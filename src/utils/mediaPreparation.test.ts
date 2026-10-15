import assert from 'node:assert/strict';
import test from 'node:test';
import { isAudioFile, isPdfFile } from './mediaPreparation';

test('recognizes audio by MIME type or extension when MIME is missing', () => {
  assert.equal(isAudioFile({ name: 'reference.mp3', type: '' }), true);
  assert.equal(isAudioFile({ name: 'reference.bin', type: 'audio/mpeg' }), true);
  assert.equal(isAudioFile({ name: 'scene.mp4', type: 'video/mp4' }), false);
  assert.equal(isAudioFile({ name: 'brief.pdf', type: 'application/pdf' }), false);
});

test('recognizes PDF by MIME type or extension when MIME is missing', () => {
  assert.equal(isPdfFile({ name: 'brief.pdf', type: '' }), true);
  assert.equal(isPdfFile({ name: 'brief.bin', type: 'application/pdf' }), true);
  assert.equal(isPdfFile({ name: 'scene.mp4', type: 'video/mp4' }), false);
});
