export interface AudioDownloadRange { start: number; end: number }

/** Preview and export share the same source-frame boundaries. */
export function downloadRangeFrames(source: AudioBuffer, range: AudioDownloadRange) {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) {
    throw new Error('请选择有效的音频范围。');
  }
  const start = Math.max(0, Math.min(source.length, Math.round(range.start * source.sampleRate)));
  const end = Math.max(0, Math.min(source.length, Math.round(range.end * source.sampleRate)));
  if (end <= start) throw new Error('选区太短，请扩大下载范围。');
  return { start, end };
}

/** Round both boundaries to source frames so stereo channels stay aligned. */
export function sliceDownloadAudio(source: AudioBuffer, range: AudioDownloadRange | null): AudioBuffer {
  if (!range) return source;
  const { start, end } = downloadRangeFrames(source, range);
  const output = new AudioBuffer({ length: end - start, sampleRate: source.sampleRate, numberOfChannels: source.numberOfChannels });
  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    output.copyToChannel(source.getChannelData(channel).subarray(start, end), channel);
  }
  return output;
}

export interface AudioRangePlayback { currentTime: () => number; stop: () => void }

/** The audio engine ends at the clipped buffer's last sample, even when the UI
 * thread or a background tab delays timers. Never pause an untrimmed media file
 * from timeupdate/requestAnimationFrame to enforce a selection boundary. */
export function startAudioRangePreview(context: AudioContext, source: AudioBuffer, range: AudioDownloadRange,
  options: { currentTime: number; playbackRate: number; onEnded: (time: number) => void }): AudioRangePlayback {
  const { start, end } = downloadRangeFrames(source, range);
  const clip = sliceDownloadAudio(source, range);
  const startTime = start / source.sampleRate, endTime = end / source.sampleRate;
  const resumeFrame = Math.round((options.currentTime - startTime) * source.sampleRate);
  const offset = resumeFrame >= 0 && resumeFrame < clip.length ? resumeFrame / source.sampleRate : 0;
  const rate = Number.isFinite(options.playbackRate) && options.playbackRate > 0 ? options.playbackRate : 1;
  const node = context.createBufferSource();
  node.buffer = clip;
  node.playbackRate.value = rate;
  node.connect(context.destination);
  const startedAt = context.currentTime;
  let stopped = false;
  node.onended = () => {
    if (stopped) return;
    stopped = true; node.disconnect(); options.onEnded(endTime);
  };
  node.start(startedAt, offset);
  return {
    currentTime: () => Math.min(endTime, startTime + offset + Math.max(0, context.currentTime - startedAt) * rate),
    stop: () => {
      if (stopped) return;
      stopped = true; node.onended = null; node.stop(); node.disconnect();
    },
  };
}

export async function exportDownloadAudio(source: AudioBuffer, range: AudioDownloadRange | null, format: 'wav' | 'mp3', name: string, signal?: AbortSignal) {
  const clip = sliceDownloadAudio(source, range);
  // Reuse the validated FFmpeg path instead of the legacy browser MP3 encoder.
  const { encodeFactoryAudio } = await import('./audioFactoryEncoder');
  return encodeFactoryAudio(clip, name, { format, sampleRate: clip.sampleRate, bitrate: 192,
    channelMode: clip.numberOfChannels === 1 ? 'mono' : 'stereo', signal });
}
