import assert from 'node:assert/strict';
import test from 'node:test';
import { createSearchBillingBatches } from './searchBillingBatches';

test('server batches bind owner, fixed single-use items, lifetime and one successful charge', () => {
  let now = 1000;
  const batches = createSearchBillingBatches({ now: () => now, ttlMs: 1000 });
  const { batchId } = batches.create('alice', ['door', 'wind']);
  assert.throws(() => batches.claim('alice', 'client-picked-id', 'door'));
  assert.throws(() => batches.claim('bob', batchId, 'door'));
  assert.throws(() => batches.claim('alice', batchId, 'extra'));
  const first = batches.claim('alice', batchId, 'door');
  assert.equal(first.hasBeenBilled, false);
  assert.throws(() => batches.claim('alice', batchId, 'door'));
  const second = batches.claim('alice', batchId, 'wind');
  // Simultaneous successful results still settle the whole batch once.
  assert.equal(second.markSuccessful(), true);
  assert.equal(first.markSuccessful(), false);
  const later = batches.create('alice', ['rain']);
  now += 1000;
  assert.throws(() => batches.claim('alice', later.batchId, 'rain'));
  assert.equal(batches.claim('alice', undefined, undefined).markSuccessful(), true);
  assert.equal(batches.claim('alice', undefined, undefined).markSuccessful(), true);
});

test('invalid, duplicate and unlimited task sets are rejected', () => {
  const batches = createSearchBillingBatches();
  for (const items of [[], ['a', 'a'], [''], [1], Array.from({ length: 201 }, (_, i) => String(i))]) {
    assert.throws(() => batches.create('alice', items));
  }
});
