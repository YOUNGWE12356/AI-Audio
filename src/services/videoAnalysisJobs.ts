export type VideoAnalysisTrack = 'bgm' | 'sfx' | 'dubbing';
export const VIDEO_ANALYSIS_LABELS: Record<VideoAnalysisTrack, string> = { bgm: '配乐', sfx: '音效', dubbing: '配音' };
export const VIDEO_ANALYSIS_ENDPOINT = '/api/video/analyze/jobs';
export const VIDEO_ANALYSIS_RETENTION_MS = 24 * 60 * 60_000;
export type VideoAnalysisInput = {
  fileName: string; videoDuration: number; tracks: VideoAnalysisTrack[]; requirements: string; sourceVersion: string;
};
export type VideoTrackProgress = {
  status: 'pending' | 'running' | 'completed' | 'failed'; completed: number; total: number;
  detail: string; clips?: any[];
};
export type VideoAnalysisJob = {
  id: string; requestId: string; status: 'running' | 'completed' | 'partial' | 'cancelled';
  createdAt: number; tracks: Partial<Record<VideoAnalysisTrack, VideoTrackProgress>>;
};

/** Ownership intervals do not overlap; context intervals do, preserving boundary actions. */
export function videoSfxSegments(duration: number) {
  return Array.from({ length: Math.ceil(duration / 10) }, (_, index) => ({
    start: index * 10, end: Math.min(duration, (index + 1) * 10),
    contextStart: Math.max(0, index * 10 - 1), contextEnd: Math.min(duration, (index + 1) * 10 + 1),
  }));
}

export function normalizeVideoPlan(clips: unknown, track: 'bgm' | 'sfx', duration: number, range?: { start: number; end: number }) {
  if (!Array.isArray(clips)) throw Object.assign(new Error('INVALID_VIDEO_PLAN'), { code: 'INVALID_VIDEO_PLAN' });
  const result: any[] = [];
  for (const clip of clips) {
    if (!clip || clip.trackId !== track || typeof clip.prompt !== 'string' || !clip.prompt.trim()
      || typeof clip.startTime !== 'number' || !Number.isFinite(clip.startTime)
      || typeof clip.duration !== 'number' || !Number.isFinite(clip.duration) || clip.duration <= 0) continue;
    if (track === 'sfx' && (clip.startTime < (range?.start ?? 0) || clip.startTime >= (range?.end ?? duration))) continue;
    const startTime = track === 'bgm' ? 0 : clip.startTime;
    if (startTime < 0 || startTime >= duration) continue;
    const length = track === 'bgm' ? duration : Math.min(clip.duration, duration - startTime);
    const name = String(clip.name || VIDEO_ANALYSIS_LABELS[track]).trim().slice(0, 100);
    // Independent simultaneous sources stay separate; only exact duplicate events collapse.
    if (result.some(item => item.name === name && item.prompt === clip.prompt && Math.abs(item.startTime - startTime) < 0.01)) continue;
    result.push({ id: `${track}-${result.length}`, trackId: track, name, prompt: clip.prompt.trim(), startTime, duration: length });
    if (track === 'bgm') break;
  }
  if (track === 'bgm' && !result.length) throw Object.assign(new Error('INVALID_VIDEO_PLAN'), { code: 'INVALID_VIDEO_PLAN' });
  return result;
}
