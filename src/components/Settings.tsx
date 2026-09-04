/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Ban, Database, LockKeyhole, LogOut, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import UsageDashboard from './UsageDashboard';
import { clearLocalStoragePreservingClientIdentity } from '../services/clientIdentity';
import { fetchAccessBlacklist, saveAccessBlacklist } from '../services/accessBlacklistService';
import {
  loginSfxLibraryAdmin,
  logoutSfxLibraryAdmin,
} from '../services/sfxLibraryAdminService';

interface SettingsProps {
  onKeysUpdated?: () => void;
}

export default function SettingsComponent({ onKeysUpdated }: SettingsProps) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [passwordFeedback, setPasswordFeedback] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [blacklistedIps, setBlacklistedIps] = useState<string[]>([]);
  const [blacklistInput, setBlacklistInput] = useState('');
  const [blacklistLoading, setBlacklistLoading] = useState(false);
  const [blacklistFeedback, setBlacklistFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthorized) return;
    let cancelled = false;
    setBlacklistLoading(true);
    fetchAccessBlacklist()
      .then(ips => {
        if (!cancelled) setBlacklistedIps(ips);
      })
      .catch(error => {
        if (!cancelled) setBlacklistFeedback(error instanceof Error ? error.message : '无法读取 IP 黑名单。');
      })
      .finally(() => {
        if (!cancelled) setBlacklistLoading(false);
      });
    return () => { cancelled = true; };
  }, [isAuthorized]);

  const handleUnlockManager = async () => {
    if (!adminPassword.trim() || isVerifying) return;
    setIsVerifying(true);
    setPasswordFeedback(null);
    try {
      await loginSfxLibraryAdmin(adminPassword.trim());
      setIsAuthorized(true);
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
    setPasswordFeedback(null);
    onKeysUpdated?.();
  };

  const handleAddBlacklistIp = async () => {
    const ip = blacklistInput.trim();
    if (!ip || blacklistLoading) return;
    if (blacklistedIps.includes(ip)) {
      setBlacklistFeedback('该 IP 已在黑名单中。');
      return;
    }
    setBlacklistLoading(true);
    setBlacklistFeedback(null);
    try {
      const nextIps = await saveAccessBlacklist([...blacklistedIps, ip]);
      setBlacklistedIps(nextIps);
      setBlacklistInput('');
      setBlacklistFeedback('已加入黑名单。');
    } catch (error) {
      setBlacklistFeedback(error instanceof Error ? error.message : '保存 IP 黑名单失败。');
    } finally {
      setBlacklistLoading(false);
    }
  };

  const handleRemoveBlacklistIp = async (ip: string) => {
    if (blacklistLoading) return;
    setBlacklistLoading(true);
    setBlacklistFeedback(null);
    try {
      const nextIps = await saveAccessBlacklist(blacklistedIps.filter(item => item !== ip));
      setBlacklistedIps(nextIps);
      setBlacklistFeedback('已移出黑名单。');
    } catch (error) {
      setBlacklistFeedback(error instanceof Error ? error.message : '保存 IP 黑名单失败。');
    } finally {
      setBlacklistLoading(false);
    }
  };

  const handleClearCache = async () => {
    if (typeof window === 'undefined' || !confirm('确定清空本地浏览器缓存与历史工程记录吗？服务器文件不会被删除。')) return;
    await logoutSfxLibraryAdmin();
    clearLocalStoragePreservingClientIdentity();
    setCleared(true);
    onKeysUpdated?.();
    setTimeout(() => window.location.reload(), 800);
  };

  if (!isAuthorized) {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md items-center px-4 py-10 lg:min-h-dvh">
        <section className="w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-lg font-bold text-slate-900">设置访问验证</h1>
          <p className="mt-1 text-xs leading-5 text-slate-500">输入管理密码后才能查看用量统计和系统设置。</p>

          <label className="mt-5 block text-[11px] font-semibold text-slate-600" htmlFor="settings-admin-password">
            管理密码
          </label>
          <input
            id="settings-admin-password"
            type="password"
            autoComplete="current-password"
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleUnlockManager();
            }}
            placeholder="请输入管理密码"
            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
          {passwordFeedback ? <p className="mt-2 text-[11px] text-rose-600">{passwordFeedback}</p> : null}
          <button
            type="button"
            onClick={() => void handleUnlockManager()}
            disabled={isVerifying || !adminPassword.trim()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LockKeyhole className="h-4 w-4" />
            {isVerifying ? '正在验证...' : '验证并进入设置'}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">设置</h1>
          <p className="mt-1 text-xs text-slate-500">用量统计与本地数据管理</p>
        </div>
        <button
          type="button"
          onClick={() => void handleLockManager()}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <LogOut className="h-4 w-4" />
          退出设置
        </button>
      </header>

      <UsageDashboard />

      <section className="mt-8 border-t border-slate-200 pt-6">
        <div className="flex items-center gap-2">
          <Ban className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-bold text-slate-800">设备 IP 黑名单</h2>
        </div>
        <p className="mt-2 max-w-3xl text-[11px] leading-5 text-slate-500">
          被加入黑名单的设备会被服务端拒绝访问。这里使用服务器看到的连接 IP，不接受客户端自行修改的设备标识；请确认代理已正确传递真实来源 IP。
        </p>
        <div className="mt-4 flex max-w-xl gap-2">
          <input
            value={blacklistInput}
            onChange={event => setBlacklistInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void handleAddBlacklistIp();
            }}
            placeholder="输入 IPv4 或 IPv6 地址"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
          <button
            type="button"
            onClick={() => void handleAddBlacklistIp()}
            disabled={blacklistLoading || !blacklistInput.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            加入
          </button>
        </div>
        {blacklistFeedback ? <p className="mt-2 text-[11px] text-slate-500">{blacklistFeedback}</p> : null}
        <div className="mt-4 max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white">
          {blacklistLoading && blacklistedIps.length === 0 ? (
            <p className="px-3 py-4 text-xs text-slate-400">正在读取黑名单...</p>
          ) : blacklistedIps.length === 0 ? (
            <p className="px-3 py-4 text-xs text-slate-400">暂无被禁止的设备 IP。</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {blacklistedIps.map(ip => (
                <li key={ip} className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs text-slate-700">
                  <code className="font-mono">{ip}</code>
                  <button
                    type="button"
                    onClick={() => void handleRemoveBlacklistIp(ip)}
                    disabled={blacklistLoading}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-8 border-t border-slate-200 pt-6">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-bold text-slate-800">本地数据</h2>
        </div>
        <p className="mt-2 max-w-3xl text-[11px] leading-5 text-slate-500">
          工程进度、剪辑轨道、配音列表和操作历史会临时保存在当前浏览器中。清空操作不会删除服务器保存的音频文件。
        </p>
        <button
          type="button"
          onClick={() => void handleClearCache()}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-2.5 text-xs font-bold text-rose-600 hover:bg-rose-50"
        >
          <Trash2 className="h-4 w-4" />
          {cleared ? '缓存已清空，正在重新加载...' : '清空本地缓存'}
        </button>
      </section>
    </div>
  );
}
