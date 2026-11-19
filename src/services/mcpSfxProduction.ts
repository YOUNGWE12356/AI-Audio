import type { AgentToolContext } from './assistantAgentTools';
import { createSfxRetryRequest } from './mcpSfxReliability';
import { createOnlineSfxRelevanceMatcher } from './onlineSfxRelevance';
import { existingBatchSearchQuery } from './sfxBatch';
import { rankMcpSfxCandidates, type McpSfxIntent } from './mcpSfxIntent';

export const MCP_SFX_POLICY = '音效请求默认调用produce_sound_effect（批量用produce_sfx_batch），mode留空或auto：先联网搜索，搜索结果可直接进入制作并保留来源；不因授权未知而自动拒绝使用，也不声称已取得商用授权。无匹配音效、候选无法读取或搜索服务错误时，自动改用AI生成一次，并说明切换原因。试听后发现候选内容不合适，可用mode=generate继续本次制作，不必再次搜索。明确要求AI生成时直接使用mode=generate或generate_sound_effect；明确只搜索时用mode=search，不自动生成。已知搜索繁忙由平台按账号排队并最多重试三次，搜索持续繁忙且没有可用音效时，auto才切换AI生成一次；不要另起任务反复搜索。平台整体请求限制在允许的短等待后重试，持续受限时停止。登录、权限、积分不足、存储上限、未知429、参数错误或用户取消时停止。之前任务失败不代表本次不可生成，必须按本次调用结果判断；生成失败时如实报告，不擅自以程序合成代替，不自动重复生成扣费。请保留用户的原始描述，服务端据此校正检索词，首词无候选时可尝试一个备用词。收到needs_clarification时将question转达给用户。';

export type SfxProductionInput = {
  name: string; keywords: string; description?: string; searchQuery?: string; duration?: number;
  mode?: 'auto' | 'search' | 'generate'; exactSearchQuery?: boolean; searchBatchId?: string; searchBatchItemId?: string;
};

const canFallBack = (error: any) => {
  const status = Number(error?.status);
  if (['COMPANY_POINTS_EXCEEDED', 'STORAGE_LIMIT_EXCEEDED', 'ELEVENLABS_QUOTA',
    'ELEVENLABS_AUTH', 'ELEVENLABS_POLICY', 'ELEVENLABS_INVALID_INPUT'].includes(error?.code)) return false;
  // Access/billing/admission failures are not a reason to incur another charge.
  if ([400, 401, 403, 409, 413, 429].includes(status)) return false;
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return false;
  return error?.code === 'SFX_NO_MATCHES' || error?.code === 'SFX_CAPTURE_FAILED' || error?.code === 'SFX_SEARCH_UNAVAILABLE'
    || error?.code === 'SFX_QUERY_FAILED'
    || error?.name === 'TimeoutError' || [404, 408, 410, 422, 500, 502, 503, 504].includes(status)
    || error instanceof TypeError && /fetch|network/i.test(error.message);
};

/** One route for single and batch requests, including their fallback boundary. */
export async function produceMcpSoundEffect(c: AgentToolContext, input: SfxProductionInput,
  generate: (args: Record<string, any>) => Promise<unknown>) {
  c.signal.throwIfAborted();
  const mode = input.mode || 'auto';
  let intent: McpSfxIntent = {};
  let attemptedQueries: string[] | undefined;
  const description = input.description?.trim() || '';
  const prepare = (request: AgentToolContext['request']): Promise<McpSfxIntent> => request('/api/ai/sfx-batch/search-query', {
    keywords: input.keywords, searchQuery: input.searchQuery || '', description,
    intentMode: mode, exactSearchQuery: mode !== 'generate' && input.exactSearchQuery === true, duration: input.duration,
  });
  const clarification = (question: string) => ({ status: 'needs_clarification' as const, requestedMode: mode, question,
    method: undefined, fallback: false, fallbackReason: undefined });
  const generateOnce = async (reason?: string) => {
    c.signal.throwIfAborted();
    c.progress?.(reason ? '未取得合适的搜索音效，正在改用 AI 生成…' : '正在按要求使用 AI 生成音效…');
    // Generation needs the sound's details, not a two-word search query.
    const duration = input.duration ?? intent.suggestedDuration ?? 4;
    const result = await generate({ name: input.name, prompt: intent.generationPrompt || description || input.keywords,
      duration });
    const output = result as any;
    if (!output?.asset?.size && !output?.assets?.some((asset: any) => asset?.size > 0)) throw new Error('AI生成未返回可用音效文件。');
    return { method: 'generate' as const, requestedMode: mode, status: 'completed' as const,
      fallback: Boolean(reason), ...(reason ? { fallbackReason: reason } : {}), soundDetails: intent.soundDetails,
      generationPrompt: intent.generationPrompt, requestedDuration: duration, result };
  };
  if (mode === 'generate') {
    // Legacy callers can send a longer prompt directly to the generator.
    if (description.length <= 2000) {
      try { intent = await prepare(c.request); }
      catch (error) { c.signal.throwIfAborted(); if (!canFallBack(error)) throw error; }
    }
    if (intent.clarification) return clarification(intent.clarification);
    return generateOnce();
  }
  let searchQuery: string | undefined;
  let fallbackReason: string;
  const request = createSfxRetryRequest(c);
  const search = async () => {
    try { intent = await prepare(request); }
    catch (error) {
      c.signal.throwIfAborted();
      const existing = existingBatchSearchQuery(input.searchQuery || '');
      if (!existing || !canFallBack(error)) throw error;
      intent = { searchQuery: existing };
    }
    if (intent.clarification) return clarification(intent.clarification);
    searchQuery = intent.searchQuery;
    const searchBatchId = input.searchBatchId;
    const result = await request('/api/ai/sfx-batch/search', { query: searchQuery, alternateQuery: intent.alternateQuery,
      searchBatchId, searchBatchItemId: input.searchBatchItemId });
    searchQuery = result.usedQuery || searchQuery;
    attemptedQueries = result.attemptedQueries || (searchQuery ? [searchQuery] : undefined);
    if (!Array.isArray(result.items)) throw Object.assign(new Error('搜索服务未返回有效的候选列表。'), { code: 'SFX_SEARCH_UNAVAILABLE' });
    if (!result.items.length && result.sources?.length && result.sources.every((source: any) => source.unavailable)) {
      throw Object.assign(new Error('所有音效搜索来源暂不可用。'), { code: 'SFX_SEARCH_UNAVAILABLE' });
    }
    // This is metadata matching, not a claim that we listened to the sound.
    const matches = createOnlineSfxRelevanceMatcher(searchQuery || '');
    const items = mode === 'search' ? result.items : result.items.filter((item: any) => !item.title || !searchQuery || matches(item.title) > 0);
    if (!items.length) {
      if (mode === 'auto') throw Object.assign(new Error('未搜索到与需求匹配的音效。'), { code: 'SFX_NO_MATCHES' });
      return { method: 'search' as const, requestedMode: mode, status: 'no_matches' as const,
        fallback: false, searchQuery, attemptedQueries, searchBatchId, candidates: [], message: '未找到匹配音效。' };
    }
    const candidates = [];
    let lastError: unknown;
    let blockingError: unknown;
    for (const candidate of items) {
      c.signal.throwIfAborted();
      try {
        const captured = await request('/api/ai/sfx-batch/capture', { id: candidate.id });
        const asset = await c.register(captured.url, `${input.name}_${candidates.length + 1}.wav`, false);
        candidates.push({ ...candidate, status: 'completed', asset });
      } catch (error) {
        c.signal.throwIfAborted();
        lastError = error;
        candidates.push({ ...candidate, status: 'failed', message: error instanceof Error ? error.message : '试听读取失败。' });
        if (!canFallBack(error)) { blockingError = error; break; }
      }
    }
    if (candidates.some(v => v.asset)) return { method: 'search' as const, requestedMode: mode, status: 'completed' as const,
      fallback: false, searchQuery, attemptedQueries, searchBatchId, soundDetails: intent.soundDetails,
      matchBasis: 'title_metadata_and_preview_duration',
      candidates: rankMcpSfxCandidates(candidates, searchQuery || '', intent.generationPrompt, input.duration ?? intent.suggestedDuration),
      nextAction: '搜索文件可直接用于制作，保留来源；如试听后内容不合适，用mode=generate生成本次需求，不以之前任务的失败跳过生成。' };
    throw blockingError || lastError || Object.assign(new Error('候选音效均无法读取。'), { code: 'SFX_CAPTURE_FAILED' });
  };
  try { return await (c.queueSfxSearch ? c.queueSfxSearch(search) : search()); }
  catch (error) {
    c.signal.throwIfAborted();
    if (mode !== 'auto' || !canFallBack(error)) throw error;
    fallbackReason = error instanceof Error ? error.message : '音效搜索服务出错。';
  }
  // Keep generation outside the search catch: its failure must never cause a second paid call.
  return { ...await generateOnce(fallbackReason), searchQuery, attemptedQueries };
}
