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
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
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

  return /UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|temporar(?:y|ily)|overload|high demand|timeout|timed out/i
    .test(getErrorText(error));
};

const createFriendlyGeminiError = (error: unknown) => {
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
