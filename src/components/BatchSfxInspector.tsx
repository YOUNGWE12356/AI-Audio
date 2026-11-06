import React from 'react';
import { Check, Search, Sparkles, X } from 'lucide-react';
import GeneratedAudioPlayer from './GeneratedAudioPlayer';
import BatchSfxCostHint from './BatchSfxCostHint';
import { isBatchSfxDurationValid } from '../services/sfxBatchBilling';
import type { BatchRow, BatchVersion } from '../services/sfxBatchProject';
import type { BatchTimeRange } from '../services/batchVideoTimeline';
import type { AudioDownloadRange } from '../services/audioRangeExport';

const control = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-emerald-400 disabled:opacity-40';
const input = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none';

export default function BatchSfxInspector({ row, index, version, chosen, locked, inline, range, hasVideo, activeAudioId,
  setActiveAudioId, onClose, onEdit, onRun, onSelectVersion, onDecoded, onRange, onConfirm }: {
  row?: BatchRow; index: number; version?: BatchVersion; chosen?: BatchVersion; locked: boolean; inline: boolean;
  range: BatchTimeRange | null; hasVideo: boolean; activeAudioId: string | null; setActiveAudioId: (id: string | null) => void;
  onClose: () => void; onEdit: (update: Partial<BatchRow>) => void;
  onRun: (kind: 'search' | 'generate') => void; onSelectVersion: (version: BatchVersion) => void;
  onDecoded: (duration: number) => void; onRange: (range: AudioDownloadRange | null) => void;
  onConfirm: (blob: Blob, range: AudioDownloadRange) => void;
}) {
  const field = inline ? `${input} !px-2 !py-1.5` : input;
  return <section aria-label={inline ? '范围音效需求与试听' : '当前音效试听与剪辑'} className={`min-w-0 rounded-2xl border bg-white ${inline ? 'border-emerald-200 p-3 space-y-2' : 'border-slate-200 p-4 space-y-4 xl:sticky xl:top-4'}`}>
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-slate-800">{inline ? '当前范围 · 音效需求与试听' : '试听与剪辑'}</h3>{inline ? <button type="button" className={control} aria-label="收起范围音效详情" onClick={onClose}><X size={13} />收起</button> : <span className="text-[11px] text-slate-500">保留原音频，可恢复选区</span>}</div>
    <div className={inline ? 'grid gap-3 lg:grid-cols-[minmax(0,1fr)_350px] 2xl:grid-cols-[minmax(0,1fr)_400px]' : 'space-y-4'}>
      <div className={`min-w-0 ${inline ? 'space-y-2' : 'space-y-3'}`}>
        {row && <>{!inline && <p className="text-xs font-semibold text-emerald-700 break-all">{index + 1}. {row.name}</p>}
          {inline ? <div className="grid gap-2 sm:grid-cols-2 text-[11px] text-slate-500">
            <label className="block">音效命名<input aria-label="当前范围音效命名" className={field} value={row.name} disabled={locked} onChange={event => onEdit({ name: event.target.value })} /></label>
            <label className="block">场景<input aria-label="当前范围音效场景" className={field} value={row.scene} disabled={locked} onChange={event => onEdit({ scene: event.target.value })} /></label>
            <label className="block sm:col-span-2">音效需求<textarea aria-label="当前范围音效描述" rows={2} className={`${field} resize-y`} value={row.description} disabled={locked} onChange={event => onEdit({ description: event.target.value })} /></label>
            <label className="sm:col-span-2">关键词<input aria-label="当前范围音效关键词" placeholder="用中文填写，例如：木门吱呀" className={field} value={row.keywords} disabled={locked} onChange={event => onEdit({ keywords: event.target.value })} /><span className="mt-1 block text-[10px] text-slate-400">搜索或生成时自动转换为英文。</span></label>
          </div> : <p className="text-[11px] leading-relaxed text-slate-500">{row.description}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><button className={control} disabled={locked} onClick={() => onRun('search')}><Search size={13} />{row.versions.some(v => v.kind === 'search') ? '再次搜索' : '搜索音效'}</button><BatchSfxCostHint kind="search" rows={[row]} compact /></div>
            <div className="space-y-1.5"><button className={control} disabled={locked || !isBatchSfxDurationValid(row.duration)} onClick={() => onRun('generate')}><Sparkles size={13} />{row.versions.some(v => v.kind === 'generate') ? '再次生成' : '生成音效'}</button><BatchSfxCostHint kind="generate" rows={[row]} compact /></div>
          </div>
        </>}
        {row && hasVideo && <p className={inline ? 'text-[11px] text-slate-600' : 'text-xs text-slate-600'}>视频范围：{range ? `${range.start.toFixed(3)}—${range.end.toFixed(3)} 秒 · ${(range.end - range.start).toFixed(3)} 秒` : '未设置，请在需求表填写范围'}</p>}
      </div>
      <div className={`min-w-0 ${inline ? 'space-y-2' : 'space-y-3'}`}>
        {row && <div role="status" className={`rounded-lg border text-xs ${inline ? 'p-2' : 'p-3'} ${chosen ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{chosen ? <><p className="flex items-center gap-1.5 font-semibold"><Check size={14} />{inline ? `已确认 · ${chosen.title}` : '已确认音效 · 这条需求已完成选用'}</p>{!inline && <p className="mt-1 break-words">选用版本：{chosen.title}</p>}{version?.id !== chosen.id && <p className="mt-1 text-[10px]">当前正在试听其他版本，点击“确认音效”可更换选用。</p>}</> : inline ? '待确认：试听后点击“确认音效”。' : '尚未确认音效：试听满意后，点击波形下方的“确认音效”。'}</div>}
        {!row?.versions.length && <div className={`rounded-xl bg-slate-50 text-center text-xs text-slate-400 ${inline ? 'p-4' : 'p-8'}`}>搜索或生成音效后，在这里试听并确认音效。</div>}
        {!!row?.versions.length && <div className={inline ? 'flex gap-1.5 max-h-20 overflow-auto' : 'max-h-48 overflow-y-auto space-y-2'}>{row.versions.map((item, i) => <button key={item.id} disabled={locked} onClick={() => onSelectVersion(item)} title={item.kind === 'generate' ? 'AI 生成' : `${item.source} · 点击读取试听`} className={`text-left rounded-lg border text-xs ${inline ? 'shrink-0 px-2 py-1' : 'w-full p-2.5'} ${version?.id === item.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}><span className="flex gap-2 items-center text-slate-700">{chosen?.id === item.id && <Check size={13} className="text-emerald-600" />}{i + 1}. {item.title}</span>{!inline && <span className="text-[10px] text-slate-400">{item.kind === 'generate' ? 'AI 生成' : `${item.source} · 点击读取试听`}</span>}</button>)}</div>}
        {version?.sourceUrl && <a href={version.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-emerald-700 underline">查看素材来源与许可</a>}
        {version?.url && row && <GeneratedAudioPlayer key={version.id} id={version.id} url={version.url} title={row.name} activeId={activeAudioId} setActiveId={setActiveAudioId} compact={inline} enableRangeDownload hideDownloads initialRange={version.draftRange} confirmLabel={chosen?.id === version.id ? '已确认音效' : '确认音效'} confirmationHint={inline ? '拖动波形裁剪，试听后确认音效。' : '试听满意后点击“确认音效”，将当前版本选用于这条需求。可先裁剪；不裁剪则使用完整音频。'} onDecoded={onDecoded} onSelectionChange={onRange} onConfirm={onConfirm} />}
        {!inline && chosen?.confirmedRange && <p className="text-xs text-emerald-700 flex items-center gap-2"><Check size={14} />下载版本：{chosen.title} · 已确认 {(chosen.confirmedRange.end - chosen.confirmedRange.start).toFixed(2)} 秒</p>}
        {row?.error && <p className="text-xs text-red-600">{row.error}</p>}
        {!inline && <p className="text-[10px] leading-relaxed text-slate-400">“确认音效”保存选用版本及剪辑范围，单独下载和打包使用该版本。再次搜索或生成不会自动更换已确认音效。搜索素材使用前请核对来源许可。</p>}
      </div>
    </div>
  </section>;
}
