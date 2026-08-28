import type { SpeechTranscriptionResult } from './elevenLabsService';
import { encodeWav } from './audioEncoderService';

export type SeedVoiceAudioEventType = 'laughter' | 'breath' | 'quick_breath' | 'cough' | 'sigh' | 'noise' | 'mn';

export interface SeedVoiceTimedSegment {
  id: string;
  start: number;
  end: number;
  sourceText: string;
  targetText: string;
}

export interface SeedVoiceAudioEvent {
  id: string;
  start: number;
  end: number;
  type: SeedVoiceAudioEventType;
  sourceText: string;
}

const SENTENCE_END_PATTERN = /[.!?。！？…]$/;

const normalizeAudioEvent = (value: string): SeedVoiceAudioEventType => {
  const event = value.toLowerCase().replace(/[\[\]()<>]/g, ' ').replace(/[_-]+/g, ' ').trim();
  if (/laugh|chuckle|giggle|笑声|大笑|轻笑|发笑/.test(event)) return 'laughter';
  if (/quick\s*breath|吸气|急促呼吸/.test(event)) return 'quick_breath';
  if (/sigh|叹气/.test(event)) return 'sigh';
  if (/breath|gasp|呼吸|喘气/.test(event)) return 'breath';
  if (/cough|throat\s*clear|咳嗽|清嗓/.test(event)) return 'cough';
  if (/^\s*(mn|hmm+|uh-?huh|嗯|哼|嗯哼)\s*$/.test(event)) return 'mn';
  return 'noise';
};

export function buildSeedVoiceTimeline(transcription: SpeechTranscriptionResult) {
  const words = (transcription.words || []).flatMap((word, index) => {
    const text = String(word.text ?? word.word ?? '');
    const start = Number(word.start);
    const end = Number(word.end);
    if (!text.trim() || !Number.isFinite(start) || !Number.isFinite(end)) return [];
    return [{
      index,
      text,
      start: Math.max(0, start),
      end: Math.max(start, end),
      isAudioEvent: word.type === 'audio_event',
      isSpacing: word.type === 'spacing',
    }];
  });

  const dedupeKeys = new Set<string>();
  const tokens = words.filter(word => {
    const key = `${word.isAudioEvent ? 'event' : word.isSpacing ? 'spacing' : 'word'}:${word.text.trim().toLowerCase()}:${word.start.toFixed(3)}:${word.end.toFixed(3)}`;
    if (dedupeKeys.has(key)) return false;
    dedupeKeys.add(key);
    return true;
  });

  if (tokens.length === 0) {
    const segments = (transcription.segments || []).flatMap((segment, index) => {
      const text = String(segment.text || '').trim();
      const start = Number(segment.start);
      const end = Number(segment.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end)) return [];
      return [{
        id: `segment-${index + 1}`,
        start: Math.max(0, start),
        end: Math.max(start, end),
        sourceText: text,
        targetText: '',
      } satisfies SeedVoiceTimedSegment];
    });
    return { segments, events: [] as SeedVoiceAudioEvent[] };
  }

  const segments: SeedVoiceTimedSegment[] = [];
  const events: SeedVoiceAudioEvent[] = [];
  let current: typeof tokens = [];
  const flush = () => {
    while (current[0]?.isSpacing) current.shift();
    while (current.at(-1)?.isSpacing) current.pop();
    if (current.length === 0) return;
    const sourceText = current.map(word => word.text).join('').replace(/\s+/g, ' ').trim();
    if (sourceText) {
      segments.push({
        id: `segment-${segments.length + 1}`,
        start: current[0].start,
        end: current[current.length - 1].end,
        sourceText,
        targetText: '',
      });
    }
    current = [];
  };

  tokens.forEach(word => {
    if (word.isAudioEvent) {
      flush();
      events.push({
        id: `event-${events.length + 1}`,
        start: word.start,
        end: word.end,
        type: normalizeAudioEvent(word.text),
        sourceText: word.text.trim(),
      });
      return;
    }
    if (word.isSpacing) {
      if (current.length > 0) current.push(word);
      return;
    }
    const previous = current.at(-1);
    const gap = previous ? word.start - previous.end : 0;
    const currentDuration = current.length > 0 ? word.end - current[0].start : 0;
    const shouldBreak = Boolean(previous) && (
      gap > 1.2
      || currentDuration > 10
      || (currentDuration > 5 && gap > 0.16 && SENTENCE_END_PATTERN.test(previous!.text.trim()))
    );
    if (shouldBreak) flush();
    current.push(word);
  });
  flush();

  const mergedEvents: SeedVoiceAudioEvent[] = [];
  events.sort((left, right) => left.start - right.start).forEach(event => {
    const previous = mergedEvents.at(-1);
    if (previous && previous.type === event.type && event.start - previous.end <= 0.35) {
      previous.end = Math.max(previous.end, event.end);
      previous.sourceText = `${previous.sourceText} ${event.sourceText}`.trim();
      return;
    }
    mergedEvents.push({ ...event });
  });

  return {
    segments: segments.map((segment, index) => ({ ...segment, id: `segment-${index + 1}` })),
    events: mergedEvents.map((event, index) => ({ ...event, id: `event-${index + 1}` })),
  };
}

export async function readMediaDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
      media.preload = 'metadata';
      media.onloadedmetadata = () => resolve(Number.isFinite(media.duration) ? media.duration : 0);
      media.onerror = () => reject(new Error('无法读取素材时长。'));
      media.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeAudioBlobs(blobs: Blob[]): Promise<AudioBuffer[]> {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) throw new Error('当前浏览器不支持音频时间线渲染。');
  const context = new AudioContextClass();
  try {
    return await Promise.all(blobs.map(async blob => context.decodeAudioData(await blob.arrayBuffer())));
  } finally {
    await context.close();
  }
}

export async function renderSeedVoiceDriver(
  segments: SeedVoiceTimedSegment[],
  audioBlobs: Blob[],
  totalDuration: number,
) {
  if (segments.length === 0 || segments.length !== audioBlobs.length) {
    throw new Error('台词时间线与生成音频数量不一致。');
  }
  const buffers = await decodeAudioBlobs(audioBlobs);
  const sampleRate = 24_000;
  const OfflineContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!OfflineContextClass) throw new Error('当前浏览器不支持离线音频时间线渲染。');
  const renderDuration = Math.max(totalDuration, segments.at(-1)?.end || 0, 0.5);
  const context = new OfflineContextClass(1, Math.ceil(renderDuration * sampleRate), sampleRate);
  let paceAdjustedCount = 0;
  let maxPlaybackRate = 1;

  buffers.forEach((buffer, index) => {
    const segment = segments[index];
    const nextStart = segments[index + 1]?.start ?? renderDuration;
    const availableDuration = Math.max(segment.end - segment.start, nextStart - segment.start - 0.05, 0.3);
    const requiredRate = buffer.duration / availableDuration;
    // Translated speech is often longer than the source language. Use the
    // following silence first, then fit the complete generated clip back into
    // its slot. This avoids aborting the whole conversion because of one long
    // translated line. The upper bound is a last-resort guard for pathological
    // sub-second slots; normal lines remain at or below a modest compression.
    const playbackRate = requiredRate > 1 ? Math.min(1.6, requiredRate) : 1;
    const renderedSegmentDuration = buffer.duration / playbackRate;
    if (playbackRate > 1.005) paceAdjustedCount += 1;
    maxPlaybackRate = Math.max(maxPlaybackRate, playbackRate);

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    source.connect(gain);
    gain.connect(context.destination);
    const start = Math.max(0, segment.start);
    const fadeDuration = Math.min(0.015, renderedSegmentDuration / 4);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(1, start + fadeDuration);
    gain.gain.setValueAtTime(1, Math.max(start + fadeDuration, start + renderedSegmentDuration - fadeDuration));
    gain.gain.linearRampToValueAtTime(0, start + renderedSegmentDuration);
    source.start(start);
  });

  const rendered = await context.startRendering();
  const blob = encodeWav(rendered, 16);
  return {
    file: new File([blob], 'seed-vc-timeline-driver.wav', { type: 'audio/wav' }),
    paceAdjustedCount,
    maxPlaybackRate,
    duration: renderDuration,
  };
}
