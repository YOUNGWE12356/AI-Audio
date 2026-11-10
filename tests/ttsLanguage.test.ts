import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { generateVoice } from '../src/services/elevenLabsService';
import { ELEVENLABS_TTS_LANGUAGES, normalizeTtsLanguageCode } from '../src/utils/elevenLabsTtsLanguage';

function mockProvider(t: TestContext, failures = 0) {
  for (const [key, value] of Object.entries({ ELEVENLABS_API_KEY: 'test-only-key', ELEVENLABS_FALLBACK_API_KEY: '', ELEVENLABS_API_KEYS: '' })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const requests: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return requests.length <= failures
      ? new Response(JSON.stringify({ detail: { message: 'Model temporarily unavailable' } }), { status: 503 })
      : new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } });
  });
  return requests;
}

test('automatic language omits the provider override and preserves input text', async t => {
  const requests = mockProvider(t);
  await generateVoice('Hello 你好', 'test-voice', undefined, undefined, undefined, { languageCode: 'auto' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].text, 'Hello 你好');
  assert.equal(Object.hasOwn(requests[0], 'language_code'), false);
});

test('chosen language survives model fallback and skips multilingual v2', async t => {
  const requests = mockProvider(t, 2);
  await generateVoice('Bonjour', 'test-voice', undefined, undefined, undefined, { languageCode: 'fr' });
  assert.deepEqual(requests.map(r => [r.model_id, r.language_code]), [
    ['eleven_v4', 'fr'], ['eleven_v3', 'fr'], ['eleven_flash_v2_5', 'fr'],
  ]);
});

test('v4-only languages never silently fall back to an unsupported model', async t => {
  const requests = mockProvider(t, 10);
  await assert.rejects(generateVoice('test', 'test-voice', undefined, undefined, undefined, { languageCode: 'am' }));
  assert.deepEqual(requests.map(r => [r.model_id, r.language_code]), [['eleven_v4', 'am']]);
});

test('unknown language codes are rejected before a provider call', async t => {
  const requests = mockProvider(t);
  await assert.rejects(generateVoice('test', 'test-voice', undefined, undefined, undefined, { languageCode: 'invalid' }));
  assert.equal(requests.length, 0);
  assert.equal(normalizeTtsLanguageCode(' JA '), 'ja');
  assert.equal(normalizeTtsLanguageCode(undefined), undefined);
  assert.equal(new Set(ELEVENLABS_TTS_LANGUAGES.map(l => l.code)).size, ELEVENLABS_TTS_LANGUAGES.length);
});
