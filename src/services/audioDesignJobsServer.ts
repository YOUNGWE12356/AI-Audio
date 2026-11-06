import { logEvent } from './safeLogging';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AUDIO_DESIGN_JOB_TIMEOUT_MS, AUDIO_DESIGN_RETENTION_MS, type AudioDesignJob } from './audioDesignJobs';

type StoredJob = AudioDesignJob & { owner: string; requestId: string; fingerprint: string; updatedAt: number };

/** Submission and status requests never hold the browser connection open for inference. */
export function createAudioDesignJobs<Input>(options: {
  directory: string;
  identity: (req: express.Request, res: express.Response) => string;
  normalize: (body: any) => Input;
  reserve: (req: express.Request, res: express.Response) => (() => void) | null;
  run: (req: express.Request, res: express.Response, work: () => Promise<void>) => void;
  execute: (input: Input, progress: (message: string) => void, signal: AbortSignal) => Promise<AudioDesignJob['result']>;
  timeoutMs?: number;
}) {
  const router = express.Router();
  const jobs = new Map<string, StoredJob>();
  const controllers = new Map<string, AbortController>();
  const cancelledRequests = new Map<string, number>();
  fs.mkdirSync(options.directory, { recursive: true });
  const persist = (job: StoredJob) => {
    const file = path.join(options.directory, `${job.id}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(job));
    fs.renameSync(`${file}.tmp`, file);
  };
  for (const name of fs.readdirSync(options.directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const job: StoredJob = JSON.parse(fs.readFileSync(path.join(options.directory, name), 'utf8'));
      if (`${job.id}.json` !== name || !Number.isFinite(job.updatedAt)) continue;
      if (Date.now() - job.updatedAt > AUDIO_DESIGN_RETENTION_MS) {
        fs.unlinkSync(path.join(options.directory, name)); continue;
      }
      if (job.status === 'running') {
        job.status = 'failed'; job.error = '服务器重启中断了音频设计，请重新分析。';
        job.message = job.error; job.updatedAt = Date.now(); persist(job);
      }
      jobs.set(job.id, job);
    } catch { /* Incomplete manifests are not task results. */ }
  }
  const publicJob = ({ owner: _owner, requestId: _requestId, fingerprint: _fingerprint, updatedAt: _updatedAt, ...job }: StoredJob) => job;
  const prune = () => {
    for (const [id, job] of jobs) {
      if (job.status === 'running' || Date.now() - job.updatedAt <= AUDIO_DESIGN_RETENTION_MS) continue;
      jobs.delete(id);
      try { fs.unlinkSync(path.join(options.directory, `${id}.json`)); } catch { /* Best effort. */ }
    }
    for (const [key, at] of cancelledRequests) if (Date.now() - at > AUDIO_DESIGN_RETENTION_MS) cancelledRequests.delete(key);
  };
  const requestKey = (owner: string, requestId: string) => `${owner}\0${requestId}`;
  const validRequestId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value);
  router.post('/', (req, res, next) => {
    try {
      prune();
      const owner = options.identity(req, res);
      if (!owner || owner === 'unknown') return res.status(401).json({ error: '无法识别当前用户，请刷新后重试。' });
      const { requestId, ...body } = req.body || {};
      if (!validRequestId(requestId)) return res.status(400).json({ error: '无效音频设计任务标识。' });
      const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const existing = [...jobs.values()].find(job => job.owner === owner && job.requestId === requestId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) return res.status(409).json({ error: '任务标识对应不同素材，请重新分析。' });
        return res.status(202).json(publicJob(existing));
      }
      if (cancelledRequests.has(requestKey(owner, requestId))) return res.status(409).json({ error: '已取消本次分析。' });
      const running = [...jobs.values()].filter(job => job.status === 'running');
      if (running.some(job => job.owner === owner)) return res.status(409).json({ error: '已有音频设计任务正在后台处理，请等待或取消当前任务。' });
      if (running.length >= 8 || jobs.size >= 200) return res.status(429).json({ error: '音频设计任务繁忙，请稍后重试。' });
      const input = options.normalize(body);
      const release = options.reserve(req, res);
      if (!release) return;
      const job: StoredJob = { id: randomUUID(), owner, requestId, fingerprint, status: 'running',
        message: '素材校验完成，正在等待模型分析并生成设计方案。', createdAt: Date.now(), updatedAt: Date.now() };
      try { persist(job); } catch (error) { release(); throw error; }
      jobs.set(job.id, job);
      const controller = new AbortController(); controllers.set(job.id, controller);
      options.run(req, res, async () => {
        let timedOut = false;
        const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? AUDIO_DESIGN_JOB_TIMEOUT_MS);
        try {
          const result = await options.execute(input, message => {
            if (controller.signal.aborted) return;
            job.message = message; job.updatedAt = Date.now(); persist(job);
          }, controller.signal);
          controller.signal.throwIfAborted();
          if (!result) throw new Error('音频设计没有返回有效结果。');
          job.result = result; job.status = 'completed'; job.message = '音频设计方案已完成。';
        } catch (error: any) {
          job.status = controller.signal.aborted && !timedOut ? 'cancelled' : 'failed';
          job.error = timedOut ? '音频设计超过 90 秒，已停止本次分析。请稍后重试或减少素材。'
            : controller.signal.aborted ? '已取消本次分析。' : error?.message || '音频设计失败，请重试。';
          job.message = job.error!;
        } finally {
          clearTimeout(deadline); controllers.delete(job.id); release(); job.updatedAt = Date.now();
          try { persist(job); } catch (error) { logEvent('src/services/audioDesignJobsServer.ts:98', 'error', error); }
          console.info(`[audio-design] job=${job.id} status=${job.status} elapsedMs=${Date.now() - job.createdAt}`);
        }
      });
      return res.status(202).json(publicJob(job));
    } catch (error) { next(error); }
  });
  router.get('/:id', (req, res) => {
    prune();
    const job = jobs.get(String(req.params.id));
    if (!job || job.owner !== options.identity(req, res)) return res.status(404).json({ error: '音频设计任务不存在或已过期，请重新分析。' });
    res.setHeader('Cache-Control', 'no-store'); return res.json(publicJob(job));
  });
  router.post('/cancel', (req, res) => {
    prune();
    const owner = options.identity(req, res), requestId = req.body?.requestId;
    if (!owner || owner === 'unknown') return res.status(401).json({ error: '无法识别当前用户。' });
    if (!validRequestId(requestId)) return res.status(400).json({ error: '无效音频设计任务标识。' });
    cancelledRequests.set(requestKey(owner, requestId), Date.now());
    const job = [...jobs.values()].find(item => item.owner === owner && item.requestId === requestId);
    if (job?.status === 'running') controllers.get(job.id)?.abort();
    return res.json({ success: true });
  });
  return router;
}
