/** Keep storage failures distinct from missing source media and hide server paths. */
export function requirementsErrorText(error: unknown) {
  const detail = error && typeof error === 'object' ? error as { message?: string; name?: string; code?: string } : {};
  const message = typeof error === 'string' ? error : detail.message || '操作失败，请重试。';
  if (['NotFoundError', 'NotReadableError'].includes(detail.name || '')) return '请重新上传文件。';
  if (['EPERM', 'EACCES', 'EBUSY'].includes(detail.code || '') || /^(EPERM|EACCES|EBUSY):/.test(message)) {
    return '需求表任务保存失败，请稍后重试。';
  }
  if (detail.code === 'ENOSPC' || /^ENOSPC:/.test(message)) return '服务器存储空间不足，请清理后重试。';
  return message;
}
