/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { 
  Mic, 
  Loader2, 
  Play, 
  Pause, 
  Download, 
  X, 
  Sliders, 
  CheckCircle2, 
  AlertCircle,
  Sparkles,
  Volume2,
  Users,
  Globe,
  Pencil,
  Check,
  Search,
  ChevronDown,
  Info,
  Languages,
  UploadCloud,
  FileAudio,
  RefreshCw
} from 'lucide-react';
import { HistoryItem } from '../types';
import { ELEVENLABS_VOICES, VoiceItem } from '../data/voices';
import { fetchAvailableVoices, generateSpeechToSpeech, generateVoice } from '../services/elevenLabsService';
import SpeechToSpeech from './SpeechToSpeech';
import SpeechToText from './SpeechToText';
import CrossLanguageDubbing from './CrossLanguageDubbing';
import VoiceConversion from './VoiceConversion';
import { downloadAudioHelper } from '../utils/downloadHelper';
import GeneratedAudioPlayer, { sanitizeAudioFileName } from './GeneratedAudioPlayer';
import { enhanceVoicePromptForElevenV3 } from '../services/geminiService';
import { getElevenLabsQualityMode } from '../utils/elevenLabsQuality';
import type { AssistantVoiceRequest } from './GlobalAssistant';

interface PendingVoiceOption {
  url: string;
  voiceLabel: string;
  displayName: string;
  emotionLabel: string;
  processedText: string;
  timestamp: string;
  details: string;
  speed: number;
}

type BatchVoiceStatus = 'pending' | 'generating' | 'done' | 'error';
type BatchVoiceNameSource = 'detected' | 'fallback' | 'manual';

interface BatchVoiceRequirement {
  id: string;
  enabled: boolean;
  name: string;
  nameSource?: BatchVoiceNameSource;
  text: string;
  emotionTags: string;
  note: string;
  sourceLine: string;
  status: BatchVoiceStatus;
  audioUrl?: string;
  error?: string;
}
interface DubbingStudioProps {
  standaloneVoicePrompt: string;
  setStandaloneVoicePrompt: (prompt: string) => void;
  standaloneVoiceGender: 'male' | 'female';
  setStandaloneVoiceGender: (gender: 'male' | 'female') => void;
  standaloneVoiceRole: string;
  setStandaloneVoiceRole: (role: string) => void;
  setSelectedStandaloneVoice?: (voice: VoiceItem | null) => void;
  standaloneVoiceLang: string;
  setStandaloneVoiceLang: (lang: string) => void;
  standaloneVoiceSpeed: number;
  setStandaloneVoiceSpeed: (speed: number) => void;
  standaloneVoiceLoading: boolean;
  standaloneVoiceAudioUrl: string | null;
  setStandaloneVoiceAudioUrl: (url: string | null) => void;
  standaloneVoiceError: string | null;
  standaloneVoiceAudioRef: React.RefObject<HTMLAudioElement | null>;
  handleStandaloneVoiceGenerate: () => void;
  historyList: HistoryItem[];
  setHistoryList: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
  pendingVoiceOptions: {
    optionA: PendingVoiceOption | null;
    optionB: PendingVoiceOption | null;
  };
  setPendingVoiceOptions: React.Dispatch<React.SetStateAction<{
    optionA: PendingVoiceOption | null;
    optionB: PendingVoiceOption | null;
  }>>;
  assistantVoiceRequest?: AssistantVoiceRequest | null;
}

const VOICE_SEARCH_SYNONYMS: Array<{ triggers: string[]; terms: string[] }> = [
  { triggers: ['女', '女性', '女声', '女生', '女孩', '少女', 'female', 'woman', 'girl', 'feminine', '女性的', '女性声', '여성', '여자', '女声優', 'femme', 'féminine', 'mujer', 'femenina', 'weiblich', 'frau', 'mulher', 'feminina'], terms: ['female', 'woman', 'girl', 'young female', 'feminine'] },
  { triggers: ['男', '男性', '男声', '男生', '男孩', '大叔', 'male', 'man', 'boy', 'masculine', '男性的', '男性声', '남성', '남자', '男声優', 'homme', 'masculin', 'hombre', 'masculina', 'männlich', 'mann', 'masculino'], terms: ['male', 'man', 'boy', 'masculine'] },
  { triggers: ['温柔', '柔和', '治愈', '亲切', '舒服', '暖', '暖心', 'gentle', 'soft', 'warm', 'soothing', 'calm', '優しい', 'やさしい', '穏やか', '柔らかい', '따뜻한', '부드러운', '차분한', 'douce', 'doux', 'calme', 'suave', 'cálida', 'calido', 'ruhig', 'sanft', 'warmherzig', 'gentil', 'suave'], terms: ['gentle', 'soft', 'warm', 'soothing', 'comforting', 'calm', 'kind'] },
  { triggers: ['开心', '高兴', '快乐', '兴奋', '激动', '活泼', '元气', 'happy', 'excited', 'cheerful', 'playful', '楽しい', '明るい', '元気', '嬉しい', '신나는', '밝은', '활발한', 'joyeux', 'joyeuse', 'heureux', 'animé', 'alegre', 'emocionado', 'divertido', 'fröhlich', 'lebhaft', 'aufgeregt', 'animada'], terms: ['happy', 'excited', 'energetic', 'upbeat', 'cheerful', 'playful', 'lively'] },
  { triggers: ['严肃', '正式', '专业', '商务', '稳重', '沉稳', 'serious', 'professional', 'formal', 'business', '信頼', 'プロ', '真面目', '전문적인', '진지한', '차분한', 'professionnel', 'sérieux', 'formel', 'profesional', 'serio', 'formal', 'professionell', 'seriös', 'geschäftlich'], terms: ['serious', 'professional', 'formal', 'corporate', 'confident', 'trustworthy', 'authoritative'] },
  { triggers: ['低沉', '磁性', '厚', '深沉', '成熟', 'deep', 'low', 'rich', 'mature', '低い', '渋い', '深い', '낮은', '깊은', '성숙한', 'grave', 'profond', 'profonde', 'maduro', 'madura', 'tief', 'reif', 'baixo', 'profundo'], terms: ['deep', 'low', 'resonant', 'rich', 'mature', 'bass'] },
  { triggers: ['年轻', '青春', '少年', '少女', '学生', 'young', 'youthful', 'teen', '若い', '青春', '若者', '젊은', '청춘', 'jeune', 'joven', 'juvenil', 'jung', 'jugendlich'], terms: ['young', 'youthful', 'teen', 'fresh'] },
  { triggers: ['老人', '老年', '年长', '爷爷', '奶奶', 'old', 'elderly', 'senior', 'お年寄り', '老人', '高齢', '노인', '어르신', 'âgé', 'âgée', 'senior', 'mayor', 'anciano', 'älter', 'idoso'], terms: ['old', 'elderly', 'senior', 'aged', 'mature'] },
  { triggers: ['旁白', '解说', '叙述', '纪录片', '讲述', 'narration', 'narrator', 'voiceover', 'ナレーション', '語り', '解説', '내레이션', '해설', 'narrateur', 'narratrice', 'voix off', 'narrador', 'narradora', 'erzähler', 'sprecher'], terms: ['narration', 'narrator', 'storytelling', 'documentary', 'voiceover', 'deep engaging'] },
  { triggers: ['牧师', '神父', '传教士', '牧师角色', 'priest', 'pastor', 'preacher', 'reverend'], terms: ['priest', 'pastor', 'preacher', 'reverend', 'authoritative', 'warm'] },
  { triggers: ['广告', '宣传', '品牌', '产品', 'commercial', 'promo', 'brand', '広告', '宣伝', '브랜드', '광고', 'publicité', 'marque', 'promoción', 'marca', 'werbung', 'marke'], terms: ['commercial', 'promo', 'advertising', 'brand', 'clear', 'professional'] },
  { triggers: ['角色', '动画', '游戏', '卡通', '可爱', 'q版', 'character', 'animation', 'game', 'cartoon', 'cute', 'キャラ', 'アニメ', 'ゲーム', 'かわいい', '캐릭터', '애니', '게임', '귀여운', 'personnage', 'dessin animé', 'jeu', 'mignon', 'personaje', 'animación', 'juego', 'lindo', 'figur', 'spiel', 'süß'], terms: ['character', 'animation', 'game', 'cartoon', 'cute', 'playful'] },
  { triggers: ['害怕', '紧张', '恐惧', '惊悚', '悬疑', 'nervous', 'tense', 'scared', 'suspense', '怖い', '緊張', '不安', '무서운', '긴장', '불안', 'nerveux', 'tendu', 'peur', 'suspense', 'nervioso', 'tenso', 'miedo', 'suspenso', 'nervös', 'angespannt', 'unheimlich'], terms: ['nervous', 'tense', 'scared', 'suspense', 'dramatic'] },
  { triggers: ['悲伤', '难过', '哭', '失落', '遗憾', 'sad', 'melancholy', 'emotional', '悲しい', '泣く', '切ない', '슬픈', '감성적인', 'triste', 'mélancolique', 'émotionnel', 'emocional', 'melancólico', 'traurig', 'emotional', 'melancholisch'], terms: ['sad', 'melancholy', 'emotional', 'soft'] },
  { triggers: ['中文', '普通话', '国语', '华语', 'mandarin', 'chinese', '中国語', '중국어'], terms: ['chinese', 'mandarin', 'zh'] },
  { triggers: ['英文', '英语', '美式', '英式', 'english', 'american', 'british', '英語', '영어'], terms: ['english', 'american', 'british', 'en'] },
  { triggers: ['日文', '日语', 'japanese', '日本語', '일본어'], terms: ['japanese', 'ja'] },
  { triggers: ['韩文', '韩语', 'korean', '韓国語', '한국어'], terms: ['korean', 'ko'] },
];

const QUICK_VOICE_SEARCHES = ['温柔女声', '低沉男声', '年轻旁白', '专业解说', '开心活泼', '成熟稳重'];
const DEFAULT_SMART_VOICE_SEARCH_TERMS = ['voice', 'narration', 'natural', 'expressive', 'character'];
const BATCH_VOICE_ACCEPTED_FILE_TYPES = '.txt,.md,.csv,.tsv,.json,.html,.htm,.docx,.xlsx,.xls,.pdf,image/*';
const BATCH_VOICE_READABLE_FILE_HINT = '支持拖拽 Word .docx、Excel .xlsx、CSV/TSV、TXT/MD/JSON/HTML；旧版 .xls 建议另存为 .xlsx 或 CSV。';
const DUBBING_SUBNAV_MIN_WIDTH = 64;
const DUBBING_SUBNAV_COMPACT_WIDTH = 168;
const DUBBING_SUBNAV_DEFAULT_WIDTH = 184;
const DUBBING_SUBNAV_MAX_WIDTH = 520;
const DUBBING_SUBNAV_WIDTH_READY_KEY = 'ai-audio-dubbing-subnav-width-ready';

const normalizeVoiceSearchText = (value: unknown) => (
  String(value || '')
    .toLowerCase()
    .replace(/[_#/·|()[\]{}，。！？、；：:;,.!?'"“”‘’+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const stripVoiceSearchDiacritics = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const voiceSearchMatchesTrigger = (normalizedText: string, trigger: string) => {
  const normalizedTrigger = normalizeVoiceSearchText(trigger);
  if (!normalizedTrigger) return false;
  return normalizedText.includes(normalizedTrigger)
    || stripVoiceSearchDiacritics(normalizedText).includes(stripVoiceSearchDiacritics(normalizedTrigger));
};

const getVoiceSearchTerms = (query: string) => {
  const normalized = normalizeVoiceSearchText(query);
  if (!normalized) return [];

  const terms = new Set<string>();
  terms.add(normalized);
  normalized.split(/\s+/).filter(Boolean).forEach(term => terms.add(term));

  VOICE_SEARCH_SYNONYMS.forEach(({ triggers, terms: expandedTerms }) => {
    if (triggers.some(trigger => voiceSearchMatchesTrigger(normalized, trigger))) {
      triggers.forEach(trigger => terms.add(trigger.toLowerCase()));
      expandedTerms.forEach(term => terms.add(term.toLowerCase()));
    }
  });

  return Array.from(terms).filter(term => term.length > 0);
};

const buildSmartVoiceSearchQuery = (input: string) => {
  const normalized = normalizeVoiceSearchText(input);
  if (!normalized) return '';

  const terms = new Set<string>();
  const searchableNormalized = stripVoiceSearchDiacritics(normalized);
  const asciiWords = searchableNormalized.match(/[a-z0-9-]+/gi) || [];
  asciiWords.forEach(word => {
    if (word.length > 1) terms.add(word.toLowerCase());
  });

  VOICE_SEARCH_SYNONYMS.forEach(({ triggers, terms: expandedTerms }) => {
    if (triggers.some(trigger => voiceSearchMatchesTrigger(normalized, trigger))) {
      expandedTerms.forEach(term => terms.add(term.toLowerCase()));
    }
  });

  if (terms.size === 0) {
    return DEFAULT_SMART_VOICE_SEARCH_TERMS.join(' ');
  }

  return Array.from(terms).slice(0, 18).join(' ');
};

const getVoiceSearchHaystack = (voice: VoiceItem) => normalizeVoiceSearchText([
  voice.name,
  voice.englishName,
  voice.gender === 'male' ? '男声 male masculine man' : '女声 female feminine woman',
  voice.category,
  voice.description,
  ...(voice.tags || []),
].join(' '));

const escapeVoiceSearchRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const voiceSearchTextIncludesTerm = (text: string, term: string) => {
  if (!term) return false;
  if (/^[a-z0-9][a-z0-9\s-]*$/i.test(term)) {
    const compactTerm = term.replace(/\s+/g, ' ').trim();
    return new RegExp(`(^|\\s)${escapeVoiceSearchRegex(compactTerm)}(?=\\s|$)`, 'i').test(text);
  }
  return text.includes(term);
};

const getVoiceSearchScore = (voice: VoiceItem, query: string) => {
  const normalizedQuery = normalizeVoiceSearchText(query);
  if (!normalizedQuery) return 1;

  const haystack = getVoiceSearchHaystack(voice);
  const voiceName = normalizeVoiceSearchText(`${voice.name} ${voice.englishName}`);
  const terms = getVoiceSearchTerms(query);
  let score = 0;

  if (voiceSearchTextIncludesTerm(voiceName, normalizedQuery)) score += 80;
  if (voiceSearchTextIncludesTerm(haystack, normalizedQuery)) score += 40;
  terms.forEach(term => {
    if (voiceSearchTextIncludesTerm(voiceName, term)) score += 18;
    if (voiceSearchTextIncludesTerm(haystack, term)) score += 8;
  });

  return score;
};

const sanitizeBatchVoiceFileName = (value: string) => (
  sanitizeAudioFileName(value || 'voice')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
    || 'voice'
);

const stripBatchVoiceNameIndexPrefix = (value: string) => (
  String(value || '')
    .trim()
    .replace(/^[0-9０-９]{1,4}\s*[.．、)）_-]\s*/, '')
    .trim()
);

const shouldPrefixBatchVoiceFileName = (item: BatchVoiceRequirement) => (
  item.nameSource === 'fallback'
  || (!item.nameSource && item.note.includes('未检测到命名'))
);

const formatBatchVoiceFileName = (item: BatchVoiceRequirement, index: number) => {
  const baseName = sanitizeBatchVoiceFileName(stripBatchVoiceNameIndexPrefix(item.name) || getBatchVoiceFallbackName(item.text, index));
  return shouldPrefixBatchVoiceFileName(item) ? `${index + 1}.${baseName}` : baseName;
};

const stripBatchVoiceTags = (text: string) => text
  .replace(/\[[^\]\r\n]{1,48}\]/g, ' ')
  .replace(/【[^】\r\n]{1,48}】/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const stripBatchVoiceLeadingIndex = (text: string) => {
  const trimmedText = text.trim();
  const match = trimmedText.match(/^(?:[#＃]\s*)?(?:第\s*)?([0-9０-９]{1,4}|[一二三四五六七八九十百千万两]{1,10})\s*[.．、)）:：]\s*(.+)$/u);
  if (!match) return trimmedText;
  const remainingText = match[2].trim();
  if (!remainingText || /^[0-9０-９]/.test(remainingText)) return trimmedText;
  return remainingText;
};

const normalizeBatchVoiceTag = (tag: string) => {
  const normalized = normalizeVoiceSearchText(tag);
  if (!normalized) return '';
  if (/(婚礼|仪式|典礼|庆典|祝贺|新人|誓言|ceremony|ceremonial|wedding|celebration|celebratory|solemn)/.test(normalized)) return 'ceremonial';
  if (/(开心|高兴|兴奋|激动|惊喜|热情|excited|happy|joyful|thrilled|energetic)/.test(normalized)) return 'excited';
  if (/(大声|喊|吼|紧急|危险|shout|shouting|loud|urgent|danger)/.test(normalized)) return 'shouting';
  if (/(小声|悄悄|低声|耳语|秘密|whisper|whispers|quiet|secret)/.test(normalized)) return 'whispers';
  if (/(难过|悲伤|伤心|哭|遗憾|失落|sad|crying|sorry|melancholy|regret)/.test(normalized)) return 'sad';
  if (/(害怕|恐惧|紧张|不安|惊吓|悬疑|scared|afraid|nervous|tense|anxious|suspense)/.test(normalized)) return 'nervous';
  if (/(笑|哈哈|打趣|laugh|laughs|chuckle|joking)/.test(normalized)) return 'laughs';
  if (/(温柔|暖|亲切|安慰|warm|comforting|kind)/.test(normalized)) return 'warm';
  if (/(平静|冷静|轻声|慢慢|calm|gentle|soft|slowly)/.test(normalized)) return 'calm';
  if (/(严肃|认真|郑重|正式通知|正式声明|警告|命令|专业|沉稳|serious|professional|formal|authoritative)/.test(normalized)) return 'serious';
  return normalized.replace(/[^a-z0-9\s-]/gi, '').split(/\s+/).filter(Boolean)[0] || 'natural';
};

const inferBatchVoiceTags = (text: string) => {
  const normalized = text.toLowerCase();
  const hasCelebrationContext = /(婚礼|仪式|典礼|庆典|庆祝|祝贺|新人|伴侣|礼花|红包|礼物|狂欢|誓言)/.test(text)
    || /\b(wedding|ceremony|celebration|celebratory|congratulations)\b/.test(normalized);
  const tags: string[] = [];
  const add = (tag: string) => {
    if (!tags.includes(tag)) tags.push(tag);
  };

  if (hasCelebrationContext) add('ceremonial');
  if (/(祝贺|庆祝|狂欢|抢红包|送礼物|玩游戏|爆起来|燥起来|躁起来|太好了|终于成功|开心|高兴|兴奋|激动|惊喜|热情|!|！)/.test(text) || /\b(excited|happy|joyful|thrilled|energetic|celebrat)\b/.test(normalized)) add('excited');
  if (/(大声|喊|快点|紧急|危险|注意)/.test(text) || /\b(shout|shouting|loud|urgent|danger)\b/.test(normalized)) add('shouting');
  if (/(小声|悄悄|低声|耳语|秘密)/.test(text) || /\b(whisper|whispers|quiet|secret)\b/.test(normalized)) add('whispers');
  if (/(难过|悲伤|伤心|哭|遗憾|失落|对不起)/.test(text) || /\b(sad|crying|sorry|melancholy|regret)\b/.test(normalized)) add('sad');
  if (/(害怕|恐惧|紧张|不安|惊吓|悬疑)/.test(text) || /\b(scared|afraid|nervous|tense|anxious|suspense)\b/.test(normalized)) add('nervous');
  if (/(笑|哈哈|开心地笑|打趣)/.test(text) || /\b(laugh|laughs|chuckle|joking)\b/.test(normalized)) add('laughs');
  if (/(温柔|暖|亲切|安慰)/.test(text) || /\b(warm|comforting|kind)\b/.test(normalized)) add('warm');
  if (hasCelebrationContext || /(平静|冷静|轻声|慢慢|请大家保持安静)/.test(text) || /\b(calm|gentle|soft|slowly)\b/.test(normalized)) add('calm');
  if (!hasCelebrationContext && (/(严肃|认真|郑重|正式通知|正式声明|警告|命令|专业|沉稳)/.test(text) || /\b(serious|professional|formal|authoritative)\b/.test(normalized))) add('serious');

  return tags.length > 0 ? tags : ['natural'];
};

const extractBatchVoiceTags = (text: string) => {
  const explicitTags = [
    ...Array.from(text.matchAll(/\[([^\]\r\n]{1,48})\]/g), match => match[1].trim()),
    ...Array.from(text.matchAll(/【([^】\r\n]{1,48})】/g), match => match[1].trim()),
  ].map(normalizeBatchVoiceTag).filter(Boolean);
  return explicitTags.length > 0 ? explicitTags : inferBatchVoiceTags(text);
};

const normalizeBatchVoiceTagList = (tags: string[]) => Array.from(new Set(
  tags
    .flatMap(tag => String(tag || '').split(/[,，、/\s]+/))
    .map(normalizeBatchVoiceTag)
    .filter(Boolean),
)).slice(0, 5);

const getBatchVoiceFallbackName = (text: string, index: number) => {
  const cleanText = stripBatchVoiceTags(text).replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ' ').trim();
  const chinese = cleanText.match(/[\u4e00-\u9fff]/g);
  if (chinese && chinese.length > 0) {
    return chinese.slice(0, 5).join('');
  }
  const words = cleanText.split(/\s+/).filter(Boolean).slice(0, 4).join('_');
  return words || `voice_${String(index + 1).padStart(2, '0')}`;
};

const isLikelyBatchVoiceNameCell = (value: string) => {
  const text = value.trim();
  if (!text || text.length > 32) return false;
  if (/^(文件名|命名|名称|name|filename)$/i.test(text)) return true;
  if (/^(角色|旁白|对白|台词|配音|女声|男声|主角|npc|vo|voice|line|speaker|role)[\s_-]*[\w\u4e00-\u9fff-]{0,20}\d{0,4}$/i.test(text)) return true;
  if (/^[a-z]+[\w-]*[_-]\d{1,4}$/i.test(text)) return true;
  if (/^[\u4e00-\u9fff]{1,8}[_-]\d{1,4}$/u.test(text)) return true;
  if (/^[\u4e00-\u9fff]{1,6}\d{1,4}$/u.test(text)) return true;
  return false;
};

const splitDelimitedBatchLine = (line: string) => {
  if (line.includes('\t')) {
    return line.split('\t').map(part => part.trim()).filter(Boolean);
  }
  const csvParts = line.match(/("([^"]|"")*"|[^,，]+)(?=,|，|$)/g)?.map(part => (
    part.replace(/^"|"$/g, '').replace(/""/g, '"').trim()
  )).filter(Boolean) || [];
  return csvParts.length >= 2 && isLikelyBatchVoiceNameCell(csvParts[0]) ? csvParts : [];
};

const parseBatchVoiceLine = (line: string, index: number): BatchVoiceRequirement | null => {
  const cleanedLine = line.replace(/^\s*[-*•]\s+/, '').trim();
  if (!cleanedLine || /^#+\s/.test(cleanedLine)) return null;

  let name = '';
  let text = cleanedLine;
  let note = '';

  const labelledMatch = cleanedLine.match(/(?:文件名|命名|名称|name|filename)\s*[:：]\s*([^|｜\n]+?)(?:\s*[|｜,，]\s*)?(?:台词|文案|内容|text|line|script)\s*[:：]\s*(.+)$/i);
  if (labelledMatch) {
    name = labelledMatch[1].trim();
    text = labelledMatch[2].trim();
    note = '按“文件名/台词”标签识别';
  } else {
    const delimited = splitDelimitedBatchLine(cleanedLine);
    if (delimited.length >= 2 && delimited[0].length <= 48) {
      name = delimited[0];
      text = delimited.slice(1).join(' ').trim();
      note = '按表格列识别';
    } else {
      const colonMatch = cleanedLine.match(/^(.{1,48}?)[：:]\s*(.+)$/);
      if (colonMatch && colonMatch[2].trim().length >= 2) {
        name = colonMatch[1].replace(/^(第?\d+[\.、\)]?\s*)/, '').trim();
        text = colonMatch[2].trim();
        note = '按冒号前后识别';
      }
    }
  }

  const textBeforeIndexStrip = text.trim();
  text = stripBatchVoiceLeadingIndex(textBeforeIndexStrip);
  if (text !== textBeforeIndexStrip) {
    note = note ? `${note} · 已去除序号` : '已去除序号';
  }

  if (!text || text.length < 2) return null;
  const emotionTags = extractBatchVoiceTags(text).join(', ');
  const fallbackName = getBatchVoiceFallbackName(text, index);

  return {
    id: `batch-voice-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    enabled: true,
    name: sanitizeBatchVoiceFileName(name || fallbackName),
    nameSource: name ? 'detected' : 'fallback',
    text,
    emotionTags,
    note: note || (name ? '已识别命名' : '未检测到命名，使用台词前几字'),
    sourceLine: cleanedLine,
    status: 'pending',
  };
};

const parseBatchVoiceRequirementsFromText = (rawText: string) => {
  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u00a0/g, ' ');

  const lines = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^(文件名|命名|名称|name|filename)[\t,，]/i.test(line));

  const parsed = lines
    .map((line, index) => parseBatchVoiceLine(line, index))
    .filter(Boolean) as BatchVoiceRequirement[];

  const seenNames = new Map<string, number>();
  return parsed.map((item, index) => {
    const baseName = stripBatchVoiceNameIndexPrefix(item.name || getBatchVoiceFallbackName(item.text, index));
    const count = seenNames.get(baseName) || 0;
    seenNames.set(baseName, count + 1);
    return {
      ...item,
      name: count > 0 ? `${baseName}_${count + 1}` : baseName,
    };
  });
};

const getXlsxColumnIndex = (cellRef: string) => {
  const letters = (cellRef.match(/[A-Z]+/i)?.[0] || '').toUpperCase();
  return letters.split('').reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

const readXlsxVoiceRequirementText = async (file: File) => {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(file);
  const parser = new DOMParser();
  const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const sharedStrings = sharedStringsXml
    ? Array.from(parser.parseFromString(sharedStringsXml, 'application/xml').getElementsByTagName('si')).map(item => (
      Array.from(item.getElementsByTagName('t')).map(node => node.textContent || '').join('')
    ))
    : [];
  const sheetFiles = Object.keys(zip.files)
    .filter(path => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const rows: string[] = [];
  for (const sheetPath of sheetFiles) {
    const sheetXml = await zip.file(sheetPath)?.async('string');
    if (!sheetXml) continue;
    const sheetDoc = parser.parseFromString(sheetXml, 'application/xml');
    Array.from(sheetDoc.getElementsByTagName('row')).forEach(row => {
      const cells: string[] = [];
      Array.from(row.getElementsByTagName('c')).forEach(cell => {
        const ref = cell.getAttribute('r') || '';
        const columnIndex = Math.max(0, getXlsxColumnIndex(ref));
        const type = cell.getAttribute('t');
        const valueNode = cell.getElementsByTagName('v')[0];
        const inlineTextNode = cell.getElementsByTagName('t')[0];
        const rawValue = valueNode?.textContent || inlineTextNode?.textContent || '';
        const cellText = type === 's' ? sharedStrings[Number(rawValue)] || '' : rawValue;
        cells[columnIndex] = cellText.trim();
      });
      const usefulCells = cells.map(cell => cell || '').filter(Boolean);
      if (usefulCells.length > 0) {
        rows.push(cells.join('\t').replace(/\t+$/g, ''));
      }
    });
  }

  if (rows.length === 0) {
    throw new Error('没有在 xlsx 表格中读取到可用文字。');
  }
  return rows.join('\n');
};

const readBatchVoiceFileText = async (file: File) => {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.docx')) {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(file);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) {
      throw new Error('没有在 docx 中读取到正文内容。');
    }
    const xmlDoc = new DOMParser().parseFromString(documentXml, 'application/xml');
    return Array.from(xmlDoc.getElementsByTagName('w:p')).map(paragraph => (
      Array.from(paragraph.getElementsByTagName('w:t')).map(node => node.textContent || '').join('')
    )).filter(Boolean).join('\n');
  }

  if (lowerName.endsWith('.xlsx')) {
    return readXlsxVoiceRequirementText(file);
  }

  if (lowerName.endsWith('.xls')) {
    throw new Error('暂不支持旧版 .xls 二进制表格，请先另存为 .xlsx 或 CSV 后再拖拽上传。');
  }

  if (/(\.txt|\.md|\.csv|\.tsv|\.json|\.html?)$/i.test(lowerName) || file.type.startsWith('text/')) {
    return file.text();
  }

  if (file.type.startsWith('image/') || lowerName.endsWith('.pdf')) {
    throw new Error('这个文件需要 OCR/视觉解析。当前先支持 txt、md、csv、tsv、json、html、docx、xlsx；图片或 PDF 可以先把 OCR 文字粘贴到下方文本框。');
  }

  return file.text();
};

const buildBatchVoiceGenerationText = (item: BatchVoiceRequirement) => {
  const tags = normalizeBatchVoiceTagList(item.emotionTags.split(/[,，、/\s]+/));
  const spokenText = stripBatchVoiceLeadingIndex(stripBatchVoiceTags(item.text));
  return `${tags.map(tag => `[${tag}]`).join('')} ${spokenText}`.trim();
};

const downloadBlobFile = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function DubbingStudio({
  standaloneVoicePrompt,
  setStandaloneVoicePrompt,
  standaloneVoiceGender,
  setStandaloneVoiceGender,
  standaloneVoiceRole,
  setStandaloneVoiceRole,
  setSelectedStandaloneVoice,
  standaloneVoiceLang,
  setStandaloneVoiceLang,
  standaloneVoiceSpeed,
  setStandaloneVoiceSpeed,
  standaloneVoiceLoading,
  standaloneVoiceAudioUrl,
  setStandaloneVoiceAudioUrl,
  standaloneVoiceError,
  standaloneVoiceAudioRef,
  handleStandaloneVoiceGenerate,
  historyList,
  setHistoryList,
  pendingVoiceOptions,
  setPendingVoiceOptions,
  assistantVoiceRequest
}: DubbingStudioProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingHistoryId, setPlayingHistoryId] = useState<string | null>(null);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [fetchedVoices, setFetchedVoices] = useState<VoiceItem[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [activeGeneratedVoiceId, setActiveGeneratedVoiceId] = useState<string | null>(null);
  const [v3Enhancement, setV3Enhancement] = useState<{
    originalText: string;
    enhancedText: string;
    addedTags: string[];
    notes: string;
  } | null>(null);
  const [v3EnhancementLoading, setV3EnhancementLoading] = useState(false);
  const [v3EnhancementError, setV3EnhancementError] = useState<string | null>(null);

  // Active sub-tab state ('tts' = Text-to-Speech, 'sts' = Speech-to-Speech, 'convert' = Voice Conversion, 'stt' = Speech-to-Text)
  const [activeSubTab, setActiveSubTab] = useState<'tts' | 'sts' | 'convert' | 'translate' | 'stt'>(() => (
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tool') === 'voice-conversion'
      ? 'convert'
      : 'tts'
  ));
  const [visitedSubTabs, setVisitedSubTabs] = useState<Set<'tts' | 'sts' | 'convert' | 'translate' | 'stt'>>(() => new Set(
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tool') === 'voice-conversion'
      ? ['convert']
      : ['tts'],
  ));
  const [ttsInputMode, setTtsInputMode] = useState<'single' | 'batch'>('single');
  const [subNavWidth, setSubNavWidth] = useState(() => {
    if (typeof window === 'undefined') return DUBBING_SUBNAV_DEFAULT_WIDTH;
    const hasInitializedWidth = window.localStorage.getItem(DUBBING_SUBNAV_WIDTH_READY_KEY) === '1';
    const saved = Number(window.localStorage.getItem('ai-audio-dubbing-subnav-width'));
    return hasInitializedWidth && Number.isFinite(saved)
      ? Math.max(DUBBING_SUBNAV_MIN_WIDTH, Math.min(DUBBING_SUBNAV_MAX_WIDTH, saved))
      : DUBBING_SUBNAV_DEFAULT_WIDTH;
  });
  const [isResizingSubNav, setIsResizingSubNav] = useState(false);
  const isSubNavCompact = subNavWidth < DUBBING_SUBNAV_COMPACT_WIDTH;

  // STS File Upload & Playing States
  const [stsFile, setStsFile] = useState<File | null>(null);
  const [stsFileUrl, setStsFileUrl] = useState<string | null>(null);
  const [stsDragActive, setStsDragActive] = useState(false);
  const stsInputRef = useRef<HTMLInputElement | null>(null);
  const [stsInputIsPlaying, setStsInputIsPlaying] = useState(false);
  const stsInputAudioRef = useRef<HTMLAudioElement | null>(null);

  // STS Voice Selection States
  const [stsVoiceRole, setStsVoiceRole] = useState('');
  const [stsVoiceGender, setStsVoiceGender] = useState<'male' | 'female'>('male');
  const [stsVoiceSearchQuery, setStsVoiceSearchQuery] = useState('');
  const [stsVoiceActiveCategory, setStsVoiceActiveCategory] = useState('全部');
  const [stsVoiceGenderFilter, setStsVoiceGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [stsShowVoiceDropdown, setStsShowVoiceDropdown] = useState(false);

  // STS Conversion API & Playing States
  const [stsLoading, setStsLoading] = useState(false);
  const [stsAudioUrl, setStsAudioUrl] = useState<string | null>(null);
  const [stsError, setStsError] = useState<string | null>(null);
  const [stsIsPlaying, setStsIsPlaying] = useState(false);
  const stsAudioRef = useRef<HTMLAudioElement | null>(null);
  const subNavResizeStartRef = useRef({ width: DUBBING_SUBNAV_DEFAULT_WIDTH, x: 0 });

  useEffect(() => {
    if (!isResizingSubNav) return;

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = subNavResizeStartRef.current.width + event.clientX - subNavResizeStartRef.current.x;
      setSubNavWidth(Math.max(DUBBING_SUBNAV_MIN_WIDTH, Math.min(DUBBING_SUBNAV_MAX_WIDTH, nextWidth)));
    };

    const handleMouseUp = () => {
      setIsResizingSubNav(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSubNav]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('ai-audio-dubbing-subnav-width', String(subNavWidth));
    window.localStorage.setItem(DUBBING_SUBNAV_WIDTH_READY_KEY, '1');
  }, [subNavWidth]);

  useEffect(() => {
    setVisitedSubTabs(prev => {
      if (prev.has(activeSubTab)) return prev;
      const next = new Set(prev);
      next.add(activeSubTab);
      return next;
    });
  }, [activeSubTab]);

  useEffect(() => {
    if (!assistantVoiceRequest?.id) return;
    setActiveSubTab(assistantVoiceRequest.mode || 'tts');
    if ((assistantVoiceRequest.mode || 'tts') === 'tts') {
      const nextInputMode = assistantVoiceRequest.inputMode || 'single';
      setTtsInputMode(nextInputMode);
      if (nextInputMode === 'batch' && assistantVoiceRequest.text.trim()) {
        setBatchVoiceRawText(assistantVoiceRequest.text);
      }
    }
  }, [assistantVoiceRequest?.id, assistantVoiceRequest?.mode]);

  useEffect(() => {
    return () => {
      if (stsFileUrl) {
        URL.revokeObjectURL(stsFileUrl);
      }
      if (stsAudioUrl) {
        URL.revokeObjectURL(stsAudioUrl);
      }
    };
  }, []);

  const handleStsDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setStsDragActive(true);
    } else if (e.type === "dragleave") {
      setStsDragActive(false);
    }
  };

  const handleStsDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setStsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleStsFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleStsFileChange = (file: File) => {
    if (stsFileUrl) {
      URL.revokeObjectURL(stsFileUrl);
    }
    setStsFile(file);
    setStsFileUrl(URL.createObjectURL(file));
    setStsInputIsPlaying(false);
    setStsAudioUrl(null); // Reset converted url when new file uploaded
  };

  const toggleStsInputPlay = () => {
    if (stsInputAudioRef.current) {
      if (stsInputIsPlaying) {
        stsInputAudioRef.current.pause();
        setStsInputIsPlaying(false);
      } else {
        // Pause other active playbacks to keep audio environment clean
        if (stsAudioRef.current) {
          stsAudioRef.current.pause();
          setStsIsPlaying(false);
        }
        if (standaloneVoiceAudioRef.current) {
          standaloneVoiceAudioRef.current.pause();
          setIsPlaying(false);
        }
        stsInputAudioRef.current.play().catch(err => console.error(err));
        setStsInputIsPlaying(true);
      }
    }
  };

  const handleStsGenerate = async () => {
    if (!stsFile) {
      setStsError('请先上传需要变声的源音频文件');
      return;
    }
    if (!stsVoiceRole) {
      setStsError('当前配音库暂无可用声线，请先在 ElevenLabs 添加或恢复声线');
      return;
    }

    setStsLoading(true);
    setStsError(null);
    try {
      const blob = await generateSpeechToSpeech(stsFile, stsVoiceRole);
      const url = URL.createObjectURL(blob);
      setStsAudioUrl(url);

      const matchedVoice = displayVoices.find(v => v.id === stsVoiceRole);
      const voiceLabel = matchedVoice ? matchedVoice.name : '自定义声线';
      
      const newHistoryItem: HistoryItem = {
        id: `sts-${Date.now()}`,
        type: 'voice',
        title: `语音变声 - ${voiceLabel}`,
        prompt: `源音频：${stsFile.name} → 变声目标：${voiceLabel}`,
        url: url,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
        details: `${(stsFile.size / 1024 / 1024).toFixed(2)}MB · ${stsVoiceGender === 'male' ? '男声' : '女声'}`,
        speed: 1.0
      };
      setHistoryList(prev => [newHistoryItem, ...prev]);

      // Auto play the converted audio to give instant feedback
      setTimeout(() => {
        if (stsAudioRef.current) {
          stsAudioRef.current.src = url;
          stsAudioRef.current.play().catch(e => console.error(e));
          setStsIsPlaying(true);
        }
      }, 150);
    } catch (err: any) {
      setStsError(err.message || '语音变声生成失败，请重试');
    } finally {
      setStsLoading(false);
    }
  };

  // Voice selection states
  const [voiceSmartSearchInput, setVoiceSmartSearchInput] = useState('');
  const [voiceSearchQuery, setVoiceSearchQuery] = useState('');
  const [voiceSearchManuallyEdited, setVoiceSearchManuallyEdited] = useState(false);
  const [voiceActiveCategory, setVoiceActiveCategory] = useState('全部');
  const [voiceGenderFilter, setVoiceGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  const [batchVoiceRawText, setBatchVoiceRawText] = useState('');
  const [batchVoiceItems, setBatchVoiceItems] = useState<BatchVoiceRequirement[]>([]);
  const [batchVoiceFileName, setBatchVoiceFileName] = useState('');
  const [batchVoiceStatus, setBatchVoiceStatus] = useState('');
  const [batchVoiceError, setBatchVoiceError] = useState<string | null>(null);
  const [batchVoiceLoading, setBatchVoiceLoading] = useState(false);
  const [batchVoiceToneLoading, setBatchVoiceToneLoading] = useState(false);
  const [batchVoiceDragActive, setBatchVoiceDragActive] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Highlighting and scroll-sync refs
  const highlightRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleScroll = () => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const renderHighlightedText = (text: string) => {
    if (!text) {
      return (
        <span className="text-slate-400 leading-normal block">
          在此输入要配音的文本，在台词中使用中括号标注情绪，例如 <span className="text-emerald-600 font-bold rounded-sm shadow-[inset_0_-0.7em_0_rgba(16,185,129,0.14)]">[激动地]</span> 我们终于抵达了这颗被称为蔚蓝家园的星球...
        </span>
      );
    }

    // Split by bracket expressions like [excited] or [开心地]
    const parts = text.split(/(\[[^\]]+\])/g);
    return parts.map((part, index) => {
      if (part.startsWith("[") && part.endsWith("]")) {
        return (
          <span 
            key={index} 
            className="text-emerald-600 font-bold rounded-sm shadow-[inset_0_-0.7em_0_rgba(16,185,129,0.16)]"
          >
            {part}
          </span>
        );
      }
      return <React.Fragment key={index}>{part}</React.Fragment>;
    });
  };

  const shouldHideDubbingVoice = (voice: VoiceItem) => {
    const category = String(voice.category || '').toLowerCase();
    const tags = (voice.tags || []).map(tag => String(tag).toLowerCase());
    const searchable = [category, ...tags].join(' ');
    return (
      searchable.includes('premade') ||
      searchable.includes('default') ||
      searchable.includes('legacy')
    );
  };

  const loadVoices = async () => {
    setIsLoadingVoices(true);
    try {
      const apiVoices = await fetchAvailableVoices();
      if (apiVoices && apiVoices.length > 0) {
        // Keep high-quality ElevenLabs Voice Library voices and the user's own non-default voices.
        // Premade/default voices are intentionally excluded because they were removed from the product library.
        const filteredApiVoices = apiVoices.filter(av =>
          av.source === 'voice_library' ||
          ['professional', 'cloned', 'generated'].includes(av.category)
        );

        // Map API voices to our VoiceItem structure
        const mapped: VoiceItem[] = filteredApiVoices.map(av => {
          // Check if we already have detailed metadata for this voice in ELEVENLABS_VOICES
          const existing = ELEVENLABS_VOICES.find(ev => ev.id === av.voice_id);
          if (existing) {
            return existing;
          }
          
          // Otherwise, construct a nice dynamic VoiceItem
          const genderLabel = (av.labels?.gender || '').toLowerCase();
          let isMale = false;
          if (genderLabel) {
            if (genderLabel.includes('female')) {
              isMale = false;
            } else if (genderLabel.includes('male')) {
              isMale = true;
            }
          } else {
            // Check name with word boundary to avoid partial matching (e.g. Samantha matching "sam", or Georgia matching "george")
            isMale = /\b(adam|arnold|josh|clyde|antoni|sam|drew|paul|george|thomas|michael|marcus|ethan|henry)\b/i.test(av.name);
          }
          const category = av.source === 'voice_library'
            ? 'ElevenLabs 人声库'
            : (av.category === 'cloned' || av.category === 'professional' || av.category === 'generated')
              ? '我的克隆'
              : '自定义声线';
          const tags = [
            ...Object.values(av.labels || {}).filter(Boolean),
            av.source === 'voice_library' ? 'Voice Library' : '',
            'v3',
          ].filter(Boolean) as string[];
          
          return {
            id: av.voice_id,
            name: av.name,
            englishName: av.name,
            gender: isMale ? 'male' as const : 'female' as const,
            category: category,
            tags,
            description: av.labels?.description || `ElevenLabs ${category} · 已适配 eleven_v3`,
            previewUrl: av.preview_url || '',
            source: av.source,
            publicOwnerId: av.public_owner_id,
          };
        });
        setFetchedVoices(mapped.filter(voice => !shouldHideDubbingVoice(voice)));
      } else {
        setFetchedVoices([]);
      }
    } catch (err) {
      console.error("Failed to load voices from ElevenLabs:", err);
    } finally {
      setIsLoadingVoices(false);
    }
  };

  // Load voices on mount
  useEffect(() => {
    loadVoices();
  }, []);

  // Re-fetch voices when the dropdown is opened to ensure up-to-date custom/cloned voices
  useEffect(() => {
    if (showVoiceDropdown) {
      loadVoices();
    }
  }, [showVoiceDropdown]);

  // Compute final voices list to display (merge pre-made voices with user's fetched custom voices, filtering duplicates)
  const displayVoices = (
    fetchedVoices.length > 0
      ? [...ELEVENLABS_VOICES, ...fetchedVoices.filter(fv => !ELEVENLABS_VOICES.some(ev => ev.id === fv.id))]
      : ELEVENLABS_VOICES
  ).filter(voice => !shouldHideDubbingVoice(voice));
  const voiceCategories = ['全部', ...Array.from(new Set(displayVoices.map(voice => voice.category).filter(Boolean)))];
  const normalizedVoiceSearchQuery = normalizeVoiceSearchText(voiceSearchQuery);
  const convertedSmartVoiceSearchQuery = buildSmartVoiceSearchQuery(voiceSmartSearchInput);
  const filteredVoiceOptions = displayVoices
    .map(voice => ({ voice, score: getVoiceSearchScore(voice, voiceSearchQuery) }))
    .filter(({ voice, score }) => {
    if (voiceActiveCategory !== '全部' && voice.category !== voiceActiveCategory) return false;
    if (voiceGenderFilter !== 'all' && voice.gender !== voiceGenderFilter) return false;
    if (!normalizedVoiceSearchQuery) return true;
    return score > 0;
  })
    .sort((left, right) => right.score - left.score || left.voice.name.localeCompare(right.voice.name, 'zh-CN'))
    .map(({ voice }) => voice);

  // Derived state to check if current standaloneVoiceRole is an ElevenLabs Premium Voice ID
  const isPremiumVoiceSelected = displayVoices.some(v => v.id === standaloneVoiceRole);
  const voiceMode = 'premium';

  // Ensure standaloneVoiceRole is always set to a valid premium voice ID
  useEffect(() => {
    if (standaloneVoiceRole && !displayVoices.some(v => v.id === standaloneVoiceRole)) {
      if (displayVoices.length > 0) {
        setStandaloneVoiceRole(displayVoices[0].id);
        setSelectedStandaloneVoice?.(displayVoices[0]);
        setStandaloneVoiceGender(displayVoices[0].gender);
      } else {
        setStandaloneVoiceRole('');
        setSelectedStandaloneVoice?.(null);
        setStandaloneVoiceGender('male');
      }
    }
  }, [standaloneVoiceRole, displayVoices]);

  // Sync / Stop preview audio on unmount or tab change
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const playWebSpeechFallback = (voiceName: string, gender: 'male' | 'female', category: string, tags: string[]) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setPlayingVoiceId(null);
      return;
    }
    
    try {
      window.speechSynthesis.cancel();
      
      const text = `你好！我是 AI 配音助理 ${voiceName}。这是我为您准备的专属声线。我擅长 ${tags.join('、')}等不同风格的拟真配音，期待能为您生成完美的音频。`;
      const utterance = new SpeechSynthesisUtterance(text);
      const nativeVoices = window.speechSynthesis.getVoices();
      let chineseVoices = nativeVoices.filter(v => v.lang.includes('zh') || v.lang.includes('ZH'));
      if (chineseVoices.length === 0) {
        chineseVoices = nativeVoices;
      }
      
      let selectedNativeVoice = null;
      if (gender === 'female') {
        selectedNativeVoice = chineseVoices.find(v => 
          v.name.includes('Xiaoxiao') || 
          v.name.includes('Tingting') || 
          v.name.includes('female') || 
          v.name.includes('Female') ||
          v.name.includes('Huihui') ||
          v.name.includes('Yaoyao') ||
          v.name.includes('Meijia')
        ) || chineseVoices[0];
      } else {
        selectedNativeVoice = chineseVoices.find(v => 
          v.name.includes('Yunxi') || 
          v.name.includes('Kangkang') || 
          v.name.includes('male') || 
          v.name.includes('Male') ||
          v.name.includes('Zhiwei')
        ) || chineseVoices[0];
      }
      
      if (selectedNativeVoice) {
        utterance.voice = selectedNativeVoice;
      }
      
      utterance.rate = 1.0;
      utterance.pitch = gender === 'female' ? 1.15 : 0.9;
      
      utterance.onend = () => {
        setPlayingVoiceId(null);
      };
      
      utterance.onerror = () => {
        setPlayingVoiceId(null);
      };
      
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error("Speech synthesis fallback failed:", err);
      setPlayingVoiceId(null);
    }
  };

  const handlePlayVoicePreview = (voiceId: string, url: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid triggering dropdown selection when listening
    
    // Pause main playback if playing
    if (standaloneVoiceAudioRef.current) {
      standaloneVoiceAudioRef.current.pause();
      setIsPlaying(false);
    }

    if (playingVoiceId === voiceId) {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setPlayingVoiceId(null);
    } else {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      
      setPlayingVoiceId(voiceId);

      // If no preview URL is available, trigger Speech Synthesis fallback immediately
      if (!url) {
        console.warn("No preview URL provided. Running local synthesis fallback...");
        const voiceObj = displayVoices.find(v => v.id === voiceId);
        if (voiceObj) {
          playWebSpeechFallback(voiceObj.name, voiceObj.gender, voiceObj.category, voiceObj.tags);
        } else {
          setPlayingVoiceId(null);
        }
        return;
      }
      
      const audio = new Audio(url);
      let fallbackTriggered = false;

      const triggerFallback = () => {
        if (fallbackTriggered) return;
        fallbackTriggered = true;
        const voiceObj = displayVoices.find(v => v.id === voiceId);
        if (voiceObj) {
          playWebSpeechFallback(voiceObj.name, voiceObj.gender, voiceObj.category, voiceObj.tags);
        } else {
          setPlayingVoiceId(null);
        }
      };

      audio.onerror = () => {
        console.warn(`Audio error event fired for URL: ${url}. Triggering fallback...`);
        triggerFallback();
      };

      audio.onended = () => {
        if (!fallbackTriggered) {
          setPlayingVoiceId(null);
        }
      };

      previewAudioRef.current = audio;
      
      audio.play().catch(err => {
        console.warn("Audio element play rejected. Triggering fallback...", err);
        triggerFallback();
      });
    }
  };

  const handleSelectVoice = (voice: VoiceItem) => {
    setStandaloneVoiceRole(voice.id);
    setSelectedStandaloneVoice?.(voice);
    setStandaloneVoiceGender(voice.gender);
    setShowVoiceDropdown(false);
  };
  
  const historyAudioRefs = useRef<{ [key: string]: HTMLAudioElement | null }>({});

  // Sync playback speed rate on preview audio player
  useEffect(() => {
    if (standaloneVoiceAudioRef.current) {
      standaloneVoiceAudioRef.current.playbackRate = standaloneVoiceSpeed;
    }
  }, [standaloneVoiceSpeed, standaloneVoiceAudioUrl]);

  const toggleMainPlay = () => {
    if (standaloneVoiceAudioRef.current) {
      if (isPlaying) {
        standaloneVoiceAudioRef.current.pause();
        setIsPlaying(false);
      } else {
        if (playingHistoryId && historyAudioRefs.current[playingHistoryId]) {
          historyAudioRefs.current[playingHistoryId]?.pause();
          setPlayingHistoryId(null);
        }
        standaloneVoiceAudioRef.current.play().catch(e => console.error(e));
        setIsPlaying(true);
      }
    }
  };

  const handleHistoryPlayPause = (id: string) => {
    if (isPlaying && standaloneVoiceAudioRef.current) {
      standaloneVoiceAudioRef.current.pause();
      setIsPlaying(false);
    }
    if (stsInputIsPlaying && stsInputAudioRef.current) {
      stsInputAudioRef.current.pause();
      setStsInputIsPlaying(false);
    }
    if (stsIsPlaying && stsAudioRef.current) {
      stsAudioRef.current.pause();
      setStsIsPlaying(false);
    }

    if (playingHistoryId && playingHistoryId !== id && historyAudioRefs.current[playingHistoryId]) {
      historyAudioRefs.current[playingHistoryId]?.pause();
    }

    const audioObj = historyAudioRefs.current[id];
    if (audioObj) {
      if (playingHistoryId === id) {
        audioObj.pause();
        setPlayingHistoryId(null);
      } else {
        const histItem = historyList.find(item => item.id === id);
        audioObj.playbackRate = histItem?.speed || 1.0;
        audioObj.play().catch(e => console.error(e));
        setPlayingHistoryId(id);
      }
    }
  };

  const handleSaveRename = (id: string) => {
    if (!editingTitle.trim()) return;
    setHistoryList(prev => prev.map(item => item.id === id ? { ...item, title: editingTitle.trim() } : item));
    setEditingHistoryId(null);
  };

  const langsList = [
    { id: 'zh', name: '中文 普通话 (Chinese)' },
    { id: 'en', name: '英语 美式/英式 (English)' },
    { id: 'ja', name: '日语 (Japanese)' },
    { id: 'ko', name: '韩语 (Korean)' },
    { id: 'ar', name: '阿拉伯语 (Arabic)' },
    { id: 'fr', name: '法语 (French)' },
    { id: 'de', name: '德语 (German)' },
    { id: 'es', name: '西班牙语 (Spanish)' },
  ];

  const detectLanguage = (text: string): string | null => {
    if (!text.trim()) return null;
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
      return 'ja';
    }
    if (/[\u4e00-\u9fa5]/.test(text)) {
      return 'zh';
    }
    if (/[盲枚眉脽脛脰脺]/.test(text)) {
      return 'de';
    }
    if (/[茅脿猫霉莽芒锚卯么没毛茂眉脣脧脺脗脢脦脭脹脡脌脠脵脟]/.test(text)) {
      return 'fr';
    }
    if (/[a-zA-Z]/.test(text)) {
      return 'en';
    }
    return null;
  };

  const handleTextChange = (val: string) => {
    setStandaloneVoicePrompt(val);
    if (v3Enhancement && val !== v3Enhancement.enhancedText) {
      setV3Enhancement(null);
      setV3EnhancementError(null);
    }
    const detected = detectLanguage(val);
    if (detected) {
      setStandaloneVoiceLang(detected);
    }
  };

  const detectedLangCode = detectLanguage(standaloneVoicePrompt);
  const detectedLangObj = langsList.find(l => l.id === detectedLangCode);

  const voiceHistory = historyList.filter(item => item.type === 'voice');
  const selectedVoiceObj = displayVoices.find(v => v.id === standaloneVoiceRole);
  const canRestoreV3Original = Boolean(v3Enhancement?.originalText && standaloneVoicePrompt === v3Enhancement.enhancedText);
  const generatedVoiceOptions = [
    pendingVoiceOptions.optionA ? { id: 'A' as const, label: '版本 A', option: pendingVoiceOptions.optionA } : null,
    pendingVoiceOptions.optionB ? { id: 'B' as const, label: '版本 B', option: pendingVoiceOptions.optionB } : null,
  ].filter(Boolean) as Array<{ id: 'A' | 'B'; label: string; option: PendingVoiceOption }>;
  const batchVoiceEnabledCount = batchVoiceItems.filter(item => item.enabled && item.text.trim()).length;
  const batchVoiceCompletedCount = batchVoiceItems.filter(item => item.enabled && item.status === 'done' && item.audioUrl).length;

  const applySmartVoiceSearch = (input: string) => {
    setVoiceSmartSearchInput(input);
    setVoiceSearchQuery(buildSmartVoiceSearchQuery(input));
    setVoiceSearchManuallyEdited(false);
    setShowVoiceDropdown(true);
  };

  useEffect(() => {
    if (!assistantVoiceRequest?.openVoiceLibrary) return;
    const search = assistantVoiceRequest.voiceSearchQuery?.trim() || (
      assistantVoiceRequest.gender === 'male' ? '男声' : '女声'
    );
    setVoiceSmartSearchInput(search);
    setVoiceSearchQuery(buildSmartVoiceSearchQuery(search));
    setVoiceSearchManuallyEdited(false);
    setShowVoiceDropdown(true);
    setVoiceGenderFilter(assistantVoiceRequest.gender);
  }, [assistantVoiceRequest?.id]);

  const handleManualVoiceSearchChange = (query: string) => {
    setVoiceSearchQuery(query);
    setVoiceSearchManuallyEdited(true);
  };

  const clearVoiceSearch = () => {
    setVoiceSmartSearchInput('');
    setVoiceSearchQuery('');
    setVoiceSearchManuallyEdited(false);
    setShowVoiceDropdown(true);
  };

  const updateBatchVoiceItem = (id: string, patch: Partial<BatchVoiceRequirement>) => {
    setBatchVoiceItems(prev => prev.map(item => (
      item.id === id ? { ...item, ...patch } : item
    )));
  };

  const handleParseBatchVoiceText = (text = batchVoiceRawText) => {
    const items = parseBatchVoiceRequirementsFromText(text);
    setBatchVoiceItems(items);
    setBatchVoiceError(items.length > 0 ? null : '没有识别到有效台词。可以按“文件名：台词”一行一条来整理后再分析。');
    setBatchVoiceStatus(items.length > 0 ? `已分析出 ${items.length} 条配音需求，请先检查预览。` : '');
  };

  const handleEnhanceBatchVoiceTags = async () => {
    const analyzableItems = batchVoiceItems.filter(item => item.text.trim());
    if (analyzableItems.length === 0) {
      setBatchVoiceError('请先分析或新增至少一条台词，再重析语气。');
      return;
    }

    setBatchVoiceToneLoading(true);
    setBatchVoiceError(null);
    setBatchVoiceStatus(`正在用 V3 方式重析 ${analyzableItems.length} 条语气标签...`);
    const updates: Array<{ id: string; emotionTags: string; note: string }> = [];

    try {
      for (let index = 0; index < analyzableItems.length; index += 1) {
        const item = analyzableItems[index];
        setBatchVoiceStatus(`正在重析语气 ${index + 1}/${analyzableItems.length}：${item.name || `第 ${index + 1} 条`}`);
        const result = await enhanceVoicePromptForElevenV3(stripBatchVoiceTags(item.text), {
          voiceName: selectedVoiceObj?.name || '',
          voiceDescription: selectedVoiceObj?.description || '',
          language: standaloneVoiceLang,
        });
        const tags = normalizeBatchVoiceTagList([
          ...extractBatchVoiceTags(item.text),
          ...(result.addedTags || []),
        ]);
        updates.push({
          id: item.id,
          emotionTags: (tags.length > 0 ? tags : ['natural']).join(', '),
          note: item.note.includes('V3语气') ? item.note : `${item.note} · V3语气`,
        });
      }

      setBatchVoiceItems(prev => prev.map(item => (
        updates.find(update => update.id === item.id)
          ? { ...item, ...updates.find(update => update.id === item.id)!, status: item.audioUrl ? 'pending' : item.status }
          : item
      )));
      setBatchVoiceStatus(`已按 V3 方式重析 ${updates.length} 条语气标签，可继续手动微调。`);
    } catch (error: any) {
      setBatchVoiceError(error?.message || 'V3 语气重析失败，请先手动调整语气标签。');
    } finally {
      setBatchVoiceToneLoading(false);
    }
  };

  const handleBatchVoiceFiles = async (files: File[]) => {
    const pickedFiles = files.filter(Boolean);
    if (pickedFiles.length === 0) return;
    setBatchVoiceFileName(pickedFiles.length === 1 ? pickedFiles[0].name : `${pickedFiles.length} 个文件`);
    setBatchVoiceError(null);
    setBatchVoiceStatus(pickedFiles.length === 1 ? '正在读取文档内容...' : `正在读取 ${pickedFiles.length} 个文档/表格...`);
    try {
      const results = await Promise.allSettled(pickedFiles.map(async (file) => ({
        file,
        text: await readBatchVoiceFileText(file),
      })));
      const readableTexts = results
        .filter((result): result is PromiseFulfilledResult<{ file: File; text: string }> => result.status === 'fulfilled')
        .map(result => result.value.text.trim())
        .filter(Boolean);
      const failedMessages = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason?.message || '读取失败');

      if (readableTexts.length === 0) {
        throw new Error(failedMessages[0] || '没有读取到可用文字，请换成 docx、xlsx、csv、txt 或直接粘贴内容。');
      }

      const text = readableTexts.join('\n\n');
      const items = parseBatchVoiceRequirementsFromText(text);
      setBatchVoiceRawText(text);
      setBatchVoiceItems(items);
      setBatchVoiceStatus(items.length > 0
        ? `已从 ${pickedFiles.length === 1 ? pickedFiles[0].name : `${pickedFiles.length} 个文件`} 分析出 ${items.length} 条配音需求，请先检查预览。`
        : `已读取 ${pickedFiles.length === 1 ? pickedFiles[0].name : `${pickedFiles.length} 个文件`}，但没有识别到有效台词。可以手动粘贴/整理文本后再分析。`);
      if (items.length === 0) {
        setBatchVoiceError('没有识别到有效台词。推荐一行一条，例如“角色_001：你好，欢迎回来。”');
      } else if (failedMessages.length > 0) {
        setBatchVoiceError(`${failedMessages.length} 个文件未读取：${failedMessages.join('；')}`);
      }
    } catch (error: any) {
      setBatchVoiceError(error?.message || '读取文档失败，请换成 txt/csv/xlsx/docx 或粘贴文本。');
      setBatchVoiceStatus('');
    }
  };

  const handleBatchVoiceDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setBatchVoiceDragActive(false);
    handleBatchVoiceFiles(Array.from(event.dataTransfer.files));
  };

  const addBatchVoiceItem = () => {
    setBatchVoiceItems(prev => [
      ...prev,
      {
        id: `batch-voice-manual-${Date.now()}`,
        enabled: true,
        name: `voice_${String(prev.length + 1).padStart(2, '0')}`,
        nameSource: 'manual',
        text: '',
        emotionTags: 'natural',
        note: '手动新增',
        sourceLine: '',
        status: 'pending',
      },
    ]);
  };

  const removeBatchVoiceItem = (id: string) => {
    setBatchVoiceItems(prev => prev.filter(item => item.id !== id));
  };

  const createBatchVoiceZip = async (items: BatchVoiceRequirement[]) => {
    const completedItems = items.filter(item => item.enabled && item.status === 'done' && item.audioUrl);
    if (completedItems.length === 0) {
      throw new Error('还没有可打包的配音音频。');
    }

    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const usedNames = new Map<string, number>();

    for (const item of completedItems) {
      const response = await fetch(item.audioUrl!);
      const blob = await response.blob();
      const itemIndex = items.findIndex(entry => entry.id === item.id);
      const itemOrderIndex = itemIndex >= 0 ? itemIndex : 0;
      const baseName = formatBatchVoiceFileName(item, itemOrderIndex);
      const count = usedNames.get(baseName) || 0;
      usedNames.set(baseName, count + 1);
      const finalName = `${baseName}${count > 0 ? `_${count + 1}` : ''}.mp3`;
      zip.file(finalName, blob, { binary: true });
    }

    const zipBlob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE' },
      (metadata) => setBatchVoiceStatus(`正在打包 ZIP ${Math.round(metadata.percent)}%...`),
    );
    const zipName = `batch_voice_${new Date().toISOString().slice(0, 10)}.zip`;
    downloadBlobFile(zipBlob, zipName);
    setBatchVoiceStatus(`已下载 ${zipName}，共 ${completedItems.length} 条。`);
  };

  const generateBatchVoiceItem = async (id: string) => {
    const item = batchVoiceItems.find(entry => entry.id === id);
    if (!item) return null;
    if (!item.text.trim()) {
      updateBatchVoiceItem(id, { status: 'error', error: '台词为空，无法生成。' });
      return null;
    }
    if (!standaloneVoiceRole) {
      updateBatchVoiceItem(id, { status: 'error', error: '请先选择一个配音声音。' });
      return null;
    }

    const selectedBatchVoice = selectedVoiceObj;
    const sharedVoiceOptions = selectedBatchVoice?.source === 'voice_library'
      ? {
          voiceSource: 'voice_library' as const,
          publicOwnerId: selectedBatchVoice.publicOwnerId,
          voiceName: selectedBatchVoice.name,
        }
      : {};
    const tags = item.emotionTags.toLowerCase();
    const isHighEnergy = /excited|happy|shouting|loud|urgent|angry|nervous|tense/.test(tags);
    const isSoft = /calm|gentle|soft|sad|whisper|warm|ceremonial/.test(tags);
    const generationText = buildBatchVoiceGenerationText(item);
    const fallbackText = stripBatchVoiceTags(item.text);

    updateBatchVoiceItem(id, { status: 'generating', error: undefined });
    try {
      const blob = await generateVoice(
        generationText,
        standaloneVoiceRole,
        isSoft ? 0.5 : 0.45,
        0.82,
        isHighEnergy ? 0.28 : isSoft ? 0.1 : 0.14,
        {
          qualityMode: getElevenLabsQualityMode(),
          fallbackText,
          seed: Date.now() % 1_000_000_000,
          ...sharedVoiceOptions,
        },
      );
      const url = URL.createObjectURL(blob);
      updateBatchVoiceItem(id, { status: 'done', audioUrl: url, error: undefined });
      const itemIndex = batchVoiceItems.findIndex(entry => entry.id === id);
      const indexedName = formatBatchVoiceFileName(item, itemIndex >= 0 ? itemIndex : 0);
      setHistoryList(prev => [{
        id: `batch-voice-${Date.now()}-${id}`,
        type: 'voice',
        title: indexedName,
        prompt: generationText,
        url,
        timestamp: new Date().toISOString(),
        details: `批量配音 · ${standaloneVoiceLang.toUpperCase()} · ${selectedBatchVoice?.name || standaloneVoiceRole}`,
        speed: standaloneVoiceSpeed,
      }, ...prev]);
      return { ...item, status: 'done' as const, audioUrl: url, error: undefined };
    } catch (error: any) {
      const message = error?.message || '生成失败，请稍后重试。';
      updateBatchVoiceItem(id, { status: 'error', error: message });
      return { ...item, status: 'error' as const, error: message };
    }
  };

  const handleGenerateBatchVoices = async () => {
    const enabledItems = batchVoiceItems.filter(item => item.enabled && item.text.trim());
    if (enabledItems.length === 0) {
      setBatchVoiceError('请先分析或新增至少一条需要生成的台词。');
      return;
    }
    if (!standaloneVoiceRole) {
      setBatchVoiceError('请先在上方声音库选择一个配音声音。');
      return;
    }

    setBatchVoiceLoading(true);
    setBatchVoiceError(null);
    setBatchVoiceStatus(`准备生成 ${enabledItems.length} 条配音...`);
    const generatedItems: BatchVoiceRequirement[] = [];
    try {
      for (let index = 0; index < enabledItems.length; index += 1) {
        const item = enabledItems[index];
        const itemOrderIndex = batchVoiceItems.findIndex(entry => entry.id === item.id);
        setBatchVoiceStatus(`正在生成 ${index + 1}/${enabledItems.length}：${formatBatchVoiceFileName(item, itemOrderIndex >= 0 ? itemOrderIndex : index)}`);
        const generated = await generateBatchVoiceItem(item.id);
        if (generated?.status === 'done') {
          generatedItems.push(generated);
        }
      }

      if (generatedItems.length > 0) {
        setBatchVoiceStatus(`已生成 ${generatedItems.length}/${enabledItems.length} 条配音，请先在预览中试听确认，确认后再下载 ZIP。`);
      } else {
        setBatchVoiceError('本次没有成功生成的配音，请查看每条错误后重试。');
        setBatchVoiceStatus('');
      }
    } catch (error: any) {
      setBatchVoiceError(error?.message || '批量生成失败。');
    } finally {
      setBatchVoiceLoading(false);
    }
  };

  const handleV3EnhancePrompt = async () => {
    const originalText = standaloneVoicePrompt.trim();
    if (!originalText) {
      setV3EnhancementError('请先输入要增强的配音台词。');
      return;
    }

    setV3EnhancementLoading(true);
    setV3EnhancementError(null);
    try {
      const result = await enhanceVoicePromptForElevenV3(originalText, {
        voiceName: selectedVoiceObj?.name || '',
        voiceDescription: selectedVoiceObj?.description || '',
        language: standaloneVoiceLang,
      });
      setV3Enhancement({
        originalText,
        enhancedText: result.enhancedText,
        addedTags: result.addedTags || [],
        notes: result.notes || '已生成 v3 语气增强文本。',
      });
      setStandaloneVoicePrompt(result.enhancedText);
    } catch (error: any) {
      setV3EnhancementError(error?.message || 'V3 增强失败，请稍后重试。');
    } finally {
      setV3EnhancementLoading(false);
    }
  };

  const handleRestoreV3Original = () => {
    if (!v3Enhancement?.originalText) return;
    setStandaloneVoicePrompt(v3Enhancement.originalText);
    setV3Enhancement(null);
    setV3EnhancementError(null);
  };

  const updateGeneratedVoiceName = (id: 'A' | 'B', name: string) => {
    const key = id === 'A' ? 'optionA' : 'optionB';
    const current = pendingVoiceOptions[key];
    setPendingVoiceOptions(prev => ({
      ...prev,
      [key]: prev[key] ? { ...prev[key], displayName: name } : prev[key],
    }));
    if (current?.url) {
      const normalizedName = name.trim() || current.displayName;
      setHistoryList(prev => prev.map(item => (
        item.url === current.url ? { ...item, title: normalizedName } : item
      )));
    }
  };

  useEffect(() => {
    if (selectedVoiceObj) {
      setSelectedStandaloneVoice?.(selectedVoiceObj);
    } else if (!standaloneVoiceRole) {
      setSelectedStandaloneVoice?.(null);
    }
  }, [selectedVoiceObj, standaloneVoiceRole, setSelectedStandaloneVoice]);

  return (
    <div id="dubbingstudio-view" className="flex-1 flex flex-col md:flex-row bg-slate-50 min-h-screen overflow-hidden">
      {/* Sub-navigation Sidebar */}
      <div
        className={`relative w-full md:w-[var(--dubbing-subnav-width)] bg-white border-b md:border-b-0 md:border-r border-slate-200 flex flex-col shrink-0 select-none ${
          isSubNavCompact ? 'p-2 md:p-3' : 'p-4 md:p-5'
        }`}
        style={{ '--dubbing-subnav-width': `${subNavWidth}px` } as React.CSSProperties}
      >
        <div className="space-y-1.5">
          <p className={`px-3 text-[10px] font-bold text-emerald-800/80 tracking-wider uppercase mb-2 ${isSubNavCompact ? 'hidden' : ''}`}>AI配音</p>
          
          {/* Subtab Button 1: 文本转语音 */}
          <button
            type="button"
            title="文本转语音"
            aria-label="文本转语音"
            onClick={() => {
              setActiveSubTab('tts');
            }}
            className={`w-full flex items-center overflow-hidden whitespace-nowrap rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
              isSubNavCompact ? 'justify-center gap-0 px-0 py-3' : 'gap-3 px-3 py-2.5'
            } ${
              activeSubTab === 'tts'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Mic className={`w-4 h-4 shrink-0 transition-colors ${activeSubTab === 'tts' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className={`shrink-0 whitespace-nowrap ${isSubNavCompact ? 'hidden' : ''}`}>文本转语音</span>
          </button>

          {/* Subtab Button 2: 语音转语音 */}
          <button
            type="button"
            title="语音转语音"
            aria-label="语音转语音"
            onClick={() => {
              setActiveSubTab('sts');
              if (standaloneVoiceAudioRef.current) standaloneVoiceAudioRef.current.pause();
              setIsPlaying(false);
            }}
            className={`w-full flex items-center overflow-hidden whitespace-nowrap rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
              isSubNavCompact ? 'justify-center gap-0 px-0 py-3' : 'gap-3 px-3 py-2.5'
            } ${
              activeSubTab === 'sts'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Volume2 className={`w-4 h-4 shrink-0 transition-colors ${activeSubTab === 'sts' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className={`shrink-0 whitespace-nowrap ${isSubNavCompact ? 'hidden' : ''}`}>语音转语音</span>
          </button>

          {/* Subtab Button 3: 声音克隆转换 */}
          <button
            type="button"
            title="声音克隆"
            aria-label="声音克隆"
            onClick={() => {
              setActiveSubTab('translate');
              if (standaloneVoiceAudioRef.current) standaloneVoiceAudioRef.current.pause();
              setIsPlaying(false);
            }}
            className={`w-full flex items-center overflow-hidden whitespace-nowrap rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
              isSubNavCompact ? 'justify-center gap-0 px-0 py-3' : 'gap-3 px-3 py-2.5'
            } ${
              activeSubTab === 'translate'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Languages className={`w-4 h-4 shrink-0 transition-colors ${activeSubTab === 'translate' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className={`shrink-0 whitespace-nowrap ${isSubNavCompact ? 'hidden' : ''}`}>声音克隆</span>
          </button>

          {/* Subtab Button 4: 声音转换 */}
          <button
            type="button"
            title="声音转换"
            aria-label="声音转换"
            onClick={() => {
              setActiveSubTab('convert');
              if (standaloneVoiceAudioRef.current) standaloneVoiceAudioRef.current.pause();
              setIsPlaying(false);
            }}
            className={`w-full flex items-center overflow-hidden whitespace-nowrap rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
              isSubNavCompact ? 'justify-center gap-0 px-0 py-3' : 'gap-3 px-3 py-2.5'
            } ${
              activeSubTab === 'convert'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <RefreshCw className={`w-4 h-4 shrink-0 transition-colors ${activeSubTab === 'convert' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className={`shrink-0 whitespace-nowrap ${isSubNavCompact ? 'hidden' : ''}`}>声音转换</span>
          </button>

          <button
            type="button"
            title="语音转文本"
            aria-label="语音转文本"
            onClick={() => {
              setActiveSubTab('stt');
              if (standaloneVoiceAudioRef.current) standaloneVoiceAudioRef.current.pause();
              setIsPlaying(false);
            }}
            className={`w-full flex items-center overflow-hidden whitespace-nowrap rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
              isSubNavCompact ? 'justify-center gap-0 px-0 py-3' : 'gap-3 px-3 py-2.5'
            } ${
              activeSubTab === 'stt'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <FileAudio className={`w-4 h-4 shrink-0 transition-colors ${activeSubTab === 'stt' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className={`shrink-0 whitespace-nowrap ${isSubNavCompact ? 'hidden' : ''}`}>语音转文本</span>
          </button>
        </div>
        <button
          type="button"
          aria-label="拖拽调整配音导航宽度"
          onMouseDown={(event) => {
            event.preventDefault();
            subNavResizeStartRef.current = { width: subNavWidth, x: event.clientX };
            setIsResizingSubNav(true);
          }}
          className="absolute right-[-4px] top-0 z-30 hidden h-full w-2 cursor-col-resize bg-transparent transition-colors hover:bg-emerald-400/25 md:block"
        >
          <span className="sr-only">调整配音导航宽度</span>
        </button>
      </div>

      {/* Main Workspace Panel */}
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        {visitedSubTabs.has('tts') && (
          <div hidden={activeSubTab !== 'tts'}>
            <div className="mb-4 border-b border-slate-200 pb-3">
              <nav
                className="mx-auto w-full max-w-4xl rounded-2xl border border-emerald-200 bg-emerald-50/60 p-2"
                aria-label="文本配音输入模式"
              >
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/80 p-1">
                {[
                  { value: 'single', label: '单文本' },
                  { value: 'batch', label: '多文本' },
                ].map(option => {
                  const isActive = ttsInputMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => setTtsInputMode(option.value as 'single' | 'batch')}
                      className={`flex h-10 min-w-0 items-center justify-center rounded-lg px-2 text-center text-[11px] font-black transition-colors ${
                        isActive
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
                </div>
              </nav>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Core parameters */}
              <div className="lg:col-span-7 space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
            {/* Dialogue textarea with dynamic bracket highlighting */}
            {ttsInputMode === 'single' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 block uppercase tracking-wider">配音台词 / 输入文本</label>
                {detectedLangObj && (
                  <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100 flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5 animate-pulse text-emerald-600" />
                    已智能检测语种：{detectedLangObj.name.split(' ')[0]}
                  </span>
                )}
              </div>
              
              <style>{`
                .sync-input-textarea {
                  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
                  font-size: 13px !important;
                  line-height: 1.625 !important;
                  padding: 16px !important;
                  margin: 0 !important;
                  border: 0 !important;
                  width: 100% !important;
                  height: 100% !important;
                  box-sizing: border-box !important;
                  letter-spacing: normal !important;
                  word-spacing: normal !important;
                  text-transform: none !important;
                  text-indent: 0px !important;
                  text-shadow: none !important;
                  text-align: start !important;
                }
                .sync-input-textarea::-webkit-scrollbar {
                  display: none !important;
                }
              `}</style>
              
              <div className="relative w-full h-32 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:ring-1 focus-within:ring-emerald-500 focus-within:border-emerald-500 transition-all shadow-inner">
                {/* Highlighted layer (behind) */}
                <div 
                  ref={highlightRef}
                  className="sync-input-textarea absolute inset-0 pointer-events-none select-none overflow-y-auto text-slate-800 whitespace-pre-wrap break-words"
                  style={{ msOverflowStyle: 'none', scrollbarWidth: 'none' }}
                >
                  {renderHighlightedText(standaloneVoicePrompt)}
                </div>
                
                {/* Actual textarea (foreground, transparent text but visible caret) */}
                <textarea
                  ref={textareaRef}
                  value={standaloneVoicePrompt}
                  onChange={(e) => handleTextChange(e.target.value)}
                  onScroll={handleScroll}
                  placeholder=""
                  className="sync-input-textarea absolute inset-0 bg-transparent text-transparent caret-slate-800 focus:ring-0 focus:outline-none resize-none overflow-y-auto"
                  style={{ WebkitTextFillColor: 'transparent' }}
                />
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="text-[11px] font-black text-emerald-900">ElevenLabs V3 自动增强</span>
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-emerald-800/75">
                      逐句分析台词，在情绪变化处添加多个 V3 语气标签；不改正文，不满意可恢复原文。
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleV3EnhancePrompt}
                      disabled={v3EnhancementLoading || !standaloneVoicePrompt.trim()}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {v3EnhancementLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      <span>{v3EnhancementLoading ? '增强中...' : '自动语气'}</span>
                    </button>
                    {canRestoreV3Original && (
                      <button
                        type="button"
                        onClick={handleRestoreV3Original}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-[10px] font-bold text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>恢复原文</span>
                      </button>
                    )}
                  </div>
                </div>

                {v3Enhancement && (
                  <div className="mt-2 rounded-lg border border-emerald-100 bg-white/70 px-2.5 py-2 text-[10px] leading-relaxed text-slate-600">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-emerald-800">已增强</span>
                      {v3Enhancement.addedTags.length > 0 ? (
                        v3Enhancement.addedTags.map(tag => (
                          <span key={tag} className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-mono font-bold text-emerald-700">
                            [{tag}]
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-500">未额外添加标签</span>
                      )}
                    </div>
                    <p className="mt-1 text-slate-500">{v3Enhancement.notes}</p>
                  </div>
                )}

                {v3EnhancementError && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{v3EnhancementError}</span>
                  </div>
                )}
              </div>
            </div>
            )}

            {ttsInputMode === 'batch' && (
            <div
              onDragEnter={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setBatchVoiceDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setBatchVoiceDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setBatchVoiceDragActive(false);
                }
              }}
              onDrop={handleBatchVoiceDrop}
              className={`rounded-2xl border bg-gradient-to-br from-white to-emerald-50/40 p-4 space-y-3 shadow-sm transition-all ${
                batchVoiceDragActive
                  ? 'border-emerald-400 ring-2 ring-emerald-200 bg-emerald-50'
                  : 'border-emerald-100'
              }`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <UploadCloud className="h-4 w-4 text-emerald-600" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">批量配音需求导入</h3>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                    上传台本/需求表、拖拽文档或直接粘贴内容，先生成可编辑预览，再逐条合成；试听确认后再打包下载 ZIP。
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-[10px] font-bold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-50">
                  <UploadCloud className="h-3.5 w-3.5" />
                  <span>上传文档/表格/图片</span>
                  <input
                    type="file"
                    accept={BATCH_VOICE_ACCEPTED_FILE_TYPES}
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      handleBatchVoiceFiles(Array.from(event.target.files || []));
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
              </div>

              <div className={`rounded-xl border border-dashed px-3 py-2 text-[10px] leading-relaxed transition-colors ${
                batchVoiceDragActive
                  ? 'border-emerald-400 bg-emerald-100 text-emerald-800'
                  : 'border-emerald-200 bg-white/70 text-slate-500'
              }`}>
                {batchVoiceDragActive ? '松开即可导入文档/表格并生成可编辑预览。' : BATCH_VOICE_READABLE_FILE_HINT}
              </div>

              {batchVoiceFileName && (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-600">
                  <FileAudio className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="truncate">已选择：{batchVoiceFileName}</span>
                </div>
              )}

              <textarea
                value={batchVoiceRawText}
                onChange={(event) => setBatchVoiceRawText(event.target.value)}
                placeholder={'也可以直接粘贴需求表内容：\n角色_001：欢迎来到我们的世界。\n角色_002\t[开心] 太好了，我们终于成功了！\n旁白03, 请大家保持安静。'}
                className="min-h-28 w-full rounded-xl border border-slate-200 bg-white/90 p-3 text-xs leading-relaxed text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleParseBatchVoiceText()}
                  disabled={!batchVoiceRawText.trim() || batchVoiceLoading || batchVoiceToneLoading}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>分析生成预览</span>
                </button>
                <button
                  type="button"
                  onClick={handleEnhanceBatchVoiceTags}
                  disabled={batchVoiceToneLoading || batchVoiceLoading || batchVoiceItems.filter(item => item.text.trim()).length === 0}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-[10px] font-bold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {batchVoiceToneLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  <span>{batchVoiceToneLoading ? '重析中...' : 'V3 重析语气'}</span>
                </button>
                <button
                  type="button"
                  onClick={addBatchVoiceItem}
                  disabled={batchVoiceLoading || batchVoiceToneLoading}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>+ 新增一句</span>
                </button>
              </div>

              {batchVoiceStatus && (
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-2 text-[10px] font-semibold text-emerald-800">
                  {batchVoiceStatus}
                </div>
              )}
              {batchVoiceError && (
                <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{batchVoiceError}</span>
                </div>
              )}

              {batchVoiceItems.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                    <span>分析预览 · {batchVoiceItems.length} 条</span>
                    <span>{batchVoiceItems.filter(item => item.enabled).length} 条将生成</span>
                  </div>
                  <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                    {batchVoiceItems.map((item, index) => {
                      const isGeneratingItem = item.status === 'generating';
                      return (
                        <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 flex-1 items-start gap-2">
                              <input
                                type="checkbox"
                                checked={item.enabled}
                                onChange={(event) => updateBatchVoiceItem(item.id, { enabled: event.target.checked })}
                                className="mt-2 h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              />
                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <label className="space-y-1">
                                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">文件名</span>
                                    <input
                                      value={formatBatchVoiceFileName(item, index)}
                                      onChange={(event) => updateBatchVoiceItem(item.id, {
                                        name: sanitizeBatchVoiceFileName(stripBatchVoiceNameIndexPrefix(event.target.value)),
                                        nameSource: 'manual',
                                      })}
                                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-bold text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
                                    />
                                  </label>
                                  <label className="space-y-1">
                                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">语气标签</span>
                                    <input
                                      value={item.emotionTags}
                                      onChange={(event) => updateBatchVoiceItem(item.id, { emotionTags: event.target.value })}
                                      placeholder="多个标签，例如：excited, warm, calm"
                                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
                                    />
                                    <span className="block text-[9px] leading-relaxed text-slate-400">
                                      可填多个，生成时会转成 [tag][tag] 的 V3 风格提示。
                                    </span>
                                  </label>
                                </div>
                                <label className="block space-y-1">
                                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">台词</span>
                                  <textarea
                                    value={item.text}
                                    onChange={(event) => updateBatchVoiceItem(item.id, {
                                      text: event.target.value,
                                      emotionTags: extractBatchVoiceTags(event.target.value).join(', '),
                                      status: item.audioUrl ? 'pending' : item.status,
                                    })}
                                    rows={2}
                                    className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] leading-relaxed text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
                                  />
                                </label>
                                <div className="flex flex-wrap items-center gap-1.5 text-[9px] text-slate-400">
                                  <span>#{index + 1}</span>
                                  <span>{item.note}</span>
                                  {item.status === 'done' && <span className="font-bold text-emerald-600">已生成</span>}
                                  {item.status === 'error' && <span className="font-bold text-red-500">{item.error}</span>}
                                </div>
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-row gap-1.5 sm:flex-col">
                              <button
                                type="button"
                                onClick={() => generateBatchVoiceItem(item.id)}
                                disabled={batchVoiceLoading || batchVoiceToneLoading || isGeneratingItem || !item.text.trim() || !standaloneVoiceRole}
                                className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isGeneratingItem ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                <span>{item.audioUrl ? '重新生成' : '生成'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => removeBatchVoiceItem(item.id)}
                                disabled={batchVoiceLoading || batchVoiceToneLoading || isGeneratingItem}
                                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                删除
                              </button>
                            </div>
                          </div>

                          {item.audioUrl && (
                            <div className="mt-3 border-t border-slate-100 pt-3">
                              <GeneratedAudioPlayer
                                id={`batch-voice-${item.id}`}
                                url={item.audioUrl}
                                title={formatBatchVoiceFileName(item, index)}
                                titleBadge="批量配音"
                                prompt={buildBatchVoiceGenerationText(item)}
                                meta={`文件名：${formatBatchVoiceFileName(item, index)}.mp3 · ${selectedVoiceObj?.name || standaloneVoiceRole}`}
                                playbackRate={standaloneVoiceSpeed}
                                activeId={activeGeneratedVoiceId}
                                setActiveId={setActiveGeneratedVoiceId}
                                editableTitle
                                downloadFileName={`${formatBatchVoiceFileName(item, index)}.mp3`}
                                downloadLabel="下载此条 MP3"
                                onRename={(title) => updateBatchVoiceItem(item.id, {
                                  name: sanitizeBatchVoiceFileName(stripBatchVoiceNameIndexPrefix(title)),
                                  nameSource: 'manual',
                                })}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Premium Voice Library vs Custom Voice Setting block */}
            <div className="space-y-3">
              <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>声线设定方式（精品人声库）</span>
                </span>
                <span className="text-[10px] text-slate-450 font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">ElevenLabs 引擎支持</span>
              </label>

              {/* PREMIUM VOICE SELECTION WIDGET */}
              <div className="space-y-3 relative">
                  {assistantVoiceRequest?.openVoiceLibrary && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-[10px] leading-relaxed text-emerald-900">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="font-bold">已提取台词并按匹配度排列声音</span>
                        <span className="text-emerald-700/80">请试听并选择，生成由你确认</span>
                      </div>
                      <div className="mt-1 truncate text-emerald-800/80" title={assistantVoiceRequest.text}>
                        台词：{assistantVoiceRequest.text || '未识别到台词，请在文本框中补充'}
                      </div>
                      {assistantVoiceRequest.translationApplied && assistantVoiceRequest.sourceText && (
                        <div className="mt-1 truncate text-emerald-700/70" title={assistantVoiceRequest.sourceText}>
                          已将中文台词翻译为{
                            assistantVoiceRequest.language === 'ar' ? '阿拉伯语'
                              : assistantVoiceRequest.language === 'ja' ? '日语'
                                : assistantVoiceRequest.language === 'ko' ? '韩语'
                                  : assistantVoiceRequest.language === 'fr' ? '法语'
                                    : assistantVoiceRequest.language === 'de' ? '德语'
                                      : assistantVoiceRequest.language === 'es' ? '西班牙语' : '英语'
                          }；原文：{assistantVoiceRequest.sourceText}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] font-black text-slate-700 flex items-center gap-1.5">
                        <Search className="w-3.5 h-3.5 text-emerald-600" />
                        智能搜索声音
                      </span>
                      <span className="text-[9px] font-semibold text-slate-400">
                        {filteredVoiceOptions.length}/{displayVoices.length} 个声音
                      </span>
                    </div>

                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        value={voiceSmartSearchInput}
                        onFocus={() => setShowVoiceDropdown(true)}
                        onChange={(event) => applySmartVoiceSearch(event.target.value)}
                        onCompositionEnd={(event) => applySmartVoiceSearch(event.currentTarget.value)}
                        placeholder="输入任意语言描述，例如：温柔年轻女旁白、低沉成熟男声、優しい女性ナレーション..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-9 pr-8 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none transition-all placeholder-slate-400"
                      />
                      {voiceSmartSearchInput && (
                        <button
                          type="button"
                          onClick={clearVoiceSearch}
                          className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 transition-colors"
                          aria-label="清空声音搜索"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {voiceSmartSearchInput.trim() && voiceSearchQuery.trim() && (
                      <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50/70 p-2 text-[9px] font-semibold text-emerald-800">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span>{voiceSearchManuallyEdited || voiceSearchQuery !== convertedSmartVoiceSearchQuery ? '下方搜索已手动微调' : '已生成下方可用搜索词'}</span>
                          <span className="text-emerald-700/70">同步到声音库</span>
                        </div>
                        <input
                          type="text"
                          value={voiceSearchQuery}
                          onFocus={() => setShowVoiceDropdown(true)}
                          onChange={(event) => handleManualVoiceSearchChange(event.target.value)}
                          placeholder="转换后的英文搜索词会显示在这里"
                          className="w-full rounded-lg border border-emerald-100 bg-white/90 px-2 py-1.5 text-[10px] font-bold text-emerald-950 outline-none transition-all focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
                        />
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {QUICK_VOICE_SEARCHES.map(search => (
                        <button
                          key={search}
                          type="button"
                          onClick={() => {
                            applySmartVoiceSearch(search);
                          }}
                          className={`rounded-full px-2 py-0.5 text-[9px] font-bold transition-colors ${
                            voiceSmartSearchInput === search
                              ? 'bg-emerald-600 text-white'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {search}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Selected Voice Display & Trigger Button */}
                        <button
                          type="button"
                          onClick={() => setShowVoiceDropdown(!showVoiceDropdown)}
                          className="w-full bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-xl py-3 px-4 text-xs text-left text-slate-800 focus:outline-none transition-all flex items-center justify-between cursor-pointer shadow-sm"
                        >
                          {selectedVoiceObj ? (
                            <div className="flex items-center gap-2.5">
                              <span className={`w-2 h-2 rounded-full ${selectedVoiceObj.gender === 'male' ? 'bg-blue-500' : 'bg-pink-500'}`} />
                              <div>
                                <span className="font-bold text-slate-850">已选：{selectedVoiceObj.name}</span>
                                <span className="text-[10px] text-slate-500 bg-slate-150 border border-slate-200 px-1.5 py-0.5 rounded ml-2 font-bold">
                                  {selectedVoiceObj.category}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400">请选择精品配音角色...</span>
                          )}
                          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${showVoiceDropdown ? 'rotate-180' : ''}`} />
                        </button>

                        {showVoiceDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 space-y-3">
                            <div className="relative">
                              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                              <input
                                type="text"
                                value={voiceSearchQuery}
                                onChange={(event) => handleManualVoiceSearchChange(event.target.value)}
                                placeholder="继续细化搜索：声音名、情绪、人物、分类、标签..."
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-8 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all placeholder-slate-400"
                              />
                              {voiceSearchQuery && (
                                <button
                                  type="button"
                                  onClick={() => handleManualVoiceSearchChange('')}
                                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>

                            <div className="flex items-center justify-between text-[9px] text-slate-400">
                              <span>
                                {normalizedVoiceSearchQuery
                                  ? `按“${voiceSearchQuery.trim()}”匹配声音`
                                  : '可手动浏览全部声音，也可输入描述快速定位'}
                              </span>
                              <span className="font-bold text-slate-500">{filteredVoiceOptions.length} 个结果</span>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-2">
                              <span className="text-[9px] font-bold text-slate-400 uppercase mr-1">分类:</span>
                              {voiceCategories.map(category => (
                                <button
                                  key={category}
                                  type="button"
                                  onClick={() => setVoiceActiveCategory(category)}
                                  className={`text-[9px] px-2.5 py-0.5 rounded font-bold transition-all ${
                                    voiceActiveCategory === category
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {category}
                                </button>
                              ))}
                            </div>

                            <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
                              <span className="text-[9px] font-bold text-slate-400 uppercase mr-1">性别:</span>
                              {[
                                { value: 'all', label: '全部', activeClassName: 'bg-emerald-600 text-white' },
                                { value: 'male', label: '男声', activeClassName: 'bg-blue-600 text-white' },
                                { value: 'female', label: '女声', activeClassName: 'bg-pink-600 text-white' },
                              ].map(option => (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => setVoiceGenderFilter(option.value as 'all' | 'male' | 'female')}
                                  className={`text-[9px] px-2.5 py-0.5 rounded font-bold transition-all ${
                                    voiceGenderFilter === option.value
                                      ? option.activeClassName
                                      : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>

                            <div className="max-h-72 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                              {isLoadingVoices ? (
                                <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  正在加载声音库...
                                </div>
                              ) : displayVoices.length === 0 ? (
                                <div className="py-10 px-4 text-center flex flex-col items-center justify-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 border border-amber-100">
                                    <Info className="w-5 h-5" />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-xs font-bold text-slate-700">配音声音库为空</p>
                                    <p className="text-[11px] text-slate-500 max-w-xs leading-relaxed">
                                      请检查 ElevenLabs 服务状态，或先同步/添加可用声线。
                                    </p>
                                  </div>
                                </div>
                              ) : filteredVoiceOptions.length === 0 ? (
                                <div className="py-8 text-center text-slate-400 text-xs">
                                  未找到匹配的声音，请换一个搜索词或筛选条件。
                                </div>
                              ) : filteredVoiceOptions.map(voice => {
                                const isSelected = standaloneVoiceRole === voice.id;
                                return (
                                  <div
                                    key={voice.id}
                                    onClick={() => handleSelectVoice(voice)}
                                    className={`w-full py-2 px-2.5 rounded-xl flex items-start justify-between gap-3 cursor-pointer transition-colors text-left ${
                                      isSelected ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1 space-y-0.5">
                                      <div className="flex items-center flex-wrap gap-1">
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${voice.gender === 'male' ? 'bg-blue-500' : 'bg-pink-500'}`} />
                                        <span className="text-xs font-bold text-slate-850">{voice.name}</span>
                                        <span className="text-[9px] text-slate-400 bg-slate-50 px-1 py-0.2 rounded border border-slate-100 font-mono">
                                          {voice.category}
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-slate-500 truncate leading-normal">{voice.description}</p>
                                      <div className="flex flex-wrap gap-1">
                                        {(voice.tags || []).slice(0, 3).map((tag, index) => (
                                          <span key={index} className="text-[9px] text-emerald-700 bg-emerald-50 px-1 rounded-sm">
                                            #{tag}
                                          </span>
                                        ))}
                                      </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-1 mt-1">
                                      <button
                                        type="button"
                                        onClick={(event) => handlePlayVoicePreview(voice.id, voice.previewUrl || '', event)}
                                        aria-label={`试听 ${voice.name}`}
                                        title="试听"
                                        className={`w-5.5 h-5.5 rounded-full flex items-center justify-center border transition-colors ${
                                          playingVoiceId === voice.id
                                            ? 'bg-emerald-600 border-emerald-500 text-white'
                                            : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-700'
                                        }`}
                                      >
                                        {playingVoiceId === voice.id ? (
                                          <Pause className="w-2.5 h-2.5 fill-current" />
                                        ) : (
                                          <Play className="w-2.5 h-2.5 fill-current ml-0.2" />
                                        )}
                                      </button>

                                      <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                                        isSelected ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-200 bg-white'
                                      }`}>
                                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Selected Voice Detailed Card */}
                        {selectedVoiceObj && (
                          <div className="bg-gradient-to-br from-emerald-50/50 to-teal-50/30 border border-emerald-500/20 rounded-2xl p-4 space-y-2.5 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-black text-emerald-950">{selectedVoiceObj.name}</span>
                                  <span className="text-[9px] text-slate-500 bg-slate-100 border border-slate-200 px-1.5 rounded-full font-semibold">
                                    {selectedVoiceObj.category}
                                  </span>
                                  <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                                    selectedVoiceObj.gender === 'male' 
                                      ? 'bg-blue-50 text-blue-700 border border-blue-100' 
                                      : 'bg-pink-50 text-pink-700 border border-pink-100'
                                  }`}>
                                    {selectedVoiceObj.gender === 'male' ? '男声 (Male)' : '女声 (Female)'}
                                  </span>
                                </div>
                                <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">{selectedVoiceObj.description}</p>
                              </div>

                              <button
                                type="button"
                                onClick={(e) => handlePlayVoicePreview(selectedVoiceObj.id, selectedVoiceObj.previewUrl, e)}
                                className={`w-8 h-8 rounded-full flex items-center justify-center border shrink-0 transition-all ${
                                  playingVoiceId === selectedVoiceObj.id
                                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-md animate-pulse'
                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-150 shadow-sm'
                                }`}
                                title="试听当前声线"
                              >
                                {playingVoiceId === selectedVoiceObj.id ? (
                                  <Pause className="w-3.5 h-3.5 fill-current" />
                                ) : (
                                  <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                                )}
                              </button>
                            </div>

                            <div className="flex flex-wrap gap-1 pt-1.5 border-t border-emerald-500/10">
                              {selectedVoiceObj.tags.map((tag, idx) => (
                                <span
                                  key={idx}
                                  className="text-[9px] font-semibold text-emerald-800 bg-emerald-100/50 px-2 py-0.5 rounded-full"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                </div>
            </div>

            {ttsInputMode === 'batch' && (
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-black text-slate-800">
                      <Download className="h-3.5 w-3.5 text-emerald-600" />
                      多文本生成
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                      已勾选 {batchVoiceEnabledCount} 条
                    </span>
                    {batchVoiceCompletedCount > 0 && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        已生成 {batchVoiceCompletedCount} 条
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleGenerateBatchVoices}
                      disabled={batchVoiceLoading || batchVoiceToneLoading || batchVoiceEnabledCount === 0 || !standaloneVoiceRole}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-black text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {batchVoiceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      <span>{batchVoiceLoading ? '全部生成中...' : '全部生成'}</span>
                    </button>
                    {batchVoiceCompletedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => createBatchVoiceZip(batchVoiceItems).catch(error => setBatchVoiceError(error?.message || '打包失败'))}
                        disabled={batchVoiceLoading}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>下载 ZIP</span>
                      </button>
                    )}
                  </div>
                </div>
                {(!standaloneVoiceRole || batchVoiceEnabledCount === 0) && (
                  <p className="mt-1.5 text-[10px] font-semibold text-amber-600">
                    {!standaloneVoiceRole && batchVoiceEnabledCount === 0
                      ? '请选择声音和台词。'
                      : !standaloneVoiceRole
                        ? '请先选择一个声音。'
                        : '请先分析或新增台词。'}
                  </p>
                )}
              </div>
            )}

            {/* Error alerts */}
            {ttsInputMode === 'single' && standaloneVoiceError && (
              <div className="bg-red-50 border border-red-200 text-red-600 p-3.5 rounded-xl text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{standaloneVoiceError}</span>
              </div>
            )}

            {/* Dub generation button */}
            {ttsInputMode === 'single' && (
            <button
              onClick={handleStandaloneVoiceGenerate}
              disabled={standaloneVoiceLoading || !standaloneVoicePrompt.trim() || !standaloneVoiceRole}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3.5 rounded-xl text-xs tracking-wider uppercase transition-all shadow-md shadow-emerald-600/10 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {standaloneVoiceLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>ElevenLabs 正在生成配音...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>合成并输出人物配音</span>
                </>
              )}
            </button>
            )}

          </div>
        </div>

        {/* Player preview columns */}
        <div className="lg:col-span-5 space-y-5">
          {/* Main active preview player */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              {ttsInputMode === 'batch' ? '多文本配音状态' : '配音预览与播放控制'}
            </h3>
            
            {ttsInputMode === 'batch' ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-xs leading-relaxed text-slate-500 space-y-3">
                <div className="flex items-center gap-2 font-bold text-slate-700">
                  <UploadCloud className="w-4 h-4 text-emerald-600" />
                  <span>多文本批量配音</span>
                </div>
                <p>
                  在左侧上传或粘贴台本/需求表，先检查可编辑预览，再逐条生成、试听、重命名；确认后再打包 ZIP。
                </p>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <span className="block text-slate-400">预览条目</span>
                    <span className="font-black text-slate-800">{batchVoiceItems.length}</span>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <span className="block text-slate-400">已生成</span>
                    <span className="font-black text-emerald-700">{batchVoiceItems.filter(item => item.status === 'done' && item.audioUrl).length}</span>
                  </div>
                </div>
              </div>
            ) : standaloneVoiceLoading ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-3">
                <div className="w-12 h-12 bg-emerald-50 border border-emerald-200 rounded-full flex items-center justify-center animate-spin">
                  <Mic className="w-5 h-5 text-emerald-600 animate-pulse" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-slate-700">正在生成配音作品...</p>
                  <p className="text-[10px] text-slate-400">大约需要 5 - 10 秒</p>
                </div>
              </div>
            ) : generatedVoiceOptions.length > 0 ? (
              <div className="space-y-3">
                {generatedVoiceOptions.map(({ id, label, option }) => (
                  <GeneratedAudioPlayer
                    key={id}
                    id={`voice-${id}`}
                    url={option.url}
                    title={option.displayName}
                    titleBadge={label}
                    prompt={option.processedText}
                    meta={`属性：${standaloneVoiceGender === 'male' ? '男声' : '女声'} · ${standaloneVoiceLang.toUpperCase()} · ${option.speed}x`}
                    playbackRate={option.speed}
                    activeId={activeGeneratedVoiceId}
                    setActiveId={setActiveGeneratedVoiceId}
                    editableTitle
                    downloadFileName={`${sanitizeAudioFileName(option.displayName, `generated_voiceover_${id}`)}.mp3`}
                    downloadLabel={`下载 MP3 配音（${label}）`}
                    onRename={(title) => updateGeneratedVoiceName(id, title)}
                  />
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-slate-200 bg-slate-50 rounded-xl p-10 text-center text-slate-400 text-xs leading-relaxed">
                <Mic className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <span>输入台词，指定人设和语气偏好，点击生成高品质配音音轨。</span>
              </div>
            )}
          </div>

          {/* Voice History Tracks */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
              <span>已归档配音 ({voiceHistory.length})</span>
              <span className="text-[10px] text-slate-400 font-normal">本次会话</span>
            </h3>

            {voiceHistory.length === 0 ? (
              <p className="text-slate-400 text-[10px] text-center py-6">暂无历史配音。配音生成成功后，将在此自动归档。</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                {voiceHistory.map((item) => {
                  const isHistPlaying = playingHistoryId === item.id;
                  return (
                    <div key={item.id} className="p-3 bg-slate-50 border border-slate-200 hover:border-emerald-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                      <audio 
                        ref={el => { historyAudioRefs.current[item.id] = el; }} 
                        src={item.url} 
                        onEnded={() => setPlayingHistoryId(null)}
                      />
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <button
                          onClick={() => handleHistoryPlayPause(item.id)}
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                            isHistPlaying 
                              ? 'bg-emerald-600 text-white border-emerald-500' 
                              : 'bg-white text-slate-500 border-slate-200 hover:text-slate-905 hover:bg-slate-50'
                          }`}
                        >
                          {isHistPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          {editingHistoryId === item.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                className="bg-white border border-emerald-300 rounded px-1.5 py-0.5 text-[11px] text-slate-850 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-full"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveRename(item.id);
                                  if (e.key === 'Escape') setEditingHistoryId(null);
                                }}
                              />
                              <button
                                onClick={() => handleSaveRename(item.id)}
                                className="p-0.5 hover:bg-emerald-50 text-emerald-600 rounded transition-colors shrink-0"
                                title="保存"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingHistoryId(null)}
                                className="p-0.5 hover:bg-red-50 text-red-600 rounded transition-colors shrink-0"
                                title="取消"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 group">
                              <p className="font-bold text-slate-750 truncate text-[11px]">{item.title}</p>
                              <button
                                onClick={() => {
                                  setEditingHistoryId(item.id);
                                  setEditingTitle(item.title);
                                }}
                                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-0.5 text-slate-400 hover:text-emerald-600 rounded transition-opacity shrink-0"
                                title="重命名"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          <p className="text-[9px] text-slate-400 truncate italic">"{item.prompt}"</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[9px] text-slate-400 font-mono hidden sm:inline">{item.timestamp.split(' ')[1]}</span>
                        <button
                          onClick={() => downloadAudioHelper(item.url, `${item.id}.mp3`)}
                          className="p-1 hover:bg-emerald-50 hover:text-emerald-700 text-slate-400 rounded transition-colors cursor-pointer"
                          title="下载"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
          </div>
          )}
          {visitedSubTabs.has('sts') && (
            <div hidden={activeSubTab !== 'sts'}>
              <SpeechToSpeech
                initialFile={assistantVoiceRequest?.mode === 'sts' ? assistantVoiceRequest.file : undefined}
                assistantRequestId={assistantVoiceRequest?.mode === 'sts' ? assistantVoiceRequest.id : undefined}
                historyList={historyList}
                setHistoryList={setHistoryList}
                displayVoices={displayVoices}
                playingVoiceId={playingVoiceId}
                handlePlayVoicePreview={handlePlayVoicePreview}
                onAudioPlay={() => {
                  if (standaloneVoiceAudioRef.current) {
                    standaloneVoiceAudioRef.current.pause();
                    setIsPlaying(false);
                  }
                }}
              />
            </div>
          )}
          {visitedSubTabs.has('translate') && (
            <div hidden={activeSubTab !== 'translate'}>
              <CrossLanguageDubbing
                initialFile={assistantVoiceRequest?.mode === 'translate' ? assistantVoiceRequest.file : undefined}
                assistantRequestId={assistantVoiceRequest?.mode === 'translate' ? assistantVoiceRequest.id : undefined}
                initialTargetLanguage={assistantVoiceRequest?.mode === 'translate' ? assistantVoiceRequest.language : undefined}
                setHistoryList={setHistoryList}
                onAudioPlay={() => {
                  if (standaloneVoiceAudioRef.current) {
                    standaloneVoiceAudioRef.current.pause();
                    setIsPlaying(false);
                  }
                }}
              />
            </div>
          )}
          {visitedSubTabs.has('convert') && (
            <div hidden={activeSubTab !== 'convert'} className="min-h-full">
              <VoiceConversion
                displayVoices={displayVoices}
                initialFile={assistantVoiceRequest?.mode === 'translate' ? assistantVoiceRequest.file : undefined}
                assistantRequestId={assistantVoiceRequest?.mode === 'translate' ? assistantVoiceRequest.id : undefined}
                initialTargetLanguage={assistantVoiceRequest?.mode === 'translate' ? assistantVoiceRequest.language : undefined}
                setHistoryList={setHistoryList}
                playingVoiceId={playingVoiceId}
                handlePlayVoicePreview={handlePlayVoicePreview}
                onAudioPlay={() => {
                  if (standaloneVoiceAudioRef.current) {
                    standaloneVoiceAudioRef.current.pause();
                    setIsPlaying(false);
                  }
                }}
              />
            </div>
          )}
          {visitedSubTabs.has('stt') && (
            <div hidden={activeSubTab !== 'stt'}>
              <SpeechToText
                initialFile={assistantVoiceRequest?.mode === 'stt' ? assistantVoiceRequest.file : undefined}
                assistantRequestId={assistantVoiceRequest?.mode === 'stt' ? assistantVoiceRequest.id : undefined}
              />
            </div>
          )}
      </div>
    </div>
  );
}
