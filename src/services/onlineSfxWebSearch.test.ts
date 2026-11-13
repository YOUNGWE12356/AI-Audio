import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublicResource, publicHttpsUrl, resolvePublicAddresses } from './onlineSfxPublicFetch';
import { parseWebAudioPage, parseWebSearchLinks, searchWebSoundEffects, type WebResourceFetcher } from './onlineSfxWebSearch';

const signal = () => AbortSignal.timeout(2_000);
const publicResolver = async () => [{ address: '8.8.8.8', family: 4 }];
const page = (data: string, url: string, type = 'text/html') => ({ data: Buffer.from(data), url, type });
const searchLink = (url: string) => `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}">Sound</a>`;

test('discovery extracts engine result links, unwraps redirects, and excludes fixed sites and internal URLs', () => {
  const html = searchLink('https://sounds.example.com/whoosh?utm_source=engine')
    + searchLink('https://mixkit.co/free-sound-effects/whoosh/')
    + searchLink('https://127.0.0.1/internal')
    + searchLink('https://sounds.example.com/whoosh');
  assert.deepEqual(parseWebSearchLinks(html, 'duckduckgo'), ['https://sounds.example.com/whoosh']);
  const encoded = Buffer.from('https://sounds.example.com/hit').toString('base64url');
  assert.deepEqual(parseWebSearchLinks(`<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1${encoded}">Hit</a></h2></li>`, 'bing'),
    ['https://sounds.example.com/hit']);
});

test('audio extraction pairs gallery titles and links, handles JSON-LD and never executes page scripts', () => {
  const html = `<title>Whoosh gallery</title>
    <article><h3><a href="/wind">Wind Whoosh</a></h3><audio><source src="/wind.mp3"></audio><a download href="/wind.mp3">Download</a></article>
    <article><h3><a href="/water">Water Splash</a></h3><audio src="https://cdn.example.com/water.ogg"></audio></article>
    <article><h3>Internal Whoosh</h3><audio src="https://10.0.0.1/private.mp3"></audio></article>
    <script type="application/ld+json">{"@graph":[{"@type":"AudioObject","name":"Metal Whoosh","contentUrl":"/metal.wav","url":"/metal","author":{"name":"Artist"}}]}</script>
    <script>throw new Error('do not run me')</script>`;
  const items = parseWebAudioPage(html, 'https://sounds.example.com/gallery');
  assert.deepEqual(items.map(item => item.title), ['Wind Whoosh', 'Water Splash', 'Metal Whoosh']);
  assert.equal(items[0].sourceUrl, 'https://sounds.example.com/wind');
  assert.equal(items[0].previewUrl, 'https://sounds.example.com/wind.mp3');
  assert.equal(items[1].previewUrl, 'https://cdn.example.com/water.ogg');
  assert.equal(items[2].author, 'Artist');
  assert.deepEqual(parseWebAudioPage(html, 'https://mixkit.co/'), []);
});

test('Pond5 public metadata uses explicit catalog parsing and never pairs another site or private preview', () => {
  const html = '<script type="application/ld+json">' + JSON.stringify({ '@graph': [
    { '@type': 'AudioObject', name: 'Door Open', contentUrl: 'https://cdn.example.com/door.mp3',
      url: 'https://www.pond5.com/sound-effects/item/123-door' },
    { '@type': 'AudioObject', name: 'Wrong Source', contentUrl: 'https://cdn.example.com/wrong.mp3', url: 'https://other.example.com/sound' },
    { '@type': 'AudioObject', name: 'Private', contentUrl: 'https://127.0.0.1/audio.mp3' },
  ] }) + '</script>';
  const url = 'https://www.pond5.com/search?kw=door&media=sfx';
  assert.deepEqual(parseWebAudioPage(html, url), []);
  const parsed = parseWebAudioPage(html, url, 'Pond5');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].source, 'Pond5');
  assert.equal(parsed[0].title, 'Door Open');
  assert.equal(parsed[0].sourceUrl, 'https://www.pond5.com/sound-effects/item/123-door');
  assert.deepEqual(parseWebAudioPage(html, 'https://pond5.com.evil.example/search', 'Pond5'), []);
});

test('same-gallery audio receives distinct stable source identities when no item links exist', () => {
  const html = '<article><h3>Whoosh One</h3><audio src="/1.mp3"></audio></article>'
    + '<article><h3>Whoosh Two</h3><audio src="/2.mp3"></audio></article>';
  const first = parseWebAudioPage(html, 'https://sounds.example.com/gallery');
  assert.equal(new Set(first.map(item => item.sourceUrl)).size, 2);
  assert.deepEqual(parseWebAudioPage(html, 'https://sounds.example.com/gallery'), first);
});

test('web search falls back to the next engine and skips failed pages, dead media and unrelated sounds', async () => {
  const requested: string[] = [];
  const fetchResource: WebResourceFetcher = async (url) => {
    requested.push(url);
    if (url.includes('duckduckgo.com')) throw new Error('engine unavailable');
    if (url.includes('bing.com')) return page('<li class="b_algo"><h2><a href="https://sounds.example.com/gallery">Whoosh</a></h2></li>'
      + '<li class="b_algo"><h2><a href="https://blocked.example.com/">Whoosh</a></h2></li>', url);
    if (url.includes('blocked.example.com') || url.endsWith('/dead.mp3')) throw new Error('403');
    if (url.endsWith('.mp3')) return page('ID3' + 'x'.repeat(100), url, 'audio/mpeg');
    return page('<article><h3>Wind Whoosh</h3><audio src="/good.mp3"></audio></article>'
      + '<article><h3>Fire Crackle</h3><audio src="/fire.mp3"></audio></article>'
      + '<article><h3>Dead Whoosh</h3><audio src="/dead.mp3"></audio></article>', url);
  };
  const items = await searchWebSoundEffects({ query: 'whoosh', page: 1, signal: signal(), fetchResource });
  assert.deepEqual(items.map(item => item.title), ['Wind Whoosh']);
  assert.ok(requested.some(url => url.includes('bing.com')));
  assert.ok(!requested.some(url => url.endsWith('/fire.mp3')));
});

test('captcha or inaccessible web sources report failure; a legitimate empty search remains empty', async () => {
  await assert.rejects(searchWebSoundEffects({ query: 'whoosh', page: 1, signal: signal(),
    fetchResource: async url => page('<div class="anomaly-modal">captcha</div>', url) }), /全网搜索暂不可用/);
  assert.deepEqual(await searchWebSoundEffects({ query: 'whoosh', page: 1, signal: signal(),
    fetchResource: async url => page('<html>No matches</html>', url) }), []);
});

test('web continues to the alternate engine when thirty results do not meet the forty-result target', async () => {
  const fetchResource: WebResourceFetcher = async url => {
    if (url.includes('duckduckgo.com')) return page(searchLink('https://sounds.example.com/first'), url);
    if (url.includes('bing.com')) return page('<li class="b_algo"><h2><a href="https://sounds.example.com/second">Whoosh</a></h2></li>', url);
    if (url.endsWith('.mp3')) return page('ID3' + 'x'.repeat(100), url, 'audio/mpeg');
    const first = url.endsWith('/first');
    return page(Array.from({ length: first ? 30 : 10 }, (_, i) =>
      `<article><h3>Whoosh ${i}</h3><audio src="/${first ? 'first' : 'second'}-${i}.mp3"></audio></article>`).join(''), url);
  };
  const items = await searchWebSoundEffects({ query: 'whoosh', page: 1, signal: signal(), fetchResource });
  assert.equal(items.length, 40);
});

test('public URL and DNS checks reject private, mapped, credentialed and mixed destinations', async () => {
  for (const url of ['http://example.com/a', 'https://127.0.0.1/a', 'https://2130706433/a', 'https://[::1]/a',
    'https://[::ffff:8.8.8.8]/a', 'https://169.254.169.254/a', 'https://10.20.16.85/a',
    'https://user:pass@example.com/a', 'https://example.com:8443/a', 'https://device.local/a']) {
    assert.equal(publicHttpsUrl(url), null, url);
  }
  const url = new URL('https://sounds.example.com/a');
  assert.deepEqual(await resolvePublicAddresses(url, signal(), publicResolver), await publicResolver());
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.0.1', '::1', 'fc00::1', 'fe80::1']) {
    await assert.rejects(resolvePublicAddresses(url, signal(), async () => [
      { address: '8.8.8.8', family: 4 }, { address, family: address.includes(':') ? 6 : 4 },
    ]), /不安全/);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(resolvePublicAddresses(url, controller.signal, publicResolver));
});

test('public fetch pins resolved addresses and revalidates every redirect before connecting', async () => {
  const connected: string[] = [], resolved: string[] = [];
  const options = {
    resolver: async (host: string) => { resolved.push(host); return publicResolver(); },
    transport: async (url: URL, addresses: { address: string }[]) => {
      connected.push(url.href);
      assert.equal(addresses[0].address, '8.8.8.8');
      if (url.hostname === 'sounds.example.com') return new Response(null, { status: 302,
        headers: { location: 'https://cdn.example.com/a.mp3' } });
      return new Response('ID3audio', { headers: { 'content-type': 'audio/mpeg' } });
    },
  };
  const result = await fetchPublicResource('https://sounds.example.com/a', 100, signal(), options);
  assert.equal(result.url, 'https://cdn.example.com/a.mp3');
  assert.deepEqual(resolved, ['sounds.example.com', 'cdn.example.com']);
  assert.equal(connected.length, 2);
  let calls = 0;
  await assert.rejects(fetchPublicResource('https://sounds.example.com/a', 100, signal(), {
    resolver: publicResolver,
    transport: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }); },
  }), /不安全/);
  assert.equal(calls, 1);
});

test('public fetch bounds chunked responses, cancels large files and stops prefix probes early', async () => {
  let cancelled = false;
  const transport = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Buffer.alloc(512)); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'audio/mpeg' } });
  await assert.rejects(fetchPublicResource('https://sounds.example.com/a', 64, signal(), {
    resolver: publicResolver, transport,
  }), /大小上限/);
  assert.equal(cancelled, true);
  cancelled = false;
  const result = await fetchPublicResource('https://sounds.example.com/a', 1024, signal(), {
    resolver: publicResolver, transport, probeBytes: 64,
  });
  assert.equal(result.data.length, 64);
  assert.equal(cancelled, true);
});
