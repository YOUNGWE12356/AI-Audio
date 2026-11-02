import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createSfxRequirementsJobs } from './sfxRequirementsJobs';

test('background jobs retain owner and billing context, deduplicate starts and isolate results', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-requirements-test-'));
  const context = new AsyncLocalStorage<string>();
  let finish!: (result: { items: any[] }) => void;
  let calls = 0, reservations = 0, releases = 0;
  const createRouter = () => createSfxRequirementsJobs({ directory,
    identity: req => String(req.headers['x-owner']), normalize: body => ({ text: body.text }),
    reserve: () => { reservations++; return () => { releases++; }; },
    run: (req, _res, work) => { void context.run(String(req.headers['x-owner']), work); },
    execute: async (_input, progress) => {
      calls++; progress('AI 正在生成需求表。');
      const result = await new Promise<{ items: any[] }>(resolve => { finish = resolve; });
      assert.equal(context.getStore(), 'alice');
      return result;
    },
  });
  const app = express(); app.use(express.json()); app.use('/requirements', createRouter());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/requirements`;
  const start = (requestId = 'requirements-request-0001', text = 'wood door') => fetch(base, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-owner': 'alice' }, body: JSON.stringify({ background: true, requestId, text }) });
  const read = (id: string, owner = 'alice') => fetch(`${base}/jobs/${id}`, { headers: { 'x-owner': owner } });
  try {
    const response = await start(); assert.equal(response.status, 202);
    const job = await response.json(); assert.equal(job.status, 'running'); assert.equal('owner' in job, false);
    assert.equal((await (await start()).json()).id, job.id);
    assert.equal(calls, 1); assert.equal(reservations, 1); assert.equal(releases, 0);
    assert.equal((await start('requirements-request-0001', 'different input')).status, 409);
    assert.equal((await start('requirements-request-0002')).status, 409);
    assert.equal((await read(job.id, 'bob')).status, 404);
    const running = await (await read(job.id)).json(); assert.match(running.message, /正在生成/);
    assert.equal(reservations, 1);
    finish({ items: [{ filename: 'Door_Open' }] });
    await new Promise<void>(resolve => setImmediate(resolve));
    const done = await (await read(job.id)).json();
    assert.equal(done.status, 'completed'); assert.equal(done.result.items[0].filename, 'Door_Open');
    assert.equal(releases, 1);
    assert.equal((await (await start()).json()).status, 'completed'); assert.equal(calls, 1);
    const manifests = fs.readdirSync(directory).filter(name => name.endsWith('.json'));
    assert.equal(manifests.length, 1);
    assert.equal(fs.readFileSync(path.join(directory, manifests[0]), 'utf8').includes('wood door'), false);
    // Simulate a server restart: the completed result is still available.
    const restored = express(); restored.use('/requirements', createRouter());
    const restoredServer = restored.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => restoredServer.once('listening', resolve));
    try {
      const result = await fetch(`http://127.0.0.1:${(restoredServer.address() as any).port}/requirements/jobs/${job.id}`, { headers: { 'x-owner': 'alice' } });
      assert.equal((await result.json()).status, 'completed');
    } finally { restoredServer.closeAllConnections(); await new Promise<void>(resolve => restoredServer.close(() => resolve())); }
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('job failures settle and release quota with an explicit error', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-requirements-test-'));
  let releases = 0;
  const app = express(); app.use(express.json());
  app.use('/requirements', createSfxRequirementsJobs({ directory, identity: () => 'alice', normalize: () => ({}),
    reserve: () => () => { releases++; }, run: (_req, _res, work) => { void work(); },
    execute: async () => { throw new Error('AI 网关超过 240 秒未返回结果。'); },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/requirements`;
  try {
    const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ background: true, requestId: 'requirements-request-0001' }) });
    const job = await response.json();
    const failed = await (await fetch(`${base}/jobs/${job.id}`)).json();
    assert.equal(failed.status, 'failed'); assert.match(failed.error, /240 秒/); assert.equal(releases, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); }
});
