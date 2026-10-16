import { toUsageNumber } from './usageTracking';

export const GPT_COMPANY_POINT_PRICING_VERSION = 'company-v1-gpt-token';

export const DEFAULT_GPT_TOKEN_PRICING = {
  inputUsdPerMillionTokens: 2,
  outputUsdPerMillionTokens: 10,
  minimumPointsPerRequest: 1,
  audioInputUsdPerMillionTokens: 10,
  audioOutputUsdPerMillionTokens: 20,
  audioMinimumPointsPerRequest: 10,
} as const;

type GptPricingMode = 'text' | 'audio';

const positiveNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getGptTokenPricing = (mode: GptPricingMode = 'text') => {
  if (mode === 'audio') {
    return {
      inputUsdPerMillionTokens: positiveNumber(
        process.env.GPT_AUDIO_INPUT_USD_PER_MILLION_TOKENS,
        DEFAULT_GPT_TOKEN_PRICING.audioInputUsdPerMillionTokens,
      ),
      outputUsdPerMillionTokens: positiveNumber(
        process.env.GPT_AUDIO_OUTPUT_USD_PER_MILLION_TOKENS,
        DEFAULT_GPT_TOKEN_PRICING.audioOutputUsdPerMillionTokens,
      ),
      minimumPointsPerRequest: positiveNumber(
        process.env.GPT_AUDIO_MINIMUM_COMPANY_POINTS_PER_REQUEST,
        DEFAULT_GPT_TOKEN_PRICING.audioMinimumPointsPerRequest,
      ),
    };
  }
  return {
    inputUsdPerMillionTokens: positiveNumber(
      process.env.GPT_INPUT_USD_PER_MILLION_TOKENS,
      DEFAULT_GPT_TOKEN_PRICING.inputUsdPerMillionTokens,
    ),
    outputUsdPerMillionTokens: positiveNumber(
      process.env.GPT_OUTPUT_USD_PER_MILLION_TOKENS,
      DEFAULT_GPT_TOKEN_PRICING.outputUsdPerMillionTokens,
    ),
    minimumPointsPerRequest: positiveNumber(
      process.env.GPT_MINIMUM_COMPANY_POINTS_PER_REQUEST,
      DEFAULT_GPT_TOKEN_PRICING.minimumPointsPerRequest,
    ),
  };
};

export const estimateGptTokenCompanyPoints = ({
  inputTokens,
  outputTokens,
  mode = 'text',
}: {
  inputTokens: number;
  outputTokens: number;
  mode?: GptPricingMode;
}) => {
  const pricing = getGptTokenPricing(mode);
  const points = (
    toUsageNumber(inputTokens) * pricing.inputUsdPerMillionTokens
    + toUsageNumber(outputTokens) * pricing.outputUsdPerMillionTokens
  ) / 1000;
  return Math.max(pricing.minimumPointsPerRequest, Number(points.toFixed(6)));
};

export const isGptCompanyPointPricingEnabled = () => true;
