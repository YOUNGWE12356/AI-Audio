import test from 'node:test';
import assert from 'node:assert/strict';
import { produceMcpSoundEffect } from './mcpSfxProduction';
import { createMcpAudioTools } from './mcpAudioTools';
import type { AgentToolContext } from './assistantAgentTools';

const input = { name: '关门', keywords: '关门', description: '厚重木门缓慢关上，沉闷撞击，轻微房间混响', duration: 2 };
const fail = (status: number) => Object.assign(new Error(`搜索或采集失败 (${status})`), { status });
function harness(options: { searchError?: Error; queryError?: Error; captureErrors?: Record<string, Error>; items?: any[]; sources?: any[]; generationError?: Error } = {}) {
  const controller = new AbortController(), calls: string[] = [], prompts: any[] = [];
  const assets: any[] = [];
  const c: AgentToolContext = {
    assets, signal: controller.signal, asset: id => assets.find(v => v.id === id), filePath: () => '', save: async () => { throw Error('unused'); },
    register: async (url, name, generated) => { const asset = { id: `asset-${assets.length}`, url, name, generated, size: 100, mimeType: 'audio/wav' }; assets.push(asset); return asset; },
    ffmpeg: async () => '', wait: async () => {}, ask: () => {}, finish: () => {}, navigate: () => {},
    request: async (endpoint, args: any) => {
      calls.push(endpoint);
      if (endpoint.endsWith('search-query')) { if (options.queryError) throw options.queryError; return { searchQuery: 'door slam' }; }
      if (endpoint.endsWith('/search')) { if (options.searchError) throw options.searchError; return { items: options.items ?? [{ id: 'one' }, { id: 'two' }], sources: options.sources }; }
      if (endpoint.endsWith('/capture')) { if (options.captureErrors?.[args.id]) throw options.captureErrors[args.id]; return { url: `/uploads/${args.id}.wav` }; }
      if (endpoint.endsWith('sound-effect')) { prompts.push(args); if (options.generationError) throw options.generationError; return { audioUrl: '/uploads/generated.wav' }; }
      throw Error(`Unexpected endpoint ${endpoint}`);
    },
  };
  const tools = createMcpAudioTools(c);
  const produce = (args: Record<string, any> = {}) => tools.find(t => t.name === 'produce_sound_effect')!.execute({ ...input, ...args }) as Promise<any>;
  return { c, controller, calls, prompts, produce, tools };
}

test('ordinary sound requests default to search; partial preview errors keep usable results without generating', async () => {
  const h = harness({ captureErrors: { one: fail(502) } });
  const result = await h.produce();
  assert.equal(result.method, 'search'); assert.equal(result.fallback, false); assert.equal(result.status, 'completed');
  assert.equal(result.candidates.filter((v: any) => v.asset).length, 1);
  assert.equal(h.prompts.length, 0);
  assert.deepEqual(h.calls, ['/api/ai/sfx-batch/search-query', '/api/ai/sfx-batch/search', '/api/ai/sfx-batch/capture', '/api/ai/sfx-batch/capture']);
});

test('search outages and wholly broken previews fall back once, retaining the full generation description', async () => {
  for (const options of [{ searchError: fail(502) }, { queryError: fail(504) }, { captureErrors: { one: fail(410), two: fail(502) } },
    { items: [], sources: [{ unavailable: true }, { unavailable: true }] }]) {
    const h = harness(options), result = await h.produce();
    assert.equal(result.method, 'generate'); assert.equal(result.fallback, true); assert.ok(result.fallbackReason);
    assert.equal(h.prompts.length, 1); assert.equal(h.prompts[0].text, input.description); assert.equal(h.prompts[0].duration, 2);
    assert.equal(result.result.assets.length, 1);
  }
});

test('explicit AI generation skips searching and search-term translation', async () => {
  const h = harness({ queryError: fail(502) });
  const result = await h.produce({ mode: 'generate' });
  assert.equal(result.method, 'generate'); assert.equal(result.fallback, false);
  assert.deepEqual(h.calls, ['/api/ai/elevenlabs/sound-effect']);
});

test('only-search requests, honest empty searches, bad input, permission and quota failures never trigger AI charges', async () => {
  const only = harness({ searchError: fail(502) }); await assert.rejects(only.produce({ mode: 'search' })); assert.equal(only.prompts.length, 0);
  const empty = harness({ items: [], sources: [{ unavailable: false }] });
  assert.equal((await empty.produce()).status, 'no_matches'); assert.equal(empty.prompts.length, 0);
  for (const status of [400, 401, 403, 409, 413, 429]) {
    const h = harness({ searchError: fail(status) }); await assert.rejects(h.produce()); assert.equal(h.prompts.length, 0);
    const captured = harness({ captureErrors: { one: fail(status), two: fail(502) } });
    await assert.rejects(captured.produce()); assert.equal(captured.prompts.length, 0);
  }
});

test('cancellation stops fallback and failed AI generation is not retried', async () => {
  const h = harness(); h.controller.abort(); await assert.rejects(h.produce()); assert.equal(h.calls.length, 0);
  const interrupted = harness();
  interrupted.c.request = async () => { interrupted.controller.abort(); throw fail(502); };
  await assert.rejects(interrupted.produce()); assert.equal(interrupted.prompts.length, 0);
  const broken = harness({ searchError: fail(502), generationError: fail(503) });
  await assert.rejects(broken.produce()); assert.equal(broken.prompts.length, 1);
  await assert.rejects(produceMcpSoundEffect(harness().c, { ...input, mode: 'generate' }, async () => ({ assets: [] })), /未返回可用/);
});

test('batch defaults to auto and per-item explicit generation or search overrides the batch', async () => {
  const h = harness({ searchError: fail(502) });
  const tool = h.tools.find(t => t.name === 'produce_sfx_batch')!;
  assert.deepEqual(tool.parameters.required, ['items']);
  const result: any = await tool.execute({ items: [input, { ...input, mode: 'generate' }, { ...input, mode: 'search' }] });
  assert.equal(result.completedCount, 2);
  assert.deepEqual(result.items.map((v: any) => [v.status, v.method, v.fallback]), [['completed', 'generate', true], ['completed', 'generate', false], ['failed', undefined, undefined]]);
  assert.equal(h.prompts.length, 2);
  assert.equal(h.calls.filter(v => v.endsWith('/search')).length, 2);
  const found = harness();
  const searched: any = await found.tools.find(t => t.name === 'produce_sfx_batch')!.execute({ items: [input] });
  assert.equal(searched.items[0].method, 'search'); assert.equal(found.prompts.length, 0);
});
