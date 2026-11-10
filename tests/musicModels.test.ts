import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { generateMusic } from '../src/services/elevenLabsService';
import { setAiUsageRecorder, type AiUsageEvent } from '../src/services/usageTracking';

function mockMusic(t: TestContext, responses: Array<Response | Error>) {
  for (const [key, value] of Object.entries({ ELEVENLABS_API_KEY: 'test-only-key', ELEVENLABS_FALLBACK_API_KEY: '', ELEVENLABS_API_KEYS: '' })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const usage: AiUsageEvent[] = [];
  setAiUsageRecorder(event => usage.push(event));
  t.after(() => setAiUsageRecorder(null));
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected extra provider request');
    if (response instanceof Error) throw response;
    return response;
  });
  return { requests, usage };
}

const audio = () => new Response(new Uint8Array([1, 2, 3]), {
  headers: { 'Content-Type': 'audio/mpeg', 'character-cost': '900' },
});
const failure = (status: number, message: string) => new Response(JSON.stringify({ detail: { message } }), { status });

test('music uses v2.5 first with the requested duration and records its actual usage', async t => {
  const { requests, usage } = mockMusic(t, [audio()]);
  let usedModel = '';
  const result = await generateMusic('warm piano', 60, true, undefined, { onModelUsed: model => { usedModel = model; } });
  assert.equal(result.size, 3);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.model_id, 'music_v2_5');
  assert.equal(requests[0].body.music_length_ms, 60000);
  assert.equal(requests[0].body.force_instrumental, true);
  assert.match(requests[0].url, /output_format=mp3_48000_192/);
  assert.equal(usedModel, 'music_v2_5');
  assert.deepEqual(usage.map(event => [event.model, event.credits, event.companyPoints]), [['music_v2_5', 900, 150]]);
});

for (const [status, message] of [
  [503, 'Service unavailable'],
  [502, 'Bad gateway'],
  [404, 'Model music_v2_5 not found'],
  [400, 'Unsupported model music_v2_5'],
  [403, 'Model music_v2_5 is not available for your account'],
  [422, 'model_not_available'],
] as const) {
  test(`music falls back once to v2 on model failure ${status}: ${message}`, async t => {
    const { requests, usage } = mockMusic(t, [failure(status, message), audio()]);
    let usedModel = '';
    await generateMusic('warm piano', 60, false, '你好，世界', { onModelUsed: model => { usedModel = model; } });
    assert.deepEqual(requests.map(request => request.body.model_id), ['music_v2_5', 'music_v2']);
    assert.deepEqual(requests[1].body, { ...requests[0].body, model_id: 'music_v2' });
    assert.match(String(requests[1].body.prompt), /你好，世界/);
    assert.equal(usedModel, 'music_v2');
    assert.deepEqual(usage.map(event => [event.model, event.credits, event.companyPoints]), [['music_v2', 900, 150]]);
  });
}

for (const [status, message] of [
  [401, 'Invalid API key'],
  [403, 'Missing permissions'],
  [429, 'Rate limit exceeded'],
  [400, 'Insufficient credits'],
  [422, 'Invalid prompt length'],
  [400, 'Prompt violated our Terms of Service'],
  [503, 'Safety policy rejected prompt'],
] as const) {
  test(`music does not switch models for request/account rejection ${status}: ${message}`, async t => {
    const { requests, usage } = mockMusic(t, [failure(status, message)]);
    await assert.rejects(generateMusic('warm piano', 60));
    assert.equal(requests.length, 1);
    assert.equal(usage.length, 0);
  });
}

test('music stops after the backup fails and does not record a successful charge', async t => {
  const { requests, usage } = mockMusic(t, [failure(503, 'Unavailable'), failure(503, 'Backup unavailable')]);
  await assert.rejects(generateMusic('warm piano', 60), /Backup unavailable/);
  assert.deepEqual(requests.map(request => request.body.model_id), ['music_v2_5', 'music_v2']);
  assert.equal(usage.length, 0);
});

test('music does not repeat an ambiguous network failure', async t => {
  const { requests, usage } = mockMusic(t, [new TypeError('fetch failed')]);
  await assert.rejects(generateMusic('warm piano', 60), /fetch failed/);
  assert.equal(requests.length, 1);
  assert.equal(usage.length, 0);
});

test('music does not regenerate when the successful response body is interrupted', async t => {
  const response = audio();
  t.mock.method(response, 'blob', async () => { throw new Error('audio stream interrupted'); });
  const { requests } = mockMusic(t, [response]);
  let usedModel = '';
  await assert.rejects(generateMusic('warm piano', 60, true, undefined, { onModelUsed: model => { usedModel = model; } }), /interrupted/);
  assert.equal(requests.length, 1);
  assert.equal(usedModel, '');
});
