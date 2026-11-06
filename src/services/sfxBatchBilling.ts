import { SOUND_EFFECT_POINTS_PER_SECOND } from './companyPointRates';
import { batchQuerySource, existingBatchSearchQuery, type SfxBatchRequirement } from './sfxBatch';

export const BATCH_SFX_USAGE_FEATURES = {
  analysis: 'AI 音效 · 批量需求分析',
  query: 'AI 音效 · 关键词转换',
  search: 'AI 音效 · 批量联网搜索',
  generation: 'AI 音效 · 批量 AI 生成',
} as const;

export function resolveBatchSfxUsageFeature(endpoint: string, body?: { usageSource?: unknown }) {
  if (/^\/api\/ai\/sfx-batch\/analyze(?:\/|$)/.test(endpoint)) return BATCH_SFX_USAGE_FEATURES.analysis;
  if (endpoint === '/api/ai/sfx-batch/search-query') return BATCH_SFX_USAGE_FEATURES.query;
  if (endpoint === '/api/ai/sfx-batch/search') return BATCH_SFX_USAGE_FEATURES.search;
  if (endpoint === '/api/ai/elevenlabs/sound-effect' && body?.usageSource === 'sfx-batch') return BATCH_SFX_USAGE_FEATURES.generation;
  return undefined;
}

type CostRow = Pick<SfxBatchRequirement, 'duration' | 'keywords' | 'description' | 'searchQuery'> & { searchQuerySource?: string };
export const needsBatchSearchQuery = (row: Omit<CostRow, 'duration'>) => (
  row.searchQuerySource !== batchQuerySource(row) || !existingBatchSearchQuery(row.searchQuery)
);
export const isBatchSfxDurationValid = (duration: number) => Number.isFinite(duration) && duration >= 0.5 && duration <= 30;

export function estimateBatchSfxCost(rows: readonly CostRow[]) {
  let seconds = 0, queryConversions = 0, invalidDurations = 0;
  for (const row of rows) {
    if (isBatchSfxDurationValid(row.duration)) seconds += row.duration;
    else invalidDurations++;
    if (needsBatchSearchQuery(row)) queryConversions++;
  }
  return {
    seconds,
    generationPoints: rows.length && !invalidDurations ? Number((seconds * SOUND_EFFECT_POINTS_PER_SECOND).toFixed(6)) : null,
    queryConversions,
    invalidDurations,
  };
}
