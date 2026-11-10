import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import { replaceAssistantManifest } from './assistantManifest';

export type McpIdentity = { id: string; displayName: string; identitySource: 'feishu' | 'account'; adminUntil?: number };
type TokenRecord = { id: string; hash: string; name: string; user: McpIdentity; createdAt: number; expiresAt: number };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

// Machine credentials are deliberately accepted only by audio routes, never by
// login, quota administration, the assistant agent or local model endpoints.
export function isMcpApiAllowed(method: string, endpoint: string) {
  const pathname = endpoint.split('?')[0];
  if (pathname === '/mcp') return ['GET', 'POST', 'DELETE'].includes(method);
  if (/^\/api\/mcp\/files(?:\/[a-f0-9-]{36})?$/.test(pathname)) return ['GET', 'POST'].includes(method);
  if (method === 'GET') return [
    /^\/api\/(?:health|usage\/quota|ai\/elevenlabs\/voices|sfx\/categories|sfx\/library\/(?:state|stream))$/,
    /^\/api\/ai\/(?:sfx-batch\/analyze|sfx-requirements|audio-design)\/jobs\/[a-f0-9-]{36}$/,
    /^\/api\/video\/analyze\/jobs\/[a-f0-9-]{36}$/,
  ].some(rule => rule.test(pathname));
  if (method === 'PUT') return pathname === '/api/sfx/library/state';
  if (method !== 'POST') return false;
  return [
    /^\/api\/ai\/(?:translate|translate-language|voice-v[34]-enhance|generate-lyrics|regenerate-lyrics|music-prompt|music-analysis-naming|music-analysis-naming\/audio|batch-voice-image-ocr|optimize-metadata|match-voice|audio-analysis\/(?:metrics|semantic)|audio-design|audio-design-video-keyframes|audio-design\/jobs|sfx-requirements)$/,
    /^\/api\/ai\/music-prompt\/from-visual$/,
    /^\/api\/ai\/elevenlabs\/(?:voice|music|sound-effect|speech-to-text|speech-to-speech|translate-dubbing|audio-isolation)$/,
    /^\/api\/ai\/sfx-batch\/(?:analyze|search-query|search|capture)$/,
    /^\/api\/sfx\/(?:online\/(?:search|capture)|library\/upload)$/,
    /^\/api\/video\/(?:analyze|analyze\/jobs|analyze\/jobs\/cancel|generate-clip|mix|preview-compatible|extract-audio-clip|match-similar-voices)$/,
    /^\/api\/audio\/(?:mix-tracks-v2|export-stems)$/,
  ].some(rule => rule.test(pathname));
}

export function createMcpAccess(directory: string, now = Date.now) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'tokens.json');
  let records: TokenRecord[] = [];
  if (fs.existsSync(file)) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(value)) throw new Error('Invalid MCP token store');
    records = value.filter(v => /^[a-f0-9]{64}$/.test(v.hash) && typeof v.user?.id === 'string' && v.expiresAt > now());
  }
  const persist = () => {
    const temporary = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(records), { mode: 0o600 });
    replaceAssistantManifest(temporary, file);
  };
  const list = (owner: string) => records.filter(r => r.user.id === owner && r.expiresAt > now())
    .map(({ id, name, createdAt, expiresAt, user }) => ({ id, name, createdAt, expiresAt, libraryAdminUntil: user.adminUntil || 0 }));
  const issue = (user: McpIdentity, name: string, days: number) => {
    records = records.filter(r => r.expiresAt > now());
    if (list(user.id).length >= 10 || records.length >= 5000) throw new Error('令牌数量已达上限，请先撤销旧令牌。');
    const token = `t1_audio_${randomBytes(32).toString('base64url')}`;
    const record: TokenRecord = { id: randomUUID(), hash: hash(token), name: name.trim().slice(0, 80) || 'MCP',
      user: { ...user }, createdAt: now(), expiresAt: now() + Math.min(90, Math.max(1, days)) * 86400_000 };
    records.push(record); persist();
    return { token, ...list(user.id).find(r => r.id === record.id)! };
  };
  const revoke = (owner: string, id: string) => { records = records.filter(r => r.user.id !== owner || r.id !== id); persist(); };
  const verify = (token: string) => {
    if (!/^t1_audio_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const record = records.find(r => r.hash === hash(token) && r.expiresAt > now());
    return record ? { ...record.user } : null;
  };
  const authenticate = (req: express.Request) => {
    if (!isMcpApiAllowed(req.method, req.path)) return null;
    return verify(/^Bearer (\S+)$/.exec(req.get('authorization') || '')?.[1] || '');
  };
  return { issue, list, revoke, verify, authenticate };
}

export function createMcpAccessRouter(access: ReturnType<typeof createMcpAccess>, adminExpiresAt: (req: express.Request) => number) {
  const router = express.Router();
  router.use((req, res, next) => {
    // Only an interactive authenticated session may provision or revoke tokens.
    if (!res.locals.authUser || req.get('authorization')) return res.status(403).json({ error: '请使用网页登录后管理令牌。' });
    next();
  });
  router.get('/', (_req, res) => res.json({ tokens: access.list(res.locals.authUser.id) }));
  router.post('/', (req, res) => {
    const days = req.body?.days ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > 90 || typeof req.body?.name !== 'string') return res.status(400).json({ error: '无效令牌参数。' });
    const adminUntil = req.body?.libraryAdmin === true ? adminExpiresAt(req) : 0;
    if (req.body?.libraryAdmin === true && !adminUntil) return res.status(403).json({ error: '请先在音效库验证管理密码。' });
    try { return res.json(access.issue({ ...res.locals.authUser, adminUntil }, req.body.name, days)); }
    catch { return res.status(429).json({ error: '令牌数量已达上限。' }); }
  });
  router.delete('/:id', (req, res) => { access.revoke(res.locals.authUser.id, String(req.params.id)); res.json({ success: true }); });
  return router;
}
