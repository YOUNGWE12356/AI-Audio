import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Download, FileUp, Loader2, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import BatchSfxInspector from './BatchSfxInspector';
import BatchSfxVideo from './BatchSfxVideo';
import { analyzeBatchRequirements, prepareSfxBatchInput, resolveBatchSearchQuery, saveBatchDownload, SFX_BATCH_ACCEPT, validateSfxBatchFile } from '../services/sfxBatchClient';
import { batchFileStem, batchRequirementsCsv, batchSearchWordCount, createBatchSfxRequest, existingBatchSearchQuery, SFX_BATCH_MAX_ROWS, uniqueBatchFileNames } from '../services/sfxBatch';
import { batchId, clearBatchWorkspace, confirmedVersion, loadBatchProject, loadBatchVideo, saveBatchVideo, sameBatchRange, saveBatchProject, type BatchRow, type BatchVersion, type BatchVideoAsset } from '../services/sfxBatchProject';
import { batchTimeRange, isBatchPoint } from '../services/batchVideoTimeline';
import { readGeneratedSoundEffectDuration } from '../utils/soundEffectAudio';
import type { AudioDownloadRange } from '../services/audioRangeExport';

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none';
const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed';
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';

async function api(path: string, body: unknown, timeout = 150_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || data.message || `请求失败（${response.status}）`);
    }
    // Consume the body before releasing the timeout.
    return path.includes('sound-effect') ? await response.blob() : await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error('请求超时，请稍后重试；生成请求不会自动重复扣费。');
    throw error;
  } finally { clearTimeout(timer); }
}

export default function BatchSfxStudio({ active = true }: { active?: boolean }) {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const [hydrated, setHydrated] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [videoAsset, setVideoAsset] = useState<BatchVideoAsset | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const videoRef = useRef(videoAsset); videoRef.current = videoAsset;
  const videoSaveQueue = useRef(Promise.resolve());
  const projectSaveQueue = useRef(Promise.resolve());
  const projectSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [instructions, setInstructions] = useState('');
  const [append, setAppend] = useState(true);
  const [sourceExpanded, setSourceExpanded] = useState(true);
  const [activeRowId, setActiveRowId] = useState('');
  const [timelineDetails, setTimelineDetails] = useState(false);
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const busyRef = useRef(false);
  const stopRef = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const [zipping, setZipping] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const urls = useRef(new Set<string>());
  useEffect(() => {
    if (timelineDetails) detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [timelineDetails, activeRowId]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([loadBatchProject(), loadBatchVideo()]).then(([saved, video]) => {
      if (!mounted) { saved.forEach(r => r.versions.forEach(v => { if (v.url?.startsWith('blob:')) URL.revokeObjectURL(v.url); })); return; }
      saved.forEach(r => r.versions.forEach(v => { if (v.url?.startsWith('blob:')) urls.current.add(v.url); }));
      setRows(saved); setActiveRowId(saved[0]?.id || ''); setSourceExpanded(!saved.length);
      setVideoAsset(video); if (video) setFile(video.file);
    }).catch(() => { if (mounted) setStorageWarning('浏览器存储不可用，离开页面后本次制作可能丢失，请及时下载。'); })
      .finally(() => { if (mounted) setHydrated(true); });
    return () => { mounted = false; stopRef.current = true; urls.current.forEach(url => URL.revokeObjectURL(url)); };
  }, []);
  useEffect(() => {
    if (!hydrated || clearing) return;
    const timer = setTimeout(() => {
      projectSaveTimer.current = null;
      projectSaveQueue.current = projectSaveQueue.current.then(() => saveBatchProject(rows)).catch(() => setStorageWarning('本地保存失败，可能存储空间不足，请及时下载已确认音效。'));
    }, 700);
    projectSaveTimer.current = timer;
    return () => clearTimeout(timer);
  }, [rows, hydrated, clearing]);

  const patchRow = (id: string, update: Partial<BatchRow> | ((row: BatchRow) => BatchRow)) => {
    setRows(current => current.map(row => row.id !== id ? row : typeof update === 'function' ? update(row) : { ...row, ...update }));
  };
  const patchVersion = (rowId: string, versionId: string, update: (v: BatchVersion) => BatchVersion) => {
    patchRow(rowId, row => ({ ...row, versions: row.versions.map(v => v.id === versionId ? update(v) : v) }));
  };
  const ownUrl = (blob: Blob) => { const url = URL.createObjectURL(blob); urls.current.add(url); return url; };
  const storeVideo = (video: BatchVideoAsset | null) => {
    setVideoAsset(video); setVideoDuration(0);
    videoSaveQueue.current = videoSaveQueue.current.then(() => saveBatchVideo(video)).catch(() => setStorageWarning('视频本地保存失败，请重新上传视频；音效需求和已制作音频会继续保存。'));
  };
  const clearWorkspace = async () => {
    if (busyRef.current || !hydrated || zipping || clearing) return;
    busyRef.current = true; setClearing(true); setError('');
    if (projectSaveTimer.current !== null) clearTimeout(projectSaveTimer.current);
    try {
      // Finish earlier writes before deleting, so autosave cannot restore the old workspace.
      await Promise.all([projectSaveQueue.current, videoSaveQueue.current]);
      await clearBatchWorkspace();
      setActiveAudioId(null); setTimelineDetails(false); setActiveRowId('');
      setRows([]); setFile(null); setVideoAsset(null); setVideoDuration(0);
      setInstructions(''); setAppend(true); setSourceExpanded(true); setStorageWarning('');
      setShowClearConfirm(false);
      if (inputRef.current) inputRef.current.value = '';
      urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear();
      setMessage('工作区已清空，可上传新素材开始制作。');
    } catch (e) { setError(`清空失败，工作区已保留：${errorText(e)}`); }
    finally { busyRef.current = false; setClearing(false); }
  };
  const chooseFile = (next: File) => {
    try {
      const kind = validateSfxBatchFile(next);
      setFile(next); setError(''); setSourceExpanded(true); setTimelineDetails(false); setActiveAudioId(null);
      if (kind === 'video') storeVideo({ id: batchId(), file: next });
      else if (videoAsset) storeVideo(null);
    }
    catch (e) { setError(errorText(e)); }
  };
  const analyze = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('正在准备分析素材…');
    try {
      const input = await prepareSfxBatchInput(file, instructions, setMessage);
      const analysisVideo = file && validateSfxBatchFile(file) === 'video' ? videoAsset : null;
      const analysis = await analyzeBatchRequirements({ ...input, ...(analysisVideo && videoDuration ? { videoDuration } : {}) }, setMessage);
      const requirements = analysis.items;
      if (analysisVideo && videoRef.current?.id !== analysisVideo.id) throw new Error('视频已更换，请重新分析当前视频。');
      const excluded = analysis.excludedItems.length ? `另有${analysis.excludedItems.length}条非音效需求未进入音效制作：${analysis.excludedItems.map(item => `${item.name}（${item.reason}）`).join('；')}。` : '';
      const inventory = analysis.sourceItemCount !== undefined ? `原表共${analysis.sourceItemCount}条，已逐条核对。` : '';
      if (!requirements.length) {
        if (analysis.excludedItems.length) { setMessage(`${inventory}${excluded}当前列表已保留。`); return; }
        throw new Error('未识别到音效需求，请补充场景说明或更清晰的素材。');
      }
      if ((append ? rowsRef.current.length : 0) + requirements.length > SFX_BATCH_MAX_ROWS) throw new Error(`合并后超过${SFX_BATCH_MAX_ROWS}条，请分批制作或关闭“追加到现有列表”。`);
      const next = requirements.map(row => {
        const range = analysisVideo ? batchTimeRange(row, videoDuration) : null;
        return { ...row, ...(analysisVideo ? { videoId: analysisVideo.id } : {}),
          ...(range ? { endTime: range.end, duration: Math.max(0.5, Math.min(30, range.end - range.start)) } : {}),
          selected: true, versions: [], excludedSources: [], status: '待制作' };
      });
      setRows(current => append ? [...current, ...next] : next);
      const unlocatedCount = analysisVideo ? next.filter(row => !batchTimeRange(row, videoDuration)).length : 0;
      setActiveRowId(next[0].id); setSourceExpanded(false); setMessage(`${inventory}分析完成，新增 ${next.length} 条音效需求。${excluded}${unlocatedCount ? `其中 ${unlocatedCount} 条待定位，可在需求表填写范围。` : ''}`);
    } catch (e) { setError(errorText(e)); setMessage(''); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const add = (time?: number) => {
    if (busyRef.current || !hydrated || rowsRef.current.length >= SFX_BATCH_MAX_ROWS) return;
    if (time !== undefined && videoDuration) time = Math.max(0, Math.min(videoDuration - 0.001, time));
    const id = batchId();
    setRows(current => [...current, { id, name: `Sfx_${current.length + 1}`, description: '', keywords: '', searchQuery: '', duration: 3, scene: '', selected: true, versions: [], excludedSources: [], status: '待制作', ...(videoAsset ? { videoId: videoAsset.id, time, ...(time !== undefined ? { endTime: Math.min(videoDuration, time + 3) } : {}) } : {}) }]);
    setActiveRowId(id);
    if (time !== undefined) setTimelineDetails(true);
    setActiveAudioId(null);
  };
  const movePoint = (id: string, time: number | undefined, endTime?: number) => {
    if (busyRef.current) return;
    if (time === undefined) { setError(''); patchRow(id, { time: undefined, endTime: undefined, videoId: videoAsset?.id }); return; }
    const row = rowsRef.current.find(row => row.id === id);
    if (!row || !isBatchPoint(time, videoDuration)) { setError('范围开始须在视频时长内，且不能等于视频结束时间。'); return; }
    const previous = row.videoId === videoAsset?.id ? batchTimeRange(row, videoDuration) : null;
    const end = endTime ?? (previous && previous.end > time ? previous.end : Math.min(videoDuration, time + (previous ? previous.end - previous.start : row.duration || 3)));
    if (!Number.isFinite(end) || end <= time || end > videoDuration) { setError('范围结束须大于开始时间，且不能超过视频时长。'); return; }
    setError(''); patchRow(id, { time, endTime: end, duration: Math.max(0.5, Math.min(30, Math.round((end - time) * 1000) / 1000)), videoId: videoAsset?.id });
  };
  const capture = async (rowId: string, version: BatchVersion) => {
    if (version.blob && version.url) return;
    patchRow(rowId, { status: '正在读取试听音频…' });
    const result = await api('/api/ai/sfx-batch/capture', { id: version.ticketId }, 65_000);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 35_000);
    let blob: Blob;
    try {
      const response = await fetch(result.url, { signal: controller.signal });
      if (!response.ok) throw new Error('试听音频下载失败，请重新搜索。');
      blob = await response.blob();
    } finally { clearTimeout(timer); }
    const url = ownUrl(blob);
    patchVersion(rowId, version.id, v => ({ ...v, blob, url }));
    patchRow(rowId, { status: '待试听与确认' });
  };
  const makeRow = async (row: BatchRow, kind: 'search' | 'generate') => {
    if (!existingBatchSearchQuery(row.searchQuery)) patchRow(row.id, { status: '正在将需求提炼为英文搜索词…', error: undefined });
    const searchQuery = await resolveBatchSearchQuery({ searchQuery: row.searchQuery, keywords: row.keywords, description: row.description });
    if (searchQuery !== row.searchQuery) patchRow(row.id, { searchQuery });
    const request = createBatchSfxRequest({ ...row, searchQuery }, kind, row.excludedSources);
    patchRow(row.id, { status: kind === 'search' ? '正在搜索…' : '正在生成音效…', error: undefined });
    if (kind === 'search') {
      const result = await api(request.endpoint, request.body, 65_000);
      if (!result.items?.length) throw new Error(result.message || '没有找到新的相关素材，请修改搜索词后重试。');
      const versions: BatchVersion[] = result.items.map((item: any) => ({ id: batchId(), title: item.title, source: item.source, sourceUrl: item.sourceUrl, ticketId: item.id, kind: 'search' }));
      patchRow(row.id, current => ({ ...current, versions: [...current.versions, ...versions], activeVersionId: versions[0].id,
        excludedSources: [...new Set([...current.excludedSources, ...versions.map(v => v.sourceUrl!).filter(Boolean)])] }));
      await capture(row.id, versions[0]);
    } else {
      const blob = await api(request.endpoint, request.body) as Blob;
      const duration = await readGeneratedSoundEffectDuration(blob);
      const version: BatchVersion = { id: batchId(), title: `生成版本 ${row.versions.filter(v => v.kind === 'generate').length + 1}`, kind, blob, url: ownUrl(blob), duration };
      patchRow(row.id, current => ({ ...current, versions: [...current.versions, version], activeVersionId: version.id, status: '待试听与确认' }));
    }
  };
  const run = async (kind: 'search' | 'generate', ids: string[]) => {
    if (busyRef.current || !ids.length) return;
    busyRef.current = true; stopRef.current = false; setBusy(true); setQueueing(true); setError('');
    let completed = 0, failed = 0;
    for (const id of ids) {
      if (stopRef.current) break;
      const row = rowsRef.current.find(r => r.id === id); if (!row) continue;
      setActiveRowId(id); setMessage(`${kind === 'search' ? '搜索' : '生成'} ${completed + failed + 1}/${ids.length}：${row.name}`);
      try { await makeRow(row, kind); completed++; }
      catch (e) { failed++; patchRow(id, { status: '制作失败，可重试', error: errorText(e) }); }
      finally { window.dispatchEvent(new Event('ai-audio:usage-updated')); }
    }
    setMessage(`${stopRef.current ? '队列已停止。' : '本轮完成。'}成功 ${completed} 条，失败 ${failed} 条${completed ? '，请试听并点击“确认音效”完成选用。' : '。'}`);
    busyRef.current = false; setBusy(false); setQueueing(false);
  };
  const selectVersion = async (rowId: string, version: BatchVersion) => {
    if (busyRef.current) return;
    setActiveAudioId(null); patchRow(rowId, { activeVersionId: version.id, error: undefined });
    if (version.url) return;
    busyRef.current = true; setBusy(true); setMessage(`正在读取候选：${version.title}`);
    try { await capture(rowId, version); setMessage('候选音频已就绪，请试听并点击“确认音效”完成选用。'); }
    catch (e) { patchRow(rowId, { status: '试听读取失败', error: errorText(e) }); setMessage(''); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const onRange = (rowId: string, versionId: string, range: AudioDownloadRange | null) => {
    patchRow(rowId, row => {
      const version = row.versions.find(v => v.id === versionId);
      if (!version || sameBatchRange(version.draftRange, range, version.duration || version.confirmedRange?.end)) return row;
      const invalidate = !!version.confirmedBlob && !sameBatchRange(range, version.confirmedRange, version.duration || version.confirmedRange?.end);
      return { ...row, status: invalidate ? '剪辑已修改，请重新确认' : row.status, versions: row.versions.map(v => v.id === versionId
        ? { ...v, draftRange: range, ...(invalidate ? { confirmedBlob: undefined, confirmedRange: undefined } : {}) } : v) };
    });
  };
  const confirm = (rowId: string, versionId: string, blob: Blob, range: AudioDownloadRange) => {
    patchRow(rowId, row => ({ ...row, confirmedVersionId: versionId, status: '已确认音效', error: undefined, versions: row.versions.map(v => v.id === versionId
      ? { ...v, confirmedBlob: blob, confirmedRange: range, draftRange: range } : v) }));
    setMessage('音效已确认，这条需求已完成选用；可以下载或继续制作下一条。');
  };
  const csv = () => batchRequirementsCsv(rows.map(row => {
    const range = confirmedVersion(row)?.confirmedRange;
    const videoRange = row.videoId === videoAsset?.id ? batchTimeRange(row, videoDuration) : null;
    return { ...row, ...(videoRange ? { endTime: videoRange.end } : {}), confirmedDuration: range ? Number((range.end - range.start).toFixed(3)) : undefined };
  }));
  const downloadTable = () => saveBatchDownload(new Blob([csv()], { type: 'text/csv;charset=utf-8' }), '音效需求表.csv');
  const ready = rows.filter(row => confirmedVersion(row));
  const zip = async () => {
    if (!ready.length || zipping) return;
    setZipping(true); setError('');
    try {
      const JSZip = (await import('jszip')).default, archive = new JSZip();
      const names = uniqueBatchFileNames(ready.map(row => row.name));
      ready.forEach((row, index) => archive.file(names[index], confirmedVersion(row)!.confirmedBlob!));
      archive.file('音效需求表.csv', csv());
      archive.file('素材来源.txt', ready.map((row, index) => {
        const version = confirmedVersion(row)!;
        return `${names[index]}\n${version.kind === 'generate' ? 'AI 生成' : `${version.source || ''}\n${version.sourceUrl || ''}`}`;
      }).join('\n\n') + '\n\n搜索素材请遵守对应来源的许可要求。');
      saveBatchDownload(await archive.generateAsync({ type: 'blob', compression: 'STORE' }), '批量音效.zip');
      setMessage(`已打包 ${ready.length} 条已确认音效${rows.length > ready.length ? `，另有 ${rows.length - ready.length} 条未确认，未包含在音频包中` : ''}。`);
    } catch (e) { setError(errorText(e)); } finally { setZipping(false); }
  };
  const selectedIds = rows.filter(row => row.selected).map(row => row.id);
  const activeRow = rows.find(row => row.id === activeRowId) || rows[0];
  const activeVersion = activeRow?.versions.find(v => v.id === activeRow.activeVersionId);
  const chosenVersion = activeRow ? confirmedVersion(activeRow) : undefined;
  const locked = busy || clearing || !hydrated;
  const selectRow = (id: string) => {
    if (id !== activeRow?.id) { setActiveRowId(id); setActiveAudioId(null); }
  };
  const selectVideoRange = (id: string) => {
    selectRow(id); setTimelineDetails(true);
    const row = rowsRef.current.find(row => row.id === id);
    if (!row) return;
    const version = confirmedVersion(row) || row.versions.find(version => version.id === row.activeVersionId) || row.versions[0];
    if (version && version.id !== row.activeVersionId) void selectVersion(id, version);
    else if (version && !version.url) void selectVersion(id, version);
  };
  const editSearchQuery = (id: string, searchQuery: string) => patchRow(id, row => ({ ...row, searchQuery, error: undefined,
    status: row.error ? confirmedVersion(row) ? '已确认剪辑' : row.versions.length ? '待试听与确认' : '待制作' : row.status,
  }));
  const showTimelineDetails = timelineDetails && !!videoAsset && activeRow?.videoId === videoAsset.id;
  const activeRange = activeRow && activeRow.videoId === videoAsset?.id ? batchTimeRange(activeRow, videoDuration) : null;
  const inspector = <BatchSfxInspector row={activeRow} index={activeRow ? rows.indexOf(activeRow) : 0} version={activeVersion} chosen={chosenVersion} locked={locked} inline={showTimelineDetails} range={activeRange} hasVideo={!!videoAsset}
    activeAudioId={activeAudioId} setActiveAudioId={setActiveAudioId} onClose={() => setTimelineDetails(false)}
    onEdit={update => { if (activeRow) patchRow(activeRow.id, update); }} onQuery={query => { if (activeRow) editSearchQuery(activeRow.id, query); }}
    onRun={kind => { if (activeRow) void run(kind, [activeRow.id]); }}
    onSelectVersion={version => { if (activeRow) void selectVersion(activeRow.id, version); }}
    onDecoded={duration => { if (activeRow && activeVersion) patchVersion(activeRow.id, activeVersion.id, v => v.duration === duration ? v : { ...v, duration }); }}
    onRange={range => { if (activeRow && activeVersion) onRange(activeRow.id, activeVersion.id, range); }}
    onConfirm={(blob, range) => { if (activeRow && activeVersion) confirm(activeRow.id, activeVersion.id, blob, range); }} />;

  return <div className="space-y-5">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-bold text-slate-800"><FileUp size={18} className="text-emerald-600" />素材与需求分析</h3><div className="flex flex-wrap items-center gap-3"><button type="button" className={`${buttonClass} hover:!border-red-300 hover:!text-red-600`} disabled={locked || queueing || zipping || (!rows.length && !file && !videoAsset && !instructions.trim())} onClick={() => setShowClearConfirm(true)}>{clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}{clearing ? '正在清空…' : '清空工作区'}</button><button type="button" className="flex items-center gap-2 text-xs text-slate-500" aria-expanded={sourceExpanded} aria-controls="batch-sfx-source" onClick={() => setSourceExpanded(current => !current)}>{sourceExpanded ? '收起分析设置' : '展开分析设置'}<ChevronDown size={16} className={`transition-transform ${sourceExpanded ? 'rotate-180' : ''}`} /></button></div></div>
      {showClearConfirm && <div role="alertdialog" aria-modal="false" aria-labelledby="batch-clear-title" aria-describedby="batch-clear-description" className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3" onKeyDown={e => { if (e.key === 'Escape' && !clearing) setShowClearConfirm(false); }}>
        <h4 id="batch-clear-title" className="text-sm font-semibold text-slate-800">清空当前工作区？</h4>
        <p id="batch-clear-description" className="text-xs leading-relaxed text-slate-600">将移除上传素材、全部音效需求、视频范围和已制作音效，并清除本地保存。清空后无法恢复，请先下载需要保留的内容。</p>
        <div className="flex flex-wrap justify-end gap-2"><button type="button" autoFocus className={buttonClass} disabled={clearing} onClick={() => setShowClearConfirm(false)}>取消</button><button type="button" className={`${buttonClass} !border-red-600 !bg-red-600 !text-white`} disabled={locked || queueing || zipping} onClick={() => void clearWorkspace()}>{clearing && <Loader2 size={14} className="animate-spin" />}确认清空</button></div>
      </div>}
        <div aria-label="批量制作素材上传区" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!locked && e.dataTransfer.files[0]) chooseFile(e.dataTransfer.files[0]); }} className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-3">
          <input ref={inputRef} type="file" className="hidden" accept={SFX_BATCH_ACCEPT} onChange={e => { if (e.target.files?.[0]) chooseFile(e.target.files[0]); e.target.value = ''; }} />
          <button className="flex items-center gap-2 text-xs font-bold text-emerald-700" disabled={locked} onClick={() => inputRef.current?.click()}><FileUp size={18} />{file ? '上传新视频 / 图片 / 需求表' : '上传视频 / 图片 / 需求表'}</button>
          <p className="mt-2 text-[11px] text-slate-500">可拖拽上传；视频最大500MB，图片与需求表最大20MB。截图可粘贴到下方文本框。</p>
          {file && <div className="mt-3 flex items-center gap-2 text-xs text-slate-700"><span className="truncate">{file.name}</span><button aria-label="移除素材" disabled={locked} onClick={() => { if (file === videoAsset?.file) storeVideo(null); setFile(null); }}><X size={14} /></button></div>}
        </div>
      <div id="batch-sfx-source" hidden={!sourceExpanded} className="space-y-4">
        <textarea aria-label="批量音效补充要求" className={`${inputClass} min-h-28 resize-y`} value={instructions} disabled={locked} placeholder="补充场景和制作要求，或直接输入音效需求；可在这里粘贴截图。" onChange={e => setInstructions(e.target.value)} onPaste={(e: React.ClipboardEvent<HTMLTextAreaElement>) => {
          const image = Array.from<File>(e.clipboardData.files).find(f => f.type.startsWith('image/'))
            || Array.from<DataTransferItem>(e.clipboardData.items).find(i => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
          if (image && !locked) { e.preventDefault(); chooseFile(image); }
        }} />
      <div className="flex flex-wrap items-center gap-3">
        <button className={`${buttonClass} !bg-emerald-600 !text-white !border-emerald-600`} disabled={locked || (!file && !instructions.trim())} onClick={() => void analyze()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}分析并列出需求</button>
        <label className="text-xs text-slate-600 flex items-center gap-1.5"><input type="checkbox" checked={append} disabled={locked} onChange={e => setAppend(e.target.checked)} />追加到现有列表</label>
        {!append && !!rows.length && <span className="text-xs text-amber-700">分析成功后将替换当前列表及其音频</span>}
      </div>
      <p className="text-[11px] text-slate-500">搜索和生成优先使用“英文搜索词”，留空时自动提炼1～2个英文词。视频仅识别新触发的动作/动效，同次动画合并，常驻背景与循环装饰不列需求；范围可手动校准。分析按实际用量计费，搜索每次1积分，AI生成每条1版、2积分/秒。</p>
      </div>
    </section>
    {videoAsset && <BatchSfxVideo asset={videoAsset} rows={rows} activeRowId={activeRowId} locked={locked} active={active} onDuration={setVideoDuration} onSelect={selectVideoRange} onAdd={add} onMove={movePoint} onDelete={id => setRows(current => current.filter(row => row.id !== id))} onBeginPlayback={() => setActiveAudioId(null)} />}
    {showTimelineDetails && <div ref={detailsRef}>{inspector}</div>}
    {(message || error || storageWarning) && <div role="status" aria-live="polite" className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">{message && <p className="text-slate-700 flex items-center gap-2">{busy && <Loader2 size={14} className="animate-spin" />}{message}</p>}{error && <p className="text-red-600">{error}</p>}{storageWarning && <p className="text-amber-700">{storageWarning}</p>}</div>}
    <div className="flex flex-wrap gap-2 items-center">
      <button className={buttonClass} disabled={locked || rows.length >= SFX_BATCH_MAX_ROWS} onClick={() => add()}><Plus size={14} />新增音效</button>
      <button className={buttonClass} disabled={locked || !selectedIds.length} onClick={() => void run('search', selectedIds)}><Search size={14} />一键搜索（{selectedIds.length}）</button>
      <button className={buttonClass} disabled={locked || !selectedIds.length} onClick={() => void run('generate', selectedIds)}><Sparkles size={14} />一键生成（{selectedIds.length}）</button>
      {queueing && <button className={buttonClass} onClick={() => { stopRef.current = true; setMessage('当前步骤完成后停止队列，已完成结果会保留。'); }}>停止后续任务</button>}
      <button className={buttonClass} disabled={!rows.length} onClick={downloadTable}><Download size={14} />下载需求表</button>
      <button className={buttonClass} disabled={!ready.length || zipping} onClick={() => void zip()}>{zipping ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}打包下载（{ready.length}）</button>
    </div>
    <div className={`grid gap-5 items-start ${showTimelineDetails ? '' : 'xl:grid-cols-[minmax(0,1fr)_350px] 2xl:grid-cols-[minmax(0,1fr)_400px]'}`}>
      <section aria-label="音效需求表" className="min-w-0 rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-wrap justify-between items-center gap-2 p-4 border-b border-slate-100 text-xs text-slate-600"><h3 className="font-bold text-slate-800">音效需求表 <span className="ml-1 font-normal text-slate-400">{rows.length} 条</span></h3><span>批量勾选 {selectedIds.length} · 已确认音效 {ready.length}/{rows.length}</span></div>
        <div className="max-h-[680px] overflow-auto">
          <table className="w-full min-w-[760px] table-fixed border-collapse text-left text-xs">
            <caption className="sr-only">可编辑音效需求表，选择一行后在右侧试听与剪辑</caption>
            <colgroup><col className="w-11" /><col className="w-[160px]" /><col /><col className="w-[180px]" /><col className="w-[70px]" /><col className="w-[88px]" /></colgroup>
            <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] text-slate-500"><tr>
              <th scope="col" className="px-3 py-3"><input type="checkbox" aria-label="全选需求" disabled={locked || !rows.length} checked={!!rows.length && selectedIds.length === rows.length} onChange={e => setRows(current => current.map(row => ({ ...row, selected: e.target.checked })))} /></th>
              <th scope="col" className="px-2 py-3 font-medium">文件命名 / 状态</th><th scope="col" className="px-2 py-3 font-medium">音效描述 / 场景</th><th scope="col" className="px-2 py-3 font-medium">关键词 / 英文搜索词</th><th scope="col" className="px-2 py-3 font-medium">时长 / 范围</th><th scope="col" className="px-2 py-3 font-medium">操作</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!rows.length && <tr><td colSpan={6} className="p-10 text-center text-slate-400">{hydrated ? '上传素材分析，或新增一条音效需求。' : '正在恢复本地项目…'}</td></tr>}
              {rows.map((row, index) => <tr key={row.id} aria-selected={activeRow?.id === row.id} onClick={() => selectRow(row.id)} onFocus={e => { if (e.target.matches('input, textarea')) selectRow(row.id); }} className={`align-top transition-colors ${activeRow?.id === row.id ? 'bg-emerald-50/60' : 'hover:bg-slate-50/60'}`}>
                <td className={`px-3 py-3 border-l-2 ${activeRow?.id === row.id ? 'border-emerald-500' : 'border-transparent'}`}><input type="checkbox" aria-label={`选择音效${index + 1}`} checked={row.selected} disabled={locked} onChange={e => patchRow(row.id, { selected: e.target.checked })} /><button aria-label={`试听音效${index + 1}`} className={`mt-3 block text-[11px] font-semibold ${activeRow?.id === row.id ? 'text-emerald-700' : 'text-slate-400'}`} onClick={() => selectRow(row.id)}>{String(index + 1).padStart(2, '0')}</button></td>
                <td className="px-2 py-3"><input aria-label={`音效${index + 1}命名`} title={row.name} className={`${inputClass} !px-2 font-medium`} value={row.name} disabled={locked} onChange={e => patchRow(row.id, { name: e.target.value })} onBlur={() => patchRow(row.id, { name: batchFileStem(row.name) })} />{confirmedVersion(row) ? <span className="mt-3 inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700"><Check size={12} />已确认音效</span> : <p className="mt-3 text-[10px] leading-4 text-slate-500">{row.status}</p>}<button className="mt-2 block text-[11px] font-semibold text-emerald-700 hover:underline" onClick={() => selectRow(row.id)}>试听 / 剪辑{row.versions.length ? ` · ${row.versions.length} 版` : ''}</button>{row.error && <p title={row.error} className="mt-2 line-clamp-2 text-[10px] text-red-600">{row.error}</p>}</td>
                <td className="px-2 py-3"><textarea aria-label={`音效${index + 1}描述`} className={`${inputClass} !px-2 resize-y min-h-[60px]`} rows={2} value={row.description} disabled={locked} onChange={e => patchRow(row.id, { description: e.target.value })} /><label className="mt-2 block text-[10px] text-slate-400">场景 / 时间点<input aria-label={`音效${index + 1}场景`} className={`${inputClass} mt-1 !px-2`} value={row.scene} disabled={locked} onChange={e => patchRow(row.id, { scene: e.target.value })} /></label></td>
                <td className="px-2 py-3"><input aria-label={`音效${index + 1}关键词`} placeholder="关键词" className={`${inputClass} !px-2`} value={row.keywords} disabled={locked} onChange={e => patchRow(row.id, { keywords: e.target.value })} /><label className="mt-2 block text-[10px] text-slate-400">英文搜索词 · 1～2词<textarea aria-label={`音效${index + 1}英文搜索词`} aria-invalid={batchSearchWordCount(row.searchQuery) > 2} aria-describedby={batchSearchWordCount(row.searchQuery) > 2 ? `batch-query-${row.id}` : undefined} rows={2} placeholder="留空时搜索前自动提炼" className={`${inputClass} mt-1 !px-2 resize-y ${batchSearchWordCount(row.searchQuery) > 2 ? '!border-amber-400' : ''}`} value={row.searchQuery} disabled={locked} onChange={e => editSearchQuery(row.id, e.target.value)} /></label>{batchSearchWordCount(row.searchQuery) > 2 && <p id={`batch-query-${row.id}`} className="mt-1 text-[10px] text-amber-700">当前{batchSearchWordCount(row.searchQuery)}词，搜索或生成前会自动精简为1～2个英文词</p>}</td>
                <td className="px-2 py-3"><input aria-label={`音效${index + 1}时长`} type="number" min="0.5" max="30" step="0.1" className={`${inputClass} !px-1.5 tabular-nums`} value={Number.isFinite(row.duration) ? row.duration : ''} disabled={locked} onChange={e => patchRow(row.id, { duration: e.target.value === '' ? NaN : Number(e.target.value) })} />{videoAsset && <>
                  <label className="mt-3 block text-[10px] text-slate-500">开始 / 秒<input aria-label={`音效${index + 1}范围开始`} type="number" min="0" max={videoDuration || undefined} step="0.001" placeholder="待设置" className={`${inputClass} mt-1 !px-1 tabular-nums`} value={row.videoId === videoAsset.id ? row.time ?? '' : ''} disabled={locked || !videoDuration} onChange={e => movePoint(row.id, e.target.value === '' ? undefined : Number(e.target.value))} /></label>
                  <label className="mt-2 block text-[10px] text-slate-500">结束 / 秒<input aria-label={`音效${index + 1}范围结束`} type="number" min={row.time ?? 0} max={videoDuration || undefined} step="0.001" placeholder="待设置" className={`${inputClass} mt-1 !px-1 tabular-nums`} value={row.videoId === videoAsset.id ? batchTimeRange(row, videoDuration)?.end ?? '' : ''} disabled={locked || !videoDuration || row.videoId !== videoAsset.id || row.time === undefined} onChange={e => { if (e.target.value !== '') movePoint(row.id, row.time, Number(e.target.value)); }} /></label>
                </>}</td>
                <td className="px-2 py-3 space-y-2"><button aria-label={`搜索音效${index + 1}`} title={row.versions.some(v => v.kind === 'search') ? '再次搜索' : '搜索'} className={`${buttonClass} w-full !px-1.5`} disabled={locked} onClick={() => void run('search', [row.id])}><Search size={12} />搜索</button><button aria-label={`生成音效${index + 1}`} title={row.versions.some(v => v.kind === 'generate') ? '再次生成' : '生成'} className={`${buttonClass} w-full !px-1.5`} disabled={locked} onClick={() => void run('generate', [row.id])}><Sparkles size={12} />生成</button><div className="flex justify-between gap-1"><button aria-label={`下载音效${index + 1}`} title="下载已确认音效" className={`${buttonClass} !p-2`} disabled={!confirmedVersion(row)} onClick={() => saveBatchDownload(confirmedVersion(row)!.confirmedBlob!, `${batchFileStem(row.name)}.wav`)}><Download size={13} /></button><button className={`${buttonClass} !p-2 hover:!text-red-500`} aria-label={`删除音效${index + 1}`} title="删除需求" disabled={locked} onClick={() => setRows(current => current.filter(r => r.id !== row.id))}><Trash2 size={13} /></button></div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">点击任一行，在右侧查看对应音效。英文搜索词留空时，点击搜索或生成会自动从关键词和需求描述提炼并回填1～2个英文词。</p>
      </section>
      {!showTimelineDetails && inspector}
    </div>
  </div>;
}
