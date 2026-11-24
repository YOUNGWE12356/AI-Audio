/** Safe, public request errors. Unknown 429s must not trigger paid fallback. */
export const REQUEST_LIMIT_MESSAGES: Record<string, string> = {
  SFX_NAMING_INVALID_INPUT: '命名文件列表无效，请重新选择文件。',
  SFX_NAMING_INVALID_RESULT: 'AI 未返回合规的命名建议。原名已保留，可补充文件名描述后重试。',
  SFX_NAMING_TIMEOUT: 'AI 命名等待超时。原名已保留，可重试未完成项。',
  SFX_NAMING_BUSY: 'AI 命名服务繁忙，请稍后重试。',
  SFX_NAMING_UNAVAILABLE: 'AI 命名服务暂不可用，请联系管理员检查 AI 网关。',
  SFX_NAMING_UPSTREAM: 'AI 命名服务未能返回结果。可重试，或保留原名入库。',
  COMPANY_POINTS_EXCEEDED: '个人积分不足，请联系管理员追加额度。',
  API_RATE_LIMIT: '平台请求过于频繁，请稍后重试。',
  REQUEST_CONCURRENCY_LIMIT: '平台处理任务较多，请等待当前任务完成。',
  STORAGE_LIMIT_EXCEEDED: '文件存储空间已达上限，请先整理文件。',
  SFX_QUERY_BUSY: '英文搜索词提炼繁忙，正在等待可用处理位置。',
  SFX_SEARCH_BUSY: '音效搜索繁忙，正在等待前面的搜索完成。',
  SFX_SEARCH_CAPACITY: '暂存的音效候选较多，请稍后重试。',
  SFX_CAPTURE_BUSY: '音效试听转换繁忙，请稍后重试。',
  SFX_PREVIEW_EXPIRED: '候选试听已过期，请重新搜索这条需求。',
  SFX_PREVIEW_UNAVAILABLE: '此来源的公开试听暂时无法读取，请尝试其他候选。',
  SFX_SOURCES_UNAVAILABLE: '音效来源暂时无法访问，请稍后重试。',
};
export const requestLimitMessage = (code: unknown, fallback: string) =>
  typeof code === 'string' && Object.hasOwn(REQUEST_LIMIT_MESSAGES, code) ? REQUEST_LIMIT_MESSAGES[code] : fallback;
export const safeRetryAfterMs = (value: unknown): number | undefined =>
  Number.isInteger(value) && Number(value) > 0 && Number(value) <= 60_000 ? Number(value) : undefined;
