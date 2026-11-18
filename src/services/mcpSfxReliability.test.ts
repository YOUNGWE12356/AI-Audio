import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpSfxSearchQueue, createSfxRetryRequest } from './mcpSfxReliability';
import { produceMcpSoundEffect } from './mcpSfxProduction';
import type { AgentToolContext } from './assistantAgentTools';

const busy = (code = 'SFX_SEARCH_BUSY', retryAfterMs = 1000) =>
  Object.assign(new Error('busy'), { status: 429, code, retryAfterMs });
const input = { name: 'door', keywords: 'door', description: 'wooden door closes' };
const context = () => {
  const controller = new AbortController(), calls: { endpoint: string; body: any }[] = [], waits: number[] = [];
  const c = { signal: controller.signal, wait: async (ms: number) => { waits.push(ms); },
    request: async (endpoint: string, body: any) => {
      calls.push({ endpoint, body });
      if (endpoint.endsWith('search-query')) return { searchQuery: 'door' };
      if (endpoint.endsWith('/search')) return { items: [{ id: 'door' }] };
      return { url: '/uploads/door.wav' };
    }, register: async () => ({ size: 100 }) } as unknown as AgentToolContext;
  return { c, controller, calls, waits };
};
const generate = () => Promise.resolve({ assets: [{ size: 100 }] });

test('known search admission failures retry the identical call and recover without generation', async () => {
  for (const code of ['SFX_QUERY_BUSY', 'SFX_SEARCH_BUSY', 'SFX_SEARCH_CAPACITY', 'SFX_CAPTURE_BUSY']) {
    const h = context(), original = h.c.request;
    const endpoint = code === 'SFX_QUERY_BUSY' ? 'search-query' : code === 'SFX_CAPTURE_BUSY' ? '/capture' : '/search';
    let failures = 2, generations = 0;
    const attempts: any[] = [];
    h.c.request = async (url, body) => {
      if (url.endsWith(endpoint)) { attempts.push(body); if (failures-- > 0) throw busy(code); }
      return original(url, body);
    };
    const result = await produceMcpSoundEffect(h.c, input, async () => { generations++; return generate(); });
    assert.equal(result.method, 'search'); assert.equal(generations, 0);
    assert.deepEqual(h.waits, [1000, 2000]);
    assert.equal(attempts.length, 3); assert.ok(attempts.every(body => body === attempts[0]));
  }
});

test('persistent search busy falls back exactly once; search-only never generates', async () => {
  for (const mode of ['auto', 'search'] as const) {
    const h = context(), original = h.c.request;
    let attempts = 0, generations = 0;
    h.c.request = async (url, body) => {
      if (url.endsWith('/search')) { attempts++; throw busy(); }
      return original(url, body);
    };
    const result = produceMcpSoundEffect(h.c, { ...input, mode }, async () => { generations++; return generate(); });
    if (mode === 'auto') { const output = await result; assert.equal(output.method, 'generate'); assert.match(output.fallbackReason || '', /持续繁忙/); }
    else await assert.rejects(result, /持续繁忙/);
    assert.equal(attempts, 4); assert.deepEqual(h.waits, [1000, 2000, 4000]);
    assert.equal(generations, mode === 'auto' ? 1 : 0);
  }
});

test('quota, storage, permissions and ambiguous 429 stop immediately, even with misleading busy fields', async () => {
  for (const [status, code] of [[429, 'COMPANY_POINTS_EXCEEDED'], [429, 'STORAGE_LIMIT_EXCEEDED'],
    [429, undefined], [401, undefined], [403, undefined], [503, 'ELEVENLABS_QUOTA'], [502, 'ELEVENLABS_AUTH']] as const) {
    const h = context(); let calls = 0, generations = 0;
    h.c.request = async () => { calls++; throw Object.assign(new Error('stop'), { status, code, retryAfterMs: 1000 }); };
    await assert.rejects(produceMcpSoundEffect(h.c, input, async () => { generations++; return generate(); }));
    assert.equal(calls, 1); assert.equal(generations, 0); assert.deepEqual(h.waits, []);
  }
});

test('platform-wide limits stop after bounded waits; long Retry-After is never ignored', async () => {
  for (const code of ['API_RATE_LIMIT', 'REQUEST_CONCURRENCY_LIMIT']) {
    const h = context(); let generations = 0, calls = 0;
    h.c.request = async () => { calls++; throw busy(code); };
    await assert.rejects(produceMcpSoundEffect(h.c, input, async () => { generations++; return generate(); }));
    assert.equal(generations, 0); assert.equal(calls, 4);
  }
  const h = context(); h.c.request = async () => { throw busy('API_RATE_LIMIT', 60_000); };
  await assert.rejects(createSfxRetryRequest(h.c)('/search'));
  assert.deepEqual(h.waits, []);
});

test('retry budget is shared by query, search and capture; cancellation and generation are not retried', async () => {
  const h = context(), original = h.c.request, seen = new Set<string>();
  h.c.request = async (url, body) => {
    if (!seen.has(url)) { seen.add(url); throw busy(); }
    return original(url, body);
  };
  assert.equal((await produceMcpSoundEffect(h.c, input, generate)).method, 'search');
  assert.equal(h.waits.length, 3);
  const cancelled = context(); cancelled.c.request = async () => { throw busy(); };
  cancelled.c.wait = async () => { cancelled.controller.abort(); };
  await assert.rejects(produceMcpSoundEffect(cancelled.c, input, async () => { throw Error('must not generate'); }));
  let generations = 0;
  const broken = context(); broken.c.request = async () => { throw busy(); };
  await assert.rejects(produceMcpSoundEffect(broken.c, input, async () => { generations++; throw Error('provider error'); }), /provider error/);
  assert.equal(generations, 1);
});

test('account queue is FIFO, isolates accounts and removes cancelled waiting tasks', async () => {
  const run = createMcpSfxSearchQueue(), controller = new AbortController();
  const order: number[] = [];
  let unlock!: () => void;
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  const first = run('alice', new AbortController().signal, async () => { order.push(1); await gate; });
  const cancelled = run('alice', controller.signal, async () => { order.push(99); });
  const cancelledCheck = assert.rejects(cancelled);
  const third = run('alice', new AbortController().signal, async () => { order.push(3); });
  await run('bob', new AbortController().signal, async () => { order.push(2); });
  controller.abort(); await cancelledCheck; assert.deepEqual(order, [1, 2]);
  unlock(); await Promise.all([first, third]); assert.deepEqual(order, [1, 2, 3]);
  await assert.rejects(run('alice', new AbortController().signal, async () => { throw Error('failed'); }));
  await run('alice', new AbortController().signal, async () => { order.push(4); });
  assert.equal(order.at(-1), 4);
});

test('queue timeout permits auto fallback but explicit generation bypasses the search queue', async () => {
  const run = createMcpSfxSearchQueue({ timeoutMs: 10 });
  let unlock!: () => void;
  const first = run('alice', new AbortController().signal, () => new Promise<void>(resolve => { unlock = resolve; }));
  try {
    const h = context(); h.c.queueSfxSearch = work => run('alice', h.c.signal, work);
    const result = await produceMcpSoundEffect(h.c, input, generate);
    assert.equal(result.method, 'generate'); assert.equal(result.fallback, true);
    assert.equal(h.calls.length, 0);
    h.c.queueSfxSearch = async () => { throw Error('must bypass'); };
    assert.equal((await produceMcpSoundEffect(h.c, { ...input, mode: 'generate' }, generate)).fallback, false);
  } finally { unlock(); await first; }
});
