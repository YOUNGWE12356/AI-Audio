import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createHash, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import JSZip from 'jszip';
import { pcmWav } from './helpers/audioFixture';

test('real server: CDN upload, library archive, processing after cache loss and restored stem jobs', { timeout: 30_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-server-test-'));
  const project = fileURLToPath(new URL('../', import.meta.url));
  const data = path.join(directory, 'data'), remote = path.join(directory, 'fake-cdn');
  const cache = path.join(os.tmpdir(), 'ai-audio-media', createHash('sha256').update(data).digest('hex'));
  const allocator = express().listen(0, '127.0.0.1'); await once(allocator, 'listening');
  const port = (allocator.address() as any).port;
  await new Promise<void>(resolve => allocator.close(() => resolve()));
  const preload = path.join(directory, 'mock.cjs');
  fs.writeFileSync(preload, `const fs = require('node:fs'), path = require('node:path');
const qiniu = require(${JSON.stringify(path.join(project, 'node_modules', 'qiniu'))});
const root = ${JSON.stringify(remote)};
qiniu.form_up.FormUploader.prototype.putFile = function(token,key,file,extra,callback) {
  const destination = path.join(root,key); fs.mkdirSync(path.dirname(destination),{recursive:true}); fs.copyFileSync(file,destination);
  callback(null, {}, {statusCode:200});
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async function(input,init) {
  const url = String(input);
  if (url.startsWith('https://cdn.example.test/')) return new Response(fs.readFileSync(path.join(root,new URL(url).pathname)),{headers:{'Content-Type':'audio/wav'}});
  return originalFetch(input,init);
};`);
  const password = 'test-only-long-password', adminPassword = 'test-only-long-admin-password';
  const salt = '00112233445566778899aabbccddeeff';
  const passwordHash = `scrypt$${salt}$${scryptSync(password, Buffer.from(salt, 'hex'), 64, { N: 32768, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
  const origin = 'https://audio.example.test';
  const child = spawn(process.execPath, ['--require', preload, '--import', import.meta.resolve('tsx'), path.join(project, 'server.ts')], {
    cwd: directory, env: { ...process.env, NODE_ENV: 'production', PORT: String(port), APP_ORIGIN: origin,
      AUTH_USERS_JSON: JSON.stringify([{ id: 'alice', displayName: 'Alice', passwordHash }]), FEISHU_AUTH_ENABLED: 'false',
      SFX_LIBRARY_ADMIN_PASSWORD: adminPassword, UPLOADS_CLEANUP_ENABLED: 'false', MEDIA_STORAGE_MODE: 'cdn', SFX_LIBRARY_DIR: '',
      QINIU_ACCESS_KEY: 'fixture-access', QINIU_SECRET_KEY: 'fixture-secret', QINIU_BUCKET: 'fixture-bucket', QINIU_CDN_DOMAIN: 'https://cdn.example.test',
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    fs.rmSync(directory, { recursive: true, force: true }); fs.rmSync(cache, { recursive: true, force: true });
  });
  let errors = ''; child.stderr.on('data', bytes => { errors += String(bytes); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timeout: ${errors}`)), 15_000);
    child.stdout.on('data', bytes => { if (String(bytes).includes('Full-stack server running')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Server exited: ${errors}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  const request = (url: string, init: RequestInit = {}) => fetch(base + url, { ...init, redirect: 'manual', headers: { Origin: origin, Cookie: cookie, ...init.headers } });
  const login = await request('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'alice', password }) });
  assert.equal(login.status, 200); cookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await request('/api/sfx/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword }) })).status, 200);
  const wav = pcmWav(.25);
  const upload = await request('/api/sfx/library/upload', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-filename-utf8-base64': Buffer.from('确认音效.wav').toString('base64') }, body: wav });
  assert.equal(upload.status, 200, await upload.clone().text());
  const sound = await upload.json();
  assert.match(sound.url, /^https:\/\/cdn\.example\.test\/ai-audio\/library\//); assert.equal(sound.storageKey, undefined);
  assert.deepEqual(fs.readdirSync(path.join(data, 'sfx-library', 'originals')), []);
  const initial = await (await request('/api/sfx/library/state')).json();
  const saved = await request('/api/sfx/library/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    baseRevision: initial.revision, categories: [], sounds: [{ id: 'test-sound', name: '确认音效', fileName: '确认音效.wav', url: sound.url }],
  }) }); assert.equal(saved.status, 200);
  const archive = await (await request('/api/sfx/library/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['test-sound'] }) })).json();
  const packed = await request(archive.downloadUrl); assert.equal(packed.status, 200);
  const zip = await JSZip.loadAsync(await packed.arrayBuffer());
  assert.deepEqual(await zip.file('确认音效.wav')!.async('nodebuffer'), wav);
  const privateUpload = await request('/api/sfx/upload', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-filename': 'source.wav' }, body: wav });
  assert.equal(privateUpload.status, 200);
  const asset = await privateUpload.json(); assert.match(asset.url, /^https:\/\/cdn\.example\.test\/ai-audio\/users\//);
  assert.deepEqual(fs.readdirSync(path.join(data, 'private-uploads')), []);
  fs.rmSync(cache, { recursive: true, force: true });
  const recovered = await request(`/api/sfx/download-file?path=${encodeURIComponent(asset.url)}`);
  assert.equal(recovered.status, 200); assert.deepEqual(Buffer.from(await recovered.arrayBuffer()), wav);
  const id = 'c1f8a202-b67a-4419-93d3-09ef4f940c93', hash = createHash('sha256').update('account:alice').digest('hex');
  const manifest = path.join(data, 'media-jobs', hash, `music-stems-${id}.json`);
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(manifest, JSON.stringify({ version: 1, id, owner: 'account:alice', status: 'completed', mode: 'vocals', zipUrl: `${asset.url}.zip`,
    stems: [{ id: 'vocals', name: '人声', fileName: 'vocals.wav', audioUrl: asset.url, size: wav.length, waveform: [.1, .2] }] }));
  fs.rmSync(cache, { recursive: true, force: true });
  const restored = await request(`/api/audio/music-separation/jobs/${id}`); assert.equal(restored.status, 200);
  const job = await restored.json(); assert.equal(job.status, 'completed'); assert.equal(job.stems[0].audioUrl, asset.url);
  assert.equal((await request(`/api/audio/music-separation/jobs/${id}/stems/vocals/download`)).headers.get('location'), asset.url);
});
