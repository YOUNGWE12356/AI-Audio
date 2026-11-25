import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import ffmpeg from 'ffmpeg-static';
import { applyFactoryGain, FACTORY_METER_SAMPLE_RATE, measureFactoryLoudness, planFactoryGain } from './audioFactoryLoudness';

function tone(amplitude: number, duration = 1, channels = 1) {
  const sampleRate = FACTORY_METER_SAMPLE_RATE;
  const length = Math.round(duration * sampleRate);
  const data = Array.from({ length: channels }, () => Float32Array.from(
    { length }, (_, index) => amplitude * Math.sin(2 * Math.PI * 1000 * index / sampleRate),
  ));
  return { sampleRate, length, numberOfChannels: channels, getChannelData: (channel: number) => data[channel] } as AudioBuffer;
}

const closeTo = (actual: number | null, expected: number, tolerance = 0.02) => {
  assert.ok(actual !== null && Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};

test('48 kHz integrated readings agree with FFmpeg across mono and stereo', () => {
  for (const channels of [1, 2]) {
    const source = tone(0.25, 2, channels);
    const pcm = Buffer.alloc(source.length * channels * 4);
    for (let channel = 0; channel < channels; channel++) {
      const samples = source.getChannelData(channel);
      for (let index = 0; index < samples.length; index++) pcm.writeFloatLE(samples[index], (index * channels + channel) * 4);
    }
    const output = execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', '48000', '-ac', String(channels),
      '-i', 'pipe:0', '-af', 'ebur128=metadata=1,ametadata=print:key=lavfi.r128.I:file=-', '-f', 'null', '-'], { input: pcm, encoding: 'utf8' });
    const reference = Array.from(output.matchAll(/lavfi\.r128\.I=(-?[\d.]+)/g)).at(-1)?.[1];
    assert.ok(reference);
    closeTo(measureFactoryLoudness(source).lufs, Number(reference), 0.08);
  }
});

test('fixed gain offsets each file while normalization uses that file’s measured level', () => {
  for (const amplitude of [0.1, 0.25]) {
    for (const gainDb of [-6, 6]) {
      const source = tone(amplitude);
      const before = measureFactoryLoudness(source);
      const settings = { mode: 'gain' as const, gainDb, targetLufs: -20, peakCeilingDb: -1 };
      const gain = planFactoryGain(before, settings);
      closeTo(gain.appliedGainDb, gainDb);
      applyFactoryGain(source, gain.appliedGainDb);
      const after = measureFactoryLoudness(source);
      closeTo(after.lufs, before.lufs! + gainDb);
      const normalized = planFactoryGain(after, { ...settings, mode: 'normalize' });
      applyFactoryGain(source, normalized.appliedGainDb);
      closeTo(measureFactoryLoudness(source).lufs, -20);
    }
  }
});

test('peak protection applies clean gain without flattening peaks and handles silence and short sounds', () => {
  const source = tone(0.8, 0.15);
  const before = measureFactoryLoudness(source);
  const settings = { mode: 'gain' as const, gainDb: 12, targetLufs: -20, peakCeilingDb: -1 };
  const gain = planFactoryGain(before, settings);
  assert.ok(gain.appliedGainDb < gain.requestedGainDb);
  applyFactoryGain(source, gain.appliedGainDb);
  closeTo(measureFactoryLoudness(source).peak, 10 ** (-1 / 20));
  const silent = measureFactoryLoudness(tone(0));
  assert.equal(silent.lufs, null);
  assert.equal(planFactoryGain(silent, { ...settings, mode: 'normalize' }).appliedGainDb, 0);
});
