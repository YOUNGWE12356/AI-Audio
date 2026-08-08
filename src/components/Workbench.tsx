/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  Sparkles, 
  Music, 
  Waves, 
  Mic, 
  ArrowRight,
  Film,
  SlidersHorizontal,
  ClipboardList,
  Database
} from 'lucide-react';
import { HistoryItem, TabType } from '../types';

interface WorkbenchProps {
  setCurrentTab: (tab: TabType) => void;
  historyList: HistoryItem[];
}

export default function Workbench({ setCurrentTab, historyList }: WorkbenchProps) {
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

  const featureGuide = [
    {
      id: 'video-soundtrack' as const,
      title: '视频声音制作',
      tag: '视频配声',
      icon: Film,
      accent: 'bg-amber-50 text-amber-700 border-amber-100',
      intro: '围绕视频片段组织配音、音效、音乐和时间线，适合做短片、广告、游戏演示的完整声音层。',
      usage: '导入视频或素材后，按画面段落添加声音需求，逐步完成角色配音、环境声、强调音效和背景音乐。',
      functions: ['视频声轨规划', '时间线式整理', '多类型声音组合'],
    },
    {
      id: 'audio-director' as const,
      title: 'AI 音频设计',
      tag: '总策划',
      icon: Sparkles,
      accent: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      intro: '把场景、画面或创意描述拆成可执行的声音方案，帮助先确定整体声音风格和制作清单。',
      usage: '输入项目背景、情绪、场景节奏或参考方向，让系统生成声音设计建议，再进入具体模块制作。',
      functions: ['声音方案规划', '素材需求拆解', '音乐与音效排程'],
    },
    {
      id: 'music-studio' as const,
      title: 'AI 音乐',
      tag: '作曲',
      icon: Music,
      accent: 'bg-indigo-50 text-indigo-700 border-indigo-100',
      intro: '根据文字提示生成背景音乐 Demo，可用于氛围铺底、片头片尾、宣传片和游戏循环音乐。',
      usage: '描述风格、速度、情绪、乐器和时长；需要人声时补充歌词或演唱方向。',
      functions: ['纯音乐生成', '带词音乐草稿', '风格/情绪控制'],
    },
    {
      id: 'sfx-studio' as const,
      title: 'AI 音效',
      tag: 'Foley',
      icon: Waves,
      accent: 'bg-blue-50 text-blue-700 border-blue-100',
      intro: '快速生成单个或一组场景音效，适合动作、机械、自然、科幻、转场等声音素材。',
      usage: '输入对象、动作、材质、空间和强度，例如“金属机器人缓慢脚步，近距离，厚重”。',
      functions: ['独立音效生成', '场景氛围声', '动作/材质音色描述'],
    },
    {
      id: 'dubbing-studio' as const,
      title: 'AI 配音',
      tag: 'TTS',
      icon: Mic,
      accent: 'bg-pink-50 text-pink-700 border-pink-100',
      intro: '把文本转成角色配音，适合旁白、角色对白、产品介绍、教学说明和情绪化表达。',
      usage: '选择声线与语气，输入台词，按需要调整速度、情绪和语言，再生成并试听。',
      functions: ['角色声线选择', '多语种配音', '情绪与语速控制'],
    },
    {
      id: 'audio-tools' as const,
      title: '音频工具',
      tag: '工作站',
      icon: SlidersHorizontal,
      accent: 'bg-cyan-50 text-cyan-700 border-cyan-100',
      intro: '提供多轨音频工作站和常用处理工具，用来导入、剪辑、移调、导出和整理音频。',
      usage: '进入音频工作站后，可拖拽音频进轨道，选中片段进行剪切、淡入淡出、移调和混音导出。',
      functions: ['多轨编辑', '拖拽导入', '移调/剪切/导出'],
    },
    {
      id: 'sfx-requirements' as const,
      title: '音效需求表',
      tag: '清单',
      icon: ClipboardList,
      accent: 'bg-teal-50 text-teal-700 border-teal-100',
      intro: '用于整理项目里的音效条目，把每个镜头或段落需要的声音变成可跟踪清单。',
      usage: '按场景、时间点、描述、优先级记录需求，方便后续生成、替换、确认和交付。',
      functions: ['需求记录', '镜头/时间点管理', '制作进度跟踪'],
    },
    {
      id: 'sfx-library' as const,
      title: '音效库',
      tag: '资产',
      icon: Database,
      accent: 'bg-slate-50 text-slate-700 border-slate-200',
      intro: '集中管理已生成或导入的音效资产，方便按类型、用途和项目复用。',
      usage: '把常用音效保存到库中，通过分类和关键词查找，再下载或放入后续项目。',
      functions: ['资产归档', '分类检索', '项目复用'],
    },
  ];

  return (
    <div id="workbench-view" className="flex-1 p-8 space-y-8 max-w-6xl mx-auto w-full">
      {/* Welcome Banner */}
      <div id="workbench-hero" className="relative overflow-hidden rounded-3xl bg-white border border-emerald-100 p-6 md:p-7 shadow-md">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-emerald-500/5 to-teal-500/5 blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <div className="space-y-3 text-center md:text-left">
            <h2 className="text-2xl md:text-3xl font-extrabold text-slate-800 tracking-tight">
              欢迎回来，音频制作人
            </h2>
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

      {/* Product Guide */}
      <div id="tool-guide" className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">AI Audio Guide</p>
            <h3 className="mt-1 text-lg font-black text-slate-800">功能说明与使用方法</h3>
          </div>
          <p className="max-w-xl text-xs leading-relaxed text-slate-500">
            从创意规划到生成、剪辑、资产管理，AI Audio 把音频制作拆成清晰模块；根据当前任务选择入口即可开始。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {featureGuide.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCurrentTab(item.id)}
                className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-white hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${item.accent}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-black text-slate-500">
                    {item.tag}
                  </span>
                </div>

                <div className="mt-3 space-y-3">
                  <div>
                    <h4 className="text-sm font-black text-slate-800 group-hover:text-emerald-700">{item.title}</h4>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{item.intro}</p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
                    <div className="text-[10px] font-black text-slate-700">怎么用</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{item.usage}</p>
                  </div>

                  <div>
                    <div className="mb-1.5 text-[10px] font-black text-slate-700">主要功能</div>
                    <div className="flex flex-wrap gap-1.5">
                      {item.functions.map(feature => (
                        <span
                          key={feature}
                          className="rounded-md border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700"
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-auto flex items-center gap-1.5 pt-4 text-[11px] font-black text-slate-400 group-hover:text-emerald-700">
                  <span>进入功能</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
