import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertPrivateEnvironment, createServerSecurity, createRateLimiter, currentUploadDirectory,
  currentUserId, privateDownload, resolvePrivateDownload, sanitizeResponse, verifyPassword,
} from './serverSecurity';
import { createAudioDesignJobs } from './audioDesignJobsServer';
import { createAssistantAgentRouter } from './assistantAgentServer';
import { createSfxRequirementsJobs } from './sfxRequirementsJobs';
import { logEvent } from './safeLogging';
import { readFeishuAuthConfig } from './feishuAuthServer';

const password = 'test-only-long-account-password';
const adminPassword = 'test-only-strong-management-password';
const salt = randomBytes(16);
const passwordHash = `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
const accounts = JSON.stringify(['alice', 'bob'].map(id => ({ id, displayName: id, passwordHash })));
const origin = 'https://audio.example.test';
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ai-audio-security-'));

test('Feishu OAuth preserves trusted identity, binds one-use state and revokes logout sessions', async t => {
  const directory = temp(); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const env = { APP_ORIGIN: origin, FEISHU_AUTH_ENABLED: 'true', FEISHU_APP_ID: 'test-app',
    FEISHU_APP_SECRET: 'test-secret', FEISHU_REDIRECT_URI: `${origin}/api/auth/callback`, AUTH_USERS_JSON: accounts };
  assert.throws(() => readFeishuAuthConfig({ FEISHU_AUTH_ENABLED: 'true' }));
  assert.throws(() => readFeishuAuthConfig({ ...env, FEISHU_REDIRECT_URI: 'https://audio.example.test/wrong' }));
  assert.throws(() => createServerSecurity({ privateRoot: directory, env: { ...env, APP_ORIGIN: 'https://other.test' } }));
  assert.throws(() => readFeishuAuthConfig({ ...env, NODE_ENV: 'production', FEISHU_REDIRECT_URI: 'http://localhost/api/auth/callback' }));
  let now = Date.now(), calls = 0;
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls++;
    assert.match(url, /^https:\/\/open\.feishu\.cn\/open-apis\//);
    if (url.endsWith('auth/v3/app_access_token/internal')) {
      assert.equal(JSON.parse(String(init?.body)).app_secret, 'test-secret');
      return Response.json({ code: 0, app_access_token: 'app-token' });
    }
    if (url.endsWith('authen/v1/oidc/access_token')) return Response.json({ code: 0, data: { access_token: 'user-token' } });
    return Response.json({ code: 0, data: { open_id: 'ou_alice', name: 'Alice', avatar_url: 'https://images.example.test/alice.png' } });
  }) as typeof fetch;
  const security = createServerSecurity({ privateRoot: directory, env, now: () => now, fetcher });
  const app = express();
  app.use('/auth', security.router); app.use('/api/auth', security.router);
  app.use(security.authenticate);
  app.get('/api/identity', (_req, res) => res.json({ id: currentUserId(), source: res.locals.authUser.identitySource }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (url: string, cookie = '', init: RequestInit = {}) => fetch(base + url, {
    ...init, redirect: 'manual', headers: { Origin: origin, Cookie: cookie, ...init.headers },
  });
  assert.equal((await request('/auth/login')).headers.get('location'), '/');
  assert.equal((await request('/auth/login', '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'alice', password }) })).status, 403);
  assert.equal((await request('/api/auth/guest', '', { method: 'POST' })).status, 403);
  const begin = async () => {
    const response = await request('/api/auth/lark');
    const target = new URL(response.headers.get('location')!);
    assert.equal(target.origin, 'https://open.feishu.cn');
    assert.equal(target.searchParams.get('redirect_uri'), env.FEISHU_REDIRECT_URI);
    assert.match(response.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax;.*Secure/);
    return { state: target.searchParams.get('state')!, cookie: response.headers.get('set-cookie')!.split(';')[0] };
  };
  const stolen = await begin();
  assert.match((await request(`/api/auth/callback?state=${stolen.state}&code=code`)).headers.get('location')!, /login_failed/);
  assert.equal(calls, 0);
  assert.match((await request(`/api/auth/callback?state=${stolen.state}&code=code`, stolen.cookie)).headers.get('location')!, /login_failed/);
  const expired = await begin(); now += 5 * 60_000 + 1;
  assert.match((await request(`/api/auth/callback?state=${expired.state}&code=code`, expired.cookie)).headers.get('location')!, /login_failed/);
  assert.equal(calls, 0);
  const flow = await begin();
  const callback = await request(`/api/auth/callback?state=${flow.state}&code=code`, flow.cookie);
  assert.equal(callback.headers.get('location'), `${origin}/`);
  const authCookie = callback.headers.getSetCookie().find(value => value.startsWith('__Host-ai_audio_session='))!.split(';')[0];
  assert.equal(calls, 3);
  assert.deepEqual(await (await request('/api/identity', authCookie, { headers: { 'x-ai-audio-client-id': 'ou_bob' } })).json(), { id: 'feishu:ou_alice', source: 'feishu' });
  const me = await (await request('/api/auth/me', authCookie)).json();
  assert.equal(me.user.openId, 'ou_alice');
  assert.doesNotMatch(JSON.stringify(me), /user-token|app-token|test-secret/);
  assert.match((await request(`/api/auth/callback?state=${flow.state}&code=code`, flow.cookie)).headers.get('location')!, /login_failed/);
  assert.equal(calls, 3);
  assert.equal((await request('/api/auth/logout', authCookie, { method: 'POST', headers: { Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await request('/api/identity', authCookie)).status, 200);
  assert.equal((await request('/api/auth/logout', authCookie, { method: 'POST' })).status, 200);
  assert.equal((await request('/api/identity', authCookie)).status, 401);
  assert.equal((await (await request('/api/auth/me', authCookie)).json()).user, null);
});

test('scrypt passwords and unsafe configuration fail closed', async () => {
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword('wrong', passwordHash), false);
  assert.equal(await verifyPassword(password, 'md5$anything'), false);
  assert.throws(() => assertPrivateEnvironment({ VITE_ELEVENLABS_API_KEY: 'secret' }));
  assert.throws(() => assertPrivateEnvironment({ NEXT_PUBLIC_DB_PASSWORD: 'secret' }));
  assert.throws(() => assertPrivateEnvironment({ SFX_LIBRARY_ADMIN_PASSWORD: 'weak' }));
  assert.throws(() => createServerSecurity({ privateRoot: '/unused', env: { NODE_ENV: 'production' } }));
  assert.throws(() => createServerSecurity({ privateRoot: '/unused', env: { AUTH_USERS_JSON: '[{"id":"alice"}]' } }));
});

test('realpath download checks reject traversal, symlinks, manifests and dotfiles', t => {
  const directory = temp(); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'private'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(directory, '.env'), 'SECRET_SENTINEL');
  fs.writeFileSync(path.join(root, 'audio.wav'), 'audio');
  fs.writeFileSync(path.join(root, 'job.json'), '{}');
  fs.writeFileSync(path.join(root, 'audio.wav.source.json'), '{}');
  try { fs.symlinkSync(path.join(directory, '.env'), path.join(root, 'link.wav')); }
  catch (error) { if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error; t.diagnostic('Windows symlink creation requires developer mode; traversal and missing-link checks still run.'); }
  assert.equal(resolvePrivateDownload(root, 'audio.wav'), fs.realpathSync(path.join(root, 'audio.wav')));
  for (const name of ['../.env', 'x/../../.env', '.env', 'job.json', 'audio.wav.source.json', 'link.wav', '/audio.wav', 'a\\b']) {
    assert.equal(resolvePrivateDownload(root, name), null, name);
  }
});

test('response filtering never returns raw nested errors and the limiter enforces its bound', () => {
  const value = sanitizeResponse({ status: 'failed', error: 'API_KEY_SENTINEL', message: '/private/internal', nested: { error: 'stack' }, result: 42 });
  assert.equal(value.result, 42);
  assert.doesNotMatch(JSON.stringify(value), /API_KEY_SENTINEL|\/private|stack/);
  const allow = createRateLimiter(2, 60_000);
  assert.equal(allow('alice'), true); assert.equal(allow('alice'), true); assert.equal(allow('alice'), false);
  assert.equal(allow('bob'), true);
  const original = console.error;
  const lines: string[] = [];
  try {
    console.error = message => { lines.push(String(message)); };
    logEvent('provider.failure', 'error', Object.assign(new Error('PASSWORD_SENTINEL /private/path'), { code: 'EIO', body: 'TOKEN_SENTINEL' }));
    assert.match(lines[0], /EIO/);
    assert.doesNotMatch(lines[0], /PASSWORD_SENTINEL|TOKEN_SENTINEL|private/);
  } finally { console.error = original; }
});

test('authenticated middleware isolates files/jobs, revokes sessions and rejects active uploads', async t => {
  const directory = temp(); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = Date.now();
  const security = createServerSecurity({ privateRoot: path.join(directory, 'uploads'), now: () => now,
    env: { APP_ORIGIN: origin, AUTH_USERS_JSON: accounts, SFX_LIBRARY_ADMIN_PASSWORD: adminPassword } });
  const app = express();
  app.use('/auth', security.router);
  app.use(security.authenticate, security.resourceLimits, express.json());
  app.get('/api/me', (_req, res) => res.json({ id: currentUserId() }));
  app.post('/api/file', (_req, res) => {
    fs.writeFileSync(path.join(currentUploadDirectory(), 'same-name.txt'), currentUserId());
    fs.writeFileSync(path.join(currentUploadDirectory(), 'untrusted.html'), '<script>sentinel</script>');
    res.json({ ok: true });
  });
  app.get('/uploads/*', (req, res, next) => privateDownload(currentUploadDirectory(), req.params[0], res, next));
  app.post('/api/admin/login', (req, res) => { const result = security.elevateAdmin(req, req.body.password); res.status(result.status).json(result); });
  app.post('/api/admin/logout', (req, res) => { security.revokeAdmin(req); res.json({ ok: true }); });
  app.get('/api/admin', security.requireAdmin, (_req, res) => res.json({ ok: true }));
  app.get('/api/error', (_req, res) => res.status(500).json({ error: 'SECRET_SENTINEL /private/path stack' }));
  app.use('/api/design', createAudioDesignJobs({ directory: path.join(directory, 'design'), identity: currentUserId,
    normalize: input => input, reserve: () => () => {}, run: (_req, _res, work) => { void work(); },
    execute: async () => ({ private: 'ALICE_RESULT' }) as any }));
  app.use('/api/assistant', createAssistantAgentRouter({ uploadsDir: currentUploadDirectory, manifestDir: path.join(directory, 'assistant'),
    ffmpegBinary: 'unused', identity: currentUserId, duration: async () => 1 }));
  app.use('/api/requirements', createSfxRequirementsJobs({ directory: path.join(directory, 'requirements'), identity: currentUserId,
    normalize: input => input, reserve: () => () => {}, run: (_req, _res, work) => { void work(); },
    execute: async () => ({ items: [{ private: 'ALICE_REQUIREMENTS' }] }) }));
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 500).json({ error: 'Request failed' }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (url: string, cookie = '', options: RequestInit = {}) => fetch(base + url, {
    ...options, headers: { Origin: origin, Cookie: cookie, ...options.headers }, redirect: 'manual',
  });
  const login = async (id: string) => {
    const response = await request('/auth/login', '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, password }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict;.*Secure/);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  assert.equal((await request('/api/me', '', { headers: { 'x-ai-audio-client-id': 'victim' } })).status, 401);
  const alice = await login('alice'), bob = await login('bob');
  const identity = await (await request('/api/me', alice, { headers: { 'x-ai-audio-client-id': 'bob' } })).json();
  assert.equal(identity.id, 'account:alice');
  assert.equal((await request('/api/file', alice, { method: 'POST', headers: { Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await request('/api/file', alice, { method: 'POST' })).status, 200);
  assert.equal(await (await request('/uploads/same-name.txt', alice)).text(), 'account:alice');
  assert.equal((await request('/uploads/same-name.txt', bob)).status, 404);
  assert.equal((await request('/uploads/same-name.txt')).status, 401);
  const html = await request('/uploads/untrusted.html', alice);
  assert.match(html.headers.get('content-disposition')!, /^attachment;/);
  assert.match(html.headers.get('content-security-policy')!, /sandbox/);
  assert.match(html.headers.get('content-type')!, /application\/octet-stream/);
  const form = new FormData(); form.set('prompt', 'test'); form.append('files', new Blob(['<script>sentinel</script>']), 'active.html');
  assert.equal((await request('/api/assistant/jobs', alice, { method: 'POST', body: form })).status, 415);
  assert.equal((await request('/api/admin', alice)).status, 403);
  assert.equal((await request('/api/admin/login', alice, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })).status, 403);
  const elevation = await request('/api/admin/login', alice, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword }) });
  assert.equal(elevation.status, 200); assert.equal((await elevation.json()).token, undefined);
  assert.equal((await request('/api/admin', alice)).status, 200);
  assert.equal((await request('/api/admin', bob)).status, 403);
  await request('/api/admin/logout', alice, { method: 'POST' });
  assert.equal((await request('/api/admin', alice)).status, 403);
  await request('/api/admin/login', alice, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword }) });
  now += 31 * 60_000; assert.equal((await request('/api/admin', alice)).status, 403);
  const design = await (await request('/api/design', alice, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: 'security-request-1234' }) })).json();
  assert.equal((await request(`/api/design/${design.id}`, alice)).status, 200);
  assert.equal((await request(`/api/design/${design.id}`, bob, { headers: { 'x-ai-audio-client-id': 'alice' } })).status, 404);
  const requirements = await (await request('/api/requirements', alice, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ background: true, requestId: 'requirements-request-1234' }) })).json();
  assert.equal((await request(`/api/requirements/jobs/${requirements.id}`, alice)).status, 200);
  assert.equal((await request(`/api/requirements/jobs/${requirements.id}`, bob)).status, 404);
  assert.doesNotMatch(await (await request('/api/error', alice)).text(), /SECRET_SENTINEL|private|stack/);
  await request('/auth/logout', alice, { method: 'POST' });
  assert.equal((await request('/api/me', alice)).status, 401);
  now += 9 * 60 * 60_000; assert.equal((await request('/api/me', bob)).status, 401);
  for (let i = 0; i < 8; i++) assert.equal((await request('/auth/login', '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'alice', password: 'wrong' }) })).status, 401);
  assert.equal((await request('/auth/login', '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'alice', password }) })).status, 429);
});

test('real server rejects audited attacks and preserves an authenticated upload/download workflow', { timeout: 30_000 }, async t => {
  const directory = temp();
  // Allocate a loopback port without touching the application's configured deployment.
  const allocator = express().listen(0, '127.0.0.1'); await once(allocator, 'listening');
  const port = (allocator.address() as any).port; await new Promise<void>(resolve => allocator.close(() => resolve()));
  fs.mkdirSync(path.join(directory, 'dist', 'client'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'dist', 'client', 'index.html'), '<h1>fixture</h1>');
  fs.writeFileSync(path.join(directory, 'dist', 'server.cjs.map'), 'SERVER_SOURCE_SENTINEL');
  fs.writeFileSync(path.join(directory, '.env'), 'LEAK_SENTINEL=private-test-value');
  const serverPath = fileURLToPath(new URL('../../server.ts', import.meta.url));
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), serverPath], { cwd: directory,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), APP_ORIGIN: origin, AUTH_USERS_JSON: accounts,
      SFX_LIBRARY_ADMIN_PASSWORD: adminPassword, UPLOADS_CLEANUP_ENABLED: 'false',
      OPENAI_API_KEY: '', ARK_API_KEY: '', TOKENHUB_API_KEY: '', ELEVENLABS_API_KEY: '', ELEVENLABS_FALLBACK_API_KEY: '', ELEVENLABS_API_KEYS: '' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not become ready')), 15_000);
    child.stdout.on('data', data => { if (String(data).includes('Full-stack server running')) { clearTimeout(timeout); resolve(); } });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Server exited before startup')); });
  });
  const base = `http://127.0.0.1:${port}`;
  const request = (url: string, cookie = '', options: RequestInit = {}) => fetch(base + url, { ...options,
    headers: { Origin: origin, Cookie: cookie, ...options.headers }, redirect: 'manual' });
  const login = async (id: string) => {
    const response = await request('/auth/login', '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, password }) });
    assert.equal(response.status, 200); return response.headers.get('set-cookie')!.split(';')[0];
  };
  assert.equal((await request('/healthz')).status, 200);
  for (const url of ['/api/sfx/library/state', '/api/sfx/library/stream?key=x', '/api/sfx/download-file?path=.env', '/uploads/old.wav', '/api/usage/quota', '/api/points/me', '/api/points/admin']) {
    assert.equal((await request(url)).status, 401, url);
  }
  const alice = await login('alice'), bob = await login('bob');
  const points = await (await request('/api/usage/quota', alice)).json();
  assert.equal(points.user.userId, 'account:alice');
  assert.equal(points.quota.remainingCredits, 5000);
  assert.equal((await request('/api/points/me', alice)).status, 410);
  assert.equal((await request('/api/points/admin', alice)).status, 403);
  const elevated = await request('/api/sfx/admin/login', alice, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword }) });
  assert.equal(elevated.status, 200);
  assert.equal((await request('/api/points/admin', alice)).status, 410);
  assert.equal((await request('/api/usage/quotas', alice)).status, 200);
  assert.equal((await request('/api/points/admin', bob)).status, 403);
  assert.equal((await request('/api/usage/quotas', alice, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
  const failedGeneration = await request('/api/ai/elevenlabs/sound-effect', alice, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'test' }) });
  assert.ok(failedGeneration.status >= 400);
  const refunded = await (await request('/api/usage/quota', alice)).json();
  assert.equal(refunded.quota.pendingCredits, 0);
  assert.equal(refunded.quota.usedCredits, 0);
  await request('/api/sfx/admin/logout', alice, { method: 'POST' });
  assert.equal((await request('/api/points/admin', alice)).status, 403);
  for (const value of ['.env', 'uploads/../../../../etc/passwd', '/uploads/../.env', '/uploads/%2e%2e/.env']) {
    const response = await request(`/api/sfx/download-file?path=${encodeURIComponent(value)}`, alice);
    assert.ok(response.status >= 400, value); assert.doesNotMatch(await response.text(), /LEAK_SENTINEL/);
  }
  for (const url of ['/server.cjs', '/server.cjs.map', '/server/server.cjs.map']) {
    const response = await request(url, alice); assert.equal(response.status, 404); assert.doesNotMatch(await response.text(), /SERVER_SOURCE_SENTINEL/);
  }
  const upload = await request('/api/sfx/upload', alice, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-filename': 'test.wav' }, body: 'test-audio-data' });
  assert.equal(upload.status, 200); const asset = await upload.json();
  assert.equal(await (await request(asset.url, alice)).text(), 'test-audio-data');
  assert.equal((await request(asset.url, bob)).status, 404);
  assert.equal((await request(`/api/sfx/download-file?path=${encodeURIComponent(asset.url.slice(1))}&name=audio.wav`, alice)).status, 200);
  assert.equal((await request('/api/usage/quota', alice, { headers: { 'x-ai-audio-client-id': 'forged' } })).status, 200);
  const quota = await (await request('/api/usage/quota', alice)).json(); assert.equal(quota.user.userId, 'account:alice');
  assert.equal((await request('/api/usage/quotas', alice)).status, 403);
  // Seed an owned manifest without running a model; the actual router must reject Bob.
  const id = 'c1f8a202-b67a-4419-93d3-09ef4f940c93';
  const { createHash } = await import('node:crypto');
  const userDir = path.join(directory, 'data', 'private-uploads', createHash('sha256').update('account:alice').digest('hex'), `music-stems-${id}`);
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, 'job.json'), JSON.stringify({ version: 1, id, owner: 'account:alice', status: 'failed', stage: 'failed', sourceName: 'private.wav', stems: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  assert.equal((await request(`/api/audio/music-separation/jobs/${id}`, alice)).status, 200);
  for (const method of ['GET', 'DELETE']) assert.equal((await request(`/api/audio/music-separation/jobs/${id}`, bob, { method })).status, 404);
  assert.equal((await request(`/api/audio/music-separation/jobs/${id}/download`, bob)).status, 404);
  const active = new FormData(); active.set('prompt', 'test'); active.append('files', new Blob(['<script>bad()</script>']), 'attack.html');
  assert.equal((await request('/api/ai/assistant/jobs', alice, { method: 'POST', body: active })).status, 415);
  const malformed = await request('/api/ai/translate', alice, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad-json-SECRET_SENTINEL' });
  assert.equal(malformed.status, 400); assert.doesNotMatch(await malformed.text(), /SECRET_SENTINEL|SyntaxError|stack|server\.ts/);
  await request('/auth/logout', alice, { method: 'POST' }); assert.equal((await request(asset.url, alice)).status, 401);
});
