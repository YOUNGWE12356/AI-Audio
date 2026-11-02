import express from 'express';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ONLINE_SFX_BATCH_COMPANY_POINTS,
  ONLINE_SFX_MAX_RESULTS,
  ONLINE_SFX_PRICING_VERSION,
  ONLINE_SFX_SOURCE_PAGES_PER_BATCH,
  onlineSfxSearchUrl,
  type OnlineSfxItem,
} from './onlineSfxTypes';
import { recordAiUsage } from './usageTracking';

const runFile = promisify(execFile);
const PREVIEW_HOST = 'public-assets.content-platform.envatousercontent.com';
const MAX_CAPTURE_SECONDS = 60;
const MAX_BYTES = 20 * 1024 * 1024;
const TTL = 30 * 60 * 1000;
const ONLINE_SFX_FILE_PATTERN = /^online_sfx_[a-f0-9-]+\.wav(?:\.source\.json)?$/;
const fail = (message: string, status = 502) => Object.assign(new Error(message), { status });
const decodeHtml = (value: string) => value.replace(/&(?:amp|quot|apos|lt|gt|#39|#x27);/g, entity => (
  ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&#x27;': "'", '&lt;': '<', '&gt;': '>' })[entity] || entity
));

export function recordOnlineSfxBatchUsage() {
  recordAiUsage({
    provider: 'network',
    model: 'envato-preview-search',
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    credits: 0,
    companyPoints: ONLINE_SFX_BATCH_COMPANY_POINTS,
    pricingVersion: ONLINE_SFX_PRICING_VERSION,
    billingQuantity: 1,
    billingUnit: 'request',
  });
}

export function recordTimelineOnlineSfxUsage() {
  recordAiUsage({
    provider: 'network',
    model: 'envato-preview-timeline',
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    credits: 0,
    companyPoints: ONLINE_SFX_BATCH_COMPANY_POINTS,
    pricingVersion: ONLINE_SFX_PRICING_VERSION,
    billingQuantity: 1,
    billingUnit: 'request',
  });
}

export async function removeOrphanedOnlineSfxFiles(uploadsDir: string, createdBefore = Date.now()) {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(uploadsDir, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
  let removed = 0;
  await Promise.all(entries.map(async entry => {
    if (!entry.isFile() || !ONLINE_SFX_FILE_PATTERN.test(entry.name)) return;
    const filePath = path.join(uploadsDir, entry.name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || Math.max(stat.birthtimeMs, stat.ctimeMs, stat.mtimeMs) > createdBefore) return;
    await fs.rm(filePath, { force: true });
    removed++;
  }));
  return removed;
}

export function allowedPreviewUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === PREVIEW_HOST && !url.port
      && !url.username && !url.password && /\/preview\.(?:mp3|m4a)$/.test(url.pathname);
  } catch { return false; }
}

type Candidate = Omit<OnlineSfxItem, 'id'> & { previewUrl: string };
// Use title/source/audio from the same card; never guess preview URLs or use
// unrelated homepage recommendations when the result schema changes.
export function parseEnvatoSearch(html: string, limit = ONLINE_SFX_MAX_RESULTS): Candidate[] {
  const items: Candidate[] = [];
  const seen = new Set<string>();
  for (const card of html.split('data-testid="audio-card"').slice(1)) {
    const titleLink = card.match(/<a\b[^>]*data-testid="title-link"[^>]*>/)?.[0];
    const title = titleLink?.match(/\btitle="([^"]+)"/)?.[1];
    const href = titleLink?.match(/\bhref="([^"]+)"/)?.[1];
    const previewUrl = card.match(/<source\b[^>]*src="([^"]+\/preview\.mp3(?:\?[^"]*)?)"/)?.[1];
    if (!title || !href || !previewUrl) continue;
    const sourceUrl = new URL(decodeHtml(href), 'https://elements.envato.com');
    const preview = decodeHtml(previewUrl);
    if (sourceUrl.origin !== 'https://elements.envato.com' || !allowedPreviewUrl(preview) || seen.has(sourceUrl.href)) continue;
    seen.add(sourceUrl.href);
    items.push({ title: decodeHtml(title), author: decodeHtml(card.match(/href="\/user\/([^/]+)\/sound-effects"/)?.[1] || ''),
      source: 'Envato Elements', sourceUrl: sourceUrl.href, previewUrl: preview });
    if (items.length === limit) break;
  }
  return items;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

export async function boundedFetch(
  url: string,
  limit: number,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const initial = new URL(url);
  let current = initial;
  let response: Response;
  try {
    for (let redirects = 0; ; redirects++) {
      let connectionError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await fetcher(current, { signal, redirect: 'manual' });
          connectionError = undefined;
          break;
        } catch (error: any) {
          if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
          connectionError = error;
        }
      }
      if (connectionError) throw connectionError;
      if (!REDIRECT_STATUSES.has(response.status)) break;

      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw fail('来源网站返回了无效跳转。');
      if (redirects >= MAX_REDIRECTS) throw fail('来源网站跳转次数过多，请稍后重试。');

      const next = new URL(location, current);
      if (next.protocol !== 'https:' || next.origin !== initial.origin || next.username || next.password) {
        throw fail('来源网站返回了不安全的跳转。');
      }
      current = next;
    }
  } catch (error: any) {
    if (error?.status || error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
    throw fail('无法连接来源网站，请稍后重试。');
  }
  if (!response.ok) throw fail(response.status === 401 || response.status === 403
    ? '来源网站要求登录或限制自动访问，请打开来源页面处理。'
    : `来源网站返回 HTTP ${response.status}，请稍后重试。`);
  if (Number(response.headers.get('content-length') || 0) > limit) {
    await response.body?.cancel(); throw fail('来源文件超过本次采集大小上限。', 413);
  }
  if (!response.body) throw fail('来源网站没有返回内容。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw fail('来源文件超过本次采集大小上限。', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return { data: Buffer.concat(chunks), type: response.headers.get('content-type') || '' };
}

export type TimelineOnlineSfxResult = {
  audioUrl: string;
  duration: number;
  title: string;
  author: string;
  source: string;
  sourceUrl: string;
};

const rankTimelineCandidates = (candidates: Candidate[], query: string) => {
  const queryTokens = new Set<string>(
    query.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter(token => !['sound', 'effect', 'audio'].includes(token)) || [],
  );
  return candidates
    .map((candidate, index) => {
      const titleTokens: string[] = candidate.title.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
      return {
        candidate,
        index,
        score: titleTokens.filter(token => queryTokens.has(token)).length,
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(item => item.candidate);
};

/**
 * Finds one usable public preview for a timeline SFX clip. Timeline files use a
 * separate prefix so the manual online-search cleanup never removes them.
 */
export async function findAndCaptureTimelineOnlineSfx(options: {
  query: string;
  uploadsDir: string;
  ffmpeg: string;
  maxDurationSeconds?: number;
  fetcher?: typeof fetch;
}): Promise<TimelineOnlineSfxResult | null> {
  const query = options.query.trim().slice(0, 160);
  if (!query) return null;

  const fetcher = options.fetcher || fetch;
  let candidates: Candidate[];
  try {
    const { data } = await boundedFetch(
      onlineSfxSearchUrl('envato', query),
      3 * 1024 * 1024,
      AbortSignal.timeout(12_000),
      fetcher,
    );
    candidates = rankTimelineCandidates(parseEnvatoSearch(data.toString('utf8'), 8), query).slice(0, 3);
  } catch (error) {
    console.warn('[timeline-sfx] Online search unavailable; using ElevenLabs fallback:', error);
    return null;
  }

  const captureSeconds = Math.min(
    MAX_CAPTURE_SECONDS,
    Math.max(0.5, Number(options.maxDurationSeconds) || MAX_CAPTURE_SECONDS),
  );
  for (const candidate of candidates) {
    let temp: string | undefined;
    try {
      const { data, type } = await boundedFetch(
        candidate.previewUrl,
        MAX_BYTES,
        AbortSignal.timeout(18_000),
        fetcher,
      );
      if (/text\/|application\/(?:json|xml)/i.test(type) || data.length < 32) continue;

      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-audio-timeline-sfx-'));
      const input = path.join(temp, 'preview.mp3');
      const output = path.join(temp, 'capture.wav');
      await fs.writeFile(input, data);
      await runFile(options.ffmpeg, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', input,
        '-vn', '-t', String(captureSeconds), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-y', output,
      ], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });

      const wav = await fs.readFile(output);
      if (wav.length < 100) continue;
      const probe = await runFile(options.ffmpeg, ['-hide_banner', '-i', output, '-f', 'null', '-'], {
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      const match = probe.stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) continue;
      const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      if (!Number.isFinite(duration) || duration <= 0) continue;

      const fileName = `timeline_sfx_${randomUUID()}.wav`;
      await fs.mkdir(options.uploadsDir, { recursive: true });
      await fs.copyFile(output, path.join(options.uploadsDir, fileName));
      await fs.writeFile(
        path.join(options.uploadsDir, `${fileName}.source.json`),
        JSON.stringify({
          title: candidate.title,
          author: candidate.author,
          source: candidate.source,
          sourceUrl: candidate.sourceUrl,
          query,
          querySource: 'public-preview',
          capturedAt: new Date().toISOString(),
          duration,
        }),
      );
      return {
        audioUrl: `/uploads/${fileName}`,
        duration,
        title: candidate.title,
        author: candidate.author,
        source: candidate.source,
        sourceUrl: candidate.sourceUrl,
      };
    } catch (error) {
      console.warn(`[timeline-sfx] Preview capture failed for ${candidate.sourceUrl}:`, error);
    } finally {
      if (temp) await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  }
  return null;
}

export function createOnlineSfxRouter(options: {
  uploadsDir: string; ffmpeg: string;
  owner: (req: express.Request, res: express.Response) => string;
  reserve?: (req: express.Request, res: express.Response, points: number) => (() => void) | null;
}) {
  const router = express.Router();
  type Ticket = { item: OnlineSfxItem; previewUrl: string; owner: string; at: number;
    pending?: Promise<unknown>; captured?: unknown; fileName?: string; discarded?: boolean };
  const tickets = new Map<string, Ticket>();
  const searches = new Map<string, number>();
  let searching = 0, capturing = 0;

  const removeTicketFiles = async (ticket: Ticket) => {
    if (!ticket.fileName) return;
    const fileName = ticket.fileName;
    ticket.fileName = undefined;
    await Promise.all([
      fs.rm(path.join(options.uploadsDir, fileName), { force: true }),
      fs.rm(path.join(options.uploadsDir, `${fileName}.source.json`), { force: true }),
    ]);
  };
  const discardTicket = async (id: string, ticket: Ticket) => {
    ticket.discarded = true;
    if (ticket.pending) {
      void ticket.pending.then(() => removeTicketFiles(ticket), () => removeTicketFiles(ticket))
        .catch(error => console.warn('Failed to remove discarded online sound preview:', error))
        .finally(() => tickets.delete(id));
      return;
    }
    tickets.delete(id);
    await removeTicketFiles(ticket);
  };
  const cleanupOwner = async (owner: string) => {
    await Promise.all([...tickets.entries()]
      .filter(([, ticket]) => ticket.owner === owner)
      .map(([id, ticket]) => discardTicket(id, ticket)));
  };
  const prune = async () => {
    await Promise.all([...tickets.entries()]
      .filter(([, ticket]) => Date.now() - ticket.at > TTL)
      .map(([id, ticket]) => discardTicket(id, ticket)));
    for (const [id, at] of searches) if (Date.now() - at > 60_000) searches.delete(id);
  };

  const orphanCutoff = Date.now();
  void removeOrphanedOnlineSfxFiles(options.uploadsDir, orphanCutoff).catch(error => {
    console.warn('Failed to remove orphaned online sound previews:', error);
  });

  router.post('/cleanup', async (req, res) => {
    try {
      const owner = options.owner(req, res);
      if (!owner || owner === 'unknown') return res.status(401).json({ error: '无法识别当前会话。' });
      void cleanupOwner(owner).catch(error => {
        console.warn('Failed to remove online sound previews after page close:', error);
      });
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: '临时音效清理失败，请稍后重试。' });
    }
  });
  router.post('/search', async (req, res) => {
    let releaseReservation: (() => void) | undefined;
    try {
      await prune();
      const owner = options.owner(req, res);
      if (!owner || owner === 'unknown') return res.status(401).json({ error: '无法识别当前会话，请刷新后重试。' });
      const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
      if (!query || query.length > 160) return res.status(400).json({ error: '请输入 1～160 字的音效关键词。' });
      const page = Number(req.body?.page ?? 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 50) {
        return res.status(400).json({ error: '搜索批次无效，请重新开始搜索。' });
      }
      const excluded = new Set<string>();
      if (Array.isArray(req.body?.excludeSourceUrls)) {
        for (const value of req.body.excludeSourceUrls.slice(0, 1000)) {
          if (typeof value !== 'string') continue;
          try {
            const url = new URL(value);
            if (url.origin === 'https://elements.envato.com') excluded.add(url.href);
          } catch { /* Ignore malformed client-side history entries. */ }
        }
      }
      // Mark the old batch as discarded immediately, but let disk deletion run
      // alongside the remote search so cleanup never adds to search latency.
      void cleanupOwner(owner).catch(error => {
        console.warn('Failed to remove previous online sound preview batch:', error);
      });
      if (searching >= 4 || tickets.size >= 600 || Date.now() - (searches.get(owner) || 0) < 5000) {
        return res.status(429).json({ error: '搜索较频繁，请稍后重试。' });
      }
      if (options.reserve) {
        releaseReservation = options.reserve(req, res, ONLINE_SFX_BATCH_COMPANY_POINTS) || undefined;
        if (!releaseReservation) return;
      }
      searches.set(owner, Date.now()); searching++;
      const started = Date.now();
      try {
        const sourcePages = Array.from({ length: ONLINE_SFX_SOURCE_PAGES_PER_BATCH }, (_, index) => page + index);
        const pages = await Promise.all(sourcePages.map(async sourcePage => {
          const { data } = await boundedFetch(
            onlineSfxSearchUrl('envato', query, sourcePage),
            3 * 1024 * 1024,
            AbortSignal.timeout(20_000),
          );
          return data.toString('utf8');
        }));
        const candidates: Candidate[] = [];
        const seenCandidates = new Set<string>();
        for (const html of pages) {
          for (const candidate of parseEnvatoSearch(html, ONLINE_SFX_MAX_RESULTS)) {
            if (excluded.has(candidate.sourceUrl) || seenCandidates.has(candidate.sourceUrl)) continue;
            seenCandidates.add(candidate.sourceUrl);
            candidates.push(candidate);
            if (candidates.length === ONLINE_SFX_MAX_RESULTS) break;
          }
          if (candidates.length === ONLINE_SFX_MAX_RESULTS) break;
        }
        if (!candidates.length) {
          if (pages.some(html => /captcha|just a moment|access denied|verify you are human/i.test(html))) {
            throw fail('来源网站要求验证，请打开来源页面处理。');
          }
          return res.json({ items: [], page, nextPage: page + ONLINE_SFX_SOURCE_PAGES_PER_BATCH, elapsedMs: Date.now() - started,
            message: page > 1
              ? '当前关键词暂时没有更多未展示的音效，请换一个关键词再试。'
              : '没有找到可采集的试听，请换用简短英文关键词或打开来源搜索。' });
        }
        const items = candidates.map(({ previewUrl, ...candidate }) => {
          const item = { ...candidate, id: randomUUID() };
          tickets.set(item.id, { item, previewUrl, owner, at: Date.now() });
          return item;
        });
        recordOnlineSfxBatchUsage();
        return res.json({ items, page, nextPage: page + ONLINE_SFX_SOURCE_PAGES_PER_BATCH, elapsedMs: Date.now() - started });
      } finally { searching--; }
    } catch (error: any) {
      return res.status(error.status || 502).json({ error: error.name === 'TimeoutError' ? '来源搜索超过 20 秒，请稍后重试。' : error.message });
    } finally { releaseReservation?.(); }
  });
  router.post('/capture', async (req, res) => {
    let temp: string | undefined;
    try {
      await prune();
      const ticket = tickets.get(String(req.body?.id || ''));
      if (!ticket || ticket.owner !== options.owner(req, res)) return res.status(404).json({ error: '搜索结果已过期，请重新搜索。' });
      if (ticket.captured) return res.json(ticket.captured);
      if (ticket.pending) return res.json(await ticket.pending);
      if (capturing >= 6) return res.status(429).json({ error: '采集任务繁忙，请稍后重试该条音效。' });
      capturing++;
      const work = async () => {
        const started = Date.now();
        const { data, type } = await boundedFetch(ticket.previewUrl, MAX_BYTES, AbortSignal.timeout(25_000));
        if (/text\/|application\/(?:json|xml)/i.test(type) || data.length < 32) throw fail('来源返回的不是有效试听音频。');
        temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-audio-online-sfx-'));
        const input = path.join(temp, 'preview.mp3');
        const output = path.join(temp, 'capture.wav');
        await fs.writeFile(input, data);
        // Capture the public preview's decoded signal, retaining source overlays.
        // Local input only: FFmpeg never receives an arbitrary network URL.
        await runFile(options.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', input,
          '-vn', '-t', String(MAX_CAPTURE_SECONDS), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-y', output],
        { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
        const wav = await fs.readFile(output);
        if (wav.length < 100) throw fail('试听转换没有得到有效音频。');
        // FFmpeg's duration is read from the local WAV, not estimated from the title.
        const probe = await runFile(options.ffmpeg, ['-hide_banner', '-i', output, '-f', 'null', '-'],
          { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 });
        const match = probe.stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (!match) throw fail('无法验证采集音频的时长。');
        const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        if (!Number.isFinite(duration) || duration <= 0) throw fail('采集音频为空。');
        const fileName = `online_sfx_${randomUUID()}.wav`;
        ticket.fileName = fileName;
        await fs.mkdir(options.uploadsDir, { recursive: true });
        await fs.copyFile(output, path.join(options.uploadsDir, fileName));
        const provenance = { ...ticket.item, querySource: 'public-preview', capturedAt: new Date().toISOString(), duration };
        await fs.writeFile(path.join(options.uploadsDir, `${fileName}.source.json`), JSON.stringify(provenance));
        if (ticket.discarded) {
          await removeTicketFiles(ticket);
          throw fail('页面已刷新，本次临时试听已清理。', 410);
        }
        ticket.captured = { url: `/uploads/${fileName}`, duration, elapsedMs: Date.now() - started, limited: duration >= MAX_CAPTURE_SECONDS - 0.02 };
        return ticket.captured;
      };
      ticket.pending = work();
      try { return res.json(await ticket.pending); }
      finally { ticket.pending = undefined; capturing--; }
    } catch (error: any) {
      return res.status(error.status || 502).json({ error: error.name === 'TimeoutError' ? '试听采集超时，请重试该条音效。' :
        error.code === 'ENOENT' ? '本机音频转换组件不可用。' : '试听采集失败：' + (error.status ? error.message : '来源连接或音频转换异常，请重试。') });
    } finally {
      if (temp) await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  });
  return router;
}
