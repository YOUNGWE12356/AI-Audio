import test from 'node:test';
import assert from 'node:assert/strict';
import { requirementsErrorText } from './sfxRequirementsErrors';
import { prepareSfxBatchInput } from './sfxBatchClient';

test('missing or unreadable source asks for reupload while storage locks do not blame the source', async () => {
  await assert.rejects(prepareSfxBatchInput(null, ' ', () => {}), /^Error: 请重新上传文件。$/);
  for (const name of ['NotFoundError', 'NotReadableError']) {
    assert.equal(requirementsErrorText(Object.assign(new Error('source unavailable'), { name })), '请重新上传文件。');
  }
  assert.equal(requirementsErrorText(new Error("EPERM: operation not permitted, rename 'D:/private/task.json.tmp' -> 'D:/private/task.json'")), '需求表任务保存失败，请稍后重试。');
  assert.equal(requirementsErrorText(Object.assign(new Error('locked'), { code: 'EBUSY' })), '需求表任务保存失败，请稍后重试。');
  assert.equal(requirementsErrorText(new Error('积分不足')), '积分不足');
  const textOnly = await prepareSfxBatchInput(null, '木门打开时的吱呀声', () => {});
  assert.equal(textOnly.instructions, '木门打开时的吱呀声');
});
