import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MediaStorage } from '../src/services/mediaStorage';
import { readCdnConfig, uploadCdnFile } from '../src/services/cdnStorage';

// Stop the application before --apply so manifests cannot change during migration.
const apply = process.argv.includes('--apply');
const removeLocal = process.argv.includes('--remove-local');
const data = path.resolve('data');
const library = process.env.SFX_LIBRARY_DIR ? path.resolve(process.env.SFX_LIBRARY_DIR) : path.join(data, 'sfx-library');
const storage = new MediaStorage(data);
const audioPattern = /\.(?:wav|mp3|m4a|aac|ogg|opus|flac|aiff?|mp4|m4v|mov|mkv|webm|png|jpe?g|webp|mid|zip|txt|md|csv|tsv|docx|xlsx)$/i;
const files = (root: string): string[] => !fs.existsSync(root) ? [] : fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
  if (entry.isSymbolicLink() || entry.name.startsWith('.')) return [];
  const file = path.join(root, entry.name);
  return entry.isDirectory() ? files(file) : entry.isFile() ? [file] : [];
});
const writeJson = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && !fs.existsSync(`${file}.pre-cdn.bak`)) fs.copyFileSync(file, `${file}.pre-cdn.bak`);
  const temp = `${file}.cdn.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(temp, file);
};

async function main() {
  const privateRoot = path.join(data, 'private-uploads');
  const privateFiles = files(privateRoot).filter(file => audioPattern.test(file) || /(?:mcp|assistant)_[a-f0-9-]+\.json$/i.test(file));
  const soundsFile = path.join(data, 'sounds.json');
  const sounds = fs.existsSync(soundsFile) ? JSON.parse(fs.readFileSync(soundsFile, 'utf8')) : [];
  if (!Array.isArray(sounds)) throw new Error('sounds.json is not an array; migration stopped');
  const librarySounds = sounds.filter(sound => typeof sound.storageKey === 'string' && sound.storageKey);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', privateFiles: privateFiles.length, librarySounds: librarySounds.length, removeLocal: apply && removeLocal }));
  if (!apply) { console.log('运行 --apply 上传并更新清单；追加 --remove-local 在全部清单更新成功后移除已迁移文件。执行前请停服并备份 data/。'); return; }
  readCdnConfig();
  const removable = new Set<string>();
  const aliases = new Map<string, Map<string, string>>();
  for (const file of privateFiles) {
    const parts = path.relative(privateRoot, file).split(path.sep), hash = parts.shift()!;
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Unexpected private owner directory');
    const relative = parts.join('/'), owner = `sha256:${hash}`;
    const cached = storage.local(owner, relative);
    fs.mkdirSync(path.dirname(cached), { recursive: true, mode: 0o700 });
    fs.copyFileSync(file, cached);
    const url = await storage.publish(owner, `/uploads/${relative.split('/').map(encodeURIComponent).join('/')}`);
    if (!aliases.has(hash)) aliases.set(hash, new Map());
    aliases.get(hash)!.set(relative, url); removable.add(file);
  }
  const libraryUrls = new Map<string, string>();
  for (const sound of librarySounds) {
    const key = String(sound.storageKey).replace(/\\/g, '/');
    const source = path.resolve(library, key), within = path.relative(library, source);
    if (!within || within.startsWith('..') || path.isAbsolute(within) || !fs.lstatSync(source).isFile()) throw new Error('Library original missing or invalid; migration stopped');
    let url = libraryUrls.get(key);
    if (!url) { url = await uploadCdnFile(source, 'library'); libraryUrls.set(key, url); }
    sound.url = sound.previewUrl = sound.downloadUrl = sound.path = url;
    delete sound.storageKey; removable.add(source);
  }
  const rewrite = (value: any, ownerHash?: string): any => {
    if (typeof value === 'string') {
      if (value.startsWith('/api/sfx/library/stream?')) return libraryUrls.get(new URL(value, 'http://local').searchParams.get('key') || '') || value;
      if (!value.startsWith('/uploads/')) return value;
      const relative = decodeURIComponent(value.slice(9));
      if (ownerHash) return aliases.get(ownerHash)?.get(relative) || value;
      const matches = [...aliases.values()].map(entries => entries.get(relative)).filter(Boolean);
      return matches.length === 1 ? matches[0] : value;
    }
    if (Array.isArray(value)) return value.map(item => rewrite(item, ownerHash));
    if (!value || typeof value !== 'object') return value;
    const owner = typeof value.owner === 'string' ? value.owner : undefined;
    const hash = owner ? createHash('sha256').update(owner).digest('hex') : ownerHash;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, hash)]));
  };
  for (const file of files(data).filter(file => file.endsWith('.json') && !file.includes(`${path.sep}media${path.sep}`) && file !== soundsFile)) {
    const original = JSON.parse(fs.readFileSync(file, 'utf8'));
    const hash = file.split(path.sep).find(part => /^[a-f0-9]{64}$/.test(part));
    const updated = rewrite(original, hash);
    if (path.basename(file) === 'job.json' && file.includes(`${path.sep}music-stems-`) && hash) {
      const folder = path.basename(path.dirname(file));
      updated.zipUrl = aliases.get(hash)?.get(`${folder}/${folder}.zip`) || updated.zipUrl;
      writeJson(path.join(data, 'media-jobs', hash, `${path.basename(path.dirname(file))}.json`), updated);
    } else if (JSON.stringify(updated) !== JSON.stringify(original)) writeJson(file, updated);
  }
  const rewrittenSounds = rewrite(sounds);
  if (fs.existsSync(soundsFile) && JSON.stringify(rewrittenSounds) !== JSON.stringify(JSON.parse(fs.readFileSync(soundsFile, 'utf8')))) writeJson(soundsFile, rewrittenSounds);
  if (removeLocal) for (const file of removable) fs.unlinkSync(file);
  console.log(JSON.stringify({ migratedPrivateFiles: privateFiles.length, migratedLibrarySounds: librarySounds.length, removedLocalFiles: removeLocal ? removable.size : 0 }));
}
main().catch(error => { console.error(JSON.stringify({ event: 'cdn.migration.failed', code: error.code || 'MIGRATION_FAILED', message: error.message })); process.exitCode = 1; });
