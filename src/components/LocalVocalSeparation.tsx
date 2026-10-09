import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileAudio, FileVideo, Loader2, Mic2, RefreshCw, Square, Trash2, Upload } from 'lucide-react';

type EngineStatus = {
  ready: boolean;
  gpuName?: string;
  error?: string;
  installed: boolean;
  cudaAvailable: boolean;
  modelCached: boolean;
};

type VocalStem = {
  id: string;
  name: string;
  audioUrl: string;
  size: number;
  duration: number;
};

type VocalJob = {
  id: string;
  mode: 'stems' | 'vocals';
  status: string;
  progress: number;
  message: string;
  sourceName: string;
  queuePosition: number;
  stems: VocalStem[];
  zipUrl?: string;
  error?: string;
  canCancel: boolean;
};

const API = '/api/audio/music-separation';
const SESSION_KEY = 'ai-audio-local-vocal-separation-job';
const ACTIVE = new Set(['queued', 'preparing', 'separating', 'analyzing', 'packaging', 'cancelling']);

const readError = async (response: Response) => {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || `请求失败（${response.status}）`;
};

const formatSize = (bytes: number) => bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(0)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const sourceBaseName = (source: string) => (
  source.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || 'audio'
);

const downloadName = (source: string, stem: string) => (
  `${sourceBaseName(source)}_${stem === 'vocals' ? '纯人声' : '无人声伴奏'}.wav`
);

export default function LocalVocalSeparation({ visible = true }: { visible?: boolean }) {
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<VocalJob | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const recoveryAttemptedRef = useRef<string | null>(null);
  const active = Boolean(job && ACTIVE.has(job.status));
  const needsRecovery = Boolean(job?.status === 'completed'
    && job.stems.some(stem => stem.id === 'vocals')
    && !job.stems.some(stem => stem.id === 'instrumental'));

  useEffect(() => {
    if (!visible) containerRef.current?.querySelectorAll('audio').forEach(audio => audio.pause());
  }, [visible]);

  const checkEngine = async () => {
    setEngineLoading(true);
    try {
      const response = await fetch(`${API}/engine`);
      if (!response.ok) throw new Error(await readError(response));
      setEngine(await response.json() as EngineStatus);
    } catch (failure) {
      setEngine(null);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setEngineLoading(false);
    }
  };

  useEffect(() => {
    void checkEngine();
    const savedId = sessionStorage.getItem(SESSION_KEY);
    if (!savedId) return;
    void fetch(`${API}/jobs/${encodeURIComponent(savedId)}`)
      .then(async response => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<VocalJob>;
      })
      .then(savedJob => {
        setJob(savedJob);
      })
      .catch(() => sessionStorage.removeItem(SESSION_KEY));
  }, []);

  const recoverVocals = async (id: string) => {
    if (recoveryAttemptedRef.current === id) return;
    recoveryAttemptedRef.current = id;
    setRecovering(true);
    setError('');
    try {
      const response = await fetch(`${API}/jobs/${encodeURIComponent(id)}/complete-vocals`, { method: 'POST' });
      if (!response.ok) throw new Error(await readError(response));
      setJob(await response.json() as VocalJob);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRecovering(false);
    }
  };

  useEffect(() => {
    if (job?.id && needsRecovery) void recoverVocals(job.id);
  }, [job?.id, needsRecovery]);

  useEffect(() => {
    if (!job?.id || !active) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const response = await fetch(`${API}/jobs/${encodeURIComponent(job.id)}`);
        if (!response.ok) throw new Error(await readError(response));
        const next = await response.json() as VocalJob;
        if (cancelled) return;
        setJob(next);
        setError('');
        if (ACTIVE.has(next.status)) timer = window.setTimeout(poll, 1500);
      } catch (failure) {
        if (cancelled) return;
        setError(failure instanceof Error ? failure.message : String(failure));
        timer = window.setTimeout(poll, 3000);
      }
    };
    timer = window.setTimeout(poll, 500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [active, job?.id]);

  const selectFile = (next: File | null) => {
    if (!next) return;
    if (next.size > 100 * 1024 * 1024) {
      setError('文件超过 100 MB 上传限制。');
      return;
    }
    if (!(next.type.startsWith('audio/') || next.type.startsWith('video/') || /\.(aac|aif|aiff|flac|m4a|mp3|mp4|mov|mkv|ogg|opus|wav|webm)$/i.test(next.name))) {
      setError('请选择音频或视频文件。');
      return;
    }
    setFile(next);
    setJob(null);
    setError('');
    sessionStorage.removeItem(SESSION_KEY);
  };

  const start = async () => {
    if (!file || !engine?.ready || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const body = new FormData();
      body.append('mode', 'vocals');
      body.append('originalName', file.name);
      body.append('media', file, file.name);
      const response = await fetch(`${API}/vocal-jobs`, { method: 'POST', body });
      if (!response.ok) throw new Error(await readError(response));
      const next = await response.json() as VocalJob;
      setJob(next);
      sessionStorage.setItem(SESSION_KEY, next.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSubmitting(false);
    }
  };

  const stop = async () => {
    if (!job?.canCancel) return;
    try {
      const response = await fetch(`${API}/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readError(response));
      setJob(await response.json() as VocalJob);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const clear = () => {
    if (active) return;
    setFile(null);
    setJob(null);
    setError('');
    sessionStorage.removeItem(SESSION_KEY);
    if (inputRef.current) inputRef.current.value = '';
  };

  const stems = job?.status === 'completed' ? job.stems.filter(stem => stem.id === 'vocals' || stem.id === 'instrumental') : [];

  return (
    <div ref={containerRef} className="mx-auto w-full max-w-5xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Mic2 className="h-5 w-5 text-emerald-600" />本地人声分离</h2>
          <p className="mt-1 text-xs text-slate-500">提取人声与伴奏，不调用 ElevenLabs，不消耗 API 积分</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold">
          {engineLoading ? <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> : engine?.ready ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-amber-600" />}
          <span className={engine?.ready ? 'text-emerald-700' : 'text-slate-600'}>{engineLoading ? '检测模型' : engine?.ready ? `${engine.gpuName || '本地 GPU'} 已就绪` : '模型未就绪'}</span>
          <button type="button" onClick={() => void checkEngine()} title="重新检测模型" aria-label="重新检测模型" className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:text-emerald-700"><RefreshCw className="h-4 w-4" /></button>
        </div>
      </header>

      {!engineLoading && !engine?.ready && <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">{engine?.error || (!engine?.installed ? '本地分轨环境未安装。' : !engine?.cudaAvailable ? '当前设备没有可用的 CUDA GPU。' : '模型文件尚未缓存。')}</div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
        <section className="space-y-4 rounded border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">源素材</h3>
            {(file || job) && <button type="button" onClick={clear} disabled={active} title="清空当前素材和结果" className="flex h-8 items-center gap-1 rounded border border-slate-200 px-2 text-xs text-slate-600 hover:text-rose-600 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />清空</button>}
          </div>
          <div
            role="button" tabIndex={active ? -1 : 0}
            onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && !active) { event.preventDefault(); inputRef.current?.click(); } }}
            onClick={() => !active && inputRef.current?.click()}
            onDragOver={event => { event.preventDefault(); setDragActive(true); }}
            onDragLeave={event => { event.preventDefault(); setDragActive(false); }}
            onDrop={event => { event.preventDefault(); setDragActive(false); if (!active) selectFile(event.dataTransfer.files[0] || null); }}
            className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed p-4 text-center ${dragActive ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-emerald-400'} ${active ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input ref={inputRef} type="file" accept="audio/*,video/*,.mkv,.mov,.aiff,.flac" disabled={active} className="hidden" onChange={event => selectFile(event.target.files?.[0] || null)} />
            {file?.type.startsWith('video/') ? <FileVideo className="h-7 w-7 text-emerald-600" /> : file ? <FileAudio className="h-7 w-7 text-emerald-600" /> : <Upload className="h-7 w-7 text-slate-400" />}
            <span className="max-w-full break-all text-xs font-semibold text-slate-700">{file?.name || '选择或拖入音频 / 视频'}</span>
            <span className="text-[11px] text-slate-500">{file ? formatSize(file.size) : '单文件不超过 100 MB'}</span>
          </div>
          <button type="button" disabled={!file || !engine?.ready || active || submitting} onClick={() => void start()} className="flex h-10 w-full items-center justify-center gap-2 rounded bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
            {submitting ? '正在上传…' : '开始本地人声分离'}
          </button>
          {job && <div className={`rounded border px-3 py-3 text-xs ${job.status === 'failed' ? 'border-rose-200 bg-rose-50' : job.status === 'completed' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-start justify-between gap-2"><span className="font-semibold text-slate-800">{recovering ? '正在补全伴奏…' : job.message}{job.status === 'queued' && job.queuePosition > 0 ? ` · 队列第 ${job.queuePosition} 位` : ''}</span>{job.canCancel && <button type="button" onClick={() => void stop()} title="停止任务" aria-label="停止任务" className="text-slate-600 hover:text-rose-600"><Square className="h-4 w-4" /></button>}</div>
            {needsRecovery && !recovering && <button type="button" onClick={() => { recoveryAttemptedRef.current = null; void recoverVocals(job.id); }} className="mt-2 text-xs font-semibold text-emerald-700 hover:underline">补全伴奏</button>}
            {active && <div className="mt-3 h-1.5 overflow-hidden rounded bg-slate-200"><div className="h-full bg-emerald-600 transition-[width]" style={{ width: `${Math.max(3, job.progress)}%` }} /></div>}
            {job.error && <p className="mt-2 text-rose-700">{job.error}</p>}
          </div>}
          {error && <div role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
        </section>

        <section className="space-y-4 rounded border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-slate-800">分离结果</h3>{stems.length === 2 && job?.zipUrl && <a href={job.zipUrl} download={`${sourceBaseName(job.sourceName)}_人声分离.zip`} className="flex h-8 items-center gap-1 rounded border border-slate-200 px-2 text-xs font-semibold text-emerald-700 hover:border-emerald-300"><Download className="h-3.5 w-3.5" />打包下载</a>}</div>
          {stems.length === 0 ? <p className="py-14 text-center text-xs text-slate-400">分离完成后可分别试听、下载人声与伴奏</p> : stems.map(stem => (
            <div key={stem.id} className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-xs font-bold text-slate-800">{stem.id === 'vocals' ? '纯人声' : '无人声伴奏'}</h4><p className="mt-0.5 text-[11px] text-slate-500">WAV · {formatSize(stem.size)}</p></div><a href={`${API}/jobs/${encodeURIComponent(job!.id)}/stems/${encodeURIComponent(stem.id)}/download`} download={downloadName(job?.sourceName || 'audio', stem.id)} className="flex h-8 items-center gap-1 rounded border border-slate-200 px-2 text-xs font-semibold text-emerald-700 hover:border-emerald-300"><Download className="h-3.5 w-3.5" />下载</a></div>
              <audio controls preload="metadata" src={stem.audioUrl} className="h-9 w-full" aria-label={`${stem.name}试听`} />
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
