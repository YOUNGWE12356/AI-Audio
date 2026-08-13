/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  Music,
  Loader2,
  Play,
  Pause,
  Download,
  FileAudio,
  X,
  AlertCircle,
  Sparkles,
  Languages,
} from 'lucide-react';
import { HistoryItem } from '../types';
import { generateLyricsFromMusicStyle, translateToEnglish } from '../services/geminiService';
import type { PendingMusicOption } from '../App';

const formatMusicTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
};

const createWaveformBars = (seed: string, count = 128) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  return Array.from({ length: count }, (_, index) => {
    const phrase = Math.sin((index + 1) * 0.18 + (hash % 23)) * 0.24;
    const transient = Math.sin((index + 1) * 0.73 + (hash % 41)) * 0.28;
    const groove = Math.sin((index + 1) * 0.07 + (hash % 11)) * 0.18;
    const randomish = (((hash + index * 2654435761) >>> 0) % 100) / 100;
    return Math.max(12, Math.min(98, Math.round((0.46 + phrase + transient + groove + randomish * 0.34) * 100)));
  });
};

const createMusicFileName = (option: PendingMusicOption) => {
  const cleanTitle = (option.title || `generated_music_${option.id}`)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

  return `${cleanTitle || `generated_music_${option.id}`}.mp3`;
};

interface MusicWaveformPlayerProps {
  option: PendingMusicOption;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  onClear?: () => void;
}

function MusicWaveformPlayer({ option, activeId, setActiveId, onClear }: MusicWaveformPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(option.duration || 0);
  const [dragFile, setDragFile] = useState<File | null>(null);
  const fallbackBars = useMemo(
    () => createWaveformBars(`${option.id}-${option.prompt}-${option.url}`),
    [option.id, option.prompt, option.url],
  );
  const [bars, setBars] = useState(fallbackBars);
  const isPlaying = activeId === option.id;
  const safeDuration = duration || option.duration || 0;
  const progress = safeDuration > 0 ? Math.min(1, currentTime / safeDuration) : 0;
  const fileName = useMemo(() => createMusicFileName(option), [option]);

  React.useEffect(() => {
    let cancelled = false;
    setBars(fallbackBars);

    const decodeRealWaveform = async () => {
      try {
        const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextCtor) return;

        const response = await fetch(option.url);
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new AudioContextCtor();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        const targetBarCount = 128;
        const samplesPerBar = Math.max(1, Math.floor(audioBuffer.length / targetBarCount));
        const peaks = Array.from({ length: targetBarCount }, (_, barIndex) => {
          const start = barIndex * samplesPerBar;
          const end = Math.min(audioBuffer.length, start + samplesPerBar);
          let peak = 0;

          for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
            const channel = audioBuffer.getChannelData(channelIndex);
            for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
              const value = Math.abs(channel[sampleIndex] || 0);
              if (value > peak) peak = value;
            }
          }

          return peak;
        });

        const maxPeak = Math.max(...peaks, 0.01);
        const normalizedBars = peaks.map(peak => Math.max(8, Math.min(100, Math.round((peak / maxPeak) * 100))));
        await audioContext.close?.();

        if (!cancelled) {
          setBars(normalizedBars);
        }
      } catch {
        // Blob 解码失败时保留 fallbackBars，播放器和定位功能不受影响。
      }
    };

    decodeRealWaveform();

    return () => {
      cancelled = true;
    };
  }, [fallbackBars, option.url]);

  React.useEffect(() => {
    let cancelled = false;

    const prepareDragFile = async () => {
      try {
        const response = await fetch(option.url);
        const blob = await response.blob();
        if (!cancelled) {
          setDragFile(new File([blob], fileName, { type: blob.type || 'audio/mpeg' }));
        }
      } catch {
        if (!cancelled) {
          setDragFile(null);
        }
      }
    };

    prepareDragFile();

    return () => {
      cancelled = true;
    };
  }, [fileName, option.url]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setActiveId(null);
      return;
    }

    window.dispatchEvent(new CustomEvent('music-waveform-stop-others', { detail: option.id }));
    audio.play().then(() => setActiveId(option.id)).catch(err => console.error(err));
  };

  const seekByPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const nextTime = ratio * (audio.duration || safeDuration || 0);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);

    if (!isPlaying) {
      window.dispatchEvent(new CustomEvent('music-waveform-stop-others', { detail: option.id }));
      audio.play().then(() => setActiveId(option.id)).catch(err => console.error(err));
    }
  };

  React.useEffect(() => {
    const stopOtherPlayers = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail !== option.id) {
        audioRef.current?.pause();
      }
    };

    window.addEventListener('music-waveform-stop-others', stopOtherPlayers);
    return () => window.removeEventListener('music-waveform-stop-others', stopOtherPlayers);
  }, [option.id]);

  const handleExportDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    const transfer = event.dataTransfer;
    transfer.effectAllowed = 'copy';
    transfer.dropEffect = 'copy';

    transfer.setData('DownloadURL', `audio/mpeg:${fileName}:${option.url}`);
    transfer.setData('text/uri-list', option.url);
    transfer.setData('text/plain', `${fileName}\n${option.url}`);

    if (dragFile) {
      try {
        transfer.items.add(dragFile);
      } catch {
        // Some browsers/targets reject file items during drag; DownloadURL/URL data still remain.
      }
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3 shadow-sm">
      <audio
        ref={audioRef}
        src={option.url}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || option.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onPlay={() => setActiveId(option.id)}
        onPause={() => {
          if (activeId === option.id) setActiveId(null);
        }}
        onEnded={() => {
          setActiveId(null);
          setCurrentTime(0);
        }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black text-slate-800">
            版本 {option.id} · AI 独立音乐作品
          </p>
          <p className="mt-0.5 truncate text-[10px] italic text-slate-500">"{option.prompt}"</p>
          <p className="mt-1 text-[9px] font-bold text-emerald-600">
            {formatMusicTime(currentTime)} / {formatMusicTime(safeDuration)} · {option.type === 'instrumental' ? '纯伴奏' : '歌词人声'}
          </p>
        </div>
        {onClear && (
          <button type="button" onClick={onClear} className="p-1 text-slate-400 hover:text-red-500" title="移除">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all ${
            isPlaying
              ? 'border-emerald-500 bg-emerald-600 text-white shadow-sm shadow-emerald-500/20'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
        </button>

        <div
          role="slider"
          aria-label={`版本 ${option.id} 音乐波形进度`}
          aria-valuemin={0}
          aria-valuemax={Math.max(1, Math.round(safeDuration))}
          aria-valuenow={Math.round(currentTime)}
          onPointerDown={seekByPointer}
          className="relative h-24 flex-1 cursor-pointer overflow-hidden rounded-xl border border-slate-700 bg-slate-950 px-2 py-2 shadow-inner"
        >
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.1)_1px,transparent_1px)] bg-[size:16px_100%,100%_25%]" />
          <div className="absolute inset-y-4 left-2 right-2 flex items-center gap-px">
            {bars.map((height, index) => {
              const barProgress = index / Math.max(1, bars.length - 1);
              const active = barProgress <= progress;
              return (
                <span
                  key={index}
                  className={`flex-1 rounded-sm transition-colors ${active ? 'bg-emerald-300' : 'bg-slate-500'}`}
                  style={{ height: `${height}%` }}
                />
              );
            })}
          </div>
          <div
            className="absolute bottom-1 top-1 w-[2px] rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.95)]"
            style={{ left: `calc(${progress * 100}% - 1px)` }}
          />
          <div className="pointer-events-none absolute inset-x-2 top-1 flex justify-between text-[8px] font-mono text-slate-400">
            <span>{formatMusicTime(0)}</span>
            <span>{formatMusicTime(safeDuration)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr]">
        <a
          href={option.url}
          download={fileName}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-center text-[10px] font-bold text-slate-700 shadow-sm transition-all hover:bg-emerald-50 hover:text-emerald-700"
        >
          <Download className="h-3.5 w-3.5" />
          <span>下载 MP3（版本 {option.id}）</span>
        </a>

        <div
          draggable
          onDragStart={handleExportDragStart}
          title="拖到桌面、文件夹或支持浏览器拖拽导入的 DAW 轨道"
          className="flex w-full cursor-grab select-none items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 py-2 text-center text-[10px] font-bold text-emerald-700 shadow-sm transition-all hover:bg-emerald-100 active:cursor-grabbing"
        >
          <FileAudio className="h-3.5 w-3.5" />
          <span>{dragFile ? '拖到桌面 / Cubase' : '准备拖拽文件...'}</span>
        </div>
      </div>
    </div>
  );
}

interface MusicStudioProps {
  standaloneMusicPrompt: string;
  setStandaloneMusicPrompt: (prompt: string) => void;
  standaloneMusicDuration: number;
  setStandaloneMusicDuration: (dur: number) => void;
  standaloneMusicType: 'instrumental' | 'vocal';
  setStandaloneMusicType: (type: 'instrumental' | 'vocal') => void;
  standaloneMusicLyrics: string;
  setStandaloneMusicLyrics: (lyrics: string) => void;
  standaloneMusicLoading: boolean;
  standaloneMusicAudioUrl: string | null;
  setStandaloneMusicAudioUrl: (url: string | null) => void;
  pendingMusicOptions: {
    optionA: PendingMusicOption | null;
    optionB: PendingMusicOption | null;
  };
  setPendingMusicOptions: React.Dispatch<React.SetStateAction<{
    optionA: PendingMusicOption | null;
    optionB: PendingMusicOption | null;
  }>>;
  standaloneMusicError: string | null;
  standaloneMusicAudioRef: React.RefObject<HTMLAudioElement | null>;
  handleStandaloneMusicGenerate: () => void;
  historyList: HistoryItem[];
}

export default function MusicStudio({
  standaloneMusicPrompt,
  setStandaloneMusicPrompt,
  standaloneMusicDuration,
  setStandaloneMusicDuration,
  standaloneMusicType,
  setStandaloneMusicType,
  standaloneMusicLyrics,
  setStandaloneMusicLyrics,
  standaloneMusicLoading,
  standaloneMusicAudioUrl,
  setStandaloneMusicAudioUrl,
  pendingMusicOptions,
  setPendingMusicOptions,
  standaloneMusicError,
  standaloneMusicAudioRef,
  handleStandaloneMusicGenerate,
  historyList,
}: MusicStudioProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingHistoryId, setPlayingHistoryId] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isGeneratingLyrics, setIsGeneratingLyrics] = useState(false);
  const [lyricsGenerationError, setLyricsGenerationError] = useState<string | null>(null);
  const [activeMusicOptionId, setActiveMusicOptionId] = useState<string | null>(null);
  const historyAudioRefs = useRef<{ [key: string]: HTMLAudioElement | null }>({});
  const musicOptions = [pendingMusicOptions.optionA, pendingMusicOptions.optionB].filter(Boolean) as PendingMusicOption[];

  const handleTranslate = async () => {
    if (!standaloneMusicPrompt.trim()) return;
    setIsTranslating(true);
    try {
      const translated = await translateToEnglish(standaloneMusicPrompt);
      if (translated) {
        setStandaloneMusicPrompt(translated);
      }
    } catch (err) {
      console.error('Translation error:', err);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleGenerateLyrics = async () => {
    if (!standaloneMusicPrompt.trim()) return;
    setIsGeneratingLyrics(true);
    setLyricsGenerationError(null);
    try {
      const generatedLyrics = await generateLyricsFromMusicStyle(standaloneMusicPrompt);
      if (generatedLyrics.trim()) {
        setStandaloneMusicLyrics(generatedLyrics.trim());
      }
    } catch (err) {
      console.error('Lyrics generation error:', err);
      setLyricsGenerationError(err instanceof Error ? err.message : '歌词生成失败，请稍后重试。');
    } finally {
      setIsGeneratingLyrics(false);
    }
  };

  const handleHistoryPlayPause = (id: string) => {
    if (isPlaying && standaloneMusicAudioRef.current) {
      standaloneMusicAudioRef.current.pause();
      setIsPlaying(false);
    }

    if (playingHistoryId && playingHistoryId !== id && historyAudioRefs.current[playingHistoryId]) {
      historyAudioRefs.current[playingHistoryId]?.pause();
    }

    const audioObj = historyAudioRefs.current[id];
    if (!audioObj) return;

    if (playingHistoryId === id) {
      audioObj.pause();
      setPlayingHistoryId(null);
    } else {
      window.dispatchEvent(new CustomEvent('music-waveform-stop-others', { detail: `history-${id}` }));
      audioObj.play().catch(e => console.error(e));
      setPlayingHistoryId(id);
    }
  };

  const musicPrompts = [
    { label: '史诗级科幻交响', prompt: 'epic orchestral sci-fi cinematic theme, space organ, brass highlights, powerful dynamic build-up' },
    { label: '赛博朋克重型电子', prompt: 'heavy industrial dark techno, cyberpunk combat synthwave, distorted bassline, aggressive beats' },
    { label: '治愈系原声吉他', prompt: 'warm fingerstyle acoustic folk guitar, serene campfire mood, soft mellow pad background, gentle pacing' },
    { label: '低保真复古休闲 Lofi', prompt: 'cozy nostalgic lofi hip-hop beat, dusty vinyl crackle, warm rhodes piano chords, chilled sax melody' },
    { label: '国风水墨新民乐', prompt: 'modern oriental guzheng and bamboo flute fusion, cinematic epic cinematic build, light cinematic beats' },
  ];

  const musicHistory = historyList.filter(item => item.type === 'music');

  return (
    <div id="musicstudio-view" className="flex-1 p-6 space-y-6 max-w-6xl mx-auto w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h2 className="text-xl font-black text-slate-800">AI 音乐</h2>
          <p className="text-xs text-slate-500 mt-1">输入情绪与配乐风格关键词，一次生成两首可对比的背景音乐 Demo。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 block uppercase tracking-wider">配乐风格与情感描述</label>
                <button
                  type="button"
                  onClick={handleTranslate}
                  disabled={isTranslating || !standaloneMusicPrompt.trim()}
                  className="text-[10px] text-emerald-600 hover:text-emerald-700 disabled:text-slate-400 font-bold flex items-center gap-1.5 transition-all bg-emerald-50 hover:bg-emerald-100 disabled:bg-slate-50 px-2.5 py-1 rounded-lg border border-emerald-200/50 disabled:border-slate-200 cursor-pointer"
                >
                  {isTranslating ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                      <span>正在翻译...</span>
                    </>
                  ) : (
                    <>
                      <Languages className="w-3 h-3 text-emerald-600" />
                      <span>翻译为英文</span>
                    </>
                  )}
                </button>
              </div>
              <textarea
                value={standaloneMusicPrompt}
                onChange={(e) => setStandaloneMusicPrompt(e.target.value)}
                placeholder="例如：温馨悠扬的木吉他，伴随轻缓的钢琴和微风声，适合温馨生活日常 VLOG..."
                className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all resize-none placeholder-slate-400"
              />
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase">点击载入灵感预设：</span>
              <div className="flex flex-wrap gap-2">
                {musicPrompts.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setStandaloneMusicPrompt(item.prompt)}
                    className="text-[10px] bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 text-slate-600 hover:text-emerald-700 px-3 py-1.5 rounded-xl transition-all font-semibold"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>期望生成时长</span>
                  <span className="text-emerald-600 font-mono">{standaloneMusicDuration}秒</span>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="10"
                    max="60"
                    step="5"
                    value={standaloneMusicDuration}
                    onChange={(e) => setStandaloneMusicDuration(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                  />
                </div>
                <span className="text-[9px] text-slate-400 block">建议 10s - 60s；每次会连续生成 A/B 两首。</span>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 block">有无人声偏好</label>
                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setStandaloneMusicType('instrumental')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                      standaloneMusicType === 'instrumental'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    纯音乐 Demo
                  </button>
                  <button
                    type="button"
                    onClick={() => setStandaloneMusicType('vocal')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                      standaloneMusicType === 'vocal'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    歌词人声
                  </button>
                </div>
              </div>
            </div>

            {standaloneMusicType === 'vocal' && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-bold text-slate-700 block uppercase tracking-wider">
                    输入背景歌词
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateLyrics}
                    disabled={isGeneratingLyrics || !standaloneMusicPrompt.trim()}
                    className="text-[10px] text-emerald-600 hover:text-emerald-700 disabled:text-slate-400 font-bold flex items-center gap-1.5 transition-all bg-emerald-50 hover:bg-emerald-100 disabled:bg-slate-50 px-2.5 py-1 rounded-lg border border-emerald-200/50 disabled:border-slate-200 cursor-pointer"
                    title={!standaloneMusicPrompt.trim() ? '请先输入配乐风格与情感描述' : '根据当前风格描述生成歌词'}
                  >
                    {isGeneratingLyrics ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                        <span>生成中...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 text-emerald-600" />
                        <span>根据风格生成歌词</span>
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  value={standaloneMusicLyrics}
                  onChange={(e) => setStandaloneMusicLyrics(e.target.value)}
                  placeholder="请输入希望 AI 歌唱的歌词文本，例如：[Verse] 在深夜的街头... [Chorus] 奔跑吧，迎着风..."
                  className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all resize-none placeholder-slate-400"
                />
                <p className="text-[10px] text-slate-400 italic">
                  支持使用 [Verse] / [Chorus] 等结构标签。
                </p>
                {lyricsGenerationError && (
                  <p className="text-[10px] text-red-500 flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{lyricsGenerationError}</span>
                  </p>
                )}
              </div>
            )}

            {standaloneMusicError && (
              <div className="bg-red-50 border border-red-200 text-red-600 p-3.5 rounded-xl text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{standaloneMusicError}</span>
              </div>
            )}

            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-[10px] font-semibold leading-relaxed text-emerald-700">
              直接输入中文也可以。点击生成时会自动翻译成英文再生成；上方“翻译为英文”只用于提前预览和手动微调。
            </div>

            <button
              onClick={handleStandaloneMusicGenerate}
              disabled={standaloneMusicLoading || !standaloneMusicPrompt.trim()}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3.5 rounded-xl text-xs tracking-wider uppercase transition-all shadow-md shadow-emerald-600/10 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {standaloneMusicLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>正在自动英译并生成两首...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>生成两首背景音乐 Demo</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">当前音乐预览播放器</h3>

            {standaloneMusicLoading ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-3">
                <div className="w-12 h-12 bg-emerald-50 border border-emerald-200 rounded-full flex items-center justify-center animate-spin">
                  <Music className="w-5 h-5 text-emerald-600 animate-pulse" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-slate-700">正在自动英译并谱写两个版本...</p>
                  <p className="text-[10px] text-slate-400">会先转成英文提示词，再连续生成 A/B 两首。</p>
                </div>
              </div>
            ) : musicOptions.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black text-slate-800">已生成双版本音乐</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">每首都可单独试听、点击波形定位播放、单独下载。</p>
                  </div>
                  <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">
                    2 首
                  </span>
                </div>
                {musicOptions.map((option) => (
                  <div key={option.id}>
                    <MusicWaveformPlayer
                      option={option}
                      activeId={activeMusicOptionId}
                      setActiveId={setActiveMusicOptionId}
                      onClear={() => {
                        URL.revokeObjectURL(option.url);
                        setPendingMusicOptions((prev) => {
                          const next = {
                            optionA: option.id === 'A' ? null : prev.optionA,
                            optionB: option.id === 'B' ? null : prev.optionB,
                          };
                          setStandaloneMusicAudioUrl(next.optionA?.url || next.optionB?.url || null);
                          return next;
                        });
                        if (activeMusicOptionId === option.id) setActiveMusicOptionId(null);
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-slate-200 bg-slate-50 rounded-xl p-10 text-center text-slate-400 text-xs leading-relaxed">
                <Music className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <span>输入配乐灵感并点击生成。生成后会在这里显示两个可对比的波形播放器。</span>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
              <span>已保存的音乐 ({musicHistory.length})</span>
              <span className="text-[10px] text-slate-400 font-normal">本会话</span>
            </h3>

            {musicHistory.length === 0 ? (
              <p className="text-slate-400 text-[10px] text-center py-6">暂无历史音乐。每次生成成功的音乐都会自动归档到此处。</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                {musicHistory.map((item) => {
                  const isHistPlaying = playingHistoryId === item.id;
                  return (
                    <div key={item.id} className="p-3 bg-slate-50 border border-slate-200 hover:border-emerald-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                      <audio
                        ref={el => {
                          historyAudioRefs.current[item.id] = el;
                        }}
                        src={item.url}
                        onEnded={() => setPlayingHistoryId(null)}
                      />
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <button
                          onClick={() => handleHistoryPlayPause(item.id)}
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                            isHistPlaying
                              ? 'bg-emerald-600 text-white border-emerald-500'
                              : 'bg-white text-slate-500 border-slate-200 hover:text-slate-900 hover:bg-slate-50'
                          }`}
                        >
                          {isHistPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                        </button>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-700 truncate text-[11px]">{item.title}</p>
                          <p className="text-[9px] text-slate-400 truncate italic">"{item.prompt}"</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[9px] text-slate-400 font-mono hidden sm:inline">{item.timestamp.split(' ')[1]}</span>
                        <a
                          href={item.url}
                          download={`${item.id}.mp3`}
                          className="p-1 hover:bg-emerald-50 hover:text-emerald-700 text-slate-400 rounded transition-colors"
                          title="下载"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
