import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSfxLibraryAdminState, getSfxLibraryAdminHeaders, verifySfxLibraryAdmin } from './sfxLibraryAdminService';

test('disabled browser storage does not block session verification or repeatedly publish authorization', async t => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const events = new EventTarget();
  let published = 0;
  events.addEventListener('security-state-changed', () => { published++; });
  Object.assign(globalThis, { window: {
    localStorage: { getItem() { throw new Error('storage disabled'); },
      setItem() { throw new Error('storage disabled'); }, removeItem() { throw new Error('storage disabled'); } },
    dispatchEvent: events.dispatchEvent.bind(events),
  } });
  globalThis.fetch = async () => new Response(JSON.stringify({ authorized: true }), { status: 200 });
  t.after(() => { clearSfxLibraryAdminState(); globalThis.fetch = originalFetch; Object.assign(globalThis, { window: originalWindow }); });
  assert.deepEqual(getSfxLibraryAdminHeaders({ 'Content-Type': 'application/json' }), { 'Content-Type': 'application/json' });
  assert.equal(await verifySfxLibraryAdmin(), true);
  assert.equal(await verifySfxLibraryAdmin(), true);
  assert.equal(published, 1);
  clearSfxLibraryAdminState(); clearSfxLibraryAdminState();
  assert.equal(published, 2);
});
