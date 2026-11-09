import React, { useMemo, useRef, useState } from 'react';
import { layoutBatchTimeRanges, moveBatchTimeRange, resizeBatchTimeRange, updateBatchOccurrence, type BatchTimeRange } from '../services/batchVideoTimeline';
import type { BatchRow } from '../services/sfxBatchProject';

export const rangeTimeLabel = (time: number) => {
  const ms = Math.round(time * 1000);
  return `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
};
type Drag = { id: string; occurrenceIndex: number; edge: 'start' | 'end' | 'move'; range: BatchTimeRange; initial: BatchTimeRange; pointerTime: number; clientX: number; moved: boolean };

export default function BatchSfxRanges({ rows, videoId, duration, time, selectedId, selectedOccurrenceIndex = 0, locked, onSelect, onAdd, onChange }: {
  rows: BatchRow[]; videoId: string; duration: number; time: number; selectedId?: string; locked: boolean;
  selectedOccurrenceIndex?: number;
  onSelect: (row: BatchRow, occurrenceIndex: number) => void; onAdd: (time: number) => void; onChange: (id: string, start: number, end: number, occurrenceIndex: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef(drag);
  const suppressClick = useRef(false);
  const items = useMemo(() => layoutBatchTimeRanges(rows, videoId, duration), [rows, videoId, duration]);
  const lanes = items.reduce((max, item) => Math.max(max, item.lane + 1), 1);
  const pointerTime = (event: React.PointerEvent) => {
    const box = railRef.current!.getBoundingClientRect();
    return (event.clientX - box.left) / box.width * duration;
  };
  const updateDrag = (event: React.PointerEvent) => {
    const current = dragRef.current;
    if (!current) return;
    const moved = current.moved || Math.abs(event.clientX - current.clientX) >= 3;
    const next = { ...current, moved, range: !moved ? current.initial : current.edge === 'move'
      ? moveBatchTimeRange(current.initial, pointerTime(event) - current.pointerTime, duration)
      : resizeBatchTimeRange(current.initial, current.edge, pointerTime(event), duration) };
    dragRef.current = next; setDrag(next);
  };
  const finishDrag = (event: React.PointerEvent, commit: boolean) => {
    if (!dragRef.current) return;
    if (commit) updateDrag(event);
    const current = dragRef.current!;
    dragRef.current = null; setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (current.edge === 'move') suppressClick.current = current.moved;
    if (commit && current.moved) {
      onChange(current.id, current.range.start, current.range.end, current.occurrenceIndex);
      const row = rows.find(row => row.id === current.id);
      if (row) onSelect(updateBatchOccurrence(row, current.occurrenceIndex, current.range.start, current.range.end), current.occurrenceIndex);
    } else if (commit && current.edge !== 'move') {
      const row = rows.find(row => row.id === current.id);
      if (row) onSelect(row, current.occurrenceIndex);
    }
  };
  const startDrag = (event: React.PointerEvent, row: BatchRow, edge: Drag['edge'], initial: BatchTimeRange, occurrenceIndex: number) => {
    suppressClick.current = false;
    if (event.button !== 0 || locked) return;
    event.preventDefault(); event.stopPropagation();
    const current = { id: row.id, occurrenceIndex, edge, initial, range: initial, pointerTime: pointerTime(event), clientX: event.clientX, moved: false };
    dragRef.current = current; setDrag(current);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  return <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
    <div ref={railRef} aria-label="视频音效范围" className="relative min-h-16" style={{ height: Math.max(64, lanes * 38 + 12) }} onDoubleClick={event => {
      if (locked || !duration || event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      onAdd(Math.max(0, Math.min(duration - 0.001, (event.clientX - box.left) / box.width * duration)));
    }}>
      <span className="pointer-events-none absolute inset-y-0 z-10 w-px bg-slate-400" style={{ left: `${duration ? time / duration * 100 : 0}%` }} />
      {items.map(({ row, index, occurrenceIndex, range: originalRange, lane }) => {
        const range = drag?.id === row.id && drag.occurrenceIndex === occurrenceIndex ? drag.range : originalRange;
        const selected = selectedId === row.id && selectedOccurrenceIndex === occurrenceIndex;
        return <div key={`${row.id}:${occurrenceIndex}`} className={`absolute h-8 min-w-[6px] overflow-hidden rounded-md border ${selected ? 'z-20 border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-300 bg-emerald-100 text-emerald-800'}`}
          style={{ left: `${range.start / duration * 100}%`, width: `${(range.end - range.start) / duration * 100}%`, top: lane * 38 + 6 }}>
          <button type="button" aria-label={`选择音效范围${index + 1} ${rangeTimeLabel(range.start)}至${rangeTimeLabel(range.end)}`} aria-pressed={selected}
            title={`${row.name} · ${rangeTimeLabel(range.start)}—${rangeTimeLabel(range.end)} · 按住拖动整体移动，方向键微调0.1秒`}
            onClick={event => { if (event.detail && suppressClick.current) { suppressClick.current = false; return; } onSelect(row, occurrenceIndex); }}
            onPointerDown={event => startDrag(event, row, 'move', range, occurrenceIndex)} onPointerMove={updateDrag} onPointerUp={event => finishDrag(event, true)} onPointerCancel={event => finishDrag(event, false)}
            onKeyDown={event => {
              if (locked || event.ctrlKey || event.metaKey || event.altKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const delta = event.key === 'Home' ? -duration : event.key === 'End' ? duration : (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : 0.1);
              const next = moveBatchTimeRange(range, delta, duration);
              onChange(row.id, next.start, next.end, occurrenceIndex); onSelect(updateBatchOccurrence(row, occurrenceIndex, next.start, next.end), occurrenceIndex);
            }}
            className={`absolute inset-0 w-full touch-none select-none truncate px-0.5 text-left text-[10px] font-semibold ${locked ? 'cursor-pointer' : drag?.id === row.id && drag.edge === 'move' ? 'cursor-grabbing' : 'cursor-grab'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700`}>{index + 1}. {row.name}</button>
          {(['start', 'end'] as const).map(edge => <button key={edge} type="button" role="slider" aria-label={`音效${index + 1}范围${edge === 'start' ? '开始' : '结束'}拖柄`}
            aria-valuemin={edge === 'start' ? 0 : range.start + 0.001} aria-valuemax={edge === 'start' ? range.end - 0.001 : duration}
            aria-valuenow={edge === 'start' ? range.start : range.end} aria-valuetext={`${(edge === 'start' ? range.start : range.end).toFixed(3)} 秒`}
            disabled={locked} title="拖动调整范围，方向键微调0.1秒" style={{ width: 'min(10px, 25%)' }} className={`absolute inset-y-0 z-10 touch-none cursor-ew-resize rounded-sm bg-black/15 hover:bg-black/30 focus-visible:outline-2 focus-visible:outline-emerald-900 disabled:cursor-not-allowed ${edge === 'start' ? 'left-0' : 'right-0'}`}
            onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
            onPointerDown={event => startDrag(event, row, edge, range, occurrenceIndex)} onPointerMove={updateDrag} onPointerUp={event => finishDrag(event, true)} onPointerCancel={event => finishDrag(event, false)}
            onKeyDown={event => {
              if (event.ctrlKey || event.metaKey || event.altKey) return;
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const current = edge === 'start' ? range.start : range.end;
              const value = event.key === 'Home' ? 0 : event.key === 'End' ? duration : current + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : 0.1);
              const next = resizeBatchTimeRange(range, edge, value, duration);
              onChange(row.id, next.start, next.end, occurrenceIndex); onSelect(updateBatchOccurrence(row, occurrenceIndex, next.start, next.end), occurrenceIndex);
            }} />)}
        </div>;
      })}
    </div>
  </div>;
}
