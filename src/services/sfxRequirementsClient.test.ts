import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForRequirementsJob } from './sfxRequirementsClient';

test('polling survives the old 90 second cutoff and a transient connection failure without resubmitting', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  const messages: string[] = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(options?.method, 'GET'); assert.match(String(url), /jobs\/job-1$/);
    calls++;
    if (calls === 1) throw new Error('connection reset');
    if (calls === 2) return Response.json({ id: 'job-1', status: 'running', message: 'AI 仍在生成', createdAt: Date.now() - 100_000 });
    return Response.json({ id: 'job-1', status: 'completed', result: { items: [{ filename: 'Door_Open' }] } });
  };
  try {
    const result = await waitForRequirementsJob({ id: 'job-1', status: 'running', message: '后台处理中', createdAt: Date.now() - 91_000 }, message => messages.push(message), { pollMs: 1, maxWaitMs: 1000 });
    assert.equal(result.items[0].filename, 'Door_Open'); assert.equal(calls, 3);
    assert.ok(messages.some(message => message.includes('不会重复生成')));
    assert.ok(messages.some(message => message.includes('AI 仍在生成')));
  } finally { globalThis.fetch = original; }
});

test('server job failures and expired jobs stop polling with the actual message', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: '需求表任务已过期' }, { status: 404 });
    await assert.rejects(waitForRequirementsJob({ id: 'job-1', status: 'running', message: '', createdAt: Date.now() }, undefined, { pollMs: 1 }), /任务已过期/);
    await assert.rejects(waitForRequirementsJob({ id: 'job-2', status: 'failed', message: '', error: '上游生成失败', createdAt: Date.now() }), /上游生成失败/);
  } finally { globalThis.fetch = original; }
});
