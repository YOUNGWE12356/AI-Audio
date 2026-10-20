/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  FileAudio,
  Gauge,
  Globe2,
  Guitar,
  Loader2,
  Music2,
  Piano,
  Upload,
  Waves,
} from 'lucide-react';

import { AUDIO_FILE_EXTENSION_REGEX, formatBytes, formatTime, type AnalyzerResult, type Confidence } from '../utils/audioMetrics';
import { analyzeAudioFile } from '../services/audioAnalysisClient';
import PointCostHint from './PointCostHint';
import { useNativeAssistantTool } from '../services/useNativeAssistantTool';
import { reportAssistantWorkspaceProgress } from '../services/assistantWorkspaceClient';
export { estimateKey, estimateMusicalMode } from '../utils/audioMetrics';

type AnalysisItemStatus = 'pending' | 'analyzing' | 'done' | 'error';

interface AnalysisQueueItem {
  id: string;
  file: File;
  status: AnalysisItemStatus;
  progress: number;
  result?: AnalyzerResult;
  error?: string;
}


const MetricCard = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    <p className="mt-1 text-lg font-black text-slate-900">{value}</p>
    {hint && <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{hint}</p>}
  </div>
);

const ConfidencePill = ({ value }: { value: Confidence }) => (
  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
    value === '高'
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
      : value === '中'
      ? 'bg-amber-50 text-amber-700 border border-amber-100'
      : 'bg-slate-50 text-slate-500 border border-slate-200'
  }`}>
    {value}置信
  </span>
);

interface AudioAnalyzerProps {
  initialFiles?: File[];
}

export default function AudioAnalyzer({ initialFiles = [] }: AudioAnalyzerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [analysisItems, setAnalysisItems] = useState<AnalysisQueueItem[]>([]);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  React.useEffect(() => {
    if (!initialFiles.length || loading) return;
    handleFiles(initialFiles);
    // The assistant passes a new file list only when a new task is confirmed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  const totalSelectedSize = analysisItems.reduce((sum, item) => sum + item.file.size, 0);
  const completedCount = analysisItems.filter(item => item.status === 'done').length;
  const failedCount = analysisItems.filter(item => item.status === 'error').length;
  const selectedItem = analysisItems.find(item => item.id === selectedResultId);

  const isSupportedAudioFile = (nextFile: File) => (
    nextFile.type.startsWith('audio/') || AUDIO_FILE_EXTENSION_REGEX.test(nextFile.name)
  );

  const handleFiles = (nextFiles: FileList | File[]) => {
    if (loading) return;
    const incomingFiles = Array.from(nextFiles);
    if (!incomingFiles.length) return;

    const supportedFiles = incomingFiles.filter(isSupportedAudioFile);
    const ignoredCount = incomingFiles.length - supportedFiles.length;

    if (!supportedFiles.length) {
      setError('请上传音乐或音频文件，当前分析器暂不处理视频容器。');
      return;
    }

    const nextItems = supportedFiles.map((nextFile, index) => ({
      id: `${nextFile.name}-${nextFile.size}-${nextFile.lastModified}-${index}`,
      file: nextFile,
      status: 'pending' as AnalysisItemStatus,
      progress: 0,
    }));

    setAnalysisItems(nextItems);
    setSelectedResultId(null);
    setResult(null);
    setProgress(0);
    setError(ignoredCount ? `已忽略 ${ignoredCount} 个非音频文件。` : null);
  };

  const clearQueue = () => {
    if (loading) return;
    setAnalysisItems([]);
    setSelectedResultId(null);
    setResult(null);
    setProgress(0);
    setError(null);
  };

  const handleAnalyze = async (options: { signal?: AbortSignal; semantic?: boolean; assistant?: boolean } = {}) => {
    if (!analysisItems.length || loading) {
      if (options.assistant) throw new Error(loading ? '分析器正在处理另一项任务。' : '没有可分析的音频。');
      return [];
    }
    setLoading(true);
    setError(null);
    setProgress(0);
    setResult(null);
    setSelectedResultId(null);
    setAnalysisItems(previous => previous.map(item => ({
      ...item,
      status: 'pending',
      progress: 0,
      result: undefined,
      error: undefined,
    })));

    const queueSnapshot = analysisItems;
    let finished = 0;
    let failed = 0;
    const results: AnalyzerResult[] = [];
    let failure: string | undefined;

    try {
      for (const item of queueSnapshot) {
        options.signal?.throwIfAborted();
        setAnalysisItems(previous => previous.map(queueItem => (
          queueItem.id === item.id
            ? { ...queueItem, status: 'analyzing', progress: 12, error: undefined, result: undefined }
            : queueItem
        )));

        const timer = window.setInterval(() => {
          setAnalysisItems(previous => previous.map(queueItem => (
            queueItem.id === item.id && queueItem.status === 'analyzing'
              ? { ...queueItem, progress: Math.min(queueItem.progress + 12, 86) }
              : queueItem
          )));
        }, 260);

        try {
          const nextResult = await analyzeAudioFile(item.file, {
            signal: options.signal, semantic: options.semantic,
            onStage: options.assistant ? stage => reportAssistantWorkspaceProgress(`${item.file.name}：${stage}`) : undefined,
          });
          results.push(nextResult);
          window.clearInterval(timer);
          finished += 1;
          setProgress(Math.round((finished / queueSnapshot.length) * 100));
          setResult(nextResult);
          setSelectedResultId(item.id);
          setAnalysisItems(previous => previous.map(queueItem => (
            queueItem.id === item.id
              ? { ...queueItem, status: 'done', progress: 100, result: nextResult, error: undefined }
              : queueItem
          )));
        } catch (err: any) {
          window.clearInterval(timer);
          finished += 1;
          failed += 1;
          failure = `${item.file.name}：${err?.message || '解码或分析失败'}`;
          setProgress(Math.round((finished / queueSnapshot.length) * 100));
          setAnalysisItems(previous => previous.map(queueItem => (
            queueItem.id === item.id
              ? {
                  ...queueItem,
                  status: 'error',
                  progress: 0,
                  error: err?.message || '音频分析失败，请确认文件格式可被浏览器解码。',
                }
              : queueItem
          )));
        }
      }

      if (failed) {
        setError(`已完成 ${queueSnapshot.length - failed} 个音频，${failed} 个文件分析失败；请检查失败文件的格式或重新导出后再试。`);
      }
      if (options.assistant && failure) throw new Error(failure);
      return results;
    } finally {
      setLoading(false);
    }
  };

  useNativeAssistantTool(['analyze_music_metrics', 'semantic_audio_analysis'], {
    prepare: ({ files }) => {
      if (loading) throw new Error('分析器正在处理另一项任务。');
      if (!files.length || files.some(file => !isSupportedAudioFile(file))) throw new Error('请提供可分析的音频文件。');
      handleFiles(files);
    },
    run: async ({ command }, signal) => {
      const semantic = command.args.tool === 'semantic_audio_analysis';
      const results = await handleAnalyze({ signal, semantic, assistant: true });
      if (semantic && results.some(item => item.semanticError)) throw new Error(`GPT 解读失败，本地指标已保留：${results.find(item => item.semanticError)!.semanticError}`);
      return { ...results[0], results, analysisBasis: 'metrics',
        note: '使用音频分析页面实测；BPM、调性与音色倾向为信号估算，保留置信度。GPT 解读未直接听音。' };
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-900">音频测速 / 测调 / 乐器和弦分析</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
              上传一首或多首音乐后，分析 BPM、调性、全球音乐风格与调式体系、主要和弦、乐器/音色倾向、响度、动态范围、底噪 RMS、SNR 信噪比、频段分布和立体声宽度。
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <button
              type="button"
              disabled={!analysisItems.length || loading}
              onClick={() => void handleAnalyze()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-xs font-black text-white shadow-lg shadow-emerald-600/15 transition-all hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
              {loading ? `批量分析中 ${progress}%` : analysisItems.length > 1 ? `分析 ${analysisItems.length} 个音频` : '开始分析'}
            </button>
            <PointCostHint kind="token-audio" />
          </div>
        </div>

        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            if (event.dataTransfer.files?.length) handleFiles(event.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`mt-6 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition-all ${
            dragActive
              ? 'border-emerald-400 bg-emerald-50'
              : analysisItems.length
              ? 'border-emerald-100 bg-emerald-50/40'
              : 'border-slate-200 bg-slate-50 hover:border-emerald-300 hover:bg-emerald-50/40'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) handleFiles(event.target.files);
              event.currentTarget.value = '';
            }}
          />
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-emerald-600 shadow-sm">
            {analysisItems.length ? <FileAudio className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
          </div>
          {analysisItems.length ? (
            <>
              <p className="max-w-xl truncate text-sm font-black text-slate-800">
                {analysisItems.length === 1 ? analysisItems[0].file.name : `已选择 ${analysisItems.length} 个音频`}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {analysisItems.length === 1
                  ? `${formatBytes(analysisItems[0].file.size)} · ${analysisItems[0].file.type || '未知格式'}`
                  : `合计 ${formatBytes(totalSelectedSize)} · 将按顺序逐个分析`}
              </p>
              {analysisItems.length > 1 && (
                <div className="mt-3 flex max-w-2xl flex-wrap justify-center gap-1.5">
                  {analysisItems.slice(0, 5).map(item => (
                    <span key={item.id} className="max-w-[180px] truncate rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                      {item.file.name}
                    </span>
                  ))}
                  {analysisItems.length > 5 && (
                    <span className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                      +{analysisItems.length - 5}
                    </span>
                  )}
                </div>
              )}
              <p className="mt-3 text-[11px] font-bold text-emerald-700">点击可重新选择，或直接点右上角开始分析。</p>
            </>
          ) : (
            <>
              <p className="text-sm font-black text-slate-800">点击上传或把一首/多首音乐拖到这里</p>
              <p className="mt-1 text-xs text-slate-500">支持 MP3 / WAV / M4A / OGG 等浏览器可解码音频。</p>
            </>
          )}
        </div>

        {(loading || error) && (
          <div className={`mt-4 rounded-2xl border p-4 text-xs ${
            error ? 'border-rose-100 bg-rose-50 text-rose-700' : 'border-emerald-100 bg-emerald-50 text-slate-700'
          }`}>
            <div className="flex items-start gap-2">
              {error ? <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-600" />}
              <div className="flex-1">
                <p className="font-bold">{error || '正在检测本地指标并请求 GPT 分析，请稍候...'}</p>
                {loading && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {analysisItems.length > 0 && (
          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-black text-slate-900">批量分析队列</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {analysisItems.length} 个音频 · 已完成 {completedCount} 个{failedCount ? ` · 失败 ${failedCount} 个` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={clearQueue}
                disabled={loading}
                className="inline-flex h-8 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-500 hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                清空列表
              </button>
            </div>

            <div className="space-y-2">
              {analysisItems.map((item, index) => {
                const isActive = item.id === selectedResultId;
                const statusText = item.status === 'pending'
                  ? '等待分析'
                  : item.status === 'analyzing'
                  ? '分析中'
                  : item.status === 'done'
                  ? item.result?.semanticError ? '仅本地结果' : '已完成'
                  : '失败';
                const statusClass = item.status === 'done'
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                  : item.status === 'analyzing'
                  ? 'border-blue-100 bg-blue-50 text-blue-700'
                  : item.status === 'error'
                  ? 'border-rose-100 bg-rose-50 text-rose-700'
                  : 'border-slate-200 bg-white text-slate-500';

                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border bg-white p-3 transition-all ${
                      isActive ? 'border-emerald-300 shadow-sm shadow-emerald-600/10' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-500">
                            {index + 1}
                          </span>
                          <p className="truncate text-xs font-black text-slate-800">{item.file.name}</p>
                        </div>
                        <p className="mt-1 pl-8 text-[10px] text-slate-400">{formatBytes(item.file.size)} · {item.file.type || '未知格式'}</p>
                        {(item.status === 'analyzing' || item.status === 'error') && (
                          <div className="mt-2 pl-8">
                            {item.status === 'analyzing' ? (
                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${item.progress}%` }} />
                              </div>
                            ) : (
                              <p className="text-[10px] font-bold text-rose-600">{item.error}</p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-6 lg:min-w-[650px]">
                        <div className={`flex items-center justify-center rounded-xl border px-2 py-1.5 font-black ${statusClass}`}>
                          {item.status === 'analyzing' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                          {statusText}
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-2 py-1.5 text-center">
                          <p className="font-bold text-slate-400">BPM</p>
                          <p className="font-black text-slate-800">{item.result?.bpm.value || '-'}</p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-2 py-1.5 text-center">
                          <p className="font-bold text-slate-400">Key</p>
                          <p className="truncate font-black text-slate-800">{item.result?.key.name || '-'}</p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-2 py-1.5 text-center">
                          <p className="font-bold text-slate-400">Mode</p>
                          <p className="truncate font-black text-slate-800" title={item.result?.musicalMode?.name}>
                            {item.result?.musicalMode?.englishName || '-'}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-2 py-1.5 text-center">
                          <p className="font-bold text-slate-400">时长</p>
                          <p className="font-black text-slate-800">{item.result ? formatTime(item.result.duration) : '-'}</p>
                        </div>
                        <button
                          type="button"
                          disabled={!item.result}
                          onClick={() => {
                            if (!item.result) return;
                            setResult(item.result);
                            setSelectedResultId(item.id);
                          }}
                          className="rounded-xl bg-slate-900 px-3 py-1.5 font-black text-white transition hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400"
                        >
                          查看详情
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {result && (
        <div className="space-y-6">
          {analysisItems.length > 1 && (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
              <span className="font-black">详细分析：</span>
              {selectedItem?.file.name || result.fileName}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="速度 BPM" value={`${result.bpm.value}`} hint={`备选：${result.bpm.alternatives.join(' / ') || '-'} · ${result.bpm.confidence}置信`} />
            <MetricCard label="调性 Key" value={result.key.name} hint={`${result.key.mode === 'Major' ? '大调' : '小调'}倾向 · ${result.key.confidence}置信`} />
            {result.musicalMode ? (
              <MetricCard
                label="调式 Mode"
                value={result.musicalMode.name}
                hint={`${result.musicalMode.englishName} · ${result.musicalMode.confidence}置信 · ${result.musicalMode.evidence}${result.musicalMode.alternatives.length ? ` · 备选：${result.musicalMode.alternatives.join(' / ')}` : ''}`}
              />
            ) : (
              <MetricCard label="调式 Mode" value="重新分析后生成" hint="旧分析结果未包含调式，请重新点击开始分析。" />
            )}
            <MetricCard label="时长 / 规格" value={formatTime(result.duration)} hint={`${result.sampleRate.toLocaleString()} Hz · ${result.channels} 声道`} />
            <MetricCard label="响度 / 峰值" value={`${result.audioProfile.rmsDb.toFixed(1)} dB`} hint={`Peak ${result.audioProfile.peakDb.toFixed(1)} dBFS · DR ${result.audioProfile.dynamicRangeDb.toFixed(1)} dB`} />
            <MetricCard label="底噪 RMS" value={`${result.audioProfile.noiseFloorRmsDb.toFixed(1)} dBFS`} hint="按最低 10% 能量帧估算，越低越干净。" />
            <MetricCard label="信噪比 SNR" value={`${result.audioProfile.snrDb.toFixed(1)} dB`} hint={result.audioProfile.snrDb >= 36 ? '较干净，适合二次制作。' : '偏低时建议先做降噪或修复。'} />
          </div>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Globe2 className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black text-slate-900">GPT 音频分析</h3>
              </div>
              {result.globalAnalysis ? <ConfidencePill value={result.globalAnalysis.confidence} /> : null}
            </div>

            {result.globalAnalysis ? (
              <div className="mt-4">
                <p className="mb-3 text-xs leading-relaxed text-slate-500">
                  {result.globalAnalysis.analysisBasis === 'audio'
                    ? '本次已由 GPT 直接分析音频片段（最多 36 秒，长音频取开头、中间和结尾）。'
                    : '本次由 GPT 解读本地检测指标，未直接听音；具体风格、乐器和特殊调式无法据此确认。'}
                  {result.globalAnalysis.model ? ` · ${result.globalAnalysis.model}` : ''}
                </p>
                <div className="grid grid-cols-1 border-y border-slate-100 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ['主要风格', result.globalAnalysis.primaryStyle],
                    ['地域 / 文化传统', result.globalAnalysis.regionalTradition],
                    ['调式体系', result.globalAnalysis.modeSystem],
                    ['具体调式', result.globalAnalysis.modeName],
                    ['主音', result.globalAnalysis.tonic],
                    ['律制', result.globalAnalysis.tuningSystem],
                    ['微分音', result.globalAnalysis.microtonal],
                    ['子风格 / 融合风格', result.globalAnalysis.subStyles.join(' / ') || '未识别'],
                  ].map(([label, value], index) => (
                    <div
                      key={label}
                      className={`min-w-0 px-3 py-3 ${index % 4 ? 'xl:border-l xl:border-slate-100' : ''} ${index % 2 ? 'sm:border-l sm:border-slate-100 xl:border-l' : ''}`}
                    >
                      <p className="text-[10px] font-bold text-slate-400">{label}</p>
                      <p className="mt-1 break-words text-sm font-black text-slate-800">{value}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs leading-relaxed text-slate-600">
                  <span className="font-black text-slate-800">判断依据：</span>
                  {result.globalAnalysis.reason}
                </p>
                {result.globalAnalysis.alternatives.length ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    <span className="font-bold text-slate-700">候选：</span>
                    {result.globalAnalysis.alternatives.join(' / ')}
                  </p>
                ) : null}
              </div>
            ) : result.semanticSkipped ? (
              <p className="mt-4 text-xs leading-relaxed text-slate-500">本次测速/测调已完成本地检测，未调用 GPT。需要风格解读时可继续发出指令。</p>
            ) : (
              <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-700">
                <span className="font-black">GPT 分析失败，以下仅保留本地检测结果：</span>
                {result.semanticError || '未返回全球风格与调式结果，请重新分析。'}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
              <div className="mb-4 flex items-center gap-2">
                <Piano className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black text-slate-900">和弦段落倾向</h3>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {result.chords.map((item, index) => (
                  <div key={`${item.section}-${item.chord}-${index}`} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400">{item.section}</p>
                      <p className="mt-0.5 text-base font-black text-slate-900">{item.chord}</p>
                    </div>
                    <ConfidencePill value={item.confidence} />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Guitar className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black text-slate-900">{result.globalAnalysis?.analysisBasis === 'audio' && result.globalAnalysis.instruments?.length ? 'GPT 乐器 / 音色判断' : '本地音色倾向（非乐器识别）'}</h3>
              </div>
              <div className="space-y-3">
                {result.instruments.map((instrument) => (
                  <div key={instrument.name} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-black text-slate-800">{instrument.name}</p>
                      <ConfidencePill value={instrument.confidence} />
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{instrument.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
              <div className="mb-4 flex items-center gap-2">
                <Waves className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black text-slate-900">频段与混音信息</h3>
              </div>
              {[
                ['低频 Bass', result.audioProfile.bassPercent],
                ['中频 Mid', result.audioProfile.midPercent],
                ['高频 High', result.audioProfile.highPercent],
                ['立体声宽度', result.audioProfile.stereoWidth],
              ].map(([label, value]) => (
                <div key={label} className="mb-3 last:mb-0">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">{label}</span>
                    <span className="font-black text-slate-900">{value}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${value}%` }} />
                  </div>
                </div>
              ))}
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <MetricCard label="频谱重心" value={`${Math.round(result.audioProfile.spectralCentroid)} Hz`} hint="数值越高，整体听感越亮。" />
                <MetricCard label="过零率" value={result.audioProfile.zeroCrossingRate.toFixed(3)} hint="可辅助判断噪声、鼓镲和高频瞬态。" />
                <MetricCard label="底噪 RMS" value={`${result.audioProfile.noiseFloorRmsDb.toFixed(1)} dBFS`} hint="用于判断静音段噪声底。" />
                <MetricCard label="SNR 信噪比" value={`${result.audioProfile.snrDb.toFixed(1)} dB`} hint="有效信号相对底噪的距离。" />
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Gauge className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black text-slate-900">制作建议</h3>
              </div>
              <div className="space-y-2">
                {result.productionNotes.map((note) => (
                  <div key={note} className="flex gap-2 rounded-2xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span>{note}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-[11px] leading-relaxed text-amber-800">
            <strong>说明：</strong>BPM、Key、和弦和基础 Mode 由浏览器本地计算估算。GPT 分析会注明输入依据：只有配置音频模型后才会直接分析声音；仅有检测指标时不会据此确认风格、地域、具体乐器或微分音。AI 判断与本地估算均需结合实际听感复核。
          </div>
        </div>
      )}
    </div>
  );
}
