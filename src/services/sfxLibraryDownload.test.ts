import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import JSZip from 'jszip';
import { createSfxArchiveStream, downloadContentDisposition, safeDownloadFileName } from './sfxLibraryDownload';

test('download headers retain Chinese library filenames', () => {
  assert.equal(safeDownloadFileName('中文/音效.wav', 'fallback.wav'), '中文_音效.wav');
  assert.match(downloadContentDisposition('确认按钮.wav'), /filename\*=UTF-8''%E7%A1%AE%E8%AE%A4%E6%8C%89%E9%92%AE.wav/);
});

test('archive streams file bytes and retains names, suffixing only duplicates', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-archive-test-'));
  const filePath = path.join(directory, 'source.wav');
  try {
    fs.writeFileSync(filePath, 'audio-bytes');
    const chunks: Buffer[] = [];
    for await (const chunk of createSfxArchiveStream([
      { fileName: '确认按钮.wav', filePath },
      { fileName: '确认按钮.wav', filePath },
      { fileName: '确认按钮_(1).wav', filePath },
    ]) as Readable) chunks.push(Buffer.from(chunk));
    const archive = await JSZip.loadAsync(Buffer.concat(chunks));
    assert.deepEqual(Object.keys(archive.files), ['确认按钮.wav', '确认按钮_(1).wav', '确认按钮_(1)_(1).wav']);
    assert.equal(await archive.file('确认按钮.wav')?.async('string'), 'audio-bytes');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
