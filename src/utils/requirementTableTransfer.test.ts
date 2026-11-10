import test from 'node:test';
import assert from 'node:assert/strict';
import { requirementTableText } from './requirementTableTransfer';
import { prepareSfxBatchInput } from '../services/sfxBatchClient';
import { normalizeSfxBatchInput } from '../services/sfxBatchServer';

test('table transfer retains every row, edited values, empty cells and multiline descriptions', () => {
  assert.equal(requirementTableText(['类型', '命名', '描述', '时长'], [
    ['SFX', 'Door_Open', '木门\t打开\n带"吱呀"声', 1.5],
    ['BGM', 'Music_Loop', null, 0],
    ['SFX', '修改后的命名', '脚步', undefined],
  ]), '类型\t命名\t描述\t时长\nSFX\tDoor_Open\t"木门\t打开\n带""吱呀""声"\t1.5\nBGM\tMusic_Loop\t\t0\nSFX\t修改后的命名\t脚步\t');
});

test('pasted full tables use the table text budget and arrive at the server intact', async () => {
  const text = requirementTableText(['序号', '音效描述'], Array.from({ length: 30 }, (_, i) => [i + 1, '木门缓慢打开，木轴吱呀，无音乐。'.repeat(15)]));
  assert.ok(text.length > 5000);
  const prepared = await prepareSfxBatchInput(null, text, () => {});
  const normalized = normalizeSfxBatchInput(prepared);
  assert.equal(normalized.text, text);
  assert.equal(normalized.instructions, '');
  assert.equal(normalized.sourceType, 'table');
  assert.deepEqual(normalized.files, []);
  await assert.rejects(prepareSfxBatchInput(null, '长'.repeat(80_001), () => {}), /超过80000/);
});
