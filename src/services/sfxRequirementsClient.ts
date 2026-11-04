import { getClientId } from './clientIdentity';

export interface RequirementsJobState {
  id: string;
  status: 'running' | 'completed' | 'failed';
  message: string;
  createdAt: number;
  result?: { items: any[]; sourceItemCount?: number };
  error?: string;
}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const endpoint = '/api/ai/sfx-requirements';

// This is a local storage lookup key, not an authorization token. Avoid requiring
// crypto.subtle so ordinary HTTP LAN addresses work as well as localhost.
const pendingKey = (value: string) => {
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return `${value.length}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
};

export async function waitForRequirementsJob(
  initial: RequirementsJobState,
  onProgress?: (message: string) => void,
  options: { pollMs?: number; maxWaitMs?: number; endpoint?: string } = {},
) {
  const jobEndpoint = options.endpoint || endpoint;
  const deadline = Date.now() + (options.maxWaitMs ?? 12 * 60 * 1000);
  let job = initial;
  while (true) {
    if (job.status === 'completed') {
      if (!Array.isArray(job.result?.items)) throw Object.assign(new Error('需求表任务返回结果无效。'), { terminal: true });
      return job.result;
    }
    if (job.status === 'failed') throw Object.assign(new Error(job.error || job.message || '需求表生成失败。'), { terminal: true });
    const elapsed = Math.max(0, Math.floor((Date.now() - job.createdAt) / 1000));
    onProgress?.(`${job.message} 已等待 ${elapsed} 秒。`);
    if (Date.now() >= deadline) throw new Error('暂未取到需求表结果，后台任务已保留。请使用相同素材再次点击生成以继续查询，不会重复提交。');
    await pause(options.pollMs ?? 2000);
    try {
      const response = await fetch(`${jobEndpoint}/jobs/${encodeURIComponent(job.id)}`, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (response.status < 500) throw Object.assign(new Error(payload.error || '无法读取需求表任务。'), { terminal: true });
        throw new Error(payload.error || '任务连接暂不可用。');
      }
      job = await response.json();
    } catch (error: any) {
      if (error?.terminal) throw error;
      onProgress?.('暂时无法连接服务器，正在重新查询已有任务，不会重复生成或重复扣费。');
    }
  }
}

export async function generateRequirementsInBackground(body: unknown, onProgress?: (message: string) => void, options: { endpoint?: string } = {}) {
  const jobEndpoint = options.endpoint || endpoint;
  const payload = JSON.stringify(body);
  const storageKey = `ai-audio.requirements.pending.${pendingKey(jobEndpoint + getClientId() + payload)}`;
  let requestId: string = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID() : `requirements-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (stored && /^[a-zA-Z0-9-]{16,80}$/.test(stored.id) && Date.now() - stored.at < 60 * 60 * 1000) requestId = stored.id;
    sessionStorage.setItem(storageKey, JSON.stringify({ id: requestId, at: Date.now() }));
  } catch { /* Storage is optional; in-tab retries still share the request ID. */ }
  const clearPending = () => { try { sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ } };
  let job: RequirementsJobState | undefined;
  onProgress?.('正在提交后台任务，复杂截图和表格可以继续等待，不会在 90 秒时中断。');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(jobEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...JSON.parse(payload), background: true, requestId }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error || '需求表任务提交失败。'), { terminal: response.status < 500 });
      if (!result.id) throw new Error('服务器未返回需求表任务标识。');
      job = result; break;
    } catch (error: any) {
      if (error?.terminal) { clearPending(); throw error; }
      if (attempt === 2) throw new Error('暂时无法确认任务状态，请使用相同素材再次点击生成以继续连接，避免更换素材后重复提交。');
      onProgress?.('正在重新连接并确认已有任务，不会重复提交。');
      await pause(2000);
    }
  }
  try {
    const result = await waitForRequirementsJob(job!, onProgress, { endpoint: jobEndpoint });
    clearPending();
    window.dispatchEvent(new Event('ai-audio:usage-updated'));
    return result;
  } catch (error: any) {
    if (error?.terminal) clearPending();
    throw error;
  }
}
