/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Loader2, Pause, Play, X } from 'lucide-react';
import { exportDownloadAudio, startAudioRangePreview, type AudioDownloadRange, type AudioRangePlayback } from '../services/audioRangeExport';

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
  enableRangeDownload?: boolean;
  deferDecode?: boolean;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  editableTitle?: boolean;
  onRename?: (title: string) => void;
  onClear?: () => void;
  stopEventName?: string;
  onConfirm?: (blob: Blob, range: AudioDownloadRange) => Promise<void> | void;
  confirmLabel?: string;
  confirmationHint?: string;
  onSelectionChange?: (range: AudioDownloadRange | null) => void;
  hideDownloads?: boolean;
  compact?: boolean;
  initialRange?: AudioDownloadRange | null;
  onDecoded?: (duration: number) => void;
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
  enableRangeDownload = false,
  deferDecode = false,
  activeId,
  setActiveId,
  editableTitle = false,
  onRename,
  onClear,
  stopEventName = 'generated-audio-player-stop-others',
  onConfirm,
  confirmLabel = '确认剪辑',
  confirmationHint = '在波形上拖动框选保留范围，两端可来回调整；试听满意后确认剪辑。未框选时保留完整音频。',
  onSelectionChange,
  hideDownloads = false,
  compact = false,
  initialRange = null,
  onDecoded,
}: GeneratedAudioPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const decodedRef = useRef<AudioBuffer | null>(null);
  const previewRef = useRef<AudioRangePlayback | null>(null);
  const previewContextRef = useRef<AudioContext | null>(null);
  const previewRequestRef = useRef(0);
  const [decodeStatus, setDecodeStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selection, setSelection] = useState<AudioDownloadRange | null>(initialRange);
  const initialRangeRef = useRef(initialRange);
  const selectionCallback = useRef(onSelectionChange);
  selectionCallback.current = onSelectionChange;
  const decodedCallback = useRef(onDecoded);
  decodedCallback.current = onDecoded;
  useEffect(() => { selectionCallback.current?.(selection); }, [selection, url]);
  const dragRef = useRef<{ pointerId: number; anchor: number; initialX: number; moved: boolean; previous: AudioDownloadRange | null; edge?: 'start' | 'end' } | null>(null);
  const [exporting, setExporting] = useState<'wav' | 'mp3' | null>(null);
  const [exportError, setExportError] = useState('');
  const exportController = useRef<AbortController | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationHint || 0);
  const fallbackBars = useMemo(
    () => createFallbackWaveformBars(`${id}-${url}`),
    [id, url],
  );
  const [bars, setBars] = useState(fallbackBars);
  const [titleDraft, setTitleDraft] = useState(title);
  const [decodeUrl, setDecodeUrl] = useState<string | null>(() => deferDecode ? null : url);
  const isPlaying = activeId === id;
  const decodeEnabled = !deferDecode || decodeUrl === url;
  const safeDuration = duration || durationHint || 0;
  const progress = safeDuration > 0 ? Math.max(0, Math.min(1, currentTime / safeDuration)) : 0;
  const safeDownloadFileName = useMemo(
    () => downloadFileName || `${sanitizeAudioFileName(title, `generated_audio_${id}`)}.mp3`,
    [downloadFileName, id, title],
  );

  const closePreviewContext = (drainOutput = false) => {
    const context = previewContextRef.current;
    previewContextRef.current = null;
    if (!context) return;
    const close = () => { void context.close().catch(() => undefined); };
    // onended is raised on the rendering clock. Let the device play its queued
    // final samples before releasing the context; this does not extend the clip.
    if (drainOutput) window.setTimeout(close, Math.max(100, ((context.baseLatency || 0) + (context.outputLatency || 0)) * 1000 + 50));
    else close();
  };

  const stopRangePreview = () => {
    previewRequestRef.current++;
    const preview = previewRef.current;
    const wasActive = !!preview || !!previewContextRef.current;
    if (preview) {
      setCurrentTime(preview.currentTime());
      preview.stop(); previewRef.current = null;
    }
    closePreviewContext();
    if (wasActive) setActiveId(null);
  };

  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

  useEffect(() => {
    if (!deferDecode) {
      setDecodeUrl(url);
      return;
    }
    setDecodeUrl(null);
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setDecodeUrl(url);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setDecodeUrl(url);
      observer.disconnect();
    }, { rootMargin: '600px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [deferDecode, url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setBars(fallbackBars);
    decodedRef.current = null;
    setDecodeStatus('loading');
    setSelection(initialRangeRef.current);
    setExporting(null);
    setExportError('');
    setCurrentTime(0);
    setDuration(durationHint || 0);
    if (!decodeEnabled) return () => controller.abort();

    const decodeRealWaveform = async () => {
      let audioContext: AudioContext | null = null;

      try {
        const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextCtor) throw new Error('当前浏览器不支持音频解码。');

        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`音频读取失败（${response.status}）。`);
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
          if (enableRangeDownload) decodedRef.current = audioBuffer;
          setDecodeStatus('ready');
          setBars(normalizedBars);
          setDuration(audioBuffer.duration || durationHint || 0);
          decodedCallback.current?.(audioBuffer.duration);
        }
      } catch (error) {
        if (!cancelled) {
          setDecodeStatus('error');
          if (enableRangeDownload) setExportError('无法读取音频波形，暂不能选区导出。请重新加载音频。');
          console.warn('Failed to decode generated audio waveform. Using fallback waveform.', error);
        }
      } finally {
        await audioContext?.close?.().catch(() => undefined);
      }
    };

    decodeRealWaveform();

    return () => {
      cancelled = true;
      controller.abort();
      exportController.current?.abort();
      previewRequestRef.current++;
      previewRef.current?.stop(); previewRef.current = null;
      closePreviewContext();
      decodedRef.current = null;
    };
  }, [decodeEnabled, durationHint, enableRangeDownload, fallbackBars, url]);

  useEffect(() => {
    if (!enableRangeDownload || !selection || !isPlaying) return;
    let frame: number;
    const updateProgress = () => {
      const preview = previewRef.current;
      if (!preview) return;
      setCurrentTime(preview.currentTime());
      frame = requestAnimationFrame(updateProgress);
    };
    frame = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(frame);
  }, [enableRangeDownload, isPlaying, selection]);

  useEffect(() => {
    const stopOtherPlayers = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail !== id) {
        audioRef.current?.pause();
        stopRangePreview();
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

  const playFromCurrentPosition = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (enableRangeDownload && selection) {
      const buffer = decodedRef.current;
      if (!buffer) return;
      audio.pause();
      stopRangePreview();
      const requestId = ++previewRequestRef.current;
      try {
        const Context = window.AudioContext || (window as any).webkitAudioContext;
        const context: AudioContext = new Context();
        previewContextRef.current = context;
        await context.resume();
        if (requestId !== previewRequestRef.current) return;
        window.dispatchEvent(new CustomEvent(stopEventName, { detail: id }));
        const preview = startAudioRangePreview(context, buffer, selection, {
          currentTime, playbackRate,
          onEnded: (time) => {
            if (requestId !== previewRequestRef.current) return;
            previewRef.current = null; closePreviewContext(true);
            setCurrentTime(time); setActiveId(null);
          },
        });
        previewRef.current = preview;
        setCurrentTime(preview.currentTime()); setActiveId(id); setExportError('');
      } catch (error: any) {
        if (requestId === previewRequestRef.current) {
          stopRangePreview(); setExportError(error.message || '选区试听失败，请重试。');
        }
      }
      return;
    }
    audio.playbackRate = playbackRate;
    window.dispatchEvent(new CustomEvent(stopEventName, { detail: id }));
    audio.play().then(() => setActiveId(id)).catch(error => console.error('Play generated audio failed:', error));
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying || previewContextRef.current) {
      stopRangePreview();
      audio.pause();
      setActiveId(null);
      return;
    }

    playFromCurrentPosition();
  };

  const pointerTime = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left - 12) / Math.max(1, rect.width - 24))) * safeDuration;
  };

  const seek = (time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    stopRangePreview();
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const beginPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !safeDuration) return;
    if (!enableRangeDownload) { seek(pointerTime(event)); if (!isPlaying) playFromCurrentPosition(); return; }
    if (decodeStatus !== 'ready' || exporting) return;
    const edge = (event.target as HTMLElement).dataset?.rangeEdge as 'start' | 'end' | undefined;
    dragRef.current = { pointerId: event.pointerId, anchor: edge && selection ? selection[edge === 'start' ? 'end' : 'start'] : pointerTime(event),
      initialX: event.clientX, moved: false, previous: selection, edge };
    event.currentTarget.setPointerCapture(event.pointerId);
    stopRangePreview();
    audioRef.current?.pause();
    event.preventDefault();
  };

  const movePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.initialX) >= 3) drag.moved = true;
    if (!drag.moved) return;
    const time = pointerTime(event);
    setSelection({ start: Math.min(drag.anchor, time), end: Math.max(drag.anchor, time) });
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const time = pointerTime(event);
    const start = Math.min(drag.anchor, time), end = Math.max(drag.anchor, time);
    if (cancelled || (drag.moved && end - start < 0.01)) setSelection(drag.previous);
    else if (drag.moved) { setSelection({ start, end }); seek(start); }
    else if (!drag.edge) { seek(time); }
  };

  const updateBoundary = (edge: 'start' | 'end', value: number) => {
    if (!Number.isFinite(value)) return;
    const current = selection || { start: 0, end: safeDuration };
    const next = edge === 'start'
      ? { start: Math.max(0, Math.min(value, current.end - 0.01)), end: current.end }
      : { start: current.start, end: Math.min(safeDuration, Math.max(value, current.start + 0.01)) };
    audioRef.current?.pause(); setSelection(next); seek(next.start);
  };

  const downloadRange = async (format: 'wav' | 'mp3') => {
    const source = decodedRef.current;
    if (!source || exportController.current) return;
    const controller = new AbortController(); exportController.current = controller;
    setExporting(format); setExportError('');
    try {
      const blob = await exportDownloadAudio(source, selection, format, title, controller.signal);
      controller.signal.throwIfAborted();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const base = sanitizeAudioFileName(safeDownloadFileName.replace(/\.[^/.]+$/, ''));
      link.href = objectUrl;
      link.download = `${base}${selection ? `_${selection.start.toFixed(2)}-${selection.end.toFixed(2)}s` : ''}.${format}`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error: any) {
      if (!controller.signal.aborted) setExportError(error.message || '导出失败，请重试。');
    } finally {
      if (exportController.current === controller) {
        exportController.current = null;
        if (!controller.signal.aborted) setExporting(null);
      }
    }
  };

  const position = (time: number) => {
    const ratio = safeDuration > 0 ? time / safeDuration : 0;
    return `calc(${ratio * 100}% + ${12 - 24 * ratio}px)`;
  };

  const confirmRange = async () => {
    const source = decodedRef.current;
    if (!source || !onConfirm || exportController.current) return;
    const controller = new AbortController(); exportController.current = controller;
    setExporting('wav'); setExportError('');
    try {
      const blob = await exportDownloadAudio(source, selection, 'wav', title, controller.signal);
      controller.signal.throwIfAborted();
      await onConfirm(blob, selection || { start: 0, end: source.duration });
    } catch (error: any) {
      if (!controller.signal.aborted) setExportError(error.message || '确认剪辑失败，请重试。');
    } finally {
      if (exportController.current === controller) { exportController.current = null; if (!controller.signal.aborted) setExporting(null); }
    }
  };

  return (
    <div ref={containerRef} className={`rounded-2xl border border-slate-200 bg-slate-50/80 ${compact ? 'p-2 space-y-2' : 'p-4 space-y-3 shadow-sm'}`}>
      <audio
        ref={audioRef}
        src={url}
        preload={deferDecode ? 'none' : 'metadata'}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          audio.playbackRate = playbackRate;
          setDuration(audio.duration || durationHint || 0);
        }}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget;
          if (enableRangeDownload && selection) return;
          setCurrentTime(audio.currentTime || 0);
        }}
        onPlay={() => setActiveId(id)}
        onPause={() => {
          if (previewContextRef.current) return;
          if (activeId === id) setActiveId(null);
        }}
        onEnded={() => {
          if (previewContextRef.current) return;
          setActiveId(null);
          setCurrentTime(0);
        }}
      />

      <div className={compact ? 'sr-only' : 'flex items-start justify-between gap-3'}>
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

      <div className={`flex items-center border border-slate-200 bg-white ${compact ? 'gap-2 rounded-xl p-2' : 'gap-3 rounded-[1.4rem] p-3 shadow-sm shadow-slate-200/60'}`}>
        <button
          type="button"
          onClick={togglePlay}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-950 bg-slate-950 text-white shadow-md shadow-slate-900/15 transition-all hover:scale-105"
          aria-label={isPlaying ? '暂停' : selection ? '试听选区' : '播放'}
          title={isPlaying ? '暂停' : selection ? '试听选区' : '播放'}
        >
          {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
        </button>

        <div
          role="slider"
          aria-label={`${titleBadge || title} 音频波形进度`}
          aria-valuemin={0}
          aria-valuemax={Math.max(1, Math.round(safeDuration))}
          aria-valuenow={Math.round(currentTime)}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault(); seek(Math.max(0, Math.min(safeDuration, currentTime + (event.key === 'ArrowRight' ? 0.1 : -0.1))));
            }
          }}
          onPointerDown={beginPointer}
          onPointerMove={movePointer}
          onPointerUp={event => endPointer(event)}
          onPointerCancel={event => endPointer(event, true)}
          className={`group relative ${compact ? 'h-14' : 'h-20'} min-w-0 flex-1 select-none overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-b from-white to-slate-50 px-3 py-2 ${enableRangeDownload ? 'touch-none cursor-crosshair' : 'cursor-pointer'}`}
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
          {enableRangeDownload && selection && <>
            <div className="pointer-events-none absolute inset-y-0 border-x border-emerald-600 bg-emerald-400/20"
              style={{ left: position(selection.start), right: `calc(100% - ${position(selection.end)})` }} />
            {(['start', 'end'] as const).map(edge => <div key={edge} data-range-edge={edge}
              title={edge === 'start' ? '拖动调整选区起点' : '拖动调整选区终点'}
              className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize border-x border-emerald-700 bg-emerald-500/60"
              style={{ left: position(selection[edge]) }} />)}
          </>}
          <div
            className="absolute bottom-2 top-2 w-[2px] rounded-full bg-slate-950 shadow-[0_0_0_3px_rgba(15,23,42,0.08)]"
            style={{ left: position(currentTime), pointerEvents: 'none' }}
          />
          <div className="pointer-events-none absolute inset-x-3 top-1 flex justify-between text-[8px] font-mono font-bold text-slate-400">
            <span>{formatGeneratedAudioTime(currentTime)}</span>
            <span>{formatGeneratedAudioTime(safeDuration)}</span>
          </div>
        </div>
      </div>

      {enableRangeDownload ? <div className="space-y-2">
        {(!compact || decodeStatus === 'loading') && <p className="text-[10px] text-slate-500">{decodeStatus === 'loading' ? '正在读取波形…' : onConfirm ? confirmationHint : '在波形上拖动框选下载范围，拖动两端可调整；不框选则下载完整音频。'}</p>}
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-600">
          <label className="flex items-center gap-1">起点（秒）<input aria-label="下载起点（秒）" type="number" step="0.01" min="0" max={safeDuration}
            disabled={decodeStatus !== 'ready' || !!exporting} value={Number((selection?.start || 0).toFixed(2))}
            onChange={event => updateBoundary('start', event.currentTarget.valueAsNumber)} className="w-20 rounded border border-slate-200 bg-white px-2 py-1" /></label>
          <label className="flex items-center gap-1">终点（秒）<input aria-label="下载终点（秒）" type="number" step="0.01" min="0" max={safeDuration}
            disabled={decodeStatus !== 'ready' || !!exporting} value={Number((selection?.end ?? safeDuration).toFixed(2))}
            onChange={event => updateBoundary('end', event.currentTarget.valueAsNumber)} className="w-20 rounded border border-slate-200 bg-white px-2 py-1" /></label>
          <span>{selection ? `已选 ${(selection.end - selection.start).toFixed(2)} 秒` : '完整音频'}</span>
          {selection && <button type="button" disabled={!!exporting} onClick={() => { stopRangePreview(); if (audioRef.current) audioRef.current.currentTime = currentTime; setSelection(null); }} className="text-emerald-700 underline">取消选区</button>}
        </div>
        {onConfirm && <button type="button" onClick={() => void confirmRange()}
          disabled={decodeStatus !== 'ready' || !!exporting || !!dragRef.current}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{exporting ? '正在确认…' : confirmLabel}</button>}
        {!hideDownloads && <div className="grid grid-cols-2 gap-2">
          {(['wav', 'mp3'] as const).map(format => <button key={format} type="button" disabled={decodeStatus !== 'ready' || !!exporting || !!dragRef.current || !!(selection && selection.end - selection.start < 0.01)}
            onClick={() => void downloadRange(format)} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-[10px] font-bold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40">
            {exporting === format ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {exporting === format ? '正在导出…' : `下载${selection ? '选区' : '完整'} ${format.toUpperCase()}`}
          </button>)}
        </div>}
        {exportError && <p role="alert" className="text-[10px] text-red-600">{exportError}</p>}
      </div> : <a
        href={url}
        download={safeDownloadFileName}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2 text-center text-[10px] font-bold text-slate-700 shadow-sm transition-all hover:bg-emerald-50 hover:text-emerald-700"
      >
        <Download className="h-3.5 w-3.5" />
        <span>{downloadLabel || '下载 MP3'}</span>
      </a>}
    </div>
  );
}
