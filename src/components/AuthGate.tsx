import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { LogIn, Waves } from 'lucide-react';
import { logoutSfxLibraryAdmin } from '../services/sfxLibraryAdminService';
import { PointsBalance } from './PointsManagement';

type User = { openId: string; displayName: string; avatarUrl: string };
type AuthState = { enabled: boolean; user: User | null; guest?: boolean; guestAllowed?: boolean };
const AuthContext = createContext<AuthState>({ enabled: false, user: null });
export const useAuth = () => useContext(AuthContext);

const loginErrors: Record<string, string> = {
  invalid_state: '登录请求已过期，请重新使用飞书登录。',
  invalid_request: '登录信息不完整，请重新登录。',
  access_denied: '你已取消飞书授权，可再次尝试登录。',
  token_failed: '飞书授权未完成，请重试或联系管理员。',
  user_info_failed: '未能获取飞书用户信息，请联系管理员检查应用权限。',
  provider_failed: '暂时无法连接飞书登录服务，请稍后重试。',
};

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [guestBusy, setGuestBusy] = useState(false);
  const [loginError] = useState(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('auth_error');
    return code ? loginErrors[code] || '登录未完成，请重新尝试。' : '';
  });
  const check = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!response.ok) throw new Error('登录状态检查失败，请检查网络后重试。');
      const result = await response.json() as AuthState;
      if (typeof result.enabled !== 'boolean') throw new Error('登录服务响应异常，请稍后重试。');
      setAuth(result);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录状态检查失败。');
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('auth_error')) {
      url.searchParams.delete('auth_error');
      window.history.replaceState(null, '', url);
    }
    void check();
    const expired = () => { setAuth(previous => ({ ...previous, enabled: true, user: null, guest: false })); };
    const focus = () => { void check(); };
    window.addEventListener('ai-audio:auth-required', expired);
    window.addEventListener('focus', focus);
    const timer = window.setInterval(focus, 60_000);
    return () => {
      window.removeEventListener('ai-audio:auth-required', expired);
      window.removeEventListener('focus', focus);
      window.clearInterval(timer);
    };
  }, [check]);

  const enterGuest = async () => {
    setGuestBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/guest', { method: 'POST' });
      if (!response.ok) throw new Error('游客登录失败，请重试。');
      await check();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '游客登录失败。');
    } finally {
      setGuestBusy(false);
    }
  };

  if (auth && (!auth.enabled || auth.user || auth.guest)) {
    return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-6 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm" aria-labelledby="login-title">
        <Waves className="mb-6 h-10 w-10 text-emerald-600" aria-hidden="true" />
        <p className="mb-2 text-sm font-semibold text-emerald-700">AI Audio</p>
        <h1 id="login-title" className="text-2xl font-bold tracking-tight text-slate-900">让声音创作，从这里开始</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">使用飞书账号登录音频工作台，开始制作音乐、音效与配音。</p>
        {checking ? <p className="mt-8 text-sm text-slate-500" role="status">正在检查登录状态…</p> : (
          <>
            {(error || loginError) && <p role="alert" className="mt-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{error || loginError}</p>}
            {error && !auth ? (
              <button type="button" onClick={() => { setChecking(true); void check(); }} className="mt-6 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">重新检查</button>
            ) : (
              <a href="/api/auth/lark" className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
                <LogIn className="h-4 w-4" aria-hidden="true" />使用飞书账号登录
              </a>
            )}
            {auth?.guestAllowed && <button type="button" disabled={guestBusy} onClick={() => void enterGuest()} className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{guestBusy ? '正在进入…' : '游客进入'}</button>}
          </>
        )}
      </section>
    </main>
  );
}

export function AuthProfile({ compact = false }: { compact?: boolean }) {
  const { user, guest } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logout = async () => {
    setBusy(true);
    setError('');
    try {
      await logoutSfxLibraryAdmin();
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('退出失败，请重试。');
      window.location.assign('/');
    } catch {
      setError('退出失败，请重试。');
      setBusy(false);
    }
  };
  return (
    <div className={`border-t border-slate-100 bg-slate-50 ${compact ? 'p-2' : 'p-4'}`}>
      <div className={`flex items-center gap-3 ${compact ? 'justify-center' : ''}`}>
        {user?.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-full object-cover" /> : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">{user?.displayName.slice(0, 1) || 'AD'}</span>
        )}
        {!compact && <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-700">{user?.displayName || (guest ? '本地游客' : 'Audio Director')}</p><p className="mt-1 text-[10px] text-slate-500">{user ? '飞书账号' : '本地工作空间'}</p></div>}
      </div>
      {(user || guest) && <button type="button" disabled={busy} onClick={() => void logout()} className="mt-3 w-full rounded-lg border border-slate-200 px-1 py-2 text-xs text-slate-600 hover:bg-white disabled:opacity-50">{busy ? '退出中…' : '退出登录'}</button>}
      <PointsBalance compact={compact} />
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
