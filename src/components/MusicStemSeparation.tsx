import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileAudio,
  FileVideo,
  Headphones,
  Layers,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Upload,
  Volume2,
  VolumeX,
  Workflow,
  X,
} from 'lucide-react';

type EngineStatus = {
  installed: boolean;
  cudaAvailable: boolean;
  modelCached: boolean;
  ready: boolean;
  engine: string;
  model: string;
  stemCount: number;
  gpuName?: string;
  packageVersion?: string;
  torchVersion?: string;
  cudaVersion?: string;
  error?: string;
};

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

type SeparationJob = {
  id: string;
  status: 'queued' | 'preparing' | 'separating' | 'analyzing' | 'packaging' | 'completed' | 'failed' | 'cancelling' | 'cancelled';
  stage: string;
  progress: number;
  message: string;
  sourceName: string;
  queuePosition: number;
  duration?: number;
  sampleRate?: number;
  stems: MusicStem[];
  zipUrl?: string;
  error?: string;
  canCancel: boolean;
};

type MusicStemSeparationProps = {
  onSendToWorkstation: (files: File[]) => void;
};

const ACTIVE_STATUSES = new Set(['queued', 'preparing', 'separating', 'analyzing', 'packaging', 'cancelling']);
const RESTORED_JOB_KEY = 'ai-audio-music-separation-job';
const TRACK_COLORS: Record<string, string> = {
  vocals: 'bg-rose-500',
  drums: 'bg-amber-500',
  bass: 'bg-indigo-500',
  guitar: 'bg-emerald-500',
  piano: 'bg-sky-500',
  other: 'bg-slate-500',
};
const TRACK_WAVE_COLORS: Record<string, string> = {
  vocals: '#f43f5e',
  drums: '#f59e0b',
  bass: '#6366f1',
  guitar: '#10b981',
  piano: '#0ea5e9',
  other: '#64748b',
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const formatTime = (seconds: number) => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const formatDb = (value: number | null) => (
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} dB` : '--'
);

type WaveformPlotProps = {
  peaks: number[];
  currentTime: number;
  duration: number;
  color: string;
  label: string;
  onSeek: (time: number) => void;
  compact?: boolean;
};

const WaveformPlot = React.memo(function WaveformPlot({
  peaks,
  currentTime,
  duration,
  color,
  label,
  onSeek,
  compact = false,
}: WaveformPlotProps) {
  const clipId = `waveform-${useId().replace(/:/g, '')}`;
  const bars = useMemo(() => {
    const source = peaks.length > 0 ? peaks : Array.from({ length: 96 }, () => 0);
    const maximum = Math.max(...source, 0.0001);
    return source.map(value => {
      const normalized = Math.sqrt(Math.max(0, value) / maximum);
      return Math.max(8, Math.min(92, Math.round(normalized * 92)));
    });
  }, [peaks]);
  const progress = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
  const gap = compact ? 3 : 2.4;
  const barWidth = Math.max(2.5, (1000 - gap * Math.max(0, bars.length - 1)) / Math.max(1, bars.length));

  return (
    <div className={`relative min-w-0 overflow-hidden rounded-md bg-slate-50 ${compact ? 'h-9' : 'h-12'}`}>
      <div className="pointer-events-none absolute inset-x-1.5 top-1/2 h-px -translate-y-1/2 bg-slate-200" />
      <svg
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-x-1.5 inset-y-1 h-[calc(100%-0.5rem)] w-[calc(100%-0.75rem)]"
        aria-hidden="true"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={progress * 1000} height="100" />
          </clipPath>
        </defs>
        {bars.map((height, index) => (
          <rect
            key={`idle-${index}`}
            x={index * (barWidth + gap)}
            y={(100 - height) / 2}
            width={barWidth}
            height={height}
            rx={barWidth / 2}
            fill="#94a3b8"
            opacity="0.58"
          />
        ))}
        <g clipPath={`url(#${clipId})`}>
          {bars.map((height, index) => (
            <rect
              key={`played-${index}`}
              x={index * (barWidth + gap)}
              y={(100 - height) / 2}
              width={barWidth}
              height={height}
              rx={barWidth / 2}
              fill={color}
              opacity="0.95"
            />
          ))}
        </g>
      </svg>
      {progress > 0 && progress < 1 && (
        <span
          className="pointer-events-none absolute inset-y-1 w-px -translate-x-px"
          style={{ left: `${progress * 100}%`, backgroundColor: color }}
        />
      )}
      <input
        type="range"
        min={0}
        max={Math.max(0.01, duration)}
        step={0.01}
        value={Math.min(currentTime, duration)}
        onChange={event => onSeek(Number(event.currentTarget.value))}
        aria-label={label}
        aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
});

const readApiError = async (response: Response) => {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return String(body?.error || `请求失败（${response.status}）`);
};

export default function MusicStemSeparation({ onSendToWorkstation }: MusicStemSeparationProps) {
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<SeparationJob | null>(null);
  const [requestError, setRequestError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendingToWorkstation, setSendingToWorkstation] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [soloed, setSoloed] = useState<Record<string, boolean>>({});
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const animationFrameRef = useRef<number | null>(null);

  const stems = job?.stems || [];
  const duration = job?.duration || stems[0]?.duration || 0;
  const masterWaveform = useMemo(() => {
    const pointCount = Math.max(0, ...stems.map(stem => stem.waveform?.length || 0));
    return Array.from({ length: pointCount }, (_, index) => Math.sqrt(
      stems.reduce((sum, stem) => {
        const value = Math.max(0, stem.waveform?.[index] || 0);
        return sum + value * value;
      }, 0),
    ));
  }, [stems]);
  const hasSolo = stems.some(stem => soloed[stem.id]);
  const audibleStemIds = useMemo(() => new Set(
    stems
      .filter(stem => hasSolo ? soloed[stem.id] : !muted[stem.id])
      .map(stem => stem.id),
  ), [hasSolo, muted, soloed, stems]);
  const isJobActive = Boolean(job && ACTIVE_STATUSES.has(job.status));

  const loadEngine = async () => {
    setEngineLoading(true);
    try {
      const response = await fetch('/api/audio/music-separation/engine');
      if (!response.ok) throw new Error(await readApiError(response));
      setEngine(await response.json() as EngineStatus);
    } catch (error) {
      setEngine(null);
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setEngineLoading(false);
    }
  };

  useEffect(() => {
    void loadEngine();
    const restoredId = window.sessionStorage.getItem(RESTORED_JOB_KEY);
    if (!restoredId) return;
    void fetch(`/api/audio/music-separation/jobs/${encodeURIComponent(restoredId)}`)
      .then(async response => {
        if (!response.ok) throw new Error(await readApiError(response));
        return response.json() as Promise<SeparationJob>;
      })
      .then(setJob)
      .catch(error => {
        window.sessionStorage.removeItem(RESTORED_JOB_KEY);
        setRequestError(error instanceof Error ? error.message : String(error));
      });
  }, []);

  useEffect(() => {
    if (!job?.id || !isJobActive) return;
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/audio/music-separation/jobs/${encodeURIComponent(job.id)}`);
        if (response.status === 404) {
          const message = await readApiError(response);
          if (disposed) return;
          window.sessionStorage.removeItem(RESTORED_JOB_KEY);
          setRequestError('分轨服务已重启，且本次任务没有可恢复的完整结果。请重新选择原素材后重试。');
          setJob(current => current?.id === job.id ? {
            ...current,
            status: 'failed',
            stage: 'failed',
            progress: 0,
            message: '本次分轨任务已中断。',
            error: message,
            canCancel: false,
          } : current);
          return;
        }
        if (!response.ok) throw new Error(await readApiError(response));
        const nextJob = await response.json() as SeparationJob;
        if (disposed) return;
        setJob(nextJob);
        setRequestError('');
        if (ACTIVE_STATUSES.has(nextJob.status)) timer = window.setTimeout(poll, 1_250);
      } catch (error) {
        if (disposed) return;
        setRequestError(error instanceof Error ? error.message : String(error));
        timer = window.setTimeout(poll, 3_000);
      }
    };
    timer = window.setTimeout(poll, 500);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [isJobActive, job?.id]);

  useEffect(() => {
    if (!job?.id) return;
    if (job.status === 'failed' || job.status === 'cancelled') {
      window.sessionStorage.removeItem(RESTORED_JOB_KEY);
    } else {
      window.sessionStorage.setItem(RESTORED_JOB_KEY, job.id);
    }
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (job?.status !== 'completed') return;
    setMuted(Object.fromEntries(stems.map(stem => [stem.id, false])));
    setSoloed(Object.fromEntries(stems.map(stem => [stem.id, false])));
    setVolumes(Object.fromEntries(stems.map(stem => [stem.id, 1])));
    setCurrentTime(0);
    setIsPlaying(false);
  }, [job?.status, stems]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    (Object.values(audioRefs.current) as Array<HTMLAudioElement | null>).forEach(audio => audio?.pause());
  }, []);

  useEffect(() => {
    stems.forEach(stem => {
      const audio = audioRefs.current[stem.id];
      if (!audio) return;
      audio.volume = volumes[stem.id] ?? 1;
      if (!isPlaying || !audibleStemIds.has(stem.id)) {
        audio.pause();
      } else if (audio.paused) {
        audio.currentTime = currentTime;
        void audio.play().catch(() => setIsPlaying(false));
      }
    });
  }, [audibleStemIds, isPlaying, stems, volumes]);

  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      return;
    }

    const updatePlayhead = () => {
      const masterStem = stems.find(stem => audibleStemIds.has(stem.id));
      const master = masterStem ? audioRefs.current[masterStem.id] : null;
      if (!master || master.ended || (duration > 0 && master.currentTime >= duration - 0.02)) {
        setIsPlaying(false);
        setCurrentTime(duration);
        return;
      }
      const nextTime = master.currentTime;
      stems.forEach(stem => {
        if (stem.id === masterStem?.id || !audibleStemIds.has(stem.id)) return;
        const audio = audioRefs.current[stem.id];
        if (audio && Math.abs(audio.currentTime - nextTime) > 0.06) audio.currentTime = nextTime;
      });
      setCurrentTime(nextTime);
      animationFrameRef.current = requestAnimationFrame(updatePlayhead);
    };
    animationFrameRef.current = requestAnimationFrame(updatePlayhead);
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [audibleStemIds, duration, isPlaying, stems]);

  const setSelectedFile = (nextFile: File | null) => {
    if (!nextFile) return;
    if (nextFile.size > 100 * 1024 * 1024) {
      setRequestError('文件超过 100MB 上传限制。');
      return;
    }
    const supported = nextFile.type.startsWith('audio/')
      || nextFile.type.startsWith('video/')
      || /\.(aac|aif|aiff|flac|m4a|mp3|mp4|mov|mkv|ogg|opus|wav|webm)$/i.test(nextFile.name);
    if (!supported) {
      setRequestError('请选择音频或视频文件。');
      return;
    }
    setFile(nextFile);
    setJob(null);
    setRequestError('');
  };

  const startJob = async () => {
    if (!file || !engine?.ready || submitting) return;
    setSubmitting(true);
    setRequestError('');
    try {
      const formData = new FormData();
      formData.append('media', file, file.name);
      const response = await fetch('/api/audio/music-separation/jobs', { method: 'POST', body: formData });
      if (!response.ok) throw new Error(await readApiError(response));
      const nextJob = await response.json() as SeparationJob;
      setJob(nextJob);
      window.sessionStorage.setItem(RESTORED_JOB_KEY, nextJob.id);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
      await loadEngine();
    } finally {
      setSubmitting(false);
    }
  };

  const cancelJob = async () => {
    if (!job?.canCancel) return;
    try {
      const response = await fetch(`/api/audio/music-separation/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readApiError(response));
      setJob(await response.json() as SeparationJob);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    }
  };

  const togglePlayback = async () => {
    if (isPlaying) {
      (Object.values(audioRefs.current) as Array<HTMLAudioElement | null>).forEach(audio => audio?.pause());
      setIsPlaying(false);
      return;
    }
    const startAt = currentTime >= duration - 0.05 ? 0 : currentTime;
    setCurrentTime(startAt);
    const playable = stems.filter(stem => audibleStemIds.has(stem.id));
    if (playable.length === 0) return;
    await Promise.all(playable.map(async stem => {
      const audio = audioRefs.current[stem.id];
      if (!audio) return;
      audio.currentTime = startAt;
      audio.volume = volumes[stem.id] ?? 1;
      await audio.play();
    })).then(() => setIsPlaying(true)).catch(error => {
      console.error('Unable to start synchronized stem preview:', error);
      setRequestError('浏览器无法开始同步试听，请再次点击播放。');
      (Object.values(audioRefs.current) as Array<HTMLAudioElement | null>).forEach(audio => audio?.pause());
    });
  };

  const seekTo = (nextTime: number) => {
    const safeTime = Math.max(0, Math.min(duration, nextTime));
    setCurrentTime(safeTime);
    stems.forEach(stem => {
      const audio = audioRefs.current[stem.id];
      if (audio) audio.currentTime = safeTime;
    });
  };

  const sendToWorkstation = async () => {
    if (stems.length === 0 || sendingToWorkstation) return;
    setSendingToWorkstation(true);
    setRequestError('');
    try {
      const files = await Promise.all(stems.map(async (stem, index) => {
        const response = await fetch(stem.audioUrl);
        if (!response.ok) throw new Error(`${stem.name}轨道读取失败。`);
        const blob = await response.blob();
        return new File([blob], `${String(index + 1).padStart(2, '0')}_${stem.name}.wav`, { type: 'audio/wav' });
      }));
      onSendToWorkstation(files);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setSendingToWorkstation(false);
    }
  };

  const reset = () => {
    (Object.values(audioRefs.current) as Array<HTMLAudioElement | null>).forEach(audio => audio?.pause());
    setIsPlaying(false);
    setCurrentTime(0);
    setJob(null);
    setFile(null);
    setRequestError('');
    window.sessionStorage.removeItem(RESTORED_JOB_KEY);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-emerald-600" />
            <h2 className="text-lg font-black text-slate-900">拆分分轨</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">可拆分人声、鼓、贝斯、吉他、钢琴和其他乐器</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-bold">
          {engineLoading ? (
            <span className="flex items-center gap-2 text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />检测运行环境</span>
          ) : engine?.ready ? (
            <span className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{engine.gpuName || 'CUDA GPU'} 已就绪</span>
          ) : (
            <span className="flex items-center gap-2 text-amber-700"><AlertCircle className="h-3.5 w-3.5" />本地模型未就绪</span>
          )}
          <button
            type="button"
            onClick={() => void loadEngine()}
            title="重新检测运行环境"
            aria-label="重新检测运行环境"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-emerald-700"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${engineLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {!engineLoading && !engine?.ready && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-bold">
              {!engine?.installed
                ? '需要安装独立的本地分轨环境。'
                : !engine.cudaAvailable
                  ? '当前环境没有检测到可用的 CUDA。'
                  : '高质量 6 轨模型尚未缓存。'}
            </p>
            <code className="mt-1 block overflow-x-auto whitespace-nowrap text-[10px] text-amber-800">
              powershell -ExecutionPolicy Bypass -File tools/music-separation/setup-music-separation.ps1
            </code>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.4fr)]">
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h3 className="text-sm font-bold text-slate-800">源素材</h3>
            <p className="mt-1 text-[11px] text-slate-500">音频或视频，最大 100MB</p>
          </div>

          <div
            onDragEnter={event => { event.preventDefault(); setDragActive(true); }}
            onDragOver={event => { event.preventDefault(); setDragActive(true); }}
            onDragLeave={event => { event.preventDefault(); setDragActive(false); }}
            onDrop={event => {
              event.preventDefault();
              setDragActive(false);
              setSelectedFile(event.dataTransfer.files[0] || null);
            }}
            onClick={() => !isJobActive && inputRef.current?.click()}
            className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors ${
              dragActive ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-emerald-400'
            } ${isJobActive ? 'cursor-not-allowed opacity-70' : ''}`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="audio/*,video/*,.mkv,.mov,.aiff,.flac"
              className="hidden"
              disabled={isJobActive}
              onChange={event => setSelectedFile(event.target.files?.[0] || null)}
            />
            {file ? (
              <>
                {file.type.startsWith('video/') ? <FileVideo className="h-8 w-8 text-emerald-600" /> : <FileAudio className="h-8 w-8 text-emerald-600" />}
                <p className="mt-3 max-w-full truncate text-xs font-bold text-slate-800">{file.name}</p>
                <p className="mt-1 text-[10px] text-slate-500">{formatBytes(file.size)}</p>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-slate-400" />
                <p className="mt-3 text-xs font-bold text-slate-700">选择或拖入音乐素材</p>
              </>
            )}
          </div>

          {job && (
            <div className={`rounded-lg border px-3 py-3 ${
              job.status === 'failed' ? 'border-rose-200 bg-rose-50' : job.status === 'completed' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'
            }`}>
              <div className="flex items-start gap-2">
                {isJobActive ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-600" /> : job.status === 'completed' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-slate-800">{job.message}</p>
                  {job.status === 'queued' && job.queuePosition > 0 && <p className="mt-1 text-[10px] text-slate-500">队列位置：{job.queuePosition}</p>}
                  {job.error && <p className="mt-1 break-words text-[10px] leading-relaxed text-rose-700">{job.error}</p>}
                </div>
              </div>
              {isJobActive && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-500" style={{ width: `${Math.max(3, job.progress)}%` }} />
                </div>
              )}
            </div>
          )}

          {requestError && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] font-semibold text-rose-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{requestError}</span>
            </div>
          )}

          <div className="flex gap-2">
            {isJobActive ? (
              <button
                type="button"
                onClick={() => void cancelJob()}
                disabled={job?.status === 'cancelling'}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                <Square className="h-3.5 w-3.5" />停止任务
              </button>
            ) : job?.status === 'completed' ? (
              <button type="button" onClick={reset} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50">
                <RotateCcw className="h-3.5 w-3.5" />处理新素材
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startJob()}
                disabled={!file || !engine?.ready || submitting}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Workflow className="h-4 w-4" />}
                开始高质量分轨
              </button>
            )}
            {file && !isJobActive && job?.status !== 'completed' && (
              <button type="button" onClick={reset} title="清除素材" aria-label="清除素材" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-rose-600">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-800">独立轨道</h3>
              <p className="mt-1 text-[10px] text-slate-500">
                {job?.status === 'completed' ? `${stems.length} 轨 · ${formatTime(duration)} · ${((job.sampleRate || 44_100) / 1000).toFixed(1)} kHz Float WAV` : '等待分轨结果'}
              </p>
            </div>
            {job?.status === 'completed' && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void sendToWorkstation()}
                  disabled={sendingToWorkstation}
                  className="flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-700 hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
                >
                  {sendingToWorkstation ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                  送入工作站
                </button>
                <a href={job.zipUrl} download className="flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-[11px] font-bold text-white hover:bg-slate-800">
                  <Download className="h-3.5 w-3.5" />下载 ZIP
                </a>
              </div>
            )}
          </div>

          {job?.status === 'completed' ? (
            <>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => void togglePlayback()} title={isPlaying ? '暂停同步试听' : '播放全部轨道'} aria-label={isPlaying ? '暂停同步试听' : '播放全部轨道'} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white hover:bg-slate-800">
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                  </button>
                  <span className="w-10 text-right font-mono text-[10px] text-slate-500">{formatTime(currentTime)}</span>
                  <div className="min-w-0 flex-1">
                    <WaveformPlot
                      peaks={masterWaveform}
                      currentTime={currentTime}
                      duration={duration}
                      color="#059669"
                      label="全部轨道组合波形播放位置"
                      onSeek={seekTo}
                    />
                  </div>
                  <span className="w-10 font-mono text-[10px] text-slate-500">{formatTime(duration)}</span>
                </div>
              </div>

              <div className="space-y-2">
                {stems.map(stem => (
                  <article key={stem.id} className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm sm:grid-cols-[minmax(110px,0.55fr)_minmax(180px,1.45fr)_auto]">
                    <audio ref={element => { audioRefs.current[stem.id] = element; }} src={stem.audioUrl} preload="metadata" />
                    <div className="order-1 flex min-w-0 items-center gap-3">
                      <span className={`h-8 w-1.5 shrink-0 rounded-full ${TRACK_COLORS[stem.id] || 'bg-slate-500'}`} />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black text-slate-800">{stem.name}</p>
                        <p className="mt-0.5 text-[9px] text-slate-400">{formatBytes(stem.size)} · 峰值 {formatDb(stem.peakDb)}</p>
                      </div>
                    </div>
                    <div className="order-3 col-span-2 min-w-0 space-y-1 sm:order-2 sm:col-span-1">
                      <WaveformPlot
                        peaks={stem.waveform || []}
                        currentTime={currentTime}
                        duration={duration}
                        color={TRACK_WAVE_COLORS[stem.id] || '#64748b'}
                        label={`${stem.name}轨道波形播放位置`}
                        onSeek={seekTo}
                        compact
                      />
                      <div className="flex min-w-0 items-center gap-2 px-0.5">
                        <Volume2 className="h-3 w-3 shrink-0 text-slate-400" />
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={volumes[stem.id] ?? 1}
                          onChange={event => setVolumes(current => ({ ...current, [stem.id]: Number(event.target.value) }))}
                          aria-label={`${stem.name}音量`}
                          className="h-1.5 min-w-0 flex-1 accent-emerald-600"
                        />
                      </div>
                    </div>
                    <div className="order-2 flex items-center gap-1.5 sm:order-3">
                      <button
                        type="button"
                        onClick={() => setMuted(current => ({ ...current, [stem.id]: !current[stem.id] }))}
                        title={muted[stem.id] ? `取消静音${stem.name}` : `静音${stem.name}`}
                        aria-label={muted[stem.id] ? `取消静音${stem.name}` : `静音${stem.name}`}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border ${muted[stem.id] ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-500 hover:text-slate-800'}`}
                      >
                        {muted[stem.id] ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSoloed(current => ({ ...current, [stem.id]: !current[stem.id] }))}
                        title={soloed[stem.id] ? `取消独奏${stem.name}` : `独奏${stem.name}`}
                        aria-label={soloed[stem.id] ? `取消独奏${stem.name}` : `独奏${stem.name}`}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border ${soloed[stem.id] ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:text-slate-800'}`}
                      >
                        <Headphones className="h-3.5 w-3.5" />
                      </button>
                      <a href={stem.audioUrl} download={stem.fileName} title={`下载${stem.name}`} aria-label={`下载${stem.name}`} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-emerald-300 hover:text-emerald-700">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-6 text-center">
              {isJobActive ? <Loader2 className="h-9 w-9 animate-spin text-emerald-600" /> : <Layers className="h-9 w-9 text-slate-300" />}
              <p className="mt-3 text-xs font-bold text-slate-600">{isJobActive ? job?.message : '暂无独立轨道'}</p>
              {isJobActive && <p className="mt-1 text-[10px] text-slate-400">完成后会在这里同步显示所有有效轨道</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
