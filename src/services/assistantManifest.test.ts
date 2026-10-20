import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceAssistantManifest } from './assistantManifest';

test('transient Windows locks retry atomic replacement; other errors and exhausted retries propagate', () => {
  let calls = 0; let pauses = 0;
  const locked = Object.assign(new Error('file locked'), { code: 'EPERM' });
  replaceAssistantManifest('pending', 'saved', {
    rename: (source, destination) => {
      assert.equal(source, 'pending'); assert.equal(destination, 'saved');
      if (++calls < 3) throw locked;
    }, pause: () => { pauses++; },
  });
  assert.equal(calls, 3); assert.equal(pauses, 2);
  calls = 0;
  assert.throws(() => replaceAssistantManifest('pending', 'saved', { rename: () => { calls++; throw locked; }, pause: () => {} }), /file locked/);
  assert.equal(calls, 9);
  calls = 0;
  assert.throws(() => replaceAssistantManifest('pending', 'saved', { rename: () => { calls++; throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } }), /disk full/);
  assert.equal(calls, 1);
});
