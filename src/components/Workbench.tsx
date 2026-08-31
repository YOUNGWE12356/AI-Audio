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
  Database,
  RefreshCw,
} from 'lucide-react';
import { HistoryItem, TabType } from '../types';

interface WorkbenchProps {
  setCurrentTab: (tab: TabType) => void;
  historyList: HistoryItem[];
  assistantPanel?: React.ReactNode;
}

export default function Workbench({ setCurrentTab, historyList, assistantPanel }: WorkbenchProps) {
  const studios = [
    {
      id: 'audio-director' as const,
      name: 'AI 音频设计',
      desc: '解析文字、图片、音频与视频参考，规划影片或游戏的音效、配乐和配音制作方案',
      icon: Sparkles,
      color: 'from-emerald-500/20 to-teal-500/20 text-emerald-400 border-emerald-500/15',
      badge: '核心模块',
    },
    {
      id: 'music-studio' as const,
      name: 'AI 音乐',
      desc: '根据风格、情绪、速度、乐器和歌词生成纯音乐或带人声的双版本音乐',
      icon: Music,
      color: 'from-indigo-500/20 to-purple-500/20 text-indigo-400 border-indigo-500/15',
      badge: 'AI 作曲',
    },
    {
      id: 'sfx-studio' as const,
      name: 'AI 音效',
      desc: '输入声音对象、动作、材质和空间，生成可对比、试听和下载的双版本音效',
      icon: Waves,
      color: 'from-blue-500/20 to-cyan-500/20 text-blue-400 border-blue-500/15',
      badge: 'Foley 音效',
    },
    {
      id: 'dubbing-studio' as const,
      name: 'AI 配音',
      desc: '覆盖文本配音、语音转语音、声音克隆、声音转换和语音转文本完整流程',
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
      intro: '在同一条视频时间线上组织原声、配音、音效和音乐，完成从素材分析到最终混音。',
      usage: '导入视频，识别字幕与对白片段；在轨道中补充配音、环境声、动作音效和 BGM，检查时间与音量后导出。',
      functions: ['字幕/对白识别', '多轨时间线', '混音与导出'],
    },
    {
      id: 'audio-director' as const,
      title: 'AI 音频设计',
      tag: '总策划',
      icon: Sparkles,
      accent: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      intro: '把文字、图片、音频或视频参考拆成可执行的声音方向、素材清单与时间排程。',
      usage: '上传参考素材并补充项目目标，生成整体声音方案；确认后把音乐、音效或配音提示发送到对应模块继续制作。',
      functions: ['多模态解析', '声音方案规划', '跨模块发送'],
    },
    {
      id: 'music-studio' as const,
      title: 'AI 音乐',
      tag: '作曲',
      icon: Music,
      accent: 'bg-indigo-50 text-indigo-700 border-indigo-100',
      intro: '生成纯音乐或带歌词人声的音乐版本，可用于短片、宣传片、游戏循环与氛围铺底。',
      usage: '描述曲风、情绪、速度、乐器和时长；需要人声时输入歌词。生成后在音波上点击定位，对比版本并下载。',
      functions: ['纯音乐/带词', '双版本试听', '音波定位播放'],
    },
    {
      id: 'sfx-studio' as const,
      title: 'AI 音效',
      tag: 'Foley',
      icon: Waves,
      accent: 'bg-blue-50 text-blue-700 border-blue-100',
      intro: '生成动作、机械、自然、科幻、界面、转场和环境氛围等独立声音素材。',
      usage: '按“对象 + 动作 + 材质 + 空间 + 强度”描述声音，选择自动或指定时长；试听两个版本后下载或归档。',
      functions: ['自动/指定时长', '双版本生成', '历史归档'],
    },
    {
      id: 'dubbing-studio' as const,
      title: 'AI 配音',
      tag: '配音中心',
      icon: Mic,
      accent: 'bg-pink-50 text-pink-700 border-pink-100',
      intro: '集中处理单条与批量 TTS、语音转语音、跨语言声音克隆，以及带时间码的语音转文本。',
      usage: '先选择左侧任务类型，再导入语音或输入台词；设置语言、声线和表达方式，生成后通过音波试听并下载。',
      functions: ['单条/批量 TTS', '语音转语音', '克隆与转写'],
    },
    {
      id: 'dubbing-studio' as const,
      title: '声音转换',
      tag: '四套方案',
      icon: RefreshCw,
      accent: 'bg-violet-50 text-violet-700 border-violet-100',
      intro: '支持直接表达式翻译、Seed-VC 音色迁移、多人角色分轨，以及对白与笑声/呼吸等事件混合。',
      usage: '进入 AI 配音后选择“声音转换”，再选择方案一至四；上传素材，分析台词与角色，确认目标文本后生成 A/B 版本。',
      functions: ['跨语言音色迁移', '多人角色分轨', '声音事件保留'],
    },
    {
      id: 'audio-tools' as const,
      title: '音频工具',
      tag: '工作站',
      icon: SlidersHorizontal,
      accent: 'bg-cyan-50 text-cyan-700 border-cyan-100',
      intro: '提供多轨工作站、音频分析、批量格式/压缩/响度处理和 AI 人声分离。',
      usage: '根据任务选择左侧工具：在工作站剪辑混音，在分析页检查音频指标，或批量转成 WAV/MP3 并统一响度。',
      functions: ['多轨编辑', '分析与转码', '人声分离'],
    },
    {
      id: 'sfx-requirements' as const,
      title: '音效需求表',
      tag: '清单',
      icon: ClipboardList,
      accent: 'bg-teal-50 text-teal-700 border-teal-100',
      intro: '从描述、截图、音频或视频中整理标准化音效、配乐和配音制作需求。',
      usage: '选择表格模板，输入需求或上传参考素材；生成后逐行校对、继续追加，再导出 CSV 交给 Excel、WPS 或团队协作。',
      functions: ['多模态识别', '模板化需求表', '追加与 CSV 导出'],
    },
    {
      id: 'sfx-library' as const,
      title: '音效库',
      tag: '资产',
      icon: Database,
      accent: 'bg-slate-50 text-slate-700 border-slate-200',
      intro: '集中管理生成或导入的声音资产，用统一名称、分类和关键词支持长期复用。',
      usage: '上传或归档常用声音，补充分类与关键词；按名称和标签检索，试听确认后下载或用于后续项目。',
      functions: ['上传与归档', '搜索/分类管理', '试听与下载'],
    },
  ];

  const workflowSteps = [
    ['1', '选择任务', '从生成、转换、剪辑或资产管理中选择入口'],
    ['2', '准备输入', '输入需求文字，或导入图片、音频与视频素材'],
    ['3', '生成与调整', '检查识别结果和参数，对比 A/B 版本并修改'],
    ['4', '试听与交付', '点击音波定位检查，下载音频或导出需求表'],
  ];

  return (
    <div id="workbench-view" className="flex-1 p-8 space-y-6 max-w-6xl mx-auto w-full">
      {/* Welcome Banner */}
      <div id="workbench-hero" className="relative overflow-hidden p-6 md:p-7">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.14)_0%,rgba(20,184,166,0.07)_42%,transparent_82%)]" />
        <div className="relative z-10">
          <div className="space-y-3 text-center">
            <h2 className="text-2xl md:text-3xl font-extrabold text-slate-800 tracking-tight">
              欢迎回来，音频制作人
            </h2>
          </div>
        </div>
      </div>

      {assistantPanel}

      {/* Main Studio Modules Grid */}
      <div className="-mt-2 space-y-4">
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
            从需求规划、声音生成和音色转换，到时间线剪辑与资产交付；先按任务选择入口，再按照卡片中的步骤操作。
          </p>
        </div>

        <div className="grid grid-cols-1 border-b border-slate-100 pb-4 sm:grid-cols-2 xl:grid-cols-4">
          {workflowSteps.map(([number, title, description], index) => (
            <div key={number} className={`flex gap-3 px-3 py-2 ${index > 0 ? 'sm:border-l sm:border-slate-100' : ''}`}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-black text-emerald-700">{number}</span>
              <div><p className="text-[11px] font-black text-slate-800">{title}</p><p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{description}</p></div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {featureGuide.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={`${item.id}-${item.title}`}
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
