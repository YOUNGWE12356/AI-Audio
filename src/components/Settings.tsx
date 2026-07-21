/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Settings, 
  CheckCircle2, 
  AlertCircle,
  Database,
  Trash2,
  Cpu,
  Sparkles,
  HelpCircle
} from 'lucide-react';

interface SettingsProps {
  onKeysUpdated?: () => void;
}

export default function SettingsComponent({ onKeysUpdated }: SettingsProps) {
  const [cleared, setCleared] = useState(false);

  const handleClearCache = () => {
    if (typeof window !== 'undefined' && confirm('确定要清空本地浏览器缓存与历史工程记录吗？这不会影响服务器已保存的文件，但会清空您的本地操作历史。')) {
      localStorage.clear();
      setCleared(true);
      if (onKeysUpdated) {
        onKeysUpdated();
      }
      setTimeout(() => setCleared(false), 2500);
      window.location.reload();
    }
  };

  return (
    <div id="settings-view" className="flex-1 p-6 space-y-6 max-w-4xl mx-auto w-full">
      {/* Workspace Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Global Settings & Status</span>
          </div>
          <h2 className="text-xl font-black text-slate-800 mt-1">设置 & 状态监控</h2>
          <p className="text-xs text-slate-500 mt-1">查看系统集成服务状态，管理本地缓存与历史工程数据。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Left Status monitor card */}
        <div className="md:col-span-7 space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3">
              <Cpu className="w-4 h-4 text-emerald-600" />
              <span>服务集成状态</span>
            </h3>

            <div className="space-y-4">
              {/* Gemini status */}
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-150 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Gemini AI API</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5">负责多模态创意素材分析、声音排程规划与提示词优化</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-600 font-bold text-xs shrink-0 bg-emerald-50 px-2 py-1 rounded-lg">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>已启用 (云端托管)</span>
                </div>
              </div>

              {/* ElevenLabs status */}
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-150 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">ElevenLabs Audio API</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5">负责高保真声音合成、环境音效与角色克隆配音生成</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-600 font-bold text-xs shrink-0 bg-emerald-50 px-2 py-1 rounded-lg">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>已启用 (云端托管)</span>
                </div>
              </div>
            </div>

            <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4 text-xs text-emerald-800 leading-relaxed">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <p>
                  <strong>安全须知：</strong>当前系统的所有 API 密钥与敏感凭证均已通过服务器后台环境变量（Secrets）进行安全托管，且均处于健康运行状态。您在前端无需手动输入、保存或管理任何密钥。
                </p>
              </div>
            </div>
          </div>

          {/* Local Cache management */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3">
              <Database className="w-4 h-4 text-slate-600" />
              <span>数据与本地存储</span>
            </h3>

            <div className="space-y-2 text-xs text-slate-500">
              <p>为了给您提供连贯的体验，您的创意工程进度（如剪辑轨道、配音列表、上传的文件记录）会临时保存在本地浏览器的 LocalStorage 中。</p>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-1">如果您在使用过程中遇到页面卡顿、数据不同步或需要全新重置，可以选择清空本地浏览器缓存。该操作将彻底重置本地的所有会话与历史记录。</p>
            </div>

            <div className="pt-2">
              <button
                onClick={handleClearCache}
                className="w-full bg-slate-50 hover:bg-red-50 text-slate-700 hover:text-red-600 border border-slate-200 hover:border-red-200 font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
              >
                <Trash2 className="w-4 h-4" />
                <span>{cleared ? '本地缓存已清空，正在重载页面...' : '清空本地缓存并重置应用'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Info Card */}
        <div className="md:col-span-5 space-y-4 text-xs text-slate-500">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3">
              <HelpCircle className="w-4 h-4 text-emerald-600" />
              <span>设置说明</span>
            </h3>

            <div className="space-y-3.5 leading-relaxed">
              <div className="space-y-1">
                <p className="font-bold text-slate-700">1. 为什么去掉了 API 密钥配置？</p>
                <p>为了保证用户密钥的安全并简化操作流程，本应用已将所有的核心 AI 接口密钥统一迁移到安全隔离的服务器后端托管。前端无需再手动配置或输入，直接即可开始流畅创作。</p>
              </div>

              <div className="space-y-1">
                <p className="font-bold text-slate-700">2. 重置应用会丢失我的作品吗？</p>
                <p>重置只会清空您在当前浏览器中留存的操作痕迹和本地历史工程列表，而对于您已经在各个功能模块（如配乐混音、AI 配音合成）中生成并下载的媒体文件不会产生任何影响。</p>
              </div>

              <div className="space-y-1">
                <p className="font-bold text-slate-700">3. 如何使用克隆声线？</p>
                <p>在 AI 配音模块中，系统已经内置了丰富的极品中文、游戏动漫、小说、媒体广告等顶级克隆声线。您可以直接使用它们进行完美的人声朗读与配音创作。</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
