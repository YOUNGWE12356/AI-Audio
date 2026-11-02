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
  findAndCaptureTimelineOnlineSfx,
  parseEnvatoSearch,
  recordOnlineSfxBatchUsage,
  recordTimelineOnlineSfxUsage,
  removeOrphanedOnlineSfxFiles,
} from './onlineSfxServer';
import {
  ONLINE_SFX_BATCH_COMPANY_POINTS,
  ONLINE_SFX_PRICING_VERSION,
  onlineSfxSearchUrl,
} from './onlineSfxTypes';
import { setAiUsageRecorder, type AiUsageEvent } from './usageTracking';

const card = (id: number, source = `/whoosh-${id}`, host = 'public-assets.content-platform.envatousercontent.com') => `
  <div data-testid="audio-card"><a title="Whoosh &amp; Hit ${id}" data-testid="title-link" href="${source}">title</a>
  <a href="/user/Artist/sound-effects">Artist</a><audio><source src="https://${host}/asset-${id}/preview.mp3" /></audio></div>`;

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
  assert.equal(events[0].model, 'envato-preview-timeline');
  assert.equal(events[0].companyPoints, 1);
  assert.equal(events[0].credits, 0);
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
