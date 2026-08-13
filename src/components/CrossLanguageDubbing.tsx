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
  Download,
  FileAudio,
  Info,
  Languages,
  Loader2,
  Pause,
  Play,
  Search,
  Sparkles,
  UploadCloud,
  Volume2,
  X,
} from 'lucide-react';
import { HistoryItem } from '../types';
import { VoiceItem } from '../data/voices';
import { translateDubbingAudio, TranslateDubbingResult } from '../services/elevenLabsService';
import { getElevenLabsQualityMode } from '../utils/elevenLabsQuality';
import { downloadAudioHelper } from '../utils/downloadHelper';

interface CrossLanguageDubbingProps {
  displayVoices: VoiceItem[];
  setHistoryList: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
  onAudioPlay?: () => void;
  playingVoiceId: string | null;
  handlePlayVoicePreview: (voiceId: string, url: string, e: React.MouseEvent) => void;
}

interface SimilarVoiceRecommendation {
  voiceId: string;
  score: number;
  reason: string;
}

type SimilarVoiceGenderPreference = 'auto' | 'male' | 'female';
type TranslateDubbingOptionId = 'A' | 'B';

interface PendingTranslateDubbingOption {
  id: TranslateDubbingOptionId;
  data: TranslateDubbingResult;
  displayName: string;
}

const sourceLanguageOptions = [
  { value: 'auto', label: '自动识别' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' },
  { value: 'ja', label: '日文' },
  { value: 'ko', label: '韩文' },
  { value: 'fr', label: '法文' },
  { value: 'de', label: '德文' },
  { value: 'es', label: '西班牙文' },
];

const targetLanguageOptions = [
  { value: 'English', label: '英文' },
  { value: 'Chinese Mandarin', label: '中文' },
  { value: 'Japanese', label: '日文' },
  { value: 'Korean', label: '韩文' },
  { value: 'French', label: '法文' },
  { value: 'German', label: '德文' },
  { value: 'Spanish', label: '西班牙文' },
  { value: 'Portuguese', label: '葡萄牙文' },
  { value: 'Italian', label: '意大利文' },
  { value: 'Russian', label: '俄文' },
  { value: 'Hindi', label: '印地文' },
  { value: 'Indonesian', label: '印尼文' },
  { value: 'Vietnamese', label: '越南文' },
  { value: 'Thai', label: '泰文' },
  { value: 'Arabic', label: '阿拉伯文' },
  { value: 'Turkish', label: '土耳其文' },
  { value: 'Dutch', label: '荷兰文' },
  { value: 'Polish', label: '波兰文' },
  { value: 'Swedish', label: '瑞典文' },
  { value: 'Danish', label: '丹麦文' },
  { value: 'Finnish', label: '芬兰文' },
  { value: 'Norwegian', label: '挪威文' },
  { value: 'Greek', label: '希腊文' },
  { value: 'Czech', label: '捷克文' },
  { value: 'Romanian', label: '罗马尼亚文' },
  { value: 'Hungarian', label: '匈牙利文' },
  { value: 'Ukrainian', label: '乌克兰文' },
  { value: 'Hebrew', label: '希伯来文' },
  { value: 'Malay', label: '马来文' },
  { value: 'Filipino', label: '菲律宾文' },
  { value: 'Bengali', label: '孟加拉文' },
  { value: 'Urdu', label: '乌尔都文' },
  { value: 'Tamil', label: '泰米尔文' },
];

const timingModeOptions = [
  { value: 'natural', label: '自然配音', description: '优先自然表达，时长允许变化' },
  { value: 'match', label: '尽量贴合原时长', description: '轻微变速，适合大多数视频替换' },
  { value: 'strict', label: '严格对齐', description: '更强时长贴合，可能牺牲一点自然度' },
] as const;
export default function CrossLanguageDubbing({
  displayVoices,
  setHistoryList,
  onAudioPlay,
  playingVoiceId,
  handlePlayVoicePreview,
}: CrossLanguageDubbingProps) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceFileUrl, setSourceFileUrl] = useState<string | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [targetLanguage, setTargetLanguage] = useState('English');
  const [timingMode, setTimingMode] = useState<'natural' | 'match' | 'strict'>('match');
  const [voiceId, setVoiceId] = useState('');
  const [voiceSearch, setVoiceSearch] = useState('');
  const [voiceActiveCategory, setVoiceActiveCategory] = useState('全部');
  const [voiceGenderFilter, setVoiceGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isMatchingSimilarVoice, setIsMatchingSimilarVoice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranslateDubbingResult | null>(null);
  const [pendingResultOptions, setPendingResultOptions] = useState<{
    optionA: PendingTranslateDubbingOption | null;
    optionB: PendingTranslateDubbingOption | null;
  }>({ optionA: null, optionB: null });
  const [resultAudioDurations, setResultAudioDurations] = useState<Record<string, number>>({});
  const [playingResultOptionId, setPlayingResultOptionId] = useState<TranslateDubbingOptionId | null>(null);
  const [sourceDuration, setSourceDuration] = useState<number | null>(null);
  const [similarVoiceGenderPreference, setSimilarVoiceGenderPreference] = useState<SimilarVoiceGenderPreference>('auto');
  const [similarVoiceDetectedGender, setSimilarVoiceDetectedGender] = useState<'unknown' | 'male' | 'female'>('unknown');
  const [similarVoiceRecommendations, setSimilarVoiceRecommendations] = useState<SimilarVoiceRecommendation[]>([]);
  const [similarVoiceSourceDescription, setSimilarVoiceSourceDescription] = useState('');
  const [similarVoiceKeywords, setSimilarVoiceKeywords] = useState('');
  const [isSourcePlaying, setIsSourcePlaying] = useState(false);

  const sourceAudioRef = useRef<HTMLAudioElement | null>(null);
  const resultOptionAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleVoicePreviewClick = (previewVoiceId: string, previewUrl: string, event: React.MouseEvent) => {
    sourceAudioRef.current?.pause();
    setIsSourcePlaying(false);
    resultOptionAudioRef.current?.pause();
    setPlayingResultOptionId(null);
    onAudioPlay?.();
    handlePlayVoicePreview(previewVoiceId, previewUrl, event);
  };

  const similarVoiceRecommendationById = useMemo(() => (
    new Map(similarVoiceRecommendations.map(recommendation => [recommendation.voiceId, recommendation]))
  ), [similarVoiceRecommendations]);

  const getVoiceSearchText = (voice: VoiceItem) => [
    voice.name,
    voice.englishName,
    voice.category,
    voice.description,
    ...(Array.isArray(voice.tags) ? voice.tags : []),
  ].map(value => String(value || '').toLowerCase()).join(' ');

  const filteredVoices = useMemo(() => {
    const query = voiceSearch.trim().toLowerCase();
    const categoryFilteredVoices = displayVoices.filter(voice => {
      if (similarVoiceRecommendations.length > 0 && !similarVoiceRecommendationById.has(voice.id)) return false;
      if (voiceActiveCategory !== '全部' && voice.category !== voiceActiveCategory) return false;
      if (voiceGenderFilter !== 'all' && voice.gender !== voiceGenderFilter) return false;
      return true;
    });
    const searchedVoices = !query
      ? categoryFilteredVoices
      : categoryFilteredVoices.filter(voice => getVoiceSearchText(voice).includes(query));
    if (similarVoiceRecommendations.length === 0) return searchedVoices;
    return [...searchedVoices].sort((left, right) => (
      (similarVoiceRecommendationById.get(right.id)?.score || 0)
      - (similarVoiceRecommendationById.get(left.id)?.score || 0)
    ));
  }, [
    displayVoices,
    similarVoiceRecommendationById,
    similarVoiceRecommendations.length,
    voiceActiveCategory,
    voiceGenderFilter,
    voiceSearch,
  ]);

  const selectedVoice = displayVoices.find(voice => voice.id === voiceId);
  const selectedVoiceRecommendation = selectedVoice ? similarVoiceRecommendationById.get(selectedVoice.id) : undefined;
  const voiceCategories = useMemo(() => (
    ['全部', ...Array.from(new Set(displayVoices.map(voice => String(voice.category || '')).filter(Boolean)))]
  ), [displayVoices]);
  const resultOptionList = useMemo(() => ([
    pendingResultOptions.optionA,
    pendingResultOptions.optionB,
  ].filter(Boolean) as PendingTranslateDubbingOption[]), [pendingResultOptions]);

  useEffect(() => {
    if (!voiceId && displayVoices.length > 0) {
      setVoiceId(displayVoices[0].id);
    }
  }, [displayVoices, voiceId]);

  useEffect(() => () => {
    if (sourceFileUrl) URL.revokeObjectURL(sourceFileUrl);
  }, [sourceFileUrl]);

  useEffect(() => {
    if (!sourceFileUrl) {
      setSourceDuration(null);
      return;
    }
    const audio = new Audio(sourceFileUrl);
    audio.onloadedmetadata = () => {
      setSourceDuration(Number.isFinite(audio.duration) ? audio.duration : null);
    };
    audio.onerror = () => setSourceDuration(null);
  }, [sourceFileUrl]);

  useEffect(() => {
    resultOptionList.forEach((option) => {
      const audioUrl = option.data.audioUrl;
      if (!audioUrl || resultAudioDurations[audioUrl]) return;
      const audio = new Audio(audioUrl);
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
        setResultAudioDurations(prev => ({
          ...prev,
          [audioUrl]: audio.duration,
        }));
      };
    });
  }, [resultOptionList, resultAudioDurations]);

  const handleFileChange = (file: File) => {
    if (!file.type.startsWith('audio/') && !/\.(wav|mp3|m4a|aac|ogg|opus|flac|aif|aiff)$/i.test(file.name)) {
      setError('请上传音频文件。');
      return;
    }
    if (sourceFileUrl) URL.revokeObjectURL(sourceFileUrl);
    setSourceFile(file);
    setSourceFileUrl(URL.createObjectURL(file));
    setResult(null);
    setPendingResultOptions({ optionA: null, optionB: null });
    setPlayingResultOptionId(null);
    setError(null);
    setSimilarVoiceRecommendations([]);
    setSimilarVoiceSourceDescription('');
    setSimilarVoiceDetectedGender('unknown');
    setIsSourcePlaying(false);
  };

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

  const uploadSourceAudioForMatching = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/sfx/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(data.error || '上传参考音频失败，无法匹配相近声音。'));
    }
    if (!data.url) {
      throw new Error('上传参考音频后没有返回可用地址。');
    }
    return String(data.url);
  };

  const requestSimilarVoiceRecommendations = async (referenceAudioUrl: string) => {
    const response = await fetch('/api/video/match-similar-voices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioUrl: referenceAudioUrl,
        voices: displayVoices,
        preferredGender: similarVoiceGenderPreference === 'auto' ? undefined : similarVoiceGenderPreference,
        matchingKeywords: similarVoiceKeywords.trim() || undefined,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(data.error || '匹配相近声音失败，请稍后重试。'));
    }
    const recommendations: SimilarVoiceRecommendation[] = Array.isArray(data.recommendations)
      ? data.recommendations
        .map((item: any) => ({
          voiceId: String(item?.voiceId || ''),
          score: Math.max(0, Math.min(100, Number.isFinite(Number(item?.score)) ? Number(item.score) : 0)),
          reason: String(item?.reason || '音色、语气和用途接近。'),
        }))
        .filter((item: SimilarVoiceRecommendation) => (
          item.voiceId && item.score > 0 && displayVoices.some(voice => voice.id === item.voiceId)
        ))
      : [];
    if (recommendations.length === 0) {
      throw new Error('没有在当前声音库中找到相近声音，请刷新 ElevenLabs 声音库后再试。');
    }
    return {
      recommendations,
      sourceDescription: String(data.sourceDescription || '已根据原始配音音色匹配相近声音。'),
      detectedGender: data.gender === 'male' || data.gender === 'female' ? data.gender : 'unknown',
    };
  };

  const handleMatchSimilarVoice = async () => {
    if (!sourceFile) {
      setError('请先上传一段原始配音音频，再匹配相近声音。');
      return;
    }
    if (displayVoices.length === 0) {
      setError('当前配音声音库为空，请先同步或刷新 ElevenLabs 声音库。');
      return;
    }

    sourceAudioRef.current?.pause();
    resultOptionAudioRef.current?.pause();
    setPlayingResultOptionId(null);
    setIsSourcePlaying(false);
    onAudioPlay?.();

    setIsMatchingSimilarVoice(true);
    setError(null);
    try {
      if (!sourceFileUrl) {
        throw new Error('源音频还没有准备好，请重新上传后再匹配。');
      }
      const referenceAudioUrl = await uploadSourceAudioForMatching(sourceFile);
      const { recommendations, sourceDescription, detectedGender } = await requestSimilarVoiceRecommendations(referenceAudioUrl);
      const bestVoiceId = recommendations[0]?.voiceId;
      setSimilarVoiceRecommendations(recommendations);
      setSimilarVoiceSourceDescription(sourceDescription);
      setSimilarVoiceDetectedGender(detectedGender);
      setVoiceSearch('');
      setVoiceActiveCategory('全部');
      setVoiceGenderFilter('all');
      if (bestVoiceId) setVoiceId(bestVoiceId);
      setShowVoiceDropdown(true);
    } catch (err: any) {
      setError(err.message || '匹配相近声音失败，请稍后重试。');
    } finally {
      setIsMatchingSimilarVoice(false);
    }
  };

  const handleGenerate = async () => {
    if (!sourceFile) {
      setError('请先上传一段原始配音音频。');
      return;
    }
    if (!voiceId) {
      setError('请先选择目标语言使用的配音声音。');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const requestOptions = {
        sourceLanguage,
        targetLanguage,
        voiceId,
        timingMode,
        qualityMode: getElevenLabsQualityMode(),
      };
      const [dataA, dataB] = await Promise.all([
        translateDubbingAudio(sourceFile, requestOptions),
        translateDubbingAudio(sourceFile, requestOptions),
      ]);
      const voiceLabel = selectedVoice?.name || '目标声音';
      const targetLabel = targetLanguageOptions.find(item => item.value === targetLanguage)?.label || targetLanguage;
      const optionA: PendingTranslateDubbingOption = {
        id: 'A',
        data: dataA,
        displayName: `跨语种转换 - ${targetLabel} - ${voiceLabel}（版本 A）`,
      };
      const optionB: PendingTranslateDubbingOption = {
        id: 'B',
        data: dataB,
        displayName: `跨语种转换 - ${targetLabel} - ${voiceLabel}（版本 B）`,
      };
      setResult(dataA);
      setPendingResultOptions({ optionA, optionB });
      addTranslateResultToHistory(optionA);
      addTranslateResultToHistory(optionB);

      setTimeout(() => {
        playResultOption('A', dataA.audioUrl);
      }, 150);
    } catch (err: any) {
      setError(err.message || '跨语种转换生成失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  const addTranslateResultToHistory = (option: PendingTranslateDubbingOption) => {
    const targetLabel = targetLanguageOptions.find(item => item.value === targetLanguage)?.label || targetLanguage;
    const newHistoryItem: HistoryItem = {
      id: `translate-dubbing-${option.id}-${Date.now()}`,
      type: 'voice',
      title: option.displayName,
      prompt: option.data.translatedText,
      url: option.data.audioUrl,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
      details: `${targetLabel} · ${timingModeOptions.find(item => item.value === option.data.timingMode)?.label || '时长贴合'}`,
    };
    setHistoryList(prev => [newHistoryItem, ...prev]);
  };

  const playResultOption = (optionId: TranslateDubbingOptionId, audioUrl: string) => {
    sourceAudioRef.current?.pause();
    setIsSourcePlaying(false);
    onAudioPlay?.();
    if (!resultOptionAudioRef.current) resultOptionAudioRef.current = new Audio();
    if (playingResultOptionId === optionId) {
      resultOptionAudioRef.current.pause();
      setPlayingResultOptionId(null);
      return;
    }
    resultOptionAudioRef.current.src = audioUrl;
    resultOptionAudioRef.current.play()
      .then(() => setPlayingResultOptionId(optionId))
      .catch(console.error);
    resultOptionAudioRef.current.onended = () => setPlayingResultOptionId(null);
  };

  const formatDuration = (duration?: number | null) => {
    if (!duration || !Number.isFinite(duration)) return '--:--';
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

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
  ) => (
    <div className="relative flex h-12 items-center overflow-hidden rounded-lg border border-slate-200 bg-white/90 px-2 py-1.5 shadow-inner">
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
                className={`w-[2px] rounded-t-full transition-all ${
                  isPlaying
                    ? accentClassName
                    : isTransient
                      ? 'bg-slate-500/70'
                      : 'bg-slate-400/55'
                }`}
                style={{ height: `${topHeight}%` }}
              />
              <span
                className={`w-[2px] rounded-b-full transition-all ${
                  isPlaying
                    ? accentClassName
                    : isTransient
                      ? 'bg-slate-500/60'
                      : 'bg-slate-400/45'
                }`}
                style={{ height: `${bottomHeight}%` }}
              />
            </span>
          );
        })}
      </div>
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
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      <div className="xl:col-span-7 space-y-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-black text-slate-850 flex items-center gap-2">
                <Languages className="w-4 h-4 text-emerald-600" />
                跨语种转换
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                上传原始配音，自动识别台词并翻译成目标语言，再用选定声音生成接近原语气、语速和长度的新配音。
              </p>
            </div>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">
              Pro 模式会自动跟随设置
            </span>
          </div>

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
              accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.flac,.aif,.aiff"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFileChange(file);
                event.currentTarget.value = '';
              }}
            />
            <UploadCloud className="w-8 h-8 text-slate-400 transition-colors group-hover:text-emerald-600" />
            <p className="mt-3 text-xs font-bold text-slate-700">
              {sourceFile ? sourceFile.name : '上传中文/任意语种配音音频'}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">支持拖拽上传，建议使用干净人声或已经分离出来的配音。</p>
          </label>

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
                <p className="truncate text-xs font-bold text-slate-750">{sourceFile?.name}</p>
                <p className="text-[10px] text-slate-400">{sourceFile ? `${(sourceFile.size / 1024 / 1024).toFixed(2)} MB` : '源音频'}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (sourceFileUrl) URL.revokeObjectURL(sourceFileUrl);
                  setSourceFile(null);
                  setSourceFileUrl(null);
                  setResult(null);
                  setSimilarVoiceRecommendations([]);
                  setSimilarVoiceSourceDescription('');
                  setSimilarVoiceDetectedGender('unknown');
                }}
                className="p-1.5 text-slate-400 hover:text-rose-500"
              >
                <X className="w-4 h-4" />
              </button>
              <audio
                ref={sourceAudioRef}
                src={sourceFileUrl}
                onEnded={() => setIsSourcePlaying(false)}
                onPause={() => setIsSourcePlaying(false)}
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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

            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">时长策略</span>
              <select
                value={timingMode}
                onChange={(event) => setTimingMode(event.target.value as 'natural' | 'match' | 'strict')}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {timingModeOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3.5 space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black text-emerald-900">匹配相近声音</p>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  根据上传的原始配音分析音色、性别倾向、年龄感、语气和能量，从当前配音声音库里推荐相近声音。
                </p>
              </div>
              <Sparkles className="w-4 h-4 shrink-0 text-emerald-600" />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-bold text-slate-500">参考性别</span>
              {[
                { value: 'auto', label: '自动' },
                { value: 'male', label: '男声' },
                { value: 'female', label: '女声' },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setSimilarVoiceGenderPreference(option.value as SimilarVoiceGenderPreference);
                    setSimilarVoiceRecommendations([]);
                    setSimilarVoiceSourceDescription('');
                    setSimilarVoiceDetectedGender('unknown');
                  }}
                  aria-pressed={similarVoiceGenderPreference === option.value}
                  className={`rounded-lg px-2.5 py-1 text-[10px] font-black transition-colors ${
                    similarVoiceGenderPreference === option.value
                      ? option.value === 'male'
                        ? 'bg-blue-600 text-white'
                        : option.value === 'female'
                          ? 'bg-pink-600 text-white'
                          : 'bg-emerald-600 text-white'
                      : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <label className="relative">
                <span className="sr-only">匹配关键词（可选）</span>
                <input
                  type="text"
                  value={similarVoiceKeywords}
                  onChange={(event) => {
                    setSimilarVoiceKeywords(event.target.value);
                    setSimilarVoiceRecommendations([]);
                    setSimilarVoiceSourceDescription('');
                    setSimilarVoiceDetectedGender('unknown');
                  }}
                  maxLength={80}
                  placeholder="关键词可选：甜美、年轻、磁性、广告旁白"
                  className="h-9 w-full rounded-xl border border-emerald-100 bg-white px-3 text-[11px] font-semibold text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleMatchSimilarVoice()}
                disabled={!sourceFile || displayVoices.length === 0 || isMatchingSimilarVoice || loading}
                className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 text-[11px] font-black text-emerald-700 shadow-sm transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isMatchingSimilarVoice ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span className="whitespace-nowrap">{isMatchingSimilarVoice ? '正在匹配...' : '匹配相近声音'}</span>
              </button>
            </div>
            {similarVoiceRecommendations.length > 0 && (
              <div className="rounded-xl border border-emerald-200 bg-white/70 p-2.5 text-[10px] leading-relaxed text-emerald-900">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">
                    已匹配到 {similarVoiceRecommendations.length} 个相近声音
                    {similarVoiceDetectedGender !== 'unknown'
                      ? `（按${similarVoiceDetectedGender === 'male' ? '男声' : '女声'}匹配）`
                      : ''}
                    ，已自动选中第一推荐。
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSimilarVoiceRecommendations([]);
                      setSimilarVoiceSourceDescription('');
                    }}
                    className="shrink-0 rounded-lg border border-emerald-200 px-2 py-1 text-[9px] font-bold text-emerald-700 hover:bg-emerald-50"
                  >
                    清除
                  </button>
                </div>
                {similarVoiceSourceDescription && (
                  <p className="mt-1 text-emerald-800/70">{similarVoiceSourceDescription}</p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3 relative">
            <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>配音声音</span>
              </span>
              <span className="text-[10px] text-slate-450 font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">ElevenLabs 声音库</span>
            </label>

            <button
              type="button"
              onClick={() => setShowVoiceDropdown(!showVoiceDropdown)}
              className="w-full bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-xl py-3 px-4 text-xs text-left text-slate-800 focus:outline-none transition-all flex items-center justify-between cursor-pointer shadow-sm"
            >
              {selectedVoice ? (
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${selectedVoice.gender === 'male' ? 'bg-blue-500' : 'bg-pink-500'}`} />
                  <div className="min-w-0">
                    <span className="font-bold text-slate-850 truncate block">已选：{selectedVoice.name}</span>
                    <span className="text-[10px] text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded font-bold">
                      {selectedVoice.category}
                    </span>
                  </div>
                </div>
              ) : (
                <span className="text-slate-400">请选择配音声音库里的声音...</span>
              )}
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${showVoiceDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showVoiceDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={voiceSearch}
                    onChange={(event) => setVoiceSearch(event.target.value)}
                    placeholder="搜索声音名称、分类、标签或音色特点..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-8 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all placeholder-slate-400"
                  />
                  {voiceSearch && (
                    <button
                      type="button"
                      onClick={() => setVoiceSearch('')}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-2">
                  <span className="text-[9px] font-bold text-slate-400 uppercase mr-1">分类:</span>
                  {voiceCategories.map(category => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setVoiceActiveCategory(category)}
                      className={`text-[9px] px-2.5 py-0.5 rounded font-bold transition-all ${
                        voiceActiveCategory === category
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                      }`}
                    >
                      {category}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
                  <span className="text-[9px] font-bold text-slate-400 uppercase mr-1">性别:</span>
                  {[
                    { value: 'all', label: '全部', activeClassName: 'bg-emerald-600 text-white' },
                    { value: 'male', label: '男声', activeClassName: 'bg-blue-600 text-white' },
                    { value: 'female', label: '女声', activeClassName: 'bg-pink-600 text-white' },
                  ].map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setVoiceGenderFilter(option.value as 'all' | 'male' | 'female')}
                      className={`text-[9px] px-2.5 py-0.5 rounded font-bold transition-all ${
                        voiceGenderFilter === option.value
                          ? option.activeClassName
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="max-h-72 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                  {displayVoices.length === 0 ? (
                    <div className="py-12 px-4 text-center flex flex-col items-center justify-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 border border-amber-100">
                        <Info className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-slate-700">配音声音库为空</p>
                        <p className="text-[11px] text-slate-500 max-w-xs leading-relaxed">
                          请检查 ElevenLabs 服务状态，或先同步/添加可用声线。
                        </p>
                      </div>
                    </div>
                  ) : filteredVoices.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      未找到匹配的声音，请换一个搜索词或筛选条件。
                    </div>
                  ) : filteredVoices.map(voice => {
                    const isSelected = voiceId === voice.id;
                    const similarRecommendation = similarVoiceRecommendationById.get(voice.id);
                    return (
                      <div
                        key={voice.id}
                        onClick={() => {
                          setVoiceId(voice.id);
                          setShowVoiceDropdown(false);
                        }}
                        className={`w-full py-2 px-2.5 rounded-xl flex items-start justify-between gap-3 cursor-pointer transition-colors text-left ${
                          isSelected ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center flex-wrap gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${voice.gender === 'male' ? 'bg-blue-500' : 'bg-pink-500'}`} />
                            <span className="text-xs font-bold text-slate-850">{voice.name}</span>
                            <span className="text-[9px] text-slate-400 bg-slate-50 px-1 py-0.2 rounded border border-slate-100 font-mono">
                              {voice.category}
                            </span>
                            {similarRecommendation && (
                              <span className="text-[9px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded-full">
                                {Math.round(similarRecommendation.score)}%
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 truncate leading-normal">{voice.description}</p>
                          {similarRecommendation && (
                            <p className="text-[9px] text-emerald-700 leading-snug line-clamp-2">
                              {similarRecommendation.reason}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-1">
                            {(Array.isArray(voice.tags) ? voice.tags : []).slice(0, 3).map((tag, index) => (
                              <span key={index} className="text-[9px] text-emerald-700 bg-emerald-50 px-1 rounded-sm">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1 mt-1">
                          <button
                            type="button"
                            onClick={(event) => handleVoicePreviewClick(voice.id, voice.previewUrl || '', event)}
                            aria-label={`试听 ${voice.name}`}
                            title="试听"
                            className={`w-5.5 h-5.5 rounded-full flex items-center justify-center border transition-colors ${
                              playingVoiceId === voice.id
                                ? 'bg-emerald-600 border-emerald-500 text-white'
                                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            {playingVoiceId === voice.id ? (
                              <Pause className="w-2.5 h-2.5 fill-current" />
                            ) : (
                              <Play className="w-2.5 h-2.5 fill-current ml-0.2" />
                            )}
                          </button>

                          <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                            isSelected ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-200 bg-white'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                  <span>这里使用和文本转语音一致的配音声音库。</span>
                  <span className="text-emerald-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> 已同步
                  </span>
              </div>
              </div>
            )}

            {selectedVoice && (
              <div className="bg-gradient-to-br from-emerald-50/50 to-teal-50/30 border border-emerald-500/20 rounded-2xl p-4 space-y-2.5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-black text-emerald-950">{selectedVoice.name}</span>
                      <span className="text-[9px] text-slate-500 bg-slate-100 border border-slate-200 px-1.5 rounded-full font-semibold">
                        {selectedVoice.category}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                        selectedVoice.gender === 'male'
                          ? 'bg-blue-50 text-blue-700 border border-blue-100'
                          : 'bg-pink-50 text-pink-700 border border-pink-100'
                      }`}>
                        {selectedVoice.gender === 'male' ? '男声 (Male)' : '女声 (Female)'}
                      </span>
                      {selectedVoiceRecommendation && (
                        <span className="text-[9px] font-black px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                          相似度 {Math.round(selectedVoiceRecommendation.score)}%
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">{selectedVoice.description}</p>
                    {selectedVoiceRecommendation && (
                      <p className="mt-1.5 rounded-lg bg-white/70 px-2 py-1.5 text-[10px] leading-relaxed text-emerald-800">
                        {selectedVoiceRecommendation.reason}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={(event) => handleVoicePreviewClick(selectedVoice.id, selectedVoice.previewUrl || '', event)}
                    aria-label={`试听 ${selectedVoice.name}`}
                    title="试听"
                    className={`w-8 h-8 rounded-full flex items-center justify-center border shrink-0 transition-all ${
                      playingVoiceId === selectedVoice.id
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-md animate-pulse'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-150 shadow-sm'
                    }`}
                  >
                    {playingVoiceId === selectedVoice.id ? (
                      <Pause className="w-3.5 h-3.5 fill-current" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap gap-1 pt-1.5 border-t border-emerald-500/10">
                  {selectedVoice.tags.map((tag, index) => (
                    <span
                      key={index}
                      className="text-[9px] font-semibold text-emerald-800 bg-emerald-100/50 px-2 py-0.5 rounded-full"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>


          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || !sourceFile || !voiceId}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3.5 text-xs font-black uppercase tracking-wider text-white shadow-md shadow-emerald-600/10 transition-all hover:from-emerald-700 hover:to-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                正在识别、翻译并生成目标语音...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                生成跨语种转换
              </>
            )}
          </button>
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
              <p className="mt-3 text-xs font-bold text-slate-500">生成后会在这里显示原文、译文和音频。</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3.5 text-[11px] text-emerald-800">
                已生成目标语音
                {typeof result.sourceDuration === 'number' && typeof result.outputDuration === 'number'
                  ? ` · 原音频 ${result.sourceDuration.toFixed(1)}s / 输出 ${result.outputDuration.toFixed(1)}s`
                  : ''}
              </div>

              {sourceFileUrl && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <div className="flex items-center gap-3">
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
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-black text-slate-800">原始上传音频</p>
                        <span className="shrink-0 text-[10px] font-mono font-bold text-slate-400">{formatDuration(sourceDuration)}</span>
                      </div>
                      <p className="truncate text-[10px] text-slate-500">{sourceFile?.name || '源音频'}</p>
                    </div>
                  </div>
                  {renderDetailedWaveform('source', isSourcePlaying, 'bg-slate-800')}
                </div>
              )}

              {resultOptionList.map(option => {
                const isPlayingThisOption = playingResultOptionId === option.id;
                const optionDuration = option.data.outputDuration
                  ?? option.data.generatedDuration
                  ?? resultAudioDurations[option.data.audioUrl]
                  ?? null;
                return (
                  <div key={option.id} className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 space-y-3">
                    <div className="flex items-center gap-3">
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
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black text-white ${option.id === 'A' ? 'bg-emerald-600' : 'bg-teal-600'}`}>版本 {option.id}</span>
                          <input
                            type="text"
                            value={option.displayName}
                            onChange={(event) => updateResultOptionName(option.id, event.target.value)}
                            className="min-w-0 flex-1 rounded-md border border-transparent bg-white/80 px-2 py-1 text-xs font-bold text-slate-800 outline-none transition-all hover:border-slate-200 focus:border-emerald-400 focus:bg-white focus:ring-1 focus:ring-emerald-200"
                            aria-label={`版本 ${option.id} 配音名称`}
                          />
                          <span className="shrink-0 text-[10px] font-mono font-bold text-slate-500">{formatDuration(optionDuration)}</span>
                        </div>
                        <p className="mt-1 truncate text-[10px] text-slate-500">{selectedVoice?.name || '目标声音'} · {targetLanguage}</p>
                      </div>
                    </div>

                    {renderDetailedWaveform(
                      option.id,
                      isPlayingThisOption,
                      option.id === 'A' ? 'bg-emerald-500' : 'bg-teal-500',
                    )}

                    <button
                      type="button"
                      onClick={() => downloadAudioHelper(option.data.audioUrl, `${sanitizeDownloadName(option.displayName)}.mp3`)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-[10px] font-bold text-slate-700 shadow-sm transition-all hover:bg-emerald-50 hover:text-emerald-700"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>下载 MP3 配音（版本 {option.id}）</span>
                    </button>
                  </div>
                );
              })}

              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">识别原文</p>
                  <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 custom-scrollbar">
                    {result.sourceText}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">目标译文</p>
                  <div className="max-h-32 overflow-y-auto rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-xs leading-relaxed text-slate-800 custom-scrollbar">
                    {result.translatedText}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-[11px] leading-relaxed text-slate-500 shadow-sm">
          <p className="font-bold text-slate-700 mb-1">使用建议</p>
          <p>广告、短视频口型替换建议用“尽量贴合原时长”；如果是独立配音文件，优先用“自然配音”，声音会更像真人。</p>
        </div>
      </div>
    </div>
  );
}

