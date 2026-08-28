import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileAudio,
  Gauge,
  Loader2,
  RefreshCw,
  UploadCloud,
  WandSparkles,
} from 'lucide-react';
import {
  convertWithSeamlessExpressive,
  getSeamlessExpressiveStatus,
  type SeamlessExpressiveLanguage,
  type SeamlessExpressiveLanguageOption,
  type SeamlessExpressiveResult,
  type SeamlessExpressiveStatus,
} from '../services/seamlessExpressiveService';

const FALLBACK_LANGUAGES: SeamlessExpressiveLanguageOption[] = [
  { code: 'eng', label: '英语', experimental: false, recommendedDurationFactor: 1 },
  { code: 'spa', label: '西班牙语', experimental: false, recommendedDurationFactor: 1 },
  { code: 'fra', label: '法语', experimental: false, recommendedDurationFactor: 1.2 },
  { code: 'deu', label: '德语', experimental: false, recommendedDurationFactor: 1.1 },
  { code: 'cmn', label: '中文', experimental: true, recommendedDurationFactor: 1 },
  { code: 'ita', label: '意大利语', experimental: true, recommendedDurationFactor: 1 },
];

function formatDuration(value?: number) {
  if (!value || !Number.isFinite(value)) return '--';
  const seconds = Math.round(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function SourceUpload({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`rounded-lg border border-dashed p-5 transition-colors ${dragging ? 'border-sky-400 bg-sky-50' : 'border-slate-300 bg-slate-50/70'}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        onChange(event.dataTransfer.files[0] || null);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={(event) => onChange(event.target.files?.[0] || null)}
      />
      {file ? (
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
            <FileAudio className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-slate-800">{file.name}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>
          <button type="button" onClick={() => onChange(null)} className="text-[10px] font-bold text-slate-500 hover:text-slate-900">
            移除
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} className="flex w-full items-center justify-center gap-2 py-2 text-xs font-bold text-slate-600 hover:text-sky-700">
          <UploadCloud className="h-4 w-4" />
          选择或拖入视频 / 音频
        </button>
      )}
    </div>
  );
}

export default function SeamlessExpressivePanel() {
  const [source, setSource] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<SeamlessExpressiveLanguage>('eng');
  const [durationFactor, setDurationFactor] = useState(1);
  const [status, setStatus] = useState<SeamlessExpressiveStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SeamlessExpressiveResult | null>(null);

  const loadStatus = async () => {
    setStatusLoading(true);
    try {
      setStatus(await getSeamlessExpressiveStatus());
    } catch (reason) {
      setStatus({
        available: false,
        model: 'SeamlessExpressive',
        platform: 'unknown',
        runtimeSupported: false,
        pythonFound: false,
        repoFound: false,
        scriptFound: false,
        modelFilesFound: false,
        supportedLanguages: FALLBACK_LANGUAGES,
        license: 'Seamless License - noncommercial research only',
        gated: true,
        reason: reason instanceof Error ? reason.message : '无法读取本地模型状态。',
      });
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => { void loadStatus(); }, []);
  useEffect(() => {
    if (!source) {
      setSourceUrl(null);
      return;
    }
    const url = URL.createObjectURL(source);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);

  const languages = status?.supportedLanguages?.length ? status.supportedLanguages : FALLBACK_LANGUAGES;
  const selectedLanguage = useMemo(
    () => languages.find(language => language.code === targetLanguage) || languages[0],
    [languages, targetLanguage],
  );

  const selectLanguage = (code: SeamlessExpressiveLanguage) => {
    const language = languages.find(item => item.code === code);
    setTargetLanguage(code);
    if (language) setDurationFactor(language.recommendedDurationFactor);
    setResult(null);
    setError(null);
  };

  const handleConvert = async () => {
    if (!source || !status?.available) return;
    setConverting(true);
    setError(null);
    setResult(null);
    try {
      setResult(await convertWithSeamlessExpressive(source, targetLanguage, durationFactor));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'SeamlessExpressive 转换失败。');
    } finally {
      setConverting(false);
    }
  };

  const updateSource = (file: File | null) => {
    setSource(file);
    setResult(null);
    setError(null);
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start" aria-label="SeamlessExpressive 语音翻译">
      <section className="space-y-5 lg:col-span-8">
        <div className="rounded-lg border border-sky-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase text-sky-700">方案四 · 开发中</span>
                <span className="rounded bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">Speech-to-Speech</span>
              </div>
              <h2 className="mt-2 text-base font-black text-slate-900">SeamlessExpressive</h2>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-500">
                原始语音直接翻译成目标语言语音，迁移语速、停顿和表达风格，不经过文字转 TTS。
              </p>
            </div>
            <div className={`flex w-fit items-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-bold ${status?.available ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              <span className={`h-2 w-2 rounded-full ${statusLoading ? 'animate-pulse bg-slate-400' : status?.available ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {statusLoading ? '检查运行环境…' : status?.available ? `本地可用${status.gpu ? ` · ${status.gpu}` : ''}` : '尚不可运行'}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-black text-slate-800">原始素材</h3>
              <p className="mt-1 text-[10px] text-slate-500">保留对白内容、语速、停顿与表达的源视频或音频。</p>
            </div>
            <FileAudio className="h-4 w-4 text-sky-600" />
          </div>
          <div className="mt-4"><SourceUpload file={source} onChange={updateSource} /></div>
          {sourceUrl ? <audio controls preload="metadata" src={sourceUrl} className="mt-4 h-9 w-full" /> : null}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-black text-slate-800">目标语言</h3>
          <select
            value={targetLanguage}
            onChange={(event) => selectLanguage(event.target.value as SeamlessExpressiveLanguage)}
            className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          >
            {languages.map(language => (
              <option key={language.code} value={language.code}>
                {language.label}{language.experimental ? '（实验性）' : ''}
              </option>
            ))}
          </select>

          <div className="mt-5 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-black text-slate-800"><Gauge className="h-3.5 w-3.5" />时长系数</div>
              <p className="mt-1 text-[10px] text-slate-500">值越大，输出语速越慢。</p>
            </div>
            <span className="min-w-12 text-right text-sm font-black text-sky-700">{durationFactor.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.8"
            max="1.35"
            step="0.05"
            value={durationFactor}
            onChange={(event) => setDurationFactor(Number(event.target.value))}
            className="mt-3 w-full accent-sky-600"
            aria-label="输出时长系数"
          />
          <div className="mt-1 flex justify-between text-[9px] text-slate-400"><span>更快</span><span>官方建议 {selectedLanguage?.recommendedDurationFactor.toFixed(2)}</span><span>更慢</span></div>

          <button
            type="button"
            onClick={handleConvert}
            disabled={!source || !status?.available || converting}
            className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 text-xs font-black text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {converting ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
            {converting ? '正在翻译并重建表达…' : '开始转换'}
          </button>
          {converting ? <p className="mt-2 text-center text-[10px] text-slate-500">首次运行需要加载大型模型，耗时会明显更长。</p> : null}
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] leading-relaxed text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
          </div>
        ) : null}

        {result ? (
          <div className="rounded-lg border border-emerald-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-black text-emerald-800"><CheckCircle2 className="h-4 w-4" />转换完成</div>
                <p className="mt-1 text-[10px] text-slate-500">原始 {formatDuration(result.sourceDuration)} · 输出 {formatDuration(result.generatedDuration)}</p>
              </div>
              <a href={result.audioUrl} download className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 px-3 text-[10px] font-black text-emerald-700 hover:bg-emerald-50">
                <Download className="h-3.5 w-3.5" />下载 WAV
              </a>
            </div>
            <audio controls preload="metadata" src={result.audioUrl} className="mt-4 h-10 w-full" />
            {result.translatedText ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">{result.translatedText}</p> : null}
          </div>
        ) : null}
      </section>

      <aside className="space-y-4 lg:col-span-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-black text-slate-800">运行状态</h3>
            <button type="button" onClick={() => void loadStatus()} disabled={statusLoading} title="重新检查" className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${statusLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <dl className="mt-3 space-y-2 text-[10px]">
            {[
              ['Linux / WSL', status?.runtimeSupported],
              ['Python 环境', status?.pythonFound],
              ['官方代码', status?.repoFound && status?.scriptFound],
              ['受限模型权重', status?.modelFilesFound],
            ].map(([label, ready]) => (
              <div key={String(label)} className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                <dt className="text-slate-500">{label}</dt>
                <dd className={ready ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'}>{ready ? '已就绪' : '未就绪'}</dd>
              </div>
            ))}
          </dl>
          {status?.reason ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-[10px] leading-relaxed text-amber-800">{status.reason}</p> : null}
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div>
              <h3 className="text-xs font-black text-amber-900">受限模型</h3>
              <p className="mt-1 text-[10px] leading-relaxed text-amber-800">权重需经 Meta 与 Hugging Face 授权，仅限非商业研究用途。当前产品商用时不能直接使用该模型。</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="https://huggingface.co/facebook/seamless-expressive" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-black text-amber-900 underline underline-offset-2">模型授权 <ExternalLink className="h-3 w-3" /></a>
            <a href="https://github.com/facebookresearch/seamless_communication" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-black text-amber-900 underline underline-offset-2">官方项目 <ExternalLink className="h-3 w-3" /></a>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 text-[10px] leading-relaxed text-slate-500 shadow-sm">
          <p className="font-black text-slate-800">能力边界</p>
          <p className="mt-2">该模型重点保留语速、停顿和表达风格，不保证与原人物完全一致的身份级音色。多人素材不会自动提供独立角色音色控制。</p>
        </div>
      </aside>
    </div>
  );
}
