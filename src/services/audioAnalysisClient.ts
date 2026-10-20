import { analyzeDecodedAudio, type AnalyzerResult } from '../utils/audioMetrics';
import { createAudioEvidence } from '../utils/audioEvidence';

export async function extractLocalAudioEvidence(file: File, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (file.size > 100 * 1024 * 1024) throw new Error('音频超过 100MB，请先压缩或截取后分析。');
  const buffer = await decodeAudioFile(file);
  signal?.throwIfAborted();
  // Keep long files bounded; every caller receives the exact coverage.
  const length = Math.min(buffer.length, Math.floor(buffer.sampleRate * 300));
  const analyzed = {
    duration: length / buffer.sampleRate, sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels, length,
    getChannelData: (index: number) => buffer.getChannelData(index).subarray(0, length),
  } as AudioBuffer;
  const result = analyzeDecodedAudio(analyzed, file.name);
  signal?.throwIfAborted();
  return createAudioEvidence(result, buffer.duration);
}

export async function decodeAudioFile(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass();
  try {
    return await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await audioCtx.close();
  }
}
export const createSemanticAnalysisClip = (buffer: AudioBuffer, maxSeconds = 36, targetSampleRate = 16000) => {
  const segmentCount = buffer.duration > maxSeconds ? 3 : 1;
  const totalDuration = Math.min(buffer.duration, maxSeconds);
  const segmentDuration = Math.max(totalDuration / segmentCount, 1 / targetSampleRate);
  const segmentStarts = segmentCount === 1
    ? [0]
    : [
        0,
        Math.max(0, (buffer.duration - segmentDuration) / 2),
        Math.max(0, buffer.duration - segmentDuration),
      ];
  const frameCount = Math.max(1, Math.floor(totalDuration * targetSampleRate));
  const wavBuffer = new ArrayBuffer(44 + frameCount * 2);
  const view = new DataView(wavBuffer);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + frameCount * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, frameCount * 2, true);

  const channels = Array.from(
    { length: Math.min(buffer.numberOfChannels, 2) },
    (_, index) => buffer.getChannelData(index),
  );
  for (let index = 0; index < frameCount; index += 1) {
    const outputSeconds = index / targetSampleRate;
    const segmentIndex = Math.min(segmentStarts.length - 1, Math.floor(outputSeconds / segmentDuration));
    const segmentOffsetSeconds = outputSeconds - segmentIndex * segmentDuration;
    const sourceSeconds = segmentStarts[segmentIndex] + segmentOffsetSeconds;
    const sourceIndex = Math.min(buffer.length - 1, Math.floor(sourceSeconds * buffer.sampleRate));
    const sample = channels.reduce((sum, channel) => sum + (channel[sourceIndex] || 0), 0)
      / Math.max(channels.length, 1);
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
};

const requestGlobalMusicAnalysis = async (
  file: File,
  buffer: AudioBuffer,
  localResult: AnalyzerResult,
  signal?: AbortSignal,
) => {
  const formData = new FormData();
  formData.append('metadata', JSON.stringify({
    sourceName: file.name,
    duration: localResult.duration,
    bpm: localResult.bpm.value,
    keyName: localResult.key.name,
    localMode: localResult.musicalMode.name,
    localModeConfidence: localResult.musicalMode.confidence,
    tempo: localResult.bpm,
    key: localResult.key,
    musicalMode: localResult.musicalMode,
    chords: localResult.chords,
    audioProfile: localResult.audioProfile,
  }));
  formData.append(
    'audio',
    createSemanticAnalysisClip(buffer),
    `${file.name.replace(/\.[^/.]+$/, '') || 'music'}-semantic-analysis.wav`,
  );

  const response = await fetch('/api/ai/audio-analysis/semantic', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: formData,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(150_000)]) : AbortSignal.timeout(150_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `全球风格与调式分析失败（${response.status}）。`);
  }
  if (!payload?.analysis) throw new Error('全球风格与调式分析未返回有效结果。');
  return {
    ...payload.analysis,
    model: payload.model,
  } as NonNullable<AnalyzerResult['globalAnalysis']>;
};

export async function analyzeAudioFile(file: File, options: { signal?: AbortSignal; semantic?: boolean; onStage?: (stage: string) => void } = {}): Promise<AnalyzerResult> {
  options.signal?.throwIfAborted();
  options.onStage?.('读取和解码音频');
  const buffer = await decodeAudioFile(file);
  options.signal?.throwIfAborted();
  options.onStage?.('计算 BPM、调性和音频指标');
  const localResult = analyzeDecodedAudio(buffer, file.name);
  options.signal?.throwIfAborted();
  if (options.semantic === false) return { ...localResult, semanticSkipped: true };
  try {
    options.onStage?.('GPT 解读音频指标');
    const globalAnalysis = await requestGlobalMusicAnalysis(file, buffer, localResult, options.signal);
    return {
      ...localResult,
      globalAnalysis,
      instruments: globalAnalysis.analysisBasis === 'audio' && globalAnalysis.instruments?.length
        ? globalAnalysis.instruments : localResult.instruments,
      productionNotes: globalAnalysis.productionNotes?.length ? globalAnalysis.productionNotes : localResult.productionNotes,
    };
  } catch (error: any) {
    options.signal?.throwIfAborted();
    return {
      ...localResult,
      semanticError: error?.name === 'TimeoutError' ? 'GPT 分析超时，请稍后重试。' : error?.message || 'GPT 分析失败，请稍后重试。',
    };
  }
}
