import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const fail of [false, true]) test(`CDN migration ${fail ? 'preserves originals on upload failure' : 'rewrites manifests before removing local media'}`, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-migration-test-'));
  const project = fileURLToPath(new URL('../', import.meta.url));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const data = path.join(directory, 'data'), hash = createHash('sha256').update('account:alice').digest('hex');
  const original = path.join(data, 'sfx-library', 'originals', 'old.wav');
  const privateFile = path.join(data, 'private-uploads', hash, 'upload.wav');
  for (const file of [original, privateFile]) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'original-audio'); }
  const sounds = [{ id: 'sound', fileName: '中文.wav', url: '/api/sfx/library/stream?key=originals%2Fold.wav', storageKey: 'originals/old.wav' }];
  fs.writeFileSync(path.join(data, 'sounds.json'), JSON.stringify(sounds));
  const job = path.join(data, 'assistant-jobs', 'job.json');
  fs.mkdirSync(path.dirname(job));
  fs.writeFileSync(job, JSON.stringify({ owner: 'account:alice', job: { assets: [{ url: '/uploads/upload.wav' }] } }));
  const stemId = 'music-stems-11111111-1111-4111-8111-111111111111';
  const stemDirectory = path.join(data, 'private-uploads', hash, stemId);
  fs.mkdirSync(path.join(stemDirectory, 'stems'), { recursive: true });
  fs.writeFileSync(path.join(stemDirectory, 'stems', 'vocals.wav'), 'stem-audio');
  fs.writeFileSync(path.join(stemDirectory, `${stemId}.zip`), 'zip-bytes');
  fs.writeFileSync(path.join(stemDirectory, 'job.json'), JSON.stringify({ owner: 'account:alice', status: 'completed',
    zipUrl: '/api/audio/music-separation/jobs/11111111-1111-4111-8111-111111111111/download',
    stems: [{ audioUrl: `/uploads/${stemId}/stems/vocals.wav` }],
  }));
  const preload = path.join(directory, 'mock.cjs');
  fs.writeFileSync(preload, `const qiniu = require(${JSON.stringify(path.join(project, 'node_modules', 'qiniu'))});
qiniu.form_up.FormUploader.prototype.putFile = function(token,key,file,extra,callback) { callback(null, {}, { statusCode: ${fail ? 500 : 200} }); };`);
  const result = spawnSync(process.execPath, ['--require', preload, '--import', import.meta.resolve('tsx'), path.join(project, 'scripts', 'migrate-cdn.ts'), '--apply', '--remove-local'], {
    cwd: directory, encoding: 'utf8', env: { ...process.env, QINIU_ACCESS_KEY: 'fixture-access', QINIU_SECRET_KEY: 'fixture-secret', QINIU_BUCKET: 'fixture-bucket', QINIU_CDN_DOMAIN: 'https://cdn.example.test', SFX_LIBRARY_DIR: '' },
  });
  if (fail) {
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'sounds.json'), 'utf8')), sounds);
    assert.equal(fs.readFileSync(original, 'utf8'), 'original-audio');
    assert.equal(fs.readFileSync(privateFile, 'utf8'), 'original-audio');
  } else {
    assert.equal(result.status, 0, result.stderr);
    const saved = JSON.parse(fs.readFileSync(path.join(data, 'sounds.json'), 'utf8'))[0];
    assert.match(saved.url, /^https:\/\/cdn\.example\.test\/ai-audio\/library\//);
    assert.equal(saved.storageKey, undefined);
    assert.match(JSON.parse(fs.readFileSync(job, 'utf8')).job.assets[0].url, /^https:\/\/cdn\.example\.test\/ai-audio\/users\//);
    assert.equal(fs.existsSync(original), false); assert.equal(fs.existsSync(privateFile), false);
    assert.equal(fs.existsSync(`${job}.pre-cdn.bak`), true);
    const restored = JSON.parse(fs.readFileSync(path.join(data, 'media-jobs', hash, `${stemId}.json`), 'utf8'));
    assert.match(restored.zipUrl, /^https:\/\/cdn\.example\.test\/ai-audio\/users\//);
    assert.match(restored.stems[0].audioUrl, /^https:\/\/cdn\.example\.test\/ai-audio\/users\//);
  }
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret|fixture-access/);
  // Migration cache is outside the project and is not a persistent media store.
  const cache = path.join(os.tmpdir(), 'ai-audio-media', createHash('sha256').update(data).digest('hex'));
  fs.rmSync(cache, { recursive: true, force: true });
});
