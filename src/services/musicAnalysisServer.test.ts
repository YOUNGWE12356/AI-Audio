import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { analyzeMusicWithGpt, createMusicAnalysisRouter, validateAnalysisWav } from './musicAnalysisServer';
import { setAiUsageRecorder } from './usageTracking';

const analysis = {
  primaryStyle: '氛围音乐', subStyles: [], regionalTradition: '不确定', modeSystem: '不确定',
  modeName: '不确定', tonic: 'C', tuningSystem: '不确定', microtonal: '不确定', confidence: '低',
  alternatives: [], reason: '证据有限', instruments: [], productionNotes: ['建议复核节拍与峰值。'],
};
const metadata = { duration: 2, bpm: 100, keyName: 'C Major', audioProfile: { peakDb: -1, rmsDb: -16 } };
function wav(seconds = 2) {
  const b = Buffer.alloc(44 + seconds * 16000 * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40);
  return b;
}
async function isolated(run: () => Promise<void>) {
  const keys = ['GPT_AUDIO_API_KEY', 'GPT_AUDIO_BASE_URL', 'GPT_AUDIO_MODEL', 'OPENAI_API_KEY', 'ARK_API_KEY', 'TOKENHUB_API_KEY'];
  const saved = keys.map(k => process.env[k]); const originalFetch = globalThis.fetch;
  keys.forEach(k => delete process.env[k]); process.env.TOKENHUB_API_KEY = 'test-text-key';
  try { await run(); } finally {
    globalThis.fetch = originalFetch; setAiUsageRecorder(null);
    keys.forEach((k, i) => saved[i] === undefined ? delete process.env[k] : process.env[k] = saved[i]);
  }
}
test('metrics mode calls GPT but cannot present inferred genre or instruments as heard', () => isolated(async () => {
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/responses$/);
    const body = JSON.parse(String(options?.body));
    assert.match(body.instructions, /没有音频输入/);
    assert.equal(JSON.parse(body.input).bpm, 100);
    return Response.json({ output_text: JSON.stringify({ ...analysis, confidence: '高', instruments: [{ name: '钢琴', reason: '猜测', confidence: '高' }] }) });
  };
  const result = await analyzeMusicWithGpt(metadata, wav());
  assert.equal(result.analysis.analysisBasis, 'metrics');
  assert.equal(result.analysis.primaryStyle, '不确定');
  assert.equal(result.analysis.confidence, '低');
  assert.deepEqual(result.analysis.instruments, []);
  assert.match(result.analysis.reason, /未直接听音/);
}));
test('native mode sends actual WAV bytes to the separate audio model and records chat usage', () => isolated(async () => {
  process.env.GPT_AUDIO_API_KEY = 'test-audio-key'; process.env.GPT_AUDIO_BASE_URL = 'https://audio.example/v1/';
  process.env.GPT_AUDIO_MODEL = 'gpt-audio-1.5';
  const events: any[] = []; setAiUsageRecorder(e => events.push(e));
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://audio.example/v1/chat/completions');
    assert.equal((options?.headers as any).Authorization, 'Bearer test-audio-key');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, 'gpt-audio-1.5');
    assert.deepEqual(body.modalities, ['text']);
    assert.equal(body.messages[1].content[1].type, 'input_audio');
    assert.deepEqual(Buffer.from(body.messages[1].content[1].input_audio.data, 'base64'), wav());
    return Response.json({ model: 'gpt-audio-1.5', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis) } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } });
  };
  assert.equal((await analyzeMusicWithGpt(metadata, wav())).analysis.analysisBasis, 'audio');
  assert.equal(events[0].totalTokens, 130);
  assert.equal(events[0].companyPoints >= 10, true);
  assert.match(events[0].pricingVersion, /gpt-token/);
}));
test('native model failure is not silently replaced with text analysis', () => isolated(async () => {
  process.env.GPT_AUDIO_API_KEY = 'test-audio-key'; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: { message: 'audio model unavailable' } }, { status: 403 }); };
  await assert.rejects(analyzeMusicWithGpt(metadata, wav()), /403.*audio model unavailable/);
  assert.equal(calls, 1);
}));
test('a custom audio host never receives the text gateway key implicitly', () => isolated(async () => {
  process.env.OPENAI_API_KEY = 'private-text-key'; process.env.GPT_AUDIO_BASE_URL = 'https://other.example/v1';
  globalThis.fetch = async (url) => {
    assert.ok(!String(url).includes('other.example'));
    return Response.json({ output_text: JSON.stringify(analysis) });
  };
  assert.equal((await analyzeMusicWithGpt(metadata)).analysis.analysisBasis, 'metrics');
}));
test('invalid or truncated model output is rejected', () => isolated(async () => {
  globalThis.fetch = async () => Response.json({ output_text: '{"primaryStyle":"Jazz"}' });
  await assert.rejects(analyzeMusicWithGpt(metadata), /结果不完整/);
}));
test('WAV guard rejects fake headers, truncation and unbounded clips', () => {
  validateAnalysisWav(wav());
  assert.throws(() => validateAnalysisWav(Buffer.from('not wav')), /PCM WAV/);
  assert.throws(() => validateAnalysisWav(wav().subarray(0, 50)), /不完整/);
  assert.throws(() => validateAnalysisWav(wav(38)), /36 秒/);
});
test('multipart endpoint validates input and serves real GPT results', () => isolated(async () => {
  const app = express(); app.use('/analysis', createMusicAnalysisRouter());
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.on('listening', r));
  const address = server.address() as { port: number }; const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => String(url).startsWith('http://127.0.0.1:')
    ? nativeFetch(url, options) : Response.json({ output_text: JSON.stringify(analysis) });
  try {
    const form = new FormData(); form.set('metadata', JSON.stringify(metadata)); form.set('audio', new Blob([wav()]), 'clip.wav');
    const response = await fetch(`http://127.0.0.1:${address.port}/analysis/semantic`, { method: 'POST', body: form });
    assert.equal(response.status, 200); assert.equal((await response.json()).analysis.analysisBasis, 'metrics');
    const bad = new FormData(); bad.set('metadata', '{broken');
    const rejected = await fetch(`http://127.0.0.1:${address.port}/analysis/semantic`, { method: 'POST', body: bad });
    assert.equal(rejected.status, 400);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}));
