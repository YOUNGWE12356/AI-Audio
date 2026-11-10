import type { VideoAnalysisTrack } from './videoAnalysisJobs';
export type VideoGenerationProgress = Partial<Record<VideoAnalysisTrack, { total: number; completed: number; failed: number; running: boolean }>>;

/** One worker per track, at most two tracks at once. A failed clip never stops another track. */
export async function generateVideoTracks<T>(options: {
  clips: T[]; track: (clip: T) => VideoAnalysisTrack | undefined;
  generate: (clip: T) => Promise<boolean>; progress: (value: VideoGenerationProgress) => void; signal?: AbortSignal;
}) {
  const groups = (['bgm', 'sfx', 'dubbing'] as VideoAnalysisTrack[]).map(track => ({ track, clips: options.clips.filter(clip => options.track(clip) === track) })).filter(group => group.clips.length);
  const state: VideoGenerationProgress = Object.fromEntries(groups.map(group => [group.track, { total: group.clips.length, completed: 0, failed: 0, running: false }]));
  const emit = () => options.progress(Object.fromEntries(Object.entries(state).map(([key, value]) => [key, { ...value }])));
  let cursor = 0;
  const worker = async () => {
    while (cursor < groups.length) {
      options.signal?.throwIfAborted();
      const group = groups[cursor++], progress = state[group.track]!;
      progress.running = true; emit();
      try {
        for (const clip of group.clips) {
          options.signal?.throwIfAborted();
          let success = false;
          try { success = await options.generate(clip); }
          catch { options.signal?.throwIfAborted(); }
          if (success) progress.completed++; else progress.failed++;
          emit();
        }
      } finally { progress.running = false; emit(); }
    }
  };
  const outcomes = await Promise.allSettled([worker(), worker()]);
  const failure = outcomes.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return state;
}
