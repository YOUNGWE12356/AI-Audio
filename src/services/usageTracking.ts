export type AiUsageEvent = {
  provider: 'elevenlabs' | 'gemini' | 'gpt';
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  credits: number;
};

type AiUsageRecorder = (event: AiUsageEvent) => void;

let aiUsageRecorder: AiUsageRecorder | null = null;

export const setAiUsageRecorder = (recorder: AiUsageRecorder | null) => {
  aiUsageRecorder = recorder;
};

export const toUsageNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
);

export const recordAiUsage = (event: AiUsageEvent) => {
  try {
    aiUsageRecorder?.(event);
  } catch (error) {
    console.warn('[ai-usage] Failed to persist usage metadata:', error);
  }
};

const ELEVENLABS_CREDIT_HEADER_NAMES = [
  'character-cost',
  'x-character-cost',
  'credits-used',
  'x-credits-used',
  'elevenlabs-character-cost',
  'x-elevenlabs-character-cost',
  'elevenlabs-credits-used',
  'x-elevenlabs-credits-used',
  'xi-character-cost',
  'xi-credits-used',
];

const parseElevenLabsCreditHeader = (response: Response) => {
  for (const headerName of ELEVENLABS_CREDIT_HEADER_NAMES) {
    const rawValue = response.headers.get(headerName);
    if (rawValue === null) continue;
    const credits = Number(rawValue);
    if (Number.isFinite(credits)) return Math.max(0, credits);
  }
  return null;
};

export const recordElevenLabsResponseUsage = (
  response: Response,
  model: string,
  options: { fallbackCredits?: number } = {},
) => {
  if (!response.ok) return;
  const headerCredits = parseElevenLabsCreditHeader(response);
  const fallbackCredits = toUsageNumber(options.fallbackCredits);
  recordAiUsage({
    provider: 'elevenlabs',
    model,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    credits: headerCredits ?? fallbackCredits,
  });
};
