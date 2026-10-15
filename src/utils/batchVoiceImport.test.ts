import assert from 'node:assert/strict';
import test from 'node:test';
import { deduplicateBatchVoiceImages } from './batchVoiceImport';

test('deduplicates identical clipboard images even with different names and timestamps', async () => {
  const first = new File(['screenshot'], 'image.png', { type: 'image/png', lastModified: 1 });
  const copy = new File(['screenshot'], 'pasted-copy.png', { type: 'image/png', lastModified: 2 });
  assert.deepEqual(await deduplicateBatchVoiceImages([first, copy, first]), [first]);
});

test('keeps different images with identical metadata, preserving their order', async () => {
  const first = new File(['abc'], 'image.png', { type: 'image/png', lastModified: 1 });
  const second = new File(['abd'], 'image.png', { type: 'image/png', lastModified: 1 });
  assert.deepEqual(await deduplicateBatchVoiceImages([first, second, first]), [first, second]);
});

test('does not remove intentional repeated dialogue or duplicate text documents', async () => {
  const document = new File(['你好\n你好'], 'script.txt', { type: 'text/plain' });
  assert.deepEqual(await deduplicateBatchVoiceImages([document, document]), [document, document]);
});
