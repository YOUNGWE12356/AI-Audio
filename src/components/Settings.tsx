/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  Key, 
  CheckCircle2, 
  HelpCircle, 
  Save, 
  AlertCircle
} from 'lucide-react';

interface SettingsProps {
  onKeysUpdated?: () => void;
}

export default function SettingsComponent({ onKeysUpdated }: SettingsProps) {
  const [geminiKey, setGeminiKey] = useState('');
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setGeminiKey(localStorage.getItem('GEMINI_API_KEY') || '');
      setElevenLabsKey(localStorage.getItem('ELEVENLABS_API_KEY') || '');
    }
  }, []);

  const handleSave = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('GEMINI_API_KEY', geminiKey.trim());
      localStorage.setItem('ELEVENLABS_API_KEY', elevenLabsKey.trim());
      setSaved(true);
      if (onKeysUpdated) {
        onKeysUpdated();
      }
      setTimeout(() => setSaved(false), 2500);
    }
  };

  const handleClear = () => {
    if (typeof window !== 'undefined' && confirm('确定要清空本地配置的 API Keys 吗？')) {
      localStorage.removeItem('GEMINI_API_KEY');
      localStorage.removeItem('ELEVENLABS_API_KEY');
      setGeminiKey('');
      setElevenLabsKey('');
      if (onKeysUpdated) {
        onKeysUpdated();
      }
    }
  };

  const hasEnvGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasEnvElevenLabs = Boolean(process.env.ELEVENLABS_API_KEY);

  return (
    <div id="settings-view" className="flex-1 p-6 space-y-6 max-w-4xl mx-auto w-full">
      {/* Workspace Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Global Keys Configuration</span>
          </div>
          <h2 className="text-xl font-black text-slate-800 mt-1">设置 & 凭证管理</h2>
          <p className="text-xs text-slate-500 mt-1">在此配置模型与声音合成服务所需的 API Keys。所有密钥皆保存在您的本地浏览器中，安全可信。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Left Input card */}
        <div className="md:col-span-7 space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3">
              <Key className="w-4 h-4 text-emerald-600" />
              <span>API 密钥配置</span>
            </h3>

            {/* Gemini secret input */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">Gemini API Key</label>
                {hasEnvGemini && (
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-bold border border-emerald-100">系统预设已载入</span>
                )}
              </div>
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder={hasEnvGemini ? "••••••••••••••••••••••••••••" : "输入以 AI_STUDIO_KEY 格式开头的 Gemini Key..."}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3.5 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:bg-white focus:outline-none transition-all placeholder-slate-400"
              />
              <p className="text-[10px] text-slate-400 leading-relaxed">用于对视频/画幅等多模态创意素材进行分析，规划并设计声音 cue sheet 方案。</p>
            </div>

            {/* ElevenLabs secret input */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">ElevenLabs API Key</label>
                {hasEnvElevenLabs && (
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-bold border border-emerald-100">系统预设已载入</span>
                )}
              </div>
              <input
                type="password"
                value={elevenLabsKey}
                onChange={(e) => setElevenLabsKey(e.target.value)}
                placeholder={hasEnvElevenLabs ? "••••••••••••••••••••••••••••" : "输入 ElevenLabs 网页控制台获取的 API Key..."}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3.5 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:bg-white focus:outline-none transition-all placeholder-slate-400"
              />
              <p className="text-[10px] text-slate-400 leading-relaxed">用于合成并生成最终的高保真音效、氛围声景以及人物角色配音。</p>
            </div>

            {/* Actions button */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-750 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10 transition-all"
              >
                {saved ? <CheckCircle2 className="w-4 h-4 text-white" /> : <Save className="w-4 h-4 text-white" />}
                <span>{saved ? '配置已成功保存！' : '保存设置'}</span>
              </button>
              
              <button
                onClick={handleClear}
                className="bg-slate-50 hover:bg-red-50 text-slate-500 hover:text-red-600 border border-slate-200 hover:border-red-200 px-4 py-2.5 rounded-xl text-xs transition-all font-semibold animate-transition"
              >
                清空密钥
              </button>
            </div>
          </div>
        </div>

        {/* Right Info Card */}
        <div className="md:col-span-5 space-y-4 text-xs text-slate-500">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3">
              <HelpCircle className="w-4 h-4 text-emerald-600" />
              <span>常见配置解答</span>
            </h3>

            <div className="space-y-3.5 leading-relaxed">
              <div className="space-y-1">
                <p className="font-bold text-slate-700">1. 如何获取 Gemini Key？</p>
                <p>您可以免费前往 <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">Google AI Studio</a> 创建 API Key 并直接粘贴至上方。</p>
              </div>

              <div className="space-y-1">
                <p className="font-bold text-slate-700">2. 如何获取 ElevenLabs Key？</p>
                <p>注册登录 <a href="https://elevenlabs.io/" target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">ElevenLabs</a> 平台后，在个人设置 (Profile Settings) 页面中即可直接获取您的私人 API Key。</p>
              </div>

              <div className="space-y-1">
                <p className="font-bold text-slate-700">3. 为什么我能正常使用？</p>
                <p>如果应用已部署于支持环境变量的容器中，本系统会默认读取环境变量。如果您不需要自定义密钥，保持上方留空即可。</p>
              </div>
            </div>

            <div className="bg-amber-50/60 p-4 rounded-xl border border-amber-200/50 flex gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-800 leading-normal">
                安全提示：保存在本地的 API Keys 仅会供您当前浏览器对上述大模型与合成接口发送请求，本套件绝不上传和收集您的凭证。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
