import React, { useEffect, useRef, useState } from 'react';
import { Film, Pause, Play, Plus, RotateCw, Trash2 } from 'lucide-react';
import { batchOccurrenceRange, isBatchPoint, layoutBatchTimeRanges } from '../services/batchVideoTimeline';
import BatchSfxRanges, { rangeTimeLabel } from './BatchSfxRanges';
import type { BatchRow, BatchVideoAsset } from '../services/sfxBatchProject';

const control = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-emerald-400 disabled:opacity-40';
export const pointLabel = rangeTimeLabel;

export default function BatchSfxVideo({ asset, rows, activeRowId, activeOccurrenceIndex = 0, locked, active = true, onDuration, onSelect,
  onAdd, onMove, onDelete, onBeginPlayback }: {
  asset: BatchVideoAsset; rows: BatchRow[]; activeRowId?: string; activeOccurrenceIndex?: number; locked: boolean; active?: boolean;
  onDuration: (duration: number) => void; onSelect: (id: string, occurrenceIndex: number) => void; onAdd: (time: number) => void;
  onMove: (id: string, time: number | undefined, endTime?: number, occurrenceIndex?: number) => void; onDelete: (id: string) => void;
  onBeginPlayback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState(''), [duration, setDuration] = useState(0), [time, setTime] = useState(0);
  const [mediaError, setMediaError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const restoreTime = useRef(0);
  const wasActive = useRef(active);
  const reloadPreview = () => {
    const video = videoRef.current;
    restoreTime.current = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
    video?.pause();
    setPlaying(false); setMediaError(''); setLoading(true);
    // A decoded video can still lose its browser rendering surface after being
    // hidden. Remount the element, not just its React state, to recover it.
    setPreviewRevision(value => value + 1);
  };
  const pause = () => { videoRef.current?.pause(); };
  useEffect(() => {
    pause();
    const objectUrl = URL.createObjectURL(asset.file); setUrl(objectUrl); setTime(0); setDuration(0); setMediaError('');
    restoreTime.current = 0; setPlaying(false); setLoading(true);
    return () => { URL.revokeObjectURL(objectUrl); };
  }, [asset.id, asset.file]);
  useEffect(() => {
    if (!active) pause();
    else if (!wasActive.current) reloadPreview();
    wasActive.current = active;
  }, [active]);
  useEffect(() => {
    let wasHidden = document.hidden;
    const resume = () => {
      if (document.hidden) { wasHidden = true; pause(); }
      else if (wasHidden) { wasHidden = false; if (active) reloadPreview(); }
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, [active]);
  useEffect(() => {
    const interrupt = () => pause();
    window.addEventListener('generated-audio-player-stop-others', interrupt);
    return () => { window.removeEventListener('generated-audio-player-stop-others', interrupt); pause(); };
  }, []);
  const points = layoutBatchTimeRanges(rows, asset.id, duration);
  const unlocatedCount = rows.filter(row => row.videoId === asset.id && !isBatchPoint(row.time, duration)).length;
  const selected = rows.find(row => row.id === activeRowId && row.videoId === asset.id);
  const selectedRange = selected ? batchOccurrenceRange(selected, activeOccurrenceIndex, duration) : null;
  const locate = (row: BatchRow, occurrenceIndex: number) => {
    pause(); onSelect(row.id, occurrenceIndex);
    const range = batchOccurrenceRange(row, occurrenceIndex, duration);
    if (videoRef.current && range) { videoRef.current.currentTime = range.start; setTime(range.start); }
  };
  const seek = (value: number) => { pause(); if (videoRef.current) videoRef.current.currentTime = value; setTime(value); };

  return <section aria-label="视频点位与音效预览" className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
    <div className="min-w-0"><h3 className="flex items-center gap-2 text-sm font-bold text-slate-800"><Film size={17} className="text-emerald-600" />视频预览与音效打点</h3><p className="mt-1 truncate text-[11px] text-slate-500">{asset.file.name}</p></div>
    <video key={`${url}:${previewRevision}`} ref={videoRef} src={url || undefined} controls playsInline preload="auto" aria-label="批量音效视频预览" aria-busy={loading} className="mx-auto h-[360px] w-full rounded-xl bg-slate-950 object-contain" onLoadedMetadata={e => {
      const length = e.currentTarget.duration;
      if (Number.isFinite(length) && length > 0) {
        setDuration(length); onDuration(length);
        const position = Math.min(restoreTime.current, Math.max(0, length - 0.001));
        if (position > 0) e.currentTarget.currentTime = position;
        setTime(position);
      }
    }} onLoadedData={() => setLoading(false)} onError={() => { setLoading(false); setPlaying(false); setMediaError('视频无法预览，可重新加载重试；如仍失败，请使用 H.264 MP4 或 WebM 文件。'); }}
      onPlay={() => { setPlaying(true); onBeginPlayback(); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onSeeked={() => setTime(videoRef.current?.currentTime || 0)}
      onTimeUpdate={e => setTime(e.currentTarget.currentTime)} />
    {mediaError && <p role="alert" className="text-xs text-red-600">{mediaError}</p>}
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
      <div className="flex flex-wrap items-center gap-2">
        <button className={control} disabled={!duration || !!mediaError || loading} onClick={() => { if (playing) pause(); else void videoRef.current?.play().catch(() => setMediaError('视频播放失败，请重新加载视频后重试。')); }}>{playing ? <Pause size={13} /> : <Play size={13} />}{playing ? '暂停视频' : '播放视频'}</button>
        <button className={control} disabled={!url} onClick={reloadPreview}><RotateCw size={13} />重新加载视频</button>
        <button className={control} disabled={locked || !duration || !!mediaError || rows.length >= 100} onClick={() => { pause(); onAdd(videoRef.current?.currentTime || 0); }}><Plus size={14} />在当前时间添加点位</button>
      </div>
      <span className="font-mono tabular-nums">{pointLabel(time)} / {pointLabel(duration)}</span><span>{points.length} 个范围{unlocatedCount > 0 && ` · ${unlocatedCount} 条需求待定位`}</span>
      {loading && !mediaError && <span role="status">正在加载视频画面…</span>}
    </div>
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
      <input type="range" aria-label="视频点位播放头" min={0} max={duration || 1} step={0.001} value={Math.min(time, duration)} disabled={!duration} onChange={e => seek(Number(e.target.value))} className="w-full accent-emerald-600" />
      <BatchSfxRanges rows={rows} videoId={asset.id} duration={duration} time={time} selectedId={selected?.id} selectedOccurrenceIndex={activeOccurrenceIndex} locked={locked || !!mediaError} onSelect={locate} onAdd={point => { seek(point); onAdd(point); }} onChange={(id, start, end, occurrenceIndex) => { pause(); onMove(id, start, end, occurrenceIndex); }} />
      <p className="text-[10px] text-slate-400">点击范围展开需求与试听；按住中间拖动整体位置，拖动两端调整长短。重叠范围分行显示，双击空白处新增。分析范围为画面建议，可试听校准。</p>
    </div>
    {selected && <div className="flex flex-wrap items-end gap-2 rounded-xl bg-emerald-50/60 p-3">
      <label className="text-[11px] text-slate-600">开始（秒）<input aria-label="当前音效范围开始秒数" type="number" min={0} max={duration} step="0.001" value={selectedRange?.start ?? ''} disabled={locked} onChange={e => onMove(selected.id, e.target.value === '' ? undefined : Number(e.target.value), undefined, activeOccurrenceIndex)} className="ml-2 w-24 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs" /></label>
      <label className="text-[11px] text-slate-600">结束（秒）<input aria-label="当前音效范围结束秒数" type="number" min={selectedRange?.start ?? 0} max={duration} step="0.001" value={selectedRange?.end ?? ''} disabled={locked || !selectedRange} onChange={e => { if (e.target.value !== '') onMove(selected.id, selectedRange?.start, Number(e.target.value), activeOccurrenceIndex); }} className="ml-2 w-24 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs" /></label>
      <span className="mb-2 text-xs text-emerald-700">{selectedRange && `${(selectedRange.end - selectedRange.start).toFixed(3)} 秒 · `}{selected.name}{!!selected.occurrences?.length && ` · 复用位置 ${activeOccurrenceIndex + 1}/${selected.occurrences.length + 1}`}</span><button className={control} disabled={locked || !duration} onClick={() => onMove(selected.id, Math.min(duration - 0.001, videoRef.current?.currentTime || 0), undefined, activeOccurrenceIndex)}>使用当前播放位置</button><button className={`${control} hover:!text-red-600`} disabled={locked} onClick={() => onDelete(selected.id)}><Trash2 size={13} />删除需求及全部范围</button></div>}
  </section>;
}
