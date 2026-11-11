import { logEvent } from './safeLogging';
import { uploadDirectory, type UploadDirectory } from './serverSecurity';
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
  onlineSfxSearchUrl,
  type OnlineSfxItem,
  type OnlineSfxSourceStatus,
  type OnlineSfxCandidate,
} from './onlineSfxTypes';
import { recordAiUsage } from './usageTracking';
import { createOnlineSfxRelevanceMatcher } from './onlineSfxRelevance';
import { fetchPublicResource, publicHttpsUrl } from './onlineSfxPublicFetch';
import { searchWebSoundEffects } from './onlineSfxWebSearch';

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
    model: 'multi-source-preview-search',
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
    model: 'multi-source-preview-timeline',
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
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
    return (url.hostname === PREVIEW_HOST && /\/preview\.(?:mp3|m4a)$/.test(url.pathname))
      || (url.hostname === 'prosoundeffects.blob.core.windows.net' && /^\/library\/mp3\/.+\.mp3$/.test(url.pathname))
      || (url.hostname === 'audiocdn.epidemicsound.com' && /^\/lqmp3\/[A-Za-z0-9]+\.mp3$/.test(url.pathname))
      || (url.hostname === 'assets.mixkit.co' && /^\/active_storage\/sfx\/\d+\/\d+-preview\.mp3$/.test(url.pathname));
  } catch { return false; }
}

type Candidate = OnlineSfxCandidate;

export const downloadOnlineSfxPreview = (url: string, limit: number, signal: AbortSignal, fetcher?: typeof fetch) =>
  allowedPreviewUrl(url) ? boundedFetch(url, limit, signal, fetcher) : fetchPublicResource(url, limit, signal);
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
    if (sourceUrl.origin !== 'https://elements.envato.com' || !allowedPreviewUrl(preview)
      || new URL(preview).hostname !== PREVIEW_HOST || seen.has(sourceUrl.href)) continue;
    seen.add(sourceUrl.href);
    items.push({ title: decodeHtml(title), author: decodeHtml(card.match(/href="\/user\/([^/]+)\/sound-effects"/)?.[1] || ''),
      source: 'Envato Elements', sourceUrl: sourceUrl.href, previewUrl: preview });
    if (items.length === limit) break;
  }
  return items;
}

const attribute = (tag: string, name: string) => decodeHtml(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || '');

export function parsePseSearch(json: string): Candidate[] {
  const payload = JSON.parse(json);
  if (!Array.isArray(payload?.result)) throw fail('PSE 搜索数据格式已变化。');
  return payload.result.flatMap((item: any): Candidate[] => {
    // The catalog also supports third-party collections; only use the PSE store.
    if (item?.source !== 'PSE' || typeof item?.description !== 'string'
      || typeof item?.filename !== 'string' || typeof item?.mp3Url !== 'string'
      || !allowedPreviewUrl(item.mp3Url) || new URL(item.mp3Url).hostname !== 'prosoundeffects.blob.core.windows.net') return [];
    return [{ title: item.description, author: typeof item.artist === 'string' ? item.artist : '',
      source: 'Pro Sound Effects', sourceUrl: onlineSfxSearchUrl('pse', item.filename), previewUrl: item.mp3Url }];
  });
}

export function parseEpidemicSearch(flight: string): Candidate[] {
  // Parse only the public search action's JSON result, never homepage/Flight
  // recommendations. No JS evaluation or reference resolution is needed.
  for (const line of flight.split('\n')) {
    const json = line.match(/^[\da-f]+:(\{.*\})$/)?.[1];
    if (!json) continue;
    let result: any;
    try { result = JSON.parse(json); } catch { continue; }
    if (!Array.isArray(result?.tracks) || !Number.isFinite(result?.meta?.totalHits)) continue;
    return result.tracks.flatMap((track: any): Candidate[] => {
      const previewUrl = track?.stems?.full?.lqMp3Url;
      if (track?.isSfx !== true || typeof track?.title !== 'string'
        || typeof track?.kosmosId !== 'string' || !/^[a-f0-9-]{36}$/.test(track.kosmosId)
        || track.pathname !== `/sound-effects/tracks/${track.kosmosId}/`
        || typeof previewUrl !== 'string' || !allowedPreviewUrl(previewUrl)
        || new URL(previewUrl).hostname !== 'audiocdn.epidemicsound.com') return [];
      return [{ title: track.title, author: '', source: 'Epidemic Sound',
        sourceUrl: `https://www.epidemicsound.com${track.pathname}`, previewUrl }];
    });
  }
  throw fail('Epidemic 搜索接口已变化或暂不可用。');
}

const epidemicActions = new WeakMap<typeof fetch, { until: number; promise: Promise<string> }>();
async function epidemicSearchAction(signal: AbortSignal, fetcher: typeof fetch) {
  const cached = epidemicActions.get(fetcher);
  if (cached && cached.until > Date.now()) return cached.promise;
  const promise = (async () => {
    const { data } = await boundedFetch('https://www.epidemicsound.com/sound-effects/', 3 * 1024 * 1024, signal, fetcher);
    const script = [...data.toString('utf8').matchAll(/<script\b[^>]*src="([^"]+)"/g)]
      .map(match => match[1]).find(url => /^https:\/\/www\.epidemicsound\.com\/staticfiles\/public-pages\/_next\/static\/chunks\/app\/[^?#]+\/sound-effects\/page-[\w-]+\.js$/.test(url));
    if (!script) throw fail('Epidemic 搜索页面结构已变化。');
    const { data: chunk } = await boundedFetch(script, 1024 * 1024, signal, fetcher);
    const action = chunk.toString('utf8').match(/createServerReference\)\("([a-f0-9]{40,64})"[^;]{0,200}"fetchSfxTracks"/)
      || chunk.toString('utf8').match(/createServerReference\("([a-f0-9]{40,64})"[^;]{0,200}"fetchSfxTracks"/);
    if (!action) throw fail('Epidemic 搜索接口已变化。');
    return action[1];
  })();
  const entry = { until: Date.now() + 10 * 60_000, promise };
  epidemicActions.set(fetcher, entry);
  try { return await promise; } catch (error) {
    if (epidemicActions.get(fetcher) === entry) epidemicActions.delete(fetcher);
    throw error;
  }
}

export function parseMixkitSearch(html: string): Candidate[] {
  const items: Candidate[] = [];
  // Category pages contain real matching cards; never use the generic homepage.
  if (!/<h1\b[^>]*>\s*Free\s+[^<]+\s+Sound Effects\s*<\/h1>/i.test(html)) return items;
  for (const card of html.split(/class="item-grid__item"/).slice(1)) {
    const player = card.match(/<div\b[^>]*\bdata-audio-player-preview-url-value="[^"]+"[^>]*>/)?.[0];
    if (!player || attribute(player, 'data-audio-player-item-type-value') !== 'sfx') continue;
    const id = attribute(player, 'data-audio-player-item-id-value');
    const previewUrl = attribute(player, 'data-audio-player-preview-url-value');
    const title = decodeHtml(card.match(/<h2\b[^>]*class="item-grid-card__title"[^>]*>\s*([^<]+)<\/h2>/)?.[1]?.trim() || '');
    if (!/^\d+$/.test(id) || !title || !allowedPreviewUrl(previewUrl)
      || previewUrl !== `https://assets.mixkit.co/active_storage/sfx/${id}/${id}-preview.mp3`) continue;
    items.push({ title, author: '', source: 'Mixkit', sourceUrl: `https://mixkit.co/free-sound-effects/download/${id}/`, previewUrl });
  }
  return items;
}

const MIXKIT_CATEGORIES = new Set(('transition blow cinematic glitch impact slide spin stomp sweep swish swoosh thud whip whoosh woosh zoom '
  + 'nature ambience beach desert fire forest jungle morning mountain night rain rivers sea storm thunder water waterfall waves wind wood splash ocean lightning '
  + 'technology bleep buzzer camera click clock keyboard drone electricity error interface laptop light radio rewind robot static tones tv type typewriter ding '
  + 'funny fart laugh cartoon happy notification alarm alerts beep phone animals bird cat chicken cow crickets dog farm horse insect lion monkey mouse roar wolf pig '
  + 'transport airport bike boat bus engine car flying helicopter motorcycle ship siren skateboard tractor traffic train tram truck human applause baby breathe children '
  + 'clapping cough crowd cry eat falling footsteps gasp heartbeat hum hurt kiss moan party scream voices yawn teeth sad sneeze terror jump cheer walk run warfare battle '
  + 'bomb explosion fight gun hit rocket sword war boom crash instrument bass bell brass chimes choir cymbal drum flute guitar horn music orchestra rock synth violins '
  + 'whistle tap piano lifestyle appliances bar bathroom bedroom church city cleaning cooking doorbell doors drink emergency food garden hall hospital kitchen office '
  + 'restaurant school supermarket sweeping game arcade asteroid athletics ball basketball boxing casino goal golf lose monster player punch sports toy win correct laser '
  + 'wrong shot scary balloon break bubbles coin construction countdown cute fairy festive fireworks intro key halloween lock magic metal movie page paper police pop '
  + 'sparkle spell squeak tools write horror money glass wow drop sci-fi game-over video-game race-car car-horn').split(' '));
const MIXKIT_ALIASES: Record<string, string> = { door: 'doors', footstep: 'footsteps', birds: 'bird', dogs: 'dog',
  cats: 'cat', wooshes: 'whoosh', footsteps: 'footsteps', laughter: 'laugh', windstorm: 'wind' };

export function mixkitSearchCategories(query: string) {
  const words = query.toLowerCase().match(/[a-z0-9]+/g) || [];
  const phrases = [words.join('-'), ...words.map((word, index) => words.slice(index, index + 2).join('-')), ...words];
  return [...new Set(phrases.map(word => MIXKIT_ALIASES[word] || word).filter(word => MIXKIT_CATEGORIES.has(word)))].slice(0, 2);
}

const SEARCH_SOURCES = [
  { id: 'envato', name: 'Envato Elements', pages: 3, parse: parseEnvatoSearch },
  { id: 'pse', name: 'Pro Sound Effects', pages: 1, parse: parsePseSearch },
  // Public Epidemic search exposes ten results, without public pagination.
  { id: 'epidemic', name: 'Epidemic Sound', pages: 1, parse: parseEpidemicSearch },
  { id: 'mixkit', name: 'Mixkit', pages: 1, parse: parseMixkitSearch },
  { id: 'web', name: '全网搜索', pages: 1, parse: () => [] as Candidate[] },
] as const;
type SourceState = { page: number; completed: Set<number>; buffer: Candidate[]; seen: Set<string>; exhausted: boolean };
export function createOnlineSfxSearchState() {
  return SEARCH_SOURCES.map((): SourceState => ({ page: 1, completed: new Set(), buffer: [], seen: new Set(), exhausted: false }));
}

export function onlineSfxGroupTargets(limit: number) {
  const weights = [0.3, 0.3, 0.4];
  const targets = weights.map(weight => Math.floor(weight * limit));
  const order = weights.map((weight, index) => ({ index, remainder: weight * limit - targets[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0, remaining = limit - targets.reduce((a, b) => a + b, 0); i < remaining; i++) targets[order[i].index]++;
  return targets;
}

/** Envato 30%, three other catalogs together 30%, web 40%; all deficits flow both ways. */
export function mixOnlineSfxCandidates(pools: Candidate[][], limit: number): Candidate[] {
  const picked = pools.map(() => [] as Candidate[]);
  const seen = new Set<string>();
  const seenAudio = new Set<string>();
  const take = (index: number) => {
    while (pools[index]?.length) {
      const candidate = pools[index].shift()!;
      if (seen.has(candidate.sourceUrl) || candidate.previewUrl && seenAudio.has(candidate.previewUrl)) continue;
      if (candidate.previewUrl) seenAudio.add(candidate.previewUrl);
      seen.add(candidate.sourceUrl); picked[index].push(candidate); return true;
    }
    return false;
  };
  const groups = [[0], [1, 2, 3], [4]];
  const targets = onlineSfxGroupTargets(limit);
  for (let group = 0; group < groups.length; group++) {
    let count = 0;
    while (count < targets[group]) {
      let changed = false;
      for (const index of groups[group]) {
        if (count < targets[group] && take(index)) { count++; changed = true; }
      }
      if (!changed) break;
    }
  }
  while (seen.size < limit) {
    let changed = false;
    for (let index = 0; index < pools.length && seen.size < limit; index++) changed = take(index) || changed;
    if (!changed) break;
  }
  // Interleave the selected pools, so the first screen also shows alternate sites.
  const result: Candidate[] = [];
  while (picked.some(pool => pool.length)) {
    if (picked[0]?.length) result.push(picked[0].shift()!);
    for (let index = 1; index < picked.length; index++) {
      if (picked[index].length) result.push(picked[index].shift()!);
      if (picked[0]?.length) result.push(picked[0].shift()!);
    }
  }
  return result;
}

export async function searchOnlineSfxSources(options: {
  query: string; state?: ReturnType<typeof createOnlineSfxSearchState>; limit?: number;
  excluded?: Set<string>; fetcher?: typeof fetch;
  cooldowns?: Map<string, number>;
  webSearch?: typeof searchWebSoundEffects;
}) {
  const state = options.state || createOnlineSfxSearchState();
  const limit = Math.min(ONLINE_SFX_MAX_RESULTS, Math.max(1, options.limit || ONLINE_SFX_MAX_RESULTS));
  const excluded = options.excluded || new Set<string>();
  const relevance = createOnlineSfxRelevanceMatcher(options.query);
  const categories = mixkitSearchCategories(options.query);
  const unavailable = new Set<string>();
  const attempted = SEARCH_SOURCES.map(() => new Set<number>());
  const deadline = AbortSignal.timeout(16_000);
  const fill = async (index: number, count: number) => {
    const source = SEARCH_SOURCES[index], stream = state[index];
    if (stream.exhausted || deadline.aborted) return;
    if ((options.cooldowns?.get(source.id) || 0) > Date.now()) { unavailable.add(source.id); return; }
    if (source.id === 'epidemic' && stream.page > 1) { stream.exhausted = true; return; }
    if (source.id === 'mixkit' && !categories.length) { stream.exhausted = true; return; }
    const pages = Array.from({ length: Math.max(0, 51 - stream.page) }, (_, i) => stream.page + i)
      .filter(page => !stream.completed.has(page) && !attempted[index].has(page)).slice(0, count);
    if (!pages.length) { if (stream.page > 50) stream.exhausted = true; return; }
    pages.forEach(page => attempted[index].add(page));
    const responses = await Promise.allSettled(pages.map(async page => {
      if (source.id === 'web') return (options.webSearch || searchWebSoundEffects)({
        query: options.query, page, signal: AbortSignal.any([deadline, AbortSignal.timeout(12_000)]),
      });
      const queries = source.id === 'mixkit' ? categories : [options.query];
      const results = await Promise.allSettled(queries.map(async query => {
        const signal = AbortSignal.any([deadline, AbortSignal.timeout(6_000)]);
        const fetcher = options.fetcher || fetch;
        let url = onlineSfxSearchUrl(source.id, query, page);
        let request: Pick<RequestInit, 'method' | 'body' | 'headers'> = {};
        if (source.id === 'pse') {
          url = 'https://api.prosoundeffects.com/v2/Search/sounds';
          request = { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords: [query], pageIndex: page, pageSize: 50 }) };
        } else if (source.id === 'epidemic') {
          const action = await epidemicSearchAction(signal, fetcher);
          request = { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Next-Action': action, Accept: 'text/x-component' },
            body: JSON.stringify([{ filter: { term: query }, locale: 'en', sort: 'relevance' }]) };
        }
        const { data } = await boundedFetch(url, 3 * 1024 * 1024, signal, fetcher, request);
        const html = data.toString('utf8');
        const parsed = source.parse(html);
        if (!parsed.length && /captcha|just a moment|access denied|verify you are human/i.test(html)) throw fail('来源网站要求验证。');
        return parsed;
      }));
      const fulfilled = results.filter(result => result.status === 'fulfilled');
      if (!fulfilled.length) throw fail('来源搜索暂不可用。');
      return fulfilled.flatMap(result => result.value);
    }));
    let newCandidates = 0;
    // Advance only through successful consecutive pages; failed pages are retried
    // on a later batch, with deduplication covering any later page fetched here.
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      if (response.status !== 'fulfilled') continue;
      stream.completed.add(pages[i]);
      while (stream.completed.delete(stream.page)) stream.page++;
      for (const candidate of response.value) {
        const audioKey = `audio:${candidate.previewUrl}`;
        if (stream.seen.has(candidate.sourceUrl) || candidate.previewUrl && stream.seen.has(audioKey)) continue;
        stream.seen.add(candidate.sourceUrl);
        if (candidate.previewUrl) stream.seen.add(audioKey);
        newCandidates++;
        if (!excluded.has(candidate.sourceUrl) && relevance(candidate.title) > 0) stream.buffer.push(candidate);
      }
    }
    if (responses.every(response => response.status === 'rejected')) {
      unavailable.add(source.id);
      if (source.id === 'epidemic') epidemicActions.delete(options.fetcher || fetch);
      options.cooldowns?.set(source.id, Date.now() + 60_000);
    } else if (stream.page > pages[pages.length - 1] && responses.every(response => response.status === 'fulfilled'
      && (response.value.length === 0 || (source.id === 'mixkit' && !newCandidates)))) stream.exhausted = true;
  };
  for (const stream of state) stream.buffer = stream.buffer.filter(candidate => !excluded.has(candidate.sourceUrl) && relevance(candidate.title) > 0);
  const targets = onlineSfxGroupTargets(limit);
  const sourceTargets = [targets[0], ...Array(3).fill(Math.ceil(targets[1] / 3)), targets[2]];
  await Promise.all(SEARCH_SOURCES.map((source, index) => state[index].buffer.length < sourceTargets[index]
    ? fill(index, source.pages) : Promise.resolve()));
  // Backups are already queried in parallel. Fetch extra pages only if the total
  // is short; an unavailable primary never blocks successful alternate results.
  const totalAvailable = state.reduce((sum, stream) => sum + stream.buffer.length, 0);
  const alternateAvailable = state.slice(1, 4).reduce((sum, stream) => sum + stream.buffer.length, 0);
  const totalShort = totalAvailable < limit;
  const groupShort = [state[0].buffer.length < targets[0], alternateAvailable < targets[1], state[4].buffer.length < targets[2]];
  if ((totalShort || groupShort.some(Boolean)) && !deadline.aborted) {
    await Promise.all(SEARCH_SOURCES.map((source, index) => unavailable.has(source.id) || (!totalShort && !groupShort[index === 0 ? 0 : index === 4 ? 2 : 1])
      ? Promise.resolve() : fill(index, source.id === 'web' ? 1 : 2)));
  }
  for (const stream of state) stream.buffer.sort((a, b) => relevance(b.title) - relevance(a.title));
  const items = mixOnlineSfxCandidates(state.map(stream => stream.buffer), limit);
  const sources: OnlineSfxSourceStatus[] = SEARCH_SOURCES.map(source => ({ source: source.name,
    count: items.filter(item => source.id === 'web' ? item.source.startsWith('全网 · ') : item.source === source.name).length,
    unavailable: unavailable.has(source.id) }));
  sources.push({ source: 'Pond5', count: 0, unavailable: true, reason: '网站验证限制，待官方接口接入' });
  return { items, sources };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

export async function boundedFetch(
  url: string,
  limit: number,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  request: Pick<RequestInit, 'method' | 'body' | 'headers'> = {},
) {
  const initial = new URL(url);
  let current = initial;
  let response: Response;
  try {
    for (let redirects = 0; ; redirects++) {
      let connectionError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await fetcher(current, { ...request, signal, redirect: 'manual' });
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
      if (request.method === 'POST' && response.status !== 307 && response.status !== 308) {
        throw fail('来源搜索接口发生跳转，请稍后重试。');
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
  uploadsDir: UploadDirectory;
  ffmpeg: string;
  maxDurationSeconds?: number;
  fetcher?: typeof fetch;
  webSearch?: typeof searchWebSoundEffects;
}): Promise<TimelineOnlineSfxResult | null> {
  const query = options.query.trim().slice(0, 160);
  if (!query) return null;

  const fetcher = options.fetcher || fetch;
  let candidates: Candidate[];
  try {
    const result = await searchOnlineSfxSources({ query, limit: 12, fetcher: options.fetcher, webSearch: options.webSearch });
    candidates = rankTimelineCandidates(result.items, query).slice(0, 3);
  } catch (error) {
    logEvent('src/services/onlineSfxServer.ts:521', 'warn', error);
    return null;
  }

  const captureSeconds = Math.min(
    MAX_CAPTURE_SECONDS,
    Math.max(0.5, Number(options.maxDurationSeconds) || MAX_CAPTURE_SECONDS),
  );
  for (const candidate of candidates) {
    let temp: string | undefined;
    try {
      const { data, type } = await downloadOnlineSfxPreview(
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
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe',
        '-format_whitelist', 'mp3,wav,ogg,mov,flac,aac', '-i', input,
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
      await fs.mkdir(uploadDirectory(options.uploadsDir), { recursive: true });
      await fs.copyFile(output, path.join(uploadDirectory(options.uploadsDir), fileName));
      await fs.writeFile(
        path.join(uploadDirectory(options.uploadsDir), `${fileName}.source.json`),
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
      logEvent('src/services/onlineSfxServer.ts:586', 'warn', error);
    } finally {
      if (temp) await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  }
  return null;
}

export function createOnlineSfxRouter(options: {
  uploadsDir: UploadDirectory; ffmpeg: string;
  owner: (req: express.Request, res: express.Response) => string;
  reserve?: (req: express.Request, res: express.Response, points: number) => (() => void) | null;
}) {
  const router = express.Router();
  type Ticket = { item: OnlineSfxItem; previewUrl: string; owner: string; at: number;
    pending?: Promise<unknown>; captured?: unknown; fileName?: string; directory?: string; discarded?: boolean };
  const tickets = new Map<string, Ticket>();
  const searches = new Map<string, number>();
  const sessions = new Map<string, { query: string; nextPage: number; at: number; state: ReturnType<typeof createOnlineSfxSearchState> }>();
  const cooldowns = new Map<string, number>();
  let searching = 0, capturing = 0;

  const removeTicketFiles = async (ticket: Ticket) => {
    if (!ticket.fileName || !ticket.directory) return;
    const fileName = ticket.fileName;
    ticket.fileName = undefined;
    await Promise.all([
      fs.rm(path.join(ticket.directory!, fileName), { force: true }),
      fs.rm(path.join(ticket.directory!, `${fileName}.source.json`), { force: true }),
    ]);
  };
  const discardTicket = async (id: string, ticket: Ticket) => {
    ticket.discarded = true;
    if (ticket.pending) {
      void ticket.pending.then(() => removeTicketFiles(ticket), () => removeTicketFiles(ticket))
        .catch(error => logEvent('src/services/onlineSfxServer.ts:621', 'warn', error))
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
    for (const [id, session] of sessions) if (Date.now() - session.at > TTL) sessions.delete(id);
  };

  const orphanCutoff = Date.now();
  if (typeof options.uploadsDir === 'string') void removeOrphanedOnlineSfxFiles(options.uploadsDir, orphanCutoff).catch(error => {
    logEvent('src/services/onlineSfxServer.ts:643', 'warn', error);
  });

  router.post('/cleanup', async (req, res) => {
    try {
      const owner = options.owner(req, res);
      if (!owner || owner === 'unknown') return res.status(401).json({ error: '无法识别当前会话。' });
      sessions.delete(owner);
      void cleanupOwner(owner).catch(error => {
        logEvent('src/services/onlineSfxServer.ts:652', 'warn', error);
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
            const url = publicHttpsUrl(value);
            if (url) excluded.add(url.href);
          } catch { /* Ignore malformed client-side history entries. */ }
        }
      }
      // Mark the old batch as discarded immediately, but let disk deletion run
      // alongside the remote search so cleanup never adds to search latency.
      void cleanupOwner(owner).catch(error => {
        logEvent('src/services/onlineSfxServer.ts:684', 'warn', error);
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
        let session = sessions.get(owner);
        if (page === 1) {
          session = { query, nextPage: 1, at: Date.now(), state: createOnlineSfxSearchState() };
          sessions.set(owner, session);
          while (sessions.size > 64) sessions.delete(sessions.keys().next().value!);
        }
        if (!session || session.query !== query || session.nextPage !== page) {
          return res.status(409).json({ error: '搜索批次已过期，请刷新后重新搜索。' });
        }
        session.at = Date.now();
        const { items: candidates, sources } = await searchOnlineSfxSources({ query, state: session.state, excluded, cooldowns });
        if (!candidates.length && sources.every(source => source.unavailable)) throw fail('所有音效来源暂不可用，请稍后重试。');
        session.nextPage = page + 1;
        if (!candidates.length) {
          return res.json({ items: [], sources, page, nextPage: session.nextPage, elapsedMs: Date.now() - started,
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
        return res.json({ items, sources, page, nextPage: session.nextPage, elapsedMs: Date.now() - started });
      } finally { searching--; }
    } catch (error: any) {
      return res.status(error.status || 502).json({ error: error.name === 'TimeoutError' ? '来源搜索超时，请稍后重试。' : error.message });
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
        const { data, type } = await downloadOnlineSfxPreview(ticket.previewUrl, MAX_BYTES, AbortSignal.timeout(25_000));
        if (/text\/|application\/(?:json|xml)/i.test(type) || data.length < 32) throw fail('来源返回的不是有效试听音频。');
        temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-audio-online-sfx-'));
        const input = path.join(temp, 'preview.mp3');
        const output = path.join(temp, 'capture.wav');
        await fs.writeFile(input, data);
        // Capture the public preview's decoded signal, retaining source overlays.
        // Local input only: FFmpeg never receives an arbitrary network URL.
        await runFile(options.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe',
          '-format_whitelist', 'mp3,wav,ogg,mov,flac,aac', '-i', input,
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
        ticket.fileName = fileName; ticket.directory = uploadDirectory(options.uploadsDir);
        await fs.mkdir(uploadDirectory(options.uploadsDir), { recursive: true });
        await fs.copyFile(output, path.join(uploadDirectory(options.uploadsDir), fileName));
        const provenance = { ...ticket.item, querySource: 'public-preview', capturedAt: new Date().toISOString(), duration };
        await fs.writeFile(path.join(uploadDirectory(options.uploadsDir), `${fileName}.source.json`), JSON.stringify(provenance));
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
