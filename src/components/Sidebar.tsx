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
  Folder, 
  Volume2,
  Database,
  ClipboardList,
  SlidersHorizontal,
  Film,
  X
} from 'lucide-react';
import { TabType } from '../types';

const SIDEBAR_MIN_WIDTH = 72;
const SIDEBAR_COMPACT_WIDTH = 160;
const SIDEBAR_DEFAULT_WIDTH = 192;
const SIDEBAR_MAX_WIDTH = 520;

interface SidebarProps {
  currentTab: TabType;
  setCurrentTab: (tab: TabType) => void;
  isMobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar({ currentTab, setCurrentTab, isMobileOpen, onMobileClose }: SidebarProps) {
  const [desktopWidth, setDesktopWidth] = React.useState(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem('ai-audio-sidebar-width'));
    return Number.isFinite(saved) ? Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, saved)) : SIDEBAR_DEFAULT_WIDTH;
  });
  const [isResizingDesktop, setIsResizingDesktop] = React.useState(false);
  const isDesktopCompact = desktopWidth < SIDEBAR_COMPACT_WIDTH;

  const mainFeatures = [
    { id: 'workbench' as const, label: '工作台', icon: LayoutDashboard },
    { id: 'video-soundtrack' as const, label: '视频声音制作', icon: Film },
    { id: 'audio-director' as const, label: 'AI 音频设计', icon: Sparkles },
    { id: 'music-studio' as const, label: 'AI 音乐', icon: Music },
    { id: 'sfx-studio' as const, label: 'AI 音效', icon: Waves },
    { id: 'dubbing-studio' as const, label: 'AI 配音', icon: Mic },
    { id: 'audio-tools' as const, label: '音频工具', icon: SlidersHorizontal },
    { id: 'sfx-requirements' as const, label: '音效需求表', icon: ClipboardList },
    { id: 'sfx-library' as const, label: '音效库', icon: Database },
    { id: 'settings' as const, label: '设置', icon: Settings },
  ];

  React.useEffect(() => {
    if (!isMobileOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onMobileClose();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isMobileOpen, onMobileClose]);

  React.useEffect(() => {
    if (!isResizingDesktop) return;

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, event.clientX));
      setDesktopWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingDesktop(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingDesktop]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('ai-audio-sidebar-width', String(desktopWidth));
  }, [desktopWidth]);

  const handleTabChange = (tab: TabType) => {
    setCurrentTab(tab);
    onMobileClose();
  };

  const renderSidebarContent = (variant: 'desktop' | 'mobile') => (
    <>
      {/* Brand Logo */}
      <div className={`${variant === 'desktop' && isDesktopCompact ? 'px-3 py-5 justify-center' : 'px-6 py-6'} border-b border-slate-100 flex items-center gap-3`}>
        <div className={`flex min-w-0 flex-1 items-center ${variant === 'desktop' && isDesktopCompact ? 'justify-center gap-0' : 'gap-3'}`}>
          <div className="w-9 h-9 shrink-0 bg-gradient-to-tr from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/10">
            <Volume2 className="text-white w-5 h-5" />
          </div>
          <div className={`min-w-0 ${variant === 'desktop' && isDesktopCompact ? 'hidden' : ''}`}>
            <h1 className="truncate text-sm font-bold tracking-tight text-slate-800">AI Audio</h1>
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
      <div className={`flex-1 overflow-y-auto py-6 space-y-7 custom-scrollbar ${variant === 'desktop' && isDesktopCompact ? 'px-2' : 'px-4'}`}>
        {/* Main Features Segment */}
        <div className="space-y-1.5">
          {mainFeatures.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                id={`nav-item-${variant}-${item.id}`}
                onClick={() => handleTabChange(item.id)}
                title={variant === 'desktop' && isDesktopCompact ? item.label : undefined}
                className={`w-full flex items-center overflow-hidden whitespace-nowrap rounded-xl text-xs font-semibold transition-all duration-200 ${
                  variant === 'desktop' && isDesktopCompact ? 'justify-center gap-0 px-0 py-3' : 'gap-3 px-3 py-2.5'
                } ${
                  isActive 
                    ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100' 
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Icon className={`w-4 h-4 transition-colors ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                <span className={`shrink-0 whitespace-nowrap ${variant === 'desktop' && isDesktopCompact ? 'hidden' : ''}`}>{item.label}</span>
              </button>
            );
          })}
        </div>

      </div>

      {/* Footer User Profile (Light Emerald style) */}
      <div className={`${variant === 'desktop' && isDesktopCompact ? 'justify-center p-3' : 'p-4'} border-t border-slate-100 bg-slate-50 flex items-center gap-3`}>
        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 flex items-center justify-center text-xs font-bold text-white shadow-sm">
          AD
        </div>
        <div className={`flex-1 min-w-0 ${variant === 'desktop' && isDesktopCompact ? 'hidden' : ''}`}>
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
        className="relative hidden h-dvh shrink-0 select-none flex-col border-r border-slate-200 bg-white lg:flex"
        style={{ width: `${desktopWidth}px` }}
        aria-label="主导航"
      >
        {renderSidebarContent('desktop')}
        <button
          type="button"
          aria-label="拖拽调整主导航宽度"
          onMouseDown={(event) => {
            event.preventDefault();
            setIsResizingDesktop(true);
          }}
          className="absolute right-[-4px] top-0 z-30 hidden h-full w-2 cursor-col-resize bg-transparent transition-colors hover:bg-emerald-400/25 lg:block"
        >
          <span className="sr-only">调整主导航宽度</span>
        </button>
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
