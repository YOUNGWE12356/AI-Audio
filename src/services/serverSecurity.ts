import express from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertPrivateEnvironment } from './serverEnvironment';
import { createFeishuLogin, readFeishuAuthConfig, type FeishuUser } from './feishuAuthServer';
export { assertPrivateEnvironment } from './serverEnvironment';

const deriveKey = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
const SESSION_MS = 8 * 60 * 60_000;
const ADMIN_MS = 30 * 60_000;
type User = { id: string; displayName: string; passwordHash: string; feishu?: FeishuUser };
type Session = { user: User; expires: number; adminUntil: number };
type RequestSecurity = { userId: string; directory: string; requestId: string };
const context = new AsyncLocalStorage<RequestSecurity>();

export type UploadDirectory = string | (() => string);
export const uploadDirectory = (value: UploadDirectory) => typeof value === 'function' ? value() : value;
export const currentUserId = () => context.getStore()?.userId || '';
export const currentUploadDirectory = () => {
  const directory = context.getStore()?.directory;
  if (!directory) throw new Error('Authenticated file context required');
  return directory;
};

export function logSafeError(event: string, error?: unknown) {
  const value = error as { name?: unknown; code?: unknown } | undefined;
  const safeCode = typeof value?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(value.code) ? value.code : undefined;
  console.error(JSON.stringify({ event, requestId: context.getStore()?.requestId, code: safeCode }));
}

export const publicError = (status: number) => ({
  400: '请求参数无效。', 401: '请先登录。', 403: '没有操作权限。', 404: '资源不存在或无权访问。',
  409: '操作冲突，请刷新后重试。', 410: '资源已过期。', 413: '上传内容超过限制。',
  422: '无法处理该素材，请检查输入。', 429: '请求过于频繁或额度不足，请稍后重试。',
  503: '服务暂不可用，请联系管理员。',
}[status] || '处理失败，请稍后重试。');

export function sanitizeResponse(value: any, failed = false): any {
  if (Array.isArray(value)) return value.map(item => sanitizeResponse(item, failed));
  if (!value || typeof value !== 'object') return value;
  const taskFailed = failed || value.status === 'failed';
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    (key === 'error' && typeof item === 'string') || (taskFailed && key === 'message')
      ? '处理失败，请稍后重试。' : sanitizeResponse(item, taskFailed)]));
}

/** Fixed-window limiter with bounded storage; never trusts forwarded client IP headers. */
export function createRateLimiter(limit: number, windowMs: number) {
  const entries = new Map<string, { count: number; until: number }>();
  return (key: string) => {
    const now = Date.now();
    for (const [id, entry] of entries) if (entry.until <= now) entries.delete(id);
    let entry = entries.get(key);
    if (!entry) {
      if (entries.size >= 10_000) return false;
      entry = { count: 0, until: now + windowMs }; entries.set(key, entry);
    }
    return ++entry.count <= limit;
  };
}

export async function verifyPassword(password: string, encoded: string) {
  const match = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
  if (!match || password.length > 1024) return false;
  const actual = await deriveKey(password, Buffer.from(match[1], 'hex'));
  return timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
}

export function createServerSecurity(options: { privateRoot: string; env?: NodeJS.ProcessEnv; now?: () => number; fetcher?: typeof fetch }) {
  const env = options.env || process.env;
  assertPrivateEnvironment(env);
  const now = options.now || Date.now;
  const production = env.NODE_ENV === 'production';
  const feishu = readFeishuAuthConfig(env);
  const origin = env.APP_ORIGIN || (feishu.enabled ? new URL(feishu.redirectUri).origin : '') || (production ? '' : `http://localhost:${env.PORT || '3000'}`);
  if (!origin || new URL(origin).origin !== origin || (production && !origin.startsWith('https://'))) {
    throw new Error('APP_ORIGIN must be a canonical HTTPS origin in production');
  }
  const secure = origin.startsWith('https://');
  if (feishu.enabled && new URL(feishu.redirectUri).origin !== origin) throw new Error('APP_ORIGIN and Feishu callback origin must match');
  const cookieName = secure ? '__Host-ai_audio_session' : 'ai_audio_session';
  const parsed = JSON.parse(env.AUTH_USERS_JSON || '[]');
  if (!Array.isArray(parsed) || parsed.length > 500) throw new Error('Invalid AUTH_USERS_JSON');
  const users: User[] = parsed.map((user: any) => {
    if (!/^[a-zA-Z0-9._@-]{1,128}$/.test(user.id || '')
      || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(user.passwordHash || '')
      || typeof user.displayName !== 'string' || user.displayName.length > 80) throw new Error('Invalid AUTH_USERS_JSON account');
    return { id: user.id, displayName: user.displayName, passwordHash: user.passwordHash };
  });
  if (new Set(users.map(user => user.id)).size !== users.length) throw new Error('Duplicate account IDs');
  const sessions = new Map<string, Session>();
  const loginLimit = createRateLimiter(10, 15 * 60_000);
  const accountLimit = createRateLimiter(20, 15 * 60_000);
  const adminLimit = createRateLimiter(5, 15 * 60_000);
  const apiLimit = createRateLimiter(600, 60_000);
  const inflight = new Map<string, number>();
  let passwordChecks = 0;
  const router = express.Router();
  const sessionToken = (req: express.Request) => {
    const token = (req.headers.cookie || '').split(';').map(value => value.trim())
      .find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
    return /^[a-f0-9]{64}$/.test(token) ? token : '';
  };
  const digest = (token: string) => createHash('sha256').update(token).digest('hex');
  const lookup = (req: express.Request) => {
    const key = digest(sessionToken(req));
    const session = sessions.get(key);
    if (session && session.expires > now()) return session;
    sessions.delete(key); return undefined;
  };
  const cookie = (token: string, maxAge: number) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const issueSession = (req: express.Request, res: express.Response, user: User) => {
    for (const [key, session] of sessions) if (session.expires <= now()) sessions.delete(key);
    if (sessions.size >= 10_000) throw new Error('Session capacity reached');
    sessions.delete(digest(sessionToken(req)));
    const token = randomBytes(32).toString('hex');
    sessions.set(digest(token), { user, expires: now() + SESSION_MS, adminUntil: 0 });
    res.append('Set-Cookie', cookie(token, SESSION_MS / 1000));
  };
  const sameOrigin: express.RequestHandler = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('origin') !== origin || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: '请求来源无效。' });
    next();
  };
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(createFeishuLogin({ config: feishu, origin, now, fetcher: options.fetcher,
    complete: (req, res, user) => issueSession(req, res, { id: user.openId, displayName: user.displayName, passwordHash: '', feishu: user }) }));
  router.get('/me', (req, res) => {
    const session = lookup(req);
    res.json({ enabled: feishu.enabled, user: session?.user.feishu || null, guest: false, guestAllowed: false });
  });
  router.get('/login', (_req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (feishu.enabled) return res.type('html').send('<!doctype html><html lang="zh"><meta charset="utf-8"><title>飞书登录</title><h1>登录 AI Audio</h1><p>请使用飞书账号登录。</p><a href="/api/auth/lark">使用飞书登录</a></html>');
    return res.type('html').send('<!doctype html><html lang="zh"><meta charset="utf-8"><title>登录</title><h1>登录 AI Audio</h1><form method="post" action="/auth/login"><label>账号 <input name="id" autocomplete="username" required maxlength="128"></label><label>密码 <input name="password" type="password" autocomplete="current-password" required maxlength="1024"></label><button>登录</button></form></html>');
  });
  router.post('/login', sameOrigin, (req, res, next) => {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!loginLimit(ip)) return res.status(429).json({ error: publicError(429) });
    next();
  }, express.urlencoded({ extended: false, limit: '4kb' }), express.json({ limit: '4kb' }), async (req, res, next) => {
    try {
      if (feishu.enabled) return res.status(403).json({ error: '请使用飞书登录。' });
      if (!users.length) return res.status(503).json({ error: '请管理员配置登录账号。' });
      const id = typeof req.body?.id === 'string' ? req.body.id : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!accountLimit(id)) return res.status(429).json({ error: publicError(429) });
      const user = users.find(entry => entry.id === id);
      // Derive even for unknown IDs, to avoid a cheap username-existence oracle.
      if (passwordChecks >= 4) return res.status(429).json({ error: publicError(429) });
      let valid: boolean;
      passwordChecks++;
      try { valid = await verifyPassword(password, user?.passwordHash || `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`); }
      finally { passwordChecks--; }
      if (!user || !valid) return res.status(401).json({ error: '账号或密码错误。' });
      issueSession(req, res, user);
      return req.is('application/json') ? res.json({ authenticated: true }) : res.redirect(303, '/');
    } catch (error) { next(error); }
  });
  router.post('/logout', sameOrigin, (req, res) => {
    sessions.delete(digest(sessionToken(req)));
    res.append('Set-Cookie', cookie('', 0));
    return res.json({ success: true });
  });
  router.get('/session', (req, res) => {
    const session = lookup(req);
    return res.json({ authenticated: Boolean(session), displayName: session?.user.displayName });
  });
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logSafeError('auth.request-failed', error);
    return res.status(400).json({ error: publicError(400) });
  });

  const authenticate: express.RequestHandler = (req, res, next) => {
    const session = lookup(req);
    if (!session) {
      if (req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api/') && !req.path.startsWith('/uploads/')) return res.redirect('/auth/login');
      return res.status(401).json({ error: publicError(401) });
    }
    if (!apiLimit(session.user.id)) return res.status(429).json({ error: publicError(429) });
    return sameOrigin(req, res, () => {
      const userId = `${session.user.feishu ? 'feishu' : 'account'}:${session.user.id}`;
      const directory = path.join(options.privateRoot, createHash('sha256').update(userId).digest('hex'));
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      res.locals.authUser = { id: userId, displayName: session.user.displayName, identitySource: session.user.feishu ? 'feishu' : 'account' };
      const requestId = randomUUID(); res.setHeader('X-Request-Id', requestId);
      res.setHeader('Cache-Control', 'no-store');
      const originalJson = res.json.bind(res);
      res.json = ((body: any) => originalJson(res.statusCode >= 400
        ? { error: publicError(res.statusCode), code: /^[A-Z0-9_]+$/.test(body?.code || '') ? body.code : undefined, requestId }
        : sanitizeResponse(body))) as typeof res.json;
      context.run({ userId, directory, requestId }, next);
    });
  };
  const resourceLimits: express.RequestHandler = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const id = currentUserId();
    if ((inflight.get(id) || 0) >= 4 || [...inflight.values()].reduce((sum, count) => sum + count, 0) >= 16) return res.status(429).json({ error: publicError(429) });
    inflight.set(id, (inflight.get(id) || 0) + 1);
    let done = false;
    const release = () => { if (!done) { done = true; const remaining = (inflight.get(id) || 1) - 1; if (remaining) inflight.set(id, remaining); else inflight.delete(id); } };
    res.once('finish', release); res.once('close', release);
    // Check before body parsing/model work. Never follow links while counting storage.
    const checkStorage = async () => {
      if (req.method !== 'POST' || /\/(?:admin\/[^/]+|cancel|cleanup)$/.test(req.path)) return;
      let bytes = 0, files = 0;
      const visit = async (directory: string): Promise<void> => {
        for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
          if (++files > 20_000) throw Object.assign(new Error('Storage limit exceeded'), { status: 429 });
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) await visit(file);
          else if (entry.isFile()) bytes += (await fs.promises.stat(file)).size;
          if (bytes > 1024 * 1024 * 1024) throw Object.assign(new Error('Storage limit exceeded'), { status: 429 });
        }
      };
      await visit(currentUploadDirectory());
    };
    void checkStorage().then(() => next(), next);
  };
  const isAdmin = (req: express.Request) => (lookup(req)?.adminUntil || 0) > now();
  const requireAdmin: express.RequestHandler = (req, res, next) => isAdmin(req) ? next() : res.status(403).json({ error: publicError(403) });
  const elevateAdmin = (req: express.Request, password: unknown) => {
    const session = lookup(req);
    if (!session || !adminLimit(`${req.socket.remoteAddress}:${session.user.id}`)) return { status: 429 };
    const expected = env.SFX_LIBRARY_ADMIN_PASSWORD?.trim() || '';
    if (!expected) return { status: 503 };
    const actualHash = createHash('sha256').update(typeof password === 'string' ? password : '').digest();
    if (!timingSafeEqual(actualHash, createHash('sha256').update(expected).digest())) return { status: 403 };
    session.adminUntil = now() + ADMIN_MS;
    return { status: 200, expiresAt: session.adminUntil };
  };
  return { router, authenticate, resourceLimits, isAdmin, requireAdmin, elevateAdmin, origin,
    revokeAdmin: (req: express.Request) => { const session = lookup(req); if (session) session.adminUntil = 0; } };
}

/** Read existing files only inside the current user's real storage root. */
export function resolvePrivateDownload(root: string, relative: string) {
  if (!relative || relative.includes('\\') || relative.split('/').some(part => !part || part === '..' || part.startsWith('.'))
    || /[\x00-\x1f\x7f]/.test(relative) || /(?:^|\/)(?:job\.json|.*\.source\.json)$/.test(relative)) return null;
  try {
    const realRoot = fs.realpathSync(root);
    const file = fs.realpathSync(path.resolve(root, relative));
    const within = path.relative(realRoot, file);
    return within && !within.startsWith(`..${path.sep}`) && within !== '..' && !path.isAbsolute(within) && fs.statSync(file).isFile() ? file : null;
  } catch { return null; }
}

export function privateDownload(root: string, relative: string, res: express.Response, next: express.NextFunction, name?: string) {
  const file = resolvePrivateDownload(root, relative);
  if (!file) return res.status(404).json({ error: publicError(404) });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'none'");
  const safeInline = /\.(?:wav|mp3|m4a|aac|ogg|opus|flac|mp4|mov|webm|png|jpe?g|webp)$/i.test(file);
  if (name || !safeInline) {
    res.type('application/octet-stream');
    return res.download(file, path.basename(name || file), error => { if (error) next(error); });
  }
  return res.sendFile(file, { dotfiles: 'deny', cacheControl: false }, error => { if (error) next(error); });
}
