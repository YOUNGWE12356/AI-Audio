export interface PlatformHealth {
  ok: boolean;
  runtime: 'server';
  services: {
    gemini: boolean;
    gptText: boolean;
    elevenLabs: boolean;
  };
  timestamp: string;
}

export async function fetchPlatformHealth(signal?: AbortSignal): Promise<PlatformHealth> {
  const response = await fetch('/api/health', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`服务状态检查失败 (${response.status})`);
  }

  return response.json();
}
