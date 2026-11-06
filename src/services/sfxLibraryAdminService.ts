const ADMIN_TOKEN_KEY = 'SFX_LIBRARY_ADMIN_TOKEN';
const LEGACY_AUTH_KEY = 'OWNER_AUTHORIZED';

const publishAuthorizationState = (authorized: boolean) => {
  if (typeof window === 'undefined') return;
  const nextValue = authorized ? 'true' : 'false';
  if (window.localStorage.getItem(LEGACY_AUTH_KEY) === nextValue) return;
  window.localStorage.setItem(LEGACY_AUTH_KEY, nextValue);
  window.dispatchEvent(new Event('security-state-changed'));
};

// Management authority lives only in the HttpOnly server session. Remove legacy bearer tokens.
const clearLegacyToken = () => { if (typeof window !== 'undefined') window.localStorage.removeItem(ADMIN_TOKEN_KEY); };
export const clearSfxLibraryAdminState = () => { clearLegacyToken(); publishAuthorizationState(false); };
export const getSfxLibraryAdminHeaders = (headers?: HeadersInit): HeadersInit => {
  clearLegacyToken();
  return headers || {};
};

export const loginSfxLibraryAdmin = async (password: string) => {
  const response = await fetch('/api/sfx/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.authorized !== true) {
    throw new Error(payload.error || '管理密码验证失败。');
  }
  clearLegacyToken();
  publishAuthorizationState(true);
  return payload;
};

export const verifySfxLibraryAdmin = async () => {
  clearLegacyToken();
  try {
    const response = await fetch('/api/sfx/admin/session', {
      headers: getSfxLibraryAdminHeaders(),
    });
    const authorized = response.ok && Boolean((await response.json()).authorized);
    publishAuthorizationState(authorized);
    return authorized;
  } catch {
    return false;
  }
};

export const logoutSfxLibraryAdmin = async () => {
  try {
    const response = await fetch('/api/sfx/admin/logout', { method: 'POST' });
    if (!response.ok) throw new Error('管理会话退出失败，请重试。');
  } finally {
    clearLegacyToken();
    publishAuthorizationState(false);
  }
};
