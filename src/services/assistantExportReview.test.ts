import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { isExportApproval, requestAssistantExportReview } from './assistantExportReview';
import { createAssistantAgentRouter } from './assistantAgentServer';
import { getAssistantActivity } from './assistantActivity';
import { runAssistantLoop } from './assistantAgentLoop';
import type { AssistantJob } from './assistantAgentTypes';

const readyJob = (): AssistantJob => ({
  id: '44444444-4444-4444-4444-444444444444', prompt: '给视频配音和音乐', status: 'running',
  createdAt: '', updatedAt: '', assets: [], events: [{ id: 'generation', tool: 'video_workspace', status: 'completed', message: '片段已生成' }],
  workspaceCommand: { id: 'generated', workspace: 'video-soundtrack', action: 'generate', status: 'completed', args: {}, message: '片段已生成',
    result: { project: { id: 'project', name: '视频工程', videoFile: { name: 'source.mp4' }, tracks: [{ id: 'dubbing', type: 'dubbing' }],
      clips: [{ id: 'voice', trackId: 'dubbing', audioUrl: '/uploads/voice.mp3' }] } } },
});

test('only an explicit export reply approves export; negatives, conditions and revisions do not', () => {
  for (const reply of ['导出', '确认导出', '可以导出', '没问题，导出', '试听没问题，请导出', '请导出成品吧', 'export']) assert.equal(isExportApproval(reply), true, reply);
  for (const reply of ['不要导出', '先别导出', '导出前降低音乐', '如果没问题就导出', '修改配音后导出', '不导出视频', '没问题', '导出失败了吗']) assert.equal(isExportApproval(reply), false, reply);
});

test('review preserves the project, stops the spinner, and is never reported as a completed delivery', () => {
  const job = readyJob();
  requestAssistantExportReview(job, { name: '成片', includeOriginalAudio: false });
  assert.equal(job.status, 'waiting');
  assert.equal(job.waitingFor, 'export-review');
  assert.deepEqual(job.exportReview, { status: 'pending', args: { name: '成片', includeOriginalAudio: false } });
  assert.match(job.messages!.at(-1)!.content, /试听.*导出/);
  assert.equal(job.workspaceCommand!.action, 'generate');
  assert.equal(getAssistantActivity({ job, sending: false }).busy, false);
  assert.match(getAssistantActivity({ job, sending: false }).label, /等待试听/);
  const unfinished = readyJob();
  unfinished.workspaceCommand!.result!.project.clips[0].voiceDirty = true;
  assert.throws(() => requestAssistantExportReview(unfinished), /未完成/);
});

test('pausing for review skips later exports in the same model turn but retains a valid resume transcript', async () => {
  const input: any[] = [];
  let waiting = false;
  let exports = 0;
  await runAssistantLoop({ input, signal: new AbortController().signal, event: () => {}, isWaiting: () => waiting,
    tools: [{ name: 'review', description: '', parameters: {}, execute: async () => { waiting = true; return { waiting: true }; } },
      { name: 'export', description: '', parameters: {}, execute: async () => { exports++; } }],
    turn: async () => ({ model: 'test', text: '', output: [
      { type: 'function_call', name: 'review', call_id: 'review-call', arguments: '{}' },
      { type: 'function_call', name: 'export', call_id: 'export-call', arguments: '{}' },
    ] }),
  });
  assert.equal(exports, 0);
  assert.deepEqual(input.filter(item => item.type === 'function_call_output').map(item => item.call_id), ['review-call', 'export-call']);
  assert.equal(JSON.parse(input.at(-1).output).skipped, true);
});

test('server enforces preview before export and resumes only export after an approved reply across restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-export-review-'));
  const job = readyJob();
  job.status = 'waiting'; job.question = '继续制作？';
  await writeFile(path.join(dir, `${job.id}.json`), JSON.stringify({ owner: 'test', job }));
  await writeFile(path.join(dir, 'finished.mp4'), 'page-export-result');
  let modelCalls = 0;
  const makeServer = async () => {
    const app = express(); app.use(express.json());
    app.get('/api/usage/quota', (_req, res) => res.json({ blocked: false }));
    app.use(createAssistantAgentRouter({ manifestDir: dir, uploadsDir: dir, ffmpegBinary: 'unused', duration: async () => 5,
      identity: () => 'test', modelTurn: async () => {
        modelCalls++;
        return { model: 'test', text: '', output: [
          { type: 'function_call', name: 'video_workspace', call_id: 'export-call', arguments: JSON.stringify({ action: 'export', name: '成片' }) },
          { type: 'function_call', name: 'finish_task', call_id: 'finish-call', arguments: JSON.stringify({ summary: 'done', assetIds: [] }) },
        ] };
      } }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    return { server, origin: `http://127.0.0.1:${(server.address() as any).port}` };
  };
  let running = await makeServer();
  const post = async (url: string, body: any) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  };
  const poll = async (predicate: (value: AssistantJob) => boolean): Promise<AssistantJob> => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const value = await (await fetch(`${running.origin}/jobs/${job.id}`)).json();
      if (predicate(value)) return value;
    }
    throw new Error('Task did not reach the expected review/export state');
  };
  try {
    await post(`${running.origin}/jobs/${job.id}/reply`, { reply: '继续' });
    const review = await poll(value => value.status === 'waiting');
    assert.equal(review.waitingFor, 'export-review');
    assert.equal(review.workspaceCommand!.action, 'generate');
    assert.equal(modelCalls, 1);
    await new Promise<void>(resolve => running.server.close(() => resolve()));
    running = await makeServer();
    const restored = await (await fetch(`${running.origin}/jobs/${job.id}`)).json();
    assert.equal(restored.exportReview.status, 'pending');
    await post(`${running.origin}/jobs/${job.id}/reply`, { reply: '导出' });
    const exporting = await poll(value => value.workspaceCommand?.action === 'export');
    const command = exporting.workspaceCommand!;
    const endpoint = `${running.origin}/jobs/${job.id}/workspace/${command.id}`;
    const clientId = '55555555-5555-5555-5555-555555555555';
    await post(`${endpoint}/claim`, { clientId });
    await post(`${endpoint}/result`, { clientId, result: { project: review.workspaceCommand!.result!.project,
      files: [{ url: '/uploads/finished.mp4', name: '成片.mp4' }] } });
    const completed = await poll(value => value.status === 'completed' || value.status === 'failed');
    assert.equal(completed.status, 'completed', completed.error);
    assert.equal(completed.answer, '已完成');
    assert.ok(completed.assets.some(asset => asset.name === '成片.mp4' && asset.size > 0));
    assert.equal(modelCalls, 1, 'export approval must not trigger planning or generation again');
    assert.equal(completed.messages!.filter(message => message.role === 'user').at(-1)!.content, '导出');
  } finally {
    await new Promise<void>(resolve => running.server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
