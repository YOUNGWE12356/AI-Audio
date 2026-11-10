import { VIDEO_ANALYSIS_ENDPOINT as endpoint, VIDEO_ANALYSIS_LABELS, type VideoAnalysisJob, type VideoAnalysisTrack } from './videoAnalysisJobs';

const pause = (signal: AbortSignal, ms = 1500) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  signal.addEventListener('abort', abort, { once: true });
});

export async function analyzeVideoInBackground(body: {
  fileName: string; videoDuration: number; tracks: VideoAnalysisTrack[]; requirements?: string; resumeFromId?: string;
}, options: { signal: AbortSignal; headers?: Record<string, string>; onProgress: (job: VideoAnalysisJob) => void; onConnection: (message: string) => void }) {
  const { resumeFromId: _resume, ...stableInput } = body;
  const storageKey = `video-analysis.pending:${JSON.stringify(stableInput)}`;
  let requestId = globalThis.crypto?.randomUUID?.() || `video-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  try { requestId = JSON.parse(sessionStorage.getItem(storageKey) || 'null')?.requestId || requestId; } catch { /* Storage is optional. */ }
  const remember = (status = 'running') => { try { sessionStorage.setItem(storageKey, JSON.stringify({ requestId, status, at: Date.now() })); } catch { /* Optional. */ } };
  const clear = () => { try { sessionStorage.removeItem(storageKey); } catch { /* Optional. */ } };
  remember();
  const cancel = () => { clear(); void fetch(`${endpoint}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId }), keepalive: true, signal: AbortSignal.timeout(10_000) }).catch(() => {}); };
  const onAbort = () => { if (options.signal.reason !== 'detach') cancel(); };
  options.signal.addEventListener('abort', onAbort, { once: true });
  const request = async (url: string, init: RequestInit) => {
    const response = await fetch(url, { ...init, signal: AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error || '无法连接分析任务。'), { terminal: response.status < 500 });
    return value as VideoAnalysisJob;
  };
  try {
    let job: VideoAnalysisJob | undefined;
    for (let attempt = 0; !job; attempt++) {
      options.signal.throwIfAborted();
      try {
        job = await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...options.headers }, body: JSON.stringify({ ...body, requestId, retry: true }) });
      } catch (error: any) {
        options.signal.throwIfAborted();
        if (error.terminal || attempt >= 2) throw error;
        options.onConnection('正在确认同一后台任务，请稍候…'); await pause(options.signal);
      }
    }
    const deadline = Date.now() + 21 * 60_000;
    while (true) {
      options.onProgress(job);
      remember(job.status);
      if (job.status !== 'running') {
        if (job.status === 'completed') clear();
        window.dispatchEvent(new Event('ai-audio:usage-updated'));
        return job;
      }
      if (Date.now() >= deadline) { cancel(); throw new Error('分析等待超时，已完成的结果已保留。'); }
      await pause(options.signal);
      try { job = await request(`${endpoint}/${encodeURIComponent(job.id)}`, { method: 'GET', cache: 'no-store' }); }
      catch (error: any) {
        options.signal.throwIfAborted();
        if (error.terminal) { clear(); throw error; }
        options.onConnection('连接暂时中断，正在重连同一后台任务…');
      }
    }
  } catch (error: any) { if (error?.terminal) clear(); throw error; }
  finally { options.signal.removeEventListener('abort', onAbort); }
}

export function pendingVideoAnalysis(fileName: string): { tracks: VideoAnalysisTrack[]; requirements?: string } | undefined {
  try {
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index)!;
      if (!key.startsWith('video-analysis.pending:')) continue;
      const state = JSON.parse(sessionStorage.getItem(key)!);
      const body = JSON.parse(key.slice('video-analysis.pending:'.length));
      if (body.fileName === fileName && state.status === 'running' && Date.now() - state.at < 24 * 60 * 60_000) return body;
    }
  } catch { /* Optional storage. */ }
}

export const videoAnalysisSummary = (job: VideoAnalysisJob) => Object.entries(job.tracks).map(([track, state]) =>
  `${VIDEO_ANALYSIS_LABELS[track as VideoAnalysisTrack]}：${state.detail}`,
).join('；');
