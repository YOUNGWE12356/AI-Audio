export interface AudioClipRegion {
  startTime: number;
  duration: number;
  buffer: Pick<AudioBuffer, 'duration'>;
  /** Offset into the full buffer, in source seconds (before playback rate). */
  sourceOffset?: number;
  playbackRate?: number;
}

export const clipPlaybackRate = (clip: Pick<AudioClipRegion, 'playbackRate'>) => (
  Math.max(0.5, Math.min(2, clip.playbackRate ?? 1))
);

/** Move an event boundary without changing its samples or its opposite edge. */
export function resizeAudioClip<T extends AudioClipRegion>(clip: T, edge: 'left' | 'right', time: number): T {
  const rate = clipPlaybackRate(clip);
  const offset = clip.sourceOffset ?? 0;
  const end = clip.startTime + clip.duration;
  const minDuration = Math.min(0.1, clip.duration);
  if (edge === 'left') {
    const earliestStart = Math.max(0, clip.startTime - offset / rate);
    const startTime = Math.max(earliestStart, Math.min(end - minDuration, time));
    return { ...clip, startTime, duration: end - startTime,
      sourceOffset: Math.max(0, offset + (startTime - clip.startTime) * rate) };
  }
  const latestEnd = clip.startTime + (clip.buffer.duration - offset) / rate;
  const nextEnd = Math.min(latestEnd, Math.max(clip.startTime + minDuration, time));
  return { ...clip, sourceOffset: offset, duration: nextEnd - clip.startTime };
}

/** Shared by live playback and offline export; hidden source audio stays silent. */
export function getClipPlaybackRegion(clip: AudioClipRegion, playheadTime = 0) {
  const rate = clipPlaybackRate(clip);
  const timelineOffset = Math.max(0, playheadTime - clip.startTime);
  const offset = Math.min(clip.buffer.duration, (clip.sourceOffset ?? 0) + timelineOffset * rate);
  return {
    delay: Math.max(0, clip.startTime - playheadTime),
    offset,
    duration: Math.max(0, Math.min(clip.buffer.duration - offset, (clip.duration - timelineOffset) * rate)),
  };
}

const waveformCache = new WeakMap<AudioBuffer, Map<number, { path: string; width: number }>>();

/** Peaks stay anchored to the full source, independent of the visible event. */
export function getSourceWaveform(buffer: AudioBuffer, requestedResolution = 20) {
  const pixelsPerSecond = 20 * 2 ** Math.max(0, Math.ceil(Math.log2(requestedResolution / 20)));
  let resolutions = waveformCache.get(buffer);
  const cached = resolutions?.get(pixelsPerSecond);
  if (cached) return cached;
  const binFrames = Math.max(1, Math.round(buffer.sampleRate / pixelsPerSecond));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  const points: string[] = [];
  for (let start = 0; start < buffer.length; start += binFrames) {
    let low = 0, high = 0;
    const end = Math.min(buffer.length, start + binFrames);
    for (const samples of channels) {
      for (let frame = start; frame < end; frame++) {
        low = Math.min(low, samples[frame]);
        high = Math.max(high, samples[frame]);
      }
    }
    const x = (start / buffer.sampleRate * pixelsPerSecond).toFixed(3);
    points.push(`M ${x} ${(50 - high * 45).toFixed(2)} L ${x} ${(50 - low * 45).toFixed(2)}`);
  }
  const waveform = { path: points.join(' '), width: buffer.duration * pixelsPerSecond };
  if (!resolutions) { resolutions = new Map(); waveformCache.set(buffer, resolutions); }
  resolutions.set(pixelsPerSecond, waveform);
  return waveform;
}
