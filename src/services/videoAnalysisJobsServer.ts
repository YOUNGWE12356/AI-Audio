import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { AiContentResponse } from './aiGateway';
import { logEvent } from './safeLogging';
import { VIDEO_ANALYSIS_RETENTION_MS, type VideoAnalysisInput, type VideoAnalysisJob, type VideoAnalysisTrack, type VideoTrackProgress } from './videoAnalysisJobs';

type StoredJob = VideoAnalysisJob & { owner: string; fingerprint: string; input: VideoAnalysisInput; units: Record<string, AiContentResponse>; updatedAt: number };
const safeFailure = (error: any) => error?.code === 'SUBTITLE_UNCERTAIN' ? '部分字幕识别不完整或不清晰，可重试配音分析；其他结果已保留。'
  : error?.status === 504 || error?.name === 'TimeoutError' ? '模型响应超时，自动重试后仍未完成。可仅重试此项，已完成部分保留。'
  : error?.status === 404 ? '视频文件已失效，请重新上传文件。'
  : error?.status === 422 ? '视频或字幕暂时无法读取，请检查素材后重试。'
  : error?.status === 429 ? '模型服务繁忙或额度不足，请稍后重试此项。'
  : '此项分析暂未完成，可重试；已完成部分保留。';

export function createVideoAnalysisJobs(options: {
  directory: string; identity: () => string;
  normalize: (body: any) => Promise<VideoAnalysisInput>;
  reserve: (req: express.Request, res: express.Response) => (() => void) | null;
  run: (req: express.Request, res: express.Response, work: () => Promise<void>) => void;
  execute: (input: VideoAnalysisInput, track: VideoAnalysisTrack, signal: AbortSignal,
    units: StoredJob['units'], save: () => void, progress: (value: Partial<VideoTrackProgress>) => void) => Promise<any[]>;
}) {
  const router = express.Router();
  const jobs = new Map<string, StoredJob>();
  const controllers = new Map<string, AbortController>();
  const cancelled = new Map<string, number>();
  fs.mkdirSync(options.directory, { recursive: true });
  const persist = (job: StoredJob) => {
    job.updatedAt = Date.now();
    const file = path.join(options.directory, `${job.id}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(job)); fs.renameSync(`${file}.tmp`, file);
  };
  for (const name of fs.readdirSync(options.directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const job: StoredJob = JSON.parse(fs.readFileSync(path.join(options.directory, name), 'utf8'));
      if (`${job.id}.json` !== name || !Number.isFinite(job.updatedAt) || Date.now() - job.updatedAt > VIDEO_ANALYSIS_RETENTION_MS) continue;
      if (job.status === 'running') {
        job.status = 'partial';
        for (const track of Object.values(job.tracks)) if (track.status !== 'completed') {
          track.status = 'failed'; track.detail = '服务器重启，已完成部分保留，可重试此项。';
        }
        persist(job);
      }
      jobs.set(job.id, job);
    } catch { /* A malformed manifest cannot authorize or restore a task. */ }
  }
  const view = (job: StoredJob): VideoAnalysisJob => ({ id: job.id, requestId: job.requestId, status: job.status, createdAt: job.createdAt, tracks: job.tracks });
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(id);
  const prune = () => {
    for (const [key, at] of cancelled) if (Date.now() - at > VIDEO_ANALYSIS_RETENTION_MS) cancelled.delete(key);
    for (const [id, job] of jobs) if (job.status !== 'running' && Date.now() - job.updatedAt > VIDEO_ANALYSIS_RETENTION_MS) {
      jobs.delete(id); try { fs.unlinkSync(path.join(options.directory, `${id}.json`)); } catch { /* Best effort. */ }
    }
  };
  // Serialize admission so two lost-ack retries cannot reserve or start duplicate jobs.
  let admission = Promise.resolve();
  router.post('/', (req, res, next) => {
    admission = admission.then(async () => {
      prune();
      const owner = options.identity();
      if (!owner) return void res.status(401).json({ error: '请先登录。' });
      if (!validId(req.body?.requestId)) return void res.status(400).json({ error: '无效任务标识。' });
      const { retry: _retry, requestId, ...body } = req.body;
      const cancelKey = `${owner}:${requestId}`;
      if (cancelled.has(cancelKey)) return void res.status(409).json({ error: '已取消本次分析，请重新开始。' });
      // Resolve the authenticated file again on retry, rather than trusting saved paths.
      const input = await options.normalize(body);
      if (cancelled.has(cancelKey)) return void res.status(409).json({ error: '已取消本次分析，请重新开始。' });
      const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      let job = [...jobs.values()].find(item => item.owner === owner && item.requestId === requestId);
      if (job && job.fingerprint !== fingerprint) return void res.status(409).json({ error: '素材或要求已更改，请重新分析。' });
      if (job && (job.status === 'running' || job.status === 'completed' || req.body.retry !== true)) return void res.status(202).json(view(job));
      const running = [...jobs.values()].filter(item => item.status === 'running');
      if (running.some(item => item.owner === owner) || running.length >= 4 || jobs.size >= 200) return void res.status(429).json({ error: '已有分析任务运行，请等待完成。' });
      const release = options.reserve(req, res);
      if (!release) return;
      const reusableUnits = Object.assign({}, ...[...jobs.values()].filter(item => item.id === body.resumeFromId && item.owner === owner
        && item.input.fileName === input.fileName && item.input.sourceVersion === input.sourceVersion
        && item.input.requirements === input.requirements).map(item => item.units));
      job ??= { id: randomUUID(), requestId, owner, fingerprint, input, units: reusableUnits, createdAt: Date.now(), updatedAt: Date.now(), status: 'running', tracks: {} };
      job.status = 'running';
      for (const track of input.tracks) if (job.tracks[track]?.status !== 'completed') {
        job.tracks[track] = { status: 'pending', completed: 0, total: 1, detail: '等待分析' };
      }
      try { persist(job); } catch (error) { release(); throw error; }
      jobs.set(job.id, job);
      const activeJob = job;
      const controller = new AbortController(); controllers.set(job.id, controller);
      options.run(req, res, async () => {
        const deadline = setTimeout(() => controller.abort('timeout'), 20 * 60_000);
        try {
          await Promise.allSettled(input.tracks.map(async track => {
            const state = activeJob.tracks[track]!;
            if (state.status === 'completed') return;
            state.status = 'running'; persist(activeJob);
            try {
              const clips = await options.execute(input, track, controller.signal, activeJob.units, () => persist(activeJob), value => {
                if (controller.signal.aborted) return;
                Object.assign(state, value); persist(activeJob);
              });
              controller.signal.throwIfAborted();
              Object.assign(state, { status: 'completed', clips, completed: state.total, detail: clips.length ? `分析完成，${clips.length} 个片段` : '分析完成，未发现需要添加的片段' });
            } catch (error) {
              state.status = 'failed'; state.detail = controller.signal.aborted ? '分析已停止，已完成部分保留。' : safeFailure(error);
              logEvent('video-analysis.track.failed', 'warn', error);
            }
            persist(activeJob);
          }));
          activeJob.status = controller.signal.aborted ? 'cancelled'
            : Object.values(activeJob.tracks).every(track => track.status === 'completed') ? 'completed' : 'partial';
        } finally {
          clearTimeout(deadline); controllers.delete(activeJob.id); release();
          for (const state of Object.values(activeJob.tracks)) if (state.status === 'running' || state.status === 'pending') {
            state.status = 'failed'; state.detail = '任务未完成，已完成部分保留，可重试此项。';
          }
          if (activeJob.status === 'running') activeJob.status = 'partial';
          try { persist(activeJob); } catch (error) { logEvent('video-analysis.persist.failed', 'error', error); }
        }
      });
      res.status(202).json(view(activeJob));
    }).catch(next).then(() => undefined);
  });
  router.get('/:id', (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job || job.owner !== options.identity()) return res.status(404).json({ error: '任务不存在或已过期。' });
    return res.json(view(job));
  });
  router.post('/cancel', (req, res) => {
    const owner = options.identity();
    if (validId(req.body?.requestId)) {
      if (cancelled.size >= 4000) cancelled.delete(cancelled.keys().next().value!);
      cancelled.set(`${owner}:${req.body.requestId}`, Date.now());
    }
    const job = [...jobs.values()].find(item => item.owner === owner && item.requestId === req.body?.requestId);
    if (job) controllers.get(job.id)?.abort('user');
    res.json({ success: true });
  });
  return router;
}
