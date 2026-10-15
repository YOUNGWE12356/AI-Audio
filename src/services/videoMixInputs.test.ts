import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { resolveVideoMixAudioInputs } from './videoMixInputs';
import { detectMediaAudioStream } from './mediaStreamProbe';

test('silent video originals are omitted while real speech remains at its requested time', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'video-mix-inputs-'));
  const source = path.join(dir, 'silent.mp4');
  const voice = path.join(dir, 'voice.wav');
  const run = promisify(execFile);
  try {
    await run(ffmpeg!, ['-y', '-f', 'lavfi', '-i', 'color=black:s=32x32:d=5:r=10', '-an', source]);
    await run(ffmpeg!, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.8', voice]);
    const speech = { id: 'voice', trackType: 'dubbing', audioUrl: '/uploads/voice.wav', startTime: 3, duration: .8 };
    const result = await resolveVideoMixAudioInputs(dir, source, [
      { id: 'original', trackType: 'original', audioUrl: '/uploads/silent.mp4', startTime: 0, duration: 5 }, speech,
    ], file => detectMediaAudioStream(ffmpeg!, file), true);
    assert.deepEqual(result.clips, [speech]);
    assert.equal(result.useOriginalAudio, false);
    assert.deepEqual(result.skippedOriginalClipIds, ['original']);
    const mixed = path.join(dir, 'mixed.mp4');
    await run(ffmpeg!, ['-y', '-i', source, '-i', voice, '-filter_complex', '[1:a]adelay=3000|3000,apad[a]',
      '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', mixed]);
    assert.equal(await detectMediaAudioStream(ffmpeg!, mixed), true);
    await assert.rejects(resolveVideoMixAudioInputs(dir, source, [
      { id: 'bad-dubbing', trackType: 'dubbing', audioUrl: '/uploads/silent.mp4' },
    ], file => detectMediaAudioStream(ffmpeg!, file), false), /不包含音轨/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('existing source audio is kept once and probing is deduplicated', async () => {
  const dir = path.resolve('uploads');
  const source = path.join(dir, 'source.mp4');
  const original = { id: 'original', trackId: 'original-audio', audioUrl: '/uploads/source.mp4' };
  let probes = 0;
  const result = await resolveVideoMixAudioInputs(dir, source, [original], async () => { probes++; return true; }, true);
  assert.deepEqual(result.clips, [original]);
  assert.equal(result.useOriginalAudio, false);
  assert.equal(probes, 1);
  const standalone = await resolveVideoMixAudioInputs(dir, source, [], async () => true, true);
  assert.equal(standalone.useOriginalAudio, true);
  await assert.rejects(resolveVideoMixAudioInputs(dir, source, [original], async () => { throw new Error('probe failed'); }, false), /probe failed/);
});
