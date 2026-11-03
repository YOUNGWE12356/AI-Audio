import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForAudioDesignJob, generateAudioDesignInBackground } from './audioDesignJobsClient';

const result = { bgmRecommendations: [{ style: 'test' }], sfxSchemes: [] };
test('connection interruption queries the same task without repeating inference', async () => {
  const original = globalThis.fetch; let calls = 0; const messages: string[] = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(options?.method, 'GET'); assert.match(String(url), /jobs\/same-job$/); calls++;
    if (calls === 1) return Response.json({ error: 'temporary' }, { status: 503 });
    return Response.json({ id: 'same-job', status: 'completed', result });
  };
  try {
    const output = await waitForAudioDesignJob({ id: 'same-job', status: 'running', createdAt: Date.now(), message: '' }, { pollMs: 1, onProgress: m => messages.push(m) });
    assert.equal(output.bgmRecommendations.length, 1); assert.equal(calls, 2);
    assert.ok(messages.some(m => m.includes('不会重复生成')));
    await assert.rejects(waitForAudioDesignJob({ id: 'slow-job', status: 'running', createdAt: Date.now() - 90_001, message: '' }), /90 秒.*已停止/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('resubmission after a lost acknowledgement reuses request ID and cancellation reaches the job', async () => {
  const original = globalThis.fetch;
  const originalStorage = (globalThis as any).sessionStorage;
  const values = new Map<string, string>();
  (globalThis as any).sessionStorage = { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  const ids: string[] = []; let cancelled = '';
  const controller = new AbortController();
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body || '{}'));
    if (String(url).endsWith('/cancel')) { cancelled = body.requestId; return Response.json({ success: true }); }
    if (options?.method === 'POST') {
      ids.push(body.requestId);
      if (ids.length === 1) throw new Error('lost acknowledgement');
      return Response.json({ id: 'same-job', status: 'running', createdAt: Date.now(), message: 'waiting' });
    }
    throw new Error('No extra task should be submitted');
  };
  try {
    const operation = generateAudioDesignInBackground({ requirements: 'test' }, { signal: controller.signal, onProgress: message => {
      if (message.includes('已等待')) controller.abort();
    } });
    await assert.rejects(operation, { name: 'AbortError' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]); assert.equal(cancelled, ids[0]);
  } finally { globalThis.fetch = original; (globalThis as any).sessionStorage = originalStorage; }
});

test('the 90 second limit cancels the server task rather than leaving inference running', async () => {
  const original = globalThis.fetch;
  let submitted = '', cancelled = '';
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (String(url).endsWith('/cancel')) { cancelled = body.requestId; return Response.json({ success: true }); }
    submitted = body.requestId;
    return Response.json({ id: 'too-slow', status: 'running', createdAt: Date.now() - 90_001, message: 'waiting' });
  };
  try {
    await assert.rejects(generateAudioDesignInBackground({ requirements: 'timeout fixture' }), /90 秒.*已停止/);
    assert.ok(submitted); assert.equal(cancelled, submitted);
  } finally { globalThis.fetch = original; }
});
