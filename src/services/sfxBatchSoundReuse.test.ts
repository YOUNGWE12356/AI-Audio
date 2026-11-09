import assert from 'node:assert/strict';
import test from 'node:test';
import { consolidateBatchVideoSounds } from './sfxBatchSoundReuse';
import { normalizeBatchRequirements, batchRequirementsCsv, type SfxBatchRequirement } from './sfxBatch';
import { analyzeSfxBatch, normalizeSfxBatchInput } from './sfxBatchServer';
import { batchOccurrenceRange, batchVideoClips, layoutBatchTimeRanges, updateBatchOccurrence } from './batchVideoTimeline';
import type { BatchRow } from './sfxBatchProject';

const cue = (name: string, time: number, description = '少量硬币零星掉落，清脆金属碰撞'): SfxBatchRequirement => ({
  id: name, name, time, endTime: time + 0.75, description, duration: 0.75,
  keywords: '硬币、掉落', searchQuery: 'coin drop', scene: `${time}秒出现掉落动作`,
});

test('semantic reuse consolidates repeated sounds across times/names while keeping sparse and dense coin variants', () => {
  const original = [cue('Coin_Drop01', 1), cue('Coin_Drop02', 5, '几枚硬币轻碰后短暂滚动'),
    cue('Coin_Drop03', 8, '大量硬币密集倾泻，持续滚落'), cue('Reel_Spin01', 2, '转轮快速旋转'), cue('Reel_Spin02', 6, '四格转轮再次快速转动')];
  const result = consolidateBatchVideoSounds(original, ['coin_sparse', 'coin_sparse', 'coin_shower', 'reel_spin', 'reel_spin']);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0].occurrences, [{ time: 5, endTime: 5.75 }]);
  assert.equal(result[1].description, original[2].description);
  assert.deepEqual(result[2].occurrences, [{ time: 6, endTime: 6.75 }]);
  assert.equal(original[0].occurrences, undefined, 'inputs remain intact');
  assert.equal(consolidateBatchVideoSounds(original, []).length, 5, 'uncertain groups must not merge by keyword/name');
  assert.equal(consolidateBatchVideoSounds([original[0], original[0]], ['same', 'same'])[0].occurrences?.length, 0);
});

test('reuse ranges survive normalization/export and independently edit, place and bound to the same video', () => {
  const grouped = consolidateBatchVideoSounds([cue('First', 1), cue('Again', 5)], ['same', 'same']);
  const normalized = normalizeBatchRequirements(grouped);
  assert.deepEqual(normalized[0].occurrences, [{ time: 5, endTime: 5.75 }]);
  assert.match(batchRequirementsCsv(normalized), /其他复用范围（秒）/);
  assert.match(batchRequirementsCsv(normalized), /5—5.75/);
  const row: BatchRow = { ...normalized[0], videoId: 'v', selected: true, excludedSources: [], status: '',
    confirmedVersionId: 'audio', placedVersionId: 'audio', versions: [{ id: 'audio', kind: 'generate', title: '声音',
      confirmedBlob: new Blob(['audio']), confirmedRange: { start: 0, end: 0.75 } }] };
  assert.deepEqual(layoutBatchTimeRanges([row], 'v', 10).map(item => [item.occurrenceIndex, item.range.start]), [[0, 1], [1, 5]]);
  assert.deepEqual(batchVideoClips([row], 'v', 10).map(clip => clip.time), [1, 5]);
  assert.deepEqual(batchVideoClips([row], 'other', 10), []);
  const changed = updateBatchOccurrence(row, 1, 7, 8);
  assert.equal(changed.time, 1);
  assert.deepEqual(batchOccurrenceRange(changed, 1, 7.5), { start: 7, end: 7.5 });
  assert.equal(changed.versions, row.versions, 'range edits retain confirmed audio');
  assert.deepEqual(updateBatchOccurrence(changed, 1, undefined).occurrences, []);
  for (const occurrences of [[{ time: -1, endTime: 2 }], [{ time: 2, endTime: 1 }], [{ time: Infinity, endTime: 3 }]]) {
    assert.throws(() => normalizeBatchRequirements([{ ...grouped[0], occurrences }]), /复用点位/);
  }
});

test('full video review performs reuse in its existing request and preserves every real placement without extra model calls', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfkEAAAAASUVORK5CYII=';
  const input = normalizeSfxBatchInput({ sourceType: 'video', videoDuration: 10,
    files: [{ mimeType: 'image/png', data: png, label: '视频画面0秒' }] });
  let calls = 0;
  const result = await analyzeSfxBatch(input, undefined, (async (options: any) => {
    calls++;
    if (calls === 1) return { text: JSON.stringify({ items: [cue('Coin01', 1), cue('Coin02', 5)] }) };
    assert.match(options.contents[0].parts[0].text, /少量硬币零星掉落与大量硬币密集倾泻必须分开/);
    assert.ok(options.config.responseSchema.properties.items.items.required.includes('soundGroup'));
    return { text: JSON.stringify({ items: [cue('Coin01', 1), cue('Coin02', 5)].map(item => ({ ...item, soundGroup: 'coins_sparse' })) }) };
  }) as any);
  assert.equal(calls, 2);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].occurrences, [{ time: 5, endTime: 5.75 }]);
});
