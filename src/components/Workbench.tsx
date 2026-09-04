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
  const featureGuide = [
    {
      id: 'video-soundtrack' as const,
      title: '视频声音制作',
      tag: '视频配声',
      icon: Film,
      accent: 'bg-amber-50 text-amber-700 border-amber-100',
      intro: '在同一条视频时间线上组织原声、配音、音效和音乐，完成从素材分析到最终混音。',
      usage: [
        '导入视频或音频，等待系统识别字幕、对白和时间码；先检查识别结果是否准确。',
        '在时间线上添加配音、环境声、动作音效和 BGM，拖动片段调整起止位置，并分别控制各轨道音量。',
        '从头到尾试听混音，确认对白清楚、音效不抢声后，导出最终视频或音频文件。',
      ],
      functions: ['字幕/对白识别', '多轨时间线', '混音与导出'],
    },
    {
      id: 'audio-director' as const,
      title: 'AI 音频设计',
      tag: '总策划',
      icon: Sparkles,
      accent: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      intro: '把文字、图片、音频或视频参考拆成可执行的声音方向、素材清单与时间排程。',
      usage: [
        '输入项目类型、画面内容和声音目标，也可以上传截图、音频或视频作为参考。',
        '查看 AI 拆分出的音乐、音效、配音清单和出现时刻；补充遗漏内容或修改不符合项目的建议。',
        '确认方案后，将音乐、音效或配音任务发送到对应工具继续生成，并保留需求表作为制作依据。',
      ],
      functions: ['多模态解析', '声音方案规划', '跨模块发送'],
    },
    {
      id: 'music-studio' as const,
      title: 'AI 音乐',
      tag: '作曲',
      icon: Music,
      accent: 'bg-indigo-50 text-indigo-700 border-indigo-100',
      intro: '生成纯音乐或带歌词人声的音乐版本，可用于短片、宣传片、游戏循环与氛围铺底。',
      usage: [
        '填写曲风、情绪、速度、乐器、用途和目标时长；需要人声时，再输入完整歌词或段落结构。',
        '选择纯音乐或带歌词人声模式后开始生成，等待两个版本完成并比较旋律、编曲和人声表现。',
        '点击波形定位试听重点段落，确认版本和名称后下载音频，或将结果继续放入工作站剪辑。',
      ],
      functions: ['纯音乐/带词', '双版本试听', '音波定位播放'],
    },
    {
      id: 'sfx-studio' as const,
      title: 'AI 音效',
      tag: 'Foley',
      icon: Waves,
      accent: 'bg-blue-50 text-blue-700 border-blue-100',
      intro: '生成动作、机械、自然、科幻、界面、转场和环境氛围等独立声音素材。',
      usage: [
        '用“对象 + 动作 + 材质 + 空间 + 强度”描述声音，例如“金属门在狭窄走廊中快速关闭”。',
        '选择自动时长或输入指定时长，必要时补充近景/远景、速度和情绪等限制条件后生成两个版本。',
        '对比试听两个版本，确认起音、尾音和质感符合画面后下载；常用素材可直接归档到音效库。',
      ],
      functions: ['自动/指定时长', '双版本生成', '历史归档'],
    },
    {
      id: 'dubbing-studio' as const,
      title: 'AI 配音',
      tag: '配音中心',
      icon: Mic,
      accent: 'bg-pink-50 text-pink-700 border-pink-100',
      intro: '集中处理单条与批量 TTS、语音转语音、跨语言声音克隆，以及带时间码的语音转文本。',
      usage: [
        '先在左侧选择文本转语音、语音转语音、声音克隆或语音转文本等任务类型。',
        '按页面提示输入台词或上传参考语音，再设置语言、声线、语速、情绪和表达方式等参数。',
        '生成后逐句试听并检查发音、停顿和时长；确认无误后下载，或把音频送入工作站继续处理。',
      ],
      functions: ['单条/批量 TTS', '语音转语音', '克隆与转写'],
    },
    {
      id: 'dubbing-studio' as const,
      title: '声音转换',
      tag: '四套方案',
      icon: RefreshCw,
      accent: 'bg-violet-50 text-violet-700 border-violet-100',
      intro: '支持直接表达式翻译、Seed-VC 音色迁移、多人角色分轨，以及对白与笑声/呼吸等事件混合。',
      usage: [
        '进入 AI 配音的“声音转换”，选择单人转换、多人角色转换或克隆转换等方案。',
        '上传原始对白或视频，等待系统识别台词、角色和声音事件；检查文本、分段和目标语言是否正确。',
        '确认参数后生成 A/B 版本，逐段对比音色、口型节奏和时长；满意的版本可下载或直接加入工作站。',
      ],
      functions: ['跨语言音色迁移', '多人角色分轨', '声音事件保留'],
    },
    {
      id: 'audio-tools' as const,
      title: '音频工具',
      tag: '工作站',
      icon: SlidersHorizontal,
      accent: 'bg-cyan-50 text-cyan-700 border-cyan-100',
      intro: '提供多轨工作站、音频分析、批量格式/压缩/响度处理和 AI 人声分离。',
      usage: [
        '根据任务选择音频工作站、音频分析、格式转换、响度处理或人声分离等工具。',
        '上传一个或多个音频，按页面提示设置剪辑范围、输出格式、采样率、目标响度或分离选项。',
        '检查波形、响度和导出规格，确认处理结果后下载；需要继续编辑时，可直接放入工作站轨道。',
      ],
      functions: ['多轨编辑', '分析与转码', '人声分离'],
    },
    {
      id: 'sfx-requirements' as const,
      title: '音效需求表',
      tag: '清单',
      icon: ClipboardList,
      accent: 'bg-teal-50 text-teal-700 border-teal-100',
      intro: '从描述、截图、音频或视频中整理标准化音效、配乐和配音制作需求。',
      usage: [
        '先选择项目模板，再输入简短需求，或上传截图、音频、视频等参考文件；系统会按模板整理字段。',
        '检查生成表格中的类型、描述、数量、优先级、命名和 ID；发现遗漏时可补充说明并再次优化。',
        '逐行确认后继续追加任务，最后导出 CSV，交给 Excel、WPS 或团队协作，并保留项目模板便于复用。',
      ],
      functions: ['多模态识别', '模板化需求表', '追加与 CSV 导出'],
    },
    {
      id: 'sfx-library' as const,
      title: '音效库',
      tag: '资产',
      icon: Database,
      accent: 'bg-slate-50 text-slate-700 border-slate-200',
      intro: '集中管理生成或导入的声音资产，用统一名称、分类和关键词支持长期复用。',
      usage: [
        '上传音效或音乐文件，填写规范名称、项目、类别、标签和备注；已有生成结果也可以直接归档。',
        '通过名称、类别或关键词筛选资产，打开详情试听并确认版本、时长和格式是否适合当前项目。',
        '将确认后的文件下载到本地，或拖入音频工作站继续剪辑；常用声音可保留统一标签方便复用。',
      ],
      functions: ['上传与归档', '搜索/分类管理', '试听与下载'],
    },
  ];

  const recentHistory = historyList.slice(0, 20);
  const historyTabByType: Record<HistoryItem['type'], TabType> = {
    sfx: 'sfx-studio',
    music: 'music-studio',
    voice: 'dubbing-studio',
    director: 'audio-director',
    'video-soundtrack': 'video-soundtrack',
  };

  return (
    <div id="workbench-view" className="flex-1 px-8 pt-6 pb-8 space-y-6 max-w-6xl mx-auto w-full">
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

      {/* Product Guide */}
      <div id="tool-guide" className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
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
                    <ol className="mt-2 space-y-1.5">
                      {item.usage.map((step, index) => (
                        <li key={step} className="flex gap-2 text-[11px] leading-relaxed text-slate-500">
                          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[9px] font-black text-emerald-700">
                            {index + 1}
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
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

      <section id="recent-work-history" className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-slate-800">最近工作记录</h3>
            <p className="mt-1 text-[11px] text-slate-500">输入内容、参考文件和生成结果会在此设备长期保留；不支持文件存储的浏览器至少保留完整记录。</p>
          </div>
          <span className="shrink-0 text-[10px] font-bold text-slate-400">最近 {recentHistory.length} 条</span>
        </div>
        {recentHistory.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-[11px] text-slate-400">暂无工作记录</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recentHistory.map(item => (
              <div key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      onClick={() => setCurrentTab(historyTabByType[item.type])}
                      className="truncate text-left text-xs font-bold text-slate-700 hover:text-emerald-700"
                    >
                      {item.title}
                    </button>
                    <span className="text-[10px] font-mono text-slate-400">{item.timestamp}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-500">{item.inputText || item.prompt}</p>
                  {item.attachments && item.attachments.length > 0 && (
                    <p className="mt-1 truncate text-[10px] text-slate-400" title={item.attachments.map(file => file.name).join('、')}>
                      参考文件：{item.attachments.map(file => file.name).join('、')}
                    </p>
                  )}
                </div>
                {item.url && item.url !== '#' && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-500 hover:border-emerald-200 hover:text-emerald-700"
                  >
                    打开文件
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
