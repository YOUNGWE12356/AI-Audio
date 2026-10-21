import { generateAiContent, SchemaType, ThinkingLevel } from './aiGateway';
import { setClientIdentityHeader } from './clientIdentity';
import { normalizeAudioDesignSfxSchemes } from '../utils/audioDesignNaming';
import { AUDIO_METRICS_MIME, AUDIO_EVIDENCE_RULES, validateAudioEvidence, type AudioMetricEvidence } from '../utils/audioEvidence';
import { isBgmImportFileName, normalizeRequirementEngineeringNames, normalizeUcsImportFileName, normalizeUcsRequirementItems, UCS_CATALOG_PROMPT, UCS_CATALOG_VERSION } from './ucsNaming';

const isBrowser = typeof window !== 'undefined';

const createAsciiVideoUploadName = (fileName: string, mimeType = '') => {
  const allowedExtensions = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.mpeg', '.mpg', '.wmv']);
  const extensionMatch = fileName.toLowerCase().match(/(\.[a-z0-9]{1,10})$/);
  const requestedExtension = extensionMatch?.[1] || '';
  const mimeFallbacks: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/x-m4v': '.m4v',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'video/x-matroska': '.mkv',
    'video/x-msvideo': '.avi',
    'video/mpeg': '.mpeg',
    'video/x-ms-wmv': '.wmv',
  };
  const extension = allowedExtensions.has(requestedExtension)
    ? requestedExtension
    : mimeFallbacks[mimeType.toLowerCase()] || '.mp4';
  const nonce = Math.random().toString(36).slice(2, 10);
  return `video_${Date.now()}_${nonce}${extension}`;
};

async function postJson<T>(
  path: string,
  body: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const handleParentAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) handleParentAbort();
  options.signal?.addEventListener('abort', handleParentAbort, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || `AI 服务请求失败 (${response.status})`);
    }

    return response.json();
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutSeconds = Math.max(1, Math.round(timeoutMs / 1000));
      throw new Error(timedOut ? `AI 分析超过 ${timeoutSeconds} 秒，请减少素材后重试。` : '已取消本次分析。');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', handleParentAbort);
  }
}

const getAI = () => ({ Type: SchemaType, ThinkingLevel });

export interface AudioDesignResult {
  audioAnalysisSources?: Array<{ sourceName: string; sourceDuration: number; analyzedSeconds: number; method: 'local-metrics-gpt'; model: string }>;
  sfxAnalysis: {
    summary: string;
    keyElements: string[];
    pacing: string;
  };
  musicAnalysis: {
    mood: string;
    rhythm: string;
    suggestedInstruments: string[];
    emotionalCurve: string;
  };
  videoMotionTempo?: {
    detected: boolean;
    primaryBpm: number;
    bpmRangeMin: number;
    bpmRangeMax: number;
    alternateBpms: number[];
    confidence: string;
    motionPattern: string;
    analysisBasis: string;
    syncGuidance: string;
    segments: {
      timecode: string;
      motion: string;
      bpm: number;
      confidence: string;
    }[];
  };
  sfxSchemes: {
    title: string;
    items: {
      name: string;
      description: string;
      scene: string;
      logic: string;
    }[];
  }[];
  bgmRecommendations: {
    style: string;
    instrumentation: string;
    visualRationale?: string;
    sunoPrompt: {
      chinese: string;
      english: string;
      bpm: string;
      key: string;
      structure: string;
      dynamics: string;
    };
    vocalInfo?: {
      type: string;
      gender: string;
      age: string;
      characteristics: string;
      mood: string;
      singingStyle: string;
    };
    lyrics?: {
      content: { section: string; text: string }[];
    };
    timelineDesign?: {
      timecode: string;
      instruments: string;
      emotion: string;
      description: string;
    }[];
  }[];
}

export interface AudioDesignScope {
  music: boolean;
  sfx: boolean;
}

interface RawAudioDesignTimelineItem {
  timecode: string;
  instruments: string;
  instrumentsEnglish: string;
  emotion: string;
  emotionEnglish: string;
  description: string;
  descriptionEnglish: string;
}

interface RawAudioDesignBgmRecommendation {
  style: string;
  styleEnglish: string;
  sunoDirection: {
    use: string;
    useEnglish: string;
    moodEnergy: string;
    moodEnergyEnglish: string;
    instrumentRoles: string;
    instrumentRolesEnglish: string;
    tempoFeel: string;
    tempoFeelEnglish: string;
    melodyMix: string;
    melodyMixEnglish: string;
    formEnding: string;
    formEndingEnglish: string;
    exclude: string;
    excludeEnglish: string;
  };
  instrumentation?: string;
  instrumentationEnglish?: string;
  visualRationale?: string;
  bpm: number;
  key: string;
  vocalDirection: string;
  vocalDirectionEnglish: string;
  vocalInfo?: AudioDesignResult['bgmRecommendations'][number]['vocalInfo'];
  lyrics?: AudioDesignResult['bgmRecommendations'][number]['lyrics'];
  timelineDesign?: RawAudioDesignTimelineItem[];
}

type RawAudioDesignResult = Partial<Omit<AudioDesignResult, 'bgmRecommendations'>> & {
  bgmRecommendations?: RawAudioDesignBgmRecommendation[];
};

const cleanText = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const cleanEnglishText = (value: unknown) => cleanText(value)
  .replace(/\s+/g, ' ')
  .trim();

const containsHan = (value: string) => /[\u3400-\u9fff\uf900-\ufaff]/.test(value);
const containsNonEnglishContent = (value: string) => /[\u3400-\u9fff\uf900-\ufaff，；：。！？、]/.test(value);
const containsVocalContentChinese = (value: string) => /(人声|女声|男声|童声|女高音|男高音|女低音|男低音|主唱|歌手|歌声|声乐|清唱|无伴奏演唱|吟唱|哼唱|合唱|呼喊|歌唱|歌词|说唱|口白|念白|旁白)/.test(value);
const containsVocalContentEnglish = (value: string) => /\b(vocals?|voices?|choirs?|chants?|chanting|singers?|singing|humming|hums?|lyrics?|rapping|rap vocals?|countertenor|a cappella|acapella|vocalise|spoken[- ]word|narration|narrator)\b|\bsoprano\b(?!\s+sax)|\balto\b(?!\s+sax)|\btenor\b(?!\s+sax)|\bbaritone\b(?!\s+(?:sax|horn))/i.test(value);
const isStandardMusicKey = (value: string) => /^[A-G](?:#|b)?\s+(?:major|minor)$/i.test(value);

const uniqueTexts = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const SUNO_STYLE_WORD_LIMIT = 12;
const SUNO_VOCAL_WORD_LIMIT = 14;
const SUNO_STYLE_CHAR_LIMIT = 32;
const SUNO_VOCAL_CHAR_LIMIT = 32;

const containsTimedCue = (value: string) => (
  /(?<![\d:])(?:\d{1,2}:)?\d{1,2}(?:\.\d+)?\s*(?:-|–|—|~|至|到|to)\s*(?:\d{1,2}:)?\d{1,2}(?:\.\d+)?\s*(?:s|秒|secs?|seconds?)?(?!\d)(?!\s*BPM\b)/i.test(value)
  || /(?<!\d)\d{1,2}:\d{2}(?:\.\d+)?(?!\d)/.test(value)
  || /\b(?:timecode|at\s+\d+(?:\.\d+)?\s*(?:s|secs?|seconds?))\b|(?:时间码|第\s*[一二三四五六七八九十\d]+\s*段)/i.test(value)
);

export const containsTimelineReference = (value: string) => (
  containsTimedCue(value)
  || /\b(?:timeline)\b|(?:时间线)/i.test(value)
  || /\b(?:intro|verse|chorus|bridge|outro|starting\s+with|followed\s+by|ending\s+with|then|later|enters?)\b|(?:前奏|主歌|副歌|桥段|尾奏|开场|中段|后段|随后|然后|最后|结尾|收尾|进入)/i.test(value)
  || /(?:→|->)/.test(value)
);

const limitWords = (value: string, maximum: number) => value
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, maximum)
  .join(' ');

const limitCharacters = (value: string, maximum: number) => Array.from(value).slice(0, maximum).join('').trim();

const selectWholeTrackText = (
  value: string,
  fallback: string,
  separator: RegExp,
  limit: number,
  limiter: (text: string, maximum: number) => string,
) => {
  const safeText = value
    .split(separator)
    .map(part => part.trim())
    .find(part => part && !containsTimelineReference(part));
  return limiter(safeText || fallback, limit);
};

const normalizeBpm = (value: unknown) => {
  const parsed = Number.parseInt(String(value), 10);
  return String(Number.isFinite(parsed) ? Math.min(220, Math.max(40, parsed)) : 90);
};

export const formatSunoBpmRange = (bpm: string): string => {
  const roundedCenter = Math.round(Number(bpm) / 5) * 5;
  const lower = Math.max(40, Math.min(210, roundedCenter - 5));
  return `${lower}-${lower + 10} BPM`;
};

const normalizeAudioDesignScope = (scope?: Partial<AudioDesignScope>): AudioDesignScope => {
  if (!scope) return { music: true, sfx: true };
  const normalized = {
    music: scope.music === true,
    sfx: scope.sfx === true,
  };
  return normalized.music || normalized.sfx ? normalized : { music: true, sfx: false };
};

const normalizeMotionBpm = (value: unknown) => {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.min(300, Math.max(30, parsed)) : 0;
};

const normalizeVideoMotionTempo = (
  value: AudioDesignResult['videoMotionTempo'],
): AudioDesignResult['videoMotionTempo'] => {
  if (!value) return undefined;
  const primaryBpm = value.detected ? normalizeMotionBpm(value.primaryBpm) : 0;
  const detected = Boolean(value.detected && primaryBpm);
  const rangeValues = detected
    ? [normalizeMotionBpm(value.bpmRangeMin), normalizeMotionBpm(value.bpmRangeMax)].filter(Boolean)
    : [];
  const rangeMin = rangeValues.length > 0 ? Math.min(...rangeValues) : primaryBpm;
  const rangeMax = rangeValues.length > 0 ? Math.max(...rangeValues) : primaryBpm;
  const alternateBpms = Array.from(new Set(
    (Array.isArray(value.alternateBpms) ? value.alternateBpms : [])
      .map(normalizeMotionBpm)
      .filter(bpm => bpm > 0 && bpm !== primaryBpm),
  )).slice(0, 3);

  return {
    detected,
    primaryBpm,
    bpmRangeMin: rangeMin,
    bpmRangeMax: rangeMax,
    alternateBpms,
    confidence: cleanText(value.confidence) || '低',
    motionPattern: cleanText(value.motionPattern) || '未识别到稳定的周期动作',
    analysisBasis: cleanText(value.analysisBasis) || '画面中的重复动作不足，无法稳定估算。',
    syncGuidance: cleanText(value.syncGuidance) || '建议手动选择关键动作点后再确认卡点速度。',
    segments: (Array.isArray(value.segments) ? value.segments : [])
      .map(segment => ({
        timecode: cleanText(segment.timecode),
        motion: cleanText(segment.motion),
        bpm: normalizeMotionBpm(segment.bpm),
        confidence: cleanText(segment.confidence) || '低',
      }))
      .filter(segment => segment.timecode && segment.motion && segment.bpm > 0)
      .slice(0, 8),
  };
};

/** Suno 词概括整曲，不复制视频剪辑时间码。 */
export const materializeAudioDesignResult = (
  raw: RawAudioDesignResult,
  isInstrumental: boolean,
  includeTimeline: boolean,
  scope: AudioDesignScope,
): AudioDesignResult => {
  if (scope.music && (!Array.isArray(raw.bgmRecommendations) || raw.bgmRecommendations.length === 0)) {
    throw new Error('AI 未生成有效的配乐方案，请重试。');
  }
  if (scope.sfx && (!raw.sfxAnalysis || !Array.isArray(raw.sfxSchemes) || raw.sfxSchemes.length === 0)) {
    throw new Error('AI 未生成有效的音效设计方案，请重试。');
  }

  const bgmRecommendations = (scope.music ? raw.bgmRecommendations || [] : []).map((plan, planIndex) => {
    const style = cleanText(plan.style);
    const styleEnglish = cleanEnglishText(plan.styleEnglish);
    const key = cleanEnglishText(plan.key);
    const bpm = normalizeBpm(plan.bpm);
    const sunoBpmRange = formatSunoBpmRange(bpm);
    const sourceTimeline = Array.isArray(plan.timelineDesign) ? plan.timelineDesign : [];
    const overallInstrumentation = cleanText(plan.instrumentation);
    const overallInstrumentationEnglish = cleanEnglishText(plan.instrumentationEnglish);
    const visualRationale = cleanText(plan.visualRationale);

    if (
      !style
      || !containsHan(style)
      || !styleEnglish
      || containsNonEnglishContent(styleEnglish)
      || (includeTimeline && sourceTimeline.length === 0)
      || (!includeTimeline && (
        !overallInstrumentation
        || !containsHan(overallInstrumentation)
        || !overallInstrumentationEnglish
        || containsNonEnglishContent(overallInstrumentationEnglish)
        || !visualRationale
        || !containsHan(visualRationale)
      ))
    ) {
      throw new Error(`AI 生成的第 ${planIndex + 1} 套配乐方案不完整，请重试。`);
    }
    if (!isStandardMusicKey(key)) {
      throw new Error(`AI 生成的第 ${planIndex + 1} 套配乐调性格式有误，请重试。`);
    }

    const pairedTimeline = sourceTimeline.map((item, itemIndex) => {
      const normalized = {
        timecode: cleanText(item.timecode),
        instruments: cleanText(item.instruments),
        instrumentsEnglish: cleanEnglishText(item.instrumentsEnglish),
        emotion: cleanText(item.emotion),
        emotionEnglish: cleanEnglishText(item.emotionEnglish),
        description: cleanText(item.description),
        descriptionEnglish: cleanEnglishText(item.descriptionEnglish),
      };

      const chineseFields = [normalized.instruments, normalized.emotion, normalized.description];
      const englishFields = [normalized.instrumentsEnglish, normalized.emotionEnglish, normalized.descriptionEnglish];
      if (
        !normalized.timecode
        || containsNonEnglishContent(normalized.timecode)
        || chineseFields.some(value => !value || !containsHan(value))
        || englishFields.some(value => !value || containsNonEnglishContent(value))
      ) {
        throw new Error(`AI 生成的第 ${planIndex + 1} 套配乐在第 ${itemIndex + 1} 个时间段缺少双语信息，请重试。`);
      }
      return normalized;
    });

    const instrumentation = includeTimeline
      ? uniqueTexts(pairedTimeline.map(item => item.instruments)).join('；')
      : overallInstrumentation;
    if (isInstrumental) {
      const chineseBlueprint = [style, instrumentation, ...pairedTimeline.flatMap(item => [item.emotion, item.description])].join(' ');
      const englishBlueprint = [
        styleEnglish,
        ...(includeTimeline
          ? pairedTimeline.flatMap(item => [item.instrumentsEnglish, item.emotionEnglish, item.descriptionEnglish])
          : [overallInstrumentationEnglish]),
      ].join(' ');
      if (containsVocalContentChinese(chineseBlueprint) || containsVocalContentEnglish(englishBlueprint)) {
        throw new Error(`AI 生成的第 ${planIndex + 1} 套纯音乐方案包含人声元素，请重试。`);
      }
    }

    const timelineDesign = includeTimeline ? pairedTimeline.map(item => ({
      timecode: item.timecode,
      instruments: item.instruments,
      emotion: item.emotion,
      description: item.description,
    })) : undefined;
    const vocalDirection = isInstrumental
      ? '纯音乐，无人声、吟唱、合唱或歌词'
      : cleanText(plan.vocalDirection);
    const vocalDirectionEnglish = isInstrumental
      ? 'instrumental, no vocals, chanting, choir, or lyrics'
      : cleanEnglishText(plan.vocalDirectionEnglish);

    if (
      !vocalDirection
      || !vocalDirectionEnglish
      || (!isInstrumental && (!containsHan(vocalDirection) || containsNonEnglishContent(vocalDirectionEnglish)))
    ) {
      throw new Error(`AI 生成的第 ${planIndex + 1} 套配乐缺少人声方向，请重试。`);
    }

    const direction = plan.sunoDirection;
    if (!direction) {
      throw new Error(`AI 生成的第 ${planIndex + 1} 套配乐缺少 Suno 创作要点，请重试。`);
    }
    const chineseDirection = [
      direction.use, direction.moodEnergy, direction.instrumentRoles,
      direction.tempoFeel, direction.melodyMix, direction.formEnding, direction.exclude,
    ].map(cleanText);
    const englishDirection = [
      direction.useEnglish, direction.moodEnergyEnglish, direction.instrumentRolesEnglish,
      direction.tempoFeelEnglish, direction.melodyMixEnglish, direction.formEndingEnglish,
      direction.excludeEnglish,
    ].map(cleanEnglishText);
    if (
      chineseDirection.some(value => !value || !containsHan(value) || containsTimedCue(value))
      || englishDirection.some(value => !value || containsNonEnglishContent(value) || containsTimedCue(value))
      || (isInstrumental && (
        containsVocalContentChinese(chineseDirection.slice(0, 6).join(' '))
        || containsVocalContentEnglish(englishDirection.slice(0, 6).join(' '))
      ))
    ) {
      throw new Error(`AI 生成的第 ${planIndex + 1} 套 Suno 创作要点不完整或包含时间码，请重试。`);
    }
    const [use, moodEnergy, instrumentRoles, tempoFeel, melodyMix, formEnding, exclude] =
      chineseDirection.map(value => limitCharacters(value, 24));
    const [useEnglish, moodEnergyEnglish, instrumentRolesEnglish, tempoFeelEnglish,
      melodyMixEnglish, formEndingEnglish, excludeEnglish] =
      englishDirection.map(value => limitWords(value, 10));
    const compactStyle = selectWholeTrackText(
      style,
      '现代电影感配乐',
      /[。；;\n]+/,
      SUNO_STYLE_CHAR_LIMIT,
      limitCharacters,
    );
    const compactStyleEnglish = selectWholeTrackText(
      styleEnglish,
      'modern cinematic soundtrack',
      /[.;\n]+/,
      SUNO_STYLE_WORD_LIMIT,
      limitWords,
    );
    const compactVocalDirection = isInstrumental
      ? vocalDirection
      : selectWholeTrackText(
        vocalDirection,
        '统一且自然的人声音色与演唱方式',
        /[。；;\n]+/,
        SUNO_VOCAL_CHAR_LIMIT,
        limitCharacters,
      );
    const compactVocalDirectionEnglish = isInstrumental
      ? vocalDirectionEnglish
      : selectWholeTrackText(
        vocalDirectionEnglish,
        'consistent natural vocals and performance style',
        /[.;\n]+/,
        SUNO_VOCAL_WORD_LIMIT,
        limitWords,
      );
    const chinesePrompt = [
      `用途：${use}`,
      `风格：${compactStyle}`,
      `情绪/能量：${moodEnergy}`,
      `配器：${instrumentRoles}`,
      `速度：${tempoFeel}，${sunoBpmRange}`,
      `调性：${key}`,
      `旋律/混音：${melodyMix}`,
      `结构/结尾：${formEnding}`,
      isInstrumental ? '' : `人声：${compactVocalDirection}`,
      `排除：${isInstrumental ? '人声、吟唱、歌词，' : ''}${exclude}`,
    ].filter(Boolean).join('；') + '。';
    const englishPrompt = [
      `Use: ${useEnglish}`,
      `Style: ${compactStyleEnglish}`,
      `Mood/energy: ${moodEnergyEnglish}`,
      `Instruments: ${instrumentRolesEnglish}`,
      `Tempo: ${tempoFeelEnglish}, ${sunoBpmRange}`,
      `Key: ${key}`,
      `Melody/mix: ${melodyMixEnglish}`,
      `Form/ending: ${formEndingEnglish}`,
      isInstrumental ? '' : `Vocals: ${compactVocalDirectionEnglish}`,
      `Avoid: ${isInstrumental ? 'no vocals, no chanting, no lyrics, ' : ''}${excludeEnglish}`,
    ].filter(Boolean).join('; ') + '.';

    if (containsTimedCue(chinesePrompt) || containsTimedCue(englishPrompt)) {
      throw new Error(`AI 生成的第 ${planIndex + 1} 套整体音乐提示包含视频时间码，请重试。`);
    }

    return {
      style,
      instrumentation,
      visualRationale: includeTimeline ? undefined : visualRationale,
      vocalInfo: isInstrumental ? undefined : plan.vocalInfo,
      lyrics: isInstrumental ? undefined : plan.lyrics,
      timelineDesign,
      sunoPrompt: {
        chinese: chinesePrompt,
        english: englishPrompt,
        bpm,
        key,
        structure: includeTimeline ? pairedTimeline.map(item => `${item.timecode} ${item.emotion}`).join(' → ') : '',
        dynamics: includeTimeline ? pairedTimeline.map(item => `${item.timecode}：${item.emotion}；${item.description}`).join(' → ') : '',
      },
    };
  });

  return {
    sfxAnalysis: scope.sfx && raw.sfxAnalysis
      ? raw.sfxAnalysis
      : { summary: '', keyElements: [], pacing: '' },
    musicAnalysis: scope.music && raw.musicAnalysis
      ? raw.musicAnalysis
      : { mood: '', rhythm: '', suggestedInstruments: [], emotionalCurve: '' },
    videoMotionTempo: scope.music ? normalizeVideoMotionTempo(raw.videoMotionTempo) : undefined,
    sfxSchemes: scope.sfx ? normalizeAudioDesignSfxSchemes(raw.sfxSchemes || []) : [],
    bgmRecommendations,
  };
};

export interface AudioDesignMedia {
  audioMetrics?: AudioMetricEvidence;
  data?: string;
  fileUri?: string;
  mimeType: string;
  label?: string;
  videoMetadata?: {
    startOffset?: string;
    endOffset?: string;
    fps?: number;
  };
}

export interface AudioDesignVideoPreuploadResult {
  uploadId: string;
  displayName: string;
  mimeType: string;
  expiresAt: number;
  optimized?: boolean;
}

export async function extractAudioDesignVideoKeyframes(
  video: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
  } = {},
): Promise<AudioDesignMedia[]> {
  if (!isBrowser) {
    throw new Error('该方法仅用于 HTML5 客户端上传视频。');
  }

  return new Promise<AudioDesignMedia[]>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('已取消本次分析。'));
      return;
    }

    const request = new XMLHttpRequest();
    const handleAbort = () => request.abort();
    const cleanup = () => options.signal?.removeEventListener('abort', handleAbort);
    options.signal?.addEventListener('abort', handleAbort, { once: true });

    request.open('POST', '/api/ai/audio-design-video-keyframes');
    setClientIdentityHeader(request);
    request.responseType = 'json';
    request.timeout = 90_000;
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(95, Math.round((event.loaded / event.total) * 95));
      options.onProgress?.(`正在上传视频用于服务器关键帧分析 ${percent}%...`);
    };
    request.upload.onload = () => {
      options.onProgress?.('上传完成，服务器正在提取关键帧...');
    };
    request.onload = () => {
      cleanup();
      const response = request.response || {};
      if (request.status >= 200 && request.status < 300 && Array.isArray(response.frames)) {
        resolve(response.frames as AudioDesignMedia[]);
        return;
      }
      reject(new Error(response.error || `服务器关键帧分析失败 (${request.status})`));
    };
    request.onerror = () => {
      cleanup();
      reject(new Error('服务器关键帧分析上传失败，请检查网络后重试。'));
    };
    request.ontimeout = () => {
      cleanup();
      reject(new Error('服务器关键帧分析超过 90 秒，请缩短视频后重试。'));
    };
    request.onabort = () => {
      cleanup();
      reject(new Error('已取消本次分析。'));
    };

    const formData = new FormData();
    formData.append('originalName', video.name);
    formData.append('video', video, createAsciiVideoUploadName(video.name, video.type));
    request.send(formData);
  });
}

export async function preuploadAudioDesignVideo(
  video: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: number, message: string) => void;
    shortVideo?: boolean;
  } = {},
): Promise<AudioDesignVideoPreuploadResult> {
  if (!isBrowser) {
    throw new Error('该方法仅用于 HTML5 客户端预上传视频。');
  }

  return new Promise<AudioDesignVideoPreuploadResult>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('已取消视频预上传。'));
      return;
    }

    const request = new XMLHttpRequest();
    const handleAbort = () => request.abort();
    const cleanup = () => options.signal?.removeEventListener('abort', handleAbort);
    options.signal?.addEventListener('abort', handleAbort, { once: true });

    request.open('POST', '/api/ai/audio-design-video-preupload');
    setClientIdentityHeader(request);
    request.responseType = 'json';
    request.timeout = 180_000;
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(95, Math.round((event.loaded / event.total) * 95));
      options.onProgress?.(percent, `正在后台上传视频 ${percent}%...`);
    };
    request.upload.onload = () => {
      options.onProgress?.(96, '视频已上传，正在提取分析画面...');
    };
    request.onload = () => {
      cleanup();
      const response = request.response || {};
      if (request.status >= 200 && request.status < 300) {
        options.onProgress?.(100, '视频预上传已就绪，点击分析会更快。');
        resolve(response as AudioDesignVideoPreuploadResult);
        return;
      }
      reject(new Error(response.error || `视频预上传失败 (${request.status})`));
    };
    request.onerror = () => {
      cleanup();
      reject(new Error('视频预上传失败，请检查网络后重试。'));
    };
    request.ontimeout = () => {
      cleanup();
      reject(new Error('视频预上传超过 3 分钟，请稍后点击分析继续。'));
    };
    request.onabort = () => {
      cleanup();
      reject(new Error('已取消视频预上传。'));
    };

    const formData = new FormData();
    formData.append('originalName', video.name);
    formData.append('shortVideo', String(Boolean(options.shortVideo)));
    formData.append('video', video, createAsciiVideoUploadName(video.name, video.type));
    request.send(formData);
  });
}

export async function analyzeAudioDesignVideo(
  video: File,
  requirements: string,
  target: { game: boolean; video: boolean; avatar?: boolean; sunnyIsland?: boolean; gift?: boolean; activity?: boolean },
  isInstrumental: boolean,
  options: {
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
    analysisMode?: 'professional' | 'fallback';
    scope?: AudioDesignScope;
  } = {},
): Promise<AudioDesignResult> {
  if (!isBrowser) {
    throw new Error('该方法仅用于 HTML5 客户端上传视频。');
  }

  return new Promise<AudioDesignResult>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('已取消本次分析。'));
      return;
    }

    const request = new XMLHttpRequest();
    const handleAbort = () => request.abort();
    const cleanup = () => options.signal?.removeEventListener('abort', handleAbort);
    options.signal?.addEventListener('abort', handleAbort, { once: true });

    request.open('POST', '/api/ai/audio-design-video');
    setClientIdentityHeader(request);
    request.responseType = 'json';
    request.timeout = 240_000;
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      options.onProgress?.(`正在上传原视频 ${percent}%...`);
    };
    request.upload.onload = () => {
      if (options.analysisMode === 'fallback') {
        options.onProgress?.('上传完成，服务器正在分析完整视频...');
        return;
      }

      options.onProgress?.(target.avatar || target.gift
        ? '上传完成，服务器会先压缩大视频，再进行短视频高精度分析...'
        : '上传完成，服务器会先压缩大视频，再分析完整画面与声音...');
    };
    request.onload = () => {
      cleanup();
      const response = request.response || {};
      if (request.status >= 200 && request.status < 300) {
        resolve(response as AudioDesignResult);
        return;
      }
      reject(new Error(response.error || `专业视频分析失败 (${request.status})`));
    };
    request.onerror = () => {
      cleanup();
      reject(new Error('视频上传失败，请检查网络后重试。'));
    };
    request.ontimeout = () => {
      cleanup();
      reject(new Error('专业视频分析超过 4 分钟，请缩短视频后重试。'));
    };
    request.onabort = () => {
      cleanup();
      reject(new Error('已取消本次分析。'));
    };

    const formData = new FormData();
    formData.append('originalName', video.name);
    formData.append('video', video, createAsciiVideoUploadName(video.name, video.type));
    formData.append('requirements', requirements);
    formData.append('target', JSON.stringify(target));
    formData.append('isInstrumental', String(isInstrumental));
    formData.append('analysisMode', options.analysisMode || 'professional');
    formData.append('scope', JSON.stringify(normalizeAudioDesignScope(options.scope)));
    request.send(formData);
  });
}

export async function analyzeAudioDesignPreuploadedVideo(
  uploadId: string,
  requirements: string,
  target: { game: boolean; video: boolean; avatar?: boolean; sunnyIsland?: boolean; gift?: boolean; activity?: boolean },
  isInstrumental: boolean,
  options: {
    signal?: AbortSignal;
    analysisMode?: 'professional' | 'fallback';
    scope?: AudioDesignScope;
  } = {},
): Promise<AudioDesignResult> {
  if (!isBrowser) {
    throw new Error('该方法仅用于 HTML5 客户端分析预上传视频。');
  }

  return postJson<AudioDesignResult>('/api/ai/audio-design-video-preuploaded', {
    uploadId,
    requirements,
    target,
    isInstrumental,
    analysisMode: options.analysisMode || 'professional',
    scope: normalizeAudioDesignScope(options.scope),
  }, { signal: options.signal, timeoutMs: 180_000 });
}

export async function analyzeAudioDesign(
  files: AudioDesignMedia[],
  requirements: string,
  target: { game: boolean; video: boolean; avatar?: boolean; sunnyIsland?: boolean; gift?: boolean; activity?: boolean },
  isInstrumental: boolean,
  options: { signal?: AbortSignal; scope?: AudioDesignScope } = {},
): Promise<AudioDesignResult> {
  const analysisScope = normalizeAudioDesignScope(options.scope);
  if (isBrowser) {
    return postJson<AudioDesignResult>('/api/ai/audio-design', {
      files,
      requirements,
      target,
      isInstrumental,
      scope: analysisScope,
    }, { signal: options.signal, timeoutMs: 180_000 });
  }

  const audioEvidence = files.filter(file => file.mimeType === AUDIO_METRICS_MIME).map(file => validateAudioEvidence(file.audioMetrics));
  if (files.some(file => file.mimeType.startsWith('audio/'))) {
    throw new Error('请先提取音频本地指标后再分析，不支持向文本模型直接发送音频。');
  }

  let targetDesc = target.game && target.video ? "游戏CG宣传片" : target.game ? "游戏" : target.video ? "视频" : "音频设计";
  const isGameTrack = (target.game || target.activity) && !target.video && !target.avatar && !target.sunnyIsland && !target.gift;
  const includeMusicTimeline = !isGameTrack;
  const hasVideoInput = files.some(file => (
    file.mimeType.startsWith('video/')
    || Boolean(file.videoMetadata)
    || /^视频 .+关键帧/.test(file.label || '')
    || /^完整视频：/.test(file.label || '')
  ));
  const shouldAnalyzeMotionTempo = analysisScope.music && hasVideoInput;
  const scopeDescription = analysisScope.music && analysisScope.sfx
    ? '音乐设计与音效设计'
    : analysisScope.music
      ? '仅音乐设计'
      : '仅音效设计';
  if (target.avatar) {
    targetDesc = "科幻巨制《阿凡达》(Avatar) 风格奇幻自然场景";
  } else if (target.gift) {
    targetDesc = "礼物动效短视频，通常 4-12 秒，画面动作密集，重点服务礼物出现、爆发、闪光、粒子、结算和反馈音效";
  } else if (target.activity) {
    targetDesc = "游戏活动页或运营活动场景，通常以背景图和少量背景变化为主，配乐保持统一氛围，音效强调按钮、奖励、弹窗、转场和重点反馈";
  } else if (target.sunnyIsland) {
    targetDesc = "治愈系田园日常《小岛有晴天》(Sunny Day on the Island) 温暖舒缓场景";
  }
  
  let additionalSpecialInstructions = "";
  if (target.avatar) {
    additionalSpecialInstructions = `
    【阿凡达 (Avatar) 风格特别设计要求（最高优先级）】：
    ${analysisScope.music ? `1. **高精度但符合音乐规律的时间线设计 (timelineDesign)**：逐秒观察画面动作，但配乐段落必须按真实叙事与音乐乐句自适应划分，不设固定段数。常规段落约 5-8 秒；画面与情绪持续稳定时可延长，只有明显转场、关键动作或强烈情绪拐点才提前切段，严禁连续设计大量 2-3 秒的情绪切换。
    2. **宏大管弦交响与原始部落打击乐 (BGM)**：配乐应融合史诗科幻管弦、原野木管（原野木笛）和原始部落大鼓打击乐（wood drum, hand percussion），传递人与大自然的灵性连接，空灵、原始而极其震撼。${isInstrumental ? '本次为纯音乐，严禁加入可辨识的人声、吟唱、合唱、呼喊或歌词，只能用乐器音色塑造原始感。' : '本次可使用人声，但人声出现的时间、情绪和演唱方式必须写入同一份 timelineDesign。'}` : ''}
    ${analysisScope.sfx ? '**外星奇幻生态声景 (Foley)**：音效命名和设计应该充满潘多拉星球外星动植物的奇特生命律动、夜光森林荧光植物的发光嗡嗡声（ambient bioluminescent glow）、斑溪兽（Banshee）的飞掠振翅与嘶鸣、灵魂之树的空灵触碰共鸣（使用神秘高频合成器与奇异声学共鸣音效）。' : ''}
    `;
  } else if (target.gift) {
    additionalSpecialInstructions = `
    【礼物动效特别设计要求（最高优先级）】：
    **短视频定位**：礼物素材通常是 4-12 秒的短动效，核心不是长叙事，而是“出现 → 蓄力 → 爆发/展示 → 收尾”的声音反馈。
    ${analysisScope.sfx ? '**礼物音效重点**：只保留画面确实出现的 3-5 个主要触发点；同一动作的连续变化合并，不能为凑数量编造礼物、金币或奖励。每个节点的 description、scene、logic 各不超过 40 字，时间码以提供的关键帧为依据。' : ''}
    ${analysisScope.music ? '**礼物配乐重点**：保留两套不同音乐方向，但每套 timelineDesign 最多 2 个阶段；视频不足 5 秒时优先使用 1 个完整阶段。每个字段简洁说明，不重复画面分析。' : ''}
    **短视频输出控制**：总结和理由各用一两句话，数组只保留实际可辨识的信息；不要用冗长描述填充 JSON。
    `;
  } else if (target.activity) {
    additionalSpecialInstructions = `
    【活动场景特别设计要求（最高优先级）】：
    **活动页定位**：活动素材通常像游戏音轨，以活动主题背景图、少量背景变化、入口按钮、奖励领取、弹窗、转场和任务反馈为主。
    ${analysisScope.music ? '**活动配乐重点**：配乐按活动主题输出统一整体方案，适合长时间循环和页面停留；不要按背景图的细小变化拆成复杂时间线。' : ''}
    ${analysisScope.sfx ? '**活动音效重点**：勾选音效时需要更仔细识别按钮点击、奖励出现、弹窗打开/关闭、任务完成、列表滑动、转场与重点视觉反馈，可给出具体触发时机和制作建议。' : ''}
    `;
  } else if (target.sunnyIsland) {
    additionalSpecialInstructions = `
    【小岛有晴天 (Sunny Day on the Island) 风格特别设计要求（最高优先级）】：
    **治愈、田园、温暖的总体风格**：本次输出必须往治愈、舒缓、安宁、田园、温暖方向倾斜，彻底避免任何惊悚、机械或突兀的内容。
    ${analysisScope.sfx ? '**田园大自然日常音效 (Foley)**：音效设计应聚焦于清爽海风吹拂、海浪拍打沙滩的细软声音、微风拂过花草麦浪的沙沙沙声、自行车链条及轮轴转动的轻快咔哒声、日系风铃随风摆动的清脆铜铃音、温水煮热咖啡气泡破裂的汩汩咕嘟声、以及远方小猫撒娇的温柔细叫与草丛鸟鸣。' : ''}
    ${analysisScope.music ? `**温暖安宁的小品式乐器配乐 (BGM)**：音乐推荐必须极度慵懒舒缓。推荐的主奏与辅奏乐器为：尤克里里 (ukulele)、木吉他温暖扫弦 (acoustic guitar strumming)、马林巴木琴 (marimba)、手风琴 (accordion)、轻快的手碟 (handpan) 及带大厅混响的经典立式原声钢琴 (piano)。
    **双语音乐蓝图必须温润治愈**：style/styleEnglish 与 timelineDesign 中每组 instruments/instrumentsEnglish 必须共同体现温暖田园；最终 Suno 词只概括整首音乐，但曲风、情绪和核心乐器必须与这套蓝图一致。` : ''}
    `;
  }

  const prompt = `
    你是一个顶级的音频设计师和视频分析专家。请深度分析上传的内容，并提供${target.gift ? '精炼且专业' : '极其详尽且专业'}的${scopeDescription}方案。
    【本次输出范围（最高优先级）】：${scopeDescription}。${analysisScope.music ? '必须输出音乐分析与背景音乐方案。' : '不得输出任何音乐分析、配乐方案、音乐提示词或视频动作速度。'}${analysisScope.sfx ? '必须输出音效分析与音效制作排程。' : '不得输出任何音效分析或音效制作排程。'}
    
    分析要求：
    1. **多文件逻辑**：有联系则综合分析，无联系则以第一张/段素材为主。
    2. **双语字段边界**：除字段名带 English、标准英文调性 key、数字 bpm、时间码 timecode 及规范英文音效名 name 外，所有分析描述必须使用中文；所有 English 字段必须只写英文，不得夹杂中文。
    ${analysisScope.sfx ? `3. **动作级SFX**：在 "scene" 字段标明具体时间点。\n    5. **无语音**：音效严禁出现人声对白。\n    6. **性能与精度平衡**：只保留最重要的 ${target.gift ? '3-5' : '6-10'} 个音效节点；字段描述保持专业但精炼，每段不超过 ${target.gift ? '40' : '100'} 个汉字，避免重复内容。` : ''}
    ${analysisScope.music
      ? (isGameTrack
          ? '4. **双重BGM**：提供两个制作方向不同的整体风格方案，但两套都必须严格符合素材与补充需求的题材、情绪和玩法；差异只能来自曲风融合、核心配器或节奏处理，禁止为了制造差异而输出相反情绪。'
          : '4. **双重BGM**：提供两个差异巨大的风格方案。')
      : ''}
    ${analysisScope.music ? `
    **Suno 整曲创作要点（强制）**：每套配乐的 sunoDirection 必须填写中英同义的七组短语，每组中文不超过 24 字、英文不超过 10 个单词；只概括整首音乐，不复制视频时间码或逐秒剪辑指令。
       - use/useEnglish：具体用途与画面。游戏写常驻、战斗、菜单或短演出等实际适用类型；其他场景写广告、礼物动效、活动页等实际用途，不要凭空套用游戏设定。
       - moodEnergy/moodEnergyEnglish：玩家或观众的感受，以及能量保持稳定还是适度起伏。
       - instrumentRoles/instrumentRolesEnglish：明确主奏、节奏、铺底各自的乐器或音色；没有鼓时如实写轻脉冲或无打击乐，不要编造。
       - tempoFeel/tempoFeelEnglish：慢速、中速或快速的听感，与 bpm 字段一致；不要在此字段重复数字，Suno BPM 范围由系统生成。
       - melodyMix/melodyMixEnglish：旋律突出或克制，以及是否给对白和音效留空间。
       - formEnding/formEndingEnglish：整曲渐进、循环感和结尾方式；可写音乐段落类型，但不要写画面时间码或分秒进入指令。
       - exclude/excludeEnglish：与本方案相关的 1-2 类不需要的乐器、音色或编排元素；纯音乐不得包含人声，带人声方案不要把所需人声写入排除项。
    style/styleEnglish 必须写具体曲风或地域音乐传统，并与画面、七组要点及配器一致；不要仅写“史诗”“中东风”等宽泛标签。` : ''}
    ${shouldAnalyzeMotionTempo ? `
    **视频动作速度独立分析（最高优先级）**：videoMotionTempo 只分析视频画面中人物跳舞、上下抖动、摇晃、摆动、踏步等可见动作的重复周期，用于后续卡点配乐；它不是推荐音乐的速度，严禁从 bgmRecommendations.bpm 推导或为了匹配推荐曲风而修改。
       - 跟踪同一人物或主体的重复动作，以一次完整动作循环对应一拍，结合多个循环间隔估算 primaryBpm 与稳定区间 bpmRangeMin/bpmRangeMax。
       - 镜头切换、运镜、闪白和剪辑频率不是人物动作，不得计入动作 BPM；动作速度发生明显变化时写入 segments，并给出时间码、动作、局部 BPM 与可信度。
       - alternateBpms 只填写可能成立的半速或倍速候选，最多 3 个；confidence 只能写“高”“中”“低”。analysisBasis 必须说明观察到的动作与周期依据，syncGuidance 说明实际卡点应对齐哪个动作相位。
       - 若素材帧数、动作循环或可见范围不足以可靠估算，detected=false、primaryBpm=0、区间为 0、候选与分段为空，并如实说明限制；不得编造速度。
    ` : ''}
    ${analysisScope.music ? (isGameTrack ? `
    7. **游戏配乐只做整体方案（最高优先级）**：游戏音轨不按视频时间、镜头或动作切分音乐。每个 bgmRecommendations 项只提供一套统一的整曲风格，不得输出 timelineDesign，不得在任何音乐字段中写时间码、段落时长、进入时机、剪辑点或先后顺序。
    8. **整体配器双语同义（强制）**：instrumentation/instrumentationEnglish 用一句短语列出整首音乐最重要的 3-5 个核心乐器或音色，中英文必须语义等价。
    9. **画面推荐依据（强制）**：visualRationale 用中文说明画面题材、色彩/空间、动作节奏、玩法氛围或用户补充需求如何共同指向该音乐风格；必须解释“为什么推荐这种音乐”，但不得写时间码、段落时长或先后顺序，长度 60-120 字。
    10. **Suno 整体音乐词（强制）**：style/styleEnglish 用一句短语概括具体曲风与总体情绪，不得包含具体 BPM；单点推荐速度只写入 bpm 字段。系统会结合 sunoDirection 生成简短的整曲创作提示词和 BPM 范围，不复制视频剪辑时间线。
    11. **游戏适配原则**：音乐应适合长时间播放和自然循环，保持统一氛围与稳定能量，避免依赖固定画面时长或一次性剧情转折。素材内容与“补充需求”是判断整体风格的最高依据；没有素材时完全以补充需求为准，不得输出与其题材或情绪相冲突的音乐。
    ` : `
    7. **单一配乐蓝图（强制）**：每个 bgmRecommendations 项是一套完全独立、闭环的方案，timelineDesign 负责分秒级音画分析。顶层 style、BPM、调性、人声方向及所有时间段必须互相一致，禁止把两套推荐交叉混用；系统会从同一方案汇总最终 Suno 整体音乐词。
    8. **逐项双语同义（强制）**：style/styleEnglish，以及 timelineDesign 中每一组 emotion/emotionEnglish、instruments/instrumentsEnglish、description/descriptionEnglish 都必须语义等价。不得在英文项中新增中文方案没有的曲风、乐器、人声、情绪或时间节点。
    9. **Suno 整体音乐词（强制）**：style/styleEnglish 必须用一句短语概括具体曲风和总体情绪，中文不超过 30 字、英文不超过 12 个单词，不得包含具体 BPM 或视频时间码。单点推荐速度只写入 bpm 字段。timelineDesign 的 instruments/instrumentsEnglish 只列该段使用的 1-4 个乐器或音色名称，进入时机、动态变化和剪辑配合统一写入 description/descriptionEnglish。系统将用整体曲风、sunoDirection、调性和人声方向生成简短的整曲 Suno 提示词，不会复制视频时间线。
    10. **配乐段落长度与连续性（最高优先级）**：timelineDesign 是音乐段落设计，不是逐动作音效清单。必须根据视频实际时长、叙事段落、镜头群和显著情绪拐点自适应划分，不能为了增加细节而强行增加段数。常规每段约 5-8 秒；连续镜头或同一情绪可保持 8-15 秒；短于 5 秒只允许用于视频首尾余量，或真正重要的转场、关键动作与强烈情绪变化。相邻段若情绪与核心配器相近必须合并，严禁连续出现大量 2-3 秒段落。高频画面采样只用于识别动作与 SFX，不代表 BGM 要以相同颗粒度切段；微小动作、卡点和瞬时声音写入 SFX 或当前段 description，不得据此更换整段音乐情绪。时间线必须从开头到结尾连续覆盖、无空隙、无重叠。
    11. **画面分析与方案分工**：musicAnalysis.emotionalCurve 只描述画面本身的客观情绪走势；每套音乐如何响应画面，必须分别写进该方案的 timelineDesign，不能用全局情绪曲线代替。
    `) : ''}
    ${analysisScope.music ? '12. **调性格式（强制）**：key 必须使用标准英文“音名 + major/minor”格式，例如 "D minor"、"F# major"，不得写“小调/大调”或只写音名。' : ''}
    ${analysisScope.music
      ? (isInstrumental
          ? `13. **纯音乐硬约束（强制）**：style、instrumentation${includeMusicTimeline ? ' 和 timelineDesign' : ''} 的全部中英文字段中不得出现人声、女声、男声、童声、吟唱、合唱、呼喊、歌唱、歌词、说唱及 vocal/voice/choir/chant/singer/lyrics/rap/singing/humming 等元素；不要输出 vocalInfo 或 lyrics。`
          : isGameTrack
            ? '13. **人声方案约束**：vocalDirection/vocalDirectionEnglish 只用一句短语描述整首歌曲统一的人声类型、音色与唱法，不得写时间码、进入时机或分段安排；不要输出 vocalInfo 或 lyrics。'
            : '13. **人声方案约束**：vocalDirection/vocalDirectionEnglish 只用一句短语描述整首歌曲统一的人声类型、音色与唱法，不得写时间码或进入时机；人声何时进入只写在对应 timelineDesign 时间段中，中英文必须同义。')
      : ''}

    ${analysisScope.music && files.some(file => Boolean(file.fileUri)) && includeMusicTimeline ? `
    【原生视频精细分析要求】：
    1. 必须从 00:00 开始覆盖到视频结束，结合画面运动、镜头剪辑和原始音轨进行判断。
    2. 识别关键镜头群、叙事阶段、情绪和音乐能量的明显转折，并使用“MM:SS-MM:SS”标出开始与结束时间；普通切镜和细小动作不应单独拆成配乐段落。
    3. timelineDesign 必须按真实视频顺序连续覆盖，不得只根据少数代表画面概括全片。
    4. 快速动作段落优先标记 Foley、撞击、转场和节奏卡点；安静段落标记氛围、留白和音乐动态。
    ` : ''}
    
    ${analysisScope.sfx ? '【所有场景的音效命名要求】：sfxSchemes.items.name 使用简洁英文工程命名，单词之间一律用下划线 _ 连接，禁止空格、制表符和换行，例如 Soft_UI_Tap、Fairy_Page_Transition。此规则仅用于 name，scene、logic、description 保持自然语言书写。' : ''}

    ${target.video || target.avatar || target.gift || target.activity ? `
    【高精度影视级特别设计要求（最高优先级）】：
    由于本项目属于“影视广告 / Avatar / 礼物 / 活动”等需要精细画面判断的创作类型，本次请求在勾选音效时需要达到专业精度：
    ${analysisScope.sfx ? `1. **音效命名细致化 (name)**：
       - 所有生成的音效命名（name）必须采用统一且高精度的英文规范命名（如: sfx_foley_footstep_wood_01, sfx_ambient_wind_howl_loop_02, sfx_scifi_laser_shot_03），禁止使用模糊词，应区分出类型、材质、道具、变化序号等。
    2. **动作场景及时间码精准化 (scene)**：
       - 所有音效的出现场景和动作必须包含极度精准的时间码段（如: '00:01.5 - 00:03.2'、'0-5s' 或 '00:12 - 00:15'），并在 scene 字段中清晰阐述该时刻画面的微观动势（如：“特写镜头主角推门、门轴干涩吱呀声；0.5s时门板撞击墙壁”）。
    ` : ''}
    ${analysisScope.music ? `3. **分秒级音乐细致设计文案 (timelineDesign)**：
       - 每个配乐推荐（bgmRecommendations）必须在 timelineDesign 字段中附带一套按视频实际内容自适应的配乐段落设计，不设固定段数。通常每段约 5-8 秒；同一情绪可更长，只有重要转折可更短，并避免连续 2-3 秒换一次音乐情绪：
         - "timecode": 连续时间段，例如 24 秒视频可规划为 '0-6s', '6-13s', '13-20s', '20-24s'；末段可因视频结束而短于 5 秒。实际边界必须服从视频内容，不能照抄示例。
         - "instruments" / "instrumentsEnglish": 该时间段乐器配置的中英文同义表述。
         - "emotion" / "emotionEnglish": 该时间段画面情绪的中英文同义表述。
         - "description" / "descriptionEnglish": 具体编排、声学变化及剪辑配合方式的中英文同义表述；英文需简洁，且不得增添中文没有的元素。
    ` : ''}
    ` : isGameTrack ? `
    【游戏音轨整体音乐要求】：
    ${analysisScope.sfx ? '音效节点可根据素材动作标记具体触发时机。' : ''}
    ${analysisScope.music ? `1. 背景音乐只做整局统一风格，不得按素材时间拆分。
    2. bgmRecommendations 不输出 timelineDesign；只输出 style/styleEnglish、instrumentation/instrumentationEnglish、visualRationale、bpm、key 与统一人声方向。
    3. visualRationale 必须针对上传画面或补充需求解释推荐逻辑，说明这种音乐如何匹配画面气质、玩法情绪和长时间循环体验。` : ''}
    ` : `
    【通用场景设计要求】：
    ${analysisScope.music ? '即使不是纯影视广告，也请在 bgmRecommendations 的 timelineDesign 中按素材实际叙事和情绪拐点自适应设计音乐段落，不设固定段数。常规段落约 5-8 秒，同一情绪可延长；避免连续 2-3 秒切换情绪，并写明各段的情感表达和主导乐器。' : '根据素材内容提取最重要的音效节点并生成音效制作排程。'}
    `}

    ${additionalSpecialInstructions}

    目标方向：${targetDesc}
    补充需求：${requirements}
    ${audioEvidence.length ? `【音频参考的证据边界，优先于其他分析要求】：${AUDIO_EVIDENCE_RULES}\n音效只能给出待验证的创意方向，不可声称识别到原音频事件。仅有音频指标时，不可声称观察到画面、动作或确定原曲风格。` : ''}
    ${analysisScope.music ? `音乐类型：${isInstrumental ? "纯音乐（Instrumental）" : "带有人声的歌曲"}` : ''}
  `;

  const usesNativeVideo = files.some(file => Boolean(file.fileUri));
  const parts: any[] = usesNativeVideo ? [] : [{ text: prompt }];
  files.forEach((file) => {
    if (file.mimeType === AUDIO_METRICS_MIME) {
      parts.push({ text: `本地提取的音频指标（未直接听音）：${JSON.stringify(validateAudioEvidence(file.audioMetrics))}` });
      return;
    }
    if (!usesNativeVideo && file.label) parts.push({ text: `\n[${file.label}]` });
    if (file.fileUri) {
      parts.push({
        fileData: {
          fileUri: file.fileUri,
          mimeType: file.mimeType,
        },
        ...(file.videoMetadata ? { videoMetadata: file.videoMetadata } : {}),
      });
    } else if (file.data) {
      parts.push({
        inlineData: {
          data: file.data.split(',')[1] || file.data,
          mimeType: file.mimeType,
        },
      });
    }
  });
  if (usesNativeVideo) {
    const labels = files.map(file => file.label).filter(Boolean).join('；');
    parts.push({ text: `${labels ? `[${labels}]\n` : ''}${prompt}` });
  }

  const { Type, ThinkingLevel } = getAI();
  const response = await generateAiContent({
    contents: [{ parts }],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: target.gift ? 8_192 : analysisScope.music && analysisScope.sfx ? 16_384 : 10_240,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseSchema: {
        type: Type.OBJECT,
        required: [
          ...(analysisScope.sfx ? ["sfxAnalysis", "sfxSchemes"] : []),
          ...(analysisScope.music ? ["musicAnalysis", "bgmRecommendations"] : []),
          ...(shouldAnalyzeMotionTempo ? ["videoMotionTempo"] : []),
        ],
        properties: {
            ...(analysisScope.sfx ? { sfxAnalysis: {
              type: Type.OBJECT,
              required: ["summary", "keyElements", "pacing"],
              properties: {
                summary: { type: Type.STRING },
                keyElements: { type: Type.ARRAY, items: { type: Type.STRING } },
                pacing: { type: Type.STRING }
              }
            } } : {}),
            ...(analysisScope.music ? { musicAnalysis: {
              type: Type.OBJECT,
              required: ["mood", "rhythm", "suggestedInstruments", "emotionalCurve"],
              properties: {
                mood: { type: Type.STRING },
                rhythm: { type: Type.STRING },
                suggestedInstruments: { type: Type.ARRAY, items: { type: Type.STRING } },
                emotionalCurve: { type: Type.STRING }
              }
            } } : {}),
            ...(shouldAnalyzeMotionTempo ? { videoMotionTempo: {
              type: Type.OBJECT,
              required: [
                "detected",
                "primaryBpm",
                "bpmRangeMin",
                "bpmRangeMax",
                "alternateBpms",
                "confidence",
                "motionPattern",
                "analysisBasis",
                "syncGuidance",
                "segments"
              ],
              properties: {
                detected: { type: Type.BOOLEAN },
                primaryBpm: { type: Type.INTEGER },
                bpmRangeMin: { type: Type.INTEGER },
                bpmRangeMax: { type: Type.INTEGER },
                alternateBpms: { type: Type.ARRAY, items: { type: Type.INTEGER } },
                confidence: { type: Type.STRING },
                motionPattern: { type: Type.STRING },
                analysisBasis: { type: Type.STRING },
                syncGuidance: { type: Type.STRING },
                segments: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    required: ["timecode", "motion", "bpm", "confidence"],
                    properties: {
                      timecode: { type: Type.STRING },
                      motion: { type: Type.STRING },
                      bpm: { type: Type.INTEGER },
                      confidence: { type: Type.STRING }
                    }
                  }
                }
              }
            } } : {}),
            ...(analysisScope.sfx ? { sfxSchemes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["title", "items"],
                properties: {
                  title: { type: Type.STRING },
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      required: ["name", "description", "scene", "logic"],
                      properties: {
                        name: { type: Type.STRING },
                        description: { type: Type.STRING },
                        scene: { type: Type.STRING },
                        logic: { type: Type.STRING }
                      }
                    }
                  }
                }
              }
            } } : {}),
            ...(analysisScope.music ? { bgmRecommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: [
                  "style",
                  "styleEnglish",
                  "sunoDirection",
                  ...(isGameTrack ? ["instrumentation", "instrumentationEnglish", "visualRationale"] : []),
                  "bpm",
                  "key",
                  "vocalDirection",
                  "vocalDirectionEnglish",
                  ...(!isGameTrack ? ["timelineDesign"] : [])
                ],
                properties: {
                  style: { type: Type.STRING },
                  styleEnglish: { type: Type.STRING },
                  sunoDirection: {
                    type: Type.OBJECT,
                    required: [
                      'use', 'useEnglish', 'moodEnergy', 'moodEnergyEnglish',
                      'instrumentRoles', 'instrumentRolesEnglish', 'tempoFeel', 'tempoFeelEnglish',
                      'melodyMix', 'melodyMixEnglish', 'formEnding', 'formEndingEnglish',
                      'exclude', 'excludeEnglish',
                    ],
                    properties: {
                      use: { type: Type.STRING },
                      useEnglish: { type: Type.STRING },
                      moodEnergy: { type: Type.STRING },
                      moodEnergyEnglish: { type: Type.STRING },
                      instrumentRoles: { type: Type.STRING },
                      instrumentRolesEnglish: { type: Type.STRING },
                      tempoFeel: { type: Type.STRING },
                      tempoFeelEnglish: { type: Type.STRING },
                      melodyMix: { type: Type.STRING },
                      melodyMixEnglish: { type: Type.STRING },
                      formEnding: { type: Type.STRING },
                      formEndingEnglish: { type: Type.STRING },
                      exclude: { type: Type.STRING },
                      excludeEnglish: { type: Type.STRING },
                    },
                  },
                  instrumentation: { type: Type.STRING },
                  instrumentationEnglish: { type: Type.STRING },
                  visualRationale: { type: Type.STRING },
                  bpm: { type: Type.INTEGER },
                  key: { type: Type.STRING },
                  vocalDirection: { type: Type.STRING },
                  vocalDirectionEnglish: { type: Type.STRING },
                  vocalInfo: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      gender: { type: Type.STRING },
                      age: { type: Type.STRING },
                      characteristics: { type: Type.STRING },
                      mood: { type: Type.STRING },
                      singingStyle: { type: Type.STRING }
                    }
                  },
                  lyrics: {
                    type: Type.OBJECT,
                    properties: {
                      content: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            section: { type: Type.STRING },
                            text: { type: Type.STRING }
                          }
                        }
                      }
                    }
                  },
                  timelineDesign: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      required: [
                        "timecode",
                        "instruments",
                        "instrumentsEnglish",
                        "emotion",
                        "emotionEnglish",
                        "description",
                        "descriptionEnglish"
                      ],
                      properties: {
                        timecode: { type: Type.STRING },
                        instruments: { type: Type.STRING },
                        instrumentsEnglish: { type: Type.STRING },
                        emotion: { type: Type.STRING },
                        emotionEnglish: { type: Type.STRING },
                        description: { type: Type.STRING },
                        descriptionEnglish: { type: Type.STRING }
                      }
                    }
                  }
                }
              }
            } } : {})
        }
      }
    },
  });

  if (!response.text) {
    throw new Error("AI 未能生成有效内容");
  }

  let rawResult: RawAudioDesignResult;
  try {
    rawResult = JSON.parse(response.text) as RawAudioDesignResult;
  } catch (e) {
    console.error("JSON 解析失败:", response.text);
    throw new Error("AI 返回的数据格式有误，请重试");
  }

  const result = materializeAudioDesignResult(rawResult, isInstrumental, includeMusicTimeline, analysisScope);
  if (audioEvidence.length) result.audioAnalysisSources = audioEvidence.map(e => ({ sourceName: e.sourceName,
    sourceDuration: e.sourceDuration, analyzedSeconds: e.analyzedSeconds, method: 'local-metrics-gpt', model: response.modelVersion }));
  return result;
}

export async function regenerateLyrics(
  originalLyrics: string,
  selectedPart: string,
  direction: string
): Promise<string> {
  if (isBrowser) {
    const result = await postJson<{ text: string }>('/api/ai/regenerate-lyrics', {
      originalLyrics,
      selectedPart,
      direction,
    });
    return result.text;
  }

  const { ThinkingLevel } = getAI();
  const prompt = `
    原始歌词：
    ${originalLyrics}

    需要修改的部分：
    ${selectedPart}

    修改方向：
    ${direction}

    请仅返回修改后的这一部分歌词内容，保持原有的结构标注格式。
  `;

  const response = await generateAiContent({
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    }
  });

  return response.text || "";
}

export async function generateLyricsFromMusicStyle(
  stylePrompt: string,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const normalizedStyle = stylePrompt.trim();
  if (!normalizedStyle) {
    throw new Error("请先输入歌曲风格描述。");
  }

  if (isBrowser) {
    const result = await postJson<{ text: string }>('/api/ai/generate-lyrics', {
      style: normalizedStyle,
    }, {
      signal: options.signal,
    });
    return result.text;
  }

  const { ThinkingLevel } = getAI();
  const prompt = `
    请根据下面的歌曲风格与情绪描述，创作一版适合 Suno / AI 音乐生成使用的中文背景歌词。

    歌曲风格描述：
    ${normalizedStyle}

    要求：
    1. 歌词需要贴合风格描述中的情绪、题材、速度、配器、画面感或应用场景。
    2. 使用 [Verse]、[Pre-Chorus]、[Chorus]、[Bridge] 等结构标签。
    3. 歌词要适合作为背景音乐/游戏/视频配乐使用，避免过度抢戏。
    4. 保持画面感、节奏感和可唱性，副歌可以更有记忆点。
    5. 只返回歌词正文，不要解释，不要 Markdown 代码块。
  `;

  const response = await generateAiContent({
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    }
  });

  const text = response.text?.trim() || "";
  if (!text) {
    throw new Error("AI 未能生成有效歌词，请稍后重试。");
  }
  return text;
}

export interface SfxRequirementRow {
  index: number;
  filename: string;
  [key: string]: string | number;
}

const JINN_NAMING_GUIDE = `
      【Jinn 项目命名规范（优先级最高）】
      以下规则来自 Jinn 现有需求表，覆盖通用小写 snake_case 和 FMOD event:/ 路径规则：
      - ID 事件名与资源工程名采用 PascalCase 英文分段，并用下划线连接，结构为“[类别]_[对象/模块]_[动作或状态]”。首段禁止使用 SFX、Sfx、Audio 或 Sound；禁止输出 sfx_xxx、lower_snake_case、event:/SFX/... 或 Play_xxx。
      - 类别前缀按现有项目语义使用 Item、Loot、Weapon、Monster。不要擅自增加 Sfx、Audio、Sound 等通用前缀。
      - 参考命名必须作为风格锚点：Item_Pinata_DonkeyBray、Loot_Pinata_Use、Loot_Pinata_Success、Loot_WoodenPlank_Pickup、Loot_WoodenPlank_Attack、Loot_WoodenPlank_Hit、Loot_WoodenPlank_HitWall、Loot_Crowbar_Pickup、Weapon_Saif_Combo_1、Weapon_Saif_Combo_2、Weapon_Saif_ChargeMax、Weapon_Saif_AttackMax、Weapon_Saif_Hit、Weapon_Saif_HitWall、Weapon_Saif_UmmDuwais_ExecuteMonster、Monster_Spider_Idle、Monster_Spider_Walk、Monster_Spider_Webbing、Monster_Spider_Lock、Monster_Spider_Chase、Monster_Spider_BeAttacked、Monster_Spider_Attack、Monster_Spider_EnterAmbush、Monster_Spider_Ambush、Monster_Spider_StopAmbush、Monster_Spider_Dizziness、Monster_Spider_Died。
      - 动作词保持参考表中的写法与时态，例如 Pickup、Use、Success、Attack、Hit、HitWall、Idle、Walk、Webbing、Lock、Chase、BeAttacked、EnterAmbush、Ambush、StopAmbush、Dizziness、Died、Combo_1、ChargeMax、AttackMax、ExecuteMonster。不要改成同义词，也不要加入华丽形容词。
      - 命名末段必须描述“实际要制作和听到的声音行为”，不能只照搬触发条件。Hit 仅用于交付物本身是碰撞、击中或受击冲击声的情况；如果音效是在受击、惊吓或碰撞时触发的怪物叫声，必须按叫声类型命名，例如老鼠吱叫使用 Monster_Mouse_Squeak，咆哮使用 Roar，嘶叫使用 Hiss，笑声使用 Laugh，低语使用 Whisper。禁止把“老鼠受到惊吓时发出的吱叫”命名为 Monster_Mouse_Hit。
      - event_name 必须逐字复制 filename，二者使用完全相同的工程命名；禁止自行添加 Event_、SFX_、Play_ 或 event:/ 前缀。多个资源文件可以在 filename 末尾保留编号（如 _1、_2、_3 或参考文件中的 _1234），event_name 也必须保留相同编号。单个资源不要凭空补编号。
      - 若参考素材明确提供专有资源前缀，必须保留差异。例如 ID 事件名 Monster_Spider_Idle 对应的资源工程名可以是 Monster_NewSpider_Idle；没有明确前缀时不要自行添加 New。
      - 物件、战斗、怪物动作等世界声音默认填写 3D。怪物相关条目 distance_3d 默认 35，道具和武器相关条目默认 20，无法明确归类时也默认 20；只有明确是 UI 等屏幕声时才使用 2D 和“-”。playback_logic 必须明确填写 Loop 或 Once：Idle、Walk、Chase、Ambush、Dizziness 等持续状态通常为 Loop，其余瞬时动作通常为 Once。
      - 中文需求名称、描述、备注保持中文；filename 字段表示资源工程名，event_name 字段表示 ID 事件名，两者必须遵循上述英文格式。
`;

const AVATAR_NAMING_GUIDE = `
      【Avatar 项目命名规范（优先级最高）】
      - Avatar filename 只能使用以下固定模板，禁止任何其他命名形式、额外前缀或解释性词语：
        1) 三星以下且无配乐：audio_avatar_show_<CostumeName>_<CostumeId>_<Girl|Boy>
        2) 三星以上且有配乐：audio_avatar_bgm_<CostumeName>_<CostumeId>_<Girl|Boy>
        3) 三星以上且有配乐的双人：audio_avatar_bgm_<CostumeName>_<CostumeId>_Double
      - 例：服装名“秋叶”、服装 ID“20011”时，三星以下无配乐：男声必须命名为 audio_avatar_show_Qiuye_20011_Girl，女声必须命名为 audio_avatar_show_Qiuye_20011_Boy；三星以上有配乐：女声必须命名为 audio_avatar_bgm_Qiuye_20011_Girl，男声必须命名为 audio_avatar_bgm_Qiuye_20011_Boy，双人使用 audio_avatar_bgm_Qiuye_20011_Double。
      - 严格保留参考素材中的服装名和服装 ID；服装名使用首字母大写的英文单词，ID 原样保留。不要凭空编造名称或 ID。
      - 后缀映射必须按星级和配乐分档执行：三星以下无配乐时男→Girl、女→Boy；三星以上有配乐时女→Girl、男→Boy；双人始终→Double。若模板包含 event_name，必须与 filename 完全相同，不要输出 event:/、Event_、SFX_ 或 Play_。
      - 当用户提供了服装名和服装 ID 时，必须一次性输出全部有效变体，不得只输出一个：三星以下同时给出男、女 2 个命名；三星以上同时给出女、男、双人 3 个命名。三星以下没有双人模板，禁止虚构 audio_avatar_show_*_Double。
`;

const SUNNY_ISLAND_NAMING_GUIDE = `
      【小岛有晴天项目命名规范（优先级最高）】
      - 文件命名使用项目现有的类别前缀，并采用下划线分段、每个单词首字母大写：Ani、Tool、Pet、Char、Music、Npc、FWSH。
      - 保留参考表中的数字 ID 和动作写法，例如 Ani_60019_PersonalShow_Time、Pet_10070_Skill、Tool_StoreTree、Tool_RestoreTree、Char_Kingkong_Pound、Music_Suit_60024、Music_Jungle_Admin02、Npc_MonthlyPass01。
      - 单个资源不要凭空增加编号；同一动作存在多个样本时，使用末尾 _01、_02、_03。配音/台词可以把动作和变体连写，例如 Npc_MonthlyPass01_CloseA01、Npc_MonthlyPass01_CloseB01、Npc_MonthlyPass01_Collect01。
      - FWSH 是固定全大写前缀，编号格式为 FWSH_01、FWSH_02；Npc 使用 Npc（不要改成 NPC），Ani、Pet、Tool、Char、Music 也保持参考表大小写。
      - 如果参考文件名带有 .mp3 等扩展名且用户希望保留文件名，应保留扩展名；小岛有晴天命名不需要开头的 SFX 前缀，遇到 SFX_、sfx_ 或 SFX- 时必须删除；也不要新增 Audio、Sound、event:/、Play_ 等前缀，也不要输出全小写 snake_case。
      - 只要参考表、截图或用户输入中出现动作 ID、资源 ID 或明确的数字 ID，就必须把该 ID 原样放进音效 filename 的对应位置；不能只写动作名称而丢弃 ID，也不能自行改写、补造或省略 ID。
      - 事件命名优先沿用同一资源命名；如果模板包含 event_name，除非参考表明确有不同规则，否则让事件名与文件命名保持一致。
      - 命名应优先从用户给出的原始名称、类别、ID 和动作中提取信息，不要擅自改写成通用或华丽词汇。`;

const extractSunnyIslandReferenceNames = async (
  Type: any,
  referenceFile: { data: string; mimeType: string },
): Promise<string[]> => {
  if (!referenceFile.mimeType.toLowerCase().startsWith('image/')) return [];

  try {
    const response = await generateAiContent({
      contents: [{
        parts: [
          {
            text: `Inspect this screenshot of an audio requirement table for the Sunny Island project. Perform OCR on the audio naming column only. Return JSON with a names array containing every visible filename or naming token, preserving exact capitalization, underscores, numeric IDs, suffixes, and file extensions. Do not translate, normalize, summarize, or invent names. If no naming tokens are readable, return an empty array.`,
          },
          {
            inlineData: {
              data: referenceFile.data.split(',')[1] || referenceFile.data,
              mimeType: referenceFile.mimeType,
            },
          },
        ],
      }],
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 4096,
        responseSchema: {
          type: Type.OBJECT,
          required: ['names'],
          properties: {
            names: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
      },
    });
    const parsed = JSON.parse(response.text || '{}');
    return Array.isArray(parsed.names)
      ? parsed.names.filter((name: unknown): name is string => typeof name === 'string' && Boolean(name.trim())).slice(0, 200)
      : [];
  } catch (error) {
    console.warn('Sunny Island reference-name OCR skipped:', error);
    return [];
  }
};

const AVATAR_COSTUME_NAME_ALIASES: Record<string, string> = {
  '元宝': 'Yuanbao',
  '秋叶': 'Qiuye',
};

const normalizeAvatarCostumeName = (value: string) => {
  const trimmed = value.trim().replace(/[.。]+$/g, '');
  if (!trimmed) return '';
  const aliased = AVATAR_COSTUME_NAME_ALIASES[trimmed];
  if (aliased) return aliased;
  if (/[^a-zA-Z0-9 _-]/.test(trimmed)) return '';
  return trimmed
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(segment => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join('_');
};

const extractAvatarCostumeDetails = (inputText: string) => {
  const match = inputText.trim().match(
    /(?:服装名?\s*[:：]\s*)?([^\s:：,，;；]+)\s*(?:服装\s*)?ID\s*[:：]?\s*([A-Za-z0-9_-]+)/i,
  );
  if (!match) return null;
  const costumeName = normalizeAvatarCostumeName(match[1]);
  const costumeId = match[2].trim();
  if (!costumeName || !costumeId) return null;
  return { costumeName, costumeId };
};

const createAvatarRequirementItems = (inputText: string) => {
  const details = extractAvatarCostumeDetails(inputText);
  if (!details) return null;

  const variants = [
    { prefix: 'show', suffix: 'Girl', tier: '三星以下无配乐（男声）' },
    { prefix: 'show', suffix: 'Boy', tier: '三星以下无配乐（女声）' },
    { prefix: 'bgm', suffix: 'Girl', tier: '三星以上有配乐（女声）' },
    { prefix: 'bgm', suffix: 'Boy', tier: '三星以上有配乐（男声）' },
    { prefix: 'bgm', suffix: 'Double', tier: '三星以上有配乐（双人）' },
  ];

  return variants.map((variant, index) => {
    const filename = `audio_avatar_${variant.prefix}_${details.costumeName}_${details.costumeId}_${variant.suffix}`;
    return {
      index: index + 1,
      filename,
      event_name: filename,
      duration: '-',
      scene: `Avatar ${variant.tier}服装语音转换`,
      description: '按 Avatar 固定命名模板生成的角色声音资源。',
      remarks: '事件名与文件名保持完全一致。',
      video_link: '-',
      reference: '-',
      playback_logic: 'Once',
      distance_3d: '-',
    };
  });
};

export interface ExistingSfxRequirementItem {
  audio_type?: string;
  filename?: string;
  event_name?: string;
  scene?: string;
  description?: string;
  script_tone?: string;
  remarks?: string;
  tone?: string;
  script?: string;
  script_zh?: string;
  script_en?: string;
  script_ko?: string;
}

export async function generateSfxRequirements(
  inputText: string,
  referenceFile: { data: string; mimeType: string } | null,
  templateType: 'game_sfx_general' | 'game_sfx_middleware' | 'voiceover_general' | 'voiceover_multilang',
  projectName: string | null = null,
  existingItems: ExistingSfxRequirementItem[] = [],
): Promise<{ items: any[]; sourceItemCount?: number }> {
  if (referenceFile && !/^(?:image|video)\//i.test(referenceFile.mimeType)) {
    throw Object.assign(new Error('音效需求表只支持图片/截图或视频参考，不支持音频参考。'), { status: 400 });
  }
  const normalizedProjectName = projectName?.trim().toLowerCase() || '';
  const isJinnProject = normalizedProjectName === 'jinn';
  const isAvatarProject = normalizedProjectName === 'avatar';
  const isSunnyIslandProject = ['小岛有晴天', 'sunny_island', 'sunny island'].includes(normalizedProjectName);
  const useUcsSfxNaming = !normalizedProjectName && templateType.startsWith('game_sfx_');

  // Avatar names are a strict five-row template. Generate them locally when
  // the user supplied an explicit costume name and ID, so a long AI response
  // cannot be truncated before the deterministic names reach the table.
  if (isAvatarProject && !referenceFile && existingItems.length === 0) {
    const avatarItems = createAvatarRequirementItems(inputText);
    if (avatarItems) return { items: avatarItems };
  }

  if (isBrowser) {
    return postJson<{ items: any[]; sourceItemCount?: number }>('/api/ai/sfx-requirements', {
      inputText,
      screenshot: referenceFile,
      templateType,
      projectName,
      existingItems,
    });
  }

  const { Type, ThinkingLevel } = getAI();
  let schema: any;
  let templateDescription = "";

  if (templateType === 'game_sfx_general') {
    templateDescription = `
      【游戏音效配乐通用需求表模板参考1】
      该模板主要包含以下字段，请在输出 JSON 时填充：
      - index (序号): 整数，从1开始递增。
      - audio_type (类型): 必须填写 "SFX"、"BGM" 或 "VO"。音效为 SFX，背景音乐为 BGM，角色台词/旁白/字幕配音为 VO。
      - filename (文件命名): ${useUcsSfxNaming ? 'SFX 使用 Sfx_CatID_FXName，例如 Sfx_UIClick_Confirm、Sfx_FEETHmn_Wood_Heavy；Sfx_ 是必需的工程前缀，CatID 从下方 UCS 8.2.1 分类中选择。FXName 通常仅保留 1-3 个必要英文关键词，用下划线分隔、禁止空格，避免重复 CatID 已表达的类别。BGM/VO 仍用 Bgm_/Vo_ 工程命名。' : '采用下划线英文命名规范，且每个单词首字母大写。例如 Sfx_Ui_Confirm, Bgm_Battle_Loop。对象、动作只保留必要关键词，详细听感写入 description。'}只有同一基础音效存在多个变体/随机样本时才添加尾号；如果该类型只有一个音效，不要添加尾号。
      - duration_logic (时长&播放逻辑): 声效时长描述及触发/播放逻辑，例如 "1s, 单次播放", "10s, 循环播放", "3s, 随机多样本触发"。
      - scene (应用场景): 说明具体对象、动作/交互、触发节点及必要的结束条件；例如“设置页确认按钮点击且操作被接受时触发一次，与按钮按下反馈同步”，禁止只写“UI界面”或“游戏中”。
      - description (描述): 按实际要听到的声音行为描述声源/材质、起音、主体变化和尾音，再按需要补充力度、速度、层次与空间；用 2-3 个简洁分句给出可制作的方向，避免只有“清脆、震撼、有质感”等形容词。
      - script (台词): SFX/BGM 行填 "-"；VO 行必须填写识别到或创作出的台词文案，不要混入语气说明。
      - tone (语气): SFX/BGM 行填 "-"；VO 行填写情绪、语速、口吻、年龄感、性别倾向等表演提示，例如 "沉稳、亲切、略带科技感"。
      - remarks (备注): 混音、响度或音频程序实现的注意事项，如 "链接&视频说明" 或 "需要混响衰减处理"。
      - video_link (动效视频): 默认为 "链接&视频说明" 或类似视频占位说明。
    `;
    schema = {
      type: Type.OBJECT,
      required: ["items"],
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ["index", "audio_type", "filename", "duration_logic", "scene", "description", "script", "tone", "remarks", "video_link"],
            properties: {
              index: { type: Type.INTEGER },
              audio_type: { type: Type.STRING },
              filename: { type: Type.STRING },
              duration_logic: { type: Type.STRING },
              scene: { type: Type.STRING },
              description: { type: Type.STRING },
              script: { type: Type.STRING },
              tone: { type: Type.STRING },
              remarks: { type: Type.STRING },
              video_link: { type: Type.STRING }
            }
          }
        }
      }
    };
  } else if (templateType === 'game_sfx_middleware') {
    templateDescription = `
      【游戏音效需求表模板参考2（应用到FMOD,WWISE音频中间件引擎的需求表）】
      该模板主要包含以下字段，请在输出 JSON 时填充：
      - index (序号): 整数，从1开始递增。
      - filename (文件命名): ${isJinnProject ? 'Jinn 资源工程名，严格遵循文末 Jinn 项目命名规范。' : isAvatarProject ? 'Avatar 服装音频名，只能使用文末 Avatar 固定模板。' : isSunnyIslandProject ? '小岛有晴天资源名，严格遵循文末小岛有晴天项目命名规范。' : useUcsSfxNaming ? 'SFX 使用 Sfx_CatID_FXName，例如 Sfx_UIClick_Confirm、Sfx_FEETHmn_Wood_Heavy。保留 Sfx_ 工程前缀和真实 UCS CatID，FXName 通常仅保留 1-3 个必要英文关键词，用下划线分隔、禁止空格，避免重复类别；仅同一音效多个变体才加编号。' : '采用下划线英文命名规范，且每个单词首字母大写。如 Sfx_Player_Dash。只有同一基础音效存在多个变体/随机样本时才使用 _01/_02/_03，例如 Sfx_Footstep_Grass_01。'}
       - event_name (事件命名): ${isJinnProject ? 'Jinn ID 事件名必须逐字复制 filename，不使用 event:/、Event_、SFX_ 或 Play_ 前缀；多个编号资源也保留与 filename 相同的编号。' : isAvatarProject ? 'Avatar ID 事件名必须逐字复制 filename，只能使用文末 Avatar 固定模板，不使用 event:/ 路径。' : isSunnyIslandProject ? '小岛有晴天事件名优先沿用同一资源命名；除非参考表明确不同，否则与 filename 保持一致。' : '音频中间件事件路径规范。如 "event:/SFX/Player/dash" 或 "Play_sfx_player_dash"；只有多个变体时才在末尾编号。'}
      - duration (时长): 预估的时长，如 "0.5s", "12s", "loop"。
      - scene (应用场景): 写明具体声源、动作/状态、动画或交互触发节点；持续声补充开始/停止条件，与 playback_logic 的单次/循环及 2D/3D 保持一致。无依据时不要捏造秒数或帧号。
      - description (描述): 给出实际声音行为、材质交互、起音/主体/尾音、力度与速度；必要时说明分层及近远空间关系。说明设计目标，不重复场景文字，也不要只堆砌“有冲击力”等空泛形容词。
      - remarks (备注): 声音备注或技术要点，如 "需要加入 3D 空间衰减 (Spatialization)"。
      - video_link (动效视频): 占位说明或对应动效分镜视频。
      - reference (参考): 参考音频链接或灵感来源，如 "参考《尼尔：机械纪元》闪避声效"。
      - playback_logic (播放逻辑): 音频在引擎中的播放/触发参数逻辑，如 "3D 空间，设置随机音高 (Pitch)"。
      - distance_3d (3D距离): ${isJinnProject ? '遵循 Jinn 参考表：怪物相关默认 35，道具和武器相关默认 20，无法明确归类时也默认 20；2D 屏幕声填写 "-"。' : '3D空间最大衰减距离（如果是3D事件，必须增加一个3D距离，默认是 "20"；如果是2D事件则设置为 "-"）。'}
    `;
    schema = {
      type: Type.OBJECT,
      required: ["items"],
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ["index", "filename", "event_name", "duration", "scene", "description", "remarks", "video_link", "reference", "playback_logic", "distance_3d"],
            properties: {
              index: { type: Type.INTEGER },
              filename: {
                type: Type.STRING,
                description: isJinnProject ? 'Jinn 资源工程名，例如 Loot_WoodenPlank_HitWall' : isAvatarProject ? 'Avatar 固定模板，例如 audio_avatar_show_Qiuye_20011_Girl' : isSunnyIslandProject ? '小岛有晴天资源名，例如 Pet_10070_Skill 或 Npc_MonthlyPass01_CloseA01' : undefined,
              },
              event_name: {
                type: Type.STRING,
                description: isJinnProject ? 'Jinn ID 事件名必须与 filename 完全相同，例如 Loot_WoodenPlank_HitWall_1234；禁止 Event_、SFX_ 和 event:/ 前缀' : isAvatarProject ? 'Avatar ID 事件名必须与 filename 完全相同，例如 audio_avatar_bgm_Qiuye_20011_Double' : isSunnyIslandProject ? '小岛有晴天事件名优先与 filename 完全相同，例如 Npc_MonthlyPass01_Collect01' : undefined,
              },
              duration: { type: Type.STRING },
              scene: { type: Type.STRING },
              description: { type: Type.STRING },
              remarks: { type: Type.STRING },
              video_link: { type: Type.STRING },
              reference: { type: Type.STRING },
              playback_logic: { type: Type.STRING },
              distance_3d: { type: Type.STRING }
            }
          }
        }
      }
    };
  } else if (templateType === 'voiceover_general') {
    templateDescription = `
      【配音需求表模板1】
      该模板主要包含以下字段，请在输出 JSON 时填充：
      - index (序号): 整数，从1开始递增。
      - scene (应用场景): 触发台词的具体关卡、动画或时机，如 "主角击杀首领后的剧情独白"。
      - tone (语气描述): 语气与角色心理描述，如 "沉重而略带自嘲，缓缓道来"。
      - filename (文件命名): 配音文件使用下划线英文命名规范，且每个单词首字母大写，如 "Vo_Chapter1_Monologue"。只有同一角色/场景下有多句同类变体时才使用 _01/_02/_03。
      - script (台词文案): 角色要说的中文台词内容。
    `;
    schema = {
      type: Type.OBJECT,
      required: ["items"],
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ["index", "scene", "tone", "filename", "script"],
            properties: {
              index: { type: Type.INTEGER },
              scene: { type: Type.STRING },
              tone: { type: Type.STRING },
              filename: { type: Type.STRING },
              script: { type: Type.STRING }
            }
          }
        }
      }
    };
  } else {
    templateDescription = `
      【配音需求表模板2（多语种）】
      该模板主要包含以下字段，请在输出 JSON 时填充：
      - index (序号): 整数，从1开始递增。
      - filename (文件命名): 配音文件使用英文下划线命名规范，且每个单词首字母大写，如 "Vo_Npc_Guide_Greet"。只有同一角色/场景下有多句同类变体时才使用 _01/_02/_03。
      - scene (应用场景): 触发场景，如 "新手村向导NPC首次与玩家对话"。
      - tone (语气描述): 语气描述，如 "热情、亲切，带有温暖的笑意"。
      - script_zh (台词文案（简中）): 简体中文台词文案，如 "旅行者，欢迎来到晨曦之城！这里的阳光永远璀璨。"。
      - script_en (英语): 翻译或生成的专业英文台词文案，必须自然优雅，切合游戏世界观，如 "Greetings, traveler! Welcome to Aurelia, where the sun never sets."。
      - script_ko (韩语): 翻译或生成的专业韩语台词文案，例如 "여행자여, 여명의 도시에 오신 것을 환영합니다! 이곳의 태양은 영원히 빛납니다."。
    `;
    schema = {
      type: Type.OBJECT,
      required: ["items"],
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ["index", "filename", "scene", "tone", "script_zh", "script_en", "script_ko"],
            properties: {
              index: { type: Type.INTEGER },
              filename: { type: Type.STRING },
              scene: { type: Type.STRING },
              tone: { type: Type.STRING },
              script_zh: { type: Type.STRING },
              script_en: { type: Type.STRING },
              script_ko: { type: Type.STRING }
            }
          }
        }
      }
    };
  }

  // Ask the visual model to expose the number of rows it actually read from a table or
  // checklist reference. The UI uses this only to remove hallucinated rows;
  // ordinary visual references return 0 and remain unconstrained.
  schema.required = Array.from(new Set([...(schema.required || []), 'sourceItemCount']));
  schema.properties.sourceItemCount = {
    type: Type.INTEGER,
    description: '仅当上传参考文件是需求表、表格或清单截图且能数清数据行时，填写不含表头的实际数据行数；普通图片、视频或纯文字需求填写 0。',
  };

  const hasTextInput = inputText.trim().length > 0;
  const inputInterpretationInstruction = hasTextInput
    ? `
    【当前输入识别重点：用户输入的是自然语言需求文本】
    本次必须优先分析“用户输入要求”里的自然语言内容，而不是按模板示例自由扩写。
    请把用户输入的一段话拆成一张真正可制作、可分配给声音设计师的需求表：
    - 先识别文本中明确提到的每一个声音交付物：音效、环境氛围、BGM/音乐、配音/旁白/字幕台词、UI反馈、角色动作、道具、技能、怪物、场景机关等。
    - 一行只对应一个可制作的声音资产或一组强相关随机样本；不要把多个不相关声音塞进同一行。
    - 如果一句话里用“包含、以及、还有、/、顿号、逗号、换行、编号”列出多个需求，必须拆成多行。
    - 如果文本是剧情/玩法描述，而不是清单，请只提取其中“画面上或交互中确实会发生、需要声音反馈”的事件；不要生成无关的通用游戏音效库。
    - 如果用户给了具体数量、风格、时长、情绪、角色、语种、是否循环、是否随机多样本、是否 3D、参考作品等约束，必须写入对应字段。
    - 如果用户说“不需要、去掉、不要、仅、只要”，必须严格遵守，不要把排除项生成出来。
    - 对不确定的信息可以在 remarks 里写“待确认/建议”，但不要凭空编造角色名、关卡名或与原文无关的资产。
    - 当用户输入已经很具体时，items 数量应接近文本中可识别的需求数量；不要自动扩展成 6-10 条模板化内容。
    - 当用户输入很抽象，例如“做一套末日游戏音效表”，才可以头脑风暴生成 6-10 条典型条目。
    - 输出的 scene 必须说明触发时机；description 必须说明声音材质和听感；filename 必须来自真实触发对象/动作，而不是从华丽描述词里硬凑。
    `
    : `
    【当前输入识别重点：用户没有提供明确文字需求】
    如果也没有上传参考文件，请按所选模板生成一套 6-10 条典型专业示例需求；如果上传了参考文件，请以参考文件内容为主。
    `;

  const sunnyIslandReferenceNames = isSunnyIslandProject && referenceFile
    ? await extractSunnyIslandReferenceNames(Type, referenceFile)
    : [];
  const sunnyIslandReferenceContext = sunnyIslandReferenceNames.length > 0
    ? `
    SUNNY ISLAND OCR NAMING LOCK:
    The following names were read from the uploaded screenshot. Treat them as source-of-truth naming tokens. Preserve every visible numeric ID in the corresponding generated filename; do not drop an ID merely because it is not part of the action word. Match rows by their visible object/action context and keep variants such as _01, CloseA01, Collect01. Never add an SFX prefix.
    ${JSON.stringify(sunnyIslandReferenceNames)}
  `
    : '';
  const existingItemsForPrompt = existingItems
    .slice(0, 80)
    .map((item, index) => ({
      index: index + 1,
      type: item.audio_type || '',
      filename: item.filename || '',
      event_name: item.event_name || '',
      scene: item.scene || '',
      description: item.description || '',
      script: item.script || item.script_tone || item.script_zh || '',
      remarks: item.remarks || item.tone || '',
    }))
    .filter(item => Object.values(item).some(value => String(value || '').trim()));
  const appendDedupInstruction = existingItemsForPrompt.length > 0
    ? `
    【继续添加模式：已有需求排重约束】
    当前需求表里已经有以下条目，本次只允许根据“新加入的文字描述或新上传的参考文件”生成新增需求；禁止把这些已有条目换个说法再次输出。
    判断重复时不要只看 filename，也要看应用场景、声音对象、动作、描述、台词和 BGM 用途；含义相同就算重复。
    如果用户没有提供任何新需求，或本次输入只能识别出已有需求，请返回空 items 数组，不要为了凑数生成重复或泛化条目。
    已有需求摘要：
    ${JSON.stringify(existingItemsForPrompt)}
    `
    : '';

  const sfxDesignInstruction = templateType.startsWith('game_sfx_') ? `
    【音效分析与命名顺序】
    先在内部梳理“输入证据 → 具体触发事件 → 实际发声行为 → 制作描述”，最后才提炼 filename；只输出最终表格，不输出推理过程。
    - scene 回答“谁/什么，在什么场景或状态，发生什么动作，在哪个节点触发声音”。优先利用用户文字、可见画面和参考表已有信息；单张图片不能确定的动作时序只写建议，不编造时间码。
    - 区分触发原因和声音本体：受惊触发的老鼠吱叫应描述短促高频吱叫，不可误写成撞击声；UI 成功反馈也不能擅自变成金币拾取声。分类与 filename 必须对应实际声音本体。
    - description 回答“具体怎么做、怎么听”：材质/发声方式、起音瞬态、主体的节奏/音高/力度变化、尾音衰减；按声音需要选取关键维度，用 2-3 个分句描述。持续氛围说明层次与变化密度；瞬时动作突出接触点与尾音。无需把所有维度逐项凑满。
    - 描述是设计方向，不代表已听过音频。参考中明确的信息按原意保留；不确定的材质、空间、力度只能标“建议”，未知触发条件在 remarks 标“待确认”。禁止编造具体角色、物件、时间或现有音色事实。
    - duration/duration_logic 写时长、单次/循环与变体需求；remarks/playback_logic 写同步、防重复触发、随机采样、打断/停止或空间化等真正必要的实现要点。各字段互相补充，不重复粘贴同一段话，不无端添加未要求的音层、音乐或配音。
    - 示例（用户明确“木门缓慢打开，铰链吱响，末尾锁扣轻响”）：scene 可写“木门由关闭转为缓慢开启时触发，铰链吱响跟随开门过程，锁扣声对齐末端动作”；description 可写“建议以干涩、断续的铰链摩擦为主体，随开启速度轻微起伏；末端一声短促锁扣轻响，自然收尾”。命名只提炼门/开启，细节留在描述内。
    - 输出前逐行复核：场景触发是否具体？声音描述是否足以让设计师制作？两者是否指向同一声音？没有依据的细节是否标为建议/待确认？保持原有需求数量约束，不因补充分析增加无关条目。
  ` : '';
  const conciseNamingInstruction = !normalizedProjectName && templateType.startsWith('game_sfx_') ? `
    【精简命名要求】
    - SFX 采用 Sfx_CatID_FXName，FXName 通常只用 1-3 个必要英文关键词；BGM/VO 保留既有前缀，后接必要的场景/角色与动作/状态。新生成的名称尽量在 48 个字符以内。
    - 优先保留能区分资产的对象/用途、动作及必要材质；不把描述中的起音、频段、尾音、空间或修饰词全部塞进文件名。CatID 已说明的类别无需在 FXName 重复。
    - 例如 Sfx_UIClick_Confirm_Button_Click 精简为 Sfx_UIClick_Confirm；Sfx_FEETHmn_Wood_Heavy_Footstep 精简为 Sfx_FEETHmn_Wood_Heavy。但若需区分行走/奔跑，则应保留 Walk/Run 等差异，不能为了短而丢失用途或产生同名。
    - 单个声音不添加序号；真实的变体编号、用户锁定的成熟名称和必要 ID 原样保留。多行最终名称不得重名，需要区分时添加有意义的对象/动作/材质差异，真实多变体才用编号。不要机械截断文件名或使用难懂的自造缩写。
  ` : '';

  const prompt = `
    你是一个顶级的游戏音频总监、声音设计师和配音导演。
    你的任务是：根据用户输入的文字描述、或上传的参考文件（图片/截图、视频画面），进行高品质的识别、结构化重构、工程化规范命名、以及专业化的填充和优化。最终生成一张完美格式的、可以直接用于项目开发、给外包和合作团队看的专业“音效/配音需求表”。

    ${inputInterpretationInstruction}
    ${sunnyIslandReferenceContext}
    ${appendDedupInstruction}
    ${sfxDesignInstruction}
    ${conciseNamingInstruction}

    请严格遵守以下规则进行处理：
    1. **多模态输入识别与需求数量控制**：
       - **图片/截图/表格草稿**：如果上传文件是已有需求表、表格截图、手写/截图清单，请先逐行 OCR，排除表头、合计行和空白行，数出实际数据行，并将该数字写入 \`sourceItemCount\`；重构和优化时 \`items\` 数组必须与原输入条目数量 1:1 对应，\`items.length\` 必须等于 \`sourceItemCount\`，绝不能为了补充专业建议而额外增加行。
       - 如果截图中的数据行无法可靠数清，\`sourceItemCount\` 填 0，不要猜测；此时仅按能确认的条目输出，不要添加截图中没有的需求。
       - **普通图片/视觉参考图**：如果上传文件不是表格，而是画面、角色、场景、UI 或概念图，请根据画面内容生成适合当前模板的音乐/音效/配音需求，不要求 1:1。
       - **视频文件**：视频只分析画面、镜头节奏、角色动作、UI变化、场景氛围和画面中的可见字幕；不分析视频内嵌音频。不要根据视频原声推断音乐或音效，也不要声称听过原声。
       - **视频字幕 / 配音需求混合输出**：如果视频画面中有字幕，或用户文字/参考文件里出现角色台词、旁白、对白、播报、引导语、口语化文案等配音需求，必须识别字幕内容和语境，并生成对应 VO 配音需求。即使当前选择的是“游戏音效配乐通用表”或其它音效/BGM模板，也不能忽略配音需求；通用表里请把音效、BGM、VO 放在同一个 items 数组中，VO 行使用 \`Vo_\` 文件名，\`audio_type\` 填 \`VO\`，\`script\` 只填写台词文案，\`tone\` 单独填写语气和表演提示。
       - **同一素材的一次性综合需求**：同一个视频、图片或文字需求可能同时包含 SFX、BGM 和 VO。除非用户明确只要某一种类型，否则请一次性输出素材中可识别的所有音频需求，避免让用户反复切模板才能得到完整结果。
       - **空泛输入或只选模板**：当用户没有提供具体列表、表格或参考文件，只选择模板或输入非常抽象的提示词时，自动头脑风暴生成 6-10 行典型专业条目。

    2. **文件名命名优化与直接保留**：
       - 如果用户输入或上传的参考文件/草稿表格中**本身就带有文件命名或名称**（如 \`sfx_click\`, \`bg_battle\`, \`刀剑砍击声\` 等）：
         - ${isJinnProject ? '必须按 Jinn 参考规范优化为 PascalCase 分段命名，并优先保留素材中已经出现的 Item、Loot、Weapon、Monster、对象名和动作词。' : isAvatarProject ? '必须按 Avatar 固定模板生成小写 audio_avatar_show 或 audio_avatar_bgm 命名，并保留服装名、服装 ID 与性别/双人后缀；禁止任何其他格式。' : isSunnyIslandProject ? '必须按小岛有晴天参考规范保留 Ani、Tool、Pet、Char、Music、Npc、FWSH 前缀、数字 ID 和动作词；多变体才追加 `_[序号]`，配音可使用 CloseA01、Collect01 等组合。' : useUcsSfxNaming ? 'SFX 保留原名描述语义，统一使用 Sfx_CatID_FXName，CatID 取下方真实 UCS 分类；BGM/VO 保持现有工程命名。' : '必须使用下划线分隔的英文命名，并确保每个单词首字母大写（如 `Sfx_Ui_Button_Click`）；多变体时才追加 `_[序号]`。'}
         - 如果用户提供的命名已经相当成熟、合理或带有特定的版本代号，你应当**直接使用和保留**给到的命名；
         - 确保优化的命名与原始名称的意图保持强关联，不得凭空捏造全新的无关名称。

    3. **专业化设计与规范**：
       ${isJinnProject ? JINN_NAMING_GUIDE : isAvatarProject ? AVATAR_NAMING_GUIDE : isSunnyIslandProject ? SUNNY_ISLAND_NAMING_GUIDE : useUcsSfxNaming ? `- **UCS ${UCS_CATALOG_VERSION} 音效分类命名**：只有 SFX 行使用 Sfx_CatID_FXName，例如 Sfx_UIClick_Confirm。Sfx_ 为固定工程前缀，仅添加一次；CatID 必须从下方完整目录逐字选择并保留精确大小写，按声音本身所属类别选择，不能编造 CatID。FXName 通常只用 1-3 个必要英文关键词，不重复类别信息；英文单词以下划线分隔，禁止空格（例如 Sfx_FEETHmn_Wood_Heavy）；同一基础音效多个变体才追加 _01、_02 等编号。未提供 CreatorID 或 SourceID，不要编造这两个字段。BGM 和 VO 不是 UCS 音效分类，继续使用 Bgm_[Scene]_[StyleOrState] 与 Vo_[SpeakerOrRole]_[Intent]。中间件 event_name 仍保持现有事件路径规则，不照抄文件名。
       - **UCS ${UCS_CATALOG_VERSION} 分类目录 (CatID:Category/SubCategory)**：${UCS_CATALOG_PROMPT}
       - **语义准确**：优先根据应用场景和声音内容选分类；如果没有可靠分类，不要随便填 Misc，明确无法分类。` : `- **工程化文件命名 (filename)**：禁止用中文命名文件。所有文件名必须使用下划线分隔，并确保每个单词首字母大写。
         格式：\`[Sfx / Bgm / Vo]_[模块]_[动作/角色]_[描述]\`；只有同一基础音效/台词存在多个变体、随机样本、连号资产时，才追加 \`_[序号]\`。
         例如：单个确认点击用 \`Sfx_Ui_Confirm\`，单个战斗 BGM 用 \`Bgm_Battle_Loop\`，单句旁白用 \`Vo_Narrator_Intro\`；多个脚步随机样本才用 \`Sfx_Footstep_Grass_01\`、\`Sfx_Footstep_Grass_02\`、\`Sfx_Footstep_Grass_03\`。
       - **命名必须简约、明确、语义准确**：filename 必须优先从“应用场景/触发时机”里提取真实模块、页面、对象和动作；“描述”只用于理解音色、材质、情绪和制作方式，不能把描述里的装饰性词汇误当成文件名主体。
         命名优先级：应用场景/触发时机 > 原始名称 > 描述。除非“应用场景”明确说是金币、奖励、宝箱、道具拾取，否则不要因为描述中出现“金色闪光、金币质感、奖励感”等词，就在 filename 里加入 \`gold\`、\`coin\`、\`reward\`。
         例如应用场景是“升级成功提示/升级完成反馈”，即使描述里写了“金色粒子、奖励闪光”，也应命名为 \`Sfx_Ui_Upgrade_Success\`，不要命名为 \`Sfx_Ui_Upgrade_Gold\` 或 \`Sfx_Ui_Upgrade_Success_Gold\`。
       UI 音效推荐格式：\`Sfx_Ui_[ScreenOrWidget]_[Action]\`，例如“升级页打开”应命名为 \`Sfx_Ui_Upgrade_Page_Open\`，而不是 \`Sfx_Ui_Button\` 或 \`Sfx_Ui_Click_01\`。
         常用 action 词优先使用：\`open\`, \`close\`, \`click\`, \`confirm\`, \`cancel\`, \`select\`, \`switch\`, \`unlock\`, \`upgrade\`, \`reward\`, \`popup\`, \`warning\`, \`error\`。
         BGM 推荐格式：\`Bgm_[Scene]_[StyleOrState]\`；配音推荐格式：\`Vo_[SpeakerOrRole]_[Intent]\`。
         所有单词首字母必须大写，使用下划线分隔，不输出全小写 snake_case。
       - **FMOD/Wwise 事件路径命名 (event_name)**：如果是音频中间件模板，对应的事件必须有规范的虚空间路径格式，例如：\`event:/SFX/Player/jump\` 或 \`event:/VO/Hero/attack\`。`}
       - **时长与播放逻辑**：用声效术语编写，例如 "1s, 单次播放", "loop, 循环播放"。
       - **3D 距离规范 (distance_3d)**：${isJinnProject ? '严格使用 Jinn 参考规则：怪物相关默认 `"35"`，道具和武器相关默认 `"20"`，无法明确归类时也默认 `"20"`；明确的 2D 屏幕声填写 `"-"`。' : '对于 FMOD/Wwise 中间件需求表，如果是 3D 事件（如备注或播放逻辑里包含 3D 空间、3D 空间定位等），必须在 `distance_3d` 中增加一个 3D 距离，默认值为 `"20"`（或根据音量、场景大小评估为 "15", "30" 等数字字符串）；如果是 2D 事件，则该字段输出为 `"-"`。'}
       - **多语种台词生成**：在多语种配音模板下，根据简中台词，翻译并创作出对应的英语台词和韩语台词。台词要带有文学色彩、符合游戏中的魔幻/科幻/写实风格，不能是粗暴的机器人机翻。
       - **通用表中的 VO 行**：当模板是“游戏音效配乐通用表”时，配音需求不要丢弃；请把配音行作为普通综合音频需求行输出，\`audio_type\` 为 \`VO\`，\`filename\` 使用 \`Vo_[SpeakerOrRole]_[Intent]\`，\`description\` 写声音角色/声线方向，\`script\` 只写台词文案，\`tone\` 单独写语气、情绪、语速和表演提示，\`remarks\` 写配音制作、口型、情绪或交付注意事项。
       - **通用表排序规则**：当模板是“游戏音效配乐通用表”时，输出顺序不要跟随用户文字描述顺序；必须先集中输出所有 SFX，再输出所有 BGM，最后输出所有 VO/人声/配音/台词需求。同一大类内部再保留需求的自然逻辑顺序。

    4. **输出格式**：
       - 必须输出符合以下模板要求的 JSON 数组。
       - 所有模板的 filename 和 event_name 均禁止空格，单词之间使用半角下划线；保留项目规定的大小写、前缀、ID 及事件路径结构。description、scene、台词等自然语言字段正常保留空格。
       - 文件名短、分析具体：scene 尽量控制在 100 个中文字符内，description 用 2-3 个分句且尽量在 160 个中文字符内，remarks、script、tone 尽量在 120 个中文字符内。避免套话和重复，但不能为了短而省掉关键触发、声音变化或用户原有约束；用户原台词不得截断。除非用户原始表格本身包含更多条目，否则一次最多输出 24 行。
       - 视频字幕类 VO 行不要重复写长段分析；优先保留台词、语气、时间/场景和制作注意事项。
       ${templateDescription}

    ${isJinnProject
      ? '当前项目：Jinn。严格执行上方“Jinn 项目命名规范（优先级最高）”，不得回退到通用命名。'
      : isAvatarProject
        ? '当前项目：Avatar。严格执行上方“Avatar 项目命名规范（优先级最高）”，不得回退到通用命名。'
        : isSunnyIslandProject
          ? '当前项目：小岛有晴天。严格执行上方“小岛有晴天项目命名规范（优先级最高）”，不得回退到通用命名。'
        : projectName
          ? `当前项目：${projectName}。请优先参考该项目的专有命名习惯；目前尚未提供该项目的具体规则，不要凭空捏造专有词汇，先沿用通用工程命名规范，并保留项目名称作为上下文。`
          : `当前未指定项目，${useUcsSfxNaming ? `SFX 使用 Sfx_ 工程前缀加 UCS ${UCS_CATALOG_VERSION} 分类命名，BGM/VO 沿用工程命名。` : '请使用通用工程命名规范。'}`}

    用户输入要求：${inputText || "请根据上传参考文件生成；如果没有参考文件，则自动生成该类型游戏的标准专业需求表"}
  `;

  const parts: any[] = [{ text: prompt }];
  if (referenceFile) {
    parts.push({
      inlineData: {
        data: referenceFile.data.split(',')[1] || referenceFile.data,
        mimeType: referenceFile.mimeType
      }
    });
  }

  for (let attempt = 0; attempt < (useUcsSfxNaming ? 2 : 1); attempt++) {
    const response = await generateAiContent({
      contents: [{ parts: attempt === 0 ? parts : [
        ...parts,
        { text: '上次返回含无效 UCS CatID。请重新生成完整 JSON；每条 SFX 的 filename 格式必须为 Sfx_CatID_FXName，Sfx_ 后使用本提示中的真实 CatID。BGM/VO 不使用 CatID。' },
      ] }],
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 12_288,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseSchema: schema
      }
    });

    if (!response.text) throw new Error("AI 未能生成有效的内容，请检查您的输入或重试");

    let parsed: { items?: Record<string, unknown>[]; sourceItemCount?: unknown };
    try {
      parsed = JSON.parse(response.text);
    } catch (error) {
      console.error('需求表 JSON 解析失败:', { length: response.text.length, error });
      throw new Error("AI 返回的需求表结果过长或格式不完整，请减少需求数量后重试。");
    }
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const checked = useUcsSfxNaming
      ? normalizeUcsRequirementItems(items, templateType)
      : { items: normalizeRequirementEngineeringNames(items), invalid: [] };
    if (checked.invalid.length) {
      if (attempt === 0) continue;
      throw new Error(`AI 未能为第 ${checked.invalid.join('、')} 行选出有效 UCS ${UCS_CATALOG_VERSION} 分类，请调整音效描述后重试。`);
    }
    const sourceItemCount = Number.parseInt(String(parsed.sourceItemCount ?? 0), 10);
    return {
      items: checked.items,
      sourceItemCount: Number.isFinite(sourceItemCount) && sourceItemCount > 0
        ? Math.min(sourceItemCount, 100)
        : 0,
    };
  }
  throw new Error('UCS 分类校验失败，请重试。');
}

export interface OptimizedImportItem {
  id: string;
  name: string;
  fileName: string;
  category: string;
  subcategory?: string;
  tags: string[];
}

export async function optimizeImportMetadata(
  items: Array<{ id: string; originalName: string; path: string; size: string; type: string }>
): Promise<OptimizedImportItem[]> {
  if (isBrowser) {
    const result = await postJson<{ items: OptimizedImportItem[] }>('/api/ai/optimize-metadata', { items });
    return result.items;
  }

  const { Type } = getAI();
  const schema = {
    type: Type.OBJECT,
    required: ["items"],
    properties: {
      items: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ["id", "name", "fileName", "category", "subcategory", "tags"],
          properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING },
            fileName: { type: Type.STRING },
            category: { type: Type.STRING },
            subcategory: { type: Type.STRING },
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          }
        }
      }
    }
  };

  const prompt = `
    你是一个顶级的音频资源管理专家和AI声音设计师。
    现在用户上传了一批音效文件（可能来自某个文件夹，包含相对路径）。
    根据原始中文/英文文件名及相对路径的语义，进行音效 UCS ${UCS_CATALOG_VERSION} 命名、分类、二级子分类、中文显示名称及标签生成。你没有听到音频，不能声称根据听感分析；名称不足以判断时不要猜测声音内容。

    输入的文件列表信息如下：
    ${JSON.stringify(items, null, 2)}

    处理规范：
    1. **主分类 (category)**：必须只能是以下七个大类之一：
       - "角色与拟音"
       - "武器与战斗"
       - "魔法与奇幻"
       - "怪兽与生物"
       - "环境与声景"
       - "系统与界面"
       - "全部音乐"
    2. **二级子分类 (subcategory)**：必须只能属于以下二级类别之一：
       - "角色与拟音" 对应的子类："角色动作", "脚步材质", "肢体装束", "人声拟音"
       - "武器与战斗" 对应的子类："冷兵器砍击", "物理碰撞", "枪械与射击", "爆炸与重低音"
       - "魔法与奇幻" 对应的子类："元素魔法", "增益减益", "奇幻护盾"
       - "怪兽与生物" 对应的子类："怪兽咆哮", "怪物受击", "异形生物"
       - "环境与声景" 对应的子类："自然环境", "空间背景", "点声源(Emitter)"
       - "系统与界面" 对应的子类："UI 反馈", "胜利奖励", "警报失败"
       - "全部音乐" 对应的子类："史诗交响", "赛博电子", "国风仙侠", "日常休闲", "战斗热血", "惊悚悬疑"
    3. **工程化文件命名 (fileName)**：
       - 音效使用 UCS ${UCS_CATALOG_VERSION} 类别前缀命名 \`CatID_FXName.原扩展名\`，例如 \`UIClick_Confirm Button.wav\`、\`FOLYFeet_Grass Footstep 01.ogg\`。CatID 必须从下面的目录逐字选取，保留精确大小写；FXName 用英文表达原始文件名中的声音对象、动作、材质，不含下划线。不能输出 \`sfx_\`、编造 CatID 或笼统的 Asset/Sound 占位名。
       - 仅同一基本音效的不同样本才保留原有编号或在 FXName 末尾用空格添加编号；不要无理由给每个文件编号。
       - UCS 只用于音效，不用于音乐。音乐使用 \`Bgm_[SceneOrStyle]_[Description].原扩展名\`，不要加 UCS CatID。
       - 扩展名必须和每个原始文件一致；没有提供 CreatorID/SourceID 时不要编造。
       - UCS 分类目录 (CatID:Category/SubCategory)：${UCS_CATALOG_PROMPT}
    4. **中文显示名称 (name)**：
       - 清爽、直观的中文描述性名称。
       - 例如：将 "UI_click_01_confirm_alt.wav" 改为 "UI 清脆确认点击音"；将 "slash_iron_metal.wav" 改为 "刀剑重击金属摩擦声"。
    5. **标签 (tags)**：
       - 仅提取文件名及目录明确提供的场景、对象、动作、材质等标签，不要臆测听感或声学特征。
       - 每个文件生成 3-5 个短标签。例如：["金属", "写实", "硬撞击", "清脆"]。

    请将列表中的每一项进行智能转换，并且必须保留和返回对应的 \`id\`（以便客户端能够精确匹配回对应的文件）。
  `;

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await generateAiContent({
      contents: [{ parts: [{ text: prompt + (attempt ? '\n上次命名未通过校验。重新生成完整列表，严格使用真实 UCS CatID 并保持各自原扩展名。' : '') }] }],
      config: { responseMimeType: "application/json", responseSchema: schema }
    });
    if (!response.text) throw new Error("AI 批量优化未能生成有效的内容，请重试");
    let parsed: { items?: OptimizedImportItem[] };
    try {
      parsed = JSON.parse(response.text);
    } catch {
      throw new Error("AI 批量优化返回的数据格式有误，请重试");
    }
    const returned = Array.isArray(parsed.items) ? parsed.items : [];
    const byId = new Map(returned.map(item => [item.id, item]));
    const validCategories = new Set(['角色与拟音', '武器与战斗', '魔法与奇幻', '怪兽与生物', '环境与声景', '系统与界面', '全部音乐']);
    const valid = returned.length === items.length && byId.size === items.length && items.every(source => {
      const result = byId.get(source.id);
      if (!result || !result.name?.trim() || !Array.isArray(result.tags) || !validCategories.has(result.category)) return false;
      const extension = source.originalName.match(/\.(wav|mp3|ogg|flac|m4a|aac)$/i)?.[0].toLowerCase();
      if (!extension) return false;
      if (result.category === '全部音乐') {
        return isBgmImportFileName(result.fileName, source.originalName);
      }
      return normalizeUcsImportFileName(result.fileName, source.originalName) !== null;
    });
    if (valid) return items.map(source => {
      const result = byId.get(source.id)!;
      return result.category === '全部音乐'
        ? result
        : { ...result, fileName: normalizeUcsImportFileName(result.fileName, source.originalName)! };
    });
  }
  throw new Error(`AI 未能生成有效的 UCS ${UCS_CATALOG_VERSION} 文件名；请检查原文件名是否足以判断音效内容，再重试。`);
}

export async function translateToEnglish(text: string): Promise<string> {
  if (!text || !text.trim()) return "";
  
  // Quick check: if already only alphanumeric, spaces, and basic punctuation, return as-is
  if (/^[a-zA-Z0-9\s\.,!\?'"\(\)\-\/]*$/.test(text)) {
    return text.trim();
  }

  if (isBrowser) {
    const result = await postJson<{ text: string }>('/api/ai/translate', { text });
    return result.text;
  }

  try {
    const { ThinkingLevel } = getAI();
    const prompt = `你是一个专业的翻译专家。请将以下文本翻译成地道、简洁的英文，用于描述 AI 声线或情感。
请只返回翻译后的英文文本，不要包含任何解释、说明或标点引号。

需要翻译的文本: "${text.trim()}"`;

    const response = await generateAiContent({
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      }
    });

    return response.text ? response.text.trim() : text.trim();
  } catch (err) {
    console.error("Translation to English failed:", err);
    return text.trim();
  }
}

export interface VoiceExpressionPromptEnhancement {
  enhancedText: string;
  addedTags: string[];
  notes: string;
}

const stripVoicePerformanceTags = (text: string) => text
  .replace(/\[[^\]\r\n]{1,48}\]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeVoicePromptForCompare = (text: string) => stripVoicePerformanceTags(text)
  .replace(/\s+/g, '')
  .replace(/[“”"']/g, '')
  .trim();

const splitVoicePromptIntoSpeakableChunks = (text: string) => {
  const chunks: string[] = [];
  let current = '';
  for (const char of text) {
    current += char;
    if (/[。！？!?；;\n]/.test(char)) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text];
};

const collectVoiceExpressionTagsForSegment = (segment: string) => {
  const content = stripVoicePerformanceTags(segment);
  const lowerText = content.toLowerCase();
  const tags: string[] = [];
  const addTag = (tag: string) => {
    if (!tags.includes(tag)) tags.push(tag);
  };

  if (/(兴奋|激动|开心|高兴|惊喜|太好了|终于|!|！)/.test(content) || /\b(excited|thrilled|happy|joyful|amazed)\b/.test(lowerText)) {
    addTag('excited');
  }
  if (/(大声|喊|吼|急促|紧急|快点|危险|糟了)/.test(content) || /\b(loud|shout|urgent|hurry|danger)\b/.test(lowerText)) {
    addTag('shouting');
  }
  if (/(小声|悄悄|低声|耳语|秘密|别出声)/.test(content) || /\b(whisper|quietly|secret)\b/.test(lowerText)) {
    addTag('whispers');
  }
  if (/(难过|伤心|哭|失望|遗憾|对不起|再也|离开)/.test(content) || /\b(sad|crying|sorry|disappointed|regret)\b/.test(lowerText)) {
    addTag('sad');
  }
  if (/(害怕|恐惧|惊吓|紧张|不安|怎么办|不会吧)/.test(content) || /\b(scared|afraid|nervous|tense|anxious)\b/.test(lowerText)) {
    addTag('nervous');
  }
  if (/(叹气|唉|哎|无奈)/.test(content) || /\b(sigh|sighs)\b/.test(lowerText)) {
    addTag('sighs');
  }
  if (/(笑|哈哈|呵呵|开玩笑)/.test(content) || /\b(laugh|laughs|chuckle|joking)\b/.test(lowerText)) {
    addTag('laughs');
  }
  if (/(冷静|平静|温柔|安慰|慢慢|别怕|没关系)/.test(content) || /\b(calm|gentle|softly|warm|comforting)\b/.test(lowerText)) {
    addTag('calm');
  }
  if (/(严肃|认真|庄重|郑重|注意听)/.test(content) || /\b(serious|solemn|firm)\b/.test(lowerText)) {
    addTag('serious');
  }
  if (/(疑惑|奇怪|为什么|真的吗|难道)/.test(content) || /\b(confused|curious|questioning|really)\b/.test(lowerText)) {
    addTag('curious');
  }

  return tags.slice(0, 3);
};

const mergeVoiceExpressionTagsIntoSegment = (segment: string, tags: string[]) => {
  if (!segment.trim() || tags.length === 0) return segment;
  const leadingWhitespace = segment.match(/^\s*/)?.[0] || '';
  const rest = segment.slice(leadingWhitespace.length);
  const existingTags = Array.from(rest.matchAll(/^\s*(?:\[([^\]\r\n]{1,48})\]\s*)+/g))[0]?.[0] || '';
  const existingTagNames = new Set(
    Array.from(existingTags.matchAll(/\[([^\]\r\n]{1,48})\]/g)).map(match => match[1].trim().toLowerCase()),
  );
  const tagsToAdd = tags.filter(tag => !existingTagNames.has(tag.toLowerCase())).slice(0, Math.max(0, 3 - existingTagNames.size));
  if (tagsToAdd.length === 0) return segment;
  return `${leadingWhitespace}${tagsToAdd.map(tag => `[${tag}]`).join(' ')} ${rest}`;
};

const collapseDuplicateAdjacentVoiceTags = (text: string) => text.replace(
  /(\[[^\]\r\n]{1,48}\])(?:\s+\1)+/gi,
  '$1',
);

const createLocalVoiceExpressionEnhancementFallback = (text: string): VoiceExpressionPromptEnhancement => {
  const normalizedText = text.trim();
  const chunks = splitVoicePromptIntoSpeakableChunks(normalizedText);
  const addedTagsInOrder: string[] = [];
  let taggedChunkCount = 0;

  const enhancedText = collapseDuplicateAdjacentVoiceTags(chunks.map(chunk => {
    const tags = collectVoiceExpressionTagsForSegment(chunk);
    if (tags.length > 0) {
      taggedChunkCount += 1;
      addedTagsInOrder.push(...tags);
    }
    return mergeVoiceExpressionTagsIntoSegment(chunk, tags);
  }).join(''));

  const addedTags = Array.from(new Set(addedTagsInOrder));

  return {
    enhancedText,
    addedTags,
    notes: addedTags.length > 0
      ? `已按 ${taggedChunkCount} 个句段添加分段 v4 语气标签；每个句段最多 3 个。`
      : '未检测到明确情绪关键词，保留原文。',
  };
};

const parseVoiceExpressionEnhancementResponse = (rawText: string, originalText: string): VoiceExpressionPromptEnhancement => {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  let parsed: any = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { enhancedText: cleaned };
  }

  const enhancedText = collapseDuplicateAdjacentVoiceTags(String(parsed?.enhancedText || '').trim());
  if (!enhancedText) {
    throw new Error('AI 未返回增强文本。');
  }

  const originalComparable = normalizeVoicePromptForCompare(originalText);
  const enhancedComparable = normalizeVoicePromptForCompare(enhancedText);
  if (originalComparable && enhancedComparable !== originalComparable) {
    throw new Error('AI 增强结果改变了原台词内容，已拒绝使用。');
  }

  const rawTags = (Array.isArray(parsed?.addedTags) ? parsed.addedTags : enhancedText.match(/\[([^\]\r\n]{1,48})\]/g) || [])
    .map((tag: unknown) => String(tag).replace(/^\[/, '').replace(/\]$/, '').trim())
    .filter((tag: string) => Boolean(tag))
    .slice(0, 12);
  const addedTags: string[] = Array.from(new Set<string>(rawTags));

  return {
    enhancedText,
    addedTags,
    notes: String(parsed?.notes || '已按 ElevenLabs v4 audio tags 方式增强文本。').trim(),
  };
};

export async function enhanceVoicePromptForElevenV4(
  text: string,
  options: { voiceName?: string; voiceDescription?: string; language?: string } = {},
): Promise<VoiceExpressionPromptEnhancement> {
  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new Error('请先输入要增强的配音台词。');
  }

  if (isBrowser) {
    try {
      return await postJson<VoiceExpressionPromptEnhancement>('/api/ai/voice-v4-enhance', {
        text: normalizedText,
        voiceName: options.voiceName || '',
        voiceDescription: options.voiceDescription || '',
        language: options.language || '',
      }, { timeoutMs: 20_000 });
    } catch (error) {
      console.info('Voice v4 enhancement API failed, using local fallback:', error);
      return createLocalVoiceExpressionEnhancementFallback(normalizedText);
    }
  }

  try {
    const { Type, ThinkingLevel } = getAI();
    const prompt = `You are preparing text for ElevenLabs eleven_v4 text-to-speech.
Enhance the script by adding sparse, audible performance tags in square brackets supported by ElevenLabs v4 audio prompting.

Rules:
1. Preserve the spoken dialogue exactly. Do not translate, rewrite, delete, reorder, or add spoken words.
2. You may only add short English bracket tags such as [excited], [calm], [whispers], [laughs], [sighs], [nervous], [sarcastic], [sad], [shouting], [pauses].
3. Tags must describe vocal delivery or vocalized reactions only. Do not add music, sound effects, camera, scene, or physical action tags.
4. Analyze every sentence/paragraph independently. Insert tags before the sentence or phrase where the performance changes, not only at the beginning of the whole script.
5. A longer script should usually have several tag positions across different paragraphs or sentences when the emotion changes.
6. Use at most 1-3 tags per sentence/phrase and only where useful. Multiple tags may be combined for one sentence, for example [excited] [shouting].
7. Avoid duplicate adjacent tags such as [excited] [excited].
8. Keep any existing user bracket tags unless they are clearly non-vocal.
9. Return JSON only. In notes, briefly mention how many sentence/paragraph positions were tagged.

Voice context: ${options.voiceName || 'unknown voice'} ${options.voiceDescription || ''}
Language hint: ${options.language || 'auto'}

Source script:
${normalizedText}`;

    const response = await generateAiContent({
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['enhancedText', 'addedTags', 'notes'],
          properties: {
            enhancedText: { type: Type.STRING },
            addedTags: { type: Type.ARRAY, items: { type: Type.STRING } },
            notes: { type: Type.STRING },
          },
        },
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    return parseVoiceExpressionEnhancementResponse(String(response.text || ''), normalizedText);
  } catch (error) {
    console.error('Voice v4 prompt enhancement failed:', error);
    return createLocalVoiceExpressionEnhancementFallback(normalizedText);
  }
}

// Keep the old export available for callers compiled against the previous helper name.
export const enhanceVoicePromptForElevenV3 = enhanceVoicePromptForElevenV4;

const sanitizeMusicPolicyTerms = (text: string) => text
  .replace(/\bterrifying\b/gi, 'dark intense')
  .replace(/\bterror\b/gi, 'tense suspense')
  .replace(/\bhorrifying\b/gi, 'dark suspenseful')
  .replace(/\bhorror\b/gi, 'dark suspense')
  .replace(/\bscary\b/gi, 'eerie suspenseful')
  .replace(/\bfrightening\b/gi, 'eerie tense')
  .replace(/\bpanic\b/gi, 'urgent tension')
  .replace(/\bthreatening\b/gi, 'ominous')
  .replace(/\bviolent\b/gi, 'intense dramatic')
  .replace(/\bviolence\b/gi, 'dramatic conflict')
  .replace(/\bblood\b/gi, 'dark dramatic')
  .replace(/\bgore\b/gi, 'dark dramatic')
  .replace(/\bweapon\b/gi, 'metallic dramatic accent')
  .replace(/\bgun\b/gi, 'sharp cinematic accent')
  .replace(/\bkill(?:ing)?\b/gi, 'dramatic climax');

const createLocalEnglishMusicPromptFallback = (
  text: string,
  options: { instrumental?: boolean } = {},
) => {
  const normalizedText = text.trim();
  const lowerText = normalizedText.toLowerCase();
  const parts: string[] = [];
  const add = (value: string) => {
    if (!parts.includes(value)) parts.push(value);
  };

  if (/(惊悚|惊吓|恐怖|吓人|紧张|悬疑|诡异|阴森|压迫|不安)/.test(normalizedText) || /\b(suspense|eerie|tense|dark|ominous|mysterious|scary|horror|terrifying)\b/i.test(lowerText)) {
    add('dark suspenseful cinematic underscore');
    add('eerie tense atmosphere');
    add('slow tension build');
  }
  if (/(弦乐|小提琴|大提琴|提琴|string|strings|violin|cello)/i.test(normalizedText)) {
    add('tremolo string ensemble');
    add('low string drones');
  }
  if (/(钢琴|piano)/i.test(normalizedText)) add('sparse felt piano');
  if (/(电子|合成器|赛博|科幻|synth|electronic|cyber|sci-fi)/i.test(normalizedText)) add('dark analog synth textures');
  if (/(管弦|交响|史诗|orchestral|symphonic|epic)/i.test(normalizedText)) add('cinematic orchestral arrangement');
  if (/(温馨|治愈|轻松|柔和|warm|gentle|cozy|soft)/i.test(normalizedText)) add('warm gentle emotional tone');
  if (/(悲伤|忧伤|孤独|sad|melancholy|lonely)/i.test(normalizedText)) add('melancholic emotional harmony');
  if (/(快乐|明亮|开心|happy|bright|uplifting)/i.test(normalizedText)) add('bright uplifting melody');
  if (/(不要鼓|无鼓|别加鼓|不要打击乐|无打击乐|no drums|without drums|no percussion)/i.test(normalizedText)) {
    add('no drums');
    add('no percussion');
  }
  if (/(不要人声|无人声|纯音乐|no vocals|instrumental)/i.test(normalizedText)) {
    add('no vocals');
    add('no speech');
    add('no lyrics');
  }

  if (/^[\x00-\x7F]+$/.test(normalizedText)) {
    add(sanitizeMusicPolicyTerms(normalizedText).replace(/[^\w\s,.-]/g, ' ').replace(/\s+/g, ' ').trim());
  }

  if (parts.length === 0) {
    add('cinematic background music based on the user mood');
    add('clear arrangement');
    add('polished mix');
  }

  if (options.instrumental !== false) {
    add('instrumental background music');
    add('no vocals');
    add('no speech');
    add('no lyrics');
  } else {
    add('original vocal song style');
  }

  return parts
    .join(', ')
    .split(/\s+/)
    .slice(0, 45)
    .join(' ')
    .replace(/\s+,/g, ',')
    .trim();
};

export async function createEnglishMusicPromptForElevenLabs(
  text: string,
  options: { instrumental?: boolean } = {},
): Promise<string> {
  const normalizedText = text.trim();
  if (!normalizedText) return '';

  if (isBrowser) {
    try {
      const result = await postJson<{ text: string }>('/api/ai/music-prompt', {
        text: normalizedText,
        instrumental: options.instrumental !== false,
      }, { timeoutMs: 8_000 });
      return result.text || createLocalEnglishMusicPromptFallback(normalizedText, options);
    } catch (err) {
      console.info('Music prompt API rewrite failed, using local fallback:', err);
      return createLocalEnglishMusicPromptFallback(normalizedText, options);
    }
  }

  try {
    const { ThinkingLevel } = getAI();
    const prompt = `你是影视/游戏配乐提示词工程师。请把用户的中文或英文音乐需求改写成适合 ElevenLabs Music 生成的英文 prompt。

要求：
1. 只返回英文 prompt，不要解释，不要引号。
2. 使用音乐制作语言描述：mood, instruments, arrangement, tempo, dynamics, mix。
3. 避免容易触发平台误判的直白惊吓/暴力/威胁/血腥词。遇到“恐怖、惊悚、惊吓、吓人”等需求时，改写成 dark suspenseful, eerie, tense, mysterious, cinematic underscore 等音乐氛围词。
4. 保留否定需求和限制，例如“不要鼓/无鼓”必须写成 no drums, no percussion。
5. 不要模仿具体歌手、真实人物或受版权保护的作品。
6. ${options.instrumental === false ? '可以描述原创人声歌曲风格。' : '必须明确是 instrumental background music, no vocals, no speech, no lyrics。'}
7. 控制在 45 个英文词以内。

用户需求：${normalizedText}`;

    const response = await generateAiContent({
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      }
    });

    return response.text ? response.text.trim() : normalizedText;
  } catch (err) {
    console.error("Music prompt rewrite failed:", err);
    return createLocalEnglishMusicPromptFallback(normalizedText, options);
  }
}

export async function translateTextToLanguage(
  text: string,
  targetLanguage: string,
  options?: {
    preserveTone?: boolean;
    preserveInterjections?: boolean;
    maxDurationSeconds?: number;
    strictDuration?: boolean;
    timeoutMs?: number;
  }
): Promise<string> {
  const normalizedText = text.trim();
  if (!normalizedText) return '';

  const normalizedTargetLanguage = targetLanguage.trim() || 'English';

  if (isBrowser) {
    const result = await postJson<{ text: string }>('/api/ai/translate-language', {
      text: normalizedText,
      targetLanguage: normalizedTargetLanguage,
      preserveTone: options?.preserveTone !== false,
      preserveInterjections: options?.preserveInterjections !== false,
      maxDurationSeconds: options?.maxDurationSeconds,
      strictDuration: options?.strictDuration === true,
    }, { timeoutMs: options?.timeoutMs });
    return result.text;
  }

  try {
    const { ThinkingLevel } = getAI();
    const durationInstruction = typeof options?.maxDurationSeconds === 'number' && Number.isFinite(options.maxDurationSeconds)
      ? options.strictDuration
        ? `The spoken translation MUST fit within ${Math.max(0.5, options.maxDurationSeconds).toFixed(1)} seconds at a normal, unhurried speaking pace. This is a hard dubbing limit. Use the shortest natural wording, never expand the source, and preserve the essential meaning and emotional intention. Keep only repetitions, fillers, and interjections that are essential to the performance.`
        : `Aim to speak naturally within about ${Math.max(0.5, options.maxDurationSeconds).toFixed(1)} seconds. Use concise spoken phrasing and do not add detail that is absent from the source. Do not omit essential meaning, repetitions, fillers, interjections, hesitations, or conversational emphasis; preserve all of them when they carry meaning.`
      : '';
    const interjectionInstruction = options?.preserveInterjections !== false
      ? 'Preserve every filler, interjection, hesitation, vocalization, and repeated syllable. Keep the same type and repetition count (for example, 哦哦哦 must not become 啊啊啊). Translate a vocalization only to its direct target-language equivalent; never invent, normalize, or replace it with a different sound.'
      : '';
    const prompt = `You are a professional dubbing translator.
Translate the source dialogue into ${normalizedTargetLanguage}.
Preserve the original meaning, emotion, tone, speaking intention, and natural spoken rhythm.
Make the translated line sound like a real voice actor would say it, not like a literal subtitle.
${interjectionInstruction}
${durationInstruction}
The output language MUST be ${normalizedTargetLanguage}. Do not return the source language unless the source is already ${normalizedTargetLanguage}. Do not answer with the original text as a placeholder. Preserve punctuation and repetition structure.
Return only the translated dialogue. Do not add explanations, labels, quotation marks, or markdown.

Source dialogue:
${normalizedText}`;

    const response = await generateAiContent({
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      }
    });

    const translatedText = response.text ? response.text.trim() : '';
    if (!translatedText) {
      throw new Error(`未能翻译成${normalizedTargetLanguage}，请稍后重试。`);
    }
    return translatedText;
  } catch (err) {
    console.error("Target-language translation failed:", err);
    throw err instanceof Error
      ? err
      : new Error(`翻译成${normalizedTargetLanguage}失败，请稍后重试。`);
  }
}

export async function extractBatchVoiceTextFromImage(
  image: { data: string; mimeType: string; fileName?: string },
): Promise<string> {
  const mimeType = String(image.mimeType || '').toLowerCase();
  if (!mimeType.startsWith('image/')) {
    throw new Error('请上传 PNG、JPG 或 WebP 截图。');
  }

  if (isBrowser) {
    const result = await postJson<{ text: string }>('/api/ai/batch-voice-image-ocr', {
      image,
    }, { timeoutMs: 120_000 });
    return result.text;
  }

  try {
    const { ThinkingLevel } = getAI();
    const prompt = `你是配音台本整理助手。请对这张截图做 OCR，只提取适合“批量文本转语音”的台词内容。

要求：
1. 按截图中从上到下、从左到右的阅读顺序整理。
2. 如果截图是表格，请优先识别“文件名/命名/名称/角色/编号”和“台词/文案/内容/对白”这类列。
3. 如果能识别到文件名或角色名，请输出为“文件名：台词”；否则每行只输出一条台词。
4. 保留可见编号、角色名、语气标注、标点和原语言；不要翻译。
5. 忽略按钮、菜单、页眉页脚、水印、聊天软件界面控件、无关说明文字。
6. 最多输出 200 条；不要编造截图里没有的台词。
7. 只返回纯文本，不要 markdown、不要解释。`;

    const response = await generateAiContent({
      contents: [{
        parts: [
          { text: prompt },
          {
            inlineData: {
              data: image.data.split(',')[1] || image.data,
              mimeType,
            },
          },
        ],
      }],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const text = response.text?.trim() || '';
    if (!text) throw new Error('没有从截图中识别到可用台词，请换更清晰的截图或手动粘贴文字。');
    return text
      .replace(/^```(?:text)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
  } catch (err) {
    console.error('Batch voice image OCR failed:', err);
    throw err instanceof Error
      ? err
      : new Error('截图识别失败，请换更清晰的图片或手动粘贴文字。');
  }
}

export async function matchBestVoice(
  description: string,
  gender: 'male' | 'female',
  voices: Array<{ id: string; name: string; englishName: string; gender: string; description: string; tags: string[] }>
): Promise<string> {
  if (!description || !description.trim()) {
    return voices[0]?.id || '';
  }

  if (isBrowser) {
    const result = await postJson<{ voiceId: string }>('/api/ai/match-voice', {
      description,
      gender,
      voices,
    });
    return result.voiceId;
  }

  try {
    const { ThinkingLevel } = getAI();
    // Prepare a simplified list of voices of the same gender for the model.
    const simplifiedVoices = voices
      .filter(v => v.gender === gender)
      .map(v => ({ id: v.id, name: v.name, englishName: v.englishName, description: v.description, tags: v.tags }));

    const prompt = `你是一个专业的配音导演和AI音频专家。
请根据用户对所需声线的描述，从以下可选的 AI 人声音色列表中选择一个最契合、最贴近的音色。

用户要求的性别: ${gender === 'male' ? '男声 (Male)' : '女声 (Female)'}
用户声线描述: "${description}"

可选人声列表:
${JSON.stringify(simplifiedVoices, null, 2)}

请仅返回最匹配的那个音色的 20 位 ElevenLabs ID，不要包含任何其他字符、标点、前缀、空格或解释。如果完全无法匹配，请返回可选人声列表中的第一个 ID。`;

    const response = await generateAiContent({
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      }
    });

    const voiceId = response.text ? response.text.trim() : "";
    // Clean up response to ensure it's a valid ID
    const cleanedId = voiceId.replace(/['"`\s]/g, "");
    
    // Validate that the returned ID is actually in our list, otherwise fallback
    const exists = voices.some(v => v.id === cleanedId);
    if (exists) {
      return cleanedId;
    }
    
    return simplifiedVoices[0]?.id || '';
  } catch (err) {
    console.error("AI voice matching failed, falling back:", err);
    return voices[0]?.id || '';
  }
}
