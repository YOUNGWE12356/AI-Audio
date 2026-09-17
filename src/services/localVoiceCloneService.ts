import type { TranslateDubbingResult } from './elevenLabsService';

export type LocalVoiceCloneEngine = 'chatterbox' | 'cosyvoice3';

export interface LocalVoiceCloneEngineStatus {
  available: boolean;
  model: string;
  gpu?: string;
  modelCached: boolean;
  supportedLanguages: Record<string, string>;
  reason?: string;
}

export interface LocalVoiceCloneStatus {
  defaultEngine: LocalVoiceCloneEngine;
  engines: Record<LocalVoiceCloneEngine, LocalVoiceCloneEngineStatus>;
}

export interface LocalVoiceCloneOptions {
  engine: LocalVoiceCloneEngine;
  language: string;
  text: string;
  referenceStart: number;
  referenceDuration?: number;
  sourceDuration?: number;
  exaggeration: number;
  cfgWeight: number;
  temperature: number;
  performance: 'natural' | 'expressive' | 'stable';
}

export interface LocalVoiceCloneResult extends TranslateDubbingResult {
  dubbingModel: 'local_chatterbox' | 'local_cosyvoice3';
  outputFormat: 'wav';
  language: string;
  model: string;
  gpu?: string;
  referenceStart: number;
  referenceDuration: number;
}

export interface LocalMultiSpeakerProfile {
  id: string;
  referenceStart: number;
  referenceEnd: number;
  referenceRanges?: Array<{ start: number; end: number }>;
}

export interface LocalMultiSpeakerSegment {
  id: string;
  speakerId: string;
  start: number;
  end: number;
  sourceText: string;
  targetText: string;
}

export type LocalMultiSpeakerAudioEventType =
  | 'laughter'
  | 'breath'
  | 'quick_breath'
  | 'cough'
  | 'sigh'
  | 'noise'
  | 'mn';

export interface LocalMultiSpeakerAudioEvent {
  id: string;
  speakerId: string;
  start: number;
  end: number;
  type: LocalMultiSpeakerAudioEventType;
  sourceText: string;
}

export interface LocalMultiSpeakerCloneOptions {
  engine: LocalVoiceCloneEngine;
  dialogueMode?: 'single' | 'multi';
  language: string;
  sourceDuration?: number;
  profiles: LocalMultiSpeakerProfile[];
  segments: LocalMultiSpeakerSegment[];
  events: LocalMultiSpeakerAudioEvent[];
  versions: Array<{
    id: 'A' | 'B';
    performance: 'natural' | 'expressive' | 'stable';
    exaggeration: number;
    cfgWeight: number;
    temperature: number;
  }>;
}

export interface LocalMultiSpeakerCloneResult {
  options: Array<{
    id: 'A' | 'B';
    data: TranslateDubbingResult;
    performance: 'natural' | 'expressive' | 'stable';
    speakerSimilarity?: number;
  }>;
  referenceDurations: Record<string, number>;
  timeline: {
    shiftedClipCount: number;
    maxShiftSeconds: number;
    paceAdjustedClipCount: number;
    maxPaceAdjustment: number;
    preservedEventCount: number;
    droppedEventCount: number;
    outputDuration: number;
    versions: Array<{
      id: 'A' | 'B';
      shiftedClipCount: number;
      maxShiftSeconds: number;
      paceAdjustedClipCount: number;
      maxPaceAdjustment: number;
      preservedEventCount: number;
      droppedEventCount: number;
      outputDuration: number;
    }>;
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12 * 60 * 1000);
  try {
    const response = await fetch(path, { ...init, signal: init?.signal || controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(body.error || `本地声音克隆请求失败 (${response.status})`));
    }
    return body as T;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('声音转换等待时间过长，服务可能仍在处理；请检查服务器状态后重试。');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function getLocalVoiceCloneStatus(): Promise<LocalVoiceCloneStatus> {
  return requestJson<LocalVoiceCloneStatus>('/api/ai/local/voice-clone/status');
}

export function cloneVoiceLocally(
  referenceFile: File,
  options: LocalVoiceCloneOptions,
): Promise<LocalVoiceCloneResult> {
  const formData = new FormData();
  formData.append('reference', referenceFile, referenceFile.name || 'reference.wav');
  formData.append('engine', options.engine);
  formData.append('language', options.language);
  formData.append('text', options.text);
  formData.append('referenceStart', String(options.referenceStart));
  if (typeof options.referenceDuration === 'number' && Number.isFinite(options.referenceDuration)) {
    formData.append('referenceDuration', String(options.referenceDuration));
  }
  if (typeof options.sourceDuration === 'number' && Number.isFinite(options.sourceDuration)) {
    formData.append('sourceDuration', String(options.sourceDuration));
  }
  formData.append('exaggeration', String(options.exaggeration));
  formData.append('cfgWeight', String(options.cfgWeight));
  formData.append('temperature', String(options.temperature));
  formData.append('performance', options.performance);

  return requestJson<LocalVoiceCloneResult>('/api/ai/local/voice-clone', {
    method: 'POST',
    body: formData,
  });
}

export function cloneMultiSpeakerVoicesLocally(
  sourceFile: File,
  options: LocalMultiSpeakerCloneOptions,
): Promise<LocalMultiSpeakerCloneResult> {
  const formData = new FormData();
  formData.append('source', sourceFile, sourceFile.name || 'source.wav');
  formData.append('payload', JSON.stringify(options));
  return requestJson<LocalMultiSpeakerCloneResult>('/api/ai/local/voice-clone/batch', {
    method: 'POST',
    body: formData,
  });
}
