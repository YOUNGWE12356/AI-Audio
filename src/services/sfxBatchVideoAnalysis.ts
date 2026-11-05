import { SFX_BATCH_MAX_ROWS, type SfxBatchRequirement } from './sfxBatch';

export const SFX_BATCH_VIDEO_MAX_FRAMES = 240;
export const SFX_BATCH_VIDEO_MIN_FRAMES = 12;
export const SFX_BATCH_VIDEO_FRAME_INTERVAL = 0.25;
export const SFX_BATCH_VIDEO_SEGMENT_FRAMES = 24;
export const SFX_BATCH_VIDEO_CONCURRENCY = 3;
export const SFX_BATCH_VIDEO_MAX_DIMENSION = 768;
export const SFX_BATCH_RANGE_MAX_FRAMES = 96;
export const SFX_BATCH_RANGE_FRAME_INTERVAL = 0.125;
export function batchRangeFrameCount(start: number, end: number, videoDuration: number) {
  if (![start, end, videoDuration].every(Number.isFinite) || start < 0 || end <= start || end > videoDuration) {
    throw new Error('视频分析范围无效，请检查起止时间。');
  }
  return Math.min(SFX_BATCH_RANGE_MAX_FRAMES, Math.max(6, Math.ceil((end - start) / SFX_BATCH_RANGE_FRAME_INTERVAL) + 1));
}
export const SFX_BATCH_VIDEO_REVIEW_FRAMES = 48;
// Ten segments / three workers + overview, each with a three-minute gateway budget.
export const SFX_BATCH_VIDEO_JOB_TIMEOUT_MS = 16 * 60_000;

export function batchVideoFrameCount(duration: number) {
  return Math.min(SFX_BATCH_VIDEO_MAX_FRAMES, Math.max(SFX_BATCH_VIDEO_MIN_FRAMES,
    Math.ceil((Number.isFinite(duration) && duration > 0 ? duration : 30) / SFX_BATCH_VIDEO_FRAME_INTERVAL) + 1));
}

/** Adjacent segments share context so actions at a segment boundary remain visible. */
export function batchVideoSegments<T>(frames: T[]): T[][] {
  const segments: T[][] = [];
  for (let start = 0; start < frames.length; start += SFX_BATCH_VIDEO_SEGMENT_FRAMES) {
    segments.push(frames.slice(Math.max(0, start - 1), start + SFX_BATCH_VIDEO_SEGMENT_FRAMES + 1));
  }
  return segments;
}

/** Detailed passes see every frame; the final pass only needs a whole-video overview. */
export function batchVideoOverview<T>(frames: T[]): T[] {
  if (frames.length <= SFX_BATCH_VIDEO_REVIEW_FRAMES) return frames;
  return Array.from({ length: SFX_BATCH_VIDEO_REVIEW_FRAMES }, (_, i) =>
    frames[Math.round(i * (frames.length - 1) / (SFX_BATCH_VIDEO_REVIEW_FRAMES - 1))]);
}

export function mergeBatchVideoRequirements(existing: SfxBatchRequirement[], incoming: SfxBatchRequirement[]) {
  const result = [...existing];
  for (const item of incoming) {
    const duplicate = existing.some(previous => previous.name.toLowerCase() === item.name.toLowerCase()
      && previous.searchQuery.toLowerCase() === item.searchQuery.toLowerCase()
      // Time/name/query alone cannot distinguish two objects acting simultaneously.
      && previous.description === item.description && previous.scene === item.scene
      && (item.time === undefined || previous.time === undefined
        ? item.time === previous.time
        : Math.abs(previous.time - item.time) < 0.05
          && Math.abs((previous.endTime ?? previous.time + previous.duration) - (item.endTime ?? item.time + item.duration)) < 0.05));
    if (!duplicate) result.push(item);
  }
  if (result.length > SFX_BATCH_MAX_ROWS) throw new Error(`细致分析发现超过${SFX_BATCH_MAX_ROWS}条音效需求，请将视频分段后分析。`);
  return result.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity)).map((item, index) => ({ ...item, id: `sfx-${index + 1}` }));
}
