import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileAudio, Loader2, Pause, Play, RefreshCw, UploadCloud, Volume2 } from 'lucide-react';
import { convertWithSeedVc, getSeedVcStatus, type SeedVcConvertOptions, type SeedVcModel, type SeedVcStatus } from '../services/seedVoiceConversionService';
import { transcribeSpeech, generateVoice } from '../services/elevenLabsService';
import { translateTextToLanguage } from '../services/geminiService';
import type { VoiceItem } from '../data/voices';
import SeamlessExpressivePanel from './SeamlessExpressivePanel';
import AdvancedVoiceConversionPanel from './AdvancedVoiceConversionPanel';
import {
  buildSeedVoiceTimeline,
  readMediaDuration,
  renderSeedVoiceDriver,
  type SeedVoiceAudioEvent,
  type SeedVoiceTimedSegment,
} from '../services/seedVoiceDriverService';

const DEFAULT_OPTIONS: SeedVcConvertOptions = {
  model: 'v2',
  diffusionSteps: 12,
  lengthAdjust: 1,
  intelligibilityCfgRate: 0.7,
  similarityCfgRate: 0.7,
  convertStyle: true,
  temperature: 0.7,
  topP: 0.9,
  repetitionPenalty: 1.1,
};

const formatTime = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const whole = Math.floor(value);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function UploadCard({
  title,
  hint,
  file,
  accept,
  onFile,
}: {
  title: string;
  hint: string;
  file: File | null;
  accept: string;
  onFile: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`rounded-2xl border p-4 transition-colors ${dragging ? 'border-emerald-400 bg-emerald-50/60' : 'border-slate-200 bg-white'}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); onFile(event.dataTransfer.files[0] || null); }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black text-slate-800">{title}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{hint}</p>
        </div>
        <FileAudio className="h-5 w-5 shrink-0 text-emerald-600" />
      </div>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(event) => onFile(event.target.files?.[0] || null)} />
      {file ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-emerald-900">{file.name}</span>
          <button type="button" className="text-[10px] font-bold text-emerald-700 hover:text-emerald-900" onClick={() => onFile(null)}>移除</button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-3 text-[11px] font-bold text-slate-500 transition-colors hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700">
          <UploadCloud className="h-4 w-4" /> 选择或拖入音频
        </button>
      )}
    </div>
  );
}

interface VoiceConversionProps {
  displayVoices?: VoiceItem[];
}

type ConversionPlan = 'plan1' | 'plan2' | 'plan3' | 'plan4';

const conversionPlans: Array<{
  id: ConversionPlan;
  label: string;
  title: string;
  description: string;
  tone: string;
}> = [
  { id: 'plan1', label: '方案一 · Seed-VC', title: '目标语言驱动 + Seed-VC', description: '自动提取台词、翻译并生成目标语言驱动音频，再由 Seed-VC 迁移原始音色与表达。', tone: 'border-emerald-200 bg-emerald-50/60 text-emerald-800' },
  { id: 'plan2', label: '方案二', title: '多人角色分轨转换', description: '先识别说话人，再为每个角色单独建立音色和台词轨道，避免多人对话串音。', tone: 'border-violet-200 bg-violet-50/60 text-violet-800' },
  { id: 'plan3', label: '方案三', title: '语音与声音事件混合', description: '在台词转换之外保留笑声、呼吸、语气词和环境声等非语言事件。', tone: 'border-amber-200 bg-amber-50/60 text-amber-800' },
  { id: 'plan4', label: '方案四 · SeamlessExpressive（开发中）', title: '表达式语音翻译（开发中）', description: '原始语音直接翻译成目标语言语音，迁移语速、停顿与表达风格。', tone: 'border-sky-200 bg-sky-50/60 text-sky-800' },
];

const targetLanguages = [
  ['zh', '中文'], ['en', '英文'], ['ja', '日文'], ['ko', '韩文'], ['fr', '法文'], ['de', '德文'],
  ['es', '西班牙文'], ['pt', '葡萄牙文'], ['it', '意大利文'], ['ru', '俄文'], ['ar', '阿拉伯文'], ['hi', '印地文'],
];

export default function VoiceConversion({ displayVoices = [] }: VoiceConversionProps) {
  const [activePlan, setActivePlan] = useState<ConversionPlan>('plan1');
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [targetText, setTargetText] = useState('');
  const [timedSegments, setTimedSegments] = useState<SeedVoiceTimedSegment[]>([]);
  const [audioEvents, setAudioEvents] = useState<SeedVoiceAudioEvent[]>([]);
  const [originalDuration, setOriginalDuration] = useState(0);
  const [driverProgress, setDriverProgress] = useState('');
  const [driverPaceSummary, setDriverPaceSummary] = useState<{ adjusted: number; maxRate: number } | null>(null);
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [textLoading, setTextLoading] = useState<'transcribe' | 'translate' | 'draft' | null>(null);
  const [status, setStatus] = useState<SeedVcStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultDuration, setResultDuration] = useState<number | undefined>();
  const [resultTimelineInfo, setResultTimelineInfo] = useState<{ preservedEvents: number; aligned: boolean } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const resultAudioRef = useRef<HTMLAudioElement | null>(null);
  const activePlanConfig = conversionPlans.find(plan => plan.id === activePlan) || conversionPlans[0];

  useEffect(() => {
    let cancelled = false;
    setStatusLoading(true);
    getSeedVcStatus().then((value) => { if (!cancelled) setStatus(value); }).catch((reason) => {
      if (!cancelled) setStatus({ available: false, model: 'Seed-VC V2', pythonFound: false, scriptFound: false, modelCached: false, reason: reason instanceof Error ? reason.message : '无法读取本地模型状态' });
    }).finally(() => { if (!cancelled) setStatusLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!sourceFile) { setSourceUrl(null); return; }
    const url = URL.createObjectURL(sourceFile); setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sourceFile]);
  useEffect(() => {
    if (!referenceFile) { setReferenceUrl(null); return; }
    const url = URL.createObjectURL(referenceFile); setReferenceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [referenceFile]);
  useEffect(() => {
    if (!originalFile) { setOriginalUrl(null); return; }
    const url = URL.createObjectURL(originalFile); setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [originalFile]);

  const canConvert = Boolean(sourceFile && referenceFile && status?.available && !isConverting);
  const statusLabel = useMemo(() => {
    if (statusLoading) return '检查本地运行环境…';
    if (status?.available) return `本地可用${status.gpu ? ` · ${status.gpu}` : ''}`;
    return '需要安装本地模型';
  }, [status, statusLoading]);

  const handleConvert = async () => {
    if (!sourceFile || !referenceFile) return;
    setError(null); setResultUrl(null); setResultTimelineInfo(null); setIsConverting(true); setIsPlaying(false);
    try {
      const result = await convertWithSeedVc(sourceFile, referenceFile, options, {
        timelineSource: originalFile || undefined,
        targetDuration: originalDuration || undefined,
        events: audioEvents,
      });
      setResultUrl(result.audioUrl); setResultDuration(result.generatedDuration);
      setResultTimelineInfo({
        preservedEvents: result.preservedEventCount || 0,
        aligned: result.timelineAligned === true,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '声音转换失败');
    } finally { setIsConverting(false); }
  };

  const handleTranscribe = async () => {
    if (!originalFile) return;
    setError(null); setTextLoading('transcribe');
    try {
      const result = await transcribeSpeech(originalFile, undefined, true);
      const timeline = buildSeedVoiceTimeline(result);
      const text = timeline.segments.length > 0
        ? timeline.segments.map(segment => segment.sourceText).join('\n\n')
        : String(result.text || result.segments?.map(segment => segment.text || '').join(' ') || '').trim();
      const detectedDuration = Math.max(
        originalDuration,
        ...timeline.segments.map(segment => segment.end),
        ...timeline.events.map(event => event.end),
      );
      setTimedSegments(timeline.segments);
      setAudioEvents(timeline.events);
      if (detectedDuration > 0) setOriginalDuration(detectedDuration);
      setSourceText(text);
      setTargetText('');
      setSourceFile(null);
      setDriverPaceSummary(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '台词提取失败'); }
    finally { setTextLoading(null); }
  };

  const handleTranslate = async () => {
    if (!sourceText.trim()) return;
    setError(null); setTextLoading('translate');
    try {
      const languageLabel = targetLanguages.find(([code]) => code === targetLanguage)?.[1] || targetLanguage;
      if (timedSegments.length > 0) {
        const translated = await mapWithConcurrency<SeedVoiceTimedSegment, SeedVoiceTimedSegment>(timedSegments, 4, async (segment) => ({
          ...segment,
          targetText: (await translateTextToLanguage(segment.sourceText, languageLabel, {
            preserveTone: true,
            maxDurationSeconds: Math.max(0.5, segment.end - segment.start),
          })).trim(),
        }));
        setTimedSegments(translated);
        setTargetText(translated.map(segment => segment.targetText).join('\n\n'));
      } else {
        setTargetText(await translateTextToLanguage(sourceText, languageLabel, { preserveTone: true }));
      }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : '台词翻译失败'); }
    finally { setTextLoading(null); }
  };

  const handleDraft = async () => {
    if (!targetText.trim() || displayVoices.length === 0) return;
    setError(null); setTextLoading('draft');
    try {
      const voice = displayVoices[0];
      if (timedSegments.length > 0 && timedSegments.every(segment => segment.targetText.trim())) {
        let completed = 0;
        setDriverProgress(`正在并行生成 0/${timedSegments.length} 段目标语音…`);
        const blobs = await mapWithConcurrency<SeedVoiceTimedSegment, Blob>(timedSegments, 3, async (segment) => {
          const blob = await generateVoice(segment.targetText, voice.id, 0.45, 0.82, 0.12, {
            voiceSource: voice.source,
            publicOwnerId: voice.publicOwnerId,
            voiceName: voice.name,
          });
          completed += 1;
          setDriverProgress(`正在并行生成 ${completed}/${timedSegments.length} 段目标语音…`);
          return blob;
        });
        setDriverProgress('正在按原时间码排列语音和停顿…');
        const rendered = await renderSeedVoiceDriver(timedSegments, blobs, originalDuration);
        setSourceFile(rendered.file);
        setDriverPaceSummary({ adjusted: rendered.paceAdjustedCount, maxRate: rendered.maxPlaybackRate });
      } else {
        const blob = await generateVoice(targetText, voice.id, 0.45, 0.82, 0.12, { voiceSource: voice.source, publicOwnerId: voice.publicOwnerId, voiceName: voice.name });
        setSourceFile(new File([blob], `seed-vc-draft-${targetLanguage}.mp3`, { type: blob.type || 'audio/mpeg' }));
        setDriverPaceSummary(null);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '目标语言驱动音频生成失败'); }
    finally { setTextLoading(null); setDriverProgress(''); }
  };

  const updateOriginalFile = (file: File | null) => {
    setOriginalFile(file);
    setSourceFile(null);
    setReferenceFile(file);
    setSourceText('');
    setTargetText('');
    setTimedSegments([]);
    setAudioEvents([]);
    setOriginalDuration(0);
    setDriverPaceSummary(null);
    setResultUrl(null);
    if (file) {
      void readMediaDuration(file).then(duration => {
        if (Number.isFinite(duration) && duration > 0) setOriginalDuration(duration);
      }).catch(() => undefined);
    }
  };

  const updateSourceDialogue = (value: string) => {
    setSourceText(value);
    if (timedSegments.length === 0) return;
    const paragraphs = value.split(/\n\s*\n/);
    setTimedSegments(current => current.map((segment, index) => ({
      ...segment,
      sourceText: index < current.length - 1
        ? (paragraphs[index] || '').trim()
        : paragraphs.slice(index).join('\n\n').trim(),
      targetText: '',
    })));
    setTargetText('');
    setSourceFile(null);
  };

  const updateTargetDialogue = (value: string) => {
    setTargetText(value);
    if (timedSegments.length === 0) return;
    const paragraphs = value.split(/\n\s*\n/);
    setTimedSegments(current => current.map((segment, index) => ({
      ...segment,
      targetText: index < current.length - 1
        ? (paragraphs[index] || '').trim()
        : paragraphs.slice(index).join('\n\n').trim(),
    })));
    setSourceFile(null);
    setDriverPaceSummary(null);
  };

  const togglePlayback = () => {
    const audio = resultAudioRef.current; if (!audio) return;
    if (audio.paused) { void audio.play(); } else { audio.pause(); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8" aria-label="声音转换工作台">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2"><RefreshCw className="h-5 w-5 text-emerald-600" /><h1 className="text-xl font-black tracking-tight text-slate-900">声音转换</h1><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">{activePlanConfig.label}</span></div>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-500">{activePlanConfig.description}</p>
        </div>
        {activePlan === 'plan1' ? <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold ${status?.available ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-amber-100 bg-amber-50 text-amber-700'}`}><span className={`h-2 w-2 rounded-full ${status?.available ? 'bg-emerald-500' : 'bg-amber-400'}`} />{statusLabel}</div> : null}
      </div>

      <nav className="mx-auto grid w-full max-w-4xl grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 sm:grid-cols-4" aria-label="声音转换方案">
        {conversionPlans.map((plan) => {
          const isActive = activePlan === plan.id;
          return (
            <button
              key={plan.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => setActivePlan(plan.id)}
              className={`rounded-lg px-2 py-2 text-left transition-colors ${isActive ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'}`}
            >
              <span className="block text-xs font-black">{plan.label}</span>
              <span className="mt-0.5 block truncate text-[10px] font-medium opacity-70">{plan.title}</span>
            </button>
          );
        })}
      </nav>

      <div className={activePlan === 'plan1' ? '' : 'hidden'}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        <div className="space-y-5 lg:col-span-7">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black text-emerald-900">第一步：上传原始素材</p><p className="mt-1 text-[10px] leading-relaxed text-emerald-800/80">上传原始视频或音频，系统会从这里自动提取台词。你不需要先准备目标语言音频。</p></div><FileAudio className="h-5 w-5 text-emerald-600" /></div>
            <UploadCard title="原始素材（视频 / 音频）" hint="包含原始人物声音和完整对白的素材。上传后会提取逐句时间码、停顿和笑声，并默认用它作为参考音。" file={originalFile} accept="audio/*,video/*" onFile={updateOriginalFile} />
            <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" disabled={!originalFile || Boolean(textLoading)} onClick={handleTranscribe} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{textLoading === 'transcribe' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}自动提取台词</button>{originalUrl && <audio controls src={originalUrl} className="h-8 min-w-[180px] flex-1" />}</div>
            {timedSegments.length > 0 ? <p className="mt-3 text-[10px] font-bold text-emerald-800">已建立 {timedSegments.length} 段台词时间槽 · {audioEvents.length} 个笑声/呼吸事件 · 原时长 {formatTime(originalDuration)}</p> : null}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black text-slate-800">第二步：确认目标语言台词</p><p className="mt-1 text-[10px] text-slate-500">每个空行对应一段原时间槽；笑声不会写成台词，而是保留原声。</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">逐句时间线</span></div><textarea value={sourceText} onChange={(event) => updateSourceDialogue(event.target.value)} placeholder="点击“自动提取台词”后，原始台词会显示在这里" className="mt-4 min-h-20 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200" /><div className="mt-3 flex flex-col gap-2 sm:flex-row"><select value={targetLanguage} onChange={(event) => { setTargetLanguage(event.target.value); setTargetText(''); setSourceFile(null); setTimedSegments(current => current.map(segment => ({ ...segment, targetText: '' }))); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 outline-none focus:border-emerald-400">{targetLanguages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><button type="button" disabled={!sourceText.trim() || Boolean(textLoading)} onClick={handleTranslate} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">{textLoading === 'translate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}逐句翻译</button></div><textarea value={targetText} onChange={(event) => updateTargetDialogue(event.target.value)} placeholder="逐句翻译会保留空行和原始时间槽，也可以手动修改" className="mt-3 min-h-20 w-full resize-y rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 text-xs text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200" /><button type="button" disabled={!targetText.trim() || displayVoices.length === 0 || Boolean(textLoading)} onClick={handleDraft} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{textLoading === 'draft' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}生成时间线驱动音频{displayVoices.length === 0 ? '（暂无可用 TTS 声线）' : ''}</button>{driverProgress ? <p className="mt-2 text-[10px] font-bold text-emerald-700">{driverProgress}</p> : null}</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <UploadCard title="待转换语音（时间线驱动）" hint="自动生成与原素材等长的目标语音；未说话的位置保持空白，不做整段拉伸。" file={sourceFile} accept="audio/*,video/*" onFile={setSourceFile} />
            <UploadCard title="原始参考音（自动使用，可替换）" hint="默认使用上面的原始素材。若有更干净的同一人物语音片段，可在这里替换以提升音色稳定性。" file={referenceFile} accept="audio/*,video/*" onFile={setReferenceFile} />
          </div>
          {(sourceUrl || referenceUrl) && <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{sourceUrl && <audio controls src={sourceUrl} className="h-9 w-full" />}{referenceUrl && <audio controls src={referenceUrl} className="h-9 w-full" />}</div>}
          {driverPaceSummary ? <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] text-emerald-800">驱动音频已对齐 {formatTime(originalDuration)}；{driverPaceSummary.adjusted > 0 ? `${driverPaceSummary.adjusted} 段仅做轻微调整，最大 ${driverPaceSummary.maxRate.toFixed(2)}x` : '所有台词保持自然语速'}。</div> : null}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between"><div><p className="text-xs font-black text-slate-800">模型与转换策略</p><p className="mt-1 text-[10px] text-slate-500">默认 12 步快速档；时间线和笑声在模型转换后单独恢复。</p></div><Volume2 className="h-5 w-5 text-slate-400" /></div>
            <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" aria-pressed={options.model === 'v2'} onClick={() => setOptions((prev) => ({ ...prev, model: 'v2' as SeedVcModel }))} className={`rounded-xl border px-3 py-3 text-left transition-colors ${options.model === 'v2' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}><span className="block text-xs font-black">Seed-VC V2</span><span className="mt-1 block text-[10px] opacity-75">风格 / 情绪迁移</span></button><button type="button" aria-pressed={options.model === 'v1'} onClick={() => setOptions((prev) => ({ ...prev, model: 'v1' as SeedVcModel }))} className={`rounded-xl border px-3 py-3 text-left transition-colors ${options.model === 'v1' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}><span className="block text-xs font-black">Seed-VC V1</span><span className="mt-1 block text-[10px] opacity-75">更轻量的兼容模式</span></button></div>
            <div className="mt-5 grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
              {([['similarityCfgRate', '音色相似度', 0, 1, 0.05], ['intelligibilityCfgRate', '内容清晰度', 0, 1, 0.05], ['lengthAdjust', '语速倍率', 0.5, 1.5, 0.01], ['diffusionSteps', '扩散步数', 8, 50, 1]] as const).map(([key, label, min, max, step]) => <label key={key} className="block"><div className="mb-1 flex justify-between text-[10px] font-bold text-slate-600"><span>{label}</span><span className="font-mono text-emerald-700">{options[key]}</span></div><input type="range" min={min} max={max} step={step} value={options[key]} onChange={(event) => setOptions((prev) => ({ ...prev, [key]: Number(event.target.value) }))} className="w-full accent-emerald-600" /></label>)}
            </div>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setOptions(prev => ({ ...prev, diffusionSteps: 8 }))} className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold ${options.diffusionSteps === 8 ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>极速 · 8 步</button><button type="button" onClick={() => setOptions(prev => ({ ...prev, diffusionSteps: 12 }))} className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold ${options.diffusionSteps === 12 ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>快速 · 12 步</button><button type="button" onClick={() => setOptions(prev => ({ ...prev, diffusionSteps: 20 }))} className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold ${options.diffusionSteps === 20 ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>精细 · 20 步</button></div>
            <label className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5"><span><span className="block text-[11px] font-bold text-slate-700">迁移原始语气与情绪</span><span className="mt-0.5 block text-[10px] text-slate-500">启用后会更积极参考原始参考音的表达风格</span></span><input type="checkbox" checked={options.convertStyle} onChange={(event) => setOptions((prev) => ({ ...prev, convertStyle: event.target.checked }))} className="h-4 w-4 accent-emerald-600" /></label>
          </div>
          {!statusLoading && !status?.available && <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[11px] leading-relaxed text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-black">本地 Seed-VC 尚未就绪</p><p className="mt-1">{status?.reason || '请配置 Python 运行时、Seed-VC 脚本和模型依赖。界面已准备好，环境可用后无需更改操作流程。'}</p></div></div>}
          {error && <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-[11px] leading-relaxed text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
          <button type="button" disabled={!canConvert} onClick={handleConvert} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45">{isConverting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{isConverting ? 'Seed-VC 转换并恢复时间线…' : '开始声音转换'}</button>
        </div>

        <div className="space-y-5 lg:col-span-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><p className="text-xs font-black text-slate-800">转换结果</p></div>{resultUrl ? <div className="mt-4 space-y-3"><audio ref={resultAudioRef} src={resultUrl} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} /><div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3"><button type="button" onClick={togglePlayback} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">{isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}</button><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold text-slate-800">Seed-VC {options.model.toUpperCase()} 转换结果</p><p className="mt-1 text-[10px] text-slate-500">原始 {formatTime(originalDuration)} · 输出 {formatTime(resultDuration || 0)}{resultTimelineInfo?.aligned ? ' · 已对齐' : ''}</p><p className="mt-0.5 text-[10px] text-slate-400">保留原声事件 {resultTimelineInfo?.preservedEvents || 0} 个</p></div><a href={resultUrl} download="seed-vc-converted.wav" className="rounded-lg p-2 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700" title="下载结果"><Download className="h-4 w-4" /></a></div></div> : <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center"><Play className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-2 text-[11px] font-bold text-slate-500">完成一次转换后，结果会显示在这里</p><p className="mt-1 text-[10px] text-slate-400">输出会保持原时长、逐句位置和原始笑声</p></div>}</div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black text-slate-800">处理流程</p><div className="mt-3 space-y-3 text-[10px] leading-relaxed text-slate-500"><p><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 font-black text-emerald-700">1</span>逐句识别时间码，台词之间的停顿保持空白。</p><p><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 font-black text-emerald-700">2</span>目标语言按段并行生成，再放回原说话位置后交给 Seed-VC。</p><p><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 font-black text-emerald-700">3</span>笑声、呼吸直接从原素材提取并带尾音混回，不再让 TTS 模仿。</p></div></div>
        </div>
      </div>
      </div>
      {activePlan === 'plan4' ? <SeamlessExpressivePanel /> : null}
      {activePlan === 'plan2' ? <AdvancedVoiceConversionPanel mode="speakers" /> : null}
      {activePlan === 'plan3' ? <AdvancedVoiceConversionPanel mode="events" /> : null}
    </div>
  );
}
