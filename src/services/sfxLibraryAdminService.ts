const ADMIN_TOKEN_KEY = 'SFX_LIBRARY_ADMIN_TOKEN';
const LEGACY_AUTH_KEY = 'OWNER_AUTHORIZED';

export const getSfxLibraryAdminToken = () => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(ADMIN_TOKEN_KEY) || '';
};

const publishAuthorizationState = (authorized: boolean) => {
  if (typeof window === 'undefined') return;
  const nextValue = authorized ? 'true' : 'false';
  if (window.localStorage.getItem(LEGACY_AUTH_KEY) === nextValue) return;
  window.localStorage.setItem(LEGACY_AUTH_KEY, nextValue);
  window.dispatchEvent(new Event('security-state-changed'));
};

export const setSfxLibraryAdminToken = (token: string) => {
  if (typeof window === 'undefined') return;
  if (token) {
    window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
  }
  publishAuthorizationState(Boolean(token));
};

export const getSfxLibraryAdminHeaders = (headers?: HeadersInit): HeadersInit => {
  const token = getSfxLibraryAdminToken();
  return {
    ...headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export const loginSfxLibraryAdmin = async (password: string) => {
  const response = await fetch('/api/sfx/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.token !== 'string') {
    throw new Error(payload.error || '管理密码验证失败。');
  }
  setSfxLibraryAdminToken(payload.token);
  return payload;
};

export const verifySfxLibraryAdmin = async () => {
  const token = getSfxLibraryAdminToken();
  if (!token) {
    publishAuthorizationState(false);
    return false;
  }
  try {
    const response = await fetch('/api/sfx/admin/session', {
      headers: getSfxLibraryAdminHeaders(),
    });
    const authorized = response.ok && Boolean((await response.json()).authorized);
    if (!authorized) setSfxLibraryAdminToken('');
    return authorized;
  } catch {
    return false;
  }
};

export const logoutSfxLibraryAdmin = async () => {
  const token = getSfxLibraryAdminToken();
  try {
    if (token) {
      await fetch('/api/sfx/admin/logout', {
        method: 'POST',
        headers: getSfxLibraryAdminHeaders(),
      });
    }
  } finally {
    setSfxLibraryAdminToken('');
  }
};
