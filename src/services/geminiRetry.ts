import type { GoogleGenAI } from '@google/genai';
import { recordAiUsage, toUsageNumber } from './usageTracking';

export const GEMINI_PRIMARY_MODEL = 'gemini-3.6-flash';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';

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
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
  };
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

const recordGeminiUsage = (response: GenerateContentResponse, requestedModel: string) => {
  const usage = (response as GenerateContentResponse & {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      totalTokenCount?: number;
    };
  }).usageMetadata;
  if (!usage) return;

  const inputTokens = toUsageNumber(usage.promptTokenCount);
  const outputTokens = toUsageNumber(usage.candidatesTokenCount);
  const reasoningTokens = toUsageNumber(usage.thoughtsTokenCount);
  recordAiUsage({
    provider: 'gemini',
    model: response.modelVersion || requestedModel,
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens: toUsageNumber(usage.totalTokenCount) || inputTokens + outputTokens + reasoningTokens,
    credits: 0,
  });
};

type GptInputContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string };

type GptCompatibleInput = {
  hasImage: boolean;
  input: string | Array<{ role: 'user'; content: GptInputContentPart[] }>;
};

// Interactive HTML5 requests should recover quickly instead of leaving the UI
// waiting through a long retry chain. Try the primary model once more, then
// switch to the lightweight fallback.
const RETRY_DELAYS_MS = [650];

const wait = (delayMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, delayMs);
});

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

const normalizeTokenHubModel = (value: string | undefined) => {
  const model = value?.trim() || 'gpt-5.6-sol';
  return model.includes('/') ? model : `ark/${model}`;
};

const getGptGatewayConfig = (): GptGatewayConfig | null => {
  if (typeof window !== 'undefined' || process.env.AI_TEXT_PROVIDER === 'gemini') return null;

  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) {
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
  }

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
      model: normalizeTokenHubModel(
        process.env.TOKENHUB_MODEL || process.env.GPT_MODEL,
      ),
      provider: 'tokenhub',
    };
  }

  return null;
};

export const isGptTextConfigured = () => Boolean(getGptGatewayConfig());

export type GptStructuredResult<T> = {
  value: T;
  model: string;
  provider: GptGatewayConfig['provider'];
};

export const generateGptStructuredJson = async <T>({
  instructions,
  input,
  schema,
  schemaName,
  maxOutputTokens = 4000,
  reasoningEffort = 'medium',
}: {
  instructions: string;
  input: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens?: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}): Promise<GptStructuredResult<T>> => {
  const gateway = getGptGatewayConfig();
  if (!gateway) {
    throw Object.assign(new Error('GPT 任务规划服务尚未配置。'), { status: 503 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${gateway.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gateway.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: gateway.model,
        instructions,
        input,
        reasoning: { effort: reasoningEffort },
        max_output_tokens: maxOutputTokens,
        text: {
          format: {
            type: 'json_schema',
            name: schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
            strict: true,
            schema,
          },
        },
      }),
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
    if (!text) throw new Error('GPT gateway returned no structured output.');
    const value = JSON.parse(text) as T;
    const inputTokens = toUsageNumber(result.usage?.input_tokens);
    const outputTokens = toUsageNumber(result.usage?.output_tokens);
    const reasoningTokens = toUsageNumber(result.usage?.output_tokens_details?.reasoning_tokens);
    recordAiUsage({
      provider: 'gpt',
      model: result.model || gateway.model,
      inputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens: toUsageNumber(result.usage?.total_tokens) || inputTokens + outputTokens,
      credits: 0,
    });
    return {
      value,
      model: result.model || gateway.model,
      provider: gateway.provider,
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const collectGptCompatibleContent = (value: unknown, parts: GptInputContentPart[]): boolean => {
  if (typeof value === 'string') {
    if (value.trim()) parts.push({ type: 'input_text', text: value });
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(item => collectGptCompatibleContent(item, parts));
  }
  if (!value || typeof value !== 'object') return false;

  const part = value as Record<string, unknown>;
  const inlineData = (part.inlineData || part.inline_data) as Record<string, unknown> | undefined;
  if (inlineData) {
    const data = typeof inlineData.data === 'string' ? inlineData.data : '';
    const mimeType = typeof inlineData.mimeType === 'string'
      ? inlineData.mimeType
      : typeof inlineData.mime_type === 'string'
        ? inlineData.mime_type
        : 'image/jpeg';
    if (!data || !mimeType.startsWith('image/')) return false;
    parts.push({ type: 'input_image', image_url: `data:${mimeType};base64,${data}` });
    return true;
  }

  if ('fileData' in part || 'file_data' in part || 'videoMetadata' in part || 'video_metadata' in part) {
    return false;
  }
  if (typeof part.text === 'string') {
    if (part.text.trim()) parts.push({ type: 'input_text', text: part.text });
    return true;
  }
  if (Array.isArray(part.parts)) {
    return collectGptCompatibleContent(part.parts, parts);
  }
  return false;
};

const getGptCompatibleInput = (contents: unknown): GptCompatibleInput | null => {
  const parts: GptInputContentPart[] = [];
  if (!collectGptCompatibleContent(contents, parts)) return null;

  const textParts = parts
    .filter((part): part is { type: 'input_text'; text: string } => part.type === 'input_text')
    .map(part => part.text.trim())
    .filter(Boolean);
  if (textParts.length === 0) return null;

  const hasImage = parts.some(part => part.type === 'input_image');
  return {
    hasImage,
    input: hasImage
      ? [{ role: 'user', content: parts }]
      : textParts.join('\n\n'),
  };
};

const containsGeminiFileData = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsGeminiFileData);
  if (!value || typeof value !== 'object') return false;

  const part = value as Record<string, unknown>;
  if ('fileData' in part || 'file_data' in part) return true;
  return Array.isArray(part.parts) && part.parts.some(containsGeminiFileData);
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
  input: GptCompatibleInput,
  request: GenerateContentRequest,
): Promise<GenerateContentResponse> => {
  const config = (request.config || {}) as Record<string, unknown>;
  const responseSchema = config.responseSchema;
  const maxOutputTokens = typeof config.maxOutputTokens === 'number'
    ? config.maxOutputTokens
    : undefined;
  const body: Record<string, unknown> = {
    model: gateway.model,
    input: input.input,
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
    const inputTokens = toUsageNumber(result.usage?.input_tokens);
    const outputTokens = toUsageNumber(result.usage?.output_tokens);
    const reasoningTokens = toUsageNumber(result.usage?.output_tokens_details?.reasoning_tokens);
    recordAiUsage({
      provider: 'gpt',
      model: result.model || gateway.model,
      inputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens: toUsageNumber(result.usage?.total_tokens) || inputTokens + outputTokens,
      credits: 0,
    });
    console.info(`[ai-router] ${input.hasImage ? 'Vision' : 'Text'} request completed with ${result.model || gateway.model} via ${gateway.provider}.`);
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
      error?: unknown;
      response?: unknown;
      data?: unknown;
      status?: unknown;
      statusText?: unknown;
    };
    if (typeof candidate.message === 'string') parts.push(candidate.message);
    if (typeof candidate.code === 'string' || typeof candidate.code === 'number') {
      parts.push(String(candidate.code));
    }
    if (typeof candidate.status === 'string' || typeof candidate.status === 'number') {
      parts.push(String(candidate.status));
    }
    if (typeof candidate.statusText === 'string') parts.push(candidate.statusText);
    visit(candidate.error, depth + 1);
    visit(candidate.response, depth + 1);
    visit(candidate.data, depth + 1);
    visit(candidate.cause, depth + 1);
    if (Array.isArray(candidate.errors)) {
      candidate.errors.forEach(item => visit(item, depth + 1));
    }
  };

  visit(error, 0);
  return parts.join(' ');
};

export const isGeminiUnsupportedLocationError = (error: unknown) => (
  /User location is not supported for the API use|location is not supported|FAILED_PRECONDITION/i
    .test(getErrorText(error))
);

export const createFriendlyGeminiUnsupportedLocationError = (error: unknown) => Object.assign(
  new Error('当前 Gemini API 所在地区不支持此分析请求。请切换到支持 Gemini API 的网络/地区，或在服务端配置可用的 ARK_API_KEY / OPENAI_API_KEY 视觉模型后重试关键帧分析。'),
  { status: 400, cause: error },
);

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

const isGeminiKeyFailoverError = (error: unknown) => {
  const status = getErrorStatus(error);
  if (status === 401 || status === 403 || status === 429) return true;

  return /API_KEY_INVALID|API key not valid|invalid API key|PERMISSION_DENIED|RESOURCE_EXHAUSTED|quota|rate.?limit|billing/i
    .test(getErrorText(error));
};

const getFallbackGeminiClient = async () => {
  if (typeof window !== 'undefined') return null;

  const fallbackKey = process.env.GEMINI_FALLBACK_API_KEY?.trim();
  const primaryKey = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY)?.trim();
  if (!fallbackKey || fallbackKey === primaryKey) return null;

  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey: fallbackKey });
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
  if (isGeminiUnsupportedLocationError(error)) return createFriendlyGeminiUnsupportedLocationError(error);
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
  const gptCompatibleInput = gateway ? getGptCompatibleInput(request.contents) : null;
  if (gateway && gptCompatibleInput) {
    try {
      return await generateGptText(gateway, gptCompatibleInput, request);
    } catch (error) {
      console.warn(
        `[ai-router] GPT ${gptCompatibleInput.hasImage ? 'vision' : 'text'} route failed via ${gateway.provider}; falling back to Gemini.`,
        getErrorText(error),
      );
    }
  }

  let lastTransientError: unknown;
  let shouldTryFallbackKey = false;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        ...request,
        model: GEMINI_PRIMARY_MODEL,
      });
      recordGeminiUsage(response, GEMINI_PRIMARY_MODEL);
      return response;
    } catch (error) {
      if (isGeminiUnsupportedLocationError(error)) {
        throw createFriendlyGeminiUnsupportedLocationError(error);
      }
      if (isGeminiKeyFailoverError(error)) {
        lastTransientError = error;
        shouldTryFallbackKey = true;
        break;
      }
      if (!isRetryableGeminiError(error)) throw error;
      lastTransientError = error;

      if (attempt < RETRY_DELAYS_MS.length) {
        const jitterMs = Math.floor(Math.random() * 250);
        await wait(RETRY_DELAYS_MS[attempt] + jitterMs);
      }
    }
  }

  const requestUsesUploadedFile = containsGeminiFileData(request.contents);
  const fallbackClient = shouldTryFallbackKey && !requestUsesUploadedFile
    ? await getFallbackGeminiClient()
    : null;
  if (shouldTryFallbackKey && requestUsesUploadedFile) {
    console.warn(
      '[ai-router] Gemini API key failover skipped because an uploaded file may be project-scoped; trying the fallback model with the primary key.',
    );
  }
  if (fallbackClient) {
    try {
      const response = await fallbackClient.models.generateContent({
        ...request,
        model: GEMINI_PRIMARY_MODEL,
      });
      recordGeminiUsage(response, GEMINI_PRIMARY_MODEL);
      console.info('[ai-router] Gemini request completed with the fallback API key.');
      return response;
    } catch (fallbackKeyError) {
      console.warn(
        '[ai-router] Gemini fallback API key failed; trying the fallback model.',
        getErrorText(fallbackKeyError),
      );
      lastTransientError = fallbackKeyError;
    }
  }

  try {
    const response = await (fallbackClient || ai).models.generateContent({
      ...request,
      model: GEMINI_FALLBACK_MODEL,
    });
    recordGeminiUsage(response, GEMINI_FALLBACK_MODEL);
    return response;
  } catch (fallbackError) {
    console.error('Gemini fallback model failed:', fallbackError);
    throw createFriendlyGeminiError(
      isRetryableGeminiError(fallbackError) ? fallbackError : lastTransientError,
    );
  }
}
