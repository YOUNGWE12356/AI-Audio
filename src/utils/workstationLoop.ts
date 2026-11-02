/** Schedule on the audio clock ahead of the next boundary, independently of
 * animation frames. A delayed background timer resumes at the current phase. */
export function scheduleLoopPasses(now: number, nextStart: number, duration: number,
  schedule: (playhead: number, audioStart: number) => void) {
  if (!Number.isFinite(duration) || duration <= 0) return nextStart;
  if (nextStart < now) {
    const skipped = Math.floor((now - nextStart) / duration);
    const cycleStart = nextStart + skipped * duration;
    schedule(now - cycleStart, now);
    nextStart = cycleStart + duration;
  }
  // At most two upcoming passes, including for very short sound effects.
  const horizon = now + Math.min(0.5, duration * 2);
  while (nextStart <= horizon) {
    schedule(0, nextStart);
    nextStart += duration;
  }
  return nextStart;
}

export function loopPlayhead(time: number, duration: number) {
  return duration > 0 ? ((time % duration) + duration) % duration : 0;
}
