import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAssistantCompressionDefaults } from './assistantCompressionDefaults';
import { getDirectAssistantPlan } from './assistantDirectPlan';
import { createAssistantTools, type AgentToolContext } from './assistantAgentTools';

test('simple compression commands use the requested MP3 32 kHz / 96 kbps preset', () => {
  const source = { id: 'input', name: '音乐.wav', mimeType: 'audio/wav', url: '/uploads/input.wav', size: 10 };
  for (const text of ['压缩文件', '压缩一下文件', '帮我压缩一下音频', '把这个音频压缩一下']) {
    assert.deepEqual(getDirectAssistantPlan(text, [source])?.[0].args,
      { assetId: 'input', name: '音乐_压缩', format: 'mp3', sampleRate: 32000, bitrate: 96 });
  }
  for (const text of ['不要压缩文件', '压缩为48kHz 128kbps', '压缩文件然后改响度到-16', '压缩成zip']) {
    assert.equal(getDirectAssistantPlan(text, [source]), undefined, 'complex instructions must go through the planner');
  }
});

test('compression defaults are enforced for planner guesses while preserving explicit requests', () => {
  const args = { assetId: 'input', format: 'wav', sampleRate: 48000, bitrate: 192, lufs: -16, channels: 'mono' };
  assert.deepEqual(applyAssistantCompressionDefaults(args, '去压缩一下格式然后改一下响度到-16'),
    { ...args, format: 'mp3', sampleRate: 32000, bitrate: 96 });
  assert.deepEqual(applyAssistantCompressionDefaults(args, '压缩成 OGG，48kHz / 128kbps'),
    { ...args, format: 'ogg', sampleRate: 48000, bitrate: 128 });
  assert.deepEqual(applyAssistantCompressionDefaults(args, '压缩音频，采样率44100，比特率128'),
    { ...args, format: 'mp3', sampleRate: 44100, bitrate: 128 });
  assert.equal(applyAssistantCompressionDefaults(args, '不要压缩，只改响度'), args);
  assert.equal(applyAssistantCompressionDefaults(args, '把文件打包成压缩包ZIP'), args);
  assert.equal(applyAssistantCompressionDefaults(args, '转成WAV'), args);
  assert.deepEqual(applyAssistantCompressionDefaults(args, '使用上次参数压缩音频'), args);
});

test('compound compression sends the preset and loudness to the actual native page', async () => {
  let received: any;
  const context = { taskPrompt: '压缩文件并把响度调整到-16', runInWorkspace: async (_name: string, args: unknown) => { received = args; } } as unknown as AgentToolContext;
  await createAssistantTools(context).find(tool => tool.name === 'process_audio')!.execute({ assetId: 'input', name: '压缩结果', sampleRate: 48000, bitrate: 128, lufs: -16 });
  assert.equal(received.sampleRate, 32000);
  assert.equal(received.bitrate, 96);
  assert.equal(received.format, 'mp3');
  assert.equal(received.lufs, -16);
});
