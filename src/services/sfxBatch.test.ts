import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import ffmpeg from 'ffmpeg-static';
import { batchFileStem, batchRequirementsCsv, createBatchSfxRequest, normalizeBatchRequirements, uniqueBatchFileNames } from './sfxBatch';
import { analyzeSfxBatch, createSfxBatchRouter, normalizeSfxBatchInput } from './sfxBatchServer';
import { sameBatchRange, confirmedVersion, restoreBatchProjectRow, type BatchRow } from './sfxBatchProject';
import { validateSfxBatchFile, readSfxBatchDocument } from './sfxBatchClient';
import { waitForRequirementsJob } from './sfxRequirementsClient';
import { setAiUsageRecorder, type AiUsageEvent } from './usageTracking';

const requirement = { name: 'Door Open.wav', description: '木门缓慢打开，木轴吱呀，短尾音，无音乐', keywords: '木门 打开', searchQuery: 'door creak', duration: 2.5, scene: '第5秒开门' };
test('search and generation require the prepared internal query rather than sending raw Chinese', () => {
  for (const kind of ['search', 'generate'] as const) {
    const request = createBatchSfxRequest(requirement, kind);
    assert.equal(kind === 'search' ? request.body.query : request.body.text, requirement.searchQuery);
    assert.doesNotMatch(JSON.stringify(request), /木门|第5秒|Scene context/);
    assert.throws(() => createBatchSfxRequest({ ...requirement, searchQuery: '' }, kind), /自动转换/);
    assert.throws(() => createBatchSfxRequest({ ...requirement, searchQuery: 'wood door 木门' }, kind), /不是有效英文/);
    assert.throws(() => createBatchSfxRequest({ ...requirement, searchQuery: 'soft plastic button click' }, kind), /1～2.*当前4个/);
    assert.throws(() => createBatchSfxRequest({ ...requirement, searchQuery: '!!!' }, kind), /1～2/);
  }
  assert.equal(createBatchSfxRequest({ ...requirement, searchQuery: '  button   click  ' }, 'generate').body.text, 'button click');
  assert.equal(createBatchSfxRequest({ ...requirement, searchQuery: 'click' }, 'search').body.query, 'click');
  assert.equal(createBatchSfxRequest(requirement, 'search', [], 'click-1').body.searchBatchId, 'click-1');
  assert.equal('searchBatchId' in createBatchSfxRequest(requirement, 'generate', [], 'click-1').body, false);
});
test('batch normalization keeps event detail, safe filenames and rejects malformed or oversized lists', () => {
  const result = normalizeBatchRequirements([requirement]);
  assert.equal(result[0].name, 'Door_Open'); assert.equal(result[0].description, requirement.description);
  assert.equal(result[0].scene, '第5秒开门');
  for (const invalid of [null, Array(301).fill(requirement), [{ ...requirement, duration: 31 }], [{ ...requirement, duration: NaN }], [{ ...requirement, description: '' }]]) assert.throws(() => normalizeBatchRequirements(invalid));
  assert.equal(batchFileStem(' ../声音 : 测试 .wav '), '声音_测试');
  assert.deepEqual(uniqueBatchFileNames(['Door Open', 'door_open', 'Door_Open_2', 'Door Open']), ['Door_Open.wav', 'door_open_2.wav', 'Door_Open_2_2.wav', 'Door_Open_3.wav']);
});

test('analysis lists keep every Chinese requirement when internal English queries are missing or invalid', () => {
  const { searchQuery: _query, ...chinese } = requirement;
  const rows = normalizeBatchRequirements([
    chinese, { ...chinese, searchQuery: '' }, { ...chinese, searchQuery: '木门吱呀' },
    { ...chinese, searchQuery: 'playing card place pile' }, requirement,
  ]);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(row => row.searchQuery), ['', '', '', '', 'door creak']);
  assert.ok(rows.every(row => row.description === chinese.description && row.keywords === chinese.keywords));
});

test('table, video and point analysis accept Chinese-only results without requesting English fields', async () => {
  const { searchQuery: _query, ...chinese } = requirement;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfkEAAAAASUVORK5CYII=';
  const files = [{ data: png, mimeType: 'image/png', label: '视频画面1秒' }];
  for (const input of [normalizeSfxBatchInput({ text: '木门打开，2.5秒' }),
    normalizeSfxBatchInput({ sourceType: 'video', files, videoDuration: 10 }),
    normalizeSfxBatchInput({ sourceType: 'video', files, videoDuration: 10, pointTime: 1, pointEndTime: 3.5 })]) {
    const result = await analyzeSfxBatch(input, undefined, (async (options: any) => {
      if (JSON.stringify(options.contents).includes('这是需求表逐行盘点')) return { text: JSON.stringify({
        isRequirementList: true, sourceItemCount: 1,
        rows: [{ rowNumber: 1, name: '木门', rawText: '木门打开，2.5秒', kind: 'sfx', reason: '' }],
      }) };
      const schema = options.config.responseSchema.properties.items.items;
      assert.equal('searchQuery' in schema.properties, false);
      assert.equal(schema.required.includes('searchQuery'), false);
      assert.match(options.contents[0].parts[0].text, /用户点击搜索或生成时再自动转换/);
      return { text: JSON.stringify({ items: [{ ...chinese, time: 1, endTime: 3.5, sourceRowId: 'row-1', soundGroup: 'door' }] }) };
    }) as any);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].keywords, chinese.keywords);
    assert.equal(result.items[0].searchQuery, '');
  }
});
test('CSV retains editable data and confirmed duration while escaping formulas and quoted descriptions', () => {
  const csv = batchRequirementsCsv([{ ...requirement, id: 'a', name: '=EVIL', description: 'a,"b"\nc', confirmedDuration: 1.25 }]);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"\'=EVIL"')); assert.ok(csv.includes('"a,""b""\nc"')); assert.ok(csv.includes('"1.25"'));
});
test('audio confirmation tracks source ranges without destroying the original selection', () => {
  assert.equal(sameBatchRange(null, { start: 0, end: 3 }, 3), true);
  assert.equal(sameBatchRange({ start: 1, end: 2 }, { start: 1, end: 3 }, 3), false);
  const row = { confirmedVersionId: 'one', versions: [{ id: 'one', confirmedBlob: new Blob(['audio']) }] } as BatchRow;
  assert.equal(confirmedVersion(row)?.id, 'one');
  row.versions[0].confirmedBlob = undefined; assert.equal(confirmedVersion(row), undefined);
});

test('restoring projects clears obsolete translation failures and keeps audio, edits and genuine errors', () => {
  const audio = new Blob(['original audio']), confirmed = new Blob(['trimmed audio']);
  const row: BatchRow = { ...requirement, id: 'saved', selected: true, status: '制作失败，可重试', excludedSources: ['https://example.com/source'],
    error: '音效描述翻译失败，请重试；本次未开始生成音效。', activeVersionId: 'v1', confirmedVersionId: 'v1',
    versions: [{ id: 'v1', kind: 'generate', title: '已制作版本', blob: audio, confirmedBlob: confirmed, confirmedRange: { start: 0.2, end: 1.5 } }] };
  const restored = restoreBatchProjectRow(row);
  try {
    assert.equal(restored.error, undefined); assert.equal(restored.status, '已确认剪辑');
    assert.equal(restored.description, row.description); assert.equal(restored.searchQuery, row.searchQuery);
    assert.equal(confirmedVersion(restored)?.confirmedBlob, confirmed);
    assert.equal(restored.versions[0].blob, audio); assert.deepEqual(restored.versions[0].confirmedRange, { start: 0.2, end: 1.5 });
    assert.deepEqual(restored.excludedSources, row.excludedSources);
  } finally { URL.revokeObjectURL(restored.versions[0].url!); }
  const genuine = restoreBatchProjectRow({ ...row, versions: [], error: '来源未返回有效试听音频。' });
  assert.equal(genuine.error, '来源未返回有效试听音频。'); assert.equal(genuine.status, '制作失败，可重试');
});
test('document upload validates formats and decodes requirements text without corruption', async () => {
  const file = new File(['命名,描述\nDoor_Open,木门打开'], 'requirements.csv', { type: 'text/csv' });
  assert.equal(validateSfxBatchFile(file), 'table'); assert.match(await readSfxBatchDocument(file), /木门打开/);
  assert.equal(validateSfxBatchFile({ name: 'clip.mov', type: '', size: 5 }), 'video');
  assert.throws(() => validateSfxBatchFile({ name: 'old.xls', type: '', size: 5 }), /XLSX/);
  assert.throws(() => validateSfxBatchFile({ name: 'big.mp4', type: '', size: 501 * 1024 * 1024 }), /500MB/);
});
test('batch AI analysis validates input and retains structured results through the gateway', async () => {
  assert.throws(() => normalizeSfxBatchInput({}), /上传/);
  assert.throws(() => normalizeSfxBatchInput({ text: 'a'.repeat(80001) }), /过长/);
  assert.throws(() => normalizeSfxBatchInput({ sourceType: 'image', files: [{ mimeType: 'image/png', data: 'invalid' }] }));
  const input = normalizeSfxBatchInput({ text: '原表:Door Open,2.5秒', instructions: '严格按表' });
  const inventory = { isRequirementList: true, sourceItemCount: 1, rows: [{ rowNumber: 1, name: 'Door Open', rawText: 'Door Open,2.5秒', kind: 'sfx', reason: '' }] };
  const isInventory = (options: any) => JSON.stringify(options.contents).includes('这是需求表逐行盘点');
  let prompt = '';
  const result = await analyzeSfxBatch(input, undefined, (async options => {
    if (isInventory(options)) return { text: JSON.stringify(inventory) };
    prompt = JSON.stringify(options.contents);
    return { text: JSON.stringify({ items: [{ ...requirement, sourceRowId: 'row-1' }] }) };
  }) as any);
  assert.equal(result.items[0].name, 'Door_Open'); assert.match(prompt, /原表/); assert.match(prompt, /中文关键词/); assert.match(prompt, /用户点击搜索或生成时再自动转换/);
  await assert.rejects(analyzeSfxBatch(input, undefined, (async () => ({ text: '{"items":[' })) as any), /不完整/);
  await assert.rejects(analyzeSfxBatch(input, undefined, (async options => ({ text: JSON.stringify(isInventory(options) ? inventory : { items: [{ ...requirement, duration: 90, sourceRowId: 'row-1' }] }) })) as any), /仍有1条音效未完整整理/);
});
test('batch polling uses its own endpoint without touching the requirements-table jobs', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => { assert.equal(String(url), '/api/ai/sfx-batch/analyze/jobs/job-1'); return Response.json({ status: 'completed', result: { items: [requirement] } }); };
  try { const result = await waitForRequirementsJob({ id: 'job-1', status: 'running', message: '', createdAt: Date.now() }, undefined, { endpoint: '/api/ai/sfx-batch/analyze', pollMs: 1 }); assert.equal(result.items.length, 1); }
  finally { globalThis.fetch = original; }
});
test('screenshot and timestamped video frames reach vision analysis as image inputs', async () => {
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfkEAAAAASUVORK5CYII=';
  for (const sourceType of ['image', 'video']) {
    const input = normalizeSfxBatchInput({ sourceType, files: [{ data, mimeType: 'image/png', label: '视频画面 5.00 秒' }] });
    await analyzeSfxBatch(input, undefined, (async options => {
      const prompt = JSON.stringify(options.contents);
      assert.ok(prompt.includes(data)); assert.match(prompt, /5.00 秒/);
      if (prompt.includes('这是需求表逐行盘点')) return { text: '{"isRequirementList":false,"sourceItemCount":0,"rows":[]}' };
      assert.match(prompt, /只分析画面/);
      return { text: '{"items":[]}' };
    }) as any);
  }
});
test('search tickets are owner-scoped; concurrent capture deduplicates and converts actual WAV audio', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sfx-batch-test-'));
  const samples = 2400, audio = Buffer.alloc(44 + samples * 2);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(24000, 24); audio.writeUInt32LE(48000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) audio.writeInt16LE(Math.round(Math.sin(i / 10) * 1000), 44 + i * 2);
  let fetched = 0, released = 0;
  const app = express(); app.use(express.json());
  app.use('/batch', createSfxBatchRouter({ uploadsDir: path.join(directory, 'uploads'), jobsDir: path.join(directory, 'jobs'), ffmpeg: ffmpeg!,
    owner: req => String(req.headers['x-owner'] || 'unknown'), reserve: () => () => { released++; }, run: (_req, _res, work) => { void work(); },
    search: (async options => { assert.equal(options.query, 'wood door'); return { items: [{ title: 'Door', author: '', source: 'test', previewUrl: 'https://example.com/audio', sourceUrl: 'https://example.com/door' }] }; }) as any,
    fetchPreview: async () => { fetched++; return { data: audio, type: 'audio/wav' }; },
  }));
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/batch`;
  const post = (route: string, body: unknown, owner = 'alice') => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-owner': owner }, body: JSON.stringify(body) });
  try {
    const invalid = await post('/search', { query: '' }); assert.equal(invalid.status, 400); assert.match((await invalid.json()).error, /自动转换/);
    const longQuery = await post('/search', { query: 'soft wooden door creak' }); assert.equal(longQuery.status, 400); assert.match((await longQuery.json()).error, /1～2/); assert.equal(released, 0);
    assert.equal((await post('/search', { query: 'wood door' }, 'unknown')).status, 401);
    const result = await (await post('/search', { query: 'wood door' })).json(); const id = result.items[0].id;
    assert.equal(released, 1); assert.equal((await post('/capture', { id }, 'bob')).status, 404);
    const captured = await Promise.all([post('/capture', { id }), post('/capture', { id })]);
    const outputs = await Promise.all(captured.map(r => r.json())); assert.equal(outputs[0].url, outputs[1].url); assert.equal(fetched, 1);
    const wav = await fs.readFile(path.join(directory, outputs[0].url));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.readUInt16LE(22), 2); assert.equal(wav.readUInt32LE(24), 48000);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true }); }
});

test('batch search bills one point across rows, charges new clicks and users independently, and skips empty or failed searches', async () => {
  const events: AiUsageEvent[] = [];
  const balances = new Map([['alice', 1], ['bob', 1]]);
  let reserved = 0, released = 0;
  setAiUsageRecorder(event => events.push(event));
  const app = express(); app.use(express.json());
  app.use('/batch', createSfxBatchRouter({
    uploadsDir: os.tmpdir(), jobsDir: os.tmpdir(), ffmpeg: ffmpeg!,
    owner: req => String(req.headers['x-owner'] || 'unknown'),
    reserve: (req, res, points) => {
      const owner = String(req.headers['x-owner']);
      if ((balances.get(owner) || 0) < points) { res.status(429).json({ error: '积分不足' }); return null; }
      reserved++;
      return () => { released++; };
    },
    run: (_req, _res, work) => { void work(); },
    search: (async ({ query }) => {
      if (query === 'broken') throw new Error('source unavailable');
      return { items: query === 'missing' ? [] : [{ title: query, source: 'test', sourceUrl: `https://example.com/${query}`, previewUrl: 'https://example.com/audio' }] };
    }) as typeof import('./onlineSfxServer').searchOnlineSfxSources,
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/batch/search`;
  const post = (query: string, searchBatchId?: unknown, owner = 'alice') => fetch(url, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-owner': owner }, body: JSON.stringify({ query, searchBatchId }) });
  try {
    assert.equal((await post('missing', 'click-1')).status, 200);
    assert.equal((await post('broken', 'click-1')).status, 500);
    assert.equal(events.length, 0);
    assert.equal((await post('door', 'click-1')).status, 200);
    assert.equal(events.length, 1); assert.equal(events[0].companyPoints, 1);
    const afterFirstMatch = reserved;
    balances.set('alice', 0);
    for (const query of ['click', 'whoosh', 'impact']) assert.equal((await post(query, 'click-1')).status, 200);
    assert.equal(events.length, 1); assert.equal(reserved, afterFirstMatch);
    assert.equal((await post('door', 'click-2')).status, 429);
    balances.set('alice', 1);
    assert.equal((await post('door', 'click-2')).status, 200);
    assert.equal(events.length, 2);
    assert.equal((await post('door', 'click-1', 'bob')).status, 200);
    assert.equal(events.length, 3);
    // Legacy single-row calls without a batch ID each count as a new batch.
    assert.equal((await post('door')).status, 200);
    assert.equal((await post('door')).status, 200);
    assert.equal(events.length, 5);
    assert.equal((await post('door', {})).status, 400);
    assert.equal((await post('door', 'x'.repeat(129))).status, 400);
    assert.equal(events.reduce((sum, event) => sum + (event.companyPoints || 0), 0), 5);
    assert.equal(reserved, released);
  } finally { setAiUsageRecorder(null); await new Promise<void>(resolve => server.close(() => resolve())); }
});
