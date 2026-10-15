import { recordAiUsage, toUsageNumber } from './usageTracking';

export const SchemaType = {
  OBJECT: 'object', ARRAY: 'array', STRING: 'string', INTEGER: 'integer', NUMBER: 'number', BOOLEAN: 'boolean',
} as const;
export const ThinkingLevel = { LOW: 'low' } as const;

export const audioUnderstandingUnavailableError = () => Object.assign(
  new Error('当前 AI 网关未配置音频理解模型，无法准确分析上传的音频。请配置支持音频输入的模型后重试。'),
  { status: 503 },
);

export const unsupportedMediaError = () => Object.assign(
  new Error('当前 AI 网关不支持此素材。完整视频请使用关键帧分析；音频理解需要另配兼容模型。'),
  { status: 503 },
);

type Gateway = { apiKey: string; baseUrl: string; model: string; provider: 'ark' | 'tokenhub' | 'openai' };
type ResponseBody = {
  error?: { message?: string }; model?: string; output_text?: string; status?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};
type InputPart = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string };
type CompatibleInput = { hasImage: boolean; input: string | Array<{ role: 'user'; content: InputPart[] }> };
export type AiContentRequest = { contents: unknown; config?: Record<string, any>; model?: string };
export type AiContentResponse = { text: string; modelVersion: string };

const companyPoints = (input: number, output: number) => (
  input * (Number(process.env.GPT_INPUT_USD_PER_MILLION_TOKENS) || 0)
  + output * (Number(process.env.GPT_OUTPUT_USD_PER_MILLION_TOKENS) || 0)
) / 1000;

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '');
const normalizeTokenHubModel = (value: string | undefined) => {
  const model = value?.trim() || 'gpt-6.1-sol';
  return model.includes('/') ? model : `ark/${model}`;
};

const getGateway = (): Gateway | null => {
  if (typeof window !== 'undefined') return null;
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) return {
    apiKey: openaiKey,
    baseUrl: trimTrailingSlashes(process.env.OPENAI_BASE_URL?.trim() || process.env.GPT_BASE_URL?.trim() || 'https://api.openai.com/v1'),
    model: process.env.OPENAI_MODEL?.trim() || process.env.GPT_MODEL?.trim() || 'gpt-6.1-sol',
    provider: 'openai',
  };
  const arkKey = process.env.ARK_API_KEY?.trim();
  if (arkKey) return {
    apiKey: arkKey,
    baseUrl: trimTrailingSlashes(process.env.ARK_BASE_URL?.trim() || process.env.GPT_BASE_URL?.trim() || 'https://ark.cn-beijing.volces.com/api/v3'),
    model: process.env.ARK_MODEL?.trim() || process.env.GPT_MODEL?.trim() || 'gpt-6.1-sol',
    provider: 'ark',
  };
  const tokenHubKey = process.env.TOKENHUB_API_KEY?.trim();
  if (tokenHubKey) return {
    apiKey: tokenHubKey,
    baseUrl: trimTrailingSlashes(process.env.TOKENHUB_BASE_URL?.trim() || process.env.GPT_BASE_URL?.trim() || 'https://tokenhub.piegateway.me/v1'),
    model: normalizeTokenHubModel(process.env.TOKENHUB_MODEL || process.env.GPT_MODEL),
    provider: 'tokenhub',
  };
  return null;
};

export const isGptTextConfigured = () => Boolean(getGateway());
export type AssistantModelItem = Record<string, any>;

const extractText = (response: ResponseBody) => {
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();
  return (response.output || []).flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text!.trim()).filter(Boolean).join('\n');
};

const trackUsage = (result: ResponseBody, gateway: Gateway) => {
  const inputTokens = toUsageNumber(result.usage?.input_tokens);
  const outputTokens = toUsageNumber(result.usage?.output_tokens);
  const reasoningTokens = toUsageNumber(result.usage?.output_tokens_details?.reasoning_tokens);
  recordAiUsage({ provider: 'gpt', model: result.model || gateway.model, inputTokens, outputTokens,
    reasoningTokens, totalTokens: toUsageNumber(result.usage?.total_tokens) || inputTokens + outputTokens,
    credits: 0, companyPoints: companyPoints(inputTokens, outputTokens), pricingVersion: 'company-v1',
    billingQuantity: inputTokens + outputTokens, billingUnit: 'token' });
  return { inputTokens, outputTokens, reasoningTokens };
};

const requestGateway = async (gateway: Gateway, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal) => {
  const response = await fetch(`${gateway.baseUrl}/responses`, {
    method: 'POST', headers: { Authorization: `Bearer ${gateway.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  const result = await response.json().catch(() => ({})) as ResponseBody;
  if (!response.ok) throw Object.assign(new Error(result.error?.message || `AI gateway request failed (${response.status})`), { status: response.status });
  if (result.status === 'incomplete') throw new Error('模型输出未完成，请缩小任务范围后重试。');
  return result;
};

export const generateGptToolTurn = async ({ instructions, input, tools, signal }: {
  instructions: string; input: AssistantModelItem[]; tools: AssistantModelItem[]; signal: AbortSignal;
}): Promise<{ output: AssistantModelItem[]; text: string; model: string }> => {
  const gateway = getGateway();
  if (!gateway) throw new Error('智能助手执行服务尚未配置。');
  const result = await requestGateway(gateway, { model: gateway.model, instructions, input, tools,
    parallel_tool_calls: false, store: false, include: ['reasoning.encrypted_content'],
    reasoning: { effort: 'medium' }, max_output_tokens: 6000 }, 120_000, signal);
  trackUsage(result, gateway);
  return { output: result.output || [], text: extractText(result), model: result.model || gateway.model };
};

export type GptStructuredResult<T> = { value: T; model: string; provider: Gateway['provider'] };
export const generateGptStructuredJson = async <T>({ instructions, input, schema, schemaName,
  maxOutputTokens = 4000, reasoningEffort = 'medium',
}: { instructions: string; input: string; schema: Record<string, unknown>; schemaName: string;
  maxOutputTokens?: number; reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}): Promise<GptStructuredResult<T>> => {
  const gateway = getGateway();
  if (!gateway) throw Object.assign(new Error('GPT 任务规划服务尚未配置。'), { status: 503 });
  const result = await requestGateway(gateway, { model: gateway.model, instructions, input,
    reasoning: { effort: reasoningEffort }, max_output_tokens: maxOutputTokens,
    text: { format: { type: 'json_schema', name: schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64), strict: true, schema } },
  }, 60_000);
  const text = extractText(result);
  if (!text) throw new Error('GPT gateway returned no structured output.');
  const value = JSON.parse(text) as T;
  trackUsage(result, gateway);
  return { value, model: result.model || gateway.model, provider: gateway.provider };
};

const collectContent = (value: unknown, parts: InputPart[]): boolean => {
  if (typeof value === 'string') { if (value.trim()) parts.push({ type: 'input_text', text: value }); return true; }
  if (Array.isArray(value)) return value.every(item => collectContent(item, parts));
  if (!value || typeof value !== 'object') return false;
  const part = value as Record<string, unknown>;
  const inlineData = (part.inlineData || part.inline_data) as Record<string, unknown> | undefined;
  if (inlineData) {
    const data = typeof inlineData.data === 'string' ? inlineData.data : '';
    const mimeType = typeof inlineData.mimeType === 'string' ? inlineData.mimeType
      : typeof inlineData.mime_type === 'string' ? inlineData.mime_type : 'image/jpeg';
    if (!data || !mimeType.startsWith('image/')) return false;
    parts.push({ type: 'input_image', image_url: `data:${mimeType};base64,${data}` });
    return true;
  }
  if ('fileData' in part || 'file_data' in part || 'videoMetadata' in part || 'video_metadata' in part) return false;
  if (typeof part.text === 'string') { if (part.text.trim()) parts.push({ type: 'input_text', text: part.text }); return true; }
  if (Array.isArray(part.parts)) return collectContent(part.parts, parts);
  return false;
};

const hasAudio = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasAudio);
  if (!value || typeof value !== 'object') return false;
  const part = value as Record<string, unknown>;
  const data = (part.inlineData || part.inline_data) as Record<string, unknown> | undefined;
  if (typeof (data?.mimeType || data?.mime_type) === 'string' && String(data?.mimeType || data?.mime_type).startsWith('audio/')) return true;
  return Array.isArray(part.parts) && part.parts.some(hasAudio);
};

const normalizeSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key,
    key === 'type' && typeof child === 'string' ? child.toLowerCase() : normalizeSchema(child)]));
};

export const generateAiContent = async (request: AiContentRequest): Promise<AiContentResponse> => {
  const gateway = getGateway();
  if (!gateway) throw Object.assign(new Error('AI 文本/视觉网关尚未配置。'), { status: 503 });
  const parts: InputPart[] = [];
  if (!collectContent(request.contents, parts)) throw hasAudio(request.contents) ? audioUnderstandingUnavailableError() : unsupportedMediaError();
  const textParts = parts.filter((part): part is { type: 'input_text'; text: string } => part.type === 'input_text');
  if (textParts.length === 0) throw unsupportedMediaError();
  const hasImage = parts.some(part => part.type === 'input_image');
  const input: CompatibleInput = { hasImage, input: hasImage ? [{ role: 'user', content: parts }] : textParts.map(part => part.text.trim()).join('\n\n') };
  const config = request.config || {};
  const body: Record<string, unknown> = { model: gateway.model, input: input.input,
    reasoning: { effort: process.env.GPT_REASONING_EFFORT?.trim() || 'low' } };
  if (typeof config.maxOutputTokens === 'number') body.max_output_tokens = config.maxOutputTokens;
  if (config.responseSchema) body.text = { format: { type: 'json_schema', name: 'ai_audio_response', strict: false,
    schema: normalizeSchema(config.responseSchema) } };
  const startedAt = Date.now();
  const result = await requestGateway(gateway, body, 90_000);
  const text = extractText(result);
  if (!text) throw new Error('AI gateway returned no text output.');
  if (config.responseSchema) JSON.parse(text);
  const usage = trackUsage(result, gateway);
  console.info(`[ai-router] ${hasImage ? 'Vision' : 'Text'} request completed with ${result.model || gateway.model} via ${gateway.provider} in ${Date.now() - startedAt}ms (${usage.inputTokens} input, ${usage.outputTokens} output, ${usage.reasoningTokens} reasoning tokens).`);
  return { text, modelVersion: result.model || gateway.model };
};
