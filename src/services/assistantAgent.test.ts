import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import JSZip from 'jszip';
import { runAssistantLoop, type AgentTool } from './assistantAgentLoop';
import { createAssistantTools, type AgentToolContext } from './assistantAgentTools';
import { createAssistantAgentRouter, resolveAssistantUpload } from './assistantAgentServer';
import { readAssistantDocument } from './assistantDocument';
import { detectMediaAudioStream } from './mediaStreamProbe';
import type { AssistantAsset } from './assistantAgentTypes';
import express from 'express';
import { createAssistantWorkspaceOperationCache } from './assistantWorkspaceOperations';
import { getAssistantMessages } from './assistantMessages';
import type { AssistantJob } from './assistantAgentTypes';

test('a direct separation command opens the real workspace and delivers its results without model planning', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-separation-'));
  await writeFile(path.join(dir, 'vocals.wav'), 'actual-output');
  const app = express();
  app.use(express.json());
  app.use('/uploads', express.static(dir));
  app.use('/api/ai/assistant', createAssistantAgentRouter({ manifestDir: dir, uploadsDir: dir, ffmpegBinary: ffmpeg!, duration: async () => 1,
    identity: () => 'test', modelTurn: async () => { throw new Error('direct command must not call the model'); } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}/api/ai/assistant`;
  const readJob = async (id: string) => (await fetch(`${origin}/jobs/${id}`)).json();
  try {
    for (const failure of [false, true]) {
      const form = new FormData(); form.append('prompt', '拆分轨'); form.append('files', new Blob(['audio'], { type: 'audio/wav' }), 'source.wav');
      let job = await (await fetch(`${origin}/jobs`, { method: 'POST', body: form })).json();
      for (let i = 0; !job.workspaceCommand && i < 30; i++) job = await readJob(job.id);
      assert.equal(job.workspaceCommand?.workspace, 'audio-tools');
      assert.equal(job.workspaceCommand.action, 'separate');
      assert.equal(job.workspaceCommand.args.source.name, 'source.wav');
      const endpoint = `${origin}/jobs/${job.id}/workspace/${job.workspaceCommand.id}`;
      const headers = { 'content-type': 'application/json' };
      const clientId = '11111111-1111-4111-8111-111111111111';
      const claim = await fetch(`${endpoint}/claim`, { method: 'POST', headers, body: JSON.stringify({ clientId }) });
      assert.equal(claim.status, 200, JSON.stringify({ response: await claim.json(), job: await readJob(job.id) }));
      await fetch(`${endpoint}/result`, { method: 'POST', headers, body: JSON.stringify({ clientId,
        ...(failure ? { error: '模型推理失败：显存不足' } : { result: { files: [{ url: '/uploads/vocals.wav', name: 'source_人声.wav' }] } }) }) });
      for (let i = 0; job.status === 'running' && i < 60; i++) job = await readJob(job.id);
      assert.equal(job.status, failure ? 'failed' : 'completed');
      assert.equal(job.events.some((event: any) => event.tool === 'engine_status'), false);
      assert.equal(job.waitingFor, undefined, 'separation does not require video export review');
      if (failure) assert.match(job.error, /显存不足/);
      else assert.ok(job.deliverableIds.length > 0);
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});

test('chat retains user instructions and follow-up replies after completion and legacy restore', () => {
  const job: AssistantJob = { id: 'chat', prompt: '给视频配乐\n保留原声', status: 'waiting',
    question: '使用哪种风格？', createdAt: '', updatedAt: '', assets: [], events: [] };
  const initial = getAssistantMessages(job);
  assert.deepEqual(initial.map(message => message.content), ['给视频配乐\n保留原声', '使用哪种风格？']);
  job.messages = [...initial, { id: 'reply', role: 'user', content: '轻柔梦幻风格' }];
  job.status = 'completed';
  job.question = undefined;
  job.answer = 'Verbose generation details';
  const restored = JSON.parse(JSON.stringify(job));
  const messages = getAssistantMessages(restored);
  assert.deepEqual(messages.map(message => message.content), ['给视频配乐\n保留原声', '使用哪种风格？', '轻柔梦幻风格', '已完成']);
  restored.messages = messages;
  assert.deepEqual(getAssistantMessages(restored), messages);
  assert.equal(new Set(messages.map(message => message.id)).size, messages.length);
  assert.deepEqual(getAssistantMessages({ ...job, messages: undefined }).map(message => message.content), ['给视频配乐\n保留原声', '已完成']);
});

test('a pending generation must finish before the next tool receives its real output', async () => {
  const input: any[] = [{ role: 'user', content: 'generate then convert' }];
  const events: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let turn = 0;
  const tools: AgentTool[] = [
    { name: 'generate', description: '', parameters: {}, execute: async () => { events.push('started'); await pending; events.push('generated'); return { assetId: 'real-output' }; } },
    { name: 'convert', description: '', parameters: {}, execute: async args => { assert.equal(args.assetId, 'real-output'); events.push('converted'); return { ok: true }; } },
  ];
  const run = runAssistantLoop({ input, tools, signal: new AbortController().signal, event: () => {}, isWaiting: () => false,
    turn: async () => {
      turn++;
      if (turn === 1) return { model: 'test', text: '', output: [{ type: 'reasoning', encrypted_content: 'keep-me' }, { type: 'function_call', call_id: 'one', name: 'generate', arguments: '{}' }] };
      if (turn === 2) {
        assert.equal(events.join(','), 'started,generated');
        assert.equal(input[1].encrypted_content, 'keep-me');
        const result = JSON.parse(input[3].output);
        return { model: 'test', text: '', output: [{ type: 'function_call', call_id: 'two', name: 'convert', arguments: JSON.stringify(result) }] };
      }
      return { model: 'test', text: 'done', output: [] };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['started']);
  assert.equal(turn, 1);
  release(); await run;
  assert.deepEqual(events, ['started', 'generated', 'converted']);
});

test('cancellation during generation prevents every dependent step', async () => {
  const controller = new AbortController();
  let converted = false;
  await assert.rejects(runAssistantLoop({ input: [], signal: controller.signal, event: () => {}, isWaiting: () => false,
    tools: [{ name: 'generate', description: '', parameters: {}, execute: async () => { controller.abort(); return {}; } },
      { name: 'convert', description: '', parameters: {}, execute: async () => { converted = true; } }],
    turn: async () => ({ model: 'test', text: '', output: [{ type: 'function_call', name: 'generate', call_id: 'one', arguments: '{}' }, { type: 'function_call', name: 'convert', call_id: 'two', arguments: '{}' }] }),
  }), /abort/i);
  assert.equal(converted, false);
});

test('tool failures are returned to the model as failures, never fabricated artifacts', async () => {
  let calls = 0;
  const result = await runAssistantLoop({ input: [], signal: new AbortController().signal, event: () => {}, isWaiting: () => false,
    tools: [{ name: 'generate', description: '', parameters: {}, execute: async () => { throw new Error('provider unavailable'); } }],
    turn: async input => {
      if (!calls++) return { model: 'test', text: '', output: [{ type: 'function_call', name: 'generate', call_id: 'one', arguments: '{}' }] };
      assert.deepEqual(JSON.parse(input.at(-1)!.output), { error: 'provider unavailable', completed: false });
      return { model: 'test', text: 'blocked', output: [] };
    },
  });
  assert.equal(result.failures, 1);
});

test('actual FFmpeg conversion, exact timed clip propagation, and unicode ZIP filenames', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-audio-agent-'));
  try {
    const assets: AssistantAsset[] = [];
    let mixed: any;
    const register = async (url: string, name: string, generated = true) => {
      const data = await readFile(path.join(dir, path.basename(url)));
      const item = { id: `asset-${assets.length}`, url, name, mimeType: 'audio/wav', size: data.length, duration: 1, generated };
      assets.push(item); return item;
    };
    const save = async (data: Buffer, name: string) => {
      const url = `/uploads/${assets.length}-${name}`;
      await writeFile(path.join(dir, path.basename(url)), data);
      return register(url, name);
    };
    const context: AgentToolContext = { assets, signal: new AbortController().signal,
      asset: id => { const item = assets.find(a => a.id === id); assert.ok(item); return item; },
      filePath: a => path.join(dir, path.basename(a.url)), register, save,
      ffmpeg: async args => { const result = await promisify(execFile)(ffmpeg!, args); return result.stderr; },
      request: async (_endpoint, body) => { mixed = body; return { videoUrl: '/uploads/source.mp4' }; },
      wait: async () => {}, ask: () => {}, finish: () => {}, navigate: () => {},
    };
    await promisify(execFile)(ffmpeg!, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', path.join(dir, '台词_09.wav')]);
    const speech = await register('/uploads/台词_09.wav', '台词_09.wav');
    const tools = createAssistantTools(context);
    const requests: any[] = [];
    const priorRequest = context.request;
    context.request = async (endpoint, body) => { requests.push({ endpoint, body }); return { analysis: { analysisBasis: 'metrics' } }; };
    await tools.find(t => t.name === 'audio_design')!.execute({ assetIds: [speech.id], requirements: '参考音频设计配乐' });
    assert.equal(requests[0].body.files[0].audioMetrics.method, 'local-signal-estimation');
    assert.equal(requests[0].body.files[0].data, undefined);
    const semantic = await tools.find(t => t.name === 'semantic_audio_analysis')!.execute({ assetId: speech.id }) as any;
    assert.equal(requests[1].endpoint, '/api/ai/audio-analysis/metrics');
    assert.ok(requests[1].body.metadata.audioProfile);
    assert.equal(semantic.analyzedSeconds, 1);
    context.request = priorRequest;
    const processed = await tools.find(t => t.name === 'process_audio')!.execute({ assetId: speech.id, name: '台词_09_单声道', channels: 'mono', format: 'wav', sampleRate: 24000 }) as any;
    const wav = await readFile(context.filePath(processed.asset));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(await detectMediaAudioStream(ffmpeg!, context.filePath(speech)), true);
    await writeFile(path.join(dir, 'source.mp4'), Buffer.from('fixture'));
    const video = await register('/uploads/source.mp4', 'source.mp4'); video.duration = 10;
    await tools.find(t => t.name === 'mix_timeline')!.execute({ videoAssetId: video.id, name: '视频结果', clips: [{ assetId: processed.asset.id, trackType: 'dubbing', startTime: 5 }] });
    assert.equal(mixed.clips[0].startTime, 5);
    assert.equal(mixed.clips[0].duration, 1);
    assert.equal(mixed.includeOriginalAudio, true);
    const zipResult = await tools.find(t => t.name === 'package_files')!.execute({ assetIds: [processed.asset.id], name: '打包' }) as any;
    const zip = await JSZip.loadAsync(await readFile(context.filePath(zipResult.asset)));
    assert.ok(zip.file('台词_09_单声道.wav'));
    await assert.rejects(tools.find(t => t.name === 'mix_timeline')!.execute({ videoAssetId: video.id, name: '不允许截断', clips: [{ assetId: speech.id, startTime: 9.5 }] }), /超出视频/);
    await assert.rejects(tools.find(t => t.name === 'mix_timeline')!.execute({ videoAssetId: video.id, name: '不允许截台词', clips: [{ assetId: speech.id, trackType: 'dubbing', startTime: 5, duration: .2 }] }), /不能静默截掉/);
    assert.throws(() => resolveAssistantUpload(dir, '/uploads/../../secret'), /路径/);
    assert.throws(() => resolveAssistantUpload(dir, 'https://external.example/audio.wav'), /范围/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('uploaded document numbering survives extraction', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document><w:p><w:r><w:t>009. 你好</w:t></w:r></w:p><w:p><w:r><w:t>010. 再见 &amp; 谢谢</w:t></w:r></w:p></w:document>');
  assert.equal(await readAssistantDocument(await zip.generateAsync({ type: 'nodebuffer' }), '台词.docx'), '009. 你好\n010. 再见 & 谢谢');
});

test('video jobs dispatch to the actual workspace and wait for its acknowledgement', async () => {
  const assets: AssistantAsset[] = [{ id: 'video', name: 'video.mp4', url: '/uploads/video.mp4', mimeType: 'video/mp4', size: 10, duration: 10 },
    { id: 'speech', name: 'hello.wav', url: '/uploads/hello.wav', mimeType: 'audio/wav', size: 10, duration: 2 }];
  const commands: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const context: AgentToolContext = {
    assets, signal: new AbortController().signal, asset: id => assets.find(a => a.id === id)!, filePath: a => a.url,
    request: async () => { throw new Error('must not bypass the visible workspace'); },
    ffmpeg: async () => '', wait: async () => {}, ask: () => {}, finish: () => {}, navigate: () => {},
    register: async (url, name) => ({ id: 'output', url, name, mimeType: 'video/mp4', size: 10 }),
    save: async (_data, name) => ({ id: 'project', url: '/uploads/project.json', name, mimeType: 'application/json', size: 10 }),
    workspace: async (action, args) => {
      commands.push(action);
      if (action === 'load') assert.equal(args.video.id, 'video');
      if (action === 'edit_clips') { assert.equal(args.clips[0].asset.id, 'speech'); assert.equal(args.clips[0].startTime, 5); }
      if (action === 'export') { await pending; return { files: [{ url: '/uploads/done.mp4', name: 'done.mp4' }], project: { name: 'done' } }; }
      return {};
    },
  };
  const tools = createAssistantTools(context);
  let finished = false;
  const execution = tools.find(tool => tool.name === 'mix_timeline')!.execute({ videoAssetId: 'video', name: 'done', clips: [{ assetId: 'speech', trackType: 'dubbing', startTime: 5 }] }).then(result => { finished = true; return result as any; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(commands, ['load', 'edit_clips', 'export']);
  assert.equal(finished, false);
  release();
  const result = await execution;
  assert.equal(result.assets[0].url, '/uploads/done.mp4');
  assert.equal(result.projectAsset.id, 'project');
});

test('refreshing a workspace reattaches to generation without a duplicate paid request', async () => {
  const app = express();
  app.use(express.json());
  app.use(createAssistantWorkspaceOperationCache(req => String(req.header('x-test-user') || 'one')));
  let generations = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  app.post('/api/video/generate-clip', async (_req, res) => { generations++; await pending; res.json({ audioUrl: '/uploads/real.wav' }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const port = (server.address() as any).port;
    const url = `http://127.0.0.1:${port}/api/video/generate-clip`;
    const headers = { 'content-type': 'application/json', 'x-assistant-workspace-operation': '12345678-1234-1234-1234-123456789abc:clip_1' };
    const first = fetch(url, { method: 'POST', headers, body: JSON.stringify({ text: 'hello' }) });
    const reconnected = fetch(url, { method: 'POST', headers, body: JSON.stringify({ text: 'hello' }) });
    const changed = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ text: 'different' }) });
    assert.equal(changed.status, 409);
    assert.equal(generations, 1);
    release();
    assert.deepEqual(await (await first).json(), { audioUrl: '/uploads/real.wav' });
    assert.deepEqual(await (await reconnected).json(), { audioUrl: '/uploads/real.wav' });
    const cached = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ text: 'hello' }) });
    assert.equal(cached.status, 200);
    assert.equal(generations, 1);
    await fetch(url, { method: 'POST', headers: { ...headers, 'x-test-user': 'two' }, body: JSON.stringify({ text: 'hello' }) });
    assert.equal(generations, 2);
  } finally { release(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('server restart preserves a paused decision, while interrupted running work is explicitly failed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-restart-'));
  const waitingId = '11111111-1111-1111-1111-111111111111';
  const runningId = '22222222-2222-2222-2222-222222222222';
  for (const [id, status] of [[waitingId, 'waiting'], [runningId, 'running']]) {
    await writeFile(path.join(dir, `${id}.json`), JSON.stringify({ owner: 'test', job: { id, status, prompt: 'make video', question: '供应商拦截，请选择替代方案', assets: [], events: [] } }));
  }
  const app = express();
  app.use(express.json());
  app.use(createAssistantAgentRouter({ manifestDir: dir, uploadsDir: dir, ffmpegBinary: ffmpeg!, duration: async () => 1, identity: () => 'test' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const waiting = await (await fetch(`${origin}/jobs/${waitingId}`)).json();
    assert.equal(waiting.status, 'waiting');
    assert.match(waiting.question, /供应商拦截/);
    const interrupted = await (await fetch(`${origin}/jobs/${runningId}`)).json();
    assert.equal(interrupted.status, 'failed');
    assert.match(interrupted.error, /服务重启/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});

test('reply and continuation endpoints persist chat history without invoking a model', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-chat-'));
  const id = '33333333-3333-3333-3333-333333333333';
  await writeFile(path.join(dir, `${id}.json`), JSON.stringify({ owner: 'test', job: {
    id, status: 'waiting', prompt: '给视频配乐', question: '需要什么风格？', assets: [], events: [],
  } }));
  const app = express();
  app.use(express.json());
  // Stop execution before any external model request: only exercise message storage.
  app.get('/api/usage/quota', (_req, res) => res.json({ blocked: true }));
  app.use(createAssistantAgentRouter({ manifestDir: dir, uploadsDir: dir, ffmpegBinary: ffmpeg!, duration: async () => 1, identity: () => 'test' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const response = await fetch(`${origin}/jobs/${id}/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reply: '轻柔梦幻' }) });
    assert.equal(response.status, 202);
    const replied = await response.json();
    assert.deepEqual(replied.messages.map((m: any) => m.content), ['给视频配乐', '需要什么风格？', '轻柔梦幻']);
    const waitForStop = async (jobId: string) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const job = await (await fetch(`${origin}/jobs/${jobId}`)).json();
        if (job.status !== 'running') return;
      }
      assert.fail('Test execution did not stop at the local quota guard');
    };
    await waitForStop(id);
    const saved = JSON.parse(await readFile(path.join(dir, `${id}.json`), 'utf8'));
    assert.deepEqual(saved.job.messages, replied.messages);
    const form = new FormData();
    form.append('prompt', '再增加风铃');
    form.append('previousJobId', id);
    const continued = await (await fetch(`${origin}/jobs`, { method: 'POST', body: form })).json();
    assert.deepEqual(continued.messages.map((m: any) => m.content), ['给视频配乐', '需要什么风格？', '轻柔梦幻', '再增加风铃']);
    assert.equal(continued.messages.at(-1).role, 'user');
    await waitForStop(continued.id);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
