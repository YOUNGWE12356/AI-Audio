import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaUrl, persistMediaUrl, readMediaBlob, uploadMediaBlob } from './mediaClient';
import { persistHistory } from './historyStorage';

test('generated blobs reuse the server CDN URL without uploading again', async () => {
  const response = new Response('audio', { headers: { 'Content-Type': 'audio/wav', 'X-Audio-CDN-URL': 'https://cdn.example.test/generated.wav' } });
  const blob = await readMediaBlob(response);
  assert.equal(createMediaUrl(blob), 'https://cdn.example.test/generated.wav');
  assert.equal(await uploadMediaBlob(blob), 'https://cdn.example.test/generated.wav');
});

test('browser history persists CDN URLs and attachment metadata, with no audio binaries', async t => {
  const originalFetch = globalThis.fetch, originalWindow = (globalThis as any).window;
  const metadata = new Map<string, string>();
  (globalThis as any).window = { localStorage: { setItem: (key: string, value: string) => metadata.set(key, value) } };
  let uploads = 0;
  const source = 'blob:history-storage-test';
  globalThis.fetch = (async (input, init) => {
    if (String(input) === source) return new Response('generated-audio', { headers: { 'Content-Type': 'audio/wav' } });
    assert.equal(input, '/api/sfx/upload'); assert.equal(init?.method, 'POST');
    assert(init?.body instanceof Blob);
    return Response.json({ url: `https://cdn.example.test/file-${++uploads}.wav` });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; (globalThis as any).window = originalWindow; });
  await persistHistory([{ id: 'history', type: 'sfx', title: '测试', prompt: '', timestamp: '', url: source,
    attachments: [{ name: '参考.wav', file: new File(['reference'], '参考.wav', { type: 'audio/wav' }) }] }]);
  const entries = JSON.parse(metadata.get('ai-audio-history-metadata-v1')!);
  assert.match(entries[0].url, /^https:\/\/cdn\.example\.test\//);
  assert.match(entries[0].attachments[0].url, /^https:\/\/cdn\.example\.test\//);
  assert.equal(entries[0].attachments[0].file, undefined);
  assert.doesNotMatch(JSON.stringify(entries), /blob:|generated-audio|reference/);
  assert.equal(uploads, 2);
  await persistMediaUrl(source); assert.equal(uploads, 2, 'a saved blob URL must not upload twice');
});

test('failed CDN saves preserve the previous browser history', async t => {
  const originalFetch = globalThis.fetch, originalWindow = (globalThis as any).window;
  let writes = 0;
  (globalThis as any).window = { localStorage: { setItem: () => writes++ } };
  globalThis.fetch = (async input => String(input).startsWith('blob:') ? new Response('audio') : Response.json({ error: 'upload failed' }, { status: 502 })) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; (globalThis as any).window = originalWindow; });
  await assert.rejects(persistHistory([{ id: 'failed', type: 'sfx', title: '', prompt: '', timestamp: '', url: 'blob:failed-history' }]));
  assert.equal(writes, 0);
});
