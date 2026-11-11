import { randomUUID } from 'node:crypto';

const invalid = () => Object.assign(new Error('搜索批次无效、已完成或已过期，请重新发起本轮搜索。'), { status: 400 });

/** One server-issued batch authorizes a fixed, finite set of single-use tasks. */
export function createSearchBillingBatches(options: { now?: () => number; ttlMs?: number; maxItems?: number } = {}) {
  const now = options.now || Date.now;
  const ttl = options.ttlMs ?? 24 * 60 * 60_000;
  type Batch = { owner: string; expires: number; remaining: Set<string>; billed: boolean };
  const batches = new Map<string, Batch>();
  const prune = () => {
    for (const [id, batch] of batches) if (batch.expires <= now() || !batch.remaining.size) batches.delete(id);
  };
  return {
    create(owner: string, items: unknown) {
      prune();
      if (!owner || owner === 'unknown') throw Object.assign(invalid(), { status: 401 });
      if (!Array.isArray(items) || !items.length || items.length > (options.maxItems ?? 200)
        || items.some(id => typeof id !== 'string' || !id.trim() || id.length > 128)
        || new Set(items).size !== items.length) throw invalid();
      if (batches.size >= 5000 || [...batches.values()].filter(b => b.owner === owner).length >= 32) {
        throw Object.assign(new Error('未完成的搜索批次过多，请稍后再试。'), { status: 429 });
      }
      const batchId = randomUUID();
      const expiresAt = now() + ttl;
      batches.set(batchId, { owner, expires: expiresAt, remaining: new Set(items), billed: false });
      return { batchId, expiresAt };
    },
    claim(owner: string, id: unknown, itemId: unknown) {
      // Old single-item clients are safe: without an ID every call is a new paid action.
      if (id === undefined || id === '') return { hasBeenBilled: false, markSuccessful: () => true };
      if (typeof id !== 'string' || typeof itemId !== 'string') throw invalid();
      const batch = batches.get(id);
      if (!batch || batch.owner !== owner || batch.expires <= now() || !batch.remaining.delete(itemId)) throw invalid();
      return {
        hasBeenBilled: batch.billed,
        markSuccessful() {
          if (batch.billed) return false;
          batch.billed = true;
          return true;
        },
      };
    },
  };
}
