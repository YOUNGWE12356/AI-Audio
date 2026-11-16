import assert from 'node:assert/strict';
import test from 'node:test';
import { batchAudioExports, batchExportRequirements, confirmedVersion, confirmedVersions, confirmBatchVersion,
  restoreBatchProjectRow, unconfirmBatchVersion, updateBatchVersionRange, type BatchRow } from './sfxBatchProject';
import { batchRequirementsCsv } from './sfxBatch';

const range = { start: 1, end: 3 };
const blob = new Blob(['confirmed audio']);
const makeRow = (): BatchRow => ({ id: 'row', name: 'Sfx_Footstep_Wood_Walk', description: '脚步', keywords: '脚步',
  searchQuery: 'footsteps', duration: 2, scene: '', selected: true, status: '待试听与确认', excludedSources: [],
  versions: ['a', 'b'].map(id => ({ id, kind: 'search', title: id, duration: 5, blob: new Blob([`original ${id}`]) })) });
const confirmBoth = () => confirmBatchVersion(confirmBatchVersion(makeRow(), 'b', blob, range), 'a', new Blob(['second']), { start: 0, end: 4 });

test('legacy projects only migrate their selected candidate, not historical confirmed blobs', () => {
  const row = makeRow(); row.confirmedVersionId = 'b';
  row.versions.forEach(version => { version.confirmedBlob = blob; });
  assert.deepEqual(confirmedVersions(row).map(version => version.id), ['b']);
  assert.deepEqual(confirmedVersions({ ...row, confirmedVersionIds: [] }), []);
  assert.equal(confirmedVersion({ ...row, confirmedVersionIds: [] }), undefined);
});

test('confirming multiple candidates preserves independent ranges and stable confirmation order', () => {
  const original = makeRow();
  const first = confirmBatchVersion(original, 'b', blob, range);
  const second = confirmBatchVersion(first, 'a', new Blob(['second']), { start: 0, end: 4 });
  assert.deepEqual(second.confirmedVersionIds, ['b', 'a']);
  assert.equal(confirmedVersion(second)?.id, 'b', 'the existing video choice is retained');
  assert.equal(second.versions[1].confirmedBlob, blob);
  assert.deepEqual(second.versions[1].confirmedRange, range);
  assert.deepEqual(confirmedVersions(second).map(version => version.confirmedRange), [range, { start: 0, end: 4 }]);
  assert.deepEqual(confirmBatchVersion(second, 'b', blob, range).confirmedVersionIds, ['b', 'a']);
  assert.equal(confirmBatchVersion(second, 'missing', blob, range), second);
  assert.equal(original.versions[1].confirmedBlob, undefined);
});

test('audio exports, table rows and collision handling agree on every numbered filename', () => {
  const single = confirmBatchVersion(makeRow(), 'b', blob, range);
  assert.equal(batchAudioExports([single])[0].name, 'Sfx_Footstep_Wood_Walk.wav');
  const multiple = confirmBoth();
  const other = { ...single, id: 'other', name: 'Sfx_Footstep_Wood_Walk_1' };
  const pending = { ...makeRow(), id: 'pending' };
  const rows = [multiple, other, pending];
  const exports = batchAudioExports(rows);
  assert.deepEqual(exports.map(entry => entry.name), ['Sfx_Footstep_Wood_Walk_1.wav', 'Sfx_Footstep_Wood_Walk_2.wav', 'Sfx_Footstep_Wood_Walk_1_2.wav']);
  assert.deepEqual(exports.map(entry => entry.version.id), ['b', 'a', 'b']);
  const table = batchExportRequirements(rows);
  assert.deepEqual(table.slice(0, 3).map(row => `${row.name}.wav`), exports.map(entry => entry.name));
  assert.deepEqual(table.map(row => row.confirmedDuration), [2, 4, 2, undefined]);
  assert.equal(table[3].id, 'pending');
  const csv = batchRequirementsCsv(table);
  assert.match(csv, /"Sfx_Footstep_Wood_Walk_1"/);
  assert.match(csv, /"Sfx_Footstep_Wood_Walk_2"/);
  const longRows = [{ ...multiple, name: 'a'.repeat(100) }, { ...multiple, id: 'same-name', name: 'a'.repeat(100) }];
  const longExports = batchAudioExports(longRows).map(entry => entry.name);
  assert.ok(longExports[0].endsWith('_1.wav'));
  assert.ok(longExports[1].endsWith('_2.wav'));
  assert.equal(new Set(longExports).size, 4);
  assert.deepEqual(batchExportRequirements(longRows).map(row => `${row.name}.wav`), longExports);
  assert.ok(longExports.every(name => name.length <= 104));
});

test('canceling or trimming one candidate keeps other confirmations and their audio', () => {
  const both = { ...confirmBoth(), placedVersionId: 'b' };
  assert.equal(updateBatchVersionRange(both, 'b', { ...range }), both);
  const edited = updateBatchVersionRange(both, 'a', { start: 1, end: 4 });
  assert.deepEqual(edited.confirmedVersionIds, ['b']);
  assert.equal(edited.placedVersionId, 'b');
  assert.equal(edited.versions[0].confirmedBlob, undefined);
  assert.equal(edited.versions[1].confirmedBlob, blob);
  const canceled = unconfirmBatchVersion(both, 'b');
  assert.deepEqual(canceled.confirmedVersionIds, ['a']);
  assert.equal(canceled.confirmedVersionId, 'a');
  assert.equal(canceled.placedVersionId, undefined);
  assert.equal(batchAudioExports([canceled])[0].name, 'Sfx_Footstep_Wood_Walk.wav');
  const empty = unconfirmBatchVersion(canceled, 'a');
  assert.deepEqual(confirmedVersions(empty), []);
  assert.equal(empty.confirmedVersionId, undefined);
  assert.equal(empty.status, '待试听与确认');
});

test('saved projects restore all choices, original audio and independent trim ranges', async () => {
  const restored = restoreBatchProjectRow(structuredClone(confirmBoth()));
  assert.deepEqual(restored.confirmedVersionIds, ['b', 'a']);
  assert.deepEqual(confirmedVersions(restored).map(version => version.confirmedRange), [range, { start: 0, end: 4 }]);
  assert.equal(await restored.versions[1].confirmedBlob!.text(), 'confirmed audio');
  assert.equal(await restored.versions[1].blob!.text(), 'original b');
  restored.versions.forEach(version => { assert.ok(version.url?.startsWith('blob:')); URL.revokeObjectURL(version.url!); });
  const legacy = makeRow(); legacy.confirmedVersionId = 'a'; legacy.versions[0].confirmedBlob = blob;
  assert.equal(confirmedVersion(restoreBatchProjectRow(legacy))?.id, 'a');
});
