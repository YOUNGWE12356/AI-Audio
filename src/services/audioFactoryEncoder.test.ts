import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { encodeMp3 } from './audioEncoderService';
import { encodeFactoryAudio, validateFactoryAudioOutput } from './audioFactoryEncoder';

function source(sampleRate = 48000, silent = false) {
  const samples = Float32Array.from({ length: sampleRate }, (_, i) => silent ? 0 : 0.25 * Math.sin(2 * Math.PI * 440 * i / sampleRate));
  return { sampleRate, duration: 1, numberOfChannels: 2, length: samples.length, getChannelData: () => samples } as unknown as AudioBuffer;
}

function decode(bytes: Buffer) {
  const pcm = execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '32000', '-f', 'f32le', 'pipe:1'], { input: bytes, windowsHide: true });
  const samples = Float32Array.from({ length: pcm.length / 4 }, (_, i) => pcm.readFloatLE(i * 4));
  return { sampleRate: 32000, length: samples.length, duration: samples.length / 32000, numberOfChannels: 1, getChannelData: () => samples } as unknown as AudioBuffer;
}

async function withLocalCodec(run: () => Promise<void>) {
  const savedWindow = globalThis.window;
  const savedFetch = globalThis.fetch;
  Object.assign(globalThis, { window: { AudioContext: class {
    async decodeAudioData(bytes: ArrayBuffer) { return decode(Buffer.from(bytes)); }
    async close() {}
  } } });
  // Exercise the real FFmpeg codec with the exact WAV and encoding fields sent
  // by the client, without depending on a running application server.
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/audio/convert');
    const form = init!.body as FormData;
    const file = form.get('media') as File;
    assert.equal(file.type, 'audio/wav');
    const format = String(form.get('format'));
    const output = execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-ar', String(form.get('sampleRate')), '-ac', form.get('channelMode') === 'mono' ? '1' : '2',
      '-c:a', format === 'mp3' ? 'libmp3lame' : 'libvorbis', '-b:a', String(form.get('bitrate')), '-f', format, 'pipe:1'],
    { input: Buffer.from(await file.arrayBuffer()), windowsHide: true });
    return new Response(output, { headers: { 'content-type': format === 'mp3' ? 'audio/mpeg' : 'audio/ogg' } });
  };
  try { await run(); } finally { globalThis.fetch = savedFetch; globalThis.window = savedWindow; }
}

test('96 kbps factory output retains audible PCM at 32, 44.1 and 48 kHz', () => withLocalCodec(async () => {
  for (const sampleRate of [32000, 44100, 48000]) {
    const blob = await encodeFactoryAudio(source(sampleRate), '音乐.wav', { format: 'mp3', sampleRate, bitrate: 96, channelMode: 'stereo' });
    assert.equal(blob.type, 'audio/mpeg');
    const buffer = decode(Buffer.from(await blob.arrayBuffer()));
    assert.ok(Math.max(...buffer.getChannelData(0)) > 0.1, `${sampleRate} Hz output must contain sound`);
  }
}));

test('output validation rejects the real silent 96 kbps lamejs regression', () => withLocalCodec(async () => {
  const input = source();
  const broken = encodeMp3(input, 96);
  assert.equal(Math.max(...decode(Buffer.from(await broken.arrayBuffer())).getChannelData(0)), 0);
  await assert.rejects(validateFactoryAudioOutput(input, broken), /意外变成静音/);
}));

test('intentional silence is allowed, and WAV output does not require a server', () => withLocalCodec(async () => {
  globalThis.fetch = async () => { throw new Error('WAV should not call a server'); };
  const blob = await encodeFactoryAudio(source(32000, true), '静音.wav', { format: 'wav', sampleRate: 32000, bitrate: 96, channelMode: 'stereo' });
  assert.equal(blob.type, 'audio/wav');
  assert.ok(blob.size > 44);
}));

test('failed conversion, empty output and cancellation cannot be reported as success', () => withLocalCodec(async () => {
  globalThis.fetch = async () => Response.json({ error: 'FFmpeg 转码失败' }, { status: 422 });
  await assert.rejects(encodeFactoryAudio(source(), '音频.wav', { format: 'mp3', sampleRate: 32000, bitrate: 96, channelMode: 'stereo' }), /FFmpeg 转码失败/);
  await assert.rejects(validateFactoryAudioOutput(source(), new Blob()), /编码结果为空/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(encodeFactoryAudio(source(), '音频.wav', { format: 'mp3', sampleRate: 32000, bitrate: 96, channelMode: 'stereo', signal: controller.signal }), /abort/i);
}));
