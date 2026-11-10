import type { CategoryGroup, SoundEffect } from '../data/sfxData';

export type LibraryData = { categories: CategoryGroup[]; sounds: SoundEffect[] };
export type LibrarySnapshot = LibraryData & { revision: number };
export type LibrarySyncStatus = 'loading' | 'saved' | 'pending' | 'saving' | 'error' | 'conflict';
type Draft = { base: LibrarySnapshot; local: LibraryData };
type Options = {
  save: (snapshot: LibrarySnapshot) => Promise<LibrarySnapshot>;
  changed: (data: LibraryData, status: LibrarySyncStatus, error: string) => void;
  readDraft: () => string | null;
  writeDraft: (value: string | null) => void;
};

export class LibraryRevisionConflict extends Error {
  constructor(public remote: LibrarySnapshot) { super('音效库已被其他管理员更新。'); }
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const dataOf = ({ categories, sounds }: LibraryData): LibraryData => ({ categories, sounds });
const valid = (value: any): value is LibrarySnapshot => Boolean(value
  && Number.isFinite(value.revision) && Array.isArray(value.categories) && Array.isArray(value.sounds));

// Reconcile independent additions/edits by ID. A conflicting edit or deletion of
// the same entity is never resolved by silently discarding either administrator's work.
function mergeItems<T extends { id: string }>(base: T[], local: T[], remote: T[]): T[] {
  const before = new Map(base.map(item => [item.id, item]));
  const ours = new Map(local.map(item => [item.id, item]));
  const theirs = new Map(remote.map(item => [item.id, item]));
  const result = new Map<string, T>();
  for (const id of new Set([...before.keys(), ...ours.keys(), ...theirs.keys()])) {
    const b = before.get(id), l = ours.get(id), r = theirs.get(id);
    if (!equal(l, b) && !equal(r, b) && !equal(l, r)) {
      throw new Error('同一目录或音效被其他管理员修改，待保存内容已保留。请核对后处理冲突。');
    }
    const item = equal(l, b) ? r : l;
    if (item) result.set(id, item);
  }
  const localOrderChanged = !equal(local.filter(item => before.has(item.id)).map(item => item.id),
    base.filter(item => ours.has(item.id)).map(item => item.id));
  const order = localOrderChanged ? [...local, ...remote] : [...remote, ...local];
  return [...new Set(order.map(item => item.id))].flatMap(id => result.has(id) ? [result.get(id)!] : []);
}

export class SfxLibrarySync {
  private base: LibrarySnapshot | null = null;
  private local: LibraryData = { categories: [], sounds: [] };
  private authorized = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | null = null;
  private disposed = false;
  status: LibrarySyncStatus = 'loading';
  error = '';
  storageError = false;

  constructor(private options: Options) {}
  get data() { return this.local; }
  get revision() { return this.base?.revision || 0; }
  get dirty() { return Boolean(this.base && !equal(dataOf(this.base), this.local)); }

  private publish(status: LibrarySyncStatus, error = '') {
    this.status = status;
    this.error = error;
    try {
      this.options.writeDraft(this.dirty ? JSON.stringify({ base: this.base, local: this.local }) : null);
      this.storageError = false;
    } catch { this.storageError = true; }
    if (!this.disposed) this.options.changed(this.local, status, error);
  }

  setAuthorized(authorized: boolean) {
    const gained = authorized && !this.authorized;
    this.authorized = authorized;
    if (gained && this.dirty) this.schedule();
  }

  receive(remote: LibrarySnapshot) {
    if (!valid(remote) || this.inFlight || (this.base && remote.revision < this.base.revision)) return;
    if (!this.base) {
      let draft: Draft | null = null;
      try {
        const stored = this.options.readDraft();
        const parsed = stored ? JSON.parse(stored) : null;
        if (valid(parsed?.base) && Array.isArray(parsed?.local?.categories) && Array.isArray(parsed?.local?.sounds)) draft = parsed;
      } catch { /* A broken browser cache must not prevent loading server data. */ }
      this.base = draft?.base || remote;
      this.local = draft?.local || dataOf(remote);
    }
    if (this.dirty) {
      try {
        const merged = {
          categories: mergeItems(this.base.categories, this.local.categories, remote.categories),
          sounds: mergeItems(this.base.sounds, this.local.sounds, remote.sounds),
        };
        this.base = remote;
        this.local = merged;
      } catch (error) {
        this.publish('conflict', (error as Error).message);
        return;
      }
    } else {
      this.base = remote;
      this.local = dataOf(remote);
    }
    // Polls may reconcile an acknowledged-but-lost response, but don't create a
    // background retry loop on network/auth failures.
    const previousStatus = this.status;
    this.publish(this.dirty ? previousStatus === 'error' ? 'error' : 'pending' : 'saved', this.dirty ? this.error : '');
    if (this.dirty && previousStatus !== 'error') this.schedule();
  }

  edit<K extends keyof LibraryData>(key: K, update: LibraryData[K] | ((previous: LibraryData[K]) => LibraryData[K])) {
    if (!this.base) throw new Error('音效库尚未加载完成，请稍后重试。');
    const next = typeof update === 'function' ? update(this.local[key]) : update;
    this.local = { ...this.local, [key]: next };
    this.publish(this.status === 'conflict' ? 'conflict' : 'pending', this.status === 'conflict' ? this.error : '');
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    if (!this.authorized || this.disposed || this.status === 'conflict') return;
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 250);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.inFlight) {
      await this.inFlight;
      return this.dirty ? this.flush() : undefined;
    }
    if (!this.dirty) return;
    if (!this.authorized) {
      const message = '管理权限已过期，请重新开启“管理”后重试保存。待保存内容已保留。';
      this.publish('error', message);
      throw new Error(message);
    }
    if (this.status === 'conflict') throw new Error(this.error);
    const run = async () => {
      let conflicts = 0;
      while (this.dirty) {
        const sent = { ...this.local, revision: this.base!.revision };
        this.publish('saving');
        try {
          const saved = await this.options.save(sent);
          this.base = saved;
          this.publish(this.dirty ? 'pending' : 'saved');
        } catch (error) {
          if (error instanceof LibraryRevisionConflict && conflicts++ < 2) {
            // No GET may replace the local state during a PUT; rebase only on
            // the explicit revision-conflict response from that PUT.
            try {
              this.local = {
                categories: mergeItems(this.base!.categories, this.local.categories, error.remote.categories),
                sounds: mergeItems(this.base!.sounds, this.local.sounds, error.remote.sounds),
              };
              this.base = error.remote;
              this.publish(this.dirty ? 'pending' : 'saved');
              continue;
            } catch (conflict) {
              this.publish('conflict', (conflict as Error).message);
              throw conflict;
            }
          }
          const message = error instanceof Error ? error.message : '保存失败，请重试。';
          this.publish('error', message);
          throw error;
        }
      }
    };
    this.inFlight = run();
    try { await this.inFlight; } finally { this.inFlight = null; }
  }

  // Explicitly discard a draft only after the user confirms using server data.
  useServer(remote: LibrarySnapshot) {
    if (this.inFlight) throw new Error('正在保存，请稍后重试。');
    this.base = remote;
    this.local = dataOf(remote);
    this.publish('saved');
  }

  exportDraft() { return JSON.stringify({ base: this.base, local: this.local }, null, 2); }
  dispose() { this.disposed = true; clearTimeout(this.timer); }
  activate() { this.disposed = false; if (this.dirty) this.schedule(); }
}
