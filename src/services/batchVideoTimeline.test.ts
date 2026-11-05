import assert from 'node:assert/strict';
import test from 'node:test';
import { batchTimeRange, batchVideoClips, layoutBatchTimeRanges, moveBatchTimeRange, resizeBatchTimeRange, scheduleBatchVideoAudio } from './batchVideoTimeline';
import { batchRequirementsCsv, normalizeBatchRequirements } from './sfxBatch';
import { analyzeSfxBatch, normalizeSfxBatchInput } from './sfxBatchServer';
import type { BatchRow } from './sfxBatchProject';

const requirement = { name: 'Door_Open', description: '木门打开', keywords: '木门', searchQuery: 'door creak', duration: 3, scene: '开门' };
const image = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfkEAAAAASUVORK5CYII=', label: '视频点位 0.000 秒' };

test('video points preserve zero and CSV precision, and never turn unknown points into the beginning of the video', () => {
  const items = normalizeBatchRequirements([0, 5.125, -1, NaN, undefined].map(time => ({ ...requirement, time })));
  assert.deepEqual(items.map(item => item.time), [0, 5.125, undefined, undefined, undefined]);
  assert.match(batchRequirementsCsv(items), /视频点位（秒）/);
  assert.match(batchRequirementsCsv(items), /"5.125"/);
});

test('video analysis retains ranges, normalizes unknown ends and exports both boundaries', () => {
  const items = normalizeBatchRequirements([{ ...requirement, time: 1.25, endTime: 4.5 }, { ...requirement, time: -1, endTime: 8 }, { ...requirement, time: 3, endTime: 2 }]);
  assert.equal(items[0].endTime, 4.5);
  assert.equal(items[1].endTime, undefined); assert.equal(items[2].endTime, undefined);
  assert.match(batchRequirementsCsv(items), /视频结束（秒）/);
  assert.match(batchRequirementsCsv(items), /"1.25","4.5"/);
});

test('legacy points become bounded ranges and resize handles cannot cross or leave the video', () => {
  assert.deepEqual(batchTimeRange({ time: 2, duration: 3 }, 10), { start: 2, end: 5 });
  assert.deepEqual(batchTimeRange({ time: 9, duration: 3 }, 10), { start: 9, end: 10 });
  assert.deepEqual(batchTimeRange({ time: 2, endTime: 8, duration: 3 }, 10), { start: 2, end: 8 });
  assert.equal(batchTimeRange({ duration: 3 }, 10), null);
  assert.equal(batchTimeRange({ time: 10, duration: 3 }, 10), null);
  const range = { start: 2, end: 5 };
  assert.deepEqual(resizeBatchTimeRange(range, 'start', -4, 10), { start: 0, end: 5 });
  assert.deepEqual(resizeBatchTimeRange(range, 'start', 9, 10), { start: 4.999, end: 5 });
  assert.deepEqual(resizeBatchTimeRange(range, 'end', 1, 10), { start: 2, end: 2.001 });
  assert.deepEqual(resizeBatchTimeRange(range, 'end', 11, 10), { start: 2, end: 10 });
  assert.deepEqual(resizeBatchTimeRange(range, 'end', 6.12345, 10), { start: 2, end: 6.123 });
});

test('moving a range preserves its length, clamps both boundaries and moves placed audio with it', () => {
  const range = { start: 2, end: 5 };
  assert.deepEqual(moveBatchTimeRange(range, 1.23456, 10), { start: 3.235, end: 6.235 });
  assert.deepEqual(moveBatchTimeRange(range, -20, 10), { start: 0, end: 3 });
  assert.deepEqual(moveBatchTimeRange(range, 20, 10), { start: 7, end: 10 });
  assert.deepEqual(moveBatchTimeRange({ start: 0, end: 10 }, 4, 10), { start: 0, end: 10 });
  const moved = moveBatchTimeRange(range, 2, 10);
  const row = { ...requirement, id: 'move', time: moved.start, endTime: moved.end, videoId: 'v', confirmedVersionId: 'audio', placedVersionId: 'audio',
    versions: [{ id: 'audio', kind: 'generate', confirmedBlob: new Blob(['audio']), confirmedRange: { start: 1, end: 3 } }] } as BatchRow;
  assert.equal(batchVideoClips([row], 'v', 10)[0].time, 4);
  assert.equal(batchVideoClips([row], 'v', 10)[0].duration, 2);
});

test('overlapping requirement ranges have separate visible lanes and adjacent ranges reuse a lane', () => {
  const row = (id: string, time: number, endTime: number) => ({ ...requirement, id, time, endTime, videoId: 'v' }) as BatchRow;
  const items = layoutBatchTimeRanges([row('later', 5, 7), row('first', 0, 4), row('overlap', 2, 6), { ...row('foreign', 0, 9), videoId: 'other' }], 'v', 10);
  assert.deepEqual(items.map(item => [item.row.id, item.lane]), [['first', 0], ['overlap', 1], ['later', 0]]);
});

test('range review validates and preserves user boundaries and caps AI ranges at video end', async () => {
  for (const pointEndTime of [0, -1, 11, NaN]) assert.throws(() => normalizeSfxBatchInput({ sourceType: 'video', files: [image], videoDuration: 10, pointTime: 0, pointEndTime }), /范围结束/);
  const input = normalizeSfxBatchInput({ sourceType: 'video', files: [image], videoDuration: 10, pointTime: 2, pointEndTime: 7 });
  const review = await analyzeSfxBatch(input, undefined, (async (options: any) => {
    assert.match(JSON.stringify(options.contents), /保留该范围/);
    return { text: JSON.stringify({ items: [{ ...requirement, time: 1, endTime: 3 }] }) };
  }) as any);
  assert.equal(review.items[0].time, 2); assert.equal(review.items[0].endTime, 7);
  const all = await analyzeSfxBatch(normalizeSfxBatchInput({ sourceType: 'video', files: [image], videoDuration: 10 }), undefined,
    (async () => ({ text: JSON.stringify({ items: [{ ...requirement, time: 8, endTime: 12 }] }) })) as any);
  assert.equal(all.items[0].endTime, 10);
});

test('single-frame review uses the selected time and limits changes to one suggestion, while full-video analysis discards out-of-range points', async () => {
  assert.throws(() => normalizeSfxBatchInput({ pointTime: 1, instructions: 'point' }), /点位无效/);
  for (const time of [-1, 10, NaN]) assert.throws(() => normalizeSfxBatchInput({ sourceType: 'video', files: [image], videoDuration: 10, pointTime: time }), /点位无效/);
  const input = normalizeSfxBatchInput({ sourceType: 'video', files: [image], videoDuration: 10, pointTime: 0 });
  const result = await analyzeSfxBatch(input, undefined, (async (options: any) => {
    assert.match(JSON.stringify(options.contents), /单点位复核/);
    assert.match(JSON.stringify(options.contents), /0秒的指定视频帧/);
    return { text: JSON.stringify({ items: [{ ...requirement, time: 7 }, { ...requirement, time: 8 }] }) };
  }) as any);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].time, 0);
  const all = await analyzeSfxBatch(normalizeSfxBatchInput({ sourceType: 'video', files: [image], videoDuration: 10 }), undefined,
    (async () => ({ text: JSON.stringify({ items: [0, 2.5, 10, 12, -1].map(time => ({ ...requirement, time })) }) })) as any);
  assert.deepEqual(all.items.map(item => item.time), [0, 2.5, undefined, undefined, undefined]);
});

test('placed tracks use confirmed trimmed audio, remain independent when overlapping and cannot leak between videos', () => {
  const row = (id: string, time: number): BatchRow => ({ ...requirement, id, time, videoId: 'video', selected: true, excludedSources: [], status: '',
    confirmedVersionId: id, placedVersionId: id,
    versions: [{ id, kind: 'generate', title: id, confirmedBlob: new Blob(['trimmed']), confirmedRange: { start: 2, end: 5 } }] });
  const rows = [row('a', 0), row('b', 1), row('c', 9), row('d', 10), { ...row('e', 1), videoId: 'other' }, { ...row('f', 1), confirmedVersionId: undefined }, { ...row('g', 1), placedVersionId: undefined }];
  const clips = batchVideoClips(rows, 'video', 10);
  assert.deepEqual(clips.map(clip => [clip.rowId, clip.time, clip.duration]), [['a', 0, 3], ['b', 1, 3], ['c', 9, 1]]);
  assert.deepEqual(batchVideoClips(rows, 'video', 10), clips, 'repeated placement derives one track per requirement');
  rows[0].versions[0].confirmedBlob = undefined;
  assert.equal(batchVideoClips(rows, 'video', 10).length, 2, 'invalidated confirmation removes the track');
  rows[1].endTime = 2;
  assert.equal(batchVideoClips(rows, 'video', 10)[0].duration, 1, 'shortening the video range limits playback');
  rows[1].endTime = 8;
  assert.equal(batchVideoClips(rows, 'video', 10)[0].duration, 3, 'extending the range restores the existing audio without stretching');
});

test('synchronized playback schedules overlapping nodes, seeks within trimmed clips, scales speed and stops every node', () => {
  const nodes: any[] = [];
  const context = { currentTime: 20, destination: {}, createBufferSource() {
    const node = { playbackRate: { value: 1 }, connect() {}, disconnect() {}, start(...args: number[]) { node.args = args; }, stop() { node.stopped = true; }, args: [] as number[], stopped: false };
    nodes.push(node); return node;
  } } as unknown as AudioContext;
  const buffer = { duration: 3 } as AudioBuffer;
  const schedule = scheduleBatchVideoAudio(context, [{ time: 0, duration: 3, buffer }, { time: 1, duration: 3, buffer }, { time: 5, duration: 2, buffer }], 2, 2);
  assert.deepEqual(nodes.map(node => node.args), [[20, 2, 1], [20, 1, 2], [21.5, 0, 2]]);
  assert.ok(nodes.every(node => node.playbackRate.value === 2));
  schedule.stop(); assert.ok(nodes.every(node => node.stopped));
  nodes.length = 0;
  scheduleBatchVideoAudio(context, [{ time: 0, duration: 3, buffer }], 4);
  assert.equal(nodes.length, 0, 'clips that ended before a seek must stay silent');
});
