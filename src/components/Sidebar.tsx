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
  Database,
  ClipboardList,
  SlidersHorizontal,
  Film,
  X,
  Coins,
  ChevronUp,
} from 'lucide-react';
import { TabType } from '../types';
import wpLogoUrl from '../assets/wp-logo.png';
import { fetchPersonalPointBalance, type PersonalPointBalance } from '../services/usageService';

const SIDEBAR_MIN_WIDTH = 72;
const SIDEBAR_COMPACT_WIDTH = 160;
const SIDEBAR_DEFAULT_WIDTH = 208;
const SIDEBAR_MAX_WIDTH = 520;
const SIDEBAR_WIDTH_READY_KEY = 'ai-audio-sidebar-width-ready-v2';

interface SidebarProps {
  currentTab: TabType;
  setCurrentTab: (tab: TabType) => void;
  isMobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar({ currentTab, setCurrentTab, isMobileOpen, onMobileClose }: SidebarProps) {
  const [desktopWidth, setDesktopWidth] = React.useState(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
    const hasInitializedWidth = window.localStorage.getItem(SIDEBAR_WIDTH_READY_KEY) === '1';
    const saved = Number(window.localStorage.getItem('ai-audio-sidebar-width'));
    return hasInitializedWidth && Number.isFinite(saved)
      ? Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, saved))
      : SIDEBAR_DEFAULT_WIDTH;
  });
  const [isResizingDesktop, setIsResizingDesktop] = React.useState(false);
  const [pointBalance, setPointBalance] = React.useState<PersonalPointBalance | null>(null);
  const [isBalanceOpen, setIsBalanceOpen] = React.useState(false);
  const isDesktopCompact = desktopWidth < SIDEBAR_COMPACT_WIDTH;

  const refreshPointBalance = React.useCallback(() => {
    const controller = new AbortController();
    fetchPersonalPointBalance(controller.signal).then(setPointBalance).catch(() => undefined);
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    const cancelInitial = refreshPointBalance();
    const timer = window.setInterval(refreshPointBalance, 30_000);
    const refresh = () => refreshPointBalance();
    window.addEventListener('focus', refresh);
    window.addEventListener('ai-audio:usage-updated', refresh);
    return () => {
      cancelInitial();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('ai-audio:usage-updated', refresh);
    };
  }, [refreshPointBalance]);

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
    window.localStorage.setItem(SIDEBAR_WIDTH_READY_KEY, '1');
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
          <img
            src={wpLogoUrl}
            alt="AI Audio"
            className="h-9 w-9 shrink-0 rounded-xl object-contain shadow-lg shadow-emerald-500/10"
          />
          <div className={`min-w-0 flex-1 flex-col items-center text-center ${variant === 'desktop' && isDesktopCompact ? 'hidden' : 'flex'}`}>
            <h1 className="max-w-full truncate text-sm font-bold tracking-tight text-slate-800">AI Audio</h1>
            <p className="mt-1 max-w-full whitespace-nowrap text-[9px] font-semibold leading-none text-slate-500">高音甜 中音准 低音沉</p>
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

      {/* Personal balance is visible without exposing the password-protected admin settings. */}
      <div className="relative border-t border-slate-100 bg-slate-50">
        {isBalanceOpen && !(variant === 'desktop' && isDesktopCompact) ? (
          <div className="absolute bottom-full left-3 right-3 mb-2 rounded-lg border border-slate-200 bg-white p-3 shadow-xl" role="dialog" aria-label="个人积分详情">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-slate-800">个人积分</p>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700">
                {pointBalance?.quota.tier === 'professional' ? '专业档' : '基础档'}
              </span>
            </div>
            {pointBalance ? (() => {
              const quota = pointBalance.quota;
              const percent = quota.limitCredits > 0 ? Math.min(100, quota.usedCredits / quota.limitCredits * 100) : 100;
              return (
                <>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div><p className="text-[9px] text-slate-400">剩余</p><p className="font-mono text-lg font-bold text-slate-900">{Math.floor(quota.remainingCredits).toLocaleString('zh-CN')}</p></div>
                    <p className="pb-1 text-[10px] text-slate-400">已用 {Math.ceil(quota.usedCredits).toLocaleString('zh-CN')} / {quota.limitCredits.toLocaleString('zh-CN')}</p>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${percent >= 100 ? 'bg-rose-500' : percent >= 90 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} />
                  </div>
                  {percent >= 70 ? (
                    <p className={`mt-2 text-[9px] font-semibold ${percent >= 100 ? 'text-rose-600' : percent >= 90 ? 'text-amber-600' : 'text-sky-600'}`}>
                      {percent >= 100 ? '积分已用完，付费生成功能已暂停' : percent >= 90 ? '积分即将用完，请联系管理员' : '本月积分已使用超过 70%'}
                    </p>
                  ) : null}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] text-slate-500">
                    <span>临时加额 <b className="block font-mono text-[11px] text-slate-700">{quota.bonusCredits.toLocaleString('zh-CN')}</b></span>
                    <span>项目池分配 <b className="block font-mono text-[11px] text-slate-700">{quota.projectPoints.toLocaleString('zh-CN')}</b></span>
                  </div>
                  <p className="mt-3 border-t border-slate-100 pt-2 text-[9px] text-slate-400">{new Date(quota.periodEnd).toLocaleDateString('zh-CN')} 自动重置</p>
                </>
              );
            })() : <p className="mt-3 text-[10px] text-slate-400">正在读取积分...</p>}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setIsBalanceOpen(value => !value)}
          className={`${variant === 'desktop' && isDesktopCompact ? 'justify-center p-3' : 'p-4'} flex w-full items-center gap-3 text-left hover:bg-slate-100`}
          title={variant === 'desktop' && isDesktopCompact ? '个人积分' : undefined}
          aria-expanded={isBalanceOpen}
        >
        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 flex items-center justify-center text-xs font-bold text-white shadow-sm">
          {pointBalance?.user.displayName?.slice(0, 1).toUpperCase() || 'A'}
        </div>
        <div className={`flex-1 min-w-0 ${variant === 'desktop' && isDesktopCompact ? 'hidden' : ''}`}>
          <p className="truncate text-xs font-semibold text-slate-700">{pointBalance?.user.displayName || '当前用户'}</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-slate-500"><Coins className="h-3 w-3" />剩余 {pointBalance ? Math.floor(pointBalance.quota.remainingCredits).toLocaleString('zh-CN') : '--'} 积分</p>
        </div>
        <ChevronUp className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${variant === 'desktop' && isDesktopCompact ? 'hidden' : ''} ${isBalanceOpen ? '' : 'rotate-180'}`} />
        </button>
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
