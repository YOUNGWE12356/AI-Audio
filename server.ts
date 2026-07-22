import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { exec, execFile } from 'child_process';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { DEFAULT_CATEGORIES, INITIAL_SOUNDS } from './src/data/sfxData';
import multer from 'multer';
import {
  analyzeAudioDesign,
  analyzeAudioDesignVideoFile,
  generateSfxRequirements,
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
  const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
  const MAX_INLINE_MEDIA_BYTES = 24 * 1024 * 1024;
  const MAX_CHUNK_COUNT = 100;
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

  // Ensure directories exist
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
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

  const safeRemoveDirectory = async (directoryPath?: string) => {
    if (!directoryPath || !isPathInside(uploadsDir, directoryPath)) return;
    await fs.promises.rm(directoryPath, { recursive: true, force: true }).catch((error) => {
      console.warn(`Failed to remove temporary directory ${directoryPath}:`, error);
    });
  };

  const parseSafeVideoFilename = (value: unknown) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 255) return null;
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
      },
      timestamp: new Date().toISOString(),
    });
  });

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

  // Configure multer disk storage for multipart/form-data
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      let originalname = file.originalname;
      try {
        originalname = decodeURIComponent(originalname);
      } catch (e) {}
      const ext = path.extname(originalname) || '.wav';
      const base = path.basename(originalname, ext).replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');
      const cleanFilename = `${base}_${Date.now()}${ext}`;
      cb(null, cleanFilename);
    }
  });

  const upload = multer({ 
    storage,
    limits: { fileSize: MAX_UPLOAD_BYTES }
  });

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
          'ffmpeg',
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
    '/api/ai/gemini/audio-design-video',
    upload.single('video'),
    asyncRoute(async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: '请选择一个视频文件。' });
      }

      const uploadedPath = path.resolve(req.file.path);
      const uploadsRoot = `${path.resolve(uploadsDir)}${path.sep}`;
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
        if (!target.video && !target.avatar) {
          return res.status(400).json({ error: '只有影视/广告或 Avatar 模式可使用专业视频分析。' });
        }

        const result = await analyzeAudioDesignVideoFile(
          uploadedPath,
          req.file.mimetype,
          req.file.originalname,
          String(req.body?.requirements || ''),
          target,
          String(req.body?.isInstrumental) !== 'false',
        );
        return res.json(result);
      } finally {
        if (uploadedPath.startsWith(uploadsRoot) && fs.existsSync(uploadedPath)) {
          fs.unlinkSync(uploadedPath);
        }
      }
    }),
  );

  app.post('/api/ai/gemini/regenerate-lyrics', asyncRoute(async (req, res) => {
    const { originalLyrics = '', selectedPart = '', direction = '' } = req.body || {};
    const text = await regenerateLyrics(String(originalLyrics), String(selectedPart), String(direction));
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
          
          const ext = path.extname(originalFilename) || '.wav';
          const base = path.basename(originalFilename, ext).replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');
          const cleanFilename = `${base}_${Date.now()}${ext}`;
          
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

        const cleanFilename = `${safeName.base}_${Date.now()}_${uploadId.slice(-12)}${safeName.extension}`;
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

  // Helper to initialize GoogleGenAI on the server
  const getGoogleAI = () => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not configured.");
    }
    return new GoogleGenAI({ 
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
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
        bgmEnabled,
        sfxEnabled,
        dubbingEnabled,
      } = req.body;
      
      ai = getGoogleAI();
      
      const prompt = `你是一个顶级的多模态AI视频音效与配乐设计师。
请分析提供的信息（包含视频文件或关键帧画面序列、时间点），并针对此视频生成一份极其精确的“音效、配乐和配音时间轴清单 (JSON格式)”。
请提供以下轨道的元素（你可以根据视频画面的时间长度和事件，智能规划最合适的开始时间 startTime 和时长 duration，单位为秒）：
${bgmEnabled ? '1. 背景音乐轨 (bgm): 通常是一段大气合适的 background music，覆盖视频主要时间。' : ''}
${sfxEnabled ? '2. 音效轨 (sfx): 根据视频中的关键动势、场景变化或特效出现，生成对应的短音效。' : ''}
${dubbingEnabled ? '3. 配音轨 (dubbing): 如果画面中有需要配音旁白或人物台词的情景，生成对应的台词文本 (text)。' : ''}

返回的 JSON 必须包含一个 \`clips\` 数组，每项符合以下定义：
{
  id: string (唯一标识，如 "clip-1", "clip-2" 等),
  trackId: "bgm" | "sfx" | "dubbing",
  name: string (简短直观的中文显示名称，如 "科技感启动音效", "深邃太空背景音"),
  prompt: string (详细的英文提示词，用于 ElevenLabs 音效或音乐生成，要求是专业地道的英文描述，如 "deep cinematic low boom synth impact", "lofi chill hip hop background track"),
  text?: string (仅在 trackId 为 "dubbing" 时需要，配音台词的中文文本内容),
  voiceId?: string (仅在 trackId 为 "dubbing" 时需要，推荐的 ElevenLabs 声音ID，Rachel女声为 "21m00Tcm4TlvDq8ikWAM", Adam男声为 "pNInz6obpg7IdgWAs6g8"),
  startTime: number (在时间轴上的起始时间，单位为秒，必须大于等于 0 且小于视频时长),
  duration: number (该音频块的时长，单位秒，BGM通常在10-30s，SFX通常在2-4s，Dubbing通常在2-6s)
}

请确保 clips 数组中只包含启用的轨道类型：
- bgmEnabled: ${bgmEnabled ? '开启' : '关闭'}
- sfxEnabled: ${sfxEnabled ? '开启' : '关闭'}
- dubbingEnabled: ${dubbingEnabled ? '开启' : '关闭'}

视频总时长约为 ${parseNumber(videoDuration, 30, 1, 3_600).toFixed(1)} 秒。所有片段必须严格位于该时长内。
为保证生成速度，请保持结果精炼：BGM 最多 1 段、SFX 最多 8 段、配音最多 3 段，只保留画面中最重要的声音节点。

请只返回符合 JSON 语法的纯数据，不要用 markdown 格式包裹，也不要带 \`\`\`json 开头。`;

      const contents: any[] = [prompt];

      let analysisKeyframes: Array<{ timestamp: number; base64: string }> = [];
      let analysisSource: 'client-keyframes' | 'server-ffmpeg' | 'server-native-video' = 'client-keyframes';
      if (Array.isArray(keyframes) && keyframes.length > 0) {
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

          // The path is validated again before any third-party upload. Invalid,
          // missing, or oversized files therefore never reach Gemini Files API.
          const validatedVideo = await resolveValidatedUploadedVideo(fileName);
          console.warn(
            `FFmpeg fallback unavailable (${ffmpegStatus}); using Gemini native video analysis for ${validatedVideo.displayName}.`,
          );

          let uploadedVideo: any = await ai.files.upload({
            file: validatedVideo.videoPath,
            config: {
              mimeType: validatedVideo.mimeType,
              displayName: validatedVideo.displayName.slice(0, 200),
            },
          });
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
            uploadedVideo = await ai.files.get({ name: uploadedVideo.name });
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
            videoMetadata: { fps: 1 },
          });
          contents.push({ text: prompt });
          analysisSource = 'server-native-video';
        }
      }

      if (analysisSource === 'server-native-video') {
        console.log('Analyzing complete uploaded video with native visual and audio understanding (1 FPS).');
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
                    voiceId: { type: Type.STRING },
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
      const normalizedClips = parsed.clips
        .filter((clip: any) => enabledTracks.has(clip?.trackId))
        .slice(0, 12)
        .map((clip: any, index: number) => {
          const startTime = parseNumber(clip.startTime, 0, 0, Math.max(0, durationLimit - 0.1));
          const maxDuration = Math.max(0.1, durationLimit - startTime);
          return {
            ...clip,
            id: String(clip.id || `clip-${index + 1}`),
            startTime,
            duration: parseNumber(clip.duration, clip.trackId === 'bgm' ? maxDuration : 3, 0.1, maxDuration),
          };
        });
      if (normalizedClips.length === 0) {
        throw new Error('AI 未生成可用的音轨片段，请调整轨道选项后重试。');
      }

      console.log(`Video analysis complete. Found ${normalizedClips.length} clips.`);
      return res.json({ clips: normalizedClips, analysisSource });
      
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
        const targetVoice = voiceId || "21m00Tcm4TlvDq8ikWAM"; // Rachel fallback
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
          
          const loopCmd = `ffmpeg -y -stream_loop -1 -i "${tempPath}" -t ${duration} "${filePath}"`;
          console.log(`Looping BGM to ${duration}s using command: ${loopCmd}`);
          
          await new Promise<void>((resolve) => {
            exec(loopCmd, (err, stdout, stderr) => {
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
      return res.status(500).json({ error: err.message });
    }
  });

  // 9. Mix Video with Audio Timeline Clips using FFmpeg
  app.post('/api/video/mix', (req, res) => {
    try {
      const { videoFileName, clips } = req.body;
      if (!videoFileName) {
        return res.status(400).json({ error: 'videoFileName is required' });
      }

      const inputVideoPath = path.join(uploadsDir, videoFileName);
      if (!fs.existsSync(inputVideoPath)) {
        return res.status(404).json({ error: 'Video file not found' });
      }

      const validClips = (clips || []).filter((c: any) => c.audioUrl && typeof c.audioUrl === 'string');
      if (validClips.length === 0) {
        // No valid audio clips, just return the video directly
        return res.json({ videoUrl: `/uploads/${videoFileName}` });
      }

      // Generate a unique output file name
      const ext = path.extname(videoFileName) || '.mp4';
      const base = path.basename(videoFileName, ext);
      const outputFileName = `mixed_${base}_${Date.now()}${ext}`;
      const outputFilePath = path.join(uploadsDir, outputFileName);

      // Assemble FFmpeg command arguments
      const inputArgs = [`-i "${inputVideoPath}"`];
      
      validClips.forEach((clip: any) => {
        const clipFileName = path.basename(clip.audioUrl);
        const clipPath = path.join(uploadsDir, clipFileName);
        inputArgs.push(`-i "${clipPath}"`);
      });

      // Filter complex to adjust volumes and apply delays
      const filterParts: string[] = [];
      validClips.forEach((clip: any, idx: number) => {
        const delayMs = Math.max(1, Math.round((clip.startTime || 0) * 1000));
        let speedFilter = '';
        if (clip.speed && clip.speed !== 1.0) {
          const clampedSpeed = Math.max(0.5, Math.min(2.0, clip.speed));
          speedFilter = `,atempo=${clampedSpeed}`;
        }
        // Force sample rate of 44100 and channel layout to stereo, then apply speed filter, volume and adelay
        filterParts.push(`[${idx + 1}:a]aformat=sample_rates=44100:channel_layouts=stereo${speedFilter},volume=${clip.volume || 1.0},adelay=${delayMs}|${delayMs}[aud${idx}]`);
      });

      // Mix all delayed streams together
      const mixInputs = validClips.map((_, idx) => `[aud${idx}]`).join('');
      filterParts.push(`${mixInputs}amix=inputs=${validClips.length}:duration=longest:dropout_transition=0[aout]`);

      const filterComplexString = filterParts.join('; ');

      // Assemble FFmpeg command
      // -c:v copy copies the video stream directly without re-encoding, extremely fast!
      // -c:a aac encodes the mixed audio stream to AAC
      const cmd = `ffmpeg -y ${inputArgs.join(' ')} -filter_complex "${filterComplexString}" -map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "${outputFilePath}"`;

      console.log('Running FFmpeg Command:', cmd);

      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          console.error('FFmpeg execution failed:', err, stderr);
          return res.status(500).json({ error: `FFmpeg mixing failed: ${err.message}.` });
        }
        console.log('FFmpeg mixed video successfully created:', outputFileName);
        return res.json({ videoUrl: `/uploads/${outputFileName}` });
      });

    } catch (err: any) {
      console.error('Error in video mixing:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // 10. Mix only audio tracks (all mixed or filtered by trackId) for professional exporting
  app.post('/api/audio/mix-tracks', (req, res) => {
    try {
      const { clips, trackId } = req.body;
      const validClips = (clips || []).filter((c: any) => {
        if (!c.audioUrl || typeof c.audioUrl !== 'string') return false;
        if (trackId && c.trackId !== trackId) return false;
        
        const clipFileName = path.basename(c.audioUrl);
        const clipPath = path.join(uploadsDir, clipFileName);
        return fs.existsSync(clipPath);
      });
      
      if (validClips.length === 0) {
        return res.status(400).json({ error: '没有已生成的、存在于服务器上的音频片段可供导出。请先合成对应的音轨。' });
      }

      const outputFileName = `exported_audio_${trackId || 'mixed'}_${Date.now()}.mp3`;
      const outputFilePath = path.join(uploadsDir, outputFileName);

      const inputArgs: string[] = [];
      validClips.forEach((clip: any) => {
        const clipFileName = path.basename(clip.audioUrl);
        const clipPath = path.join(uploadsDir, clipFileName);
        inputArgs.push(`-i "${clipPath}"`);
      });

      const filterParts: string[] = [];
      validClips.forEach((clip: any, idx: number) => {
        const delayMs = Math.max(1, Math.round((clip.startTime || 0) * 1000));
        let speedFilter = '';
        if (clip.speed && clip.speed !== 1.0) {
          const clampedSpeed = Math.max(0.5, Math.min(2.0, clip.speed));
          speedFilter = `,atempo=${clampedSpeed}`;
        }
        // Force sample rate of 44100 and channel layout to stereo, then apply speed filter, volume and adelay
        filterParts.push(`[${idx}:a]aformat=sample_rates=44100:channel_layouts=stereo${speedFilter},volume=${clip.volume || 1.0},adelay=${delayMs}|${delayMs}[aud${idx}]`);
      });

      const mixInputs = validClips.map((_, idx) => `[aud${idx}]`).join('');
      filterParts.push(`${mixInputs}amix=inputs=${validClips.length}:duration=longest:dropout_transition=0[aout]`);

      const filterComplexString = filterParts.join('; ');
      const cmd = `ffmpeg -y ${inputArgs.join(' ')} -filter_complex "${filterComplexString}" -map "[aout]" -c:a libmp3lame -q:a 2 "${outputFilePath}"`;
      
      console.log('Running Audio Mix FFmpeg Command:', cmd);

      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          console.error('Audio FFmpeg mixing failed:', err, stderr);
          return res.status(500).json({ error: `音频合成失败: ${err.message}` });
        }
        console.log('FFmpeg mixed audio successfully created:', outputFileName);
        return res.json({ audioUrl: `/uploads/${outputFileName}` });
      });

    } catch (err: any) {
      console.error('Error in audio mixing endpoint:', err);
      return res.status(500).json({ error: err.message });
    }
  });

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
