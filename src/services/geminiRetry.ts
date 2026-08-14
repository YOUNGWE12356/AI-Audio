import type { GoogleGenAI } from '@google/genai';

export const GEMINI_PRIMARY_MODEL = 'gemini-3.6-flash';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

type GenerateContentRequest = Parameters<GoogleGenAI['models']['generateContent']>[0];
type GenerateContentResponse = Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;

type GptGatewayConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: 'ark' | 'tokenhub' | 'openai';
};

type GptResponse = {
  error?: { message?: string };
  model?: string;
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

// Interactive HTML5 requests should recover quickly instead of leaving the UI
// waiting through a long retry chain. Try the primary model once more, then
// switch to the lightweight fallback.
const RETRY_DELAYS_MS = [650];

const wait = (delayMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, delayMs);
});

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

const getGptGatewayConfig = (): GptGatewayConfig | null => {
  if (typeof window !== 'undefined' || process.env.AI_TEXT_PROVIDER === 'gemini') return null;

  const arkKey = process.env.ARK_API_KEY?.trim();
  if (arkKey) {
    return {
      apiKey: arkKey,
      baseUrl: trimTrailingSlashes(
        process.env.ARK_BASE_URL?.trim()
          || process.env.GPT_BASE_URL?.trim()
          || 'https://ark.cn-beijing.volces.com/api/v3',
      ),
      model: process.env.ARK_MODEL?.trim() || process.env.GPT_MODEL?.trim() || 'gpt-5.6-sol',
      provider: 'ark',
    };
  }

  const tokenHubKey = process.env.TOKENHUB_API_KEY?.trim();
  if (tokenHubKey) {
    return {
      apiKey: tokenHubKey,
      baseUrl: trimTrailingSlashes(
        process.env.TOKENHUB_BASE_URL?.trim()
          || process.env.GPT_BASE_URL?.trim()
          || 'https://tokenhub.piegateway.me/v1',
      ),
      model: process.env.TOKENHUB_MODEL?.trim() || process.env.GPT_MODEL?.trim() || 'gpt-5.6-sol',
      provider: 'tokenhub',
    };
  }

  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openAiKey) return null;
  return {
    apiKey: openAiKey,
    baseUrl: trimTrailingSlashes(
      process.env.OPENAI_BASE_URL?.trim()
        || process.env.GPT_BASE_URL?.trim()
        || 'https://api.openai.com/v1',
    ),
    model: process.env.OPENAI_MODEL?.trim() || process.env.GPT_MODEL?.trim() || 'gpt-5.6-sol',
    provider: 'openai',
  };
};

export const isGptTextConfigured = () => Boolean(getGptGatewayConfig());

const collectTextOnlyContent = (value: unknown, textParts: string[]): boolean => {
  if (typeof value === 'string') {
    if (value.trim()) textParts.push(value);
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(item => collectTextOnlyContent(item, textParts));
  }
  if (!value || typeof value !== 'object') return false;

  const part = value as Record<string, unknown>;
  if ('inlineData' in part || 'fileData' in part || 'inline_data' in part || 'file_data' in part) {
    return false;
  }
  if (typeof part.text === 'string') {
    if (part.text.trim()) textParts.push(part.text);
    return true;
  }
  if (Array.isArray(part.parts)) {
    return collectTextOnlyContent(part.parts, textParts);
  }
  return false;
};

const getTextOnlyPrompt = (contents: unknown) => {
  const textParts: string[] = [];
  if (!collectTextOnlyContent(contents, textParts) || textParts.length === 0) return null;
  return textParts.join('\n\n');
};

const normalizeJsonSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeJsonSchema);
  if (!value || typeof value !== 'object') return value;

  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    normalized[key] = key === 'type' && typeof child === 'string'
      ? child.toLowerCase()
      : normalizeJsonSchema(child);
  }
  return normalized;
};

const getGptReasoningEffort = () => {
  const requested = process.env.GPT_REASONING_EFFORT?.trim().toLowerCase();
  return ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(requested || '')
    ? requested
    : 'low';
};

const extractGptText = (response: GptResponse) => {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  return (response.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text!.trim())
    .filter(Boolean)
    .join('\n');
};

const generateGptText = async (
  gateway: GptGatewayConfig,
  prompt: string,
  request: GenerateContentRequest,
): Promise<GenerateContentResponse> => {
  const config = (request.config || {}) as Record<string, unknown>;
  const responseSchema = config.responseSchema;
  const maxOutputTokens = typeof config.maxOutputTokens === 'number'
    ? config.maxOutputTokens
    : undefined;
  const body: Record<string, unknown> = {
    model: gateway.model,
    input: prompt,
    reasoning: { effort: getGptReasoningEffort() },
  };

  if (maxOutputTokens !== undefined) body.max_output_tokens = maxOutputTokens;
  if (responseSchema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: 'ai_audio_response',
        strict: false,
        schema: normalizeJsonSchema(responseSchema),
      },
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${gateway.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gateway.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({})) as GptResponse;
    if (!response.ok) {
      throw Object.assign(
        new Error(result.error?.message || `GPT gateway request failed (${response.status})`),
        { status: response.status },
      );
    }

    const text = extractGptText(result);
    if (!text) throw new Error('GPT gateway returned no text output.');
    if (responseSchema) JSON.parse(text);
    console.info(`[ai-router] Text request completed with ${result.model || gateway.model} via ${gateway.provider}.`);
    return { text, modelVersion: result.model || gateway.model } as GenerateContentResponse;
  } finally {
    clearTimeout(timeoutId);
  }
};

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
  const gateway = getGptGatewayConfig();
  const textOnlyPrompt = getTextOnlyPrompt(request.contents);
  if (gateway && textOnlyPrompt) {
    try {
      return await generateGptText(gateway, textOnlyPrompt, request);
    } catch (error) {
      console.warn(
        `[ai-router] GPT text route failed via ${gateway.provider}; falling back to Gemini.`,
        getErrorText(error),
      );
    }
  }

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
