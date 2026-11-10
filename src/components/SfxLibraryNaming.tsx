import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Sparkles } from 'lucide-react';
import { optimizeImportMetadata } from '../services/aiService';
import {
  needsLibraryNaming,
  type LibraryNamingSource,
  type LibraryNamingChange,
} from '../services/sfxLibraryNaming';

type Suggestion = LibraryNamingChange & { originalFileName: string };
interface Props {
  sources: LibraryNamingSource[];
  onApply: (changes: LibraryNamingChange[]) => void | Promise<void>;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function useNaming({ sources, onApply, onBusyChange, disabled = false }: Omit<Props, 'children'>) {
  const [mode, setMode] = useState<'smart' | 'all'>('smart');
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const active = useRef(true);
  const stop = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; stop.current = true; };
  }, []);
  useEffect(() => {
    onBusyChange(busy || applying);
    return () => onBusyChange(false);
  }, [busy, applying, onBusyChange]);

  const sourceById = new Map(sources.map(source => [source.id, source]));
  const selected = sources.filter(source => !excluded.has(source.id));
  const candidates = selected.filter(source => mode === 'all' || needsLibraryNaming(source));
  const currentSuggestions = candidates.filter(source => suggestions[source.id]?.originalFileName === source.fileName);
  const suggestedIds = new Set(currentSuggestions.map(source => source.id));
  const pending = candidates.filter(source => !suggestedIds.has(source.id));
  const changes = currentSuggestions.map(source => suggestions[source.id]);
  const locked = disabled || busy || applying;

  const generate = async () => {
    if (running.current || locked || pending.length === 0) return;
    running.current = true;
    stop.current = false;
    setBusy(true);
    setError('');
    setNotice('');
    setProgress({ done: 0, total: pending.length });
    try {
      for (let start = 0; start < pending.length; start += 20) {
        if (stop.current || !active.current) break;
        const batch = pending.slice(start, start + 20);
        try {
          const result = await optimizeImportMetadata(batch.map(source => ({
            id: source.id, originalName: source.fileName, path: source.path,
            size: source.size, type: source.type,
          })));
          if (!active.current) return;
          const byId = new Map(result.map(item => [item.id, item]));
          setSuggestions(current => {
            const next = { ...current };
            batch.forEach(source => {
              const item = byId.get(source.id);
              if (item?.fileName) next[source.id] = {
                id: source.id, fileName: item.fileName, name: item.name, tags: item.tags,
                originalFileName: source.fileName,
              };
            });
            return next;
          });
          setErrors(current => {
            const next = { ...current };
            batch.forEach(source => {
              if (byId.get(source.id)?.fileName) delete next[source.id];
              else next[source.id] = '未返回命名建议，可重试。';
            });
            return next;
          });
        } catch (cause) {
          if (!active.current) return;
          const message = cause instanceof Error ? cause.message : '命名失败，请重试。';
          setErrors(current => ({ ...current, ...Object.fromEntries(batch.map(source => [source.id, message])) }));
        }
        if (active.current) setProgress({ done: Math.min(start + batch.length, pending.length), total: pending.length });
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  };

  const apply = async () => {
    if (!changes.length || locked) return;
    setApplying(true);
    setError('');
    try {
      await onApply(changes.map(({ id, name, fileName, tags }) => ({ id, name, fileName: fileName.trim(), tags })));
      if (active.current) {
        setSuggestions({});
        setErrors({});
        setNotice(`已应用 ${changes.length} 项命名，未勾选文件保持原名。`);
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : '应用失败，请重试。');
    } finally {
      if (active.current) setApplying(false);
    }
  };

  return {
    mode, setMode, sources, sourceById, selected, excluded, setExcluded, suggestions, setSuggestions,
    errors, error, setError, notice, setNotice, busy, applying, progress, candidates,
    pending, changes, locked, generate, apply, stop,
    discard: () => { setSuggestions({}); setErrors({}); setError(''); setNotice('已放弃建议，文件名未修改。'); },
  };
}

const NamingContext = createContext<ReturnType<typeof useNaming> | null>(null);
const useNamingContext = () => {
  const value = useContext(NamingContext);
  if (!value) throw new Error('Naming controls must be inside the library naming provider.');
  return value;
};

export function SfxLibraryNamingProvider({ children, ...props }: Props) {
  const naming = useNaming(props);
  return <NamingContext.Provider value={naming}>{children}</NamingContext.Provider>;
}

export function SfxLibraryNamingControls() {
  const naming = useNamingContext();
  return (
    <section aria-label="AI 命名整理" className="space-y-2 rounded-xl border border-emerald-200 bg-white p-3 text-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 flex items-center gap-1.5 text-xs font-bold"><Sparkles className="h-4 w-4 text-emerald-600" />AI 命名整理</span>
        <select aria-label="命名整理方式" value={naming.mode} disabled={naming.locked}
          onChange={event => { naming.setMode(event.target.value as 'smart' | 'all'); naming.setNotice(''); }}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none disabled:opacity-50">
          <option value="smart">仅整理不规范名称</option>
          <option value="all">全部重新命名</option>
        </select>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" aria-label="全选命名文件" disabled={naming.locked || !naming.sources.length}
            checked={naming.sources.length > 0 && naming.selected.length === naming.sources.length}
            onChange={event => naming.setExcluded(event.target.checked ? new Set() : new Set(naming.sources.map(source => source.id)))} />
          全选
        </label>
        <button type="button" onClick={() => void naming.generate()} disabled={naming.locked || !naming.pending.length}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400">
          {naming.busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {naming.busy ? `正在生成 ${naming.progress.done}/${naming.progress.total}` : Object.keys(naming.errors).length ? '重试未完成项' : '生成命名建议'}
        </button>
        {naming.busy && <button type="button" onClick={() => { naming.stop.current = true; naming.setNotice('当前批次完成后停止。'); }}
          className="text-xs font-bold text-slate-600">停止后续批次</button>}
        {naming.changes.length > 0 && <>
          <button type="button" onClick={naming.discard} disabled={naming.locked}
            className="rounded-lg px-2 py-2 text-xs text-slate-500 disabled:opacity-50">放弃建议</button>
          <button type="button" onClick={() => void naming.apply()} disabled={naming.locked}
            className="flex items-center gap-1 rounded-lg border border-emerald-500 bg-white px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-50">
            {naming.applying ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}确认应用 {naming.changes.length} 项
          </button>
        </>}
      </div>
      <p className="text-[11px] text-slate-500">默认保留原名；仅点击“生成命名建议”才调用 AI，建议显示在下方对应文件中，确认后应用。</p>
      <p className="text-[11px] text-slate-500">已勾选 {naming.selected.length} 个 · 待生成 {naming.pending.length} 个 · 已有建议 {naming.changes.length} 个</p>
      {naming.notice && <p role="status" className="text-xs text-emerald-700">{naming.notice}</p>}
      {naming.error && <p role="alert" className="text-xs text-rose-600">{naming.error}</p>}
    </section>
  );
}
export function SfxLibraryNamingSelection({ id, fileName }: { id: string; fileName: string }) {
  const naming = useNamingContext();
  if (!naming.sourceById.has(id)) return null;
  return <input type="checkbox" aria-label={`选择命名 ${fileName}`} checked={!naming.excluded.has(id)} disabled={naming.locked}
    onChange={event => {
      const checked = event.target.checked;
      naming.setExcluded(current => { const next = new Set(current); if (checked) next.delete(id); else next.add(id); return next; });
    }} />;
}

export function SfxLibraryNamingSuggestion({ id }: { id: string }) {
  const naming = useNamingContext();
  const source = naming.sourceById.get(id);
  if (!source) return null;
  const suggestion = naming.suggestions[id];
  const visible = suggestion?.originalFileName === source.fileName && (naming.mode === 'all' || needsLibraryNaming(source));
  return (
    <div className="mt-1.5 space-y-1">
      {visible ? <>
        <label className="block text-[10px] font-bold text-emerald-700" htmlFor={`naming-suggestion-${id}`}>AI 建议（未应用）</label>
        <input id={`naming-suggestion-${id}`} aria-label={`建议文件名 ${source.fileName}`} type="text" value={suggestion.fileName} disabled={naming.locked}
          onChange={event => {
            const fileName = event.target.value;
            naming.setError('');
            naming.setSuggestions(current => ({ ...current, [id]: { ...current[id], fileName } }));
          }}
          className="w-full min-w-[180px] rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1.5 font-mono text-[11px] text-emerald-800 outline-none focus:border-emerald-500" />
      </> : <p className="text-[10px] text-slate-400">{naming.mode === 'smart' && !needsLibraryNaming(source) ? '符合规范，保留原名' : '未生成建议，保留原名'}</p>}
      {naming.errors[id] && <p className="text-[11px] text-rose-600">{naming.errors[id]}</p>}
    </div>
  );
}
