export const DETAILED_SFX_FRAME_INTERVAL_SECONDS = 1.5;
export const DETAILED_SFX_MIN_FRAMES = 8;
export const DETAILED_SFX_MAX_FRAMES = 32;
export const DETAILED_SFX_MAX_BASE64_LENGTH = 24_000_000;

const normalizeDuration = (durationSeconds: number) => (
  Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 30
);

export const getDetailedSfxFrameCount = (durationSeconds: number) => Math.min(
  DETAILED_SFX_MAX_FRAMES,
  Math.max(
    DETAILED_SFX_MIN_FRAMES,
    Math.ceil(normalizeDuration(durationSeconds) / DETAILED_SFX_FRAME_INTERVAL_SECONDS),
  ),
);

export const getDetailedSfxClipLimit = (durationSeconds: number) => getDetailedSfxFrameCount(durationSeconds);
