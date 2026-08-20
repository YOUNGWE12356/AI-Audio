import {
  createFriendlyGeminiNetworkError,
  GEMINI_PRIMARY_MODEL,
  generateGeminiContent,
  isGeminiNetworkError,
} from './geminiRetry';

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

type GeminiModule = typeof import('@google/genai');

let geminiModulePromise: Promise<GeminiModule> | null = null;

const loadGeminiModule = () => {
  geminiModulePromise ??= import('@google/genai');
  return geminiModulePromise;
};

async function postJson<T>(
  path: string,
  body: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const handleParentAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) handleParentAbort();
  options.signal?.addEventListener('abort', handleParentAbort, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 90_000);

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
      throw new Error(timedOut ? 'AI 分析超过 90 秒，请减少素材后重试。' : '已取消本次分析。');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', handleParentAbort);
  }
}

const getAI = async () => {
  const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!key) {
    throw new Error("服务端 GEMINI_API_KEY 未配置。");
  }

  const { GoogleGenAI, Type, ThinkingLevel } = await loadGeminiModule();
  return {
    ai: new GoogleGenAI({ apiKey: key }),
    Type,
    ThinkingLevel,
  };
};

export interface AudioDesignResult {
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

type RawAudioDesignResult = Omit<AudioDesignResult, 'bgmRecommendations'> & {
  bgmRecommendations: RawAudioDesignBgmRecommendation[];
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

const SUNO_CORE_INSTRUMENT_LIMIT = 5;
const SUNO_STYLE_WORD_LIMIT = 12;
const SUNO_VOCAL_WORD_LIMIT = 14;
const SUNO_STYLE_CHAR_LIMIT = 32;
const SUNO_VOCAL_CHAR_LIMIT = 32;

const containsTimelineReference = (value: string) => (
  /(?:\d{1,2}:)?\d{1,2}(?:\.\d+)?\s*(?:-|–|—|~|至|到|to)\s*(?:\d{1,2}:)?\d{1,2}(?:\.\d+)?\s*(?:s|秒|secs?|seconds?)?/i.test(value)
  || /\b(?:timeline|timecode|at\s+\d+(?:\.\d+)?\s*(?:s|secs?|seconds?))\b|(?:时间线|时间码|第\s*[一二三四五六七八九十\d]+\s*段)/i.test(value)
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

const extractCoreInstruments = (values: string[], isEnglish: boolean) => uniqueTexts(
  values.flatMap(value => value
    .split(isEnglish ? /[,;|/+]/ : /[、，,；;|/+]/)
    .map(item => item.trim())
    .filter(item => item && !containsTimelineReference(item))
    .map(item => isEnglish ? limitWords(item, 4) : limitCharacters(item, 12))),
).slice(0, SUNO_CORE_INSTRUMENT_LIMIT);

const normalizeBpm = (value: unknown) => {
  const parsed = Number.parseInt(String(value), 10);
  return String(Number.isFinite(parsed) ? Math.min(220, Math.max(40, parsed)) : 90);
};

/**
 * 详细时间线只服务于音画分析；Suno 词由同一方案的全局风格与核心乐器汇总。
 * 最终词必须描述一首完整音乐，不携带时间码或分段编排说明。
 */
const materializeAudioDesignResult = (
  raw: RawAudioDesignResult,
  isInstrumental: boolean,
  includeTimeline: boolean,
): AudioDesignResult => {
  if (!Array.isArray(raw.bgmRecommendations) || raw.bgmRecommendations.length === 0) {
    throw new Error('AI 未生成有效的配乐方案，请重试。');
  }

  const bgmRecommendations = raw.bgmRecommendations.map((plan, planIndex) => {
    const style = cleanText(plan.style);
    const styleEnglish = cleanEnglishText(plan.styleEnglish);
    const key = cleanEnglishText(plan.key);
    const bpm = normalizeBpm(plan.bpm);
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

    const coreInstruments = extractCoreInstruments(
      includeTimeline ? pairedTimeline.map(item => item.instruments) : [overallInstrumentation],
      false,
    );
    const coreInstrumentsEnglish = extractCoreInstruments(
      includeTimeline ? pairedTimeline.map(item => item.instrumentsEnglish) : [overallInstrumentationEnglish],
      true,
    );
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
      compactStyle,
      isInstrumental ? '完整连贯的纯音乐配乐' : '完整连贯的歌曲',
      coreInstruments.length > 0 ? `核心乐器：${coreInstruments.join('、')}` : '',
      `${bpm} BPM`,
      key,
      compactVocalDirection,
    ].filter(Boolean).join('；') + '。';
    const englishPrompt = [
      compactStyleEnglish,
      isInstrumental ? 'cohesive full-length instrumental soundtrack' : 'cohesive full-length song',
      coreInstrumentsEnglish.length > 0 ? `featuring ${coreInstrumentsEnglish.join(', ')}` : '',
      `${bpm} BPM`,
      key,
      compactVocalDirectionEnglish,
    ].filter(Boolean).join('; ') + '.';

    if (containsTimelineReference(chinesePrompt) || containsTimelineReference(englishPrompt)) {
      throw new Error(`AI 生成的第 ${planIndex + 1} 套整体音乐提示仍包含时间线，请重试。`);
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
    ...raw,
    bgmRecommendations,
  };
};

export interface AudioDesignMedia {
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
}

export async function preuploadAudioDesignVideo(
  video: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: number, message: string) => void;
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

    request.open('POST', '/api/ai/gemini/audio-design-video-preupload');
    request.responseType = 'json';
    request.timeout = 180_000;
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(95, Math.round((event.loaded / event.total) * 95));
      options.onProgress?.(percent, `正在后台上传视频 ${percent}%...`);
    };
    request.upload.onload = () => {
      options.onProgress?.(96, '视频已传到服务器，Gemini 正在预处理...');
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
    formData.append('video', video, createAsciiVideoUploadName(video.name, video.type));
    request.send(formData);
  });
}

export async function analyzeAudioDesignVideo(
  video: File,
  requirements: string,
  target: { game: boolean; video: boolean; avatar?: boolean; sunnyIsland?: boolean },
  isInstrumental: boolean,
  options: {
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
    analysisMode?: 'professional' | 'fallback';
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

    request.open('POST', '/api/ai/gemini/audio-design-video');
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

      options.onProgress?.(target.avatar
        ? '上传完成，Gemini 正在进行高精度逐秒分析...'
        : '上传完成，Gemini 正在分析完整画面与声音...');
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
    request.send(formData);
  });
}

export async function analyzeAudioDesignPreuploadedVideo(
  uploadId: string,
  requirements: string,
  target: { game: boolean; video: boolean; avatar?: boolean; sunnyIsland?: boolean },
  isInstrumental: boolean,
  options: {
    signal?: AbortSignal;
    analysisMode?: 'professional' | 'fallback';
  } = {},
): Promise<AudioDesignResult> {
  if (!isBrowser) {
    throw new Error('该方法仅用于 HTML5 客户端分析预上传视频。');
  }

  return postJson<AudioDesignResult>('/api/ai/gemini/audio-design-video-preuploaded', {
    uploadId,
    requirements,
    target,
    isInstrumental,
    analysisMode: options.analysisMode || 'professional',
  }, { signal: options.signal, timeoutMs: 180_000 });
}

export async function analyzeAudioDesignVideoFile(
  videoPath: string,
  mimeType: string,
  displayName: string,
  requirements: string,
  target: { game: boolean; video: boolean; avatar?: boolean; sunnyIsland?: boolean },
  isInstrumental: boolean,
): Promise<AudioDesignResult> {
  const { ai } = await getAI();
  let uploadedFile: Awaited<ReturnType<typeof ai.files.upload>> | undefined;

  try {
    uploadedFile = await ai.files.upload({
      file: videoPath,
      config: {
        mimeType,
        displayName: createAsciiVideoUploadName(displayName, mimeType),
      },
    });

    const deadline = Date.now() + 120_000;
    while (uploadedFile.state === 'PROCESSING') {
      if (Date.now() >= deadline) {
        throw Object.assign(new Error('Gemini 视频预处理超过 2 分钟，请稍后重试。'), { status: 504 });
      }
      await new Promise(resolve => setTimeout(resolve, 1_500));
      if (!uploadedFile.name) throw new Error('Gemini 未返回视频文件标识。');
      uploadedFile = await ai.files.get({ name: uploadedFile.name });
    }

    if (uploadedFile.state === 'FAILED') {
      throw Object.assign(new Error(uploadedFile.error?.message || 'Gemini 无法处理此视频编码。'), { status: 422 });
    }
    if (!uploadedFile.uri || !uploadedFile.mimeType) {
      throw new Error('Gemini 未返回可分析的视频地址。');
    }

    return await analyzeAudioDesign([{
      fileUri: uploadedFile.uri,
      mimeType: uploadedFile.mimeType,
      label: `完整视频：${displayName}`,
      videoMetadata: {
        fps: target.avatar ? 2 : 1,
      },
    }], requirements, target, isInstrumental);
  } catch (error) {
    if (isGeminiNetworkError(error)) {
      throw createFriendlyGeminiNetworkError(error);
    }
    throw error;
  } finally {
    if (uploadedFile?.name) {
      await ai.files.delete({ name: uploadedFile.name }).catch((error) => {
        console.warn('Failed to delete temporary Gemini file:', error);
      });
    }
  }
}

export async function analyzeAudioDesign(
  files: AudioDesignMedia[],
  requirements: string,
  target: { game: boolean; video: boolean; avatar?: boolean; sunnyIsland?: boolean },
  isInstrumental: boolean,
  options: { signal?: AbortSignal } = {},
): Promise<AudioDesignResult> {
  if (isBrowser) {
    return postJson<AudioDesignResult>('/api/ai/gemini/audio-design', {
      files,
      requirements,
      target,
      isInstrumental,
    }, { signal: options.signal, timeoutMs: 90_000 });
  }

  let targetDesc = target.game && target.video ? "游戏CG宣传片" : target.game ? "游戏" : target.video ? "视频" : "音频设计";
  const isGameTrack = target.game && !target.video && !target.avatar && !target.sunnyIsland;
  const includeMusicTimeline = !isGameTrack;
  if (target.avatar) {
    targetDesc = "科幻巨制《阿凡达》(Avatar) 风格奇幻自然场景";
  } else if (target.sunnyIsland) {
    targetDesc = "治愈系田园日常《小岛有晴天》(Sunny Day on the Island) 温暖舒缓场景";
  }
  
  let additionalSpecialInstructions = "";
  if (target.avatar) {
    additionalSpecialInstructions = `
    【阿凡达 (Avatar) 风格特别设计要求（最高优先级）】：
    1. **高精度但符合音乐规律的时间线设计 (timelineDesign)**：逐秒观察画面动作，但配乐段落必须按真实叙事与音乐乐句自适应划分，不设固定段数。常规段落约 5-8 秒；画面与情绪持续稳定时可延长，只有明显转场、关键动作或强烈情绪拐点才提前切段，严禁连续设计大量 2-3 秒的情绪切换。
    2. **外星奇幻生态声景 (Foley)**：音效命名和设计应该充满潘多拉星球外星动植物的奇特生命律动、夜光森林荧光植物的发光嗡嗡声（ambient bioluminescent glow）、斑溪兽（Banshee）的飞掠振翅与嘶鸣、灵魂之树的空灵触碰共鸣（使用神秘高频合成器与奇异声学共鸣音效）。
    3. **宏大管弦交响与原始部落打击乐 (BGM)**：配乐应融合史诗科幻管弦、原野木管（原野木笛）和原始部落大鼓打击乐（wood drum, hand percussion），传递人与大自然的灵性连接，空灵、原始而极其震撼。${isInstrumental ? '本次为纯音乐，严禁加入可辨识的人声、吟唱、合唱、呼喊或歌词，只能用乐器音色塑造原始感。' : '本次可使用人声，但人声出现的时间、情绪和演唱方式必须写入同一份 timelineDesign。'}
    `;
  } else if (target.sunnyIsland) {
    additionalSpecialInstructions = `
    【小岛有晴天 (Sunny Day on the Island) 风格特别设计要求（最高优先级）】：
    1. **治治愈、田园、温暖的总体风格**：输出的所有音效设计描述（description）、背景音乐风格（style）、音效命名（name）、乐器和合成技术（logic），**都必须往治愈、舒缓、安宁、田园、温暖方向倾斜，彻底避免任何惊悚、机械或突兀的噪音**。
    2. **田园大自然日常音效 (Foley)**：音效设计应聚焦于清爽海风吹拂、海浪拍打沙滩的细软声音、微风拂过花草麦浪的沙沙沙声、自行车链条及轮轴转动的轻快咔哒声、日系风铃随风摆动的清脆铜铃音、温水煮热咖啡气泡破裂的汩汩咕嘟声、以及远方小猫撒娇的温柔细叫与草丛鸟鸣。
    3. **温暖安宁的小品式乐器配乐 (BGM)**：音乐推荐必须是极度慵懒舒缓的。推荐的主奏与辅奏乐器为：尤克里里 (ukulele)、木吉他温暖扫弦 (acoustic guitar strumming)、马林巴木琴 (marimba)、手风琴 (accordion)、轻快的手碟 (handpan) 及带大厅混响的经典立式原声钢琴 (piano)。
    4. **双语音乐蓝图必须温润治愈**：style/styleEnglish 与 timelineDesign 中每组 instruments/instrumentsEnglish 必须共同体现温暖田园；最终 Suno 词只概括整首音乐，但曲风、情绪和核心乐器必须与这套蓝图一致。
    `;
  }

  const prompt = `
    你是一个顶级的音频设计师和视频分析专家。请深度分析上传的内容，并提供极其详尽且专业的音效设计需求表与背景音乐方案。
    
    分析要求：
    1. **多文件逻辑**：有联系则综合分析，无联系则以第一张/段素材为主。
    2. **双语字段边界**：除字段名带 English、标准英文调性 key、数字 bpm、时间码 timecode 及规范英文音效名 name 外，所有分析描述必须使用中文；所有 English 字段必须只写英文，不得夹杂中文。
    3. **动作级SFX**：在 "scene" 字段标明具体时间点。
    ${isGameTrack
      ? '4. **双重BGM**：提供两个制作方向不同的整体风格方案，但两套都必须严格符合素材与补充需求的题材、情绪和玩法；差异只能来自曲风融合、核心配器或节奏处理，禁止为了制造差异而输出相反情绪。'
      : '4. **双重BGM**：提供两个差异巨大的风格方案。'}
    5. **无语音**：音效严禁出现人声对白。
    6. **性能与精度平衡**：只保留最重要的 6-10 个音效节点；字段描述保持专业但精炼，每段不超过 100 个汉字，避免重复内容。
    ${isGameTrack ? `
    7. **游戏配乐只做整体方案（最高优先级）**：游戏音轨不按视频时间、镜头或动作切分音乐。每个 bgmRecommendations 项只提供一套统一的整曲风格，不得输出 timelineDesign，不得在任何音乐字段中写时间码、段落时长、进入时机、剪辑点或先后顺序。
    8. **整体配器双语同义（强制）**：instrumentation/instrumentationEnglish 用一句短语列出整首音乐最重要的 3-5 个核心乐器或音色，中英文必须语义等价。
    9. **画面推荐依据（强制）**：visualRationale 用中文说明画面题材、色彩/空间、动作节奏、玩法氛围或用户补充需求如何共同指向该音乐风格；必须解释“为什么推荐这种音乐”，但不得写时间码、段落时长或先后顺序，长度 60-120 字。
    10. **Suno 整体音乐词（强制）**：style/styleEnglish 用一句短语概括整首音乐的统一曲风与情绪；结合整体配器、BPM、调性和统一人声方向生成简短明确的 Suno Style Prompt。不要生成曲式结构、动态时间线或剪辑说明。
    11. **游戏适配原则**：音乐应适合长时间播放和自然循环，保持统一氛围与稳定能量，避免依赖固定画面时长或一次性剧情转折。素材内容与“补充需求”是判断整体风格的最高依据；没有素材时完全以补充需求为准，不得输出与其题材或情绪相冲突的音乐。
    ` : `
    7. **单一配乐蓝图（强制）**：每个 bgmRecommendations 项是一套完全独立、闭环的方案，timelineDesign 负责分秒级音画分析。顶层 style、BPM、调性、人声方向及所有时间段必须互相一致，禁止把两套推荐交叉混用；系统会从同一方案汇总最终 Suno 整体音乐词。
    8. **逐项双语同义（强制）**：style/styleEnglish，以及 timelineDesign 中每一组 emotion/emotionEnglish、instruments/instrumentsEnglish、description/descriptionEnglish 都必须语义等价。不得在英文项中新增中文方案没有的曲风、乐器、人声、情绪或时间节点。
    9. **Suno 整体音乐词（强制）**：style/styleEnglish 必须用一句短语概括整首音乐的统一曲风和总体情绪，中文不超过 30 字、英文不超过 12 个单词，不得包含时间码、时间线、章节名或先后顺序。timelineDesign 的 instruments/instrumentsEnglish 只列该段使用的 1-4 个乐器或音色名称，进入时机、动态变化和剪辑配合统一写入 description/descriptionEnglish。系统将用整体曲风、最多 5 个核心乐器、BPM、调性和总体人声要求生成一条简短明确的 Suno Style Prompt，不会复制时间线文案。
    10. **配乐段落长度与连续性（最高优先级）**：timelineDesign 是音乐段落设计，不是逐动作音效清单。必须根据视频实际时长、叙事段落、镜头群和显著情绪拐点自适应划分，不能为了增加细节而强行增加段数。常规每段约 5-8 秒；连续镜头或同一情绪可保持 8-15 秒；短于 5 秒只允许用于视频首尾余量，或真正重要的转场、关键动作与强烈情绪变化。相邻段若情绪与核心配器相近必须合并，严禁连续出现大量 2-3 秒段落。高频画面采样只用于识别动作与 SFX，不代表 BGM 要以相同颗粒度切段；微小动作、卡点和瞬时声音写入 SFX 或当前段 description，不得据此更换整段音乐情绪。时间线必须从开头到结尾连续覆盖、无空隙、无重叠。
    11. **画面分析与方案分工**：musicAnalysis.emotionalCurve 只描述画面本身的客观情绪走势；每套音乐如何响应画面，必须分别写进该方案的 timelineDesign，不能用全局情绪曲线代替。
    `}
    12. **调性格式（强制）**：key 必须使用标准英文“音名 + major/minor”格式，例如 "D minor"、"F# major"，不得写“小调/大调”或只写音名。
    ${isInstrumental
      ? `13. **纯音乐硬约束（强制）**：style、instrumentation${includeMusicTimeline ? ' 和 timelineDesign' : ''} 的全部中英文字段中不得出现人声、女声、男声、童声、吟唱、合唱、呼喊、歌唱、歌词、说唱及 vocal/voice/choir/chant/singer/lyrics/rap/singing/humming 等元素；不要输出 vocalInfo 或 lyrics。`
      : isGameTrack
        ? '13. **人声方案约束**：vocalDirection/vocalDirectionEnglish 只用一句短语描述整首歌曲统一的人声类型、音色与唱法，不得写时间码、进入时机或分段安排；不要输出 vocalInfo 或 lyrics。'
        : '13. **人声方案约束**：vocalDirection/vocalDirectionEnglish 只用一句短语描述整首歌曲统一的人声类型、音色与唱法，不得写时间码或进入时机；人声何时进入只写在对应 timelineDesign 时间段中，中英文必须同义。'}

    ${files.some(file => Boolean(file.fileUri)) && includeMusicTimeline ? `
    【原生视频精细分析要求】：
    1. 必须从 00:00 开始覆盖到视频结束，结合画面运动、镜头剪辑和原始音轨进行判断。
    2. 识别关键镜头群、叙事阶段、情绪和音乐能量的明显转折，并使用“MM:SS-MM:SS”标出开始与结束时间；普通切镜和细小动作不应单独拆成配乐段落。
    3. timelineDesign 必须按真实视频顺序连续覆盖，不得只根据少数代表画面概括全片。
    4. 快速动作段落优先标记 Foley、撞击、转场和节奏卡点；安静段落标记氛围、留白和音乐动态。
    ` : ''}
    
    ${target.video || target.avatar ? `
    【高精度影视级特别设计要求（最高优先级）】：
    由于本项目定属于“影视广告”创作类型，我们的音画同步和配乐设计方案需要达到最顶尖的专业精度：
    1. **音效命名细致化 (name)**：
       - 所有生成的音效命名（name）必须采用统一且高精度的英文规范命名（如: sfx_foley_footstep_wood_01, sfx_ambient_wind_howl_loop_02, sfx_scifi_laser_shot_03），禁止使用模糊词，应区分出类型、材质、道具、变化序号等。
    2. **动作场景及时间码精准化 (scene)**：
       - 所有音效的出现场景和动作必须包含极度精准的时间码段（如: '00:01.5 - 00:03.2'、'0-5s' 或 '00:12 - 00:15'），并在 scene 字段中清晰阐述该时刻画面的微观动势（如：“特写镜头主角推门、门轴干涩吱呀声；0.5s时门板撞击墙壁”）。
    3. **分秒级音乐细致设计文案 (timelineDesign)**：
       - 每个配乐推荐（bgmRecommendations）必须在 timelineDesign 字段中附带一套按视频实际内容自适应的配乐段落设计，不设固定段数。通常每段约 5-8 秒；同一情绪可更长，只有重要转折可更短，并避免连续 2-3 秒换一次音乐情绪：
         - "timecode": 连续时间段，例如 24 秒视频可规划为 '0-6s', '6-13s', '13-20s', '20-24s'；末段可因视频结束而短于 5 秒。实际边界必须服从视频内容，不能照抄示例。
         - "instruments" / "instrumentsEnglish": 该时间段乐器配置的中英文同义表述。
         - "emotion" / "emotionEnglish": 该时间段画面情绪的中英文同义表述。
         - "description" / "descriptionEnglish": 具体编排、声学变化及剪辑配合方式的中英文同义表述；英文需简洁，且不得增添中文没有的元素。
    ` : isGameTrack ? `
    【游戏音轨整体音乐要求】：
    1. 音效节点仍可根据素材动作标记具体触发时机，但背景音乐只做整局统一风格，不得按素材时间拆分。
    2. bgmRecommendations 不输出 timelineDesign；只输出 style/styleEnglish、instrumentation/instrumentationEnglish、visualRationale、bpm、key 与统一人声方向。
    3. visualRationale 必须针对上传画面或补充需求解释推荐逻辑，说明这种音乐如何匹配画面气质、玩法情绪和长时间循环体验。
    ` : `
    【通用场景设计要求】：
    1. 即使不是纯影视广告，也请在 bgmRecommendations 的 timelineDesign 中按素材实际叙事和情绪拐点自适应设计音乐段落，不设固定段数。常规段落约 5-8 秒，同一情绪可延长；避免连续 2-3 秒切换情绪，并写明各段的情感表达和主导乐器。
    `}

    ${additionalSpecialInstructions}

    目标方向：${targetDesc}
    补充需求：${requirements}
    音乐类型：${isInstrumental ? "纯音乐（Instrumental）" : "带有人声的歌曲"}
  `;

  const usesNativeVideo = files.some(file => Boolean(file.fileUri));
  const parts: any[] = usesNativeVideo ? [] : [{ text: prompt }];
  files.forEach((file) => {
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

  const { ai, Type } = await getAI();
  const response = await generateGeminiContent(ai, {
    model: GEMINI_PRIMARY_MODEL,
    contents: [{ parts }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        required: ["sfxAnalysis", "musicAnalysis", "sfxSchemes", "bgmRecommendations"],
        properties: {
          sfxAnalysis: {
            type: Type.OBJECT,
            required: ["summary", "keyElements", "pacing"],
            properties: {
              summary: { type: Type.STRING },
              keyElements: { type: Type.ARRAY, items: { type: Type.STRING } },
              pacing: { type: Type.STRING }
            }
          },
          musicAnalysis: {
            type: Type.OBJECT,
            required: ["mood", "rhythm", "suggestedInstruments", "emotionalCurve"],
            properties: {
              mood: { type: Type.STRING },
              rhythm: { type: Type.STRING },
              suggestedInstruments: { type: Type.ARRAY, items: { type: Type.STRING } },
              emotionalCurve: { type: Type.STRING }
            }
          },
          sfxSchemes: {
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
          },
          bgmRecommendations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: [
                "style",
                "styleEnglish",
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
          }
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

  return materializeAudioDesignResult(rawResult, isInstrumental, includeMusicTimeline);
}

export async function regenerateLyrics(
  originalLyrics: string,
  selectedPart: string,
  direction: string
): Promise<string> {
  if (isBrowser) {
    const result = await postJson<{ text: string }>('/api/ai/gemini/regenerate-lyrics', {
      originalLyrics,
      selectedPart,
      direction,
    });
    return result.text;
  }

  const { ai, ThinkingLevel } = await getAI();
  const prompt = `
    原始歌词：
    ${originalLyrics}

    需要修改的部分：
    ${selectedPart}

    修改方向：
    ${direction}

    请仅返回修改后的这一部分歌词内容，保持原有的结构标注格式。
  `;

  const response = await generateGeminiContent(ai, {
    model: GEMINI_PRIMARY_MODEL,
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
    const result = await postJson<{ text: string }>('/api/ai/gemini/generate-lyrics', {
      style: normalizedStyle,
    }, {
      signal: options.signal,
    });
    return result.text;
  }

  const { ai, ThinkingLevel } = await getAI();
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

  const response = await generateGeminiContent(ai, {
    model: GEMINI_PRIMARY_MODEL,
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

export async function generateSfxRequirements(
  inputText: string,
  referenceFile: { data: string; mimeType: string } | null,
  templateType: 'game_sfx_general' | 'game_sfx_middleware' | 'voiceover_general' | 'voiceover_multilang'
): Promise<{ items: any[] }> {
  if (isBrowser) {
    return postJson<{ items: any[] }>('/api/ai/gemini/sfx-requirements', {
      inputText,
      screenshot: referenceFile,
      templateType,
    });
  }

  const { ai, Type } = await getAI();
  let schema: any;
  let templateDescription = "";

  if (templateType === 'game_sfx_general') {
    templateDescription = `
      【游戏音效配乐通用需求表模板参考1】
      该模板主要包含以下字段，请在输出 JSON 时填充：
      - index (序号): 整数，从1开始递增。
      - audio_type (类型): 必须填写 "SFX"、"BGM" 或 "VO"。音效为 SFX，背景音乐为 BGM，角色台词/旁白/字幕配音为 VO。
      - filename (文件命名): 采用下划线小写英文命名规范。例如 sfx_ui_button, bgm_battle, sfx_foley_footstep_wood_01。只有同一基础音效存在多个变体/随机样本时才使用 _01/_02/_03；如果该类型只有一个音效，不要添加尾号。
      - duration_logic (时长&播放逻辑): 声效时长描述及触发/播放逻辑，例如 "1s, 单次播放", "10s, 循环播放", "3s, 随机多样本触发"。
      - scene (应用场景): 音效触发的具体场景与时机描述，如 "通用与主界面&游戏内的ui点击按键"。
      - description (描述): 对声音声学物理表现与听觉感受的文字描述，如 "清脆的交互点击声，带有科技高频感"。
      - script_tone (台词/语气): SFX/BGM 行填 "-"；VO 行必须填写识别到或创作出的台词文案，并包含语气提示。不要在内容开头重复写“台词：”，例如 "欢迎回来，指挥官。语气：沉稳、亲切、略带科技感"。
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
            required: ["index", "audio_type", "filename", "duration_logic", "scene", "description", "script_tone", "remarks", "video_link"],
            properties: {
              index: { type: Type.INTEGER },
              audio_type: { type: Type.STRING },
              filename: { type: Type.STRING },
              duration_logic: { type: Type.STRING },
              scene: { type: Type.STRING },
              description: { type: Type.STRING },
              script_tone: { type: Type.STRING },
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
      - filename (文件命名): 采用下划线小写英文命名规范。如 sfx_player_dash。只有同一基础音效存在多个变体/随机样本时才使用 _01/_02/_03，例如 sfx_footstep_grass_01。
      - event_name (事件命名): 音频中间件事件路径规范。如 "event:/SFX/Player/dash" 或 "Play_sfx_player_dash"；只有多个变体时才在末尾编号。
      - duration (时长): 预估的时长，如 "0.5s", "12s", "loop"。
      - scene (应用场景): 音效在游戏/关卡/引擎中的应用时机，如 "玩家瞬间前冲闪避时"。
      - description (描述): 对声效材质、空间、力量感的详细描述，如 "带有疾风气流破空声，以及微弱的粒子汇聚声"。
      - remarks (备注): 声音备注或技术要点，如 "需要加入 3D 空间衰减 (Spatialization)"。
      - video_link (动效视频): 占位说明或对应动效分镜视频。
      - reference (参考): 参考音频链接或灵感来源，如 "参考《尼尔：机械纪元》闪避声效"。
      - playback_logic (播放逻辑): 音频在引擎中的播放/触发参数逻辑，如 "3D 空间，设置随机音高 (Pitch)"。
      - distance_3d (3D距离): 3D空间最大衰减距离（如果是3D事件，必须增加一个3D距离，默认是 "20"；如果是2D事件则设置为 "-"）。
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
              filename: { type: Type.STRING },
              event_name: { type: Type.STRING },
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
      - filename (文件命名): 配音文件下划线英文命名规范，如 "vo_chapter1_monologue"。只有同一角色/场景下有多句同类变体时才使用 _01/_02/_03。
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
      - filename (文件命名): 配音文件英文下划线命名规范，如 "vo_npc_guide_greet"。只有同一角色/场景下有多句同类变体时才使用 _01/_02/_03。
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

  const prompt = `
    你是一个顶级的游戏音频总监、声音设计师和配音导演。
    你的任务是：根据用户输入的文字描述、或上传的参考文件（图片/截图、音频、视频），进行高品质的识别、结构化重构、工程化规范命名、以及专业化的填充和优化。最终生成一张完美格式的、可以直接用于项目开发、给外包和合作团队看的专业“音效/配音需求表”。

    ${inputInterpretationInstruction}

    请严格遵守以下规则进行处理：
    1. **多模态输入识别与需求数量控制**：
       - **图片/截图/表格草稿**：如果上传文件是已有需求表、表格截图、手写/截图清单，请仔细 OCR 并识别其中实际包含的音效、BGM 或配音条目数量；重构和优化时 items 数组必须与原输入条目数量 1:1 对应，不要额外增加行。
       - **普通图片/视觉参考图**：如果上传文件不是表格，而是画面、角色、场景、UI 或概念图，请根据画面内容生成适合当前模板的音乐/音效/配音需求，不要求 1:1。
       - **音频文件**：音频通常作为 BGM/音乐参考处理。请聆听并分析风格、情绪、速度、节奏密度、配器、音色、段落结构、循环/无缝衔接需求和适用场景；优先生成 BGM 或音乐方向需求。如果用户文字另有说明，再结合文字修正。
       - **视频文件**：视频默认只分析画面、镜头节奏、角色动作、UI变化、场景氛围和画面中的可见字幕；请忽略视频内嵌音频，因为它大概率与画面无关。不要根据视频原声推断音乐或音效。
       - **视频字幕 / 配音需求混合输出**：如果视频画面中有字幕，或用户文字/参考文件里出现角色台词、旁白、对白、播报、引导语、口语化文案等配音需求，必须识别字幕内容和语境，并生成对应 VO 配音需求。即使当前选择的是“游戏音效配乐通用表”或其它音效/BGM模板，也不能忽略配音需求；通用表里请把音效、BGM、VO 放在同一个 items 数组中，VO 行使用 \`vo_\` 文件名，\`audio_type\` 填 \`VO\`，\`script_tone\` 直接填写文案和语气，不要在开头加“台词：”。
       - **同一素材的一次性综合需求**：同一个视频、图片或文字需求可能同时包含 SFX、BGM 和 VO。除非用户明确只要某一种类型，否则请一次性输出素材中可识别的所有音频需求，避免让用户反复切模板才能得到完整结果。
       - **空泛输入或只选模板**：当用户没有提供具体列表、表格或参考文件，只选择模板或输入非常抽象的提示词时，自动头脑风暴生成 6-10 行典型专业条目。

    2. **文件名命名优化与直接保留**：
       - 如果用户输入或上传的参考文件/草稿表格中**本身就带有文件命名或名称**（如 \`sfx_click\`, \`bg_battle\`, \`刀剑砍击声\` 等）：
         - 你可以根据专业的下划线英文命名规范（如：\`[sfx / bgm / vo]_[模块]_[动作/角色]_[描述]\`，多变体时才追加 \`_[序号]\`）来智能优化重构这些命名；
         - 如果用户提供的命名已经相当成熟、合理或带有特定的版本代号，你应当**直接使用和保留**给到的命名；
         - 确保优化的命名与原始名称的意图保持强关联，不得凭空捏造全新的无关名称。

    3. **专业化设计与规范**：
       - **工程化文件命名 (filename)**：禁止用中文命名文件。所有文件名必须是标准的下划线英文小写结构。
         格式：\`[sfx / bgm / vo]_[模块]_[动作/角色]_[描述]\`；只有同一基础音效/台词存在多个变体、随机样本、连号资产时，才追加 \`_[序号]\`。
         例如：单个确认点击用 \`sfx_ui_confirm\`，单个战斗 BGM 用 \`bgm_battle_loop\`，单句旁白用 \`vo_narrator_intro\`；多个脚步随机样本才用 \`sfx_footstep_grass_01\`、\`sfx_footstep_grass_02\`、\`sfx_footstep_grass_03\`。
       - **命名必须简约、明确、语义准确**：filename 必须优先从“应用场景/触发时机”里提取真实模块、页面、对象和动作；“描述”只用于理解音色、材质、情绪和制作方式，不能把描述里的装饰性词汇误当成文件名主体。
         命名优先级：应用场景/触发时机 > 原始名称 > 描述。除非“应用场景”明确说是金币、奖励、宝箱、道具拾取，否则不要因为描述中出现“金色闪光、金币质感、奖励感”等词，就在 filename 里加入 \`gold\`、\`coin\`、\`reward\`。
         例如应用场景是“升级成功提示/升级完成反馈”，即使描述里写了“金色粒子、奖励闪光”，也应命名为 \`sfx_ui_upgrade_success\`，不要命名为 \`sfx_ui_upgrade_gold\` 或 \`sfx_ui_upgrade_success_gold\`。
       UI 音效推荐格式：\`sfx_ui_[screen_or_widget]_[action]\`，例如“升级页打开”应命名为 \`sfx_ui_upgrade_page_open\`，而不是 \`sfx_ui_button\` 或 \`sfx_ui_click_01\`。
         常用 action 词优先使用：\`open\`, \`close\`, \`click\`, \`confirm\`, \`cancel\`, \`select\`, \`switch\`, \`unlock\`, \`upgrade\`, \`reward\`, \`popup\`, \`warning\`, \`error\`。
         BGM 推荐格式：\`bgm_[scene]_[style_or_state]\`；配音推荐格式：\`vo_[speaker_or_role]_[intent]\`。
         所有单词必须小写 snake_case，不使用 CamelCase / PascalCase，例如使用 \`sfx_ui_upgrade_page_open\`，不要输出 \`sfx_ui_UpgradePage_Open\`。
       - **FMOD/Wwise 事件路径命名 (event_name)**：如果是音频中间件模板，对应的事件必须有规范的虚空间路径格式，例如：\`event:/SFX/Player/jump\` 或 \`event:/VO/Hero/attack\`。
       - **时长与播放逻辑**：用声效术语编写，例如 "1s, 单次播放", "loop, 循环播放"。
       - **3D 距离规范 (distance_3d)**：对于 FMOD/Wwise 中间件需求表，如果是 3D 事件（如备注或播放逻辑里包含 3D 空间、3D 空间定位等），必须在 \`distance_3d\` 中增加一个 3D 距离，默认值为 \`"20"\`（或根据音量、场景大小评估为 "15", "30" 等数字字符串）；如果是 2D 事件，则该字段输出为 \`"-"\`。
       - **多语种台词生成**：在多语种配音模板下，根据简中台词，翻译并创作出对应的英语台词和韩语台词。台词要带有文学色彩、符合游戏中的魔幻/科幻/写实风格，不能是粗暴的机器人机翻。
       - **通用表中的 VO 行**：当模板是“游戏音效配乐通用表”时，配音需求不要丢弃；请把配音行作为普通综合音频需求行输出，\`audio_type\` 为 \`VO\`，\`filename\` 使用 \`vo_[speaker_or_role]_[intent]\`，\`description\` 写声音角色/声线方向，\`script_tone\` 直接写台词文案与语气，\`remarks\` 写配音制作、口型、情绪或交付注意事项。
       - **通用表排序规则**：当模板是“游戏音效配乐通用表”时，输出顺序不要跟随用户文字描述顺序；必须先集中输出所有 SFX，再输出所有 BGM，最后输出所有 VO/人声/配音/台词需求。同一大类内部再保留需求的自然逻辑顺序。

    4. **输出格式**：
       - 必须输出符合以下模板要求的 JSON 数组。
       - 为避免生成结果过长导致 JSON 截断，每个字段都要简洁：description、remarks、script_tone 尽量控制在 120 个中文字符内；除非用户原始表格本身包含更多条目，否则一次最多输出 24 行。
       - 视频字幕类 VO 行不要重复写长段分析；优先保留台词、语气、时间/场景和制作注意事项。
       ${templateDescription}

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

  const response = await generateGeminiContent(ai, {
    model: GEMINI_PRIMARY_MODEL,
    contents: [{ parts }],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 24_576,
      responseSchema: schema
    }
  });

  if (!response.text) {
    throw new Error("AI 未能生成有效的内容，请检查您的输入或重试");
  }

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("JSON 解析失败:", {
      length: response.text.length,
      preview: response.text.slice(0, 500),
      tail: response.text.slice(-500),
      error: e,
    });
    throw new Error("AI 返回的需求表结果过长或格式不完整，系统已收紧输出长度，请再点击生成一次。");
  }
}

export interface OptimizedImportItem {
  id: string;
  name: string;
  fileName: string;
  category: string;
  tags: string[];
}

export async function optimizeImportMetadata(
  items: Array<{ id: string; originalName: string; path: string; size: string; type: string }>
): Promise<OptimizedImportItem[]> {
  if (isBrowser) {
    const result = await postJson<{ items: OptimizedImportItem[] }>('/api/ai/gemini/optimize-metadata', { items });
    return result.items;
  }

  const { ai, Type } = await getAI();
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
    我们需要通过AI智能重命名（英文工程规范）、分类、二级子分类、提取描述性中文显示名称，并智能生成标签（3-5个）。

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
       - 文件名后缀（如.wav, .mp3, .ogg）保持不变。
       - 主体格式必须是下划线英文小写结构。
       - 格式推荐：sfx_<分类简写>_<子类简写>_<描述性命名>_01.<后缀>
       - 例如：\`sfx_ui_uiclick_confirm_01.wav\`、\`sfx_weapon_melee_sword_slash_02.ogg\`、\`bgm_ambient_nature_forest_wind_loop_01.wav\`。
    4. **中文显示名称 (name)**：
       - 清爽、直观的中文描述性名称。
       - 例如：将 "UI_click_01_confirm_alt.wav" 改为 "UI 清脆确认点击音"；将 "slash_iron_metal.wav" 改为 "刀剑重击金属摩擦声"。
    5. **标签 (tags)**：
       - 智能提取该声音的声学质感、声学环境、乐器/材质等特征标签。
       - 每个文件生成 3-5 个短标签。例如：["金属", "写实", "硬撞击", "清脆"]。

    请将列表中的每一项进行智能转换，并且必须保留和返回对应的 \`id\`（以便客户端能够精确匹配回对应的文件）。
  `;

  const response = await generateGeminiContent(ai, {
    model: GEMINI_PRIMARY_MODEL,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: schema
    }
  });

  if (!response.text) {
    throw new Error("AI 批量优化未能生成有效的内容，请重试");
  }

  try {
    const parsed = JSON.parse(response.text);
    return parsed.items;
  } catch (e) {
    console.error("JSON 解析失败:", response.text);
    throw new Error("AI 批量优化返回的数据格式有误，请重试");
  }
}

export async function translateToEnglish(text: string): Promise<string> {
  if (!text || !text.trim()) return "";
  
  // Quick check: if already only alphanumeric, spaces, and basic punctuation, return as-is
  if (/^[a-zA-Z0-9\s\.,!\?'"\(\)\-\/]*$/.test(text)) {
    return text.trim();
  }

  if (isBrowser) {
    const result = await postJson<{ text: string }>('/api/ai/gemini/translate', { text });
    return result.text;
  }

  try {
    const { ai, ThinkingLevel } = await getAI();
    const prompt = `你是一个专业的翻译专家。请将以下文本翻译成地道、简洁的英文，用于描述 AI 声线或情感。
请只返回翻译后的英文文本，不要包含任何解释、说明或标点引号。

需要翻译的文本: "${text.trim()}"`;

    const response = await generateGeminiContent(ai, {
      model: GEMINI_PRIMARY_MODEL,
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

export interface VoiceV3PromptEnhancement {
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

const collectVoiceV3TagsForSegment = (segment: string) => {
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

const mergeVoiceV3TagsIntoSegment = (segment: string, tags: string[]) => {
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

const createLocalVoiceV3EnhancementFallback = (text: string): VoiceV3PromptEnhancement => {
  const normalizedText = text.trim();
  const chunks = splitVoicePromptIntoSpeakableChunks(normalizedText);
  const addedTagsInOrder: string[] = [];
  let taggedChunkCount = 0;

  const enhancedText = collapseDuplicateAdjacentVoiceTags(chunks.map(chunk => {
    const tags = collectVoiceV3TagsForSegment(chunk);
    if (tags.length > 0) {
      taggedChunkCount += 1;
      addedTagsInOrder.push(...tags);
    }
    return mergeVoiceV3TagsIntoSegment(chunk, tags);
  }).join(''));

  const addedTags = Array.from(new Set(addedTagsInOrder));

  return {
    enhancedText,
    addedTags,
    notes: addedTags.length > 0
      ? `已按 ${taggedChunkCount} 个句段添加分段 v3 语气标签；每个句段最多 3 个。`
      : '未检测到明确情绪关键词，保留原文。',
  };
};

const parseVoiceV3EnhancementResponse = (rawText: string, originalText: string): VoiceV3PromptEnhancement => {
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
    notes: String(parsed?.notes || '已按 ElevenLabs v3 audio tags 方式增强文本。').trim(),
  };
};

export async function enhanceVoicePromptForElevenV3(
  text: string,
  options: { voiceName?: string; voiceDescription?: string; language?: string } = {},
): Promise<VoiceV3PromptEnhancement> {
  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new Error('请先输入要增强的配音台词。');
  }

  if (isBrowser) {
    try {
      return await postJson<VoiceV3PromptEnhancement>('/api/ai/gemini/voice-v3-enhance', {
        text: normalizedText,
        voiceName: options.voiceName || '',
        voiceDescription: options.voiceDescription || '',
        language: options.language || '',
      }, { timeoutMs: 20_000 });
    } catch (error) {
      console.info('Voice v3 enhancement API failed, using local fallback:', error);
      return createLocalVoiceV3EnhancementFallback(normalizedText);
    }
  }

  try {
    const { ai, Type, ThinkingLevel } = await getAI();
    const prompt = `You are preparing text for ElevenLabs eleven_v3 text-to-speech.
Enhance the script by adding sparse, audible performance tags in square brackets, similar to ElevenLabs v3 audio tags.

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

    const response = await generateGeminiContent(ai, {
      model: GEMINI_PRIMARY_MODEL,
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

    return parseVoiceV3EnhancementResponse(String(response.text || ''), normalizedText);
  } catch (error) {
    console.error('Voice v3 prompt enhancement failed:', error);
    return createLocalVoiceV3EnhancementFallback(normalizedText);
  }
}

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
      const result = await postJson<{ text: string }>('/api/ai/gemini/music-prompt', {
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
    const { ai, ThinkingLevel } = await getAI();
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

    const response = await generateGeminiContent(ai, {
      model: GEMINI_PRIMARY_MODEL,
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
  options?: { preserveTone?: boolean }
): Promise<string> {
  const normalizedText = text.trim();
  if (!normalizedText) return '';

  const normalizedTargetLanguage = targetLanguage.trim() || 'English';

  if (isBrowser) {
    const result = await postJson<{ text: string }>('/api/ai/gemini/translate-language', {
      text: normalizedText,
      targetLanguage: normalizedTargetLanguage,
      preserveTone: options?.preserveTone !== false,
    });
    return result.text;
  }

  try {
    const { ai, ThinkingLevel } = await getAI();
    const prompt = `You are a professional dubbing translator.
Translate the source dialogue into ${normalizedTargetLanguage}.
Preserve the original meaning, emotion, tone, speaking intention, and natural spoken rhythm.
Make the translated line sound like a real voice actor would say it, not like a literal subtitle.
The output language MUST be ${normalizedTargetLanguage}. Do not return the source language unless the source is already ${normalizedTargetLanguage}.
Return only the translated dialogue. Do not add explanations, labels, quotation marks, or markdown.

Source dialogue:
${normalizedText}`;

    const response = await generateGeminiContent(ai, {
      model: GEMINI_PRIMARY_MODEL,
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

export async function matchBestVoice(
  description: string,
  gender: 'male' | 'female',
  voices: Array<{ id: string; name: string; englishName: string; gender: string; description: string; tags: string[] }>
): Promise<string> {
  if (!description || !description.trim()) {
    return voices[0]?.id || '';
  }

  if (isBrowser) {
    const result = await postJson<{ voiceId: string }>('/api/ai/gemini/match-voice', {
      description,
      gender,
      voices,
    });
    return result.voiceId;
  }

  try {
    const { ai, ThinkingLevel } = await getAI();
    // Prepare a simplified list of voices of the same gender for Gemini to consider
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

    const response = await generateGeminiContent(ai, {
      model: GEMINI_PRIMARY_MODEL,
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
    console.error("Gemini voice matching failed, falling back:", err);
    return voices[0]?.id || '';
  }
}
