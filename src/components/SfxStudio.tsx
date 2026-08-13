/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Play, Pause, Download, AlertCircle, Sparkles } from 'lucide-react';
import { HistoryItem } from '../types';

interface PendingSfxOption {
  url: string;
  title: string;
  prompt: string;
  timestamp: string;
  details: string;
  duration: number;
}
interface SfxStudioProps {
  standalonePrompt: string;
  setStandalonePrompt: (prompt: string) => void;
  standaloneDuration: number;
  setStandaloneDuration: (dur: number) => void;
  standaloneLoading: boolean;
  standaloneError: string | null;
  handleStandaloneGenerate: () => void;
  historyList: HistoryItem[];
  pendingSfxOptions: {
    optionA: PendingSfxOption | null;
    optionB: PendingSfxOption | null;
  };
}

interface AudioPreviewAnalysis {
  status: 'idle' | 'loading' | 'ready' | 'error';
  duration: number | null;
  peaks: number[];
}

const EMPTY_AUDIO_PREVIEW: AudioPreviewAnalysis = {
  status: 'idle',
  duration: null,
  peaks: [],
};

const FALLBACK_WAVEFORM = [
  0.18, 0.34, 0.24, 0.52, 0.36, 0.72, 0.45, 0.62,
  0.84, 0.48, 0.74, 0.38, 0.56, 0.28, 0.42, 0.22,
  0.36, 0.58, 0.78, 0.44, 0.64, 0.32, 0.50, 0.26,
  0.40, 0.70, 0.92, 0.54, 0.76, 0.36, 0.58, 0.24,
  0.34, 0.56, 0.42, 0.68, 0.86, 0.46, 0.62, 0.30,
  0.48, 0.74, 0.52, 0.36, 0.58, 0.82, 0.44, 0.64,
];

const formatAudioDuration = (duration?: number | null) => {
  if (!duration || !Number.isFinite(duration)) return '--:--';
  const totalSeconds = Math.max(0, Math.round(duration));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const buildMonoPeaks = (audioBuffer: AudioBuffer, barCount = 64) => {
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index));
  const samplesPerBar = Math.max(1, Math.floor(audioBuffer.length / barCount));
  const peaks = Array.from({ length: barCount }, (_, barIndex) => {
    const start = barIndex * samplesPerBar;
    const end = barIndex === barCount - 1
      ? audioBuffer.length
      : Math.min(audioBuffer.length, start + samplesPerBar);
    let peak = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      let mixedSample = 0;
      for (const channelData of channels) {
        mixedSample += Math.abs(channelData[sampleIndex] || 0);
      }
      peak = Math.max(peak, mixedSample / Math.max(1, channels.length));
    }
    return peak;
  });

  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map(peak => Math.min(1, Math.max(0.08, peak / maxPeak)));
};

export default function SfxStudio({
  standalonePrompt,
  setStandalonePrompt,
  standaloneDuration,
  setStandaloneDuration,
  standaloneLoading,
  standaloneError,
  handleStandaloneGenerate,
  historyList,
  pendingSfxOptions,
}: SfxStudioProps) {
  const [playingHistoryId, setPlayingHistoryId] = useState<string | null>(null);
  const [playingOptionId, setPlayingOptionId] = useState<'A' | 'B' | null>(null);
  const [optionPreviews, setOptionPreviews] = useState<Record<'A' | 'B', AudioPreviewAnalysis>>({
    A: EMPTY_AUDIO_PREVIEW,
    B: EMPTY_AUDIO_PREVIEW,
  });
  const optionAudioRef = useRef<HTMLAudioElement | null>(null);
  const historyAudioRefs = useRef<{ [key: string]: HTMLAudioElement | null }>({});

  useEffect(() => {
    let cancelled = false;
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;

    const analyseOption = async (id: 'A' | 'B', url?: string) => {
      if (!url || !AudioContextCtor) {
        setOptionPreviews(prev => ({ ...prev, [id]: EMPTY_AUDIO_PREVIEW }));
        return;
      }

      setOptionPreviews(prev => ({
        ...prev,
        [id]: { status: 'loading', duration: null, peaks: [] },
      }));

      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioContext = new AudioContextCtor();
        const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        await audioContext.close().catch(() => undefined);
        if (cancelled) return;
        setOptionPreviews(prev => ({
          ...prev,
          [id]: {
            status: 'ready',
            duration: decodedBuffer.duration,
            peaks: buildMonoPeaks(decodedBuffer),
          },
        }));
      } catch (error) {
        console.warn('Failed to analyse SFX waveform:', error);
        if (cancelled) return;
        setOptionPreviews(prev => ({
          ...prev,
          [id]: { status: 'error', duration: null, peaks: [] },
        }));
      }
    };

    analyseOption('A', pendingSfxOptions.optionA?.url);
    analyseOption('B', pendingSfxOptions.optionB?.url);

    return () => {
      cancelled = true;
    };
  }, [pendingSfxOptions.optionA?.url, pendingSfxOptions.optionB?.url]);

  const handleHistoryPlayPause = (id: string) => {
    if (playingHistoryId && playingHistoryId !== id && historyAudioRefs.current[playingHistoryId]) {
      historyAudioRefs.current[playingHistoryId]?.pause();
    }

    const audioObj = historyAudioRefs.current[id];
    if (!audioObj) return;

    if (playingHistoryId === id) {
      audioObj.pause();
      setPlayingHistoryId(null);
    } else {
      audioObj.play().catch(e => console.error(e));
      setPlayingHistoryId(id);
    }
  };

  const sfxHistory = historyList.filter(item => item.type === 'sfx');

  const playSfxOption = (id: 'A' | 'B', url: string) => {
    if (!optionAudioRef.current) optionAudioRef.current = new Audio();

    if (playingOptionId === id) {
      optionAudioRef.current.pause();
      setPlayingOptionId(null);
      return;
    }

    optionAudioRef.current.src = url;
    optionAudioRef.current.play()
      .then(() => setPlayingOptionId(id))
      .catch(error => console.error('Play SFX option failed:', error));
    optionAudioRef.current.onended = () => setPlayingOptionId(null);
  };

  const renderOptionWaveform = (id: 'A' | 'B') => {
    const preview = optionPreviews[id];
    const peaks = preview.peaks.length > 0 ? preview.peaks : FALLBACK_WAVEFORM;
    const isPlaying = playingOptionId === id;
    const barColor = id === 'A'
      ? 'from-emerald-500 to-emerald-700'
      : 'from-teal-500 to-cyan-700';

    return (
      <div className="rounded-xl border border-slate-200 bg-slate-950 px-3 py-3 shadow-inner">
        <div className="flex h-16 items-center gap-[2px]">
          {peaks.map((peak, index) => {
            const heightPercent = Math.max(12, Math.round(peak * 100));
            return (
              <div
                key={`${id}-wave-${index}`}
                className={`flex-1 rounded-full bg-gradient-to-t ${barColor} ${isPlaying ? 'opacity-100' : 'opacity-80'}`}
                style={{
                  height: `${heightPercent}%`,
                  boxShadow: isPlaying ? '0 0 10px rgba(16, 185, 129, 0.35)' : undefined,
                }}
              />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div id="sfxstudio-view" className="flex-1 p-6 space-y-6 max-w-6xl mx-auto w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h2 className="text-xl font-black text-slate-800">AI 音效</h2>
          <p className="text-xs text-slate-500 mt-1">专业拟音与科幻特技合成，输入文字描述即可收获极具张力的电影声效。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block uppercase tracking-wider">音效场景描述</label>
              <textarea
                value={standalonePrompt}
                onChange={(e) => setStandalonePrompt(e.target.value)}
                placeholder="例如：雨夜里远处雷声、细雨打在树叶上、脚步声慢慢靠近"
                className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all resize-none placeholder-slate-400"
              />
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>指定音效长度</span>
                <span className="text-emerald-600 font-mono">{standaloneDuration}s</span>
              </div>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={standaloneDuration}
                  onChange={(e) => setStandaloneDuration(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                />
              </div>
              <span className="text-[9px] text-slate-400 block">生成范围支持 1s - 20s，音效通常建议控制在 2s - 8s。</span>
            </div>

            {standaloneError && (
              <div className="bg-red-50 border border-red-200 text-red-600 p-3.5 rounded-xl text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{standaloneError}</span>
              </div>
            )}

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
                  <span>生成高保真独立音效</span>
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
                  <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-wider">已生成双版本音效</h4>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-700">先试听再保留</span>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {([
                  ['A', pendingSfxOptions.optionA, 'bg-emerald-600 hover:bg-emerald-700'],
                  ['B', pendingSfxOptions.optionB, 'bg-teal-600 hover:bg-teal-700'],
                ] as const).map(([id, option, buttonClass]) => option && (
                  <div key={id} className="rounded-2xl border border-emerald-100 bg-white p-3.5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-black text-slate-800">
                        <span className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-[9px] font-black text-white ${id === 'A' ? 'bg-emerald-600' : 'bg-teal-600'}`}>{id}</span>
                        版本 {id}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-black text-slate-600">
                        {formatAudioDuration(optionPreviews[id].duration || option.duration)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 p-2.5">
                      <button
                        type="button"
                        onClick={() => playSfxOption(id, option.url)}
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-all ${
                          playingOptionId === id
                            ? `${id === 'A' ? 'bg-emerald-600 border-emerald-500' : 'bg-teal-600 border-teal-500'} text-white`
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                        title={playingOptionId === id ? '暂停试听' : '试听'}
                      >
                        {playingOptionId === id ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-black text-slate-800">{option.title}</p>
                        <p className="mt-0.5 truncate text-[9px] text-slate-400">
                          {optionPreviews[id].status === 'loading' ? '正在读取音波...' : option.details}
                        </p>
                      </div>
                    </div>

                    {renderOptionWaveform(id)}

                    <a
                      href={option.url}
                      download={`${option.title}.mp3`}
                      className={`flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-bold text-white transition-colors ${buttonClass}`}
                    >
                      <Download className="w-3 h-3" />
                      <span>下载版本 {id}</span>
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
              <span>已归档的音效 ({sfxHistory.length})</span>
              <span className="text-[10px] text-slate-400 font-normal">本会话</span>
            </h3>

            {sfxHistory.length === 0 ? (
              <p className="text-slate-400 text-[10px] text-center py-6">暂无历史音效。成功生成的音效将在下面自动保存。</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                {sfxHistory.map((item) => {
                  const isHistPlaying = playingHistoryId === item.id;
                  return (
                    <div key={item.id} className="p-3 bg-slate-50 border border-slate-200 hover:border-emerald-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                      <audio
                        ref={el => { historyAudioRefs.current[item.id] = el; }}
                        src={item.url}
                        onEnded={() => setPlayingHistoryId(null)}
                      />
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <button
                          onClick={() => handleHistoryPlayPause(item.id)}
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                            isHistPlaying
                              ? 'bg-emerald-600 text-white border-emerald-500'
                              : 'bg-white text-slate-500 border-slate-200 hover:text-slate-905 hover:bg-slate-50'
                          }`}
                        >
                          {isHistPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                        </button>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-700 truncate text-[11px]">{item.title}</p>
                          <p className="text-[9px] text-slate-400 truncate italic">"{item.prompt}"</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[9px] text-slate-400 font-mono hidden sm:inline">{item.timestamp.split(' ')[1]}</span>
                        <a
                          href={item.url}
                          download={`${item.id}.mp3`}
                          className="p-1 hover:bg-emerald-50 hover:text-emerald-700 text-slate-400 rounded transition-colors"
                          title="下载"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
