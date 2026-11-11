/** Fixed public categories only: never expose provider text, credentials or prompts. */
export const ELEVENLABS_FAILURES = {
  ELEVENLABS_AUTH: 'ElevenLabs 接口密钥或服务权限不可用，请联系管理员。',
  ELEVENLABS_QUOTA: 'ElevenLabs 服务额度不足，请联系管理员补充额度。',
  ELEVENLABS_RATE_LIMIT: 'ElevenLabs 请求过于频繁，请稍后重试。',
  ELEVENLABS_INVALID_INPUT: 'ElevenLabs 无法处理本次音效参数，请检查描述和时长。',
  ELEVENLABS_POLICY: 'ElevenLabs 拒绝了本次音效描述，请调整描述。',
  ELEVENLABS_UPSTREAM: 'ElevenLabs 音效服务暂时失败，请稍后重试。',
} as const;

export async function soundEffectProviderError(response: Response) {
  const body = await response.json().catch(() => null);
  const type = typeof body?.detail?.status === 'string' ? body.detail.status.toLowerCase() : '';
  const quota = response.status === 402 || /quota|credit|payment/.test(type);
  const code = quota ? 'ELEVENLABS_QUOTA'
    : /policy|safety|content/.test(type) ? 'ELEVENLABS_POLICY'
    : [401, 403].includes(response.status) ? 'ELEVENLABS_AUTH'
    : response.status === 429 ? 'ELEVENLABS_RATE_LIMIT'
    : [400, 422].includes(response.status) ? 'ELEVENLABS_INVALID_INPUT' : 'ELEVENLABS_UPSTREAM';
  const status = quota ? 503 : code === 'ELEVENLABS_RATE_LIMIT' ? 429
    : ['ELEVENLABS_INVALID_INPUT', 'ELEVENLABS_POLICY'].includes(code) ? 422 : 502;
  return Object.assign(new Error(ELEVENLABS_FAILURES[code]), { code, status, upstreamStatus: response.status });
}

export function audioFailureDetails(error: unknown) {
  const value = error as { code?: unknown; status?: unknown; requestId?: unknown } | undefined;
  return {
    code: typeof value?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(value.code) ? value.code : undefined,
    status: Number.isInteger(value?.status) && Number(value?.status) >= 400 && Number(value?.status) <= 599 ? Number(value?.status) : undefined,
    requestId: typeof value?.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(value.requestId) ? value.requestId : undefined,
  };
}

export function audioFailureMessage(error: unknown, fallback: string) {
  const details = audioFailureDetails(error);
  const message = ELEVENLABS_FAILURES[details.code as keyof typeof ELEVENLABS_FAILURES] || fallback;
  return `${message}${details.requestId ? ` 请求编号：${details.requestId}` : ''}`;
}
