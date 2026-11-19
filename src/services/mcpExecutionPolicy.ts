import { audioFailureDetails } from './elevenLabsErrors';
import { safeRetryAfterMs } from './requestLimitErrors';

export const MCP_EXECUTION_POLICY_VERSION = '2026-11-19.1';

// Returned on every call, including to clients that never refresh inspect_tools.
// This describes the current server, not the version that ran a historical job.
export const MCP_EXECUTION_POLICY = {
  version: MCP_EXECUTION_POLICY_VERSION,
  scope: 'current_server_calls',
  soundEffects: {
    singleTool: 'produce_sound_effect', batchTool: 'produce_sfx_batch', defaultMode: 'auto',
    auto: 'server_search_then_generate_once_if_unavailable',
    searchBusy: 'server_queue_and_bounded_retry',
    explicitMode: 'preserve_search_or_generate',
    intent: 'interpret_description_with_one_alternate_query',
  },
  paidRetry: 'never_automatic',
  export: 'preview_first_export_on_user_request',
  ruleUpdates: 'server_behavior_applies_without_reconnecting',
} as const;

type Guidance = {
  action: 'continue' | 'poll_job' | 'preview' | 'review_batch' | 'clarify' | 'stop' | 'wait';
  repeatExecution: false;
  message: string;
  tool?: string;
  arguments?: { jobId: string };
  retryAfterMs?: number;
};
const guide = (action: Guidance['action'], message: string, extra: Partial<Guidance> = {}): Guidance =>
  ({ action, repeatExecution: false, message, ...extra });

export function mcpFailureGuidance(error: unknown): Guidance {
  const details = audioFailureDetails(error);
  if (details.code === 'COMPANY_POINTS_EXCEEDED') return guide('stop', '个人积分不足，请补充额度；不要重建任务或改用付费生成。');
  if (details.code === 'STORAGE_LIMIT_EXCEEDED') return guide('stop', '请先整理存储空间；不要重复制作。');
  if (details.status === 401 || details.status === 403 || details.code === 'ELEVENLABS_AUTH') return guide('stop', '请先解决登录或权限问题；不要切换付费功能重试。');
  if (details.code === 'ELEVENLABS_QUOTA') return guide('stop', '上游服务额度不足，请联系管理员；不要重复生成。');
  if (details.code === 'MCP_INVALID_ARGUMENTS' || details.status === 400 || details.status === 422) return guide('stop', '请检查本次参数或描述，调整前不要重复执行。');
  const retryAfterMs = safeRetryAfterMs((error as { retryAfterMs?: unknown })?.retryAfterMs);
  if (['API_RATE_LIMIT', 'REQUEST_CONCURRENCY_LIMIT', 'MCP_JOB_BUSY'].includes(details.code || '')) {
    return guide('wait', '平台暂时繁忙，请等待；不要重跑整个批次或切换付费生成。有后台任务时查询原任务。', retryAfterMs ? { retryAfterMs } : {});
  }
  if (details.status === 429) return guide('stop', '本次请求仍受限制，请报告具体错误码；不要自行循环重试或触发付费回退。');
  return guide('stop', '报告本次失败并保留已有文件；不要自动重建任务、重跑整个批次或重复付费生成。');
}

export function withMcpExecutionPolicy(tool: string, value: unknown): Record<string, any> & {
  executionPolicy: typeof MCP_EXECUTION_POLICY; serverGuidance: Guidance;
} {
  const result = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : { result: value };
  let guidance = guide('continue', '按本次实际返回结果继续；服务器执行当前策略，无需为更新规则重建任务。');
  let actualTool = tool, actualResult = result;
  if (['start_audio_job', 'get_audio_job', 'cancel_audio_job'].includes(tool)) {
    if (result.cancellationRequested || result.status === 'cancelled') guidance = guide('stop', '任务已请求停止或已取消，已有文件保留，不自动重启。');
    else if (result.status === 'running' && typeof result.id === 'string') {
      guidance = guide('poll_job', '继续查询同一任务，不要更换requestId重新执行。', { tool: 'get_audio_job', arguments: { jobId: result.id } });
    } else if (result.status === 'failed') guidance = mcpFailureGuidance(result.errorDetails);
    else if (result.status === 'completed' && result.result && typeof result.result === 'object' && !Array.isArray(result.result)) {
      actualTool = result.tool;
      actualResult = result.result || {};
    }
  }
  if (actualTool === 'produce_sfx_batch') {
    const items = Array.isArray(actualResult.items) ? actualResult.items : [];
    guidance = guide('review_batch', '先试听已完成音效，向用户确认需要补充描述的条目。后续只处理用户补充或确认的条目。');
    // Keep diagnostics and guidance next to each failed row, including saved jobs.
    actualResult = { ...actualResult, items: items.map((item: any) => item.status === 'failed'
      ? { ...item, serverGuidance: mcpFailureGuidance(item.errorDetails) }
      : item.status === 'needs_clarification' ? { ...item, serverGuidance: guide('clarify', item.question) } : item) };
  } else if (actualResult.status === 'needs_clarification') {
    guidance = guide('clarify', actualResult.question);
  } else if (actualResult.status === 'no_matches') {
    guidance = guide('stop', '本次只搜索未找到匹配音效，请调整关键词或询问用户；不自动切换AI生成。');
  } else if (actualResult.method === 'search' || actualResult.method === 'generate'
    || ['generate_speech', 'generate_speech_batch', 'generate_music', 'generate_sound_effect'].includes(actualTool)) {
    guidance = guide('preview', '使用本次返回的文件先试听，不要重复搜索或生成；用户要求导出后再混音或打包。');
  }
  const output = actualResult === result ? result : tool === actualTool ? actualResult : { ...result, result: actualResult };
  return { ...output, executionPolicy: MCP_EXECUTION_POLICY, serverGuidance: guidance };
}

export function mcpFailureResult(error: unknown, message: string) {
  const retryAfterMs = safeRetryAfterMs((error as { retryAfterMs?: unknown })?.retryAfterMs);
  return { error: message, errorDetails: { ...audioFailureDetails(error), ...(retryAfterMs ? { retryAfterMs } : {}) },
    executionPolicy: MCP_EXECUTION_POLICY, serverGuidance: mcpFailureGuidance(error) };
}
