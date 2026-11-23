import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeBatchAnalysisRequirements, normalizeBatchSearchQueryInput, prepareBatchSearchQuery } from './sfxBatchSearchQuery';
import { resolveBatchSearchQuery } from './sfxBatchClient';
import { batchQuerySource, batchRequirementsCsv, createBatchSfxRequest, normalizeBatchRequirements } from './sfxBatch';
import { createSfxBatchRouter } from './sfxBatchServer';

const manual = { searchQuery: '', keywords: '翻牌', description: '牌翻过来的声音' };

test('analysis repairs missing, Chinese and overly long queries without changing valid rows or timing', async () => {
  const values = ['door creak', '', undefined, '翻牌', 'a very long card flip'];
  let calls = 0;
  const rows = values.map((searchQuery, i) => ({ ...manual, searchQuery, name: `sound_${i}`, duration: 2, scene: '场景', time: i * 3, endTime: i * 3 + 2 }));
  const result = await normalizeBatchAnalysisRequirements(rows, undefined, (async () => {
    calls++; return { text: JSON.stringify({ searchQuery: 'card flip' }) };
  }) as any);
  assert.equal(calls, 4);
  assert.deepEqual(result.map(row => row.searchQuery), ['door creak', 'card flip', 'card flip', 'card flip', 'card flip']);
  assert.deepEqual(result.map(row => [row.name, row.description, row.time, row.endTime]), rows.map(row => [row.name, row.description, row.time, row.endTime]));
  assert.equal(rows[1].searchQuery, '');
});

test('analysis validates other fields before repair and reports repair failure with the row number', async () => {
  let calls = 0;
  const generate = (async () => { calls++; return { text: '{"searchQuery":""}' }; }) as any;
  const row = { ...manual, name: 'card', scene: '', duration: 1 };
  await assert.rejects(normalizeBatchAnalysisRequirements([{ ...row, duration: 99 }], undefined, generate), /时长/);
  assert.equal(calls, 0);
  await assert.rejects(normalizeBatchAnalysisRequirements([{ ...row, searchQuery: 'click' }, row], undefined, generate), /第 2 条.*自动补全失败/);
  assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(normalizeBatchAnalysisRequirements([row], controller.signal, generate), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('Chinese-only analysis results convert only when search or generation starts', async () => {
  const original = globalThis.fetch;
  let conversions = 0;
  globalThis.fetch = async (url, options) => {
    conversions++;
    assert.equal(url, '/api/ai/sfx-batch/search-query');
    assert.deepEqual(JSON.parse(String(options?.body)), manual);
    return Response.json({ searchQuery: 'card flip' });
  };
  try {
    const [row] = normalizeBatchRequirements([{ name: '翻牌', description: manual.description, keywords: manual.keywords, duration: 1, scene: '翻牌动作' }]);
    assert.equal(conversions, 0);
    assert.equal(row.searchQuery, '');
    const searchQuery = await resolveBatchSearchQuery(row);
    assert.equal(conversions, 1);
    assert.equal(createBatchSfxRequest({ ...row, searchQuery }, 'search').body.query, 'card flip');
    const cached = { ...row, searchQuery, searchQuerySource: batchQuerySource(row) };
    assert.equal(createBatchSfxRequest({ ...cached, searchQuery: await resolveBatchSearchQuery(cached) }, 'generate').body.text, 'card flip');
    assert.equal(conversions, 1);
  } finally { globalThis.fetch = original; }
});

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

test('client converts Chinese keywords and reuses a hidden translation only for the same keywords and description', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, '/api/ai/sfx-batch/search-query');
    assert.deepEqual(JSON.parse(String(options?.body)), manual);
    return Response.json({ searchQuery: 'card flip' });
  };
  try {
    const searchQuery = await resolveBatchSearchQuery(manual);
    const prepared = { ...manual, searchQuery, searchQuerySource: batchQuerySource(manual), duration: 1 };
    assert.equal(createBatchSfxRequest(prepared, 'search').body.query, 'card flip');
    assert.equal(createBatchSfxRequest(prepared, 'generate').body.text, 'card flip');
    assert.equal(await resolveBatchSearchQuery(prepared), 'card flip');
    assert.equal(calls, 1);
    // Legacy rows must not let a previously visible English field override Chinese edits.
    assert.equal(await resolveBatchSearchQuery({ ...manual, searchQuery: 'door creak' }), 'card flip');
    assert.equal(calls, 2);
    globalThis.fetch = async (_url, options) => {
      calls++;
      const body = JSON.parse(String(options?.body));
      assert.equal(body.searchQuery, ''); assert.equal(body.keywords, '木门吱呀');
      return Response.json({ searchQuery: 'door creak' });
    };
    const changed = { ...prepared, keywords: '木门吱呀' };
    assert.equal(await resolveBatchSearchQuery(changed), 'door creak');
    assert.equal(calls, 3);
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(String(options?.body)); assert.equal(body.description, '木门打开');
      assert.equal(body.searchQuery, ''); return Response.json({ searchQuery: 'door creak' });
    };
    assert.equal(await resolveBatchSearchQuery({ ...prepared, description: '木门打开' }), 'door creak');
    globalThis.fetch = async () => Response.json({ searchQuery: '牌' });
    await assert.rejects(resolveBatchSearchQuery(manual), /本次未开始搜索或生成/);
    globalThis.fetch = async () => Response.json({ error: '积分不足' }, { status: 429 });
    await assert.rejects(resolveBatchSearchQuery(manual), /积分不足/);
    await assert.rejects(resolveBatchSearchQuery({ searchQuery: '', keywords: '', description: '' }), /先填写/);
  } finally { globalThis.fetch = original; }
});

test('downloaded requirements have one Chinese keyword column without the internal English translation', () => {
  const csv = batchRequirementsCsv([{ ...manual, id: 'one', name: '翻牌', searchQuery: 'card flip', duration: 1, scene: '' }]);
  assert.match(csv, /"关键词"/); assert.match(csv, /翻牌/);
  assert.doesNotMatch(csv, /英文搜索词|card flip/);
});

test('query preparation endpoint validates, accounts for AI work and never starts a search on failure', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sfx-batch-query-test-'));
  let generated = 0, reserved = 0, released = 0, searched = 0, badOutput = false;
  let lastIntentPrompt = '', lastIntentTimeout = 0;
  const studioChunks: string[] = [];
  const app = express(); app.use(express.json());
  app.use('/batch', createSfxBatchRouter({ uploadsDir: directory, jobsDir: path.join(directory, 'jobs'), ffmpeg: '',
    owner: req => String(req.headers['x-owner'] || 'unknown'),
    reserve: () => { reserved++; return () => { released++; }; }, run: (_req, _res, work) => { void work(); },
    generateQuery: (async request => {
      generated++;
      const contents = String(request.contents);
      if (contents.includes('"chunk":')) {
        const { summary, chunk } = JSON.parse(contents.split('\n').at(-1)!);
        studioChunks.push(chunk);
        return { text: JSON.stringify({ summary: summary + (chunk.includes('不要人声') ? '不要人声。' : '领取金币。') }) };
      }
      if (contents.includes('"intentMode":')) {
        lastIntentPrompt = contents;
        lastIntentTimeout = request.timeoutMs || 0;
        if (contents.includes('"description":"角色打开旧木门的声音"')) {
          return { text: JSON.stringify({ searchQuery: 'door creak', alternateQuery: 'wood creak', clarification: '是哪种木门？' }) };
        }
        if (contents.includes('"description":"在草地上走路的声音"')) {
          return { text: JSON.stringify({ searchQuery: 'grass footsteps', alternateQuery: 'grass walking' }) };
        }
        return { text: JSON.stringify({ searchQuery: 'coin pickup', alternateQuery: 'reward chime',
          generationPrompt: 'One crisp, rising coin chime. No music.', soundDetails: '清脆的单次上扬金币声', clarification: '', suggestedDuration: 0.8 }) };
      }
      if (contents.includes('简短中文音效关键词')) {
        assert.match(contents, /关键词数据："金币掉落"/);
        return { text: JSON.stringify({ searchQuery: 'coin drop' }) };
      }
      return { text: JSON.stringify({ searchQuery: badOutput ? '翻牌' : 'card flip' }) };
    }) as typeof import('./aiGateway').generateAiContent,
    search: (async options => { searched++; assert.equal(options.query, 'card flip'); return { items: [] }; }) as any,
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/batch`;
  const post = (route: string, body: unknown, owner = 'alice') => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-owner': owner }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/search-query', manual, 'unknown')).status, 401);
    assert.equal((await post('/search-query', {})).status, 400); assert.equal(reserved, 0);
    assert.deepEqual(await (await post('/search-query', { searchQuery: 'click' })).json(), { searchQuery: 'click' });
    for (const [keywords, expected] of [['Game Over', 'Game Over'], ['游戏失败', 'game over'], ['游戏胜利', 'game win']]) {
      for (const intentMode of ['auto', 'search']) {
        const response = await post('/search-query', { intentMode, keywords, description: keywords });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { searchQuery: expected });
      }
    }
    assert.deepEqual(await (await post('/search-query', { intentMode: 'auto', searchQuery: 'game over', keywords: '游戏失败' })).json(), { searchQuery: 'game over' });
    assert.equal(generated, 0); assert.equal(reserved, 0);
    const translated = await post('/search-query', manual); assert.equal(translated.status, 200);
    const result = await translated.json(); assert.equal(result.searchQuery, 'card flip');
    assert.equal(reserved, 1); assert.equal(released, 1); assert.equal(searched, 0);
    assert.equal((await post('/search', { query: result.searchQuery })).status, 200); assert.equal(searched, 1);
    badOutput = true;
    assert.equal((await post('/search-query', manual)).status, 502);
    assert.equal(searched, 1); assert.equal(reserved, released);
    const prepared = await (await post('/search-query', { intentMode: 'auto', searchQuery: 'beep', keywords: '提示音', description: '领金币时叮一下', duration: 2 })).json();
    assert.equal(prepared.searchQuery, 'coin pickup');
    assert.equal(prepared.alternateQuery, 'beep', 'retain the original explicit query as the alternate');
    assert.match(prepared.generationPrompt, /No music/);
    assert.equal(prepared.suggestedDuration, undefined, 'never override an explicit duration');
    const shortIntentTimeout = lastIntentTimeout;
    const translation = await (await post('/search-query', { intentMode: 'search', keywords: '金币掉落' })).json();
    assert.deepEqual(translation, { searchQuery: 'coin drop' });
    const walking = await (await post('/search-query', { intentMode: 'search', description: '在草地上走路的声音' })).json();
    assert.equal(walking.searchQuery, 'grass footsteps');
    assert.equal(walking.alternateQuery, 'grass walking');
    assert.match(lastIntentPrompt, /地面材质/);
    const multiple = await (await post('/search-query', { intentMode: 'search', keywords: 'wood door creak' })).json();
    assert.equal(multiple.alternateQuery, 'reward chime', 'multiple keywords go through intent preparation');
    const twoSounds = await (await post('/search-query', { intentMode: 'search', keywords: '游戏失败 游戏胜利' })).json();
    assert.equal(twoSounds.alternateQuery, 'reward chime', 'multiple sound subjects are not treated as one alias');
    const longDescription = '游戏界面设定和流程。'.repeat(500) + '最后只要一声金币提示，不要背景音乐和人声。';
    const longResult = await post('/search-query', { intentMode: 'auto', keywords: longDescription, description: longDescription });
    assert.equal(longResult.status, 200);
    assert.equal((await longResult.json()).searchQuery, 'coin pickup');
    assert.ok(lastIntentPrompt.includes(longDescription), 'the complete description, including its final constraints, reaches the model');
    assert.equal(lastIntentPrompt.split(longDescription).length, 2, 'the duplicated input is only sent once');
    assert.ok(lastIntentTimeout > shortIntentTimeout);
    const callsBeforeOversized = generated;
    const oversized = await post('/search-query', { intentMode: 'auto', keywords: '金币', description: '字'.repeat(12_001) });
    assert.equal(oversized.status, 400);
    assert.match((await oversized.json()).error, /按声音事件拆分/);
    assert.equal(generated, callsBeforeOversized);
    const callsBeforeEvent = generated;
    const event = await post('/search-query', { intentMode: 'search', studioDescription: 'Bookshelf_Complete' });
    assert.equal(event.status, 200);
    assert.deepEqual(await event.json(), { searchQuery: 'completion chime', alternateQuery: 'success chime' });
    assert.equal(generated, callsBeforeEvent, 'explicit completion events need no model call');
    const bestEffort = await post('/search-query', { intentMode: 'search', studioDescription: '角色打开旧木门的声音' });
    assert.equal(bestEffort.status, 200);
    const bestEffortPlan = await bestEffort.json();
    assert.equal(bestEffortPlan.searchQuery, 'door creak');
    assert.equal(bestEffortPlan.alternateQuery, 'wood creak');
    assert.equal(bestEffortPlan.clarification, undefined);
    assert.match(lastIntentPrompt, /不要追问/);
    const studioDescription = '描述整个界面和反馈过程。'.repeat(1500) + '最后只需要一声金币提示，不要人声。';
    const webQuery = await post('/search-query', { intentMode: 'search', studioDescription });
    assert.equal(webQuery.status, 200);
    assert.equal((await webQuery.json()).searchQuery, 'coin pickup');
    assert.equal(studioChunks.join(''), studioDescription);
    assert.match(lastIntentPrompt, /不要人声/);
    const webGeneration = await post('/search-query', { intentMode: 'generate', studioDescription, duration: 3 });
    assert.equal(webGeneration.status, 200);
    assert.match((await webGeneration.json()).generationPrompt, /crisp/);
    assert.match(lastIntentPrompt, /"duration":3/);
    const callsBeforeExact = generated;
    assert.deepEqual(await (await post('/search-query', { intentMode: 'search', exactSearchQuery: true, searchQuery: 'coin pickup' })).json(), { searchQuery: 'coin pickup' });
    assert.equal(generated, callsBeforeExact);
    assert.equal(searched, 1); assert.equal(reserved, released);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true }); }
});
