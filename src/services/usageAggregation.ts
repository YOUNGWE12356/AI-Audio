import type { AiUsageEvent } from './usageTracking';

export type UsageIdentitySource = 'feishu' | 'device' | 'unknown';

export type StoredAiUsageEvent = AiUsageEvent & {
  timestamp: string;
  feature: string;
  endpoint: string;
  userId: string;
  displayName: string;
  department: string;
  identitySource: UsageIdentitySource;
  ipAddress: string;
};

export type UsageUserDetail = {
  provider: AiUsageEvent['provider'];
  feature: string;
  model: string;
  credits: number;
  companyPoints: number;
  billingQuantity: number;
  billingUnit?: AiUsageEvent['billingUnit'];
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  requests: number;
};

export type UsageUserSummary = {
  userId: string;
  displayName: string;
  department: string;
  identitySource: UsageIdentitySource;
  ipAddresses: string[];
  requests: number;
  elevenLabsCredits: number;
  companyPoints: number;
  legacyTokens: number;
  gptTokens: number;
  totalTokens: number;
  lastUsedAt: string;
  details: UsageUserDetail[];
};

type MemberBucket = Omit<UsageUserSummary, 'details'> & {
  details: Map<string, UsageUserDetail>;
};

export const summarizeUsageUsers = (events: StoredAiUsageEvent[]): UsageUserSummary[] => {
  const members = new Map<string, MemberBucket>();
  for (const event of events) {
    const memberKey = `${event.identitySource}:${event.userId}`;
    const member = members.get(memberKey) || {
      userId: event.userId,
      displayName: event.displayName,
      department: event.department,
      identitySource: event.identitySource,
      ipAddresses: [],
      requests: 0,
      elevenLabsCredits: 0,
      companyPoints: 0,
      legacyTokens: 0,
      gptTokens: 0,
      totalTokens: 0,
      lastUsedAt: event.timestamp,
      details: new Map<string, UsageUserDetail>(),
    };
    member.requests += 1;
    member.elevenLabsCredits += event.provider === 'elevenlabs' ? event.credits : 0;
    member.companyPoints += event.companyPoints || 0;
    member.legacyTokens += event.provider === 'legacy' ? event.totalTokens : 0;
    member.gptTokens += event.provider === 'gpt' ? event.totalTokens : 0;
    member.totalTokens += event.totalTokens;
    if (event.ipAddress && !member.ipAddresses.includes(event.ipAddress)) {
      member.ipAddresses.push(event.ipAddress);
    }
    if (Date.parse(event.timestamp) > Date.parse(member.lastUsedAt)) member.lastUsedAt = event.timestamp;

    const detailKey = `${event.provider}\u0000${event.feature}\u0000${event.model}`;
    const detail = member.details.get(detailKey) || {
      provider: event.provider,
      feature: event.feature,
      model: event.model,
      credits: 0,
      companyPoints: 0,
      billingQuantity: 0,
      billingUnit: event.billingUnit,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      requests: 0,
    };
    detail.credits += event.credits;
    detail.companyPoints += event.companyPoints || 0;
    detail.billingQuantity += event.billingQuantity || 0;
    if (!detail.billingUnit) detail.billingUnit = event.billingUnit;
    detail.inputTokens += event.inputTokens;
    detail.outputTokens += event.outputTokens;
    detail.reasoningTokens += event.reasoningTokens;
    detail.totalTokens += event.totalTokens;
    detail.requests += 1;
    member.details.set(detailKey, detail);
    members.set(memberKey, member);
  }

  return Array.from(members.values()).map(member => ({
    ...member,
    details: Array.from(member.details.values()).sort((left, right) => (
      (right.companyPoints + right.credits + right.totalTokens) - (left.companyPoints + left.credits + left.totalTokens)
    )),
  })).sort((left, right) => Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt));
};
