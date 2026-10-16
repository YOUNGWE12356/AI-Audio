import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GPT_TOKEN_PRICING,
  estimateGptTokenCompanyPoints,
  getGptTokenPricing,
} from './companyPointPricing';

const pricingKeys = [
  'GPT_INPUT_USD_PER_MILLION_TOKENS',
  'GPT_OUTPUT_USD_PER_MILLION_TOKENS',
  'GPT_MINIMUM_COMPANY_POINTS_PER_REQUEST',
  'GPT_AUDIO_INPUT_USD_PER_MILLION_TOKENS',
  'GPT_AUDIO_OUTPUT_USD_PER_MILLION_TOKENS',
  'GPT_AUDIO_MINIMUM_COMPANY_POINTS_PER_REQUEST',
] as const;

const isolatedPricing = async (run: () => void | Promise<void>) => {
  const saved = pricingKeys.map(key => process.env[key]);
  pricingKeys.forEach(key => delete process.env[key]);
  try {
    await run();
  } finally {
    pricingKeys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
  }
};

test('text and audio requests always receive non-zero trial points', () => isolatedPricing(() => {
  assert.equal(estimateGptTokenCompanyPoints({ inputTokens: 0, outputTokens: 0 }), 1);
  assert.equal(estimateGptTokenCompanyPoints({ inputTokens: 0, outputTokens: 0, mode: 'audio' }), 10);
  assert.deepEqual(getGptTokenPricing(), {
    inputUsdPerMillionTokens: DEFAULT_GPT_TOKEN_PRICING.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: DEFAULT_GPT_TOKEN_PRICING.outputUsdPerMillionTokens,
    minimumPointsPerRequest: DEFAULT_GPT_TOKEN_PRICING.minimumPointsPerRequest,
  });
}));

test('configured supplier prices override the trial defaults', () => isolatedPricing(() => {
  process.env.GPT_INPUT_USD_PER_MILLION_TOKENS = '3';
  process.env.GPT_OUTPUT_USD_PER_MILLION_TOKENS = '12';
  process.env.GPT_MINIMUM_COMPANY_POINTS_PER_REQUEST = '0.5';
  assert.equal(estimateGptTokenCompanyPoints({ inputTokens: 2_000, outputTokens: 500 }), 12);
  assert.equal(estimateGptTokenCompanyPoints({ inputTokens: 10, outputTokens: 0 }), 0.5);
}));
