const CLIENT_ID_STORAGE_KEY = 'ai-audio.client-identity.v1';
export const CLIENT_ID_HEADER = 'X-AI-Audio-Client-Id';

let cachedClientId: string | null = null;
let isFetchIdentityInstalled = false;

const createClientId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

export const getClientId = () => {
  if (cachedClientId) return cachedClientId;
  if (typeof window === 'undefined') return '';

  const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY)?.trim();
  cachedClientId = existing || createClientId();
  if (!existing) window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, cachedClientId);
  return cachedClientId;
};

export const clearLocalStoragePreservingClientIdentity = () => {
  if (typeof window === 'undefined') return;
  const clientId = getClientId();
  window.localStorage.clear();
  window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
};

const isSameOriginApiRequest = (input: RequestInfo | URL) => {
  if (typeof window === 'undefined') return false;
  try {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
};

export const setClientIdentityHeader = (request: XMLHttpRequest) => {
  const clientId = getClientId();
  if (clientId) request.setRequestHeader(CLIENT_ID_HEADER, clientId);
};

export const installClientIdentity = () => {
  if (typeof window === 'undefined' || isFetchIdentityInstalled) return;
  isFetchIdentityInstalled = true;
  getClientId();

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isSameOriginApiRequest(input)) return nativeFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set(CLIENT_ID_HEADER, getClientId());
    return nativeFetch(input, { ...init, headers });
  };
};
