/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Download,
  FileAudio,
  Info,
  Languages,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { HistoryItem } from '../types';
import { transcribeSpeech, translateDubbingV2Audio, TranslateDubbingResult } from '../services/elevenLabsService';
import { translateTextToLanguage } from '../services/geminiService';
import {
  cloneMultiSpeakerVoicesLocally,
  cloneVoiceLocally,
  getLocalVoiceCloneStatus,
  LocalMultiSpeakerCloneResult,
  LocalVoiceCloneEngine,
  LocalVoiceCloneStatus,
} from '../services/localVoiceCloneService';
import { convertWithSeedVc, type SeedVcConvertOptions, type SeedVcConvertResult } from '../services/seedVoiceConversionService';
import { downloadAudioHelper } from '../utils/downloadHelper';
import {
  COSYVOICE_LANGUAGE_OPTIONS,
  DUBBING_SOURCE_LANGUAGE_OPTIONS,
  DUBBING_TARGET_LANGUAGE_OPTIONS,
  getAudioLanguage,
  LOCAL_CLONE_LANGUAGE_OPTIONS,
} from '../services/languageRegistry';

interface CrossLanguageDubbingProps {
  initialFile?: File;
  assistantRequestId?: string;
  initialTargetLanguage?: string;
  cloneModeOnly?: boolean;
  setHistoryList: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
  onAudioPlay?: () => void;
}

type TranslateDubbingOptionId = 'A' | 'B';
type DubbingMode = 'dubbing_v2' | 'self_hosted';
type LocalDialogueMode = 'single' | 'multi';

const DUBBING_V2_AVAILABLE = false;
const VOICE_CONVERSION_AI_TIMEOUT_MS = 240_000;
type LocalCloneInputMode = 'text' | 'speech_to_speech';

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

interface MultiSpeakerSegment {
  id: string;
  speakerId: string;
  start: number;
  end: number;
  sourceText: string;
  targetText: string;
}

type MultiSpeakerAudioEventType = 'laughter' | 'breath' | 'quick_breath' | 'cough' | 'sigh' | 'noise' | 'mn';

interface MultiSpeakerAudioEvent {
  id: string;
  speakerId: string;
  start: number;
  end: number;
  type: MultiSpeakerAudioEventType;
  sourceText: string;
}

interface MultiSpeakerProfile {
  id: string;
  name: string;
  color: string;
  referenceStart: number;
  referenceEnd: number;
  referenceRanges: Array<{ start: number; end: number }>;
  segmentIds: string[];
}

interface PendingTranslateDubbingOption {
  id: TranslateDubbingOptionId;
  data: TranslateDubbingResult;
  displayName: string;
}

const speakerColors = ['#0284c7', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4f46e5'];
const SENTENCE_END_PATTERN = /[.!?。！？…]$/;
const audioEventLabels: Record<MultiSpeakerAudioEventType, string> = {
  laughter: '笑声',
  breath: '呼吸',
  quick_breath: '吸气',
  cough: '咳嗽',
  sigh: '叹气',
  noise: '其他原声',
  mn: '语气声',
};

const localSpeechToSpeechOptions: SeedVcConvertOptions = {
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

const mapSeedVcResultToDubbingResult = (result: SeedVcConvertResult): TranslateDubbingResult => ({
  audioUrl: result.audioUrl,
  sourceText: '',
  translatedText: '',
  sourceDuration: result.sourceDuration,
  generatedDuration: result.generatedDuration,
  outputDuration: result.generatedDuration,
  timingMode: 'natural',
  dubbingModel: 'local_seed_vc',
  outputFormat: 'wav',
  speakerSimilarity: undefined,
});

const normalizeAudioEvent = (value: string): MultiSpeakerAudioEventType => {
  const event = value.toLowerCase().replace(/[\[\]()<>]/g, ' ').replace(/[_-]+/g, ' ').trim();
  if (/laugh|chuckle|giggle|笑声|大笑|轻笑|发笑/.test(event)) return 'laughter';
  if (/quick\s*breath|吸气|急促呼吸/.test(event)) return 'quick_breath';
  if (/sigh|叹气/.test(event)) return 'sigh';
  if (/breath|gasp|呼吸|喘气/.test(event)) return 'breath';
  if (/cough|throat\s*clear|咳嗽|清嗓/.test(event)) return 'cough';
  if (/^\s*(mn|hmm+|uh-?huh|嗯|哼|嗯哼)\s*$/.test(event)) return 'mn';
  return 'noise';
};

const normalizeSpeakerId = (value: unknown) => {
  const normalized = String(value || '').trim();
  return normalized || 'speaker_0';
};

const joinMultiSpeakerText = (left: string, right: string) => {
  const previous = left.trim();
  const next = right.trim();
  if (!previous) return next;
  if (!next) return previous;
  const needsSpace = /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(next);
  return `${previous}${needsSpace ? ' ' : ''}${next}`;
};

const mergeAdjacentMultiSpeakerTailSegments = (segments: MultiSpeakerSegment[]) => {
  const merged: MultiSpeakerSegment[] = [];
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
      previous.sourceText = joinMultiSpeakerText(previous.sourceText, segment.sourceText);
      return;
    }
    merged.push({ ...segment });
  });
  return merged;
};

const buildMultiSpeakerDialogue = (transcription: Awaited<ReturnType<typeof transcribeSpeech>>) => {
  const rawTimedWords = (transcription.words || []).flatMap((word, index) => {
    const text = String(word.text ?? word.word ?? '');
    const start = Number(word.start);
    const end = Number(word.end);
    if (!text.trim() || !Number.isFinite(start) || !Number.isFinite(end)) return [];
    return [{
      index,
      text,
      start: Math.max(0, start),
      end: Math.max(start, end),
      speakerId: String(word.speaker_id ?? word.speakerId ?? '').trim(),
      isAudioEvent: word.type === 'audio_event',
      isSpacing: word.type === 'spacing',
    }];
  });

  const seenTimedTokens = new Set<string>();
  const deduplicatedTimedWords = rawTimedWords.filter(word => {
    const key = `${word.isAudioEvent ? 'event' : word.isSpacing ? 'spacing' : 'word'}:${word.text.trim().toLowerCase()}:${word.start.toFixed(3)}:${word.end.toFixed(3)}`;
    if (seenTimedTokens.has(key)) return false;
    seenTimedTokens.add(key);
    return true;
  });
  const spokenWords = deduplicatedTimedWords.filter(word => !word.isAudioEvent && !word.isSpacing);
  const timedWords = deduplicatedTimedWords.map(word => {
    if (word.speakerId) return { ...word, speakerId: normalizeSpeakerId(word.speakerId) };
    const center = (word.start + word.end) / 2;
    const nearest = spokenWords.reduce<typeof spokenWords[number] | undefined>((best, candidate) => {
      if (!best) return candidate;
      const bestDistance = Math.abs(((best.start + best.end) / 2) - center);
      const candidateDistance = Math.abs(((candidate.start + candidate.end) / 2) - center);
      return candidateDistance < bestDistance ? candidate : best;
    }, undefined);
    return { ...word, speakerId: normalizeSpeakerId(nearest?.speakerId) };
  });

  if (timedWords.length === 0) {
    const segments = (transcription.segments || []).flatMap((segment, index) => {
      const text = String(segment.text || '').trim();
      const start = Number(segment.start);
      const end = Number(segment.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end)) return [];
      return [{
        id: `segment-${index + 1}`,
        speakerId: normalizeSpeakerId(segment.speaker_id ?? segment.speakerId),
        start: Math.max(0, start),
        end: Math.max(start, end),
        sourceText: text,
        targetText: '',
      } satisfies MultiSpeakerSegment];
    });
    return { segments: mergeAdjacentMultiSpeakerTailSegments(segments), events: [] as MultiSpeakerAudioEvent[] };
  }

  const rawSegments: MultiSpeakerSegment[] = [];
  const events: MultiSpeakerAudioEvent[] = [];
  let current: Array<(typeof timedWords)[number]> = [];
  const flush = () => {
    while (current[0]?.isSpacing) current.shift();
    while (current.at(-1)?.isSpacing) current.pop();
    if (current.length === 0) return;
    const sourceText = current.map(word => word.text).join('').replace(/\s+/g, ' ').trim();
    if (sourceText) {
      rawSegments.push({
        id: `segment-${rawSegments.length + 1}`,
        speakerId: current[0].speakerId,
        start: current[0].start,
        end: current[current.length - 1].end,
        sourceText,
        targetText: '',
      });
    }
    current = [];
  };

  timedWords.forEach(word => {
    if (word.isAudioEvent) {
      flush();
      events.push({
        id: `event-${events.length + 1}`,
        speakerId: word.speakerId,
        start: word.start,
        end: word.end,
        type: normalizeAudioEvent(word.text),
        sourceText: word.text.trim(),
      });
      return;
    }
    if (word.isSpacing) {
      if (current.length > 0) current.push({ ...word, speakerId: current[0].speakerId });
      return;
    }
    const previous = current[current.length - 1];
    const gap = previous ? word.start - previous.end : 0;
    const currentDuration = current.length > 0 ? word.end - current[0].start : 0;
    const shouldBreak = Boolean(previous) && (
      previous.speakerId !== word.speakerId
      || gap > 1.4
      || currentDuration > 16
      || (currentDuration > 9 && gap > 0.18 && SENTENCE_END_PATTERN.test(previous.text.trim()))
    );
    if (shouldBreak) flush();
    current.push(word);
  });
  flush();

  const mergedEvents: MultiSpeakerAudioEvent[] = [];
  events.sort((left, right) => left.start - right.start).forEach(event => {
    const previous = mergedEvents.at(-1);
    if (
      previous
      && previous.speakerId === event.speakerId
      && previous.type === event.type
      && event.start - previous.end <= 0.35
    ) {
      previous.end = Math.max(previous.end, event.end);
      previous.sourceText = `${previous.sourceText} ${event.sourceText}`.trim();
      return;
    }
    mergedEvents.push({ ...event });
  });

  const mergedSegments: MultiSpeakerSegment[] = [];
  rawSegments.forEach(segment => {
    const previous = mergedSegments.at(-1);
    const segmentDuration = segment.end - segment.start;
    const hasInterveningAudioEvent = Boolean(previous) && mergedEvents.some(event => (
      event.start >= previous!.end - 0.02
      && event.end <= segment.start + 0.02
    ));
    const canMerge = Boolean(previous)
      && previous!.speakerId === segment.speakerId
      && segment.start - previous!.end >= -0.02
      && segment.start - previous!.end <= 0.2
      && segmentDuration <= 2
      && segment.end - previous!.start <= 20
      && !hasInterveningAudioEvent;
    const shouldMerge = canMerge;
    if (!shouldMerge || !previous) {
      mergedSegments.push({ ...segment });
      return;
    }
    previous.end = segment.end;
    previous.sourceText = `${previous.sourceText} ${segment.sourceText}`.replace(/\s+/g, ' ').trim();
  });

  const deduplicatedSegments = mergedSegments.filter((segment, segmentIndex) => {
    const normalizedText = segment.sourceText.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
    return !mergedSegments.slice(0, segmentIndex).some(previous => {
      const previousText = previous.sourceText.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
      const overlaps = Math.min(previous.end, segment.end) - Math.max(previous.start, segment.start) > 0.05;
      return previous.speakerId === segment.speakerId && overlaps && previousText === normalizedText;
    });
  });

  return {
    segments: deduplicatedSegments.map((segment, index) => ({
      ...segment,
      id: `segment-${index + 1}`,
    })),
    events: mergedEvents.map((event, index) => ({ ...event, id: `event-${index + 1}` })),
  };
};

const buildMultiSpeakerProfiles = (segments: MultiSpeakerSegment[], duration?: number | null) => {
  const speakerIds = Array.from(new Set(segments.map(segment => segment.speakerId)));
  return speakerIds.map((speakerId, index) => {
    const speakerSegments = segments.filter(segment => segment.speakerId === speakerId);
    const maxDuration = Math.max(0.5, duration || speakerSegments.at(-1)?.end || 20);
    const candidates = speakerSegments
      .filter(segment => segment.end - segment.start >= 0.7)
      .map(segment => ({
        start: Math.max(0, segment.start + 0.03),
        end: Math.min(maxDuration, segment.end - 0.03),
      }))
      .sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const referenceRanges: Array<{ start: number; end: number }> = [];
    let selectedDuration = 0;
    for (const candidate of candidates) {
      if (referenceRanges.length >= 5 || selectedDuration >= 12) break;
      const remaining = 15 - selectedDuration;
      const rangeDuration = Math.min(candidate.end - candidate.start, 8, remaining);
      if (rangeDuration < 0.5) continue;
      referenceRanges.push({ start: candidate.start, end: candidate.start + rangeDuration });
      selectedDuration += rangeDuration;
    }
    if (referenceRanges.length === 0) {
      const fallbackStart = Math.max(0, speakerSegments[0]?.start || 0);
      referenceRanges.push({ start: fallbackStart, end: Math.min(maxDuration, fallbackStart + 3) });
    }
    referenceRanges.sort((a, b) => a.start - b.start);
    const primaryRange = referenceRanges.reduce((best, range) => (
      range.end - range.start > best.end - best.start ? range : best
    ));
    return {
      id: speakerId,
      name: `说话人 ${String.fromCharCode(65 + index)}`,
      color: speakerColors[index % speakerColors.length],
      referenceStart: primaryRange.start,
      referenceEnd: primaryRange.end,
      referenceRanges,
      segmentIds: speakerSegments.map(segment => segment.id),
    } satisfies MultiSpeakerProfile;
  });
};

const sourceLanguageOptions = DUBBING_SOURCE_LANGUAGE_OPTIONS;

const targetLanguageOptions = DUBBING_TARGET_LANGUAGE_OPTIONS;
const localTargetLanguageOptions = LOCAL_CLONE_LANGUAGE_OPTIONS;
const cosyVoiceTargetLanguageOptions = COSYVOICE_LANGUAGE_OPTIONS;
const localVoiceEngineOptions: Array<{
  value: LocalVoiceCloneEngine;
  label: string;
  description: string;
  coverage: string;
}> = [
  {
    value: 'chatterbox',
    label: 'Chatterbox V3',
    description: '覆盖语种更广，适合多语种批量尝试',
    coverage: '23 种语言',
  },
  {
    value: 'cosyvoice3',
    label: 'CosyVoice 3',
    description: '音色与韵律更强，支持自然语言表现指令',
    coverage: '9 种语言',
  },
];

const localPerformancePresets = [
  {
    value: 'natural',
    label: '自然',
    description: '音色与目标语言自然度平衡',
    exaggeration: 0.5,
    cfgWeight: 0.5,
    temperature: 0.8,
  },
  {
    value: 'expressive',
    label: '情绪',
    description: '加强语气起伏和表现力',
    exaggeration: 0.7,
    cfgWeight: 0.25,
    temperature: 0.85,
  },
  {
    value: 'stable',
    label: '稳定',
    description: '更克制、更接近参考音色',
    exaggeration: 0.4,
    cfgWeight: 0.45,
    temperature: 0.7,
  },
] as const;

type LocalPerformancePreset = typeof localPerformancePresets[number]['value'];

interface LocalVoiceEngineSelectorProps {
  selectedEngine: LocalVoiceCloneEngine;
  status: LocalVoiceCloneStatus | null;
  isChecking: boolean;
  disabled: boolean;
  onSelect: (engine: LocalVoiceCloneEngine) => void;
  onRefresh: () => void;
}

function LocalVoiceEngineSelector({
  selectedEngine,
  status,
  isChecking,
  disabled,
  onSelect,
  onRefresh,
}: LocalVoiceEngineSelectorProps) {
  const selectedStatus = status?.engines[selectedEngine];
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {localVoiceEngineOptions.map(engineOption => {
          const engineStatus = status?.engines[engineOption.value];
          const isSelected = selectedEngine === engineOption.value;
          return (
            <button
              key={engineOption.value}
              type="button"
              onClick={() => onSelect(engineOption.value)}
              aria-pressed={isSelected}
              className={`flex min-h-16 items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                isSelected
                  ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-200'
                  : 'border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/50'
              }`}
            >
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                isSelected ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-transparent'
              }`}>
                <Check className="h-3 w-3 stroke-[3]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[11px] font-black text-slate-800">{engineOption.label}</span>
                  <span className="text-[9px] font-bold text-slate-400">{engineOption.coverage}</span>
                  {engineStatus && (
                    <span className={`text-[9px] font-bold ${engineStatus.available ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {engineStatus.available ? '已就绪' : engineStatus.modelCached ? '环境异常' : '待下载'}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[9px] leading-relaxed text-slate-500">{engineOption.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2.5">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
          selectedStatus?.available
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-slate-200 bg-white text-slate-500'
        }`}>
          {isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[10px] font-black text-sky-950">
              {isChecking ? '正在检查本地引擎' : selectedStatus?.available ? '本地引擎已就绪' : '本地引擎未就绪'}
            </p>
            {selectedStatus?.available && (
              <span className="text-[9px] font-bold text-emerald-700">CUDA · 模型已缓存</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[9px] text-slate-500">
            {selectedStatus?.available
              ? `${selectedStatus.model} · ${selectedStatus.gpu || 'NVIDIA GPU'}`
              : selectedStatus?.reason || '无需另启服务；正在检查 Python、PyTorch、CUDA 和模型环境...'}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isChecking || disabled}
          title="重新检查本地引擎"
          aria-label="重新检查本地引擎"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sky-200 bg-white text-sky-700 transition-colors hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}

export default function CrossLanguageDubbing({
  initialFile,
  assistantRequestId,
  initialTargetLanguage,
  cloneModeOnly = false,
  setHistoryList,
  onAudioPlay,
}: CrossLanguageDubbingProps) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceFileUrl, setSourceFileUrl] = useState<string | null>(null);
  const [speechInputFile, setSpeechInputFile] = useState<File | null>(null);
  const [speechInputFileUrl, setSpeechInputFileUrl] = useState<string | null>(null);
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [isTranscribingScript, setIsTranscribingScript] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [targetLanguage, setTargetLanguage] = useState('English');
  const [dubbingMode, setDubbingMode] = useState<DubbingMode>('self_hosted');
  const [localInputMode, setLocalInputMode] = useState<LocalCloneInputMode>('text');
  const [localTargetLanguage, setLocalTargetLanguage] = useState('en');
  const [localTargetText, setLocalTargetText] = useState('');
  const [localDialogueMode, setLocalDialogueMode] = useState<LocalDialogueMode>('single');
  const [expectedSpeakerCount, setExpectedSpeakerCount] = useState<'auto' | number>('auto');
  const [multiSpeakerSegments, setMultiSpeakerSegments] = useState<MultiSpeakerSegment[]>([]);
  const [multiSpeakerAudioEvents, setMultiSpeakerAudioEvents] = useState<MultiSpeakerAudioEvent[]>([]);
  const [multiSpeakerProfiles, setMultiSpeakerProfiles] = useState<MultiSpeakerProfile[]>([]);
  const [multiSpeakerGenerationProgress, setMultiSpeakerGenerationProgress] = useState('');
  const [multiSpeakerTimelineSummary, setMultiSpeakerTimelineSummary] = useState<LocalMultiSpeakerCloneResult['timeline'] | null>(null);
  const [isExtractingTargetText, setIsExtractingTargetText] = useState(false);
  const [targetTextExtractionMessage, setTargetTextExtractionMessage] = useState('');
  const [localReferenceStart, setLocalReferenceStart] = useState(0);
  const [localReferenceEnd, setLocalReferenceEnd] = useState(20);
  const [localPerformancePreset, setLocalPerformancePreset] = useState<LocalPerformancePreset>('natural');
  const [localVoiceEngine, setLocalVoiceEngine] = useState<LocalVoiceCloneEngine>('cosyvoice3');
  const [localEngineStatus, setLocalEngineStatus] = useState<LocalVoiceCloneStatus | null>(null);
  const [isCheckingLocalEngine, setIsCheckingLocalEngine] = useState(false);
  const [cloningStrength, setCloningStrength] = useState(7);
  const [outputFormat, setOutputFormat] = useState<'mp3' | 'mp4'>('mp3');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranslateDubbingResult | null>(null);
  const [pendingResultOptions, setPendingResultOptions] = useState<{
    optionA: PendingTranslateDubbingOption | null;
    optionB: PendingTranslateDubbingOption | null;
  }>({ optionA: null, optionB: null });
  const [resultAudioDurations, setResultAudioDurations] = useState<Record<string, number>>({});
  const [resultAudioErrors, setResultAudioErrors] = useState<Record<string, string>>({});
  const [playingResultOptionId, setPlayingResultOptionId] = useState<TranslateDubbingOptionId | null>(null);
  const [sourceDuration, setSourceDuration] = useState<number | null>(null);
  const [isSourcePlaying, setIsSourcePlaying] = useState(false);

  const sourceAudioRef = useRef<HTMLAudioElement | null>(null);
  const resultOptionAudioRef = useRef<HTMLAudioElement | null>(null);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const resultVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const activeResultOptionRef = useRef<TranslateDubbingOptionId | null>(null);
  const activeResultAudioUrlRef = useRef('');
  const waveformProgressRatiosRef = useRef<Record<TranslateDubbingOptionId | 'source', number>>({
    source: 0,
    A: 0,
    B: 0,
  });
  const waveformFillRefs = useRef<Record<TranslateDubbingOptionId | 'source', HTMLDivElement | null>>({
    source: null,
    A: null,
    B: null,
  });
  const waveformPlayheadRefs = useRef<Record<TranslateDubbingOptionId | 'source', HTMLDivElement | null>>({
    source: null,
    A: null,
    B: null,
  });
  const waveformInputRefs = useRef<Record<TranslateDubbingOptionId | 'source', HTMLInputElement | null>>({
    source: null,
    A: null,
    B: null,
  });
  const targetTextRequestRef = useRef(0);
  const extractedSourceTextRef = useRef('');

  const resultOptionList = useMemo(() => ([
    pendingResultOptions.optionA,
    pendingResultOptions.optionB,
  ].filter(Boolean) as PendingTranslateDubbingOption[]), [pendingResultOptions]);
  const sourceIsVideo = Boolean(
    sourceFile && (sourceFile.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|wmv)$/i.test(sourceFile.name)),
  );
  const primaryResultIsVideo = resultOptionList[0]?.data.outputFormat === 'mp4';
  const localReferenceTimelineDuration = Math.max(0, sourceDuration || 0);
  const localReferenceMaxStart = Math.max(0, localReferenceTimelineDuration - 0.5);
  const localReferenceInterval = Math.max(0.5, Math.min(20, localReferenceEnd - localReferenceStart));
  const selectedLocalEngineStatus = localEngineStatus?.engines[localVoiceEngine];
  const availableLocalTargetLanguageOptions = localVoiceEngine === 'cosyvoice3'
    ? cosyVoiceTargetLanguageOptions
    : localTargetLanguageOptions;
  const multiSpeakerTargetReady = multiSpeakerSegments.length > 0
    && multiSpeakerProfiles.length > 0
    && multiSpeakerSegments.every(segment => segment.targetText.trim());
  const localCloneDisabledReason = !sourceFile
    ? '请先上传参考音频或视频。'
    : localInputMode === 'speech_to_speech' && !speechInputFile
      ? '请先上传要转换的内容语音。'
      : localInputMode === 'speech_to_speech'
        ? ''
        : localDialogueMode === 'multi' && !multiSpeakerTargetReady
          ? '请先识别说话人，并确认每段目标语言台词。'
          : localDialogueMode === 'single' && !localTargetText.trim()
            ? '请先选择目标语言并提取或填写目标语言台词。'
            : selectedLocalEngineStatus?.available !== true
              ? selectedLocalEngineStatus?.reason || '本机克隆由当前应用按需调用 Python，无需另启服务；请先检查本机依赖和 CUDA。'
              : '';

  useEffect(() => () => {
    if (sourceFileUrl) URL.revokeObjectURL(sourceFileUrl);
  }, [sourceFileUrl]);

  useEffect(() => {
    if (DUBBING_V2_AVAILABLE || dubbingMode !== 'dubbing_v2') return;
    setDubbingMode('self_hosted');
    setError(null);
  }, [dubbingMode]);

  useEffect(() => () => {
    if (speechInputFileUrl) URL.revokeObjectURL(speechInputFileUrl);
  }, [speechInputFileUrl]);

  useEffect(() => {
    if (!sourceFileUrl) {
      setSourceDuration(null);
      return;
    }
    const media = document.createElement(sourceIsVideo ? 'video' : 'audio');
    media.preload = 'metadata';
    media.src = sourceFileUrl;
    media.onloadedmetadata = () => {
      setSourceDuration(Number.isFinite(media.duration) ? media.duration : null);
    };
    media.onerror = () => setSourceDuration(null);
    return () => {
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
    };
  }, [sourceFileUrl, sourceIsVideo]);

  useEffect(() => {
    if (!sourceDuration) {
      setLocalReferenceStart(0);
      setLocalReferenceEnd(20);
      return;
    }
    setLocalReferenceStart(current => Math.min(current, Math.max(0, sourceDuration - 0.5)));
    setLocalReferenceEnd(current => Math.min(sourceDuration, Math.max(0.5, current)));
  }, [sourceDuration]);

  const refreshLocalEngineStatus = async () => {
    setIsCheckingLocalEngine(true);
    try {
      setLocalEngineStatus(await getLocalVoiceCloneStatus());
    } catch (statusError: any) {
      setLocalEngineStatus({
        defaultEngine: 'chatterbox',
        engines: {
          chatterbox: {
            available: false,
            model: 'Chatterbox Multilingual V3',
            modelCached: false,
            supportedLanguages: {},
            reason: statusError?.message || '无法连接本地声音克隆服务。',
          },
          cosyvoice3: {
            available: false,
            model: 'Fun-CosyVoice3 0.5B',
            modelCached: false,
            supportedLanguages: {},
            reason: statusError?.message || '无法连接本地声音克隆服务。',
          },
        },
      });
    } finally {
      setIsCheckingLocalEngine(false);
    }
  };

  useEffect(() => {
    if (dubbingMode === 'self_hosted' && localInputMode === 'text' && !localEngineStatus && !isCheckingLocalEngine) {
      void refreshLocalEngineStatus();
    }
  }, [dubbingMode, localInputMode, localEngineStatus, isCheckingLocalEngine]);

  useEffect(() => {
    resultOptionList.forEach((option) => {
      const audioUrl = option.data.audioUrl;
      if (!audioUrl || resultAudioDurations[audioUrl]) return;
      const media = document.createElement(option.data.outputFormat === 'mp4' ? 'video' : 'audio');
      media.preload = 'metadata';
      media.src = audioUrl;
      media.onloadedmetadata = () => {
        if (!Number.isFinite(media.duration) || media.duration <= 0) return;
        setResultAudioDurations(prev => ({
          ...prev,
          [audioUrl]: media.duration,
        }));
      };
      media.onerror = () => {
        setResultAudioErrors(prev => ({
          ...prev,
          [audioUrl]: '生成的音频无法加载。请确认服务仍在运行，或点击重试。',
        }));
        media.removeAttribute('src');
      };
    });
  }, [resultOptionList, resultAudioDurations]);

  const localTargetLanguageLabel = (language: string) => (
    localTargetLanguageOptions.find(option => option.value === language)?.label || language
  );

  const translateExtractedTargetText = async (sourceText: string, language: string, requestId: number) => {
    const translatedText = await translateTextToLanguage(sourceText, localTargetLanguageLabel(language), {
      preserveTone: true,
      timeoutMs: VOICE_CONVERSION_AI_TIMEOUT_MS,
    });
    if (targetTextRequestRef.current !== requestId) return;
    setLocalTargetText(translatedText.trim().slice(0, 800));
    setTargetTextExtractionMessage('已自动提取并翻译，可继续修改');
  };

  const translateTimedSingleSpeakerDialogue = async (
    segments: MultiSpeakerSegment[],
    language: string,
    requestId: number,
    eventCount: number,
  ) => {
    const translatedSegments = await mapWithConcurrency(segments, 3, async segment => ({
      ...segment,
      speakerId: 'speaker_0',
      targetText: (await translateTextToLanguage(segment.sourceText, localTargetLanguageLabel(language), {
        preserveTone: true,
        maxDurationSeconds: Math.max(0.5, segment.end - segment.start),
        timeoutMs: VOICE_CONVERSION_AI_TIMEOUT_MS,
      })).trim().slice(0, 800),
    }));
    if (targetTextRequestRef.current !== requestId) return;
    setMultiSpeakerSegments(translatedSegments);
    setLocalTargetText(translatedSegments.map(segment => segment.targetText).join('\n\n').slice(0, 800));
    extractedSourceTextRef.current = translatedSegments.map(segment => segment.sourceText).join(' ');
    setTargetTextExtractionMessage(
      `已识别 ${translatedSegments.length} 段台词；笑声、呼吸等 ${eventCount} 个语气事件将按原时间保留`,
    );
  };

  const extractMultiSpeakerDialogue = async (file: File) => {
    const requestId = ++targetTextRequestRef.current;
    setIsExtractingTargetText(true);
    setMultiSpeakerGenerationProgress('');
    setMultiSpeakerTimelineSummary(null);
    setTargetTextExtractionMessage('正在识别说话人和逐句时间码…');
    try {
      const transcription = await transcribeSpeech(file, undefined, true, {
        diarize: true,
        numSpeakers: expectedSpeakerCount === 'auto' ? undefined : expectedSpeakerCount,
      });
      if (targetTextRequestRef.current !== requestId) return;
      const { segments, events } = buildMultiSpeakerDialogue(transcription);
      if (segments.length === 0) throw new Error('没有识别到带时间码的清晰台词，请换一段人声更清楚的文件。');
      if (segments.length > 40) {
        throw new Error('当前识别到超过 40 段台词，请先截取较短的视频后分批处理。');
      }
      const profiles = buildMultiSpeakerProfiles(segments, sourceDuration);
      setMultiSpeakerSegments(segments);
      setMultiSpeakerAudioEvents(events);
      setMultiSpeakerProfiles(profiles);
      setTargetTextExtractionMessage(`已识别 ${profiles.length} 位说话人、${segments.length} 段台词和 ${events.length} 个语气事件，正在翻译…`);

      const translatedSegments = await mapWithConcurrency(segments, 3, async segment => ({
        ...segment,
        targetText: (await translateTextToLanguage(segment.sourceText, localTargetLanguageLabel(localTargetLanguage), {
          preserveTone: true,
          maxDurationSeconds: Math.max(0.5, segment.end - segment.start),
          timeoutMs: VOICE_CONVERSION_AI_TIMEOUT_MS,
        })).trim().slice(0, 800),
      }));
      if (targetTextRequestRef.current !== requestId) return;
      setMultiSpeakerSegments(translatedSegments);
      setLocalTargetText(translatedSegments.map(segment => segment.targetText).join(' ').slice(0, 800));
      extractedSourceTextRef.current = segments.map(segment => segment.sourceText).join(' ');
      setTargetTextExtractionMessage(`已识别 ${profiles.length} 位说话人；笑声、呼吸等 ${events.length} 个事件将保留原声`);
    } catch (extractionError: any) {
      if (targetTextRequestRef.current !== requestId) return;
      setMultiSpeakerSegments([]);
      setMultiSpeakerAudioEvents([]);
      setMultiSpeakerProfiles([]);
      setTargetTextExtractionMessage(extractionError?.message || '多人对话识别失败，请重试。');
    } finally {
      if (targetTextRequestRef.current === requestId) setIsExtractingTargetText(false);
    }
  };

  const updateMultiSpeakerProfile = (speakerId: string, patch: Partial<MultiSpeakerProfile>) => {
    setMultiSpeakerProfiles(current => current.map(profile => {
      if (profile.id !== speakerId) return profile;
      const next = { ...profile, ...patch };
      if ('referenceStart' in patch || 'referenceEnd' in patch) {
        next.referenceRanges = [{ start: next.referenceStart, end: next.referenceEnd }];
      }
      return next;
    }));
  };

  const updateSpeakerDialogue = (speakerId: string, value: string) => {
    setMultiSpeakerSegments(current => {
      const speakerSegments = current.filter(segment => segment.speakerId === speakerId);
      if (speakerSegments.length === 0) return current;
      const paragraphs = value.split(/\n\s*\n/);
      const mappedParagraphs = speakerSegments.map((_segment, index) => {
        if (index < speakerSegments.length - 1) return paragraphs[index] || '';
        return paragraphs.slice(index).join('\n\n');
      });
      const targetTextById = new Map(speakerSegments.map((segment, index) => [
        segment.id,
        mappedParagraphs[index].slice(0, 800),
      ]));
      return current.map(segment => (
        segment.speakerId === speakerId
          ? { ...segment, targetText: targetTextById.get(segment.id) || '' }
          : segment
      ));
    });
  };

  const updateSingleSpeakerDialogue = (value: string) => {
    const normalizedValue = value.slice(0, 800);
    setLocalTargetText(normalizedValue);
    setMultiSpeakerSegments(current => {
      if (current.length === 0 || current.some(segment => segment.speakerId !== 'speaker_0')) return current;
      const paragraphs = normalizedValue.split(/\n\s*\n/);
      return current.map((segment, index) => ({
        ...segment,
        targetText: index < current.length - 1
          ? (paragraphs[index] || '').slice(0, 800)
          : paragraphs.slice(index).join('\n\n').slice(0, 800),
      }));
    });
  };

  const extractTargetTextFromFile = async (file: File) => {
    const requestId = ++targetTextRequestRef.current;
    setIsExtractingTargetText(true);
    setTargetTextExtractionMessage('正在从上传文件提取台词…');
    try {
      const transcription = await transcribeSpeech(file, undefined, true);
      if (targetTextRequestRef.current !== requestId) return;
      const dialogue = buildMultiSpeakerDialogue(transcription);
      const segments = dialogue.segments.map(segment => ({ ...segment, speakerId: 'speaker_0' }));
      const events = dialogue.events.map(event => ({ ...event, speakerId: 'speaker_0' }));
      if (segments.length === 0) throw new Error('没有识别到带时间码的清晰台词，请换一段包含人声的文件。');
      if (segments.length > 40) throw new Error('当前识别到超过 40 段台词，请先截取较短的素材。');
      const profiles = buildMultiSpeakerProfiles(segments, sourceDuration);
      setMultiSpeakerSegments(segments);
      setMultiSpeakerAudioEvents(events);
      setMultiSpeakerProfiles(profiles);
      const primaryProfile = profiles[0];
      if (primaryProfile) {
        setLocalReferenceStart(primaryProfile.referenceStart);
        setLocalReferenceEnd(primaryProfile.referenceEnd);
      }
      setTargetTextExtractionMessage(`已识别 ${segments.length} 段台词和 ${events.length} 个语气事件，正在逐句翻译…`);
      await translateTimedSingleSpeakerDialogue(segments, localTargetLanguage, requestId, events.length);
    } catch (extractionError: any) {
      if (targetTextRequestRef.current !== requestId) return;
      extractedSourceTextRef.current = '';
      setMultiSpeakerSegments([]);
      setMultiSpeakerAudioEvents([]);
      setMultiSpeakerProfiles([]);
      setTargetTextExtractionMessage(extractionError?.message || '自动提取失败，请手动输入台词。');
    } finally {
      if (targetTextRequestRef.current === requestId) setIsExtractingTargetText(false);
    }
  };

  const handleLocalTargetLanguageChange = (language: string) => {
    setLocalTargetLanguage(language);
    targetTextRequestRef.current += 1;
    setIsExtractingTargetText(false);
    setLocalTargetText('');
    setMultiSpeakerSegments(current => current.map(segment => ({ ...segment, targetText: '' })));
    setTargetTextExtractionMessage('已选择目标语种，请点击“提取目标语种台词”');
  };

  const handleScriptFileChange = async (file: File) => {
    const isAudio = file.type.startsWith('audio/') || /\.(wav|mp3|m4a|aac|ogg|opus|flac|aif|aiff)$/i.test(file.name);
    if (!isAudio) {
      setError('台词音频请上传 WAV、MP3、M4A 或其他音频文件。');
      return;
    }
    setScriptFile(file);
    setIsTranscribingScript(true);
    setError(null);
    setTargetTextExtractionMessage('正在识别台词音频…');
    try {
      const transcription = await transcribeSpeech(file, undefined, true);
      const text = String(transcription.text || transcription.segments?.map(segment => segment.text).join(' ') || '').trim();
      if (!text) throw new Error('没有识别到清晰台词，请换一段人声更清楚的音频。');
      setLocalTargetText(text.slice(0, 800));
      setTargetTextExtractionMessage(`已从台词音频识别 ${Math.min(text.length, 800)} 个字符，可继续编辑后生成。`);
    } catch (transcriptionError: any) {
      setTargetTextExtractionMessage('');
      setError(transcriptionError?.message || '台词音频识别失败，请重试。');
    } finally {
      setIsTranscribingScript(false);
    }
  };

  const handleSpeechInputFileChange = (file: File) => {
    const isAudio = file.type.startsWith('audio/') || /\.(wav|mp3|m4a|aac|ogg|opus|flac|aif|aiff)$/i.test(file.name);
    if (!isAudio) {
      setError('语音转语音内容请上传 WAV、MP3、M4A 或其他音频文件。');
      return;
    }
    if (speechInputFileUrl) URL.revokeObjectURL(speechInputFileUrl);
    setSpeechInputFile(file);
    setSpeechInputFileUrl(URL.createObjectURL(file));
    setError(null);
    setLocalTargetText('');
    extractedSourceTextRef.current = '';
    setTargetTextExtractionMessage('已准备待转换语音，无需填写目标语音或台词。');
  };

  const clearSpeechInputFile = () => {
    if (speechInputFileUrl) URL.revokeObjectURL(speechInputFileUrl);
    setSpeechInputFile(null);
    setSpeechInputFileUrl(null);
    setLocalTargetText('');
    extractedSourceTextRef.current = '';
    setTargetTextExtractionMessage('');
    setError(null);
  };

  const handleLocalInputModeChange = (mode: LocalCloneInputMode) => {
    if (mode === localInputMode) return;
    setLocalInputMode(mode);
    setError(null);
    setResult(null);
    setPendingResultOptions({ optionA: null, optionB: null });
    targetTextRequestRef.current += 1;
    extractedSourceTextRef.current = '';
    setLocalTargetText('');
    setScriptFile(null);
    setTargetTextExtractionMessage(sourceFile
      ? mode === 'speech_to_speech'
        ? speechInputFile ? '已准备待转换语音，可直接生成' : '请上传要转换的内容语音'
        : '请选择目标语种后点击“提取目标语种台词”'
      : '');
    if (mode === 'speech_to_speech') {
      setLocalDialogueMode('single');
      setMultiSpeakerSegments([]);
      setMultiSpeakerAudioEvents([]);
      setMultiSpeakerProfiles([]);
      setMultiSpeakerTimelineSummary(null);
    }
  };

  const handleLocalVoiceEngineChange = (engine: LocalVoiceCloneEngine) => {
    setLocalVoiceEngine(engine);
    setError(null);
    if (engine === 'cosyvoice3' && !COSYVOICE_LANGUAGE_OPTIONS.some(option => option.value === localTargetLanguage)) {
      handleLocalTargetLanguageChange('en');
      setTargetTextExtractionMessage('CosyVoice 3 不支持原目标语种，已切换为英文，请重新提取台词。');
    }
  };

  const handleExtractTargetTextClick = () => {
    const dialogueSourceFile = localInputMode === 'speech_to_speech' ? speechInputFile : sourceFile;
    if (!dialogueSourceFile || isExtractingTargetText) return;
    if (localDialogueMode === 'multi') {
      if (sourceFile) void extractMultiSpeakerDialogue(sourceFile);
      return;
    }
    const sourceText = extractedSourceTextRef.current;
    if (!sourceText) {
      void extractTargetTextFromFile(dialogueSourceFile);
      return;
    }

    const requestId = ++targetTextRequestRef.current;
    setIsExtractingTargetText(true);
    setTargetTextExtractionMessage('正在按新的目标语言翻译台词…');
    const translationPromise = multiSpeakerSegments.length > 0
      && multiSpeakerSegments.every(segment => segment.speakerId === 'speaker_0')
      ? translateTimedSingleSpeakerDialogue(multiSpeakerSegments, localTargetLanguage, requestId, multiSpeakerAudioEvents.length)
      : translateExtractedTargetText(sourceText, localTargetLanguage, requestId);
    void translationPromise
      .catch((translationError: any) => {
        if (targetTextRequestRef.current !== requestId) return;
        setTargetTextExtractionMessage(translationError?.message || '重新翻译失败，请手动修改台词。');
      })
      .finally(() => {
        if (targetTextRequestRef.current === requestId) setIsExtractingTargetText(false);
      });
  };

  const handleFileChange = (file: File) => {
    const isVideo = file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|wmv)$/i.test(file.name);
    const isAudio = file.type.startsWith('audio/') || /\.(wav|mp3|m4a|aac|ogg|opus|flac|aif|aiff)$/i.test(file.name);
    if (!isAudio && !isVideo) {
      setError('请上传音频或视频文件。');
      return;
    }
    if (sourceFileUrl) URL.revokeObjectURL(sourceFileUrl);
    resultOptionAudioRef.current?.pause();
    activeResultOptionRef.current = null;
    activeResultAudioUrlRef.current = '';
    waveformProgressRatiosRef.current = { source: 0, A: 0, B: 0 };
    setSourceFile(file);
    setSourceFileUrl(URL.createObjectURL(file));
    setResult(null);
    setOutputFormat(isVideo ? 'mp4' : 'mp3');
    setPendingResultOptions({ optionA: null, optionB: null });
    setPlayingResultOptionId(null);
    setError(null);
    setIsSourcePlaying(false);
    setLocalReferenceStart(0);
    extractedSourceTextRef.current = '';
    targetTextRequestRef.current += 1;
    setLocalTargetText('');
    setMultiSpeakerSegments([]);
    setMultiSpeakerAudioEvents([]);
    setMultiSpeakerProfiles([]);
    setMultiSpeakerGenerationProgress('');
    setMultiSpeakerTimelineSummary(null);
    setTargetTextExtractionMessage('');
    if (dubbingMode === 'self_hosted') {
      setTargetTextExtractionMessage(localDialogueMode === 'multi'
        ? '已上传文件，请点击“识别说话人与台词”'
        : '已上传文件，请选择目标语种后点击“提取目标语种台词”');
    }
  };

  useEffect(() => {
    if (initialFile && assistantRequestId) handleFileChange(initialFile);
    const requestedLanguage = getAudioLanguage(initialTargetLanguage || '');
    if (requestedLanguage) {
      setTargetLanguage(requestedLanguage.elevenLabsName);
      if (requestedLanguage.localChatterbox) setLocalTargetLanguage(requestedLanguage.code);
    }
  }, [assistantRequestId, initialTargetLanguage]);

  const toggleSourcePlay = () => {
    if (!sourceAudioRef.current) return;
    if (isSourcePlaying) {
      sourceAudioRef.current.pause();
      setIsSourcePlaying(false);
      return;
    }
    resultOptionAudioRef.current?.pause();
    setPlayingResultOptionId(null);
    onAudioPlay?.();
    sourceAudioRef.current.play().catch(console.error);
    setIsSourcePlaying(true);
  };

  const generateTimedLocalDubbing = async (dialogueMode: LocalDialogueMode) => {
    if (!sourceFile || !multiSpeakerTargetReady) {
      throw new Error('请先提取带时间码的台词，并确认每段目标语言内容。');
    }
    const selectedPreset = localPerformancePresets.find(item => item.value === localPerformancePreset)
      || localPerformancePresets[0];
    const alternatePreset = localPerformancePresets.find(item => (
      item.value === (selectedPreset.value === 'stable' ? 'natural' : 'stable')
    )) || localPerformancePresets[0];
    setMultiSpeakerGenerationProgress(dialogueMode === 'single'
      ? `正在按原时间线生成单人配音 A/B 两版，共 ${multiSpeakerSegments.length} 段台词…`
      : `正在为 ${multiSpeakerProfiles.length} 位角色批量生成 A/B 两版，共 ${multiSpeakerSegments.length} 个内部轮次…`);
      const batchResult = await cloneMultiSpeakerVoicesLocally(sourceFile, {
      engine: localVoiceEngine,
      dialogueMode,
      language: localTargetLanguage,
      sourceDuration: sourceDuration || undefined,
      profiles: multiSpeakerProfiles.map(profile => {
        return {
          id: profile.id,
          referenceStart: dialogueMode === 'single' ? localReferenceStart : profile.referenceStart,
          referenceEnd: dialogueMode === 'single' ? localReferenceEnd : profile.referenceEnd,
          referenceRanges: dialogueMode === 'single'
            ? [{ start: localReferenceStart, end: localReferenceEnd }]
            : profile.referenceRanges,
        };
      }),
      segments: multiSpeakerSegments,
      events: multiSpeakerAudioEvents,
      versions: [selectedPreset, alternatePreset].map((preset, index) => ({
        id: index === 0 ? 'A' as const : 'B' as const,
        performance: preset.value,
        exaggeration: preset.exaggeration,
        cfgWeight: preset.cfgWeight,
        temperature: preset.temperature,
      })),
    });
    setMultiSpeakerTimelineSummary(batchResult.timeline);
    return batchResult;
  };

  const handleGenerate = async () => {
    if (!sourceFile) {
      setError('请先上传一段克隆参考音频。');
      return;
    }
    if (dubbingMode === 'self_hosted') {
      if (localInputMode === 'speech_to_speech' && !speechInputFile) {
        setError('请先上传要转换的内容语音。');
        return;
      }
      if (localInputMode === 'text' && localDialogueMode === 'single' && !localTargetText.trim()) {
        setError('请输入需要生成的目标语言台词。');
        return;
      }
      if (localInputMode === 'text' && localDialogueMode === 'multi' && !multiSpeakerTargetReady) {
        setError('请先识别说话人，并确认每段目标语言台词。');
        return;
      }
      if (selectedLocalEngineStatus && !selectedLocalEngineStatus.available) {
        setError(selectedLocalEngineStatus.reason || '本地声音克隆引擎当前不可用。');
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const isLocalSpeechToSpeech = dubbingMode === 'self_hosted' && localInputMode === 'speech_to_speech';
      const targetLabel = dubbingMode === 'self_hosted'
        ? localTargetLanguageOptions.find(item => item.value === localTargetLanguage)?.label || localTargetLanguage
        : targetLanguageOptions.find(item => item.value === targetLanguage)?.label || targetLanguage;
      const selectedLocalPreset = localPerformancePresets.find(item => item.value === localPerformancePreset)
        || localPerformancePresets[0];
      const alternateLocalPreset = localPerformancePresets.find(item => (
        item.value === (selectedLocalPreset.value === 'stable' ? 'natural' : 'stable')
      )) || localPerformancePresets[0];
      const shouldUseTimedLocalBatch = dubbingMode === 'self_hosted'
        && localInputMode === 'text'
        && multiSpeakerTargetReady
        && localDialogueMode === 'multi';
      const timedLocalBatch = shouldUseTimedLocalBatch
        ? await generateTimedLocalDubbing(localDialogueMode)
        : null;
      const speechToSpeechResults = isLocalSpeechToSpeech
        ? await Promise.all([
          convertWithSeedVc(speechInputFile!, sourceFile, localSpeechToSpeechOptions),
          convertWithSeedVc(speechInputFile!, sourceFile, {
            ...localSpeechToSpeechOptions,
            diffusionSteps: Math.min(80, localSpeechToSpeechOptions.diffusionSteps + 4),
            temperature: Math.min(2, localSpeechToSpeechOptions.temperature + 0.08),
            topP: Math.max(0.05, localSpeechToSpeechOptions.topP - 0.04),
          }),
        ])
        : null;
      const dataA = isLocalSpeechToSpeech
        ? mapSeedVcResultToDubbingResult(speechToSpeechResults![0])
        : dubbingMode === 'dubbing_v2'
        ? await translateDubbingV2Audio(sourceFile, { sourceLanguage, targetLanguage, cloningStrength, outputFormat })
        : localDialogueMode === 'multi'
          ? timedLocalBatch!.options.find(option => option.id === 'A')!.data
          : timedLocalBatch
            ? timedLocalBatch.options.find(option => option.id === 'A')!.data
            : await cloneVoiceLocally(sourceFile, {
              engine: localVoiceEngine,
              language: localTargetLanguage,
              text: localTargetText.trim(),
              referenceStart: localReferenceStart,
              referenceDuration: localReferenceInterval,
              sourceDuration: sourceDuration || undefined,
              exaggeration: selectedLocalPreset.exaggeration,
              cfgWeight: selectedLocalPreset.cfgWeight,
              temperature: selectedLocalPreset.temperature,
              performance: selectedLocalPreset.value,
            });
      const dataB = isLocalSpeechToSpeech
        ? mapSeedVcResultToDubbingResult(speechToSpeechResults![1])
        : dubbingMode === 'self_hosted'
        ? localDialogueMode === 'multi'
          ? timedLocalBatch!.options.find(option => option.id === 'B')!.data
          : timedLocalBatch
            ? timedLocalBatch.options.find(option => option.id === 'B')!.data
            : await cloneVoiceLocally(sourceFile, {
              engine: localVoiceEngine,
              language: localTargetLanguage,
              text: localTargetText.trim(),
              referenceStart: localReferenceStart,
              referenceDuration: localReferenceInterval,
              sourceDuration: sourceDuration || undefined,
              exaggeration: alternateLocalPreset.exaggeration,
              cfgWeight: alternateLocalPreset.cfgWeight,
              temperature: alternateLocalPreset.temperature,
              performance: alternateLocalPreset.value,
            })
        : null;
      const optionA: PendingTranslateDubbingOption = {
        id: 'A',
        data: dataA,
        displayName: isLocalSpeechToSpeech
          ? `语音转语音 - Seed-VC V2（版本 A）`
          : dubbingMode === 'dubbing_v2'
          ? `ElevenLabs Dubbing v2 - ${targetLabel}`
          : dubbingMode === 'self_hosted'
            ? localDialogueMode === 'multi'
              ? `多人配音 - ${targetLabel}（版本 A · ${selectedLocalPreset.label}）`
              : `${localInputMode === 'speech_to_speech' ? '语音转语音' : localVoiceEngine === 'cosyvoice3' ? 'CosyVoice 3' : 'Chatterbox V3'} - ${targetLabel}（${selectedLocalPreset.label}）`
            : `Dubbing v2 - ${targetLabel}`,
      };
      const optionB: PendingTranslateDubbingOption | null = dataB ? {
        id: 'B',
        data: dataB,
        displayName: isLocalSpeechToSpeech
          ? `语音转语音 - Seed-VC V2（版本 B）`
          : dubbingMode === 'self_hosted'
          ? localDialogueMode === 'multi'
            ? `多人配音 - ${targetLabel}（版本 B · ${alternateLocalPreset.label}）`
            : `${localInputMode === 'speech_to_speech' ? '语音转语音' : localVoiceEngine === 'cosyvoice3' ? 'CosyVoice 3' : 'Chatterbox V3'} - ${targetLabel}（${alternateLocalPreset.label}）`
          : `Dubbing v2 - ${targetLabel}（版本 B）`,
      } : null;
      waveformProgressRatiosRef.current.A = 0;
      waveformProgressRatiosRef.current.B = 0;
      activeResultOptionRef.current = null;
      activeResultAudioUrlRef.current = '';
      setResultAudioErrors({});
      setResult(dataA);
      setPendingResultOptions({ optionA, optionB });
      addTranslateResultToHistory(optionA);
      if (optionB) addTranslateResultToHistory(optionB);

      setTimeout(() => {
        playResultOption('A', dataA.audioUrl);
      }, 150);
    } catch (err: any) {
      setError(err.message || '跨语种转换生成失败，请稍后重试。');
    } finally {
      setMultiSpeakerGenerationProgress('');
      setLoading(false);
    }
  };

  const addTranslateResultToHistory = (option: PendingTranslateDubbingOption) => {
    const isLocalClone = option.data.dubbingModel === 'local_chatterbox'
      || option.data.dubbingModel === 'local_cosyvoice3'
      || option.data.dubbingModel === 'local_multispeaker'
      || option.data.dubbingModel === 'local_seed_vc';
    const targetLabel = isLocalClone
      ? localTargetLanguageOptions.find(item => item.value === localTargetLanguage)?.label || localTargetLanguage
      : targetLanguageOptions.find(item => item.value === targetLanguage)?.label || targetLanguage;
    const newHistoryItem: HistoryItem = {
      id: `translate-dubbing-${option.id}-${Date.now()}`,
      type: 'voice',
      title: option.displayName,
      prompt: option.data.translatedText,
      url: option.data.audioUrl,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
      details: isLocalClone
        ? `${option.data.dubbingModel === 'local_seed_vc' ? '直接音色迁移' : targetLabel} · ${option.data.dubbingModel === 'local_multispeaker'
          ? `多人配音（${multiSpeakerProfiles.length} 位）`
          : option.data.dubbingModel === 'local_seed_vc' ? 'Seed-VC V2' : option.data.dubbingModel === 'local_cosyvoice3' ? 'CosyVoice 3' : 'Chatterbox V3'}${option.data.dubbingModel === 'local_seed_vc' ? '' : ` · ${localPerformancePresets.find(item => item.value === localPerformancePreset)?.label || '自然'}表现`}`
        : `${targetLabel} · Dubbing v2`,
      inputText: option.data.translatedText,
      attachments: sourceFile ? [{
        name: sourceFile.name,
        type: sourceFile.type,
        size: sourceFile.size,
        file: sourceFile,
      }] : [],
    };
    setHistoryList(prev => [newHistoryItem, ...prev]);
  };

  const updateWaveformProgress = (
    waveformId: TranslateDubbingOptionId | 'source',
    currentTime: number,
    duration: number,
  ) => {
    const ratio = duration > 0 && Number.isFinite(duration)
      ? Math.max(0, Math.min(1, currentTime / duration))
      : 0;
    waveformProgressRatiosRef.current[waveformId] = ratio;
    const percentage = `${(ratio * 100).toFixed(3)}%`;
    if (waveformFillRefs.current[waveformId]) waveformFillRefs.current[waveformId]!.style.width = percentage;
    if (waveformPlayheadRefs.current[waveformId]) waveformPlayheadRefs.current[waveformId]!.style.left = percentage;
    const input = waveformInputRefs.current[waveformId];
    if (input) {
      input.value = String(Math.round(ratio * 1000));
      input.setAttribute('aria-valuetext', `${formatDuration(currentTime)} / ${formatDuration(duration)}`);
    }
  };

  const playResultOption = (
    optionId: TranslateDubbingOptionId,
    audioUrl: string,
    seekRatio?: number,
  ) => {
    sourceAudioRef.current?.pause();
    sourceVideoRef.current?.pause();
    (Object.values(resultVideoRefs.current) as Array<HTMLVideoElement | null>).forEach(video => video?.pause());
    setIsSourcePlaying(false);
    onAudioPlay?.();
    if (!resultOptionAudioRef.current) resultOptionAudioRef.current = new Audio();
    const audio = resultOptionAudioRef.current;
    if (playingResultOptionId === optionId && seekRatio === undefined) {
      audio.pause();
      setPlayingResultOptionId(null);
      return;
    }

    activeResultOptionRef.current = optionId;
    setResultAudioErrors(prev => {
      if (!prev[audioUrl]) return prev;
      const next = { ...prev };
      delete next[audioUrl];
      return next;
    });
    const startPlayback = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const targetRatio = seekRatio ?? waveformProgressRatiosRef.current[optionId] ?? 0;
      const targetTime = duration > 0 ? Math.min(duration - 0.01, Math.max(0, targetRatio * duration)) : 0;
      if (duration > 0) audio.currentTime = targetTime;
      updateWaveformProgress(optionId, targetTime, duration);
      audio.play()
        .then(() => setPlayingResultOptionId(optionId))
        .catch(() => {
          setPlayingResultOptionId(null);
          setResultAudioErrors(prev => ({
            ...prev,
            [audioUrl]: '音频播放失败，请检查服务器连接后重试。',
          }));
        });
    };

    audio.ontimeupdate = () => {
      const activeOptionId = activeResultOptionRef.current;
      if (activeOptionId) updateWaveformProgress(activeOptionId, audio.currentTime, audio.duration);
    };
    audio.onended = () => {
      updateWaveformProgress(optionId, 0, audio.duration);
      audio.currentTime = 0;
      setPlayingResultOptionId(null);
    };
    audio.onerror = () => {
      setPlayingResultOptionId(null);
      setResultAudioErrors(prev => ({
        ...prev,
        [audioUrl]: '生成的音频无法加载。请确认服务仍在运行，或点击重试。',
      }));
    };

    if (activeResultAudioUrlRef.current !== audioUrl) {
      activeResultAudioUrlRef.current = audioUrl;
      audio.src = audioUrl;
      audio.load();
      audio.onloadedmetadata = startPlayback;
      return;
    }
    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      audio.onloadedmetadata = startPlayback;
      return;
    }
    startPlayback();
  };

  const seekSourceAudio = (ratio: number) => {
    const audio = sourceAudioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    resultOptionAudioRef.current?.pause();
    activeResultOptionRef.current = null;
    setPlayingResultOptionId(null);
    const targetTime = Math.max(0, Math.min(audio.duration - 0.01, ratio * audio.duration));
    audio.currentTime = targetTime;
    updateWaveformProgress('source', targetTime, audio.duration);
    onAudioPlay?.();
    audio.play()
      .then(() => setIsSourcePlaying(true))
      .catch(console.error);
  };

  const handleVideoPlay = (currentVideo: HTMLVideoElement) => {
    if (sourceAudioRef.current) sourceAudioRef.current.pause();
    if (resultOptionAudioRef.current) resultOptionAudioRef.current.pause();
    if (sourceVideoRef.current && sourceVideoRef.current !== currentVideo) sourceVideoRef.current.pause();
    (Object.values(resultVideoRefs.current) as Array<HTMLVideoElement | null>).forEach(video => {
      if (video && video !== currentVideo) video.pause();
    });
    setIsSourcePlaying(false);
    setPlayingResultOptionId(null);
    onAudioPlay?.();
  };

  const formatDuration = (duration?: number | null) => {
    if (duration == null || !Number.isFinite(duration)) return '--:--';
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const estimatedDubbingCredits = sourceDuration && sourceDuration > 0
    ? {
      low: Math.max(1, Math.ceil((sourceDuration / 60) * 2000)),
      high: Math.max(1, Math.ceil((sourceDuration / 60) * 3000)),
    }
    : null;

  const getWaveHeight = (versionId: TranslateDubbingOptionId | 'source', index: number) => {
    const seed = versionId === 'A' ? 11 : versionId === 'B' ? 23 : 5;
    const primary = Math.sin((index + seed) * 0.83);
    const secondary = Math.sin((index + seed * 2) * 0.31);
    const transient = ((index * 37 + seed * 19) % 17) / 17;
    return 16 + Math.round(Math.abs(primary * 0.62 + secondary * 0.28) * 54 + transient * 24);
  };

  const renderDetailedWaveform = (
    versionId: TranslateDubbingOptionId | 'source',
    isPlaying: boolean,
    accentClassName: string,
    onSeek: (ratio: number) => void,
  ) => (
    <div className={`relative flex h-12 items-center overflow-hidden rounded-lg border bg-white/90 px-2 py-1.5 shadow-inner transition-colors ${
      isPlaying ? 'border-sky-300' : 'border-slate-200'
    }`}>
      <div
        ref={(element) => {
          waveformFillRefs.current[versionId] = element;
          if (element) element.style.width = `${waveformProgressRatiosRef.current[versionId] * 100}%`;
        }}
        className={`pointer-events-none absolute inset-y-0 left-0 ${accentClassName} opacity-[0.14]`}
      />
      <div className="absolute left-0 right-0 top-1/2 h-px bg-slate-200/80" />
      <div className="relative z-10 flex h-full w-full items-center gap-px">
        {Array.from({ length: 96 }).map((_, index) => {
          const height = getWaveHeight(versionId, index);
          const topHeight = Math.max(8, Math.round(height * (0.45 + ((index * 7) % 10) / 40)));
          const bottomHeight = Math.max(8, Math.round(height * (0.38 + ((index * 11) % 12) / 42)));
          const isTransient = index % 13 === 0 || index % 17 === 0;
          return (
            <span key={index} className="flex h-full min-w-0 flex-1 flex-col items-center justify-center">
              <span
                className={`w-[2px] rounded-t-full ${isTransient ? 'bg-slate-500/70' : 'bg-slate-400/55'}`}
                style={{ height: `${topHeight}%` }}
              />
              <span
                className={`w-[2px] rounded-b-full ${isTransient ? 'bg-slate-500/60' : 'bg-slate-400/45'}`}
                style={{ height: `${bottomHeight}%` }}
              />
            </span>
          );
        })}
      </div>
      <div
        ref={(element) => {
          waveformPlayheadRefs.current[versionId] = element;
          if (element) element.style.left = `${waveformProgressRatiosRef.current[versionId] * 100}%`;
        }}
        className={`pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-px ${accentClassName}`}
      />
      <input
        ref={(element) => { waveformInputRefs.current[versionId] = element; }}
        type="range"
        min="0"
        max="1000"
        step="1"
        defaultValue={Math.round(waveformProgressRatiosRef.current[versionId] * 1000)}
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
          event.currentTarget.value = String(Math.round(ratio * 1000));
          onSeek(ratio);
        }}
        onInput={(event) => onSeek(Number(event.currentTarget.value) / 1000)}
        aria-label={`${versionId === 'source' ? '原始音频' : `版本 ${versionId}`}播放进度`}
        aria-valuetext="0:00"
        title="点击或拖动以跳转播放位置"
        className="absolute inset-0 z-30 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );

  const sanitizeDownloadName = (name: string) => (
    name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || `translated-dubbing-${Date.now()}`
  );

  const updateResultOptionName = (optionId: TranslateDubbingOptionId, displayName: string) => {
    const key = optionId === 'A' ? 'optionA' : 'optionB';
    const current = pendingResultOptions[key];
    setPendingResultOptions(prev => ({
      ...prev,
      [key]: prev[key] ? { ...prev[key], displayName } : prev[key],
    }));
    if (current?.data.audioUrl) {
      const normalizedName = displayName.trim() || current.displayName;
      setHistoryList(prev => prev.map(item => (
        item.url === current.data.audioUrl ? { ...item, title: normalizedName } : item
      )));
    }
  };

  return (
    <div className="space-y-5">
      {DUBBING_V2_AVAILABLE && (
        <nav
          className="mx-auto w-full max-w-4xl rounded-2xl border border-emerald-200 bg-emerald-50/60 p-2"
          aria-label="声音克隆方案"
        >
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/80 p-1">
            {([
              { value: 'self_hosted' as const, label: '声音克隆', disabled: false },
              { value: 'dubbing_v2' as const, label: DUBBING_V2_AVAILABLE ? '扩展语种 · Dubbing v2' : 'Dubbing v2 · 暂停使用', disabled: !DUBBING_V2_AVAILABLE },
            ]).map(option => {
              const isActive = dubbingMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={option.disabled}
                  title={option.disabled ? 'Dubbing v2 暂停使用' : undefined}
                  onClick={() => {
                    if (option.disabled) return;
                    setDubbingMode(option.value);
                    setError(null);
                    if (option.value === 'self_hosted' && sourceFile) {
                      setTargetTextExtractionMessage('请选择目标语种后点击“提取目标语种台词”');
                    }
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex h-10 min-w-0 items-center justify-center rounded-lg px-2 text-center text-[11px] font-black transition-colors ${
                    option.disabled
                      ? 'cursor-not-allowed text-slate-400 opacity-60'
                      : isActive
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      <div className="xl:col-span-7 space-y-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
          {dubbingMode === 'self_hosted' && localInputMode === 'text' && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5">
              <LocalVoiceEngineSelector
                selectedEngine={localVoiceEngine}
                status={localEngineStatus}
                isChecking={isCheckingLocalEngine}
                disabled={loading}
                onSelect={handleLocalVoiceEngineChange}
                onRefresh={() => void refreshLocalEngineStatus()}
              />
            </div>
          )}
          {dubbingMode === 'self_hosted' && (
            <nav className="rounded-xl border border-sky-200 bg-sky-50/50 p-1.5" aria-label="声音克隆输入方式">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/80 p-1">
                {([
                  { value: 'text' as const, label: '台词合成' },
                  { value: 'speech_to_speech' as const, label: '语音转语音' },
                ]).map(option => (
                  <button
                    key={option.value}
                    type="button"
                    aria-current={localInputMode === option.value ? 'page' : undefined}
                    onClick={() => handleLocalInputModeChange(option.value)}
                    className={`flex h-9 items-center justify-center rounded-md px-2 text-[10px] font-black transition-colors ${
                      localInputMode === option.value
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-500 hover:bg-sky-50 hover:text-sky-700'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </nav>
          )}
          {dubbingMode === 'self_hosted' && localInputMode === 'speech_to_speech' && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-3 text-[10px] text-emerald-800">
              <RefreshCw className="h-4 w-4 shrink-0 text-emerald-600" />
              <span><strong>Seed-VC V2 直接音色迁移</strong> · 只需参考音频和待转换语音，不需要目标语音或台词。</span>
            </div>
          )}
          {dubbingMode === 'dubbing_v2' && (
              <label className="block space-y-1.5 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5">
                <span className="flex items-center justify-between text-[10px] font-bold text-slate-600">
                  <span>说话人相似度</span>
                  <span className="font-mono text-emerald-700">{cloningStrength}/10</span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="1"
                  value={cloningStrength}
                  onChange={(event) => setCloningStrength(Number(event.target.value))}
                  className="w-full accent-emerald-600"
                />
                <span className="block text-[9px] leading-relaxed text-slate-500">默认 7；提高相似度可能牺牲部分目标语言的自然度。</span>
              </label>
          )}

          <label
            className="group flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/80 p-5 text-center transition-all hover:border-emerald-300 hover:bg-emerald-50/40"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files?.[0];
              if (file) handleFileChange(file);
            }}
          >
            <input
              type="file"
              accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.flac,.aif,.aiff,.mp4,.m4v,.mov,.webm,.mkv,.avi,.mpeg,.mpg,.wmv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFileChange(file);
                event.currentTarget.value = '';
              }}
            />
            <UploadCloud className="w-8 h-8 text-slate-400 transition-colors group-hover:text-emerald-600" />
            <p className="mt-3 text-xs font-bold text-slate-700">
              {sourceFile
                ? sourceFile.name
                : dubbingMode === 'self_hosted'
                  ? '上传一段克隆参考声音或含人声的视频'
                  : '上传中文/任意语种配音音频或视频'}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">
              {dubbingMode === 'self_hosted'
                ? localInputMode === 'speech_to_speech'
                  ? '这段声音会作为目标克隆音色；建议使用 10–20 秒、单人且干净的片段，系统最多使用 20 秒。单个文件不超过 100 MB。'
                  : localDialogueMode === 'multi'
                    ? '上传完整对话；系统会识别说话人，并为每位角色选择独立参考片段。单个文件不超过 100 MB；暂无单独时长限制。'
                  : '建议使用 10–20 秒、单人、干净且情绪明确的片段。音频只在本机处理。单个文件不超过 100 MB，系统最多使用参考声音 20 秒。'
                : '支持拖拽上传；视频可输出带新配音的 MP4，也可只导出音频。单个文件不超过 100 MB；暂无单独时长限制。'}
            </p>
          </label>

          {dubbingMode === 'self_hosted' && localInputMode === 'speech_to_speech' && (
            <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/40 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-slate-700">上传待转换语音</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-400">直接把这段语音转换成上面的克隆参考音色，保留原有内容、节奏和情绪。单个文件不超过 100 MB；暂无单独时长限制。</p>
                </div>
                <label className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-3 text-[10px] font-bold text-sky-700 transition-colors hover:border-sky-400 hover:bg-sky-50">
                  <input
                    type="file"
                    accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.flac,.aif,.aiff"
                    className="hidden"
                    disabled={isTranscribingScript || loading}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void handleSpeechInputFileChange(file);
                      event.currentTarget.value = '';
                    }}
                  />
                  {isTranscribingScript ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                  <span>{speechInputFile ? '更换语音' : '选择语音'}</span>
                </label>
              </div>
              {speechInputFile && (
                <div className="flex items-center gap-2 rounded-lg border border-sky-100 bg-white px-2.5 py-2">
                  <FileAudio className="h-4 w-4 shrink-0 text-sky-600" />
                  <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-slate-700">{speechInputFile.name}</span>
                  <button
                    type="button"
                    onClick={clearSpeechInputFile}
                    disabled={isTranscribingScript || loading}
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                    清除
                  </button>
                </div>
              )}
            </div>
          )}

          {sourceFileUrl && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
              <button
                type="button"
                onClick={toggleSourcePlay}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
              >
                {isSourcePlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-xs font-bold text-slate-750">{sourceFile?.name}</p>
                  <span className="shrink-0 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                    {dubbingMode === 'self_hosted' ? '克隆参考音频' : '原始上传音频'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400">{sourceFile ? `${(sourceFile.size / 1024 / 1024).toFixed(2)} MB` : '源音频'}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (sourceFileUrl) URL.revokeObjectURL(sourceFileUrl);
                  sourceAudioRef.current?.pause();
                  resultOptionAudioRef.current?.pause();
                  activeResultOptionRef.current = null;
                  activeResultAudioUrlRef.current = '';
                  waveformProgressRatiosRef.current = { source: 0, A: 0, B: 0 };
                  setSourceFile(null);
                  setSourceFileUrl(null);
                  setResult(null);
                  setPendingResultOptions({ optionA: null, optionB: null });
                  setPlayingResultOptionId(null);
                  setIsSourcePlaying(false);
                  targetTextRequestRef.current += 1;
                  extractedSourceTextRef.current = '';
                  setLocalTargetText('');
                  setMultiSpeakerSegments([]);
                  setMultiSpeakerAudioEvents([]);
                  setMultiSpeakerProfiles([]);
                  setMultiSpeakerGenerationProgress('');
                  setMultiSpeakerTimelineSummary(null);
                  setTargetTextExtractionMessage('');
                  setIsExtractingTargetText(false);
                }}
                className="p-1.5 text-slate-400 hover:text-rose-500"
              >
                <X className="w-4 h-4" />
              </button>
              <audio
                ref={sourceAudioRef}
                src={sourceFileUrl}
                onLoadedMetadata={(event) => updateWaveformProgress('source', event.currentTarget.currentTime, event.currentTarget.duration)}
                onTimeUpdate={(event) => updateWaveformProgress('source', event.currentTarget.currentTime, event.currentTarget.duration)}
                onEnded={(event) => {
                  event.currentTarget.currentTime = 0;
                  updateWaveformProgress('source', 0, event.currentTarget.duration);
                  setIsSourcePlaying(false);
                }}
                onPause={() => setIsSourcePlaying(false)}
              />
            </div>
          )}

          {dubbingMode === 'self_hosted' && localInputMode === 'text' && (
            <div className="-mx-6 space-y-5 border-y border-sky-100 bg-sky-50/40 px-6 py-5">
              <div className="flex flex-col gap-3 border-b border-sky-100 pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">对话模式</span>
                  <div className="grid w-full grid-cols-2 gap-1 rounded-lg border border-sky-100 bg-white p-1 sm:w-64">
                    {([
                      { value: 'single' as const, label: '单人配音', icon: Volume2 },
                      { value: 'multi' as const, label: '多人对话', icon: Users },
                    ].filter(option => localInputMode === 'speech_to_speech' ? option.value === 'single' : true)).map(option => {
                      const Icon = option.icon;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            if (option.value === localDialogueMode) return;
                            setLocalDialogueMode(option.value);
                            setError(null);
                            setResult(null);
                            setPendingResultOptions({ optionA: null, optionB: null });
                            targetTextRequestRef.current += 1;
                            extractedSourceTextRef.current = '';
                            setLocalTargetText('');
                            setMultiSpeakerSegments([]);
                            setMultiSpeakerAudioEvents([]);
                            setMultiSpeakerProfiles([]);
                            setMultiSpeakerTimelineSummary(null);
                            setTargetTextExtractionMessage(sourceFile
                              ? option.value === 'multi'
                                ? '点击识别说话人与台词'
                                : '点击提取目标语种台词'
                              : '');
                          }}
                          aria-pressed={localDialogueMode === option.value}
                          className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-[10px] font-black transition-colors ${
                            localDialogueMode === option.value
                              ? 'bg-sky-600 text-white shadow-sm'
                              : 'text-slate-500 hover:bg-sky-50 hover:text-sky-700'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {localDialogueMode === 'multi' && (
                  <label className="space-y-1.5 sm:w-36">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">预计人数</span>
                    <select
                      value={expectedSpeakerCount}
                      onChange={(event) => setExpectedSpeakerCount(event.target.value === 'auto' ? 'auto' : Number(event.target.value))}
                      className="h-10 w-full rounded-lg border border-sky-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                    >
                      <option value="auto">自动判断</option>
                      {[2, 3, 4, 5, 6, 7, 8].map(count => <option key={count} value={count}>{count} 人</option>)}
                    </select>
                  </label>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                <label className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">目标语言</span>
                  <select
                    value={localTargetLanguage}
                    onChange={(event) => handleLocalTargetLanguageChange(event.target.value)}
                    className="h-10 w-full rounded-lg border border-sky-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none transition-colors focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  >
                    {availableLocalTargetLanguageOptions.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleExtractTargetTextClick}
                    disabled={!(localInputMode === 'speech_to_speech' ? speechInputFile : sourceFile) || isExtractingTargetText}
                    className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-sky-200 bg-white px-2 text-[10px] font-bold text-sky-700 transition-colors hover:border-sky-400 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isExtractingTargetText ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
                    {isExtractingTargetText
                      ? localDialogueMode === 'multi' ? '正在识别角色…' : '正在提取台词…'
                      : localDialogueMode === 'multi' ? '识别说话人与台词' : '提取目标语种台词'}
                  </button>
                </label>

                {localDialogueMode === 'single' ? (
                <div className="space-y-1.5">
                  <span className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <span>{localInputMode === 'speech_to_speech' ? '识别后的语音台词' : '目标语言台词'}</span>
                    <span className="font-mono font-medium text-slate-400">{localTargetText.length}/800</span>
                  </span>
                  {targetTextExtractionMessage && (
                    <span className={`flex items-center gap-1 text-[10px] leading-relaxed ${
                      isExtractingTargetText
                        ? 'text-sky-600'
                        : /失败|没有识别|换一段/.test(targetTextExtractionMessage)
                          ? 'text-rose-600'
                          : 'text-emerald-600'
                    }`}>
                      {isExtractingTargetText && <Loader2 className="h-3 w-3 animate-spin" />}
                      {targetTextExtractionMessage}
                    </span>
                  )}
                  <textarea
                    value={localTargetText}
                    onChange={(event) => updateSingleSpeakerDialogue(event.target.value)}
                    rows={4}
                    placeholder={localInputMode === 'speech_to_speech'
                      ? '识别后的语音台词会显示在这里，也可以手动修改...'
                      : '输入或粘贴已经翻译好的目标语言台词...'}
                    className="w-full resize-y rounded-lg border border-sky-200 bg-white px-3 py-2.5 text-xs leading-relaxed text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  />
                  {localInputMode === 'text' && <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-2.5 text-[10px] font-bold text-sky-700 transition-colors hover:border-sky-400 hover:bg-sky-50">
                      <input
                        type="file"
                        accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.flac,.aif,.aiff"
                        className="hidden"
                        disabled={isTranscribingScript || loading}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void handleScriptFileChange(file);
                          event.currentTarget.value = '';
                        }}
                      />
                      {isTranscribingScript ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                      <span className="max-w-[220px] truncate">{scriptFile ? scriptFile.name : '上传台词音频并识别文字'}</span>
                    </label>
                    {scriptFile && (
                      <button
                        type="button"
                        onClick={() => setScriptFile(null)}
                        disabled={isTranscribingScript || loading}
                        className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[10px] font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                        清除台词音频
                      </button>
                    )}
                  </div>}
                  <p className="text-[9px] leading-relaxed text-slate-400">
                    {localInputMode === 'speech_to_speech'
                      ? '上传待转换语音后会自动识别并翻译台词，确认文本后用克隆音色生成。'
                      : '可直接输入台词，也可上传一段读台词的音频，识别文字后用克隆音色合成。'}
                  </p>
                </div>
                ) : (
                  <div className="flex min-h-24 flex-col justify-center border-l-0 border-sky-100 sm:border-l sm:pl-4">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-sky-600" />
                      <span className="text-xs font-black text-slate-800">
                        {multiSpeakerProfiles.length > 0
                          ? `${multiSpeakerProfiles.length} 位说话人 · ${multiSpeakerSegments.length} 段台词`
                          : '等待说话人识别'}
                      </span>
                    </div>
                    {targetTextExtractionMessage && (
                      <span className={`mt-2 flex items-center gap-1.5 text-[10px] leading-relaxed ${
                        isExtractingTargetText
                          ? 'text-sky-600'
                          : /失败|没有识别|超过/.test(targetTextExtractionMessage)
                            ? 'text-rose-600'
                            : 'text-emerald-600'
                      }`}>
                        {isExtractingTargetText && <Loader2 className="h-3 w-3 animate-spin" />}
                        {targetTextExtractionMessage}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {localDialogueMode === 'multi' && multiSpeakerProfiles.length > 0 && (
                <div className="space-y-4 border-t border-sky-100 pt-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">角色与参考音色</span>
                      <span className="text-[9px] text-slate-400">
                        {localVoiceEngine === 'cosyvoice3' ? '每位角色使用一段连续主参考音' : '自动拼接每位角色的多段干净台词'}
                      </span>
                    </div>
                    <div className="divide-y divide-sky-100 border-y border-sky-100">
                      {multiSpeakerProfiles.map(profile => (
                        <div key={profile.id} className="grid grid-cols-[12px_minmax(0,1fr)] gap-3 py-3 sm:grid-cols-[12px_minmax(120px,1fr)_100px_100px] sm:items-center">
                          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: profile.color }} />
                          <div className="min-w-0">
                            <input
                              value={profile.name}
                              onChange={(event) => updateMultiSpeakerProfile(profile.id, { name: event.target.value.slice(0, 30) })}
                              aria-label={`${profile.name}角色名称`}
                              className="h-8 w-full min-w-0 rounded-md border border-sky-200 bg-white px-2 text-xs font-bold text-slate-800 outline-none focus:border-sky-500"
                            />
                            {(() => {
                              const referenceDuration = localVoiceEngine === 'cosyvoice3'
                                ? profile.referenceEnd - profile.referenceStart
                                : profile.referenceRanges.reduce((sum, range) => sum + range.end - range.start, 0);
                              const referenceCount = localVoiceEngine === 'cosyvoice3' ? 1 : profile.referenceRanges.length;
                              return (
                                <span className={`mt-1 block text-[9px] ${referenceDuration < 4 ? 'font-bold text-amber-600' : 'text-emerald-600'}`}>
                                  {referenceDuration < 4
                                    ? `参考音仅 ${referenceDuration.toFixed(1)} 秒，音色可能不稳定`
                                    : `${referenceCount} 段参考音 · 共 ${referenceDuration.toFixed(1)} 秒`}
                                </span>
                              );
                            })()}
                          </div>
                          <label className="col-start-2 flex items-center gap-1 sm:col-start-auto">
                            <span className="w-7 shrink-0 whitespace-nowrap text-[9px] text-slate-400">起点</span>
                            <input
                              type="number"
                              min="0"
                              max={sourceDuration || undefined}
                              step="0.1"
                              value={profile.referenceStart.toFixed(1)}
                              onChange={(event) => {
                                const value = Math.max(0, Number(event.target.value));
                                updateMultiSpeakerProfile(profile.id, {
                                  referenceStart: Math.min(value, profile.referenceEnd - 0.5),
                                });
                              }}
                              className="h-8 w-full rounded-md border border-sky-200 bg-white px-2 font-mono text-[10px] text-slate-700 outline-none focus:border-sky-500"
                            />
                          </label>
                          <label className="col-start-2 flex items-center gap-1 sm:col-start-auto">
                            <span className="w-7 shrink-0 whitespace-nowrap text-[9px] text-slate-400">终点</span>
                            <input
                              type="number"
                              min={profile.referenceStart + 0.5}
                              max={sourceDuration || undefined}
                              step="0.1"
                              value={profile.referenceEnd.toFixed(1)}
                              onChange={(event) => {
                                const value = Math.max(profile.referenceStart + 0.5, Number(event.target.value));
                                updateMultiSpeakerProfile(profile.id, {
                                  referenceEnd: Math.min(profile.referenceStart + 20, sourceDuration || value, value),
                                });
                              }}
                              className="h-8 w-full rounded-md border border-sky-200 bg-white px-2 font-mono text-[10px] text-slate-700 outline-none focus:border-sky-500"
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">每位角色的全部台词</span>
                      <span className="text-[9px] text-slate-400">段落之间用空行分隔</span>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {multiSpeakerProfiles.map(profile => {
                        const speakerSegments = multiSpeakerSegments.filter(segment => segment.speakerId === profile.id);
                        const speakerEvents = multiSpeakerAudioEvents.filter(event => event.speakerId === profile.id);
                        const eventCounts = speakerEvents.reduce<Partial<Record<MultiSpeakerAudioEventType, number>>>((counts, event) => ({
                          ...counts,
                          [event.type]: (counts[event.type] || 0) + 1,
                        }), {});
                        return (
                          <section key={profile.id} className="min-w-0 border-l-2 bg-slate-50/60 px-3 py-3" style={{ borderLeftColor: profile.color }}>
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: profile.color }} />
                                <span className="truncate text-xs font-black text-slate-800">{profile.name}</span>
                                <span className="shrink-0 text-[9px] text-slate-400">{speakerSegments.length} 段</span>
                              </div>
                              {speakerEvents.length > 0 && (
                                <div className="flex flex-wrap justify-end gap-1">
                                  {Object.entries(eventCounts).map(([type, count]) => (
                                    <span key={type} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                                      {audioEventLabels[type as MultiSpeakerAudioEventType]} {count}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <textarea
                              value={speakerSegments.map(segment => segment.targetText).join('\n\n')}
                              onChange={(event) => updateSpeakerDialogue(profile.id, event.target.value)}
                              rows={Math.min(12, Math.max(5, speakerSegments.length * 2))}
                              aria-label={`${profile.name}全部目标台词`}
                              placeholder={`${profile.name}的目标语言台词`}
                              className="w-full resize-y rounded-md border border-sky-200 bg-white px-3 py-2.5 text-xs leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                            />
                            <p className="mt-1.5 text-[9px] leading-relaxed text-slate-400">
                              未说话处自动留白；{speakerEvents.length > 0 ? `${speakerEvents.length} 个笑声或语气事件直接保留原声。` : '未检测到可独立保留的笑声或语气事件。'}
                            </p>
                          </section>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className={`grid grid-cols-1 gap-5 border-t border-sky-100 pt-4 ${localDialogueMode === 'single' ? 'md:grid-cols-2' : ''}`}>
                {localDialogueMode === 'single' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">参考时间范围</span>
                    <span className="font-mono text-[10px] font-bold text-sky-700">
                      {sourceDuration
                        ? `${formatDuration(localReferenceStart)} - ${formatDuration(localReferenceEnd)} · ${formatDuration(localReferenceInterval)}`
                        : '--:-- - --:--'}
                    </span>
                  </div>
                  <div className="relative h-7 px-1">
                    <div className="absolute inset-x-1 top-3 h-1.5 rounded-full bg-slate-200" />
                    <div
                      className="absolute top-3 h-1.5 rounded-full bg-sky-500"
                      style={{
                        left: `${localReferenceTimelineDuration ? (localReferenceStart / localReferenceTimelineDuration) * 100 : 0}%`,
                        right: `${localReferenceTimelineDuration ? 100 - (localReferenceEnd / localReferenceTimelineDuration) * 100 : 100}%`,
                      }}
                    />
                    <input
                      type="range"
                      min="0"
                      max={localReferenceMaxStart}
                      step="0.1"
                      value={localReferenceStart}
                      onChange={(event) => {
                        const value = Math.min(Number(event.target.value), Math.max(0, localReferenceEnd - 0.5));
                        setLocalReferenceStart(Math.max(localReferenceEnd - 20, value));
                      }}
                      disabled={!sourceDuration || sourceDuration <= 0.5}
                      className="pointer-events-none absolute inset-x-0 top-0 h-7 w-full appearance-none bg-transparent accent-sky-600 disabled:opacity-40 [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto"
                      aria-label="参考声音取样起点"
                    />
                    <input
                      type="range"
                      min={Math.min(localReferenceTimelineDuration, localReferenceStart + 0.5)}
                      max={localReferenceTimelineDuration}
                      step="0.1"
                      value={Math.min(localReferenceTimelineDuration, Math.max(localReferenceStart + 0.5, localReferenceEnd))}
                      onChange={(event) => {
                        const value = Math.max(Number(event.target.value), localReferenceStart + 0.5);
                        setLocalReferenceEnd(Math.min(localReferenceTimelineDuration, Math.min(localReferenceStart + 20, value)));
                      }}
                      disabled={!sourceDuration || sourceDuration <= 0.5}
                      className="pointer-events-none absolute inset-x-0 top-0 h-7 w-full appearance-none bg-transparent accent-sky-600 disabled:opacity-40 [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto"
                      aria-label="参考声音取样终点"
                    />
                  </div>
                  <p className="text-[9px] leading-relaxed text-slate-500">
                    拖动两端手柄选择最能代表说话风格的时间区间，最长 20 秒。
                  </p>
                </div>
                )}

                <div className="space-y-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-sky-600" />
                    声音表现
                  </span>
                  <div className="grid grid-cols-3 gap-1 rounded-lg border border-sky-100 bg-white p-1">
                    {localPerformancePresets.map(preset => (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => setLocalPerformancePreset(preset.value)}
                        aria-pressed={localPerformancePreset === preset.value}
                        title={preset.description}
                        className={`h-8 rounded-md text-[10px] font-black transition-colors ${
                          localPerformancePreset === preset.value
                            ? 'bg-sky-600 text-white shadow-sm'
                            : 'text-slate-500 hover:bg-sky-50 hover:text-sky-700'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[9px] leading-relaxed text-slate-500">
                    {localPerformancePresets.find(preset => preset.value === localPerformancePreset)?.description}
                  </p>
                </div>
              </div>
            </div>
          )}

          {dubbingMode !== 'self_hosted' && (
          <div className={`grid grid-cols-1 gap-3 ${dubbingMode === 'dubbing_v2' ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">原语言</span>
              <select
                value={sourceLanguage}
                onChange={(event) => setSourceLanguage(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {sourceLanguageOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">目标语言</span>
              <select
                value={targetLanguage}
                onChange={(event) => setTargetLanguage(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {targetLanguageOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            {dubbingMode === 'dubbing_v2' && sourceIsVideo && (
              <label className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">输出格式</span>
                <select
                  value={outputFormat}
                  onChange={(event) => setOutputFormat(event.target.value as 'mp3' | 'mp4')}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="mp4">MP4 视频（替换原音轨）</option>
                  <option value="mp3">MP3 音频</option>
                </select>
              </label>
            )}

          </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {dubbingMode === 'dubbing_v2' && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-[10px] leading-relaxed text-amber-800">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>
                {estimatedDubbingCredits
                  ? <>本次预计消耗 <strong>{estimatedDubbingCredits.low.toLocaleString()}–{estimatedDubbingCredits.high.toLocaleString()} credits</strong>（1 种目标语言，按音频时长估算）。实际金额以 ElevenLabs 提交前报价为准。</>
                  : '上传音频后会读取时长，并在这里显示预计 credits 消耗。'}
              </span>
            </div>
          )}

          {dubbingMode === 'self_hosted' && (
            <div className="flex items-start gap-2 border-t border-slate-100 pt-3 text-[10px] leading-relaxed text-slate-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
              <span>
                {localDialogueMode === 'multi'
                  ? '多人模式让每位角色独立对齐原时间线。CosyVoice 会在模型内按原轮次轻微贴合语速（最多 ±8%），不使用 FFmpeg 后期变速；连续笑声会合并并保留自然尾音。'
                  : localInputMode === 'speech_to_speech'
                    ? '语音转语音会直接把内容语音迁移到参考声音的音色；当前版本输出两个 WAV 版本。'
                    : '本机生成两个版本通常约 60–120 秒；当前版本输出 WAV，不会自动翻译或替换视频音轨。'}
              </span>
            </div>
          )}

          {dubbingMode === 'self_hosted' && localDialogueMode === 'multi' && multiSpeakerTimelineSummary && (
            <div className="border-t border-sky-100 pt-3">
              <div className="flex items-center gap-1.5 text-[10px] font-black text-sky-900">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                原声语速贴合
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {multiSpeakerTimelineSummary.versions.map(version => (
                  <div key={version.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-sky-300 pl-2 text-[9px] text-slate-500">
                    <span className="font-black text-slate-700">版本 {version.id}</span>
                    <span>顺延 {version.shiftedClipCount} 段</span>
                    <span>最多 {version.maxShiftSeconds.toFixed(1)} 秒</span>
                    <span>语速贴合 {version.paceAdjustedClipCount} 段</span>
                    <span>保留事件 {version.preservedEventCount} 个</span>
                    {version.droppedEventCount > 0 && <span className="font-bold text-amber-600">漏掉 {version.droppedEventCount} 个事件</span>}
                    <span>总时长 {formatDuration(version.outputDuration)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
                每位角色分别锚定原始开始时间；语速只做小幅模型内贴合，超出范围时保留自然度并允许顺延。
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            title={dubbingMode === 'self_hosted' ? localCloneDisabledReason || '开始本机克隆配音' : undefined}
            disabled={
              loading
              || !sourceFile
              || (dubbingMode === 'self_hosted' && Boolean(localCloneDisabledReason))
            }
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-xs font-black text-white shadow-md transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
              dubbingMode === 'self_hosted'
                ? 'bg-sky-600 shadow-sky-600/10 hover:bg-sky-700'
                : 'bg-gradient-to-r from-emerald-600 to-teal-600 shadow-emerald-600/10 hover:from-emerald-700 hover:to-teal-700'
            }`}
          >
                {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {dubbingMode === 'dubbing_v2'
                  ? '正在使用 ElevenLabs Dubbing v2 生成...'
                  : dubbingMode === 'self_hosted'
                    ? localDialogueMode === 'multi'
                      ? multiSpeakerGenerationProgress || '正在准备多人配音…'
                      : '正在加载本地模型并生成 2 个克隆声音...'
                    : '正在识别、翻译并生成目标语音...'}
              </>
            ) : (
              <>
                {dubbingMode === 'self_hosted' ? <Cpu className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                {dubbingMode === 'self_hosted'
                  ? localDialogueMode === 'multi' ? '生成多人配音时间线' : localInputMode === 'speech_to_speech' ? '生成语音转语音' : '用本机生成克隆配音'
                  : '生成跨语种转换'}
              </>
            )}
          </button>
          {dubbingMode === 'self_hosted' && localCloneDisabledReason && (
            <div className="flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-700">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>{localCloneDisabledReason}</span>
            </div>
          )}
        </div>
      </div>

      <div className="xl:col-span-5 space-y-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
            <FileAudio className="w-4 h-4 text-emerald-600" />
            生成结果
          </h3>

          {!result ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <Languages className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-xs font-bold text-slate-500">
                {dubbingMode === 'self_hosted'
                  ? '生成后会在这里保留两个克隆声音版本，可分别试听和下载。'
                  : '生成后会在这里保留原始文件、转换结果、原文和译文，方便对比。'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3.5 text-[11px] text-emerald-800">
                {dubbingMode === 'self_hosted'
                  ? `已生成 ${resultOptionList.length} 个克隆声音`
                  : primaryResultIsVideo ? '已生成目标视频' : '已生成目标音频'}
                {typeof result.sourceDuration === 'number' && typeof result.outputDuration === 'number'
                  ? ` · 原始媒体 ${result.sourceDuration.toFixed(1)}s / 输出 ${result.outputDuration.toFixed(1)}s`
                  : ''}
              </div>

              {sourceFileUrl && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    {!sourceIsVideo && (
                      <button
                        type="button"
                        onClick={toggleSourcePlay}
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-all ${
                          isSourcePlaying
                            ? 'border-slate-700 bg-slate-800 text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {isSourcePlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-black text-slate-800">{sourceIsVideo ? '原始上传视频' : '原始上传音频'}</p>
                        <span className="shrink-0 text-[10px] font-mono font-bold text-slate-400">{formatDuration(sourceDuration)}</span>
                      </div>
                      <p className="truncate text-[10px] text-slate-500">{sourceFile?.name || (sourceIsVideo ? '源视频' : '源音频')}</p>
                    </div>
                  </div>
                  {sourceIsVideo ? (
                    <video
                      ref={sourceVideoRef}
                      src={sourceFileUrl}
                      controls
                      preload="metadata"
                      className="aspect-video w-full rounded-xl border border-slate-200 bg-black object-contain"
                      onPlay={(event) => handleVideoPlay(event.currentTarget)}
                    />
                  ) : renderDetailedWaveform('source', isSourcePlaying, 'bg-slate-800', seekSourceAudio)}
                </div>
              )}

              {resultOptionList.map(option => {
                const isPlayingThisOption = playingResultOptionId === option.id;
                const isVideoResult = option.data.outputFormat === 'mp4';
                const optionDuration = option.data.outputDuration
                  ?? option.data.generatedDuration
                  ?? resultAudioDurations[option.data.audioUrl]
                  ?? null;
                return (
                  <div key={option.id} className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      {!isVideoResult && (
                        <button
                          type="button"
                          onClick={() => playResultOption(option.id, option.data.audioUrl)}
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-all ${
                            isPlayingThisOption
                              ? `${option.id === 'A' ? 'border-emerald-500 bg-emerald-600' : 'border-teal-500 bg-teal-600'} text-white`
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {isPlayingThisOption ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                        </button>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black text-white ${
                            option.data.dubbingModel === 'local_chatterbox'
                            || option.data.dubbingModel === 'local_cosyvoice3'
                            || option.data.dubbingModel === 'local_multispeaker'
                            || option.data.dubbingModel === 'local_seed_vc'
                              ? 'bg-sky-600'
                              : option.id === 'A' ? 'bg-emerald-600' : 'bg-teal-600'
                          }`}>
                            {option.data.dubbingModel === 'dubbing_v2'
                              ? 'Dubbing v2'
                              : option.data.dubbingModel === 'local_chatterbox'
                                ? '本地 Chatterbox'
                                : option.data.dubbingModel === 'local_cosyvoice3'
                                  ? '本地 CosyVoice 3'
                                  : option.data.dubbingModel === 'local_multispeaker'
                                    ? `多人 · ${multiSpeakerProfiles.length} 位`
                                    : option.data.dubbingModel === 'local_seed_vc'
                                      ? 'Seed-VC V2'
                                      : `版本 ${option.id}`}
                          </span>
                          <input
                            type="text"
                            value={option.displayName}
                            onChange={(event) => updateResultOptionName(option.id, event.target.value)}
                            className="min-w-0 flex-1 rounded-md border border-transparent bg-white/80 px-2 py-1 text-xs font-bold text-slate-800 outline-none transition-all hover:border-slate-200 focus:border-emerald-400 focus:bg-white focus:ring-1 focus:ring-emerald-200"
                            aria-label={`版本 ${option.id} 配音名称`}
                          />
                          <span className="shrink-0 text-[10px] font-mono font-bold text-slate-500">{formatDuration(optionDuration)}</span>
                        </div>
                        <p className="mt-1 truncate text-[10px] text-slate-500">
                          {isVideoResult ? '转换后视频' : '转换后音频'}
                          {' · '}
                          {option.data.dubbingModel === 'dubbing_v2'
                            ? `自动保留原声线 · 相似度 ${option.data.cloningStrength ?? cloningStrength}/10`
                            : option.data.dubbingModel === 'local_chatterbox'
                              ? `本机克隆原音色 · ${localTargetLanguageOptions.find(item => item.value === localTargetLanguage)?.label || localTargetLanguage}`
                              : option.data.dubbingModel === 'local_cosyvoice3'
                              ? `CosyVoice 3 克隆原音色 · ${localTargetLanguageOptions.find(item => item.value === localTargetLanguage)?.label || localTargetLanguage}`
                              : option.data.dubbingModel === 'local_multispeaker'
                                  ? `${multiSpeakerProfiles.length} 位独立音色 · 分角色对齐时间线`
                                  : option.data.dubbingModel === 'local_seed_vc'
                                    ? 'Seed-VC V2 · 直接音色迁移'
                                    : `Dubbing v2 · ${targetLanguage}`}
                          {(option.data.dubbingModel === 'local_chatterbox' || option.data.dubbingModel === 'local_cosyvoice3')
                            && (typeof option.data.speakerSimilarity === 'number'
                              ? ` · 克隆验证 ${Math.round(option.data.speakerSimilarity * 100)}%`
                              : ' · 克隆验证未返回')}
                        </p>
                      </div>
                    </div>

                    {isVideoResult ? (
                      <video
                        ref={(element) => { resultVideoRefs.current[option.id] = element; }}
                        src={option.data.audioUrl}
                        controls
                        preload="metadata"
                        className="aspect-video w-full rounded-xl border border-emerald-100 bg-black object-contain"
                        onPlay={(event) => handleVideoPlay(event.currentTarget)}
                      />
                    ) : renderDetailedWaveform(
                      option.id,
                      isPlayingThisOption,
                      option.id === 'A' ? 'bg-emerald-500' : 'bg-teal-500',
                      ratio => playResultOption(option.id, option.data.audioUrl, ratio),
                    )}

                    {resultAudioErrors[option.data.audioUrl] && (
                      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-semibold text-rose-700">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>{resultAudioErrors[option.data.audioUrl]}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => downloadAudioHelper(option.data.audioUrl, `${sanitizeDownloadName(option.displayName)}.${option.data.outputFormat || 'mp3'}`)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-[10px] font-bold text-slate-700 shadow-sm transition-all hover:bg-emerald-50 hover:text-emerald-700"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>
                        {option.data.outputFormat === 'mp4'
                          ? '下载 MP4 视频'
                          : option.data.outputFormat === 'wav'
                            ? '下载 WAV 克隆配音'
                            : '下载 MP3 配音'}
                      </span>
                    </button>
                  </div>
                );
              })}

              <div className="space-y-3">
                {result.dubbingModel !== 'local_chatterbox' && result.dubbingModel !== 'local_cosyvoice3' && result.dubbingModel !== 'local_seed_vc' && (
                  <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">识别原文</p>
                  <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 custom-scrollbar">
                    {result.sourceText}
                  </div>
                  </div>
                )}
                {result.dubbingModel !== 'local_seed_vc' && <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {result.dubbingModel === 'local_chatterbox' || result.dubbingModel === 'local_cosyvoice3'
                      ? '本次生成台词'
                      : result.dubbingModel === 'local_multispeaker' ? '多人配音台词' : '目标译文'}
                  </p>
                  <div className="max-h-32 overflow-y-auto rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-xs leading-relaxed text-slate-800 custom-scrollbar">
                    {result.translatedText}
                  </div>
                </div>}
                {result.dubbingModel === 'local_seed_vc' && (
                  <p className="text-[10px] text-slate-500">参考音色已直接迁移到待转换语音，未经过台词或目标语音处理。</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-[11px] leading-relaxed text-slate-500 shadow-sm">
          <p className="font-bold text-slate-700 mb-1">使用建议</p>
          <p>
            {dubbingMode === 'self_hosted'
              ? '参考片段尽量只含一位说话人，避开音乐、混响和长静音；先用“自然”，情绪不足时再切到“情绪”。'
              : '广告、短视频口型替换建议用“尽量贴合原时长”；如果是独立配音文件，优先用“自然配音”，声音会更像真人。'}
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}

