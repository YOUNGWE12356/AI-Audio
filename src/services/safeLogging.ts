/** Log identifiers and bounded error codes only. Never serialize provider errors or user content. */
export function logEvent(event: string, level: 'error' | 'warn' | 'info' = 'info', error?: unknown) {
  const code = (error as { code?: unknown } | undefined)?.code;
  console[level](JSON.stringify({ event, code: typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : undefined }));
}
