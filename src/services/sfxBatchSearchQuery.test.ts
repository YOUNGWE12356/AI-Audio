import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeBatchSearchQueryInput, prepareBatchSearchQuery } from './sfxBatchSearchQuery';
import { resolveBatchSearchQuery } from './sfxBatchClient';
import { createBatchSfxRequest } from './sfxBatch';
import { createSfxBatchRouter } from './sfxBatchServer';

const manual = { searchQuery: '', keywords: '翻牌', description: '牌翻过来的声音' };

test('manual Chinese requirements become short English search terms while explicit English bypasses AI', async () => {
  let calls = 0;
  const generate = (async (options: any) => {
    calls++; assert.match(options.contents, /翻牌/); assert.match(options.contents, /1～2个核心英文单词/);
    return { text: JSON.stringify({ searchQuery: 'card flip' }) };
  }) as any;
  assert.equal(await prepareBatchSearchQuery(normalizeBatchSearchQueryInput(manual), undefined, generate), 'card flip');
  assert.equal(await prepareBatchSearchQuery(normalizeBatchSearchQueryInput({ ...manual, searchQuery: '  door creak  ' }), undefined, generate), 'door creak');
  assert.equal(calls, 1);
  for (const value of ['', '翻牌', 'a very long card flipping sound', undefined]) {
    await assert.rejects(prepareBatchSearchQuery(normalizeBatchSearchQueryInput(manual), undefined,
      (async () => ({ text: JSON.stringify({ searchQuery: value }) })) as any), /提炼失败/);
  }
  assert.throws(() => normalizeBatchSearchQueryInput({}), /先填写/);
  assert.throws(() => normalizeBatchSearchQueryInput({ keywords: '牌'.repeat(301) }), /过长/);
});

test('client resolves once then reuses the English field for search and generation', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, '/api/ai/sfx-batch/search-query');
    assert.deepEqual(JSON.parse(String(options?.body)), manual);
    return Response.json({ searchQuery: 'card flip' });
  };
  try {
    const searchQuery = await resolveBatchSearchQuery(manual);
    const prepared = { ...manual, searchQuery, duration: 1 };
    assert.equal(createBatchSfxRequest(prepared, 'search').body.query, 'card flip');
    assert.equal(createBatchSfxRequest(prepared, 'generate').body.text, 'card flip');
    assert.equal(await resolveBatchSearchQuery(prepared), 'card flip');
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ searchQuery: '牌' });
    await assert.rejects(resolveBatchSearchQuery(manual), /本次未开始搜索或生成/);
    globalThis.fetch = async () => Response.json({ error: '积分不足' }, { status: 429 });
    await assert.rejects(resolveBatchSearchQuery(manual), /积分不足/);
    await assert.rejects(resolveBatchSearchQuery({ searchQuery: '', keywords: '', description: '' }), /先填写/);
  } finally { globalThis.fetch = original; }
});

test('query preparation endpoint validates, accounts for AI work and never starts a search on failure', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sfx-batch-query-test-'));
  let generated = 0, reserved = 0, released = 0, searched = 0, badOutput = false;
  const app = express(); app.use(express.json());
  app.use('/batch', createSfxBatchRouter({ uploadsDir: directory, jobsDir: path.join(directory, 'jobs'), ffmpeg: '',
    owner: req => String(req.headers['x-owner'] || 'unknown'),
    reserve: () => { reserved++; return () => { released++; }; }, run: (_req, _res, work) => { void work(); },
    generateQuery: (async () => { generated++; return { text: JSON.stringify({ searchQuery: badOutput ? '翻牌' : 'card flip' }) }; }) as any,
    search: (async options => { searched++; assert.equal(options.query, 'card flip'); return { items: [] }; }) as any,
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/batch`;
  const post = (route: string, body: unknown, owner = 'alice') => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-owner': owner }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/search-query', manual, 'unknown')).status, 401);
    assert.equal((await post('/search-query', {})).status, 400); assert.equal(reserved, 0);
    assert.deepEqual(await (await post('/search-query', { searchQuery: 'click' })).json(), { searchQuery: 'click' });
    assert.equal(generated, 0); assert.equal(reserved, 0);
    const translated = await post('/search-query', manual); assert.equal(translated.status, 200);
    const result = await translated.json(); assert.equal(result.searchQuery, 'card flip');
    assert.equal(reserved, 1); assert.equal(released, 1); assert.equal(searched, 0);
    assert.equal((await post('/search', { query: result.searchQuery })).status, 200); assert.equal(searched, 1);
    badOutput = true;
    assert.equal((await post('/search-query', manual)).status, 502);
    assert.equal(searched, 1); assert.equal(reserved, released);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true }); }
});
