export type SeamlessExpressiveLanguage = 'eng' | 'spa' | 'fra' | 'deu' | 'cmn' | 'ita';

export interface SeamlessExpressiveLanguageOption {
  code: SeamlessExpressiveLanguage;
  label: string;
  experimental: boolean;
  recommendedDurationFactor: number;
}

export interface SeamlessExpressiveStatus {
  available: boolean;
  model: 'SeamlessExpressive';
  platform: string;
  runtimeSupported: boolean;
  pythonFound: boolean;
  repoFound: boolean;
  scriptFound: boolean;
  modelFilesFound: boolean;
  gpu?: string;
  supportedLanguages: SeamlessExpressiveLanguageOption[];
  license: string;
  gated: true;
  reason?: string;
}

export interface SeamlessExpressiveResult {
  audioUrl: string;
  sourceDuration?: number;
  generatedDuration?: number;
  targetLanguage: SeamlessExpressiveLanguage;
  translatedText?: string;
  durationFactor: number;
  model: string;
  gpu?: string;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((body as { error?: unknown }).error || `SeamlessExpressive 请求失败 (${response.status})`));
  }
  return body as T;
}

export function getSeamlessExpressiveStatus(): Promise<SeamlessExpressiveStatus> {
  return requestJson<SeamlessExpressiveStatus>('/api/ai/local/seamless-expressive/status');
}

export function convertWithSeamlessExpressive(
  source: File,
  targetLanguage: SeamlessExpressiveLanguage,
  durationFactor: number,
): Promise<SeamlessExpressiveResult> {
  const formData = new FormData();
  formData.append('source', source, source.name || 'source.wav');
  formData.append('targetLanguage', targetLanguage);
  formData.append('durationFactor', String(durationFactor));
  return requestJson<SeamlessExpressiveResult>('/api/ai/local/seamless-expressive/convert', {
    method: 'POST',
    body: formData,
  });
}
