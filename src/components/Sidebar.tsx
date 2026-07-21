/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  LayoutDashboard, 
  Sparkles, 
  Music, 
  Waves, 
  Mic, 
  Settings, 
  Languages, 
  Clock, 
  Folder, 
  History,
  Volume2,
  Database,
  ClipboardList,
  SlidersHorizontal,
  Film,
  X
} from 'lucide-react';
import { TabType } from '../types';

interface SidebarProps {
  currentTab: TabType;
  setCurrentTab: (tab: TabType) => void;
  isMobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar({ currentTab, setCurrentTab, isMobileOpen, onMobileClose }: SidebarProps) {
  const mainFeatures = [
    { id: 'workbench' as const, label: '工作台', icon: LayoutDashboard },
    { id: 'video-soundtrack' as const, label: '视频生成音频', icon: Film },
    { id: 'audio-director' as const, label: 'AI 音频设计', icon: Sparkles },
    { id: 'music-studio' as const, label: 'AI 音乐', icon: Music },
    { id: 'sfx-studio' as const, label: 'AI 音效', icon: Waves },
    { id: 'dubbing-studio' as const, label: 'AI 配音', icon: Mic },
    { id: 'audio-tools' as const, label: '音频工具', icon: SlidersHorizontal },
    { id: 'sfx-requirements' as const, label: '音效需求表', icon: ClipboardList },
    { id: 'sfx-library' as const, label: '音效库', icon: Database },
    { id: 'settings' as const, label: '设置', icon: Settings },
  ];

  const comingSoonFeatures = [
    { label: '翻译字幕', icon: Languages },
    { label: '时间线', icon: Clock },
    { label: '生成历史', icon: History },
  ];

  React.useEffect(() => {
    if (!isMobileOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onMobileClose();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isMobileOpen, onMobileClose]);

  const handleTabChange = (tab: TabType) => {
    setCurrentTab(tab);
    onMobileClose();
  };

  const renderSidebarContent = (variant: 'desktop' | 'mobile') => (
    <>
      {/* Brand Logo */}
      <div className="px-6 py-6 border-b border-slate-100 flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="w-9 h-9 shrink-0 bg-gradient-to-tr from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/10">
            <Volume2 className="text-white w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold tracking-tight text-slate-800">AI Audio Suite</h1>
            <p className="truncate text-[10px] text-emerald-600 font-semibold">多模态音频创作中心</p>
          </div>
        </div>
        {variant === 'mobile' && (
          <button
            type="button"
            onClick={onMobileClose}
            className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            aria-label="关闭导航菜单"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-7 custom-scrollbar">
        {/* Main Features Segment */}
        <div className="space-y-1.5">
          <p className="px-3 text-[10px] font-bold text-emerald-800/80 tracking-wider uppercase mb-2">主功能</p>
          {mainFeatures.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                id={`nav-item-${variant}-${item.id}`}
                onClick={() => handleTabChange(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                  isActive 
                    ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100' 
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Icon className={`w-4 h-4 transition-colors ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Coming Soon Segment */}
        <div className="space-y-1.5">
          <p className="px-3 text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-2">即将推出</p>
          {comingSoonFeatures.map((item, index) => {
            const Icon = item.icon;
            return (
              <div
                key={index}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-400 cursor-not-allowed"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-slate-300" />
                  <span>{item.label}</span>
                </div>
                <span className="text-[9px] scale-90 text-slate-400 bg-slate-50 border border-slate-150 px-1 rounded font-normal">Soon</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer User Profile (Light Emerald style) */}
      <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 flex items-center justify-center text-xs font-bold text-white shadow-sm">
          AD
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-700 truncate">Audio Director</p>
          <p className="text-[10px] text-slate-500 truncate">Professional Edition</p>
        </div>
      </div>
    </>
  );

  return (
    <>
      <aside
        id="sidebar-desktop"
        className="hidden h-dvh w-64 shrink-0 select-none flex-col border-r border-slate-200 bg-white lg:flex"
        aria-label="主导航"
      >
        {renderSidebarContent('desktop')}
      </aside>

      {isMobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
            onClick={onMobileClose}
            aria-label="关闭导航背景"
          />
          <aside
            id="sidebar-mobile"
            className="relative z-10 flex h-dvh w-[min(20rem,calc(100vw-3rem))] flex-col border-r border-slate-200 bg-white shadow-2xl"
            aria-label="移动端主导航"
          >
            {renderSidebarContent('mobile')}
          </aside>
        </div>
      )}
    </>
  );
}
