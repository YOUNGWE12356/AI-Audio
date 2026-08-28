import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { exec, execFile } from 'child_process';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import JSZip from 'jszip';
import ffmpegStatic from 'ffmpeg-static';
import { DEFAULT_CATEGORIES, INITIAL_SOUNDS } from './src/data/sfxData';
import type { SoundEffect } from './src/data/sfxData';
import { buildSfxLibraryIndex, findSfxLibraryMatches } from './src/services/sfxLibraryIndex';
import { planAssistantTask } from './src/services/assistantPlannerService';
import multer from 'multer';
import {
  analyzeAudioDesign,
  analyzeAudioDesignVideoFile,
  generateSfxRequirements,
  generateLyricsFromMusicStyle,
  createEnglishMusicPromptForElevenLabs,
  enhanceVoicePromptForElevenV3,
  matchBestVoice,
  optimizeImportMetadata,
  regenerateLyrics,
  translateTextToLanguage,
  translateToEnglish,
} from './src/services/geminiService';

const ASSISTANT_PLAN_CACHE_TTL_MS = 10 * 60 * 1000;
const ASSISTANT_PLAN_CACHE_MAX_ENTRIES = 100;
const assistantPlanCache = new Map<string, {
  expiresAt: number;
  response: {
    plan: Record<string, unknown>;
    model: string;
    provider: string;
  };
}>();
import {
  GEMINI_PRIMARY_MODEL,
  generateGeminiContent,
  isGptTextConfigured,
  isGeminiUnsupportedLocationError,
} from './src/services/geminiRetry';
import {
  recordElevenLabsResponseUsage,
  setAiUsageRecorder,
} from './src/services/usageTracking';
import type { AiUsageEvent } from './src/services/usageTracking';
import {
  summarizeUsageUsers,
  type StoredAiUsageEvent,
  type UsageIdentitySource,
} from './src/services/usageAggregation';
import {
  ELEVENLABS_MUSIC_MODEL,
  ELEVENLABS_MUSIC_OUTPUT_FORMAT,
  ELEVENLABS_SOUND_MODEL,
  ELEVENLABS_SOUND_OUTPUT_FORMAT,
  fetchAvailableVoices,
  generateMusic,
  generateSoundEffect,
  generateSpeechToSpeech,
  generateVoice,
  isolateAudio,
  transcribeSpeech,
  wrapElevenLabsPcmAsWav,
} from './src/services/elevenLabsService';
import { normalizeElevenLabsQualityMode } from './src/utils/elevenLabsQuality';

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

  // Use JSON middleware with large payload support for categories/sounds state and inline media references.
  app.use(express.json({ limit: '120mb' }));

  type UsageActor = {
    userId: string;
    displayName: string;
    department: string;
    identitySource: UsageIdentitySource;
  };
  type UsageRequestContext = UsageActor & { feature: string; endpoint: string };
  const usageRequestContext = new AsyncLocalStorage<UsageRequestContext>();
  const normalizeIdentityText = (value: unknown, maxLength: number) => (
    typeof value === 'string'
      ? value.normalize('NFC').replace(/[\0-\x1f\x7f]/g, '').trim().slice(0, maxLength)
      : ''
  );
  const resolveUsageActor = (req: express.Request, res: express.Response): UsageActor => {
    // A future Feishu auth middleware should set this server-verified value before this middleware.
    // Client-provided headers are never treated as authenticated Feishu identity.
    const feishuUser = res.locals.feishuUser as {
      openId?: unknown;
      displayName?: unknown;
      department?: unknown;
    } | undefined;
    const feishuOpenId = normalizeIdentityText(feishuUser?.openId, 128);
    if (feishuOpenId) {
      return {
        userId: `feishu:${feishuOpenId}`,
        displayName: normalizeIdentityText(feishuUser?.displayName, 80) || '飞书用户',
        department: normalizeIdentityText(feishuUser?.department, 80),
        identitySource: 'feishu',
      };
    }

    const headerValue = Array.isArray(req.headers['x-ai-audio-client-id'])
      ? req.headers['x-ai-audio-client-id'][0]
      : req.headers['x-ai-audio-client-id'];
    const clientId = normalizeIdentityText(headerValue, 128);
    if (clientId && /^[a-zA-Z0-9._:-]+$/.test(clientId)) {
      const suffix = clientId.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase();
      return {
        userId: `device:${clientId}`,
        displayName: `设备 ${suffix || '未命名'}`,
        department: '',
        identitySource: 'device',
      };
    }

    return {
      userId: 'unknown',
      displayName: '历史未识别用户',
      department: '',
      identitySource: 'unknown',
    };
  };
  const resolveUsageFeature = (req: express.Request) => {
    const endpoint = req.path;
    if (endpoint.includes('/assistant/plan')) return '智能助手 · GPT 任务规划';
    if (endpoint.includes('/audio-design')) return 'AI 音频设计';
    if (endpoint.includes('/regenerate-lyrics') || endpoint.includes('/generate-lyrics')) return 'AI 音乐 · 歌词生成';
    if (endpoint.includes('/music-prompt')) return 'AI 音乐 · 提示词优化';
    if (endpoint.includes('/sfx-requirements')) return '音效需求表';
    if (endpoint.includes('/optimize-metadata')) return '音效库 · 元数据优化';
    if (endpoint.includes('/match-voice') || endpoint.includes('/match-similar-voices')) return 'AI 配音 · 声音匹配';
    if (endpoint.includes('/voice-v3-enhance')) return 'AI 配音 · 台词增强';
    if (endpoint.includes('/translate-dubbing')) return '翻译配音';
    if (endpoint.includes('/translate-language') || endpoint.endsWith('/translate')) return '文本翻译';
    if (endpoint.includes('/speech-to-speech')) return '音频工具 · 语音转换';
    if (endpoint.includes('/audio-isolation') || endpoint.includes('/separate-original-audio')) return '音频工具 · 人声分离';
    if (endpoint.includes('/speech-to-text')) return '音频工具 · 语音转文字';
    if (endpoint.includes('/sound-effect')) return 'AI 音效';
    if (endpoint.includes('/elevenlabs/music')) return 'AI 音乐';
    if (endpoint.includes('/elevenlabs/voice')) return 'AI 配音';
    if (endpoint.includes('/video/analyze')) return '视频声音制作 · AI 分析';
    if (endpoint.includes('/video/generate-clip')) {
      const trackType = String(req.body?.trackType || req.body?.trackId || '');
      if (trackType === 'dubbing') return '视频声音制作 · 配音';
      if (trackType === 'bgm') return '视频声音制作 · 音乐';
      return '视频声音制作 · 音效';
    }
    return '其他 AI 功能';
  };

  app.use((req, res, next) => {
    const endpoint = req.path;
    usageRequestContext.run({
      feature: resolveUsageFeature(req),
      endpoint,
      ...resolveUsageActor(req, res),
    }, next);
  });

  // Directories paths
  const dataDir = path.join(process.cwd(), 'data');
  const uploadsDir = path.join(process.cwd(), 'uploads');
  // Keep the private sound library outside the application upload directory so
  // application cleanup or deployment cannot remove company audio assets.
  const libraryDir = process.env.SFX_LIBRARY_DIR
    ? path.resolve(process.env.SFX_LIBRARY_DIR)
    : path.join(dataDir, 'sfx-library');
  const libraryOriginalsDir = path.join(libraryDir, 'originals');
  const libraryTempDir = path.join(libraryDir, 'temp');
  const sfxLibraryAdminPassword = String(
    process.env.SFX_LIBRARY_ADMIN_PASSWORD
      || process.env.VITE_SFX_LIBRARY_ADMIN_PASSWORD
      || '',
  ).trim();
  const sfxLibraryAdminSessions = new Map<string, number>();
  const sfxLibraryEventClients = new Set<express.Response>();
  const SFX_LIBRARY_ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
  let sfxLibraryRevision = Date.now();
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

  const hasLostFileNameText = (value: unknown) => (
    typeof value === 'string' && /[?\uFFFD]/.test(value)
  );

  const readUploadDisplayName = (req: express.Request) => {
    const rawUtf8Name = Array.isArray(req.headers['x-filename-utf8-base64'])
      ? req.headers['x-filename-utf8-base64'][0]
      : req.headers['x-filename-utf8-base64'];
    if (rawUtf8Name) {
      try {
        return Buffer.from(String(rawUtf8Name), 'base64').toString('utf8');
      } catch {
        return '';
      }
    }

    const rawName = Array.isArray(req.headers['x-filename'])
      ? req.headers['x-filename'][0]
      : req.headers['x-filename'];
    try {
      return decodeURIComponent(String(rawName || 'audio-asset'));
    } catch {
      return String(rawName || 'audio-asset');
    }
  };

  // Ensure directories exist
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  for (const directory of [libraryDir, libraryOriginalsDir, libraryTempDir]) {
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  }
  if (!fs.existsSync(geminiTempDir)) {
    fs.mkdirSync(geminiTempDir, { recursive: true });
  }

  const aiUsageLedgerPath = path.join(dataDir, 'ai-usage.jsonl');
  const aiUsageMetadataPath = path.join(dataDir, 'ai-usage-meta.json');
  const nowIso = new Date().toISOString();
  let usageMetadata: { startedAt: string; detailedSince: string; identitySince: string } = {
    startedAt: nowIso,
    detailedSince: nowIso,
    identitySince: nowIso,
  };
  try {
    const existing = JSON.parse(fs.readFileSync(aiUsageMetadataPath, 'utf8')) as {
      startedAt?: unknown;
      detailedSince?: unknown;
      identitySince?: unknown;
    };
    if (typeof existing.startedAt === 'string' && Number.isFinite(Date.parse(existing.startedAt))) {
      usageMetadata.startedAt = existing.startedAt;
    }
    if (typeof existing.detailedSince === 'string' && Number.isFinite(Date.parse(existing.detailedSince))) {
      usageMetadata.detailedSince = existing.detailedSince;
    }
    if (typeof existing.identitySince === 'string' && Number.isFinite(Date.parse(existing.identitySince))) {
      usageMetadata.identitySince = existing.identitySince;
    }
  } catch {
    // Create or repair the marker below.
  }
  fs.writeFileSync(aiUsageMetadataPath, JSON.stringify(usageMetadata, null, 2), 'utf8');

  setAiUsageRecorder((event) => {
    const context = usageRequestContext.getStore();
    const storedEvent: StoredAiUsageEvent = {
      ...event,
      timestamp: new Date().toISOString(),
      feature: context?.feature || '其他 AI 功能',
      endpoint: context?.endpoint || '',
      userId: context?.userId || 'unknown',
      displayName: context?.displayName || '历史未识别用户',
      department: context?.department || '',
      identitySource: context?.identitySource || 'unknown',
    };
    fs.appendFileSync(aiUsageLedgerPath, `${JSON.stringify(storedEvent)}\n`, 'utf8');
  });

  const readAiUsageEvents = () => {
    if (!fs.existsSync(aiUsageLedgerPath)) return [] as StoredAiUsageEvent[];
    return fs.readFileSync(aiUsageLedgerPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const event = JSON.parse(line) as Partial<StoredAiUsageEvent>;
          return event && ['elevenlabs', 'gemini', 'gpt'].includes(String(event.provider))
            ? [{
                provider: event.provider as AiUsageEvent['provider'],
                model: String(event.model || 'unknown'),
                inputTokens: Number(event.inputTokens) || 0,
                outputTokens: Number(event.outputTokens) || 0,
                reasoningTokens: Number(event.reasoningTokens) || 0,
                totalTokens: Number(event.totalTokens) || 0,
                credits: Number(event.credits) || 0,
                timestamp: String(event.timestamp || ''),
                feature: String(event.feature || '升级前未分类'),
                endpoint: String(event.endpoint || ''),
                userId: String(event.userId || 'unknown'),
                displayName: String(event.displayName || '历史未识别用户'),
                department: String(event.department || ''),
                identitySource: ['feishu', 'device'].includes(String(event.identitySource))
                  ? event.identitySource as UsageIdentitySource
                  : 'unknown',
              } satisfies StoredAiUsageEvent]
            : [];
        } catch {
          return [];
        }
      });
  };

  const getDateKey = (timestamp: string, timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };

  const isPathInside = (root: string, candidate: string) => {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative !== ''
      && relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative);
  };

  const resolveLibraryPath = (storageKey: unknown) => {
    if (typeof storageKey !== 'string' || !storageKey.trim()) return null;
    const normalizedKey = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
    const candidate = path.resolve(libraryDir, normalizedKey);
    return isPathInside(libraryDir, candidate) ? candidate : null;
  };

  const streamRequestToFile = (req: express.Request, filePath: string) => new Promise<number>((resolve, reject) => {
    const output = fs.createWriteStream(filePath, { flags: 'wx' });
    let byteCount = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      output.destroy();
      reject(error);
    };

    req.on('data', (chunk: Buffer) => {
      byteCount += chunk.length;
      if (byteCount > MAX_UPLOAD_BYTES) {
        req.destroy();
        fail(Object.assign(new Error('文件超过 100MB 上传限制。'), { status: 413 }));
      }
    });
    req.on('error', fail);
    output.on('error', fail);
    output.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve(byteCount);
    });
    req.pipe(output);
  });

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

  // Older library exports were written with a lossy encoding conversion. Some
  // values can still be repaired from their file names; values persisted as
  // literal question marks cannot be decoded, so they receive explicit,
  // human-readable fallback names instead of leaking mojibake into the UI.
  const isLostLibraryText = (value: unknown) => (
    typeof value === 'string' && /\?/.test(value)
  );

  const legacyFileStem = (sound: any) => {
    const raw = String(sound?.fileName || sound?.name || '音频素材');
    return raw
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || '音频素材';
  };

  const secretsMatch = (actual: string, expected: string) => {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length
      && timingSafeEqual(actualBuffer, expectedBuffer);
  };

  const getSfxLibraryAdminToken = (req: express.Request) => {
    const authorization = String(req.headers.authorization || '');
    return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  };

  const hasValidSfxLibraryAdminSession = (req: express.Request) => {
    const token = getSfxLibraryAdminToken(req);
    if (!token) return false;
    const expiresAt = sfxLibraryAdminSessions.get(token) || 0;
    if (expiresAt <= Date.now()) {
      sfxLibraryAdminSessions.delete(token);
      return false;
    }
    return true;
  };

  const requireSfxLibraryAdmin: express.RequestHandler = (req, res, next) => {
    if (hasValidSfxLibraryAdminSession(req)) return next();
    return res.status(401).json({ error: '需要有效的管理权限。' });
  };

  const notifySfxLibraryChanged = (type: string) => {
    sfxLibraryRevision = Math.max(Date.now(), sfxLibraryRevision + 1);
    const event = `event: library-change\ndata: ${JSON.stringify({ type, revision: sfxLibraryRevision })}\n\n`;
    sfxLibraryEventClients.forEach(client => {
      try {
        client.write(event);
      } catch {
        sfxLibraryEventClients.delete(client);
      }
    });
    return sfxLibraryRevision;
  };

  const inferLegacyPlacement = (sound: any) => {
    const text = `${sound?.fileName || ''} ${sound?.name || ''} ${sound?.path || ''}`.toLowerCase();
    const music = /(^|[\\/_\s-])(bgm|music)([\\/_\s-]|$)/.test(text) || text.includes('/music/');
    if (music) {
      if (/combat|tension|battle|metal/.test(text)) return { category: '历史导入音乐', subcategory: '战斗/史诗' };
      if (/cyber|neon|synth|electro/.test(text)) return { category: '历史导入音乐', subcategory: '赛博电子' };
      if (/chinese|xianxia|traditional/.test(text)) return { category: '历史导入音乐', subcategory: '国风/传统' };
      if (/casual|lobby|happy|puzzle/.test(text)) return { category: '历史导入音乐', subcategory: '轻松/休闲' };
      if (/suspense|horror|tension|dark/.test(text)) return { category: '历史导入音乐', subcategory: '悬疑/恐怖' };
      return { category: '历史导入音乐', subcategory: '未分类音乐' };
    }

    if (/ui|popup|pageflip|countdown|alert|notification|menu|click/.test(text)) {
      return { category: '历史导入音效', subcategory: '界面/UI' };
    }
    if (/explosion|impact|weapon|sword|gun|firearm|melee|boom/.test(text)) {
      return { category: '历史导入音效', subcategory: '武器/战斗' };
    }
    if (/foot|foley|step|movement/.test(text)) {
      return { category: '历史导入音效', subcategory: '脚步/拟音' };
    }
    if (/magic|spell|laser|shield|sci-fi/.test(text)) {
      return { category: '历史导入音效', subcategory: '魔法/科幻' };
    }
    if (/creature|monster|wolf|goose|vocal|growl/.test(text)) {
      return { category: '历史导入音效', subcategory: '生物/怪物' };
    }
    if (/ambient|nature|fountain|wind|rain|water/.test(text)) {
      return { category: '历史导入音效', subcategory: '环境/自然' };
    }
    return { category: '历史导入音效', subcategory: '未分类音效' };
  };

  const ensureRecoveredGroup = (categories: any[], groupId: string, groupName: string, subcategories: string[]) => {
    let group = categories.find(item => item?.id === groupId);
    if (!group) {
      group = {
        id: groupId,
        name: groupName,
        english: groupName,
        subCategories: [],
      };
      categories.push(group);
    }
    group.name = groupName;
    group.english = groupName;
    if (!Array.isArray(group.subCategories)) group.subCategories = [];
    subcategories.forEach((name, index) => {
      const existing = group.subCategories.find((item: any) => item?.name === name || item?.id === `recovered-${groupId}-${index}`);
      if (existing) {
        existing.name = name;
        existing.english = name;
      } else {
        group.subCategories.push({
          id: `recovered-${groupId}-${index}`,
          name,
          english: name,
          description: name,
        });
      }
    });
    return group;
  };

  const repairLibraryMetadata = (rawCategories: any[], rawSounds: any[]) => {
    const categories = Array.isArray(rawCategories) ? rawCategories : [];
    const sounds = Array.isArray(rawSounds) ? rawSounds : [];
    const touched = { categories: false, sounds: false };
    const hadLostMetadata = categories.some((group: any) => (
      isLostLibraryText(group?.name)
      || (Array.isArray(group?.subCategories) && group.subCategories.some((sub: any) => isLostLibraryText(sub?.name)))
    )) || sounds.some((sound: any) => (
      isLostLibraryText(sound?.category)
      || isLostLibraryText(sound?.subcategory)
    ));

    categories.forEach((group: any, groupIndex: number) => {
      if (!group || typeof group !== 'object') return;
      if (isLostLibraryText(group.name) || (
        String(group.id || '').startsWith('custom_group_')
        && group.name === '历史导入音效'
      )) {
        group.name = `历史目录 ${Math.max(1, groupIndex)}`;
        touched.categories = true;
      }
      if (!Array.isArray(group.subCategories)) {
        group.subCategories = [];
        touched.categories = true;
      }
      group.subCategories.forEach((sub: any, subIndex: number) => {
        if (isLostLibraryText(sub?.name)) {
          sub.name = `历史子目录 ${subIndex + 1}`;
          touched.categories = true;
        }
        if (isLostLibraryText(sub?.description)) {
          sub.description = sub.name || '历史导入素材';
          touched.categories = true;
        }
      });
    });

    if (hadLostMetadata) {
      ensureRecoveredGroup(categories, 'recovered_imported_sfx', '历史导入音效', [
        '界面/UI', '武器/战斗', '脚步/拟音', '魔法/科幻', '生物/怪物', '环境/自然', '未分类音效',
      ]);
      ensureRecoveredGroup(categories, 'recovered_imported_music', '历史导入音乐', [
        '战斗/史诗', '赛博电子', '国风/传统', '轻松/休闲', '悬疑/恐怖', '未分类音乐',
      ]);
    }

    sounds.forEach((sound: any) => {
      if (!sound || typeof sound !== 'object') return;
      const placement = (isLostLibraryText(sound.category) || isLostLibraryText(sound.subcategory))
        ? inferLegacyPlacement(sound)
        : { category: String(sound.category || ''), subcategory: String(sound.subcategory || '') };
      if (placement.category && (sound.category !== placement.category || sound.subcategory !== placement.subcategory)) {
        sound.category = placement.category;
        sound.subcategory = placement.subcategory;
        touched.sounds = true;
      }
      if (isLostLibraryText(sound.name)) {
        sound.name = legacyFileStem(sound);
        touched.sounds = true;
      }
      if (isLostLibraryText(sound.designer)) {
        const designer = String(sound.designer);
        sound.designer = designer.includes('Kevin')
          ? 'AD_Design / Kevin'
          : designer.includes('Milly')
            ? 'AD_Design / Milly'
            : 'AD_Design';
        touched.sounds = true;
      }
      if (Array.isArray(sound.tags)) {
        const nextTags = sound.tags.filter((tag: unknown) => typeof tag === 'string' && !isLostLibraryText(tag));
        if (nextTags.length === 0) nextTags.push(sound.subcategory || '历史导入');
        if (JSON.stringify(nextTags) !== JSON.stringify(sound.tags)) {
          sound.tags = nextTags;
          touched.sounds = true;
        }
      }
    });

    return { categories, sounds, touched };
  };

  const loadAndRepairLibraryMetadata = () => {
    let categories: any[] = [];
    let sounds: any[] = [];
    try {
      if (fs.existsSync(categoriesFile)) {
        const parsed = JSON.parse(fs.readFileSync(categoriesFile, 'utf-8'));
        if (Array.isArray(parsed)) categories = parsed;
      }
    } catch (error) {
      console.warn('Unable to parse library categories; rebuilding a readable index:', error);
    }
    try {
      if (fs.existsSync(soundsFile)) {
        const parsed = JSON.parse(fs.readFileSync(soundsFile, 'utf-8'));
        if (Array.isArray(parsed)) sounds = parsed;
      }
    } catch (error) {
      console.warn('Unable to parse library sounds; keeping the readable fallback index:', error);
    }

    return {
      categories,
      sounds,
      touched: { categories: false, sounds: false },
    };
  };

  // Repair legacy metadata before the library is first read.
  try {
    loadAndRepairLibraryMetadata();
  } catch (error) {
    console.warn('Unable to repair library metadata:', error);
  }

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
    const tags = (sound.tags || []).map(tag => normalizeSearchText(tag));
    if (sound.source === 'generated' || tags.includes('自动入库') || tags.includes('ai生成')) return 'generated';
    if (sound.storageKey) return 'uploaded';
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
    if (sound.generatedKind) return sound.generatedKind;
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
      downloadUrl: sound.downloadUrl || sound.url || '',
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

  app.post('/api/sfx/admin/login', (req, res) => {
    if (!sfxLibraryAdminPassword) {
      return res.status(503).json({ error: '服务器尚未配置音效库管理密码。' });
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!secretsMatch(password, sfxLibraryAdminPassword)) {
      return res.status(401).json({ error: '管理密码错误。' });
    }
    const token = randomUUID();
    const expiresAt = Date.now() + SFX_LIBRARY_ADMIN_SESSION_TTL_MS;
    sfxLibraryAdminSessions.set(token, expiresAt);
    return res.json({ authorized: true, token, expiresAt });
  });

  app.get('/api/sfx/admin/session', (req, res) => {
    return res.json({ authorized: hasValidSfxLibraryAdminSession(req) });
  });

  app.post('/api/sfx/admin/logout', (req, res) => {
    const token = getSfxLibraryAdminToken(req);
    if (token) sfxLibraryAdminSessions.delete(token);
    return res.json({ success: true });
  });

  app.get('/api/sfx/library/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`event: connected\ndata: ${JSON.stringify({ revision: sfxLibraryRevision })}\n\n`);
    sfxLibraryEventClients.add(res);
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      sfxLibraryEventClients.delete(res);
    });
  });

  app.get('/api/sfx/library/state', (req, res) => {
    try {
      const repaired = loadAndRepairLibraryMetadata();
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        revision: sfxLibraryRevision,
        categories: repaired.categories,
        sounds: fs.existsSync(soundsFile) ? repaired.sounds : INITIAL_SOUNDS,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/sfx/library/state', requireSfxLibraryAdmin, (req, res) => {
    try {
      const categories = req.body?.categories;
      const sounds = req.body?.sounds;
      const baseRevision = Number(req.body?.baseRevision);
      if (!Array.isArray(categories) || !Array.isArray(sounds)) {
        return res.status(400).json({ error: '音效库目录或清单格式无效。' });
      }
      const hasCorruptedDirectoryText = categories.some((group: any) => (
        isLostLibraryText(group?.name)
        || (Array.isArray(group?.subCategories) && group.subCategories.some((sub: any) => isLostLibraryText(sub?.name)))
      )) || sounds.some((sound: any) => (
        isLostLibraryText(sound?.category) || isLostLibraryText(sound?.subcategory)
      ));
      const hasCorruptedSoundName = sounds.some((sound: any) => (
        hasLostFileNameText(sound?.name) || hasLostFileNameText(sound?.fileName)
      ));
      if (hasCorruptedDirectoryText || hasCorruptedSoundName) {
        return res.status(400).json({ error: '检测到损坏的目录或文件名文字，已拒绝保存以保护服务器数据。' });
      }
      if (Number.isFinite(baseRevision) && baseRevision !== sfxLibraryRevision) {
        const current = loadAndRepairLibraryMetadata();
        return res.status(409).json({
          error: '音效库已被其他管理员更新，请刷新后重试。',
          revision: sfxLibraryRevision,
          categories: current.categories,
          sounds: current.sounds,
        });
      }
      fs.writeFileSync(categoriesFile, JSON.stringify(categories, null, 2), 'utf-8');
      fs.writeFileSync(soundsFile, JSON.stringify(sounds, null, 2), 'utf-8');
      const revision = notifySfxLibraryChanged('state-updated');
      return res.json({ success: true, revision });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Private company-library media endpoints. The browser streams these files
  // directly from the server with HTTP Range support instead of proxying audio
  // through the React app or storing large uploads in browser IndexedDB.
  app.post('/api/sfx/library/upload', requireSfxLibraryAdmin, asyncRoute(async (req, res) => {
    const originalName = normalizeUploadDisplayName(readUploadDisplayName(req), '');
    if (!originalName || hasLostFileNameText(originalName)) {
      return res.status(400).json({
        error: '文件名编码异常，请重新选择原文件或在上传预览中修正文件名。',
      });
    }
    const extension = getSafeUploadExtension(originalName, req.headers['content-type'], '.wav');
    const storageName = `${randomUUID()}${extension}`;
    const storageKey = path.posix.join('originals', storageName);
    const finalPath = resolveLibraryPath(storageKey);
    if (!finalPath) return res.status(400).json({ error: 'Invalid library storage path.' });

    const tempPath = path.join(libraryTempDir, `${randomUUID()}.upload`);
    try {
      const contentLength = Number(req.headers['content-length'] || 0);
      if (contentLength > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: '文件超过 100MB 上传限制。' });
      }
      const byteCount = await streamRequestToFile(req, tempPath);
      if (byteCount <= 0) return res.status(400).json({ error: '未收到音频文件。' });
      await fs.promises.rename(tempPath, finalPath);

      const encodedKey = encodeURIComponent(storageKey);
      const streamUrl = `/api/sfx/library/stream?key=${encodedKey}`;
      return res.json({
        success: true,
        fileName: storageName,
        originalName,
        storageKey,
        sizeBytes: byteCount,
        url: streamUrl,
        previewUrl: streamUrl,
        downloadUrl: `${streamUrl}&download=1`,
        processingStatus: 'ready',
      });
    } catch (error: any) {
      await safeUnlink(tempPath);
      return res.status(error?.status || 500).json({
        error: error?.message || '音效库文件上传失败。',
      });
    }
  }));

  app.get('/api/sfx/library/stream', (req, res) => {
    const filePath = resolveLibraryPath(req.query.key);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: '音效文件不存在。' });
    }
    const download = String(req.query.download || '') === '1';
    const disposition = download ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(path.basename(filePath))}"`);
    return res.sendFile(filePath, {
      acceptRanges: true,
      cacheControl: true,
      maxAge: '1h',
    });
  });

  app.delete('/api/sfx/library/file', requireSfxLibraryAdmin, asyncRoute(async (req, res) => {
    const filePath = resolveLibraryPath(req.query.key);
    if (!filePath) return res.status(400).json({ error: 'Invalid library storage path.' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Library file not found.' });

    await fs.promises.unlink(filePath);
    return res.json({ success: true });
  }));

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
        gptText: isGptTextConfigured(),
        elevenLabs: Boolean(process.env.ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY),
        ffmpeg: Boolean(FFMPEG_BINARY),
        demucsConfigured: Boolean(process.env.DEMUCS_COMMAND || process.env.DEMUCS_PYTHON),
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/usage/summary', requireSfxLibraryAdmin, asyncRoute(async (req, res) => {
    const now = Date.now();
    const requestedStart = Number(req.query.start);
    const requestedEnd = Number(req.query.end);
    const startTime = Number.isFinite(requestedStart) ? requestedStart : now - (7 * 24 * 60 * 60 * 1000);
    const endTime = Number.isFinite(requestedEnd) ? Math.min(requestedEnd, now) : now;
    if (startTime >= endTime || endTime - startTime > 370 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Invalid usage time range.' });
    }

    const requestedTimeZone = typeof req.query.timeZone === 'string' ? req.query.timeZone : 'Asia/Shanghai';
    let timeZone = 'Asia/Shanghai';
    try {
      new Intl.DateTimeFormat('en', { timeZone: requestedTimeZone }).format();
      timeZone = requestedTimeZone;
    } catch {
      // Keep the stable application default when the browser sends an invalid zone.
    }

    const events = readAiUsageEvents().filter((event) => {
      const timestamp = Date.parse(event.timestamp);
      return timestamp >= startTime && timestamp <= endTime;
    });
    const summarizeLocalProvider = (provider: AiUsageEvent['provider'], configured: boolean) => {
      const providerEvents = events.filter(event => event.provider === provider);
      const daily = new Map<string, {
        date: string;
        credits: number;
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        requests: number;
      }>();
      const models = new Map<string, number>();
      const features = new Map<string, {
        feature: string;
        credits: number;
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        requests: number;
        models: Map<string, number>;
      }>();
      const totals = {
        credits: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        requests: 0,
        unmeteredRequests: 0,
      };

      for (const event of providerEvents) {
        totals.credits += event.credits;
        totals.inputTokens += event.inputTokens;
        totals.outputTokens += event.outputTokens;
        totals.reasoningTokens += event.reasoningTokens;
        totals.totalTokens += event.totalTokens;
        totals.requests += 1;
        if (provider === 'elevenlabs' && event.credits === 0) totals.unmeteredRequests += 1;
        const primaryAmount = provider === 'elevenlabs' ? event.credits : event.totalTokens;
        models.set(event.model, (models.get(event.model) || 0) + primaryAmount);

        const feature = features.get(event.feature) || {
          feature: event.feature,
          credits: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          requests: 0,
          models: new Map<string, number>(),
        };
        feature.credits += event.credits;
        feature.inputTokens += event.inputTokens;
        feature.outputTokens += event.outputTokens;
        feature.reasoningTokens += event.reasoningTokens;
        feature.totalTokens += event.totalTokens;
        feature.requests += 1;
        feature.models.set(event.model, (feature.models.get(event.model) || 0) + primaryAmount);
        features.set(event.feature, feature);

        const date = getDateKey(event.timestamp, timeZone);
        const bucket = daily.get(date) || {
          date,
          credits: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          requests: 0,
        };
        bucket.credits += event.credits;
        bucket.inputTokens += event.inputTokens;
        bucket.outputTokens += event.outputTokens;
        bucket.reasoningTokens += event.reasoningTokens;
        bucket.totalTokens += event.totalTokens;
        bucket.requests += 1;
        daily.set(date, bucket);
      }

      return {
        status: configured ? 'tracking' as const : 'not_configured' as const,
        ...totals,
        models: Array.from(models, ([model, amount]) => ({ model, amount }))
          .sort((left, right) => right.amount - left.amount),
        features: Array.from(features.values()).map(feature => ({
          ...feature,
          models: Array.from(feature.models, ([model, amount]) => ({ model, amount }))
            .sort((left, right) => right.amount - left.amount),
        })).sort((left, right) => (
          provider === 'elevenlabs'
            ? right.credits - left.credits
            : right.totalTokens - left.totalTokens
        )),
        daily: Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date)),
      };
    };

    const users = summarizeUsageUsers(events);

    return res.json({
      range: {
        start: new Date(startTime).toISOString(),
        end: new Date(endTime).toISOString(),
        timeZone,
      },
      collectedSince: usageMetadata.startedAt,
      detailedSince: usageMetadata.detailedSince,
      identitySince: usageMetadata.identitySince,
      scope: 'this-tool-only',
      users,
      providers: {
        elevenLabs: summarizeLocalProvider(
          'elevenlabs',
          Boolean(process.env.ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY),
        ),
        gemini: summarizeLocalProvider(
          'gemini',
          Boolean(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY),
        ),
        gpt: summarizeLocalProvider('gpt', isGptTextConfigured()),
      },
    });
  }));

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
      return res.json(loadAndRepairLibraryMetadata().categories);
    } catch (err: any) {
      console.error('Error reading categories:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 2. Save Categories
  app.post('/api/sfx/categories', requireSfxLibraryAdmin, (req, res) => {
    try {
      const categories = req.body;
      if (!Array.isArray(categories)) {
        return res.status(400).json({ error: 'Invalid categories format' });
      }
      const existingSounds = fs.existsSync(soundsFile)
        ? JSON.parse(fs.readFileSync(soundsFile, 'utf-8'))
        : [];
      fs.writeFileSync(categoriesFile, JSON.stringify(categories, null, 2), 'utf-8');
      if (!fs.existsSync(soundsFile)) {
        fs.writeFileSync(soundsFile, JSON.stringify(Array.isArray(existingSounds) ? existingSounds : [], null, 2), 'utf-8');
      }
      const revision = notifySfxLibraryChanged('categories-updated');
      return res.json({ success: true, revision });
    } catch (err: any) {
      console.error('Error saving categories:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 3. Get Sound Effects
  app.get('/api/sfx/sounds', (req, res) => {
    try {
      const repaired = loadAndRepairLibraryMetadata();
      return res.json(fs.existsSync(soundsFile) ? repaired.sounds : INITIAL_SOUNDS);
    } catch (err: any) {
      console.error('Error reading sounds:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 4. Save Sound Effects List
  app.post('/api/sfx/sounds', requireSfxLibraryAdmin, (req, res) => {
    try {
      const sounds = req.body;
      if (!Array.isArray(sounds)) {
        return res.status(400).json({ error: 'Invalid sounds format' });
      }
      const existingCategories = fs.existsSync(categoriesFile)
        ? JSON.parse(fs.readFileSync(categoriesFile, 'utf-8'))
        : [];
      fs.writeFileSync(soundsFile, JSON.stringify(sounds, null, 2), 'utf-8');
      if (!fs.existsSync(categoriesFile)) {
        fs.writeFileSync(categoriesFile, JSON.stringify(Array.isArray(existingCategories) ? existingCategories : [], null, 2), 'utf-8');
      }
      const revision = notifySfxLibraryChanged('sounds-updated');
      return res.json({ success: true, revision });
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
      const offsetValue = Number.parseInt(String(req.query.offset || '0'), 10);
      const offset = Number.isFinite(offsetValue) ? Math.max(offsetValue, 0) : 0;

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
        assets: assets.slice(offset, offset + limit),
        total: assets.length,
        limit,
        offset,
        nextOffset: offset + limit < assets.length ? offset + limit : null,
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

  app.post('/api/audio/decode', upload.single('media'), asyncRoute(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: '请上传需要提取音轨的音频或视频文件。' });
    }

    const inputPath = req.file.path;
    const outputPath = path.resolve(uploadsDir, `audio-decode-${randomUUID()}.wav`);
    if (!isPathInside(uploadsDir, outputPath)) {
      await safeUnlink(inputPath);
      throw Object.assign(new Error('音轨临时输出路径无效。'), { status: 500 });
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const args = [
          '-y',
          '-i', inputPath,
          '-map', '0:a:0',
          '-vn',
          '-map_metadata', '-1',
          '-c:a', 'pcm_s16le',
          outputPath,
        ];
        execFile(FFMPEG_BINARY, args, (error, _stdout, stderr) => {
          if (!error) {
            resolve();
            return;
          }
          const ffmpegUnavailable = /ffmpeg.*(?:not recognized|not found)|ENOENT/i.test(`${error.message}\n${stderr}`);
          reject(Object.assign(
            new Error(ffmpegUnavailable
              ? '本地 FFmpeg 不可用，无法正确提取视频音轨。'
              : `提取音轨失败：${String(stderr || error.message).trim().split(/\r?\n/).slice(-1)[0] || error.message}`),
            { status: ffmpegUnavailable ? 503 : 422 },
          ));
        });
      });

      res.type('audio/wav');
      await new Promise<void>((resolve, reject) => {
        res.sendFile(outputPath, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return undefined;
    } finally {
      await Promise.all([safeUnlink(inputPath), safeUnlink(outputPath)]);
    }
  }));

  const voiceGenerationQueues = new Map<string, Promise<unknown>>();
  const runVoiceGenerationQueued = async <T,>(voiceId: string, task: () => Promise<T>): Promise<T> => {
    const previous = voiceGenerationQueues.get(voiceId) || Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    voiceGenerationQueues.set(voiceId, run.finally(() => {
      if (voiceGenerationQueues.get(voiceId) === run) {
        voiceGenerationQueues.delete(voiceId);
      }
    }));
    return run;
  };

  const sharedVoiceAvailabilityCache = new Set<string>();
  const ensureSharedVoiceAvailable = async (
    voiceId: string,
    publicOwnerId?: string,
    voiceName?: string,
  ) => {
    const ownerId = String(publicOwnerId || '').trim();
    if (!ownerId || sharedVoiceAvailabilityCache.has(voiceId)) return;

    const apiKey = process.env.ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY || '';
    if (!apiKey) return;

    const response = await fetch(
      `https://api.elevenlabs.io/v1/voices/add/${encodeURIComponent(ownerId)}/${encodeURIComponent(voiceId)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          new_name: String(voiceName || `Voice Library ${voiceId}`).slice(0, 80),
        }),
      },
    );

    if (response.ok) {
      sharedVoiceAvailabilityCache.add(voiceId);
      return;
    }

    const body = await response.json().catch(() => ({}));
    const message = String(body?.detail?.message || body?.message || response.statusText || '');
    if (
      response.status === 409 ||
      /already|exists|added|Multiple voice additions\/deletions/i.test(message)
    ) {
      sharedVoiceAvailabilityCache.add(voiceId);
      return;
    }

    throw new Error(`ElevenLabs 声音库同步失败：${message || response.status}`);
  };

  const parseNumber = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };

  const getMediaDurationSeconds = (filePath: string) => new Promise<number>((resolve, reject) => {
    const parseDuration = (value: string) => {
      const match = String(value || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
      if (!match) return 0;
      const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      return Number.isFinite(duration) && duration > 0 ? duration : 0;
    };
    const fallbackToFfmpeg = (detail: string) => {
      execFile(
        FFMPEG_BINARY,
        ['-hide_banner', '-i', filePath, '-f', 'null', '-'],
        { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
        (fallbackError, fallbackStdout, fallbackStderr) => {
          const duration = parseDuration(`${fallbackStderr}\n${fallbackStdout}`);
          if (duration > 0) {
            resolve(duration);
            return;
          }
          reject(new Error(detail || fallbackError?.message || 'Unable to read media duration'));
        },
      );
    };
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      (error, stdout, stderr) => {
        const duration = Number.parseFloat(stdout.trim());
        if (!error && Number.isFinite(duration) && duration > 0) {
          resolve(duration);
          return;
        }
        fallbackToFfmpeg(String(stderr || error?.message || 'Unable to read media duration'));
      },
    );
  });

  const getVideoStreamSummary = (filePath: string) => new Promise<string>((resolve, reject) => {
    execFile(
      FFMPEG_BINARY,
      ['-hide_banner', '-i', filePath],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        const output = String(stderr || error?.message || '');
        const videoLine = output.split(/\r?\n/).find(line => /Video:/i.test(line));
        if (!videoLine) {
          reject(new Error(output || 'Unable to inspect video stream'));
          return;
        }
        resolve(videoLine);
      },
    );
  });

  const isBrowserFriendlyVideo = (fileName: string, videoSummary: string) => {
    const extension = path.extname(fileName).toLowerCase();
    return ['.mp4', '.m4v'].includes(extension)
      && /Video:\s*h264\b/i.test(videoSummary)
      && /yuv420p/i.test(videoSummary);
  };

  const ensureBrowserCompatiblePreview = async (fileName: string) => {
    const safeName = parseSafeVideoFilename(fileName);
    if (!safeName) {
      throw Object.assign(new Error('Invalid video file name.'), { status: 400 });
    }

    const { videoPath } = await resolveValidatedUploadedVideo(fileName);
    const sourceSummary = await getVideoStreamSummary(videoPath);

    if (isBrowserFriendlyVideo(fileName, sourceSummary)) {
      return {
        previewUrl: `/uploads/${fileName}`,
        reusedSource: true,
        sourceSummary,
      };
    }

    const previewFileName = `preview_${safeName.base}_h264.mp4`;
    const previewPath = path.resolve(uploadsDir, previewFileName);
    if (!isPathInside(uploadsDir, previewPath)) {
      throw Object.assign(new Error('Invalid preview video path.'), { status: 500 });
    }

    try {
      const existingPreview = await fs.promises.stat(previewPath);
      if (existingPreview.isFile() && existingPreview.size > 0) {
        return {
          previewUrl: `/uploads/${previewFileName}`,
          reusedSource: false,
          sourceSummary,
        };
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }

    await new Promise<void>((resolve, reject) => {
      execFile(
        FFMPEG_BINARY,
        [
          '-y',
          '-i', videoPath,
          '-map', '0:v:0',
          '-map', '0:a?',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '20',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          previewPath,
        ],
        { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 },
        async (error, _stdout, stderr) => {
          if (error) {
            await safeUnlink(previewPath);
            reject(new Error(stderr || error.message));
            return;
          }
          resolve();
        },
      );
    });

    return {
      previewUrl: `/uploads/${previewFileName}`,
      reusedSource: false,
      sourceSummary,
    };
  };

  const buildTranslatedDubbingAtempoFilter = (tempo: number) => {
    const parts: number[] = [];
    let remaining = Math.min(2, Math.max(0.5, tempo));
    while (remaining > 2) {
      parts.push(2);
      remaining /= 2;
    }
    while (remaining < 0.5) {
      parts.push(0.5);
      remaining /= 0.5;
    }
    parts.push(Math.min(2, Math.max(0.5, remaining)));
    return parts.map(part => `atempo=${part.toFixed(4)}`).join(',');
  };

  const normalizeTextForLanguageCheck = (value: string) => value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  const validateTranslatedDubbingText = (
    sourceText: string,
    translatedText: string,
    targetLanguage: string,
  ) => {
    const normalizedTarget = targetLanguage.trim().toLowerCase();
    const normalizedSource = normalizeTextForLanguageCheck(sourceText);
    const normalizedTranslation = normalizeTextForLanguageCheck(translatedText);

    if (!normalizedTranslation) {
      throw Object.assign(new Error('翻译结果为空，已停止生成目标语音。'), { status: 502 });
    }

    if (normalizedSource && normalizedSource === normalizedTranslation) {
      throw Object.assign(new Error('翻译结果仍然是原文，已停止生成目标语音，请重试。'), { status: 502 });
    }

    if (/english|en\b|英文|英语/.test(normalizedTarget) && !/[a-zA-Z]{2,}/.test(translatedText)) {
      throw Object.assign(new Error('目标语言选择为英文，但翻译结果不是英文，已停止生成。'), { status: 502 });
    }
  };

  const stretchAudioToDuration = (
    inputPath: string,
    outputPath: string,
    sourceDuration: number,
    generatedDuration: number,
    mode: 'natural' | 'match' | 'strict',
  ) => new Promise<{ stretched: boolean; speedRatio: number }>((resolve) => {
    if (mode === 'natural' || sourceDuration <= 0 || generatedDuration <= 0) {
      resolve({ stretched: false, speedRatio: 1 });
      return;
    }

    const rawTempo = generatedDuration / sourceDuration;
    const maxTempo = mode === 'strict' ? 1.75 : 1.35;
    const minTempo = mode === 'strict' ? 0.6 : 0.75;
    const tempo = Math.min(maxTempo, Math.max(minTempo, rawTempo));
    if (Math.abs(tempo - 1) < 0.03) {
      resolve({ stretched: false, speedRatio: 1 });
      return;
    }

    execFile(
      FFMPEG_BINARY,
      ['-y', '-i', inputPath, '-filter:a', buildTranslatedDubbingAtempoFilter(tempo), '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', outputPath],
      (error) => {
        if (error) {
          console.warn('Failed to time-stretch translated dubbing audio; using natural timing:', error);
          resolve({ stretched: false, speedRatio: 1 });
          return;
        }
        resolve({ stretched: true, speedRatio: tempo });
      },
    );
  });

  const recoverClipsFromPossiblyTruncatedJson = (raw: string) => {
    const clipsKeyMatch = raw.match(/"clips"\s*:/);
    if (!clipsKeyMatch || clipsKeyMatch.index === undefined) return [];

    const arrayStart = raw.indexOf('[', clipsKeyMatch.index + clipsKeyMatch[0].length);
    if (arrayStart === -1) return [];

    const recoveredClips: any[] = [];
    let inString = false;
    let escaped = false;
    let objectDepth = 0;
    let objectStart = -1;

    for (let index = arrayStart + 1; index < raw.length; index += 1) {
      const char = raw[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{') {
        if (objectDepth === 0) objectStart = index;
        objectDepth += 1;
        continue;
      }

      if (char === '}') {
        if (objectDepth <= 0) continue;
        objectDepth -= 1;
        if (objectDepth === 0 && objectStart >= 0) {
          const objectText = raw.slice(objectStart, index + 1);
          try {
            const clip = JSON.parse(objectText);
            if (clip && typeof clip === 'object') {
              recoveredClips.push(clip);
            }
          } catch (clipParseError) {
            console.warn('Skipping one malformed recovered video-analysis clip:', clipParseError);
          }
          objectStart = -1;
        }
        continue;
      }

      if (char === ']' && objectDepth === 0) {
        break;
      }
    }

    return recoveredClips;
  };

  type AudioExportFormat = 'mp3' | 'wav' | 'aac';
  type AudioExportChannelMode = 'mono' | 'stereo';

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

  const normalizeAudioChannelMode = (value: unknown): AudioExportChannelMode => (
    String(value || '').trim().toLowerCase() === 'mono' ? 'mono' : 'stereo'
  );

  const getAudioChannelArgs = (channelMode: AudioExportChannelMode) => (
    ['-ac', channelMode === 'mono' ? '1' : '2']
  );

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
    channelMode: AudioExportChannelMode = 'stereo',
  ) => {
    const args = ['-ar', String(sampleRate), ...getAudioChannelArgs(channelMode)];
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
    channelMode: AudioExportChannelMode = 'stereo',
  ) => {
    const channelArgs = getAudioChannelArgs(channelMode);
    if (format === 'wav') {
      return {
        extension: '.mov',
        args: ['-ar', String(sampleRate), ...channelArgs, '-c:a', getPcmCodec(bitDepth)],
      };
    }
    if (format === 'mp3') {
      return {
        extension: '.mp4',
        args: ['-ar', String(sampleRate), ...channelArgs, '-c:a', 'libmp3lame', '-b:a', bitrate],
      };
    }
    return {
      extension: '.mp4',
      args: ['-ar', String(sampleRate), ...channelArgs, '-c:a', 'aac', '-b:a', bitrate],
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
    options: { dense?: boolean } = {},
  ): Promise<Array<{ timestamp: number; base64: string }>> => {
    const { videoPath } = await resolveValidatedUploadedVideo(fileName);

    const duration = parseNumber(requestedDuration, 30, 1, 3_600);
    const frameCount = options.dense
      ? Math.min(48, Math.max(12, Math.ceil(duration)))
      : 6;
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

  const resolveUploadedMediaUrlPath = (value: unknown) => {
    const mediaUrl = String(value || '').trim();
    if (!mediaUrl.startsWith('/uploads/')) {
      throw Object.assign(new Error('请选择已上传到工程里的音频片段。'), { status: 400 });
    }

    const fileName = path.basename(mediaUrl.split(/[?#]/)[0]);
    if (!fileName || fileName !== mediaUrl.split(/[?#]/)[0].replace(/^\/uploads\//, '')) {
      throw Object.assign(new Error('片段音频路径无效，无法读取。'), { status: 400 });
    }

    const extension = path.extname(fileName).toLowerCase();
    if (![
      '.wav',
      '.mp3',
      '.m4a',
      '.aac',
      '.ogg',
      '.webm',
      '.mp4',
      '.mov',
      '.m4v',
    ].includes(extension)) {
      throw Object.assign(new Error('仅支持从音频/视频素材中抽取片段。'), { status: 415 });
    }

    const filePath = path.resolve(uploadsDir, fileName);
    if (!isPathInside(uploadsDir, filePath) || !fs.existsSync(filePath)) {
      throw Object.assign(new Error('找不到片段源文件，请重新上传或重新拆分后再试。'), { status: 404 });
    }
    const stat = fs.statSync(filePath);
    if (stat.size <= 0) {
      throw Object.assign(new Error('片段源文件为空，无法读取。'), { status: 422 });
    }
    return { filePath, fileName, extension };
  };

  const normalizeVoiceForMatching = (voice: any) => {
    const id = String(voice?.id || voice?.voice_id || '').trim();
    if (!/^[a-zA-Z0-9_-]{10,64}$/.test(id)) return null;
    const labels = voice?.labels && typeof voice.labels === 'object' ? voice.labels : {};
    const tags = Array.isArray(voice?.tags) ? voice.tags : Object.values(labels).filter(Boolean);
    const rawGender = String(voice?.gender || labels.gender || '').toLowerCase();
    const normalizedGender = rawGender.includes('female')
      ? 'female'
      : rawGender.includes('male')
        ? 'male'
        : '';
    return {
      id,
      name: String(voice?.name || voice?.englishName || id).slice(0, 120),
      englishName: String(voice?.englishName || voice?.name || id).slice(0, 120),
      gender: normalizedGender,
      category: String(voice?.category || voice?.category_name || '').slice(0, 80),
      description: String(voice?.description || labels.description || '').slice(0, 300),
      tags: tags.map((tag: any) => String(tag).slice(0, 60)).filter(Boolean).slice(0, 12),
    };
  };

  const getVoiceKeywordScore = (voiceText: string, matchingKeywords?: string) => {
    const rawKeywords = String(matchingKeywords || '').trim().toLowerCase();
    if (!rawKeywords) return 0;
    const tokens = rawKeywords
      .split(/[\s,，、;；|/]+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2)
      .slice(0, 12);
    const searchableTokens = tokens.length > 0 ? tokens : [rawKeywords];
    return searchableTokens.reduce((score, token) => (
      voiceText.includes(token) ? score + 7 : score
    ), voiceText.includes(rawKeywords) ? 6 : 0);
  };

  const localVoiceMatchFallback = (voices: any[], preferredGender?: string, matchingKeywords?: string) => {
    const gender = preferredGender === 'male' || preferredGender === 'female' ? preferredGender : '';
    const genderMatchedVoices = gender
      ? voices.filter(voice => String(voice.gender).toLowerCase() === gender)
      : [];
    const candidateVoices = genderMatchedVoices.length > 0 ? genderMatchedVoices : voices;
    return candidateVoices
      .map((voice, index) => {
        const voiceText = [
          voice.name,
          voice.englishName,
          voice.category,
          voice.description,
          ...(voice.tags || []),
        ].join(' ').toLowerCase();
        let score = 68 - index;
        if (gender && String(voice.gender).toLowerCase() === gender) score += 16;
        if (/natural|真实|自然|conversation|口语|dialogue|对话/i.test(voiceText)) score += 8;
        if (/young|adult|middle|warm|calm|serious|energetic|温暖|沉稳|活泼|叙事/i.test(voiceText)) score += 4;
        const keywordScore = getVoiceKeywordScore(voiceText, matchingKeywords);
        score += Math.min(18, keywordScore);
        return {
          voiceId: voice.id,
          score: Math.max(45, Math.min(92, score)),
          reason: keywordScore > 0
            ? '基于参考音频、关键词和声音库标签的近似推荐。'
            : '基于声音库标签与可用元数据的近似推荐。',
        };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);
  };

  const readAudioAsRawPcm16 = (filePath: string, seconds = 8) => new Promise<Buffer>((resolve, reject) => {
    execFile(
      FFMPEG_BINARY,
      [
        '-v', 'error',
        '-i', filePath,
        '-t', String(seconds),
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-f', 's16le',
        'pipe:1',
      ],
      {
        encoding: 'buffer',
        windowsHide: true,
        timeout: 45_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message)));
          return;
        }
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });

  const estimateReferenceVoiceGender = async (filePath: string) => {
    try {
      const sampleRate = 16_000;
      const pcm = await readAudioAsRawPcm16(filePath, 8);
      const sampleCount = Math.floor(pcm.length / 2);
      if (sampleCount < sampleRate * 0.4) return { gender: 'unknown' as const, confidence: 0, medianF0: 0 };

      const samples = new Float32Array(sampleCount);
      for (let index = 0; index < sampleCount; index += 1) {
        samples[index] = pcm.readInt16LE(index * 2) / 32768;
      }

      const frameSize = 1024;
      const hopSize = 512;
      const minLag = Math.floor(sampleRate / 360);
      const maxLag = Math.floor(sampleRate / 75);
      const f0Values: number[] = [];

      for (let start = 0; start + frameSize < samples.length; start += hopSize) {
        let energy = 0;
        for (let i = 0; i < frameSize; i += 1) {
          const sample = samples[start + i];
          energy += sample * sample;
        }
        const rms = Math.sqrt(energy / frameSize);
        if (rms < 0.012) continue;

        let bestLag = 0;
        let bestCorrelation = 0;
        for (let lag = minLag; lag <= maxLag; lag += 1) {
          let correlation = 0;
          let leftEnergy = 0;
          let rightEnergy = 0;
          const limit = frameSize - lag;
          for (let i = 0; i < limit; i += 1) {
            const left = samples[start + i];
            const right = samples[start + i + lag];
            correlation += left * right;
            leftEnergy += left * left;
            rightEnergy += right * right;
          }
          const normalizedCorrelation = correlation / Math.sqrt(Math.max(leftEnergy * rightEnergy, 1e-9));
          if (normalizedCorrelation > bestCorrelation) {
            bestCorrelation = normalizedCorrelation;
            bestLag = lag;
          }
        }

        if (bestLag > 0 && bestCorrelation >= 0.45) {
          const f0 = sampleRate / bestLag;
          if (f0 >= 75 && f0 <= 360) f0Values.push(f0);
        }
      }

      if (f0Values.length < 4) return { gender: 'unknown' as const, confidence: 0, medianF0: 0 };
      const sortedF0 = f0Values.sort((left, right) => left - right);
      const medianF0 = sortedF0[Math.floor(sortedF0.length / 2)];
      if (medianF0 >= 170) {
        return { gender: 'female' as const, confidence: Math.min(0.95, 0.62 + ((medianF0 - 170) / 120)), medianF0 };
      }
      if (medianF0 <= 150) {
        return { gender: 'male' as const, confidence: Math.min(0.95, 0.62 + ((150 - medianF0) / 90)), medianF0 };
      }
      return { gender: 'unknown' as const, confidence: 0.35, medianF0 };
    } catch (error) {
      console.warn('Acoustic gender estimation failed:', error);
      return { gender: 'unknown' as const, confidence: 0, medianF0: 0 };
    }
  };

  // --- Server-side AI gateway for the HTML5 client ---
  app.post('/api/ai/assistant/plan', asyncRoute(async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    const rawFile = req.body?.file;
    if (!prompt && !rawFile) {
      return res.status(400).json({ error: '请描述任务或上传一个文件。' });
    }
    if (prompt.length > 8000) {
      return res.status(400).json({ error: '任务描述过长，请精简后重试。' });
    }

    const file = rawFile && typeof rawFile === 'object'
      ? {
        name: normalizeIdentityText(rawFile.name, 240),
        type: normalizeIdentityText(rawFile.type, 120),
        size: Math.max(0, Math.min(Number(rawFile.size) || 0, MAX_UPLOAD_BYTES)),
      }
      : undefined;
    const rawMemory = req.body?.memory && typeof req.body.memory === 'object' ? req.body.memory : {};
    const memory = {
      preferredLanguage: normalizeIdentityText(rawMemory.preferredLanguage, 16) || undefined,
      preferredGender: normalizeIdentityText(rawMemory.preferredGender, 16) || undefined,
      preferredEmotion: normalizeIdentityText(rawMemory.preferredEmotion, 80) || undefined,
      preferredFormat: normalizeIdentityText(rawMemory.preferredFormat, 16) || undefined,
      recentTasks: Array.isArray(rawMemory.recentTasks)
        ? rawMemory.recentTasks.slice(0, 6).map((task: unknown) => normalizeIdentityText(task, 500)).filter(Boolean)
        : [],
    };
    const conversation = Array.isArray(req.body?.conversation)
      ? req.body.conversation.slice(-8).flatMap((message: unknown) => {
        if (!message || typeof message !== 'object') return [];
        const item = message as { role?: unknown; content?: unknown };
        const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : null;
        const content = normalizeIdentityText(item.content, 600);
        return role && content ? [{ role, content }] : [];
      })
      : [];
    const repairedLibrary = loadAndRepairLibraryMetadata();
    const librarySounds = fs.existsSync(soundsFile) ? repairedLibrary.sounds : INITIAL_SOUNDS;
    const libraryIndex = buildSfxLibraryIndex(repairedLibrary.categories, librarySounds);
    const cacheKey = JSON.stringify({
      prompt,
      file,
      memory,
      conversation,
      library: libraryIndex.entries.map(entry => [
        entry.id,
        entry.name,
        entry.category || '',
        entry.subcategory || '',
      ]),
    });
    const cached = assistantPlanCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json({ ...structuredClone(cached.response), cached: true });
    }
    if (cached) assistantPlanCache.delete(cacheKey);

    const result = await planAssistantTask({
      prompt,
      file,
      memory,
      conversation,
      libraryEntries: libraryIndex.entries,
    });
    if (result.plan.kind === 'library') {
      const query = typeof result.plan.librarySearchQuery === 'string'
        ? result.plan.librarySearchQuery.trim()
        : prompt;
      const matches = findSfxLibraryMatches(query, libraryIndex);
      const bestMatch = matches[0];
      result.plan.librarySearchQuery = query;
      result.plan.libraryMatchCount = matches.length;
      if (bestMatch) {
        result.plan.libraryCategory = bestMatch.category || bestMatch.name;
        result.plan.librarySubcategory = bestMatch.subcategory;
        delete result.plan.libraryFallbackKind;
        delete result.plan.libraryFallbackPrompt;
      }
    }
    if (assistantPlanCache.size >= ASSISTANT_PLAN_CACHE_MAX_ENTRIES) {
      const oldestKey = assistantPlanCache.keys().next().value;
      if (oldestKey) assistantPlanCache.delete(oldestKey);
    }
    assistantPlanCache.set(cacheKey, {
      expiresAt: Date.now() + ASSISTANT_PLAN_CACHE_TTL_MS,
      response: structuredClone(result),
    });
    return res.json(result);
  }));

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

  app.post('/api/ai/gemini/music-prompt', asyncRoute(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: '请先输入配乐风格与情感描述。' });
    if (text.length > 5000) return res.status(400).json({ error: '配乐描述过长，请精简后重试。' });
    const rewritten = await createEnglishMusicPromptForElevenLabs(text, {
      instrumental: req.body?.instrumental !== false,
    });
    return res.json({ text: rewritten });
  }));

  app.post('/api/ai/gemini/translate-language', asyncRoute(async (req, res) => {
    const text = await translateTextToLanguage(
      String(req.body?.text || ''),
      String(req.body?.targetLanguage || 'English'),
      {
        preserveTone: req.body?.preserveTone !== false,
        maxDurationSeconds: typeof req.body?.maxDurationSeconds === 'number'
          ? parseNumber(req.body.maxDurationSeconds, 0, 0.5, 60)
          : undefined,
      },
    );
    return res.json({ text });
  }));

  app.post('/api/ai/gemini/voice-v3-enhance', asyncRoute(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: '请先输入要增强的配音台词。' });
    if (text.length > 5000) return res.status(400).json({ error: '配音台词过长，请精简后再使用 V3 增强。' });
    const result = await enhanceVoicePromptForElevenV3(text, {
      voiceName: String(req.body?.voiceName || ''),
      voiceDescription: String(req.body?.voiceDescription || ''),
      language: String(req.body?.language || ''),
    });
    return res.json(result);
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
    const { audioUrl, voices, preferredGender } = req.body || {};
    const matchingKeywords = String(req.body?.matchingKeywords || '').trim().slice(0, 200);
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

    const fallbackGender = preferredGender === 'male' || preferredGender === 'female' ? preferredGender : 'unknown';
    let filePath = '';
    let mimeType = 'audio/wav';
    let acousticGender: Awaited<ReturnType<typeof estimateReferenceVoiceGender>> = { gender: 'unknown', confidence: 0, medianF0: 0 };
    let audioBase64 = '';
    try {
      const resolvedAudio = resolveUploadedAudioUrlPath(audioUrl);
      filePath = resolvedAudio.filePath;
      mimeType = resolvedAudio.mimeType;
      const referenceStat = await fs.promises.stat(filePath);
      console.info('[similar-voice-match] reference audio accepted', {
        fileName: path.basename(filePath),
        bytes: referenceStat.size,
        mimeType,
        preferredGender: preferredGender === 'male' || preferredGender === 'female' ? preferredGender : 'auto',
        hasMatchingKeywords: Boolean(matchingKeywords),
        candidateVoices: normalizedVoices.length,
      });
      acousticGender = await estimateReferenceVoiceGender(filePath);
      audioBase64 = await fs.promises.readFile(filePath, { encoding: 'base64' });
    } catch (inputError) {
      console.warn('Similar voice matching input/audio analysis failed; using metadata fallback:', inputError);
      const fallbackRecommendations = localVoiceMatchFallback(normalizedVoices, fallbackGender, matchingKeywords);
      return res.json({
        sourceDescription: '参考音频暂时无法完整解析，已先根据声音库标签和关键词给出保守推荐。',
        performancePrompt: '参考原始配音的语气、语速、停顿和情绪自然演绎。',
        gender: fallbackGender,
        recommendations: fallbackRecommendations,
      });
    }

    const stableDetectedGender = preferredGender === 'male' || preferredGender === 'female'
      ? preferredGender
      : acousticGender.confidence >= 0.6 && (acousticGender.gender === 'male' || acousticGender.gender === 'female')
        ? acousticGender.gender
        : 'unknown';
    if (process.env.ENABLE_GEMINI_VOICE_MATCH !== 'true') {
      const recommendations = localVoiceMatchFallback(normalizedVoices, stableDetectedGender, matchingKeywords);
      return res.json({
        sourceDescription: stableDetectedGender === 'unknown'
          ? '已根据参考音频和声音库标签给出相近声音推荐。'
          : `已根据参考音频的${stableDetectedGender === 'male' ? '男声' : '女声'}倾向、声音库标签和关键词给出相近声音推荐。`,
        performancePrompt: '参考原始配音的语气、语速、停顿和情绪自然演绎。',
        gender: stableDetectedGender,
        recommendations,
      });
    }

    const ai = getGoogleAI();
    const preferredGenderInstruction = preferredGender === 'male'
      ? '用户已指定参考音频为男声，请只推荐候选库中的 male 声音。'
      : preferredGender === 'female'
        ? '用户已指定参考音频为女声，请只推荐候选库中的 female 声音。'
        : acousticGender.gender === 'female' && acousticGender.confidence >= 0.6
          ? `系统基于参考音频基频估算为女声，置信度 ${Math.round(acousticGender.confidence * 100)}%，请优先按 female 推荐。`
          : acousticGender.gender === 'male' && acousticGender.confidence >= 0.6
            ? `系统基于参考音频基频估算为男声，置信度 ${Math.round(acousticGender.confidence * 100)}%，请优先按 male 推荐。`
            : '用户未手动指定参考性别，请根据音频自动判断。';
    const matchingKeywordsInstruction = matchingKeywords
      ? `用户补充匹配关键词：${matchingKeywords}
这些关键词表示希望匹配的角色气质、音色风格、年龄感、用途或表演方向。请在性别一致和参考音频相似的基础上优先考虑这些关键词；不要为了关键词忽略参考音频本身。`
      : '用户没有补充匹配关键词，请主要根据参考音频本身匹配。';
    const prompt = `
你是专业配音导演。请先聆听用户提供的人声音频，判断它的性别倾向、年龄感、音色、能量、语速、停顿、情绪、语气、口音/语言特征和适合的配音用途。
然后在给定 ElevenLabs 声音库中选择最相似、最适合替代该人声的 3-6 个声音。

重要约束：
${preferredGenderInstruction}
${matchingKeywordsInstruction}
- 只从候选声音库中选择，不要编造 voiceId。
- 如果音频中有人声不清晰，也要基于可听到的部分给出保守推荐。
- 性别一致是硬约束：如果参考音频明显是男声，只能推荐候选库里的 male 声音；如果明显是女声，只能推荐 female 声音；只有无法判断时才返回 unknown 并允许混合推荐。
- score 为 0-100，表示相似程度和可替代程度。
- reason 用中文，简短说明为什么推荐；如果使用了用户关键词，请说明与关键词的对应关系。
- performancePrompt 用中文写给 AI 配音合成使用，只描述这段台词的表演方式，不要重复台词正文；重点包含语气、情绪、语速、停顿、口吻和能量，不超过 120 个中文字符。

候选声音库 JSON：
${JSON.stringify(normalizedVoices)}

请只返回 JSON：
{
  "sourceDescription": "中文描述",
  "performancePrompt": "中文配音表演提示词",
  "gender": "male" | "female" | "unknown",
  "recommendations": [
    { "voiceId": "候选声音ID", "score": 88, "reason": "中文原因" }
  ]
}`;

    try {
      const response = await generateGeminiContent(ai, {
        model: GEMINI_PRIMARY_MODEL,
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
            required: ['sourceDescription', 'performancePrompt', 'gender', 'recommendations'],
            properties: {
              sourceDescription: { type: Type.STRING },
              performancePrompt: { type: Type.STRING },
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
      const forcedGender = preferredGender === 'male' || preferredGender === 'female' ? preferredGender : '';
      const acousticDetectedGender = acousticGender.confidence >= 0.6
        && (acousticGender.gender === 'male' || acousticGender.gender === 'female')
        ? acousticGender.gender
        : '';
      const aiDetectedGender = parsed.gender === 'male' || parsed.gender === 'female' ? parsed.gender : 'unknown';
      const detectedGender = forcedGender || acousticDetectedGender || aiDetectedGender;
      const validVoiceIds = new Set(normalizedVoices.map(voice => voice.id));
      const voiceById = new Map(normalizedVoices.map(voice => [voice.id, voice]));
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

      if (detectedGender !== 'unknown') {
        const genderMatchedRecommendations = recommendations.filter((item: any) => (
          voiceById.get(item.voiceId)?.gender === detectedGender
        ));
        const genderMatchedCandidateCount = normalizedVoices.filter(voice => voice.gender === detectedGender).length;
        if (genderMatchedRecommendations.length > 0) {
          recommendations = genderMatchedRecommendations.slice(0, 6);
        } else if (genderMatchedCandidateCount > 0) {
          recommendations = localVoiceMatchFallback(normalizedVoices, detectedGender, matchingKeywords);
        }
      }

      if (recommendations.length === 0) {
        recommendations = localVoiceMatchFallback(normalizedVoices, detectedGender, matchingKeywords);
      }

      console.info('[similar-voice-match] recommendations ready', {
        preferredGender: forcedGender || 'auto',
        acousticGender,
        aiGender: aiDetectedGender,
        finalGender: detectedGender,
        recommendations: recommendations.map((item: any) => ({
          voiceId: item.voiceId,
          score: item.score,
          gender: voiceById.get(item.voiceId)?.gender || 'unknown',
        })),
      });

      return res.json({
        sourceDescription: String(parsed.sourceDescription || '已根据拆分人声音频提取音色特征。').slice(0, 300),
        performancePrompt: String(parsed.performancePrompt || parsed.sourceDescription || '匹配当前选中音频片段的原始语气、语速、停顿和情绪。').slice(0, 180),
        gender: detectedGender,
        recommendations,
      });
    } catch (error) {
      console.warn('Gemini similar voice matching failed; using local metadata fallback:', error);
      const fallbackGender = preferredGender === 'male' || preferredGender === 'female' ? preferredGender : 'unknown';
      const fallbackRecommendations = localVoiceMatchFallback(normalizedVoices, fallbackGender, matchingKeywords);
      console.info('[similar-voice-match] fallback recommendations ready', {
        preferredGender: fallbackGender,
        recommendations: fallbackRecommendations.map((item: any) => ({
          voiceId: item.voiceId,
          score: item.score,
          gender: normalizedVoices.find(voice => voice.id === item.voiceId)?.gender || 'unknown',
        })),
      });
      return res.json({
        sourceDescription: 'AI听辨暂时不可用，已根据声音库标签给出保守推荐。',
        performancePrompt: '参考当前选中音频片段的原始语气、语速、停顿和情绪自然演绎。',
        gender: fallbackGender,
        recommendations: fallbackRecommendations,
      });
    }
  }));

  app.post('/api/video/extract-audio-clip', asyncRoute(async (req, res) => {
    const { audioUrl } = req.body || {};
    const { filePath } = resolveUploadedMediaUrlPath(audioUrl);
    const sourceOffset = parseNumber(req.body?.sourceOffset, 0, 0, 3_600);
    const duration = parseNumber(req.body?.duration, 1, 0.05, 600);
    const speed = parseNumber(req.body?.speed, 1, 0.25, 4);
    const readDuration = Number(Math.max(0.05, duration * speed).toFixed(3));
    const outputFileName = `clip_extract_${randomUUID()}.wav`;
    const outputPath = path.resolve(uploadsDir, outputFileName);
    if (!isPathInside(uploadsDir, outputPath)) {
      throw Object.assign(new Error('片段输出路径无效。'), { status: 500 });
    }

    await new Promise<void>((resolve, reject) => {
      const args = [
        '-y',
        '-ss', String(Number(sourceOffset.toFixed(3))),
        '-t', String(readDuration),
        '-i', filePath,
        '-vn',
        '-ac', '1',
        '-ar', '44100',
        '-c:a', 'pcm_s16le',
        outputPath,
      ];
      execFile(FFMPEG_BINARY, args, (error, _stdout, stderr) => {
        if (error) {
          try { fs.unlinkSync(outputPath); } catch {}
          const ffmpegUnavailable = /ffmpeg.*(?:not recognized|not found)|ENOENT/i.test(`${error.message}\n${stderr}`);
          reject(Object.assign(
            new Error(ffmpegUnavailable
              ? '本地 FFmpeg 不可用，无法抽取选中音频片段。'
              : `抽取选中音频片段失败：${String(stderr || error.message).trim().split(/\r?\n/).slice(-1)[0] || error.message}`),
            { status: ffmpegUnavailable ? 503 : 422 },
          ));
          return;
        }
        resolve();
      });
    });

    const extractedDuration = await getMediaDurationSeconds(outputPath).catch(() => readDuration);
    return res.json({
      audioUrl: `/uploads/${outputFileName}`,
      sourceOffset,
      requestedDuration: duration,
      extractedDuration,
    });
  }));

  app.post('/api/video/preview-compatible', asyncRoute(async (req, res) => {
    const { videoFileName } = req.body || {};
    if (typeof videoFileName !== 'string' || !videoFileName) {
      return res.status(400).json({ error: 'videoFileName is required' });
    }

    const preview = await ensureBrowserCompatiblePreview(videoFileName);
    return res.json(preview);
  }));

  app.post('/api/ai/elevenlabs/sound-effect', asyncRoute(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    const rawDuration = req.body?.duration;
    const duration = rawDuration === undefined || rawDuration === null || rawDuration === ''
      ? undefined
      : parseNumber(rawDuration, 10, 0.5, 30);
    const qualityMode = normalizeElevenLabsQualityMode(req.body?.qualityMode);
    const englishText = /[^\x00-\x7F]/.test(text)
      ? await translateToEnglish(text)
      : text;
    return sendAudioBlob(res, await generateSoundEffect(englishText || text, duration, { qualityMode }));
  }));

  app.post('/api/ai/elevenlabs/music', asyncRoute(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    const qualityMode = normalizeElevenLabsQualityMode(req.body?.qualityMode);
    const duration = parseNumber(req.body?.duration, 30, 1, 60);
    return sendAudioBlob(res, await generateMusic(
      text,
      duration,
      req.body?.isInstrumental !== false,
      typeof req.body?.lyrics === 'string' ? req.body.lyrics : undefined,
      { qualityMode },
    ));
  }));

  const localVoiceCloneLanguages: Record<string, string> = {
    ar: 'Arabic',
    da: 'Danish',
    de: 'German',
    el: 'Greek',
    en: 'English',
    es: 'Spanish',
    fi: 'Finnish',
    fr: 'French',
    he: 'Hebrew',
    hi: 'Hindi',
    it: 'Italian',
    ja: 'Japanese',
    ko: 'Korean',
    ms: 'Malay',
    nl: 'Dutch',
    no: 'Norwegian',
    pl: 'Polish',
    pt: 'Portuguese',
    ru: 'Russian',
    sv: 'Swedish',
    sw: 'Swahili',
    tr: 'Turkish',
    zh: 'Chinese',
  };
  const cosyVoiceLanguages: Record<string, string> = {
    de: 'German',
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    it: 'Italian',
    ja: 'Japanese',
    ko: 'Korean',
    ru: 'Russian',
    zh: 'Chinese',
  };
  type LocalVoiceCloneEngine = 'chatterbox' | 'cosyvoice3';
  const resolveLocalToolPath = (configuredPath: string | undefined, fallback: string) => (
    path.resolve(process.cwd(), configuredPath?.trim() || fallback)
  );
  const localVoiceClonePython = resolveLocalToolPath(
    process.env.LOCAL_VOICE_CLONE_PYTHON,
    path.join('tools', 'python311', process.platform === 'win32' ? 'python.exe' : 'python'),
  );
  const localVoiceCloneScript = resolveLocalToolPath(
    process.env.LOCAL_VOICE_CLONE_SCRIPT,
    path.join('tools', 'local-voice-clone', 'clone_voice.py'),
  );
  const localVoiceCloneModelsDir = path.join(path.dirname(localVoiceCloneScript), 'models');
  const cosyVoicePython = resolveLocalToolPath(
    process.env.COSYVOICE_PYTHON,
    path.join('tools', 'python310', process.platform === 'win32' ? 'python.exe' : 'python'),
  );
  const cosyVoiceScript = resolveLocalToolPath(
    process.env.COSYVOICE_SCRIPT,
    path.join('tools', 'cosyvoice', 'clone_voice.py'),
  );
  const cosyVoiceRepoDir = resolveLocalToolPath(
    process.env.COSYVOICE_REPO_DIR,
    path.join('tools', 'cosyvoice', 'repo'),
  );
  const cosyVoiceModelDir = resolveLocalToolPath(
    process.env.COSYVOICE_MODEL_DIR,
    path.join('tools', 'cosyvoice', 'models', 'Fun-CosyVoice3-0.5B'),
  );
  const seedVcPython = resolveLocalToolPath(
    process.env.SEED_VC_PYTHON,
    path.join('tools', 'seed-vc', '.venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'])),
  );
  const seedVcScript = resolveLocalToolPath(
    process.env.SEED_VC_SCRIPT,
    path.join('tools', 'seed-vc', 'voice_convert.py'),
  );
  const seedVcRepoDir = resolveLocalToolPath(
    process.env.SEED_VC_REPO_DIR,
    path.join('tools', 'seed-vc', 'repo'),
  );
  const seedVcModelsDir = resolveLocalToolPath(
    process.env.SEED_VC_MODELS_DIR,
    path.join('tools', 'seed-vc', 'repo', 'checkpoints'),
  );
  const seamlessExpressivePython = resolveLocalToolPath(
    process.env.SEAMLESS_EXPRESSIVE_PYTHON,
    path.join('tools', 'seamless-expressive', '.venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'])),
  );
  const seamlessExpressiveScript = resolveLocalToolPath(
    process.env.SEAMLESS_EXPRESSIVE_SCRIPT,
    path.join('tools', 'seamless-expressive', 'translate.py'),
  );
  const seamlessExpressiveRepoDir = resolveLocalToolPath(
    process.env.SEAMLESS_EXPRESSIVE_REPO_DIR,
    path.join('tools', 'seamless-expressive', 'repo'),
  );
  const seamlessExpressiveModelDir = resolveLocalToolPath(
    process.env.SEAMLESS_EXPRESSIVE_MODEL_DIR,
    path.join('tools', 'seamless-expressive', 'models'),
  );
  const seamlessExpressiveLanguages = [
    { code: 'eng', label: '英语', experimental: false, recommendedDurationFactor: 1 },
    { code: 'spa', label: '西班牙语', experimental: false, recommendedDurationFactor: 1 },
    { code: 'fra', label: '法语', experimental: false, recommendedDurationFactor: 1.2 },
    { code: 'deu', label: '德语', experimental: false, recommendedDurationFactor: 1.1 },
    { code: 'cmn', label: '中文', experimental: true, recommendedDurationFactor: 1 },
    { code: 'ita', label: '意大利语', experimental: true, recommendedDurationFactor: 1 },
  ] as const;
  type LocalVoiceCloneEngineStatus = {
    available: boolean;
    model: string;
    gpu?: string;
    modelCached: boolean;
    supportedLanguages: Record<string, string>;
    reason?: string;
  };
  type LocalVoiceCloneServerStatus = {
    defaultEngine: LocalVoiceCloneEngine;
    engines: Record<LocalVoiceCloneEngine, LocalVoiceCloneEngineStatus>;
  };
  let localVoiceCloneQueue: Promise<void> = Promise.resolve();
  let localVoiceCloneStatusCache: { expiresAt: number; value: LocalVoiceCloneServerStatus } | null = null;
  let seamlessExpressiveQueue: Promise<void> = Promise.resolve();

  const runLocalVoiceCloneQueued = async <T,>(task: () => Promise<T>): Promise<T> => {
    const run = localVoiceCloneQueue.catch(() => undefined).then(task);
    localVoiceCloneQueue = run.then(() => undefined, () => undefined);
    return run;
  };

  const runSeamlessExpressiveQueued = async <T,>(task: () => Promise<T>): Promise<T> => {
    const run = seamlessExpressiveQueue.catch(() => undefined).then(task);
    seamlessExpressiveQueue = run.then(() => undefined, () => undefined);
    return run;
  };

  const runSeamlessExpressiveProcess = (args: string[], timeout: number) => new Promise<string>((resolve, reject) => {
    execFile(
      seamlessExpressivePython,
      args,
      {
        cwd: process.cwd(),
        timeout,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(String(stdout || ''));
          return;
        }
        const detail = String(stderr || stdout || error.message).trim().split(/\r?\n/).slice(-8).join(' ');
        const message = /out of memory|CUDA.*memory/i.test(detail)
          ? 'SeamlessExpressive 显存不足。请缩短素材，并关闭其他占用显卡的程序后重试。'
          : /ENOENT|not found|cannot find|No such file/i.test(`${error.message} ${detail}`)
            ? 'SeamlessExpressive 运行环境或受限模型文件不完整。'
            : `SeamlessExpressive 转换失败：${detail || error.message}`;
        reject(Object.assign(new Error(message), { status: 503, cause: error }));
      },
    );
  });

  const runLocalVoiceCloneProcess = (pythonPath: string, args: string[], timeout: number) => new Promise<string>((resolve, reject) => {
    execFile(
      pythonPath,
      args,
      {
        cwd: process.cwd(),
        timeout,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const detail = String(stderr || stdout || error.message).trim().split(/\r?\n/).slice(-3).join(' ');
        const message = /out of memory|CUDA.*memory/i.test(detail)
          ? '本地显存不足，请缩短目标台词或关闭其他占用显卡的程序后重试。'
          : /ENOENT|not found|cannot find/i.test(`${error.message} ${detail}`)
            ? '本地声音克隆运行环境不完整，请检查 Python 和模型工具路径。'
            : `本地声音克隆失败：${detail || error.message}`;
        reject(Object.assign(new Error(message), { status: 503, cause: error }));
      },
    );
  });

  const readLocalVoiceCloneEngineStatus = async (
    engine: LocalVoiceCloneEngine,
  ): Promise<LocalVoiceCloneEngineStatus> => {
    const isCosyVoice = engine === 'cosyvoice3';
    const pythonPath = isCosyVoice ? cosyVoicePython : localVoiceClonePython;
    const scriptPath = isCosyVoice ? cosyVoiceScript : localVoiceCloneScript;
    const languages = isCosyVoice ? cosyVoiceLanguages : localVoiceCloneLanguages;
    const model = isCosyVoice ? 'Fun-CosyVoice3 0.5B' : 'Chatterbox Multilingual V3';
    const cosyVoiceRequiredFiles = [
      'cosyvoice3.yaml',
      'llm.pt',
      'flow.pt',
      'hift.pt',
      'campplus.onnx',
      'speech_tokenizer_v3.onnx',
      path.join('CosyVoice-BlankEN', 'model.safetensors'),
    ];
    const modelCached = isCosyVoice
      ? cosyVoiceRequiredFiles.every(fileName => fs.existsSync(path.join(cosyVoiceModelDir, fileName)))
      : fs.existsSync(localVoiceCloneModelsDir)
        && fs.readdirSync(localVoiceCloneModelsDir, { withFileTypes: true }).length > 0;
    const baseStatus = { model, modelCached, supportedLanguages: languages };
    if (!fs.existsSync(pythonPath) || !fs.existsSync(scriptPath)) {
      return {
        ...baseStatus,
        available: false,
        reason: `本地 Python 运行时或 ${model} 脚本不存在。`,
      };
    }
    if (isCosyVoice && (!fs.existsSync(cosyVoiceRepoDir) || !modelCached)) {
      return {
        ...baseStatus,
        available: false,
        reason: modelCached ? 'CosyVoice 官方代码目录不存在。' : 'CosyVoice 3 模型尚未下载完成。',
      };
    }
    try {
      const runtimeProbe = isCosyVoice
        ? [
          'import json, sys, torch',
          `sys.path.insert(0, ${JSON.stringify(cosyVoiceRepoDir)})`,
          `sys.path.insert(0, ${JSON.stringify(path.join(cosyVoiceRepoDir, 'third_party', 'Matcha-TTS'))})`,
          'from cosyvoice.cli.cosyvoice import AutoModel',
          'print(json.dumps({"cuda": torch.cuda.is_available(), "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))',
        ].join('; ')
        : 'import json, torch; print(json.dumps({"cuda": torch.cuda.is_available(), "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))';
      const stdout = await runLocalVoiceCloneProcess(pythonPath, [
        '-c',
        runtimeProbe,
      ], 30_000);
      const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}';
      const runtime = JSON.parse(lastLine) as { cuda?: boolean; gpu?: string };
      return {
        ...baseStatus,
        available: runtime.cuda === true,
        gpu: runtime.gpu,
        ...(runtime.cuda ? {} : { reason: '没有检测到可用的 NVIDIA CUDA 显卡。' }),
      };
    } catch (error: any) {
      return {
        ...baseStatus,
        available: false,
        reason: error?.message || `无法启动 ${model} 运行环境。`,
      };
    }
  };

  const readLocalVoiceCloneStatus = async (): Promise<LocalVoiceCloneServerStatus> => {
    if (localVoiceCloneStatusCache && localVoiceCloneStatusCache.expiresAt > Date.now()) {
      return localVoiceCloneStatusCache.value;
    }
    const [chatterbox, cosyvoice3] = await Promise.all([
      readLocalVoiceCloneEngineStatus('chatterbox'),
      readLocalVoiceCloneEngineStatus('cosyvoice3'),
    ]);
    const value: LocalVoiceCloneServerStatus = {
      defaultEngine: 'chatterbox',
      engines: { chatterbox, cosyvoice3 },
    };
    localVoiceCloneStatusCache = { expiresAt: Date.now() + 30_000, value };
    return value;
  };

  app.get('/api/ai/local/voice-clone/status', asyncRoute(async (_req, res) => {
    return res.json(await readLocalVoiceCloneStatus());
  }));

  type SeamlessExpressiveStatus = {
    available: boolean;
    model: 'SeamlessExpressive';
    platform: string;
    runtimeSupported: boolean;
    pythonFound: boolean;
    repoFound: boolean;
    scriptFound: boolean;
    modelFilesFound: boolean;
    gpu?: string;
    supportedLanguages: typeof seamlessExpressiveLanguages;
    license: string;
    gated: true;
    reason?: string;
  };
  let seamlessExpressiveStatusCache: { expiresAt: number; value: SeamlessExpressiveStatus } | null = null;

  const readSeamlessExpressiveStatus = async (): Promise<SeamlessExpressiveStatus> => {
    if (seamlessExpressiveStatusCache && seamlessExpressiveStatusCache.expiresAt > Date.now()) {
      return seamlessExpressiveStatusCache.value;
    }
    const platform = `${process.platform}-${process.arch}`;
    const runtimeSupported = (process.platform === 'linux' && process.arch === 'x64')
      || (process.platform === 'darwin' && process.arch === 'arm64');
    const pythonFound = fs.existsSync(seamlessExpressivePython);
    const scriptFound = fs.existsSync(seamlessExpressiveScript);
    const repoFound = fs.existsSync(path.join(
      seamlessExpressiveRepoDir,
      'src',
      'seamless_communication',
      'cli',
      'expressivity',
      'predict',
      'predict.py',
    ));
    const modelFilesFound = [
      'm2m_expressive_unity.pt',
      'pretssel_melhifigan_wm.pt',
    ].every(fileName => fs.existsSync(path.join(seamlessExpressiveModelDir, fileName)));
    const baseStatus = {
      model: 'SeamlessExpressive' as const,
      platform,
      runtimeSupported,
      pythonFound,
      repoFound,
      scriptFound,
      modelFilesFound,
      supportedLanguages: seamlessExpressiveLanguages,
      license: 'Seamless License - noncommercial research only',
      gated: true as const,
    };

    let value: SeamlessExpressiveStatus;
    if (!runtimeSupported) {
      value = {
        ...baseStatus,
        available: false,
        reason: '官方 fairseq2 不支持原生 Windows。请安装 WSL 2 Linux，并在 WSL 内运行本项目。',
      };
    } else if (!pythonFound || !scriptFound || !repoFound) {
      value = {
        ...baseStatus,
        available: false,
        reason: !pythonFound
          ? 'SeamlessExpressive Python 环境尚未安装。'
          : !repoFound
            ? 'Seamless Communication 官方代码目录不完整。'
            : 'SeamlessExpressive 适配脚本不存在。',
      };
    } else if (!modelFilesFound) {
      value = {
        ...baseStatus,
        available: false,
        reason: '受限模型权重尚未就绪。请先取得 Meta 与 Hugging Face 授权，再放入 models 目录。',
      };
    } else {
      try {
        const probeArgs = ['-c', 'import json, torch, fairseq2; print(json.dumps({"cuda": torch.cuda.is_available(), "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))'];
        const { stdout } = await runExternalFile(
          seamlessExpressivePython,
          probeArgs,
          30_000,
          'SeamlessExpressive runtime probe',
        );
        const runtime = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}') as { cuda?: boolean; gpu?: string };
        value = {
          ...baseStatus,
          available: runtime.cuda === true,
          gpu: runtime.gpu,
          ...(runtime.cuda ? {} : { reason: '未检测到可用的 NVIDIA CUDA 显卡；该大型模型不启用 CPU 推理。' }),
        };
      } catch (error: any) {
        value = {
          ...baseStatus,
          available: false,
          reason: error?.message || '无法启动 SeamlessExpressive Python 环境。',
        };
      }
    }

    seamlessExpressiveStatusCache = { expiresAt: Date.now() + 30_000, value };
    return value;
  };

  app.get('/api/ai/local/seamless-expressive/status', asyncRoute(async (_req, res) => {
    return res.json(await readSeamlessExpressiveStatus());
  }));

  app.post('/api/ai/local/seamless-expressive/convert', aiUpload.single('source'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请上传需要翻译的视频或音频。' });
    const targetLanguage = String(req.body?.targetLanguage || '').trim().toLowerCase();
    if (!seamlessExpressiveLanguages.some(language => language.code === targetLanguage)) {
      return res.status(400).json({ error: 'SeamlessExpressive 不支持这个目标语言。' });
    }
    const status = await readSeamlessExpressiveStatus();
    if (!status.available) return res.status(503).json({ error: status.reason || 'SeamlessExpressive 本地环境不可用。' });

    const durationFactor = parseNumber(req.body?.durationFactor, 1, 0.8, 1.35);
    const jobId = randomUUID();
    const sourceExtension = getSafeUploadExtension(req.file.originalname, req.file.mimetype, '.wav');
    const sourcePath = path.resolve(uploadsDir, `seamless_expressive_source_${jobId}${sourceExtension}`);
    const sourceWavPath = path.resolve(uploadsDir, `seamless_expressive_source_${jobId}.wav`);
    const outputFileName = `seamless_expressive_${targetLanguage}_${jobId}.wav`;
    const outputPath = path.resolve(uploadsDir, outputFileName);
    if (![sourcePath, sourceWavPath, outputPath].every(filePath => isPathInside(uploadsDir, filePath))) {
      throw Object.assign(new Error('SeamlessExpressive 文件路径无效。'), { status: 500 });
    }

    fs.writeFileSync(sourcePath, req.file.buffer);
    let keepOutput = false;
    try {
      await runFfmpegFile([
        '-y',
        '-i', sourcePath,
        '-map', '0:a:0',
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'pcm_s16le',
        sourceWavPath,
      ], 120_000);
      const sourceDuration = await getMediaDurationSeconds(sourceWavPath).catch(() => 0);
      if (sourceDuration > 300) {
        return res.status(422).json({ error: '单次素材不能超过 5 分钟。请先拆成较短的语音段，以避免显存不足和翻译遗漏。' });
      }
      const stdout = await runSeamlessExpressiveQueued(() => runSeamlessExpressiveProcess([
        seamlessExpressiveScript,
        '--input', sourceWavPath,
        '--output', outputPath,
        '--target-language', targetLanguage,
        '--duration-factor', String(durationFactor),
        '--repo-dir', seamlessExpressiveRepoDir,
        '--model-dir', seamlessExpressiveModelDir,
      ], 30 * 60 * 1000));
      const metadata = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}') as {
        model?: string;
        gpu?: string;
        duration_seconds?: number;
        translated_text?: string;
      };
      if (!fs.existsSync(outputPath)) {
        throw Object.assign(new Error('SeamlessExpressive 未生成可用的输出音频。'), { status: 502 });
      }
      keepOutput = true;
      return res.json({
        audioUrl: `/uploads/${outputFileName}`,
        sourceDuration: sourceDuration || undefined,
        generatedDuration: metadata.duration_seconds || await getMediaDurationSeconds(outputPath).catch(() => undefined),
        targetLanguage,
        translatedText: metadata.translated_text || undefined,
        durationFactor,
        model: metadata.model || 'SeamlessExpressive',
        gpu: metadata.gpu || status.gpu,
      });
    } finally {
      await Promise.all([
        safeUnlink(sourcePath),
        safeUnlink(sourceWavPath),
        keepOutput ? Promise.resolve() : safeUnlink(outputPath),
      ]);
    }
  }));

  const readSeedVcStatus = async (): Promise<{
    available: boolean;
    model: string;
    pythonFound: boolean;
    scriptFound: boolean;
    modelCached: boolean;
    gpu?: string;
    reason?: string;
  }> => {
    const pythonFound = fs.existsSync(seedVcPython);
    const scriptFound = fs.existsSync(seedVcScript);
    const repoFound = fs.existsSync(path.join(seedVcRepoDir, 'inference_v2.py'))
      || fs.existsSync(path.join(seedVcRepoDir, 'inference.py'));
    const modelCached = fs.existsSync(seedVcModelsDir)
      && fs.readdirSync(seedVcModelsDir, { recursive: true }).length > 0;
    if (!pythonFound || !scriptFound || !repoFound) {
      return {
        available: false,
        model: 'Seed-VC V2',
        pythonFound,
        scriptFound,
        modelCached,
        reason: !repoFound ? 'Seed-VC 官方仓库尚未配置到 tools/seed-vc/repo。' : 'Seed-VC 本地 Python 运行时或适配脚本尚未配置。',
      };
    }
    if (!modelCached) {
      return {
        available: false,
        model: 'Seed-VC V2',
        pythonFound,
        scriptFound,
        modelCached,
        reason: 'Seed-VC 模型权重尚未下载完成。',
      };
    }
    try {
      const stdout = await runLocalVoiceCloneProcess(seedVcPython, [
        '-c',
        'import json, torch; print(json.dumps({"cuda": torch.cuda.is_available(), "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))',
      ], 30_000);
      const runtime = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}') as { cuda?: boolean; gpu?: string };
      return {
        available: runtime.cuda === true,
        model: 'Seed-VC V2',
        pythonFound,
        scriptFound,
        modelCached,
        gpu: runtime.gpu,
        ...(runtime.cuda ? {} : { reason: '未检测到可用的 NVIDIA CUDA 显卡。' }),
      };
    } catch (error: any) {
      return {
        available: false,
        model: 'Seed-VC V2',
        pythonFound,
        scriptFound,
        modelCached,
        reason: error?.message || '无法启动 Seed-VC 运行环境。',
      };
    }
  };

  type SeedVcStatusValue = Awaited<ReturnType<typeof readSeedVcStatus>>;
  let seedVcStatusCache: { expiresAt: number; value: SeedVcStatusValue } | null = null;
  let seedVcStatusProbe: Promise<SeedVcStatusValue> | null = null;

  app.get('/api/ai/local/seed-vc/status', asyncRoute(async (_req, res) => {
    if (seedVcStatusCache && seedVcStatusCache.expiresAt > Date.now()) {
      return res.json(seedVcStatusCache.value);
    }
    if (!seedVcStatusProbe) {
      seedVcStatusProbe = readSeedVcStatus().then((value) => {
        seedVcStatusCache = { expiresAt: Date.now() + 60_000, value };
        return value;
      }).finally(() => {
        seedVcStatusProbe = null;
      });
    }
    return res.json(await seedVcStatusProbe);
  }));

  app.post('/api/ai/local/seed-vc/convert', aiUpload.fields([
    { name: 'source', maxCount: 1 },
    { name: 'reference', maxCount: 1 },
    { name: 'timelineSource', maxCount: 1 },
  ]), asyncRoute(async (req, res) => {
    const uploaded = (req.files || {}) as Record<string, Express.Multer.File[]>;
    const sourceFile = uploaded.source?.[0];
    const referenceFile = uploaded.reference?.[0];
    const timelineSourceFile = uploaded.timelineSource?.[0];
    if (!sourceFile || !referenceFile) return res.status(400).json({ error: '请同时上传内容语音和原始参考音。' });
    const status = seedVcStatusCache && seedVcStatusCache.expiresAt > Date.now()
      ? seedVcStatusCache.value
      : await (seedVcStatusProbe || (seedVcStatusProbe = readSeedVcStatus().then((value) => {
        seedVcStatusCache = { expiresAt: Date.now() + 60_000, value };
        return value;
      }).finally(() => {
        seedVcStatusProbe = null;
      })));
    if (!status.available) return res.status(503).json({ error: status.reason || 'Seed-VC 本地运行环境不可用。' });

    const jobId = randomUUID();
    const sourceExt = getSafeUploadExtension(sourceFile.originalname, sourceFile.mimetype, '.wav');
    const referenceExt = getSafeUploadExtension(referenceFile.originalname, referenceFile.mimetype, '.wav');
    const timelineSourceExt = timelineSourceFile
      ? getSafeUploadExtension(timelineSourceFile.originalname, timelineSourceFile.mimetype, '.wav')
      : '.wav';
    const sourcePath = path.resolve(uploadsDir, `seed_vc_source_${jobId}${sourceExt}`);
    const referencePath = path.resolve(uploadsDir, `seed_vc_reference_${jobId}${referenceExt}`);
    const timelineSourcePath = path.resolve(uploadsDir, `seed_vc_timeline_source_${jobId}${timelineSourceExt}`);
    const sourceWavPath = path.resolve(uploadsDir, `seed_vc_source_${jobId}.wav`);
    const referenceWavPath = path.resolve(uploadsDir, `seed_vc_reference_${jobId}.wav`);
    const timelineSourceWavPath = path.resolve(uploadsDir, `seed_vc_timeline_source_${jobId}.wav`);
    const rawOutputPath = path.resolve(uploadsDir, `seed_vc_raw_${jobId}.wav`);
    const outputFileName = `seed_vc_converted_${jobId}.wav`;
    const outputPath = path.resolve(uploadsDir, outputFileName);
    if (![sourcePath, referencePath, timelineSourcePath, sourceWavPath, referenceWavPath, timelineSourceWavPath, rawOutputPath, outputPath].every(filePath => isPathInside(uploadsDir, filePath))) {
      throw Object.assign(new Error('Seed-VC 文件路径无效。'), { status: 500 });
    }
    fs.writeFileSync(sourcePath, sourceFile.buffer);
    fs.writeFileSync(referencePath, referenceFile.buffer);
    if (timelineSourceFile) fs.writeFileSync(timelineSourcePath, timelineSourceFile.buffer);
    let keepOutput = false;
    try {
      const conversionInputs = [
        runFfmpegFile(['-y', '-i', sourcePath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', sourceWavPath], 120_000),
        runFfmpegFile(['-y', '-i', referencePath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', referenceWavPath], 120_000),
      ];
      if (timelineSourceFile) {
        conversionInputs.push(runFfmpegFile(['-y', '-i', timelineSourcePath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', timelineSourceWavPath], 120_000));
      }
      await Promise.all(conversionInputs);
      const sourceDuration = await getMediaDurationSeconds(sourceWavPath).catch(() => 0);
      const targetDuration = parseNumber(req.body?.targetDuration, sourceDuration, 0.5, 24 * 60 * 60);
      const model = String(req.body?.model || 'v2').toLowerCase() === 'v1' ? 'v1' : 'v2';
      const processArgs = [
        seedVcScript,
        '--source', sourceWavPath,
        '--target', referenceWavPath,
        '--output', rawOutputPath,
        '--repo-dir', seedVcRepoDir,
        '--model', model,
        '--diffusion-steps', String(parseNumber(req.body?.diffusionSteps, 12, 8, 80)),
        '--length-adjust', String(parseNumber(req.body?.lengthAdjust, 1, 0.5, 1.5)),
        '--intelligibility-cfg-rate', String(parseNumber(req.body?.intelligibilityCfgRate, 0.7, 0, 1)),
        '--similarity-cfg-rate', String(parseNumber(req.body?.similarityCfgRate, 0.7, 0, 1)),
        '--temperature', String(parseNumber(req.body?.temperature, 0.7, 0.05, 2)),
        '--top-p', String(parseNumber(req.body?.topP, 0.9, 0.05, 1)),
        '--repetition-penalty', String(parseNumber(req.body?.repetitionPenalty, 1.1, 0.5, 2)),
      ];
      if (String(req.body?.convertStyle).toLowerCase() === 'true') processArgs.push('--convert-style');
      const stdout = await runLocalVoiceCloneQueued(() => runLocalVoiceCloneProcess(seedVcPython, processArgs, 15 * 60 * 1000));
      const metadata = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}') as { duration_seconds?: number; model?: string; gpu?: string };
      if (!fs.existsSync(rawOutputPath)) throw Object.assign(new Error('Seed-VC 未生成可用的输出音频。'), { status: 502 });

      const supportedEvents = new Set(['laughter', 'breath', 'quick_breath', 'cough', 'sigh', 'noise', 'mn']);
      let requestedEvents: Array<{ start: number; end: number; type: string }> = [];
      try {
        const parsed = JSON.parse(String(req.body?.events || '[]'));
        if (Array.isArray(parsed)) {
          requestedEvents = parsed
            .filter(event => supportedEvents.has(String(event?.type || '')))
            .map(event => ({
              start: Number(event.start),
              end: Number(event.end),
              type: String(event.type),
            }))
            .filter(event => Number.isFinite(event.start) && Number.isFinite(event.end) && event.end > event.start)
            .slice(0, 80);
        }
      } catch {
        requestedEvents = [];
      }
      const preservedEvents = timelineSourceFile
        ? requestedEvents.filter(event => event.start < targetDuration && event.end > 0)
        : [];
      const finalInputArgs = ['-y', '-i', rawOutputPath] as string[];
      const filterParts = [
        `[0:a]apad=whole_dur=${targetDuration.toFixed(3)},atrim=duration=${targetDuration.toFixed(3)},asetpts=PTS-STARTPTS[base]`,
      ];
      if (preservedEvents.length > 0) {
        finalInputArgs.push('-i', timelineSourceWavPath);
        const eventLabels: string[] = [];
        preservedEvents.forEach((event, index) => {
          // Audio-event timestamps are often conservative. Keep a natural tail
          // for laughter so the last syllable/chuckle is not cut off abruptly.
          const extension = event.type === 'laughter' ? 0.58 : 0.12;
          const start = Math.max(0, event.start - (event.type === 'laughter' ? 0.06 : 0.025));
          const end = Math.min(targetDuration, event.end + extension);
          const duration = Math.max(0.05, end - start);
          const fadeOutStart = Math.max(0.01, duration - (event.type === 'laughter' ? 0.28 : 0.08));
          const label = `event${index}`;
          filterParts.push(`[1:a]atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.025,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${(duration - fadeOutStart).toFixed(3)},adelay=${Math.round(start * 1000)}:all=1,volume=${event.type === 'laughter' ? '0.82' : '0.78'}[${label}]`);
          eventLabels.push(`[${label}]`);
        });
        filterParts.push(`[base]${eventLabels.join('')}amix=inputs=${eventLabels.length + 1}:duration=longest:normalize=0:dropout_transition=0,alimiter=limit=0.95,apad=whole_dur=${targetDuration.toFixed(3)},atrim=duration=${targetDuration.toFixed(3)}[out]`);
      } else {
        filterParts.push('[base]anull[out]');
      }
      finalInputArgs.push('-filter_complex', filterParts.join(';'), '-map', '[out]', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', outputPath);
      await runFfmpegFile(finalInputArgs, 120_000);
      if (!fs.existsSync(outputPath)) throw Object.assign(new Error('Seed-VC 时间线输出失败。'), { status: 502 });
      keepOutput = true;
      return res.json({
        audioUrl: `/uploads/${outputFileName}`,
        sourceDuration: sourceDuration || undefined,
        generatedDuration: await getMediaDurationSeconds(outputPath).catch(() => targetDuration),
        rawGeneratedDuration: metadata.duration_seconds || await getMediaDurationSeconds(rawOutputPath).catch(() => undefined),
        model: metadata.model || `Seed-VC ${model.toUpperCase()}`,
        gpu: metadata.gpu || status.gpu,
        timingMode: 'timeline',
        preservedEventCount: preservedEvents.length,
        timelineAligned: Math.abs((await getMediaDurationSeconds(outputPath).catch(() => targetDuration)) - targetDuration) < 0.08,
      });
    } finally {
      await Promise.all([
        safeUnlink(sourcePath),
        safeUnlink(referencePath),
        safeUnlink(timelineSourcePath),
        safeUnlink(sourceWavPath),
        safeUnlink(referenceWavPath),
        safeUnlink(timelineSourceWavPath),
        safeUnlink(rawOutputPath),
        keepOutput ? Promise.resolve() : safeUnlink(outputPath),
      ]);
    }
  }));

  app.post('/api/ai/local/voice-clone', aiUpload.single('reference'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请上传一段参考音频或视频。' });
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: '请输入需要生成的目标语言台词。' });
    if (text.length > 800) return res.status(400).json({ error: '单次台词不能超过 800 个字符，请分段生成。' });

    const engine = String(req.body?.engine || 'chatterbox').trim().toLowerCase() as LocalVoiceCloneEngine;
    if (engine !== 'chatterbox' && engine !== 'cosyvoice3') {
      return res.status(400).json({ error: '不支持的本地声音克隆模型。' });
    }
    const engineLanguages = engine === 'cosyvoice3' ? cosyVoiceLanguages : localVoiceCloneLanguages;
    const language = String(req.body?.language || '').trim().toLowerCase();
    if (!engineLanguages[language]) {
      return res.status(400).json({ error: '当前本地模型不支持这个目标语言。' });
    }
    const status = (await readLocalVoiceCloneStatus()).engines[engine];
    if (!status.available) {
      return res.status(503).json({ error: status.reason || '本地声音克隆引擎不可用。' });
    }

    const sourceExtension = getSafeUploadExtension(req.file.originalname, req.file.mimetype, '.wav');
    const jobId = randomUUID();
    const sourcePath = path.resolve(uploadsDir, `local_clone_source_${jobId}${sourceExtension}`);
    const referencePath = path.resolve(uploadsDir, `local_clone_reference_${jobId}.wav`);
    const outputFileName = `local_voice_clone_${jobId}.wav`;
    const outputPath = path.resolve(uploadsDir, outputFileName);
    if (![sourcePath, referencePath, outputPath].every(filePath => isPathInside(uploadsDir, filePath))) {
      throw Object.assign(new Error('本地声音克隆输出路径无效。'), { status: 500 });
    }

    fs.writeFileSync(sourcePath, req.file.buffer);
    let keepOutput = false;
    try {
      const measuredSourceDuration = await getMediaDurationSeconds(sourcePath).catch(() => 0);
      const reportedSourceDuration = parseNumber(req.body?.sourceDuration, 0, 0, 24 * 60 * 60);
      const sourceDuration = measuredSourceDuration || reportedSourceDuration;
      const requestedStart = parseNumber(req.body?.referenceStart, 0, 0, 60 * 60);
      const referenceStart = sourceDuration > 0
        ? Math.min(requestedStart, Math.max(0, sourceDuration - 0.5))
        : requestedStart;
      const requestedDuration = parseNumber(req.body?.referenceDuration, 0, 0.5, 20);
      const requestedReferenceDuration = sourceDuration > 0
        ? Math.min(20, Math.max(0.5, requestedDuration || sourceDuration - referenceStart), sourceDuration - referenceStart)
        : requestedDuration || 20;

      await runFfmpegFile([
        '-y',
        '-ss', referenceStart.toFixed(3),
        '-i', sourcePath,
        '-t', requestedReferenceDuration.toFixed(3),
        '-map', '0:a:0',
        '-vn',
        '-ac', '1',
        '-ar', '24000',
        '-c:a', 'pcm_s16le',
        referencePath,
      ], 120_000);
      const referenceDuration = await getMediaDurationSeconds(referencePath).catch(() => requestedReferenceDuration);

      const seed = String(Math.floor(Math.random() * 2_147_483_647));
      const performance = ['natural', 'expressive', 'stable'].includes(String(req.body?.performance))
        ? String(req.body.performance)
        : 'natural';
      const processArgs = engine === 'cosyvoice3'
        ? [
          cosyVoiceScript,
          '--reference', referencePath,
          '--text', text,
          '--language', language,
          '--output', outputPath,
          '--performance', performance,
          '--repo-dir', cosyVoiceRepoDir,
          '--model-dir', cosyVoiceModelDir,
          '--seed', seed,
        ]
        : [
          localVoiceCloneScript,
          '--reference', referencePath,
          '--text', text,
          '--language', language,
          '--output', outputPath,
          '--model', 'v3',
          '--exaggeration', String(parseNumber(req.body?.exaggeration, 0.5, 0.25, 2)),
          '--cfg-weight', String(parseNumber(req.body?.cfgWeight, 0.3, 0, 1)),
          '--temperature', String(parseNumber(req.body?.temperature, 0.8, 0.05, 2)),
          '--seed', seed,
        ];
      const pythonPath = engine === 'cosyvoice3' ? cosyVoicePython : localVoiceClonePython;
      const stdout = await runLocalVoiceCloneQueued(() => runLocalVoiceCloneProcess(
        pythonPath,
        processArgs,
        10 * 60 * 1000,
      ));
      const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}';
      const metadata = JSON.parse(lastLine) as {
        duration_seconds?: number;
        model?: string;
        gpu?: string;
        speaker_similarity?: number;
        jobs?: Array<{ speaker_similarity?: number }>;
      };
      if (!fs.existsSync(outputPath)) {
        throw Object.assign(new Error('本地模型没有生成可用的音频文件。'), { status: 502 });
      }
      keepOutput = true;
      return res.json({
        audioUrl: `/uploads/${outputFileName}`,
        sourceText: '',
        translatedText: text,
        sourceDuration: sourceDuration || undefined,
        generatedDuration: metadata.duration_seconds,
        outputDuration: metadata.duration_seconds,
        timingMode: 'natural',
        dubbingModel: engine === 'cosyvoice3' ? 'local_cosyvoice3' : 'local_chatterbox',
        outputFormat: 'wav',
        language,
        model: engine === 'cosyvoice3'
          ? String(metadata.model || 'Fun-CosyVoice3-0.5B-2512')
          : metadata.model === 'v3' ? 'Chatterbox Multilingual V3' : String(metadata.model || 'Chatterbox Multilingual'),
        gpu: metadata.gpu || status.gpu,
        speakerSimilarity: Number.isFinite(metadata.speaker_similarity)
          ? metadata.speaker_similarity
          : Number.isFinite(metadata.jobs?.[0]?.speaker_similarity)
            ? metadata.jobs?.[0]?.speaker_similarity
            : undefined,
        referenceStart,
        referenceDuration,
      });
    } finally {
      await Promise.all([
        safeUnlink(sourcePath),
        safeUnlink(referencePath),
        keepOutput ? Promise.resolve() : safeUnlink(outputPath),
      ]);
    }
  }));

  app.post('/api/ai/local/voice-clone/batch', aiUpload.single('source'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请上传包含多人对话的源音频或视频。' });
    let payload: any;
    try {
      payload = JSON.parse(String(req.body?.payload || '{}'));
    } catch {
      return res.status(400).json({ error: '多人配音参数格式无效。' });
    }

    const engine = String(payload.engine || '').trim().toLowerCase() as LocalVoiceCloneEngine;
    if (engine !== 'chatterbox' && engine !== 'cosyvoice3') {
      return res.status(400).json({ error: '不支持的本地声音克隆模型。' });
    }
    const language = String(payload.language || '').trim().toLowerCase();
    const dialogueMode = payload.dialogueMode === 'single' ? 'single' : 'multi';
    const engineLanguages = engine === 'cosyvoice3' ? cosyVoiceLanguages : localVoiceCloneLanguages;
    if (!engineLanguages[language]) return res.status(400).json({ error: '当前模型不支持这个目标语言。' });

    const profiles = Array.isArray(payload.profiles) ? payload.profiles.slice(0, 8) : [];
    const rawSegments = Array.isArray(payload.segments) ? payload.segments.slice(0, 40) : [];
    const segments = rawSegments.filter((segment: any, segmentIndex: number) => {
      const normalizedText = String(segment.targetText || segment.sourceText || '').toLowerCase().replace(/\s+/g, ' ').trim();
      return !rawSegments.slice(0, segmentIndex).some((previous: any) => (
        String(previous.speakerId || '') === String(segment.speakerId || '')
        && String(previous.targetText || previous.sourceText || '').toLowerCase().replace(/\s+/g, ' ').trim() === normalizedText
        && Math.abs(Number(previous.start) - Number(segment.start)) < 0.18
      ));
    });
    const supportedEventTypes = new Set(['laughter', 'breath', 'quick_breath', 'cough', 'sigh', 'noise', 'mn']);
    const rawEvents = (Array.isArray(payload.events) ? payload.events : [])
      .slice(0, 80)
      .filter((event: any) => supportedEventTypes.has(String(event.type || '')));
    const events: any[] = [];
    rawEvents.sort((left: any, right: any) => Number(left.start) - Number(right.start)).forEach((event: any) => {
      const previous = events.at(-1);
      if (
        previous
        && String(previous.speakerId || '') === String(event.speakerId || '')
        && String(previous.type || '') === String(event.type || '')
        && Number(event.start) - Number(previous.end) <= 0.35
      ) {
        previous.end = Math.max(Number(previous.end), Number(event.end));
        previous.sourceText = `${String(previous.sourceText || '')} ${String(event.sourceText || '')}`.trim();
        return;
      }
      events.push({ ...event });
    });
    const versions = Array.isArray(payload.versions) ? payload.versions.slice(0, 2) : [];
    if (profiles.length === 0 || segments.length === 0 || versions.length !== 2) {
      return res.status(400).json({ error: '多人配音需要有效的角色、台词和两个生成版本。' });
    }
    if (segments.some((segment: any) => !String(segment.targetText || '').trim())) {
      return res.status(400).json({ error: '存在空白的目标语言台词，请补全后再生成。' });
    }

    const status = (await readLocalVoiceCloneStatus()).engines[engine];
    if (!status.available) return res.status(503).json({ error: status.reason || '本地声音克隆引擎当前不可用。' });

    const sourceExtension = getSafeUploadExtension(req.file.originalname, req.file.mimetype, '.wav');
    const jobId = randomUUID();
    const sourcePath = path.resolve(uploadsDir, `local_multi_source_${jobId}${sourceExtension}`);
    const manifestPath = path.resolve(uploadsDir, `local_multi_manifest_${jobId}.json`);
    const temporaryPaths: string[] = [sourcePath, manifestPath];
    const outputPaths: string[] = [];
    fs.writeFileSync(sourcePath, req.file.buffer);

    let keepOutputs = false;
    try {
      const measuredDuration = await getMediaDurationSeconds(sourcePath).catch(() => 0);
      const reportedDuration = parseNumber(payload.sourceDuration, 0, 0, 24 * 60 * 60);
      const sourceDuration = measuredDuration || reportedDuration || Math.max(
        ...segments.map((segment: any) => Number(segment.end) || 0),
        ...events.map((event: any) => Number(event.end) || 0),
      );
      const referencePaths = new Map<string, string>();
      const referenceTexts = new Map<string, string>();
      const referenceDurations: Record<string, number> = {};

      // Keep one deterministic sampling stream per speaker. CosyVoice samples
      // prosody from this stream, so changing it for every line can make one
      // diarized speaker sound like several different people.
      const speakerSeeds = new Map<string, number>();
      const getSpeakerSeed = (speakerId: string) => {
        const existing = speakerSeeds.get(speakerId);
        if (existing) return existing;
        let hash = 2166136261;
        for (const character of speakerId) {
          hash ^= character.charCodeAt(0);
          hash = Math.imul(hash, 16777619);
        }
        const seed = (hash >>> 0) % 2_147_483_646 + 1;
        speakerSeeds.set(speakerId, seed);
        return seed;
      };

      for (let profileIndex = 0; profileIndex < profiles.length; profileIndex += 1) {
        const profile = profiles[profileIndex];
        const profileId = String(profile.id || '').trim();
        if (!profileId) throw Object.assign(new Error('角色标识无效。'), { status: 400 });
        const isSingleChatterbox = dialogueMode === 'single' && engine === 'chatterbox';
        const requestedRanges = engine === 'cosyvoice3'
          ? [{ start: profile.referenceStart, end: profile.referenceEnd }]
          : isSingleChatterbox
            ? (() => {
              const requestedStart = parseNumber(profile.referenceStart, 0, 0, Math.max(0, sourceDuration - 0.2));
              const requestedEnd = parseNumber(profile.referenceEnd, requestedStart + 0.5, requestedStart + 0.2, sourceDuration);
              const candidateSegments = segments
                .filter((segment: any) => String(segment.speakerId || '') === profileId)
                .map((segment: any) => ({ start: Number(segment.start), end: Number(segment.end) }))
                .filter(segment => Number.isFinite(segment.start) && Number.isFinite(segment.end))
                .filter(segment => Math.min(requestedEnd, segment.end) - Math.max(requestedStart, segment.start) >= 0.5)
                .sort((left, right) => (
                  (Math.min(requestedEnd, right.end) - Math.max(requestedStart, right.start))
                  - (Math.min(requestedEnd, left.end) - Math.max(requestedStart, left.start))
                ));
              const selectedRanges: Array<{ start: number; end: number }> = [];
              let selectedDuration = 0;
              for (const candidate of candidateSegments) {
                if (selectedRanges.length >= 4 || selectedDuration >= 8) break;
                const start = Math.max(requestedStart, candidate.start + 0.03);
                const end = Math.min(requestedEnd, candidate.end - 0.03);
                const duration = end - start;
                if (duration < 0.5) continue;
                const remaining = 8 - selectedDuration;
                selectedRanges.push({ start, end: Math.min(end, start + remaining) });
                selectedDuration += Math.min(duration, remaining);
              }
              return selectedRanges.length > 0
                ? selectedRanges.sort((left, right) => left.start - right.start)
                : [{ start: requestedStart, end: requestedEnd }];
            })()
          : Array.isArray(profile.referenceRanges) && profile.referenceRanges.length > 0
            ? profile.referenceRanges
            : [{ start: profile.referenceStart, end: profile.referenceEnd }];
        const ranges: Array<{ start: number; end: number }> = [];
        let totalReferenceDuration = 0;
        for (const requestedRange of requestedRanges.slice(0, 5)) {
          if (totalReferenceDuration >= 15) break;
          let start = parseNumber(requestedRange?.start, 0, 0, Math.max(0, sourceDuration - 0.2));
          const requestedEnd = parseNumber(requestedRange?.end, start + 0.5, start + 0.2, sourceDuration);
          let end = Math.min(requestedEnd, start + Math.min(8, 15 - totalReferenceDuration));
          if (engine === 'cosyvoice3') {
            const matchingSegment = segments
              .filter((segment: any) => String(segment.speakerId || '') === profileId)
              .map((segment: any) => ({
                start: Number(segment.start),
                end: Number(segment.end),
              }))
              .filter(segment => Number.isFinite(segment.start) && Number.isFinite(segment.end))
              .filter(segment => Math.min(end, segment.end) - Math.max(start, segment.start) >= 0.15)
              .sort((left, right) => (
                Math.min(end, right.end) - Math.max(start, right.start)
                - (Math.min(end, left.end) - Math.max(start, left.start))
              ))[0];
            if (matchingSegment) {
              // Never let a CosyVoice reference cross a diarization boundary.
              // A short clean clip is more reliable than a longer clip with a
              // neighboring speaker or background speech mixed in.
              const edge = matchingSegment.end - matchingSegment.start >= 0.5 ? 0.03 : 0.015;
              start = Math.max(start, matchingSegment.start + edge);
              end = Math.min(end, matchingSegment.end - edge);
            }
          }
          if (end - start < 0.2) continue;
          ranges.push({ start, end });
          totalReferenceDuration += end - start;
        }
        if (ranges.length === 0) throw Object.assign(new Error(`角色 ${profileId} 没有可用参考音。`), { status: 400 });

        const referencePath = path.resolve(uploadsDir, `local_multi_reference_${jobId}_${profileIndex}.wav`);
        temporaryPaths.push(referencePath);
        const splitFilter = ranges.length > 1
          ? `[0:a]asplit=${ranges.length}${ranges.map((_range, index) => `[s${index}]`).join('')}`
          : '';
        const referenceFilters = ranges.map((range, rangeIndex) => (
          `[${ranges.length > 1 ? `s${rangeIndex}` : '0:a'}]atrim=start=${range.start.toFixed(3)}:end=${range.end.toFixed(3)},asetpts=PTS-STARTPTS[r${rangeIndex}]`
        ));
        const filterComplex = ranges.length === 1
          ? `${referenceFilters[0]};[r0]aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono[out]`
          : `${splitFilter};${referenceFilters.join(';')};${ranges.map((_range, index) => `[r${index}]`).join('')}concat=n=${ranges.length}:v=0:a=1,aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono[out]`;
        await runFfmpegFile([
          '-y', '-i', sourcePath,
          '-filter_complex', filterComplex,
          '-map', '[out]', '-vn', '-c:a', 'pcm_s16le', referencePath,
        ], 120_000);
        referencePaths.set(profileId, referencePath);
        const referenceText = engine === 'cosyvoice3'
          ? (() => {
            const range = ranges[0];
            const matchingSegment = segments
              .filter((segment: any) => String(segment.speakerId || '') === profileId)
              .map((segment: any) => ({
                ...segment,
                overlap: Math.min(range.end, Number(segment.end)) - Math.max(range.start, Number(segment.start)),
              }))
              .filter((segment: any) => Number.isFinite(segment.overlap) && segment.overlap >= 0.15)
              .sort((left: any, right: any) => right.overlap - left.overlap)[0];
            return String(matchingSegment?.sourceText || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
          })()
          : (() => {
            const seenReferenceSegmentIds = new Set<string>();
            return ranges.flatMap(range => (
              segments
                .filter((segment: any) => {
                  if (String(segment.speakerId || '') !== profileId) return false;
                  const segmentStart = Number(segment.start);
                  const segmentEnd = Number(segment.end);
                  if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd)) return false;
                  return Math.min(range.end, segmentEnd) - Math.max(range.start, segmentStart) >= 0.15;
                })
                .sort((left: any, right: any) => Number(left.start) - Number(right.start))
            )).flatMap((segment: any) => {
              const segmentId = String(segment.id || `${segment.start}-${segment.end}`);
              if (seenReferenceSegmentIds.has(segmentId)) return [];
              seenReferenceSegmentIds.add(segmentId);
              const sourceText = String(segment.sourceText || '').replace(/\s+/g, ' ').trim();
              return sourceText ? [sourceText] : [];
            }).join(' ').slice(0, 1200);
          })();
        if (referenceText) referenceTexts.set(profileId, referenceText);
        referenceDurations[profileId] = await getMediaDurationSeconds(referencePath).catch(() => totalReferenceDuration);
      }

      // Long source lines carry useful local delivery cues. Reuse those lines as
      // style prompts when they are long enough to remain a reliable speaker
      // reference; short lines continue to use the profile-level reference.
      const segmentReferencePaths = new Map<string, string>();
      if (dialogueMode === 'single' && engine === 'chatterbox') {
        for (const segment of segments) {
          const segmentId = String(segment.id || '');
          const segmentStart = Number(segment.start);
          const segmentEnd = Number(segment.end);
          const segmentDuration = segmentEnd - segmentStart;
          if (!segmentId || !Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentDuration < 2.5) continue;
          const segmentReferencePath = path.resolve(uploadsDir, `local_multi_segment_reference_${jobId}_${segmentId.replace(/[^a-zA-Z0-9_-]/g, '_')}.wav`);
          temporaryPaths.push(segmentReferencePath);
          try {
            await runFfmpegFile([
              '-y', '-ss', Math.max(0, segmentStart + 0.03).toFixed(3),
              '-t', Math.min(8, Math.max(0.5, segmentDuration - 0.06)).toFixed(3),
              '-i', sourcePath,
              '-af', 'aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono',
              '-vn', '-c:a', 'pcm_s16le', segmentReferencePath,
            ], 120_000);
            if (await getMediaDurationSeconds(segmentReferencePath).catch(() => 0) >= 1.5) {
              segmentReferencePaths.set(segmentId, segmentReferencePath);
            }
          } catch {
            await safeUnlink(segmentReferencePath);
          }
        }
      }

      const eventClips: Array<{ path: string; event: any; eventIndex: number; duration: number; start: number }> = [];
      const synthesizedEvents: Array<{ event: any; eventIndex: number; duration: number; start: number; text: string }> = [];
      const sourceTimelineRanges = [
        ...segments.map((segment: any) => ({ start: Number(segment.start), end: Number(segment.end) })),
        ...events.map((event: any) => ({ start: Number(event.start), end: Number(event.end) })),
      ].filter(range => Number.isFinite(range.start) && Number.isFinite(range.end));
      let droppedEventCount = 0;
      for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
        const event = events[eventIndex];
        const rawStart = parseNumber(event.start, 0, 0, Math.max(0, sourceDuration - 0.02));
        const rawEnd = parseNumber(event.end, rawStart + 0.1, rawStart + 0.02, sourceDuration);
        const isLaughter = String(event.type || '') === 'laughter';
        const overlapsDialogue = segments.some((segment: any) => (
          Math.min(rawEnd, Number(segment.end)) - Math.max(rawStart, Number(segment.start)) >= 0.04
        ));
        if (engine === 'cosyvoice3' && overlapsDialogue) {
          const eventType = String(event.type || '');
          const eventTag = eventType === 'breath'
            ? '[breath]'
            : eventType === 'quick_breath'
              ? '[quick_breath]'
              : eventType === 'cough'
                ? '[cough]'
                : eventType === 'sigh'
                  ? '[sigh]'
                  : eventType === 'mn'
                    ? '[mn]'
                    : eventType === 'noise'
                      ? '[vocalized-noise]'
                      : '[laughter]';
          const eventDuration = Math.max(0.2, rawEnd - rawStart);
          const repeatCount = isLaughter ? Math.max(1, Math.min(3, Math.ceil(eventDuration / 0.75))) : 1;
          synthesizedEvents.push({
            event,
            eventIndex,
            duration: eventDuration,
            start: rawStart,
            text: Array.from({ length: repeatCount }, () => eventTag).join(''),
          });
          continue;
        }
        const boundaryRanges = isLaughter
          ? segments.map((segment: any) => ({ start: Number(segment.start), end: Number(segment.end) }))
          : sourceTimelineRanges;
        const previousEnd = Math.max(
          0,
          ...boundaryRanges
            .filter(range => range.end <= rawStart - 0.01)
            .map(range => range.end),
        );
        const nextStarts = boundaryRanges
          .filter(range => range.start >= rawEnd + 0.01)
          .map(range => range.start);
        const nextStart = nextStarts.length > 0 ? Math.min(...nextStarts) : sourceDuration;
        const start = Math.max(previousEnd + 0.01, rawStart - (isLaughter ? 0.18 : 0.06), 0);
        const end = Math.min(sourceDuration, nextStart - 0.01, rawEnd + (isLaughter ? 0.65 : 0.14));
        const duration = end - start;
        if (duration < 0.02) {
          droppedEventCount += 1;
          continue;
        }
        const eventPath = path.resolve(uploadsDir, `local_multi_event_${jobId}_${eventIndex}.wav`);
        temporaryPaths.push(eventPath);
        const fadeDuration = Math.min(isLaughter ? 0.16 : 0.05, duration / 4);
        try {
          await runFfmpegFile([
            '-y', '-ss', start.toFixed(3), '-t', duration.toFixed(3), '-i', sourcePath,
            '-af', `aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono,afade=t=in:st=0:d=${fadeDuration.toFixed(3)},afade=t=out:st=${Math.max(0, duration - fadeDuration).toFixed(3)}:d=${fadeDuration.toFixed(3)}`,
            '-vn', '-c:a', 'pcm_s16le', eventPath,
          ], 120_000);
          const measuredEventDuration = await getMediaDurationSeconds(eventPath).catch(() => duration);
          eventClips.push({ path: eventPath, event, eventIndex, duration: measuredEventDuration, start });
        } catch {
          droppedEventCount += 1;
          await safeUnlink(eventPath);
        }
      }

      const manifestJobs: any[] = [];
      const synthesizeableEvents = synthesizedEvents.filter(synthesizedEvent => (
        referencePaths.has(String(synthesizedEvent.event.speakerId || ''))
      ));
      droppedEventCount += synthesizedEvents.length - synthesizeableEvents.length;
      const generatedClipsByVersion = new Map<string, Array<{ path: string; segment: any; segmentIndex: number }>>();
      const generatedEventClipsByVersion = new Map<string, Array<{ path: string; event: any; eventIndex: number; start: number }>>();
      versions.forEach((version: any, versionIndex: number) => {
        const versionId = versionIndex === 0 ? 'A' : 'B';
        const clips: Array<{ path: string; segment: any; segmentIndex: number }> = [];
        segments.forEach((segment: any, segmentIndex: number) => {
          const profileReferencePath = referencePaths.get(String(segment.speakerId || ''));
          const referencePath = segmentReferencePaths.get(String(segment.id || '')) || profileReferencePath;
          if (!referencePath) throw Object.assign(new Error(`第 ${segmentIndex + 1} 段台词没有对应角色参考音。`), { status: 400 });
          const rawPath = path.resolve(uploadsDir, `local_multi_raw_${jobId}_${versionId}_${segmentIndex}.wav`);
          temporaryPaths.push(rawPath);
          clips.push({ path: rawPath, segment, segmentIndex });
          manifestJobs.push({
            id: `${versionId}-${segmentIndex}`,
            reference: referencePath,
            prompt_text: referenceTexts.get(String(segment.speakerId || '')) || '',
            text: String(segment.targetText).trim().slice(0, 800),
            language,
            output: rawPath,
            target_duration: Math.max(0.35, Number(segment.end) - Number(segment.start)),
            performance: ['natural', 'expressive', 'stable'].includes(String(version.performance)) ? version.performance : 'natural',
            exaggeration: parseNumber(version.exaggeration, 0.5, 0.25, 2),
            cfg_weight: parseNumber(version.cfgWeight, 0.3, 0, 1),
            temperature: Math.min(0.78, parseNumber(version.temperature, 0.75, 0.05, 2)),
            seed: getSpeakerSeed(String(segment.speakerId || '')),
            diagnostic_similarity: segmentIndex === 0,
          });
        });
        generatedClipsByVersion.set(versionId, clips);
        const generatedEvents = synthesizeableEvents.flatMap(synthesizedEvent => {
          const speakerId = String(synthesizedEvent.event.speakerId || '');
          const referencePath = referencePaths.get(speakerId);
          if (!referencePath) return [];
          const rawPath = path.resolve(uploadsDir, `local_multi_event_generated_${jobId}_${versionId}_${synthesizedEvent.eventIndex}.wav`);
          temporaryPaths.push(rawPath);
          manifestJobs.push({
            id: `${versionId}-event-${synthesizedEvent.eventIndex}`,
            reference: referencePath,
            prompt_text: '',
            text: synthesizedEvent.text,
            language,
            output: rawPath,
            target_duration: synthesizedEvent.duration,
            performance: 'natural',
            event_only: true,
            seed: getSpeakerSeed(speakerId),
          });
          return [{
            path: rawPath,
            event: synthesizedEvent.event,
            eventIndex: synthesizedEvent.eventIndex,
            start: synthesizedEvent.start,
          }];
        });
        generatedEventClipsByVersion.set(versionId, generatedEvents);
      });
      fs.writeFileSync(manifestPath, JSON.stringify({ jobs: manifestJobs }), 'utf8');

      const processArgs = engine === 'cosyvoice3'
        ? [cosyVoiceScript, '--batch-manifest', manifestPath, '--repo-dir', cosyVoiceRepoDir, '--model-dir', cosyVoiceModelDir]
        : [localVoiceCloneScript, '--batch-manifest', manifestPath, '--model', 'v3'];
      const pythonPath = engine === 'cosyvoice3' ? cosyVoicePython : localVoiceClonePython;
      const stdout = await runLocalVoiceCloneQueued(() => runLocalVoiceCloneProcess(
        pythonPath,
        processArgs,
        Math.max(10 * 60 * 1000, manifestJobs.length * 90_000),
      ));
      const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}';
      const metadata = JSON.parse(lastLine) as {
        model?: string;
        gpu?: string;
        jobs?: Array<{
          id?: string;
          duration_seconds?: number;
          natural_duration_seconds?: number;
          target_duration_seconds?: number;
          speed?: number;
          speaker_similarity?: number;
        }>;
      };
      const generatedDurations = new Map(
        (metadata.jobs || []).map(job => [String(job.id || ''), Number(job.duration_seconds) || 0]),
      );
      const paceAdjustments = new Map(
        (metadata.jobs || []).map(job => [String(job.id || ''), Number(job.speed) || 1]),
      );
      const speakerSimilarities = new Map(
        (metadata.jobs || []).map(job => [String(job.id || ''), Number(job.speaker_similarity)]),
      );

      const options = [];
      const versionTimelines: Array<{
        id: 'A' | 'B';
        shiftedClipCount: number;
        maxShiftSeconds: number;
        paceAdjustedClipCount: number;
        maxPaceAdjustment: number;
        preservedEventCount: number;
        droppedEventCount: number;
        outputDuration: number;
      }> = [];
      const MIN_DIALOGUE_GAP_SECONDS = 0.06;
      for (let versionIndex = 0; versionIndex < versions.length; versionIndex += 1) {
        const versionId = versionIndex === 0 ? 'A' as const : 'B' as const;
        const clips = [...(generatedClipsByVersion.get(versionId) || [])].sort((left, right) => (
          Number(left.segment.start) - Number(right.segment.start)
          || left.segmentIndex - right.segmentIndex
        ));
        if (clips.some(clip => !fs.existsSync(clip.path))) {
          throw Object.assign(new Error(`本地模型没有完整生成版本 ${versionId} 的全部台词。`), { status: 502 });
        }
        const generatedEventClips = (generatedEventClipsByVersion.get(versionId) || []).map(clip => ({
          ...clip,
          duration: generatedDurations.get(`${versionId}-event-${clip.eventIndex}`)
            || Math.max(0.2, Number(clip.event.end) - Number(clip.event.start)),
        }));
        if (generatedEventClips.some(clip => !fs.existsSync(clip.path))) {
          throw Object.assign(new Error(`本地模型没有完整生成版本 ${versionId} 的语气事件。`), { status: 502 });
        }
        const versionEventClips = [...eventClips, ...generatedEventClips];
        const timelineItems = [
          ...clips.map(clip => ({
            kind: 'speech' as const,
            path: clip.path,
            speakerId: String(clip.segment.speakerId || ''),
            originalStart: parseNumber(clip.segment.start, 0, 0, sourceDuration),
            originalEnd: parseNumber(clip.segment.end, Number(clip.segment.start) + 0.2, Number(clip.segment.start) + 0.02, sourceDuration + 60),
            duration: generatedDurations.get(`${versionId}-${clip.segmentIndex}`)
              || Math.max(0.2, Number(clip.segment.end) - Number(clip.segment.start)),
            stableIndex: clip.segmentIndex,
          })),
          ...versionEventClips.map(clip => ({
            kind: 'event' as const,
            path: clip.path,
            speakerId: String(clip.event.speakerId || ''),
            originalStart: clip.start,
            originalEnd: clip.start + clip.duration,
            duration: clip.duration,
            stableIndex: segments.length + clip.eventIndex,
          })),
        ].sort((left, right) => left.originalStart - right.originalStart || left.stableIndex - right.stableIndex);
        const filterParts: string[] = [];
        const scheduledClips: Array<{
          kind: 'speech' | 'event';
          speakerId: string;
          originalStart: number;
          originalEnd: number;
          scheduledStart: number;
          scheduledEnd: number;
        }> = [];
        timelineItems.forEach((item, itemIndex) => {
          let scheduledStart = item.originalStart;
          if (item.kind === 'speech') {
            scheduledClips.forEach(previous => {
              const sameSpeaker = previous.speakerId === item.speakerId;
              if (sameSpeaker) {
                scheduledStart = Math.max(scheduledStart, previous.scheduledEnd + MIN_DIALOGUE_GAP_SECONDS);
              }
            });
          }
          scheduledStart = Math.max(0, scheduledStart);
          const scheduledEnd = scheduledStart + item.duration;
          scheduledClips.push({
            kind: item.kind,
            speakerId: item.speakerId,
            originalStart: item.originalStart,
            originalEnd: item.originalEnd,
            scheduledStart,
            scheduledEnd,
          });
          const fadeInDuration = Math.min(0.015, item.duration / 4);
          const fadeOutDuration = Math.min(0.025, item.duration / 4);
          const audioFilters = [
            'aresample=24000',
            'aformat=sample_fmts=fltp:channel_layouts=mono',
          ];
          if (item.kind === 'speech') {
            audioFilters.push(
              `afade=t=in:st=0:d=${fadeInDuration.toFixed(3)}`,
              `afade=t=out:st=${Math.max(0, item.duration - fadeOutDuration).toFixed(3)}:d=${fadeOutDuration.toFixed(3)}`,
            );
          }
          audioFilters.push(`adelay=${Math.round(scheduledStart * 1000)}:all=1`);
          filterParts.push(`[${itemIndex}:a]${audioFilters.join(',')}[c${itemIndex}]`);
        });
        const shiftedSpeechClips = scheduledClips.filter(clip => (
          clip.kind === 'speech' && clip.scheduledStart - clip.originalStart > 0.03
        ));
        const shiftedClipCount = shiftedSpeechClips.length;
        const maxShiftSeconds = Math.max(0, ...shiftedSpeechClips.map(clip => clip.scheduledStart - clip.originalStart));
        const versionSpeeds = clips.map(clip => paceAdjustments.get(`${versionId}-${clip.segmentIndex}`) || 1);
        const paceAdjustedClipCount = versionSpeeds.filter(speed => Math.abs(speed - 1) >= 0.001).length;
        const maxPaceAdjustment = Math.max(0, ...versionSpeeds.map(speed => Math.abs(speed - 1)));
        const outputDuration = Math.max(
          sourceDuration,
          ...scheduledClips.map(clip => clip.scheduledEnd + 0.15),
          0.5,
        );
        versionTimelines.push({
          id: versionId,
          shiftedClipCount,
          maxShiftSeconds,
          paceAdjustedClipCount,
          maxPaceAdjustment,
          preservedEventCount: versionEventClips.length,
          droppedEventCount,
          outputDuration,
        });
        filterParts.push(`${timelineItems.map((_item, index) => `[c${index}]`).join('')}amix=inputs=${timelineItems.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=disabled,apad=whole_dur=${outputDuration.toFixed(3)},atrim=duration=${outputDuration.toFixed(3)}[out]`);
        const outputFileName = `local_multi_voice_${jobId}_${versionId}.wav`;
        const outputPath = path.resolve(uploadsDir, outputFileName);
        outputPaths.push(outputPath);
        await runFfmpegFile([
          '-y', ...timelineItems.flatMap(item => ['-i', item.path]),
          '-filter_complex', filterParts.join(';'),
          '-map', '[out]', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', outputPath,
        ], 180_000);
        const generatedDuration = await getMediaDurationSeconds(outputPath).catch(() => outputDuration);
        const performance = ['natural', 'expressive', 'stable'].includes(String(versions[versionIndex].performance))
          ? versions[versionIndex].performance
          : 'natural';
        const versionSimilarities = clips
          .map(clip => speakerSimilarities.get(`${versionId}-${clip.segmentIndex}`) || 0)
          .filter(similarity => Number.isFinite(similarity) && similarity > 0);
        options.push({
          id: versionId,
          performance,
          speakerSimilarity: versionSimilarities.length > 0
            ? Number((versionSimilarities.reduce((sum, similarity) => sum + similarity, 0) / versionSimilarities.length).toFixed(4))
            : undefined,
          data: {
            audioUrl: `/uploads/${outputFileName}`,
            sourceText: segments.map((segment: any) => (
              dialogueMode === 'single' ? segment.sourceText : `${segment.speakerId}: ${segment.sourceText}`
            )).join('\n'),
            translatedText: segments.map((segment: any) => (
              dialogueMode === 'single' ? segment.targetText : `${segment.speakerId}: ${segment.targetText}`
            )).join('\n'),
            sourceDuration,
            generatedDuration,
            outputDuration: generatedDuration,
            timingMode: 'natural',
            dubbingModel: dialogueMode === 'single'
              ? engine === 'cosyvoice3' ? 'local_cosyvoice3' : 'local_chatterbox'
              : 'local_multispeaker',
            outputFormat: 'wav',
            model: engine === 'cosyvoice3'
              ? String(metadata.model || 'Fun-CosyVoice3-0.5B-2512')
              : metadata.model === 'v3' ? 'Chatterbox Multilingual V3' : String(metadata.model || 'Chatterbox Multilingual'),
            gpu: metadata.gpu || status.gpu,
            speakerSimilarity: versionSimilarities.length > 0
              ? Number((versionSimilarities.reduce((sum, similarity) => sum + similarity, 0) / versionSimilarities.length).toFixed(4))
              : undefined,
          },
        });
      }
      const timeline = {
        shiftedClipCount: versionTimelines.reduce((sum, version) => sum + version.shiftedClipCount, 0),
        maxShiftSeconds: Math.max(0, ...versionTimelines.map(version => version.maxShiftSeconds)),
        paceAdjustedClipCount: versionTimelines.reduce((sum, version) => sum + version.paceAdjustedClipCount, 0),
        maxPaceAdjustment: Math.max(0, ...versionTimelines.map(version => version.maxPaceAdjustment)),
        preservedEventCount: Math.max(0, ...versionTimelines.map(version => version.preservedEventCount)),
        droppedEventCount,
        outputDuration: Math.max(0, ...versionTimelines.map(version => version.outputDuration)),
        versions: versionTimelines,
      };
      keepOutputs = true;
      return res.json({ options, referenceDurations, timeline });
    } finally {
      await Promise.all([
        ...temporaryPaths.map(filePath => safeUnlink(filePath)),
        ...(keepOutputs ? [] : outputPaths.map(filePath => safeUnlink(filePath))),
      ]);
    }
  }));

  app.post('/api/ai/elevenlabs/voice', asyncRoute(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    const fallbackText = String(req.body?.fallbackText || text).trim();
    const voiceId = validateVoiceId(req.body?.voiceId);
    const qualityMode = normalizeElevenLabsQualityMode(req.body?.qualityMode);
    const voiceSource = String(req.body?.voiceSource || '').trim();
    const publicOwnerId = String(req.body?.publicOwnerId || '').trim();
    const voiceName = String(req.body?.voiceName || '').trim();
    const seed = Number.parseInt(String(req.body?.seed || ''), 10);
    return sendAudioBlob(res, await runVoiceGenerationQueued(voiceId, async () => {
      if (voiceSource === 'voice_library') {
        await ensureSharedVoiceAvailable(voiceId, publicOwnerId, voiceName);
      }
      return generateVoice(
        text,
        voiceId,
        parseNumber(req.body?.stability, 0.5, 0, 1),
        parseNumber(req.body?.similarity, 0.75, 0, 1),
        parseNumber(req.body?.style, 0.05, 0, 1),
        {
          qualityMode,
          fallbackText,
          ...(Number.isFinite(seed) ? { seed } : {}),
        },
      );
    }));
  }));

  app.get('/api/ai/elevenlabs/voices', asyncRoute(async (req, res) => {
    return res.json({ voices: await fetchAvailableVoices() });
  }));

  app.post('/api/ai/elevenlabs/speech-to-speech', aiUpload.single('audio'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'audio is required' });
    const audio = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype });
    const voiceId = validateVoiceId(req.body?.voiceId);
    return sendAudioBlob(res, await runVoiceGenerationQueued(voiceId, async () => {
      if (String(req.body?.voiceSource || '').trim() === 'voice_library') {
        await ensureSharedVoiceAvailable(
          voiceId,
          String(req.body?.publicOwnerId || '').trim(),
          String(req.body?.voiceName || '').trim(),
        );
      }
      return generateSpeechToSpeech(
        audio,
        voiceId,
        parseNumber(req.body?.stability, 0.5, 0, 1),
        parseNumber(req.body?.similarity, 0.75, 0, 1),
        parseNumber(req.body?.style, 0.05, 0, 1),
      );
    }));
  }));

  app.post('/api/ai/elevenlabs/audio-isolation', aiUpload.single('audio'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'audio is required' });
    const audio = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype });
    return sendAudioBlob(res, await isolateAudio(audio));
  }));

  app.post('/api/ai/elevenlabs/speech-to-text', aiUpload.single('audio'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'audio is required' });
    const sourceExtension = getSafeUploadExtension(req.file.originalname, req.file.mimetype, '.bin');
    const isVideo = req.file.mimetype.startsWith('video/') || ALLOWED_VIDEO_EXTENSIONS.has(sourceExtension);
    const sourcePath = path.resolve(uploadsDir, `speech-to-text-source-${randomUUID()}${sourceExtension}`);
    const extractedAudioPath = path.resolve(uploadsDir, `speech-to-text-audio-${randomUUID()}.wav`);
    fs.writeFileSync(sourcePath, req.file.buffer);

    try {
      let transcriptionPath = sourcePath;
      let transcriptionType = req.file.mimetype;
      if (isVideo) {
        await new Promise<void>((resolve, reject) => {
          execFile(
            FFMPEG_BINARY,
            ['-y', '-i', sourcePath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', extractedAudioPath],
            { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
            (error, _stdout, stderr) => {
              if (!error) {
                resolve();
                return;
              }
              const message = String(stderr || error.message).trim().split(/\r?\n/).slice(-1)[0];
              reject(Object.assign(
                new Error(message || '无法从视频中提取音轨。'),
                { status: /(?:not recognized|not found)|ENOENT/i.test(`${error.message}\n${stderr}`) ? 503 : 422 },
              ));
            },
          );
        });
        transcriptionPath = extractedAudioPath;
        transcriptionType = 'audio/wav';
      }

      const audio = new Blob([new Uint8Array(fs.readFileSync(transcriptionPath))], { type: transcriptionType });
      const result = await transcribeSpeech(
        audio,
        typeof req.body?.languageCode === 'string' ? req.body.languageCode : undefined,
        req.body?.tagAudioEvents !== 'false',
        {
          diarize: req.body?.diarize === 'true',
          numSpeakers: req.body?.numSpeakers
            ? parseNumber(req.body.numSpeakers, 2, 1, 32)
            : undefined,
        },
      );
      return res.json(result);
    } finally {
      await Promise.all([safeUnlink(sourcePath), safeUnlink(extractedAudioPath)]);
    }
  }));

  app.post('/api/ai/elevenlabs/translate-dubbing', aiUpload.single('audio'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'audio is required' });

    const voiceId = validateVoiceId(req.body?.voiceId);
    const sourceLanguage = typeof req.body?.sourceLanguage === 'string' ? req.body.sourceLanguage : 'auto';
    const targetLanguage = String(req.body?.targetLanguage || 'English');
    const timingMode = ['natural', 'match', 'strict'].includes(String(req.body?.timingMode))
      ? String(req.body?.timingMode) as 'natural' | 'match' | 'strict'
      : 'match';
    const qualityMode = normalizeElevenLabsQualityMode(req.body?.qualityMode);
    const isProQuality = qualityMode === 'pro';

    const sourceExt = getSafeUploadExtension(req.file.originalname, req.file.mimetype, '.wav');
    const sourceFileName = `translate_source_${randomUUID()}${sourceExt}`;
    const sourcePath = path.join(uploadsDir, sourceFileName);
    fs.writeFileSync(sourcePath, req.file.buffer);

    const generatedFileName = `translated_dubbing_raw_${randomUUID()}.mp3`;
    const generatedPath = path.join(uploadsDir, generatedFileName);
    const outputFileName = `translated_dubbing_${randomUUID()}.mp3`;
    const outputPath = path.join(uploadsDir, outputFileName);

    try {
      const audio = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype });
      const [transcription, sourceDurationResult] = await Promise.all([
        transcribeSpeech(
          audio,
          sourceLanguage && sourceLanguage !== 'auto' ? sourceLanguage : undefined,
          false,
        ),
        getMediaDurationSeconds(sourcePath).catch(() => 0),
      ]);

      const sourceText = String(transcription.text || '').trim();
      if (!sourceText) {
        return res.status(422).json({ error: '没有识别到可翻译的台词，请换一段更清晰的人声音频。' });
      }

      const translatedText = await translateTextToLanguage(sourceText, targetLanguage, { preserveTone: true });
      validateTranslatedDubbingText(sourceText, translatedText, targetLanguage);
      const ttsBlob = await runVoiceGenerationQueued(voiceId, () => generateVoice(
        translatedText,
        voiceId,
        isProQuality ? 0.45 : 0.5,
        isProQuality ? 0.82 : 0.75,
        isProQuality ? 0.14 : 0.05,
        { qualityMode },
      ));
      fs.writeFileSync(generatedPath, Buffer.from(await ttsBlob.arrayBuffer()));

      const generatedDuration = await getMediaDurationSeconds(generatedPath).catch(() => 0);
      const stretchResult = await stretchAudioToDuration(
        generatedPath,
        outputPath,
        sourceDurationResult,
        generatedDuration,
        timingMode,
      );

      if (!stretchResult.stretched) {
        fs.copyFileSync(generatedPath, outputPath);
      }

      const outputDuration = await getMediaDurationSeconds(outputPath).catch(() => generatedDuration);

      return res.json({
        audioUrl: `/uploads/${outputFileName}`,
        sourceText,
        translatedText,
        detectedLanguage: transcription.language_code,
        sourceDuration: sourceDurationResult || undefined,
        generatedDuration: generatedDuration || undefined,
        outputDuration: outputDuration || undefined,
        timingMode,
        speedRatio: stretchResult.speedRatio,
        qualityMode,
      });
    } finally {
      try { fs.unlinkSync(sourcePath); } catch {}
      try { fs.unlinkSync(generatedPath); } catch {}
    }
  }));

  // Official Automatic Dubbing v2 flow. Unlike the legacy route above, this
  // lets ElevenLabs preserve speaker identity, emotion, timing and background
  // audio instead of translating into one selected TTS voice and stretching it.
  app.post('/api/ai/elevenlabs/translate-dubbing-v2', aiUpload.single('audio'), asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'audio is required' });

    const apiKey = process.env.ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY || '';
    if (!apiKey) return res.status(503).json({ error: 'ElevenLabs API Key is not configured.' });

    const sourceLanguage = String(req.body?.sourceLanguage || 'auto').trim();
    const targetLanguage = String(req.body?.targetLanguage || 'English').trim();
    const cloningStrength = Math.min(10, Math.max(0, Math.round(Number(req.body?.cloningStrength ?? 7))));
    const outputFormat = req.body?.outputFormat === 'mp4' ? 'mp4' : 'mp3';
    const languageCodeByName: Record<string, string> = {
      English: 'en',
      'Chinese Mandarin': 'zh',
      Japanese: 'ja',
      Korean: 'ko',
      French: 'fr',
      German: 'de',
      Spanish: 'es',
      Portuguese: 'pt',
      Italian: 'it',
      Russian: 'ru',
      Hindi: 'hi',
      Indonesian: 'id',
      Vietnamese: 'vi',
      Thai: 'th',
      Arabic: 'ar',
      Turkish: 'tr',
      Dutch: 'nl',
      Polish: 'pl',
      Swedish: 'sv',
      Danish: 'da',
      Finnish: 'fi',
      Norwegian: 'no',
      Greek: 'el',
      Czech: 'cs',
      Romanian: 'ro',
      Hungarian: 'hu',
      Ukrainian: 'uk',
      Hebrew: 'he',
      Malay: 'ms',
      Filipino: 'fil',
      Bengali: 'bn',
      Urdu: 'ur',
      Tamil: 'ta',
    };
    const sourceCode = sourceLanguage === 'auto' ? undefined : (languageCodeByName[sourceLanguage] || sourceLanguage);
    const targetCode = languageCodeByName[targetLanguage] || targetLanguage;
    const apiBase = 'https://api.elevenlabs.io/v1/dubbing';
    const headers = { 'xi-api-key': apiKey, Accept: 'application/json' };
    const parseApiResponse = async (response: Response) => {
      const text = await response.text();
      let payload: any = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = { detail: text }; }
      if (!response.ok) {
        const detail = typeof payload?.detail === 'string'
          ? payload.detail
          : payload?.detail?.message || payload?.message || response.statusText;
        throw new Error(`ElevenLabs Dubbing API error: ${detail}`);
      }
      return payload;
    };
    const waitFor = async <T>(load: () => Promise<T>, ready: (value: T) => boolean, label: string) => {
      const deadline = Date.now() + 10 * 60 * 1000;
      let lastValue: T | undefined;
      while (Date.now() < deadline) {
        lastValue = await load();
        if (ready(lastValue)) return lastValue;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      throw new Error(`ElevenLabs Dubbing ${label} 超时，请稍后重试。`);
    };

    const sourceExt = getSafeUploadExtension(req.file.originalname, req.file.mimetype, '.wav');
    const sourceIsVideo = req.file.mimetype.startsWith('video/') || ALLOWED_VIDEO_EXTENSIONS.has(sourceExt);
    if (outputFormat === 'mp4' && !sourceIsVideo) {
      return res.status(422).json({ error: '只有上传视频时才能输出 MP4；音频文件请输出 MP3。' });
    }
    const sourceFileName = `translate_v2_source_${randomUUID()}${sourceExt}`;
    const sourcePath = path.join(uploadsDir, sourceFileName);
    const downloadedFileName = `translated_dubbing_v2_raw_${randomUUID()}.flac`;
    const downloadedPath = path.join(uploadsDir, downloadedFileName);
    const outputFileName = `translated_dubbing_v2_${randomUUID()}.${outputFormat}`;
    const outputPath = path.join(uploadsDir, outputFileName);
    fs.writeFileSync(sourcePath, req.file.buffer);

    try {
      const sourceAudio = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype });
      const transcriptionPromise = transcribeSpeech(
        sourceAudio,
        sourceCode,
        false,
      ).catch(() => ({ text: '', language_code: undefined }));
      const sourceDurationPromise = getMediaDurationSeconds(sourcePath).catch(() => 0);

      const createForm = new FormData();
      createForm.append('file', sourceAudio, req.file.originalname || 'source-media');
      createForm.append('model_id', 'dubbing_v2');
      createForm.append('reference', `AI Audio cross-language dubbing · ${req.file.originalname || 'source'}`.slice(0, 500));
      if (sourceCode) createForm.append('source_language', sourceCode);
      const projectResponse = await fetch(`${apiBase}/project`, {
        method: 'POST',
        headers,
        body: createForm,
      });
      const project = await parseApiResponse(projectResponse);
      const projectId = String(project.project_id || '');
      if (!projectId) throw new Error('ElevenLabs Dubbing 未返回项目 ID。');

      const readyProject = await waitFor(
        async () => parseApiResponse(await fetch(`${apiBase}/project/${encodeURIComponent(projectId)}`, { headers })),
        (value: any) => value.status === 'ready' || value.status === 'failed',
        '项目准备',
      );
      if (readyProject.status === 'failed') {
        throw new Error(readyProject.error?.message || 'ElevenLabs Dubbing 项目处理失败。');
      }

      let languageId = Array.isArray(readyProject.language_ids) ? readyProject.language_ids[0] : undefined;
      if (!languageId) {
        const languageResponse = await fetch(`${apiBase}/project/${encodeURIComponent(projectId)}/language`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_language: targetCode,
            voice_settings: { cloning_strength: cloningStrength },
          }),
        });
        const language = await parseApiResponse(languageResponse);
        languageId = String(language.language_id || '');
      }
      if (!languageId) throw new Error('ElevenLabs Dubbing 未返回目标语言 ID。');

      const target = await waitFor(
        async () => parseApiResponse(await fetch(`${apiBase}/project/${encodeURIComponent(projectId)}/language/${encodeURIComponent(languageId)}`, { headers })),
        (value: any) => ['completed', 'failed'].includes(value.status),
        '目标语言生成',
      );
      if (target.status === 'failed') {
        throw new Error(target.error?.message || 'ElevenLabs Dubbing 目标语言生成失败。');
      }
      const signedAudioUrl = target.outputs?.lossless_audio;
      if (!signedAudioUrl) throw new Error('ElevenLabs Dubbing 未返回可下载音频。');

      const signedResponse = await fetch(signedAudioUrl);
      if (!signedResponse.ok) throw new Error(`下载 ElevenLabs Dubbing 音频失败：${signedResponse.statusText}`);
      fs.writeFileSync(downloadedPath, Buffer.from(await signedResponse.arrayBuffer()));
      if (outputFormat === 'mp4') {
        await runFfmpegFile([
          '-y', '-i', sourcePath, '-i', downloadedPath,
          '-map', '0:v:0', '-map', '1:a:0',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', outputPath,
        ], 120000);
      } else {
        await runFfmpegFile([
          '-y', '-i', downloadedPath, '-vn', '-ar', '48000', '-codec:a', 'libmp3lame', '-b:a', '192k', outputPath,
        ], 120000);
      }

      const [transcription, sourceDuration, outputDuration] = await Promise.all([
        transcriptionPromise,
        sourceDurationPromise,
        getMediaDurationSeconds(outputPath).catch(() => 0),
      ]);
      const sourceText = String(transcription.text || '').trim();
      let translatedText = '';
      if (sourceText) {
        translatedText = await translateTextToLanguage(sourceText, targetLanguage, { preserveTone: true }).catch(() => '');
      }

      return res.json({
        audioUrl: `/uploads/${outputFileName}`,
        sourceText,
        translatedText,
        detectedLanguage: transcription.language_code,
        sourceDuration: sourceDuration || undefined,
        generatedDuration: outputDuration || undefined,
        outputDuration: outputDuration || undefined,
        timingMode: 'natural',
        qualityMode: 'pro',
        dubbingModel: 'dubbing_v2',
        cloningStrength,
        outputFormat,
      });
    } finally {
      try { fs.unlinkSync(sourcePath); } catch {}
      try { fs.unlinkSync(downloadedPath); } catch {}
    }
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

  const buildLocalVideoAnalysisFallback = ({
    videoDuration,
    bgmEnabled,
    sfxEnabled,
    dubbingEnabled,
    reason,
  }: {
    videoDuration: unknown;
    bgmEnabled: boolean;
    sfxEnabled: boolean;
    dubbingEnabled: boolean;
    reason?: unknown;
  }) => {
    const durationLimit = parseNumber(videoDuration, 30, 1, 3_600);
    const clips: any[] = [];
    const pushClip = (clip: any) => {
      const startTime = parseNumber(clip.startTime, 0, 0, Math.max(0, durationLimit - 0.1));
      const maxDuration = Math.max(0.1, durationLimit - startTime);
      clips.push({
        ...clip,
        startTime,
        duration: Number(parseNumber(clip.duration, maxDuration, 0.1, maxDuration).toFixed(3)),
      });
    };

    if (bgmEnabled) {
      pushClip({
        id: 'fallback-bgm-1',
        trackId: 'bgm',
        name: '本地兜底背景音乐',
        prompt: 'adaptive cinematic background music bed that follows the full video pacing, neutral mood, clean mix, no vocals',
        startTime: 0,
        duration: durationLimit,
      });
    }

    if (sfxEnabled) {
      const cueTimes = durationLimit < 8
        ? [Math.max(0.2, durationLimit * 0.35)]
        : [
          Math.max(0.2, durationLimit * 0.18),
          Math.max(0.4, durationLimit * 0.5),
          Math.max(0.6, durationLimit * 0.82),
        ];
      cueTimes.forEach((startTime, index) => {
        pushClip({
          id: `fallback-sfx-${index + 1}`,
          trackId: 'sfx',
          name: index === 0 ? '关键动作提示音' : index === 1 ? '画面转场提示音' : '结尾强调音效',
          prompt: index === 0
            ? 'short clean action accent sound effect, game UI friendly, punchy but not harsh'
            : index === 1
              ? 'short transition whoosh sound effect, modern game trailer style, clean high frequency sweep'
              : 'short positive ending accent sound effect, light impact, polished game audio',
          startTime,
          duration: Math.min(2.2, Math.max(0.6, durationLimit * 0.04)),
        });
      });
    }

    const warning = isGeminiUnsupportedLocationError(reason)
      ? '当前 Gemini API 地区不可用，系统已自动改用本地兜底分析；配乐/音效会生成基础时间线，字幕配音需要可用的视觉 AI 服务后再精确识别。'
      : 'AI 画面分析暂时不可用，系统已自动改用本地兜底分析；你可以先继续手动调整时间线，稍后再重试 AI 分析。';

    return {
      clips,
      analysisSource: 'local-fallback',
      analysisPartial: true,
      dubbingCueCount: 0,
      dubbingStatus: dubbingEnabled ? 'unavailable' : 'disabled',
      warning,
    };
  };

  // 7. Video AI Multi-modal Analysis
  app.post('/api/video/analyze', async (req, res) => {
    let ai: ReturnType<typeof getGoogleAI> | undefined;
    let temporaryGeminiFileName: string | undefined;
    try {
      const {
        fileName,
        keyframes,
        videoDuration,
        bgmEnabled: requestedBgmEnabled,
        sfxEnabled: requestedSfxEnabled,
        dubbingEnabled: requestedDubbingEnabled,
        analysisTrack,
      } = req.body;

      // A track re-analysis must use the same analyzer as the full workflow,
      // while limiting both the prompt and the returned clips to one track.
      const scopedAnalysisTrack = analysisTrack === 'bgm'
        || analysisTrack === 'sfx'
        || analysisTrack === 'dubbing'
        ? analysisTrack
        : 'all';
      const bgmEnabled = scopedAnalysisTrack === 'all'
        ? Boolean(requestedBgmEnabled)
        : scopedAnalysisTrack === 'bgm';
      const sfxEnabled = scopedAnalysisTrack === 'all'
        ? Boolean(requestedSfxEnabled)
        : scopedAnalysisTrack === 'sfx';
      const dubbingEnabled = scopedAnalysisTrack === 'all'
        ? Boolean(requestedDubbingEnabled)
        : scopedAnalysisTrack === 'dubbing';
      
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
- 保留视频中每一条可辨识字幕，不限制为少数重点片段。字幕持续多久，整句话后续就会按该区间统一调整语速。

CRITICAL SUBTITLE OCR PASS:
- First scan the entire video chronologically for on-screen subtitles, captions, speech bubbles, lyrics, and dialogue text.
- Every distinct visible subtitle/caption text MUST become one dubbing clip, even if it is very short, appears only once, or is not visually important.
- Do not summarize subtitles. Do not skip "minor" captions. Do not merge adjacent captions when the visible text is different.
- If one subtitle is split across two visual lines, combine both lines into the same text field in natural reading order.
- If multiple subtitle areas are visible at the same time, return separate clips only when they represent different spoken lines; otherwise combine the lines for the same speaker.
- Use best-effort OCR for partially occluded or stylized text, but keep the original language and punctuation as close as possible.
- subtitleStartTime is when the exact visible text first appears. subtitleEndTime is when that exact text disappears or changes to the next text.
- For dubbing clips, coverage is more important than being concise: return all readable subtitle changes, not just key moments.` : ''}

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
  duration: number (该音频块的时长，单位秒；BGM必须从0秒开始并覆盖完整视频，SFX通常为2-4s；Dubbing必须位于字幕硬边界内，高可信口型时使用口型交集，否则使用整段字幕)
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
      let analysisSource: 'client-keyframes' | 'server-ffmpeg' | 'server-native-video' | 'local-fallback' = 'client-keyframes';
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
          await prepareNativeVideoAnalysis(8, 'Dubbing is enabled;');
        } catch (nativeVideoError) {
          const canUseVisualGatewayFallback = isGptTextConfigured();
          if (!canUseVisualGatewayFallback && !bgmEnabled && !sfxEnabled) {
            if (isGeminiUnsupportedLocationError(nativeVideoError)) {
              return res.json(buildLocalVideoAnalysisFallback({
                videoDuration,
                bgmEnabled: Boolean(bgmEnabled),
                sfxEnabled: Boolean(sfxEnabled),
                dubbingEnabled: Boolean(dubbingEnabled),
                reason: nativeVideoError,
              }));
            }
            throw nativeVideoError;
          }
          dubbingAnalysisUnavailable = !canUseVisualGatewayFallback;
          console.warn(
            'Native video analysis failed; falling back to dense server keyframes through the configured visual gateway:',
            nativeVideoError,
          );
          analysisKeyframes = await extractServerVideoKeyframes(
            fileName,
            videoDuration,
            { dense: canUseVisualGatewayFallback },
          );
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

      console.log(`Sending content generation request to Gemini (models/${GEMINI_PRIMARY_MODEL})...`);
      let response: Awaited<ReturnType<typeof generateGeminiContent>>;
      try {
        response = await generateGeminiContent(ai, {
          model: GEMINI_PRIMARY_MODEL,
          contents,
          config: {
            responseMimeType: "application/json",
            maxOutputTokens: dubbingEnabled ? 65_536 : 8_192,
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
      } catch (contentGenerationError) {
        if (isGeminiUnsupportedLocationError(contentGenerationError)) {
          return res.json(buildLocalVideoAnalysisFallback({
            videoDuration,
            bgmEnabled: Boolean(bgmEnabled),
            sfxEnabled: Boolean(sfxEnabled),
            dubbingEnabled: Boolean(dubbingEnabled),
            reason: contentGenerationError,
          }));
        }
        throw contentGenerationError;
      }

      if (!response.text) {
        throw new Error("AI did not return text");
      }
      
      let parsed: any;
      let analysisPartial = false;
      try {
        parsed = JSON.parse(response.text.trim());
      } catch (parseError) {
        const recoveredClips = recoverClipsFromPossiblyTruncatedJson(response.text);
        console.error('Video analysis JSON parse failed:', {
          length: response.text.length,
          preview: response.text.slice(0, 500),
          tail: response.text.slice(-500),
          recoveredClipCount: recoveredClips.length,
          parseError,
        });
        if (recoveredClips.length > 0) {
          analysisPartial = true;
          parsed = { clips: recoveredClips };
        } else {
          throw Object.assign(
            new Error('AI 返回的视频分析结果过长或被截断，请缩短视频、减少字幕密度，或分段上传后重试。'),
            { status: 502 },
          );
        }
      }
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
            if (clip.trackId === 'bgm') {
              return {
                ...clip,
                id: String(clip.id || `clip-${index + 1}`),
                startTime: 0,
                duration: durationLimit,
              };
            }
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
        .filter((clip: any, index: number, allClips: any[]) => (
          clip.trackId !== 'bgm'
          || allClips.findIndex(candidate => candidate.trackId === 'bgm') === index
        ))
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
        analysisPartial,
        dubbingCueCount,
        dubbingStatus: dubbingEnabled
          ? dubbingAnalysisUnavailable ? 'unavailable' : dubbingCueCount > 0 ? 'detected' : 'none-detected'
          : 'disabled',
      });
      
    } catch (err: any) {
      console.error('Error analyzing video:', err);
      // The Gemini SDK may wrap the provider payload in Error.message. Unwrap it
      // here as this route has its own response handler and bypasses the global
      // API error middleware.
      let providerMessage = String(err?.message || '');
      try {
        const parsed = JSON.parse(providerMessage) as { error?: { message?: unknown } };
        const nestedMessage = parsed?.error?.message;
        if (typeof nestedMessage === 'string' && nestedMessage.trim()) providerMessage = nestedMessage;
      } catch {
        // Keep the original message when it is not JSON.
      }
      const clientError = isGeminiUnsupportedLocationError(providerMessage)
        ? Object.assign(
          new Error('当前 Gemini API 所在地区不支持视频分析，请切换到支持 Gemini API 的网络地区，或配置可用的视觉模型网关后重试。'),
          { status: 503 },
        )
        : Object.assign(err, { message: providerMessage });
      return res.status(clientError.status || 500).json({
        error: clientError.message || '视频分析暂时失败，请稍后重试。',
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
      const qualityMode = normalizeElevenLabsQualityMode(req.body?.qualityMode);
      const isProQuality = qualityMode === 'pro';
      
      const apiKey = process.env.ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: 'ElevenLabs API Key is not configured on the server. Please configure it in Settings.' });
      }
      
      const resolvedType = trackType || (trackId === 'dubbing' ? 'dubbing' : trackId === 'bgm' ? 'bgm' : 'sfx');
      const cleanFilename = `el_${trackId}_${Date.now()}.${resolvedType === 'sfx' ? 'wav' : 'mp3'}`;
      const filePath = path.join(uploadsDir, cleanFilename);
      
      if (resolvedType === 'dubbing') {
        // Text to Speech
        const targetVoice = validateVoiceId(voiceId);
        const requestedTargetLanguage = String(req.body?.targetLanguage || '').trim();
        const shouldTranslateDubbingText = Boolean(
          requestedTargetLanguage
          && !['source', 'auto', 'original', 'same'].includes(requestedTargetLanguage.toLowerCase()),
        );
        const sourceText = String(text || '').trim();
        let generationText = sourceText;
        if (shouldTranslateDubbingText) {
          generationText = await translateTextToLanguage(sourceText, requestedTargetLanguage, { preserveTone: true });
          const normalizedGeneratedText = normalizeTextForLanguageCheck(generationText);
          if (!normalizedGeneratedText) {
            throw Object.assign(new Error('目标语种翻译结果为空，已停止生成。'), { status: 502 });
          }
          if (/english|en\b|英文|英语/i.test(requestedTargetLanguage) && !/[a-zA-Z]{2,}/.test(generationText)) {
            throw Object.assign(new Error('目标语言选择为英文，但翻译结果不是英文，已停止生成。'), { status: 502 });
          }
        }
        const buffer = await runVoiceGenerationQueued(targetVoice, async () => {
          if (String(req.body?.voiceSource || '').trim() === 'voice_library') {
            await ensureSharedVoiceAvailable(
              targetVoice,
              String(req.body?.publicOwnerId || '').trim(),
              String(req.body?.voiceName || '').trim(),
            );
          }
          console.log(`ElevenLabs server TTS: text="${generationText}" voiceId=${targetVoice}`);
          const apiResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}`, {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: generationText,
              model_id: "eleven_v3",
              voice_settings: {
                stability: isProQuality ? 0.45 : 0.5,
                similarity_boost: isProQuality ? 0.82 : 0.75,
                style: isProQuality ? 0.14 : 0.05,
                use_speaker_boost: true,
              },
            }),
          });

          if (!apiResponse.ok) {
            const errJson = await apiResponse.json().catch(() => ({}));
            throw new Error(`ElevenLabs TTS Error: ${errJson.detail?.message || apiResponse.statusText}`);
          }

          recordElevenLabsResponseUsage(apiResponse, 'eleven_v3');
          return Buffer.from(await apiResponse.arrayBuffer());
        });
        fs.writeFileSync(filePath, buffer);

      } else if (resolvedType === 'bgm') {
        const musicPrompt = isProQuality
          ? `Broadcast-ready professional background instrumental music, high fidelity, polished mix, wide stereo image, no vocals, no speech: ${prompt}`
          : `AI Music, full background instrumental track, no vocals, no speech: ${prompt}`;
        const targetDuration = parseNumber(duration, 30, 3, 600);
        console.log(
          `ElevenLabs server Music: provider=ElevenLabs Music model=${ELEVENLABS_MUSIC_MODEL} format=${ELEVENLABS_MUSIC_OUTPUT_FORMAT} targetDuration=${targetDuration}s`,
        );
        const musicBlob = await generateMusic(
          musicPrompt,
          targetDuration,
          true,
          undefined,
          { qualityMode },
        );
        fs.writeFileSync(filePath, Buffer.from(await musicBlob.arrayBuffer()));
        
      } else {
        // Sound effect (Sound generation)
        const sfxPrompt = isProQuality
          ? `Studio-quality sound effect, realistic texture, clear spatial depth: ${prompt}`
          : `Sound effect, realistic texture: ${prompt}`;
        console.log(`ElevenLabs server SFX Gen: prompt="${sfxPrompt}" duration=${duration}`);
        
        const apiResponse = await fetch(
          `https://api.elevenlabs.io/v1/sound-generation?output_format=${ELEVENLABS_SOUND_OUTPUT_FORMAT}`,
          {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model_id: ELEVENLABS_SOUND_MODEL,
              text: sfxPrompt,
              duration_seconds: Math.min(30, Math.max(0.5, duration || 4)),
              prompt_influence: isProQuality ? 0.45 : 0.3,
            }),
          },
        );
        
        if (!apiResponse.ok) {
          const errJson = await apiResponse.json().catch(() => ({}));
          throw new Error(`ElevenLabs SFX Gen Error: ${errJson.detail?.message || apiResponse.statusText}`);
        }

        recordElevenLabsResponseUsage(apiResponse, ELEVENLABS_SOUND_MODEL);
        const wavBlob = wrapElevenLabsPcmAsWav(await apiResponse.arrayBuffer());
        const buffer = Buffer.from(await wavBlob.arrayBuffer());
        fs.writeFileSync(filePath, buffer);
      }
      
      return res.json({
        audioUrl: `/uploads/${cleanFilename}`,
        ...(resolvedType === 'bgm' ? {
          provider: 'ElevenLabs Music',
          model: ELEVENLABS_MUSIC_MODEL,
          outputFormat: ELEVENLABS_MUSIC_OUTPUT_FORMAT,
          requestedDuration: parseNumber(duration, 30, 3, 600),
        } : resolvedType === 'sfx' ? {
          provider: 'ElevenLabs Sound Effects',
          model: ELEVENLABS_SOUND_MODEL,
          outputFormat: ELEVENLABS_SOUND_OUTPUT_FORMAT,
        } : {}),
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
        channelMode,
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
      const targetClips = requestedClips.filter((clip: any) => !clip?.muted);
      const validClips = targetClips.filter((clip: any) => {
        if (!clip.audioUrl || typeof clip.audioUrl !== 'string') return false;
        const clipPath = path.join(uploadsDir, path.basename(clip.audioUrl));
        return fs.existsSync(clipPath);
      });
      if (validClips.length !== targetClips.length) {
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
      const normalizedChannelMode = normalizeAudioChannelMode(channelMode);
      const videoAudioOutput = getVideoAudioOutputArgs(
        normalizedAudioFormat,
        normalizedSampleRate,
        normalizedBitrate,
        normalizedBitDepth,
        normalizedChannelMode,
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
          if (clip?.trackType === 'bgm' || clip?.trackId === 'bgm') {
            inputArgs.push('-stream_loop', '-1');
          }
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
        !clip?.muted && (!normalizedTrackId || clip.trackId === normalizedTrackId)
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
        if (clip?.trackType === 'bgm' || clip?.trackId === 'bgm') {
          inputArgs.push('-stream_loop', '-1');
        }
        inputArgs.push('-i', clipPath);
      });

      const filterParts: string[] = [];
      validClips.forEach((clip: any, idx: number) => {
        filterParts.push(buildTimelineAudioFilter(idx, clip, `aud${idx}`));
      });

      const mixInputs = validClips.map((_, idx) => `[aud${idx}]`).join('');
      filterParts.push(`${mixInputs}amix=inputs=${validClips.length}:duration=longest:normalize=0:dropout_transition=0,alimiter=limit=0.95[aout]`);

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
    options: {
      audioFormat: AudioExportFormat;
      sampleRate: number;
      bitrate: string;
      bitDepth: number;
      channelMode: AudioExportChannelMode;
      timelineDuration?: number;
    },
  ) => new Promise<void>((resolve, reject) => {
    const inputArgs: string[] = [];
    targetClips.forEach((clip: any) => {
      const clipFileName = path.basename(String(clip.audioUrl || ''));
      const clipPath = path.join(uploadsDir, clipFileName);
      if (clip?.trackType === 'bgm' || clip?.trackId === 'bgm') {
        inputArgs.push('-stream_loop', '-1');
      }
      inputArgs.push('-i', clipPath);
    });

    const filterParts: string[] = [];
    targetClips.forEach((clip: any, idx: number) => {
      filterParts.push(buildTimelineAudioFilter(idx, clip, `aud${idx}`, options.sampleRate));
    });

    const mixInputs = targetClips.map((_, idx) => `[aud${idx}]`).join('');
    const inferredTimelineDuration = Math.max(
      0.01,
      ...targetClips.map((clip: any) => (
        parseNumber(clip?.startTime, 0, 0, 3_600)
        + parseNumber(clip?.duration, 0.01, 0.01, 3_600)
      )),
    );
    const timelineDuration = parseNumber(
      options.timelineDuration,
      inferredTimelineDuration,
      0.01,
      3_600,
    );
    filterParts.push(
      `${mixInputs}amix=inputs=${targetClips.length}:duration=longest:normalize=0:dropout_transition=0,alimiter=limit=0.95,apad,atrim=duration=${Number(timelineDuration.toFixed(3))}[aout]`,
    );

    const ffmpegArgs = [
      '-y',
      ...inputArgs,
      '-filter_complex', filterParts.join('; '),
      '-map', '[aout]',
      ...getAudioOutputArgs(
        options.audioFormat,
        options.sampleRate,
        options.bitrate,
        options.bitDepth,
        options.channelMode,
      ),
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
      channelMode,
      timelineDuration,
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
    const normalizedChannelMode = normalizeAudioChannelMode(channelMode);
    const requestedClips = Array.isArray(clips) ? clips : [];
    const targetClips = requestedClips.filter((clip: any) => (
      !clip?.muted && (!normalizedTrackId || clip.trackId === normalizedTrackId)
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
      channelMode: normalizedChannelMode,
      timelineDuration,
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
      channelMode,
      timelineDuration,
    } = req.body;

    const normalizedAudioFormat = normalizeAudioExportFormat(audioFormat);
    const normalizedSampleRate = normalizeSampleRate(sampleRate);
    const normalizedBitrate = normalizeAudioBitrate(bitrate);
    const normalizedBitDepth = normalizeBitDepth(bitDepth);
    const normalizedChannelMode = normalizeAudioChannelMode(channelMode);
    const requestedTracks = Array.isArray(tracks) ? tracks : [];
    const requestedClips = Array.isArray(clips) ? clips : [];
    const zip = new JSZip();
    const tempStemPaths: string[] = [];
    const timestamp = Date.now();

    for (const track of requestedTracks) {
      const trackId = typeof track?.id === 'string' ? track.id : '';
      if (!/^[\w-]+$/.test(trackId) || track?.isMuted) continue;
      const trackClips = requestedClips.filter((clip: any) => !clip?.muted && clip.trackId === trackId && clip.audioUrl);
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
        channelMode: normalizedChannelMode,
        timelineDuration,
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
    const rawMessage = String(err?.message || '');
    // Google SDK errors can arrive as a JSON string nested inside Error.message.
    // Unwrap that payload so the client receives an actionable message.
    let providerMessage = rawMessage;
    try {
      const parsed = JSON.parse(rawMessage) as { error?: { message?: unknown } };
      const nestedMessage = parsed?.error?.message;
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) providerMessage = nestedMessage;
    } catch {
      // Keep the original message when it is not JSON.
    }
    const isUnsupportedGeminiLocation = isGeminiUnsupportedLocationError(providerMessage);
    const normalizedMessage = isUnsupportedGeminiLocation
      ? '当前 Gemini API 所在地区不支持视频分析，请切换到支持 Gemini API 的网络地区，或配置可用的视觉模型网关后重试。'
      : providerMessage;
    const status = isPayloadTooLarge
      ? 413
      : isUnsupportedGeminiLocation
        ? 503
        : err?.status || err?.statusCode || 500;
    const isJsonTruncationError = /Unterminated string in JSON|Unexpected end of JSON input|JSON at position/i.test(rawMessage);
    return res.status(status).json({
      error: isPayloadTooLarge
        ? '上传内容超过 100MB 限制。'
        : isJsonTruncationError
          ? 'AI 返回结果过长或被截断，请缩短素材、减少字幕密度，或分段生成后重试。'
        : normalizedMessage || 'Internal Server Error'
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
