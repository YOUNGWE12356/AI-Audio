import { getSfxLibraryAdminHeaders } from './sfxLibraryAdminService';

export type UsagePeriod = 'week' | 'month';
export type UsageProviderName = 'elevenLabs' | 'gemini' | 'gpt';
export type UsageIdentitySource = 'feishu' | 'device' | 'unknown';

export type UsageFeature = {
  feature: string;
  credits: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  requests: number;
  models: Array<{ model: string; amount: number }>;
};

export type ProviderUsage = {
  status: 'tracking' | 'not_configured';
  credits: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  requests: number;
  unmeteredRequests: number;
  models: Array<{ model: string; amount: number }>;
  features: UsageFeature[];
  daily: Array<{
    date: string;
    credits: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    requests: number;
  }>;
};

export type UsageSummary = {
  range: { start: string; end: string; timeZone: string };
  collectedSince: string;
  detailedSince: string;
  identitySince: string;
  scope: 'this-tool-only';
  users: UsageUser[];
  providers: Record<UsageProviderName, ProviderUsage>;
};

export type UsageUserDetail = {
  provider: 'elevenlabs' | 'gemini' | 'gpt';
  feature: string;
  model: string;
  credits: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  requests: number;
};

export type UsageUser = {
  userId: string;
  displayName: string;
  department: string;
  identitySource: UsageIdentitySource;
  ipAddresses: string[];
  requests: number;
  elevenLabsCredits: number;
  geminiTokens: number;
  gptTokens: number;
  totalTokens: number;
  lastUsedAt: string;
  details: UsageUserDetail[];
};

const getPeriodStart = (period: UsagePeriod) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  if (period === 'month') {
    date.setDate(1);
    return date;
  }
  const daysSinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday);
  return date;
};

export async function fetchUsageSummary(period: UsagePeriod, signal?: AbortSignal): Promise<UsageSummary> {
  const params = new URLSearchParams({
    start: String(getPeriodStart(period).getTime()),
    end: String(Date.now()),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
  });
  const response = await fetch(`/api/usage/summary?${params.toString()}`, {
    signal,
    headers: getSfxLibraryAdminHeaders(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `无法读取用量统计 (${response.status})`);
  }
  return body as UsageSummary;
}
