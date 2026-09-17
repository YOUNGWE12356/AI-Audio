import { randomUUID } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import JSZip from 'jszip';
import multer from 'multer';

const MODEL_SLUG = 'roformer-model-bs-roformer-sw-by-jarredou';
const RUNNER_EVENT_PREFIX = '__MUSIC_SEPARATION__';
const EXPECTED_STEMS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;
const STEM_LABELS: Record<(typeof EXPECTED_STEMS)[number], string> = {
  vocals: '人声',
  drums: '鼓',
  bass: '贝斯',
  guitar: '吉他',
  piano: '钢琴',
  other: '其他乐器',
};
const JOB_MANIFEST_FILE = 'job.json';
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WAVEFORM_POINTS = 96;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

type MusicSeparationStatus =
  | 'queued'
  | 'preparing'
  | 'separating'
  | 'analyzing'
  | 'packaging'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled';

type MusicStem = {
  id: string;
  name: string;
  fileName: string;
  audioUrl: string;
  size: number;
  duration: number;
  sampleRate: number;
  rmsDb: number | null;
  peakDb: number | null;
  waveform: number[];
};

type MusicSeparationJob = {
  id: string;
  status: MusicSeparationStatus;
  stage: string;
  progress: number;
  message: string;
  sourceName: string;
  createdAt: string;
  updatedAt: string;
  directoryPath: string;
  sourcePath: string;
  childProcess?: ChildProcess;
  cancelRequested?: boolean;
  error?: string;
  duration?: number;
  sampleRate?: number;
  stems: MusicStem[];
  zipUrl?: string;
};

type PersistedMusicSeparationJob = Omit<MusicSeparationJob, 'childProcess'> & {
  version: 1;
};

type WaveInfo = {
  duration: number;
  sampleRate: number;
  channels: number;
  audioFormat: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataSize: number;
};

type RunnerStem = {
  id?: unknown;
  name?: unknown;
  filePath?: unknown;
  size?: unknown;
  duration?: unknown;
  sampleRate?: unknown;
  rmsDb?: unknown;
  peakDb?: unknown;
  waveform?: unknown;
};

type RunnerEvent = {
  type?: unknown;
  stage?: unknown;
  progress?: unknown;
  message?: unknown;
  duration?: unknown;
  sampleRate?: unknown;
  stems?: unknown;
  [key: string]: unknown;
};

type EngineProbe = {
  installed: boolean;
  cudaAvailable: boolean;
  modelCached: boolean;
  ready: boolean;
  packageVersion?: string;
  torchVersion?: string;
  cudaVersion?: string;
  gpuName?: string;
  checkpointPath?: string;
  error?: string;
};

type MusicSeparationRouterOptions = {
  uploadsDir: string;
  ffmpegBinary: string;
  maxUploadBytes: number;
};

const parseRunnerEvent = (line: string): RunnerEvent | null => {
  const markerIndex = line.indexOf(RUNNER_EVENT_PREFIX);
  if (markerIndex < 0) return null;
  try {
    return JSON.parse(line.slice(markerIndex + RUNNER_EVENT_PREFIX.length)) as RunnerEvent;
  } catch {
    return null;
  }
};

const clampProgress = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
};

const asFiniteNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeWaveform = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, WAVEFORM_POINTS)
    .map(point => Math.max(0, Math.min(4, asFiniteNumber(point))));
};

const sanitizeExtension = (fileName: string, mimeType: string) => {
  const candidate = path.extname(fileName).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(candidate)) return candidate;
  if (mimeType.startsWith('video/')) return '.mp4';
  return '.wav';
};

const isSupportedMedia = (file: Express.Multer.File) => (
  file.mimetype.startsWith('audio/')
  || file.mimetype.startsWith('video/')
  || /\.(aac|aif|aiff|flac|m4a|mp3|mp4|mov|mkv|ogg|opus|wav|webm)$/i.test(file.originalname)
);

const isPathInside = (root: string, candidate: string) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
};

const trimProcessOutput = (value: string, limit = 8_000) => (
  value.length > limit ? value.slice(-limit) : value
);

const readWaveInfo = (filePath: string): WaveInfo | null => {
  const stat = fs.statSync(filePath);
  const headerSize = Math.min(stat.size, 1024 * 1024);
  if (headerSize < 44) return null;
  const header = Buffer.allocUnsafe(headerSize);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const riff = header.toString('ascii', 0, 4);
  if ((riff !== 'RIFF' && riff !== 'RF64') || header.toString('ascii', 8, 12) !== 'WAVE') return null;

  let sampleRate = 0;
  let channels = 0;
  let audioFormat = 0;
  let bitsPerSample = 0;
  let blockAlign = 0;
  let dataOffset = 0;
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= header.length) {
    const chunkId = header.toString('ascii', offset, offset + 4);
    const chunkSize = header.readUInt32LE(offset + 4);
    const contentOffset = offset + 8;
    if (chunkId === 'fmt ' && chunkSize >= 16 && contentOffset + 16 <= header.length) {
      audioFormat = header.readUInt16LE(contentOffset);
      channels = header.readUInt16LE(contentOffset + 2);
      sampleRate = header.readUInt32LE(contentOffset + 4);
      blockAlign = header.readUInt16LE(contentOffset + 12);
      bitsPerSample = header.readUInt16LE(contentOffset + 14);
    } else if (chunkId === 'data') {
      dataOffset = contentOffset;
      dataSize = chunkSize === 0xffffffff
        ? Math.max(0, stat.size - dataOffset)
        : Math.min(chunkSize, Math.max(0, stat.size - dataOffset));
      break;
    }
    const nextOffset = contentOffset + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset || nextOffset > header.length) break;
    offset = nextOffset;
  }
  if (!sampleRate || !channels || !bitsPerSample || !blockAlign || !dataOffset || !dataSize) return null;
  return {
    duration: dataSize / (sampleRate * blockAlign),
    sampleRate,
    channels,
    audioFormat,
    bitsPerSample,
    blockAlign,
    dataOffset,
    dataSize,
  };
};

const readWaveformPeaks = (filePath: string, info: WaveInfo) => {
  const bytesPerSample = Math.ceil(info.bitsPerSample / 8);
  const supported = info.audioFormat === 3 && info.bitsPerSample === 32
    || info.audioFormat === 1 && [8, 16, 24, 32].includes(info.bitsPerSample);
  const totalFrames = Math.floor(info.dataSize / info.blockAlign);
  if (!supported || totalFrames <= 0 || bytesPerSample * info.channels > info.blockAlign) {
    return Array.from({ length: WAVEFORM_POINTS }, () => 0);
  }

  const readSample = (buffer: Buffer, offset: number) => {
    if (info.audioFormat === 3) return buffer.readFloatLE(offset);
    if (info.bitsPerSample === 8) return (buffer.readUInt8(offset) - 128) / 128;
    if (info.bitsPerSample === 16) return buffer.readInt16LE(offset) / 32_768;
    if (info.bitsPerSample === 24) return buffer.readIntLE(offset, 3) / 8_388_608;
    return buffer.readInt32LE(offset) / 2_147_483_648;
  };

  const maxWindowFrames = 2_048;
  const sampleBuffer = Buffer.allocUnsafe(maxWindowFrames * info.blockAlign);
  const peaks = Array.from({ length: WAVEFORM_POINTS }, () => 0);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    for (let pointIndex = 0; pointIndex < WAVEFORM_POINTS; pointIndex += 1) {
      const pointStart = Math.floor((pointIndex * totalFrames) / WAVEFORM_POINTS);
      const pointEnd = Math.max(pointStart + 1, Math.floor(((pointIndex + 1) * totalFrames) / WAVEFORM_POINTS));
      const pointFrames = pointEnd - pointStart;
      const windowFrames = Math.min(maxWindowFrames, pointFrames);
      const windowStarts = new Set([
        pointStart,
        pointStart + Math.max(0, Math.floor((pointFrames - windowFrames) / 2)),
        Math.max(pointStart, pointEnd - windowFrames),
      ]);
      let pointPeak = 0;
      windowStarts.forEach(windowStart => {
        const bytesToRead = windowFrames * info.blockAlign;
        const bytesRead = fs.readSync(
          descriptor,
          sampleBuffer,
          0,
          bytesToRead,
          info.dataOffset + windowStart * info.blockAlign,
        );
        const framesRead = Math.floor(bytesRead / info.blockAlign);
        for (let frameIndex = 0; frameIndex < framesRead; frameIndex += 1) {
          const frameOffset = frameIndex * info.blockAlign;
          for (let channelIndex = 0; channelIndex < info.channels; channelIndex += 1) {
            const sample = readSample(sampleBuffer, frameOffset + channelIndex * bytesPerSample);
            if (Number.isFinite(sample)) pointPeak = Math.max(pointPeak, Math.abs(sample));
          }
        }
      });
      peaks[pointIndex] = Number(pointPeak.toFixed(6));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return peaks;
};

export function createMusicSeparationRouter({
  uploadsDir,
  ffmpegBinary,
  maxUploadBytes,
}: MusicSeparationRouterOptions) {
  const router = express.Router();
  const jobs = new Map<string, MusicSeparationJob>();
  const queue: string[] = [];
  let activeJobId: string | null = null;
  let cachedProbe: { value: EngineProbe; expiresAt: number } | null = null;

  const toolDir = path.resolve(process.cwd(), 'tools', 'music-separation');
  const defaultPython = process.platform === 'win32'
    ? path.join(toolDir, '.venv', 'Scripts', 'python.exe')
    : path.join(toolDir, '.venv', 'bin', 'python');
  const pythonPath = path.resolve(process.env.MUSIC_SEPARATION_PYTHON || defaultPython);
  const runnerPath = path.resolve(
    process.env.MUSIC_SEPARATION_SCRIPT || path.join(toolDir, 'separate_stems.py'),
  );
  const modelsDir = path.resolve(
    process.env.MUSIC_SEPARATION_MODELS_DIR || path.join(toolDir, 'models'),
  );
  const timeoutMs = Math.max(
    60_000,
    Math.min(12 * 60 * 60_000, Number(process.env.MUSIC_SEPARATION_TIMEOUT_MS) || 2 * 60 * 60_000),
  );

  const validStatuses = new Set<MusicSeparationStatus>([
    'queued',
    'preparing',
    'separating',
    'analyzing',
    'packaging',
    'completed',
    'failed',
    'cancelling',
    'cancelled',
  ]);

  const getManifestPath = (directoryPath: string) => path.resolve(directoryPath, JOB_MANIFEST_FILE);

  const persistJob = (job: MusicSeparationJob) => {
    if (!fs.existsSync(job.directoryPath)) return;
    const manifestPath = getManifestPath(job.directoryPath);
    if (!isPathInside(job.directoryPath, manifestPath)) return;
    const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
    const { childProcess: _childProcess, ...serializableJob } = job;
    const persisted: PersistedMusicSeparationJob = { version: 1, ...serializableJob };
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(persisted), 'utf8');
      fs.renameSync(temporaryPath, manifestPath);
    } catch (error) {
      try { fs.unlinkSync(temporaryPath); } catch {}
      console.warn(`[music-separation] Unable to persist job ${job.id}:`, error);
    }
  };

  const updateJob = (job: MusicSeparationJob, patch: Partial<MusicSeparationJob>) => {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    persistJob(job);
  };

  const restorePersistedJob = (id: string): MusicSeparationJob | null => {
    if (!JOB_ID_PATTERN.test(id)) return null;
    const directoryPath = path.resolve(uploadsDir, `music-stems-${id}`);
    if (!isPathInside(uploadsDir, directoryPath)) return null;
    const manifestPath = getManifestPath(directoryPath);
    if (!fs.existsSync(manifestPath)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<PersistedMusicSeparationJob>;
      const status = raw.status as MusicSeparationStatus;
      if (raw.version !== 1 || raw.id !== id || !validStatuses.has(status)) return null;
      const outputDir = path.resolve(directoryPath, 'stems');
      const validIds = new Set<string>(EXPECTED_STEMS);
      const stems = Array.isArray(raw.stems) ? raw.stems.flatMap((stem): MusicStem[] => {
        if (!stem || typeof stem !== 'object') return [];
        const idValue = typeof stem.id === 'string' ? stem.id : '';
        const fileName = typeof stem.fileName === 'string' ? stem.fileName : '';
        const filePath = fileName ? path.resolve(outputDir, fileName) : '';
        if (
          !validIds.has(idValue)
          || !fileName
          || path.basename(fileName) !== fileName
          || !filePath
          || !isPathInside(outputDir, filePath)
          || !fs.existsSync(filePath)
        ) return [];
        const stemStat = fs.statSync(filePath);
        const persistedWaveform = normalizeWaveform(stem.waveform);
        const waveInfo = persistedWaveform.length === 0 ? readWaveInfo(filePath) : null;
        return [{
          id: idValue,
          name: typeof stem.name === 'string' ? stem.name : STEM_LABELS[idValue as keyof typeof STEM_LABELS],
          fileName,
          audioUrl: `/uploads/${encodeURIComponent(path.basename(directoryPath))}/stems/${encodeURIComponent(fileName)}`,
          size: stemStat.size,
          duration: asFiniteNumber(stem.duration),
          sampleRate: asFiniteNumber(stem.sampleRate, 44_100),
          rmsDb: typeof stem.rmsDb === 'number' && Number.isFinite(stem.rmsDb) ? stem.rmsDb : null,
          peakDb: typeof stem.peakDb === 'number' && Number.isFinite(stem.peakDb) ? stem.peakDb : null,
          waveform: persistedWaveform.length > 0
            ? persistedWaveform
            : waveInfo ? readWaveformPeaks(filePath, waveInfo) : [],
        }];
      }) : [];
      const zipPath = path.resolve(directoryPath, `music-stems-${id}.zip`);
      if (status === 'completed' && (stems.length === 0 || !fs.existsSync(zipPath))) return null;
      const rawSourcePath = typeof raw.sourcePath === 'string' ? path.resolve(raw.sourcePath) : '';
      const sourcePath = rawSourcePath && isPathInside(directoryPath, rawSourcePath)
        ? rawSourcePath
        : path.resolve(directoryPath, 'source');
      const directoryStat = fs.statSync(directoryPath);
      const job: MusicSeparationJob = {
        id,
        status,
        stage: typeof raw.stage === 'string' ? raw.stage : status,
        progress: clampProgress(raw.progress, status === 'completed' ? 100 : 0),
        message: typeof raw.message === 'string' ? raw.message : '已恢复分轨任务。',
        sourceName: typeof raw.sourceName === 'string' ? raw.sourceName : '已恢复的音乐素材',
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : directoryStat.birthtime.toISOString(),
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : directoryStat.mtime.toISOString(),
        directoryPath,
        sourcePath,
        cancelRequested: Boolean(raw.cancelRequested),
        error: typeof raw.error === 'string' ? raw.error : undefined,
        duration: raw.duration === undefined ? undefined : asFiniteNumber(raw.duration),
        sampleRate: raw.sampleRate === undefined ? undefined : asFiniteNumber(raw.sampleRate, 44_100),
        stems,
        zipUrl: status === 'completed' ? `/api/audio/music-separation/jobs/${id}/download` : undefined,
      };
      jobs.set(id, job);
      persistJob(job);
      if (!TERMINAL_STATUSES.has(job.status)) {
        updateJob(job, {
          status: 'failed',
          stage: 'failed',
          progress: 0,
          message: '服务重启导致本次任务中断。',
          error: '本次分轨未完整完成，请重新选择原素材后重试。',
          cancelRequested: false,
        });
      }
      return job;
    } catch (error) {
      console.warn(`[music-separation] Unable to restore job ${id}:`, error);
      return null;
    }
  };

  const recoverLegacyCompletedJob = (id: string): MusicSeparationJob | null => {
    if (!JOB_ID_PATTERN.test(id)) return null;
    const directoryPath = path.resolve(uploadsDir, `music-stems-${id}`);
    if (!isPathInside(uploadsDir, directoryPath) || !fs.existsSync(directoryPath)) return null;
    const outputDir = path.resolve(directoryPath, 'stems');
    const zipPath = path.resolve(directoryPath, `music-stems-${id}.zip`);
    if (!fs.existsSync(outputDir) || !fs.existsSync(zipPath)) return null;
    try {
      const outputFiles = fs.readdirSync(outputDir);
      const stems = EXPECTED_STEMS.flatMap((stemId): MusicStem[] => {
        const fileName = outputFiles.find(candidate => candidate.endsWith(`_${stemId}.wav`));
        if (!fileName) return [];
        const filePath = path.resolve(outputDir, fileName);
        if (!isPathInside(outputDir, filePath) || !fs.statSync(filePath).isFile()) return [];
        const waveInfo = readWaveInfo(filePath);
        if (!waveInfo) return [];
        return [{
          id: stemId,
          name: STEM_LABELS[stemId],
          fileName,
          audioUrl: `/uploads/${encodeURIComponent(path.basename(directoryPath))}/stems/${encodeURIComponent(fileName)}`,
          size: fs.statSync(filePath).size,
          duration: waveInfo.duration,
          sampleRate: waveInfo.sampleRate,
          rmsDb: null,
          peakDb: null,
          waveform: readWaveformPeaks(filePath, waveInfo),
        }];
      });
      if (stems.length === 0) return null;
      const directoryStat = fs.statSync(directoryPath);
      const job: MusicSeparationJob = {
        id,
        status: 'completed',
        stage: 'completed',
        progress: 100,
        message: `已恢复服务重启前完成的 ${stems.length} 条独立轨道`,
        sourceName: '已恢复的音乐素材.wav',
        createdAt: directoryStat.birthtime.toISOString(),
        updatedAt: directoryStat.mtime.toISOString(),
        directoryPath,
        sourcePath: path.resolve(directoryPath, 'input', 'mixture.wav'),
        duration: stems[0].duration,
        sampleRate: stems[0].sampleRate,
        stems,
        zipUrl: `/api/audio/music-separation/jobs/${id}/download`,
      };
      jobs.set(id, job);
      persistJob(job);
      return job;
    } catch (error) {
      console.warn(`[music-separation] Unable to recover legacy job ${id}:`, error);
      return null;
    }
  };

  const getJob = (id: string) => (
    jobs.get(id)
    || restorePersistedJob(id)
    || recoverLegacyCompletedJob(id)
  );

  const publicJob = (job: MusicSeparationJob) => ({
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    sourceName: job.sourceName,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    queuePosition: job.status === 'queued'
      ? Math.max(1, queue.filter(id => jobs.get(id)?.status === 'queued').indexOf(job.id) + 1)
      : 0,
    duration: job.duration,
    sampleRate: job.sampleRate,
    stems: job.stems,
    zipUrl: job.zipUrl,
    error: job.error,
    canCancel: !TERMINAL_STATUSES.has(job.status),
  });

  const runProbe = async (force = false): Promise<EngineProbe> => {
    if (!force && cachedProbe && cachedProbe.expiresAt > Date.now()) return cachedProbe.value;
    if (!fs.existsSync(pythonPath) || !fs.existsSync(runnerPath)) {
      const value: EngineProbe = {
        installed: false,
        cudaAvailable: false,
        modelCached: false,
        ready: false,
        error: '本地高质量分轨环境尚未安装。',
      };
      cachedProbe = { value, expiresAt: Date.now() + 10_000 };
      return value;
    }

    const value = await new Promise<EngineProbe>((resolve) => {
      execFile(
        pythonPath,
        [runnerPath, '--probe', '--models-dir', modelsDir],
        { timeout: 30_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const event = String(stdout || '')
            .split(/\r?\n/)
            .map(parseRunnerEvent)
            .find(item => item?.type === 'probe');
          if (event) {
            resolve({
              installed: Boolean(event.installed),
              cudaAvailable: Boolean(event.cudaAvailable),
              modelCached: Boolean(event.modelCached),
              ready: Boolean(event.ready),
              packageVersion: typeof event.packageVersion === 'string' ? event.packageVersion : undefined,
              torchVersion: typeof event.torchVersion === 'string' ? event.torchVersion : undefined,
              cudaVersion: typeof event.cudaVersion === 'string' ? event.cudaVersion : undefined,
              gpuName: typeof event.gpuName === 'string' ? event.gpuName : undefined,
              checkpointPath: typeof event.checkpointPath === 'string' ? event.checkpointPath : undefined,
              error: typeof event.error === 'string' ? event.error : undefined,
            });
            return;
          }
          resolve({
            installed: false,
            cudaAvailable: false,
            modelCached: false,
            ready: false,
            error: trimProcessOutput(String(stderr || error?.message || '无法检测本地分轨环境。')),
          });
        },
      );
    });
    cachedProbe = { value, expiresAt: Date.now() + 10_000 };
    return value;
  };

  const runFfmpeg = (args: string[]) => new Promise<void>((resolve, reject) => {
    execFile(
      ffmpegBinary,
      args,
      { timeout: 20 * 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        reject(new Error(
          /ENOENT|not recognized|not found/i.test(`${error.message}\n${stderr}`)
            ? '本地 FFmpeg 不可用，无法提取待分轨音频。'
            : `音频预处理失败：${trimProcessOutput(String(stderr || error.message)).split(/\r?\n/).slice(-1)[0]}`,
        ));
      },
    );
  });

  const generateZip = async (job: MusicSeparationJob, zipPath: string) => {
    const zip = new JSZip();
    job.stems.forEach((stem, index) => {
      const filePath = path.resolve(job.directoryPath, 'stems', stem.fileName);
      zip.file(`${String(index + 1).padStart(2, '0')}_${stem.id}.wav`, fs.createReadStream(filePath));
    });
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const zipStream = zip.generateNodeStream({
        type: 'nodebuffer',
        streamFiles: true,
        compression: 'STORE',
      });
      zipStream.on('error', reject);
      output.on('error', reject);
      output.on('finish', resolve);
      zipStream.pipe(output);
    });
  };

  const runModel = (
    job: MusicSeparationJob,
    inputPath: string,
    outputDir: string,
  ) => new Promise<RunnerEvent>((resolve, reject) => {
    const child = spawn(
      pythonPath,
      [runnerPath, '--input', inputPath, '--output-dir', outputDir, '--models-dir', modelsDir],
      {
        cwd: toolDir,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
          BS_ROFORMER_MODELS_PATH: modelsDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    job.childProcess = child;
    let stdoutBuffer = '';
    let stderrTail = '';
    let resultEvent: RunnerEvent | null = null;
    let runnerError = '';
    let settled = false;

    const handleLine = (line: string) => {
      const event = parseRunnerEvent(line);
      if (!event) return;
      if (event.type === 'stage') {
        const stage = typeof event.stage === 'string' ? event.stage : job.stage;
        const status: MusicSeparationStatus = stage === 'analyzing' ? 'analyzing' : 'separating';
        updateJob(job, {
          status,
          stage,
          progress: clampProgress(event.progress, job.progress),
          message: typeof event.message === 'string' ? event.message : job.message,
        });
      } else if (event.type === 'result') {
        resultEvent = event;
      } else if (event.type === 'error') {
        runnerError = typeof event.message === 'string' ? event.message : '';
      }
    };

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      lines.forEach(handleLine);
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderrTail = trimProcessOutput(stderrTail + chunk);
    });

    const timer = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error('高质量分轨超过最大运行时间，任务已停止。'));
      }
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      job.childProcess = undefined;
      if (stdoutBuffer) handleLine(stdoutBuffer);
      if (settled) return;
      settled = true;
      if (job.cancelRequested) {
        reject(Object.assign(new Error('任务已取消。'), { code: 'JOB_CANCELLED' }));
      } else if (code !== 0) {
        reject(new Error(runnerError || stderrTail.split(/\r?\n/).filter(Boolean).slice(-1)[0] || '本地模型分轨失败。'));
      } else if (!resultEvent) {
        reject(new Error('本地模型已退出，但没有返回有效的分轨结果。'));
      } else {
        resolve(resultEvent);
      }
    });
  });

  const processJob = async (job: MusicSeparationJob) => {
    const inputDir = path.resolve(job.directoryPath, 'input');
    const outputDir = path.resolve(job.directoryPath, 'stems');
    const normalizedInputPath = path.resolve(inputDir, 'mixture.wav');
    const zipPath = path.resolve(job.directoryPath, `music-stems-${job.id}.zip`);

    try {
      if (job.cancelRequested) throw Object.assign(new Error('任务已取消。'), { code: 'JOB_CANCELLED' });
      await fs.promises.mkdir(inputDir, { recursive: true });
      await fs.promises.mkdir(outputDir, { recursive: true });
      updateJob(job, {
        status: 'preparing',
        stage: 'preparing',
        progress: 6,
        message: '正在提取并标准化音频',
      });
      await runFfmpeg([
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-i', job.sourcePath,
        '-map', '0:a:0',
        '-vn',
        '-sn',
        '-map_metadata', '-1',
        '-ac', '2',
        '-ar', '44100',
        '-c:a', 'pcm_f32le',
        normalizedInputPath,
      ]);
      await fs.promises.unlink(job.sourcePath).catch(() => undefined);
      if (job.cancelRequested) throw Object.assign(new Error('任务已取消。'), { code: 'JOB_CANCELLED' });

      const result = await runModel(job, normalizedInputPath, outputDir);
      if (job.cancelRequested) throw Object.assign(new Error('任务已取消。'), { code: 'JOB_CANCELLED' });
      const runnerStems = Array.isArray(result.stems) ? result.stems as RunnerStem[] : [];
      const validIds = new Set<string>(EXPECTED_STEMS);
      const stems = runnerStems.flatMap((stem): MusicStem[] => {
        const id = typeof stem.id === 'string' ? stem.id : '';
        const filePath = typeof stem.filePath === 'string' ? path.resolve(stem.filePath) : '';
        if (!validIds.has(id) || !filePath || !isPathInside(outputDir, filePath) || !fs.existsSync(filePath)) return [];
        const fileName = path.basename(filePath);
        const runnerWaveform = normalizeWaveform(stem.waveform);
        const waveInfo = runnerWaveform.length === 0 ? readWaveInfo(filePath) : null;
        return [{
          id,
          name: typeof stem.name === 'string' ? stem.name : id,
          fileName,
          audioUrl: `/uploads/${encodeURIComponent(path.basename(job.directoryPath))}/stems/${encodeURIComponent(fileName)}`,
          size: asFiniteNumber(stem.size, fs.statSync(filePath).size),
          duration: asFiniteNumber(stem.duration),
          sampleRate: asFiniteNumber(stem.sampleRate, 44_100),
          rmsDb: asFiniteNumber(stem.rmsDb, -80),
          peakDb: asFiniteNumber(stem.peakDb, -80),
          waveform: runnerWaveform.length > 0
            ? runnerWaveform
            : waveInfo ? readWaveformPeaks(filePath, waveInfo) : [],
        }];
      });
      if (stems.length === 0) throw new Error('模型没有返回可用的独立轨道。');

      updateJob(job, {
        status: 'packaging',
        stage: 'packaging',
        progress: 94,
        message: '正在整理 WAV 轨道与 ZIP',
        duration: asFiniteNumber(result.duration),
        sampleRate: asFiniteNumber(result.sampleRate, 44_100),
        stems,
      });
      await generateZip(job, zipPath);
      await fs.promises.unlink(normalizedInputPath).catch(() => undefined);
      updateJob(job, {
        status: 'completed',
        stage: 'completed',
        progress: 100,
        message: `高质量分轨完成，共生成 ${stems.length} 条有效轨道`,
        zipUrl: `/api/audio/music-separation/jobs/${job.id}/download`,
      });
    } catch (error) {
      const isCancelled = job.cancelRequested || (error as { code?: string })?.code === 'JOB_CANCELLED';
      updateJob(job, isCancelled ? {
        status: 'cancelled',
        stage: 'cancelled',
        progress: 0,
        message: '任务已取消。',
        error: undefined,
      } : {
        status: 'failed',
        stage: 'failed',
        message: '高质量分轨失败。',
        error: error instanceof Error ? error.message : String(error),
      });
      await fs.promises.unlink(job.sourcePath).catch(() => undefined);
      await fs.promises.unlink(normalizedInputPath).catch(() => undefined);
      await fs.promises.unlink(zipPath).catch(() => undefined);
      console.error(`[music-separation] Job ${job.id} failed:`, error);
    }
  };

  const startNextJob = () => {
    if (activeJobId) return;
    const nextJobId = queue.shift();
    if (!nextJobId) return;
    const job = jobs.get(nextJobId);
    if (!job || job.status !== 'queued' || job.cancelRequested) {
      startNextJob();
      return;
    }
    activeJobId = job.id;
    void processJob(job).finally(() => {
      activeJobId = null;
      startNextJob();
    });
  };

  const storage = multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadsDir),
    filename: (_req, file, callback) => {
      callback(null, `music-separation-upload-${randomUUID()}${sanitizeExtension(file.originalname, file.mimetype)}`);
    },
  });
  const upload = multer({ storage, limits: { fileSize: maxUploadBytes } });

  router.get('/engine', async (_req, res, next) => {
    try {
      const probe = await runProbe();
      return res.json({
        ...probe,
        engine: 'bs-roformer-sw-local',
        model: MODEL_SLUG,
        stemCount: EXPECTED_STEMS.length,
        stems: [...EXPECTED_STEMS],
        concurrency: 1,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/jobs', upload.single('media'), async (req, res, next) => {
    const uploadedPath = req.file?.path;
    try {
      if (!req.file) return res.status(400).json({ error: '请选择需要分轨的音频或视频。' });
      if (!isSupportedMedia(req.file)) {
        await fs.promises.unlink(req.file.path).catch(() => undefined);
        return res.status(415).json({ error: '文件不是受支持的音频或视频格式。' });
      }
      const probe = await runProbe();
      if (!probe.ready) {
        await fs.promises.unlink(req.file.path).catch(() => undefined);
        const reason = !probe.installed
          ? '本地分轨环境尚未安装。'
          : !probe.cudaAvailable
            ? 'CUDA 不可用，当前高质量方案需要 NVIDIA GPU。'
            : '高质量 6 轨模型尚未下载完成。';
        return res.status(503).json({ code: 'MUSIC_SEPARATION_NOT_READY', error: reason, engine: probe });
      }

      const id = randomUUID();
      const directoryPath = path.resolve(uploadsDir, `music-stems-${id}`);
      if (!isPathInside(uploadsDir, directoryPath)) throw new Error('无法创建安全的分轨任务目录。');
      await fs.promises.mkdir(directoryPath, { recursive: true });
      const sourcePath = path.resolve(directoryPath, `source${sanitizeExtension(req.file.originalname, req.file.mimetype)}`);
      await fs.promises.rename(req.file.path, sourcePath);
      const now = new Date().toISOString();
      const job: MusicSeparationJob = {
        id,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        message: activeJobId ? '任务已进入 GPU 串行队列' : '任务已创建，等待本地 GPU',
        sourceName: req.file.originalname,
        createdAt: now,
        updatedAt: now,
        directoryPath,
        sourcePath,
        stems: [],
      };
      jobs.set(id, job);
      persistJob(job);
      queue.push(id);
      startNextJob();
      return res.status(202).json(publicJob(job));
    } catch (error) {
      if (uploadedPath) await fs.promises.unlink(uploadedPath).catch(() => undefined);
      return next(error);
    }
  });

  router.get('/jobs/:id', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '分轨任务不存在或服务已重启。' });
    return res.json(publicJob(job));
  });

  router.delete('/jobs/:id', async (req, res, next) => {
    try {
      const job = getJob(req.params.id);
      if (!job) return res.status(404).json({ error: '分轨任务不存在或服务已重启。' });
      if (TERMINAL_STATUSES.has(job.status)) return res.json(publicJob(job));
      job.cancelRequested = true;
      if (job.status === 'queued') {
        const queueIndex = queue.indexOf(job.id);
        if (queueIndex >= 0) queue.splice(queueIndex, 1);
        updateJob(job, { status: 'cancelled', stage: 'cancelled', progress: 0, message: '任务已取消。' });
        await fs.promises.rm(job.directoryPath, { recursive: true, force: true });
      } else {
        updateJob(job, { status: 'cancelling', stage: 'cancelling', message: '正在停止本地模型任务' });
        job.childProcess?.kill();
      }
      return res.json(publicJob(job));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/jobs/:id/download', (req, res) => {
    const job = getJob(req.params.id);
    if (!job || job.status !== 'completed') return res.status(404).json({ error: '分轨压缩包尚未生成。' });
    const zipPath = path.resolve(job.directoryPath, `music-stems-${job.id}.zip`);
    if (!isPathInside(job.directoryPath, zipPath) || !fs.existsSync(zipPath)) {
      return res.status(404).json({ error: '分轨压缩包已失效，请重新处理。' });
    }
    const baseName = path.basename(job.sourceName, path.extname(job.sourceName))
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .slice(0, 80) || 'music';
    return res.download(zipPath, `${baseName}_stems.zip`);
  });

  return router;
}
