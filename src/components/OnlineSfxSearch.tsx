import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ExternalLink, Globe, Loader2, Search, Square, RotateCcw } from 'lucide-react';
import GeneratedAudioPlayer, { sanitizeAudioFileName } from './GeneratedAudioPlayer';
import PointCostHint from './PointCostHint';
import { prepareSoundEffectPrompt, requiresSoundEffectTranslation } from '../services/sfxPromptService';
import type { CapturedOnlineSfx, OnlineSfxItem, OnlineSfxSourceStatus } from '../services/onlineSfxTypes';

type Row = OnlineSfxItem & { status: 'waiting' | 'capturing' | 'ready' | 'failed'; result?: CapturedOnlineSfx; error?: string };
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;
const normalizeQuery = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

async function post<T>(endpoint: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/sfx/online/${endpoint}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败，请稍后重试。');
  return result;
}

export default function OnlineSfxSearch() {
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [searchMs, setSearchMs] = useState<number | null>(null);
  const [batchNumber, setBatchNumber] = useState(0);
  const [sources, setSources] = useState<OnlineSfxSourceStatus[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const started = useRef(0);
  const mounted = useRef(true);
  const translations = useRef(new Map<string, string>());
  const searchHistory = useRef<{ key: string; nextPage: number; nextBatch: number; seen: Set<string> }>({ key: '', nextPage: 1, nextBatch: 1, seen: new Set() });
  useEffect(() => {
    mounted.current = true;
    const cleanupOnPageHide = () => {
      void fetch('/api/sfx/online/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('pagehide', cleanupOnPageHide);
    return () => {
      window.removeEventListener('pagehide', cleanupOnPageHide);
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setElapsed(Date.now() - started.current), 200);
    return () => window.clearInterval(timer);
  }, [busy]);
  const patch = (id: string, change: Partial<Row>) => {
    if (mounted.current) setRows(previous => previous.map(row => row.id === id ? { ...row, ...change } : row));
  };
  const capture = async (row: Row, signal: AbortSignal) => {
    if (signal.aborted) return;
    patch(row.id, { status: 'capturing', error: undefined });
    try {
      const result = await post<CapturedOnlineSfx>('capture', { id: row.id }, signal);
      patch(row.id, { status: 'ready', result });
    } catch (err: any) {
      patch(row.id, { status: 'failed', error: signal.aborted ? '已停止等待，可重试查询结果。' : err.message });
    }
  };
  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim() || busy) return;
    const current = new AbortController(); controller.current = current;
    started.current = Date.now(); setBusy(true); setRows([]); setError(''); setElapsed(0); setSearchMs(null); setSearchQuery('');
    setSources([]);
    setMessage(requiresSoundEffectTranslation(query) ? '正在将音效关键词翻译为英文…' : '正在并行搜索多个音效网站…');
    try {
      const trimmedQuery = query.trim();
      const queryKey = normalizeQuery(trimmedQuery);
      let english = translations.current.get(queryKey);
      if (!english) {
        english = await prepareSoundEffectPrompt(trimmedQuery);
        translations.current.set(queryKey, english);
      }
      current.signal.throwIfAborted();
      setSearchQuery(english); setMessage('正在并行搜索 Envato、PSE、Epidemic、Mixkit 和全网公开试听…');
      const continued = searchHistory.current.key === queryKey;
      const page = continued ? searchHistory.current.nextPage : 1;
      const batch = continued ? searchHistory.current.nextBatch : 1;
      const seen = continued ? searchHistory.current.seen : new Set<string>();
      const response = await post<{ items: OnlineSfxItem[]; sources?: OnlineSfxSourceStatus[]; page: number; nextPage: number; elapsedMs: number; message?: string }>(
        'search',
        { query: english, page, excludeSourceUrls: Array.from(seen) },
        current.signal,
      );
      const next: Row[] = response.items.map(item => ({ ...item, status: 'waiting' }));
      next.forEach(item => seen.add(item.sourceUrl));
      searchHistory.current = { key: queryKey, nextPage: response.nextPage, nextBatch: batch + 1, seen };
      setRows(next); setSearchMs(response.elapsedMs); setBatchNumber(batch);
      setSources(response.sources || []);
      setMessage(next.length ? '搜索完成，正在后台采集试听；完成的音效可立即播放。' : response.message || '没有找到匹配音效。');
      let cursor = 0;
      // Three bounded workers publish each playable result without waiting for
      // the rest of the batch. Source failures stay attached to that sound.
      await Promise.all(Array.from({ length: Math.min(3, next.length) }, async () => {
        while (cursor < next.length && !current.signal.aborted) await capture(next[cursor++], current.signal);
      }));
      if (!current.signal.aborted && next.length) setMessage('本次采集结束，可试听、下载或重试失败的音效。');
    } catch (err: any) {
      if (mounted.current) {
        if (current.signal.aborted) setMessage('已停止，完成的音效已保留。');
        else setError(err.message || '搜索失败，请重试。');
      }
    } finally {
      if (mounted.current) {
        setElapsed(Date.now() - started.current); setBusy(false);
        setRows(previous => previous.map(row => row.status === 'waiting' ? { ...row, status: 'failed', error: '未采集，可单独重试。' } : row));
      }
    }
  };
  const retry = async (row: Row) => {
    if (busy) return;
    const current = new AbortController(); controller.current = current;
    started.current = Date.now(); setBusy(true);
    try { await capture(row, current.signal); }
    finally { if (mounted.current) { setElapsed(Date.now() - started.current); setBusy(false); } }
  };
  const ready = rows.filter(row => row.status === 'ready').length;
  const failed = rows.filter(row => row.status === 'failed').length;
  const repeatsCurrentQuery = rows.length > 0 && searchHistory.current.key === normalizeQuery(query);
  return <div className="space-y-5">
      <form onSubmit={search} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><Globe className="w-4 h-4 text-emerald-600" />搜索音效</div>
        <label htmlFor="online-sfx-query" className="block text-xs font-bold text-slate-700">音效关键词</label>
        <input id="online-sfx-query" value={query} onChange={event => setQuery(event.target.value)} maxLength={160} disabled={busy}
          placeholder="例如：魔法转场、木门吱呀、whoosh" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={busy || !query.trim()} type="submit" className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}{busy ? '搜索 / 采集中' : repeatsCurrentQuery ? '再搜一批（最多 100 条）' : '搜索并采集（最多 100 条）'}
          </button>
          {busy && <button type="button" onClick={() => { controller.current?.abort(); setMessage('已停止等待，完成的音效已保留。'); }} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-xs text-slate-600"><Square className="w-3 h-3" />停止</button>}
          <PointCostHint kind="online-sfx" className="ml-auto" />
        </div>
        <p className="text-[11px] leading-5 text-slate-500">目标配比：Envato 30% · 其他三库合计 30% · 全网搜索 40%。结果不足或来源异常时自动互补。</p>
        <p className="text-[11px] leading-5 text-slate-500">采集网站公开试听并转为 48kHz WAV，保留原试听水印，单条最多 60 秒。正式项目请到来源站确认该条素材许可并下载原文件。</p>
        {requiresSoundEffectTranslation(query) && <p className="text-[11px] text-amber-700">中文关键词会先翻译，翻译按 GPT Token 另计（最低 1 分）；联网搜索成功后整批结算 1 分。</p>}
      </form>
    {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
    {(message || rows.length > 0) && <div role="status" aria-live="polite" className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 space-y-1">
      <p>{message}</p><p className="text-[11px] text-slate-600">已就绪 {ready} / {rows.length} · 失败 {failed} · 本次耗时 {seconds(elapsed)}{searchMs !== null ? ` · 搜索 ${seconds(searchMs)}` : ''}</p>
      {searchQuery && <p className="break-words text-[11px] text-slate-500">搜索词：{searchQuery}{batchNumber > 0 ? ` · 第 ${batchNumber} 批` : ''}</p>}
      {sources.length > 0 && <p className="break-words text-[11px] text-slate-600">{sources.map(source => `${source.source} ${source.count} 条${source.reason ? `（${source.reason}）` : source.unavailable ? '（暂不可用，已启用其他来源）' : ''}`).join(' · ')}</p>}
    </div>}
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {rows.map((row, index) => <article key={row.id} style={{ contentVisibility: 'auto', containIntrinsicSize: '560px' }} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold text-slate-800 break-words">{index + 1}. {row.title}</p><p className="mt-1 text-[10px] text-slate-500">{row.source}{row.author ? ` · ${row.author}` : ''} · 试听版本</p></div>
          <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[11px] text-emerald-700 inline-flex items-center gap-1">来源<ExternalLink className="w-3 h-3" /></a></div>
        {row.result ? <><GeneratedAudioPlayer id={row.id} url={row.result.url} title={row.title} titleBadge="试听采集" durationHint={row.result.duration}
          activeId={activeId} setActiveId={setActiveId} enableRangeDownload deferDecode downloadFileName={`${sanitizeAudioFileName(row.title)}_preview.wav`} downloadLabel="下载试听 WAV" />
          <p className="flex items-center gap-1 text-[10px] text-emerald-700"><Check className="w-3 h-3" />采集耗时 {seconds(row.result.elapsedMs)}{row.result.limited ? ' · 已保留前 60 秒' : ''}</p></>
          : row.status === 'failed' ? <div className="flex items-center justify-between gap-3 rounded-lg bg-red-50 p-3 text-xs text-red-700"><span>{row.error}</span><button disabled={busy} onClick={() => void retry(row)} className="flex items-center gap-1 shrink-0 disabled:opacity-40"><RotateCcw className="w-3 h-3" />重试</button></div>
            : <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-5 text-xs text-slate-500"><Loader2 className={`w-4 h-4 ${row.status === 'capturing' ? 'animate-spin' : ''}`} />{row.status === 'capturing' ? '正在获取试听并转换…' : '等待采集…'}</div>}
      </article>)}
    </div>
  </div>;
}
