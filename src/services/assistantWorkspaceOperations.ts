import type { RequestHandler } from 'express';
import { createHash } from 'node:crypto';

/** Reconnect a page to the same operation instead of paying for generation twice. */
export function createAssistantWorkspaceOperationCache(identity: (req: any, res: any) => string): RequestHandler {
  type Result = { status: number; body: any };
  const operations = new Map<string, { fingerprint: string; expires: number; result: Promise<Result> }>();
  return async (req, res, next) => {
    const operation = req.header('x-assistant-workspace-operation') || '';
    if (req.method !== 'POST' || !['/api/video/analyze', '/api/video/generate-clip', '/api/video/mix'].includes(req.path)
      || !/^[a-f0-9-]{36}:[a-zA-Z0-9_-]{1,120}$/.test(operation)) return next();
    const now = Date.now();
    for (const [key, entry] of operations) if (entry.expires < now) operations.delete(key);
    const key = `${identity(req, res)}:${req.path}:${operation}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    const existing = operations.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) { res.status(409).json({ error: '同一个制作操作的参数已变化，已阻止重复生成。' }); return; }
      const result = await existing.result;
      if (!res.destroyed) res.status(result.status).json(result.body);
      return;
    }
    if (operations.size >= 500) { res.status(503).json({ error: '制作队列已满，请稍后重试。' }); return; }
    let complete!: (result: Result) => void;
    const result = new Promise<Result>(resolve => { complete = resolve; });
    operations.set(key, { fingerprint, expires: now + 2 * 60 * 60_000, result });
    const originalJson = res.json.bind(res);
    res.json = ((body: any) => { complete({ status: res.statusCode, body }); return originalJson(body); }) as typeof res.json;
    next();
  };
}
