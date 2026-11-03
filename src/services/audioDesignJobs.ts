import type { AudioDesignResult } from './aiService';

export const AUDIO_DESIGN_MODEL_TIMEOUT_MS = 90_000;
export const AUDIO_DESIGN_JOB_TIMEOUT_MS = 90_000;
export const AUDIO_DESIGN_RETENTION_MS = 60 * 60_000;
export const AUDIO_DESIGN_JOBS_ENDPOINT = '/api/ai/audio-design/jobs';

export interface AudioDesignJob {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  message: string;
  createdAt: number;
  result?: AudioDesignResult;
  error?: string;
}

/** Music needs whole-clip context; SFX keeps every prepared action frame. */
export function selectAudioDesignFrames<T>(frames: T[], duration: number, musicOnly: boolean): T[] {
  const limit = musicOnly ? duration <= 30 ? 4 : duration <= 120 ? 6 : 8 : frames.length;
  if (frames.length <= limit) return frames;
  return Array.from({ length: limit }, (_, index) => frames[Math.round(index * (frames.length - 1) / (limit - 1))]);
}
