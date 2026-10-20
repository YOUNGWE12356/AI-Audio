import { encodeWav } from './audioEncoderService';

type FactoryEncodingOptions = {
  format: 'wav' | 'mp3' | 'ogg';
  sampleRate: number;
  bitrate: number;
  channelMode: 'mono' | 'stereo';
  signal?: AbortSignal;
};

function peakOf(buffer: AudioBuffer) {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    for (const sample of buffer.getChannelData(channel)) {
      if (!Number.isFinite(sample)) throw new Error('音频包含无效采样数据，请重新转换。');
      peak = Math.max(peak, Math.abs(sample));
    }
  }
  return peak;
}

/** Decode the actual encoded file before exposing it as a successful result. */
export async function validateFactoryAudioOutput(source: AudioBuffer, blob: Blob, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!blob.size) throw new Error('编码结果为空，未生成可试听音频。');
  const Context = window.AudioContext || (window as any).webkitAudioContext;
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    signal?.throwIfAborted();
    if (!decoded.length || !Number.isFinite(decoded.duration) || decoded.duration <= 0) {
      throw new Error('编码结果没有有效音频，请重新转换。');
    }
    const outputPeak = peakOf(decoded);
    // Allow intentionally silent or sub-quantization input, but reject the known
    // encoder failure that turns audible PCM into an entirely silent MP3.
    if (peakOf(source) > 1 / 32768 && outputPeak < 1e-7) {
      throw new Error('编码后音频意外变成静音，未交付该结果。请重新转换。');
    }
  } finally {
    await context.close();
  }
}

export async function encodeFactoryAudio(source: AudioBuffer, sourceName: string, options: FactoryEncodingOptions) {
  options.signal?.throwIfAborted();
  const wav = encodeWav(source);
  let output = wav;
  if (options.format !== 'wav') {
    // lamejs can silently produce zero samples when it internally resamples
    // 44.1/48 kHz PCM at 96 kbps. Use the existing local FFmpeg endpoint.
    const form = new FormData();
    form.append('media', wav, `${sourceName.replace(/\.[^/.]+$/, '') || 'audio'}-factory-source.wav`);
    form.append('format', options.format);
    form.append('sampleRate', String(options.sampleRate));
    form.append('bitrate', `${options.bitrate}k`);
    form.append('channelMode', options.channelMode);
    const response = await fetch('/api/audio/convert', { method: 'POST', body: form, signal: options.signal });
    if (!response.ok) {
      const message = (response.headers.get('content-type') || '').includes('application/json')
        ? String((await response.json().catch(() => null))?.error || '')
        : await response.text().catch(() => '');
      throw new Error(message || `${options.format.toUpperCase()} 本地转码失败（${response.status}）。`);
    }
    output = await response.blob();
  }
  await validateFactoryAudioOutput(source, output, options.signal);
  return output;
}
