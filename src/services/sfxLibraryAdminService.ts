const ADMIN_TOKEN_KEY = 'SFX_LIBRARY_ADMIN_TOKEN';
const LEGACY_AUTH_KEY = 'OWNER_AUTHORIZED';
let expirationTimer: ReturnType<typeof setTimeout> | undefined;
let lastPublishedAuthorization: boolean | undefined;

const scheduleExpiration = (expiresAt?: number) => {
  clearTimeout(expirationTimer);
  if (typeof window === 'undefined' || !Number.isFinite(expiresAt)) return;
  expirationTimer = setTimeout(() => publishAuthorizationState(false), Math.max(0, expiresAt! - Date.now()));
};

const publishAuthorizationState = (authorized: boolean) => {
  if (typeof window === 'undefined') return;
  const nextValue = authorized ? 'true' : 'false';
  const changed = lastPublishedAuthorization !== authorized;
  lastPublishedAuthorization = authorized;
  try {
    if (window.localStorage.getItem(LEGACY_AUTH_KEY) === nextValue) return;
    window.localStorage.setItem(LEGACY_AUTH_KEY, nextValue);
  } catch {
    // Deduplicate without localStorage as well, or verification listeners would
    // trigger each other indefinitely when the browser disables storage.
    if (!changed) return;
  }
  window.dispatchEvent(new Event('security-state-changed'));
};

// Management authority lives only in the HttpOnly server session. Remove legacy bearer tokens.
const clearLegacyToken = () => {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(ADMIN_TOKEN_KEY); } catch { /* Optional legacy cache cleanup. */ }
};
export const clearSfxLibraryAdminState = () => { clearTimeout(expirationTimer); clearLegacyToken(); publishAuthorizationState(false); };
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
    if (response.status === 401 || response.status === 403) clearSfxLibraryAdminState();
    throw new Error(response.status === 403 ? '管理密码错误，请重新输入。'
      : response.status === 401 ? '登录已过期，请重新登录后操作。'
      : payload.error || '管理密码验证失败。');
  }
  clearLegacyToken();
  scheduleExpiration(payload.expiresAt);
  publishAuthorizationState(true);
  return payload;
};

export const verifySfxLibraryAdmin = async () => {
  clearLegacyToken();
  try {
    const response = await fetch('/api/sfx/admin/session', {
      headers: getSfxLibraryAdminHeaders(),
    });
    const payload = await response.json();
    const authorized = response.ok && payload.authorized === true;
    scheduleExpiration(authorized ? payload.expiresAt : undefined);
    publishAuthorizationState(authorized);
    return authorized;
  } catch {
    clearSfxLibraryAdminState();
    return false;
  }
};

export const logoutSfxLibraryAdmin = async () => {
  try {
    const response = await fetch('/api/sfx/admin/logout', { method: 'POST' });
    if (!response.ok) throw new Error('管理会话退出失败，请重试。');
  } finally {
    clearSfxLibraryAdminState();
  }
};
