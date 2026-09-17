import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Check,
  ChevronRight,
  FileText,
  Loader2,
  MessageCircle,
  MessageSquarePlus,
  Minus,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { TabType } from '../types';
import {
  EMPTY_SFX_LIBRARY_INDEX,
  buildSfxLibraryIndex,
  SFX_LIBRARY_CATEGORIES_KEY,
  SFX_LIBRARY_INDEX_EVENT,
  SFX_LIBRARY_SOUNDS_KEY,
  findSfxLibraryMatches,
  readSfxLibraryIndex,
} from '../services/sfxLibraryIndex';
import type { SfxLibraryIndex } from '../services/sfxLibraryIndex';

export interface AssistantAudioRequest {
  id: string;
  file?: File;
  task: 'analyze' | 'convert' | 'rename' | 'workstation' | 'isolate' | 'midi' | 'music-separation';
  audioTool?: 'workstation' | 'analysis' | 'factory' | 'renamer' | 'isolation' | 'midi' | 'music-separation';
  targetFormat?: 'mp3' | 'wav' | 'ogg' | 'flac' | 'aac' | 'm4a';
  targetSampleRate?: number;
  targetBitrate?: number;
  targetLufs?: number;
}

export interface AssistantVoiceRequest {
  id: string;
  file?: File;
  text: string;
  sourceText?: string;
  translationApplied?: boolean;
  language: string;
  gender: 'male' | 'female';
  emotion: string;
  role?: string;
  voiceSearchQuery?: string;
  openVoiceLibrary?: boolean;
  mode?: 'tts' | 'sts' | 'translate' | 'stt';
  inputMode?: 'single' | 'batch';
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
  durationSeconds?: number;
  musicType?: 'instrumental' | 'vocal';
}

export interface AssistantSfxRequest {
  id: string;
  prompt: string;
  durationSeconds?: number;
}

export interface AssistantDirectorRequest {
  id: string;
  file?: File;
  prompt: string;
}

export interface AssistantRequirementsRequest {
  id: string;
  prompt: string;
  template?: 'game_sfx_general' | 'game_sfx_middleware' | 'voiceover_general' | 'voiceover_multilang';
}

export interface AssistantLibraryRequest {
  id: string;
  searchQuery: string;
  category?: string;
  subcategory?: string;
}

export interface AssistantPlan {
  title: string;
  summary: string;
  tab: TabType;
  steps: string[];
  kind: 'audio' | 'voice' | 'video' | 'music' | 'sfx' | 'director' | 'requirements' | 'library' | 'general';
  tracks?: Array<'bgm' | 'sfx' | 'dubbing'>;
  analyzeSubtitles?: boolean;
  autoGenerateVideo?: boolean;
  librarySearchQuery?: string;
  libraryMatchCount?: number;
  libraryCategory?: string;
  librarySubcategory?: string;
  libraryFallbackKind?: 'sfx' | 'music';
  libraryFallbackPrompt?: string;
  inputPrompt?: string;
  durationSeconds?: number;
  musicType?: 'instrumental' | 'vocal';
  voiceMode?: AssistantVoiceRequest['mode'];
  voiceInputMode?: AssistantVoiceRequest['inputMode'];
  voiceText?: string;
  voiceLanguage?: string;
  voiceGender?: 'male' | 'female';
  voiceEmotion?: string;
  voiceRole?: string;
  openVoiceLibrary?: boolean;
  requestedAudioFormat?: AssistantAudioRequest['targetFormat'];
  requirementsTemplate?: AssistantRequirementsRequest['template'];
  navigationOnly?: boolean;
  audioTargets?: {
    targetSampleRate?: number;
    targetBitrate?: number;
    targetLufs?: number;
  };
  audioTask?: AssistantAudioRequest['task'];
  audioTool?: AssistantAudioRequest['audioTool'];
  plannerSource?: 'model' | 'local';
  plannerModel?: string;
  plannerProvider?: 'openai' | 'ark' | 'tokenhub';
  plannerWarning?: string;
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
}

interface AssistantConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface SharedAssistantState {
  prompt: string;
  file?: File;
  plan: AssistantPlan | null;
  conversation: AssistantConversationMessage[];
}

let sharedAssistantState: SharedAssistantState = {
  prompt: '',
  file: undefined,
  plan: null,
  conversation: [],
};
const sharedAssistantListeners = new Set<() => void>();

const subscribeToSharedAssistant = (listener: () => void) => {
  sharedAssistantListeners.add(listener);
  return () => sharedAssistantListeners.delete(listener);
};

const readSharedAssistant = () => sharedAssistantState;

const updateSharedAssistant = (
  update: Partial<SharedAssistantState> | ((previous: SharedAssistantState) => Partial<SharedAssistantState>),
) => {
  const next = typeof update === 'function' ? update(sharedAssistantState) : update;
  sharedAssistantState = { ...sharedAssistantState, ...next };
  sharedAssistantListeners.forEach((listener) => listener());
};

interface GlobalAssistantProps {
  onNavigate: (tab: TabType) => void;
  onAudioRequest: (request: AssistantAudioRequest) => void;
  onVoiceRequest: (request: AssistantVoiceRequest) => void | Promise<void>;
  onVideoRequest: (request: AssistantVideoRequest) => void;
  onMusicRequest: (request: AssistantMusicRequest) => void;
  onSfxRequest: (request: AssistantSfxRequest) => void;
  onDirectorRequest?: (request: AssistantDirectorRequest) => void;
  onRequirementsRequest?: (request: AssistantRequirementsRequest) => void;
  onLibraryRequest?: (request: AssistantLibraryRequest) => void;
  externalTaskRunning?: boolean;
  embedded?: boolean;
}

const AUDIO_EXTENSIONS = /\.(wav|mp3|m4a|aac|ogg|oga|flac|aif|aiff|opus|webm|caf)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|wmv)$/i;
const TEXT_EXTENSIONS = /\.(txt|md|csv|tsv|json|docx|xlsx|pdf)$/i;
const ASSISTANT_MEMORY_KEY = 'ai_audio_global_assistant_memory_v1';

const EMPTY_ASSISTANT_MEMORY: AssistantMemory = {
  version: 1,
  taskCount: 0,
  recentTasks: [],
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
    };
  } catch {
    return EMPTY_ASSISTANT_MEMORY;
  }
};

const normalize = (value: string) => value.toLowerCase().replace(/[\s，。！？、:：;；()[\]{}]/g, '');

const detectVoiceRequest = (prompt: string) => {
  const normalized = normalize(prompt);
  return /配音(?!乐)|朗读|读出|念出|说出|女声|男声|女性|男性|voiceover|tts/.test(normalized)
    || /(?:用|换成|改成).{0,20}(?:声音|声线).{0,20}(?:读|朗读|配音)/.test(normalized)
    || /(?:用|让).{0,30}(?:说|念|读|朗读)/.test(normalized);
};

const detectVoiceMode = (prompt: string): NonNullable<AssistantVoiceRequest['mode']> => {
  const normalized = normalize(prompt);
  if (
    /(?:语音|音频|录音|配音|声音|对白|旁白)(?:转|转成|转为|转换成)(?:文本|文字|台词)/.test(normalized)
    || /(?:从|把|将)?(?:语音|音频|录音|配音|声音|对白|旁白).{0,24}(?:提取|识别|整理出|导出).{0,12}(?:文本|文字|台词|内容)/.test(normalized)
    || /(?:提取|识别).{0,20}(?:语音|音频|录音|配音|声音|对白|旁白).{0,12}(?:文本|文字|台词|内容)/.test(normalized)
    || /(?:转写|听写|转录)/.test(normalized)
    || /(?:语音|音频|录音|配音|声音|对白|旁白).{0,20}(?:说了什么|讲了什么|说的内容|讲的内容|内容是什么)/.test(normalized)
    || /语音识别|音频识别|录音识别|识别录音内容|语音转写|音频转写|录音转写/.test(normalized)
  ) return 'stt';
  if (/跨语种转换|跨语言转换|跨语种配音|语音翻译|音频翻译|录音翻译|保留原声线|保留音色|原声线.*翻译|原音色.*翻译/.test(normalized)) return 'translate';
  if (/语音转语音|声音转声音|变声|换声|换音色|换声线|转换声线|男声变女声|女声变男声|变成女声|变成男声|(?:录音|语音|声音).{0,24}(?:听起来像|改成|换成|变为).{0,16}(?:男声|女声|声线)/.test(normalized)) return 'sts';
  return 'tts';
};

const hasExplicitVoiceWorkflow = (prompt: string) => detectVoiceMode(prompt) !== 'tts';

const detectAudioTask = (prompt: string, file?: File) => {
  const normalized = normalize(prompt);
  if (file && AUDIO_EXTENSIONS.test(file.name)) return true;
  return /音频|歌曲|音乐文件|wav|mp3|midi|扒谱|扒带|响度|风格分析|bpm|调性|格式转换|转换格式|转格式|提取音频|转成mp3|转换成mp3|音量|压缩|采样率|比特率|lufs|分轨|stem|stems/.test(normalized);
};

const detectWorkstationTask = (prompt: string) => {
  const normalized = normalize(prompt);
  const hasExplicitAnalysis = /分析|检测|识别|统计|测一下|测量|测速|查看|是多少|多少/.test(normalized);
  return !hasExplicitAnalysis && /音频工具|音频工作站|daw|升调|降调|升[^，。！？:：]{0,8}半音|降[^，。！？:：]{0,8}半音|提高音调|降低音调|调高|调低|升高|变调|移调|变速|播放速度|倍速|音频拉伸|时间拉伸|时间伸缩|time.?stretch|加速|加快|放慢|减速|减慢|节拍器|打拍子|bpm|拍号|剪掉|剪切|裁剪|裁掉|切掉|分割|拆分|淡入|淡出|混音|混合|声像|左右声道|左声道|右声道|交换声道|声道互换|音轨|轨道|时间线|网格吸附|吸附|复制.*片段|粘贴.*片段|删除.*片段|静音.*片段|静音事件|复制音频|粘贴音频|撤销|重做|恢复操作|添加音轨|新增音轨|删除音轨|独奏音轨|轨道独奏|导入.*音频|导出混音/.test(normalized);
};

const detectFactoryTask = (prompt: string) => {
  const normalized = normalize(prompt);
  return /格式转换|转换格式|转格式|(?:转成|转换成|转为|提取成|提取为|输出|导出为|导出成|保存为)(?:mp3|wav|flac|ogg|aac|m4a)|压缩音频|压缩|采样率|比特率|kbps|khz|响度标准化|标准化响度|lufs/.test(normalized)
    || /(?:从)?视频.*(?:提取|导出).*(?:声音|音频|原声)|(?:提取|导出).*视频.*(?:声音|音频|原声)/.test(normalized)
    || (/音量/.test(normalized) && !/轨道音量|声像|混音/.test(normalized));
};

const detectAnalysisTask = (prompt: string) => {
  const normalized = normalize(prompt);
  return /分析音频|音频分析|分析这首|分析歌曲|风格分析|bpm分析|分析bpm|调性|和弦|乐器|响度分析|动态范围|底噪|snr|信噪比/.test(normalized);
};

const detectIsolationTask = (prompt: string) => {
  const normalized = normalize(prompt);
  return /人声分离|提取人声|提取.*人声|分离人声|去掉人声|消除人声|提取伴奏|去除伴奏|去掉.*伴奏|删除.*伴奏|移除.*伴奏|分离.*伴奏|消除伴奏|去噪|降噪|消除噪音|消除背景音|去掉背景音乐|去除背景音乐|删除背景音乐|移除背景音乐/.test(normalized);
};

const detectMusicSeparationTask = (prompt: string) => {
  const normalized = normalize(prompt);
  return /歌曲分轨|音乐分轨|乐器分轨|多乐器分轨|高质量音乐分轨|拆分分轨|分离分轨|分轨拆分|(?:歌|歌曲|音乐|混音|bgm|一首歌).{0,12}分轨|分轨.{0,12}(?:拆|分离|提取|导出|出来)|拆(?:出|开)?.{0,12}(?:鼓|贝斯|bass|吉他|钢琴|人声|伴奏|乐器|stem|stems|音源|轨道)|(?:分离|提取).{0,12}(?:鼓|贝斯|bass|吉他|钢琴|乐器|stem|stems|音源|轨道)|(?:鼓|贝斯|bass|吉他|钢琴|人声|伴奏|乐器|stem|stems|音源).{0,12}(?:拆分|分离|分轨|提取|导出)|stemseparation|musicseparation|stems分离|stems拆分/.test(normalized);
};

const detectMidiTask = (prompt: string) => (
  /音频转midi|转midi|转成midi|转为midi|转换成midi|导出midi|输出midi|保存为midi|midi提取|提取midi|生成midi|扒谱|扒带|钢琴转谱|音频转谱|旋律转谱|audio2midi|audiotomidi/.test(normalize(prompt))
);

const detectRenameTask = (prompt: string) => (
  /重命名|批量命名|批量重命名|改文件名|修改文件名|改名|(?:音频)?文件(?:名)?.*(?:前缀|后缀|编号|大小写|查找替换|正则替换|删除字符)|(?:前缀|后缀|自动编号).*文件名/.test(normalize(prompt))
);

const detectBatchVoiceRequest = (prompt: string) => (
  /批量配音|多文本配音|多段配音|多句配音|多角色配音|批量朗读|多段台词|多句台词/.test(normalize(prompt))
);

const detectSettingsNavigation = (prompt: string) => (
  /^(?:打开|进入|前往|切换到|带我去)?(?:系统)?设置(?:页面|面板|中心)?$/.test(normalize(prompt))
);

const detectWorkbenchNavigation = (prompt: string) => (
  /^(?:打开|进入|前往|切换到|返回|回到)?(?:工作台|首页|主页)$/.test(normalize(prompt))
);

const buildExplicitNavigationPlan = (prompt: string): AssistantPlan | null => {
  const normalized = normalize(prompt);
  const match = normalized.match(/^(?:打开|进入|前往|切换到|带我去|返回|回到)(.+?)(?:页面|面板|功能|模块)?$/);
  if (!match) return null;
  const destination = match[1];
  const base = {
    navigationOnly: true,
    summary: `将打开${destination}`,
    steps: [`打开${destination}`],
  };
  if (/^(?:工作台|首页|主页)$/.test(destination)) return { ...base, title: '返回工作台', tab: 'workbench', kind: 'general' };
  if (/^(?:设置|系统设置|设置中心)$/.test(destination)) return { ...base, title: '打开设置', tab: 'settings', kind: 'general' };
  if (/^(?:视频声音制作|视频配声)$/.test(destination)) return { ...base, title: '打开视频声音制作', tab: 'video-soundtrack', kind: 'video', tracks: [], analyzeSubtitles: false, autoGenerateVideo: false };
  if (/^(?:ai音频设计|音频设计|声音设计)$/.test(destination)) return { ...base, title: '打开 AI 音频设计', tab: 'audio-director', kind: 'director' };
  if (/^(?:ai音乐|音乐生成)$/.test(destination)) return { ...base, title: '打开 AI 音乐', tab: 'music-studio', kind: 'music' };
  if (/^(?:ai音效|音效生成)$/.test(destination)) return { ...base, title: '打开 AI 音效', tab: 'sfx-studio', kind: 'sfx' };
  if (/^(?:音效需求表|需求表)$/.test(destination)) return { ...base, title: '打开音效需求表', tab: 'sfx-requirements', kind: 'requirements' };
  if (/^(?:配音声音库|配音声线库|人声库|声线库)$/.test(destination)) return { ...base, title: '打开配音声音库', tab: 'dubbing-studio', kind: 'voice', voiceMode: 'tts', openVoiceLibrary: true };
  if (/^(?:音效库|声音库|音频库)$/.test(destination)) return { ...base, title: '打开音效库', tab: 'sfx-library', kind: 'library' };
  if (/^(?:音频工具|音频工作站|daw)$/.test(destination)) return { ...base, title: '打开音频工作站', tab: 'audio-tools', kind: 'audio', audioTask: 'workstation', audioTool: 'workstation' };
  if (/^(?:音频分析|测速测调|乐器和弦分析)$/.test(destination)) return { ...base, title: '打开音频分析', tab: 'audio-tools', kind: 'audio', audioTask: 'analyze', audioTool: 'analysis' };
  if (/^(?:格式(?:\/)?压缩(?:\/)?音量|格式转换|音频转换|音频压缩)$/.test(destination)) return { ...base, title: '打开格式/压缩/音量', tab: 'audio-tools', kind: 'audio', audioTask: 'convert', audioTool: 'factory' };
  if (/^(?:音频转midi|转midi|转成midi|midi转换|扒谱|扒带|audio2midi|audiotomidi)$/.test(destination)) return { ...base, title: '打开音频转 MIDI', tab: 'audio-tools', kind: 'audio', audioTask: 'midi', audioTool: 'midi' };
  if (/^(?:拆分分轨|歌曲分轨|音乐分轨|高质量音乐分轨|乐器分轨|分轨拆分|stemseparation|musicseparation)$/.test(destination)) return { ...base, title: '打开拆分分轨', tab: 'audio-tools', kind: 'audio', audioTask: 'music-separation', audioTool: 'music-separation' };
  if (/^(?:批量命名|批量重命名)$/.test(destination)) return { ...base, title: '打开批量命名', tab: 'audio-tools', kind: 'audio', audioTask: 'rename', audioTool: 'renamer' };
  if (/^(?:人声分离|人声提取)$/.test(destination)) return { ...base, title: '打开人声分离', tab: 'audio-tools', kind: 'audio', audioTask: 'isolate', audioTool: 'isolation' };
  const voiceMode = /语音转语音/.test(destination) ? 'sts'
    : /跨语种转换|跨语言转换/.test(destination) ? 'translate'
      : /语音转文本/.test(destination) ? 'stt' : 'tts';
  if (/^(?:ai配音|配音|文本转语音|多文本配音|批量配音|多段配音|语音转语音|跨语种转换|跨语言转换|语音转文本)$/.test(destination)) {
    return {
      ...base,
      title: `打开${destination}`,
      tab: 'dubbing-studio',
      kind: 'voice',
      voiceMode,
      voiceInputMode: /多文本|批量|多段/.test(destination) ? 'batch' : 'single',
    };
  }
  return null;
};

const detectVideoTask = (prompt: string, file?: File) => {
  const normalized = normalize(prompt);
  const hasVideoFile = Boolean(file && (file.type.startsWith('video/') || VIDEO_EXTENSIONS.test(file.name)));
  const hasVideoContext = /视频|字幕|画面|口型|镜头|视频声音制作|成片|影片|短片|视频配声|视频配音/.test(normalized);
  const hasSoundtrackContext = /给.*(?:配|加|制作)|(?:配|加|制作).*给/.test(normalized)
    && /配乐|背景音乐|bgm|音效|环境声|foley|配音|旁白|混音/.test(normalized);
  const hasContinuationContext = /继续|下一步|第一段|第二段|第(?:\d+|[一二三四五六七八九十]+)段|时间段|分段|这段|这个视频/.test(normalized);
  return (!normalized && hasVideoFile) || hasVideoContext || (hasVideoFile && (hasSoundtrackContext || hasContinuationContext));
};

const detectVideoTracks = (prompt: string): Array<'bgm' | 'sfx' | 'dubbing'> => {
  const normalized = normalize(prompt);
  const tracks: Array<'bgm' | 'sfx' | 'dubbing'> = [];
  const excludesMusic = /(?:不要|不再|避免|无需|不需要|不重复|保留(?:已有|现有|当前)?|不重新(?:生成|规划|制作)?).{0,12}(?:配乐|背景音乐|bgm|音乐)/.test(normalized);
  if (!excludesMusic && /配乐|背景音乐|bgm|音乐/.test(normalized)) tracks.push('bgm');
  if (/音效|环境声|拟音|foley|soundeffect/.test(normalized)) tracks.push('sfx');
  if (/配音(?!乐)|朗读|旁白|字幕|口型|人声/.test(normalized)) tracks.push('dubbing');
  return tracks.length ? tracks : ['bgm', 'sfx', 'dubbing'];
};

const filterPreservedVideoTracks = (
  tracks: Array<'bgm' | 'sfx' | 'dubbing'>,
  prompt: string,
) => {
  const normalized = normalize(prompt);
  const preserved = {
    bgm: /(?:不要|不再|避免|无需|不需要|不重复|保留(?:已有|现有|当前)?|不重新(?:生成|规划|制作)?).{0,12}(?:配乐|背景音乐|bgm|音乐)/.test(normalized),
    sfx: /(?:不要|不再|避免|无需|不需要|不重复|保留(?:已有|现有|当前)?|不重新(?:生成|规划|制作)?).{0,12}(?:音效|环境声|拟音|foley)/.test(normalized),
    dubbing: /(?:不要|不再|避免|无需|不需要|不重复|保留(?:已有|现有|当前)?|不重新(?:生成|规划|制作)?).{0,12}(?:配音|旁白|朗读|人声)/.test(normalized),
  };
  const filtered = tracks.filter((track) => !preserved[track]);
  return filtered.length > 0 ? filtered : tracks;
};

const detectSfxTask = (prompt: string) => {
  const normalized = normalize(prompt);
  return /音效|soundeffect|foley|打嗝|咳嗽|喷嚏|笑声|哭声|尖叫|脚步|敲门|开门|关门|爆炸|枪声|风声|雨声|雷声|钟声|铃声|门铃|鸟叫|猫叫|狗叫|呼吸|心跳|水滴|碰撞|刹车|汽车|按钮|提示音|击打|摩擦|燃烧|玻璃碎|whoosh|叮|哔声/.test(normalized)
    || /(?:生成|制作|合成|创建|设计).{1,40}(?:环境声|声音效果|声响|声音|声)$/.test(normalized);
};

type AmbiguousSoundIntent = 'library' | 'voice' | 'music' | 'sfx' | 'analysis' | null;

/**
 * “声音” is a common non-professional synonym for several asset types.
 * Resolve it with intent cues before the more generic module detectors run.
 * Library lookup wins for requests that ask to find/use/download an asset;
 * generation only wins when the user explicitly asks to create it.
 */
const classifyAmbiguousSoundIntent = (prompt: string): AmbiguousSoundIntent => {
  const normalized = normalize(prompt);
  if (!/(?:声音|声响|声效|sound)/i.test(normalized)) return null;

  if (/分析|检查|检测|识别|测一下|测速|响度|底噪|信噪比|bpm|调性|和弦|乐器/.test(normalized)) return 'analysis';
  if (/配音|朗读|读出|念出|说出|台词|对白|旁白|人声|男声|女声|男性|女性|声线|语气|角色|(?:用|让).{0,30}(?:读|念|说)/.test(normalized)) return 'voice';
  if (/音乐|配乐|背景音乐|bgm|歌曲|旋律|节奏|歌词|乐器|作曲/.test(normalized)) return 'music';
  if (/需求表|需求清单|声音清单|制作清单|声音设计|声音方案|声音排程|视频|画面|短片|影片|成片/.test(normalized)) return null;

  const asksToFindAsset = /音效库|声音库|音频库|资产库|库里|已有|目录|项目|查找|搜索|寻找|找|试听|下载|收藏|调用|使用|需要|想要|要一个|要一段|给我/.test(normalized);
  const asksToGenerate = /生成|制作|合成|创建|设计|做出?|写|造|录制|模拟/.test(normalized);
  const soundEffectCues = /环境|拟音|foley|动作|材质|空间|脚步|敲门|开门|关门|爆炸|枪声|风声|雨声|雷声|钟声|铃声|鸟叫|猫叫|狗叫|呼吸|心跳|水滴|碰撞|刹车|按钮|提示音|击打|摩擦|燃烧|玻璃碎|whoosh/.test(normalized);

  if (asksToFindAsset && !asksToGenerate) return 'library';
  if (soundEffectCues || asksToGenerate) return 'sfx';
  // Asset-first is safer than silently generating or selecting a voice.
  return 'library';
};

const detectDirectorTask = (prompt: string) => (
  /音频设计|声音设计|声音方案|整体声音|音轨规划|音效排程|声音排程|多模态分析|全片设计|场景声音方案/.test(normalize(prompt))
);

const detectRequirementsTask = (prompt: string) => (
  /音效需求|需求表|需求清单|声音清单|镜头清单|制作清单|待办音效/.test(normalize(prompt))
  || /(?:fmod|wwise).*(?:事件|event|清单|表|需求|整理)/i.test(normalize(prompt))
);

const detectLibraryTask = (prompt: string) => (
  /音效库|声音库|音频库|音频资产|资产库|(?:查找|搜索|寻找|找|浏览|试听|下载|收藏|调用|使用).*(?:音效|音乐|配乐|声音|音频)/.test(normalize(prompt))
);

const extractLibrarySearchQuery = (prompt: string) => stripLeadingRequestWords(prompt)
  .replace(/^(?:打开|进入)?(?:音效库|声音库|音频库|音频资产库|资产库)(?:中|里)?\s*/i, '')
  .replace(/^(?:搜索|查找|浏览|试听|下载|收藏|找|寻找|使用|调用)\s*(?:一个|一段|一首|一曲)?\s*/i, '')
  .replace(/^(?:一个|一段|一首|一曲)\s*/i, '')
  .replace(/\s*(?:并|然后)?\s*(?:试听|下载|收藏)\s*$/i, '')
  .replace(/(?:的)?(?:声音效果|背景音乐|音效|音乐|配乐|声音)\s*$/i, '')
  .replace(/[，。！？、:：;；]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const trimPromptPunctuation = (value: string) => value
  .replace(/^[\s，。！？、:：;；“”‘’"']+|[\s，。！？、:：;；“”‘’"']+$/g, '')
  .trim();

const stripLeadingRequestWords = (prompt: string) => prompt
  .trim()
  .replace(/^(?:请|麻烦|帮我|给我|我要|我想要|我需要)\s*/g, '')
  .trim();

const REQUIREMENTS_DEFAULT_PROMPTS: Record<NonNullable<AssistantRequirementsRequest['template']>, string> = {
  game_sfx_general: '按场景、时间点、动作、材质、空间和优先级整理音效需求',
  game_sfx_middleware: '按 FMOD / Wwise 事件路径、播放参数、触发条件和音频参考整理音效需求',
  voiceover_general: '按角色、台词、语言、语气、声线和交付规格整理配音需求',
  voiceover_multilang: '按角色、源台词、目标语言、译文、语气和交付规格整理多语种配音需求',
};

const extractRequirementsPrompt = (
  prompt: string,
  template: NonNullable<AssistantRequirementsRequest['template']>,
) => {
  const withoutRequestWords = stripLeadingRequestWords(prompt).replace(/^把\s*/, '');
  const extracted = withoutRequestWords
    .replace(/^(?:整理|制作|生成|创建|列出|做)\s*(?:一份|一个)?\s*/i, '')
    .replace(/^(?:音效需求|需求描述|制作需求)\s*[:：]\s*/i, '')
    .replace(/(?:的)?(?:音效|声音|配音)?需求(?:表|清单)\s*[，,:：]?\s*/gi, '，')
    .replace(/\s*(?:做成|整理成|制作成|生成成|转成|输出为|列成|整理为)?\s*(?:一份|一个)?\s*(?:游戏)?\s*(?:音效|声音)?需求(?:表|清单)\s*$/i, '')
    .replace(/\s*(?:做成|整理成|制作成|生成成|转成|输出为|列成|整理为)\s*(?:音效需求表|音效需求清单)\s*$/i, '');
  const cleaned = trimPromptPunctuation(extracted).replace(/^，+|，+$/g, '').trim();
  const genericOnly = /^(?:fmod|wwise|fmod\s*\/\s*wwise|游戏|多语言|多语种|多语言配音|多语种配音|配音|音效|声音)?$/i.test(cleaned);
  return cleaned.length >= 2 && !genericOnly ? cleaned : REQUIREMENTS_DEFAULT_PROMPTS[template];
};

const extractGenerationPrompt = (prompt: string) => {
  const withoutRequestWords = stripLeadingRequestWords(prompt);
  const musicForTargetMatch = withoutRequestWords.match(/^(?:给|为)(.+?)配(?:一段|一首|一曲)?(?:音乐|配乐)(.*)$/i);
  const contentFirstPrompt = musicForTargetMatch
    ? `${musicForTargetMatch[1]}配乐${musicForTargetMatch[2] ? `，${musicForTargetMatch[2]}` : ''}`
    : withoutRequestWords;
  const extracted = contentFirstPrompt.replace(
    /^(?:(?:用\s*)?ai\s*)?(?:生成|制作|合成|创作|设计|写|录制|模拟|做出?|来)\s*(?:一个|一段|一首|一曲)?\s*/i,
    '',
  )
    .replace(/^(?:音效描述|声音描述|音乐描述|配乐描述|风格描述)\s*[:：]\s*/i, '')
    .replace(/(?:时长|持续)?\s*\d+(?:\.\d+)?\s*(?:分钟|分|秒钟|秒|s|sec|seconds?)\s*(?:的)?/gi, '')
    .replace(/(?:不要人声|无人声|不带人声|纯音乐|纯配乐|带歌词|有人声|带人声|包含人声)/gi, '');
  const cleaned = trimPromptPunctuation(extracted).replace(/(音乐|配乐)声音$/i, '$1');
  return /^(?:的)?(?:音乐|配乐|音效|声音)?$/i.test(cleaned) ? '' : cleaned;
};

const extractDurationSeconds = (prompt: string) => {
  const match = prompt.match(/(\d+(?:\.\d+)?)\s*(分钟|分|秒钟|秒|s|sec|seconds?)/i);
  if (!match) return /半分钟/.test(prompt) ? 30 : undefined;
  const value = Number(match[1]);
  const seconds = /分钟|分/.test(match[2]) ? value * 60 : value;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
};

const extractMusicType = (prompt: string): 'instrumental' | 'vocal' => (
  /带歌词|有人声|带人声|包含人声|演唱|歌唱/.test(normalize(prompt)) ? 'vocal' : 'instrumental'
);

const hasExplicitSfxGenerationIntent = (prompt: string) => (
  /生成|制作|合成|创作|设计(?:一个|一段)?|做(?:一个|一段)?|造(?:一个|一段)?|用\s*ai|ai\s*(?:生成|制作|合成|音效)|人工智能音效/i.test(normalize(prompt))
);

const hasLibraryLookupIntent = (prompt: string) => (
  /要|想要|找|寻找|给我|使用|调用|下载|试听|收藏|库里|已有|项目|目录|匹配/.test(normalize(prompt))
);

const isGenericLibraryDirectoryName = (name: string) => (
  /^(?:音效库|声音库|音频库|音频资产库|资产库|音乐|音效|音频|声音|配乐|背景音乐|bgm|sound|music|sfx)$/i.test(name.trim())
);

const extractLanguage = (prompt: string, fallback = 'zh') => {
  const normalized = normalize(prompt);
  if (/阿拉伯|阿语|arabic/.test(normalized)) return 'ar';
  if (/英语|英文|english/.test(normalized)) return 'en';
  if (/日语|日文|japanese/.test(normalized)) return 'ja';
  if (/韩语|韩文|korean/.test(normalized)) return 'ko';
  if (/法语|法文|french/.test(normalized)) return 'fr';
  if (/德语|德文|german/.test(normalized)) return 'de';
  if (/西班牙语|西班牙文|spanish/.test(normalized)) return 'es';
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

  const labeledLine = source.match(/(?:台词|文案|内容)\s*(?:是|为)?\s*[，,:：]?\s*(.+)$/i);
  if (labeledLine?.[1]?.trim()) return labeledLine[1].trim();

  const spokenAfterVerb = source.match(/(?:朗读|读出|念出|说出|读)\s*(?:这句话|这段话|下面这句|以下内容)?\s*[，,:：]?\s*(.+)$/i);
  if (spokenAfterVerb?.[1]?.trim()) return spokenAfterVerb[1].trim();

  if (/^(?:请|帮我|请你)?\s*(?:生成|制作|创建|准备|打开)?\s*(?:一个|一段|一条)?\s*(?:[\u3400-\u9fff]{0,12})?(?:男声|女声|配音|朗读|语音)\s*(?:配音)?$/i.test(source)) {
    return '';
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
  const matches = ['可爱', '温柔', '甜美', '柔和', '低沉', '磁性', '成熟', '坚定', '活泼', '悲伤', '开心', '愉快', '兴奋', '平静', '紧张', '热情', '严肃', '庄严', '神圣', '正式', '神秘', '温暖', '自然', '清晰']
    .filter((tag) => prompt.includes(tag));
  if (!matches.length && /[\u3400-\u9fff]/.test(prompt)) return '自然、清晰';
  return matches.length ? matches.join(', ') : fallback;
};

const extractAudioTargets = (prompt: string) => {
  const normalized = normalize(prompt);
  // Parse numeric targets from the original prompt so `MP3, 128kbps` does
  // not become `MP3128kbps` after normalization and accidentally read as 3128.
  const lufsMatch = prompt.match(/(-?\d+(?:\.\d+)?)\s*lufs/i)
    || prompt.match(/(?:响度)\s*(?:变成|设为|为)?\s*(-?\d+(?:\.\d+)?)/i);
  const sampleRateMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(khz|hz|赫兹)/i)
    || prompt.match(/(?:采样率)\s*(\d+(?:\.\d+)?)(?:\s*(khz|hz))?/i);
  const bitrateMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(kbps|kbit|kb\/s)/i)
    || prompt.match(/(?:比特率)\s*(\d+(?:\.\d+)?)/i);
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

const extractRequestedAudioFormat = (prompt: string): AssistantAudioRequest['targetFormat'] | undefined => {
  const match = prompt.match(/(?:转成|转换成|转为|提取成|提取为|输出|导出为|导出成|保存为|目标格式(?:是|为)?)\s*(mp3|wav|flac|ogg|aac|m4a)/i);
  return match?.[1]?.toLowerCase() as AssistantAudioRequest['targetFormat'] | undefined;
};

const detectRequirementsTemplate = (prompt: string): NonNullable<AssistantRequirementsRequest['template']> => {
  const normalized = normalize(prompt);
  if (/多语言|多语种|本地化|国际化/.test(normalized) && /配音|台词|语音/.test(normalized)) return 'voiceover_multilang';
  if (/配音|台词|角色语音|旁白/.test(normalized)) return 'voiceover_general';
  if (/fmod|wwise|中间件|event:|事件路径|bank/.test(normalized)) return 'game_sfx_middleware';
  return 'game_sfx_general';
};

const buildPlan = (
  prompt: string,
  file?: File,
  memory: AssistantMemory = EMPTY_ASSISTANT_MEMORY,
  libraryIndex: SfxLibraryIndex = EMPTY_SFX_LIBRARY_INDEX,
): AssistantPlan => {
  const normalized = normalize(prompt);
  const explicitNavigationPlan = buildExplicitNavigationPlan(prompt);
  if (explicitNavigationPlan) return explicitNavigationPlan;
  const soundIntent = classifyAmbiguousSoundIntent(prompt);
  const hasExplicitAudioOperation = detectWorkstationTask(prompt)
    || detectFactoryTask(prompt)
    || detectAnalysisTask(prompt)
    || soundIntent === 'analysis'
    || detectMusicSeparationTask(prompt)
    || detectIsolationTask(prompt)
    || /音频分析|分析音频|转格式|转换格式|格式转换|提取音频|转成mp3|转换成mp3|输出mp3/.test(normalized);
  const explicitSfxGeneration = hasExplicitSfxGenerationIntent(prompt);
  const explicitVoiceIntent = soundIntent === 'voice' || hasExplicitVoiceWorkflow(prompt) || detectVoiceRequest(prompt);
  const extractedLibrarySearchQuery = extractLibrarySearchQuery(prompt);
  const libraryMatches = findSfxLibraryMatches(extractedLibrarySearchQuery || prompt, libraryIndex);
  const specificLibraryMatches = libraryMatches.filter(entry => !isGenericLibraryDirectoryName(entry.name));
  const hasSfxLookupRequest = !explicitSfxGeneration && !explicitVoiceIntent && !hasExplicitAudioOperation && (
    detectLibraryTask(prompt)
    || soundIntent === 'library'
    || (
      detectSfxTask(prompt)
      && hasLibraryLookupIntent(prompt)
    )
  );

  if (detectSettingsNavigation(prompt)) {
    return {
      title: '打开设置',
      summary: '将打开设置面板',
      tab: 'settings',
      kind: 'general',
      steps: ['打开设置', '查看服务状态、密钥配置和管理权限'],
    };
  }

  if (detectWorkbenchNavigation(prompt)) {
    return {
      title: '返回工作台',
      summary: '将返回功能总览工作台',
      tab: 'workbench',
      kind: 'general',
      steps: ['打开工作台', '查看全部功能入口和最近生成记录'],
    };
  }

  // A named library asset is a stronger signal than the generic word "音效".
  // Resolve it before AI generation so requests like "我要 Jinn 的音效" open
  // the shared library and search the matching project directory.
  if (hasSfxLookupRequest) {
    const resolvedLibraryMatches = specificLibraryMatches;
    const matchedName = resolvedLibraryMatches[0]?.name;
    const matchedDirectory = resolvedLibraryMatches.find(entry => entry.kind === 'directory');
    const searchQuery = matchedName || extractedLibrarySearchQuery;
    const soundMatchCount = resolvedLibraryMatches.filter(entry => entry.kind === 'sound').length;
    const fallbackKind = /音乐|配乐|bgm/.test(normalized) ? 'music' : 'sfx';
    const fallbackGenerator = fallbackKind === 'music' ? 'AI 音乐' : 'AI 音效';
    const matchSummary = matchedName
      ? `已从音效库实时目录匹配到“${matchedName}”，准备查找${soundMatchCount ? `${soundMatchCount} 个` : '对应目录中的'}音频资产`
      : `音效库中暂未找到“${searchQuery || '该音频'}”，请先确认是否改用 ${fallbackGenerator}生成`;
    return {
      title: '打开音效库',
      summary: matchSummary,
      tab: 'sfx-library',
      kind: 'library',
      librarySearchQuery: searchQuery,
      libraryMatchCount: resolvedLibraryMatches.length,
      libraryCategory: matchedDirectory?.category,
      librarySubcategory: matchedDirectory?.subcategory,
      ...(resolvedLibraryMatches.length === 0 ? {
        libraryFallbackKind: fallbackKind,
        libraryFallbackPrompt: searchQuery || extractGenerationPrompt(prompt) || prompt.trim(),
      } : {}),
      steps: [
        '打开音效库并读取最新目录和音频名称',
        matchedName ? `定位“${matchedName}”所属目录并筛选匹配文件` : '在共享音效库中搜索该名称、项目或标签',
        matchedName ? '试听、下载或收藏选中的文件' : `未找到后不自动生成；确认后再进入${fallbackGenerator}`,
      ],
    };
  }

  if (detectRenameTask(prompt)) {
    return {
      title: '准备批量命名',
      summary: file ? `已载入 ${file.name}，准备批量修改文件名` : '将打开音频工具的批量命名功能，请先导入需要改名的音频',
      tab: 'audio-tools',
      kind: 'audio',
      audioTask: 'rename',
      audioTool: 'renamer',
      steps: [
        '打开音频工具 > 批量命名',
        file ? '载入已提供的音频文件' : '导入多个音频或整个文件夹',
        '设置查找替换、前后缀、编号或命名模板',
        '预览改名结果后导出文件或 ZIP',
      ],
    };
  }

  if (detectMusicSeparationTask(prompt)) {
    return {
      title: '准备拆分分轨',
      summary: file ? `已载入 ${file.name}，准备拆出歌曲里的独立音源分轨` : '将打开拆分分轨功能，请先上传歌曲或混音文件',
      tab: 'audio-tools',
      kind: 'audio',
      audioTask: 'music-separation',
      audioTool: 'music-separation',
      steps: [
        '打开音频工具 > 拆分分轨',
        file ? '载入已提供的歌曲或混音文件' : '上传需要拆分的歌曲、BGM 或混音音频',
        '拆分出人声、鼓、贝斯和其它乐器等独立分轨',
        '试听分轨结果，必要时发送到音频工作站继续编辑',
      ],
    };
  }

  if (detectWorkstationTask(prompt)) {
    return {
      title: '准备音频工作站',
      summary: file ? `已载入 ${file.name}，准备在 DAW 时间线上处理` : '将打开音频工作站，准备进行时间线和轨道处理',
      tab: 'audio-tools',
      kind: 'audio',
      audioTask: 'workstation',
      audioTool: 'workstation',
      steps: [
        '打开音频工具 > 音频工作站',
        file ? '载入已提供的音频文件并放入时间线' : '导入音频或创建音轨',
        '按请求执行移调、变速、剪切、淡入淡出、节拍器、BPM、声像或混音操作',
        '试听后导出处理结果',
      ],
    };
  }

  if (detectIsolationTask(prompt)) {
    return {
      title: '准备人声分离',
      summary: file ? `已载入 ${file.name}，准备提取人声或去除背景` : '将打开人声分离功能，请导入待处理音频',
      tab: 'audio-tools',
      kind: 'audio',
      audioTask: 'isolate',
      audioTool: 'isolation',
      steps: [
        '打开音频工具 > 人声分离 (AI)',
        file ? '载入已提供的音频或视频' : '导入需要处理的音频或视频',
        '执行人声提取、伴奏移除或背景噪音消除',
        '试听并下载分离结果',
      ],
    };
  }

  // Explicit module requests must win over broad video keywords such as
  // "短片" or "镜头". Otherwise a sound-design brief or requirements list
  // can be routed into video soundtrack preparation by accident.
  if (
    detectVideoTask(prompt, file)
    && !hasExplicitAudioOperation
    && !hasExplicitVoiceWorkflow(prompt)
    && !detectDirectorTask(prompt)
    && !detectRequirementsTask(prompt)
    && !detectLibraryTask(prompt)
  ) {
    const hasVideoGenerationIntent = /(?:生成|制作|创建|添加|加上).*(?:配乐|背景音乐|音效|环境声|拟音|配音(?!乐)|旁白)/.test(normalized)
      || /(?:给|为).*视频.*(?:配|加).*(?:音乐|配乐|音效|环境声|配音(?!乐)|旁白)/.test(normalized);
    const analysisOnly = /分析|识别|检测|检查|查看/.test(normalized) && !hasVideoGenerationIntent;
    const tracks = analysisOnly ? [] : detectVideoTracks(prompt);
    const analyzeSubtitles = /字幕|台词|对白|口型|看画面|识别文字|分析视频/.test(normalized);
    const trackLabels = tracks.map((track) => track === 'bgm' ? '配乐轨' : track === 'sfx' ? '音效轨' : '配音轨');
    const steps = [
      '打开视频声音制作并载入视频',
      analyzeSubtitles ? '分析画面、字幕和时间线，补齐未识别的字幕片段' : '分析视频时长、画面节奏和声音时间线',
      ...trackLabels.map((label) => `生成${label}；重叠事件自动分配到独立轨道`),
      ...(analysisOnly
        ? ['只输出分析和时间线建议，不自动生成任何音轨']
        : ['试听每条轨道，支持单独重新生成、调整和静音', '确认后混音并导出最终视频']),
    ];
    return {
      title: analysisOnly ? '准备分析视频画面与声音' : '准备视频声音制作',
      summary: analysisOnly
        ? (file ? `已载入 ${file.name}，只分析画面、字幕和时间线` : '只分析画面、字幕和时间线，不自动生成音轨')
        : file ? `已载入 ${file.name}，将按视频时间线生成 ${trackLabels.join('、')}` : `将按视频时间线生成 ${trackLabels.join('、')}`,
      tab: 'video-soundtrack',
      kind: 'video',
      tracks,
      analyzeSubtitles,
      autoGenerateVideo: !analysisOnly,
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
    const requirementsTemplate = detectRequirementsTemplate(prompt);
    const inputPrompt = extractRequirementsPrompt(prompt, requirementsTemplate);
    const templateLabel = requirementsTemplate === 'game_sfx_middleware'
      ? 'FMOD / Wwise 引擎中间件需求表'
      : requirementsTemplate === 'voiceover_multilang'
        ? '多语种配音本地化表'
        : requirementsTemplate === 'voiceover_general'
          ? '通用角色配音表'
          : '游戏音效配乐通用表';
    return {
      title: '准备音效需求表',
      summary: `已选择“${templateLabel}”；提取需求描述：${inputPrompt}`,
      tab: 'sfx-requirements',
      kind: 'requirements',
      inputPrompt,
      requirementsTemplate,
      steps: [
        '打开音效需求表',
        `选择“${templateLabel}”模板`,
        `将“${inputPrompt}”写入需求描述框`,
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

  const voiceMode = detectVoiceMode(prompt);
  if (soundIntent === 'voice' || hasExplicitVoiceWorkflow(prompt) || (detectVoiceRequest(prompt) && !detectAudioTask(prompt, file))) {
    const language = extractLanguage(prompt, memory.preferredLanguage);
    const languageLabel = language === 'ar' ? '阿拉伯语'
      : language === 'en' ? '英语'
        : language === 'ja' ? '日语'
          : language === 'ko' ? '韩语'
            : language === 'fr' ? '法语'
              : language === 'de' ? '德语'
                : language === 'es' ? '西班牙语' : '原语言';
    const genderLabel = extractGender(prompt, memory.preferredGender) === 'female' ? '女声' : '男声';
    const emotion = extractEmotion(prompt, memory.preferredEmotion);
    const sourceIsChinese = /[\u3400-\u9fff]/.test(extractVoiceText(prompt));
    const needsTranslation = language === 'en' && sourceIsChinese;
    if (voiceMode === 'sts') {
      return {
        title: '准备语音转语音',
        summary: file ? `已载入 ${file.name}，准备转换为${genderLabel}` : `将打开语音转语音，目标声线：${genderLabel}`,
        tab: 'dubbing-studio',
        kind: 'voice',
        voiceMode,
        steps: ['打开 AI 配音 · 语音转语音', file ? '载入已提供的源音频' : '上传需要变声的源音频', `按${genderLabel}及角色描述筛选声线`, '由你试听并确认目标声音后生成'],
      };
    }
    if (voiceMode === 'translate') {
      return {
        title: '准备跨语种转换',
        summary: file ? `已载入 ${file.name}，准备转换为${languageLabel}` : `将打开跨语种转换，目标语言：${languageLabel}`,
        tab: 'dubbing-studio',
        kind: 'voice',
        voiceMode,
        steps: ['打开 AI 配音 · 跨语种转换', file ? '载入已提供的源音频' : '上传需要翻译的源音频', `设置目标语言为${languageLabel}`, '尽量保留原说话人的音色、语气和时间长度', '由你确认参数后生成'],
      };
    }
    if (voiceMode === 'stt') {
      return {
        title: '准备语音转文本',
        summary: file ? `已载入 ${file.name}，准备转写文字` : '将打开语音转文本，请上传录音或音频',
        tab: 'dubbing-studio',
        kind: 'voice',
        voiceMode,
        steps: ['打开 AI 配音 · 语音转文本', file ? '载入已提供的音频文件' : '上传需要转写的录音或音频', '自动识别语言并转写文本', '保留复制、翻译和下载结果功能'],
      };
    }
    return {
      title: '准备 AI 配音',
      summary: `${detectBatchVoiceRequest(prompt) ? '识别为多文本批量配音' : `识别为${languageLabel}${genderLabel}配音`}，语气：${emotion}`,
      tab: 'dubbing-studio',
      kind: 'voice',
      voiceMode: 'tts',
      voiceInputMode: detectBatchVoiceRequest(prompt) ? 'batch' : 'single',
      steps: [
        `打开 AI 配音 · 文本转语音${detectBatchVoiceRequest(prompt) ? ' · 多文本' : ''}`,
        `使用${genderLabel}声音库筛选：${emotion}`,
        needsTranslation
          ? '检测到中文台词：先翻译成英文，再交给配音模块'
          : language === 'ar' ? '保留阿拉伯语目标语言；中文台词需要翻译时再确认译文' : '保留原文并按目标语种生成',
        '展开声音库并按性别、角色、语言和语气匹配度排序',
        '由你选择声音并点击生成，助手不会自动生成配音',
      ],
    };
  }

  if ((soundIntent === 'sfx' || detectSfxTask(prompt)) && !hasExplicitAudioOperation) {
    const inputPrompt = extractGenerationPrompt(prompt) || '通用场景音效';
    const durationSeconds = extractDurationSeconds(prompt);
    return {
      title: '准备生成音效',
      summary: `已提取音效描述：${inputPrompt || '根据当前描述生成音效'}`,
      tab: 'sfx-studio',
      kind: 'sfx',
      inputPrompt,
      durationSeconds,
      steps: [
        '打开 AI 音效',
        `将“${inputPrompt}”写入音效场景描述框`,
        durationSeconds ? `设置音效时长为 ${durationSeconds} 秒` : '根据描述自动判断音效时长',
        '识别主体、动作、材质和空间感',
        '生成两版试听结果并保留重新生成和下载',
      ],
    };
  }

  if (detectMidiTask(prompt)) {
    return {
      title: '打开音频转 MIDI',
      summary: file ? `已识别 ${file.name}，准备进入音频转 MIDI` : '将打开音频工具里的音频转 MIDI 功能',
      tab: 'audio-tools',
      kind: 'audio',
      steps: [
        '打开音频工具 > 音频转 MIDI',
        '按素材类型选择通用转 MIDI 或乐器专用转 MIDI',
        '上传音频或视频文件，生成 MIDI 后试听并下载',
      ],
      audioTask: 'midi',
      audioTool: 'midi',
    };
  }

  if (detectAudioTask(prompt, file) || detectFactoryTask(prompt) || detectAnalysisTask(prompt) || soundIntent === 'analysis') {
    const audioTargets = extractAudioTargets(prompt);
    const requestedAudioFormat = extractRequestedAudioFormat(prompt);
    const isRequestedFormatSupported = !requestedAudioFormat || requestedAudioFormat === 'mp3' || requestedAudioFormat === 'wav' || requestedAudioFormat === 'ogg';
    const wantsFormatConversion = Boolean(requestedAudioFormat)
      || /格式转换|转换格式|转格式|提取音频|convert.*(?:mp3|wav|flac|ogg|aac|m4a)/.test(normalized);
    const wantsFactoryProcessing = detectFactoryTask(prompt) || wantsFormatConversion;
    const hasProcessingTarget = wantsFactoryProcessing || audioTargets.targetSampleRate !== undefined || audioTargets.targetBitrate !== undefined || audioTargets.targetLufs !== undefined;
    // Conversion still decodes/resamples internally, but it does not need the
    // user-facing analysis pass (BPM, key, SNR, style, etc.). Only add that
    // step when the request explicitly asks for analysis metrics.
    const wantsAnalysis = detectAnalysisTask(prompt) || soundIntent === 'analysis' || /分析|风格|bpm|调性|和弦|乐器|snr|动态|底噪/.test(normalized) || (!wantsFactoryProcessing && audioTargets.targetLufs === undefined);
    const steps: string[] = [];
    if (wantsAnalysis) {
      steps.push('打开音频工具 > 音频分析，读取原文件的格式、时长、采样率和音量');
      steps.push('完成风格、BPM、调性、响度、动态范围、底噪和 SNR 分析');
    }
    if (hasProcessingTarget) {
      steps.push('切换到格式/压缩/音量，继续使用同一个原始文件');
      if (requestedAudioFormat) steps.push(`设置目标格式为 ${requestedAudioFormat.toUpperCase()}`);
      if (!requestedAudioFormat && /音量/.test(normalized)) steps.push('保留当前格式并按要求调整音量，不额外执行 BPM、调性或风格分析');
      if (!isRequestedFormatSupported && requestedAudioFormat) {
        steps.push(`当前编码器尚未接入 ${requestedAudioFormat.toUpperCase()}，页面将保留请求但不会伪装成 MP3 转换`);
      }
      if (audioTargets.targetSampleRate !== undefined) steps.push(`设置目标采样率为 ${audioTargets.targetSampleRate} Hz`);
      if (audioTargets.targetBitrate !== undefined) steps.push(`设置目标比特率为 ${audioTargets.targetBitrate} kbps`);
      if (audioTargets.targetLufs !== undefined) steps.push(`启用响度统一并设置目标为 ${audioTargets.targetLufs} LUFS，同时保留峰值保护`);
      steps.push(isRequestedFormatSupported ? '先生成处理结果并试听，确认音量和音质后再下载' : '请选择当前支持的 MP3、WAV 或 OGG，或等待目标编码器接入');
    } else {
      steps.push('分析结果生成后提供试听和下载');
    }
    return {
      title: !isRequestedFormatSupported && requestedAudioFormat
        ? `${requestedAudioFormat.toUpperCase()} 暂不可转换`
        : hasProcessingTarget && wantsAnalysis ? '分析并处理音频' : wantsFormatConversion ? '转换音频格式' : hasProcessingTarget ? '调整音频参数' : '分析音频',
      summary: !isRequestedFormatSupported && requestedAudioFormat
        ? `已识别目标格式 ${requestedAudioFormat.toUpperCase()}；当前转换器仅支持 MP3、WAV 和 OGG`
        : file ? `已载入 ${file.name}` : '将使用音频工具处理你的任务',
      tab: 'audio-tools',
      kind: 'audio',
      steps,
      audioTargets,
      requestedAudioFormat,
      audioTask: wantsFactoryProcessing ? 'convert' : 'analyze',
      audioTool: wantsFactoryProcessing ? 'factory' : 'analysis',
    };
  }

  if (soundIntent === 'music' || /配乐|bgm|背景音乐|音乐|music/.test(normalized)) {
    const durationSeconds = extractDurationSeconds(prompt);
    const musicType = extractMusicType(prompt);
    const inputPrompt = extractGenerationPrompt(prompt) || (musicType === 'vocal' ? '带歌词的人声音乐' : '背景音乐');
    return {
      title: '准备生成音乐',
      summary: `已提取配乐描述：${inputPrompt}`,
      tab: 'music-studio',
      kind: 'music',
      inputPrompt,
      durationSeconds,
      musicType,
      steps: [
        '打开 AI 音乐',
        `将“${inputPrompt}”写入配乐风格与情感描述框`,
        durationSeconds ? `设置生成时长为 ${durationSeconds} 秒` : '根据描述保留默认生成时长',
        '生成试听结果并保留下载',
      ],
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

const ASSISTANT_PLAN_KINDS = new Set<AssistantPlan['kind']>([
  'audio', 'voice', 'video', 'music', 'sfx', 'director', 'requirements', 'library', 'general',
]);
const ASSISTANT_PLAN_TABS = new Set<TabType>([
  'workbench', 'audio-director', 'music-studio', 'sfx-studio', 'dubbing-studio',
  'settings', 'sfx-library', 'sfx-requirements', 'audio-tools', 'video-soundtrack',
]);

const parseModelPlan = (value: unknown, model: unknown, provider: unknown): AssistantPlan | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AssistantPlan>;
  if (
    typeof candidate.title !== 'string'
    || typeof candidate.summary !== 'string'
    || typeof candidate.kind !== 'string'
    || !ASSISTANT_PLAN_KINDS.has(candidate.kind as AssistantPlan['kind'])
    || typeof candidate.tab !== 'string'
    || !ASSISTANT_PLAN_TABS.has(candidate.tab as TabType)
    || !Array.isArray(candidate.steps)
    || candidate.steps.length === 0
    || candidate.steps.some(step => typeof step !== 'string')
  ) return null;

  return {
    ...candidate,
    title: candidate.title,
    summary: candidate.summary,
    kind: candidate.kind as AssistantPlan['kind'],
    tab: candidate.tab as TabType,
    steps: candidate.steps as string[],
    plannerSource: 'model',
    plannerModel: typeof model === 'string' ? model : 'gpt-5.6-sol',
    plannerProvider: provider === 'openai' || provider === 'ark' || provider === 'tokenhub'
      ? provider
      : undefined,
  };
};

export default function GlobalAssistant({ onNavigate, onAudioRequest, onVoiceRequest, onVideoRequest, onMusicRequest, onSfxRequest, onDirectorRequest, onRequirementsRequest, onLibraryRequest, externalTaskRunning = false, embedded = false }: GlobalAssistantProps) {
  const [open, setOpen] = useState(embedded);
  const sharedAssistant = useSyncExternalStore(subscribeToSharedAssistant, readSharedAssistant, readSharedAssistant);
  const prompt = sharedAssistant.prompt;
  const file = sharedAssistant.file;
  const plan = sharedAssistant.plan;
  const conversation = sharedAssistant.conversation;
  const setPrompt = useCallback<React.Dispatch<React.SetStateAction<string>>>((value) => {
    updateSharedAssistant((previous) => ({ prompt: typeof value === 'function' ? value(previous.prompt) : value }));
  }, []);
  const setFile = useCallback<React.Dispatch<React.SetStateAction<File | undefined>>>((value) => {
    updateSharedAssistant((previous) => ({ file: typeof value === 'function' ? value(previous.file) : value }));
  }, []);
  const setPlan = useCallback<React.Dispatch<React.SetStateAction<AssistantPlan | null>>>((value) => {
    updateSharedAssistant((previous) => ({ plan: typeof value === 'function' ? value(previous.plan) : value }));
  }, []);
  const setConversation = useCallback<React.Dispatch<React.SetStateAction<AssistantConversationMessage[]>>>((value) => {
    updateSharedAssistant((previous) => ({ conversation: typeof value === 'function' ? value(previous.conversation) : value }));
  }, []);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState('正在理解任务...');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [memory, setMemory] = useState<AssistantMemory>(() => loadAssistantMemory());
  const [libraryIndex, setLibraryIndex] = useState<SfxLibraryIndex>(() => readSfxLibraryIndex());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversationLogRef = useRef<HTMLDivElement>(null);
  const conversationGenerationRef = useRef(0);
  const assistantBusy = analyzing || running || externalTaskRunning;

  const startNewConversation = () => {
    conversationGenerationRef.current += 1;
    setConversation([]);
    setPrompt('');
    setFile(undefined);
    setPlan(null);
    setError(null);
    setAnalyzing(false);
    setRunning(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setOpen(true);
  };

  const attachAssistantFile = useCallback((nextFile?: File) => {
    if (!nextFile) return;
    setFile(nextFile);
    setPlan(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [setFile, setPlan]);

  const handleAssistantFileInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    attachAssistantFile(event.target.files?.[0]);
  }, [attachAssistantFile]);

  const handleAssistantFileDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  }, []);

  const handleAssistantFileDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    setDragActive(true);
  }, []);

  const handleAssistantFileDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragActive(false);
  }, []);

  const handleAssistantFileDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    setDragActive(false);
    attachAssistantFile(event.dataTransfer.files[0]);
  }, [attachAssistantFile]);

  const appendConversation = (role: AssistantConversationMessage['role'], content: string) => {
    const message = content.trim();
    if (!message) return;
    setConversation((previous) => [
      ...previous,
      { id: `assistant-message-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role, content: message },
    ].slice(-16));
  };

  useEffect(() => {
    const refreshLibraryIndex = (event?: Event) => {
      const customEvent = event as CustomEvent<SfxLibraryIndex> | undefined;
      setLibraryIndex(customEvent?.detail?.entries ? customEvent.detail : readSfxLibraryIndex());
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SFX_LIBRARY_CATEGORIES_KEY || event.key === SFX_LIBRARY_SOUNDS_KEY) refreshLibraryIndex();
    };
    window.addEventListener(SFX_LIBRARY_INDEX_EVENT, refreshLibraryIndex);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(SFX_LIBRARY_INDEX_EVENT, refreshLibraryIndex);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ASSISTANT_MEMORY_KEY, JSON.stringify(memory));
    } catch {
      // Private browsing or embedded contexts may deny local storage.
    }
  }, [memory]);

  useEffect(() => {
    const log = conversationLogRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }, [conversation, open]);

  useEffect(() => {
    if (!analyzing) return;
    setAnalysisStatus('正在理解任务...');
    const matchingTimer = window.setTimeout(() => {
      setAnalysisStatus('正在匹配最合适的功能...');
    }, 1_500);
    const validationTimer = window.setTimeout(() => {
      setAnalysisStatus('正在核对参数和实时资源...');
    }, 4_500);
    return () => {
      window.clearTimeout(matchingTimer);
      window.clearTimeout(validationTimer);
    };
  }, [analyzing]);

  const fileKind = useMemo(() => {
    if (!file) return null;
    if (AUDIO_EXTENSIONS.test(file.name) || file.type.startsWith('audio/')) return 'audio';
    if (file.type.startsWith('image/')) return 'image';
    if (TEXT_EXTENSIONS.test(file.name) || file.type.startsWith('text/')) return 'text';
    return 'file';
  }, [file]);

  const analyzeRequest = async () => {
    if (analyzing) return;
    const generation = conversationGenerationRef.current;
    const requestedPrompt = prompt.trim();
    const attachedFile = file;
    appendConversation('user', requestedPrompt || (attachedFile ? `上传文件：${attachedFile.name}` : '继续当前任务'));
    setAnalyzing(true);
    try {
      setError(null);
      let currentLibraryIndex = libraryIndex;
      try {
        const response = await fetch('/api/sfx/library/state', { headers: { Accept: 'application/json' } });
        if (response.ok) {
          const state = await response.json() as { categories?: unknown; sounds?: unknown };
          if (Array.isArray(state.categories) && Array.isArray(state.sounds)) {
            currentLibraryIndex = buildSfxLibraryIndex(state.categories, state.sounds);
            setLibraryIndex(currentLibraryIndex);
          }
        }
      } catch {
        // The local event-backed index remains usable when the shared server is offline.
      }
      let nextPlan: AssistantPlan;
      try {
        const response = await fetch('/api/ai/assistant/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            prompt: requestedPrompt,
            file: file ? { name: file.name, type: file.type, size: file.size } : undefined,
            conversation: conversation.slice(-8).map(({ role, content }) => ({ role, content })),
            memory: {
              preferredLanguage: memory.preferredLanguage,
              preferredGender: memory.preferredGender,
              preferredEmotion: memory.preferredEmotion,
              preferredFormat: memory.preferredFormat,
              recentTasks: memory.recentTasks,
            },
          }),
        });
        const result = await response.json().catch(() => ({})) as {
          plan?: unknown;
          model?: unknown;
          provider?: unknown;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || `GPT 任务规划失败 (${response.status})`);
        const modelPlan = parseModelPlan(result.plan, result.model, result.provider);
        if (!modelPlan) throw new Error('GPT 返回了无法执行的任务计划。');
        nextPlan = modelPlan;
      } catch (modelError) {
        console.warn('GPT 任务规划不可用，使用本地兜底:', modelError);
        nextPlan = {
          ...buildPlan(requestedPrompt, attachedFile, memory, currentLibraryIndex),
          plannerSource: 'local',
          plannerWarning: 'GPT 智能理解暂时不可用，当前结果来自本地兜底规则。',
        };
      }
      if (generation !== conversationGenerationRef.current) return;
      setPlan(nextPlan);
      appendConversation('assistant', `${nextPlan.title}：${nextPlan.summary}`);
      setMemory((previous) => ({
        ...previous,
        taskCount: previous.taskCount + 1,
        lastKind: nextPlan.kind,
        preferredLanguage: nextPlan.kind === 'voice' ? (nextPlan.voiceLanguage || extractLanguage(requestedPrompt, previous.preferredLanguage)) : previous.preferredLanguage,
        preferredGender: nextPlan.kind === 'voice' ? (nextPlan.voiceGender || extractGender(requestedPrompt, previous.preferredGender)) : previous.preferredGender,
        preferredEmotion: nextPlan.kind === 'voice' ? (nextPlan.voiceEmotion || extractEmotion(requestedPrompt, previous.preferredEmotion)) : previous.preferredEmotion,
        preferredFormat: nextPlan.requestedAudioFormat === 'mp3' || /转成mp3|转换成mp3|输出mp3|mp3/i.test(normalize(requestedPrompt)) ? 'mp3' : previous.preferredFormat,
        recentTasks: [requestedPrompt, ...previous.recentTasks.filter((item) => item !== requestedPrompt)].filter(Boolean).slice(0, 6),
      }));
    } catch (cause) {
      if (generation !== conversationGenerationRef.current) return;
      console.error('智能助手分析失败:', cause);
      setPlan(null);
      setError('任务分析失败，请检查描述后重试。');
    } finally {
      if (generation === conversationGenerationRef.current) setAnalyzing(false);
    }
  };

  const executePlan = async () => {
    if (!plan) return;
    const generation = conversationGenerationRef.current;
    setRunning(true);
    setError(null);
    try {
      onNavigate(plan.tab);
      const requestId = `assistant-${Date.now()}`;

      if (plan.navigationOnly) {
        if (plan.kind === 'audio') {
          const planText = `${prompt} ${plan.title || ''} ${plan.summary || ''} ${(plan.steps || []).join(' ')}`;
          const forcedAudioTool = detectMusicSeparationTask(planText) ? 'music-separation'
            : detectMidiTask(planText) ? 'midi'
              : undefined;
          onAudioRequest({
            id: requestId,
            task: forcedAudioTool || plan.audioTask || 'workstation',
            audioTool: forcedAudioTool || plan.audioTool || 'workstation',
          });
        } else if (plan.kind === 'voice') {
          const mode = plan.voiceMode || 'tts';
          await onVoiceRequest({
            id: requestId,
            mode,
            inputMode: plan.voiceInputMode || 'single',
            text: '',
            language: memory.preferredLanguage,
            gender: memory.preferredGender,
            emotion: memory.preferredEmotion,
            openVoiceLibrary: plan.openVoiceLibrary ?? false,
          });
        }
        if (generation !== conversationGenerationRef.current) return;
        appendConversation('assistant', `已打开${plan.title}。你可以继续告诉我下一步，我会沿用当前文件和上下文。`);
        setPrompt('');
        setPlan(null);
        setOpen(false);
        window.setTimeout(() => setRunning(false), 300);
        return;
      }

      if (plan.kind === 'audio') {
        const hasAudioTargets = plan.audioTargets && Object.values(plan.audioTargets).some((value) => value !== undefined);
        const wantsConvert = plan.audioTask === 'convert' || hasAudioTargets || /转成mp3|转换成mp3|输出mp3|格式转换|转换格式|转格式|提取音频|mp3/i.test(prompt);
        const planText = `${prompt} ${plan.title || ''} ${plan.summary || ''} ${(plan.steps || []).join(' ')}`;
        const forcedAudioTool = detectMusicSeparationTask(planText) ? 'music-separation'
          : detectMidiTask(planText) ? 'midi'
            : undefined;
        onAudioRequest({
          id: requestId,
          file,
          task: forcedAudioTool || plan.audioTask || (wantsConvert ? 'convert' : 'analyze'),
          audioTool: forcedAudioTool || plan.audioTool,
          ...(plan.requestedAudioFormat ? { targetFormat: plan.requestedAudioFormat } : {}),
          ...plan.audioTargets,
        });
      } else if (plan.kind === 'voice') {
        const mode = plan.voiceMode || detectVoiceMode(prompt);
        const language = plan.voiceLanguage && plan.voiceLanguage !== 'auto'
          ? plan.voiceLanguage
          : extractLanguage(prompt, memory.preferredLanguage);
        const gender = plan.voiceGender || extractGender(prompt, memory.preferredGender);
        const emotion = plan.voiceEmotion || extractEmotion(prompt, memory.preferredEmotion);
        const genderLabel = gender === 'female' ? '女声' : '男声';
        const role = plan.voiceRole || extractVoiceRole(prompt);
        await onVoiceRequest({
          id: requestId,
          file,
          mode,
          inputMode: plan.voiceInputMode || (detectBatchVoiceRequest(prompt) ? 'batch' : 'single'),
          text: mode === 'tts' ? (plan.voiceText || extractVoiceText(prompt)) : '',
          language,
          gender,
          emotion,
          role: role || undefined,
          voiceSearchQuery: [role, genderLabel, emotion, language].filter(Boolean).join(' '),
          openVoiceLibrary: plan.openVoiceLibrary ?? mode === 'tts',
        });
      } else if (plan.kind === 'video') {
        const requestedTracks = filterPreservedVideoTracks(
          plan.tracks || detectVideoTracks(prompt),
          prompt,
        );
        onVideoRequest({
          id: requestId,
          file,
          prompt,
          tracks: requestedTracks,
          analyzeSubtitles: plan.analyzeSubtitles ?? true,
          autoAnalyze: true,
          autoGenerate: plan.autoGenerateVideo ?? true,
        });
      } else if (plan.kind === 'music') {
        onMusicRequest({
          id: requestId,
          prompt: plan.inputPrompt || prompt.trim(),
          durationSeconds: plan.durationSeconds,
          musicType: plan.musicType,
        });
      } else if (plan.kind === 'sfx') {
        onSfxRequest({ id: requestId, prompt: plan.inputPrompt || prompt.trim(), durationSeconds: plan.durationSeconds });
      } else if (plan.kind === 'director') {
        onDirectorRequest?.({ id: requestId, file, prompt: prompt.trim() });
      } else if (plan.kind === 'requirements') {
        onRequirementsRequest?.({
          id: requestId,
          prompt: plan.inputPrompt || prompt.trim(),
          template: plan.requirementsTemplate,
        });
      } else if (plan.kind === 'library') {
        onLibraryRequest?.({
          id: requestId,
          searchQuery: plan.librarySearchQuery || extractLibrarySearchQuery(prompt),
          category: plan.libraryCategory,
          subcategory: plan.librarySubcategory,
        });
      }

      if (generation !== conversationGenerationRef.current) return;
      appendConversation('assistant', `已执行“${plan.title}”。当前文件和会话已保留，可以继续下达下一步任务。`);
      setPrompt('');
      setPlan(null);
      setOpen(false);
      window.setTimeout(() => setRunning(false), 700);
    } catch (cause) {
      if (generation !== conversationGenerationRef.current) return;
      console.error('智能助手执行失败:', cause);
      setRunning(false);
      setError('打开功能失败，当前任务已保留。请重试，或直接从主导航进入对应功能。');
    }
  };

  const executeLibraryFallback = () => {
    if (!plan?.libraryFallbackKind || !plan.libraryFallbackPrompt) return;
    const generation = conversationGenerationRef.current;
    setRunning(true);
    setError(null);
    const requestId = `assistant-library-fallback-${Date.now()}`;
    try {
      if (plan.libraryFallbackKind === 'music') {
        onNavigate('music-studio');
        onMusicRequest({
          id: requestId,
          prompt: plan.libraryFallbackPrompt,
          durationSeconds: extractDurationSeconds(prompt),
          musicType: extractMusicType(prompt),
        });
      } else {
        onNavigate('sfx-studio');
        onSfxRequest({
          id: requestId,
          prompt: plan.libraryFallbackPrompt,
          durationSeconds: extractDurationSeconds(prompt),
        });
      }
      if (generation !== conversationGenerationRef.current) return;
      setOpen(false);
      window.setTimeout(() => setRunning(false), 700);
    } catch (cause) {
      if (generation !== conversationGenerationRef.current) return;
      console.error('智能助手切换 AI 生成失败:', cause);
      setRunning(false);
      setError('打开 AI 生成功能失败，当前任务已保留，请重试。');
    }
  };

  return (
    <div className={embedded ? 'relative z-0 w-full pointer-events-auto' : 'pointer-events-none fixed inset-0 z-[80]'}>
      {!open && (
        <button
          type="button"
          aria-label={assistantBusy ? '智能助手正在处理任务，点击展开' : '打开智能助手'}
          title={assistantBusy ? '任务处理中' : '打开智能助手'}
          onClick={() => setOpen(true)}
          className={embedded
            ? `relative mt-3 flex h-11 w-11 items-center justify-center rounded-full border bg-white/65 text-emerald-600 backdrop-blur-md transition hover:scale-105 hover:border-emerald-300 hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${assistantBusy ? 'border-emerald-300 shadow-[0_8px_32px_rgba(16,185,129,0.24)]' : 'border-emerald-200/70 shadow-[0_8px_28px_rgba(16,185,129,0.16)]'}`
            : `pointer-events-auto absolute bottom-5 right-5 flex h-14 w-14 items-center justify-center rounded-full border bg-white/65 text-emerald-600 backdrop-blur-md transition hover:scale-105 hover:border-emerald-300 hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 sm:bottom-7 sm:right-7 ${assistantBusy ? 'border-emerald-300 shadow-[0_8px_32px_rgba(16,185,129,0.24)]' : 'border-emerald-200/70 shadow-[0_8px_28px_rgba(16,185,129,0.16)]'}`}
        >
          {assistantBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-label="全局智能助手"
          className={`${embedded ? 'relative mx-auto flex min-h-[360px] w-full max-w-2xl' : 'pointer-events-auto absolute bottom-8 right-4 flex w-[min(440px,calc(100vw-2rem))] max-h-[min(720px,calc(100dvh-2rem))] sm:bottom-10 sm:right-6'} flex-col overflow-hidden text-slate-700 ${embedded ? 'rounded-none border-0 bg-transparent shadow-none backdrop-blur-0' : 'rounded-[22px] border border-emerald-200/65 bg-white/45 shadow-[0_20px_70px_rgba(15,23,42,0.14),0_0_0_1px_rgba(16,185,129,0.07)] backdrop-blur-2xl'}`}
        >
          {!embedded && <header className="relative flex items-center justify-between border-b border-emerald-200/55 bg-white/52 px-5 py-4 text-slate-800">
            <div className="absolute inset-x-0 top-0 h-px bg-emerald-400/80" aria-hidden="true" />
            <div className="flex items-center gap-3">
              {!embedded && (
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-50/80 shadow-[0_0_18px_rgba(16,185,129,0.14)]">
                  {assistantBusy ? <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> : <Sparkles className="h-4 w-4 text-emerald-600" />}
                </div>
              )}
              {!embedded && (
                <div>
                  <h2 className="text-sm font-bold">智能助手</h2>
                  <p className="mt-0.5 text-[10px] text-slate-500">描述任务，我会打开对应功能并准备参数</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={startNewConversation}
                aria-label="新建对话"
                title="新建对话"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="最小化智能助手"
                title="最小化智能助手"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
              >
                <Minus className="h-4 w-4" />
              </button>
            </div>
          </header>}

          <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5 ${embedded ? 'bg-transparent' : 'bg-white/20'}`}>
            {conversation.length > 0 && (
              <div
                ref={conversationLogRef}
                role="log"
                aria-label="助手任务会话"
                className={`${embedded ? 'overflow-visible' : 'max-h-[220px] overflow-y-auto'} shrink-0 space-y-2 rounded-2xl border border-emerald-200/55 bg-white/24 p-2.5`}
              >
                <div className="flex items-center gap-1.5 px-1 text-[10px] font-bold text-emerald-700">
                  <MessageCircle className="h-3.5 w-3.5" />
                  <span>任务会话</span>
                </div>
                {conversation.map((message) => (
                  <div
                    key={message.id}
                    className={`rounded-xl px-2.5 py-2 text-[10px] leading-relaxed ${message.role === 'user'
                      ? 'ml-5 bg-emerald-500/10 text-slate-700'
                      : 'mr-5 border border-emerald-100/80 bg-white/45 text-slate-500'}`}
                  >
                    <span className="mr-1 font-bold text-emerald-700">{message.role === 'user' ? '你' : '助手'}</span>
                    {message.content}
                  </div>
                ))}
              </div>
            )}

            <div
              className={`relative rounded-2xl transition ${dragActive ? 'ring-2 ring-emerald-300 ring-offset-2 ring-offset-white/50' : ''}`}
              onDragEnter={handleAssistantFileDragEnter}
              onDragOver={handleAssistantFileDragOver}
              onDragLeave={handleAssistantFileDragLeave}
              onDrop={handleAssistantFileDrop}
            >
            <div
              onClick={() => fileInputRef.current?.click()}
              aria-label="上传音频、视频、图片或文档"
              title={file ? file.name : '上传文件'}
              className="pointer-events-none absolute inset-x-2 bottom-2 z-10 p-1 text-emerald-600 transition"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/*,image/*,.txt,.md,.csv,.tsv,.json,.docx,.xlsx,.pdf"
                className="hidden"
                onChange={handleAssistantFileInputChange}
              />
              <div className="flex items-center justify-start gap-2">
                <div className="pointer-events-auto flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-emerald-200/70 bg-white/75 text-emerald-600 shadow-sm transition hover:border-emerald-300 hover:bg-white hover:text-emerald-700">
                  <Plus className="h-5 w-5" strokeWidth={2.25} />
                </div>
                <div className={`${file ? 'min-w-0 flex-1' : 'hidden'}`}>
                  <p className="truncate text-xs font-bold text-slate-700">{file ? file.name : '上传音频、视频、图片或文档'}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{file ? `${Math.max(1, Math.round(file.size / 1024))} KB · 点击替换` : '也可以只输入文字任务'}</p>
                </div>
                {file && (
                  <div className="pointer-events-auto flex shrink-0 items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    <button
                      type="button"
                      aria-label="删除已上传文件"
                      title="删除已上传文件"
                      onClick={(event) => {
                        event.stopPropagation();
                        setFile(undefined);
                        setPlan(null);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500"
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
              className={`min-h-28 w-full resize-y rounded-2xl border px-3 py-3 pb-12 text-xs leading-relaxed text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 ${dragActive ? 'border-emerald-400 bg-emerald-50/80' : 'border-emerald-200/65 bg-white/26'}`}
            />
            {dragActive ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border border-emerald-300 bg-emerald-50/85 text-xs font-bold text-emerald-700 shadow-inner">
                松开即可上传到智能助手
              </div>
            ) : null}
            </div>
            {file && (
              <p className="px-1 text-[10px] text-slate-400">
                已保留当前文件和会话，可直接说“继续”“下一步”或指定新的片段任务。
              </p>
            )}

            <button
              type="button"
              disabled={analyzing || (!prompt.trim() && !file)}
              onClick={analyzeRequest}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/70 bg-emerald-500 text-xs font-bold text-white shadow-[0_0_22px_rgba(16,185,129,0.16)] transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-slate-200 disabled:text-slate-400"
            >
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {analyzing ? analysisStatus : '分析任务'}
            </button>

            {error && (
              <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-[10px] leading-relaxed text-amber-800">
                {error}
              </div>
            )}

            {plan && (
              <div className="space-y-3 rounded-2xl border border-emerald-200/65 bg-white/32 p-3.5 shadow-[inset_0_1px_0_rgba(167,243,208,0.1)]">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-black text-slate-800">{plan.title}</h3>
                    <span className="rounded-full border border-emerald-200/80 bg-emerald-50/80 px-2 py-0.5 text-[9px] font-bold text-emerald-700">{plan.tab === 'dubbing-studio' ? 'AI 配音' : plan.tab === 'audio-tools' ? '音频工具' : plan.tab === 'video-soundtrack' ? '视频声音制作' : plan.tab === 'music-studio' ? 'AI 音乐' : plan.tab === 'sfx-studio' ? 'AI 音效' : plan.tab === 'audio-director' ? 'AI 音频设计' : plan.tab === 'sfx-requirements' ? '音效需求表' : plan.tab === 'sfx-library' ? '音效库' : '工作台'}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{plan.summary}</p>
                  <p className="mt-1 text-[9px] text-slate-400">
                    {plan.plannerSource === 'model'
                      ? `GPT 规划 · ${plan.plannerModel || '当前模型'}${plan.plannerProvider ? ` · ${plan.plannerProvider}` : ''}`
                      : '本地规则兜底'}
                  </p>
                </div>
                {plan.plannerWarning && (
                  <div role="status" className="rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-2 text-[10px] leading-relaxed text-amber-800">
                    {plan.plannerWarning}
                  </div>
                )}
                <ol className="space-y-2">
                  {plan.steps.map((step, index) => (
                    <li key={step} className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-600">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-emerald-200/80 bg-emerald-50 text-[9px] font-black text-emerald-700">{index + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <div className="sticky bottom-0 z-10 -mx-1 space-y-2 bg-white/72 px-1 pb-1 pt-2 backdrop-blur-md">
                  <button
                    type="button"
                    onClick={executePlan}
                    disabled={running}
                    className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-xs font-bold transition disabled:bg-emerald-200 disabled:text-emerald-700/50 ${plan.kind === 'library' && plan.libraryMatchCount === 0 && plan.libraryFallbackKind ? 'border-emerald-200/80 bg-white/75 text-emerald-700 hover:bg-emerald-50/80' : 'border-emerald-300/70 bg-emerald-500 text-white shadow-[0_0_22px_rgba(16,185,129,0.14)] hover:bg-emerald-600'}`}
                  >
                    {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                    {running ? '正在打开并准备…' : plan.kind === 'library' && plan.libraryMatchCount === 0 ? '打开音效库继续查找' : '确认并打开功能'}
                  </button>
                  {plan.kind === 'library' && plan.libraryMatchCount === 0 && plan.libraryFallbackKind && (
                    <button
                      type="button"
                      onClick={executeLibraryFallback}
                      disabled={running}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/70 bg-emerald-500 text-xs font-bold text-white shadow-[0_0_22px_rgba(16,185,129,0.14)] transition hover:bg-emerald-600 disabled:bg-emerald-200 disabled:text-emerald-700/50"
                    >
                      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {running ? '正在切换…' : `改用 ${plan.libraryFallbackKind === 'music' ? 'AI 音乐' : 'AI 音效'}生成`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

        </section>
      )}
    </div>
  );
}
