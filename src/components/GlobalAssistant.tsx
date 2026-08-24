import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  FileAudio,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { TabType } from '../types';

export interface AssistantAudioRequest {
  id: string;
  file: File;
  task: 'analyze' | 'convert';
  targetFormat?: 'mp3';
  targetSampleRate?: number;
  targetBitrate?: number;
  targetLufs?: number;
}

export interface AssistantVoiceRequest {
  id: string;
  text: string;
  sourceText?: string;
  translationApplied?: boolean;
  language: string;
  gender: 'male' | 'female';
  emotion: string;
  role?: string;
  voiceSearchQuery?: string;
  openVoiceLibrary?: boolean;
}

export interface AssistantVideoRequest {
  id: string;
  file?: File;
  prompt: string;
  tracks: Array<'bgm' | 'sfx' | 'dubbing'>;
  analyzeSubtitles: boolean;
  autoAnalyze: boolean;
  autoGenerate: boolean;
}

export interface AssistantMusicRequest {
  id: string;
  prompt: string;
}

export interface AssistantSfxRequest {
  id: string;
  prompt: string;
}

export interface AssistantPlan {
  title: string;
  summary: string;
  tab: TabType;
  steps: string[];
  kind: 'audio' | 'voice' | 'video' | 'music' | 'sfx' | 'director' | 'requirements' | 'library' | 'general';
  tracks?: Array<'bgm' | 'sfx' | 'dubbing'>;
  analyzeSubtitles?: boolean;
  audioTargets?: {
    targetSampleRate?: number;
    targetBitrate?: number;
    targetLufs?: number;
  };
}

interface AssistantMemory {
  version: 1;
  taskCount: number;
  lastKind?: AssistantPlan['kind'];
  preferredLanguage?: string;
  preferredGender?: 'male' | 'female';
  preferredEmotion?: string;
  preferredFormat?: 'mp3';
  recentTasks: string[];
  customPreferences: string[];
}

interface GlobalAssistantProps {
  onNavigate: (tab: TabType) => void;
  onAudioRequest: (request: AssistantAudioRequest) => void;
  onVoiceRequest: (request: AssistantVoiceRequest) => void | Promise<void>;
  onVideoRequest: (request: AssistantVideoRequest) => void;
  onMusicRequest: (request: AssistantMusicRequest) => void;
  onSfxRequest: (request: AssistantSfxRequest) => void;
}

const AUDIO_EXTENSIONS = /\.(wav|mp3|m4a|aac|ogg|oga|flac|aif|aiff|opus|webm|caf)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|wmv)$/i;
const TEXT_EXTENSIONS = /\.(txt|md|csv|tsv|json|docx|xlsx|pdf)$/i;
const ASSISTANT_MEMORY_KEY = 'ai_audio_global_assistant_memory_v1';

const EMPTY_ASSISTANT_MEMORY: AssistantMemory = {
  version: 1,
  taskCount: 0,
  recentTasks: [],
  customPreferences: [],
};

const loadAssistantMemory = (): AssistantMemory => {
  if (typeof window === 'undefined') return EMPTY_ASSISTANT_MEMORY;
  try {
    const stored = window.localStorage.getItem(ASSISTANT_MEMORY_KEY);
    if (!stored) return EMPTY_ASSISTANT_MEMORY;
    const parsed = JSON.parse(stored) as Partial<AssistantMemory>;
    return {
      ...EMPTY_ASSISTANT_MEMORY,
      ...parsed,
      version: 1,
      recentTasks: Array.isArray(parsed.recentTasks) ? parsed.recentTasks.slice(0, 6) : [],
      customPreferences: Array.isArray(parsed.customPreferences) ? parsed.customPreferences.filter(Boolean).slice(0, 8) : [],
    };
  } catch {
    return EMPTY_ASSISTANT_MEMORY;
  }
};

const normalize = (value: string) => value.toLowerCase().replace(/[\s，。！？、:：;；()[\]{}]/g, '');

const detectVoiceRequest = (prompt: string) => {
  const normalized = normalize(prompt);
  return /配音|朗读|读出|声音|女声|男声|voice|tts|arabic|阿拉伯|阿语|英语|中文|日语|韩语/.test(normalized);
};

const detectAudioTask = (prompt: string, file?: File) => {
  const normalized = normalize(prompt);
  if (file && AUDIO_EXTENSIONS.test(file.name)) return true;
  return /音频|歌曲|音乐文件|wav|mp3|响度|风格分析|bpm|调性|格式转换|转换格式|转格式|提取音频|转成mp3|转换成mp3|音量/.test(normalized);
};

const detectVideoTask = (prompt: string, file?: File) => {
  const normalized = normalize(prompt);
  const hasVideoFile = Boolean(file && (file.type.startsWith('video/') || VIDEO_EXTENSIONS.test(file.name)));
  const hasVideoContext = /视频|字幕|画面|口型|镜头|视频声音制作|成片|影片|短片|视频配声|视频配音/.test(normalized);
  const hasSoundtrackContext = /给.*(?:配|加|制作)|(?:配|加|制作).*给/.test(normalized)
    && /配乐|背景音乐|bgm|音效|环境声|foley|配音|旁白|混音/.test(normalized);
  return (!normalized && hasVideoFile) || hasVideoContext || hasSoundtrackContext;
};

const detectVideoTracks = (prompt: string): Array<'bgm' | 'sfx' | 'dubbing'> => {
  const normalized = normalize(prompt);
  const tracks: Array<'bgm' | 'sfx' | 'dubbing'> = [];
  if (/配乐|背景音乐|bgm|音乐/.test(normalized)) tracks.push('bgm');
  if (/音效|环境声|拟音|foley|soundeffect/.test(normalized)) tracks.push('sfx');
  if (/配音|朗读|旁白|字幕|口型|人声/.test(normalized)) tracks.push('dubbing');
  return tracks.length ? tracks : ['bgm', 'sfx', 'dubbing'];
};

const detectSfxTask = (prompt: string) => {
  const normalized = normalize(prompt);
  return /音效|soundeffect|foley|打嗝|咳嗽|喷嚏|笑声|哭声|尖叫|脚步|敲门|开门|关门|爆炸|枪声|风声|雨声|雷声|鸟叫|猫叫|狗叫|呼吸|心跳|水滴|碰撞|刹车|汽车|按钮|提示音|击打|摩擦|燃烧|玻璃碎|whoosh|叮|哔声/.test(normalized);
};

const detectDirectorTask = (prompt: string) => (
  /音频设计|声音设计|声音方案|整体声音|音轨规划|音效排程|声音排程|多模态分析|全片设计|场景声音方案/.test(normalize(prompt))
);

const detectRequirementsTask = (prompt: string) => (
  /音效需求|需求表|需求清单|声音清单|镜头清单|制作清单|待办音效/.test(normalize(prompt))
);

const detectLibraryTask = (prompt: string) => (
  /音效库|声音库|音频资产|资产库|查找音效|搜索音效|浏览音效|下载音效|收藏音效/.test(normalize(prompt))
);

const extractLanguage = (prompt: string, fallback = 'zh') => {
  const normalized = normalize(prompt);
  if (/阿拉伯|阿语|arabic/.test(normalized)) return 'ar';
  if (/英语|英文|english/.test(normalized)) return 'en';
  if (/日语|日文|japanese/.test(normalized)) return 'ja';
  if (/韩语|韩文|korean/.test(normalized)) return 'ko';
  // Keep Chinese lines in their source language; persisted preferences must not
  // override the language of the current request.
  if (/[\u3400-\u9fff]/.test(prompt)) return 'zh';
  return fallback;
};

const extractGender = (prompt: string, fallback: 'male' | 'female' = 'female'): 'male' | 'female' => (
  /男声|男性|男生|男士|男孩|男牧师|男主播|男主持|男旁白|男配音|male|man/.test(normalize(prompt))
    ? 'male'
    : /女声|女性|女生|女士|女孩|女牧师|女主播|女主持|女旁白|女配音|female|woman/.test(normalize(prompt)) ? 'female' : fallback
);

const extractVoiceRole = (prompt: string) => {
  const normalized = prompt.replace(/[“”"「」『』]/g, ' ');
  const roleMatch = normalized.match(/(?:男|女)?(?:牧师|神父|传教士|主播|主持人?|旁白|解说|老师|医生|律师|警察|士兵|战士|公主|老人|少年|少女)/);
  return roleMatch?.[0]?.trim() || '';
};

const extractVoiceText = (prompt: string) => {
  const source = prompt.trim();
  if (!source) return '';

  // Prefer explicit quoted text so instruction punctuation never enters the TTS field.
  const quoted = source.match(/[“「『"]([^”」』"]+)[”」』"]/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();

  // A colon commonly separates the voice direction from the actual line.
  const colonIndexes = [source.indexOf('：'), source.indexOf(':')].filter((index) => index >= 0);
  const colonIndex = colonIndexes.length ? Math.min(...colonIndexes) : -1;
  if (colonIndex >= 0 && source.slice(colonIndex + 1).trim()) {
    return source.slice(colonIndex + 1).trim().replace(/^[“「『"]|[”」』"]$/g, '').trim();
  }

  // Remove a leading instruction when no explicit delimiter was provided.
  const withoutInstruction = source
    .replace(/^(?:请|帮我|请你)?\s*(?:把|将)?(?:这句话|这段话|下面这句|以下内容)?\s*(?:用[^，。！？:：]+?(?:的)?(?:语气|声音|声线))?\s*(?:读|读出|朗读|念出|说出|配音)\s*/i, '')
    .trim();
  return (withoutInstruction || source)
    .replace(/^\s*[\[(（【][^\])）】]{1,40}[\])）】]\s*/, '')
    .trim();
};

const extractEmotion = (prompt: string, fallback = '自然、清晰') => {
  const matches = ['温柔', '甜美', '坚定', '活泼', '悲伤', '开心', '平静', '紧张', '热情', '严肃', '神秘', '温暖']
    .filter((tag) => prompt.includes(tag));
  if (!matches.length && /[\u3400-\u9fff]/.test(prompt)) return '自然、清晰';
  return matches.length ? matches.join(', ') : fallback;
};

const extractAudioTargets = (prompt: string) => {
  const normalized = normalize(prompt);
  const lufsMatch = normalized.match(/(-?\d+(?:\.\d+)?)lufs/i)
    || normalized.match(/(?:\u54cd\u5ea6)(?:\u53d8\u6210|\u8bbe\u4e3a|\u4e3a)?(-?\d+(?:\.\d+)?)/i);
  const sampleRateMatch = normalized.match(/(\d+(?:\.\d+)?)(khz|hz|\u8d6b\u5179)/i)
    || normalized.match(/(?:\u91c7\u6837\u7387)(\d+(?:\.\d+)?)(khz|hz)?/i);
  const bitrateMatch = normalized.match(/(\d+(?:\.\d+)?)(kbps|kbit|kb\/s)/i)
    || normalized.match(/(?:\u6bd4\u7279\u7387)(\d+(?:\.\d+)?)/i);
  const sampleRateValue = sampleRateMatch ? Number(sampleRateMatch[1]) : undefined;
  const sampleRateUnit = sampleRateMatch?.[2]?.toLowerCase();

  return {
    targetLufs: lufsMatch ? Number(lufsMatch[1]) : undefined,
    targetSampleRate: sampleRateValue === undefined
      ? undefined
      : sampleRateUnit === 'khz' ? Math.round(sampleRateValue * 1000) : Math.round(sampleRateValue),
    targetBitrate: bitrateMatch ? Math.round(Number(bitrateMatch[1])) : undefined,
  };
};

const buildPlan = (prompt: string, file?: File, memory: AssistantMemory = EMPTY_ASSISTANT_MEMORY): AssistantPlan => {
  const normalized = normalize(prompt);
  const hasExplicitAudioOperation = /音频分析|分析音频|转格式|转换格式|格式转换|提取音频|转成mp3|转换成mp3|输出mp3/.test(normalized);
  if (detectVideoTask(prompt, file) && !hasExplicitAudioOperation) {
    const tracks = detectVideoTracks(prompt);
    const analyzeSubtitles = /字幕|台词|对白|口型|看画面|识别文字|分析视频/.test(normalized);
    const trackLabels = tracks.map((track) => track === 'bgm' ? '配乐轨' : track === 'sfx' ? '音效轨' : '配音轨');
    const steps = [
      '打开视频声音制作并载入视频',
      analyzeSubtitles ? '分析画面、字幕和时间线，补齐未识别的字幕片段' : '分析视频时长、画面节奏和声音时间线',
      ...trackLabels.map((label) => `生成${label}；重叠事件自动分配到独立轨道`),
      '试听每条轨道，支持单独重新生成、调整和静音',
      '确认后混音并导出最终视频',
    ];
    return {
      title: '准备视频声音制作',
      summary: file ? `已载入 ${file.name}，将按视频时间线生成 ${trackLabels.join('、')}` : `将按视频时间线生成 ${trackLabels.join('、')}`,
      tab: 'video-soundtrack',
      kind: 'video',
      tracks,
      analyzeSubtitles,
      steps,
    };
  }

  if (detectDirectorTask(prompt)) {
    return {
      title: '准备 AI 音频设计',
      summary: '识别为整体声音方案与音轨规划任务',
      tab: 'audio-director',
      kind: 'director',
      steps: [
        '打开 AI 音频设计',
        '整理场景、情绪、节奏和声音层级',
        '输出配乐、音效和配音的制作建议',
      ],
    };
  }

  if (detectRequirementsTask(prompt)) {
    return {
      title: '准备音效需求表',
      summary: '识别为音效需求清单整理任务',
      tab: 'sfx-requirements',
      kind: 'requirements',
      steps: [
        '打开音效需求表',
        '按场景和时间线整理待制作音效',
        '保留编辑、补充、翻译和导出功能',
      ],
    };
  }

  if (detectLibraryTask(prompt)) {
    return {
      title: '打开音效库',
      summary: '识别为查找、试听、下载或收藏音频资产任务',
      tab: 'sfx-library',
      kind: 'library',
      steps: [
        '打开音效库',
        '定位对应目录并搜索音频',
        '试听后下载或收藏选中的文件',
      ],
    };
  }

  if (detectVoiceRequest(prompt) && !detectAudioTask(prompt, file)) {
    const language = extractLanguage(prompt, memory.preferredLanguage);
    const languageLabel = language === 'ar' ? '阿拉伯语' : language === 'en' ? '英语' : language === 'ja' ? '日语' : language === 'ko' ? '韩语' : '原语言';
    const genderLabel = extractGender(prompt, memory.preferredGender) === 'female' ? '女声' : '男声';
    const emotion = extractEmotion(prompt, memory.preferredEmotion);
    const sourceIsChinese = /[\u3400-\u9fff]/.test(extractVoiceText(prompt));
    const needsTranslation = language === 'en' && sourceIsChinese;
    return {
      title: '准备 AI 配音',
      summary: `识别为${languageLabel}${genderLabel}配音，语气：${emotion}`,
      tab: 'dubbing-studio',
      kind: 'voice',
      steps: [
        '打开 AI 配音 · 文本转语音',
        `使用${genderLabel}声音库筛选：${emotion}`,
        needsTranslation
          ? '检测到中文台词：先翻译成英文，再交给配音模块'
          : language === 'ar' ? '保留阿拉伯语目标语言；中文台词需要翻译时再确认译文' : '保留原文并按目标语种生成',
        '展开声音库并按性别、角色、语言和语气匹配度排序',
        '由你选择声音并点击生成，助手不会自动生成配音',
      ],
    };
  }

  if (detectSfxTask(prompt) && !hasExplicitAudioOperation) {
    return {
      title: '准备生成音效',
      summary: `识别为 AI 音效生成任务：${prompt.trim() || '根据当前描述生成音效'}`,
      tab: 'sfx-studio',
      kind: 'sfx',
      steps: [
        '打开 AI 音效',
        '根据描述识别主体、动作、材质和空间感',
        '生成两版试听结果并保留重新生成和下载',
      ],
    };
  }

  if (detectAudioTask(prompt, file)) {
    const audioTargets = extractAudioTargets(prompt);
    const wantsConvert = /转成mp3|转换成mp3|输出mp3|格式转换|转换格式|转格式|提取音频|convert.*mp3|mp3/.test(normalized);
    const hasProcessingTarget = wantsConvert || audioTargets.targetSampleRate !== undefined || audioTargets.targetBitrate !== undefined || audioTargets.targetLufs !== undefined;
    const wantsAnalysis = /分析|风格|响度|bpm|调性|和弦|乐器|snr|动态/.test(normalized) || hasProcessingTarget || !wantsConvert;
    const steps: string[] = [];
    if (wantsAnalysis) {
      steps.push('打开音频工具 > 音频分析，读取原文件的格式、时长、采样率和音量');
      steps.push('完成风格、BPM、调性、响度、动态范围、底噪和 SNR 分析');
    }
    if (hasProcessingTarget) {
      steps.push('切换到格式/压缩/音量，继续使用同一个原始文件');
      if (wantsConvert) steps.push('设置目标格式为 MP3');
      if (audioTargets.targetSampleRate !== undefined) steps.push(`设置目标采样率为 ${audioTargets.targetSampleRate} Hz`);
      if (audioTargets.targetBitrate !== undefined) steps.push(`设置目标比特率为 ${audioTargets.targetBitrate} kbps`);
      if (audioTargets.targetLufs !== undefined) steps.push(`启用响度统一并设置目标为 ${audioTargets.targetLufs} LUFS，同时保留峰值保护`);
      steps.push('先生成处理结果并试听，确认音量和音质后再下载');
    } else {
      steps.push('分析结果生成后提供试听和下载');
    }
    return {
      title: hasProcessingTarget && wantsAnalysis ? '分析、转换并标准化音频' : wantsConvert ? '转换音频格式' : '分析音频',
      summary: file ? `已载入 ${file.name}` : '将使用音频工具处理你的任务',
      tab: 'audio-tools',
      kind: 'audio',
      steps,
      audioTargets,
    };
  }

  if (/配乐|bgm|背景音乐|音乐|music/.test(normalized)) {
    return {
      title: '准备生成音乐',
      summary: '识别为 AI 音乐生成任务',
      tab: 'music-studio',
      kind: 'music',
      steps: ['打开 AI 音乐', '填入风格、情绪和时长', '生成试听结果并保留下载'],
    };
  }

  return {
    title: '准备智能处理',
    summary: '暂时无法确定唯一功能入口，请确认下面的执行步骤',
    tab: 'workbench',
    kind: 'general',
    steps: ['回到工作台', '保留你的原始描述', '从对应功能卡片继续处理'],
  };
};

export default function GlobalAssistant({ onNavigate, onAudioRequest, onVoiceRequest, onVideoRequest, onMusicRequest, onSfxRequest }: GlobalAssistantProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [file, setFile] = useState<File | undefined>();
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAddingPreference, setIsAddingPreference] = useState(false);
  const [preferenceDraft, setPreferenceDraft] = useState('');
  const [memory, setMemory] = useState<AssistantMemory>(() => loadAssistantMemory());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addManualPreference = () => {
    const value = preferenceDraft.trim();
    if (!value) return;
    const preferenceLanguage = /英语|英文|english/i.test(value)
      ? 'en'
      : /阿拉伯语|阿拉伯文|arabic/i.test(value)
        ? 'ar'
        : /中文|汉语|普通话|chinese|mandarin/i.test(value)
          ? 'zh'
          : undefined;
    const preferenceGender = /男声|男性|男牧师|male|man|pastor|priest/i.test(value)
      ? 'male'
      : /女声|女性|female|woman/i.test(value)
        ? 'female'
        : undefined;
    const preferenceEmotion = /温柔|柔和|gentle|soft/i.test(value)
      ? '温柔'
      : /开心|高兴|快乐|happy|excited/i.test(value)
        ? '开心'
        : /严肃|正式|专业|serious|formal/i.test(value)
          ? '严肃'
          : undefined;
    setMemory((previous) => ({
      ...previous,
      customPreferences: [value, ...previous.customPreferences.filter((item) => item !== value)].slice(0, 8),
      preferredLanguage: preferenceLanguage || previous.preferredLanguage,
      preferredGender: preferenceGender || previous.preferredGender,
      preferredEmotion: preferenceEmotion || previous.preferredEmotion,
    }));
    setPreferenceDraft('');
    setIsAddingPreference(false);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(ASSISTANT_MEMORY_KEY, JSON.stringify(memory));
    } catch {
      // Private browsing or embedded contexts may deny local storage.
    }
  }, [memory]);

  const fileKind = useMemo(() => {
    if (!file) return null;
    if (AUDIO_EXTENSIONS.test(file.name) || file.type.startsWith('audio/')) return 'audio';
    if (file.type.startsWith('image/')) return 'image';
    if (TEXT_EXTENSIONS.test(file.name) || file.type.startsWith('text/')) return 'text';
    return 'file';
  }, [file]);

  const analyzeRequest = () => {
    try {
      setError(null);
      const nextPlan = buildPlan(prompt, file, memory);
      setPlan(nextPlan);
      setMemory((previous) => ({
        ...previous,
        taskCount: previous.taskCount + 1,
        lastKind: nextPlan.kind,
        preferredLanguage: nextPlan.kind === 'voice' ? extractLanguage(prompt, previous.preferredLanguage) : previous.preferredLanguage,
        preferredGender: nextPlan.kind === 'voice' ? extractGender(prompt, previous.preferredGender) : previous.preferredGender,
        preferredEmotion: nextPlan.kind === 'voice' ? extractEmotion(prompt, previous.preferredEmotion) : previous.preferredEmotion,
        preferredFormat: /转成mp3|转换成mp3|输出mp3|mp3/i.test(normalize(prompt)) ? 'mp3' : previous.preferredFormat,
        recentTasks: [prompt.trim(), ...previous.recentTasks.filter((item) => item !== prompt.trim())].filter(Boolean).slice(0, 6),
      }));
    } catch (cause) {
      console.error('智能助手分析失败:', cause);
      setPlan(null);
      setError('任务分析失败，请检查描述后重试。');
    }
  };

  const executePlan = async () => {
    if (!plan) return;
    setRunning(true);
    setError(null);
    const shouldCloseAfterSuccess = ['director', 'requirements', 'library', 'voice', 'video', 'music', 'sfx'].includes(plan.kind);
    try {
      onNavigate(plan.tab);
      const requestId = `assistant-${Date.now()}`;

      if (plan.kind === 'audio' && file) {
        const hasAudioTargets = plan.audioTargets && Object.values(plan.audioTargets).some((value) => value !== undefined);
        const wantsConvert = hasAudioTargets || /转成mp3|转换成mp3|输出mp3|格式转换|转换格式|转格式|提取音频|mp3/i.test(prompt);
        onAudioRequest({
          id: requestId,
          file,
          task: wantsConvert ? 'convert' : 'analyze',
          targetFormat: 'mp3',
          ...plan.audioTargets,
        });
      } else if (plan.kind === 'voice') {
        const language = extractLanguage(prompt, memory.preferredLanguage);
        const gender = extractGender(prompt, memory.preferredGender);
        const emotion = extractEmotion(prompt, memory.preferredEmotion);
        const genderLabel = gender === 'female' ? '女声' : '男声';
        const role = extractVoiceRole(prompt);
        await onVoiceRequest({
          id: requestId,
          text: extractVoiceText(prompt),
          language,
          gender,
          emotion,
          role: role || undefined,
          voiceSearchQuery: [role, genderLabel, emotion, language].filter(Boolean).join(' '),
          openVoiceLibrary: true,
        });
      } else if (plan.kind === 'video') {
        onVideoRequest({
          id: requestId,
          file,
          prompt,
          tracks: plan.tracks || ['bgm', 'sfx', 'dubbing'],
          analyzeSubtitles: plan.analyzeSubtitles ?? true,
          autoAnalyze: true,
          autoGenerate: true,
        });
      } else if (plan.kind === 'music') {
        onMusicRequest({ id: requestId, prompt: prompt.trim() });
      } else if (plan.kind === 'sfx') {
        onSfxRequest({ id: requestId, prompt: prompt.trim() });
      }

      if (shouldCloseAfterSuccess) setOpen(false);
      window.setTimeout(() => setRunning(false), 700);
    } catch (cause) {
      console.error('智能助手执行失败:', cause);
      setRunning(false);
      setError('打开功能失败，当前任务已保留。请重试，或直接从主导航进入对应功能。');
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[80]">
      {!open && (
        <button
          type="button"
          aria-label="打开智能助手"
          onClick={() => setOpen(true)}
          className="pointer-events-auto absolute bottom-5 right-5 flex h-14 w-14 items-center justify-center rounded-full border border-cyan-200/35 bg-[#07151d]/95 text-cyan-100 shadow-[0_0_28px_rgba(45,212,191,0.22),0_18px_40px_rgba(0,0,0,0.35)] transition hover:scale-105 hover:border-cyan-100/70 hover:bg-[#0b202a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 sm:bottom-7 sm:right-7"
        >
          <Sparkles className="h-5 w-5" />
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-label="全局智能助手"
          className="pointer-events-auto absolute bottom-4 right-4 flex w-[min(440px,calc(100vw-2rem))] max-h-[min(720px,calc(100dvh-2rem))] flex-col overflow-hidden rounded-[22px] border border-cyan-300/25 bg-[#061018]/70 text-slate-100 shadow-[0_24px_90px_rgba(0,0,0,0.36),0_0_0_1px_rgba(45,212,191,0.06)] backdrop-blur-xl sm:bottom-6 sm:right-6"
        >
          <header className="relative flex items-center justify-between border-b border-cyan-300/15 bg-[#081a24]/72 px-5 py-4 text-white">
            <div className="absolute inset-x-0 top-0 h-px bg-cyan-200/75" aria-hidden="true" />
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-200/25 bg-cyan-300/10 shadow-[0_0_20px_rgba(45,212,191,0.16)]">
                <Sparkles className="h-4 w-4 text-cyan-200" />
              </div>
              <div>
                <h2 className="text-sm font-bold">智能助手</h2>
                <p className="mt-0.5 text-[10px] text-slate-300">描述任务，我会打开对应功能并准备参数</p>
              </div>
            </div>
            <div className="mr-2 flex items-center gap-1.5 font-mono text-[8px] tracking-[0.16em] text-cyan-200/65" aria-label="SYSTEM ONLINE">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300/50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-200" />
              </span>
              <span className="hidden sm:inline">ONLINE</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭智能助手"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition hover:border-cyan-200/25 hover:bg-cyan-300/10 hover:text-cyan-100"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[linear-gradient(rgba(103,232,249,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(103,232,249,0.035)_1px,transparent_1px)] bg-[size:20px_20px] bg-[#061018]/30 p-3.5">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer rounded-2xl border border-dashed border-cyan-300/30 bg-[#0b202a]/40 p-3 transition hover:border-cyan-200/70 hover:bg-cyan-300/10"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/*,image/*,.txt,.md,.csv,.tsv,.json,.docx,.xlsx,.pdf"
                className="hidden"
                onChange={(event) => setFile(event.target.files?.[0])}
              />
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-200/15 bg-cyan-300/10 text-cyan-100 shadow-[0_0_18px_rgba(45,212,191,0.1)]">
                  {fileKind === 'audio' ? <FileAudio className="h-4 w-4" /> : fileKind === 'image' ? <ImageIcon className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-cyan-50">{file ? file.name : '上传音频、视频、图片或文档'}</p>
                  <p className="mt-0.5 text-[10px] text-cyan-100/50">{file ? `${Math.max(1, Math.round(file.size / 1024))} KB · 点击替换` : '也可以只输入文字任务'}</p>
                </div>
                {file && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Check className="h-4 w-4 text-cyan-200" aria-hidden="true" />
                    <button
                      type="button"
                      aria-label="删除已上传文件"
                      title="删除已上传文件"
                      onClick={(event) => {
                        event.stopPropagation();
                        setFile(undefined);
                        setPlan(null);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-cyan-100/50 transition hover:bg-red-400/10 hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') analyzeRequest();
              }}
              placeholder="告诉我你想完成什么……"
              className="min-h-28 w-full resize-y rounded-2xl border border-cyan-300/20 bg-[#081a24]/40 px-3 py-3 text-xs leading-relaxed text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-200/70 focus:ring-2 focus:ring-cyan-300/15"
            />

            <button
              type="button"
              disabled={!prompt.trim() && !file}
              onClick={analyzeRequest}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-cyan-100/20 bg-cyan-300 text-xs font-bold text-slate-950 shadow-[0_0_22px_rgba(45,212,191,0.16)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-slate-800 disabled:text-slate-500"
            >
              <Sparkles className="h-4 w-4" />
              分析任务
            </button>

            {error && (
              <div role="alert" className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[10px] leading-relaxed text-amber-100">
                {error}
              </div>
            )}

            {plan && (
              <div className="space-y-3 rounded-2xl border border-emerald-300/20 bg-[#0a1e23]/52 p-3.5 shadow-[inset_0_1px_0_rgba(167,243,208,0.04)]">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-black text-slate-100">{plan.title}</h3>
                    <span className="rounded-full border border-cyan-200/20 bg-cyan-300/10 px-2 py-0.5 text-[9px] font-bold text-cyan-100">{plan.tab === 'dubbing-studio' ? 'AI 配音' : plan.tab === 'audio-tools' ? '音频工具' : plan.tab === 'video-soundtrack' ? '视频声音制作' : plan.tab === 'music-studio' ? 'AI 音乐' : plan.tab === 'sfx-studio' ? 'AI 音效' : plan.tab === 'audio-director' ? 'AI 音频设计' : plan.tab === 'sfx-requirements' ? '音效需求表' : plan.tab === 'sfx-library' ? '音效库' : '工作台'}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-300">{plan.summary}</p>
                </div>
                <ol className="space-y-2">
                  {plan.steps.map((step, index) => (
                    <li key={step} className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-300">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-cyan-200/25 bg-cyan-300/10 text-[9px] font-black text-cyan-100">{index + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  onClick={executePlan}
                  disabled={running}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200/25 bg-emerald-300 text-xs font-bold text-slate-950 shadow-[0_0_22px_rgba(52,211,153,0.14)] transition hover:bg-emerald-200 disabled:bg-emerald-900 disabled:text-emerald-100/50"
                >
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                  {running ? '正在打开并准备…' : '确认并打开功能'}
                </button>
              </div>
            )}
          </div>

          <footer className="space-y-2 border-t border-cyan-300/15 bg-[#07151d]/50 px-4 py-3">
            {isAddingPreference && (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  addManualPreference();
                }}
              >
                <input
                  autoFocus
                  value={preferenceDraft}
                  onChange={(event) => setPreferenceDraft(event.target.value)}
                  placeholder="输入正确的任务偏好..."
                  aria-label="手动任务偏好"
                  className="min-w-0 flex-1 rounded-lg border border-cyan-200/25 bg-[#081a24]/70 px-2.5 py-2 text-[10px] text-cyan-50 outline-none placeholder:text-cyan-100/35 focus:border-cyan-200/70"
                />
                <button type="submit" aria-label="保存任务偏好" title="保存任务偏好" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-300 text-slate-950 transition hover:bg-emerald-200">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label="取消添加任务偏好" title="取消" onClick={() => { setIsAddingPreference(false); setPreferenceDraft(''); }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-200/20 text-cyan-100/60 transition hover:bg-cyan-300/10 hover:text-cyan-50">
                  <X className="h-3.5 w-3.5" />
                </button>
              </form>
            )}

            {memory.customPreferences.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[9px] tracking-wide text-cyan-100/45">手动偏好</span>
                {memory.customPreferences.map((preference, index) => (
                  <button
                    key={`${preference}-${index}`}
                    type="button"
                    title="编辑此任务偏好"
                    onClick={() => { setPreferenceDraft(preference); setIsAddingPreference(true); }}
                    className="max-w-full truncate rounded-md border border-cyan-200/15 bg-cyan-300/10 px-2 py-1 text-[9px] text-cyan-100/75 transition hover:border-cyan-200/40 hover:bg-cyan-300/15"
                  >
                    {preference}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[10px] text-cyan-100/50">
                {memory.taskCount > 0 ? `已记住 ${memory.taskCount} 次任务偏好` : '会记住你的常用偏好，下一次自动沿用'}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label="添加任务偏好"
                  title="手动添加正确的任务偏好"
                  onClick={() => { setIsAddingPreference(true); setPreferenceDraft(''); }}
                  className="inline-flex items-center gap-1 rounded-md border border-cyan-200/20 px-2 py-1 text-[10px] font-bold text-cyan-100/70 transition hover:border-cyan-200/45 hover:bg-cyan-300/10 hover:text-cyan-50"
                >
                  <Plus className="h-3 w-3" />
                  <span className="hidden sm:inline">添加偏好</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setMemory(EMPTY_ASSISTANT_MEMORY); setIsAddingPreference(false); setPreferenceDraft(''); }}
                  className="text-[10px] font-bold text-cyan-100/50 hover:text-cyan-100"
                  title="清除助手记住的偏好"
                >
                  重置记忆
                </button>
                <button type="button" onClick={() => { setPrompt(''); setFile(undefined); setPlan(null); setError(null); }} className="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-100/60 hover:text-cyan-50">
                  <Send className="h-3 w-3" /> 清空
                </button>
              </div>
            </div>
          </footer>
        </section>
      )}
    </div>
  );
}
