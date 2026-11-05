import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBatchRangeReview } from './sfxBatchRangeReview';
import type { BatchRow } from './sfxBatchProject';
import { SFX_BATCH_MAX_ROWS } from './sfxBatch';

const original: BatchRow = { id: 'manual', videoId: 'video', time: 16.5, endTime: 19.5, duration: 3,
  name: 'Manual', description: '', keywords: '', searchQuery: '', scene: '', selected: true,
  versions: [{ id: 'audio', kind: 'search', title: 'Saved', blob: new Blob(['saved audio']), confirmedBlob: new Blob(['trim']), confirmedRange: { start: 0, end: 1 } }],
  confirmedVersionId: 'audio', placedVersionId: 'audio', activeVersionId: 'audio', excludedSources: ['previous'], status: '已确认' };
const requirements = [0, 1].map(i => ({ id: `result-${i}`, name: `Card Flip ${i}`, time: 17, endTime: 17.5, duration: 0.5,
  description: `独立声源${i}的详细描述`, keywords: '翻牌', searchQuery: 'card flip', scene: '上方与下方卡牌' }));

test('range review preserves hand-drawn boundaries and audio, inserts independent events without touching other rows', () => {
  const other = { ...original, id: 'unrelated' };
  const rows = [other, original];
  const result = applyBatchRangeReview(rows, 'manual', 'video', requirements, 53.3);
  assert.equal(result.length, 3); assert.equal(result[0], other);
  assert.deepEqual([result[1].time, result[1].endTime, result[1].duration], [16.5, 19.5, 3]);
  assert.equal(result[1].versions, original.versions); assert.equal(result[1].activeVersionId, 'audio');
  assert.equal(result[1].confirmedVersionId, undefined); assert.equal(result[1].placedVersionId, undefined);
  assert.equal(result[1].name, 'Card_Flip_0'); assert.equal(result[1].description, requirements[0].description);
  assert.deepEqual([result[2].time, result[2].endTime], [17, 17.5]);
  assert.equal(result[2].videoId, 'video'); assert.deepEqual(result[2].versions, []);
  assert.equal(original.confirmedVersionId, 'audio'); assert.equal(rows.length, 2);
  assert.equal(applyBatchRangeReview(rows, 'manual', 'another-video', requirements, 53.3), rows);
  assert.equal(applyBatchRangeReview(rows, 'manual', 'video', [], 53.3), rows);
});

test('range review capacity errors leave the original rows and confirmations untouched', () => {
  const rows = Array.from({ length: SFX_BATCH_MAX_ROWS }, (_, i) => i ? { ...original, id: `row-${i}` } : original);
  assert.throws(() => applyBatchRangeReview(rows, 'manual', 'video', requirements, 53.3), /当前需求未改动/);
  assert.equal(rows[0], original); assert.equal(rows[0].confirmedVersionId, 'audio');
});

test('repeated reviews replace untouched suggestions and preserve edited or produced work', () => {
  const first = applyBatchRangeReview([original], 'manual', 'video', requirements, 53.3);
  const repeated = applyBatchRangeReview(first, 'manual', 'video', requirements, 53.3);
  assert.equal(repeated.length, 2, 'no growth from repeated analysis');
  const consolidated = applyBatchRangeReview(repeated, 'manual', 'video', requirements.slice(0, 1), 53.3);
  assert.equal(consolidated.length, 1, 'unmade child suggestions can be consolidated');
  for (const saved of [{ ...first[1], description: '用户手动修改' }, { ...first[1], versions: original.versions }]) {
    const result = applyBatchRangeReview([first[0], saved], 'manual', 'video', requirements, 53.3);
    assert.equal(result.length, 2, 'existing edited/produced event is not appended again');
    assert.equal(result[1], saved);
    assert.equal(applyBatchRangeReview(result, 'manual', 'video', requirements.slice(0, 1), 53.3)[1], saved);
  }
});
