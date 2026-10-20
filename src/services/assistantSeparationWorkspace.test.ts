import test from 'node:test';
import assert from 'node:assert/strict';
import { runSeparationWorkspace } from './assistantSeparationWorkspace';
import { isDirectStemSeparationRequest } from './assistantSeparationIntent';
import type { AssistantWorkspaceCommand } from './assistantAgentTypes';

const id = 'a1111111-1111-4111-8111-111111111111';
const command: AssistantWorkspaceCommand = { id, workspace: 'audio-tools', action: 'separate', status: 'pending', message: '',
  args: { mode: 'stems', source: { id: 'source', name: '测试音乐.wav', url: '/uploads/source.wav', mimeType: 'audio/wav', size: 8 } } };
function fixture(request: typeof fetch) {
  const values = new Map<string, string>();
  const progress: string[] = [];
  const files: File[] = [];
  const jobs: any[] = [];
  const controller = new AbortController();
  return { values, progress, files, jobs, controller, options: { command, signal: controller.signal, request,
    storage: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } },
    onFile: (file: File) => { files.push(file); }, onJob: (job: any) => { jobs.push(job); }, onEngine: () => {},
    onProgress: (message: string) => { progress.push(message); }, wait: async () => {} } };
}
const response = (body: any, status = 200) => Response.json(body, { status });

test('only standalone separation commands bypass planning', () => {
  for (const text of ['拆分轨', '拆分分轨', '请帮我把上传的音频拆分轨吧', '歌曲分轨']) assert.equal(isDirectStemSeparationRequest(text), true);
  for (const text of ['不要拆分轨', '为什么不能拆分轨', '先拆分轨再混音', '分析分轨功能']) assert.equal(isDirectStemSeparationRequest(text), false);
});

test('the page imports the actual file, submits once, shows progress and reattaches to the same job', async () => {
  let posts = 0;
  let polls = 0;
  const f = fixture(async (url, init) => {
    if (url === '/uploads/source.wav') return new Response('waveform');
    if (String(url).includes('/engine')) return response({ ready: true });
    if (init?.method === 'POST') {
      posts++;
      const form = init.body as FormData;
      assert.equal((form.get('media') as File).name, '测试音乐.wav');
      assert.equal(form.get('mode'), 'stems');
      assert.equal(form.get('assistantOperationId'), id);
      return response({ id, status: 'queued', stems: [] });
    }
    return response({ id, stage: polls++ ? 'completed' : 'separating', status: polls > 1 ? 'completed' : 'separating', progress: polls > 1 ? 100 : 50,
      message: polls > 1 ? '分轨完成' : '模型推理中', stems: polls > 1 ? [{ name: '人声', audioUrl: '/uploads/vocals.wav' }] : [] });
  });
  const result = await runSeparationWorkspace(f.options);
  assert.equal(await f.files[0].text(), 'waveform');
  assert.deepEqual(result.files, [{ url: '/uploads/vocals.wav', name: '测试音乐_人声.wav' }]);
  assert.ok(f.progress.some(message => message.includes('50%')));
  await runSeparationWorkspace(f.options);
  assert.equal(posts, 1, 'restoring a page must not create another job');
});

test('probe failures are rechecked and upload failures preserve their stage', async () => {
  let probes = 0;
  const f = fixture(async (url, init) => {
    if (url === '/uploads/source.wav') return new Response('waveform');
    if (String(url).includes('/engine')) return response(++probes === 1 ? { ready: false, error: '检测超时' } : { ready: true });
    assert.equal(init?.method, 'POST');
    return response({ error: '上传目录不可写' }, 500);
  });
  await assert.rejects(runSeparationWorkspace(f.options), /上传并创建分轨任务失败：上传目录不可写/);
  assert.equal(probes, 2);
});

test('runtime failures report the real stage without returning success files', async () => {
  const f = fixture(async url => url === '/uploads/source.wav' ? new Response('waveform')
    : response({ id, status: 'failed', stage: 'separating', error: 'CUDA out of memory', progress: 40, stems: [] }));
  f.values.set(`assistant-separation:${id}`, id);
  await assert.rejects(runSeparationWorkspace(f.options), /模型推理失败：CUDA out of memory/);
  assert.equal(f.jobs.at(-1).status, 'failed');
});

test('stopping the assistant cancels the actual separation job', async () => {
  let cancelled = false;
  const f = fixture(async (url, init) => {
    if (init?.method === 'DELETE') { cancelled = true; return response({ status: 'cancelled' }); }
    if (url === '/uploads/source.wav') return new Response('waveform');
    return response({ id, status: 'separating', stage: 'separating', progress: 10, stems: [] });
  });
  f.values.set(`assistant-separation:${id}`, id);
  f.options.wait = async () => { f.controller.abort(); };
  await assert.rejects(runSeparationWorkspace(f.options), /助手已停止/);
  assert.equal(cancelled, true);
});

test('preprocessing errors keep the underlying cause without repeating the stage', async () => {
  const f = fixture(async url => url === '/uploads/source.wav' ? new Response('invalid audio')
    : response({ id, status: 'failed', stage: 'preparing', error: '音频预处理失败：Invalid data found when processing input', stems: [] }));
  f.values.set(`assistant-separation:${id}`, id);
  await assert.rejects(runSeparationWorkspace(f.options), { message: '音频预处理失败：Invalid data found when processing input' });
});
