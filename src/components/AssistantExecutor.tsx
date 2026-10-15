import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle, Check, Download, Loader2, MessageSquarePlus, Minus, Plus, Sparkles, Square, Trash2, X } from 'lucide-react';
import { getAssistantActivity } from '../services/assistantActivity';
import { getAssistantMessages } from '../services/assistantMessages';
import { getAssistantAutoNavigation } from '../utils/workspaceNavigation';
import type { TabType } from '../types';
import type { AssistantAsset } from '../services/assistantAgentTypes';
import { addAssistantFiles, cancelAssistantExecution, readAssistantExecution, resetAssistantExecution, restoreAssistantExecution,
  startAssistantExecution, subscribeAssistantExecution, updateAssistantExecution } from '../services/assistantAgentClient';

export default function AssistantExecutor({ embedded = false, onNavigate }: { embedded?: boolean; onNavigate: (tab: TabType) => void }) {
  const state = useSyncExternalStore(subscribeAssistantExecution, readAssistantExecution, readAssistantExecution);
  const [open, setOpen] = useState(embedded);
  const [downloadError, setDownloadError] = useState('');
  const [hasChatUpdates, setHasChatUpdates] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const followChatRef = useRef(true);
  const previousChatViewRef = useRef({ open: false, jobId: '', messageId: '' });
  const workspaceJobRef = useRef('');
  const navigationEventRef = useRef('');
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const job = state.job;
  const activity = getAssistantActivity(state);
  const busy = activity.busy;
  const needsAttention = activity.tone === 'waiting' || activity.tone === 'failed';
  const messages = job ? getAssistantMessages(job) : [];
  const lastMessage = messages.at(-1);
  const lastEvent = job?.events.at(-1);
  const resultAssets = (job && !job.workspaceCommand ? job.assets : [])
    .filter(asset => (asset.generated || job?.deliverableIds?.includes(asset.id)) && asset.size > 0);
  const scrollToLatest = () => {
    const chat = chatRef.current;
    if (!chat) return;
    chat.scrollTop = chat.scrollHeight;
    followChatRef.current = true;
    setHasChatUpdates(false);
  };
  const startNewConversation = () => {
    resetAssistantExecution();
    setDownloadError('');
    setHasChatUpdates(false);
    followChatRef.current = true;
    if (inputRef.current) inputRef.current.value = '';
    window.requestAnimationFrame(() => promptRef.current?.focus());
  };
  useLayoutEffect(() => {
    const previous = previousChatViewRef.current;
    previousChatViewRef.current = { open, jobId: job?.id || '', messageId: lastMessage?.id || '' };
    if (!open || !chatRef.current) return;
    const ownMessage = lastMessage?.role === 'user' && previous.messageId !== lastMessage.id;
    if (!previous.open || previous.jobId !== job?.id || ownMessage || followChatRef.current) scrollToLatest();
    else setHasChatUpdates(true);
  }, [open, job?.id, job?.status, job?.answer, job?.error, lastMessage?.id, lastMessage?.content,
    lastEvent?.id, lastEvent?.status, lastEvent?.message, activity.label, activity.detail, resultAssets.length]);
  const previousStatus = useRef(job?.status);
  useEffect(() => { void restoreAssistantExecution(); }, []);
  useEffect(() => {
    if (!embedded && previousStatus.current === 'running' && ['completed', 'waiting', 'failed'].includes(job?.status || '')) setOpen(true);
    previousStatus.current = job?.status;
  }, [job?.status, embedded]);
  useEffect(() => {
    if (job?.status !== 'running' || !job.workspaceCommand || workspaceJobRef.current === job.id) return;
    workspaceJobRef.current = job.id;
    if (!embedded) setOpen(false);
  }, [job?.id, job?.status, job?.workspaceCommand?.id, embedded]);
  const navigation = getAssistantAutoNavigation(job);
  useEffect(() => {
    // Explicit "open a module" commands still navigate; finishing production does not.
    if (embedded || !navigation || navigationEventRef.current === navigation.eventId) return;
    navigationEventRef.current = navigation.eventId;
    onNavigate(navigation.tab);
  }, [navigation?.eventId, navigation?.tab, embedded, onNavigate]);
  const download = async (asset: AssistantAsset) => {
    if (!job) return;
    try {
      setDownloadError('');
      const response = await fetch(`/api/ai/assistant/jobs/${job.id}/assets/${asset.id}`);
      if (!response.ok) throw new Error('文件下载失败，请重试。');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = asset.name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { setDownloadError(error instanceof Error ? error.message : '下载失败'); }
  };
  const openProject = async (asset: AssistantAsset) => {
    try {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error('工程读取失败。');
      const project = await response.json();
      sessionStorage.setItem('assistant_pending_video_project', JSON.stringify(project));
      onNavigate('video-soundtrack');
      window.dispatchEvent(new Event('ai-audio:assistant-project'));
    } catch (error) { setDownloadError(error instanceof Error ? error.message : '打开失败'); }
  };
  const showWorkspace = () => {
    try {
      const project = job?.workspaceCommand?.result?.project;
      const saved = JSON.parse(localStorage.getItem('video_soundtrack_projects') || '[]');
      const videoUrl = job?.workspaceCommand?.args?.video?.url;
      const projectId = sessionStorage.getItem('assistant_video_workspace_project');
      const restored = saved.find((item: any) => project?.id && item.id === project.id)
        || project || saved.find((item: any) => videoUrl ? item.videoFile?.url === videoUrl : item.id === projectId);
      if (restored) sessionStorage.setItem('assistant_pending_video_project', JSON.stringify(restored));
    } catch { setDownloadError('工程记录读取失败，请在视频声音制作中手动选择已保存工程。'); }
    onNavigate('video-soundtrack');
    window.dispatchEvent(new Event('ai-audio:assistant-project'));
  };
  return <div className={embedded ? 'w-full' : 'pointer-events-none fixed inset-0 z-[80]'}>
    {!open ? <button type="button" aria-label="打开智能助手" title={activity.detail} onClick={() => setOpen(true)}
      className={`${embedded ? 'mt-3' : 'pointer-events-auto absolute bottom-6 right-6'} flex min-h-12 max-w-[min(340px,calc(100vw-2rem))] items-center justify-center gap-2 rounded-2xl border bg-white/95 px-3 py-2 shadow-lg backdrop-blur ${needsAttention ? 'border-amber-300 text-amber-700' : 'border-emerald-200 text-emerald-600'}`}>
      {busy ? <Loader2 aria-label="自动工作进行中" className="h-5 w-5 shrink-0 animate-spin" /> : needsAttention ? <AlertCircle className="h-5 w-5 shrink-0" /> : <Sparkles className="h-5 w-5 shrink-0" />}
      {activity.tone !== 'idle' && <span role="status" aria-live="polite" className="min-w-0 text-left"><span className="block truncate text-xs font-semibold">{activity.label}</span><span className="block max-w-64 truncate text-[10px] opacity-75">{activity.detail}</span></span>}
    </button> : <section role="dialog" aria-label="全局智能助手" aria-modal="false"
      className={`${embedded ? 'mx-auto w-full max-w-2xl' : 'pointer-events-auto absolute bottom-6 right-4 w-[min(460px,calc(100vw-2rem))] max-h-[calc(100dvh-3rem)] rounded-2xl border border-emerald-200 bg-white/95 shadow-2xl backdrop-blur-xl'} flex flex-col text-slate-700`}>
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">{busy && <Loader2 aria-label="自动工作进行中" className="h-4 w-4 shrink-0 animate-spin text-emerald-600" />}<p role="status" className={`truncate text-[11px] ${needsAttention ? 'text-amber-700' : 'text-slate-500'}`}>{activity.tone === 'idle' ? '一句话交代目标，自动进入对应功能并完成制作' : activity.label}</p></div>
        <div className="flex shrink-0 gap-1">
          <button type="button" aria-label="新对话" title="开启新对话，清空当前消息和附件，并停止当前任务" onClick={startNewConversation} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"><MessageSquarePlus className="h-4 w-4" /><span>新对话</span></button>
          {!embedded && <button aria-label="最小化智能助手" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-emerald-50"><Minus className="h-4 w-4" /></button>}
        </div>
      </header>
      <div className={`min-h-0 overflow-y-auto p-4 pt-0 ${embedded ? 'flex flex-col gap-3' : 'space-y-3'}`}>
        {job && <div className={`${embedded ? 'order-last ' : ''}relative shrink-0`}>
          <div ref={chatRef} role="region" aria-label="聊天内容" tabIndex={0}
            onScroll={event => {
              const chat = event.currentTarget;
              followChatRef.current = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 48;
              if (followChatRef.current) setHasChatUpdates(false);
            }}
            className="h-[min(320px,45dvh)] overflow-y-auto overscroll-contain space-y-3 rounded-xl border border-emerald-100 bg-white/65 p-3">
          <ol aria-label="对话记录" aria-live="polite" aria-relevant="additions text" className="space-y-3">
            {messages.map(message => <li key={message.id} aria-label={message.role === 'user' ? '我的消息' : '助手回复'}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <p className={`max-w-[90%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-xs leading-relaxed ${message.role === 'user' ? 'bg-emerald-50 text-slate-800' : 'bg-slate-50 text-slate-700'}`}>{message.content}</p>
            </li>)}
          </ol>
          {job.status !== 'completed' && <div className={`flex items-center gap-2 text-xs font-semibold ${needsAttention ? 'text-amber-700' : 'text-emerald-700'}`} role="status">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {activity.label}
          </div>}
          {busy && <p className="text-[11px] text-slate-500">{activity.detail}</p>}
          {job.status !== 'completed' && lastEvent && <p role="status"
            className={`text-[11px] leading-relaxed ${lastEvent.status === 'failed' ? 'text-red-600' : 'text-slate-600'}`}>
            {lastEvent.message}{lastEvent.status === 'running' ? '…' : ''}
          </p>}
          {job.status !== 'completed' && job.events.length > 0 && <details>
            <summary className="cursor-pointer text-[11px] text-slate-500">查看执行步骤（{job.events.length}）</summary>
            <ol className="mt-2 max-h-48 space-y-2 overflow-y-auto overscroll-contain" aria-label="任务执行进度">
            {job.events.map(event => <li key={event.id} className="flex items-start gap-2 text-[11px] leading-relaxed">
              {event.status === 'running' ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-emerald-600" /> : event.status === 'failed' ? <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}
              <span className={event.status === 'failed' ? 'text-red-600' : ''}>{event.message}{event.status === 'running' ? '…' : ''}</span>
            </li>)}
            </ol>
          </details>}
          {job.status !== 'completed' && job.answer && <p className="whitespace-pre-wrap text-xs leading-relaxed">{job.answer}</p>}
          {job.error && <p role="alert" className="whitespace-pre-wrap text-xs text-red-600">{job.error}</p>}
          {job.workspaceCommand && <button onClick={showWorkspace} className="text-xs font-semibold text-emerald-700">查看视频声音制作中的工程与结果</button>}
          {resultAssets.length > 0 && <details key={job.id} className="rounded-lg border border-slate-100 bg-white p-2">
            <summary className="cursor-pointer text-[11px] font-semibold text-emerald-700">查看生成文件（{resultAssets.length}）</summary>
            <div className="mt-2 max-h-48 space-y-2 overflow-y-auto overscroll-contain">
            {resultAssets.map(asset => <div key={asset.id} className="space-y-2 rounded-lg border border-slate-100 bg-white p-2">
            <div className="flex items-center gap-2"><span className="min-w-0 flex-1 break-all text-[11px]">{asset.name}</span>
              <button title={`下载 ${asset.name}`} aria-label={`下载 ${asset.name}`} onClick={() => void download(asset)} className="rounded p-1.5 text-emerald-700 hover:bg-emerald-50"><Download className="h-4 w-4" /></button></div>
            {asset.mimeType.startsWith('audio/') && !/\.mid$/i.test(asset.name) && <audio controls preload="none" src={asset.url} className="h-8 w-full" />}
            {asset.mimeType.startsWith('video/') && <video controls preload="metadata" src={asset.url} className="max-h-48 w-full rounded" />}
            {asset.name.endsWith('_时间线.json') && <button onClick={() => void openProject(asset)} className="text-[11px] font-semibold text-emerald-700">在视频声音制作中编辑时间线</button>}
            </div>)}
            </div>
          </details>}
          {job.navigation && !job.workspaceCommand && job.status === 'completed' && <button onClick={() => onNavigate(job.navigation as TabType)} className="text-xs text-emerald-700">打开对应功能</button>}
          {busy && <button onClick={() => void cancelAssistantExecution()} className="flex items-center gap-1 text-[11px] text-slate-500"><Square className="h-3 w-3" />停止任务</button>}
          </div>
          {hasChatUpdates && <button type="button" onClick={scrollToLatest}
            className="absolute bottom-2 right-3 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-emerald-700 shadow-md">查看最新消息 ↓</button>}
        </div>}
        <div className="space-y-2 rounded-xl border border-emerald-200 bg-white/60 p-3"
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
          onDrop={e => { e.preventDefault(); if (!busy) addAssistantFiles(Array.from(e.dataTransfer.files)); }}>
          <textarea ref={promptRef} aria-label="任务指令" value={state.prompt} disabled={busy} onChange={e => updateAssistantExecution({ prompt: e.target.value })}
            onPaste={(e: React.ClipboardEvent<HTMLTextAreaElement>) => { const files = Array.from(e.clipboardData.files as FileList); if (files.length) { e.preventDefault(); addAssistantFiles(files); } }}
            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void startAssistantExecution(); } }}
            placeholder={job?.waitingFor === 'export-review' ? '试听满意后回复“导出”，或输入修改要求…' : job?.status === 'waiting' ? '在这里补充必要信息…' : '描述你要完成的工作，可附多个文件…'}
            className="min-h-24 w-full resize-y bg-transparent text-xs leading-relaxed outline-none disabled:opacity-50" />
          {state.files.map((file, i) => <div key={`${file.name}:${i}`} className="flex items-center gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate">{file.name}</span><button disabled={busy} aria-label={`移除 ${file.name}`} onClick={() => updateAssistantExecution({ files: state.files.filter((_, index) => i !== index) })}><Trash2 className="h-3.5 w-3.5 text-slate-400" /></button>
          </div>)}
          <input ref={inputRef} type="file" multiple className="hidden" onChange={e => { addAssistantFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
          <div className="flex items-center justify-between"><button title="添加任务素材" aria-label="添加任务素材" disabled={busy} onClick={() => inputRef.current?.click()} className="rounded-full border border-emerald-200 p-1.5 text-emerald-600 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
            <span className="text-[10px] text-slate-400">按实际使用的模型和工具计费</span></div>
        </div>
        {(state.error || downloadError) && <p role="alert" className="text-xs text-red-600">{state.error || downloadError}</p>}
        <button disabled={busy || !state.prompt.trim()} onClick={() => void startAssistantExecution()}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-xs font-bold text-white hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? '正在制作并自动推进…' : job?.waitingFor === 'export-review' ? '发送试听反馈' : job?.status === 'waiting' ? '补充信息并继续执行' : '开始执行'}
        </button>
      </div>
    </section>}
  </div>;
}
