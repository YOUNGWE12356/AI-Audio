import test from 'node:test';
import assert from 'node:assert/strict';
import { requirementsErrorText } from './sfxRequirementsErrors';
import { prepareSfxBatchInput } from './sfxBatchClient';
import { sanitizeResponse } from './serverSecurity';

test('missing or unreadable source asks for reupload while storage locks do not blame the source', async () => {
  await assert.rejects(prepareSfxBatchInput(null, ' ', () => {}), /^Error: 请重新上传文件。$/);
  for (const name of ['NotFoundError', 'NotReadableError']) {
    assert.equal(requirementsErrorText(Object.assign(new Error('source unavailable'), { name })), '请重新上传文件。');
  }
  assert.equal(requirementsErrorText(new Error("EPERM: operation not permitted, rename 'D:/private/task.json.tmp' -> 'D:/private/task.json'")), '需求表任务保存失败，请稍后重试。');
  assert.equal(requirementsErrorText(Object.assign(new Error('locked'), { code: 'EBUSY' })), '需求表任务保存失败，请稍后重试。');
  assert.equal(requirementsErrorText(new Error('积分不足')), '积分不足');
  const textOnly = await prepareSfxBatchInput(null, '木门打开时的吱呀声', () => {});
  assert.equal(textOnly.text || textOnly.instructions, '木门打开时的吱呀声');
});

test('safe row-specific UCS failures survive response filtering without allowing raw provider errors or appended paths', () => {
  const failure = 'AI 未能为第 5、9 行选出有效 UCS 8.2.1 分类，请调整音效描述后重试。';
  const expected = '第 5、9 条需求的声音分类暂时无法确认，请补充音效描述后重试。';
  const job = sanitizeResponse({ status: 'failed', message: requirementsErrorText(failure), error: requirementsErrorText(failure) });
  assert.equal(job.error, expected); assert.equal(job.message, expected);
  assert.equal(sanitizeResponse({ status: 'failed', error: failure }).error, expected);
  assert.equal(sanitizeResponse({ status: 'failed', error: '原表15条中仍有2条音效未完整整理（小结算音效、大结算音效），未导入不完整清单，请重试。' }).error,
    '原表15条中仍有2条需求未完整返回，已停止导入以避免漏项。请重试或补充需求描述。');
  for (const error of [failure + ' SECRET_TOKEN D:/private/path', 'Error: provider key=SECRET_TOKEN', '/private/logs/stack']) {
    assert.equal(sanitizeResponse({ status: 'failed', error, message: error }).error, '处理失败，请稍后重试。');
  }
});
