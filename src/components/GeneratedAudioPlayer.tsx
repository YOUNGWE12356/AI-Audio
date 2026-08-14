/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pause, Play, X } from 'lucide-react';

export const formatGeneratedAudioTime = (seconds?: number | null) => {
  if (!Number.isFinite(seconds || 0) || !seconds || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
};

export const sanitizeAudioFileName = (name: string, fallback = 'generated_audio') => {
  const cleaned = (name || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);

  return cleaned || fallback;
};

const createFallbackWaveformBars = (seed: string, count = 128) => {
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

interface GeneratedAudioPlayerProps {
  key?: React.Key;
  id: string;
  url: string;
  title: string;
  titleBadge?: string;
  prompt?: string;
  meta?: string;
  durationHint?: number | null;
  playbackRate?: number;
  downloadFileName?: string;
  downloadLabel?: string;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  editableTitle?: boolean;
  onRename?: (title: string) => void;
  onClear?: () => void;
  stopEventName?: string;
}

export default function GeneratedAudioPlayer({
  id,
  url,
  title,
  titleBadge,
  prompt,
  meta,
  durationHint,
  playbackRate = 1,
  downloadFileName,
  downloadLabel,
  activeId,
  setActiveId,
  editableTitle = false,
  onRename,
  onClear,
  stopEventName = 'generated-audio-player-stop-others',
}: GeneratedAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationHint || 0);
  const fallbackBars = useMemo(
    () => createFallbackWaveformBars(`${id}-${title}-${prompt || ''}-${url}`),
    [id, title, prompt, url],
  );
  const [bars, setBars] = useState(fallbackBars);
  const [titleDraft, setTitleDraft] = useState(title);
  const isPlaying = activeId === id;
  const safeDuration = duration || durationHint || 0;
  const progress = safeDuration > 0 ? Math.max(0, Math.min(1, currentTime / safeDuration)) : 0;
  const safeDownloadFileName = useMemo(
    () => downloadFileName || `${sanitizeAudioFileName(title, `generated_audio_${id}`)}.mp3`,
    [downloadFileName, id, title],
  );

  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    let cancelled = false;
    setBars(fallbackBars);

    const decodeRealWaveform = async () => {
      let audioContext: AudioContext | null = null;

      try {
        const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextCtor) return;

        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        audioContext = new AudioContextCtor();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        const targetBarCount = 128;
        const samplesPerBar = Math.max(1, Math.floor(audioBuffer.length / targetBarCount));

        const peaks = Array.from({ length: targetBarCount }, (_, barIndex) => {
          const start = barIndex * samplesPerBar;
          const end = barIndex === targetBarCount - 1
            ? audioBuffer.length
            : Math.min(audioBuffer.length, start + samplesPerBar);
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

        if (!cancelled) {
          setBars(normalizedBars);
          setDuration(audioBuffer.duration || durationHint || 0);
        }
      } catch (error) {
        console.warn('Failed to decode generated audio waveform. Using fallback waveform.', error);
      } finally {
        await audioContext?.close?.().catch(() => undefined);
      }
    };

    decodeRealWaveform();

    return () => {
      cancelled = true;
    };
  }, [durationHint, fallbackBars, url]);

  useEffect(() => {
    const stopOtherPlayers = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail !== id) {
        audioRef.current?.pause();
      }
    };

    window.addEventListener(stopEventName, stopOtherPlayers);
    return () => window.removeEventListener(stopEventName, stopOtherPlayers);
  }, [id, stopEventName]);

  const commitTitle = () => {
    const nextTitle = titleDraft.trim() || title;
    setTitleDraft(nextTitle);
    if (nextTitle !== title) {
      onRename?.(nextTitle);
    }
  };

  const playFromCurrentPosition = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
    window.dispatchEvent(new CustomEvent(stopEventName, { detail: id }));
    audio.play().then(() => setActiveId(id)).catch(error => console.error('Play generated audio failed:', error));
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setActiveId(null);
      return;
    }

    playFromCurrentPosition();
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
      playFromCurrentPosition();
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3 shadow-sm">
      <audio
        ref={audioRef}
        src={url}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          audio.playbackRate = playbackRate;
          setDuration(audio.duration || durationHint || 0);
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onPlay={() => setActiveId(id)}
        onPause={() => {
          if (activeId === id) setActiveId(null);
        }}
        onEnded={() => {
          setActiveId(null);
          setCurrentTime(0);
        }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {titleBadge && (
              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-700">
                {titleBadge}
              </span>
            )}
            {editableTitle ? (
              <input
                type="text"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  } else if (event.key === 'Escape') {
                    setTitleDraft(title);
                    event.currentTarget.blur();
                  }
                }}
                aria-label={`${titleBadge || id} 音频名称`}
                title="修改名称后，下载文件名会同步使用这里的名称"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-black text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
              />
            ) : (
              <p className="min-w-0 flex-1 truncate text-[11px] font-black text-slate-800">{title}</p>
            )}
          </div>
          {prompt && <p className="mt-0.5 truncate text-[10px] italic text-slate-500">"{prompt}"</p>}
          <p className="mt-1 text-[9px] font-bold text-emerald-600">
            {formatGeneratedAudioTime(currentTime)} / {formatGeneratedAudioTime(safeDuration)}
            {meta ? ` · ${meta}` : ''}
          </p>
        </div>
        {onClear && (
          <button type="button" onClick={onClear} className="p-1 text-slate-400 hover:text-red-500" title="移除">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-[1.4rem] border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60">
        <button
          type="button"
          onClick={togglePlay}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-950 bg-slate-950 text-white shadow-md shadow-slate-900/15 transition-all hover:scale-105"
          title={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
        </button>

        <div
          role="slider"
          aria-label={`${titleBadge || title} 音频波形进度`}
          aria-valuemin={0}
          aria-valuemax={Math.max(1, Math.round(safeDuration))}
          aria-valuenow={Math.round(currentTime)}
          onPointerDown={seekByPointer}
          className="group relative h-16 flex-1 cursor-pointer overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-b from-white to-slate-50 px-3 py-2"
        >
          <div className="pointer-events-none absolute left-3 right-3 top-1/2 h-px -translate-y-1/2 bg-slate-200" />
          <svg
            className="absolute inset-y-3 left-3 right-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] overflow-visible"
            viewBox="0 0 1000 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {bars.map((height, index) => {
              const gap = 2;
              const barWidth = Math.max(2.5, (1000 - gap * Math.max(0, bars.length - 1)) / Math.max(1, bars.length));
              const x = index * (barWidth + gap);
              const normalizedHeight = Math.max(10, Math.min(92, height));
              const barProgress = index / Math.max(1, bars.length - 1);
              const active = barProgress <= progress;
              return (
                <rect
                  key={index}
                  x={x}
                  y={(100 - normalizedHeight) / 2}
                  width={barWidth}
                  height={normalizedHeight}
                  rx={barWidth / 2}
                  fill={active ? '#10b981' : '#0f172a'}
                  opacity={active ? 0.95 : 0.9}
                />
              );
            })}
          </svg>
          <div
            className="absolute bottom-2 top-2 w-[2px] rounded-full bg-slate-950 shadow-[0_0_0_3px_rgba(15,23,42,0.08)]"
            style={{ left: `calc(${progress * 100}% - 1px)` }}
          />
          <div className="pointer-events-none absolute inset-x-3 top-1 flex justify-between text-[8px] font-mono font-bold text-slate-400">
            <span>{formatGeneratedAudioTime(currentTime)}</span>
            <span>{formatGeneratedAudioTime(safeDuration)}</span>
          </div>
        </div>
      </div>

      <a
        href={url}
        download={safeDownloadFileName}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-center text-[10px] font-bold text-slate-700 shadow-sm transition-all hover:bg-emerald-50 hover:text-emerald-700"
      >
        <Download className="h-3.5 w-3.5" />
        <span>{downloadLabel || '下载 MP3'}</span>
      </a>
    </div>
  );
}
