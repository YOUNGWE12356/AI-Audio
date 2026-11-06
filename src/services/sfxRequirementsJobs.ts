import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { replaceAssistantManifest } from './assistantManifest';
import { requirementsErrorText } from './sfxRequirementsErrors';

type Result = { items: any[]; sourceItemCount?: number; excludedItems?: Array<{ name: string; reason: string }> };
type Job = {
  id: string; owner: string; requestId: string; fingerprint: string;
  status: 'running' | 'completed' | 'failed'; message: string;
  createdAt: number; updatedAt: number; result?: Result; error?: string;
};
const RETENTION_MS = 60 * 60 * 1000;
const MAX_JOB_MS = 11 * 60 * 1000;

export function createSfxRequirementsJobs(options: {
  directory: string;
  identity: (req: express.Request, res: express.Response) => string;
  normalize: (body: any) => any;
  reserve: (req: express.Request, res: express.Response) => (() => void) | null;
  run: (req: express.Request, res: express.Response, work: () => Promise<void>) => void;
  execute: (input: any, progress: (message: string) => void, signal: AbortSignal) => Promise<Result>;
  maxJobMs?: number;
}) {
  const router = express.Router();
  const jobs = new Map<string, Job>();
  fs.mkdirSync(options.directory, { recursive: true });
  const persist = (job: Job) => {
    const file = path.join(options.directory, `${job.id}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(job));
    replaceAssistantManifest(`${file}.tmp`, file);
  };
  for (const name of fs.readdirSync(options.directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const job: Job = JSON.parse(fs.readFileSync(path.join(options.directory, name), 'utf8'));
      if (`${job.id}.json` !== name) continue;
      if (Date.now() - job.updatedAt > RETENTION_MS) { fs.unlinkSync(path.join(options.directory, name)); continue; }
      if (job.status === 'running') {
        job.status = 'failed'; job.error = '服务器重启中断了需求表生成，请重新生成。';
        job.message = job.error; job.updatedAt = Date.now(); persist(job);
      }
      jobs.set(job.id, job);
    } catch { /* Ignore incomplete manifests. */ }
  }
  const ownerOf = (req: express.Request, res: express.Response) => {
    const identity = options.identity(req, res);
    if (identity && identity !== 'unknown') return identity;
    const cookie = /(?:^|;\s*)ai_audio_requirements=([a-f0-9-]{36})(?:;|$)/i.exec(req.headers.cookie || '')?.[1];
    const id = cookie || randomUUID();
    if (!cookie) res.append('Set-Cookie', `ai_audio_requirements=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    return `session:${id}`;
  };
  const publicJob = ({ owner: _owner, fingerprint: _fingerprint, requestId: _requestId, ...job }: Job) => job.status === 'failed'
    ? { ...job, error: requirementsErrorText(job.error || job.message), message: requirementsErrorText(job.error || job.message) } : job;
  const prune = () => {
    for (const [id, job] of jobs) {
      if (job.status === 'running' || Date.now() - job.updatedAt <= RETENTION_MS) continue;
      jobs.delete(id);
      try { fs.unlinkSync(path.join(options.directory, `${id}.json`)); } catch { /* Best effort. */ }
    }
  };
  router.post('/', (req, res, next) => {
    if (req.body?.background !== true) return next();
    try {
      prune();
      const owner = ownerOf(req, res);
      const requestId = String(req.body?.requestId || '');
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) return res.status(400).json({ error: '无效需求表任务标识。' });
      const input = options.normalize(req.body);
      const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const existing = [...jobs.values()].find(job => job.owner === owner && job.requestId === requestId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) return res.status(409).json({ error: '任务标识已用于不同的需求，请重新生成。' });
        return res.status(202).json(publicJob(existing));
      }
      const running = [...jobs.values()].filter(job => job.status === 'running');
      if (running.some(job => job.owner === owner)) return res.status(409).json({ error: '已有需求表正在后台生成，请等待当前任务完成。' });
      if (running.length >= 8 || jobs.size >= 200) return res.status(429).json({ error: '需求表任务繁忙，请稍后重试。' });
      const release = options.reserve(req, res);
      if (!release) return;
      const job: Job = { id: randomUUID(), owner, requestId, fingerprint, status: 'running',
        message: '已提交后台，等待 AI 识别参考素材并生成需求表。', createdAt: Date.now(), updatedAt: Date.now() };
      try { persist(job); } catch (error) {
        release(); console.error('[sfx-requirements] Failed to create task:', error);
        throw Object.assign(new Error('需求表任务保存失败，请稍后重试。'), { status: 503 });
      }
      jobs.set(job.id, job);
      options.run(req, res, async () => {
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), options.maxJobMs ?? MAX_JOB_MS);
        const startedAt = Date.now();
        try {
          job.result = await options.execute(input, message => {
            job.message = message; job.updatedAt = Date.now();
            // A locked progress manifest must not abort an otherwise valid AI request.
            try { persist(job); } catch (error) { console.error('[sfx-requirements] Failed to save progress:', error); }
          }, controller.signal);
          job.status = 'completed'; job.message = `已生成 ${job.result.items.length} 条需求。`;
        } catch (error: any) {
          job.status = 'failed';
          job.error = controller.signal.aborted ? '需求表生成超过后台等待上限，请缩小需求范围后重试。' : requirementsErrorText(error);
          job.message = job.error!;
        } finally {
          clearTimeout(deadline); release(); job.updatedAt = Date.now();
          try { persist(job); } catch (error) { console.error('[sfx-requirements] Failed to save task:', error); }
          console.info(`[sfx-requirements] job=${job.id} status=${job.status} elapsedMs=${Date.now() - startedAt}`);
        }
      });
      return res.status(202).json(publicJob(job));
    } catch (error) { next(error); }
  });
  router.get('/jobs/:id', (req, res) => {
    prune();
    const job = jobs.get(String(req.params.id));
    if (!job || job.owner !== ownerOf(req, res)) return res.status(404).json({ error: '需求表任务不存在或已过期，请重新生成。' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json(publicJob(job));
  });
  return router;
}
