import { createHash, randomBytes } from 'node:crypto';
import express from 'express';
import { getIronSession, type SessionOptions } from 'iron-session';

export type FeishuUser = { openId: string; displayName: string; avatarUrl: string };
type LoginSession = { user?: FeishuUser; guest?: boolean };
type StateSession = { state?: string };
type AuthConfig = {
  enabled: boolean;
  appId: string;
  appSecret: string;
  redirectUri: string;
  password: string;
  secure: boolean;
  localGuestEnabled: boolean;
};

export function readFeishuAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const appId = (env.FEISHU_APP_ID || env.LARK_APP_ID || '').trim();
  const appSecret = (env.FEISHU_APP_SECRET || env.LARK_APP_SECRET || '').trim();
  const redirectUri = (env.FEISHU_REDIRECT_URI || env.LARK_REDIRECT_URI || '').trim();
  const enabled = env.FEISHU_AUTH_ENABLED === 'true'
    || (env.FEISHU_AUTH_ENABLED !== 'false' && Boolean(appId || appSecret || redirectUri));
  let secure = false;
  if (enabled) {
    if (!appId || !appSecret || !redirectUri) throw new Error('飞书登录需要配置 FEISHU_APP_ID、FEISHU_APP_SECRET 和 FEISHU_REDIRECT_URI');
    const callback = new URL(redirectUri);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname);
    if (callback.protocol !== 'https:' && !(callback.protocol === 'http:' && local)) {
      throw new Error('飞书回调地址必须使用 HTTPS（localhost 开发环境可用 HTTP）');
    }
    if (callback.pathname !== '/api/auth/callback' || callback.search || callback.hash || callback.username || callback.password) {
      throw new Error('飞书回调地址路径必须为 /api/auth/callback，且不包含查询参数');
    }
    secure = callback.protocol === 'https:';
    if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET 至少需要 32 个字符');
  }
  return {
    enabled, appId, appSecret, redirectUri, secure,
    localGuestEnabled: env.LOCAL_GUEST_LOGIN_ENABLED === 'true',
    password: env.SESSION_SECRET || createHash('sha256').update(`${appSecret}:ai-audio-session`).digest('hex'),
  };
}

export function isLocalGuestRequest(req: express.Request) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')
    && ['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)
    && !req.get('forwarded') && !req.get('x-forwarded-for') && !req.get('x-forwarded-host');
}

export function createFeishuAuth(config = readFeishuAuthConfig(), fetcher: typeof fetch = fetch) {
  const router = express.Router();
  const pendingStates = new Map<string, number>();
  const stateTtl = 5 * 60 * 1000;
  const cookieOptions = { httpOnly: true, secure: config.secure, sameSite: 'lax' as const, path: '/' };
  const options: SessionOptions = {
    cookieName: 'ai_audio_sid', password: config.password, ttl: 7 * 24 * 60 * 60,
    cookieOptions,
  };
  const stateOptions: SessionOptions = {
    cookieName: 'ai_audio_oauth', password: config.password, ttl: stateTtl / 1000,
    cookieOptions: { ...cookieOptions, path: '/api/auth' },
  };
  const wrap = (handler: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler => (
    (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); }
  );
  const configuredOrigin = config.enabled ? new URL(config.redirectUri).origin : '';
  const guestAllowed = (req: express.Request) => config.enabled && config.localGuestEnabled
    && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.redirectUri).hostname)
    && isLocalGuestRequest(req);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  // Cookies authenticate browser requests, so reject cross-origin mutations as well.
  router.use((req, res, next) => {
    if (!config.enabled || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== configuredOrigin)) {
      return res.status(403).json({ error: '请从本站发起操作。' });
    }
    next();
  });
  router.use((req, res, next) => {
    if (!config.enabled) return next();
    getIronSession<LoginSession>(req, res, options).then(session => {
      if (session.user?.openId && session.user?.displayName) res.locals.feishuUser = session.user;
      else if (session.guest && guestAllowed(req)) res.locals.localGuest = true;
      next();
    }).catch(next);
  });
  router.get('/api/auth/me', (req, res) => {
    res.json({ enabled: config.enabled, user: res.locals.feishuUser || null,
      guest: Boolean(res.locals.localGuest), guestAllowed: guestAllowed(req) });
  });
  router.post('/api/auth/guest', wrap(async (req, res) => {
    if (!guestAllowed(req)) return res.status(403).json({ error: '游客登录仅限已启用该功能的本机访问。' });
    const session = await getIronSession<LoginSession>(req, res, options);
    if (!session.user) session.guest = true;
    await session.save();
    res.json({ ok: true });
  }));
  router.get('/api/auth/lark', wrap(async (req, res) => {
    if (!config.enabled) return res.status(503).json({ error: '飞书登录尚未配置。' });
    const now = Date.now();
    for (const [key, expires] of pendingStates) if (expires <= now) pendingStates.delete(key);
    if (pendingStates.size >= 1000) return res.status(429).json({ error: '登录请求过多，请稍后重试。' });
    const session = await getIronSession<StateSession>(req, res, stateOptions);
    if (session.state) pendingStates.delete(session.state);
    const state = randomBytes(32).toString('hex');
    session.state = state;
    await session.save();
    pendingStates.set(state, now + stateTtl);
    const params = new URLSearchParams({
      app_id: config.appId, redirect_uri: config.redirectUri, scope: 'contact:user.base:readonly', state,
    });
    res.redirect(`https://open.feishu.cn/open-apis/authen/v1/authorize?${params}`);
  }));
  router.get('/api/auth/callback', wrap(async (req, res) => {
    if (!config.enabled) return res.status(503).json({ error: '飞书登录尚未配置。' });
    const fail = (error: string) => res.redirect(`${configuredOrigin}/?auth_error=${error}`);
    const stateSession = await getIronSession<StateSession>(req, res, stateOptions);
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const valid = Boolean(state && stateSession.state === state && (pendingStates.get(state) || 0) > Date.now());
    if (stateSession.state) pendingStates.delete(stateSession.state);
    stateSession.destroy();
    if (!valid) return fail('invalid_state');
    if (req.query.error) return fail('access_denied');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) return fail('invalid_request');
    // Never persist provider access tokens or return provider errors (which may contain secrets).
    const api = async (endpoint: string, init?: RequestInit) => {
      const response = await fetcher(`https://open.feishu.cn/open-apis/${endpoint}`, {
        ...init, signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error('Feishu authentication failed');
      return result;
    };
    try {
      const appToken = await api('auth/v3/app_access_token/internal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
      });
      if (!appToken.app_access_token) return fail('token_failed');
      const token = await api('authen/v1/oidc/access_token', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${appToken.app_access_token}` },
        body: JSON.stringify({ grant_type: 'authorization_code', code }),
      });
      if (!token.data?.access_token) return fail('token_failed');
      const profile = await api('authen/v1/user_info', {
        headers: { Authorization: `Bearer ${token.data.access_token}` },
      });
      const user = profile.data;
      if (typeof user?.open_id !== 'string' || !user.open_id || typeof user.name !== 'string' || !user.name) return fail('user_info_failed');
      const session = await getIronSession<LoginSession>(req, res, options);
      delete session.guest;
      session.user = {
        openId: user.open_id.slice(0, 128), displayName: user.name.slice(0, 80),
        avatarUrl: typeof user.avatar_url === 'string' && user.avatar_url.startsWith('https://') ? user.avatar_url.slice(0, 1024) : '',
      };
      await session.save();
      return res.redirect(`${configuredOrigin}/`);
    } catch {
      return fail('provider_failed');
    }
  }));
  router.post('/api/auth/logout', wrap(async (req, res) => {
    if (config.enabled) {
      (await getIronSession<LoginSession>(req, res, options)).destroy();
      const stateSession = await getIronSession<StateSession>(req, res, stateOptions);
      if (stateSession.state) pendingStates.delete(stateSession.state);
      stateSession.destroy();
    }
    res.json({ ok: true });
  }));
  // Protect APIs and generated files before any business handlers or static serving.
  router.use(['/api', '/uploads'], (_req, res, next) => {
    if (config.enabled && !res.locals.feishuUser && !res.locals.localGuest) {
      return res.status(401).json({ code: 'AUTH_REQUIRED', error: '请先使用飞书账号登录。' });
    }
    next();
  });
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: '登录服务暂时不可用，请稍后重试。' });
  });
  return router;
}
