import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileAudio,
  Loader2,
  Play,
  RefreshCw,
  UploadCloud,
  Users,
  Waves,
} from 'lucide-react';
import { transcribeSpeech, type SpeechTranscriptionResult } from '../services/elevenLabsService';
import {
  cloneMultiSpeakerVoicesLocally,
  getLocalVoiceCloneStatus,
  type LocalMultiSpeakerAudioEvent,
  type LocalMultiSpeakerCloneResult,
  type LocalMultiSpeakerProfile,
  type LocalMultiSpeakerSegment,
  type LocalVoiceCloneStatus,
} from '../services/localVoiceCloneService';
import { buildSeedVoiceTimeline, readMediaDuration, type SeedVoiceAudioEvent } from '../services/seedVoiceDriverService';
import { translateTextToLanguage } from '../services/geminiService';
import GeneratedAudioPlayer from './GeneratedAudioPlayer';
import { LOCAL_CLONE_LANGUAGE_TUPLES } from '../services/languageRegistry';

type AdvancedVoiceConversionMode = 'speakers' | 'events';

const VOICE_CONVERSION_AI_TIMEOUT_MS = 240_000;

const EVENT_LABELS: Record<string, string> = {
  laughter: '笑声', breath: '呼吸', quick_breath: '急促呼吸', cough: '咳嗽', sigh: '叹气', noise: '非语言声', mn: '语气词',
};

type PanelProfile = LocalMultiSpeakerProfile & { name: string };

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

function UploadBox({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
      <input ref={inputRef} type="file" accept="audio/*,video/*" className="hidden" onChange={event => onChange(event.target.files?.[0] || null)} />
      {file ? (
        <div className="flex items-center gap-3">
          <FileAudio className="h-5 w-5 shrink-0 text-violet-600" />
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-800">{file.name}</span>
          <button type="button" onClick={() => onChange(null)} className="text-[10px] font-bold text-slate-500 hover:text-slate-900">移除</button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} className="flex w-full items-center justify-center gap-2 py-3 text-xs font-bold text-slate-600 hover:text-violet-700">
          <UploadCloud className="h-4 w-4" /> 选择或拖入原始视频 / 音频
        </button>
      )}
    </div>
  );
}

function speakerIdOf(value: { speaker_id?: string; speakerId?: string } | undefined, fallback: string) {
  return String(value?.speaker_id || value?.speakerId || fallback).trim() || fallback;
}

function joinSpeakerText(left: string, right: string) {
  const previous = left.trim();
  const next = right.trim();
  if (!previous) return next;
  if (!next) return previous;
  const needsSpace = /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(next);
  return `${previous}${needsSpace ? ' ' : ''}${next}`;
}

/**
 * Transcription providers may split one continuous utterance at an arbitrary
 * sentence boundary, even when the same speaker continues without a pause.
 * Merge only tiny, adjacent tail fragments so meaningful pauses, timing and
 * audio-event boundaries remain untouched.
 */
function mergeAdjacentSpeakerTailSegments(segments: LocalMultiSpeakerSegment[]) {
  const merged: LocalMultiSpeakerSegment[] = [];
  segments.forEach(segment => {
    const previous = merged.at(-1);
    const gap = previous ? segment.start - previous.end : Infinity;
    const segmentDuration = segment.end - segment.start;
    const combinedDuration = previous ? segment.end - previous.start : Infinity;
    const canMerge = Boolean(
      previous
      && previous.speakerId === segment.speakerId
      && gap >= -0.02
      && gap <= 0.2
      && segmentDuration <= 2
      && combinedDuration <= 20,
    );
    if (canMerge && previous) {
      previous.end = Math.max(previous.end, segment.end);
      previous.sourceText = joinSpeakerText(previous.sourceText, segment.sourceText);
      return;
    }
    merged.push({ ...segment });
  });
  return merged;
}

function buildSpeakerSegments(result: SpeechTranscriptionResult): LocalMultiSpeakerSegment[] {
  const words = (result.words || []).filter(word => word.type !== 'audio_event' && word.type !== 'spacing' && String(word.text || word.word || '').trim());
  const hasWordSpeakerLabels = words.some(word => Boolean(String(word.speaker_id || word.speakerId || '').trim()));
  const raw = (result.segments || []).map((segment, index) => ({
    id: `segment-${index + 1}`,
    speakerId: speakerIdOf(segment, 'speaker_1'),
    start: Number(segment.start),
    end: Number(segment.end),
    sourceText: String(segment.text || '').replace(/\s+/g, ' ').trim(),
    targetText: '',
  })).filter(segment => segment.sourceText && Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start);
  const hasSegmentSpeakerLabels = raw.some(segment => segment.speakerId !== 'speaker_1');
  if (raw.length > 0 && !hasWordSpeakerLabels) return mergeAdjacentSpeakerTailSegments(raw);
  if (raw.length > 0 && hasSegmentSpeakerLabels && words.length === 0) return mergeAdjacentSpeakerTailSegments(raw);

  const grouped: LocalMultiSpeakerSegment[] = [];
  words.forEach((word, index) => {
    const start = Number(word.start);
    const end = Number(word.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const speakerId = speakerIdOf(word, 'speaker_1');
    const previous = grouped.at(-1);
    if (previous && previous.speakerId === speakerId && start - previous.end < 1.1 && previous.end - previous.start < 10) {
      previous.end = end;
      previous.sourceText = `${previous.sourceText}${/^[,.;!?，。！？；：]/.test(String(word.text || word.word || '')) ? '' : ' '}${String(word.text || word.word || '').trim()}`.trim();
      return;
    }
    grouped.push({ id: `segment-${index + 1}`, speakerId, start, end, sourceText: String(word.text || word.word || '').trim(), targetText: '' });
  });
  return grouped.length > 0 ? mergeAdjacentSpeakerTailSegments(grouped) : mergeAdjacentSpeakerTailSegments(raw);
}

function buildEvents(result: SpeechTranscriptionResult, segments: LocalMultiSpeakerSegment[]): LocalMultiSpeakerAudioEvent[] {
  const timeline = buildSeedVoiceTimeline(result);
  return timeline.events.map((event: SeedVoiceAudioEvent, index) => {
    const owner = segments.find(segment => event.start < segment.end && event.end > segment.start);
    return { ...event, id: `event-${index + 1}`, speakerId: owner?.speakerId || segments[0]?.speakerId || 'speaker_1' };
  });
}

function formatSeconds(value: number) {
  if (!Number.isFinite(value)) return '0.00s';
  return `${value.toFixed(2)}s`;
}

export default function AdvancedVoiceConversionPanel({ mode }: { mode: AdvancedVoiceConversionMode }) {
  const isSpeakerMode = mode === 'speakers';
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [language, setLanguage] = useState('en');
  const [speakerCount, setSpeakerCount] = useState<number | 'auto'>('auto');
  const [segments, setSegments] = useState<LocalMultiSpeakerSegment[]>([]);
  const [events, setEvents] = useState<LocalMultiSpeakerAudioEvent[]>([]);
  const [profiles, setProfiles] = useState<PanelProfile[]>([]);
  const [status, setStatus] = useState<LocalVoiceCloneStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [working, setWorking] = useState<'analyze' | 'generate' | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LocalMultiSpeakerCloneResult | null>(null);
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getLocalVoiceCloneStatus().then(value => { if (!cancelled) setStatus(value); }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '无法读取本地声音克隆状态。');
    }).finally(() => { if (!cancelled) setStatusLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!sourceFile) { setSourceUrl(null); return; }
    const url = URL.createObjectURL(sourceFile);
    setSourceUrl(url);
    void readMediaDuration(sourceFile).then(duration => setSourceDuration(duration)).catch(() => setSourceDuration(0));
    return () => URL.revokeObjectURL(url);
  }, [sourceFile]);

  const engine = status?.defaultEngine || 'chatterbox';
  const engineStatus = status?.engines?.[engine];
  const languageOptions = useMemo(() => {
    const supported = engineStatus?.supportedLanguages;
    if (!supported) return LOCAL_CLONE_LANGUAGE_TUPLES;
    return LOCAL_CLONE_LANGUAGE_TUPLES.filter(([code]) => Object.prototype.hasOwnProperty.call(supported, code));
  }, [engineStatus]);
  const canAnalyze = Boolean(sourceFile && !working);
  const canGenerate = Boolean(sourceFile && segments.length > 0 && profiles.length > 0 && segments.every(segment => segment.sourceText.trim()) && !working && engineStatus?.available);
  const enabledEvents = events.filter(event => selectedEventIds.has(event.id));

  const resetSource = (file: File | null) => {
    setSourceFile(file); setSegments([]); setEvents([]); setProfiles([]); setResult(null); setError(null); setSelectedEventIds(new Set());
  };

  const analyze = async () => {
    if (!sourceFile) return;
    setWorking('analyze'); setError(null); setResult(null);
    try {
      const transcription = await transcribeSpeech(sourceFile, undefined, true, {
        diarize: true,
        numSpeakers: typeof speakerCount === 'number' ? speakerCount : undefined,
      });
      const detectedSegments = buildSpeakerSegments(transcription);
      if (detectedSegments.length === 0) throw new Error('没有识别到可转换的台词，请换一段对白更清晰的素材。');
      const detectedEvents = buildEvents(transcription, detectedSegments);
      const speakerIds = Array.from(new Set(detectedSegments.map(segment => segment.speakerId)));
      const nextProfiles = speakerIds.slice(0, 8).map((speakerId, index) => {
        const speakerSegments = detectedSegments.filter(segment => segment.speakerId === speakerId);
        const first = speakerSegments[0];
        return { id: speakerId, name: `角色 ${index + 1}`, referenceStart: first.start, referenceEnd: Math.min(sourceDuration || first.end, Math.max(first.end, first.start + 4)), referenceRanges: [{ start: first.start, end: Math.min(sourceDuration || first.end, Math.max(first.end, first.start + 8)) }] };
      });
      setSegments(detectedSegments);
      setEvents(detectedEvents); setProfiles(nextProfiles); setSelectedEventIds(new Set(detectedEvents.map(event => event.id)));
      setProgress('正在自动翻译识别到的台词…');
      const translatedResults = await mapWithConcurrency<LocalMultiSpeakerSegment, PromiseSettledResult<string>>(detectedSegments, 3, async segment => {
        try {
          const translated = await translateTextToLanguage(
            segment.sourceText,
            languageOptions.find(item => item[0] === language)?.[1] || language,
            {
              preserveTone: true,
              preserveInterjections: true,
              maxDurationSeconds: Math.max(0.5, segment.end - segment.start),
              timeoutMs: VOICE_CONVERSION_AI_TIMEOUT_MS,
            },
          );
          return { status: 'fulfilled', value: translated.trim() } as PromiseFulfilledResult<string>;
        } catch (reason) {
          return { status: 'rejected', reason } as PromiseRejectedResult;
        }
      });
      const translatedSegments = detectedSegments.map((segment, index) => {
        const translation = translatedResults[index];
        return translation?.status === 'fulfilled' ? { ...segment, targetText: translation.value } : segment;
      });
      const failedTranslations = translatedResults.filter(translation => translation.status === 'rejected').length;
      if (failedTranslations > 0) setError(`已显示原始台词，${failedTranslations} 段译文暂未完成，可直接编辑目标文本。`);
      setSegments(translatedSegments);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '说话人分析失败。'); }
    finally { setProgress(''); setWorking(null); }
  };

  const generate = async () => {
    if (!sourceFile || !canGenerate) return;
    setWorking('generate'); setError(null); setResult(null); setProgress('准备角色音色和时间线…');
    try {
      let preparedSegments = segments;
      if (segments.some(segment => !segment.targetText.trim())) {
        setProgress('正在自动补全目标语言台词…');
        const translatedSegments = await mapWithConcurrency<LocalMultiSpeakerSegment, LocalMultiSpeakerSegment>(segments, 3, async segment => {
          if (segment.targetText.trim()) return segment;
          const translated = await translateTextToLanguage(
            segment.sourceText,
            LOCAL_CLONE_LANGUAGE_TUPLES.find(item => item[0] === language)?.[1] || language,
            {
              preserveTone: true,
              preserveInterjections: true,
              maxDurationSeconds: Math.max(0.5, segment.end - segment.start),
              timeoutMs: VOICE_CONVERSION_AI_TIMEOUT_MS,
            },
          );
          return { ...segment, targetText: translated.trim() };
        });
        if (translatedSegments.some(segment => !segment.targetText.trim())) {
          throw new Error('有台词未能生成目标语言文本，请检查翻译结果后重试。');
        }
        preparedSegments = translatedSegments;
        setSegments(translatedSegments);
      }
      const generated = await cloneMultiSpeakerVoicesLocally(sourceFile, {
        engine,
        dialogueMode: 'multi',
        language,
        sourceDuration,
        profiles: profiles.map(({ name: _name, ...profile }) => profile),
        segments: preparedSegments,
        events: enabledEvents,
        versions: [
          { id: 'A', performance: 'natural', exaggeration: 0.45, cfgWeight: 0.3, temperature: 0.72 },
          { id: 'B', performance: 'expressive', exaggeration: 0.65, cfgWeight: 0.28, temperature: 0.78 },
        ],
      });
      setResult(generated); setActiveAudioId(null); setProgress('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '多人角色转换失败。'); setProgress(''); }
    finally { setWorking(null); }
  };

  const updateSegmentTarget = (id: string, value: string) => setSegments(current => current.map(segment => segment.id === id ? { ...segment, targetText: value } : segment));
  const updateProfileName = (id: string, name: string) => setProfiles(current => current.map(profile => profile.id === id ? { ...profile, name } : profile));
  const toggleEvent = (id: string) => setSelectedEventIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const title = isSpeakerMode ? '多人角色分轨转换' : '语音与声音事件混合';
  const statusLabel = statusLoading ? '检查本地引擎…' : engineStatus?.available ? `${engineStatus.model}${engineStatus.gpu ? ` · ${engineStatus.gpu}` : ''}` : '本地引擎未就绪';
  const detectedSpeakerCount = useMemo(() => new Set(segments.map(segment => segment.speakerId)).size, [segments]);
  const workflowStep = !sourceFile ? 1 : segments.length === 0 ? 2 : segments.some(segment => !segment.targetText.trim()) ? 3 : 4;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start" aria-label={`${title}工作台`}>
      <section className="space-y-5 lg:col-span-8">
        <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
          <div className="flex items-center justify-between gap-2"><p className="text-xs font-black text-violet-900">操作流程</p><span className="text-[10px] font-bold text-violet-600">第 {Math.min(workflowStep, 3)} 步 / 共 3 步</span></div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[['1', '选择目标语种', '上传原始视频或音频'], ['2', '分析台词', '识别说话人和时间码'], ['3', '翻译并生成', '翻译台词后生成 A / B']].map(([number, label, detail], index) => {
              const active = workflowStep === index + 1 || (workflowStep === 4 && index === 2);
              const complete = workflowStep > index + 1;
              return <div key={number} className={`rounded-xl border px-3 py-2 ${active ? 'border-violet-400 bg-white shadow-sm' : complete ? 'border-emerald-200 bg-emerald-50/60' : 'border-violet-100 bg-violet-50'}`}><div className="flex items-center gap-2"><span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${complete ? 'bg-emerald-500 text-white' : active ? 'bg-violet-600 text-white' : 'bg-violet-100 text-violet-500'}`}>{complete ? '✓' : number}</span><span className="text-[11px] font-black text-slate-800">{label}</span></div><p className="mt-1 pl-7 text-[10px] text-slate-500">{detail}</p></div>;
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black text-slate-800">1. 选择目标语种并上传素材</p><p className="mt-1 text-[10px] text-slate-500">先选择要输出的语言，再上传包含完整对白的原始视频或音频。</p></div><FileAudio className="h-5 w-5 text-violet-600" /></div>
          <div className="mt-4"><UploadBox file={sourceFile} onChange={resetSource} /></div>
          <div className="mt-3 flex flex-wrap items-center gap-2 sm:flex-nowrap"><label className="inline-flex w-full items-center gap-2 sm:w-auto"><span className="shrink-0 text-[10px] font-black text-slate-600">目标语种</span><select value={language} onChange={event => setLanguage(event.target.value)} title={`当前引擎支持 ${languageOptions.length} 种语言`} className="w-24 min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px] font-bold text-slate-700">{languageOptions.map(item => <option key={item[0]} value={item[0]}>{item[1]}</option>)}</select></label>{isSpeakerMode ? <label className="inline-flex w-full items-center gap-2 sm:w-auto"><span className="shrink-0 text-[10px] font-black text-slate-600">说话人数</span><select value={speakerCount} onChange={event => setSpeakerCount(event.target.value === 'auto' ? 'auto' : Number(event.target.value))} className="w-32 min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px] font-bold text-slate-700"><option value="auto">自动识别说话人</option>{[2, 3, 4, 5, 6, 7, 8].map(value => <option key={value} value={value}>{value} 位说话人</option>)}</select></label> : null}<button type="button" disabled={!canAnalyze} onClick={() => void analyze()} className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-2 text-[10px] font-black text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">{working === 'analyze' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}第 2 步：分析台词</button></div>
          {sourceUrl ? <audio controls preload="metadata" src={sourceUrl} className="mt-3 h-8 w-full" /> : null}
        </div>

        {segments.length > 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-black text-slate-800">3. 翻译并确认台词</p><p className="mt-1 text-[10px] text-slate-500">已识别 {detectedSpeakerCount} 个角色、{segments.length} 段台词；分析完成后自动生成译文，也可以直接修改。</p></div></div><div className="mt-4 space-y-3">{segments.map((segment, index) => <div key={segment.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center justify-between gap-2 text-[10px] text-slate-500"><span className="font-black text-violet-700">{profiles.find(profile => profile.id === segment.speakerId)?.name || segment.speakerId}</span><span>{formatSeconds(segment.start)} - {formatSeconds(segment.end)}</span></div><p className="mt-2 text-[11px] leading-relaxed text-slate-600">{segment.sourceText}</p><textarea value={segment.targetText} onChange={event => updateSegmentTarget(segment.id, event.target.value)} placeholder={`第 ${index + 1} 段目标语言台词`} className="mt-2 min-h-12 w-full resize-y rounded-lg border border-violet-100 bg-white p-2 text-[11px] text-slate-800 outline-none focus:border-violet-400" /></div>)}</div></div> : null}

        {profiles.length > 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-xs font-black text-slate-800">生成前确认角色音色</p><p className="mt-1 text-[10px] text-slate-500">系统已为每个角色提取参考音；确认无误后即可生成 A / B。</p></div><Users className="h-4 w-4 text-violet-600" /></div><div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">{profiles.map(profile => <label key={profile.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><span className="text-[10px] font-black text-slate-500">{profile.id} · 参考 {formatSeconds(profile.referenceStart)}</span><input value={profile.name} onChange={event => updateProfileName(profile.id, event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-violet-400" /></label>)}</div></div> : null}

        {events.length > 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-xs font-black text-slate-800">声音事件</p><p className="mt-1 text-[10px] text-slate-500">勾选要保留的事件；事件不会被翻译成普通台词。</p></div><Waves className="h-4 w-4 text-amber-600" /></div><div className="mt-3 flex flex-wrap gap-2">{events.map(event => <button key={event.id} type="button" onClick={() => toggleEvent(event.id)} className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold ${selectedEventIds.has(event.id) ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>{EVENT_LABELS[event.type] || event.type} · {formatSeconds(event.start)}</button>)}</div><p className="mt-3 text-[10px] text-slate-500">将保留 {enabledEvents.length}/{events.length} 个事件</p></div> : null}

        {error ? <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[11px] leading-relaxed text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
        {progress ? <p className="rounded-xl bg-violet-50 px-3 py-2 text-[10px] font-bold text-violet-700">{progress}</p> : null}
        <button type="button" disabled={!canGenerate} onClick={() => void generate()} className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40 ${isSpeakerMode ? 'bg-violet-600 hover:bg-violet-700' : 'bg-amber-600 hover:bg-amber-700'}`}>{working === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{working === 'generate' ? '正在生成两个试听版本…' : '完成流程：生成 A / B 两个试听版本'}</button>
      </section>

      <aside className="space-y-4 lg:col-span-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-black text-slate-800">本地生成引擎</p><span className={`h-2 w-2 rounded-full ${engineStatus?.available ? 'bg-emerald-500' : 'bg-amber-400'}`} /></div><p className="mt-2 text-[10px] leading-relaxed text-slate-500">{statusLabel}</p>{engineStatus?.reason ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-[10px] leading-relaxed text-amber-800">{engineStatus.reason}</p> : null}</div>
        {result ? <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-xs font-black text-emerald-800"><CheckCircle2 className="h-4 w-4" />转换完成</div><p className="mt-2 text-[10px] leading-relaxed text-slate-500">保留事件 {result.timeline.preservedEventCount} 个 · 输出 {formatSeconds(result.timeline.outputDuration)}</p><div className="mt-4 space-y-3">{result.options.map(option => <GeneratedAudioPlayer key={option.id} id={`voice-conversion-${option.id}`} url={option.data.audioUrl} title={`版本 ${option.id} · ${option.performance === 'expressive' ? '表达版' : '稳定版'}`} titleBadge={`版本 ${option.id}`} meta={option.speakerSimilarity ? `音色相似度 ${(option.speakerSimilarity * 100).toFixed(0)}%` : undefined} durationHint={option.data.generatedDuration || result.timeline.outputDuration} downloadFileName={`voice-conversion-${option.id}.wav`} downloadLabel="下载 WAV" activeId={activeAudioId} setActiveId={setActiveAudioId} stopEventName="advanced-voice-conversion-stop-others" />)}</div></div> : <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-[10px] leading-relaxed text-slate-400">完成分析、翻译并生成后，A / B 两个时间线版本会显示在这里。</div>}
      </aside>
    </div>
  );
}
