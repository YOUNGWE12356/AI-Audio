import { existingBatchSearchQuery } from './sfxBatch';
import type { McpSfxIntent } from './mcpSfxIntent';

export const exactStudioSearchQuery = (value: string) => {
  const text = value.trim();
  return /^[a-z]+(?:[\s-]+[a-z]+)?$/i.test(text) ? existingBatchSearchQuery(text) : null;
};

export const needsStudioGenerationIntent = (value: string) => value.trim().length > 160;

export type StudioSearchPlan = { searchQuery?: string; alternateQuery?: string; clarification?: string };

export async function requestStudioSfxIntent(
  studioDescription: string, intentMode: 'search' | 'generate', options: { duration?: number; signal?: AbortSignal } = {},
) {
  const timeout = AbortSignal.timeout(105_000);
  const response = await fetch('/api/ai/sfx-batch/search-query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studioDescription, intentMode, duration: options.duration }),
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  });
  const result = await response.json() as McpSfxIntent & { error?: string };
  if (!response.ok) throw new Error(result.error || '音效需求提炼失败，请重试。');
  return result;
}

export async function resolveStudioSearchQuery(value: string, signal: AbortSignal): Promise<StudioSearchPlan> {
  const direct = exactStudioSearchQuery(value);
  if (direct) return { searchQuery: direct };
  const result = await requestStudioSfxIntent(value, 'search', { signal });
  if (result.clarification) return { clarification: result.clarification };
  const searchQuery = exactStudioSearchQuery(result.searchQuery || '');
  if (!searchQuery) throw new Error('未能提炼到可用的英文检索词，请补充主要声源或动作。');
  const alternateQuery = exactStudioSearchQuery(result.alternateQuery || '') || undefined;
  return { searchQuery, alternateQuery: alternateQuery?.toLowerCase() !== searchQuery.toLowerCase() ? alternateQuery : undefined };
}

/** Retry only an empty first search, never an error or a cancelled request. */
export async function searchStudioSfx<T extends { items: unknown[]; elapsedMs: number }>(
  plan: { searchQuery: string; alternateQuery?: string },
  search: (query: string) => Promise<T>, signal: AbortSignal, onAlternate?: (query: string) => void,
) {
  signal.throwIfAborted();
  let usedQuery = plan.searchQuery;
  let result = await search(usedQuery);
  signal.throwIfAborted();
  const elapsedMs = result.elapsedMs;
  if (!result.items.length && plan.alternateQuery && plan.alternateQuery.toLowerCase() !== usedQuery.toLowerCase()) {
    usedQuery = plan.alternateQuery;
    onAlternate?.(usedQuery);
    result = await search(usedQuery);
    signal.throwIfAborted();
    result = { ...result, elapsedMs: elapsedMs + result.elapsedMs };
  }
  return { result, usedQuery };
}

export async function resolveStudioGenerationPrompt(value: string, duration?: number) {
  const result = await requestStudioSfxIntent(value, 'generate', { duration });
  if (result.clarification) throw new Error(result.clarification);
  if (!result.generationPrompt) throw new Error('音效描述提炼未完成，请重试。');
  return result.generationPrompt;
}
