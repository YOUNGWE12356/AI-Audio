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

export const recordElevenLabsResponseUsage = (response: Response, model: string) => {
  if (!response.ok) return;
  const rawCredits = response.headers.get('character-cost')
    || response.headers.get('credits-used')
    || response.headers.get('x-character-cost');
  const credits = Number(rawCredits);
  recordAiUsage({
    provider: 'elevenlabs',
    model,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    credits: Number.isFinite(credits) ? Math.max(0, credits) : 0,
  });
};
