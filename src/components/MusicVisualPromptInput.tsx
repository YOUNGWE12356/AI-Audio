import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import { generateMusicPromptFromVisual, getMusicVisualClipboardImage, validateMusicVisualFile } from '../services/musicVisualPromptClient';
import PointCostHint from './PointCostHint';

export default function MusicVisualPromptInput({ prompt, duration, instrumental, disabled, onPrompt, onBusy }: {
  prompt: string; duration: number; instrumental: boolean; disabled: boolean;
  onPrompt: (text: string) => void; onBusy: (busy: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    if (disabled || busy) { dragDepth.current = 0; setDragging(false); }
  }, [disabled, busy]);
  useEffect(() => () => { active.current?.abort(); }, []);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const cancel = () => {
    active.current?.abort(); active.current = null;
    setBusy(false); onBusy(false);
    setMessage('已取消，原有风格提示词已保留。');
  };
  const selectFile = (next: File) => {
    if (disabled || busy || active.current) return;
    try { validateMusicVisualFile(next); } catch (error) {
      setError(error instanceof Error ? error.message : '文件格式不支持。'); return;
    }
    setFile(next); setError(''); setMessage('');
  };
  const analyze = async () => {
    if (!file || disabled || active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); onBusy(true); setError('');
    try {
      const text = await generateMusicPromptFromVisual(file, { requirements: prompt, duration, instrumental,
        signal: controller.signal, onProgress: text => { if (active.current === controller) setMessage(text); } });
      if (active.current !== controller || controller.signal.aborted) return;
      onPrompt(text);
      setMessage('中文配乐提示词已填入下方，可修改；生成音乐时会自动转换为英文。');
    } catch (error) {
      if (active.current !== controller) return;
      setMessage('');
      setError(error instanceof Error && error.name === 'TimeoutError' ? '画面分析超时，请重试或缩短视频。'
        : error instanceof Error ? error.message : '画面分析失败，请重试。');
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); onBusy(false); }
    }
  };
  const video = file ? validateMusicVisualFile(file) === 'video' : false;
  return <div role="group" aria-label="配乐参考素材上传区域" aria-describedby="music-visual-upload-hint" tabIndex={disabled || busy ? -1 : 0}
    onClick={event => {
      if (!disabled && !busy && !(event.target as HTMLElement).closest('button,input,textarea,a,video,[contenteditable="true"]')) event.currentTarget.focus();
    }}
    onPaste={event => {
      const image = getMusicVisualClipboardImage(event.clipboardData);
      if (!image) return;
      event.preventDefault(); event.stopPropagation();
      selectFile(image);
    }}
    onDragEnter={event => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault(); event.stopPropagation();
      if (!disabled && !busy) { dragDepth.current++; setDragging(true); }
    }}
    onDragOver={event => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = disabled || busy ? 'none' : 'copy';
    }}
    onDragLeave={event => {
      event.preventDefault(); event.stopPropagation();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    }}
    onDrop={event => {
      if (!event.dataTransfer.types.includes('Files') && !event.dataTransfer.files.length) return;
      event.preventDefault(); event.stopPropagation();
      dragDepth.current = 0; setDragging(false);
      const next = event.dataTransfer.files[0];
      if (next) selectFile(next);
    }}
    className={`space-y-3 rounded-xl border p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-400 ${dragging ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200' : 'border-slate-200 bg-slate-50/70'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-bold text-slate-700">根据画面生成配乐提示词</span>
      <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50">
        <ImagePlus className="h-3.5 w-3.5" />{file ? '更换素材' : '上传图片 / 视频'}
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp,video/*,.mkv,.avi,.mov,.m4v"
        aria-label="上传配乐参考图片或视频" className="sr-only" disabled={disabled || busy}
        onChange={event => { const next = event.target.files?.[0]; event.target.value = ''; if (next) selectFile(next); }} />
    </div>
    <p id="music-visual-upload-hint" className={`text-[11px] leading-5 ${dragging ? 'font-semibold text-emerald-700' : 'text-slate-500'}`}>
      {dragging ? '松开即可上传图片或视频' : '拖入图片或视频，或点击此区域后按 Ctrl+V（Mac：⌘V）粘贴截图。每次使用一个素材。'}
    </p>
    <p className="text-[10px] leading-5 text-slate-500">先根据画面生成中文风格提示词，可修改；生成音乐时自动转换为英文。已有描述会作为偏好参考。</p>
    {file && <div className="space-y-3">
      <div className="flex min-w-0 items-start gap-3">
        {preview && (video ? <video src={preview} controls muted preload="metadata" aria-label="配乐参考视频预览" className="h-24 w-32 shrink-0 rounded-lg bg-slate-950 object-contain" />
          : <img src={preview} alt="配乐参考图片预览" className="h-24 w-24 shrink-0 rounded-lg bg-white object-contain" />)}
        <div className="min-w-0 flex-1 space-y-1 pt-1"><p className="break-all text-[11px] font-semibold text-slate-700">{file.name}</p>
          <p className="text-[10px] text-slate-400">{video ? '视频画面参考' : '图片参考'} · {(file.size / 1024 / 1024).toFixed(1)} MB</p></div>
        <button type="button" aria-label="移除配乐参考素材" disabled={disabled || busy}
          onClick={() => { setFile(null); setError(''); setMessage(''); }} className="shrink-0 rounded p-1 text-slate-400 hover:text-red-500 disabled:opacity-50"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void analyze()} disabled={disabled || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{busy ? '正在分析…' : '分析并填入提示词'}
        </button>
        {busy && <button type="button" onClick={cancel} className="px-2 py-2 text-[11px] text-slate-500">取消分析</button>}
        <PointCostHint kind="token" className="text-[10px]" />
      </div>
    </div>}
    {message && <p role="status" className="text-[11px] leading-5 text-emerald-700">{message}</p>}
    {error && <p role="alert" className="flex items-start gap-1.5 text-[11px] leading-5 text-red-600"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}
  </div>;
}
