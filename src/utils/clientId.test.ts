import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { createClientTaskId } from './clientId';

test('uses native UUID generation with the crypto receiver intact', () => {
  const source = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), randomUUID() {
    assert.equal(this, source);
    return '00000000-0000-4000-8000-000000000001' as const;
  } };
  assert.equal(createClientTaskId(source), '00000000-0000-4000-8000-000000000001');
});

test('LAN HTTP crypto without randomUUID produces distinct valid UUIDs', () => {
  const source = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
  const ids = Array.from({ length: 1000 }, () => createClientTaskId(source));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
});
