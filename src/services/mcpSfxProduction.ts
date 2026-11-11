import { randomUUID } from 'node:crypto';
import type { AgentToolContext } from './assistantAgentTools';

export const MCP_SFX_POLICY = '音效请求默认调用produce_sound_effect（批量用produce_sfx_batch），mode留空或auto：先联网搜索；搜索或候选采集发生服务错误且没有可用音效时，自动改用AI生成一次，并说明切换原因。用户明确要求AI生成时才直接使用mode=generate或generate_sound_effect；用户明确只搜索时用mode=search，不自动生成。没有搜索结果不等于报错，不擅自生成；登录、权限、积分不足、限流、参数错误或用户取消时停止，不切换生成。';

export type SfxProductionInput = {
  name: string; keywords: string; description?: string; searchQuery?: string; duration?: number;
  mode?: 'auto' | 'search' | 'generate'; searchBatchId?: string;
};

const canFallBack = (error: any) => {
  const status = Number(error?.status);
  // Access/billing/admission failures are not a reason to incur another charge.
  if ([400, 401, 403, 409, 413, 429].includes(status)) return false;
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return false;
  return error?.code === 'SFX_CAPTURE_FAILED' || error?.code === 'SFX_SEARCH_UNAVAILABLE'
    || error?.code === 'SFX_QUERY_FAILED'
    || error?.name === 'TimeoutError' || [404, 408, 410, 422, 500, 502, 503, 504].includes(status)
    || error instanceof TypeError && /fetch|network/i.test(error.message);
};

/** One route for single and batch requests, including their fallback boundary. */
export async function produceMcpSoundEffect(c: AgentToolContext, input: SfxProductionInput,
  generate: (args: Record<string, any>) => Promise<unknown>) {
  c.signal.throwIfAborted();
  const mode = input.mode || 'auto';
  const generateOnce = async (reason?: string) => {
    c.signal.throwIfAborted();
    c.progress?.(reason ? '音效搜索失败，正在改用 AI 生成…' : '正在按要求使用 AI 生成音效…');
    // Generation needs the sound's details, not a two-word search query.
    const result = await generate({ name: input.name, prompt: input.description?.trim() || input.keywords,
      duration: input.duration ?? 4 });
    const output = result as any;
    if (!output?.asset?.size && !output?.assets?.some((asset: any) => asset?.size > 0)) throw new Error('AI生成未返回可用音效文件。');
    return { method: 'generate' as const, requestedMode: mode, status: 'completed' as const,
      fallback: Boolean(reason), ...(reason ? { fallbackReason: reason } : {}), result };
  };
  // Explicit generation never calls the search/keyword-translation API first.
  if (mode === 'generate') return generateOnce();
  let searchQuery: string | undefined;
  try {
    const prepared = await c.request('/api/ai/sfx-batch/search-query', { keywords: input.keywords,
      searchQuery: input.searchQuery || '', description: input.description || '' });
    searchQuery = prepared.searchQuery;
    const searchBatchId = input.searchBatchId || randomUUID();
    const result = await c.request('/api/ai/sfx-batch/search', { query: searchQuery, searchBatchId });
    if (!Array.isArray(result.items)) throw Object.assign(new Error('搜索服务未返回有效的候选列表。'), { code: 'SFX_SEARCH_UNAVAILABLE' });
    if (!result.items.length && result.sources?.length && result.sources.every((source: any) => source.unavailable)) {
      throw Object.assign(new Error('所有音效搜索来源暂不可用。'), { code: 'SFX_SEARCH_UNAVAILABLE' });
    }
    if (!result.items.length) return { method: 'search' as const, requestedMode: mode, status: 'no_matches' as const,
      fallback: false, searchQuery, searchBatchId, candidates: [], message: result.message || '未找到匹配音效，可调整关键词或明确要求 AI 生成。' };
    const candidates = [];
    let lastError: unknown;
    let blockingError: unknown;
    for (const candidate of result.items) {
      c.signal.throwIfAborted();
      try {
        const captured = await c.request('/api/ai/sfx-batch/capture', { id: candidate.id });
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
      fallback: false, searchQuery, searchBatchId, candidates };
    throw blockingError || lastError || Object.assign(new Error('候选音效均无法读取。'), { code: 'SFX_CAPTURE_FAILED' });
  } catch (error) {
    c.signal.throwIfAborted();
    if (mode !== 'auto' || !canFallBack(error)) throw error;
    const reason = error instanceof Error ? error.message : '音效搜索服务出错。';
    return { ...await generateOnce(reason), searchQuery };
  }
}
