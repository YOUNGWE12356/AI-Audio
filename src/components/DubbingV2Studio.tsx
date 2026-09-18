/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileAudio,
  Languages,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UploadCloud,
  Users,
  Video,
  X,
} from 'lucide-react';
import { HistoryItem } from '../types';
import {
  transcribeSpeech,
  translateDubbingV2Audio,
  type SpeechTranscriptionResult,
  type TranslateDubbingResult,
} from '../services/elevenLabsService';
import { translateTextToLanguage } from '../services/geminiService';
import {
  DUBBING_SOURCE_LANGUAGE_OPTIONS,
  DUBBING_TARGET_LANGUAGE_OPTIONS,
} from '../services/languageRegistry';
import { downloadAudioHelper } from '../utils/downloadHelper';

interface DubbingV2StudioProps {
  initialFile?: File;
  assistantRequestId?: string;
  initialTargetLanguage?: string;
  setHistoryList: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
  onAudioPlay?: () => void;
}

type ProjectStage = 'empty' | 'uploaded' | 'analyzed' | 'rendered';
type OutputFormat = 'mp3' | 'mp4';

interface DubbingV2Segment {
  id: string;
  speakerId: string;
  start: number;
  end: number;
  sourceText: string;
  targetText: string;
}

interface DubbingV2Speaker {
  id: string;
  name: string;
  segmentCount: number;
}

interface DubbingV2LanguageVersion {
  id: string;
  language: string;
  label: string;
  status: 'draft' | 'rendered';
  resultUrl?: string;
}

const formatSeconds = (value: number) => {
  if (!Number.isFinite(value)) return '00:00.0';
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
};

const getTargetLanguageLabel = (value: string) => (
  DUBBING_TARGET_LANGUAGE_OPTIONS.find(option => option.value === value)?.label || value
);

const normalizeSpeakerId = (value: unknown, fallbackIndex = 0) => {
  const raw = String(value || '').trim();
  return raw || `speaker_${fallbackIndex + 1}`;
};

const buildTranscriptSegments = (transcription: SpeechTranscriptionResult): DubbingV2Segment[] => {
  const directSegments = transcription.segments || [];
  if (directSegments.length > 0) {
    return directSegments.map((segment, index) => ({
      id: `segment-${index + 1}`,
      speakerId: normalizeSpeakerId(segment.speaker_id ?? segment.speakerId, index),
      start: Number(segment.start) || 0,
      end: Number(segment.end) || Number(segment.start) || 0,
      sourceText: String(segment.text || '').trim(),
      targetText: '',
    })).filter(segment => segment.sourceText);
  }

  const words = (transcription.words || [])
    .map((word, index) => ({
      text: String(word.text ?? word.word ?? '').trim(),
      start: Number(word.start) || 0,
      end: Number(word.end) || Number(word.start) || 0,
      speakerId: normalizeSpeakerId(word.speaker_id ?? word.speakerId, index),
    }))
    .filter(word => word.text);

  if (words.length === 0) {
    const text = String(transcription.text || '').trim();
    return text ? [{
      id: 'segment-1',
      speakerId: 'speaker_1',
      start: 0,
      end: 0,
      sourceText: text,
      targetText: '',
    }] : [];
  }

  const segments: DubbingV2Segment[] = [];
  let current = [words[0]];
  const flush = () => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];
    segments.push({
      id: `segment-${segments.length + 1}`,
      speakerId: first.speakerId,
      start: first.start,
      end: last.end,
      sourceText: current.map(word => word.text).join(' ').replace(/\s+([,.!?;:，。！？；：])/g, '$1'),
      targetText: '',
    });
    current = [];
  };

  for (const word of words.slice(1)) {
    const previous = current[current.length - 1];
    const gap = word.start - previous.end;
    const sentenceEnded = /[.!?。！？…]$/.test(previous.text);
    if (word.speakerId !== previous.speakerId || gap > 1.2 || sentenceEnded) {
      flush();
    }
    current.push(word);
  }
  flush();
  return segments;
};

const buildSpeakers = (segments: DubbingV2Segment[]) => {
  const counts = new Map<string, number>();
  for (const segment of segments) {
    counts.set(segment.speakerId, (counts.get(segment.speakerId) || 0) + 1);
  }
  return Array.from(counts, ([id, segmentCount], index) => ({
    id,
    name: `Speaker ${index + 1}`,
    segmentCount,
  }));
};

export default function DubbingV2Studio({
  initialFile,
  assistantRequestId,
  initialTargetLanguage,
  setHistoryList,
  onAudioPlay,
}: DubbingV2StudioProps) {
  const [sourceFile, setSourceFile] = useState<File | null>(initialFile || null);
  const [sourceFileUrl, setSourceFileUrl] = useState<string | null>(() => (
    initialFile ? URL.createObjectURL(initialFile) : null
  ));
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [targetLanguage, setTargetLanguage] = useState(initialTargetLanguage || 'English');
  const [languageVersions, setLanguageVersions] = useState<DubbingV2LanguageVersion[]>(() => {
    const language = initialTargetLanguage || 'English';
    return [{ id: `language-${language}`, language, label: getTargetLanguageLabel(language), status: 'draft' }];
  });
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('mp3');
  const [cloningStrength, setCloningStrength] = useState(7);
  const [segments, setSegments] = useState<DubbingV2Segment[]>([]);
  const [speakers, setSpeakers] = useState<DubbingV2Speaker[]>([]);
  const [result, setResult] = useState<TranslateDubbingResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSourcePlaying, setIsSourcePlaying] = useState(false);
  const [isResultPlaying, setIsResultPlaying] = useState(false);
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null);
  const resultAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastAssistantRequestIdRef = useRef<string | undefined>(assistantRequestId);

  React.useEffect(() => {
    if (!initialFile || assistantRequestId === lastAssistantRequestIdRef.current) return;
    lastAssistantRequestIdRef.current = assistantRequestId;
    if (sourceFileUrl) URL.revokeObjectURL(sourceFileUrl);
    setSourceFile(initialFile);
    setSourceFileUrl(URL.createObjectURL(initialFile));
    setSegments([]);
    setSpeakers([]);
    setResult(null);
    setError(null);
  }, [assistantRequestId, initialFile, sourceFileUrl]);

  React.useEffect(() => () => {
    if (sourceFileUrl) URL.revokeObjectURL(sourceFileUrl);
  }, [sourceFileUrl]);

  const stage: ProjectStage = result ? 'rendered' : segments.length > 0 ? 'analyzed' : sourceFile ? 'uploaded' : 'empty';
  const sourceIsVideo = Boolean(sourceFile?.type.startsWith('video/')) || /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(sourceFile?.name || '');
  const canRenderMp4 = sourceIsVideo;
  const renderFormat = outputFormat === 'mp4' && !canRenderMp4 ? 'mp3' : outputFormat;
  const totalDuration = useMemo(() => Math.max(0, ...segments.map(segment => segment.end)), [segments]);

  const handleFileChange = (file: File) => {
    if (sourceFileUrl) URL.revokeObjectURL(sourceFileUrl);
    sourceAudioRef.current?.pause();
    resultAudioRef.current?.pause();
    setSourceFile(file);
    setSourceFileUrl(URL.createObjectURL(file));
    setSegments([]);
    setSpeakers([]);
    setResult(null);
    setError(null);
    setIsSourcePlaying(false);
    setIsResultPlaying(false);
  };

  const recalculateSpeakers = (nextSegments: DubbingV2Segment[], previousSpeakers = speakers) => {
    const previousById = new Map<string, DubbingV2Speaker>(previousSpeakers.map(speaker => [speaker.id, speaker]));
    return buildSpeakers(nextSegments).map(speaker => ({
      ...speaker,
      name: previousById.get(speaker.id)?.name || speaker.name,
    }));
  };

  const addLanguageVersion = () => {
    setLanguageVersions(current => {
      if (current.some(version => version.language === targetLanguage)) return current;
      return [
        ...current,
        {
          id: `language-${targetLanguage}-${Date.now()}`,
          language: targetLanguage,
          label: getTargetLanguageLabel(targetLanguage),
          status: 'draft',
        },
      ];
    });
  };

  const selectLanguageVersion = (language: string) => {
    setTargetLanguage(language);
    setResult(null);
  };

  const removeLanguageVersion = (id: string) => {
    setLanguageVersions(current => {
      const next = current.filter(version => version.id !== id);
      if (next.length > 0 && current.find(version => version.id === id)?.language === targetLanguage) {
        setTargetLanguage(next[0].language);
      }
      return next.length > 0 ? next : current;
    });
  };

  const analyzeProject = async () => {
    if (!sourceFile || isAnalyzing) return;
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const transcription = await transcribeSpeech(
        sourceFile,
        sourceLanguage === 'auto' ? undefined : sourceLanguage,
        true,
        { diarize: true },
      );
      const nextSegments = buildTranscriptSegments(transcription);
      const targetLabel = getTargetLanguageLabel(targetLanguage);
      const translatedSegments = await Promise.all(nextSegments.map(async segment => ({
        ...segment,
        targetText: segment.sourceText
          ? await translateTextToLanguage(segment.sourceText, targetLabel, { preserveTone: true }).catch(() => '')
          : '',
      })));
      setSegments(translatedSegments);
      setSpeakers(buildSpeakers(translatedSegments));
      if (translatedSegments.length === 0) {
        setError('没有识别到可编辑台词；仍可直接 Render 让 Dubbing v2 自动处理。');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dubbing v2 项目分析失败');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const renderProject = async () => {
    if (!sourceFile || isRendering) return;
    setIsRendering(true);
    setError(null);
    try {
      const data = await translateDubbingV2Audio(sourceFile, {
        sourceLanguage,
        targetLanguage,
        cloningStrength,
        outputFormat: renderFormat,
      });
      setResult(data);
      setLanguageVersions(current => {
        const found = current.some(version => version.language === targetLanguage);
        const nextVersion: DubbingV2LanguageVersion = {
          id: `language-${targetLanguage}`,
          language: targetLanguage,
          label: getTargetLanguageLabel(targetLanguage),
          status: 'rendered',
          resultUrl: data.audioUrl,
        };
        return found
          ? current.map(version => version.language === targetLanguage ? { ...version, status: 'rendered', resultUrl: data.audioUrl } : version)
          : [...current, nextVersion];
      });
      const title = `Dubbing v2 - ${getTargetLanguageLabel(targetLanguage)}`;
      setHistoryList(previous => [{
        id: `dubbing-v2-${Date.now()}`,
        type: 'voice',
        title,
        prompt: `Dubbing v2 · ${sourceLanguage} → ${getTargetLanguageLabel(targetLanguage)}`,
        url: data.audioUrl,
        timestamp: new Date().toISOString(),
        details: `ElevenLabs Dubbing v2 · ${renderFormat.toUpperCase()} · 相似度 ${cloningStrength}/10`,
        inputText: segments.map(segment => segment.targetText || segment.sourceText).join('\n').slice(0, 2000),
      }, ...previous].slice(0, 30));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dubbing v2 Render 失败');
    } finally {
      setIsRendering(false);
    }
  };

  const updateSegment = (id: string, patch: Partial<DubbingV2Segment>) => {
    setSegments(current => {
      const next = current.map(segment => segment.id === id ? { ...segment, ...patch } : segment);
      if (patch.speakerId) setSpeakers(recalculateSpeakers(next));
      return next;
    });
  };

  const updateSpeakerName = (id: string, name: string) => {
    setSpeakers(current => current.map(speaker => speaker.id === id ? { ...speaker, name } : speaker));
  };

  const addSpeaker = () => {
    const nextIndex = speakers.length + 1;
    const id = `speaker_${nextIndex}`;
    if (speakers.some(speaker => speaker.id === id)) {
      setSpeakers(current => [...current, { id: `speaker_${Date.now()}`, name: `Speaker ${nextIndex}`, segmentCount: 0 }]);
      return;
    }
    setSpeakers(current => [...current, { id, name: `Speaker ${nextIndex}`, segmentCount: 0 }]);
  };

  const removeSpeaker = (id: string) => {
    if (speakers.length <= 1) return;
    const fallback = speakers.find(speaker => speaker.id !== id)?.id || 'speaker_1';
    setSegments(current => {
      const next = current.map(segment => segment.speakerId === id ? { ...segment, speakerId: fallback } : segment);
      setSpeakers(recalculateSpeakers(next, speakers.filter(speaker => speaker.id !== id)));
      return next;
    });
  };

  const addSegment = () => {
    const lastSegment = segments[segments.length - 1];
    const speakerId = speakers[0]?.id || 'speaker_1';
    const start = lastSegment ? Math.max(lastSegment.end, lastSegment.start) + 0.1 : 0;
    const nextSegment: DubbingV2Segment = {
      id: `segment-${Date.now()}`,
      speakerId,
      start,
      end: start + 2,
      sourceText: '',
      targetText: '',
    };
    setSegments(current => {
      const next = [...current, nextSegment];
      setSpeakers(recalculateSpeakers(next));
      return next;
    });
  };

  const deleteSegment = (id: string) => {
    setSegments(current => {
      const next = current.filter(segment => segment.id !== id);
      setSpeakers(recalculateSpeakers(next));
      return next;
    });
  };

  const retranslateTranscript = async () => {
    if (segments.length === 0 || isAnalyzing) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const targetLabel = getTargetLanguageLabel(targetLanguage);
      const translated = await Promise.all(segments.map(async segment => ({
        ...segment,
        targetText: segment.sourceText.trim()
          ? await translateTextToLanguage(segment.sourceText, targetLabel, { preserveTone: true }).catch(() => segment.targetText)
          : segment.targetText,
      })));
      setSegments(translated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重新翻译 Transcript 失败');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const exportTranscript = () => {
    const payload = {
      sourceLanguage,
      targetLanguage,
      targetLanguageLabel: getTargetLanguageLabel(targetLanguage),
      speakers,
      segments,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dubbing-v2-transcript-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const toggleSourcePlay = () => {
    if (!sourceAudioRef.current) return;
    if (isSourcePlaying) {
      sourceAudioRef.current.pause();
      setIsSourcePlaying(false);
    } else {
      resultAudioRef.current?.pause();
      setIsResultPlaying(false);
      onAudioPlay?.();
      void sourceAudioRef.current.play();
      setIsSourcePlaying(true);
    }
  };

  const toggleResultPlay = () => {
    if (!resultAudioRef.current) return;
    if (isResultPlaying) {
      resultAudioRef.current.pause();
      setIsResultPlaying(false);
    } else {
      sourceAudioRef.current?.pause();
      setIsSourcePlaying(false);
      onAudioPlay?.();
      void resultAudioRef.current.play();
      setIsResultPlaying(true);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <section className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[10px] font-black text-emerald-700">
              <Sparkles className="h-3.5 w-3.5" />
              ElevenLabs Dubbing v2
            </p>
            <h2 className="mt-3 text-lg font-black text-slate-900">声音转换（Dubbing v2）专业项目</h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
              面向跨语种声音转换：创建项目、分析台词与说话人、编辑译文草稿，再 Render 输出目标语言配音。后续接入 TokenHub 项目资源接口时，可直接把这里的 Project / Transcript / Speaker / Render 数据映射过去。
            </p>
          </div>
          <div className="grid grid-cols-4 gap-1 rounded-2xl border border-slate-200 bg-white p-1 text-center text-[10px] font-black">
            {(['项目', '语言', 'Transcript', 'Render'] as const).map((label, index) => {
              const active = index === 0 ? stage !== 'empty' : index === 1 ? sourceFile : index === 2 ? segments.length > 0 : result;
              return (
                <span key={label} className={`rounded-xl px-3 py-2 ${active ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <section className="space-y-5 xl:col-span-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-slate-800">1. 创建项目</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-500">
                {sourceFile ? '已载入素材' : '等待上传'}
              </span>
            </div>
            <label
              className="mt-4 flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/80 p-5 text-center transition hover:border-emerald-300 hover:bg-emerald-50/50"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files?.[0];
                if (file) handleFileChange(file);
              }}
            >
              <input
                type="file"
                accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.flac,.mp4,.m4v,.mov,.webm,.mkv,.avi"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleFileChange(file);
                  event.currentTarget.value = '';
                }}
              />
              <UploadCloud className="h-8 w-8 text-slate-400" />
              <p className="mt-3 text-xs font-bold text-slate-700">{sourceFile?.name || '拖拽或点击上传音频 / 视频'}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">支持音频或视频；视频可 Render 为 MP4，音频默认输出 MP3。</p>
            </label>
            {sourceFileUrl && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={toggleSourcePlay}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    aria-label={isSourcePlaying ? '暂停源素材' : '播放源素材'}
                  >
                    {isSourcePlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-slate-800">{sourceFile?.name}</p>
                    <p className="text-[10px] text-slate-400">{sourceFile ? `${(sourceFile.size / 1024 / 1024).toFixed(2)} MB` : ''}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (sourceFileUrl) URL.revokeObjectURL(sourceFileUrl);
                      setSourceFile(null);
                      setSourceFileUrl(null);
                      setSegments([]);
                      setSpeakers([]);
                      setResult(null);
                      setError(null);
                    }}
                    className="p-1.5 text-slate-400 hover:text-rose-500"
                    aria-label="清除源素材"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {sourceFile?.type.startsWith('video/') ? (
                  <video ref={sourceAudioRef as React.RefObject<HTMLVideoElement>} src={sourceFileUrl} className="mt-3 max-h-48 w-full rounded-lg bg-black" controls onPlay={onAudioPlay} />
                ) : (
                  <audio ref={sourceAudioRef} src={sourceFileUrl} onEnded={() => setIsSourcePlaying(false)} className="hidden" />
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-xs font-black text-slate-800">2. 语言与声音参数</h3>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[10px] font-bold text-slate-500">源语言</span>
                <select value={sourceLanguage} onChange={event => setSourceLanguage(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400">
                  {DUBBING_SOURCE_LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-bold text-slate-500">目标语言</span>
                <select value={targetLanguage} onChange={event => setTargetLanguage(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400">
                  {DUBBING_TARGET_LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-black text-slate-600">目标语言版本</span>
                <button
                  type="button"
                  onClick={addLanguageVersion}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2 text-[10px] font-black text-emerald-700 hover:bg-emerald-50"
                >
                  <Plus className="h-3 w-3" />
                  添加当前语言
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {languageVersions.map(version => (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => selectLanguageVersion(version.language)}
                    className={`group inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-black transition ${
                      targetLanguage === version.language
                        ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-emerald-200 hover:text-emerald-700'
                    }`}
                  >
                    <span>{version.label}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[8px] ${version.status === 'rendered' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                      {version.status === 'rendered' ? '已渲染' : '草稿'}
                    </span>
                    {languageVersions.length > 1 ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeLanguageVersion(version.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            removeLanguageVersion(version.id);
                          }
                        }}
                        className="rounded p-0.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                        aria-label={`删除 ${version.label} 版本`}
                      >
                        <X className="h-3 w-3" />
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
            <label className="mt-4 block rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
              <span className="flex items-center justify-between text-[10px] font-bold text-slate-600">
                <span>说话人相似度</span>
                <span className="font-mono text-emerald-700">{cloningStrength}/10</span>
              </span>
              <input type="range" min="0" max="10" step="1" value={cloningStrength} onChange={event => setCloningStrength(Number(event.target.value))} className="mt-2 w-full accent-emerald-600" />
              <span className="mt-1 block text-[9px] text-slate-500">默认 7；越高越贴近原说话人，可能牺牲部分目标语言自然度。</span>
            </label>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(['mp3', 'mp4'] as const).map(format => (
                <button
                  key={format}
                  type="button"
                  disabled={format === 'mp4' && !canRenderMp4}
                  onClick={() => setOutputFormat(format)}
                  className={`flex h-10 items-center justify-center gap-1.5 rounded-xl border text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-45 ${
                    outputFormat === format
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 text-slate-500 hover:border-emerald-200 hover:bg-emerald-50'
                  }`}
                >
                  {format === 'mp4' ? <Video className="h-3.5 w-3.5" /> : <FileAudio className="h-3.5 w-3.5" />}
                  输出 {format.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-xs font-black text-slate-800">3. 项目资源</h3>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="font-bold text-slate-500">Project</p>
                <p className="mt-1 font-mono text-slate-800">{sourceFile ? 'ready' : 'empty'}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="font-bold text-slate-500">Language</p>
                <p className="mt-1 font-mono text-slate-800">{getTargetLanguageLabel(targetLanguage)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="font-bold text-slate-500">Transcript</p>
                <p className="mt-1 font-mono text-slate-800">{segments.length} segments</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="font-bold text-slate-500">Speaker</p>
                <p className="mt-1 font-mono text-slate-800">{speakers.length || '-'} speakers</p>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-5 xl:col-span-7">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-black text-slate-800">4. 分析 Transcript / Speaker</h3>
                <p className="mt-1 text-[10px] text-slate-400">先生成可编辑台词草稿和说话人列表；Render 时当前接入会调用 Dubbing v2 自动项目渲染。</p>
              </div>
              <button
                type="button"
                disabled={!sourceFile || isAnalyzing}
                onClick={analyzeProject}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
                {isAnalyzing ? '正在分析项目…' : segments.length > 0 ? '重新分析' : '分析台词与说话人'}
              </button>
            </div>

            {speakers.length > 0 ? (
              <>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold text-slate-400">{speakers.length} 位 Speaker，可重命名、增删并分配给台词段。</span>
                  <button
                    type="button"
                    onClick={addSpeaker}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] font-black text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    新增 Speaker
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {speakers.map(speaker => (
                    <div key={speaker.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                        <span>{speaker.id}</span>
                        <span>{speaker.segmentCount} 段</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <input value={speaker.name} onChange={event => updateSpeakerName(speaker.id, event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-800 outline-none focus:border-emerald-400" />
                        {speakers.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeSpeaker(speaker.id)}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                            aria-label={`删除 ${speaker.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="mt-4 flex min-h-24 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-[11px] text-slate-400">
                上传素材后点击“分析台词与说话人”。
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-xs font-black text-slate-800">Transcript / 译文编辑</h3>
                {totalDuration > 0 ? <p className="mt-1 text-[10px] font-mono text-slate-400">约 {formatSeconds(totalDuration)}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={addSegment}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] font-black text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  新增台词
                </button>
                <button
                  type="button"
                  onClick={() => void retranslateTranscript()}
                  disabled={segments.length === 0 || isAnalyzing}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] font-black text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  重新翻译
                </button>
                <button
                  type="button"
                  onClick={exportTranscript}
                  disabled={segments.length === 0}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] font-black text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出 JSON
                </button>
              </div>
            </div>
            <div className="max-h-[520px] space-y-3 overflow-y-auto p-5">
              {segments.map((segment, index) => {
                const speakerName = speakers.find(speaker => speaker.id === segment.speakerId)?.name || segment.speakerId;
                return (
                  <div key={segment.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                      <span className="font-black text-emerald-700">{index + 1}. {speakerName}</span>
                      <button
                        type="button"
                        onClick={() => deleteSegment(segment.id)}
                        className="inline-flex h-7 items-center gap-1 rounded-lg px-2 font-bold text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                      >
                        <Trash2 className="h-3 w-3" />
                        删除
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <label className="block">
                        <span className="text-[9px] font-bold text-slate-400">Speaker</span>
                        <select
                          value={segment.speakerId}
                          onChange={event => updateSegment(segment.id, { speakerId: event.target.value })}
                          className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-700 outline-none focus:border-emerald-400"
                        >
                          {speakers.map(speaker => <option key={speaker.id} value={speaker.id}>{speaker.name}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-[9px] font-bold text-slate-400">开始</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={Number(segment.start.toFixed(1))}
                          onChange={event => updateSegment(segment.id, { start: Math.max(0, Number(event.target.value) || 0) })}
                          className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-mono text-slate-700 outline-none focus:border-emerald-400"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[9px] font-bold text-slate-400">结束</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={Number(segment.end.toFixed(1))}
                          onChange={event => updateSegment(segment.id, { end: Math.max(segment.start, Number(event.target.value) || segment.start) })}
                          className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-mono text-slate-700 outline-none focus:border-emerald-400"
                        />
                      </label>
                    </div>
                    <textarea value={segment.sourceText} onChange={event => updateSegment(segment.id, { sourceText: event.target.value })} className="mt-2 min-h-14 w-full rounded-lg border border-slate-200 bg-white p-2 text-[11px] text-slate-700 outline-none focus:border-emerald-400" />
                    <textarea value={segment.targetText} onChange={event => updateSegment(segment.id, { targetText: event.target.value })} placeholder="目标语言译文" className="mt-2 min-h-16 w-full rounded-lg border border-emerald-100 bg-emerald-50/40 p-2 text-[11px] text-slate-800 outline-none focus:border-emerald-400" />
                  </div>
                );
              })}
              {segments.length === 0 ? (
                <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-[11px] text-slate-400">
                  暂无 Transcript。你也可以不分析，直接 Render，让 Dubbing v2 自动完成项目。
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-black text-slate-800">5. Render / 导出</h3>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                  当前 Render 使用已接入的 ElevenLabs Dubbing v2 一键渲染链路；Transcript 编辑会保留在项目草稿中，后续接入项目资源接口后可用于精修渲染。
                </p>
              </div>
              <button
                type="button"
                disabled={!sourceFile || isRendering}
                onClick={renderProject}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-xs font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {isRendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isRendering ? 'Dubbing v2 Render 中…' : `Render ${renderFormat.toUpperCase()}`}
              </button>
            </div>

            {error ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                {error}
              </div>
            ) : null}

            {result ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={toggleResultPlay} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white" aria-label={isResultPlaying ? '暂停生成结果' : '播放生成结果'}>
                    {isResultPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-black text-slate-800">Dubbing v2 · {getTargetLanguageLabel(targetLanguage)}</p>
                    <p className="text-[10px] text-slate-500">
                      {result.sourceDuration ? `源 ${formatSeconds(result.sourceDuration)} · ` : ''}
                      {result.outputDuration ? `输出 ${formatSeconds(result.outputDuration)} · ` : ''}
                      {result.outputFormat?.toUpperCase() || renderFormat.toUpperCase()}
                    </p>
                  </div>
                  <button type="button" onClick={() => void downloadAudioHelper(result.audioUrl, `dubbing-v2-${getTargetLanguageLabel(targetLanguage)}.${result.outputFormat || renderFormat}`)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 text-[10px] font-black text-emerald-700 hover:bg-emerald-50">
                    <Download className="h-3.5 w-3.5" />
                    下载
                  </button>
                </div>
                <audio ref={resultAudioRef} src={result.audioUrl} onEnded={() => setIsResultPlaying(false)} className="hidden" />
                <div className="mt-3 flex items-center gap-1.5 text-[10px] font-bold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  已完成 Render，结果已加入历史音频。
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
