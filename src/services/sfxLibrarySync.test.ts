import test from 'node:test';
import assert from 'node:assert/strict';
import { LibraryRevisionConflict, SfxLibrarySync, type LibrarySnapshot } from './sfxLibrarySync';

const group = (id: string, name = id) => ({ id, name, english: id, subCategories: [] });
const snapshot = (revision = 1, categories = [group('original')]): LibrarySnapshot => ({ revision, categories, sounds: [] });
function harness(t: any, save?: (state: LibrarySnapshot) => Promise<LibrarySnapshot>) {
  const storage = { value: null as string | null };
  const writes: LibrarySnapshot[] = [];
  const make = () => {
    const sync = new SfxLibrarySync({
      readDraft: () => storage.value,
      writeDraft: value => { storage.value = value; },
      changed: () => {},
      save: async state => { writes.push(state); return save ? save(state) : { ...state, revision: state.revision + 1 }; },
    });
    t.after(() => sync.dispose());
    return sync;
  };
  return { make, storage, writes };
}

test('an immediate refresh restores a pending folder and commits only after admin authorization', async t => {
  const h = harness(t);
  const first = h.make(); first.receive(snapshot()); first.setAuthorized(true);
  first.edit('categories', previous => [...previous, group('new-folder')]);
  assert.ok(h.storage.value); first.dispose(); // reload before debounce fires
  const refreshed = h.make(); refreshed.receive(snapshot());
  assert.equal(refreshed.data.categories.length, 2);
  await assert.rejects(refreshed.flush(), /管理权限/);
  assert.equal(h.writes.length, 0);
  refreshed.setAuthorized(true); await refreshed.flush();
  assert.equal(h.writes[0].categories[1].id, 'new-folder');
  assert.equal(h.storage.value, null); assert.equal(refreshed.status, 'saved');
});

test('polling preserves unsaved folders and independent remote additions', async t => {
  const h = harness(t); const sync = h.make(); sync.receive(snapshot());
  sync.edit('categories', previous => [...previous, group('local')]);
  sync.receive(snapshot(2, [group('original'), group('remote')]));
  assert.deepEqual(new Set(sync.data.categories.map(item => item.id)), new Set(['original', 'local', 'remote']));
  sync.receive(snapshot()); // delayed GET response
  assert.equal(sync.revision, 2);
  sync.setAuthorized(true); await sync.flush();
  assert.equal(h.writes[0].revision, 2);
});

test('serializes in-flight edits and ignores SSE data arriving before the PUT acknowledgment', async t => {
  let finish!: (state: LibrarySnapshot) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  const h = harness(t, async state => {
    if (++calls === 1) { started(); return new Promise(resolve => { finish = resolve; }); }
    return { ...state, revision: state.revision + 1 };
  });
  const sync = h.make(); sync.receive(snapshot()); sync.setAuthorized(true);
  sync.edit('categories', previous => [...previous, group('first')]);
  const saving = sync.flush(); await ready;
  sync.edit('categories', previous => [...previous, group('second')]);
  sync.receive(snapshot(2, h.writes[0].categories));
  assert.equal(sync.data.categories.length, 3);
  const alsoSaving = sync.flush();
  finish({ ...h.writes[0], revision: 2 });
  await Promise.all([saving, alsoSaving]);
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].revision, 2);
  assert.equal(h.writes[1].categories.length, 3);
  assert.equal(sync.status, 'saved');
});

test('409 retries independent edits against the new revision without losing either client', async t => {
  let calls = 0;
  const h = harness(t, async state => {
    if (++calls === 1) throw new LibraryRevisionConflict(snapshot(2, [group('original'), group('remote')]));
    return { ...state, revision: 3 };
  });
  const sync = h.make(); sync.receive(snapshot()); sync.setAuthorized(true);
  sync.edit('categories', previous => [...previous, group('local')]);
  await sync.flush();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].revision, 2);
  assert.equal(sync.data.categories.length, 3);
});

test('a conflicting rename preserves the draft across refresh and requires explicit resolution', async t => {
  const h = harness(t, async () => { throw new LibraryRevisionConflict(snapshot(2, [group('original', 'theirs')])); });
  const sync = h.make(); sync.receive(snapshot()); sync.setAuthorized(true);
  sync.edit('categories', [group('original', 'ours')]);
  await assert.rejects(sync.flush(), /同一目录/);
  assert.equal(sync.status, 'conflict'); assert.match(sync.exportDraft(), /ours/);
  sync.dispose(); const refreshed = h.make(); refreshed.receive(snapshot(2, [group('original', 'theirs')]));
  assert.equal(refreshed.status, 'conflict'); assert.equal(refreshed.data.categories[0].name, 'ours');
  refreshed.useServer(snapshot(2, [group('original', 'theirs')]));
  assert.equal(refreshed.status, 'saved'); assert.equal(h.storage.value, null);
});

test('failed saves retain data, polling does not silently retry, and explicit retry succeeds', async t => {
  let online = false;
  const h = harness(t, async state => { if (!online) throw new Error('断网'); return { ...state, revision: 2 }; });
  const sync = h.make(); sync.receive(snapshot()); sync.setAuthorized(true);
  sync.edit('categories', previous => [...previous, group('uploaded-file-folder')]);
  await assert.rejects(sync.flush(), /断网/);
  sync.receive(snapshot());
  assert.equal(sync.status, 'error'); assert.ok(h.storage.value);
  online = true; await sync.flush();
  assert.equal(sync.status, 'saved'); assert.equal(h.storage.value, null);
});

test('a committed PUT with a lost response is reconciled by polling', async t => {
  const h = harness(t, async () => { throw new Error('response lost'); });
  const sync = h.make(); sync.receive(snapshot()); sync.setAuthorized(true);
  sync.edit('categories', previous => [...previous, group('uploaded')]);
  await assert.rejects(sync.flush());
  sync.receive(snapshot(2, h.writes[0].categories));
  assert.equal(sync.status, 'saved'); assert.equal(sync.dirty, false); assert.equal(h.storage.value, null);
});

test('browser storage failures do not prevent a server save', async t => {
  let saved = false;
  const sync = new SfxLibrarySync({ readDraft: () => { throw new Error('disabled'); },
    writeDraft: () => { throw new Error('quota'); }, changed: () => {},
    save: async state => { saved = true; return { ...state, revision: 2 }; } });
  t.after(() => sync.dispose()); sync.receive(snapshot()); sync.setAuthorized(true);
  sync.edit('categories', previous => [...previous, group('new')]);
  await sync.flush(); assert.equal(saved, true); assert.equal(sync.status, 'saved'); assert.equal(sync.storageError, true);
});
