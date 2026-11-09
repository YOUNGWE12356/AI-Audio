import { confirmedVersion, type BatchRow } from './sfxBatchProject';

export const isBatchPoint = (time: unknown, duration: number): time is number =>
  typeof time === 'number' && Number.isFinite(time) && time >= 0 && time < duration;

export type BatchTimeRange = { start: number; end: number };
/** Old single-point projects acquire a range without losing their saved audio. */
export function batchTimeRange(row: { time?: number; endTime?: number; duration: number }, videoDuration: number): BatchTimeRange | null {
  if (!isBatchPoint(row.time, videoDuration)) return null;
  const length = Number.isFinite(row.duration) && row.duration > 0 ? row.duration : 3;
  const end = Math.min(videoDuration, typeof row.endTime === 'number' && Number.isFinite(row.endTime) && row.endTime > row.time ? row.endTime : row.time + length);
  return end > row.time ? { start: row.time, end } : null;
}

export function batchOccurrenceRange(row: BatchRow, occurrenceIndex: number, duration: number) {
  return batchTimeRange(occurrenceIndex ? { ...row.occurrences?.[occurrenceIndex - 1], duration: row.duration } : row, duration);
}

export function updateBatchOccurrence(row: BatchRow, occurrenceIndex: number, time: number | undefined, endTime?: number): BatchRow {
  if (!occurrenceIndex) return { ...row, time, endTime };
  if (!row.occurrences?.[occurrenceIndex - 1]) return row;
  return { ...row, occurrences: row.occurrences.flatMap((point, index) => index !== occurrenceIndex - 1 ? [point]
    : time === undefined || endTime === undefined ? [] : [{ time, endTime }]) };
}

export function resizeBatchTimeRange(range: BatchTimeRange, edge: 'start' | 'end', time: number, duration: number): BatchTimeRange {
  const value = Math.round(time * 1000) / 1000;
  return edge === 'start' ? { start: Math.max(0, Math.min(range.end - 0.001, value)), end: range.end }
    : { start: range.start, end: Math.min(duration, Math.max(range.start + 0.001, value)) };
}

/** Move both boundaries together, preserving length even at the video edges. */
export function moveBatchTimeRange(range: BatchTimeRange, delta: number, duration: number): BatchTimeRange {
  const length = range.end - range.start;
  const start = Math.max(0, Math.min(duration - length, Math.round((range.start + delta) * 1000) / 1000));
  return { start, end: Math.min(duration, Math.round((start + length) * 1000) / 1000) };
}

export function layoutBatchTimeRanges(rows: BatchRow[], videoId: string, duration: number) {
  const ends: number[] = [];
  return rows.flatMap((row, index) => {
    return row.videoId !== videoId ? [] : Array.from({ length: 1 + (row.occurrences?.length || 0) }, (_, occurrenceIndex) => {
      const range = batchOccurrenceRange(row, occurrenceIndex, duration);
      return range ? { row, index, range, occurrenceIndex } : null;
    }).filter(item => item !== null);
  }).sort((a, b) => a.range.start - b.range.start || a.index - b.index).map(item => {
    let lane = ends.findIndex(end => end <= item.range.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = item.range.end;
    return { ...item, lane };
  });
}

export function batchVideoClips(rows: BatchRow[], videoId: string, duration: number) {
  return rows.flatMap(row => {
    const version = confirmedVersion(row);
    if (row.videoId !== videoId || !version?.confirmedBlob || row.placedVersionId !== version.id) return [];
    const length = (version.confirmedRange?.end || 0) - (version.confirmedRange?.start || 0);
    if (length <= 0) return [];
    return Array.from({ length: 1 + (row.occurrences?.length || 0) }, (_, occurrenceIndex) => {
      const range = batchOccurrenceRange(row, occurrenceIndex, duration);
      return range ? { rowId: row.id, occurrenceIndex, versionId: version.id, name: row.name, time: range.start,
        duration: Math.min(length, range.end - range.start), blob: version.confirmedBlob! } : null;
    }).filter(item => item !== null);
  });
}
export type BatchVideoClip = ReturnType<typeof batchVideoClips>[number];

/** Schedule in audio-clock time, with offsets when seeking into a clip. Each
 * sound owns its source node, so overlapping effects never replace each other. */
export function scheduleBatchVideoAudio(context: AudioContext, clips: Array<{ time: number; duration: number; buffer: AudioBuffer }>, time: number, rate = 1) {
  const speed = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const anchor = context.currentTime;
  const nodes: AudioBufferSourceNode[] = [];
  for (const clip of clips) {
    const offset = Math.max(0, time - clip.time);
    const remaining = Math.min(clip.duration, clip.buffer.duration) - offset;
    if (remaining <= 0) continue;
    const node = context.createBufferSource(); node.buffer = clip.buffer;
    node.playbackRate.value = speed; node.connect(context.destination);
    node.onended = () => node.disconnect();
    node.start(anchor + Math.max(0, clip.time - time) / speed, offset, remaining);
    nodes.push(node);
  }
  return { anchor, time, rate: speed, stop: () => nodes.forEach(node => {
    node.onended = null; try { node.stop(); } catch {} node.disconnect();
  }) };
}
