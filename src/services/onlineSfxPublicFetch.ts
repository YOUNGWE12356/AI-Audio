import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import ipaddr from 'ipaddr.js';

type Address = { address: string; family: number };
type Resolver = (hostname: string) => Promise<Address[]>;
const resolve: Resolver = hostname => lookup(hostname, { all: true, verbatim: true });

export function publicHttpsUrl(value: string, base?: string): URL | null {
  try {
    const url = new URL(value, base);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (url.protocol !== 'https:' || url.port || url.username || url.password
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return null;
    if (ipaddr.isValid(host)) {
      if (ipaddr.parse(host).range() !== 'unicast') return null;
    } else if (!host.includes('.')) return null;
    return url;
  } catch { return null; }
}

export async function resolvePublicAddresses(url: URL, signal: AbortSignal, resolver: Resolver = resolve) {
  if (!publicHttpsUrl(url.href)) throw new Error('全网来源地址不安全。');
  signal.throwIfAborted();
  const addresses = await new Promise<Address[]>((accept, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    resolver(url.hostname.replace(/^\[|\]$/g, '')).then(accept, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
  // Reject mixed public/private answers too; never let DNS choose an internal IP.
  if (!addresses.length || addresses.some(item => !ipaddr.isValid(item.address)
    || ipaddr.parse(item.address).range() !== 'unicast')) throw new Error('全网来源地址不安全。');
  return addresses;
}

type Transport = (url: URL, addresses: Address[], signal: AbortSignal) => Promise<Response>;
const pinnedRequest: Transport = (url, addresses, signal) => new Promise((accept, reject) => {
  const address = addresses.find(item => item.family === 4) || addresses[0];
  const req = request(url, {
    signal, agent: false,
    headers: { 'Accept-Encoding': 'gzip, deflate, br', 'User-Agent': 'node', Accept: '*/*', 'Accept-Language': '*', 'Sec-Fetch-Mode': 'cors' },
    // Connect to the validated IP while preserving TLS hostname verification.
    lookup: (_hostname, options, callback: any) => options.all
      ? callback(null, [address]) : callback(null, address.address, address.family),
  }, incoming => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    let body: Readable = incoming;
    const encoding = incoming.headers['content-encoding'];
    if (encoding === 'gzip' || encoding === 'br' || encoding === 'deflate') {
      const decoded = encoding === 'br' ? createBrotliDecompress() : encoding === 'gzip' ? createGunzip() : createInflate();
      incoming.on('error', error => decoded.destroy(error));
      decoded.on('close', () => incoming.destroy());
      body = incoming.pipe(decoded);
      headers.delete('content-length'); headers.delete('content-encoding');
    }
    accept(new Response(Readable.toWeb(body) as ReadableStream, { status: incoming.statusCode || 502, headers }));
  });
  req.on('error', reject); req.end();
});

/** Public HTTPS only, pinned DNS and every redirect checked; no remote URL reaches FFmpeg. */
export async function fetchPublicResource(url: string, limit: number, signal: AbortSignal, options: {
  resolver?: Resolver; transport?: Transport; probeBytes?: number;
} = {}) {
  let current = publicHttpsUrl(url);
  if (!current) throw new Error('全网来源地址不安全。');
  for (let redirects = 0; ; redirects++) {
    const addresses = await resolvePublicAddresses(current, signal, options.resolver);
    const response = await (options.transport || pinnedRequest)(current, addresses, signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      const next = location && publicHttpsUrl(location, current.href);
      if (!next || redirects >= 3) throw new Error('全网来源返回了不安全或过多的跳转。');
      current = next; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`全网来源暂不可用（HTTP ${response.status}）。`); }
    if (Number(response.headers.get('content-length') || 0) > limit) {
      await response.body?.cancel(); throw new Error('全网来源文件超出大小上限。');
    }
    if (!response.body) throw new Error('全网来源没有返回内容。');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); throw new Error('全网来源文件超出大小上限。'); }
        chunks.push(value);
        if (options.probeBytes && size >= options.probeBytes) { await reader.cancel(); break; }
      }
    } finally { reader.releaseLock(); }
    const data = Buffer.concat(chunks);
    return { data: options.probeBytes ? data.subarray(0, options.probeBytes) : data,
      type: response.headers.get('content-type') || '', url: current.href };
  }
}
