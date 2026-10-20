import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { createAssistantAgentRouter } from './assistantAgentServer';
import { registerNativeAssistantTool, runAssistantToolOperation } from './assistantToolWorkspace';
import { getDirectAssistantPlan } from './assistantDirectPlan';
import { NATIVE_ASSISTANT_TOOLS, ASSISTANT_TOOL_PAGES, canUseNativeAssistantTool } from './assistantToolCatalog';
import { createAssistantTools, type AgentToolContext } from './assistantAgentTools';
import { runAssistantLoop } from './assistantAgentLoop';

const clientId = '11111111-1111-4111-8111-111111111111';
const memory = new Map<string, string>();
Object.assign(globalThis, { window: new EventTarget(), sessionStorage: {
  getItem: (key: string) => memory.get(key) || null,
  setItem: (key: string, value: string) => memory.set(key, value),
} });

test('direct commands recognize speed/key analysis without discarding constraints', () => {
  const source = { id: 'input', name: '参考.wav', mimeType: 'audio/wav', url: '/uploads/input.wav', size: 10 };
  for (const text of ['分析测速', '测速', '测速测调', '分析 BPM 和调性']) assert.equal(getDirectAssistantPlan(text, [source])?.[0].tool, 'analyze_music_metrics');
  assert.deepEqual(getDirectAssistantPlan('转成 MP3，并测量响度', [source])?.map(step => step.tool), ['process_audio', 'measure_audio']);
  assert.deepEqual(getDirectAssistantPlan('转成MP3然后测速测调', [source])?.map(step => step.tool), ['process_audio', 'analyze_music_metrics']);
  for (const text of ['不要测速', '测速并转为mp3', '为什么转成mp3', '转成mp3并降低3dB']) assert.equal(getDirectAssistantPlan(text, [source]), undefined);
  assert.equal(getDirectAssistantPlan('测速', [source, source]), undefined);
});

test('only actual native adapters are wrapped; other tools retain their implementation', async () => {
  const pages: string[] = [];
  const c = { signal: new AbortController().signal,
    runInWorkspace: async (name: string) => { pages.push(name); return { fromPage: true }; },
  } as unknown as AgentToolContext;
  const tools = createAssistantTools(c);
  for (const name of NATIVE_ASSISTANT_TOOLS) {
    assert.ok(ASSISTANT_TOOL_PAGES[name]);
    assert.deepEqual(await tools.find(tool => tool.name === name)!.execute(name === 'generate_music' ? { duration: 30 } : {}), { fromPage: true });
  }
  assert.equal(pages.length, NATIVE_ASSISTANT_TOOLS.size);
  assert.equal(canUseNativeAssistantTool('process_audio', { format: 'mp3', speed: 1.5 }), false);
  assert.equal(canUseNativeAssistantTool('process_audio', { format: 'flac' }), false);
  assert.equal(canUseNativeAssistantTool('generate_music', { duration: 120 }), false);
});

test('dispatcher imports the real File and waits for native handler registration without calling an execute API', async () => {
  const command: any = { id: 'native-import', action: 'run_tool', workspace: 'audio-tools', args: {
    tool: 'analyze_music_metrics', title: '测速测调', sources: [{ url: '/uploads/real.wav', name: '真实音频.wav', mimeType: 'audio/wav' }],
  } };
  let invoked = 0; let remove = () => {}; let waits = 0;
  try {
    const result = await runAssistantToolOperation({ command, signal: new AbortController().signal, progress: () => {},
      request: async (url, init) => { assert.equal(url, '/uploads/real.wav'); assert.equal(init?.method, undefined); return new Response('real-bytes'); },
      wait: async () => {
        waits++;
        remove = registerNativeAssistantTool('analyze_music_metrics', async ({ files }) => {
          invoked++; assert.equal(files[0].name, '真实音频.wav'); assert.equal(await files[0].text(), 'real-bytes');
          return { bpm: { value: 123, confidence: '低' } };
        });
      },
    });
    assert.equal(result.bpm.value, 123); assert.equal(invoked, 1); assert.equal(waits, 1);
    await assert.rejects(runAssistantToolOperation({ command, signal: new AbortController().signal, progress: () => {}, request: async () => new Response('real-bytes') }), /避免重复处理或扣费/);
    assert.equal(invoked, 1);
  } finally { remove(); }
});

test('native failure is reported with stage and cancellation prevents action', async () => {
  const command: any = { id: 'native-error', action: 'run_tool', workspace: 'audio-tools', args: { tool: 'analyze_music_metrics', title: '测速测调', sources: [] } };
  let invoked = 0;
  const remove = registerNativeAssistantTool('analyze_music_metrics', async () => { invoked++; throw new Error('音频解码失败'); });
  try {
    await assert.rejects(runAssistantToolOperation({ command, signal: new AbortController().signal, progress: () => {} }), /测速测调 · 执行页面操作失败：音频解码失败/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(runAssistantToolOperation({ command: { ...command, id: 'cancelled' }, signal: controller.signal, progress: () => {} }), /任务已停止/);
    assert.equal(invoked, 1);
  } finally { remove(); }
});

test('a failed tool skips dependent calls and finish in the same model turn', async () => {
  const input: any[] = []; let turn = 0; let subsequent = 0;
  const result = await runAssistantLoop({ input, signal: new AbortController().signal, event: () => {}, isWaiting: () => false,
    tools: [{ name: 'first', description: '', parameters: {}, execute: async () => { throw new Error('真实处理失败'); } },
      { name: 'next', description: '', parameters: {}, execute: async () => { subsequent++; } }],
    turn: async () => turn++ ? { output: [], text: '停止', model: 'test' } : { output: [
      { type: 'function_call', call_id: '1', name: 'first', arguments: '{}' },
      { type: 'function_call', call_id: '2', name: 'next', arguments: '{}' },
    ], text: '', model: 'test' },
  });
  assert.equal(result.failures, 1); assert.equal(subsequent, 0); assert.equal(JSON.parse(input.at(-1).output).skipped, true);
});

test('native output upload requires ownership and a claim, and next step receives its verified asset', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-native-'));
  const app = express(); app.use(express.json()); app.use('/uploads', express.static(dir));
  let turns = 0; let backendExecutions = 0;
  app.get('/api/usage/quota', (_req, res) => res.json({ blocked: false }));
  app.post('/api/ai/elevenlabs/sound-effect', (_req, res) => { backendExecutions++; res.json({}); });
  app.use('/api/ai/assistant', createAssistantAgentRouter({ uploadsDir: dir, manifestDir: dir, ffmpegBinary: ffmpeg!,
    duration: async () => 1, identity: req => req.get('x-test-owner') || 'test',
    modelTurn: async ({ input }) => {
      turns++;
      const call = (name: string, args: any) => ({ model: 'test', text: '', output: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: String(turns) }] });
      if (turns === 1) return call('generate_sound_effect', { prompt: '奖励音效', name: '奖励' });
      const previous = JSON.parse(input.at(-1).output);
      if (turns === 2) return call('analyze_music_metrics', { assetId: previous.assets[0].id });
      return call('finish_task', { summary: '完成', assetIds: [] });
    },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (url: string, init?: RequestInit) => fetch(`${origin}/api/ai/assistant${url}`, init);
  const post = (url: string, body: any) => request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const poll = async (id: string, check: (job: any) => boolean) => {
    for (let n = 0; n < 200; n++) {
      const job = await (await request(`/jobs/${id}`)).json();
      if (check(job)) return job;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('任务没有进入预期步骤');
  };
  try {
    const form = new FormData(); form.append('prompt', '制作奖励音效然后测速测调');
    const created = await (await request('/jobs', { method: 'POST', body: form })).json();
    let job = await poll(created.id, value => Boolean(value.workspaceCommand));
    const command = job.workspaceCommand;
    const base = `/jobs/${job.id}/workspace/${command.id}`;
    assert.equal(command.workspace, 'sfx-studio');
    const upload = (owner = 'test', client = clientId) => {
      const data = new FormData(); data.append('file', new Blob(['native-result'], { type: 'audio/wav' }), '奖励_A.wav');
      data.append('name', '奖励_A.wav');
      return request(`/workspace/${command.id}/output`, { method: 'POST', headers: { 'x-test-owner': owner, 'x-assistant-workspace-client': client }, body: data });
    };
    assert.equal((await upload()).status, 409);
    assert.equal((await post(`${base}/claim`, { clientId })).status, 200);
    assert.equal((await upload('outsider')).status, 409);
    assert.equal((await upload('test', 'other-client')).status, 409);
    assert.equal((await post(`${base}/execute`, { clientId })).status, 404, 'there is no backend tool execution proxy');
    const output = await (await upload()).json();
    assert.equal(output.asset.name, '奖励_A.wav');
    assert.equal(await readFile(path.join(dir, path.basename(output.asset.url)), 'utf8'), 'native-result');
    await post(`${base}/result`, { clientId, result: { assets: [{ id: output.asset.id, name: 'forged' }] } });
    job = await poll(job.id, value => value.workspaceCommand?.id !== command.id);
    assert.equal(job.workspaceCommand.workspace, 'audio-tools');
    assert.equal(job.workspaceCommand.args.sources[0].id, output.asset.id);
    assert.equal(job.workspaceCommand.args.sources[0].name, '奖励_A.wav');
    const nextBase = `/jobs/${job.id}/workspace/${job.workspaceCommand.id}`;
    await post(`${nextBase}/claim`, { clientId });
    await post(`${nextBase}/result`, { clientId, result: { bpm: { value: 120, confidence: '低' } } });
    job = await poll(job.id, value => value.status !== 'running');
    assert.equal(job.status, 'completed', job.error); assert.equal(backendExecutions, 0);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
