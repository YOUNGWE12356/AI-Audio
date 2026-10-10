import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSfxLibraryArchive } from './sfxLibraryArchiveClient';

test('retries an empty preparation response and returns the archive URL', async () => {
  let calls = 0;
  const fetchRequest = (async (_url: string, init: RequestInit) => {
    calls += 1;
    assert.deepEqual(JSON.parse(String(init.body)), { ids: ['sound-1'], fileName: 'sounds.zip' });
    return calls === 1
      ? new Response('', { status: 200 })
      : Response.json({ downloadUrl: '/api/sfx/library/archive/token-1' });
  }) as typeof fetch;

  assert.equal(
    await prepareSfxLibraryArchive(['sound-1'], 'sounds.zip', undefined, fetchRequest),
    '/api/sfx/library/archive/token-1',
  );
  assert.equal(calls, 2);
});

test('shows a useful error after two invalid preparation responses', async () => {
  const fetchRequest = (async () => new Response('', { status: 200 })) as typeof fetch;
  await assert.rejects(
    prepareSfxLibraryArchive(['sound-1'], 'sounds.zip', undefined, fetchRequest),
    /未返回有效的打包链接/,
  );
});

test('preserves a library validation error without retrying', async () => {
  let calls = 0;
  const fetchRequest = (async () => {
    calls += 1;
    return Response.json({ error: '文件已失效' }, { status: 404 });
  }) as typeof fetch;
  await assert.rejects(
    prepareSfxLibraryArchive(['sound-1'], 'sounds.zip', undefined, fetchRequest),
    /文件已失效/,
  );
  assert.equal(calls, 1);
});

test('uses the GET preparation fallback when POST is an unstructured 404', async () => {
  const urls: string[] = [];
  const fetchRequest = (async (url: string) => {
    urls.push(url);
    return urls.length === 1
      ? new Response('Cannot POST /api/sfx/library/archive', { status: 404 })
      : Response.json({ downloadUrl: '/api/sfx/library/archive/token-2' });
  }) as typeof fetch;

  const libraryIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  assert.equal(
    await prepareSfxLibraryArchive(['a', 'c', 'i'], '测试.zip', { libraryIds, revision: 7 }, fetchRequest),
    '/api/sfx/library/archive/token-2',
  );
  assert.equal(urls[0], '/api/sfx/library/archive');
  const fallbackUrl = new URL(urls[1], 'http://localhost');
  assert.equal(fallbackUrl.pathname, '/api/sfx/library/archive/prepare');
  assert.equal(fallbackUrl.searchParams.get('selection'), '0501');
  assert.equal(fallbackUrl.searchParams.get('revision'), '7');
  assert.equal(fallbackUrl.searchParams.get('fileName'), '测试.zip');
});
