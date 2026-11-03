import { getClientId } from './clientIdentity';
import { AUDIO_DESIGN_JOBS_ENDPOINT as endpoint, AUDIO_DESIGN_JOB_TIMEOUT_MS, AUDIO_DESIGN_RETENTION_MS, type AudioDesignJob } from './audioDesignJobs';

const pendingKey = (payload: string) => {
  let first = 2166136261, second = 5381;
  for (let i = 0; i < payload.length; i++) { first = Math.imul(first ^ payload.charCodeAt(i), 16777619); second = Math.imul(second, 33) ^ payload.charCodeAt(i); }
  return `${payload.length}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
};
const pause = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal?.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(signal?.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});
const terminal = (message: string) => Object.assign(new Error(message), { terminal: true });

export async function waitForAudioDesignJob(initial: AudioDesignJob, options: {
  signal?: AbortSignal; onProgress?: (message: string) => void; pollMs?: number; maxWaitMs?: number;
} = {}) {
  const deadline = options.maxWaitMs === undefined ? initial.createdAt + AUDIO_DESIGN_JOB_TIMEOUT_MS : Date.now() + options.maxWaitMs;
  let job = initial;
  while (true) {
    options.signal?.throwIfAborted();
    if (job.status === 'completed') {
      if (!job.result || (!job.result.bgmRecommendations?.length && !job.result.sfxSchemes?.length)) throw terminal('音频设计任务返回结果无效。');
      return job.result;
    }
    if (job.status === 'failed' || job.status === 'cancelled') throw terminal(job.error || job.message);
    if (Date.now() >= deadline) throw Object.assign(terminal('音频设计超过 90 秒，已停止本次分析。请稍后重试或减少素材。'), { cancelJob: true });
    options.onProgress?.(`${job.message} 已等待 ${Math.max(0, Math.floor((Date.now() - job.createdAt) / 1000))} 秒。`);
    await pause(Math.min(options.pollMs ?? 1000, deadline - Date.now()), options.signal);
    try {
      const signal = AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - Date.now())));
      const response = await fetch(`${endpoint}/${encodeURIComponent(job.id)}`, { cache: 'no-store', method: 'GET',
        signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status < 500) throw terminal(payload.error || '无法读取音频设计任务。');
        throw new Error(payload.error || '暂时无法连接任务服务。');
      }
      job = payload;
    } catch (error: any) {
      options.signal?.throwIfAborted();
      if (error?.terminal) throw error;
      options.onProgress?.('连接暂时中断，正在查询同一后台任务，不会重复生成或扣费。');
    }
  }
}

export async function generateAudioDesignInBackground(body: unknown, options: {
  signal?: AbortSignal; onProgress?: (message: string) => void;
} = {}) {
  options.signal?.throwIfAborted();
  const payload = JSON.stringify(body);
  const storageKey = `ai-audio.design.pending.${pendingKey(getClientId() + payload)}`;
  let requestId = globalThis.crypto?.randomUUID?.() || `design-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (stored && /^[a-zA-Z0-9-]{16,80}$/.test(stored.id) && Date.now() - stored.at < AUDIO_DESIGN_RETENTION_MS) requestId = stored.id;
    sessionStorage.setItem(storageKey, JSON.stringify({ id: requestId, at: Date.now() }));
  } catch { /* Optional storage. */ }
  const clearPending = () => { try { sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ } };
  const cancel = () => {
    // A request ID also cancels a submission whose acknowledgement was lost.
    void fetch(`${endpoint}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId }), keepalive: true, signal: AbortSignal.timeout(15_000) })
      .then(response => { if (response.ok) clearPending(); }).catch(() => {});
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    options.onProgress?.('正在提交后台音频设计任务…');
    let job: AudioDesignJob | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      options.signal?.throwIfAborted();
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...JSON.parse(payload), requestId }), signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
        const result = await response.json();
        if (!response.ok) throw Object.assign(new Error(result.error || '音频设计任务提交失败。'), {
          terminal: response.status < 500, preparationFailure: response.status === 410,
        });
        if (!result.id) throw new Error('服务器未返回音频设计任务标识。');
        job = result; break;
      } catch (error: any) {
        options.signal?.throwIfAborted();
        if (error?.terminal) throw error;
        if (attempt === 2) throw new Error('暂时无法确认任务状态，请用相同素材再次分析以继续查询，避免重复提交。');
        options.onProgress?.('正在重连并确认同一任务，不会重复生成。');
        await pause(2000, options.signal);
      }
    }
    const result = await waitForAudioDesignJob(job!, options);
    clearPending();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('ai-audio:usage-updated'));
    return result;
  } catch (error: any) {
    if (error?.cancelJob) cancel();
    if (error?.terminal) clearPending();
    throw error;
  } finally { options.signal?.removeEventListener('abort', cancel); }
}
