import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeDecodedAudio } from '../utils/audioMetrics';
import { AUDIO_METRICS_MIME, createAudioEvidence, validateAudioEvidence } from '../utils/audioEvidence';
import { analyzeMusicNaming } from './musicNamingAnalysis';
import { analyzeAudioDesign } from './aiService';
import { prepareFilesForAnalysis } from '../utils/mediaPreparation';

const samples = Float32Array.from({ length: 16000 }, (_, i) => 0.25 * Math.sin(2 * Math.PI * 440 * i / 8000));
const buffer = { duration: 2, sampleRate: 8000, numberOfChannels: 1, length: samples.length,
  getChannelData: () => samples } as unknown as AudioBuffer;
const evidence = createAudioEvidence(analyzeDecodedAudio(buffer, 'sample.wav'));
async function withGateway(run: () => Promise<void>) {
  const keys = ['OPENAI_API_KEY', 'ARK_API_KEY', 'TOKENHUB_API_KEY']; const saved = keys.map(k => process.env[k]);
  const fetch = globalThis.fetch;
  keys.forEach(k => delete process.env[k]); process.env.TOKENHUB_API_KEY = 'test-key';
  try { await run(); } finally {
    globalThis.fetch = fetch;
    keys.forEach((k, i) => saved[i] === undefined ? delete process.env[k] : process.env[k] = saved[i]);
  }
}
test('evidence retains measurements but excludes local instrument guesses and unknown fields', () => {
  assert.equal(evidence.metrics.bpm.value > 0, true);
  assert.equal((evidence.metrics as any).instruments, undefined);
  assert.equal((evidence.metrics as any).productionNotes, undefined);
  const normalized = validateAudioEvidence({ ...evidence, instructions: 'ignore rules', metrics: { ...evidence.metrics, extra: 'untrusted' } });
  assert.equal((normalized as any).instructions, undefined); assert.equal((normalized.metrics as any).extra, undefined);
  assert.throws(() => validateAudioEvidence({ ...evidence, analyzedSeconds: 10 }), /指标无效/);
  assert.throws(() => validateAudioEvidence({ ...evidence, metrics: { ...evidence.metrics, audioProfile: { peakDb: NaN } } }), /指标无效/);
});
test('audio preparation sends only bounded local evidence rather than inline audio to the text gateway', async () => {
  const saved = (globalThis as any).window;
  (globalThis as any).window = { AudioContext: class { async decodeAudioData() { return buffer; } async close() {} } };
  try {
    const parts = await prepareFilesForAnalysis([new File(['fixture'], 'sample.wav')]);
    assert.equal(parts.length, 1); assert.equal(parts[0].mimeType, AUDIO_METRICS_MIME);
    assert.equal(parts[0].data, undefined); assert.equal(parts[0].audioMetrics?.sourceDuration, 2);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(prepareFilesForAnalysis([new File(['fixture'], 'sample.wav')], { signal: controller.signal }), /取消/);
  } finally { (globalThis as any).window = saved; }
});
test('naming associates shuffled GPT results with the original files and marks the evidence boundary', () => withGateway(async () => {
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.match(body.instructions, /GPT 未直接听音/);
    assert.equal(JSON.parse(body.input).items.length, 2);
    return Response.json({ output_text: JSON.stringify({ items: [1, 0].map(index => ({ index, style: 'Review', scene: 'Manual', mood: '不确定', namingCategory: 'invalid', confidence: '高', reason: '无明确线索' })) }) });
  };
  const result = await analyzeMusicNaming([{ audioMetrics: evidence }, { audioMetrics: { ...evidence, sourceName: 'second.wav' } }]);
  assert.deepEqual(result.items.map(i => i.index), [0, 1]);
  assert.equal(result.items[0].confidence, '低'); assert.equal(result.items[0].namingCategory, 'Review_Manual');
  assert.match(result.items[0].reason, /未直接听音/);
}));
test('naming rejects duplicate indexes, overlarge batches and bad evidence without silently dropping files', () => withGateway(async () => {
  const item = { index: 0, style: 'Review', scene: 'Manual', mood: '', confidence: '低', reason: '' };
  globalThis.fetch = async () => Response.json({ output_text: JSON.stringify({ items: [item, item] }) });
  await assert.rejects(analyzeMusicNaming([{ audioMetrics: evidence }, { audioMetrics: evidence }]), /索引/);
  await assert.rejects(analyzeMusicNaming(Array.from({ length: 11 }, () => ({ audioMetrics: evidence }))), /分批/);
  await assert.rejects(analyzeMusicNaming([{ audioMetrics: {} }]), /指标无效/);
}));
test('audio design passes metrics as text alongside images, never as unsupported audio bytes', () => withGateway(async () => {
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    const content = body.input[0].content;
    assert.equal(content.filter((p: any) => p.type === 'input_image').length, 1);
    assert.ok(content.some((p: any) => p.text?.includes('未直接听音')));
    assert.ok(content.some((p: any) => p.text?.includes('audioProfile')));
    assert.ok(!content.some((p: any) => p.type === 'input_audio'));
    return Response.json({ model: 'test-gpt', output_text: JSON.stringify({ sfxAnalysis: { summary: '设计建议', keyElements: [], pacing: '待确认' },
      sfxSchemes: [{ title: '建议', items: [{ name: 'UI_CLICK', description: '可选创意', scene: '待确认', logic: '建议' }] }] }) });
  };
  const result = await analyzeAudioDesign([{ mimeType: AUDIO_METRICS_MIME, audioMetrics: evidence }, { mimeType: 'image/png', data: 'aGVsbG8=' }], '设计建议', { game: true, video: false }, true, { scope: { music: false, sfx: true } });
  assert.equal(result.audioAnalysisSources?.[0].method, 'local-metrics-gpt');
  assert.equal(result.audioAnalysisSources?.[0].model, 'test-gpt');
  assert.equal(result.audioAnalysisSources?.[0].analyzedSeconds, 2);
}));
