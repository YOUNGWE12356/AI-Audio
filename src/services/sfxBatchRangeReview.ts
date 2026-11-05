import { batchFileStem, SFX_BATCH_MAX_ROWS, type SfxBatchRequirement } from './sfxBatch';
import { batchId, type BatchRow } from './sfxBatchProject';
import { batchTimeRange } from './batchVideoTimeline';

const fingerprint = (row: SfxBatchRequirement) => JSON.stringify([row.name, row.description, row.keywords,
  row.searchQuery, row.scene, row.time, row.endTime, row.duration]);

/** Apply a range review atomically: keep the hand-drawn window and saved audio,
 * insert independent new events beside it, and leave unrelated rows untouched. */
export function applyBatchRangeReview(rows: BatchRow[], id: string, videoId: string,
  requirements: SfxBatchRequirement[], videoDuration: number) {
  const index = rows.findIndex(row => row.id === id && row.videoId === videoId);
  const original = rows[index], range = original && batchTimeRange(original, videoDuration);
  if (!original || !range || !requirements.length) return rows;
  // Replace only untouched suggestions from this same review. Manual edits and
  // anything already searched/generated remain user work and must survive.
  const retained = rows.filter(row => !(row.videoId === videoId && row.rangeReviewParentId === id
    && row.id !== id && !row.versions.length && row.rangeReviewFingerprint === fingerprint(row)));
  const retainedIndex = retained.indexOf(original);
  const [first, ...extra] = requirements;
  const additions = extra.filter(item => !retained.some(row => row.id !== id && row.videoId === videoId
    && row.rangeReviewParentId === id
    && batchFileStem(row.name).toLowerCase() === batchFileStem(item.name).toLowerCase()
    && row.searchQuery.trim().toLowerCase() === item.searchQuery.trim().toLowerCase()
    && (row.time === undefined || item.time === undefined ? row.time === item.time : Math.abs(row.time - item.time) < 0.15)));
  if (retained.length + additions.length > SFX_BATCH_MAX_ROWS) {
    throw new Error(`范围分析后的需求超过${SFX_BATCH_MAX_ROWS}条，请先整理列表后重试；当前需求未改动。`);
  }
  const updated: BatchRow = { ...original, ...first, id: original.id, name: batchFileStem(first.name),
    time: range.start, endTime: range.end, duration: Math.max(0.5, Math.min(30, range.end - range.start)),
    confirmedVersionId: undefined, placedVersionId: undefined, error: undefined,
    status: '范围分析完成，待制作或重新确认音效' };
  const added: BatchRow[] = additions.map(item => {
    const row: BatchRow = { ...item, id: batchId(), name: batchFileStem(item.name), videoId, selected: true,
      versions: [], excludedSources: [], status: '范围分析新增，待制作', rangeReviewParentId: id };
    return { ...row, rangeReviewFingerprint: fingerprint(row) };
  });
  return [...retained.slice(0, retainedIndex), updated, ...added, ...retained.slice(retainedIndex + 1)];
}
