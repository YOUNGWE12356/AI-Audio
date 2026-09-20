import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import test, { type TestContext } from 'node:test';
import express from 'express';
import { sealData } from 'iron-session';
import { createFeishuAuth, readFeishuAuthConfig, isLocalGuestRequest } from '../src/services/feishuAuthServer';

const config = readFeishuAuthConfig({
  FEISHU_APP_ID: 'cli_test', FEISHU_APP_SECRET: 'test-only-secret',
  FEISHU_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
});
const profile = { open_id: 'ou_test', name: '测试用户', avatar_url: 'https://example.com/avatar.png' };
const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.endsWith('/internal')) return Response.json({ code: 0, app_access_token: 'private-app-token' });
  if (url.endsWith('/access_token')) return Response.json({ code: 0, data: { access_token: 'private-user-token' } });
  return Response.json({ code: 0, data: profile });
};

async function harness(t: TestContext, options = config, fetcher = fakeFetch) {
  const app = express();
  app.use(createFeishuAuth(options, fetcher));
  app.get('/api/private', (_req, res) => res.json({ user: res.locals.feishuUser || null }));
  app.get('/uploads/test.wav', (_req, res) => res.send('audio'));
  app.get('/', (_req, res) => res.send('public login shell'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    // Node fetch rewrites Host; raw HTTP is needed to exercise a nonlocal Host.
    if (headers.has('host')) return new Promise((resolve, reject) => {
      const req = httpRequest(`${base}${path}`, { method: init?.method || 'GET', headers: Object.fromEntries(headers) }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode })));
      });
      req.on('error', reject);
      req.end();
    });
    return fetch(`${base}${path}`, { ...init, redirect: 'manual' });
  };
  const begin = async () => {
    const response = await request('/api/auth/lark');
    assert.equal(response.status, 302);
    const url = new URL(response.headers.get('location')!);
    assert.equal(url.origin, 'https://open.feishu.cn');
    assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    return { cookie, state: url.searchParams.get('state')! };
  };
  const login = async () => {
    const started = await begin();
    const response = await request(`/api/auth/callback?code=test&state=${started.state}`, { headers: { Cookie: started.cookie } });
    assert.equal(response.headers.get('location'), 'http://localhost:3000/');
    const rawCookie = response.headers.getSetCookie().find(value => value.startsWith('ai_audio_sid='))!;
    assert.match(rawCookie, /HttpOnly/);
    assert.match(rawCookie, /SameSite=Lax/i);
    return rawCookie.split(';')[0];
  };
  return { request, begin, login };
}

test('configuration is opt-in, supports OneTable aliases, and rejects partial/unsafe setup', () => {
  assert.equal(readFeishuAuthConfig({}).enabled, false);
  assert.throws(() => readFeishuAuthConfig({ FEISHU_AUTH_ENABLED: 'true' }));
  assert.throws(() => readFeishuAuthConfig({ FEISHU_APP_ID: 'partial' }));
  const env = { LARK_APP_ID: 'id', LARK_APP_SECRET: 'secret', LARK_REDIRECT_URI: 'https://audio.example.com/api/auth/callback' };
  assert.equal(readFeishuAuthConfig(env).secure, true);
  assert.throws(() => readFeishuAuthConfig({ ...env, LARK_REDIRECT_URI: 'http://audio.example.com/api/auth/callback' }));
  assert.throws(() => readFeishuAuthConfig({ ...env, SESSION_SECRET: 'short' }));
  assert.equal(config.secure, false);
});

test('guest mode remains available when authentication is not configured', async t => {
  const { request } = await harness(t, readFeishuAuthConfig({}));
  assert.deepEqual(await (await request('/api/auth/me')).json(), { enabled: false, user: null, guest: false, guestAllowed: false });
  assert.equal((await request('/api/private')).status, 200);
  assert.equal((await request('/api/auth/lark')).status, 503);
});

test('unauthenticated APIs/files reject forged client identities while login shell remains public', async t => {
  const { request } = await harness(t);
  for (const path of ['/api/private', '/uploads/test.wav']) {
    assert.equal((await request(path, { headers: { 'X-AI-Audio-Client-Id': 'feishu:ou_test' } })).status, 401);
  }
  assert.equal((await request('/')).status, 200);
  const me = await request('/api/auth/me');
  assert.equal(me.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await me.json(), { enabled: true, user: null, guest: false, guestAllowed: false });
});

test('OAuth state must belong to the initiating browser and can only be consumed once', async t => {
  const { request, begin } = await harness(t);
  const first = await begin();
  const second = await begin();
  const callback = `/api/auth/callback?code=test&state=${first.state}`;
  assert.match((await request(callback)).headers.get('location')!, /invalid_state/);
  assert.match((await request(callback, { headers: { Cookie: second.cookie } })).headers.get('location')!, /invalid_state/);
  const success = await request(callback, { headers: { Cookie: first.cookie } });
  assert.equal(success.headers.get('location'), 'http://localhost:3000/');
  assert.match((await request(callback, { headers: { Cookie: first.cookie } })).headers.get('location')!, /invalid_state/);
});

test('successful login supplies verified identity, encrypted cookie, and rejects tampered/expired sessions', async t => {
  const { request, login } = await harness(t);
  const cookie = await login();
  assert(!cookie.includes('ou_test'));
  const me = await (await request('/api/auth/me', { headers: { Cookie: cookie } })).json();
  assert.equal(me.user.openId, 'ou_test');
  assert.equal(me.user.displayName, '测试用户');
  assert(!JSON.stringify(me).includes('private-'));
  const privateResponse = await request('/api/private', { headers: { Cookie: cookie, 'X-AI-Audio-Client-Id': 'spoofed' } });
  assert.equal((await privateResponse.json()).user.openId, 'ou_test');
  const [name, value] = cookie.split('=');
  const forged = `${name}=${value.slice(0, 40)}X${value.slice(41)}`;
  assert.equal((await request('/api/private', { headers: { Cookie: forged } })).status, 401);
  const expired = await sealData({ user: me.user }, { password: config.password, ttl: -120 });
  assert.equal((await request('/api/private', { headers: { Cookie: `ai_audio_sid=${expired}` } })).status, 401);
});

test('logout clears the session and cross-origin mutations are blocked', async t => {
  const { request, login } = await harness(t);
  const cookie = await login();
  assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example' } })).status, 403);
  const response = await request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost:3000' } });
  assert.equal(response.status, 200);
  assert(response.headers.getSetCookie().some(value => value.startsWith('ai_audio_sid=;') && value.includes('Max-Age=0')));
  assert.equal((await request('/api/private')).status, 401);
});

test('provider failure returns a safe retryable login error without granting access', async t => {
  const { request, begin } = await harness(t, config, async () => { throw new Error('secret provider failure'); });
  const { cookie, state } = await begin();
  const response = await request(`/api/auth/callback?code=test&state=${state}`, { headers: { Cookie: cookie } });
  assert.match(response.headers.get('location')!, /provider_failed/);
  assert(!response.headers.get('location')!.includes('secret'));
  assert(!response.headers.getSetCookie().some(value => value.startsWith('ai_audio_sid=')));
});

test('local guest login persists without a Feishu identity and logout clears it', async t => {
  const { request } = await harness(t, { ...config, localGuestEnabled: true });
  assert.equal((await (await request('/api/auth/me')).json()).guestAllowed, true);
  assert.equal((await request('/api/private')).status, 401);
  const login = await request('/api/auth/guest', { method: 'POST' });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().find(value => value.startsWith('ai_audio_sid='))!.split(';')[0];
  const headers = { Cookie: cookie };
  assert.deepEqual(await (await request('/api/auth/me', { headers })).json(), {
    enabled: true, user: null, guest: true, guestAllowed: true,
  });
  assert.deepEqual(await (await request('/api/private', { headers })).json(), { user: null });
  assert.equal((await request('/uploads/test.wav', { headers })).status, 200);
  assert.equal((await request('/api/private', { headers: { ...headers, 'X-Forwarded-For': '192.0.2.1' } })).status, 401);
  assert.equal((await request('/api/private', { headers: { ...headers, Host: 'audio.example.com' } })).status, 401);
  const logout = await request('/api/auth/logout', { method: 'POST', headers });
  assert(logout.headers.getSetCookie().some(value => value.startsWith('ai_audio_sid=;') && value.includes('Max-Age=0')));
  assert.equal((await request('/api/private')).status, 401);
});

test('guest login requires opt-in and direct local access, and rejects cross-site requests', async t => {
  const disabled = await harness(t);
  assert.equal((await disabled.request('/api/auth/guest', { method: 'POST' })).status, 403);
  const { request } = await harness(t, { ...config, localGuestEnabled: true });
  for (const headers of [{ 'X-Forwarded-For': '192.0.2.1' }, { Host: 'audio.example.com' }, { Origin: 'https://evil.example' }]) {
    assert.equal((await request('/api/auth/guest', { method: 'POST', headers })).status, 403);
  }
  const remote = await harness(t, { ...config, localGuestEnabled: true, redirectUri: 'https://audio.example.com/api/auth/callback', secure: true });
  assert.equal((await remote.request('/api/auth/guest', { method: 'POST' })).status, 403);
  assert.equal(isLocalGuestRequest({ socket: { remoteAddress: '192.168.1.5' }, hostname: 'localhost', get: () => undefined } as unknown as express.Request), false);
});
