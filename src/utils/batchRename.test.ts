import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBatchRenameRules, getRenamePreviewOperations, type RenameOperation, type RenameRules } from './batchRename';

const remove: RenameOperation = { id: 'remove', type: 'remove', findText: '_', replaceText: '' };

test('underscore deletion runs after cleanup for original spaces and underscores', () => {
  const rules: RenameRules = { normalizeFileName: true, operations: [remove] };
  for (const name of ['魔法 飞行', '魔法_飞行', '魔法 __ 飞行']) {
    assert.equal(applyBatchRenameRules(name, 0, rules), '魔法飞行');
  }
  assert.equal(applyBatchRenameRules('魔法 飞行', 0, { ...rules, operations: [] }), '魔法_飞行');
  assert.equal(applyBatchRenameRules('魔法 飞行', 0, { ...rules, normalizeFileName: false }), '魔法 飞行');
});

test('each rule preview stops at its selected step, always from the original name', () => {
  const rules: RenameRules = { normalizeFileName: true, operations: [
    remove,
    { id: 'prefix', type: 'prefix', findText: '', replaceText: '', insertText: 'SFX_' },
    { id: 'number', type: 'number', findText: '', replaceText: '', numberStart: 9, numberPadding: 3 },
  ] };
  const preview = (id: string | null) => applyBatchRenameRules('魔法 飞行', 0,
    { ...rules, operations: getRenamePreviewOperations(rules, id) });
  assert.equal(preview('remove'), '魔法飞行');
  assert.equal(preview('prefix'), 'SFX_魔法飞行');
  assert.equal(preview('number'), 'SFX_魔法飞行_009');
  assert.equal(preview('remove'), '魔法飞行');
  assert.equal(preview('deleted-rule'), preview(null));
});

test('explicit replacements and separators survive cleanup; regex errors and empty names remain safe', () => {
  assert.equal(applyBatchRenameRules('魔法 飞行', 0, { normalizeFileName: true, operations: [
    { ...remove, type: 'replace', replaceText: '-' },
  ] }), '魔法-飞行');
  assert.equal(applyBatchRenameRules('a_b', 0, { normalizeFileName: true, operations: [
    { ...remove, type: 'replace', replaceText: '$&' },
  ] }), 'a$&b');
  assert.equal(applyBatchRenameRules('a b', 0, { normalizeFileName: true, operations: [
    { ...remove, type: 'regexReplace', findText: '[' },
  ] }), 'a_b');
  assert.equal(applyBatchRenameRules('_', 0, { normalizeFileName: true, operations: [remove] }), 'renamed_audio');
});
