import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import { exec, execFile } from 'child_process';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import JSZip from 'jszip';
import ffmpegStatic from 'ffmpeg-static';
import { DEFAULT_CATEGORIES, INITIAL_SOUNDS } from './src/data/sfxData';
import type { SoundEffect } from './src/data/sfxData';
import multer from 'multer';
import {
  analyzeAudioDesign,
  analyzeAudioDesignVideoFile,
  generateSfxRequirements,
  generateLyricsFromMusicStyle,
  matchBestVoice,
  optimizeImportMetadata,
  regenerateLyrics,
  translateToEnglish,
} from './src/services/geminiService';
import { generateGeminiContent } from './src/services/geminiRetry';
import {
  fetchAvailableVoices,
  generateMusic,
  generateSoundEffect,
  generateSpeechToSpeech,
  generateVoice,
  isolateAudio,
  transcribeSpeech,
} from './src/services/elevenLabsService';

async function startServer() {
  const app = express();
  const PORT = Number.parseInt(process.env.PORT || '3000', 10);
  const FFMPEG_BINARY = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';

  app.disable('x-powered-by');

  const asyncRoute = (
    handler: (req: express.Request, res: express.Response) => Promise<unknown>
  ) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };

  // Use JSON middleware with large payload support for categories/sounds state
  app.use(express.json({ limit: '50mb' }));

  // Directories paths
  const dataDir = path.join(process.cwd(), 'data');
  const uploadsDir = path.join(process.cwd(), 'uploads');
  const geminiTempDir = path.join(dataDir, '.gemini-upload');
  const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
  const MAX_INLINE_MEDIA_BYTES = 24 * 1024 * 1024;
  const MAX_CHUNK_COUNT = 100;
  const normalizeUnitVolume = (value: unknown) => (
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(4, Math.max(0, value))
      : 1
  );
  const ALLOWED_VIDEO_EXTENSIONS = new Set([
    '.mp4',
    '.m4v',
    '.mov',
    '.webm',
    '.mkv',
    '.avi',
    '.mpeg',
    '.mpg',
    '.wmv',
  ]);
  const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mpeg': 'video/mpeg',
    '.mpg': 'video/mpeg',
    '.wmv': 'video/x-ms-wmv',
  };
  const ALLOWED_UPLOAD_EXTENSIONS = new Set([
    ...ALLOWED_VIDEO_EXTENSIONS,
    '.wav',
    '.mp3',
    '.m4a',
    '.aac',
    '.ogg',
    '.opus',
    '.flac',
    '.aif',
    '.aiff',
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.pdf',
  ]);
  const UPLOAD_EXTENSION_BY_MIME: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(VIDEO_MIME_BY_EXTENSION).map(([extension, mimeType]) => [mimeType, extension]),
    ),
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'audio/ogg': '.ogg',
    'audio/opus': '.opus',
    'audio/flac': '.flac',
    'audio/aiff': '.aiff',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  };

  const getSafeUploadExtension = (
    fileName: unknown,
    mimeType: unknown,
    fallback = '.bin',
  ) => {
    const extension = typeof fileName === 'string' ? path.extname(fileName).toLowerCase() : '';
    if (ALLOWED_UPLOAD_EXTENSIONS.has(extension)) return extension;
    const normalizedMimeType = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
    return UPLOAD_EXTENSION_BY_MIME[normalizedMimeType] || fallback;
  };

  const normalizeUploadDisplayName = (value: unknown, fallback: string) => {
    if (typeof value !== 'string') return fallback;
    const normalized = value
      .normalize('NFC')
      .replace(/[\0-\x1f\x7f]/g, ' ')
      .replace(/[\\/]/g, '_')
      .trim()
      .slice(0, 180);
    return normalized || fallback;
  };

  // Ensure directories exist
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  if (!fs.existsSync(geminiTempDir)) {
    fs.mkdirSync(geminiTempDir, { recursive: true });
  }

  const isPathInside = (root: string, candidate: string) => {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative !== ''
      && relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative);
  };

  const safeUnlink = async (filePath?: string) => {
    if (!filePath) return;
    await fs.promises.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') console.warn(`Failed to remove temporary file ${filePath}:`, error);
    });
  };

  const isRetryableFileAccessError = (error: unknown) => {
    const code = (error as NodeJS.ErrnoException)?.code;
    return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
  };

  const copyFileWithAccessRetry = async (sourcePath: string, destinationPath: string) => {
    const delays = [0, 150, 350, 700, 1_200];
    let lastError: unknown;

    for (const delay of delays) {
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        await fs.promises.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
        return;
      } catch (error) {
        lastError = error;
        await safeUnlink(destinationPath);
        if (!isRetryableFileAccessError(error)) throw error;
      }
    }

    throw Object.assign(
      new Error('视频临时文件正被系统占用，请稍后重新生成。'),
      { status: 503, cause: lastError },
    );
  };

  // Google Files API derives X-Goog-Upload-File-Name from the local path.
  // Undici only accepts ByteString request-header values, so an existing
  // Chinese (or otherwise non-ASCII) project filename must be uploaded through
  // a short-lived ASCII alias. Windows gets an independent copy because newly
  // uploaded files can be held briefly by scanners, and a hard link retains the
  // same underlying file lock.
  const createGeminiUploadAlias = async (sourcePath: string, mimeType: string) => {
    const extension = getSafeUploadExtension(sourcePath, mimeType, '.mp4');
    const aliasName = `gemini_video_${randomUUID()}${extension}`;
    const aliasPath = path.resolve(geminiTempDir, aliasName);
    if (!isPathInside(geminiTempDir, aliasPath)) {
      throw Object.assign(new Error('无法创建安全的视频分析临时文件。'), { status: 500 });
    }

    if (process.platform === 'win32') {
      await copyFileWithAccessRetry(sourcePath, aliasPath);
    } else {
      try {
        await fs.promises.link(sourcePath, aliasPath);
      } catch {
        await copyFileWithAccessRetry(sourcePath, aliasPath);
      }
    }

    return { aliasPath, aliasName };
  };

  const safeRemoveDirectory = async (directoryPath?: string) => {
    if (!directoryPath || !isPathInside(uploadsDir, directoryPath)) return;
    await fs.promises.rm(directoryPath, { recursive: true, force: true }).catch((error) => {
      console.warn(`Failed to remove temporary directory ${directoryPath}:`, error);
    });
  };

  // Helper to initialize GoogleGenAI on the server
  function getGoogleAI() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not configured.");
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }

  const parseSafeVideoFilename = (value: unknown) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 255) return null;
    if (/[\\/\0-\x1f\x7f]/.test(value)) return null;
    if (path.basename(value) !== value) return null;

    const originalExtension = path.extname(value);
    const extension = originalExtension.toLowerCase();
    if (!ALLOWED_VIDEO_EXTENSIONS.has(extension)) return null;

    const base = path.basename(value, originalExtension)
      .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_')
      .slice(0, 160);
    if (!base) return null;
    return { base, extension };
  };

  const categoriesFile = path.join(dataDir, 'categories.json');
  const soundsFile = path.join(dataDir, 'sounds.json');

  type AudioAssetSource = 'uploaded' | 'generated' | 'external' | 'library';
  type AudioAssetKind = 'music' | 'sfx';
  type IndexedAudioAsset = SoundEffect & {
    assetKind: AudioAssetKind;
    source: AudioAssetSource;
    downloadUrl: string;
    searchableText: string;
    score?: number;
  };

  const readSfxSounds = (): SoundEffect[] => {
    try {
      if (!fs.existsSync(soundsFile)) return INITIAL_SOUNDS;
      const content = fs.readFileSync(soundsFile, 'utf-8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : INITIAL_SOUNDS;
    } catch (err) {
      console.error('Error reading indexed sounds:', err);
      return INITIAL_SOUNDS;
    }
  };

  const normalizeSearchText = (value: unknown) => String(value || '').trim().toLowerCase();

  const inferAudioAssetSource = (sound: SoundEffect): AudioAssetSource => {
    const url = normalizeSearchText(sound.url);
    const fileName = normalizeSearchText(sound.fileName);
    const designer = normalizeSearchText(sound.designer);

    if (url.startsWith('/uploads/') || fileName.startsWith('upload_') || fileName.startsWith('audio_')) {
      return 'uploaded';
    }
    if (designer.includes('gemini') || designer.includes('elevenlabs') || designer.includes('ai')) {
      return 'generated';
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return 'external';
    }
    return 'library';
  };

  const inferAudioAssetKind = (sound: SoundEffect): AudioAssetKind => {
    const text = normalizeSearchText(`${sound.category} ${sound.subcategory || ''} ${sound.fileName} ${sound.path}`);
    return text.includes('music')
      || text.includes('bgm')
      || text.includes('配乐')
      || text.includes('音乐')
      || text.includes('闊充箰')
      ? 'music'
      : 'sfx';
  };

  const toIndexedAudioAsset = (sound: SoundEffect): IndexedAudioAsset => {
    const source = inferAudioAssetSource(sound);
    const assetKind = inferAudioAssetKind(sound);
    const searchableText = [
      sound.name,
      sound.fileName,
      sound.category,
      sound.subcategory,
      sound.designer,
      sound.path,
      sound.format,
      sound.sampleRate,
      sound.channels,
      ...(sound.tags || []),
      source,
      assetKind,
    ].map(normalizeSearchText).filter(Boolean).join(' ');

    return {
      ...sound,
      source,
      assetKind,
      downloadUrl: sound.url || '',
      searchableText,
    };
  };

  const scoreAudioAsset = (asset: IndexedAudioAsset, query: string) => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return 0;

    const tokens = normalizedQuery.split(/[\s,，、/\\|;；]+/).filter(Boolean);
    const name = normalizeSearchText(asset.name);
    const fileName = normalizeSearchText(asset.fileName);
    const category = normalizeSearchText(asset.category);
    const subcategory = normalizeSearchText(asset.subcategory);
    const tags = (asset.tags || []).map(normalizeSearchText);

    let score = 0;
    for (const token of tokens) {
      if (name === token || fileName === token) score += 120;
      if (name.includes(token)) score += 60;
      if (fileName.includes(token)) score += 55;
      if (tags.some(tag => tag === token)) score += 45;
      if (tags.some(tag => tag.includes(token))) score += 28;
      if (category.includes(token)) score += 22;
      if (subcategory.includes(token)) score += 18;
      if (asset.searchableText.includes(token)) score += 8;
    }
    return score;
  };

  const getAudioAssetStats = (assets: IndexedAudioAsset[]) => {
    const byCategory: Record<string, number> = {};
    const byFormat: Record<string, number> = {};
    const bySource: Record<AudioAssetSource, number> = {
      uploaded: 0,
      generated: 0,
      external: 0,
      library: 0,
    };
    const byKind: Record<AudioAssetKind, number> = {
      music: 0,
      sfx: 0,
    };
    const tagCounts: Record<string, number> = {};

    for (const asset of assets) {
      byCategory[asset.category || '未分类'] = (byCategory[asset.category || '未分类'] || 0) + 1;
      byFormat[asset.format || 'UNKNOWN'] = (byFormat[asset.format || 'UNKNOWN'] || 0) + 1;
      bySource[asset.source] += 1;
      byKind[asset.assetKind] += 1;
      for (const tag of asset.tags || []) {
        if (!tag) continue;
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    return {
      total: assets.length,
      uploaded: bySource.uploaded,
      generated: bySource.generated,
      external: bySource.external,
      library: bySource.library,
      byCategory,
      byFormat,
      bySource,
      byKind,
      topTags: Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([tag, count]) => ({ tag, count })),
      indexedAt: new Date().toISOString(),
    };
  };

  const getIndexedAudioAssets = () => readSfxSounds().map(toIndexedAudioAsset);

  // Serve uploaded files statically
  app.use('/uploads', express.static(uploadsDir));

  // --- API Endpoints ---

  // HTML5 client bootstrapping and deployment diagnostics.
  // This endpoint only reports whether server-side secrets exist; it never
  // returns secret values to the browser.
  app.get('/api/health', (req, res) => {
    return res.json({
      ok: true,
      runtime: 'server',
      services: {
        gemini: Boolean(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY),
        elevenLabs: Boolean(process.env.ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY),
        ffmpeg: Boolean(FFMPEG_BINARY),
        demucsConfigured: Boolean(process.env.DEMUCS_COMMAND || process.env.DEMUCS_PYTHON),
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/video/separation-engines', asyncRoute(async (_req, res) => {
    const demucs = await probeDemucsAvailability();
    return res.json({
      preferred: demucs.available ? 'demucs-local' : 'ffmpeg-filter-fallback',
      demucs,
      fallback: {
        engine: 'ffmpeg-filter-fallback',
        available: true,
        ffmpegBinary: FFMPEG_BINARY,
      },
      timestamp: new Date().toISOString(),
    });
  }));

  // 1. Get Categories
  app.get('/api/sfx/categories', (req, res) => {
    try {
      if (fs.existsSync(categoriesFile)) {
        const content = fs.readFileSync(categoriesFile, 'utf-8');
        return res.json(JSON.parse(content));
      }
      return res.json(DEFAULT_CATEGORIES);
    } catch (err: any) {
      console.error('Error reading categories:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 2. Save Categories
  app.post('/api/sfx/categories', (req, res) => {
    try {
      const categories = req.body;
      if (!Array.isArray(categories)) {
        return res.status(400).json({ error: 'Invalid categories format' });
      }
      fs.writeFileSync(categoriesFile, JSON.stringify(categories, null, 2), 'utf-8');
      return res.json({ success: true });
    } catch (err: any) {
      console.error('Error saving categories:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 3. Get Sound Effects
  app.get('/api/sfx/sounds', (req, res) => {
    try {
      if (fs.existsSync(soundsFile)) {
        const content = fs.readFileSync(soundsFile, 'utf-8');
        return res.json(JSON.parse(content));
      }
      return res.json(INITIAL_SOUNDS);
    } catch (err: any) {
      console.error('Error reading sounds:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 4. Save Sound Effects List
  app.post('/api/sfx/sounds', (req, res) => {
    try {
      const sounds = req.body;
      if (!Array.isArray(sounds)) {
        return res.status(400).json({ error: 'Invalid sounds format' });
      }
      fs.writeFileSync(soundsFile, JSON.stringify(sounds, null, 2), 'utf-8');
      return res.json({ success: true });
    } catch (err: any) {
      console.error('Error saving sounds:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/audio-assets', (req, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const category = normalizeSearchText(req.query.category);
      const subcategory = normalizeSearchText(req.query.subcategory);
      const tag = normalizeSearchText(req.query.tag);
      const format = normalizeSearchText(req.query.format);
      const source = normalizeSearchText(req.query.source);
      const kind = normalizeSearchText(req.query.kind);
      const limitValue = Number.parseInt(String(req.query.limit || '120'), 10);
      const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 500) : 120;

      const assets = getIndexedAudioAssets()
        .map(asset => ({ ...asset, score: scoreAudioAsset(asset, query) }))
        .filter(asset => {
          if (query && (asset.score || 0) <= 0) return false;
          if (category && normalizeSearchText(asset.category) !== category) return false;
          if (subcategory && normalizeSearchText(asset.subcategory) !== subcategory) return false;
          if (tag && !(asset.tags || []).some(item => normalizeSearchText(item) === tag || normalizeSearchText(item).includes(tag))) return false;
          if (format && normalizeSearchText(asset.format) !== format) return false;
          if (source && asset.source !== source) return false;
          if (kind && asset.assetKind !== kind) return false;
          return true;
        })
        .sort((a, b) => {
          if (query) return (b.score || 0) - (a.score || 0);
          if (a.source === 'uploaded' && b.source !== 'uploaded') return -1;
          if (a.source !== 'uploaded' && b.source === 'uploaded') return 1;
          return a.name.localeCompare(b.name, 'zh-CN');
        });

      return res.json({
        assets: assets.slice(0, limit),
        total: assets.length,
        limit,
        indexedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('Error searching audio assets:', err);
      return res.status(500).json({ error: err.message || 'Failed to search audio assets' });
    }
  });

  app.get('/api/audio-assets/stats', (_req, res) => {
    try {
      return res.json(getAudioAssetStats(getIndexedAudioAssets()));
    } catch (err: any) {
      console.error('Error reading audio asset stats:', err);
      return res.status(500).json({ error: err.message || 'Failed to read audio asset stats' });
    }
  });

  app.post('/api/audio-assets/reindex', (_req, res) => {
    try {
      const assets = getIndexedAudioAssets();
      return res.json({
        success: true,
        message: 'Audio asset index refreshed from the existing SFX library.',
        stats: getAudioAssetStats(assets),
      });
    } catch (err: any) {
      console.error('Error refreshing audio asset index:', err);
      return res.status(500).json({ error: err.message || 'Failed to refresh audio asset index' });
    }
  });

  app.get('/api/audio-assets/:id', (req, res) => {
    try {
      const asset = getIndexedAudioAssets().find(item => item.id === req.params.id);
      if (!asset) return res.status(404).json({ error: 'Audio asset not found' });
      return res.json(asset);
    } catch (err: any) {
      console.error('Error reading audio asset:', err);
      return res.status(500).json({ error: err.message || 'Failed to read audio asset' });
    }
  });

  // Configure multer disk storage for multipart/form-data
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const ext = getSafeUploadExtension(file.originalname, file.mimetype, '.wav');
      const cleanFilename = `upload_${randomUUID()}${ext}`;
      cb(null, cleanFilename);
    }
  });

  const upload = multer({ 
    storage,
    limits: { fileSize: MAX_UPLOAD_BYTES }
  });

  type AudioDesignVideoPreupload = {
    uploadId: string;
    fileUri: string;
    mimeType: string;
    displayName: string;
    geminiFileName: string;
    expiresAt: number;
  };
  const AUDIO_DESIGN_PREUPLOAD_TTL_MS = 30 * 60 * 1000;
  const audioDesignVideoPreuploads = new Map<string, AudioDesignVideoPreupload>();

  const deleteGeminiPreupload = async (entry?: AudioDesignVideoPreupload) => {
    if (!entry?.geminiFileName) return;
    try {
      await getGoogleAI().files.delete({ name: entry.geminiFileName });
    } catch (error) {
      console.warn('Failed to delete preuploaded Gemini video:', error);
    }
  };

  const cleanupExpiredAudioDesignPreuploads = async () => {
    const now = Date.now();
    const expiredEntries = [...audioDesignVideoPreuploads.values()]
      .filter(entry => entry.expiresAt <= now);
    for (const entry of expiredEntries) {
      audioDesignVideoPreuploads.delete(entry.uploadId);
      await deleteGeminiPreupload(entry);
    }
  };

  setInterval(() => {
    void cleanupExpiredAudioDesignPreuploads();
  }, 5 * 60 * 1000).unref?.();

  const aiUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  const sendAudioBlob = async (res: express.Response, blob: Blob) => {
    res.setHeader('Content-Type', blob.type || 'audio/mpeg');
    return res.send(Buffer.from(await blob.arrayBuffer()));
  };

  const parseNumber = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };

  type AudioExportFormat = 'mp3' | 'wav' | 'aac';

  const normalizeAudioExportFormat = (value: unknown): AudioExportFormat => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'wav' || normalized === 'aac') return normalized;
    return 'mp3';
  };

  const normalizeSampleRate = (value: unknown) => {
    const parsed = Number.parseInt(String(value), 10);
    return [44100, 48000, 96000].includes(parsed) ? parsed : 48000;
  };

  const normalizeAudioBitrate = (value: unknown) => {
    const normalized = String(value || '').trim().toLowerCase();
    return ['128k', '192k', '256k', '320k'].includes(normalized) ? normalized : '192k';
  };

  const normalizeBitDepth = (value: unknown) => {
    const parsed = Number.parseInt(String(value), 10);
    return [16, 24, 32].includes(parsed) ? parsed : 24;
  };

  const getPcmCodec = (bitDepth: number) => {
    if (bitDepth === 32) return 'pcm_s32le';
    if (bitDepth === 24) return 'pcm_s24le';
    return 'pcm_s16le';
  };

  const getAudioOutputArgs = (
    format: AudioExportFormat,
    sampleRate: number,
    bitrate: string,
    bitDepth = 24,
  ) => {
    const args = ['-ar', String(sampleRate)];
    if (format === 'wav') {
      return [...args, '-c:a', getPcmCodec(bitDepth)];
    }
    if (format === 'aac') {
      return [...args, '-c:a', 'aac', '-b:a', bitrate];
    }
    return [...args, '-c:a', 'libmp3lame', '-b:a', bitrate];
  };

  const getVideoAudioOutputArgs = (
    format: AudioExportFormat,
    sampleRate: number,
    bitrate: string,
    bitDepth = 24,
  ) => {
    if (format === 'wav') {
      return {
        extension: '.mov',
        args: ['-ar', String(sampleRate), '-c:a', getPcmCodec(bitDepth)],
      };
    }
    if (format === 'mp3') {
      return {
        extension: '.mp4',
        args: ['-ar', String(sampleRate), '-c:a', 'libmp3lame', '-b:a', bitrate],
      };
    }
    return {
      extension: '.mp4',
      args: ['-ar', String(sampleRate), '-c:a', 'aac', '-b:a', bitrate],
    };
  };

  const runFfmpegFile = (
    args: string[],
    timeout = 180_000,
  ) => new Promise<void>((resolve, reject) => {
    execFile(
      FFMPEG_BINARY,
      args,
      {
        timeout,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const ffmpegUnavailable = /ffmpeg.*(?:not recognized|not found)|ENOENT/i.test(`${error.message}\n${stderr}`);
        reject(Object.assign(
          new Error(ffmpegUnavailable
            ? '本机未安装或无法访问 FFmpeg，无法拆分视频原声音频。'
            : `FFmpeg 音频拆分失败：${String(stderr || error.message).trim().split(/\r?\n/).slice(-1)[0] || error.message}`),
          { status: ffmpegUnavailable ? 503 : 422, cause: error },
        ));
      },
    );
  });

  const runExternalFile = (
    binary: string,
    args: string[],
    timeout = 180_000,
    label = 'External audio process',
  ) => new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        timeout,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
          return;
        }
        reject(Object.assign(
          new Error(`${label} failed: ${String(stderr || error.message).trim().split(/\r?\n/).slice(-1)[0] || error.message}`),
          { cause: error },
        ));
      },
    );
  });

  const splitCommandLine = (commandLine: string) => {
    const parts: string[] = [];
    commandLine.replace(/"([^"]+)"|'([^']+)'|(\S+)/g, (_match, doubleQuoted, singleQuoted, bare) => {
      parts.push(doubleQuoted || singleQuoted || bare);
      return '';
    });
    return parts;
  };

  const getDemucsCommandCandidates = () => {
    const candidates: Array<{ label: string; binary: string; argsPrefix: string[] }> = [];
    const addPythonCandidate = (label: string, pythonPath?: string) => {
      const binary = String(pythonPath || '').trim();
      if (binary) candidates.push({ label, binary, argsPrefix: ['-m', 'demucs'] });
    };

    const demucsCommand = String(process.env.DEMUCS_COMMAND || '').trim();
    if (demucsCommand) {
      const [binary, ...argsPrefix] = splitCommandLine(demucsCommand);
      if (binary) candidates.push({ label: 'demucs-command', binary, argsPrefix });
    }

    addPythonCandidate('demucs-python-env', process.env.DEMUCS_PYTHON);

    const workspaceDemucsPython = process.platform === 'win32'
      ? path.join(process.cwd(), 'tools', 'demucs', '.venv', 'Scripts', 'python.exe')
      : path.join(process.cwd(), 'tools', 'demucs', '.venv', 'bin', 'python');
    if (fs.existsSync(workspaceDemucsPython)) {
      addPythonCandidate('workspace-demucs-python', workspaceDemucsPython);
    }

    candidates.push({ label: 'demucs-path', binary: 'demucs', argsPrefix: [] });

    if (process.platform === 'win32') {
      candidates.push({ label: 'py-3.11-demucs', binary: 'py', argsPrefix: ['-3.11', '-m', 'demucs'] });
      candidates.push({ label: 'py-demucs', binary: 'py', argsPrefix: ['-m', 'demucs'] });
    } else {
      candidates.push({ label: 'python3-demucs', binary: 'python3', argsPrefix: ['-m', 'demucs'] });
      candidates.push({ label: 'python-demucs', binary: 'python', argsPrefix: ['-m', 'demucs'] });
    }

    return candidates;
  };

  async function probeDemucsAvailability() {
    const candidates = getDemucsCommandCandidates();
    const errors: string[] = [];

    for (const candidate of candidates) {
      try {
        await runExternalFile(
          candidate.binary,
          [...candidate.argsPrefix, '--help'],
          15_000,
          candidate.label,
        );
        return {
          available: true,
          engine: 'demucs-local',
          candidate: candidate.label,
          command: [candidate.binary, ...candidate.argsPrefix].join(' '),
          model: process.env.DEMUCS_MODEL || 'htdemucs',
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${candidate.label}: ${message}`);
      }
    }

    return {
      available: false,
      engine: 'ffmpeg-filter-fallback',
      candidate: null,
      command: null,
      model: process.env.DEMUCS_MODEL || 'htdemucs',
      errors: errors.slice(-5),
    };
  }

  const findDemucsStemFiles = async (directoryPath: string) => {
    const stems: Record<string, string> = {};
    const wanted = new Set(['vocals.wav', 'no_vocals.wav', 'drums.wav', 'bass.wav', 'other.wav', 'guitar.wav', 'piano.wav']);
    const walk = async (currentPath: string, depth = 0): Promise<void> => {
      if (depth > 6) return;
      const entries = await fs.promises.readdir(currentPath, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const entryPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          await walk(entryPath, depth + 1);
          continue;
        }
        const lowerName = entry.name.toLowerCase();
        if (wanted.has(lowerName) && !stems[lowerName]) {
          stems[lowerName] = entryPath;
        }
      }
    };
    await walk(directoryPath);
    return stems;
  };

  const normalizeWavStem = async (inputPath: string, outputPath: string) => {
    await runFfmpegFile([
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', inputPath,
      '-ac', '2',
      '-ar', '48000',
      '-c:a', 'pcm_s16le',
      outputPath,
    ]);
  };

  const mixWavStems = async (inputPaths: string[], outputPath: string) => {
    const uniqueInputs = Array.from(new Set(inputPaths.filter(Boolean)));
    if (uniqueInputs.length === 0) {
      throw new Error('Demucs did not produce enough accompaniment stems.');
    }
    if (uniqueInputs.length === 1) {
      await normalizeWavStem(uniqueInputs[0], outputPath);
      return;
    }
    const inputArgs = uniqueInputs.flatMap(inputPath => ['-i', inputPath]);
    await runFfmpegFile([
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      ...inputArgs,
      '-filter_complex',
      `amix=inputs=${uniqueInputs.length}:duration=longest:dropout_transition=0,volume=0.95,aformat=sample_rates=48000:channel_layouts=stereo`,
      '-c:a', 'pcm_s16le',
      outputPath,
    ]);
  };

  const tryRunDemucsSeparation = async (
    originalAudioPath: string,
    baseName: string,
    outputs: {
      vocalPath: string;
      musicPath: string;
    },
  ) => {
    const candidates = getDemucsCommandCandidates();
    const demucsOutputRoot = path.resolve(uploadsDir, `${baseName}_demucs`);
    if (!isPathInside(uploadsDir, demucsOutputRoot)) {
      throw Object.assign(new Error('Unable to create a safe Demucs working directory.'), { status: 500 });
    }

    const errors: string[] = [];
    for (const candidate of candidates) {
      await safeRemoveDirectory(demucsOutputRoot);
      await fs.promises.mkdir(demucsOutputRoot, { recursive: true });

      try {
        await runExternalFile(
          candidate.binary,
          [
            ...candidate.argsPrefix,
            '-n', process.env.DEMUCS_MODEL || 'htdemucs',
            '--out', demucsOutputRoot,
            originalAudioPath,
          ],
          parseNumber(process.env.DEMUCS_TIMEOUT_MS, 20 * 60_000, 60_000, 120 * 60_000),
          candidate.label,
        );

        const stems = await findDemucsStemFiles(demucsOutputRoot);
        const vocalsPath = stems['vocals.wav'];
        const noVocalsPath = stems['no_vocals.wav'];
        const accompanimentPaths = noVocalsPath
          ? [noVocalsPath]
          : [
            stems['drums.wav'],
            stems['bass.wav'],
            stems['other.wav'],
            stems['guitar.wav'],
            stems['piano.wav'],
          ].filter((stemPath): stemPath is string => Boolean(stemPath));
        if (!vocalsPath || accompanimentPaths.length === 0) {
          throw new Error('Demucs finished but did not produce the expected vocal/accompaniment stems.');
        }

        await normalizeWavStem(vocalsPath, outputs.vocalPath);
        await mixWavStems(accompanimentPaths, outputs.musicPath);

        await safeRemoveDirectory(demucsOutputRoot);
        return {
          ok: true as const,
          engine: 'demucs-local' as const,
          candidate: candidate.label,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${candidate.label}: ${message}`);
        console.warn(`Demucs separation candidate failed (${candidate.label}); trying fallback:`, error);
      }
    }

    await safeRemoveDirectory(demucsOutputRoot);
    return {
      ok: false as const,
      errors,
    };
  };

  const sanitizeExportName = (name: unknown, fallback: string) => {
    const raw = String(name || fallback)
      .replace(/\.[^/.]+$/, '')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .trim();
    return raw.length > 0 ? raw.slice(0, 80) : fallback;
  };

  const buildAtempoFilter = (value: unknown) => {
    const speed = parseNumber(value, 1, 0.25, 4);
    if (Math.abs(speed - 1) < 0.0001) return '';

    const factors: number[] = [];
    let remaining = speed;
    while (remaining < 0.5 - 0.0001) {
      factors.push(0.5);
      remaining /= 0.5;
    }
    while (remaining > 2 + 0.0001) {
      factors.push(2);
      remaining /= 2;
    }
    if (Math.abs(remaining - 1) >= 0.0001) factors.push(remaining);

    return factors
      .map(factor => `atempo=${Number(factor.toFixed(6))}`)
      .join(',');
  };

  const buildTimelineAudioFilter = (
    inputIndex: number,
    clip: any,
    outputLabel: string,
    sampleRate = 44100,
  ) => {
    const isDubbingClip = clip?.trackType === 'dubbing'
      || clip?.trackId === 'dubbing'
      || (typeof clip?.text === 'string' && clip.text.trim().length > 0);
    let clipStartTime = parseNumber(clip?.startTime, 0, 0, 3_600);
    let clipDuration = parseNumber(clip?.duration, 3, 0.01, 3_600);
    const subtitleStartTime = Number(clip?.subtitleStartTime);
    const subtitleEndTime = Number(clip?.subtitleEndTime);
    const hasLinkedSubtitleWindow = isDubbingClip
      && typeof clip?.subtitleId === 'string'
      && clip.subtitleId.trim().length > 0
      && Number.isFinite(subtitleStartTime)
      && Number.isFinite(subtitleEndTime)
      && subtitleEndTime > subtitleStartTime;
    if (hasLinkedSubtitleWindow) {
      const minimumWindowDuration = Math.min(0.01, subtitleEndTime - subtitleStartTime);
      clipStartTime = Math.min(
        Math.max(subtitleStartTime, clipStartTime),
        subtitleEndTime - minimumWindowDuration,
      );
      clipDuration = Math.max(
        minimumWindowDuration,
        Math.min(clipDuration, subtitleEndTime - clipStartTime),
      );
    }
    const clipSpeed = parseNumber(clip?.speed, 1, 0.25, 4);
    const sourceOffset = parseNumber(clip?.sourceOffset, 0, 0, 3_600);
    const delayMs = Math.max(0, Math.round(clipStartTime * 1_000));
    const atempoFilter = buildAtempoFilter(clipSpeed);
    const speedSegment = atempoFilter ? `,${atempoFilter}` : '';
    const sourceReadDuration = Number((clipDuration * clipSpeed).toFixed(3));
    const sourceTrimSegment = `,atrim=start=${Number(sourceOffset.toFixed(3))}:duration=${sourceReadDuration},asetpts=PTS-STARTPTS`;
    // Generated speech must never bleed into the following subtitle. Padding
    // keeps a short line aligned to its full window; atrim caps long lines.
    const dubbingWindow = isDubbingClip
      ? `,apad,atrim=duration=${Number(clipDuration.toFixed(3))},asetpts=PTS-STARTPTS`
      : '';
    const fadeIn = parseNumber(clip?.fadeIn, 0, 0, Math.min(5, clipDuration / 2));
    const fadeOut = parseNumber(clip?.fadeOut, 0, 0, Math.min(5, clipDuration / 2));
    const fadeInSegment = fadeIn > 0.001
      ? `,afade=t=in:st=0:d=${Number(fadeIn.toFixed(3))}`
      : '';
    const fadeOutSegment = fadeOut > 0.001
      ? `,afade=t=out:st=${Number(Math.max(0, clipDuration - fadeOut).toFixed(3))}:d=${Number(fadeOut.toFixed(3))}`
      : '';
    const enhancementPreset = String(clip?.audioEnhancementPreset || 'none').trim();
    const enhancementSegment = (() => {
      switch (enhancementPreset) {
        case 'voice_clean':
          return ',highpass=f=80,lowpass=f=13000,afftdn=nf=-25,dynaudnorm=f=150:g=8';
        case 'voice_warm':
          return ',highpass=f=70,lowpass=f=14000,equalizer=f=180:t=q:w=1:g=1.5,equalizer=f=3200:t=q:w=1:g=1.2,dynaudnorm=f=150:g=6';
        case 'broadcast':
          return ',highpass=f=90,lowpass=f=12000,equalizer=f=3500:t=q:w=1:g=2,dynaudnorm=f=120:g=7,alimiter=limit=0.95';
        case 'sfx_punch':
          return ',highpass=f=30,equalizer=f=100:t=q:w=1:g=1.5,equalizer=f=4500:t=q:w=1:g=2,alimiter=limit=0.98';
        case 'bgm_bed':
          return ',highpass=f=35,lowpass=f=16000,equalizer=f=2500:t=q:w=1.2:g=-1.5,alimiter=limit=0.92';
        default:
          return '';
      }
    })();

    return `[${inputIndex}:a]aformat=sample_rates=${sampleRate}:channel_layouts=stereo${sourceTrimSegment}${speedSegment}${dubbingWindow}${enhancementSegment}${fadeInSegment}${fadeOutSegment},volume=${normalizeUnitVolume(clip?.volume)},adelay=${delayMs}|${delayMs}[${outputLabel}]`;
  };

  const resolveValidatedUploadedVideo = async (fileName: unknown) => {
    const safeName = parseSafeVideoFilename(fileName);
    if (!safeName || typeof fileName !== 'string') {
      throw Object.assign(new Error('服务器视频文件名无效，请重新上传视频。'), { status: 400 });
    }

    const videoPath = path.resolve(uploadsDir, fileName);
    if (!isPathInside(uploadsDir, videoPath)) {
      throw Object.assign(new Error('服务器视频路径无效。'), { status: 400 });
    }

    let videoStat: fs.Stats;
    try {
      videoStat = await fs.promises.stat(videoPath);
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        throw Object.assign(new Error('服务器上的视频已失效，请重新上传后再分析。'), { status: 404 });
      }
      throw error;
    }
    if (!videoStat.isFile() || videoStat.size <= 0 || videoStat.size > MAX_UPLOAD_BYTES) {
      throw Object.assign(new Error('服务器视频无效或超过 100MB 限制。'), { status: 413 });
    }

    return {
      videoPath,
      displayName: fileName,
      mimeType: VIDEO_MIME_BY_EXTENSION[safeName.extension],
    };
  };

  const extractServerVideoKeyframes = async (
    fileName: unknown,
    requestedDuration: unknown,
  ): Promise<Array<{ timestamp: number; base64: string }>> => {
    const { videoPath } = await resolveValidatedUploadedVideo(fileName);

    const duration = parseNumber(requestedDuration, 30, 1, 3_600);
    const frameCount = 6;
    const firstTimestamp = duration / (frameCount * 2);
    const temporaryDirectory = await fs.promises.mkdtemp(path.join(uploadsDir, '.video-analysis-'));
    if (!isPathInside(uploadsDir, temporaryDirectory)) {
      await safeRemoveDirectory(temporaryDirectory);
      throw Object.assign(new Error('无法创建安全的视频分析目录。'), { status: 500 });
    }

    try {
      const outputPattern = path.join(temporaryDirectory, 'frame_%02d.jpg');
      const filter = `fps=${frameCount}/${duration.toFixed(3)},scale=512:512:force_original_aspect_ratio=decrease`;
      await new Promise<void>((resolve, reject) => {
        execFile(
          FFMPEG_BINARY,
          [
            '-hide_banner',
            '-loglevel', 'error',
            '-ss', firstTimestamp.toFixed(3),
            '-i', videoPath,
            '-an',
            '-sn',
            '-vf', filter,
            '-frames:v', String(frameCount),
            '-q:v', '6',
            '-start_number', '0',
            '-y',
            outputPattern,
          ],
          {
            timeout: 30_000,
            windowsHide: true,
            maxBuffer: 2 * 1024 * 1024,
          },
          (error, _stdout, stderr) => {
            if (!error) {
              resolve();
              return;
            }

            const processError = error as NodeJS.ErrnoException & { killed?: boolean };
            const status = processError.code === 'ENOENT' ? 503 : processError.killed ? 504 : 422;
            const detail = String(stderr || '').trim().split(/\r?\n/).slice(-1)[0];
            reject(Object.assign(new Error(
              status === 503
                ? '服务器尚未安装 FFmpeg，无法执行视频画面回退分析。'
                : status === 504
                  ? '服务器提取视频关键帧超时，请缩短视频后重试。'
                  : `服务器无法读取此视频编码${detail ? `：${detail}` : '。'}`,
            ), { status }));
          },
        );
      });

      const frameFiles = (await fs.promises.readdir(temporaryDirectory))
        .filter(name => /^frame_\d+\.jpg$/i.test(name))
        .sort()
        .slice(0, frameCount);
      if (frameFiles.length === 0) {
        throw Object.assign(new Error('服务器未能从视频中提取画面，请转换为 H.264 MP4 后重试。'), { status: 422 });
      }

      const frames: Array<{ timestamp: number; base64: string }> = [];
      let totalEncodedLength = 0;
      for (let index = 0; index < frameFiles.length; index += 1) {
        const framePath = path.resolve(temporaryDirectory, frameFiles[index]);
        if (!isPathInside(temporaryDirectory, framePath)) continue;
        const base64 = (await fs.promises.readFile(framePath)).toString('base64');
        totalEncodedLength += base64.length;
        if (base64.length > 1_500_000 || totalEncodedLength > 8_000_000) {
          throw Object.assign(new Error('服务器提取的关键帧数据过大。'), { status: 413 });
        }
        frames.push({
          timestamp: Number(Math.min(
            Math.max(0, duration - 0.05),
            firstTimestamp + (index * duration / frameCount),
          ).toFixed(1)),
          base64,
        });
      }
      if (frames.length === 0) {
        throw Object.assign(new Error('服务器未能生成有效关键帧。'), { status: 422 });
      }
      return frames;
    } finally {
      await safeRemoveDirectory(temporaryDirectory);
    }
  };

  const validateVoiceId = (value: unknown) => {
    const voiceId = String(value || '');
    if (!/^[a-zA-Z0-9_-]{10,64}$/.test(voiceId)) {
      throw Object.assign(new Error('Invalid voiceId'), { status: 400 });
    }
    return voiceId;
  };

  const resolveUploadedAudioUrlPath = (value: unknown) => {
    const audioUrl = String(value || '').trim();
    if (!audioUrl.startsWith('/uploads/')) {
      throw Object.assign(new Error('请选择拆分出来的人声音频片段后再匹配相似声音。'), { status: 400 });
    }

    const fileName = path.basename(audioUrl.split(/[?#]/)[0]);
    if (!fileName || fileName !== audioUrl.split(/[?#]/)[0].replace(/^\/uploads\//, '')) {
      throw Object.assign(new Error('音频片段路径无效，无法匹配声音。'), { status: 400 });
    }

    const extension = path.extname(fileName).toLowerCase();
    if (!['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.webm'].includes(extension)) {
      throw Object.assign(new Error('仅支持使用音频片段匹配相似声音。'), { status: 415 });
    }

    const filePath = path.resolve(uploadsDir, fileName);
    if (!isPathInside(uploadsDir, filePath) || !fs.existsSync(filePath)) {
      throw Object.assign(new Error('找不到拆分出来的人声音频文件，请重新拆分后再试。'), { status: 404 });
    }

    const stat = fs.statSync(filePath);
    if (stat.size <= 0) {
      throw Object.assign(new Error('人声音频片段为空，无法匹配声音。'), { status: 422 });
    }
    if (stat.size > 12 * 1024 * 1024) {
      throw Object.assign(new Error('人声音频片段过大，请选择更短、更清晰的一句台词来匹配。'), { status: 413 });
    }

    const mimeType = extension === '.mp3'
      ? 'audio/mpeg'
      : extension === '.m4a'
        ? 'audio/mp4'
        : extension === '.aac'
          ? 'audio/aac'
          : extension === '.ogg'
            ? 'audio/ogg'
            : extension === '.webm'
              ? 'audio/webm'
              : 'audio/wav';

    return { filePath, mimeType };
  };

  const normalizeVoiceForMatching = (voice: any) => {
    const id = String(voice?.id || voice?.voice_id || '').trim();
    if (!/^[a-zA-Z0-9_-]{10,64}$/.test(id)) return null;
    const labels = voice?.labels && typeof voice.labels === 'object' ? voice.labels : {};
    const tags = Array.isArray(voice?.tags) ? voice.tags : Object.values(labels).filter(Boolean);
    return {
      id,
      name: String(voice?.name || voice?.englishName || id).slice(0, 120),
      englishName: String(voice?.englishName || voice?.name || id).slice(0, 120),
      gender: voice?.gender === 'male' ? 'male' : voice?.gender === 'female' ? 'female' : String(labels.gender || ''),
      category: String(voice?.category || voice?.category_name || '').slice(0, 80),
      description: String(voice?.description || labels.description || '').slice(0, 300),
      tags: tags.map((tag: any) => String(tag).slice(0, 60)).filter(Boolean).slice(0, 12),
    };
  };

  const localVoiceMatchFallback = (voices: any[], preferredGender?: string) => {
    const gender = preferredGender === 'male' || preferredGender === 'female' ? preferredGender : '';
    return voices
      .map((voice, index) => {
        const voiceText = [
          voice.name,
          voice.englishName,
          voice.category,
          voice.description,
          ...(voice.tags || []),
        ].join(' ').toLowerCase();
        let score = 68 - index;
        if (gender && String(voice.gender).toLowerCase().includes(gender)) score += 16;
        if (/natural|真实|自然|conversation|口语|dialogue|对话/i.test(voiceText)) score += 8;
        if (/young|adult|middle|warm|calm|serious|energetic|温暖|沉稳|活泼|叙事/i.test(voiceText)) score += 4;
        return {
          voiceId: voice.id,
          score: Math.max(45, Math.min(92, score)),
          reason: '基于声音库标签与可用元数据的近似推荐。',
        };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);
  };

  // --- Server-side AI gateway for the HTML5 client ---
  app.post('/api/ai/gemini/audio-design', asyncRoute(async (req, res) => {
    const { files, requirements = '', target = {}, isInstrumental = true } = req.body || {};
    if (!Array.isArray(files)) {
      return res.status(400).json({ error: 'files must be an array' });
    }
    if (files.length > 16) {
      return res.status(400).json({ error: '素材切片数量过多，请减少文件后重试。' });
    }
    if (files.some((file: any) => file?.fileUri || typeof file?.data !== 'string')) {
      return res.status(400).json({ error: '快速模式素材格式无效。' });
    }
    const decodedLength = files.reduce((total: number, file: any) => {
      if (typeof file?.data !== 'string') return total;
      const separatorIndex = file.data.indexOf(',');
      const base64 = separatorIndex >= 0 ? file.data.slice(separatorIndex + 1) : file.data;
      const paddingBytes = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
      return total + Math.max(0, Math.floor((base64.length * 3) / 4) - paddingBytes);
    }, 0);
    if (decodedLength > MAX_INLINE_MEDIA_BYTES) {
      return res.status(413).json({ error: '素材总量过大，请减少文件数量或压缩素材。' });
    }
    const result = await analyzeAudioDesign(files, String(requirements), target, Boolean(isInstrumental));
    return res.json(result);
  }));

  app.post(
    '/api/ai/gemini/audio-design-video-preupload',
    upload.single('video'),
    asyncRoute(async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: '请选择一个视频文件。' });
      }

      const uploadedPath = path.resolve(req.file.path);
      const uploadsRoot = `${path.resolve(uploadsDir)}${path.sep}`;
      let geminiAliasPath: string | undefined;
      let uploadedVideo: any;
      let cacheStored = false;

      try {
        if (!uploadedPath.startsWith(uploadsRoot)) {
          return res.status(400).json({ error: '视频临时路径无效。' });
        }
        if (!req.file.mimetype.startsWith('video/')) {
          return res.status(415).json({ error: '只支持预上传视频文件。' });
        }

        await cleanupExpiredAudioDesignPreuploads();

        const geminiUpload = await createGeminiUploadAlias(uploadedPath, req.file.mimetype);
        geminiAliasPath = geminiUpload.aliasPath;
        const originalDisplayName = normalizeUploadDisplayName(
          req.body?.originalName,
          req.file.originalname,
        );
        const aiClient = getGoogleAI();
        uploadedVideo = await aiClient.files.upload({
          file: geminiUpload.aliasPath,
          config: {
            mimeType: req.file.mimetype,
            displayName: geminiUpload.aliasName,
          },
        });

        const processingDeadline = Date.now() + 120_000;
        while (uploadedVideo.state === 'PROCESSING') {
          if (Date.now() >= processingDeadline) {
            throw Object.assign(new Error('Gemini 视频预处理超过 2 分钟，请稍后点击分析继续。'), { status: 504 });
          }
          await new Promise(resolve => setTimeout(resolve, 1_500));
          if (!uploadedVideo.name) {
            throw new Error('Gemini 未返回视频文件标识。');
          }
          uploadedVideo = await aiClient.files.get({ name: uploadedVideo.name });
        }

        if (uploadedVideo.state === 'FAILED') {
          throw Object.assign(new Error(uploadedVideo.error?.message || 'Gemini 无法处理此视频编码。'), { status: 422 });
        }
        if (uploadedVideo.state !== 'ACTIVE' || !uploadedVideo.uri || !uploadedVideo.name) {
          throw Object.assign(new Error('Gemini 视频文件未进入可分析状态。'), { status: 502 });
        }

        const uploadId = randomUUID();
        const mimeType = uploadedVideo.mimeType || req.file.mimetype;
        const expiresAt = Date.now() + AUDIO_DESIGN_PREUPLOAD_TTL_MS;
        audioDesignVideoPreuploads.set(uploadId, {
          uploadId,
          fileUri: uploadedVideo.uri,
          mimeType,
          displayName: originalDisplayName,
          geminiFileName: uploadedVideo.name,
          expiresAt,
        });
        cacheStored = true;

        return res.json({
          uploadId,
          displayName: originalDisplayName,
          mimeType,
          expiresAt,
        });
      } finally {
        await safeUnlink(geminiAliasPath);
        if (uploadedPath.startsWith(uploadsRoot)) await safeUnlink(uploadedPath);
        if (uploadedVideo?.name && !cacheStored) {
          await getGoogleAI().files.delete({ name: uploadedVideo.name }).catch((error) => {
            console.warn('Failed to delete failed preuploaded Gemini video:', error);
          });
        }
      }
    }),
  );

  app.post('/api/ai/gemini/audio-design-video-preuploaded', asyncRoute(async (req, res) => {
    const {
      uploadId,
      requirements = '',
      target: rawTarget = {},
      isInstrumental = true,
      analysisMode = 'professional',
    } = req.body || {};
    if (typeof uploadId !== 'string' || !/^[0-9a-f-]{36}$/i.test(uploadId)) {
      return res.status(400).json({ error: '视频预上传标识无效，请重新上传视频。' });
    }

    const cachedVideo = audioDesignVideoPreuploads.get(uploadId);
    if (!cachedVideo) {
      return res.status(404).json({ error: '预上传视频已失效，请重新选择视频后再分析。' });
    }
    if (cachedVideo.expiresAt <= Date.now()) {
      audioDesignVideoPreuploads.delete(uploadId);
      await deleteGeminiPreupload(cachedVideo);
      return res.status(410).json({ error: '预上传视频已过期，请重新选择视频后再分析。' });
    }

    const target = {
      game: Boolean(rawTarget.game),
      video: Boolean(rawTarget.video),
      avatar: Boolean(rawTarget.avatar),
      sunnyIsland: Boolean(rawTarget.sunnyIsland),
    };
    const isFallbackAnalysis = String(analysisMode) === 'fallback';
    const canUseNativeVideo = target.game || target.video || target.avatar || target.sunnyIsland || isFallbackAnalysis;
    if (!canUseNativeVideo) {
      return res.status(400).json({ error: '当前模式不支持完整视频预上传分析。' });
    }

    const result = await analyzeAudioDesign([{
      fileUri: cachedVideo.fileUri,
      mimeType: cachedVideo.mimeType,
      label: `完整视频：${cachedVideo.displayName}`,
      videoMetadata: {
        fps: target.avatar ? 2 : 1,
      },
    }], String(requirements), target, Boolean(isInstrumental));
    return res.json(result);
  }));

  app.post(
    '/api/ai/gemini/audio-design-video',
    upload.single('video'),
    asyncRoute(async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: '请选择一个视频文件。' });
      }

      const uploadedPath = path.resolve(req.file.path);
      const uploadsRoot = `${path.resolve(uploadsDir)}${path.sep}`;
      let geminiAliasPath: string | undefined;
      try {
        if (!uploadedPath.startsWith(uploadsRoot)) {
          return res.status(400).json({ error: '视频临时路径无效。' });
        }
        if (!req.file.mimetype.startsWith('video/')) {
          return res.status(415).json({ error: '专业模式只支持视频文件。' });
        }

        let rawTarget: any;
        try {
          rawTarget = JSON.parse(String(req.body?.target || '{}'));
        } catch {
          return res.status(400).json({ error: '视频分析模式参数无效。' });
        }
        const target = {
          game: Boolean(rawTarget.game),
          video: Boolean(rawTarget.video),
          avatar: Boolean(rawTarget.avatar),
          sunnyIsland: Boolean(rawTarget.sunnyIsland),
        };
        const analysisMode = String(req.body?.analysisMode || 'professional');
        const isFallbackAnalysis = analysisMode === 'fallback';
        if (!isFallbackAnalysis && !target.video && !target.avatar) {
          return res.status(400).json({ error: '只有影视/广告或 Avatar 模式可使用专业视频分析。' });
        }

        const geminiUpload = await createGeminiUploadAlias(uploadedPath, req.file.mimetype);
        geminiAliasPath = geminiUpload.aliasPath;
        const originalDisplayName = normalizeUploadDisplayName(
          req.body?.originalName,
          req.file.originalname,
        );
        const result = await analyzeAudioDesignVideoFile(
          geminiUpload.aliasPath,
          req.file.mimetype,
          originalDisplayName,
          String(req.body?.requirements || ''),
          target,
          String(req.body?.isInstrumental) !== 'false',
        );
        return res.json(result);
      } finally {
        await safeUnlink(geminiAliasPath);
        if (uploadedPath.startsWith(uploadsRoot)) await safeUnlink(uploadedPath);
      }
    }),
  );

  app.post('/api/ai/gemini/regenerate-lyrics', asyncRoute(async (req, res) => {
    const { originalLyrics = '', selectedPart = '', direction = '' } = req.body || {};
    const text = await regenerateLyrics(String(originalLyrics), String(selectedPart), String(direction));
    return res.json({ text });
  }));

  app.post('/api/ai/gemini/generate-lyrics', asyncRoute(async (req, res) => {
    const style = String(req.body?.style || '').trim();
    if (!style) {
      return res.status(400).json({ error: '请先输入歌曲风格描述。' });
    }
    if (style.length > 5000) {
      return res.status(400).json({ error: '歌曲风格描述过长，请精简后重试。' });
    }
    const text = await generateLyricsFromMusicStyle(style);
    return res.json({ text });
  }));

  app.post('/api/ai/gemini/sfx-requirements', asyncRoute(async (req, res) => {
    const { inputText = '', screenshot = null, templateType } = req.body || {};
    const allowedTemplates = ['game_sfx_general', 'game_sfx_middleware', 'voiceover_general', 'voiceover_multilang'];
    if (!allowedTemplates.includes(templateType)) {
      return res.status(400).json({ error: 'Invalid templateType' });
    }
    const result = await generateSfxRequirements(String(inputText), screenshot, templateType);
    return res.json(result);
  }));

  app.post('/api/ai/gemini/optimize-metadata', asyncRoute(async (req, res) => {
    const items = req.body?.items;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array' });
    }
    const optimizedItems = await optimizeImportMetadata(items);
    return res.json({ items: optimizedItems });
  }));

  app.post('/api/ai/gemini/translate', asyncRoute(async (req, res) => {
    const text = await translateToEnglish(String(req.body?.text || ''));
    return res.json({ text });
  }));

  app.post('/api/ai/gemini/match-voice', asyncRoute(async (req, res) => {
    const { description = '', gender, voices } = req.body || {};
    if ((gender !== 'male' && gender !== 'female') || !Array.isArray(voices)) {
      return res.status(400).json({ error: 'Invalid voice matching request' });
    }
    const voiceId = await matchBestVoice(String(description), gender, voices);
    return res.json({ voiceId });
  }));

  app.post('/api/video/match-similar-voices', asyncRoute(async (req, res) => {
    const { audioUrl, voices } = req.body || {};
    if (!Array.isArray(voices) || voices.length === 0) {
      return res.status(400).json({ error: '声音库为空，请先刷新 ElevenLabs 声音库。' });
    }

    const normalizedVoices = voices
      .map(normalizeVoiceForMatching)
      .filter((voice): voice is NonNullable<ReturnType<typeof normalizeVoiceForMatching>> => Boolean(voice))
      .slice(0, 120);
    if (normalizedVoices.length === 0) {
      return res.status(400).json({ error: '没有可用于匹配的 ElevenLabs 声音。' });
    }

    const { filePath, mimeType } = resolveUploadedAudioUrlPath(audioUrl);
    const audioBase64 = await fs.promises.readFile(filePath, { encoding: 'base64' });
    const ai = getGoogleAI();
    const prompt = `
你是专业配音导演。请先聆听用户提供的人声音频，判断它的性别倾向、年龄感、音色、能量、语速、情绪、口音/语言特征和适合的配音用途。
然后在给定 ElevenLabs 声音库中选择最相似、最适合替代该人声的 3-6 个声音。

重要约束：
- 只从候选声音库中选择，不要编造 voiceId。
- 如果音频中有人声不清晰，也要基于可听到的部分给出保守推荐。
- score 为 0-100，表示相似程度和可替代程度。
- reason 用中文，简短说明为什么推荐。

候选声音库 JSON：
${JSON.stringify(normalizedVoices)}

请只返回 JSON：
{
  "sourceDescription": "中文描述",
  "gender": "male" | "female" | "unknown",
  "recommendations": [
    { "voiceId": "候选声音ID", "score": 88, "reason": "中文原因" }
  ]
}`;

    try {
      const response = await generateGeminiContent(ai, {
        model: 'gemini-3.5-flash',
        contents: [{
          parts: [
            { inlineData: { data: audioBase64, mimeType } },
            { text: prompt },
          ],
        }],
        config: {
          responseMimeType: 'application/json',
          maxOutputTokens: 4096,
          responseSchema: {
            type: Type.OBJECT,
            required: ['sourceDescription', 'gender', 'recommendations'],
            properties: {
              sourceDescription: { type: Type.STRING },
              gender: { type: Type.STRING },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  required: ['voiceId', 'score', 'reason'],
                  properties: {
                    voiceId: { type: Type.STRING },
                    score: { type: Type.NUMBER },
                    reason: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const parsed = JSON.parse(String(response.text || '{}'));
      const validVoiceIds = new Set(normalizedVoices.map(voice => voice.id));
      const seenVoiceIds = new Set<string>();
      let recommendations = Array.isArray(parsed.recommendations)
        ? parsed.recommendations
          .map((item: any) => ({
            voiceId: String(item?.voiceId || '').trim(),
            score: parseNumber(item?.score, 70, 0, 100),
            reason: String(item?.reason || '音色、语气和用途接近。').slice(0, 160),
          }))
          .filter((item: any) => {
            if (!validVoiceIds.has(item.voiceId) || seenVoiceIds.has(item.voiceId)) return false;
            seenVoiceIds.add(item.voiceId);
            return true;
          })
          .sort((left: any, right: any) => right.score - left.score)
          .slice(0, 6)
        : [];

      if (recommendations.length === 0) {
        recommendations = localVoiceMatchFallback(normalizedVoices, parsed.gender);
      }

      return res.json({
        sourceDescription: String(parsed.sourceDescription || '已根据拆分人声音频提取音色特征。').slice(0, 300),
        gender: parsed.gender === 'male' || parsed.gender === 'female' ? parsed.gender : 'unknown',
        recommendations,
      });
    } catch (error) {
      console.warn('Gemini similar voice matching failed; using local metadata fallback:', error);
      return res.json({
        sourceDescription: 'AI听辨暂时不可用，已根据声音库标签给出保守推荐。',
        gender: 'unknown',
        recommendations: localVoiceMatchFallback(normalizedVoices),
      });
    }
  }));

  app.post('/api/ai/elevenlabs/sound-effect', asyncRoute(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    const duration = parseNumber(req.body?.duration, 10, 0.5, 60);
    return sendAudioBlob(res, await generateSoundEffect(text, duration));
  }));

  app.post('/api/ai/elevenlabs/music', asyncRoute(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    const duration = parseNumber(req.body?.duration, 30, 1, 60);
    return sendAudioBlob(res, await generateMusic(
      text,
      duration,
      req.body?.isInstrumental !== false,
      typeof req.body?.lyrics === 'string' ? req.body.lyrics : undefined,
    ));
  }));

  app.post('/api/ai/elevenlabs/voice', asyncRoute(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    const voiceId = validateVoiceId(req.body?.voiceId);
    return sendAudioBlob(res, await generateVoice(
      text,
      voiceId,
      parseNumber(req.body?.stability, 0.5, 0, 1),
      parseNumber(req.body?.similarity, 0.75, 0, 1),
      parseNumber(req.body?.style, 0.05, 0, 1),
    ));
  }));

  app.get('/api/ai/elevenlabs/voices', asyncRoute(async (req, res) => {
    return res.json({ voices: await fetchAvailableVoices() });
  }));

  app.post('/api/ai/elevenlabs/speech-to-speech', aiUpload.single('audio'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'audio is required' });
    const audio = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype });
    return sendAudioBlob(res, await generateSpeechToSpeech(
      audio,
      validateVoiceId(req.body?.voiceId),
      parseNumber(req.body?.stability, 0.5, 0, 1),
      parseNumber(req.body?.similarity, 0.75, 0, 1),
      parseNumber(req.body?.style, 0.05, 0, 1),
    ));
  }));

  app.post('/api/ai/elevenlabs/audio-isolation', aiUpload.single('audio'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'audio is required' });
    const audio = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype });
    return sendAudioBlob(res, await isolateAudio(audio));
  }));

  app.post('/api/ai/elevenlabs/speech-to-text', aiUpload.single('audio'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'audio is required' });
    const audio = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype });
    const result = await transcribeSpeech(
      audio,
      typeof req.body?.languageCode === 'string' ? req.body.languageCode : undefined,
      req.body?.tagAudioEvents !== 'false',
    );
    return res.json(result);
  }));

  // 5. File Upload Endpoint (Supports both raw binary stream and multipart/form-data)
  app.post('/api/sfx/upload', (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      upload.single('file')(req, res, (err) => {
        if (err) {
          console.error('Multer upload error:', err);
          return next(err);
        }
        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded via multipart' });
        }
        console.log(`Successfully uploaded file via multipart: ${req.file.filename} (${req.file.size} bytes)`);
        return res.json({
          url: `/uploads/${req.file.filename}`,
          fileName: req.file.filename
        });
      });
    } else {
      express.raw({ type: '*/*', limit: '100mb' })(req, res, async (parseError?: any) => {
        if (parseError) return next(parseError);
        try {
          let originalFilename = req.headers['x-filename'] as string || '';
          try {
            originalFilename = decodeURIComponent(originalFilename);
          } catch (e) {}
          if (!originalFilename) {
            originalFilename = `upload_${Date.now()}.wav`;
          }
          
          const ext = getSafeUploadExtension(originalFilename, contentType, '.wav');
          const cleanFilename = `audio_${randomUUID()}${ext}`;
          
          const filePath = path.join(uploadsDir, cleanFilename);
          
          let fileBuffer: Buffer;
          if (Buffer.isBuffer(req.body)) {
            fileBuffer = req.body;
          } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length === 0) {
            fileBuffer = await new Promise<Buffer>((resolve, reject) => {
              const chunks: Buffer[] = [];
              req.on('data', (chunk) => chunks.push(chunk));
              req.on('end', () => resolve(Buffer.concat(chunks)));
              req.on('error', (err) => reject(err));
            });
          } else if (typeof req.body === 'string') {
            fileBuffer = Buffer.from(req.body);
          } else {
            fileBuffer = Buffer.alloc(0);
          }

          fs.writeFileSync(filePath, fileBuffer);
          console.log(`Successfully uploaded file via raw: ${cleanFilename} (${fileBuffer.length} bytes)`);
          return res.json({ 
            url: `/uploads/${cleanFilename}`,
            fileName: cleanFilename
          });
        } catch (err: any) {
          console.error('Error processing raw upload:', err);
          return res.status(500).json({ error: err.message });
        }
      });
    }
  });

  // 5.1. Chunked File Upload Endpoint (Bypasses proxy size limitations for large files)
  app.post('/api/sfx/upload-chunk', (req, res, next) => {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        console.error('Multer chunk upload error:', err);
        return next(err);
      }

      const incomingFilePath = req.file?.path;
      let tempChunkDir: string | undefined;
      let finalFilePath: string | undefined;
      let assemblyStarted = false;

      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No chunk file uploaded' });
        }

        const { chunkIndex, totalChunks, fileName, uploadId } = req.body || {};
        const index = Number(chunkIndex);
        const total = Number(totalChunks);
        const safeName = parseSafeVideoFilename(fileName);
        if (
          typeof uploadId !== 'string'
          || !/^[A-Za-z0-9_-]{1,80}$/.test(uploadId)
          || !Number.isInteger(index)
          || !Number.isInteger(total)
          || total < 1
          || total > MAX_CHUNK_COUNT
          || index < 0
          || index >= total
          || req.file.size <= 0
          || !safeName
        ) {
          await safeUnlink(incomingFilePath);
          return res.status(400).json({
            error: '分片参数无效；仅支持安全的视频文件名和 1-100 个分片。',
          });
        }

        tempChunkDir = path.resolve(uploadsDir, `temp_${uploadId}`);
        if (!isPathInside(uploadsDir, tempChunkDir)) {
          await safeUnlink(incomingFilePath);
          return res.status(400).json({ error: '分片上传路径无效。' });
        }
        await fs.promises.mkdir(tempChunkDir, { recursive: true });

        const metadataPath = path.join(tempChunkDir, '.metadata.json');
        const expectedMetadata = { fileName, total };
        try {
          const existingMetadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
          if (existingMetadata.fileName !== fileName || existingMetadata.total !== total) {
            await safeUnlink(incomingFilePath);
            return res.status(409).json({ error: '同一上传任务的文件名或分片总数不一致。' });
          }
        } catch (metadataError: any) {
          if (metadataError?.code !== 'ENOENT') throw metadataError;
          await fs.promises.writeFile(metadataPath, JSON.stringify(expectedMetadata), { flag: 'wx' });
        }

        const assemblyLockPath = path.join(tempChunkDir, '.assembling');
        if (fs.existsSync(assemblyLockPath)) {
          await safeUnlink(incomingFilePath);
          return res.status(409).json({ error: '视频分片正在合并，请勿重复提交。' });
        }

        const chunkPath = path.resolve(tempChunkDir, `chunk_${index}`);
        if (!isPathInside(tempChunkDir, chunkPath)) {
          await safeUnlink(incomingFilePath);
          return res.status(400).json({ error: '分片文件路径无效。' });
        }
        await safeUnlink(chunkPath);
        await fs.promises.rename(req.file.path, chunkPath);

        let aggregateBytes = 0;
        let allChunksUploaded = true;
        for (let chunkIndexToCheck = 0; chunkIndexToCheck < total; chunkIndexToCheck += 1) {
          const candidatePath = path.resolve(tempChunkDir, `chunk_${chunkIndexToCheck}`);
          if (!isPathInside(tempChunkDir, candidatePath)) {
            throw new Error('分片路径校验失败。');
          }
          try {
            const chunkStat = await fs.promises.stat(candidatePath);
            if (!chunkStat.isFile()) throw new Error('分片内容无效。');
            aggregateBytes += chunkStat.size;
          } catch (chunkError: any) {
            if (chunkError?.code === 'ENOENT') {
              allChunksUploaded = false;
              continue;
            }
            throw chunkError;
          }
        }

        if (aggregateBytes > MAX_UPLOAD_BYTES) {
          await safeRemoveDirectory(tempChunkDir);
          return res.status(413).json({ error: '视频分片总大小超过 100MB 限制。' });
        }

        if (!allChunksUploaded) {
          return res.json({ completed: false, chunkReceived: index });
        }

        assemblyStarted = true;
        const lockHandle = await fs.promises.open(assemblyLockPath, 'wx');
        await lockHandle.close();

        const cleanFilename = `video_${randomUUID()}${safeName.extension}`;
        finalFilePath = path.resolve(uploadsDir, cleanFilename);
        if (!isPathInside(uploadsDir, finalFilePath)) {
          throw new Error('合并后的视频路径无效。');
        }

        const outputHandle = await fs.promises.open(finalFilePath, 'wx');
        try {
          const copyBuffer = Buffer.allocUnsafe(1024 * 1024);
          for (let chunkIndexToMerge = 0; chunkIndexToMerge < total; chunkIndexToMerge += 1) {
            const chunkFilePath = path.resolve(tempChunkDir, `chunk_${chunkIndexToMerge}`);
            const inputHandle = await fs.promises.open(chunkFilePath, 'r');
            try {
              while (true) {
                const { bytesRead } = await inputHandle.read(copyBuffer, 0, copyBuffer.length, null);
                if (bytesRead === 0) break;

                let written = 0;
                while (written < bytesRead) {
                  const { bytesWritten } = await outputHandle.write(
                    copyBuffer,
                    written,
                    bytesRead - written,
                    null,
                  );
                  if (bytesWritten === 0) throw new Error('写入合并视频失败。');
                  written += bytesWritten;
                }
              }
            } finally {
              await inputHandle.close();
            }
          }
          await outputHandle.sync();
        } finally {
          await outputHandle.close();
        }

        const finalStat = await fs.promises.stat(finalFilePath);
        if (!finalStat.isFile() || finalStat.size !== aggregateBytes) {
          throw new Error('视频分片合并校验失败。');
        }

        await safeRemoveDirectory(tempChunkDir);
        console.log(`Successfully assembled chunked upload: ${cleanFilename}`);
        return res.json({
          url: `/uploads/${cleanFilename}`,
          fileName: cleanFilename,
          completed: true,
        });
      } catch (uploadError: any) {
        console.error('Error during chunk upload:', uploadError);
        await safeUnlink(incomingFilePath);
        await safeUnlink(finalFilePath);
        if (assemblyStarted) await safeRemoveDirectory(tempChunkDir);
        return res.status(uploadError?.status || 500).json({
          error: uploadError?.message || '视频分片上传失败。',
        });
      }
    });
  });

  // 6. Download File as Attachment (to bypass iframe download sandbox constraints)
  app.get('/api/sfx/download-file', (req, res) => {
    try {
      const filePathParam = req.query.path as string;
      const downloadName = req.query.name as string || 'download.mp3';
      if (!filePathParam) {
        return res.status(400).json({ error: 'Path parameter is required' });
      }
      
      // Prevent path traversal & resolve safely
      const cleanPath = filePathParam.replace(/^\/+/, '').replace(/^(\.\.(\/|\\))+/, '');
      const absolutePath = path.join(process.cwd(), cleanPath);
      
      if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({ error: 'File not found' });
      }
      
      // Handle file extension and mime-type dynamically
      const ext = path.extname(absolutePath).toLowerCase();
      let contentType = 'application/octet-stream';
      if (ext === '.mp4') {
        contentType = 'video/mp4';
      } else if (ext === '.mp3') {
        contentType = 'audio/mpeg';
      } else if (ext === '.wav') {
        contentType = 'audio/wav';
      } else if (ext === '.json') {
        contentType = 'application/json';
      }

      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
      res.setHeader('Content-Type', contentType);
      return fs.createReadStream(absolutePath).pipe(res);
    } catch (err: any) {
      console.error('Error downloading file:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 7. Video AI Multi-modal Analysis
  app.post('/api/video/analyze', async (req, res) => {
    let ai: ReturnType<typeof getGoogleAI> | undefined;
    let temporaryGeminiFileName: string | undefined;
    try {
      const {
        fileName,
        keyframes,
        videoDuration,
        bgmEnabled,
        sfxEnabled,
        dubbingEnabled,
      } = req.body;
      
      const aiClient = getGoogleAI();
      ai = aiClient;
      
      const prompt = `你是一个顶级的多模态AI视频音效与配乐设计师。
请分析提供的信息（包含视频文件或关键帧画面序列、时间点），并针对此视频生成一份极其精确的“音效、配乐和配音时间轴清单 (JSON格式)”。
请提供以下轨道的元素（你可以根据视频画面的时间长度和事件，智能规划最合适的开始时间 startTime 和时长 duration，单位为秒）：
${bgmEnabled ? '1. 背景音乐轨 (bgm): 通常是一段大气合适的 background music，覆盖视频主要时间。' : ''}
${sfxEnabled ? '2. 音效轨 (sfx): 根据视频中的关键动势、场景变化或特效出现，生成对应的短音效。' : ''}
${dubbingEnabled ? '3. 配音轨 (dubbing): 逐帧识别视频中的字幕变化、说话人和嘴部活动，为每一条字幕生成一个且仅一个独立配音片段。' : ''}

${dubbingEnabled ? `配音声音由用户在配音轨属性中统一设置；这里只规划台词与时间，不要为单个片段推荐或返回 voiceId。
配音时间轴必须遵守以下规则：
- 字幕文字发生变化时，上一句立即结束，下一句必须新建独立 dubbing clip；绝对不要把两条不同字幕合并成一句。
- 同一条字幕在连续画面中保持不变时只生成一个 clip，不要因逐帧重复看到而重复创建。
- 每条字幕使用稳定且唯一的 subtitleId，例如 "subtitle-001"、"subtitle-002"。
- text 必须逐字对应画面中的当前字幕；speaker 表示当前说话人或画面角色，无法确定时写 "unknown"。
- subtitleStartTime/subtitleEndTime 是该字幕实际出现和消失的时间，是绝对不可越过的硬边界。
- 配音片段必须严格按画面字幕块切分：屏幕字幕文字一旦变化，上一句立即结束并新建下一句；同一句字幕只要画面文字未变化，就保持为一个片段。
- startTime 必须等于 subtitleStartTime，duration 必须等于 subtitleEndTime - subtitleStartTime；口型时间只作为 lipStartTime/lipEndTime 元数据，不得用来缩短配音片段。
- lipStartTime/lipEndTime 是该字幕区间内说话人口型开始和结束活动的时间，必须限制在字幕边界内。
- 当 lipSyncConfidence 较高且口型与字幕的交集有效时，dubbing 的 startTime=max(subtitleStartTime, lipStartTime)，结束时间=min(subtitleEndTime, lipEndTime)，duration 等于二者之差。
- 当置信度低、没有可见人脸、属于画外音或口型交集无效时，startTime=subtitleStartTime，duration=subtitleEndTime-subtitleStartTime。
- lipSyncConfidence 为 0 到 1；timingSource 只能说明依据，例如 "subtitle+lip"、"subtitle"、"speech+subtitle" 或 "visual-estimate"。
- 保留视频中每一条可辨识字幕，不限制为少数重点片段。字幕持续多久，整句话后续就会按该区间统一调整语速。` : ''}

返回的 JSON 必须包含一个 \`clips\` 数组，每项符合以下定义：
{
  id: string (唯一标识，如 "clip-1", "clip-2" 等),
  trackId: "bgm" | "sfx" | "dubbing",
  name: string (简短直观的中文显示名称，如 "科技感启动音效", "深邃太空背景音"),
  prompt: string (详细的英文提示词，用于 ElevenLabs 音效或音乐生成，要求是专业地道的英文描述，如 "deep cinematic low boom synth impact", "lofi chill hip hop background track"),
  text?: string (仅在 trackId 为 "dubbing" 时需要，配音台词的中文文本内容),
  subtitleId?: string (仅 dubbing，当前字幕的稳定唯一标识),
  speaker?: string (仅 dubbing，当前说话人或角色，无法确认时为 "unknown"),
  subtitleStartTime?: number (仅 dubbing，当前字幕出现时间，单位秒),
  subtitleEndTime?: number (仅 dubbing，当前字幕消失或下一条字幕出现时间，单位秒),
  lipStartTime?: number (仅 dubbing，当前字幕区间内口型开始活动时间，单位秒),
  lipEndTime?: number (仅 dubbing，当前字幕区间内口型停止活动时间，单位秒),
  lipSyncConfidence?: number (仅 dubbing，口型与字幕时间判断置信度，0 到 1),
  timingSource?: string (仅 dubbing，时间依据，如 "subtitle+lip"),
  startTime: number (在时间轴上的起始时间，单位为秒，必须大于等于 0 且小于视频时长),
  duration: number (该音频块的时长，单位秒，BGM通常在10-30s，SFX通常在2-4s；Dubbing必须位于字幕硬边界内，高可信口型时使用口型交集，否则使用整段字幕)
}

请确保 clips 数组中只包含启用的轨道类型：
- bgmEnabled: ${bgmEnabled ? '开启' : '关闭'}
- sfxEnabled: ${sfxEnabled ? '开启' : '关闭'}
- dubbingEnabled: ${dubbingEnabled ? '开启' : '关闭'}

视频总时长约为 ${parseNumber(videoDuration, 30, 1, 3_600).toFixed(1)} 秒。所有片段必须严格位于该时长内。
为保证生成速度，请保持非配音结果精炼：BGM 最多 1 段、SFX 最多 8 段。配音不得抽样或截断，必须覆盖所有可辨识字幕变化。

请只返回符合 JSON 语法的纯数据，不要用 markdown 格式包裹，也不要带 \`\`\`json 开头。`;

      const contents: any[] = [prompt];

      let analysisKeyframes: Array<{ timestamp: number; base64: string }> = [];
      let analysisSource: 'client-keyframes' | 'server-ffmpeg' | 'server-native-video' = 'client-keyframes';
      let nativeVideoFps: number | undefined;
      let dubbingAnalysisUnavailable = false;

      const prepareNativeVideoAnalysis = async (fps: number, reason: string) => {
        if (!fileName) {
          throw Object.assign(
            new Error('精确配音分析需要服务器上的完整视频，请等待上传完成后重试。'),
            { status: 422 },
          );
        }

        // Validate the local path before any third-party upload. Invalid,
        // missing, or oversized files therefore never reach Gemini Files API.
        const validatedVideo = await resolveValidatedUploadedVideo(fileName);
        console.log(`${reason} Uploading ${validatedVideo.displayName} for native video analysis at ${fps} FPS.`);

        const geminiUpload = await createGeminiUploadAlias(
          validatedVideo.videoPath,
          validatedVideo.mimeType,
        );
        let uploadedVideo: any;
        try {
          uploadedVideo = await aiClient.files.upload({
            file: geminiUpload.aliasPath,
            config: {
              mimeType: validatedVideo.mimeType,
              displayName: geminiUpload.aliasName,
            },
          });
        } finally {
          await safeUnlink(geminiUpload.aliasPath);
        }
        temporaryGeminiFileName = uploadedVideo.name;

        const processingDeadline = Date.now() + 120_000;
        while (uploadedVideo.state === 'PROCESSING') {
          if (Date.now() >= processingDeadline) {
            throw Object.assign(new Error('Gemini 视频预处理超过 2 分钟，请稍后重试。'), { status: 504 });
          }
          await new Promise(resolve => setTimeout(resolve, 1_500));
          if (!uploadedVideo.name) {
            throw new Error('Gemini 未返回视频文件标识。');
          }
          uploadedVideo = await aiClient.files.get({ name: uploadedVideo.name });
          temporaryGeminiFileName = uploadedVideo.name || temporaryGeminiFileName;
        }

        if (uploadedVideo.state === 'FAILED') {
          throw Object.assign(
            new Error(uploadedVideo.error?.message || 'Gemini 无法处理此视频编码。'),
            { status: 422 },
          );
        }
        if (uploadedVideo.state !== 'ACTIVE' || !uploadedVideo.uri) {
          throw Object.assign(new Error('Gemini 视频文件未进入可分析状态。'), { status: 502 });
        }

        contents.length = 0;
        contents.push({
          fileData: {
            fileUri: uploadedVideo.uri,
            mimeType: uploadedVideo.mimeType || validatedVideo.mimeType,
          },
          videoMetadata: { fps },
        });
        contents.push({ text: prompt });
        nativeVideoFps = fps;
        analysisSource = 'server-native-video';
      };

      if (dubbingEnabled) {
        // Sparse keyframes cannot reveal subtitle boundaries or mouth motion.
        // Dubbing analysis therefore always uses the complete uploaded video.
        try {
          await prepareNativeVideoAnalysis(4, 'Dubbing is enabled;');
        } catch (nativeVideoError) {
          if (!bgmEnabled && !sfxEnabled) {
            throw nativeVideoError;
          }
          dubbingAnalysisUnavailable = true;
          console.warn('Native dubbing analysis failed; falling back to keyframe-only BGM/SFX analysis:', nativeVideoError);
          analysisKeyframes = await extractServerVideoKeyframes(fileName, videoDuration);
          analysisSource = 'server-ffmpeg';
        }
      } else if (Array.isArray(keyframes) && keyframes.length > 0) {
        if (keyframes.length > 8) {
          return res.status(400).json({ error: '关键帧数量过多，请重新分析。' });
        }

        let totalBase64Length = 0;
        for (const frame of keyframes) {
          if (!frame || typeof frame.base64 !== 'string' || frame.base64.length > 1_500_000) {
            return res.status(400).json({ error: '关键帧数据无效或尺寸过大。' });
          }
          totalBase64Length += frame.base64.length;
          analysisKeyframes.push({
            timestamp: parseNumber(frame.timestamp, 0, 0, 3_600),
            base64: frame.base64,
          });
        }
        if (totalBase64Length > 8_000_000) {
          return res.status(413).json({ error: '关键帧总量过大，请降低视频分辨率后重试。' });
        }
      } else {
        if (!fileName) {
          return res.status(422).json({ error: '未收到视频关键帧，请重新选择视频后再分析。' });
        }
        console.log(`Client keyframe extraction unavailable; using safe FFmpeg fallback for ${fileName}.`);
        try {
          analysisKeyframes = await extractServerVideoKeyframes(fileName, videoDuration);
          analysisSource = 'server-ffmpeg';
        } catch (ffmpegError: any) {
          const ffmpegStatus = Number(ffmpegError?.status);
          if (![422, 503, 504].includes(ffmpegStatus)) throw ffmpegError;
          await prepareNativeVideoAnalysis(
            1,
            `FFmpeg fallback unavailable (${ffmpegStatus});`,
          );
        }
      }

      if (nativeVideoFps !== undefined) {
        console.log(`Analyzing complete uploaded video with native visual and audio understanding (${nativeVideoFps} FPS).`);
      } else {
        console.log(`Analyzing video using ${analysisKeyframes.length} compact keyframes (${analysisSource}).`);
        contents.push({ text: "\n下面是视频不同时间点的关键帧，请结合对应时间规划音轨：\n" });
        for (const frame of analysisKeyframes) {
          contents.push({ text: `\n[视频时间轴位置: ${frame.timestamp} 秒]` });
          contents.push({
            inlineData: {
              data: frame.base64,
              mimeType: 'image/jpeg',
            },
          });
        }
      }

      console.log(`Sending content generation request to Gemini (models/gemini-3.5-flash)...`);
      const response = await generateGeminiContent(ai, {
        model: "gemini-3.5-flash",
        contents,
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: dubbingEnabled ? 32_768 : 8_192,
          responseSchema: {
            type: Type.OBJECT,
            required: ["clips"],
            properties: {
              clips: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  required: ["id", "trackId", "name", "prompt", "startTime", "duration"],
                  properties: {
                    id: { type: Type.STRING },
                    trackId: { type: Type.STRING },
                    name: { type: Type.STRING },
                    prompt: { type: Type.STRING },
                    text: { type: Type.STRING },
                    subtitleId: { type: Type.STRING },
                    speaker: { type: Type.STRING },
                    subtitleStartTime: { type: Type.NUMBER },
                    subtitleEndTime: { type: Type.NUMBER },
                    lipStartTime: { type: Type.NUMBER },
                    lipEndTime: { type: Type.NUMBER },
                    lipSyncConfidence: { type: Type.NUMBER },
                    timingSource: { type: Type.STRING },
                    startTime: { type: Type.NUMBER },
                    duration: { type: Type.NUMBER }
                  }
                }
              }
            }
          }
        }
      });

      if (!response.text) {
        throw new Error("AI did not return text");
      }
      
      const parsed = JSON.parse(response.text.trim());
      if (!Array.isArray(parsed.clips)) {
        throw new Error('AI 未返回有效的时间轴片段。');
      }

      const durationLimit = parseNumber(videoDuration, 30, 1, 3_600);
      const enabledTracks = new Set<string>([
        ...(bgmEnabled ? ['bgm'] : []),
        ...(sfxEnabled ? ['sfx'] : []),
        ...(dubbingEnabled ? ['dubbing'] : []),
      ]);
      let normalizedClips = parsed.clips
        .filter((clip: any) => enabledTracks.has(clip?.trackId))
        .map((clip: any, index: number) => {
          const startTime = parseNumber(clip.startTime, 0, 0, Math.max(0, durationLimit - 0.1));
          const maxDuration = Math.max(0.1, durationLimit - startTime);
          if (clip.trackId !== 'dubbing') {
            return {
              ...clip,
              id: String(clip.id || `clip-${index + 1}`),
              startTime,
              duration: parseNumber(clip.duration, clip.trackId === 'bgm' ? maxDuration : 3, 0.1, maxDuration),
            };
          }

          const subtitleStartTime = parseNumber(
            clip.subtitleStartTime ?? clip.subtitleStart,
            startTime,
            0,
            Math.max(0, durationLimit - 0.1),
          );
          const fallbackSubtitleDuration = parseNumber(
            clip.duration,
            3,
            0.1,
            Math.max(0.1, durationLimit - subtitleStartTime),
          );
          const subtitleEndTime = parseNumber(
            clip.subtitleEndTime ?? clip.subtitleEnd,
            Math.min(durationLimit, subtitleStartTime + fallbackSubtitleDuration),
            Math.min(durationLimit, subtitleStartTime + 0.1),
            durationLimit,
          );
          const lipStartTime = parseNumber(
            clip.lipStartTime ?? clip.lipStart,
            subtitleStartTime,
            subtitleStartTime,
            subtitleEndTime,
          );
          const lipEndTime = parseNumber(
            clip.lipEndTime ?? clip.lipEnd,
            subtitleEndTime,
            lipStartTime,
            subtitleEndTime,
          );
          const lipSyncConfidence = parseNumber(clip.lipSyncConfidence, 0, 0, 1);
          const timingSource = String(clip.timingSource || (
            lipSyncConfidence >= 0.6 ? 'subtitle+lip' : 'subtitle'
          )).trim().slice(0, 80);
          // Dubbing clip timing must follow the visible subtitle block. Lip
          // timing remains metadata for risk hints, but it must not shorten the
          // editable sentence or the later split vocal segment.
          const synchronizedStartTime = subtitleStartTime;
          const synchronizedEndTime = subtitleEndTime;
          const normalizedClip: any = {
            ...clip,
            id: String(clip.id || `clip-${index + 1}`),
            text: String(clip.text || '').trim(),
            speaker: String(clip.speaker || 'unknown').trim().slice(0, 80) || 'unknown',
            subtitleStartTime,
            subtitleEndTime,
            lipStartTime,
            lipEndTime,
            lipSyncConfidence,
            timingSource,
            startTime: synchronizedStartTime,
            duration: Number((synchronizedEndTime - synchronizedStartTime).toFixed(3)),
          };
          // Accept short aliases from a model response, but expose one stable API shape.
          delete normalizedClip.subtitleStart;
          delete normalizedClip.subtitleEnd;
          delete normalizedClip.lipStart;
          delete normalizedClip.lipEnd;
          return normalizedClip;
        })
        .filter((clip: any) => clip.trackId !== 'dubbing' || clip.text.length > 0)
        .sort((left: any, right: any) => left.startTime - right.startTime);

      // Models can repeat the same visible caption across adjacent samples.
      // Collapse only overlapping/touching duplicates; a repeated sentence
      // after a real time gap remains a separate subtitle cue.
      const normalizeCueText = (value: unknown) => String(value || '')
        .toLowerCase()
        .replace(/[\s\u3000，。！？、…,.!?;；:："'“”‘’]/g, '');
      const compactDubbingClips: any[] = [];
      const candidateDubbingClips = normalizedClips
        .filter((clip: any) => clip.trackId === 'dubbing')
        .sort((left: any, right: any) => left.subtitleStartTime - right.subtitleStartTime);
      for (const clip of candidateDubbingClips) {
        const previous = compactDubbingClips[compactDubbingClips.length - 1];
        const previousSubtitleId = String(previous?.subtitleId || '').trim();
        const currentSubtitleId = String(clip.subtitleId || '').trim();
        const bothHaveSubtitleIds = Boolean(previousSubtitleId && currentSubtitleId);
        const sameOriginalSubtitleId = bothHaveSubtitleIds
          && previousSubtitleId === currentSubtitleId;
        const previousCueText = normalizeCueText(previous?.text);
        const currentCueText = normalizeCueText(clip.text);
        const sameText = Boolean(
          previousCueText
          && currentCueText
          && previousCueText === currentCueText,
        );
        const previousSpeaker = String(previous?.speaker || 'unknown').trim().toLowerCase();
        const currentSpeaker = String(clip.speaker || 'unknown').trim().toLowerCase();
        const compatibleSpeaker = previousSpeaker === currentSpeaker
          || previousSpeaker === 'unknown'
          || currentSpeaker === 'unknown';
        const overlapsPreviousCue = Boolean(
          previous
          && clip.subtitleStartTime < previous.subtitleEndTime - 0.02,
        );
        const sameIdTouchesPreviousCue = Boolean(
          previous
          && clip.subtitleStartTime <= previous.subtitleEndTime + 0.05,
        );
        const isDuplicateCue = sameOriginalSubtitleId
          ? sameText && sameIdTouchesPreviousCue
          : !bothHaveSubtitleIds && sameText && overlapsPreviousCue;
        if (previous && compatibleSpeaker && isDuplicateCue) {
          if (String(clip.text || '').length > String(previous.text || '').length) {
            previous.text = clip.text;
          }
          previous.subtitleStartTime = Math.min(previous.subtitleStartTime, clip.subtitleStartTime);
          previous.subtitleEndTime = Math.max(previous.subtitleEndTime, clip.subtitleEndTime);
          previous.lipStartTime = Math.min(previous.lipStartTime, clip.lipStartTime);
          previous.lipEndTime = Math.max(previous.lipEndTime, clip.lipEndTime);
          if (clip.lipSyncConfidence > previous.lipSyncConfidence) {
            previous.lipSyncConfidence = clip.lipSyncConfidence;
            previous.timingSource = clip.timingSource;
          }
          continue;
        }
        compactDubbingClips.push(clip);
      }
      normalizedClips = [
        ...normalizedClips.filter((clip: any) => clip.trackId !== 'dubbing'),
        ...compactDubbingClips,
      ].sort((left: any, right: any) => left.startTime - right.startTime);

      const usedSubtitleIds = new Set<string>();
      const dubbingClips = normalizedClips
        .filter((clip: any) => clip.trackId === 'dubbing')
        .sort((left: any, right: any) => left.subtitleStartTime - right.subtitleStartTime);
      dubbingClips.forEach((clip: any, index: number) => {
        const requestedSubtitleId = String(clip.subtitleId || `subtitle-${String(index + 1).padStart(3, '0')}`)
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '-')
          .slice(0, 80) || `subtitle-${String(index + 1).padStart(3, '0')}`;
        let subtitleId = requestedSubtitleId;
        let duplicateIndex = 2;
        while (usedSubtitleIds.has(subtitleId)) {
          subtitleId = `${requestedSubtitleId}-${duplicateIndex}`;
          duplicateIndex += 1;
        }
        usedSubtitleIds.add(subtitleId);
        clip.subtitleId = subtitleId;

        const nextSubtitleStart = dubbingClips[index + 1]?.subtitleStartTime;
        const hardSubtitleEnd = Number.isFinite(nextSubtitleStart)
          ? Math.min(clip.subtitleEndTime, nextSubtitleStart)
          : clip.subtitleEndTime;
        clip.subtitleEndTime = Math.max(clip.subtitleStartTime, hardSubtitleEnd);
        clip.lipStartTime = Math.min(
          clip.subtitleEndTime,
          Math.max(clip.subtitleStartTime, clip.lipStartTime),
        );
        clip.lipEndTime = Math.min(
          clip.subtitleEndTime,
          Math.max(clip.lipStartTime, clip.lipEndTime),
        );

        clip.startTime = clip.subtitleStartTime;
        clip.duration = Number(Math.max(0, clip.subtitleEndTime - clip.subtitleStartTime).toFixed(3));
      });

      // Discard only genuinely invalid/fully overlapped cues; never truncate by count.
      normalizedClips = normalizedClips
        .filter((clip: any) => clip.trackId !== 'dubbing' || clip.duration >= 0.05)
        .sort((left: any, right: any) => left.startTime - right.startTime);
      const dubbingCueCount = normalizedClips.filter(
        (clip: any) => clip.trackId === 'dubbing',
      ).length;
      if (normalizedClips.length === 0 && !dubbingEnabled) {
        throw new Error('AI 未生成可用的音轨片段，请调整轨道选项后重试。');
      }

      console.log(`Video analysis complete. Found ${normalizedClips.length} clips.`);
      return res.json({
        clips: normalizedClips,
        analysisSource,
        dubbingCueCount,
        dubbingStatus: dubbingEnabled
          ? dubbingAnalysisUnavailable ? 'unavailable' : dubbingCueCount > 0 ? 'detected' : 'none-detected'
          : 'disabled',
      });
      
    } catch (err: any) {
      console.error('Error analyzing video:', err);
      return res.status(err.status || 500).json({
        error: err.message || '视频分析暂时失败，请稍后重试。',
      });
    } finally {
      if (ai && temporaryGeminiFileName) {
        await ai.files.delete({ name: temporaryGeminiFileName }).catch((deleteError) => {
          console.warn('Failed to delete temporary Gemini video file:', deleteError);
        });
      }
    }
  });

  // 8. Generate Timeline Clip Audio using ElevenLabs API
  app.post('/api/video/generate-clip', async (req, res) => {
    try {
      const { prompt, trackId, trackType, text, voiceId, duration } = req.body;
      
      const apiKey = process.env.ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: 'ElevenLabs API Key is not configured on the server. Please configure it in Settings.' });
      }
      
      const cleanFilename = `el_${trackId}_${Date.now()}.mp3`;
      const filePath = path.join(uploadsDir, cleanFilename);
      
      const resolvedType = trackType || (trackId === 'dubbing' ? 'dubbing' : trackId === 'bgm' ? 'bgm' : 'sfx');
      
      if (resolvedType === 'dubbing') {
        // Text to Speech
        const targetVoice = validateVoiceId(voiceId || "21m00Tcm4TlvDq8ikWAM"); // Rachel fallback
        console.log(`ElevenLabs server TTS: text="${text}" voiceId=${targetVoice}`);
        const apiResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}`, {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.05,
              use_speaker_boost: true,
            },
          }),
        });
        
        if (!apiResponse.ok) {
          const errJson = await apiResponse.json().catch(() => ({}));
          throw new Error(`ElevenLabs TTS Error: ${errJson.detail?.message || apiResponse.statusText}`);
        }
        
        const buffer = Buffer.from(await apiResponse.arrayBuffer());
        fs.writeFileSync(filePath, buffer);
        
      } else if (resolvedType === 'bgm') {
        // Background music (Sound generation)
        const sfxPrompt = `AI Music, full background instrumental track, no vocals, no speech: ${prompt}`;
        const elevenLabsDuration = Math.min(22, duration || 20);
        console.log(`ElevenLabs server Music Gen: prompt="${sfxPrompt}" elevenLabsDuration=${elevenLabsDuration}, targetDuration=${duration}`);
        
        const apiResponse = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: sfxPrompt,
            duration_seconds: elevenLabsDuration,
            prompt_influence: 0.4,
          }),
        });
        
        if (!apiResponse.ok) {
          const errJson = await apiResponse.json().catch(() => ({}));
          throw new Error(`ElevenLabs Music Gen Error: ${errJson.detail?.message || apiResponse.statusText}`);
        }
        
        const buffer = Buffer.from(await apiResponse.arrayBuffer());
        
        if (duration && duration > 22) {
          // Write ElevenLabs response to a temporary file, then loop it using FFmpeg
          const tempFileName = `temp_el_bgm_${Date.now()}.mp3`;
          const tempPath = path.join(uploadsDir, tempFileName);
          fs.writeFileSync(tempPath, buffer);
          
          console.log(`Looping BGM to ${duration}s using bundled FFmpeg.`);
          
          await new Promise<void>((resolve) => {
            execFile(FFMPEG_BINARY, ['-y', '-stream_loop', '-1', '-i', tempPath, '-t', String(duration), filePath], (err, stdout, stderr) => {
              // Delete temp file
              try { fs.unlinkSync(tempPath); } catch (e) {}
              if (err) {
                console.error('Failed to loop BGM with ffmpeg, falling back to original segment:', err);
                // Fallback: write original buffer directly
                fs.writeFileSync(filePath, buffer);
              } else {
                console.log(`Successfully generated looped BGM at ${filePath}`);
              }
              resolve();
            });
          });
        } else {
          fs.writeFileSync(filePath, buffer);
        }
        
      } else {
        // Sound effect (Sound generation)
        const sfxPrompt = `Pure sound effect, instrumental, no vocals, no speech: ${prompt}`;
        console.log(`ElevenLabs server SFX Gen: prompt="${sfxPrompt}" duration=${duration}`);
        
        const apiResponse = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: sfxPrompt,
            duration_seconds: duration || 4,
            prompt_influence: 0.3,
          }),
        });
        
        if (!apiResponse.ok) {
          const errJson = await apiResponse.json().catch(() => ({}));
          throw new Error(`ElevenLabs SFX Gen Error: ${errJson.detail?.message || apiResponse.statusText}`);
        }
        
        const buffer = Buffer.from(await apiResponse.arrayBuffer());
        fs.writeFileSync(filePath, buffer);
      }
      
      return res.json({
        audioUrl: `/uploads/${cleanFilename}`
      });
      
    } catch (err: any) {
      console.error('Error generating clip:', err);
      return res.status(Number(err?.status) || 500).json({ error: err.message });
    }
  });

  app.post('/api/video/separate-original-audio', asyncRoute(async (req, res) => {
    const {
      videoFileName,
      sourceStartTime,
      sourceDuration,
      vocalSegments,
    } = req.body || {};

    const safeName = parseSafeVideoFilename(videoFileName);
    if (!safeName) {
      return res.status(400).json({ error: '视频文件名无效，请重新上传视频后再拆分。' });
    }

    const { videoPath } = await resolveValidatedUploadedVideo(videoFileName);
    const startTime = parseNumber(sourceStartTime, 0, 0, 3_600);
    const duration = parseNumber(sourceDuration, 30, 0.05, 3_600);
    const endTime = startTime + duration;
    const timestamp = Date.now();
    const token = randomUUID().slice(0, 8);
    const baseName = `${safeName.base}_split_${timestamp}_${token}`;
    const createdFiles: string[] = [];
    const makeOutput = (suffix: string) => {
      const fileName = `${baseName}_${suffix}.wav`;
      const filePath = path.join(uploadsDir, fileName);
      createdFiles.push(filePath);
      return { fileName, filePath, audioUrl: `/uploads/${fileName}` };
    };

    const original = makeOutput('original');
    const vocal = makeOutput('vocal');
    const music = makeOutput('music');
    let separationEngine: 'demucs-local' | 'elevenlabs-audio-isolation' | 'ffmpeg-filter-fallback' = 'ffmpeg-filter-fallback';

    try {
      await runFfmpegFile([
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', startTime.toFixed(3),
        '-t', duration.toFixed(3),
        '-i', videoPath,
        '-vn',
        '-sn',
        '-map', '0:a:0',
        '-ac', '2',
        '-ar', '48000',
        '-c:a', 'pcm_s16le',
        original.filePath,
      ]);

      const demucsResult = await tryRunDemucsSeparation(original.filePath, baseName, {
        vocalPath: vocal.filePath,
        musicPath: music.filePath,
      });

      if (demucsResult.ok) {
        separationEngine = 'demucs-local';
      } else {
        if (demucsResult.errors.length > 0) {
          console.warn('Demucs is unavailable or failed; falling back to cloud/filter separation:', demucsResult.errors.slice(-3));
        }

        const hasElevenLabsKey = Boolean(process.env.ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY);
        if (hasElevenLabsKey) {
          let isolatedTempPath = '';
          try {
            const isolatedBlob = await isolateAudio(new Blob([fs.readFileSync(original.filePath)], { type: 'audio/wav' }));
            const isolatedExt = getSafeUploadExtension('isolated_audio', isolatedBlob.type, '.mp3');
            isolatedTempPath = path.join(uploadsDir, `${baseName}_isolated_raw${isolatedExt}`);
            await fs.promises.writeFile(isolatedTempPath, Buffer.from(await isolatedBlob.arrayBuffer()));
            await runFfmpegFile([
              '-y',
              '-hide_banner',
              '-loglevel', 'error',
              '-i', isolatedTempPath,
              '-ac', '2',
              '-ar', '48000',
              '-c:a', 'pcm_s16le',
              vocal.filePath,
            ]);
            separationEngine = 'elevenlabs-audio-isolation';
          } catch (isolationError) {
            console.warn('ElevenLabs audio isolation failed; falling back to FFmpeg vocal proxy:', isolationError);
            await runFfmpegFile([
              '-y',
              '-hide_banner',
              '-loglevel', 'error',
              '-i', original.filePath,
              '-af', 'highpass=f=120,lowpass=f=7800,afftdn=nf=-25,volume=1.15,aformat=sample_rates=48000:channel_layouts=stereo',
              '-c:a', 'pcm_s16le',
              vocal.filePath,
            ]);
          } finally {
            await safeUnlink(isolatedTempPath);
          }
        } else {
          await runFfmpegFile([
            '-y',
            '-hide_banner',
            '-loglevel', 'error',
            '-i', original.filePath,
            '-af', 'highpass=f=120,lowpass=f=7800,afftdn=nf=-25,volume=1.15,aformat=sample_rates=48000:channel_layouts=stereo',
            '-c:a', 'pcm_s16le',
            vocal.filePath,
          ]);
        }

        await runFfmpegFile([
          '-y',
          '-hide_banner',
          '-loglevel', 'error',
          '-i', original.filePath,
          '-af', 'highpass=f=45,lowpass=f=14000,volume=0.75,aformat=sample_rates=48000:channel_layouts=stereo',
          '-c:a', 'pcm_s16le',
          music.filePath,
        ]);

      }

      const requestedSegments = Array.isArray(vocalSegments) ? vocalSegments.slice(0, 200) : [];
      const normalizedSegments = requestedSegments.length > 0
        ? requestedSegments.map((segment: any, index: number) => {
          const absoluteStart = parseNumber(segment?.startTime, startTime, startTime, endTime);
          const maximumDuration = Math.max(0.05, endTime - absoluteStart);
          return {
            id: typeof segment?.id === 'string' && /^[\w-]+$/.test(segment.id)
              ? segment.id
              : `clip-split-vocal-${index + 1}`,
            offset: Math.max(0, absoluteStart - startTime),
            duration: parseNumber(segment?.duration, Math.min(3, maximumDuration), 0.05, maximumDuration),
          };
        })
        : [{ id: 'clip-split-vocal-1', offset: 0, duration }];

      const segmentResults = [];
      for (let index = 0; index < normalizedSegments.length; index += 1) {
        const segment = normalizedSegments[index];
        const segmentOutput = makeOutput(`vocal_segment_${String(index + 1).padStart(3, '0')}`);
        await runFfmpegFile([
          '-y',
          '-hide_banner',
          '-loglevel', 'error',
          '-ss', segment.offset.toFixed(3),
          '-t', segment.duration.toFixed(3),
          '-i', vocal.filePath,
          '-ac', '2',
          '-ar', '48000',
          '-c:a', 'pcm_s16le',
          segmentOutput.filePath,
        ]);
        segmentResults.push({
          id: segment.id,
          audioUrl: segmentOutput.audioUrl,
          sourceAudioDuration: Number(segment.duration.toFixed(3)),
        });
      }

      return res.json({
        engine: separationEngine,
        sampleRate: 48000,
        bitDepth: 16,
        source: {
          startTime,
          duration,
          audioUrl: original.audioUrl,
        },
        stems: {
          vocalUrl: vocal.audioUrl,
          musicUrl: music.audioUrl,
          originalUrl: original.audioUrl,
        },
        vocalSegments: segmentResults,
      });
    } catch (error) {
      await Promise.all(createdFiles.map(filePath => safeUnlink(filePath)));
      throw error;
    }
  }));

  // 9. Mix Video with Audio Timeline Clips using FFmpeg
  app.post('/api/video/mix', (req, res) => {
    try {
      const {
        videoFileName,
        clips,
        includeOriginalAudio = false,
        originalAudioVolume = 1,
        audioFormat,
        sampleRate,
        bitrate,
        bitDepth,
      } = req.body;
      if (!videoFileName) {
        return res.status(400).json({ error: 'videoFileName is required' });
      }

      const safeVideoFileName = path.basename(String(videoFileName));
      const inputVideoPath = path.join(uploadsDir, safeVideoFileName);
      if (!fs.existsSync(inputVideoPath)) {
        return res.status(404).json({ error: 'Video file not found' });
      }

      const requestedClips = Array.isArray(clips) ? clips : [];
      const validClips = requestedClips.filter((clip: any) => {
        if (!clip.audioUrl || typeof clip.audioUrl !== 'string') return false;
        const clipPath = path.join(uploadsDir, path.basename(clip.audioUrl));
        return fs.existsSync(clipPath);
      });
      if (validClips.length !== requestedClips.length) {
        return res.status(422).json({
          code: 'CLIP_AUDIO_MISSING',
          error: '部分音频片段已失效或尚未上传，请重新合成缺失片段后再导出。',
        });
      }
      const requestedOriginalAudio = includeOriginalAudio === true;
      const normalizedOriginalVolume = normalizeUnitVolume(originalAudioVolume);
      const normalizedAudioFormat = normalizeAudioExportFormat(audioFormat);
      const normalizedSampleRate = normalizeSampleRate(sampleRate);
      const normalizedBitrate = normalizeAudioBitrate(bitrate);
      const normalizedBitDepth = normalizeBitDepth(bitDepth);
      const videoAudioOutput = getVideoAudioOutputArgs(
        normalizedAudioFormat,
        normalizedSampleRate,
        normalizedBitrate,
        normalizedBitDepth,
      );

      // Keeping the untouched source does not require FFmpeg/FFprobe. This also
      // lets local HTML5 previews export the original video before a media
      // processing runtime is installed on the deployment server.
      if (
        validClips.length === 0
        && requestedOriginalAudio
        && Math.abs(normalizedOriginalVolume - 1) < 0.0001
      ) {
        return res.json({
          videoUrl: `/uploads/${safeVideoFileName}`,
          preservedSourceMedia: true,
        });
      }

      // Generate a unique output file name
      const sourceExt = path.extname(safeVideoFileName);
      const base = path.basename(safeVideoFileName, sourceExt);
      const outputFileName = `mixed_${base}_${Date.now()}${videoAudioOutput.extension}`;
      const outputFilePath = path.join(uploadsDir, outputFileName);

      const finishWithFfmpeg = (args: string[]) => {
        console.log('Running FFmpeg with argument count:', args.length);
        execFile(FFMPEG_BINARY, args, (err, stdout, stderr) => {
          if (err) {
            console.error('FFmpeg execution failed:', err, stderr);
            const ffmpegUnavailable = /ffmpeg.*(?:not recognized|not found)|ENOENT/i.test(`${err.message}\n${stderr}`);
            return res.status(ffmpegUnavailable ? 503 : 500).json({
              error: ffmpegUnavailable
                ? '当前服务器尚未安装 FFmpeg，暂时无法生成新的混音视频。'
                : `FFmpeg mixing failed: ${err.message}.`,
            });
          }
          console.log('FFmpeg mixed video successfully created:', outputFileName);
          return res.json({ videoUrl: `/uploads/${outputFileName}` });
        });
      };

      const mixWithDetectedSource = (hasOriginalAudio: boolean) => {
        const useOriginalAudio = requestedOriginalAudio && hasOriginalAudio;

        if (validClips.length === 0) {
          if (useOriginalAudio && Math.abs(normalizedOriginalVolume - 1) < 0.0001) {
            return res.json({
              videoUrl: `/uploads/${safeVideoFileName}`,
              includedOriginalAudio: true,
            });
          }

          const sourceOnlyArgs = useOriginalAudio
            ? [
              '-y',
              '-i', inputVideoPath,
              '-filter:a', `volume=${normalizedOriginalVolume},alimiter=limit=0.95,apad`,
              '-map', '0:v:0',
              '-map', '0:a:0',
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              '-crf', '18',
              '-pix_fmt', 'yuv420p',
              ...videoAudioOutput.args,
              '-movflags', '+faststart',
              '-shortest',
              outputFilePath,
            ]
            : [
              '-y',
              '-i', inputVideoPath,
              '-map', '0:v:0',
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              '-crf', '18',
              '-pix_fmt', 'yuv420p',
              '-movflags', '+faststart',
              '-an',
              outputFilePath,
            ];
          finishWithFfmpeg(sourceOnlyArgs);
          return;
        }

        const inputArgs = ['-i', inputVideoPath];
        validClips.forEach((clip: any) => {
          const clipPath = path.join(uploadsDir, path.basename(clip.audioUrl));
          inputArgs.push('-i', clipPath);
        });

        const filterParts: string[] = [];
        const mixInputs: string[] = [];
        if (useOriginalAudio) {
          filterParts.push(`[0:a:0]aformat=sample_rates=${normalizedSampleRate}:channel_layouts=stereo,volume=${normalizedOriginalVolume}[source]`);
          mixInputs.push('[source]');
        }
        validClips.forEach((clip: any, idx: number) => {
          filterParts.push(buildTimelineAudioFilter(idx + 1, clip, `aud${idx}`, normalizedSampleRate));
          mixInputs.push(`[aud${idx}]`);
        });
        filterParts.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:normalize=0:dropout_transition=0,alimiter=limit=0.95,apad[aout]`);

        const filterComplexString = filterParts.join('; ');
        finishWithFfmpeg([
          '-y',
          ...inputArgs,
          '-filter_complex', filterComplexString,
          '-map', '0:v:0',
          '-map', '[aout]',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '18',
          '-pix_fmt', 'yuv420p',
          ...videoAudioOutput.args,
          '-movflags', '+faststart',
          '-shortest',
          outputFilePath,
        ]);
      };

      if (!requestedOriginalAudio) {
        mixWithDetectedSource(false);
        return;
      }

      execFile(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', inputVideoPath],
        (probeError, stdout, stderr) => {
          if (probeError) {
            console.error('FFprobe failed while checking original audio:', probeError, stderr);
            return res.status(503).json({
              code: 'MEDIA_PROBE_FAILED',
              error: '服务器暂时无法检测视频原声，请确认已安装 FFmpeg/FFprobe 后重试。',
            });
          }
          if (stdout.trim().length === 0) {
            return res.status(422).json({
              code: 'ORIGINAL_AUDIO_NOT_FOUND',
              error: '源视频没有可保留的原声音轨，请关闭视频原声后再导出。',
            });
          }
          mixWithDetectedSource(true);
        },
      );

    } catch (err: any) {
      console.error('Error in video mixing:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 10. Mix only audio tracks (all mixed or filtered by trackId) for professional exporting
  app.post('/api/audio/mix-tracks', (req, res) => {
    try {
      const { clips, trackId } = req.body;
      const normalizedTrackId = typeof trackId === 'string' && trackId.length > 0
        ? trackId
        : undefined;
      if (normalizedTrackId && !['bgm', 'sfx', 'dubbing'].includes(normalizedTrackId)) {
        return res.status(400).json({ error: '不支持的音轨导出类型。' });
      }
      const requestedClips = Array.isArray(clips) ? clips : [];
      const targetClips = requestedClips.filter((clip: any) => (
        !normalizedTrackId || clip.trackId === normalizedTrackId
      ));
      const validClips = targetClips.filter((c: any) => {
        if (!c.audioUrl || typeof c.audioUrl !== 'string') return false;
        const clipFileName = path.basename(c.audioUrl);
        const clipPath = path.join(uploadsDir, clipFileName);
        return fs.existsSync(clipPath);
      });

      if (validClips.length !== targetClips.length) {
        return res.status(422).json({
          code: 'CLIP_AUDIO_MISSING',
          error: '部分音频片段已失效或尚未上传，请重新合成缺失片段后再导出。',
        });
      }
      
      if (validClips.length === 0) {
        return res.status(400).json({ error: '没有已生成的、存在于服务器上的音频片段可供导出。请先合成对应的音轨。' });
      }

      const outputFileName = `exported_audio_${normalizedTrackId || 'mixed'}_${Date.now()}.mp3`;
      const outputFilePath = path.join(uploadsDir, outputFileName);

      const inputArgs: string[] = [];
      validClips.forEach((clip: any) => {
        const clipFileName = path.basename(clip.audioUrl);
        const clipPath = path.join(uploadsDir, clipFileName);
        inputArgs.push('-i', clipPath);
      });

      const filterParts: string[] = [];
      validClips.forEach((clip: any, idx: number) => {
        filterParts.push(buildTimelineAudioFilter(idx, clip, `aud${idx}`));
      });

      const mixInputs = validClips.map((_, idx) => `[aud${idx}]`).join('');
      filterParts.push(`${mixInputs}amix=inputs=${validClips.length}:duration=longest:dropout_transition=0[aout]`);

      const filterComplexString = filterParts.join('; ');
      const ffmpegArgs = [
        '-y',
        ...inputArgs,
        '-filter_complex', filterComplexString,
        '-map', '[aout]',
        '-c:a', 'libmp3lame',
        '-q:a', '2',
        outputFilePath,
      ];
      console.log('Running audio FFmpeg with argument count:', ffmpegArgs.length);

      execFile(FFMPEG_BINARY, ffmpegArgs, (err, stdout, stderr) => {
        if (err) {
          console.error('Audio FFmpeg mixing failed:', err, stderr);
          const ffmpegUnavailable = /ffmpeg.*(?:not recognized|not found)|ENOENT/i.test(`${err.message}\n${stderr}`);
          return res.status(ffmpegUnavailable ? 503 : 500).json({
            error: ffmpegUnavailable
              ? '当前服务器尚未安装 FFmpeg，暂时无法导出混合音频。'
              : `音频合成失败: ${err.message}`,
          });
        }
        console.log('FFmpeg mixed audio successfully created:', outputFileName);
        return res.json({ audioUrl: `/uploads/${outputFileName}` });
      });

    } catch (err: any) {
      console.error('Error in audio mixing endpoint:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  const mixClipsToAudioFileV2 = (
    targetClips: any[],
    outputFilePath: string,
    options: { audioFormat: AudioExportFormat; sampleRate: number; bitrate: string; bitDepth: number },
  ) => new Promise<void>((resolve, reject) => {
    const inputArgs: string[] = [];
    targetClips.forEach((clip: any) => {
      const clipFileName = path.basename(String(clip.audioUrl || ''));
      const clipPath = path.join(uploadsDir, clipFileName);
      inputArgs.push('-i', clipPath);
    });

    const filterParts: string[] = [];
    targetClips.forEach((clip: any, idx: number) => {
      filterParts.push(buildTimelineAudioFilter(idx, clip, `aud${idx}`, options.sampleRate));
    });

    const mixInputs = targetClips.map((_, idx) => `[aud${idx}]`).join('');
    filterParts.push(`${mixInputs}amix=inputs=${targetClips.length}:duration=longest:dropout_transition=0,alimiter=limit=0.95[aout]`);

    const ffmpegArgs = [
      '-y',
      ...inputArgs,
      '-filter_complex', filterParts.join('; '),
      '-map', '[aout]',
      ...getAudioOutputArgs(options.audioFormat, options.sampleRate, options.bitrate, options.bitDepth),
      outputFilePath,
    ];

    execFile(FFMPEG_BINARY, ffmpegArgs, (err, stdout, stderr) => {
      if (err) {
        console.error('Audio FFmpeg v2 mixing failed:', err, stderr);
        reject(err);
        return;
      }
      resolve();
    });
  });

  app.post('/api/audio/mix-tracks-v2', asyncRoute(async (req, res) => {
    const {
      clips,
      trackId,
      audioFormat,
      sampleRate,
      bitrate,
      bitDepth,
    } = req.body;
    const normalizedTrackId = typeof trackId === 'string' && trackId.length > 0
      ? trackId
      : undefined;
    if (normalizedTrackId && !/^[\w-]+$/.test(normalizedTrackId)) {
      return res.status(400).json({ error: '不支持的音轨导出类型。' });
    }

    const normalizedAudioFormat = normalizeAudioExportFormat(audioFormat);
    const normalizedSampleRate = normalizeSampleRate(sampleRate);
    const normalizedBitrate = normalizeAudioBitrate(bitrate);
    const normalizedBitDepth = normalizeBitDepth(bitDepth);
    const requestedClips = Array.isArray(clips) ? clips : [];
    const targetClips = requestedClips.filter((clip: any) => (
      !normalizedTrackId || clip.trackId === normalizedTrackId
    ));
    const validClips = targetClips.filter((clip: any) => {
      const clipFileName = path.basename(String(clip.audioUrl || ''));
      const clipPath = path.join(uploadsDir, clipFileName);
      return clipFileName.length > 0 && fs.existsSync(clipPath);
    });

    if (validClips.length !== targetClips.length) {
      return res.status(422).json({
        code: 'CLIP_AUDIO_MISSING',
        error: '部分音频片段已失效或尚未上传，请重新合成缺失片段后再导出。',
      });
    }
    if (validClips.length === 0) {
      return res.status(400).json({ error: '没有可导出的音频片段。' });
    }

    const outputFileName = `exported_audio_${normalizedTrackId || 'master'}_${Date.now()}.${normalizedAudioFormat}`;
    const outputFilePath = path.join(uploadsDir, outputFileName);
    await mixClipsToAudioFileV2(validClips, outputFilePath, {
      audioFormat: normalizedAudioFormat,
      sampleRate: normalizedSampleRate,
      bitrate: normalizedBitrate,
      bitDepth: normalizedBitDepth,
    });
    return res.json({ audioUrl: `/uploads/${outputFileName}` });
  }));

  app.post('/api/audio/export-stems', asyncRoute(async (req, res) => {
    const {
      tracks,
      clips,
      audioFormat,
      sampleRate,
      bitrate,
      bitDepth,
    } = req.body;

    const normalizedAudioFormat = normalizeAudioExportFormat(audioFormat);
    const normalizedSampleRate = normalizeSampleRate(sampleRate);
    const normalizedBitrate = normalizeAudioBitrate(bitrate);
    const normalizedBitDepth = normalizeBitDepth(bitDepth);
    const requestedTracks = Array.isArray(tracks) ? tracks : [];
    const requestedClips = Array.isArray(clips) ? clips : [];
    const zip = new JSZip();
    const tempStemPaths: string[] = [];
    const timestamp = Date.now();

    for (const track of requestedTracks) {
      const trackId = typeof track?.id === 'string' ? track.id : '';
      if (!/^[\w-]+$/.test(trackId) || track?.isMuted) continue;
      const trackClips = requestedClips.filter((clip: any) => clip.trackId === trackId && clip.audioUrl);
      if (trackClips.length === 0) continue;

      const validTrackClips = trackClips.filter((clip: any) => {
        const clipFileName = path.basename(String(clip.audioUrl || ''));
        const clipPath = path.join(uploadsDir, clipFileName);
        return clipFileName.length > 0 && fs.existsSync(clipPath);
      });
      if (validTrackClips.length !== trackClips.length) {
        return res.status(422).json({
          code: 'CLIP_AUDIO_MISSING',
          error: `音轨“${track.name || trackId}”中有音频片段已失效，请重新生成后再分轨导出。`,
        });
      }

      const safeTrackName = sanitizeExportName(track?.name, trackId);
      const stemFileName = `${safeTrackName}_${trackId}_${timestamp}.${normalizedAudioFormat}`;
      const stemPath = path.join(uploadsDir, stemFileName);
      await mixClipsToAudioFileV2(validTrackClips, stemPath, {
        audioFormat: normalizedAudioFormat,
        sampleRate: normalizedSampleRate,
        bitrate: normalizedBitrate,
        bitDepth: normalizedBitDepth,
      });
      tempStemPaths.push(stemPath);
      zip.file(stemFileName, fs.readFileSync(stemPath));
    }

    if (tempStemPaths.length === 0) {
      return res.status(400).json({ error: '没有可导出的未静音单独音轨。' });
    }

    const zipFileName = `track_stems_${timestamp}.zip`;
    const zipPath = path.join(uploadsDir, zipFileName);
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(zipPath, zipBuffer);
    tempStemPaths.forEach((stemPath) => {
      try { fs.unlinkSync(stemPath); } catch {}
    });
    return res.json({ zipUrl: `/uploads/${zipFileName}`, stemCount: tempStemPaths.length });
  }));

  // --- Global API Error Handler ---
  app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled API Error:', err);
    if (res.headersSent) return next(err);

    const isPayloadTooLarge = err?.code === 'LIMIT_FILE_SIZE'
      || err?.type === 'entity.too.large'
      || err?.status === 413
      || err?.statusCode === 413;
    const status = isPayloadTooLarge ? 413 : err?.status || err?.statusCode || 500;
    return res.status(status).json({
      error: isPayloadTooLarge
        ? '上传内容超过 100MB 限制。'
        : err?.message || 'Internal Server Error'
    });
  });

  // --- Vite & SPA integration ---
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode with Vite proxy...");
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        watch: {
          ignored: ['**/uploads/**', '**/data/**']
        }
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Full-stack server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start full-stack server:", err);
});
