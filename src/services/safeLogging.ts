/** Log identifiers and bounded error codes only. Never serialize provider errors or user content. */
export function logEvent(event: string, level: 'error' | 'warn' | 'info' = 'info', error?: unknown) {
  const code = (error as { code?: unknown } | undefined)?.code;
  console[level](JSON.stringify({ event, code: typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : undefined }));
}

/** Startup diagnostics are server-only. Keep credentials out of messages and stacks. */
export function logStartupError(error: unknown, env: NodeJS.ProcessEnv = process.env) {
  const secrets = Object.entries(env)
    .filter(([key, value]) => value && /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH_USERS_JSON/i.test(key))
    .map(([, value]) => value!)
    .sort((a, b) => b.length - a.length);
  const redact = (value: string) => {
    for (const secret of secrets) value = value.split(secret).join('[REDACTED]');
    return value.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@').slice(0, 12_000);
  };
  console.error(JSON.stringify({
    event: 'server.startup.failed',
    message: redact(error instanceof Error ? error.message : String(error)),
    stack: error instanceof Error && error.stack ? redact(error.stack) : undefined,
  }));
}
