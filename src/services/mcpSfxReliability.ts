import type { AgentToolContext } from './assistantAgentTools';

const searchBusyCodes = new Set(['SFX_QUERY_BUSY', 'SFX_SEARCH_BUSY', 'SFX_SEARCH_CAPACITY', 'SFX_CAPTURE_BUSY']);
const retryableCodes = new Set([...searchBusyCodes, 'API_RATE_LIMIT', 'REQUEST_CONCURRENCY_LIMIT']);
const unavailable = (message: string) => Object.assign(new Error(message), { status: 503, code: 'SFX_SEARCH_UNAVAILABLE' });

/** Three admission retries total per sound, reusing the same request/billing IDs.
 * Never retry an ambiguous 429, a generation call, or a request already admitted. */
export function createSfxRetryRequest(c: AgentToolContext): AgentToolContext['request'] {
  let retries = 0;
  return async (endpoint, body, method, headers) => {
    for (;;) {
      c.signal.throwIfAborted();
      try { return await c.request(endpoint, body, method, headers); }
      catch (error: any) {
        c.signal.throwIfAborted();
        if (error?.status !== 429 || !retryableCodes.has(error?.code)) throw error;
        if (retries >= 3) {
          if (searchBusyCodes.has(error.code)) throw unavailable('音效搜索持续繁忙，有限重试后仍无法取得可用音效。');
          throw error; // Platform-wide admission limits would also block generation.
        }
        const retryAfter = Number(error.retryAfterMs);
        if (retryAfter > 5_000) throw error; // Respect longer server windows; do not retry too early.
        const waitMs = Math.max(1000 * 2 ** retries, Number.isFinite(retryAfter) ? retryAfter : 0);
        retries++;
        c.progress?.(`搜索繁忙，等待后重试（${retries}/3）…`);
        await c.wait(waitMs);
      }
    }
  };
}

/** FIFO per account, shared by direct tools and background jobs.
 * Only search/previews occupy a slot; AI generation runs after releasing it. */
export function createMcpSfxSearchQueue(options: { timeoutMs?: number; maxPending?: number } = {}) {
  type Waiter = { signal: AbortSignal; accept: () => void; reject: (error: unknown) => void; cleanup: () => void };
  const queues = new Map<string, { pending: Waiter[] }>();
  return async <T>(owner: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    let queue = queues.get(owner);
    if (!queue) { queue = { pending: [] }; queues.set(owner, queue); }
    else {
      if (queue.pending.length >= (options.maxPending ?? 8)) throw unavailable('等待音效搜索的任务较多，暂时无法开始本条搜索。');
      const current = queue;
      await new Promise<void>((accept, reject) => {
        const remove = () => { const index = current.pending.indexOf(waiter); if (index >= 0) current.pending.splice(index, 1); };
        const abort = () => { remove(); waiter.cleanup(); reject(signal.reason); };
        const timer = setTimeout(() => {
          remove(); waiter.cleanup(); reject(unavailable('音效搜索排队超时，暂时无法取得搜索位置。'));
        }, options.timeoutMs ?? 30_000);
        const waiter: Waiter = { signal, accept, reject, cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort', abort); } };
        current.pending.push(waiter);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    try { signal.throwIfAborted(); return await work(); }
    finally {
      const next = queue.pending.shift();
      if (next) { next.cleanup(); next.accept(); }
      else queues.delete(owner);
    }
  };
}
