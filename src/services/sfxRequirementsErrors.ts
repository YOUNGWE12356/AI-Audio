/** Keep storage failures distinct from missing source media and hide server paths. */
export function publicRequirementsFailure(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const invalidUcs = /^AI 未能为第 ((?:\d{1,3}、){0,99}\d{1,3}) 行选出有效 UCS 8\.2\.1 分类，请调整音效描述后重试。$/.exec(value);
  if (invalidUcs) return `第 ${invalidUcs[1]} 条需求的声音分类暂时无法确认，请补充音效描述后重试。`;
  const missing = /^原表(\d{1,3})条中仍有(\d{1,3})条音效未完整整理（[^\r\n]{1,2000}），未导入不完整清单，请重试。$/.exec(value);
  if (missing) return `原表${missing[1]}条中仍有${missing[2]}条需求未完整返回，已停止导入以避免漏项。请重试或补充需求描述。`;
  if (/^原表\d{1,3}条中仍有\d{1,3}条需求未完整返回，已停止导入以避免漏项。请重试或补充需求描述。$/.test(value)) return value;
  // Only fixed application-authored text and bounded numeric row lists may pass.
  if (/^第 (?:\d{1,3}、){0,99}\d{1,3} 条需求的声音分类暂时无法确认，请补充音效描述后重试。$/.test(value)) return value;
  if (['请重新上传文件。', '需求表任务保存失败，请稍后重试。', '服务器存储空间不足，请清理后重试。',
    '服务器重启中断了需求表生成，请重新生成。', '需求表生成超过后台等待上限，请缩小需求范围后重试。',
    'AI 返回的需求表结果过长或格式不完整，请减少需求数量后重试。'].includes(value)) return value;
  return null;
}

export function requirementsErrorText(error: unknown) {
  const detail = error && typeof error === 'object' ? error as { message?: string; name?: string; code?: string } : {};
  const message = typeof error === 'string' ? error : detail.message || '操作失败，请重试。';
  const known = publicRequirementsFailure(message);
  if (known) return known;
  if (['NotFoundError', 'NotReadableError'].includes(detail.name || '')) return '请重新上传文件。';
  if (['EPERM', 'EACCES', 'EBUSY'].includes(detail.code || '') || /^(EPERM|EACCES|EBUSY):/.test(message)) {
    return '需求表任务保存失败，请稍后重试。';
  }
  if (detail.code === 'ENOSPC' || /^ENOSPC:/.test(message)) return '服务器存储空间不足，请清理后重试。';
  return message;
}
