import assert from 'node:assert/strict';
import test from 'node:test';
import { sliceDownloadAudio, startAudioRangePreview } from './audioRangeExport';

class TestBuffer {
  channels: Float32Array[];
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  constructor(options: AudioBufferOptions) {
    this.sampleRate = options.sampleRate; this.length = options.length; this.numberOfChannels = options.numberOfChannels || 1;
    this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
  }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(channel: number) { return this.channels[channel]; }
  copyToChannel(samples: Float32Array, channel: number) { this.channels[channel].set(samples); }
}

test('download selection preserves the exact stereo source frames without modifying the source', () => {
  const previous = globalThis.AudioBuffer;
  Object.assign(globalThis, { AudioBuffer: TestBuffer });
  try {
    const source = new TestBuffer({ sampleRate: 48000, length: 96000, numberOfChannels: 2 });
    source.channels[0] = Float32Array.from({ length: source.length }, (_, i) => Math.sin(i / 16));
    source.channels[1] = Float32Array.from({ length: source.length }, (_, i) => Math.cos(i / 16));
    const buffer = source as unknown as AudioBuffer;
    const clip = sliceDownloadAudio(buffer, { start: 0.251, end: 0.751 });
    assert.equal(clip.duration, 0.5);
    assert.equal(clip.numberOfChannels, 2);
    assert.equal(clip.sampleRate, 48000);
    for (let channel = 0; channel < 2; channel++) {
      assert.deepEqual(clip.getChannelData(channel), source.channels[channel].slice(12048, 36048));
    }
    clip.getChannelData(0)[0] = 0;
    assert.notEqual(source.channels[0][12048], 0);
    assert.equal(sliceDownloadAudio(buffer, null), buffer);
    assert.equal(sliceDownloadAudio(buffer, { start: -2, end: 5 }).length, source.length);
    for (const range of [{ start: 2, end: 1 }, { start: 0, end: NaN }, { start: 3, end: 4 }, { start: 0, end: 1e-8 }]) {
      assert.throws(() => sliceDownloadAudio(buffer, range), /范围|太短/);
    }
  } finally { globalThis.AudioBuffer = previous; }
});

test('preview contains exactly the exported samples, including the tail, and cannot play past them when UI timers stall', () => {
  const previous = globalThis.AudioBuffer;
  Object.assign(globalThis, { AudioBuffer: TestBuffer });
  try {
    const source = new TestBuffer({ sampleRate: 48000, length: 48000, numberOfChannels: 2 });
    // An audible marker immediately before the cut, followed by different audio
    // outside the selection, catches both missing tails and preview overshoot.
    source.channels[0].fill(0.5, 36000 - 480, 36000);
    source.channels[1].fill(-0.5, 36000 - 480, 36000);
    source.channels.forEach(channel => channel.fill(0.9, 36000));
    const buffer = source as unknown as AudioBuffer;
    const range = { start: 0.251, end: 0.75 };
    const exported = sliceDownloadAudio(buffer, range);
    const node = { buffer: null as AudioBuffer | null, playbackRate: { value: 1 }, onended: null as (() => void) | null,
      starts: [] as number[][], stops: 0, disconnects: 0,
      connect() {}, disconnect() { this.disconnects++; }, stop() { this.stops++; },
      start(...args: number[]) { this.starts.push(args); } };
    const context = { currentTime: 10, destination: {}, createBufferSource: () => node };
    let endedAt: number | undefined;
    const preview = startAudioRangePreview(context as unknown as AudioContext, buffer, range,
      { currentTime: 0, playbackRate: 1, onEnded: time => { endedAt = time; } });
    assert.deepEqual(node.starts, [[10, 0]]);
    assert.equal(node.buffer!.length, exported.length);
    for (let channel = 0; channel < 2; channel++) {
      assert.deepEqual(node.buffer!.getChannelData(channel), exported.getChannelData(channel));
      assert.equal(Math.abs(node.buffer!.getChannelData(channel).at(-1)!), 0.5);
      assert.ok(!node.buffer!.getChannelData(channel).includes(Math.fround(0.9)));
    }
    context.currentTime += 20; // No requestAnimationFrame/timeupdate ever runs.
    assert.equal(preview.currentTime(), range.end);
    assert.equal(node.stops, 0); // The buffer itself enforces the cut.
    node.onended!();
    assert.equal(endedAt, range.end);
    preview.stop();
    assert.equal(node.stops, 0);

    const resumed = startAudioRangePreview(context as unknown as AudioContext, buffer, range,
      { currentTime: 0.5, playbackRate: 2, onEnded: () => assert.fail('stopped preview must not finish a newer one') });
    assert.equal(node.starts.at(-1)![1], 0.249);
    context.currentTime += 0.05;
    assert.ok(Math.abs(resumed.currentTime() - 0.6) < 1e-10);
    const staleOnEnded = node.onended!;
    resumed.stop(); staleOnEnded();
    assert.equal(node.stops, 1);
  } finally { globalThis.AudioBuffer = previous; }
});
