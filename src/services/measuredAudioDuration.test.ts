import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { pcmWav } from '../../tests/helpers/audioFixture';
import { measureAudioDurationSeconds } from './measuredAudioDuration';
import { COMPANY_POINTS, estimateTimedCompanyPoints, generateSpeechToSpeech, isolateAudio, setBillableAudioDurationMeasurer, transcribeSpeech } from './elevenLabsService';
import { setAiUsageRecorder, type AiUsageEvent } from './usageTracking';

test('equal audio duration bills equally across mono/stereo PCM, FLAC, MP3 and video', async () => {
  const mono = pcmWav(60), stereo = pcmWav(60, 48000, 2);
  const compress = (format: string) => execFileSync(ffmpeg!, ['-nostdin', '-hide_banner', '-loglevel', 'error',
    '-i', 'pipe:0', '-f', format, 'pipe:1'], { input: mono, maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  for (const [bytes, type] of [[mono, 'audio/wav'], [stereo, 'audio/wav'], [compress('flac'), 'audio/flac'],
    [compress('mp3'), 'audio/mpeg'], [compress('matroska'), 'video/webm']] as const) {
    const blob = new Blob([new Uint8Array(bytes)], { type });
    const duration = await measureAudioDurationSeconds(blob);
    assert.ok(Math.abs(duration - 60) < 0.1, `${type}: ${duration}`);
    assert.ok(Math.abs(estimateTimedCompanyPoints(duration, COMPANY_POINTS.speechToTextPerSecond) - 36) < 0.1);
    assert.equal(await measureAudioDurationSeconds(blob), duration);
  }
});

test('provider settlement uses measured seconds and rejects unreadable audio before a paid request', async () => {
  const saved = { fetch: globalThis.fetch, key: process.env.ELEVENLABS_API_KEY };
  const events: AiUsageEvent[] = [];
  let requests = 0;
  process.env.ELEVENLABS_API_KEY = 'fixture-only';
  setBillableAudioDurationMeasurer(measureAudioDurationSeconds);
  setAiUsageRecorder(event => events.push(event));
  globalThis.fetch = async () => { requests++; return Response.json({ text: 'fixture' }); };
  try {
    for (const audio of [pcmWav(60), pcmWav(60, 48000, 2)]) {
      const blob = new Blob([new Uint8Array(audio)], { type: 'audio/wav' });
      await transcribeSpeech(blob);
      await generateSpeechToSpeech(blob, 'fixtureVoice');
      await isolateAudio(blob);
    }
    assert.deepEqual(events.map(event => event.companyPoints), [36, 120, 120, 36, 120, 120]);
    assert.ok(events.every(event => event.billingQuantity === 60));
    for (const invoke of [transcribeSpeech, isolateAudio]) {
      await assert.rejects(invoke(new Blob(['invalid'], { type: 'audio/wav' })), { status: 422 });
    }
    assert.equal(requests, 6);
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = saved.key;
    setAiUsageRecorder(null);
  }
});
