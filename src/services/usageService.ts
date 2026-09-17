import { getSfxLibraryAdminHeaders } from './sfxLibraryAdminService';

export type UsagePeriod = 'week' | 'month' | 'billingCycle' | 'custom';
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
  unmeteredEvents: Array<{
    timestamp: string;
    feature: string;
    model: string;
    displayName: string;
    identitySource: UsageIdentitySource;
  }>;
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

export type ElevenLabsQuotaUser = {
  userId: string;
  displayName: string;
  department: string;
  identitySource: UsageIdentitySource;
  ipAddresses: string[];
  lastUsedAt: string;
  enabled: boolean;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  timeZone: 'Asia/Shanghai';
  baseCredits: number;
  bonusCredits: number;
  limitCredits: number;
  usedCredits: number;
  pendingCredits: number;
  remainingCredits: number;
  blocked: boolean;
};

export type ElevenLabsQuotaSummary = {
  enabled: boolean;
  defaultMonthlyCredits: number;
  period: {
    key: string;
    start: string;
    end: string;
    timeZone: 'Asia/Shanghai';
  };
  accountBillingCycle: {
    periodKey: string;
    periodStart: string;
    periodEnd: string;
    timeZone: 'Asia/Shanghai';
    defaultTotalCredits: number;
    totalCredits: number;
    usedCredits: number;
    remainingCredits: number;
    adjusted: boolean;
  };
  users: ElevenLabsQuotaUser[];
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
  if (period === 'billingCycle') {
    return getElevenLabsBillingCycleStart(date);
  }
  if (period === 'month') {
    date.setDate(1);
    return date;
  }
  const daysSinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday);
  return date;
};

export const getElevenLabsBillingCycleStart = (now = new Date()) => {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  if (date.getDate() < 11) {
    date.setMonth(date.getMonth() - 1);
  }
  date.setDate(11);
  return date;
};

export const formatDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const parseDateInputStart = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
};

export const parseDateInputEnd = (value: string) => {
  const date = parseDateInputStart(value);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date;
};

export async function fetchUsageSummaryRange(start: Date, end: Date = new Date(), signal?: AbortSignal): Promise<UsageSummary> {
  const params = new URLSearchParams({
    start: String(start.getTime()),
    end: String(end.getTime()),
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

export async function fetchUsageSummary(period: UsagePeriod, signal?: AbortSignal): Promise<UsageSummary> {
  return fetchUsageSummaryRange(getPeriodStart(period), new Date(), signal);
}

export async function fetchElevenLabsQuotaSummary(signal?: AbortSignal): Promise<ElevenLabsQuotaSummary> {
  const response = await fetch('/api/usage/quotas', {
    signal,
    headers: getSfxLibraryAdminHeaders(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `无法读取成员配额 (${response.status})`);
  }
  return body as ElevenLabsQuotaSummary;
}

export async function setElevenLabsQuotaBonus(
  userId: string,
  bonusCredits: number,
): Promise<ElevenLabsQuotaSummary> {
  const response = await fetch('/api/usage/quotas', {
    method: 'PUT',
    headers: getSfxLibraryAdminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ userId, bonusCredits }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `更新成员配额失败 (${response.status})`);
  }
  return body as ElevenLabsQuotaSummary;
}

export async function setElevenLabsAccountQuotaTotal(
  totalCredits: number,
): Promise<ElevenLabsQuotaSummary> {
  const response = await fetch('/api/usage/quotas/account', {
    method: 'PUT',
    headers: getSfxLibraryAdminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ totalCredits }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `更新本账期总额度失败 (${response.status})`);
  }
  return body as ElevenLabsQuotaSummary;
}
