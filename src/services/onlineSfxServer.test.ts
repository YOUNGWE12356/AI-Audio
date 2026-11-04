import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import ffmpeg from 'ffmpeg-static';
import {
  allowedPreviewUrl,
  boundedFetch,
  createTimelineOnlineSfxBatchTracker,
  createOnlineSfxSearchState,
  findAndCaptureTimelineOnlineSfx,
  parseEnvatoSearch,
  parsePseSearch,
  parseEpidemicSearch,
  parseMixkitSearch,
  mixOnlineSfxCandidates,
  mixkitSearchCategories,
  searchOnlineSfxSources,
  recordOnlineSfxBatchUsage,
  recordTimelineOnlineSfxUsage,
  removeOrphanedOnlineSfxFiles,
} from './onlineSfxServer';
import {
  ONLINE_SFX_BATCH_COMPANY_POINTS,
  ONLINE_SFX_PRICING_VERSION,
  onlineSfxSearchUrl,
  ONLINE_SFX_SOURCES,
} from './onlineSfxTypes';
import { setAiUsageRecorder, type AiUsageEvent } from './usageTracking';

const card = (id: number, source = `/whoosh-${id}`, host = 'public-assets.content-platform.envatousercontent.com') => `
  <div data-testid="audio-card"><a title="Whoosh &amp; Hit ${id}" data-testid="title-link" href="${source}">title</a>
  <a href="/user/Artist/sound-effects">Artist</a><audio><source src="https://${host}/asset-${id}/preview.mp3" /></audio></div>`;

const pseCard = (id: number) => ({ source: 'PSE', artist: 'Artist', description: `Whoosh ${id}`,
  filename: `Whoosh ${id}.wav`, mp3Url: `https://prosoundeffects.blob.core.windows.net/library/mp3/Whoosh%20${id}.mp3?sig=preserved` });
const psePage = (items: unknown[]) => JSON.stringify({ result: items, totalCount: items.length });
const epidemicTrack = (id: number) => ({ isSfx: true, kosmosId: `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`,
  title: `Whoosh ${id}`, pathname: `/sound-effects/tracks/00000000-0000-0000-0000-${String(id).padStart(12, '0')}/`,
  stems: { full: { lqMp3Url: `https://audiocdn.epidemicsound.com/lqmp3/TEST${id}.mp3` } } });
const epidemicFlight = (tracks: unknown[]) => `0:{"a":"$@1"}\n1:${JSON.stringify({ tracks, meta: { totalHits: tracks.length } })}\n`;
const epidemicScript = 'https://www.epidemicsound.com/staticfiles/public-pages/_next/static/chunks/app/%5Blocale%5D/(default)/sound-effects/page-test.js';
const epidemicAction = 'a'.repeat(40);
const epidemicDiscoveryResponse = (url: URL) => url.pathname.endsWith('.js')
  ? new Response(`let c=(0,i.createServerReference)("${epidemicAction}",i.callServer,void 0,i.findSourceMapURL,"fetchSfxTracks");`)
  : new Response(`<script src="${epidemicScript}"></script>`);
const mixCard = (id: number) => `<div class="item-grid__item"><div data-audio-player-item-type-value="sfx"
  data-audio-player-item-id-value="${id}" data-audio-player-preview-url-value="https://assets.mixkit.co/active_storage/sfx/${id}/${id}-preview.mp3"></div>
  <h2 class="item-grid-card__title">Whoosh ${id}</h2></div>`;
const mixPage = (body: string) => `<h1>Free Whoosh Sound Effects</h1>${body}`;
const sampleCandidates = (source: string, count: number) => Array.from({ length: count }, (_, i) => ({
  title: `${source} ${i}`, author: '', source, sourceUrl: `https://example.com/${source}/${i}`, previewUrl: '',
}));

test('alternate parsers pair real search cards and reject unrelated or mismatched previews', () => {
  assert.equal(parsePseSearch(psePage([pseCard(123)]))[0].title, 'Whoosh 123');
  assert.equal(parsePseSearch(psePage([pseCard(123)]))[0].previewUrl, pseCard(123).mp3Url);
  assert.deepEqual(parsePseSearch(psePage([{ ...pseCard(123), source: 'Freesound' }])), []);
  assert.deepEqual(parsePseSearch(psePage([{ ...pseCard(123), mp3Url: 'https://evil.example/file.mp3' }])), []);
  assert.throws(() => parsePseSearch('{"recommendations":[]}'));
  assert.equal(parseEpidemicSearch(epidemicFlight([epidemicTrack(123)]))[0].source, 'Epidemic Sound');
  assert.deepEqual(parseEpidemicSearch(epidemicFlight([{ ...epidemicTrack(123), pathname: '/music/tracks/123/' }])), []);
  assert.throws(() => parseEpidemicSearch('<html>homepage recommendations</html>'));
  assert.equal(parseMixkitSearch(mixPage(mixCard(123)))[0].source, 'Mixkit');
  assert.deepEqual(parseMixkitSearch(mixCard(123)), []);
  assert.deepEqual(parseMixkitSearch(mixPage(mixCard(123).replace('/123/123-preview', '/123/456-preview'))), []);
  assert.equal(allowedPreviewUrl('https://assets.mixkit.co/active_storage/sfx/123/123-preview.mp3'), true);
  assert.equal(allowedPreviewUrl('https://cdn.freesound.org/previews/1/123_99-lq.mp3'), false);
  assert.equal(allowedPreviewUrl('https://cdn.freesound.org/other/file.mp3'), false);
  assert.deepEqual(mixkitSearchCategories('wooden door creaking'), ['doors']);
  assert.deepEqual(mixkitSearchCategories('unrecognised specific object'), []);
});

test('mix one hundred as fifty primary plus shared alternates, interleave and keep unused candidates', () => {
  const names = ['primary', 'pse', 'epidemic', 'mix'];
  const pools = names.map(name => sampleCandidates(name, 100));
  const result = mixOnlineSfxCandidates(pools, 100);
  assert.deepEqual(names.map(source => result.filter(item => item.source === source).length), [50, 17, 17, 16]);
  assert.equal(new Set(result.slice(0, 7).map(item => item.source)).size, 4);
  assert.deepEqual(pools.map(pool => pool.length), [50, 83, 83, 84]);
  const second = mixOnlineSfxCandidates(pools, 100);
  assert.equal(new Set([...result, ...second].map(item => item.sourceUrl)).size, 200);
});

test('redistribute quotas when primary or alternates are empty without fabricating results', () => {
  for (const counts of [[0, 100, 0], [100, 0, 0], [10, 100, 10], [50, 0, 50]]) {
    assert.equal(mixOnlineSfxCandidates(counts.map((count, i) => sampleCandidates(String(i), count)), 100).length, 100);
  }
  assert.equal(mixOnlineSfxCandidates([sampleCandidates('p', 7), [], []], 100).length, 7);
});

test('parallel search tolerates a failed primary, fills from backups and skips it during cooldown', async () => {
  let primaryCalls = 0;
  const cooldowns = new Map<string, number>();
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'elements.envato.com') { primaryCalls++; return new Response('blocked', { status: 403 }); }
    if (url.hostname === 'mixkit.co') return new Response(mixPage(''));
    if (url.hostname !== 'api.prosoundeffects.com') return new Response('unavailable', { status: 403 });
    const page = JSON.parse(String(init?.body)).pageIndex;
    return new Response(psePage(Array.from({ length: 50 }, (_, i) => pseCard(page * 100 + i))));
  };
  const state = createOnlineSfxSearchState();
  const first = await searchOnlineSfxSources({ query: 'whoosh', state, fetcher, cooldowns });
  assert.equal(first.items.length, 100);
  assert.ok(first.items.every(item => item.source === 'Pro Sound Effects'));
  assert.equal(first.sources[0].unavailable, true);
  const calls = primaryCalls;
  const second = await searchOnlineSfxSources({ query: 'whoosh', state, fetcher, cooldowns });
  assert.equal(second.items.length, 100);
  assert.equal(primaryCalls, calls);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.sourceUrl)).size, 200);
});

test('one failed source page does not discard good pages or skip the failed page on continuation', async () => {
  let failFirst = true;
  const requested: number[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== 'elements.envato.com') return new Response('<html>empty</html>');
    const page = Number(url.pathname.match(/pg-(\d+)/)?.[1] || 1);
    requested.push(page);
    if (page === 1 && failFirst) return new Response('blocked', { status: 403 });
    return new Response(Array.from({ length: 40 }, (_, i) => card(page * 100 + i)).join(''));
  };
  const state = createOnlineSfxSearchState();
  const first = await searchOnlineSfxSources({ query: 'whoosh', state, fetcher });
  assert.equal(first.items.length, 100);
  assert.ok(!first.items.some(item => item.sourceUrl.endsWith('/whoosh-100')));
  failFirst = false; requested.length = 0;
  const second = await searchOnlineSfxSources({ query: 'whoosh', state, fetcher,
    excluded: new Set(first.items.map(item => item.sourceUrl)) });
  assert.ok(requested.includes(1));
  assert.ok(second.items.some(item => item.sourceUrl.endsWith('/whoosh-100')));
  assert.equal(new Set([...first.items, ...second.items].map(item => item.sourceUrl)).size, first.items.length + second.items.length);
});

test('when Mixkit is exhausted later batches still reserve half for the remaining alternate', async () => {
  const state = createOnlineSfxSearchState();
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'elements.envato.com') {
      const page = Number(url.pathname.match(/pg-(\d+)/)?.[1] || 1);
      return new Response(Array.from({ length: 25 }, (_, i) => card(page * 100 + i)).join(''));
    }
    const page = Number(url.searchParams.get('page') || 1);
    if (url.hostname === 'mixkit.co') return new Response(mixPage(page === 1 ? Array.from({ length: 20 }, (_, i) => mixCard(i)).join('') : ''));
    if (url.hostname === 'api.prosoundeffects.com') {
      const pseIndex = JSON.parse(String(init?.body)).pageIndex;
      return new Response(psePage(Array.from({ length: 50 }, (_, i) => pseCard(pseIndex * 100 + i))));
    }
    return new Response('unavailable', { status: 403 });
  };
  const first = await searchOnlineSfxSources({ query: 'whoosh', state, fetcher });
  assert.deepEqual(first.sources.map(source => source.count), [50, 30, 0, 20, 0]);
  const second = await searchOnlineSfxSources({ query: 'whoosh', state, fetcher });
  assert.deepEqual(second.sources.map(source => source.count), [50, 50, 0, 0, 0]);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.sourceUrl)).size, 200);
});

test('four approved sources search with real protocols, cache action discovery and exclude Freesound', async () => {
  const requested: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requested.push(url.href);
    assert.ok(!url.hostname.includes('freesound'));
    if (url.hostname === 'elements.envato.com') return new Response(Array.from({ length: 80 }, (_, i) => card(i)).join(''));
    if (url.hostname === 'api.prosoundeffects.com') {
      assert.equal(init?.method, 'POST');
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.keywords, ['whoosh']);
      return new Response(psePage(Array.from({ length: 50 }, (_, i) => pseCard(body.pageIndex * 100 + i))));
    }
    if (url.hostname === 'mixkit.co') return new Response(mixPage(Array.from({ length: 30 }, (_, i) => mixCard(i)).join('')));
    if (init?.method !== 'POST') return epidemicDiscoveryResponse(url);
    assert.equal(new Headers(init.headers).get('Next-Action'), epidemicAction);
    assert.equal(JSON.parse(String(init.body))[0].filter.term, 'whoosh');
    assert.equal(url.pathname, '/sound-effects/');
    return new Response(epidemicFlight(Array.from({ length: 10 }, (_, i) => epidemicTrack(i))));
  };
  const first = await searchOnlineSfxSources({ query: 'whoosh', fetcher });
  assert.deepEqual(first.sources.map(source => source.count), [50, 20, 10, 20, 0]);
  assert.ok(first.sources.slice(0, 4).every(source => !source.unavailable));
  assert.match(first.sources[4].reason || '', /网站验证/);
  assert.equal(ONLINE_SFX_SOURCES.some(source => String(source.id) === 'freesound'), false);
  assert.equal(requested.filter(url => url === epidemicScript).length, 1);
  await searchOnlineSfxSources({ query: 'whoosh', fetcher });
  assert.equal(requested.filter(url => url === epidemicScript).length, 1);
});

test('Epidemic never treats homepage recommendations as search and recovers after an interface change', async () => {
  let broken = true;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== 'www.epidemicsound.com') return new Response('blocked', { status: 403 });
    if (init?.method !== 'POST') return epidemicDiscoveryResponse(url);
    return new Response(broken ? '<html>popular water sounds</html>' : epidemicFlight([epidemicTrack(1)]));
  };
  assert.equal((await searchOnlineSfxSources({ query: 'whoosh', fetcher })).items.length, 0);
  broken = false;
  const result = await searchOnlineSfxSources({ query: 'whoosh', fetcher });
  assert.equal(result.items[0].source, 'Epidemic Sound');
});

test('all unavailable sources are reported and return no false success candidates', async () => {
  const result = await searchOnlineSfxSources({ query: 'whoosh', fetcher: async () => new Response('blocked', { status: 403 }) });
  assert.equal(result.items.length, 0);
  assert.ok(result.sources.every(source => source.unavailable));
});

test('filter irrelevant cards before allocating site quotas, including cards tagged as water', async () => {
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname !== 'mixkit.co') return new Response('<html>no matches</html>');
    const page = Number(url.searchParams.get('page') || 1);
    if (page > 1) return new Response('<h1>Free Water Sound Effects</h1>');
    const unrelated = mixCard(2364).replace('Whoosh 2364', 'Hard pop click')
      + '<a href="/free-sound-effects/water/">Water</a>';
    return new Response('<h1>Free Water Sound Effects</h1>' + unrelated + mixCard(1).replace('Whoosh 1', 'Water flowing'));
  };
  const state = createOnlineSfxSearchState();
  const result = await searchOnlineSfxSources({ query: 'water', state, fetcher });
  assert.deepEqual(result.items.map(item => item.title), ['Water flowing']);
  assert.deepEqual(result.sources.map(source => source.count), [0, 0, 0, 1, 0]);
  assert.ok(state.every(stream => stream.buffer.every(item => item.title !== 'Hard pop click')));
});

test('an irrelevant first page does not hide matching effects on subsequent pages', async () => {
  const result = await searchOnlineSfxSources({ query: 'water', fetcher: async input => {
    const url = new URL(String(input));
    if (url.hostname !== 'mixkit.co') return new Response('<html>empty</html>');
    const page = Number(url.searchParams.get('page') || 1);
    const body = page === 1 ? mixCard(2364).replace('Whoosh 2364', 'Hard pop click')
      : page === 2 ? mixCard(9).replace('Whoosh 9', 'Water splash') : '';
    return new Response('<h1>Free Water Sound Effects</h1>' + body);
  } });
  assert.deepEqual(result.items.map(item => item.title), ['Water splash']);
});

test('search cards keep title, attribution and preview paired; deduplicate and cap at one hundred', () => {
  const result = parseEnvatoSearch(card(1) + card(1) + Array.from({ length: 124 }, (_, index) => card(index + 2)).join(''));
  assert.equal(result.length, 100);
  assert.equal(result[0].title, 'Whoosh & Hit 1');
  assert.equal(result[0].author, 'Artist');
  assert.equal(result[1].sourceUrl, 'https://elements.envato.com/whoosh-2');
  assert.match(result[1].previewUrl, /asset-2\/preview.mp3$/);
});

test('reject foreign source links, arbitrary media and empty/unrelated pages', () => {
  assert.deepEqual(parseEnvatoSearch(card(1, 'https://evil.example/item') + card(2, '/item', 'evil.example')), []);
  assert.deepEqual(parseEnvatoSearch('<html>login or no matches</html>'), []);
  assert.equal(allowedPreviewUrl('https://public-assets.content-platform.envatousercontent.com/a/preview.mp3'), true);
  for (const url of ['http://127.0.0.1/preview.mp3', 'https://evil.example/preview.mp3',
    'https://public-assets.content-platform.envatousercontent.com:8443/a/preview.mp3',
    'https://user:password@public-assets.content-platform.envatousercontent.com/a/preview.mp3',
    'https://public-assets.content-platform.envatousercontent.com.evil.example/a/preview.mp3']) {
    assert.equal(allowedPreviewUrl(url), false);
  }
});

test('keywords cannot escape the source search path', () => {
  const url = new URL(onlineSfxSearchUrl('envato', 'door?foo=1/#bang'));
  assert.equal(url.origin, 'https://elements.envato.com');
  assert.equal(url.search, ''); assert.equal(url.hash, '');
  assert.match(url.pathname, /^\/sound-effects\//);

  const secondPage = new URL(onlineSfxSearchUrl('envato', 'magic', 2));
  assert.equal(secondPage.pathname, '/sound-effects/magic/pg-2');
  assert.equal(new URL(onlineSfxSearchUrl('envato', 'magic', 1)).pathname, '/sound-effects/magic');
});

test('source fetch follows Envato canonical redirects without allowing cross-origin redirects', async () => {
  const requested: string[] = [];
  const sameOriginFetch: typeof fetch = async input => {
    requested.push(String(input));
    if (requested.length === 1) {
      return new Response(null, { status: 301, headers: { location: '/sound-effects/magic' } });
    }
    return new Response('<html>results</html>', { headers: { 'content-type': 'text/html' } });
  };
  const result = await boundedFetch(
    'https://elements.envato.com/sound-effects/Magic',
    1024,
    new AbortController().signal,
    sameOriginFetch,
  );
  assert.deepEqual(requested, [
    'https://elements.envato.com/sound-effects/Magic',
    'https://elements.envato.com/sound-effects/magic',
  ]);
  assert.equal(result.data.toString(), '<html>results</html>');

  const unsafeFetch: typeof fetch = async () => new Response(null, {
    status: 302,
    headers: { location: 'http://127.0.0.1/private' },
  });
  await assert.rejects(
    boundedFetch('https://elements.envato.com/sound-effects/Magic', 1024, new AbortController().signal, unsafeFetch),
    /不安全的跳转/,
  );
});

test('source fetch replaces low-level connection failures with an actionable message', async () => {
  let attempts = 0;
  const failingFetch: typeof fetch = async () => { attempts++; throw new TypeError('fetch failed'); };
  await assert.rejects(
    boundedFetch('https://elements.envato.com/sound-effects/magic', 1024, new AbortController().signal, failingFetch),
    /无法连接来源网站/,
  );
  assert.equal(attempts, 2);
});

test('a successful search batch records one network point with a request billing unit', () => {
  const events: AiUsageEvent[] = [];
  setAiUsageRecorder(event => events.push(event));
  try {
    recordOnlineSfxBatchUsage();
  } finally {
    setAiUsageRecorder(null);
  }
  assert.deepEqual(events, [{
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
  }]);
});

test('a timeline web match records one network point without ElevenLabs usage', () => {
  const events: AiUsageEvent[] = [];
  setAiUsageRecorder(event => events.push(event));
  try {
    recordTimelineOnlineSfxUsage();
  } finally {
    setAiUsageRecorder(null);
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].provider, 'network');
  assert.equal(events[0].model, 'multi-source-preview-timeline');
  assert.equal(events[0].companyPoints, 1);
  assert.equal(events[0].credits, 0);
});

test('timeline web search charges once per user batch after the first successful match', () => {
  let timestamp = 1_000;
  const tracker = createTimelineOnlineSfxBatchTracker({
    ttlMs: 1_000,
    now: () => timestamp,
  });

  assert.equal(tracker.hasBeenBilled('user-a', 'batch-1'), false);
  // A failed search does not call markSuccessfulBatch, so the batch stays unbilled.
  assert.equal(tracker.hasBeenBilled('user-a', 'batch-1'), false);
  assert.equal(tracker.markSuccessfulBatch('user-a', 'batch-1'), true);
  assert.equal(tracker.hasBeenBilled('user-a', 'batch-1'), true);
  assert.equal(tracker.markSuccessfulBatch('user-a', 'batch-1'), false);

  assert.equal(tracker.markSuccessfulBatch('user-a', 'batch-2'), true);
  assert.equal(tracker.markSuccessfulBatch('user-b', 'batch-1'), true);

  // Missing IDs represent independent single-clip operations.
  assert.equal(tracker.markSuccessfulBatch('user-a', ''), true);
  assert.equal(tracker.markSuccessfulBatch('user-a', ''), true);

  timestamp += 1_000;
  assert.equal(tracker.hasBeenBilled('user-a', 'batch-1'), false);
  assert.equal(tracker.markSuccessfulBatch('user-a', 'batch-1'), true);
});

test('timeline capture persists a project-safe WAV with source metadata', async () => {
  assert.ok(ffmpeg, 'ffmpeg-static is required for this integration test');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'timeline-sfx-capture-test-'));
  try {
    const preview = execFileSync(ffmpeg!, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1',
      '-ac', '2', '-ar', '44100', '-f', 'mp3', 'pipe:1',
    ], { windowsHide: true });
    const fetcher: typeof fetch = async input => {
      const url = String(input);
      if (url.startsWith('https://elements.envato.com/')) {
        return new Response(card(7), { headers: { 'content-type': 'text/html' } });
      }
      if (url.endsWith('/asset-7/preview.mp3')) {
        return new Response(preview, { headers: { 'content-type': 'audio/mpeg' } });
      }
      return new Response('missing', { status: 404 });
    };

    const result = await findAndCaptureTimelineOnlineSfx({
      query: 'whoosh hit',
      uploadsDir: directory,
      ffmpeg: ffmpeg!,
      maxDurationSeconds: 0.6,
      fetcher,
    });
    assert.ok(result);
    assert.match(result.audioUrl, /^\/uploads\/timeline_sfx_[a-f0-9-]+\.wav$/);
    assert.equal(result.title, 'Whoosh & Hit 7');
    assert.ok(result.duration > 0 && result.duration <= 0.65);
    const fileName = path.basename(result.audioUrl);
    assert.ok((await fs.stat(path.join(directory, fileName))).size > 100);
    const metadata = JSON.parse(await fs.readFile(path.join(directory, `${fileName}.source.json`), 'utf8'));
    assert.equal(metadata.sourceUrl, 'https://elements.envato.com/whoosh-7');
    assert.equal(await removeOrphanedOnlineSfxFiles(directory, Date.now() + 1000), 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('timeline search returns null when no usable web result exists', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'timeline-sfx-empty-test-'));
  try {
    const result = await findAndCaptureTimelineOnlineSfx({
      query: 'not found',
      uploadsDir: directory,
      ffmpeg: ffmpeg || 'ffmpeg',
      fetcher: async () => new Response('<html>no results</html>', { headers: { 'content-type': 'text/html' } }),
    });
    assert.equal(result, null);
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('startup cleanup removes only temporary online sound preview files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'online-sfx-cleanup-test-'));
  try {
    await Promise.all([
      fs.writeFile(path.join(directory, 'online_sfx_12345678-1234-1234-1234-123456789abc.wav'), 'wav'),
      fs.writeFile(path.join(directory, 'online_sfx_12345678-1234-1234-1234-123456789abc.wav.source.json'), '{}'),
      fs.writeFile(path.join(directory, 'unrelated.wav'), 'keep'),
    ]);
    assert.equal(await removeOrphanedOnlineSfxFiles(directory, Date.now() + 1000), 2);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['unrelated.wav']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
