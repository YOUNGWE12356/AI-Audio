import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { scryptSync } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';

test('original points use persisted allowances and actual usage, protect concurrent requests and preserve audit files', { timeout: 35_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'company-points-'));
  const data = path.join(directory, 'data');
  fs.mkdirSync(data);
  const now = new Date();
  const profiles = ['alice', 'bob'].map(id => ({ userId: `account:${id}`, displayName: id, identitySource: 'account', tier: 'basic', updatedAt: now.toISOString() }));
  const configuration = { version: 2, profiles, allocations: [], accountAllocations: [] };
  fs.writeFileSync(path.join(data, 'company-points.json'), JSON.stringify(configuration));
  fs.writeFileSync(path.join(data, 'elevenlabs-quotas.json'), JSON.stringify({ ...configuration, profiles: profiles.map(p => ({ ...p, tier: 'professional' })) }));
  const retiredLedger = JSON.stringify({ entries: [{ type: 'debit', points: 200 }], policy: { memberMonthly: 200 } });
  fs.writeFileSync(path.join(data, 'creation-points.json'), retiredLedger);
  const usage = (companyPoints: number, timestamp = now.toISOString()) => ({ provider: 'gpt', model: 'fixture', companyPoints, pricingVersion: 'company-v1-gpt-token', timestamp, userId: 'account:alice', displayName: 'alice', identitySource: 'account', feature: 'fixture', credits: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  fs.writeFileSync(path.join(data, 'ai-usage.jsonl'), [usage(4992.5), usage(9000, '2020-01-01T00:00:00Z')].map(e => JSON.stringify(e)).join('\n') + '\n');
  const salt = Buffer.alloc(16, 7);
  const password = 'fixture-only-long-account-password';
  const adminPassword = 'fixture-only-long-management-password';
  const passwordHash = `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
  let release!: () => void;
  let entered!: () => void;
  const enteredProvider = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const mock = express(); mock.use(express.json());
  mock.post('/sound', async (req, res) => {
    if (req.body.text === 'hold') { entered(); await hold; }
    if (req.body.text === 'fail') return res.status(400).json({ detail: 'fixture failure' });
    res.type('application/octet-stream').send(Buffer.alloc(48000 * 2 * 2 * 2.5));
  });
  mock.post('/chat', (_req, res) => res.json({ output_text: '{"prompt":"door creak"}', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"prompt":"door creak"}' }] }], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } }));
  const provider = mock.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const children: ChildProcess[] = [];
  t.after(async () => {
    release();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    provider.closeAllConnections(); provider.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const providerBase = `http://127.0.0.1:${(provider.address() as any).port}`;
  const preload = path.join(directory, 'mock-provider.mjs');
  fs.writeFileSync(preload, `const original = globalThis.fetch; globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.startsWith('https://api.elevenlabs.io/v1/sound-generation')) return original('${providerBase}/sound', init);
    if (url.startsWith('https://mock-company-provider.test/')) return original('${providerBase}/chat', init);
    throw new Error('Unexpected external request in points regression: ' + url);
  };`);
  const allocator = express().listen(0, '127.0.0.1'); await once(allocator, 'listening');
  const port = (allocator.address() as any).port;
  await new Promise<void>(resolve => allocator.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), APP_ORIGIN: 'https://company-points.example.test', DATA_DIR: data,
    AUTH_USERS_JSON: JSON.stringify(profiles.map((p, i) => ({ id: ['alice', 'bob'][i], displayName: p.displayName, passwordHash }))),
    FEISHU_AUTH_ENABLED: 'false', SFX_LIBRARY_ADMIN_PASSWORD: adminPassword, UPLOADS_CLEANUP_ENABLED: 'false',
    ELEVENLABS_QUOTA_ENABLED: 'true', ELEVENLABS_API_KEY: 'fixture-only', ELEVENLABS_FALLBACK_API_KEY: '', ELEVENLABS_API_KEYS: '',
    OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: 'https://mock-company-provider.test/v1', OPENAI_MODEL: 'fixture',
    ARK_API_KEY: '', TOKENHUB_API_KEY: '', GPT_INPUT_USD_PER_MILLION_TOKENS: '2', GPT_OUTPUT_USD_PER_MILLION_TOKENS: '10', GPT_MINIMUM_COMPANY_POINTS_PER_REQUEST: '1' };
  const start = async () => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, '--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../server.ts', import.meta.url))], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors += String(chunk); });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Points server startup timeout')), 15_000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('Full-stack server running')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Points server exited: ${code}\n${errors}`)); });
    });
    return child;
  };
  const child = await start();
  const request = (url: string, cookie = '', body?: unknown, method = body === undefined ? 'GET' : 'POST') => fetch(origin + url, {
    method, headers: { Origin: env.APP_ORIGIN, Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual',
  });
  const login = async (id: string) => {
    const response = await request('/auth/login', '', { id, password });
    assert.equal(response.status, 200); return response.headers.get('set-cookie')!.split(';')[0];
  };
  const alice = await login('alice'), bob = await login('bob');
  const balance = async (cookie = alice) => (await (await request('/api/usage/quota', cookie)).json()).quota;
  assert.equal((await balance()).remainingCredits, 7.5);
  assert.equal((await balance(bob)).limitCredits, 5000);
  assert.equal((await request('/api/usage/quotas', alice)).status, 403);
  const generating = request('/api/ai/elevenlabs/sound-effect', alice, { text: 'hold', duration: 3 });
  await enteredProvider;
  assert.equal((await balance()).pendingCredits, 6);
  assert.equal((await request('/api/ai/elevenlabs/sound-effect', alice, { text: 'blocked', duration: 2 })).status, 429);
  release(); assert.equal((await generating).status, 200);
  assert.equal((await balance()).usedCredits, 4997.5);
  assert.equal((await balance()).pendingCredits, 0);
  assert.equal((await request('/api/ai/elevenlabs/sound-effect', alice, { text: 'fail', duration: 1 })).status, 500);
  assert.equal((await balance()).remainingCredits, 2.5);
  assert.equal((await request('/api/ai/translate', alice, { text: '木门吱呀', purpose: 'sound-effect' })).status, 200);
  assert.equal((await balance()).usedCredits, 4998.5);
  assert.equal((await balance()).pendingCredits, 0);
  assert.equal((await request('/api/sfx/admin/login', alice, { password: adminPassword })).status, 200);
  const update = await request('/api/usage/quotas', alice, { userId: 'account:alice', tier: 'professional', bonusCredits: 10, projectPoints: 20 }, 'PUT');
  assert.equal(update.status, 200);
  assert.equal((await balance()).limitCredits, 20030);
  const summary = await update.json(); assert.equal(summary.projectPool.totalPoints, 3750);
  const report = await (await request('/api/usage/summary', alice)).json();
  assert.equal(report.providers.elevenLabs.companyPoints, 5);
  assert.equal(report.providers.elevenLabs.models[0].amount, 5);
  assert.equal(report.providers.gpt.companyPoints, 4993.5);
  assert.equal((await request('/api/usage/quotas', bob, { userId: 'account:alice', bonusCredits: 99999 }, 'PUT')).status, 403);
  assert.equal((await request('/api/points/me', alice)).status, 410);
  assert.equal(fs.readFileSync(path.join(data, 'creation-points.json'), 'utf8'), retiredLedger);
  assert.equal(fs.readFileSync(path.join(data, 'ai-usage.jsonl'), 'utf8').trim().split('\n').length, 4);
  const exited = once(child, 'exit'); child.kill(); await exited;
  // When only the migration filename exists, restore its configuration too.
  fs.unlinkSync(path.join(data, 'company-points.json'));
  await start();
  const reconnected = await login('alice');
  assert.equal((await balance(reconnected)).limitCredits, 20000);
  assert.equal((await balance(reconnected)).usedCredits, 4998.5);
});
