import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type express from 'express';
import { downloadCdnFile, isCdnUrl, readCdnConfig, uploadCdnFile } from './cdnStorage';

type Entry = { url: string; size: number; mtimeMs: number };
type Manifest = Record<string, Entry>;
const ownerKey = (owner: string) => /^sha256:[a-f0-9]{64}$/.test(owner) ? owner.slice(7) : createHash('sha256').update(owner).digest('hex');
const safeRelative = (relative: string) => relative && !relative.includes('\\') && !/[\x00-\x1f]/.test(relative)
  && relative.split('/').every(part => part && part !== '..' && !part.startsWith('.'));

/** Persistent files are URL manifests. Working media lives in the OS temporary directory. */
export class MediaStorage {
  readonly cacheRoot: string;
  private pending = new Map<string, Promise<string>>();
  constructor(readonly dataDir: string, private upload = uploadCdnFile, private download = downloadCdnFile) {
    this.cacheRoot = path.join(os.tmpdir(), 'ai-audio-media', ownerKey(path.resolve(dataDir)));
  }
  directory(owner: string) { return path.join(this.cacheRoot, ownerKey(owner)); }
  private manifestPath(owner: string) { return path.join(this.dataDir, 'media', `${ownerKey(owner)}.json`); }
  entries(owner: string): Manifest {
    const file = this.manifestPath(owner);
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  private remember(owner: string, relative: string, entry: Entry) {
    const entries = this.entries(owner);
    entries[relative] = entry;
    const file = this.manifestPath(owner);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(entries), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  local(owner: string, relative: string) {
    if (!safeRelative(relative)) throw Object.assign(new Error('无效文件路径。'), { status: 400 });
    return path.join(this.directory(owner), relative);
  }
  relative(owner: string, url: string) {
    if (url.startsWith('/uploads/')) {
      const relative = decodeURIComponent(url.slice('/uploads/'.length));
      return safeRelative(relative) ? relative : null;
    }
    return Object.entries(this.entries(owner)).find(([, entry]) => entry.url === url)?.[0] || null;
  }
  async publish(owner: string, url: string): Promise<string> {
    if (!url.startsWith('/uploads/')) return url;
    const relative = this.relative(owner, url);
    if (!relative) throw Object.assign(new Error('无效文件路径。'), { status: 400 });
    const file = this.local(owner, relative), entry = this.entries(owner)[relative];
    if (!fs.existsSync(file) && !entry) {
      const legacy = path.join(this.dataDir, 'private-uploads', ownerKey(owner), relative);
      if (fs.existsSync(legacy) && fs.lstatSync(legacy).isFile()) {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.copyFileSync(legacy, file);
      }
    }
    if (!fs.existsSync(file)) {
      if (entry) return entry.url;
      throw Object.assign(new Error('文件不存在。'), { status: 404 });
    }
    const stat = fs.statSync(file);
    if (!stat.isFile() || !stat.size) throw new Error('文件为空。');
    if (entry && entry.size === stat.size && entry.mtimeMs === stat.mtimeMs) return entry.url;
    const key = `${owner}:${relative}`;
    let pending = this.pending.get(key);
    if (!pending) {
      pending = (async () => {
        const cdnUrl = await this.upload(file, `users/${ownerKey(owner)}`);
        this.remember(owner, relative, { url: cdnUrl, size: stat.size, mtimeMs: stat.mtimeMs });
        return cdnUrl;
      })().finally(() => this.pending.delete(key));
      this.pending.set(key, pending);
    }
    return pending;
  }
  async materialize(owner: string, url: string) {
    const relative = this.relative(owner, url);
    if (!relative) throw Object.assign(new Error('文件不存在或无权访问。'), { status: 404 });
    const file = this.local(owner, relative);
    if (!fs.existsSync(file)) {
      const entry = this.entries(owner)[relative];
      if (entry) {
        await this.download(entry.url, file);
        const stat = fs.statSync(file);
        if (stat.size !== entry.size) {
          fs.unlinkSync(file);
          throw Object.assign(new Error('CDN 文件大小校验失败。'), { code: 'CDN_SIZE_MISMATCH', status: 502 });
        }
        this.remember(owner, relative, { ...entry, mtimeMs: stat.mtimeMs });
      }
      else {
        const legacy = path.join(this.dataDir, 'private-uploads', ownerKey(owner), relative);
        if (!fs.existsSync(legacy) || !fs.lstatSync(legacy).isFile()) throw Object.assign(new Error('文件不存在。'), { status: 404 });
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.copyFileSync(legacy, file);
      }
    }
    return file;
  }
  async importUrl(owner: string, url: string) {
    const existing = this.relative(owner, url);
    if (existing) return this.materialize(owner, url);
    if (!isCdnUrl(url)) throw Object.assign(new Error('无效 CDN 文件。'), { status: 400 });
    const relative = `cdn_${createHash('sha256').update(url).digest('hex')}${path.extname(new URL(url).pathname)}`;
    const file = this.local(owner, relative);
    await this.download(url, file);
    const stat = fs.statSync(file);
    this.remember(owner, relative, { url, size: stat.size, mtimeMs: stat.mtimeMs });
    return file;
  }
  async publishValue(owner: string, value: any): Promise<any> {
    if (typeof value === 'string') return value.startsWith('/uploads/') ? this.publish(owner, value) : value;
    if (Array.isArray(value)) return Promise.all(value.map(item => this.publishValue(owner, item)));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await this.publishValue(owner, item)])));
  }
  async prepareValue(owner: string, value: any, field = ''): Promise<any> {
    if (typeof value === 'string') {
      if (/^(?:fileName|videoFileName|previewFileName)$/.test(field) && safeRelative(value) && this.entries(owner)[value]) {
        await this.materialize(owner, `/uploads/${value}`);
        return value;
      }
      if (value.startsWith('uploads/')) value = `/${value}`;
      if (!value.startsWith('/uploads/') && !isCdnUrl(value)) return value;
      const relative = this.relative(owner, value);
      if (!relative) {
        const file = await this.importUrl(owner, value);
        return `/uploads/${path.basename(file)}`;
      }
      await this.materialize(owner, value);
      if (relative.includes('/')) {
        const source = this.local(owner, relative);
        const flat = `cdn_${createHash('sha256').update(relative).digest('hex')}${path.extname(relative)}`;
        const file = this.local(owner, flat);
        fs.copyFileSync(source, file);
        const stat = fs.statSync(file), entry = this.entries(owner)[relative];
        if (entry) this.remember(owner, flat, { ...entry, size: stat.size, mtimeMs: stat.mtimeMs });
        return `/uploads/${flat}`;
      }
      return `/uploads/${relative.split('/').map(encodeURIComponent).join('/')}`;
    }
    if (Array.isArray(value)) return Promise.all(value.map(item => this.prepareValue(owner, item)));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await this.prepareValue(owner, item, key)])));
  }
  middleware(owner: () => string): express.RequestHandler {
    return (req, res, next) => {
      const id = owner(), json = res.json.bind(res);
      res.json = ((body: any) => {
        if (res.statusCode >= 400) return json(body);
        void this.publishValue(id, body).then(result => json(result), error => {
          console.error(JSON.stringify({ event: 'media.cdn.publish.failed', code: error.code, requestId: res.getHeader('X-Request-Id') }));
          res.status(error.status || 502); json({ error: 'CDN 文件保存失败，请重试。', code: error.code || 'CDN_UPLOAD_FAILED' });
        });
        return res;
      }) as typeof res.json;
      // Library metadata and agent manifests must retain CDN URLs, not temporary aliases.
      if (/^\/(?:mcp|api\/(?:mcp|ai\/assistant|sfx\/library|sfx\/sounds|sfx\/categories|audio-assets))(?:\/|$)/.test(req.path)) return next();
      void Promise.all([this.prepareValue(id, req.body), this.prepareValue(id, req.query)])
        .then(([body, query]) => { req.body = body; Object.assign(req.query, query); next(); }, next);
    };
  }
}

let activeStorage: MediaStorage | undefined;
export const getMediaStorage = () => activeStorage;
export function configureMediaStorage(dataDir: string, storage?: MediaStorage | null) {
  if (storage === undefined && process.env.MEDIA_STORAGE_MODE !== 'local') readCdnConfig();
  activeStorage = storage === null || (storage === undefined && process.env.MEDIA_STORAGE_MODE === 'local') ? undefined : storage || new MediaStorage(dataDir);
  return activeStorage;
}
