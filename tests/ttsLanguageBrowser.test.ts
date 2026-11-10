import test from 'node:test';
import assert from 'node:assert/strict';

test('browser sends selected language to the voice endpoint and omits automatic mode', async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete (globalThis as any).window;
  });
  const { generateVoice } = await import('../src/services/elevenLabsService');
  const requests: any[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, '/api/ai/elevenlabs/voice');
    requests.push(JSON.parse(String(init.body)));
    return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'audio/mpeg' } });
  });
  for (const languageCode of ['ja', 'auto']) {
    await generateVoice('Hello', 'test-voice', undefined, undefined, undefined, { qualityMode: 'pro', languageCode });
  }
  assert.equal(requests[0].languageCode, 'ja');
  assert.equal(Object.hasOwn(requests[1], 'languageCode'), false);
  assert.equal(requests[0].text, 'Hello');
});
