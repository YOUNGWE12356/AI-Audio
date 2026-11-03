import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeAudioDesign } from './aiService';

test('audio design uses a compact scope-specific contract, a 90s budget, and forwards cancellation', async () => {
  const keys = ['OPENAI_API_KEY', 'ARK_API_KEY', 'TOKENHUB_API_KEY'];
  const saved = keys.map(key => process.env[key]); const nativeFetch = globalThis.fetch, nativeTimeout = AbortSignal.timeout;
  const timeouts: number[] = []; const requests: any[] = [];
  keys.forEach(key => delete process.env[key]); process.env.TOKENHUB_API_KEY = 'test-key';
  AbortSignal.timeout = ms => { timeouts.push(ms); return nativeTimeout(ms); };
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body))); options?.signal?.throwIfAborted();
    return Response.json({ output_text: JSON.stringify({ sfxAnalysis: { summary: 'test', keyElements: [], pacing: '' },
      sfxSchemes: [{ title: 'test', items: [{ name: 'Door_Open', scene: '00:01', description: 'test', logic: 'test' }] }] }) });
  };
  const files = [{ mimeType: 'image/jpeg', data: 'aGVsbG8=' }];
  try {
    await analyzeAudioDesign(files, '', { game: true, video: false }, true, { scope: { music: false, sfx: true } });
    assert.deepEqual(timeouts, [90_000]);
    assert.equal(requests[0].text.format.schema.properties.bgmRecommendations, undefined);
    assert.ok(requests[0].input[0].content[0].text.length < 1000);
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      const schema = body.text.format.schema.properties;
      assert.equal(schema.sfxAnalysis, undefined);
      assert.equal(schema.bgmRecommendations.maxItems, 2);
      assert.equal(schema.bgmRecommendations.items.properties.vocalDirection, undefined);
      assert.equal(schema.bgmRecommendations.items.properties.vocalInfo, undefined);
      assert.equal(schema.bgmRecommendations.items.properties.lyrics, undefined);
      return Response.json({ output_text: '{"bgmRecommendations":[]}' });
    };
    await assert.rejects(analyzeAudioDesign(files, '', { game: false, video: false, avatar: true }, true,
      { scope: { music: true, sfx: false } }), /未生成有效的配乐方案/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(analyzeAudioDesign(files, '', { game: true, video: false }, true, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(requests.length, 1);
    globalThis.fetch = async (_url, options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    });
    const running = new AbortController();
    const pending = analyzeAudioDesign(files, '', { game: true, video: false }, true, { signal: running.signal });
    running.abort(); await assert.rejects(pending, { name: 'AbortError' });
  } finally {
    globalThis.fetch = nativeFetch; AbortSignal.timeout = nativeTimeout;
    keys.forEach((key, index) => saved[index] === undefined ? delete process.env[key] : process.env[key] = saved[index]);
  }
});
