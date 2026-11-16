import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { MediaStorage } from './mediaStorage';
import { isCdnUrl, readCdnConfig } from './cdnStorage';

const domain = 'https://cdn.example.test';
function fixture(t: TestContext) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-storage-test-'));
  const remote = new Map<string, Buffer>();
  let uploads = 0;
  const storage = new MediaStorage(data, async file => {
    uploads++;
    const url = `${domain}/ai-audio/${path.basename(file)}`;
    remote.set(url, fs.readFileSync(file));
    return url;
  }, async (url, file) => {
    const bytes = remote.get(url);
    assert(bytes, 'remote file must exist');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  });
  const before = process.env.QINIU_CDN_DOMAIN;
  process.env.QINIU_CDN_DOMAIN = domain;
  t.after(() => {
    if (before === undefined) delete process.env.QINIU_CDN_DOMAIN; else process.env.QINIU_CDN_DOMAIN = before;
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(storage.cacheRoot, { recursive: true, force: true });
  });
  return { data, remote, storage, count: () => uploads };
}

test('CDN configuration is explicit and URL validation rejects redirects and other origins', () => {
  assert.throws(() => readCdnConfig({}), { code: 'CDN_NOT_CONFIGURED' });
  assert.throws(() => readCdnConfig({ QINIU_ACCESS_KEY: 'a', QINIU_SECRET_KEY: 's', QINIU_BUCKET: 'b', QINIU_CDN_DOMAIN: 'http://cdn.test' }));
  assert.equal(isCdnUrl(`${domain}/ai-audio/a.wav`, domain), true);
  for (const url of ['https://cdn.example.test.evil/a.wav', 'https://user@cdn.example.test/a.wav', `${domain}/a.wav?redirect=http://127.0.0.1`, 'file:///tmp/a.wav']) {
    assert.equal(isCdnUrl(url, domain), false, url);
  }
});

test('publish stores links only, coalesces uploads and survives losing all temporary media', async t => {
  const { storage, data, count } = fixture(t);
  const file = storage.local('alice', 'voice.wav');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'audio-bytes');
  const results = await Promise.all([storage.publish('alice', '/uploads/voice.wav'), storage.publish('alice', '/uploads/voice.wav')]);
  assert.equal(count(), 1); assert.equal(results[0], results[1]);
  const json = fs.readFileSync(path.join(data, 'media', fs.readdirSync(path.join(data, 'media'))[0]), 'utf8');
  assert.match(json, /https:\/\/cdn\.example\.test/); assert.doesNotMatch(json, /audio-bytes/);
  assert.equal(fs.existsSync(path.join(data, 'private-uploads')), false);
  fs.rmSync(storage.cacheRoot, { recursive: true, force: true });
  const restored = await storage.materialize('alice', results[0]);
  assert.equal(fs.readFileSync(restored, 'utf8'), 'audio-bytes');
  await assert.rejects(storage.materialize('bob', results[0]), { status: 404 });
  await assert.rejects(storage.materialize('alice', '/uploads/../secret'), { status: 404 });
});

test('nested stem URLs are hydrated into filenames supported by existing mix routes', async t => {
  const { storage } = fixture(t);
  const file = storage.local('alice', 'music-stems-123/stems/vocals.wav');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'vocals');
  const url = await storage.publish('alice', '/uploads/music-stems-123/stems/vocals.wav');
  fs.unlinkSync(file);
  const request = await storage.prepareValue('alice', { clips: [{ audioUrl: url }] });
  assert.match(request.clips[0].audioUrl, /^\/uploads\/cdn_[a-f0-9]+\.wav$/);
  assert.equal(fs.readFileSync(path.join(storage.directory('alice'), path.basename(request.clips[0].audioUrl)), 'utf8'), 'vocals');
});

test('upload failure never commits a link or reports a successful local fallback', async t => {
  const { data, storage } = fixture(t);
  const failed = new MediaStorage(data, async () => { throw Object.assign(new Error('failed'), { code: 'CDN_UPLOAD_FAILED', status: 502 }); });
  const file = failed.local('alice', 'voice.wav');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'keep-for-retry');
  await assert.rejects(failed.publish('alice', '/uploads/voice.wav'), { code: 'CDN_UPLOAD_FAILED' });
  assert.deepEqual(storage.entries('alice'), {});
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep-for-retry');
});

test('HTTP upload returns CDN URLs and processing accepts the same URLs after cache loss', async t => {
  const { storage } = fixture(t);
  const app = express();
  app.use(express.json());
  app.use(storage.middleware(() => 'alice'));
  app.post('/api/upload', (_req, res) => {
    const file = storage.local('alice', 'upload.wav');
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'uploaded-audio');
    res.json({ url: '/uploads/upload.wav', fileName: 'upload.wav' });
  });
  app.post('/api/process', (req, res) => {
    assert.match(req.body.url, /^\/uploads\//);
    assert.equal(fs.readFileSync(path.join(storage.directory('alice'), path.basename(req.body.url)), 'utf8'), 'uploaded-audio');
    res.json({ audioUrl: req.body.url });
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const uploaded = await (await fetch(`${origin}/api/upload`, { method: 'POST' })).json();
  assert.equal(uploaded.url, `${domain}/ai-audio/upload.wav`);
  fs.rmSync(storage.cacheRoot, { recursive: true, force: true });
  const response = await fetch(`${origin}/api/process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: uploaded.url }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).audioUrl, uploaded.url);
});
