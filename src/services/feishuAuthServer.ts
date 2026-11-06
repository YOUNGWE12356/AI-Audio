import express from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type FeishuUser = { openId: string; displayName: string; avatarUrl: string };
export function readFeishuAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  const appId = (env.FEISHU_APP_ID || env.LARK_APP_ID || '').trim();
  const appSecret = (env.FEISHU_APP_SECRET || env.LARK_APP_SECRET || '').trim();
  const redirectUri = (env.FEISHU_REDIRECT_URI || env.LARK_REDIRECT_URI || '').trim();
  const enabled = env.FEISHU_AUTH_ENABLED === 'true'
    || (env.FEISHU_AUTH_ENABLED !== 'false' && Boolean(appId || appSecret || redirectUri));
  if (enabled) {
    if (!appId || !appSecret || !redirectUri) throw new Error('Incomplete Feishu login configuration');
    const callback = new URL(redirectUri);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname);
    if ((callback.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && local && callback.protocol === 'http:'))
      || callback.pathname !== '/api/auth/callback' || callback.search || callback.hash || callback.username || callback.password) {
      throw new Error('Invalid FEISHU_REDIRECT_URI');
    }
  }
  return { enabled, appId, appSecret, redirectUri,
    secure: enabled && new URL(redirectUri).protocol === 'https:' };
}

// OAuth state is one-use, browser-bound and server-side. Provider tokens are never stored.
export function createFeishuLogin(options: {
  config: ReturnType<typeof readFeishuAuthConfig>;
  origin: string;
  complete: (req: express.Request, res: express.Response, user: FeishuUser) => void;
  fetcher?: typeof fetch;
  now?: () => number;
}) {
  const router = express.Router();
  const { config, origin } = options;
  const now = options.now || Date.now;
  const fetcher = options.fetcher || fetch;
  const pending = new Map<string, { binding: string; expires: number }>();
  const secure = origin.startsWith('https:');
  const name = secure ? '__Host-ai_audio_oauth' : 'ai_audio_oauth';
  const cookie = (value: string, age: number) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const binding = (req: express.Request) => (req.headers.cookie || '').split(';').map(item => item.trim())
    .find(item => item.startsWith(`${name}=`))?.slice(name.length + 1) || '';
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  router.get('/lark', (req, res) => {
    if (!config.enabled) return res.status(503).json({ error: '飞书登录尚未配置。' });
    for (const [state, item] of pending) if (item.expires <= now()) pending.delete(state);
    if (pending.size >= 1000) return res.status(429).json({ error: '登录请求过多。' });
    const state = randomBytes(32).toString('hex');
    const token = randomBytes(32).toString('hex');
    pending.set(state, { binding: digest(token), expires: now() + 5 * 60_000 });
    res.append('Set-Cookie', cookie(token, 300));
    const params = new URLSearchParams({ app_id: config.appId, redirect_uri: config.redirectUri,
      scope: 'contact:user.base:readonly', state });
    res.redirect(`https://open.feishu.cn/open-apis/authen/v1/authorize?${params}`);
  });
  router.get('/callback', async (req, res) => {
    if (!config.enabled) return res.status(503).json({ error: '飞书登录尚未配置。' });
    const fail = () => res.redirect(`${origin}/auth/login?auth_error=login_failed`);
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const item = pending.get(state);
    pending.delete(state);
    res.append('Set-Cookie', cookie('', 0));
    if (!item || item.expires <= now() || !timingSafeEqual(Buffer.from(item.binding), Buffer.from(digest(binding(req))))
      || req.query.error || typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 4096) return fail();
    const api = async (endpoint: string, init?: RequestInit) => {
      const response = await fetcher(`https://open.feishu.cn/open-apis/${endpoint}`, { ...init, signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new Error('Feishu authentication failed');
      return result;
    };
    try {
      const app = await api('auth/v3/app_access_token/internal', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }) });
      if (typeof app.app_access_token !== 'string' || !app.app_access_token) return fail();
      const token = await api('authen/v1/oidc/access_token', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${app.app_access_token}` },
        body: JSON.stringify({ grant_type: 'authorization_code', code: req.query.code }) });
      if (typeof token.data?.access_token !== 'string' || !token.data.access_token) return fail();
      const profile = await api('authen/v1/user_info', { headers: { Authorization: `Bearer ${token.data.access_token}` } });
      const user = profile.data;
      if (typeof user?.open_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(user.open_id)
        || typeof user.name !== 'string' || !user.name || user.name.length > 80) return fail();
      options.complete(req, res, { openId: user.open_id, displayName: user.name,
        avatarUrl: typeof user.avatar_url === 'string' && user.avatar_url.startsWith('https://') ? user.avatar_url.slice(0, 1024) : '' });
      return res.redirect(`${origin}/`);
    } catch {
      return fail();
    }
  });
  return router;
}
