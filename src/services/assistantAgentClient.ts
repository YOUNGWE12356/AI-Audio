import type { AssistantJob } from './assistantAgentTypes';
import { runAssistantWorkspace, stopAssistantWorkspace } from './assistantWorkspaceClient';

type State = { job?: AssistantJob; files: File[]; prompt: string; sending: boolean; restoring?: boolean; error?: string };
let state: State = { files: [], prompt: '', sending: false };
const listeners = new Set<() => void>();
let polling = false;
let initialized = false;
let conversationVersion = 0;
const LAST_JOB = 'ai_audio_assistant_job_v2';
export const readAssistantExecution = () => state;
export const subscribeAssistantExecution = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const updateAssistantExecution = (update: Partial<State>) => {
  state = { ...state, ...update };
  listeners.forEach(listener => listener());
};
const parseResponse = async (response: Response): Promise<AssistantJob> => {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `请求失败 (${response.status})`);
  return result;
};
const cancelDetachedJob = async (job: AssistantJob) => {
  if (job.status !== 'running' && job.status !== 'waiting') return;
  try {
    await fetch(`/api/ai/assistant/jobs/${job.id}/cancel`, { method: 'POST', signal: AbortSignal.timeout(15000) });
  } catch { /* The detached conversation must never overwrite the new one. */ }
};
const poll = async () => {
  if (polling) return;
  polling = true;
  try {
    while (state.job?.status === 'running') {
      const id = state.job.id;
      const version = conversationVersion;
      try {
        const response = await fetch(`/api/ai/assistant/jobs/${id}`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
        if (version !== conversationVersion || state.job?.id !== id) continue;
        if (response.status === 403 || response.status === 404) {
          stopAssistantWorkspace();
          if (state.job?.id === id) updateAssistantExecution({ job: { ...state.job, status: 'failed', error: '当前任务已无法访问，自动制作已停止。请重新连接原来的网址或重新发起任务。' }, error: undefined });
          break;
        }
        const job = await parseResponse(response);
        if (version !== conversationVersion || state.job?.id !== id) continue;
        updateAssistantExecution({ job, error: undefined });
        if (job.status === 'running' && job.workspaceCommand) void runAssistantWorkspace(job.id, job.workspaceCommand);
        else if (job.status !== 'running') stopAssistantWorkspace();
      } catch (error) {
        if (version !== conversationVersion || state.job?.id !== id) continue;
        updateAssistantExecution({ error: `连接暂时中断，正在自动重连。${error instanceof Error ? error.message : ''}` });
      }
      if (state.job?.status !== 'running') break;
      await new Promise(resolve => window.setTimeout(resolve, 1800));
    }
  } finally { polling = false; }
};
export const restoreAssistantExecution = async () => {
  if (initialized) return;
  initialized = true;
  const id = localStorage.getItem(LAST_JOB);
  const version = conversationVersion;
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return;
  updateAssistantExecution({ restoring: true });
  try {
    const response = await fetch(`/api/ai/assistant/jobs/${id}`, { signal: AbortSignal.timeout(15000) });
    if (version !== conversationVersion) return;
    if (response.status === 404 || response.status === 403) { localStorage.removeItem(LAST_JOB); updateAssistantExecution({ restoring: false }); return; }
    const job = await parseResponse(response);
    if (version !== conversationVersion || localStorage.getItem(LAST_JOB) !== id) return;
    updateAssistantExecution({ job, restoring: false, error: undefined });
    void poll();
  } catch {
    if (version !== conversationVersion) return;
    updateAssistantExecution({ error: '正在重新连接服务器并确认任务状态…' });
    // A temporary startup/network failure must not discard a running page task.
    if (localStorage.getItem(LAST_JOB) === id) window.setTimeout(() => {
      if (version !== conversationVersion) return;
      initialized = false; void restoreAssistantExecution();
    }, 1800);
  }
};
export const addAssistantFiles = (files: File[]) => {
  const existing = new Set(state.files.map(file => `${file.name}:${file.size}:${file.lastModified}`));
  const additions = files.filter(file => {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (existing.has(key)) return false;
    existing.add(key); return true;
  });
  updateAssistantExecution({ files: [...state.files, ...additions].slice(0, 40), error: undefined });
};
export const startAssistantExecution = async () => {
  if (state.sending || state.job?.status === 'running' || !state.prompt.trim()) return;
  const version = conversationVersion;
  updateAssistantExecution({ sending: true, error: undefined });
  try {
    let response: Response;
    if (state.job?.status === 'waiting' && !state.files.length) {
      response = await fetch(`/api/ai/assistant/jobs/${state.job.id}/reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reply: state.prompt }),
      });
    } else {
      const form = new FormData();
      form.append('prompt', state.prompt);
      form.append('names', JSON.stringify(state.files.map(file => file.name)));
      if (state.job) form.append('previousJobId', state.job.id);
      state.files.forEach(file => form.append('files', file, file.name));
      response = await fetch('/api/ai/assistant/jobs', { method: 'POST', body: form });
    }
    const job = await parseResponse(response);
    if (version !== conversationVersion) {
      void cancelDetachedJob(job);
      return;
    }
    localStorage.setItem(LAST_JOB, job.id);
    updateAssistantExecution({ job, files: [], prompt: '' });
    void poll();
  } catch (error) {
    if (version !== conversationVersion) return;
    updateAssistantExecution({ error: error instanceof Error ? error.message : '任务提交失败。' });
  } finally {
    if (version === conversationVersion) updateAssistantExecution({ sending: false });
  }
};
export const cancelAssistantExecution = async () => {
  if (!state.job) return;
  const id = state.job.id;
  const version = conversationVersion;
  stopAssistantWorkspace();
  try {
    const job = await parseResponse(await fetch(`/api/ai/assistant/jobs/${id}/cancel`, { method: 'POST' }));
    if (version !== conversationVersion || state.job?.id !== id) return;
    updateAssistantExecution({ job });
  } catch (error) {
    if (version === conversationVersion && state.job?.id === id) updateAssistantExecution({ error: error instanceof Error ? error.message : '停止失败。' });
  }
};
export const resetAssistantExecution = () => {
  const previousJob = state.job;
  conversationVersion += 1;
  stopAssistantWorkspace();
  localStorage.removeItem(LAST_JOB);
  updateAssistantExecution({ job: undefined, files: [], prompt: '', sending: false, restoring: false, error: undefined });
  if (previousJob) void cancelDetachedJob(previousJob);
};
