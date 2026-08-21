/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Database, LockKeyhole, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import {
  loginSfxLibraryAdmin,
  logoutSfxLibraryAdmin,
  verifySfxLibraryAdmin,
} from '../services/sfxLibraryAdminService';

interface SettingsProps {
  onKeysUpdated?: () => void;
}

export default function SettingsComponent({ onKeysUpdated }: SettingsProps) {
  const [cleared, setCleared] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [passwordFeedback, setPasswordFeedback] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let active = true;
    const syncAuthorization = async () => {
      const authorized = await verifySfxLibraryAdmin();
      if (active) setIsAuthorized(authorized);
    };
    const handleStateChange = () => void syncAuthorization();
    window.addEventListener('security-state-changed', handleStateChange);
    void syncAuthorization();
    return () => {
      active = false;
      window.removeEventListener('security-state-changed', handleStateChange);
    };
  }, []);

  const handleUnlockManager = async () => {
    if (!adminPassword.trim() || isVerifying) return;
    setIsVerifying(true);
    setPasswordFeedback(null);
    try {
      await loginSfxLibraryAdmin(adminPassword.trim());
      setIsAuthorized(true);
      setPasswordFeedback('管理系统已解锁。');
      setAdminPassword('');
      onKeysUpdated?.();
    } catch (error) {
      setIsAuthorized(false);
      setPasswordFeedback(error instanceof Error ? error.message : '管理密码验证失败。');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLockManager = async () => {
    await logoutSfxLibraryAdmin();
    setIsAuthorized(false);
    setPasswordFeedback('管理系统已锁定。');
    onKeysUpdated?.();
  };

  const handleClearCache = async () => {
    if (
      typeof window !== 'undefined' &&
      confirm('确定要清空本地浏览器缓存与历史工程记录吗？这不会影响服务器已保存的文件，但会清空本地操作历史。')
    ) {
      await logoutSfxLibraryAdmin();
      localStorage.clear();
      setCleared(true);
      onKeysUpdated?.();
      setTimeout(() => setCleared(false), 2500);
      window.location.reload();
    }
  };

  return (
    <div id="settings-view" className="flex-1 p-6 max-w-4xl mx-auto w-full">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
        <div className="space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-indigo-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">管理系统验证</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isAuthorized ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {isAuthorized ? '已解锁' : '未解锁'}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-600">
            输入管理密码后，可解锁音效库与分组列表的增删改权限。
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">管理密码</label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUnlockManager();
                }}
                placeholder="请输入管理密码"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-500"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => void handleUnlockManager()}
                disabled={isVerifying || !adminPassword.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LockKeyhole className="h-3.5 w-3.5" />
                {isVerifying ? '正在验证...' : '解锁管理'}
              </button>
              <button
                type="button"
                onClick={() => void handleLockManager()}
                disabled={!isAuthorized}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                退出管理
              </button>
            </div>
          </div>
          {passwordFeedback && (
            <p className={`text-[11px] font-medium ${isAuthorized ? 'text-emerald-700' : 'text-rose-600'}`}>
              {passwordFeedback}
            </p>
          )}
        </div>

        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3">
          <Database className="w-4 h-4 text-slate-600" />
          <span>数据与本地存储</span>
        </h3>

        <div className="space-y-2 text-xs text-slate-500">
          <p>
            为了提供连续的工作体验，工程进度、剪辑轨道、配音列表、上传文件记录等会临时保存在本地浏览器 LocalStorage 中。
          </p>
          <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
            如果页面卡顿、数据不同步，或需要重新开始，可以清空本地缓存。该操作会重置本地会话与历史记录。
          </p>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={() => void handleClearCache()}
            className="w-full bg-slate-50 hover:bg-red-50 text-slate-700 hover:text-red-600 border border-slate-200 hover:border-red-200 font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
          >
            <Trash2 className="w-4 h-4" />
            <span>{cleared ? '本地缓存已清空，正在重新加载页面...' : '清空本地缓存并重置应用'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
