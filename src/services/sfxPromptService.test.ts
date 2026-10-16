import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { prepareSoundEffectPrompt } from './sfxPromptService';
import { generateSoundEffect } from './elevenLabsService';
import { setAiUsageRecorder, type AiUsageEvent } from './usageTracking';
import { generateSoundEffectVersions, type SoundEffectVersionResult } from './sfxGeneration';

const originalFetch = globalThis.fetch;
const envKeys = ['OPENAI_API_KEY', 'ARK_API_KEY', 'TOKENHUB_API_KEY', 'ELEVENLABS_API_KEY',
  'ELEVENLABS_FALLBACK_API_KEY', 'ELEVENLABS_API_KEYS', 'VITE_ELEVENLABS_API_KEY'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
let calls: Array<{ url: string; body: any }>;
let usage: AiUsageEvent[];

beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
  process.env.TOKENHUB_API_KEY = 'test-key';
  process.env.ELEVENLABS_API_KEY = 'test-key';
  calls = [];
  usage = [];
  setAiUsageRecorder(event => usage.push(event));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setAiUsageRecorder(null);
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

const mockTransport = (translation: unknown = 'Translated sound.', pcm = new Uint8Array(4 * 48000 * 2 * 2)) => {
  globalThis.fetch = (async (input: any, init: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init.body)) });
    if (url.endsWith('/responses')) {
      return Response.json({ output_text: JSON.stringify({ prompt: translation }),
        usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 } });
    }
    assert.match(url, /^https:\/\/api\.elevenlabs\.io\/v1\/sound-generation\?output_format=pcm_48000$/);
    return new Response(pcm, { headers: { 'content-type': 'audio/pcm', 'character-cost': '200' } });
  }) as typeof fetch;
};

test('full English description, punctuation, sequence and final exclusions reach ElevenLabs unchanged', async () => {
  mockTransport();
  const prompt = 'A small flock of cartoon sheep gathering at a tiny barn entrance: soft scattered bleats, delicate hoof patter on grass, and subtle woolly shuffling. Friendly, rounded and playful (not realistic). No music or human voices.';
  const blob = await generateSoundEffect(prompt, 4, { qualityMode: 'pro' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, {
    model_id: 'eleven_text_to_sound_v2', text: prompt, duration_seconds: 4, prompt_influence: 0.45,
  });
  assert.equal(blob.type, 'audio/wav');
  const bytes = await blob.arrayBuffer();
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(new DataView(bytes).getUint32(24, true), 48000);
  assert.equal(new DataView(bytes).getUint16(22, true), 2);
  assert.equal(usage[0].provider, 'elevenlabs');
  assert.equal(usage[0].companyPoints, 8);
});

test('search keyword annotation no longer replaces the complete sound description', async () => {
  mockTransport();
  const prompt = 'Dry wooden door creak (Search Keyword: door). One slow opening, then a short latch click. No footsteps or background noise.';
  await generateSoundEffect(prompt, undefined, { qualityMode: 'standard' });
  assert.equal(calls[0].body.text, prompt);
  assert.equal(calls[0].body.prompt_influence, 0.3);
  assert.equal('duration_seconds' in calls[0].body, false);
});

test('Chinese timeline/direct calls use sound-specific translation before generation and record both providers', async () => {
  const translated = 'One close, slow wooden door creak. No footsteps, background music, or ambient noise.';
  mockTransport(translated);
  await generateSoundEffect('一次近距离的木门缓慢开启吱呀声，不要脚步、不要背景音乐、不要环境底噪。', 2);
  assert.equal(calls.length, 2);
  assert.match(calls[0].body.input, /NOT a voice or emotion description/);
  assert.match(calls[0].body.input, /不要脚步/);
  assert.equal(calls[1].body.text, translated);
  assert.deepEqual(usage.map(event => event.provider), ['gpt', 'elevenlabs']);
});

test('A/B generation shares one translation and never re-translates prepared English', async () => {
  const translated = 'Three dry cartoon button pops, accelerating; no music, reverb, or background ambience.';
  mockTransport(translated);
  const prompt = await prepareSoundEffectPrompt('三个干净的卡通按钮气泡音，逐渐加快；不要音乐、混响和背景环境声。');
  await Promise.all([generateSoundEffect(prompt), generateSoundEffect(prompt)]);
  assert.equal(calls.filter(call => call.url.endsWith('/responses')).length, 1);
  assert.equal(calls.length, 3);
  assert.ok(calls.slice(1).every(call => call.body.text === translated));
});

test('failed, empty or untranslated model output never starts paid sound generation', async () => {
  for (const value of ['', null, '没有翻译的中文']) {
    calls = [];
    mockTransport(value);
    await assert.rejects(generateSoundEffect('木门吱呀声'), /翻译失败.*未开始生成/);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith('/responses'));
  }
  calls = [];
  globalThis.fetch = (async () => { throw new Error('network unavailable'); }) as typeof fetch;
  await assert.rejects(generateSoundEffect('木门吱呀声'), /翻译失败.*未开始生成/);
  assert.equal(calls.length, 0);
});

test('empty input cannot generate an arbitrary generic sound', async () => {
  mockTransport();
  await assert.rejects(generateSoundEffect('   '), /请输入音效描述/);
  assert.equal(calls.length, 0);
});

test('English smart quotes and symbols preserve the description without a translation call', async () => {
  mockTransport();
  const prompt = 'A “pop” → a soft click — dry, no reverb.';
  assert.equal(await prepareSoundEffectPrompt(prompt), prompt);
  await generateSoundEffect(prompt);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.text, prompt);
});

test('three seconds of stereo PCM stays three seconds instead of playing twice as slowly', async () => {
  const pcm = new Uint8Array(3 * 48000 * 2 * 2);
  new DataView(pcm.buffer).setInt16(0, 1000, true);
  new DataView(pcm.buffer).setInt16(2, -2000, true);
  mockTransport(undefined, pcm);
  const bytes = await (await generateSoundEffect('A dry door creak.', 3)).arrayBuffer();
  const header = new DataView(bytes);
  assert.equal(header.getUint16(22, true), 2);
  assert.equal(header.getUint16(32, true), 4);
  assert.equal(header.getUint32(40, true) / header.getUint32(28, true), 3);
  assert.equal(header.getInt16(44, true), 1000);
  assert.equal(header.getInt16(46, true), -2000);
});

test('automatic duration bills the returned PCM, including clips shorter and longer than five seconds', async () => {
  for (const seconds of [1.25, 12]) {
    mockTransport(undefined, new Uint8Array(seconds * 48000 * 2 * 2));
    await generateSoundEffect('A dry door creak.');
    assert.equal(usage.at(-1)!.billingQuantity, seconds);
    assert.equal(usage.at(-1)!.companyPoints, seconds * 2);
    assert.equal('duration_seconds' in calls.at(-1)!.body, false);
  }
});

test('even fixed-duration requests settle on the delivered duration', async () => {
  mockTransport(undefined, new Uint8Array(2.5 * 48000 * 2 * 2));
  await generateSoundEffect('A button click.', 3);
  assert.equal(calls[0].body.duration_seconds, 3);
  assert.equal(usage[0].billingQuantity, 2.5);
  assert.equal(usage[0].companyPoints, 5);
});

test('empty, malformed or interrupted responses are not recorded as delivered audio', async () => {
  for (const bytes of [0, 3]) {
    mockTransport(undefined, new Uint8Array(bytes));
    await assert.rejects(generateSoundEffect('A button click.'), /数据不完整/);
    assert.equal(usage.length, 0);
  }
  globalThis.fetch = (async () => {
    const response = new Response();
    response.arrayBuffer = async () => { throw new Error('stream interrupted'); };
    return response;
  }) as typeof fetch;
  await assert.rejects(generateSoundEffect('A button click.'), /stream interrupted/);
  assert.equal(usage.length, 0);
});

test('a successful version is published before its sibling fails and is billed only once', async () => {
  const results: SoundEffectVersionResult[] = [];
  let releaseSecond!: (response: Response) => void;
  let soundCalls = 0;
  globalThis.fetch = (async () => {
    soundCalls++;
    if (soundCalls === 2) return new Promise<Response>(resolve => { releaseSecond = resolve; });
    return new Response(new Uint8Array(3 * 48000 * 2 * 2));
  }) as typeof fetch;
  const batch = generateSoundEffectVersions({ prompt: 'A wooden door creak.', qualityMode: 'pro', onResult: result => results.push(result) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(results.length, 1);
  assert.equal(results[0].version, 'A');
  assert.equal(results[0].status, 'fulfilled');
  if (results[0].status === 'fulfilled') assert.equal(results[0].duration, 3);
  releaseSecond(Response.json({ detail: { message: 'test unavailable' } }, { status: 503 }));
  const completed = await batch;
  assert.deepEqual(completed.map(result => result.status), ['fulfilled', 'rejected']);
  assert.equal(results.length, 2);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].companyPoints, 6);
});

test('batch translates Chinese once and both failed versions settle with explicit errors', async () => {
  const results: SoundEffectVersionResult[] = [];
  mockTransport('A wooden door creak.');
  await generateSoundEffectVersions({ prompt: '木门吱呀声', qualityMode: 'pro', onResult: result => results.push(result) });
  assert.equal(calls.filter(call => call.url.endsWith('/responses')).length, 1);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  globalThis.fetch = (async () => Response.json({ detail: 'test rejected' }, { status: 500 })) as typeof fetch;
  const failed = await generateSoundEffectVersions({ prompt: 'A door.', qualityMode: 'pro', onResult: () => undefined });
  assert.ok(failed.every(result => result.status === 'rejected' && result.error === 'test rejected'));
});

test('generation timeout covers the body stream and never retries a timed-out paid request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let observedSignal: AbortSignal;
  let fetchCount = 0;
  globalThis.fetch = (async (_input: any, init: RequestInit) => {
    observedSignal = init.signal!;
    fetchCount++;
    const response = new Response();
    response.arrayBuffer = () => new Promise(() => undefined);
    return response;
  }) as typeof fetch;
  const rejected = assert.rejects(generateSoundEffect('A dry door creak.'), /超过 120 秒/);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(120_000);
  await rejected;
  assert.equal(observedSignal!.aborted, true);
  assert.equal(fetchCount, 1);
  assert.equal(usage.length, 0);
});
