export type SeedVcModel = 'v2' | 'v1';

export interface SeedVcStatus {
  available: boolean;
  model: string;
  pythonFound: boolean;
  scriptFound: boolean;
  modelCached: boolean;
  gpu?: string;
  reason?: string;
}

export interface SeedVcConvertOptions {
  model: SeedVcModel;
  diffusionSteps: number;
  lengthAdjust: number;
  intelligibilityCfgRate: number;
  similarityCfgRate: number;
  convertStyle: boolean;
  temperature: number;
  topP: number;
  repetitionPenalty: number;
}

export interface SeedVcConvertResult {
  audioUrl: string;
  sourceDuration?: number;
  generatedDuration?: number;
  rawGeneratedDuration?: number;
  model: string;
  gpu?: string;
  timingMode: 'timeline';
  preservedEventCount?: number;
  timelineAligned?: boolean;
}

export interface SeedVcTimelineOptions {
  timelineSource?: File;
  targetDuration?: number;
  events?: Array<{
    start: number;
    end: number;
    type: string;
  }>;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((body as { error?: unknown }).error || `Seed-VC 请求失败 (${response.status})`));
  }
  return body as T;
}

export function getSeedVcStatus(): Promise<SeedVcStatus> {
  return requestJson<SeedVcStatus>('/api/ai/local/seed-vc/status');
}

export function convertWithSeedVc(
  sourceFile: File,
  referenceFile: File,
  options: SeedVcConvertOptions,
  timelineOptions: SeedVcTimelineOptions = {},
): Promise<SeedVcConvertResult> {
  const formData = new FormData();
  formData.append('source', sourceFile, sourceFile.name || 'source.wav');
  formData.append('reference', referenceFile, referenceFile.name || 'reference.wav');
  if (timelineOptions.timelineSource) {
    formData.append('timelineSource', timelineOptions.timelineSource, timelineOptions.timelineSource.name || 'timeline-source.wav');
  }
  if (typeof timelineOptions.targetDuration === 'number' && Number.isFinite(timelineOptions.targetDuration)) {
    formData.append('targetDuration', String(timelineOptions.targetDuration));
  }
  if (timelineOptions.events?.length) {
    formData.append('events', JSON.stringify(timelineOptions.events));
  }
  formData.append('model', options.model);
  formData.append('diffusionSteps', String(options.diffusionSteps));
  formData.append('lengthAdjust', String(options.lengthAdjust));
  formData.append('intelligibilityCfgRate', String(options.intelligibilityCfgRate));
  formData.append('similarityCfgRate', String(options.similarityCfgRate));
  formData.append('convertStyle', String(options.convertStyle));
  formData.append('temperature', String(options.temperature));
  formData.append('topP', String(options.topP));
  formData.append('repetitionPenalty', String(options.repetitionPenalty));
  return requestJson<SeedVcConvertResult>('/api/ai/local/seed-vc/convert', {
    method: 'POST',
    body: formData,
  });
}
