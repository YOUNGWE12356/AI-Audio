import assert from 'node:assert/strict';
import test from 'node:test';
import { getClipPlaybackRegion, getSourceWaveform, resizeAudioClip } from './audioClipEditing';

const source = { duration: 30 };
const original = { startTime: 5, duration: 30, sourceOffset: 0, playbackRate: 1, buffer: source };
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('both edges can restore hidden audio across separate drag operations', () => {
  const left = resizeAudioClip(original, 'left', 12);
  assert.equal(left.sourceOffset, 7);
  assert.equal(left.startTime + left.duration, 35);
  const both = resizeAudioClip(left, 'right', 25);
  const rightRestored = resizeAudioClip(both, 'right', 35);
  const restored = resizeAudioClip(rightRestored, 'left', 5);
  assert.deepEqual(restored, original);
  assert.equal(both.buffer, source);
});

test('boundaries stop at source limits and timeline zero', () => {
  assert.equal(resizeAudioClip(original, 'right', 100).duration, 30);
  assert.equal(resizeAudioClip(original, 'left', -10).startTime, 5);
  const shifted = { ...original, startTime: 1, duration: 20, sourceOffset: 10 };
  const extended = resizeAudioClip(shifted, 'left', -10);
  assert.equal(extended.startTime, 0);
  assert.equal(extended.sourceOffset, 9);
  close(resizeAudioClip(original, 'right', 0).duration, 0.1);
  close(resizeAudioClip(original, 'left', 100).duration, 0.1);
});

test('trims and restores respect playback speed and preserve the opposite edge', () => {
  const fast = { ...original, duration: 15, playbackRate: 2 };
  const trimmed = resizeAudioClip(fast, 'left', 8);
  assert.equal(trimmed.sourceOffset, 6);
  assert.equal(trimmed.duration, 12);
  assert.deepEqual(resizeAudioClip(trimmed, 'left', 5), fast);
  assert.equal(resizeAudioClip(trimmed, 'right', 99).startTime + resizeAudioClip(trimmed, 'right', 99).duration, 20);
});

test('live playback and export use only visible source samples, including mid-clip playhead', () => {
  const clip = resizeAudioClip(resizeAudioClip(original, 'left', 10), 'right', 18);
  assert.deepEqual(getClipPlaybackRegion(clip), { delay: 10, offset: 5, duration: 8 });
  assert.deepEqual(getClipPlaybackRegion(clip, 13), { delay: 0, offset: 8, duration: 5 });
  assert.equal(getClipPlaybackRegion(clip, 20).duration, 0);
  assert.deepEqual(getClipPlaybackRegion({ ...clip, playbackRate: 2, duration: 4 }, 11), { delay: 0, offset: 7, duration: 6 });
});

test('split regions retain access to the same original source and restore independently', () => {
  const trimmed = resizeAudioClip(resizeAudioClip(original, 'left', 10), 'right', 25);
  const front = { ...trimmed, duration: 6 };
  const back = { ...trimmed, startTime: 16, duration: 9, sourceOffset: 11 };
  assert.equal(getClipPlaybackRegion(back).offset, 11);
  assert.equal(resizeAudioClip(front, 'right', 35).duration, 25);
  assert.equal(resizeAudioClip(back, 'left', 5).sourceOffset, 0);
  assert.equal(front.buffer, back.buffer);
});

test('waveform includes both channels and short transients, with fixed source coordinates', () => {
  const left = new Float32Array(1000);
  const right = new Float32Array(1000);
  right[499] = 1; left[900] = -0.5;
  let reads = 0;
  const buffer = { duration: 1, sampleRate: 1000, length: 1000, numberOfChannels: 2,
    getChannelData: (channel: number) => { reads++; return channel ? right : left; } } as AudioBuffer;
  const wave = getSourceWaveform(buffer);
  assert.match(wave.path, /M 9\.000 5\.00 L 9\.000 50\.00/);
  assert.match(wave.path, /M 18\.000 50\.00 L 18\.000 72\.50/);
  const cut = resizeAudioClip({ startTime: 0, duration: 1, buffer }, 'right', 0.5);
  assert.equal(getSourceWaveform(cut.buffer), wave);
  assert.equal(reads, 2);
  assert.equal(wave.width, 20);
  const detailed = getSourceWaveform(buffer, 80);
  assert.equal(detailed.width, 80);
  assert.equal(getSourceWaveform(buffer, 80), detailed);
  assert.equal(getSourceWaveform(buffer), wave);
});
