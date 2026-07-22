/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { 
  Sparkles, 
  Music, 
  Waves, 
  Mic, 
  Play, 
  Pause, 
  Download, 
  Clock,
  ArrowRight
} from 'lucide-react';
import { HistoryItem, TabType } from '../types';

interface WorkbenchProps {
  setCurrentTab: (tab: TabType) => void;
  historyList: HistoryItem[];
}

const historyTypeMeta: Record<HistoryItem['type'], { label: string; tab: TabType; badgeClass: string }> = {
  music: {
    label: '音乐',
    tab: 'music-studio',
    badgeClass: 'border-indigo-100 bg-indigo-50 text-indigo-700',
  },
  sfx: {
    label: '音效',
    tab: 'sfx-studio',
    badgeClass: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  },
  voice: {
    label: '配音',
    tab: 'dubbing-studio',
    badgeClass: 'border-sky-100 bg-sky-50 text-sky-700',
  },
  director: {
    label: '音频设计',
    tab: 'audio-director',
    badgeClass: 'border-teal-100 bg-teal-50 text-teal-700',
  },
  'video-soundtrack': {
    label: '视频声音制作',
    tab: 'video-soundtrack',
    badgeClass: 'border-amber-100 bg-amber-50 text-amber-700',
  },
};

export default function Workbench({ setCurrentTab, historyList }: WorkbenchProps) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement | null }>({});
  const recentHistory = [...historyList]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 3);

  const handlePlayPause = (id: string, url: string) => {
    // If we're playing another audio, pause it first
    if (playingId && playingId !== id && audioRefs.current[playingId]) {
      audioRefs.current[playingId]?.pause();
    }

    const currentAudio = audioRefs.current[id];
    if (currentAudio) {
      if (playingId === id) {
        currentAudio.pause();
        setPlayingId(null);
      } else {
        currentAudio.play().catch(e => console.error("Play failed:", e));
        setPlayingId(id);
      }
    }
  };

  const studios = [
    {
      id: 'audio-director' as const,
      name: 'AI 音频设计',
      desc: '智能解析多模态素材，一键规划并生成完整影片/游戏音效排程与音乐方案',
      icon: Sparkles,
      color: 'from-emerald-500/20 to-teal-500/20 text-emerald-400 border-emerald-500/15',
      badge: '核心模块',
    },
    {
      id: 'music-studio' as const,
      name: 'AI 音乐',
      desc: '支持通过输入文字关键词与节奏风格，高速生成高品质背景音乐Demo（带词或纯音乐）',
      icon: Music,
      color: 'from-indigo-500/20 to-purple-500/20 text-indigo-400 border-indigo-500/15',
      badge: 'AI 作曲',
    },
    {
      id: 'sfx-studio' as const,
      name: 'AI 音效',
      desc: '专为音效师打造的快捷生成通道，输入场景描述即可生成各类自然、科幻、战争等音效',
      icon: Waves,
      color: 'from-blue-500/20 to-cyan-500/20 text-blue-400 border-blue-500/15',
      badge: 'Foley 音效',
    },
    {
      id: 'dubbing-studio' as const,
      name: 'AI 配音',
      desc: '拟真多语种情感配音，提供男女各色声线与开心、忧伤、严肃等情感语气调节',
      icon: Mic,
      color: 'from-pink-500/20 to-rose-500/20 text-pink-400 border-pink-500/15',
      badge: 'TTS 角色配音',
    }
  ];

  return (
    <div id="workbench-view" className="flex-1 p-8 space-y-8 max-w-6xl mx-auto w-full">
      {/* Welcome Banner */}
      <div id="workbench-hero" className="relative overflow-hidden rounded-3xl bg-white border border-emerald-100 p-6 md:p-7 shadow-md">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-emerald-500/5 to-teal-500/5 blur-3xl pointer-events-none" />
        <div className="relative z-10 grid w-full grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.45fr)] lg:items-center">
          <div className="space-y-3 text-center md:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-100 rounded-full text-xs text-emerald-700 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              AI 多模态音频创作中心 已就绪
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold text-slate-800 tracking-tight">
              欢迎回来，音频制作人
            </h2>
          </div>

          <div id="recent-work-summary" className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <Clock className="h-3.5 w-3.5 text-emerald-600" />
                <span>最近工程与制作</span>
              </h3>
              <span className="text-[10px] font-medium text-slate-400">最近 {recentHistory.length} 条</span>
            </div>

            {recentHistory.length === 0 ? (
              <div className="mt-2 rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-5 text-center text-[11px] text-slate-400">
                完成一次创作后，最近记录会显示在这里
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {recentHistory.map((item) => {
                  const meta = historyTypeMeta[item.type];
                  return (
                    <button
                      key={item.id}
                      id={`recent-work-${item.id}`}
                      type="button"
                      onClick={() => setCurrentTab(meta.tab)}
                      className="group min-w-0 rounded-xl border border-slate-200 bg-white/85 p-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-white hover:shadow-md"
                      aria-label={`打开${item.title}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${meta.badgeClass}`}>
                          {meta.label}
                        </span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-600" />
                      </div>
                      <p className="mt-1.5 line-clamp-2 min-h-8 text-[11px] font-semibold leading-4 text-slate-700 group-hover:text-emerald-800">
                        {item.title}
                      </p>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[9px] font-medium text-slate-400">
                        <span className="truncate">{item.details || '制作记录'}</span>
                        <span className="shrink-0">{item.timestamp.slice(5)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Studio Modules Grid */}
      <div className="space-y-4">
        <h3 className="text-base font-bold text-slate-800">创意工作空间</h3>
        <div id="studios-grid" className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {studios.map((studio) => {
            const Icon = studio.icon;
            return (
              <div 
                key={studio.id}
                id={`studio-card-${studio.id}`}
                onClick={() => setCurrentTab(studio.id)}
                className="group cursor-pointer bg-white hover:bg-emerald-50/20 border border-slate-200 hover:border-emerald-200 rounded-2xl p-6 transition-all duration-300 flex flex-col justify-between h-52 relative overflow-hidden shadow-sm"
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/2 opacity-0 group-hover:opacity-100 transition-opacity rounded-bl-full pointer-events-none" />
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className={`p-2.5 rounded-xl bg-gradient-to-br ${studio.color} border flex items-center justify-center shadow-inner`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-bold text-slate-600 px-2.5 py-0.5 bg-slate-50 rounded-full border border-slate-200">
                      {studio.badge}
                    </span>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-800 group-hover:text-emerald-700 transition-colors">{studio.name}</h4>
                    <p className="text-xs text-slate-500 leading-relaxed mt-1.5">{studio.desc}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 group-hover:text-emerald-700 transition-colors mt-4">
                  <span>立刻进入</span>
                  <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent History Workspace */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-600" />
            <span>最新创作历史</span>
          </h3>
          <span className="text-xs text-slate-500 font-medium">本会话已生成 {historyList.length} 项</span>
        </div>

        {historyList.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-12 text-center shadow-sm">
            <p className="text-slate-400 text-sm">暂无生成记录。在左侧或上方选择任意工作室，开始您的声音创作吧！</p>
          </div>
        ) : (
          <div id="history-items" className="space-y-3">
            {historyList.map((item) => {
              const isPlaying = playingId === item.id;
              return (
                <div 
                  key={item.id}
                  id={`history-item-${item.id}`}
                  className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-emerald-200 transition-all shadow-sm"
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    {/* Audio Player Core Tag */}
                    <audio 
                      ref={el => { audioRefs.current[item.id] = el; }} 
                      src={item.url} 
                      onEnded={() => setPlayingId(null)}
                    />
                    
                    {/* Play Button */}
                    <button
                      onClick={() => handlePlayPause(item.id, item.url)}
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                        isPlaying 
                          ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-500/20' 
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:text-slate-950'
                      }`}
                    >
                      {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-800 truncate">{item.title}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                          item.type === 'music' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' :
                          item.type === 'sfx' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                          item.type === 'voice' ? 'bg-sky-50 text-sky-700 border border-sky-100' :
                          'bg-teal-50 text-teal-700 border border-teal-100'
                        }`}>
                          {item.type === 'music' ? '背景音乐' :
                           item.type === 'sfx' ? '独立音效' :
                           item.type === 'voice' ? '配音角色' : '排程方案'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate mt-1 leading-relaxed italic">"{item.prompt}"</p>
                      <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1 flex-wrap font-medium">
                        <span>{item.timestamp}</span>
                        {item.details && (
                          <>
                            <span className="w-1 h-1 rounded-full bg-slate-300" />
                            <span>{item.details}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <a
                      href={item.url}
                      download={`${item.type}_${item.id}.mp3`}
                      className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-emerald-700 bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-200 px-3 py-1.5 rounded-xl font-semibold transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>下载 MP3</span>
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
