import type { GoogleGenAI } from '@google/genai';

export const GEMINI_PRIMARY_MODEL = 'gemini-3.5-flash';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

type GenerateContentRequest = Parameters<GoogleGenAI['models']['generateContent']>[0];
type GenerateContentResponse = Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;

// Interactive HTML5 requests should recover quickly instead of leaving the UI
// waiting through a long retry chain. Try the primary model once more, then
// switch to the lightweight fallback.
const RETRY_DELAYS_MS = [650];

const wait = (delayMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, delayMs);
});

const getErrorText = (error: unknown) => {
  const parts: string[] = [];
  const visited = new Set<unknown>();

  const visit = (value: unknown, depth: number) => {
    if (value == null || depth > 4 || visited.has(value)) return;
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (typeof value !== 'object') {
      parts.push(String(value));
      return;
    }

    visited.add(value);
    const candidate = value as {
      message?: unknown;
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof candidate.message === 'string') parts.push(candidate.message);
    if (typeof candidate.code === 'string' || typeof candidate.code === 'number') {
      parts.push(String(candidate.code));
    }
    visit(candidate.cause, depth + 1);
    if (Array.isArray(candidate.errors)) {
      candidate.errors.forEach(item => visit(item, depth + 1));
    }
  };

  visit(error, 0);
  return parts.join(' ');
};

const getErrorStatus = (error: unknown) => {
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; status?: unknown };
    for (const value of [candidate.code, candidate.status]) {
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
    }
  }

  const match = getErrorText(error).match(/(?:code["']?\s*[:=]\s*|\b)(408|429|5\d\d)\b/i);
  return match ? Number(match[1]) : undefined;
};

export const isRetryableGeminiError = (error: unknown) => {
  const status = getErrorStatus(error);
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) {
    return true;
  }

  return /UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|temporar(?:y|ily)|overload|high demand|timeout|timed out|fetch failed|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EACCES|UND_ERR/i
    .test(getErrorText(error));
};

export const isGeminiNetworkError = (error: unknown) => (
  /fetch failed|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EACCES|UND_ERR_CONNECT_TIMEOUT/i
    .test(getErrorText(error))
);

export const createFriendlyGeminiNetworkError = (error: unknown) => Object.assign(
  new Error('服务器当前无法连接 Gemini，请检查服务进程的网络权限或代理设置后重试。'),
  { status: 503, cause: error },
);

const createFriendlyGeminiError = (error: unknown) => {
  if (isGeminiNetworkError(error)) return createFriendlyGeminiNetworkError(error);

  const status = getErrorStatus(error);
  const message = status === 429
    ? 'Gemini 当前请求次数较多，系统已自动重试。请稍后再次尝试。'
    : 'Gemini 当前服务繁忙，系统已自动重试并切换备用模型。请稍后再次尝试。';
  return Object.assign(new Error(message), { status: status === 429 ? 429 : 503 });
};

export async function generateGeminiContent(
  ai: GoogleGenAI,
  request: GenerateContentRequest,
): Promise<GenerateContentResponse> {
  let lastTransientError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await ai.models.generateContent({
        ...request,
        model: GEMINI_PRIMARY_MODEL,
      });
    } catch (error) {
      if (!isRetryableGeminiError(error)) throw error;
      lastTransientError = error;

      if (attempt < RETRY_DELAYS_MS.length) {
        const jitterMs = Math.floor(Math.random() * 250);
        await wait(RETRY_DELAYS_MS[attempt] + jitterMs);
      }
    }
  }

  try {
    return await ai.models.generateContent({
      ...request,
      model: GEMINI_FALLBACK_MODEL,
    });
  } catch (fallbackError) {
    console.error('Gemini fallback model failed:', fallbackError);
    throw createFriendlyGeminiError(
      isRetryableGeminiError(fallbackError) ? fallbackError : lastTransientError,
    );
  }
}
