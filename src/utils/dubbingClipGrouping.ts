export const DUBBING_GROUP_MAX_GAP_SECONDS = 1.25;
export const DUBBING_GROUP_MAX_SPAN_SECONDS = 32;
export const DUBBING_GROUP_MAX_TEXT_LENGTH = 600;

export interface DubbingSubtitleCue {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  speaker?: string;
}

type DubbingClipLike = Record<string, any> & {
  trackId: string;
  name?: string;
  prompt?: string;
  text: string;
  startTime: number;
  duration: number;
  subtitleStartTime: number;
  subtitleEndTime: number;
  speaker?: string;
  subtitleId?: string;
  lipStartTime?: number;
  lipEndTime?: number;
  lipSyncConfidence?: number;
  timingSource?: string;
  subtitleCues?: DubbingSubtitleCue[];
};

const normalizeSpeaker = (value: unknown) => String(value || 'unknown').trim().toLowerCase() || 'unknown';

const normalizeComparableText = (value: unknown) => String(value || '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[\s\u3000，。！？、…,.!?;；:："'“”‘’]/g, '');

const speakersAreCompatible = (left: unknown, right: unknown) => {
  const leftSpeaker = normalizeSpeaker(left);
  const rightSpeaker = normalizeSpeaker(right);
  return leftSpeaker === rightSpeaker || leftSpeaker === 'unknown' || rightSpeaker === 'unknown';
};

const joinDubbingText = (leftValue: unknown, rightValue: unknown) => {
  const left = String(leftValue || '').trim();
  const right = String(rightValue || '').trim();
  if (!left) return right;
  if (!right) return left;

  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);
  if (normalizedLeft === normalizedRight) return right.length > left.length ? right : left;
  if (normalizedRight.startsWith(normalizedLeft)) return right;
  if (normalizedLeft.endsWith(normalizedRight)) return left;

  const hasClosingPunctuation = /[。！？!?；;：:，,\.…]$/.test(left);
  const hasCjkText = /[\u3400-\u9fff]/.test(`${left}${right}`);
  const separator = hasClosingPunctuation ? '\n' : hasCjkText ? '，\n' : '.\n';
  return `${left}${separator}${right}`;
};

const toSubtitleCue = (clip: DubbingClipLike, index: number): DubbingSubtitleCue => ({
  id: String(clip.subtitleId || `subtitle-${index + 1}`),
  text: String(clip.text || '').trim(),
  startTime: Number(clip.subtitleStartTime),
  endTime: Number(clip.subtitleEndTime),
  speaker: String(clip.speaker || 'unknown').trim() || 'unknown',
});

export const groupContinuousDubbingClips = <T extends DubbingClipLike>(clips: T[]): T[] => {
  const grouped: T[] = [];

  clips.forEach((clip, index) => {
    const currentCue = toSubtitleCue(clip, index);
    const previous = grouped[grouped.length - 1];
    if (!previous) {
      grouped.push({ ...clip, subtitleCues: clip.subtitleCues?.length ? clip.subtitleCues : [currentCue] });
      return;
    }

    const gap = currentCue.startTime - Number(previous.subtitleEndTime);
    const groupedSpan = currentCue.endTime - Number(previous.subtitleStartTime);
    const combinedText = joinDubbingText(previous.text, clip.text);
    const shouldMerge = gap <= DUBBING_GROUP_MAX_GAP_SECONDS
      && gap >= -0.25
      && groupedSpan <= DUBBING_GROUP_MAX_SPAN_SECONDS
      && combinedText.length <= DUBBING_GROUP_MAX_TEXT_LENGTH
      && speakersAreCompatible(previous.speaker, clip.speaker);

    if (!shouldMerge) {
      grouped.push({ ...clip, subtitleCues: clip.subtitleCues?.length ? clip.subtitleCues : [currentCue] });
      return;
    }

    const previousCues = previous.subtitleCues?.length
      ? previous.subtitleCues
      : [toSubtitleCue(previous, Math.max(0, index - 1))];
    const nextCues = clip.subtitleCues?.length ? clip.subtitleCues : [currentCue];
    const cueCount = previousCues.length + nextCues.length;
    const previousSpeaker = normalizeSpeaker(previous.speaker);
    const currentSpeaker = normalizeSpeaker(clip.speaker);
    previous.text = combinedText;
    previous.name = `连续配音 ${grouped.length}（${cueCount}句）`;
    previous.prompt = `${String(previous.prompt || '').trim()} 连续自然地朗读整组台词，保留句间短停顿和原始语气，不要逐句重新起音。`.trim();
    previous.subtitleId = `${String(previousCues[0]?.id || previous.subtitleId || 'subtitle')}-group`;
    previous.subtitleEndTime = Math.max(Number(previous.subtitleEndTime), currentCue.endTime);
    previous.startTime = Number(previous.subtitleStartTime);
    previous.duration = Number((Number(previous.subtitleEndTime) - Number(previous.subtitleStartTime)).toFixed(3));
    previous.lipStartTime = Math.min(
      Number.isFinite(Number(previous.lipStartTime)) ? Number(previous.lipStartTime) : Number(previous.subtitleStartTime),
      Number.isFinite(Number(clip.lipStartTime)) ? Number(clip.lipStartTime) : currentCue.startTime,
    );
    previous.lipEndTime = Math.max(
      Number.isFinite(Number(previous.lipEndTime)) ? Number(previous.lipEndTime) : Number(previous.subtitleEndTime),
      Number.isFinite(Number(clip.lipEndTime)) ? Number(clip.lipEndTime) : currentCue.endTime,
    );
    previous.lipSyncConfidence = Math.max(Number(previous.lipSyncConfidence) || 0, Number(clip.lipSyncConfidence) || 0);
    previous.timingSource = 'grouped-continuous-subtitles';
    previous.speaker = previousSpeaker === 'unknown' && currentSpeaker !== 'unknown'
      ? String(clip.speaker || 'unknown').trim()
      : previous.speaker;
    previous.subtitleCues = [...previousCues, ...nextCues];
  });

  return grouped;
};
