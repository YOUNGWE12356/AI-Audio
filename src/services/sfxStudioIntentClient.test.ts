import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStudioSearchQuery, searchStudioSfx } from './sfxStudioIntentClient';

test('description preparation retains the alternate query while explicit English bypasses AI', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const description = '一个穿皮鞋的男人在大厅里走路的脚步声';
  let calls = 0;
  globalThis.fetch = (async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(String(init?.body)).studioDescription, description);
    return Response.json({ searchQuery: 'leather footsteps', alternateQuery: 'shoe footsteps' });
  }) as typeof fetch;
  try {
    const plan = await resolveStudioSearchQuery(description, controller.signal);
    assert.deepEqual(plan, { searchQuery: 'leather footsteps', alternateQuery: 'shoe footsteps' });
    assert.deepEqual(await resolveStudioSearchQuery('fire crackle', controller.signal), { searchQuery: 'fire crackle' });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('web search ignores a model question when the response contains a usable query', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ alternateQuery: 'success chime', clarification: '是哪种完成音？' })) as typeof fetch;
  try {
    const plan = await resolveStudioSearchQuery('Bookshelf_Complete', new AbortController().signal);
    assert.equal(plan.searchQuery, 'success chime');
    assert.equal(plan.alternateQuery, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test('an empty primary search tries one alternate and reports the query that produced audio', async () => {
  const queries: string[] = [], progress: string[] = [];
  const plan = { searchQuery: 'dressshoe footsteps', alternateQuery: 'leather footsteps' };
  const response = await searchStudioSfx(plan, async query => {
    queries.push(query);
    return { items: query === plan.searchQuery ? [] : [{ id: 'playable-leather-shoes' }], nextPage: 2, elapsedMs: 100 };
  }, new AbortController().signal, query => progress.push(query));
  assert.deepEqual(queries, [plan.searchQuery, plan.alternateQuery]);
  assert.deepEqual(progress, [plan.alternateQuery]);
  assert.equal(response.usedQuery, plan.alternateQuery);
  assert.equal(response.result.elapsedMs, 200);
  assert.equal(response.result.items[0].id, 'playable-leather-shoes');
  assert.equal(response.result.nextPage, 2);
});

test('successful or explicit searches do not trigger another query', async () => {
  for (const plan of [
    { searchQuery: 'leather footsteps', alternateQuery: 'shoe footsteps' },
    { searchQuery: 'fire crackle' },
    { searchQuery: 'fire crackle', alternateQuery: 'FIRE CRACKLE' },
  ]) {
    let calls = 0;
    await searchStudioSfx(plan, async () => {
      calls++;
      return { items: plan.searchQuery === 'leather footsteps' ? [{ id: 'one' }] : [], elapsedMs: 100 };
    }, new AbortController().signal);
    assert.equal(calls, 1);
  }
});

test('permission failures and cancellation stop instead of silently starting another search', async () => {
  const plan = { searchQuery: 'leather footsteps', alternateQuery: 'shoe footsteps' };
  let calls = 0;
  await assert.rejects(searchStudioSfx(plan, async () => {
    calls++; throw new Error('登录已过期');
  }, new AbortController().signal), /登录已过期/);
  assert.equal(calls, 1);
  const controller = new AbortController();
  calls = 0;
  await assert.rejects(searchStudioSfx(plan, async () => {
    calls++; controller.abort(); return { items: [], elapsedMs: 100 };
  }, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});
