import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { fetchPublicResource, publicHttpsUrl } from './onlineSfxPublicFetch';
import { createOnlineSfxRelevanceMatcher } from './onlineSfxRelevance';
import type { OnlineSfxCandidate } from './onlineSfxTypes';

const FIXED_HOSTS = ['elements.envato.com', 'prosoundeffects.com', 'epidemicsound.com', 'mixkit.co', 'pond5.com'];
const externalHost = (url: URL) => !FIXED_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
const audioPath = (url: string) => /\.(?:mp3|wav|ogg|m4a|aac|flac)(?:$|[?#])/i.test(url);
export type WebResourceFetcher = typeof fetchPublicResource;

export function parseWebSearchLinks(html: string, engine: 'duckduckgo' | 'bing') {
  const $ = load(html);
  const links: string[] = [];
  $(engine === 'duckduckgo' ? 'a.result__a, a.result-link' : 'li.b_algo h2 a').each((_, element) => {
    try {
      const raw = $(element).attr('href');
      if (!raw) return;
      let url = new URL(raw, engine === 'duckduckgo' ? 'https://duckduckgo.com' : 'https://www.bing.com');
      if (url.hostname.endsWith('duckduckgo.com') && url.searchParams.has('uddg')) url = new URL(url.searchParams.get('uddg')!);
      if (url.hostname === 'www.bing.com' && url.pathname === '/ck/a') {
        const encoded = url.searchParams.get('u') || '';
        if (!encoded.startsWith('a1')) return;
        url = new URL(Buffer.from(encoded.slice(2), 'base64url').toString('utf8'));
      }
      const safe = publicHttpsUrl(url.href);
      if (!safe || !externalHost(safe) || /(?:^|\.)(?:bing|duckduckgo)\.com$/.test(safe.hostname)) return;
      safe.hash = '';
      for (const key of [...safe.searchParams.keys()]) if (/^utm_|^(?:ref|fbclid|gclid)$/.test(key)) safe.searchParams.delete(key);
      if (!links.includes(safe.href)) links.push(safe.href);
    } catch { /* Ignore malformed or unsupported search links. */ }
  });
  return links.slice(0, 12);
}

/** Extract only audio URLs published by the page, paired with the same item's title. */
export function parseWebAudioPage(html: string, pageUrl: string, catalog?: 'Pond5'): OnlineSfxCandidate[] {
  const page = publicHttpsUrl(pageUrl);
  const allowedPage = (url: URL) => catalog === 'Pond5'
    ? /^(?:www\.)?pond5\.com$/.test(url.hostname) : externalHost(url);
  if (!page || !allowedPage(page)) return [];
  const $ = load(html);
  const items: OnlineSfxCandidate[] = [];
  const seen = new Set<string>();
  const pageTitle = $('meta[property="og:title"]').attr('content') || $('h1').first().text() || $('title').text();
  const add = (raw: unknown, title: unknown, link?: string, author = '') => {
    if (items.length >= 60 || typeof raw !== 'string' || typeof title !== 'string') return;
    const preview = publicHttpsUrl(raw, page.href);
    const name = title.replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!preview || !name || seen.has(preview.href)) return;
    const source = publicHttpsUrl(link || '', page.href) || new URL(page.href);
    if (!allowedPage(source)) return;
    // Gallery pages can expose many distinct audios without individual item URLs.
    if (!link || source.href === page.href || audioPath(source.href)) {
      source.href = page.href;
      source.hash = `audio-${createHash('sha256').update(preview.href).digest('hex').slice(0, 12)}`;
    }
    seen.add(preview.href);
    items.push({ title: name, author, source: catalog || `全网 · ${page.hostname.replace(/^www\./, '')}`,
      sourceUrl: source.href, previewUrl: preview.href });
  };
  const selector = 'audio[src], audio source[src], [data-preview-url], [data-audio-url], [data-track-url], a[download], button[onclick]';
  $(selector).each((_, element) => {
    const node = $(element);
    const raw = node.attr('src') || node.attr('data-preview-url') || node.attr('data-audio-url') || node.attr('data-track-url')
      || (node.is('a') && audioPath(node.attr('href') || '') ? node.attr('href') : '')
      || node.attr('onclick')?.match(/\bplay\(\s*['"]([^'"]+\.(?:mp3|wav|ogg|m4a)(?:\?[^'"]*)?)['"]/i)?.[1];
    if (!raw) return;
    let scope = node.parent();
    for (let depth = 0; depth < 5 && scope.length && !scope.is('body, html'); depth++, scope = scope.parent()) {
      if (scope.find('h2,h3,h4,.sound-title,.instant-link,[data-title]').length
        || scope.is('article,li,.instant,.sound-container,[class*="audio-card"],[class*="sound-card"]')) break;
    }
    const heading = scope.find('h2,h3,h4,.sound-title,.instant-link,[data-title]').first();
    const title = node.attr('data-title') || heading.text().trim() || heading.attr('data-title')
      || node.attr('download')?.replace(/\.(?:mp3|wav|ogg|m4a)$/i, '')
      || node.attr('title')?.replace(/^play\s+|\s+sound$/gi, '')
      || ($('audio').length === 1 ? pageTitle : '');
    const link = heading.closest('a[href]').attr('href') || heading.find('a[href]').first().attr('href')
      || scope.find('a.instant-link[href]').first().attr('href');
    add(raw, title, link);
  });
  $('script[type="application/ld+json"]').each((_, element) => {
    const visit = (value: any, depth: number) => {
      if (!value || typeof value !== 'object' || depth > 12) return;
      if (value['@type'] === 'AudioObject' || Array.isArray(value['@type']) && value['@type'].includes('AudioObject')) {
        add(value.contentUrl, value.name, typeof value.url === 'string' ? value.url : undefined,
          typeof value.author?.name === 'string' ? value.author.name : '');
      }
      for (const child of Object.values(value)) if (child && typeof child === 'object') {
        if (Array.isArray(child)) child.slice(0, 100).forEach(item => visit(item, depth + 1));
        else visit(child, depth + 1);
      }
    };
    try { visit(JSON.parse($(element).text()), 0); } catch { /* No script evaluation. */ }
  });
  const ogAudio = $('meta[property="og:audio"],meta[property="og:audio:url"],meta[property="og:audio:secure_url"]').first().attr('content');
  if (ogAudio) add(ogAudio, pageTitle);
  return items;
}

export async function searchWebSoundEffects(options: {
  query: string; page: number; signal: AbortSignal; fetchResource?: WebResourceFetcher;
}) {
  const read = options.fetchResource || fetchPublicResource;
  const query = `${options.query} sound effect mp3`;
  const encoded = new URLSearchParams({ q: query }).toString().slice(2);
  const offset = (options.page - 1) * 10;
  const engines = [
    { id: 'duckduckgo' as const, url: `https://html.duckduckgo.com/html/?q=${encoded}${offset ? `&s=${offset}` : ''}` },
    { id: 'bing' as const, url: `https://www.bing.com/search?q=${encoded}&first=${offset + 1}` },
  ];
  const relevance = createOnlineSfxRelevanceMatcher(options.query);
  const seenPages = new Set<string>();
  const seenAudio = new Set<string>();
  const candidates: OnlineSfxCandidate[] = [];
  let searchSucceeded = false;
  let pageSucceeded = false;
  for (const engine of engines) {
    if (options.signal.aborted || candidates.length >= 40) break;
    let links: string[];
    try {
      const result = await read(engine.url, 2 * 1024 * 1024, options.signal);
      const html = result.data.toString('utf8');
      links = parseWebSearchLinks(html, engine.id).filter(url => !seenPages.has(url));
      if (/captcha|anomaly-modal|verify you are human|just a moment/i.test(html) && !links.length) throw new Error('搜索引擎要求验证。');
      searchSucceeded = true;
    } catch { continue; }
    const discovered: OnlineSfxCandidate[] = [];
    let cursor = 0;
    await Promise.allSettled(Array.from({ length: Math.min(4, links.length) }, async () => {
      while (cursor < links.length && !options.signal.aborted) {
        const url = links[cursor++]; seenPages.add(url);
        try {
          const page = await read(url, 3 * 1024 * 1024,
            AbortSignal.any([options.signal, AbortSignal.timeout(4_000)]));
          if (!/text\/html|application\/xhtml/i.test(page.type)) continue;
          pageSucceeded = true;
          for (const item of parseWebAudioPage(page.data.toString('utf8'), page.url)) {
            if (relevance(item.title) <= 0 || seenAudio.has(item.previewUrl)) continue;
            seenAudio.add(item.previewUrl); discovered.push(item);
          }
        } catch { /* One inaccessible page never discards the other pages. */ }
      }
    }));
    // Spread probes across discovered websites rather than letting the fastest
    // gallery consume the whole web quota. Dead previews never enter the pool.
    const websites = new Map<string, OnlineSfxCandidate[]>();
    for (const item of discovered) {
      const pool = websites.get(item.source) || [];
      pool.push(item); websites.set(item.source, pool);
    }
    const probeQueue: OnlineSfxCandidate[] = [];
    while (probeQueue.length < 100 && [...websites.values()].some(pool => pool.length)) {
      for (const pool of websites.values()) if (pool.length && probeQueue.length < 100) probeQueue.push(pool.shift()!);
    }
    let probeCursor = 0;
    const verified = new Map<number, OnlineSfxCandidate>();
    await Promise.allSettled(Array.from({ length: Math.min(6, probeQueue.length) }, async () => {
      while (probeCursor < probeQueue.length && !options.signal.aborted) {
        const index = probeCursor++, item = probeQueue[index];
        try {
          const preview = await read(item.previewUrl, 20 * 1024 * 1024,
            AbortSignal.any([options.signal, AbortSignal.timeout(2_500)]), { probeBytes: 512 });
          const magic = preview.data.subarray(0, 16).toString('latin1');
          const audioHeader = /^(?:ID3|OggS|fLaC|RIFF)/.test(magic) || magic.slice(4, 8) === 'ftyp'
            || preview.data[0] === 0xff && (preview.data[1] & 0xe0) === 0xe0;
          if (preview.data.length >= 32 && !/text\/|application\/(?:json|xml)/i.test(preview.type)
            && (audioHeader || /^audio\//i.test(preview.type))) verified.set(index, item);
        } catch { /* A failed media URL is filled by another website or catalog. */ }
      }
    }));
    candidates.push(...[...verified.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item));
  }
  if (!candidates.length && (!searchSucceeded || seenPages.size > 0 && !pageSucceeded)) {
    throw new Error('全网搜索暂不可用，已使用其他音效来源。');
  }
  return candidates;
}
