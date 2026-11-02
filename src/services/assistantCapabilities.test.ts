import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantTools, type AgentToolContext } from './assistantAgentTools';
import { inspectAssistantTools } from './assistantCapabilities';
import { applyFactoryLoudnessPreset, FACTORY_LOUDNESS_PRESETS } from './audioFactoryPresets';

test('discovery exposes real executors, page routes, restrictions and shared UI presets', async () => {
  const tools = createAssistantTools({ workspace: async () => ({}) } as unknown as AgentToolContext);
  const found = inspectAssistantTools(tools, '响度').capabilities;
  const factory = found.find(tool => tool.tool === 'process_audio')!;
  assert.equal(factory.page, '音频工具');
  assert.equal(factory.tab, 'factory');
  assert.equal(factory.execution, 'native-page');
  assert.equal(factory.presets, FACTORY_LOUDNESS_PRESETS);
  assert.equal(factory.presets!.find(preset => preset.label === '礼物')?.value, -16);
  assert.match(factory.pageConstraints!, /裁剪.*现有处理服务/);
  const discovery = await tools.find(tool => tool.name === 'inspect_tools')!.execute({ query: '视频' }) as any;
  assert.ok(discovery.capabilities.some((item: any) => item.tool === 'video_workspace' && item.execution === 'native-page'));
  assert.ok(inspectAssistantTools(tools).capabilities.every(item => tools.some(tool => tool.name === item.tool)));
  assert.equal(inspectAssistantTools(tools, 'generate_speech').capabilities.find(item => item.tool === 'generate_speech')?.execution, 'service-operation');
});

test('named standards use UI values, explicit LUFS and later replies take precedence', () => {
  assert.equal(applyFactoryLoudnessPreset({ lufs: -23 }, '调整到礼物的响度标准').lufs, -16);
  assert.equal(applyFactoryLoudnessPreset({ loudnessPreset: '礼物' }).lufs, -16);
  assert.equal(applyFactoryLoudnessPreset({}, '使用礼物预设，但响度改为 -18 LUFS').lufs, -18);
  assert.equal(applyFactoryLoudnessPreset({}, '压缩并调整响度到-20\n改成礼物的响度标准').lufs, -16);
  assert.equal(applyFactoryLoudnessPreset({}, '礼物响度标准\n自定义响度为-19').lufs, -19);
  assert.deepEqual(applyFactoryLoudnessPreset({}, '小鸟的响度标准'), {});
  assert.throws(() => applyFactoryLoudnessPreset({ loudnessPreset: '小鸟' }), /不能编造/);
});

test('follow-up preserves compression and resolves UI standard before native page execution', async () => {
  let received: any;
  const context = { taskPrompt: '压缩音频，并把音效响度调到小鸟的响度标准\n调到礼物的响度标准',
    runInWorkspace: async (name: string, args: unknown) => { received = { name, args }; return { fromPage: true }; },
  } as unknown as AgentToolContext;
  const tools = createAssistantTools(context);
  await tools.find(tool => tool.name === 'process_audio')!.execute({ assetId: 'source', name: '压缩结果', format: 'wav', sampleRate: 48000, lufs: -23 });
  assert.equal(received.name, 'process_audio');
  assert.deepEqual(received.args, { assetId: 'source', name: '压缩结果', format: 'mp3', sampleRate: 32000, bitrate: 96, lufs: -16, loudnessPreset: '礼物' });
});
