export const AUTO_SFX_TRACK_ID_PREFIX = 'sfx-auto-';

type TimedTrackClip = {
  trackId: string;
  startTime: number;
  duration: number;
};

export const getAutoSfxTrackId = (laneIndex: number) => (
  laneIndex === 0 ? 'sfx' : `${AUTO_SFX_TRACK_ID_PREFIX}${laneIndex + 1}`
);

export const isAutoSfxTrackId = (trackId: string) => (
  trackId === 'sfx' || trackId.startsWith(AUTO_SFX_TRACK_ID_PREFIX)
);

export const distributeOverlappingSfxClips = <T extends TimedTrackClip>(clips: T[]) => {
  const laneEndTimes: number[] = [];
  const assignedClips = clips
    .map((clip, sourceIndex) => ({ clip, sourceIndex }))
    .sort((a, b) => (
      a.clip.startTime - b.clip.startTime
      || b.clip.duration - a.clip.duration
      || a.sourceIndex - b.sourceIndex
    ))
    .map(({ clip, sourceIndex }) => {
      const startTime = Number.isFinite(clip.startTime) ? Math.max(0, clip.startTime) : 0;
      const duration = Number.isFinite(clip.duration) ? Math.max(0.001, clip.duration) : 0.001;
      let laneIndex = laneEndTimes.findIndex(endTime => (
        endTime <= startTime
      ));
      if (laneIndex < 0) laneIndex = laneEndTimes.length;
      laneEndTimes[laneIndex] = startTime + duration;
      return {
        clip: {
          ...clip,
          trackId: getAutoSfxTrackId(laneIndex),
        },
        sourceIndex,
      };
    })
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map(item => item.clip);

  return {
    clips: assignedClips,
    trackIds: laneEndTimes.map((_, laneIndex) => getAutoSfxTrackId(laneIndex)),
  };
};
