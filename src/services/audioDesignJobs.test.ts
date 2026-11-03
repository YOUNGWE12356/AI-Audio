import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createAudioDesignJobs } from './audioDesignJobsServer';
import { selectAudioDesignFrames, type AudioDesignJob } from './audioDesignJobs';

const result = { bgmRecommendations: [{ style: 'test' }], sfxSchemes: [] } as unknown as AudioDesignJob['result'];
async function fixture(execute: Parameters<typeof createAudioDesignJobs<any>>[0]['execute'], timeoutMs?: number) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-design-test-'));
  const context = new AsyncLocalStorage<string>();
  const counts = { reservations: 0, releases: 0, normalizations: 0 };
  const router = () => createAudioDesignJobs({ directory, timeoutMs,
    identity: req => String(req.headers['x-owner'] || 'alice'),
    normalize: body => { counts.normalizations++; return body; },
    reserve: () => { counts.reservations++; return () => { counts.releases++; }; },
    run: (_req, _res, work) => { void context.run('billing-owner', work); },
    execute: async (...args) => { assert.equal(context.getStore(), 'billing-owner'); return execute(...args); },
  });
  const app = express(); app.use(express.json()); app.use('/jobs', router());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/jobs`;
  const post = (route: string, body: any) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { counts, directory, router, base, post, close: async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  } };
}

test('reconnect deduplicates inference and billing, isolates owners and restores completed results', async () => {
  let finish!: (value: AudioDesignJob['result']) => void, calls = 0;
  const f = await fixture(async (_input, progress) => { calls++; progress('模型生成中'); return new Promise(resolve => { finish = resolve; }); });
  const body = { requestId: 'audio-design-request-0001', privateMedia: 'not-for-the-manifest' };
  try {
    const job = await (await f.post('', body)).json();
    assert.equal(job.status, 'running'); assert.equal('owner' in job, false);
    assert.equal((await (await f.post('', body)).json()).id, job.id);
    assert.equal((await f.post('', { ...body, privateMedia: 'changed' })).status, 409);
    assert.equal((await fetch(`${f.base}/${job.id}`, { headers: { 'x-owner': 'bob' } })).status, 404);
    assert.equal(calls, 1); assert.equal(f.counts.reservations, 1); assert.equal(f.counts.normalizations, 1);
    finish(result); await new Promise(resolve => setImmediate(resolve));
    assert.equal((await (await f.post('', body)).json()).status, 'completed');
    assert.equal(f.counts.releases, 1);
    assert.ok(!fs.readFileSync(path.join(f.directory, `${job.id}.json`), 'utf8').includes(body.privateMedia));
    const app = express(); app.use('/jobs', f.router()); const restored = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => restored.once('listening', resolve));
    try {
      const saved = await (await fetch(`http://127.0.0.1:${(restored.address() as any).port}/jobs/${job.id}`)).json();
      assert.equal(saved.status, 'completed'); assert.equal(saved.result.bgmRecommendations.length, 1);
    } finally { restored.closeAllConnections(); await new Promise<void>(resolve => restored.close(() => resolve())); }
  } finally { await f.close(); }
});

test('cancel and deadline abort the actual inference and release the reservation', async () => {
  let aborted = 0;
  const f = await fixture(async (_input, _progress, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted++; reject(signal.reason); }, { once: true });
  }), 80);
  try {
    const first = await (await f.post('', { requestId: 'audio-design-request-0002' })).json();
    await f.post('/cancel', { requestId: 'audio-design-request-0002' });
    assert.equal((await (await fetch(`${f.base}/${first.id}`)).json()).status, 'cancelled');
    const second = await (await f.post('', { requestId: 'audio-design-request-0003' })).json();
    await new Promise(resolve => setTimeout(resolve, 100));
    const timedOut = await (await fetch(`${f.base}/${second.id}`)).json();
    assert.equal(timedOut.status, 'failed'); assert.match(timedOut.error, /90 秒.*已停止/);
    assert.equal(aborted, 2); assert.equal(f.counts.releases, 2);
    await f.post('/cancel', { requestId: 'audio-design-request-0004' });
    assert.equal((await f.post('', { requestId: 'audio-design-request-0004' })).status, 409);
    assert.equal(f.counts.reservations, 2);
  } finally { await f.close(); }
});

test('music reuses evenly spaced cached frames including clip ends; SFX retains action detail', () => {
  const frames = Array.from({ length: 24 }, (_, timestamp) => ({ timestamp }));
  assert.deepEqual(selectAudioDesignFrames(frames, 24, true).map(f => f.timestamp), [0, 8, 15, 23]);
  assert.equal(selectAudioDesignFrames(frames, 80, true).length, 6);
  assert.equal(selectAudioDesignFrames(frames, 140, true).length, 8);
  assert.equal(selectAudioDesignFrames(frames, 24, false), frames);
});
