/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { HistoryItem } from '../types';
import GeneratedAudioPlayer, { sanitizeAudioFileName } from './GeneratedAudioPlayer';
import PointCostHint from './PointCostHint';
import { requiresSoundEffectTranslation } from '../services/sfxPromptService';
const OnlineSfxSearch = lazy(() => import('./OnlineSfxSearch'));
const BatchSfxStudio = lazy(() => import('./BatchSfxStudio'));

interface PendingSfxOption {
  url: string;
  title: string;
  prompt: string;
  timestamp: string;
  details: string;
  duration: number;
}
interface SfxStudioProps {
  active?: boolean;
  standalonePrompt: string;
  setStandalonePrompt: (prompt: string) => void;
  standaloneDuration: number;
  setStandaloneDuration: (dur: number) => void;
  standaloneDurationMode: 'auto' | 'fixed';
  setStandaloneDurationMode: (mode: 'auto' | 'fixed') => void;
  standaloneLoading: boolean;
  standaloneError: string | null;
  handleStandaloneGenerate: () => void;
  historyList: HistoryItem[];
  pendingSfxOptions: {
    optionA: PendingSfxOption | null;
    optionB: PendingSfxOption | null;
  };
  setPendingSfxOptions: React.Dispatch<React.SetStateAction<{
    optionA: PendingSfxOption | null;
    optionB: PendingSfxOption | null;
  }>>;
}

export default function SfxStudio({
  active = true,
  standalonePrompt,
  setStandalonePrompt,
  standaloneDuration,
  setStandaloneDuration,
  standaloneDurationMode,
  setStandaloneDurationMode,
  standaloneLoading,
  standaloneError,
  handleStandaloneGenerate,
  historyList,
  pendingSfxOptions,
  setPendingSfxOptions,
}: SfxStudioProps) {
  const [mode, setMode] = useState<'generate' | 'online' | 'batch'>('online');
  const [onlineVisited, setOnlineVisited] = useState(true);
  const [batchVisited, setBatchVisited] = useState(false);
  // Assistant requests still use the native generation surface even if the
  // user last visited online search.
  useEffect(() => { if (standaloneLoading) setMode('generate'); }, [standaloneLoading]);
  const [playingHistoryId, setPlayingHistoryId] = useState<string | null>(null);
  const [activeSfxOptionId, setActiveSfxOptionId] = useState<string | null>(null);

  const sfxHistory = historyList.filter(item => item.type === 'sfx');
  const generatedVersionCount = Number(Boolean(pendingSfxOptions.optionA)) + Number(Boolean(pendingSfxOptions.optionB));

  return (
    <div id="sfxstudio-view" className={`flex-1 p-6 space-y-6 mx-auto w-full ${mode === 'batch' ? 'max-w-[1800px]' : 'max-w-6xl'}`}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h2 className="text-xl font-black text-slate-800">AI 音效</h2>
          <p className="text-xs text-slate-500 mt-1">搜索试听素材，或通过文字生成音效</p>
        </div>
      </div>

      <div role="tablist" aria-label="音效模式" className="inline-flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
        <button role="tab" aria-selected={mode === 'generate'} aria-controls="sfx-generate-panel" id="sfx-generate-tab" onClick={() => setMode('generate')}
          className={`rounded-lg px-5 py-2.5 text-xs font-bold ${mode === 'generate' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>AI 生成模式</button>
        <button role="tab" aria-selected={mode === 'online'} aria-controls="sfx-online-panel" id="sfx-online-tab" onClick={() => { setOnlineVisited(true); setMode('online'); }}
          className={`rounded-lg px-5 py-2.5 text-xs font-bold ${mode === 'online' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>搜索模式</button>
        <button role="tab" aria-selected={mode === 'batch'} aria-controls="sfx-batch-panel" id="sfx-batch-tab" onClick={() => { setBatchVisited(true); setMode('batch'); }}
          className={`rounded-lg px-5 py-2.5 text-xs font-bold ${mode === 'batch' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>批量制作</button>
      </div>
      {batchVisited && <div role="tabpanel" id="sfx-batch-panel" aria-labelledby="sfx-batch-tab" hidden={mode !== 'batch'}>
        <Suspense fallback={<p className="text-xs text-slate-500">正在打开批量制作…</p>}><BatchSfxStudio active={active && mode === 'batch'} /></Suspense>
      </div>}
      {onlineVisited && <div role="tabpanel" id="sfx-online-panel" aria-labelledby="sfx-online-tab" hidden={mode !== 'online'}>
        <Suspense fallback={<p className="text-xs text-slate-500">正在打开搜索…</p>}><OnlineSfxSearch /></Suspense>
      </div>}
      <div role="tabpanel" id="sfx-generate-panel" aria-labelledby="sfx-generate-tab" hidden={mode !== 'generate'}>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block uppercase tracking-wider">音效场景描述</label>
              <textarea
                disabled={standaloneLoading}
                value={standalonePrompt}
                onChange={(e) => setStandalonePrompt(e.target.value)}
                placeholder="例如：雨夜里远处雷声、细雨打在树叶上、脚步声慢慢靠近"
                className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all resize-none placeholder-slate-400"
              />
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>{standaloneDurationMode === 'auto' ? '音效长度' : '指定音效长度'}</span>
                <span className="text-emerald-600 font-mono">
                  {standaloneDurationMode === 'auto' ? '自动' : `${standaloneDuration}s`}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={standaloneLoading}
                  onClick={() => setStandaloneDurationMode('auto')}
                  className={`rounded-lg border px-3 py-2 text-[11px] font-bold transition-all ${
                    standaloneDurationMode === 'auto'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-emerald-200 hover:text-emerald-600'
                  }`}
                >
                  自动时长
                </button>
                <button
                  type="button"
                  disabled={standaloneLoading}
                  onClick={() => setStandaloneDurationMode('fixed')}
                  className={`rounded-lg border px-3 py-2 text-[11px] font-bold transition-all ${
                    standaloneDurationMode === 'fixed'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-emerald-200 hover:text-emerald-600'
                  }`}
                >
                  指定秒数
                </button>
              </div>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={standaloneDuration}
                  onChange={(e) => setStandaloneDuration(parseInt(e.target.value))}
                  disabled={standaloneLoading || standaloneDurationMode === 'auto'}
                  className={`w-full h-1.5 rounded-lg appearance-none accent-emerald-600 ${
                    standaloneDurationMode === 'auto'
                      ? 'bg-slate-100 cursor-not-allowed opacity-45'
                      : 'bg-slate-100 cursor-pointer'
                  }`}
                />
              </div>
            </div>

            {standaloneError && (
              <div className="bg-red-50 border border-red-200 text-red-600 p-3.5 rounded-xl text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{standaloneError}</span>
              </div>
            )}

            <div className="flex flex-col items-end gap-1 text-right text-[10px] font-semibold text-amber-700" aria-live="polite">
              {standaloneDurationMode === 'fixed' ? <PointCostHint
                kind="sound-effect"
                durationSeconds={standaloneDuration}
                outputs={2}
              /> : <span>音效按实际时长结算：2 分 / 秒 / 版本，共 2 版</span>}
              {requiresSoundEffectTranslation(standalonePrompt) && <span>描述翻译另计积分，按实际用量结算</span>}
            </div>
            <button
              onClick={handleStandaloneGenerate}
              disabled={standaloneLoading || !standalonePrompt.trim()}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3.5 rounded-xl text-xs tracking-wider uppercase transition-all shadow-md shadow-emerald-600/10 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {standaloneLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>生成中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>生成音效DEMO</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 space-y-5">
          {(pendingSfxOptions.optionA || pendingSfxOptions.optionB) && (
            <div className="bg-emerald-50/40 border-2 border-emerald-500/30 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-emerald-500/10 pb-2.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-wider">{generatedVersionCount === 2 ? '已生成双版本音效' : '已生成 1 个版本音效'}</h4>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-700">{standaloneLoading ? '其余版本生成中' : '先试听再保留'}</span>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {([
                  ['A', pendingSfxOptions.optionA],
                  ['B', pendingSfxOptions.optionB],
                ] as const).map(([id, option]) => option && (
                  <GeneratedAudioPlayer
                    key={id}
                    id={`sfx-${id}`}
                    url={option.url}
                    title={option.title}
                    titleBadge={`版本 ${id}`}
                    prompt={option.prompt}
                    meta={option.details}
                    durationHint={option.duration}
                    activeId={activeSfxOptionId}
                    setActiveId={setActiveSfxOptionId}
                    editableTitle
                    enableRangeDownload
                    downloadFileName={`${sanitizeAudioFileName(option.title, `generated_sfx_${id}`)}.wav`}
                    downloadLabel={`下载 WAV 音效（版本 ${id}）`}
                    onRename={(title) => {
                      setPendingSfxOptions(prev => ({
                        optionA: id === 'A' && prev.optionA ? { ...prev.optionA, title } : prev.optionA,
                        optionB: id === 'B' && prev.optionB ? { ...prev.optionB, title } : prev.optionB,
                      }));
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
              <span>生成历史音效 ({sfxHistory.length})</span>
              <span className="text-[10px] text-slate-400 font-normal">本会话</span>
            </h3>

            {sfxHistory.length === 0 ? (
              <p className="text-slate-400 text-[10px] text-center py-6">暂无生成历史。成功生成的音效会自动显示在这里。</p>
            ) : (
              <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1 custom-scrollbar">
                {sfxHistory.map(item => <GeneratedAudioPlayer key={item.id} id={`sfx-history-${item.id}`}
                  url={item.url} title={item.title} prompt={item.prompt} meta={item.timestamp}
                  activeId={playingHistoryId} setActiveId={setPlayingHistoryId} enableRangeDownload deferDecode
                  downloadFileName={`${sanitizeAudioFileName(item.title, item.id)}.wav`} />)}
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
