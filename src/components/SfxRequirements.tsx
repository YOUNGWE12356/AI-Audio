/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  Copy, 
  Download, 
  Plus, 
  Trash2, 
  Loader2, 
  X, 
  ClipboardList,
  AlertCircle,
  HelpCircle,
  Sparkles,
  ArrowRight,
  FileSpreadsheet
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { generateSfxRequirements, type ExistingSfxRequirementItem } from '../services/geminiService';
import type { AssistantRequirementsRequest } from './GlobalAssistant';

type TemplateType = 'game_sfx_general' | 'game_sfx_middleware' | 'voiceover_general' | 'voiceover_multilang';
type GenerateMode = 'replace' | 'append';
type ProjectOption = '' | 'jinn' | 'sunny_island' | 'avatar';

const PROJECT_OPTIONS: Array<{ id: Exclude<ProjectOption, ''>; name: string }> = [
  { id: 'jinn', name: 'Jinn' },
  { id: 'sunny_island', name: '小岛有晴天' },
  { id: 'avatar', name: 'Avatar' },
];

interface SfxRequirementsProps {
  hasGeminiKey: boolean;
  assistantRequest?: AssistantRequirementsRequest | null;
}

// Demo data matching our standard design principles
const DEMO_ROWS: Record<TemplateType, any[]> = {
  game_sfx_general: [
    {
      index: 1,
      audio_type: "SFX",
      filename: "sfx_ui_common_button_click",
      duration_logic: "1s, 单次播放",
      scene: "通用与主界面&游戏内的ui点击按键",
      description: "清脆的交互点击声，带有轻微的拟物触感与中高频数字质感",
      script: "-",
      tone: "-",
      remarks: "常用全局 UI 按钮，声音要小巧，响度控制在 -14 LUFS 左右",
      video_link: "UI点击演示.mp4"
    },
    {
      index: 2,
      audio_type: "BGM",
      filename: "bgm_battle",
      duration_logic: "loop, 循环播放",
      scene: "关卡内战斗场景、遭遇战",
      description: "热血、紧张有战斗感的电子摇滚乐，由重击鼓点、失真吉他与动感合成器主导",
      script: "-",
      tone: "-",
      remarks: "需要无缝循环，包含一个 4s 的 Intro 前奏，BPM 135",
      video_link: "核心战斗参考.mp4"
    },
    {
      index: 3,
      audio_type: "SFX",
      filename: "sfx_player_dash",
      duration_logic: "0.8s, 单次播放",
      scene: "主角执行前冲闪避、瞬移的一瞬间",
      description: "带有疾风气流撕裂声，高频气流破空音色叠合电声粒子回馈",
      script: "-",
      tone: "-",
      remarks: "瞬态触发极快，高音需要做压限，避免连续触发破音",
      video_link: "前冲动作.mp4"
    },
    {
      index: 4,
      audio_type: "SFX",
      filename: "sfx_item_pickup_gold",
      duration_logic: "1.2s, 随机多样本",
      scene: "玩家拾取金币或重要战利品时",
      description: "清脆悦耳的高频金属撞击声，带有闪闪发光的粒子声尾音",
      script: "-",
      tone: "-",
      remarks: "提供 3 个随机音调微调样本，增强连续拾取时的多变性",
      video_link: "拾取反馈.mp4"
    }
  ],
  game_sfx_middleware: [
    {
      index: 1,
      filename: "sfx_footstep_grass",
      event_name: "event:/SFX/Player/Footstep_Grass",
      duration: "0.5s",
      scene: "角色在草地上行走或奔跑时",
      description: "细腻的草叶摩擦声，带有泥土微弱的松软触击反馈",
      remarks: "配置 FMOD Multi-Sound，放入 5 个随机样本避免单调",
      video_link: "无",
      reference: "参考《塞尔达传说：荒野之息》草地脚步",
      playback_logic: "3D 空间，设置随机音高 (Pitch) 与音量 (Volume)",
      distance_3d: "20"
    },
    {
      index: 2,
      filename: "sfx_magic_fireball_launch",
      event_name: "event:/SFX/Magic/Fireball_Launch",
      duration: "1.2s",
      scene: "法师角色咏唱结束发射火球一瞬间",
      description: "火焰呼啸喷薄而出的轰鸣声，高频热气浪扑面感，叠合魔力蓄能释放",
      remarks: "需要关联 RTPC 参数：法力强度（改变低频厚度与爆破感）",
      video_link: "火球技能.mp4",
      reference: "参考《魔兽世界》法术释放音效",
      playback_logic: "3D 空间，限制最大发声数 3，最老发声覆盖",
      distance_3d: "20"
    }
  ],
  voiceover_general: [
    {
      index: 1,
      scene: "主线关卡第一章，主角目睹家园毁灭时的内心独白",
      tone: "悲愤、压抑，随后转为坚毅，略带沙哑的呼吸声",
      filename: "vo_hero_monologue",
      script: "我曾经以为... 只要守在这里，就能避开这世间的纷争。但我错了，他们夺走了我的一切..."
    },
    {
      index: 2,
      scene: "新手教学，指引精灵莉莉首次向玩家作自我介绍",
      tone: "活泼、俏皮、空灵，语速稍快，带着笑意",
      filename: "vo_fairy_lili_intro",
      script: "哈喽，旅行者！我是莉莉，也是你接下来的向导。别傻站着啦，快跟我出发吧！"
    }
  ],
  voiceover_multilang: [
    {
      index: 1,
      filename: "vo_villain_boss_laugh",
      scene: "战役最后一关，反派魔王在王座上嘲笑主角",
      tone: "狂妄、傲慢，带着阴冷沙哑的胸腔共鸣低笑",
      script_zh: "不自量力的凡人，你们以为这点微末的挣扎，就能改变既定的宿命吗？",
      script_en: "Foolish mortals... do you truly believe your petty struggles can shatter the chains of destiny?",
      script_ko: "어리석은 필멸자들이여, 너희의 그 사소한 발버둥이 정해진 숙명을 바꿀 수 있을 거라 생각하느냐?"
    },
    {
      index: 2,
      filename: "vo_npc_guide_farewell",
      scene: "主城守卫给即将出征的勇士们送行致敬",
      tone: "庄重、神圣、沉稳，铿锵有力，富有史诗仪式感",
      script_zh: "愿晨曦的微光指引你们的方向，勇士们，平安归来！",
      script_en: "May the twilight guide your blade, warriors. Return to us in victory and peace!",
      script_ko: "여명의 미광이 그대들의 길을 비추기를, 용사들이여, 부디 무사히 돌아오라!"
    }
  ]
};

const TEMPLATE_INFO = {
  game_sfx_general: {
    name: "游戏音效配乐通用表",
    desc: "适合把音效、BGM、配音需求放在同一张综合音频需求表里",
    headers: ["序号", "类型", "文件命名", "时长&播放逻辑", "应用场景", "描述", "台词", "语气", "备注", "动效视频"],
    keys: ["index", "audio_type", "filename", "duration_logic", "scene", "description", "script", "tone", "remarks", "video_link"]
  },
  game_sfx_middleware: {
    name: "FMOD / Wwise 引擎中间件需求表",
    desc: "适合专业音频设计师，包含事件路径、播放参数逻辑与音频参考",
    headers: ["序号", "文件命名", "事件命名", "时长", "应用场景", "描述", "备注", "动效视频", "参考", "播放逻辑", "3D距离"],
    keys: ["index", "filename", "event_name", "duration", "scene", "description", "remarks", "video_link", "reference", "playback_logic", "distance_3d"]
  },
  voiceover_general: {
    name: "通用角色配音表",
    desc: "针对配音导演和配音演员，精准定义应用场景、情感语气与台词脚本",
    headers: ["序号", "应用场景", "语气描述", "文件命名", "台词文案"],
    keys: ["index", "scene", "tone", "filename", "script"]
  },
  voiceover_multilang: {
    name: "多语种配音本地化表",
    desc: "适合多国语言配音项目，支持中、英、韩等多语种台词对照和语气约束",
    headers: ["序号", "文件命名", "应用场景", "语气描述", "台词文案（简中）", "英语", "韩语"],
    keys: ["index", "filename", "scene", "tone", "script_zh", "script_en", "script_ko"]
  }
};

const DEFAULT_COLUMN_WIDTHS: Record<TemplateType, number[]> = {
  game_sfx_general: [52, 88, 150, 128, 180, 220, 190, 160, 180, 140],
  game_sfx_middleware: [52, 150, 165, 90, 180, 220, 180, 140, 120, 140, 90],
  voiceover_general: [52, 190, 150, 170, 300],
  voiceover_multilang: [52, 150, 190, 150, 260, 220, 220],
};

const MIN_COLUMN_WIDTH = 52;
const MAX_COLUMN_WIDTH = 560;

const getColumnWidthsForTemplate = (
  widthsByTemplate: Record<TemplateType, number[]>,
  type: TemplateType,
) => {
  const defaults = DEFAULT_COLUMN_WIDTHS[type];
  const saved = widthsByTemplate[type] || [];
  return TEMPLATE_INFO[type].keys.map((_, index) => saved[index] || defaults[index] || 140);
};

const trimRequirementSeparators = (value: string) => value
  .trim()
  .replace(/^[\s,，、;；。.\n\r]+|[\s,，、;；。.\n\r]+$/g, '')
  .trim();

const splitRequirementInputSegments = (value: string) => (
  value
    .split(/[\n\r,，、;；]+/g)
    .map(segment => trimRequirementSeparators(segment))
    .filter(Boolean)
);

const getAddedRequirementText = (currentText: string, previousText: string) => {
  const current = currentText.trim();
  const previous = previousText.trim();
  if (!current) return '';
  if (!previous) return current;
  if (current === previous) return '';
  if (current.startsWith(previous)) {
    return trimRequirementSeparators(current.slice(previous.length));
  }

  const previousSegments = new Set(splitRequirementInputSegments(previous).map(normalizeRequirementText));
  const addedSegments = splitRequirementInputSegments(current).filter(segment => {
    const normalized = normalizeRequirementText(segment);
    return normalized && !previousSegments.has(normalized);
  });
  return addedSegments.join('，');
};

const getUncoveredRequirementText = (currentText: string, existingRows: any[], type: TemplateType) => {
  const segments = splitRequirementInputSegments(currentText);
  if (segments.length === 0 || existingRows.length === 0) return currentText.trim();
  const existingRowTexts = existingRows.map(row => normalizeRequirementText(getRowFieldText(
    row,
    TEMPLATE_INFO[type].keys.filter(key => key !== 'index'),
  ))).filter(Boolean);
  const uncoveredSegments = segments.filter(segment => {
    const normalizedSegment = normalizeRequirementText(segment);
    if (!normalizedSegment) return false;
    return !existingRowTexts.some(rowText => (
      rowText.includes(normalizedSegment)
      || (normalizedSegment.length >= 4 && normalizedSegment.includes(rowText) && rowText.length >= 4)
    ));
  });
  return uncoveredSegments.join('，');
};

const LOADING_STEPS = [
  "AI 正在识别用户上传的参考文件与文字...",
  "正在提取表格、画面、字幕或音频线索...",
  "正在应用专业音频工程规范重构文件名...",
  "正在扩充细致、具体的声学材质与动效描述...",
  "正在转换语境并生成多国台词对照...",
  "正在为您进行高精度的排版排程，即将呈现..."
];

const MAX_REFERENCE_FILE_BYTES = 80 * 1024 * 1024;

const isSupportedReferenceFile = (file: File) => (
  file.type.startsWith('image/')
  || file.type.startsWith('audio/')
  || file.type.startsWith('video/')
);

const getReferenceFileKind = (file: File | null) => {
  if (!file) return '参考文件';
  if (file.type.startsWith('image/')) return '图片/截图';
  if (file.type.startsWith('audio/')) return '音频/BGM参考';
  if (file.type.startsWith('video/')) return '视频/画面参考';
  return '参考文件';
};

const normalizeRequirementText = (value: unknown) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[\s\u3000，。！？、…,.!?;；:："'“”‘’【】\[\]()（）]/g, '');

const getRowFieldText = (row: any, keys: string[]) => (
  keys
    .map(key => String(row?.[key] ?? '').trim())
    .filter(Boolean)
    .join('|')
);

const getRequirementDuplicateKeys = (row: any, type: TemplateType) => {
  const keys = TEMPLATE_INFO[type].keys;
  const duplicateKeys = new Set<string>();
  const filename = normalizeGeneratedFilename(row?.filename);
  if (filename) duplicateKeys.add(`filename:${filename}`);
  const eventName = normalizeGeneratedFilename(row?.event_name);
  if (eventName) duplicateKeys.add(`event:${eventName}`);

  const scriptText = normalizeRequirementText(
    row?.script || row?.script_tone || row?.script_zh || row?.script_en || row?.script_ko || '',
  );
  if (scriptText) duplicateKeys.add(`script:${scriptText}`);

  const semanticText = normalizeRequirementText(getRowFieldText(
    row,
    keys.filter(key => !['index', 'filename', 'event_name', 'video_link', 'reference'].includes(key)),
  ));
  if (semanticText) duplicateKeys.add(`semantic:${semanticText}`);

  const sceneActionText = normalizeRequirementText(getRowFieldText(
    row,
    keys.filter(key => ['audio_type', 'scene', 'description', 'duration_logic', 'duration', 'playback_logic'].includes(key)),
  ));
  if (sceneActionText) duplicateKeys.add(`scene:${sceneActionText}`);

  return Array.from(duplicateKeys);
};

const filterNewRequirementItems = (items: any[], existingRows: any[], type: TemplateType) => {
  const seenKeys = new Set<string>();
  existingRows.forEach(row => {
    getRequirementDuplicateKeys(row, type).forEach(key => seenKeys.add(key));
  });

  return items.filter(item => {
    const keys = getRequirementDuplicateKeys(item, type);
    if (keys.length === 0) return true;
    if (keys.some(key => seenKeys.has(key))) return false;
    keys.forEach(key => seenKeys.add(key));
    return true;
  });
};

const createExistingRequirementSummary = (
  rows: any[],
  type: TemplateType,
): ExistingSfxRequirementItem[] => rows.slice(0, 80).map(row => {
  const summary: ExistingSfxRequirementItem = {};
  TEMPLATE_INFO[type].keys.forEach(key => {
    if (key === 'index') return;
    const value = getRequirementCellValue(row, key);
    if (value !== undefined && value !== null && String(value).trim()) {
      (summary as Record<string, string>)[key] = String(value).slice(0, 500);
    }
  });
  return summary;
}).filter(item => Object.keys(item).length > 0);

const stripScriptToneLabel = (value: unknown) => String(value ?? '')
  .trim()
  .replace(/^台词\s*[：:]\s*/u, '');

const splitScriptToneValue = (value: unknown) => {
  const text = stripScriptToneLabel(value);
  if (!text || text === '-') return { script: text || '-', tone: '-' };
  const match = text.match(/^(.*?)(?:[；;。.]?\s*(?:语气|情绪|口吻|表演|语气描述)\s*[：:]\s*)(.+)$/u);
  if (!match) return { script: text, tone: '' };
  const script = match[1].trim().replace(/[；;。.]$/u, '').trim();
  const tone = match[2].trim();
  return {
    script: script || '-',
    tone: tone || '',
  };
};

const getRequirementCellValue = (row: any, key: string) => {
  if (key === 'script' && (row?.script === undefined || row?.script === null || row?.script === '')) {
    return splitScriptToneValue(row?.script_tone).script;
  }
  if (key === 'tone' && (row?.tone === undefined || row?.tone === null || row?.tone === '')) {
    return splitScriptToneValue(row?.script_tone).tone;
  }
  if (key === 'script_tone') return stripScriptToneLabel(row?.script_tone);
  return row?.[key] ?? '';
};

const inferGeneralAudioType = (item: any) => {
  const explicitType = String(item?.audio_type || item?.type || '').trim().toUpperCase();
  if (['SFX', 'BGM', 'VO'].includes(explicitType)) return explicitType;
  const rawType = String(item?.audio_type || item?.type || '').trim().toLowerCase();
  if (/(配音|人声|台词|旁白|对白|语音|voice|voiceover|vocal|dialogue|dialog|speech)/i.test(rawType)) return 'VO';
  if (/(音乐|配乐|背景音乐|bgm|music|score)/i.test(rawType)) return 'BGM';
  if (/(音效|声效|sfx|sound effect|foley)/i.test(rawType)) return 'SFX';
  const filename = String(item?.filename || '').trim().toLowerCase();
  if (filename.startsWith('vo_')) return 'VO';
  if (filename.startsWith('bgm_')) return 'BGM';
  const combinedText = [
    item?.scene,
    item?.description,
    item?.script_tone,
    item?.script,
    item?.tone,
    item?.remarks,
  ].filter(Boolean).join(' ').toLowerCase();
  if (/(配音|人声|台词|旁白|对白|语音|voice|voiceover|vocal|dialogue|dialog|speech)/i.test(combinedText)) return 'VO';
  if (/(背景音乐|配乐|bgm|music|score|loop|循环音乐)/i.test(combinedText)) return 'BGM';
  return 'SFX';
};

const sortGeneralAudioItemsByType = (items: any[]) => {
  const typeOrder: Record<string, number> = { SFX: 0, BGM: 1, VO: 2 };
  return items
    .map((item, originalIndex) => ({ item, originalIndex, audioType: inferGeneralAudioType(item) }))
    .sort((left, right) => {
      const leftOrder = typeOrder[left.audioType] ?? 99;
      const rightOrder = typeOrder[right.audioType] ?? 99;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.originalIndex - right.originalIndex;
    })
    .map(entry => entry.item);
};

const stripGeneratedVariantSuffix = (value: unknown) => (
  typeof value === 'string' ? value.trim().replace(/_(\d{2,3})$/i, '') : ''
);

const normalizeGeneratedFilename = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
};

const includesAny = (value: string, keywords: string[]) => (
  keywords.some(keyword => value.includes(keyword.toLowerCase()))
);

const hasSceneTermsInOrder = (sceneText: string, firstTerms: string[], secondTerms: string[]) => (
  firstTerms.some(firstTerm => (
    secondTerms.some(secondTerm => {
      const firstIndex = sceneText.indexOf(firstTerm.toLowerCase());
      const secondIndex = sceneText.indexOf(secondTerm.toLowerCase());
      return firstIndex >= 0 && secondIndex >= 0 && firstIndex <= secondIndex;
    })
  ))
);

const inferScenarioFirstFilename = (item: any, normalizedFilename: string) => {
  const sceneText = [
    item?.scene,
    item?.duration_logic,
    item?.duration,
    item?.playback_logic,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!sceneText || !normalizedFilename.startsWith('sfx_')) return normalizedFilename;

  const upgradeTerms = ['升级', '升級', 'upgrade', 'level up', 'levelup'];
  const successTerms = ['成功', '完成', '达成', '達成', 'success', 'complete', 'completed'];
  const failTerms = ['失败', '失敗', 'fail', 'failed', 'error'];
  const pageTerms = ['页面', '頁面', '界面', '页', '頁', 'page', 'screen'];
  const openTerms = ['打开', '开启', '进入', '出現', '出现', '弹出', '彈出', 'open', 'enter', 'show', 'popup'];
  const closeTerms = ['关闭', '关掉', '退出', '返回', '收起', 'close', 'exit', 'back', 'dismiss'];
  const claimTerms = ['领取', '获得', '收取', '结算', 'claim', 'collect', 'receive'];
  const rewardTerms = ['奖励', '獎勵', 'reward'];
  const coinTerms = ['金币', '金幣', 'coin', 'coins', 'gold'];
  const pickupTerms = ['拾取', '捡起', '撿起', 'pickup', 'pick up', 'collect'];

  if (includesAny(sceneText, upgradeTerms) && includesAny(sceneText, pageTerms) && includesAny(sceneText, closeTerms)) {
    return 'sfx_ui_upgrade_page_close';
  }
  if (includesAny(sceneText, upgradeTerms) && includesAny(sceneText, pageTerms) && includesAny(sceneText, openTerms)) {
    return 'sfx_ui_upgrade_page_open';
  }
  if (hasSceneTermsInOrder(sceneText, upgradeTerms, successTerms)) {
    return 'sfx_ui_upgrade_success';
  }
  if (hasSceneTermsInOrder(sceneText, upgradeTerms, failTerms)) {
    return 'sfx_ui_upgrade_fail';
  }
  if (includesAny(sceneText, rewardTerms) && includesAny(sceneText, claimTerms)) {
    return 'sfx_ui_reward_claim';
  }
  if (includesAny(sceneText, coinTerms) && includesAny(sceneText, pickupTerms)) {
    return 'sfx_item_coin_pickup';
  }

  return normalizedFilename;
};

const replaceEventNameFilenameTail = (
  eventName: unknown,
  previousFilename: string,
  nextFilename: string,
) => {
  if (typeof eventName !== 'string' || !previousFilename || previousFilename === nextFilename) {
    return eventName;
  }
  const escapedPrevious = previousFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedNormalizedPrevious = normalizeGeneratedFilename(previousFilename)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return eventName
    .replace(new RegExp(`${escapedPrevious}$`, 'i'), nextFilename)
    .replace(new RegExp(`${escapedNormalizedPrevious}$`, 'i'), nextFilename);
};

const normalizeRequirementFilenames = (items: any[]) => items.map((item) => {
  const originalFilename = typeof item?.filename === 'string' ? item.filename.trim() : '';
  const normalizedFilename = normalizeGeneratedFilename(originalFilename);
  const scenarioFirstFilename = inferScenarioFirstFilename(item, normalizedFilename);
  if (!scenarioFirstFilename || scenarioFirstFilename === originalFilename) return item;
  return {
    ...item,
    filename: scenarioFirstFilename,
    event_name: replaceEventNameFilenameTail(item.event_name, originalFilename, scenarioFirstFilename),
  };
});

const simplifySingletonFilenameSuffixes = (items: any[]) => {
  const normalizedItems = normalizeRequirementFilenames(items);
  const baseNameCounts = new Map<string, number>();
  normalizedItems.forEach((item) => {
    const filename = typeof item?.filename === 'string' ? item.filename.trim() : '';
    if (!/_\d{2,3}$/i.test(filename)) return;
    const baseName = stripGeneratedVariantSuffix(filename);
    if (!baseName) return;
    baseNameCounts.set(baseName, (baseNameCounts.get(baseName) || 0) + 1);
  });

  return normalizedItems.map((item) => {
    const filename = typeof item?.filename === 'string' ? item.filename.trim() : '';
    if (!/_\d{2,3}$/i.test(filename)) return item;

    const baseName = stripGeneratedVariantSuffix(filename);
    if ((baseNameCounts.get(baseName) || 0) !== 1) return item;

    const simplifiedItem = { ...item, filename: baseName };
    if (typeof simplifiedItem.event_name === 'string') {
      simplifiedItem.event_name = replaceEventNameFilenameTail(simplifiedItem.event_name, filename, baseName);
    }
    return simplifiedItem;
  });
};

const capitalizeEngineeringNameSegments = (value: string) => value
  .split('_')
  .map(segment => segment ? `${segment.charAt(0).toUpperCase()}${segment.slice(1)}` : segment)
  .join('_');

const normalizeGeneralEngineeringName = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const normalized = value
    .trim()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return capitalizeEngineeringNameSegments(normalized);
};

const normalizeGeneralRequirementItems = (items: any[]) => items.map((item) => {
  const filename = normalizeGeneralEngineeringName(item?.filename);
  const normalizedItem = {
    ...item,
    filename: filename || item?.filename || '',
  };
  if (typeof item?.event_name === 'string') {
    normalizedItem.event_name = normalizeGeneralEngineeringName(item.event_name) || item.event_name;
  }
  return normalizedItem;
});

const normalizeJinnEngineeringName = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const normalized = value
    .trim()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^sfx_/i, '');
  return capitalizeEngineeringNameSegments(normalized);
};

const inferJinnVocalAction = (item: any): string | null => {
  const description = String(item?.description || '').toLowerCase();
  const remarks = String(item?.remarks || '').toLowerCase();
  const vocalText = `${description} ${remarks}`;
  if (!vocalText.trim()) return null;

  const hasVocalDescription = /(叫|鸣|吼|啸|嚎|嘶|笑|低语|耳语|squeak|squeal|cry|call|roar|growl|hiss|howl|scream|shriek|laugh|whisper|vocal)/i.test(vocalText);
  if (!hasVocalDescription) return null;

  const context = `${String(item?.filename || '')} ${String(item?.scene || '')} ${vocalText}`.toLowerCase();
  if (/(老鼠|鼠叫|mouse|rat)/i.test(context) && /(吱|尖细|squeak|squeal)/i.test(vocalText)) return 'Squeak';
  if (/(低语|耳语|whisper)/i.test(vocalText)) return 'Whisper';
  if (/(笑|laugh)/i.test(vocalText)) return 'Laugh';
  if (/(嘶嘶|吐信|hiss)/i.test(vocalText)) return 'Hiss';
  if (/(咆哮|怒吼|roar|growl)/i.test(vocalText)) return 'Roar';
  if (/(尖叫|惊叫|scream|shriek)/i.test(vocalText)) return 'Scream';
  if (/(嚎叫|长啸|howl)/i.test(vocalText)) return 'Howl';
  return 'Cry';
};

const normalizeJinnRequirementItems = (items: any[]) => items.map((item) => {
  const normalizedFilename = normalizeJinnEngineeringName(item?.filename);
  const vocalAction = inferJinnVocalAction(item);
  const filename = vocalAction
    ? normalizedFilename.replace(/_(?:Hit|Frightened|BeFrightened|Scared|Startled|Surprised|Reaction|React|BeAttacked)(?=_(?:\d+)$|$)/i, `_${vocalAction}`)
    : normalizedFilename;
  const eventName = normalizeJinnEngineeringName(item?.event_name);
  return {
    ...item,
    filename: filename || item?.filename || '',
    // Jinn requires the event ID to copy the resource filename exactly.
    event_name: filename || eventName || item?.event_name || '',
  };
});

const SUNNY_ISLAND_PREFIXES: Record<string, string> = {
  ani: 'Ani',
  tool: 'Tool',
  pet: 'Pet',
  char: 'Char',
  music: 'Music',
  npc: 'Npc',
  fwsh: 'FWSH',
};

const normalizeSunnyIslandEngineeringName = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const extension = trimmed.match(/(\.[a-z0-9]{1,8})$/i)?.[1] || '';
  const normalized = trimmed
    .slice(0, extension ? -extension.length : undefined)
    .replace(/[\\/\s-]+/g, '_')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^sfx_+/i, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) return '';
  const segments = normalized.split('_').filter(Boolean);
  const prefix = SUNNY_ISLAND_PREFIXES[segments[0].toLowerCase()];
  if (prefix) segments[0] = prefix;
  return `${segments.map((segment, index) => {
    if (index === 0 && prefix === 'FWSH') return segment;
    if (/^\d+$/.test(segment)) return segment;
    return `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`;
  }).join('_')}${extension}`;
};

const normalizeSunnyIslandRequirementItems = (items: any[]) => items.map((item) => {
  const filename = normalizeSunnyIslandEngineeringName(item?.filename);
  return {
    ...item,
    filename: filename || item?.filename || '',
    event_name: filename || normalizeSunnyIslandEngineeringName(item?.event_name) || item?.event_name || '',
  };
});

const normalizeAvatarEngineeringName = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const normalized = value
    .trim()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[\\/]+/g, '_')
    .replace(/\s+/g, '_');
  const prefix = normalized.match(/^audio_avatar_(show|bgm)_/i);
  if (!prefix) return '';
  const remainder = normalized.slice(prefix[0].length);
  const segments = remainder.split('_').filter(Boolean);
  if (segments.length < 3) return '';
  const suffix = segments.pop() || '';
  const costumeId = segments.pop() || '';
  const costumeName = segments.map(segment => segment ? `${segment.charAt(0).toUpperCase()}${segment.slice(1)}` : segment).join('_');
  const normalizedSuffix = suffix.toLowerCase() === 'double' ? 'Double' : suffix.toLowerCase() === 'girl' ? 'Girl' : suffix.toLowerCase() === 'boy' ? 'Boy' : '';
  if (!costumeName || !costumeId || !normalizedSuffix) return '';
  if (prefix[1].toLowerCase() === 'show' && normalizedSuffix === 'Double') return '';
  return `audio_avatar_${prefix[1].toLowerCase()}_${costumeName}_${costumeId}_${normalizedSuffix}`;
};

const isAvatarEngineeringName = (value: string) => (
  /^(?:audio_avatar_show_.+_(Boy|Girl)|audio_avatar_bgm_.+_(Boy|Girl|Double))$/.test(value)
);

const normalizeAvatarRequirementItems = (items: any[]) => items.map((item) => {
  const filename = normalizeAvatarEngineeringName(item?.filename);
  if (!isAvatarEngineeringName(filename)) return item;
  const normalizedItem = {
    ...item,
    filename,
  };
  if (typeof item?.event_name === 'string') {
    normalizedItem.event_name = filename;
  }
  return normalizedItem;
});

export default function SfxRequirements({ hasGeminiKey, assistantRequest = null }: SfxRequirementsProps) {
  const [templateType, setTemplateType] = useState<TemplateType>('game_sfx_general');
  const [selectedProject, setSelectedProject] = useState<ProjectOption>('');
  const [columnWidthsByTemplate, setColumnWidthsByTemplate] = useState<Record<TemplateType, number[]>>(DEFAULT_COLUMN_WIDTHS);
  const [inputText, setInputText] = useState('');
  const [rowsByTemplate, setRowsByTemplate] = useState<Record<TemplateType, any[]>>(() => ({
    game_sfx_general: [],
    game_sfx_middleware: [],
    voiceover_general: [],
    voiceover_multilang: [],
  }));
  const [draftByTemplate, setDraftByTemplate] = useState<Record<TemplateType, boolean>>({
    game_sfx_general: false,
    game_sfx_middleware: false,
    voiceover_general: false,
    voiceover_multilang: false,
  });
  
  // Reference upload states
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);

  // Loading & Error states
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('已根据您的要求完美扩充并格式化。您可直接在下方表格中修改任何单元格！');
  const [activeGenerateMode, setActiveGenerateMode] = useState<GenerateMode>('replace');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const consumedAssistantRequestRef = useRef<string | null>(null);
  const submittedInputByTemplateRef = useRef<Record<TemplateType, string>>({
    game_sfx_general: '',
    game_sfx_middleware: '',
    voiceover_general: '',
    voiceover_multilang: '',
  });
  const columnResizeRef = useRef<{ templateType: TemplateType; index: number; startX: number; startWidth: number } | null>(null);
  const [resizingColumn, setResizingColumn] = useState<number | null>(null);
  const rows = rowsByTemplate[templateType] || [];
  const hasCurrentRequirementDraft = draftByTemplate[templateType] || false;
  const selectedProjectName = PROJECT_OPTIONS.find(project => project.id === selectedProject)?.name || null;
  const currentColumnWidths = getColumnWidthsForTemplate(columnWidthsByTemplate, templateType);

  useEffect(() => {
    if (!success || rows.length === 0) return;
    const table = document.getElementById('req-table-element');
    if (!table) return;
    const frame = window.requestAnimationFrame(() => {
      table.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [success, rows.length, templateType]);

  useEffect(() => {
    if (resizingColumn === null) return;

    const handlePointerMove = (event: PointerEvent) => {
      const resize = columnResizeRef.current;
      if (!resize) return;
      const width = Math.max(
        resize.index === 0 ? MIN_COLUMN_WIDTH : MIN_COLUMN_WIDTH + 8,
        Math.min(MAX_COLUMN_WIDTH, resize.startWidth + event.clientX - resize.startX),
      );
      setColumnWidthsByTemplate(previous => {
        const current = previous[resize.templateType] || [];
        if (current[resize.index] === width) return previous;
        const next = [...current];
        next[resize.index] = width;
        return { ...previous, [resize.templateType]: next };
      });
    };

    const finishResize = () => {
      columnResizeRef.current = null;
      setResizingColumn(null);
    };

    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);
    return () => {
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
    };
  }, [resizingColumn]);

  useEffect(() => {
    if (!assistantRequest || consumedAssistantRequestRef.current === assistantRequest.id) return;
    consumedAssistantRequestRef.current = assistantRequest.id;
    if (assistantRequest.template) setTemplateType(assistantRequest.template);
    setInputText(assistantRequest.prompt);
    setError(null);
    setSuccess(false);
    setSuccessMessage('已将智能助手识别出的内容写入需求描述，请确认后生成需求表。');
  }, [assistantRequest]);

  const setRowsForTemplate = (
    type: TemplateType,
    nextRowsOrUpdater: any[] | ((previousRows: any[]) => any[]),
    isDraft?: boolean,
  ) => {
    setRowsByTemplate(prev => {
      const previousRows = prev[type] || [];
      const nextRows = typeof nextRowsOrUpdater === 'function'
        ? nextRowsOrUpdater(previousRows)
        : nextRowsOrUpdater;
      return {
        ...prev,
        [type]: nextRows,
      };
    });
    if (typeof isDraft === 'boolean') {
      setDraftByTemplate(prev => ({
        ...prev,
        [type]: isDraft,
      }));
    }
  };

  const setCurrentRows = (
    nextRowsOrUpdater: any[] | ((previousRows: any[]) => any[]),
    isDraft?: boolean,
  ) => {
    setRowsForTemplate(templateType, nextRowsOrUpdater, isDraft);
  };

  // Auto-switch rows when changing template type if they haven't been customized, or let user reset
  const handleTemplateChange = (type: TemplateType) => {
    setTemplateType(type);
    setSuccess(false);
    setSuccessMessage('已切换模板，之前生成的其它模板需求已保留。');
  };

  const handleColumnResizeStart = (event: React.PointerEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    columnResizeRef.current = {
      templateType,
      index,
      startX: event.clientX,
      startWidth: currentColumnWidths[index] || 140,
    };
    setResizingColumn(index);
  };

  const handleProjectChange = (project: ProjectOption) => {
    setSelectedProject(project);
    if (project === 'jinn' && templateType !== 'game_sfx_middleware') {
      handleTemplateChange('game_sfx_middleware');
      setSuccessMessage('已切换到 FMOD / Wwise 引擎中间件需求表，适配 Jinn 项目。');
    }
  };

  // Restore defaults
  const handleRestoreDefaults = () => {
    const defaultRows = DEMO_ROWS[templateType].map(row => ({ ...row }));
    const normalizedRows = selectedProject === 'jinn'
      ? normalizeJinnRequirementItems(defaultRows)
      : selectedProject === 'avatar'
        ? normalizeAvatarRequirementItems(defaultRows)
        : selectedProject === 'sunny_island'
          ? normalizeSunnyIslandRequirementItems(defaultRows)
        : normalizeGeneralRequirementItems(defaultRows);
    setCurrentRows(normalizedRows, false);
    setSuccess(false);
    setSuccessMessage('已恢复当前模板的示例内容。');
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const processReferenceFile = (file: File, source: 'upload' | 'drop' | 'paste' = 'upload') => {
    if (!isSupportedReferenceFile(file)) {
      setError('只支持上传图片/截图、音频或视频文件。');
      return;
    }
    if (file.size > MAX_REFERENCE_FILE_BYTES) {
      setError('参考文件不能超过 80MB。视频建议先压缩或截取关键片段后再上传。');
      return;
    }
    setError(null);
    setPasteMessage(source === 'paste' ? '已从剪贴板粘贴图片，可以直接生成/优化需求表。' : null);
    setScreenshot(file);
    if (screenshotPreview) {
      URL.revokeObjectURL(screenshotPreview);
    }
    const previewUrl = URL.createObjectURL(file);
    setScreenshotPreview(previewUrl);

    // Read as base64
    const reader = new FileReader();
    reader.onload = () => {
      setScreenshotBase64(reader.result as string);
    };
    reader.onerror = () => {
      setError('参考文件读取失败，请重新上传。');
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processReferenceFile(e.dataTransfer.files[0], 'drop');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processReferenceFile(e.target.files[0], 'upload');
    }
  };

  const getClipboardImageFile = (clipboardData: DataTransfer | null): File | null => {
    if (!clipboardData) return null;

    const clipboardItems = Array.from(clipboardData.items || []);
    const imageItem = clipboardItems.find(item => item.kind === 'file' && item.type.startsWith('image/'));
    const pastedFile = imageItem?.getAsFile();
    if (pastedFile) {
      const extension = pastedFile.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      return new File(
        [pastedFile],
        `pasted-requirements-screenshot-${Date.now()}.${extension}`,
        { type: pastedFile.type || 'image/png' },
      );
    }

    const clipboardFiles = Array.from(clipboardData.files || []);
    return clipboardFiles.find(file => file.type.startsWith('image/')) || null;
  };

  const handlePasteScreenshot = (e: React.ClipboardEvent | ClipboardEvent) => {
    const imageFile = getClipboardImageFile(e.clipboardData);
    if (!imageFile) return;
    e.preventDefault();
    processReferenceFile(imageFile, 'paste');
  };

  const handleRemoveScreenshot = () => {
    setScreenshot(null);
    if (screenshotPreview) {
      URL.revokeObjectURL(screenshotPreview);
    }
    setScreenshotPreview(null);
    setScreenshotBase64(null);
    setPasteMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    const handleWindowPaste = (event: ClipboardEvent) => {
      handlePasteScreenshot(event);
    };
    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [screenshotPreview]);

  // Table rows actions
  const handleCellChange = (rowIndex: number, key: string, value: string | number) => {
    const updated = [...rows];
    updated[rowIndex] = {
      ...updated[rowIndex],
      [key]: value
    };
    setCurrentRows(updated, true);
  };

  const handleAddRow = () => {
    const currentKeys = TEMPLATE_INFO[templateType].keys;
    const newIndex = rows.length > 0 ? Math.max(...rows.map(r => Number(r.index) || 0)) + 1 : 1;
    
    const newRow: any = { index: newIndex };
    currentKeys.forEach(key => {
      if (key !== 'index') {
        if (key === 'audio_type') {
          newRow[key] = "SFX";
        } else if (key === 'filename') {
          newRow[key] = templateType.startsWith('voiceover') ? `Vo_Character_New_${newIndex}` : `Sfx_Module_New_${newIndex}`;
        } else if (key === 'event_name') {
          newRow[key] = `event:/SFX/Module/new_${newIndex}`;
        } else if (key === 'duration' || key === 'duration_logic') {
          newRow[key] = "1s";
        } else if (key === 'script' || key === 'tone') {
          newRow[key] = "-";
        } else if (key === 'distance_3d') {
          newRow[key] = "20";
        } else {
          newRow[key] = "";
        }
      }
    });

    setCurrentRows([...rows, newRow], true);
  };

  const handleDeleteRow = (rowIndex: number) => {
    const updated = rows.filter((_, idx) => idx !== rowIndex).map((row, idx) => ({
      ...row,
      index: idx + 1 // Re-index neatly
    }));
    setCurrentRows(updated, updated.length > 0);
  };

  const handleClearTable = () => {
    setCurrentRows([], false);
    setSuccess(false);
  };

  const normalizeGeneratedRows = (items: any[], startIndex: number, type: TemplateType = templateType) => {
    const currentKeys = TEMPLATE_INFO[type].keys;
    const orderedItems = type === 'game_sfx_general'
      ? sortGeneralAudioItemsByType(items)
      : items;
    return orderedItems.map((item, itemIndex) => {
      const normalizedRow: any = { index: startIndex + itemIndex };
      currentKeys.forEach(key => {
        if (key === 'index') return;
        if (type === 'game_sfx_general' && key === 'audio_type') {
          normalizedRow[key] = inferGeneralAudioType(item);
        } else if (type === 'game_sfx_general' && key === 'script') {
          const legacyScriptTone = splitScriptToneValue(item?.script_tone);
          const script = String(item?.script ?? '').trim();
          normalizedRow[key] = script || legacyScriptTone.script || (inferGeneralAudioType(item) === 'VO' ? '' : '-');
        } else if (type === 'game_sfx_general' && key === 'tone') {
          const legacyScriptTone = splitScriptToneValue(item?.script_tone);
          const tone = String(item?.tone ?? '').trim();
          normalizedRow[key] = tone || legacyScriptTone.tone || (inferGeneralAudioType(item) === 'VO' ? '' : '-');
        } else {
          normalizedRow[key] = item?.[key] ?? '';
        }
      });
      return normalizedRow;
    });
  };

  const getVideoDurationFromFile = (file: File): Promise<number> => new Promise((resolve) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 30;
      cleanup();
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      resolve(30);
    };
    video.src = objectUrl;
  });

  const uploadRequirementVideoForSubtitleAnalysis = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/sfx/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || '视频上传失败，无法读取字幕配音需求。');
    }
    if (!data?.fileName) {
      throw new Error('视频上传后未返回文件名，无法读取字幕配音需求。');
    }
    return String(data.fileName);
  };

  const createVoRowsFromDubbingClips = (clips: any[]) => {
    const dubbingClips = clips
      .filter(clip => clip?.trackId === 'dubbing' && String(clip?.text || '').trim())
      .sort((left, right) => Number(left.subtitleStartTime ?? left.startTime ?? 0) - Number(right.subtitleStartTime ?? right.startTime ?? 0));

    return dubbingClips.map((clip, index) => {
      const cueIndex = String(index + 1).padStart(2, '0');
      const speaker = String(clip.speaker || 'subtitle').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'subtitle';
      const start = Number(clip.subtitleStartTime ?? clip.startTime ?? 0);
      const end = Number(clip.subtitleEndTime ?? (start + Number(clip.duration || 0)));
      const duration = Math.max(0, end - start);
      const text = String(clip.text || '').trim();
      return {
        index: index + 1,
        audio_type: 'VO',
        filename: `vo_${speaker}_subtitle_${cueIndex}`,
        duration_logic: `${duration > 0 ? `${duration.toFixed(2)}s` : '按字幕时长'}, 字幕配音`,
        scene: `视频字幕 ${cueIndex}，${start.toFixed(2)}s-${end.toFixed(2)}s`,
        description: `根据视频画面字幕生成的配音需求，角色/说话人：${clip.speaker || 'unknown'}。需匹配画面语境、字幕节奏和原始情绪。`,
        script: text,
        tone: '结合画面表情、动作与剧情情绪自然演绎',
        remarks: `字幕ID：${clip.subtitleId || `subtitle-${cueIndex}`}；时间依据：${clip.timingSource || 'subtitle'}；后续制作时建议按字幕出现/消失边界控制口型与语速。`,
        video_link: screenshot?.name || '上传视频',
      };
    });
  };

  const extractVideoSubtitleVoRows = async (file: File) => {
    if (!file.type.startsWith('video/')) return [];
    setLoadingStep(1);
    const [fileName, videoDuration] = await Promise.all([
      uploadRequirementVideoForSubtitleAnalysis(file),
      getVideoDurationFromFile(file),
    ]);
    setLoadingStep(2);
    const response = await fetch('/api/video/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName,
        videoDuration,
        bgmEnabled: false,
        sfxEnabled: false,
        dubbingEnabled: true,
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || '视频字幕配音需求识别失败。');
    }
    return createVoRowsFromDubbingClips(Array.isArray(data?.clips) ? data.clips : []);
  };

  const mergeGeneralRowsWithDetectedVoRows = (items: any[], voRows: any[]) => {
    if (voRows.length === 0) return items;
    const existingVoTexts = new Set(
      items
        .filter(item => inferGeneralAudioType(item) === 'VO')
        .map(item => normalizeRequirementText(item.script || item.script_tone || item.description || item.scene)),
    );
    const uniqueVoRows = voRows.filter(row => {
      const normalizedText = normalizeRequirementText(row.script || row.script_tone);
      if (!normalizedText || existingVoTexts.has(normalizedText)) return false;
      existingVoTexts.add(normalizedText);
      return true;
    });
    return [...items, ...uniqueVoRows];
  };

  // Generate / Optimize handler using Gemini model
  const handleGenerate = async (mode: GenerateMode = 'replace') => {
    if (!TEMPLATE_INFO[templateType]) {
      setError('请先选择一个需求表模板。模板是必选项，文字描述和图片资料都只是可选补充。');
      return;
    }

    if (screenshot && !screenshotBase64) {
      setError('参考文件还在读取中，请稍等一秒后再生成。');
      return;
    }

    if (!hasGeminiKey) {
      setError('GEMINI_API_KEY 未配置，请前往设置页面或 Secrets 面板添加。');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);
    setActiveGenerateMode(mode);
    setLoadingStep(0);
    const requestTemplateType = templateType;
    const requestReferenceFile = screenshot;
    const requestReferenceBase64 = screenshotBase64;
    const requestExistingRows = mode === 'append'
      ? rowsByTemplate[requestTemplateType] || []
      : [];
    const requestExistingItems = mode === 'append'
      ? createExistingRequirementSummary(requestExistingRows, requestTemplateType)
      : [];
    const currentInputText = inputText.trim();
    const lastSubmittedInputText = submittedInputByTemplateRef.current[requestTemplateType] || '';
    const appendAddedInputTextFromHistory = mode === 'append'
      ? getAddedRequirementText(currentInputText, lastSubmittedInputText)
      : '';
    const appendAddedInputText = appendAddedInputTextFromHistory
      || (mode === 'append' ? getUncoveredRequirementText(currentInputText, requestExistingRows, requestTemplateType) : '');
    const requestInputText = mode === 'append' && appendAddedInputText
      ? `继续添加模式：本次用户新补充的需求描述如下，请优先只根据这些新补充内容生成新行，不要重复当前表格已有需求。\n${appendAddedInputText}`
      : currentInputText;

    // Start automated loading step simulator
    const interval = setInterval(() => {
      setLoadingStep(prev => (prev < LOADING_STEPS.length - 1 ? prev + 1 : prev));
    }, 4500);

    try {
      let imageObj = null;
      if (requestReferenceBase64 && requestReferenceFile) {
        imageObj = {
          data: requestReferenceBase64,
          mimeType: requestReferenceFile.type
        };
      }

      const detectedVoRowsPromise = requestTemplateType === 'game_sfx_general'
        && requestReferenceFile?.type.startsWith('video/')
        ? extractVideoSubtitleVoRows(requestReferenceFile)
        : Promise.resolve([]);

      const [response, detectedVoRows] = await Promise.all([
        generateSfxRequirements(
          requestInputText,
          imageObj,
          requestTemplateType,
          selectedProjectName,
          requestExistingItems,
        ),
        detectedVoRowsPromise,
      ]);
      
      if (mode === 'append' && response && Array.isArray(response.items) && response.items.length === 0) {
        setSuccessMessage('没有追加新需求：本次没有识别到区别于当前表格的新条目。请补充新的文字描述或上传新的参考文件后再继续添加。');
        setSuccess(true);
      } else if (response && Array.isArray(response.items) && response.items.length > 0) {
        const normalizedItems = simplifySingletonFilenameSuffixes(response.items);
        const projectAwareItems = selectedProject === 'jinn'
          ? normalizeJinnRequirementItems(response.items)
          : selectedProject === 'avatar'
            ? normalizeAvatarRequirementItems(normalizedItems)
            : selectedProject === 'sunny_island'
              ? normalizeSunnyIslandRequirementItems(normalizedItems)
            : normalizedItems;
        const sourceItemCount = Number(response.sourceItemCount);
        const isTableReference = Boolean(
          requestReferenceFile
          && requestReferenceFile.type.startsWith('image/')
          && Number.isInteger(sourceItemCount)
          && sourceItemCount > 0,
        );
        const countLockedItems = isTableReference && sourceItemCount < projectAwareItems.length
          ? projectAwareItems.slice(0, sourceItemCount)
          : projectAwareItems;
        const mergedItems = mergeGeneralRowsWithDetectedVoRows(
          countLockedItems,
          detectedVoRows,
        );
        const generatedItems = selectedProject === 'jinn'
          ? normalizeJinnRequirementItems(mergedItems)
          : selectedProject === 'avatar'
            ? normalizeAvatarRequirementItems(mergedItems)
            : selectedProject === 'sunny_island'
              ? normalizeSunnyIslandRequirementItems(mergedItems)
            : normalizeGeneralRequirementItems(mergedItems);
        if (mode === 'append') {
          const uniqueGeneratedItems = filterNewRequirementItems(generatedItems, requestExistingRows, requestTemplateType);
          const duplicateCount = Math.max(0, generatedItems.length - uniqueGeneratedItems.length);
          if (uniqueGeneratedItems.length === 0) {
            setSuccessMessage(
              duplicateCount > 0
                ? `没有追加新需求：AI 返回的 ${duplicateCount} 条内容都已存在于当前表格中，已自动过滤。请补充新的文字描述或上传新的参考文件后再继续添加。`
                : '没有追加新需求：本次没有识别到区别于当前表格的新条目。请补充新的文字描述或上传新的参考文件后再继续添加。',
            );
          } else {
            setRowsForTemplate(requestTemplateType, prevRows => {
              const safeUniqueItems = filterNewRequirementItems(uniqueGeneratedItems, prevRows, requestTemplateType);
              return [
                ...prevRows,
                ...normalizeGeneratedRows(safeUniqueItems, prevRows.length + 1, requestTemplateType),
              ];
            }, true);
            setSuccessMessage(`已继续添加 ${uniqueGeneratedItems.length} 条新需求到当前表格末尾${duplicateCount > 0 ? `，并自动过滤 ${duplicateCount} 条重复需求` : ''}${isTableReference && sourceItemCount < response.items.length ? `（已按参考表 ${sourceItemCount} 行校正）` : ''}${detectedVoRows.length ? `，其中包含 ${detectedVoRows.length} 条视频字幕配音需求` : ''}。`);
          }
        } else {
          setRowsForTemplate(requestTemplateType, normalizeGeneratedRows(generatedItems, 1, requestTemplateType), true);
          setSuccessMessage(`已生成 ${generatedItems.length} 条需求，并替换为当前这版需求表${isTableReference && sourceItemCount < response.items.length ? `（已按参考表 ${sourceItemCount} 行校正）` : ''}${detectedVoRows.length ? `，其中包含 ${detectedVoRows.length} 条视频字幕配音需求` : ''}。`);
        }
        submittedInputByTemplateRef.current[requestTemplateType] = currentInputText;
        setSuccess(true);
      } else {
        throw new Error('AI 未生成任何需求，请确认服装名和 ID 格式，或检查 Gemini API 配置后重试。');
      }
    } catch (err: any) {
      console.error('Error generating SFX requirements:', err);
      setError(err.message || '生成音效需求表失败，请检查大模型调用状态并重试。');
    } finally {
      clearInterval(interval);
      setLoading(false);
    }
  };

  // Export to CSV UTF-8 with BOM
  const handleExportCSV = () => {
    const info = TEMPLATE_INFO[templateType];
    const headers = info.headers;
    const keys = info.keys;

    // Build lines
    const rowsContent = rows.map(row => {
      return keys.map(key => {
        const rawVal = getRequirementCellValue(row, key);
        const val = String(rawVal !== undefined && rawVal !== null ? rawVal : "");
        // Escape quotes
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',');
    });

    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rowsContent
    ].join('\n');

    // Add BOM marker to make sure Microsoft Excel opens Chinese characters correctly
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.id = 'download-csv-link';
    link.setAttribute('href', url);
    link.setAttribute('download', `音效配乐需求表_${info.name}_${new Date().toISOString().substring(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Clean preview URL on unmount
  useEffect(() => {
    return () => {
      if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    };
  }, [screenshotPreview]);

  const currentTemplate = TEMPLATE_INFO[templateType];
  const hasSelectedTemplate = Boolean(currentTemplate);
  const hasTextSource = inputText.trim().length > 0;
  const hasImageSource = Boolean(screenshot && screenshotBase64);
  const isImageLoading = Boolean(screenshot && !screenshotBase64);
  const canGenerateRequirements = hasSelectedTemplate && !isImageLoading;
  const uploadedReferenceKind = getReferenceFileKind(screenshot);

  return (
    <div id="sfx-requirements-main" className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div id="sfx-req-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <ClipboardList className="text-emerald-600 w-5 h-5" />
            <h2 id="sfx-req-title" className="text-xl font-bold tracking-tight text-slate-800">音效需求表优化</h2>
          </div>
          <p className="text-xs text-slate-500">
            支持输入简短想法，或上传图片/截图、音频、视频参考文件，通过 AI 识别表格、画面、字幕与音乐线索，标准化音频制作需求表。
          </p>
        </div>
      </div>

      {/* Grid Configuration and Screen Upload */}
      <div id="sfx-req-config-grid" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Control Column (8 cols in big screens) */}
        <div className="lg:col-span-8 space-y-6">
          <div id="card-step-1" className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold font-mono border border-emerald-200/50">1</span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-100">必选</span>
                <span className="text-sm font-semibold text-slate-750">选择目标数据表格式模板</span>
              </div>
            </div>

            {/* Template Selector Radio Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(Object.keys(TEMPLATE_INFO) as TemplateType[]).map((type) => {
                const info = TEMPLATE_INFO[type];
                const isSelected = templateType === type;
                return (
                  <button
                    key={type}
                    id={`template-btn-${type}`}
                    onClick={() => handleTemplateChange(type)}
                    className={`flex flex-col text-left p-3.5 rounded-xl border transition-all ${
                      isSelected 
                        ? 'bg-emerald-50/45 border-emerald-500 shadow-sm shadow-emerald-500/5' 
                        : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className={`text-xs font-bold ${isSelected ? 'text-emerald-700' : 'text-slate-700'}`}>{info.name}</span>
                      <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${isSelected ? 'border-emerald-600 bg-emerald-600' : 'border-slate-300 bg-white'}`}>
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-400 leading-relaxed truncate-3-lines">{info.desc}</span>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 border border-slate-200">可选</span>
                <span className="text-xs font-semibold text-slate-700">项目命名风格</span>
                <span className="text-[10px] text-slate-400">后续可补充各项目的命名规则</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  id="project-btn-none"
                  aria-pressed={!selectedProject}
                  onClick={() => handleProjectChange('')}
                  className={`rounded-xl border px-2.5 py-2 text-left transition-all ${
                    !selectedProject
                      ? 'border-emerald-500 bg-emerald-50/45 shadow-sm shadow-emerald-500/5'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <span className={`block text-xs font-bold ${!selectedProject ? 'text-emerald-700' : 'text-slate-700'}`}>不指定项目</span>
                </button>
                {PROJECT_OPTIONS.map(project => {
                  const isSelected = selectedProject === project.id;
                  return (
                    <button
                      type="button"
                      key={project.id}
                      id={`project-btn-${project.id}`}
                      aria-pressed={isSelected}
                      onClick={() => handleProjectChange(project.id)}
                      className={`rounded-xl border px-2.5 py-2 text-left transition-all ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50/45 shadow-sm shadow-emerald-500/5'
                          : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <span className={`block text-xs font-bold ${isSelected ? 'text-emerald-700' : 'text-slate-700'}`}>{project.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Prompt Draft Input Card */}
          <div id="card-step-2" className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold font-mono border border-emerald-200/50">2</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 border border-slate-200">可选</span>
                <span className="text-sm font-semibold text-slate-750">填写需求描述</span>
              </div>
              <HelpCircle className="w-4 h-4 text-slate-400" title="可输入您对音效库的需求想法，AI 将自动融合至表格中" />
            </div>

            <div className="space-y-3">
              <textarea
                id="input-text-prompt"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="例如：生成一份末日丧尸游戏的基础音效表，包含UI按钮声、撕咬声、沉重脚步、警报器、电锯启动声以及低沉的背景音乐，并且帮我规范化英文命名与技术实现细节..."
                className="w-full h-28 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 focus:bg-white transition-all resize-none leading-relaxed"
              />
            </div>
          </div>
        </div>

        {/* Right Drag-and-Drop Column (4 cols in big screens) */}
        <div className="lg:col-span-4">
          <div id="card-screenshot" className="bg-white border border-slate-200 rounded-2xl p-5 h-full flex flex-col justify-between space-y-4 shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 shrink-0">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold font-mono border border-emerald-200/50">3</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 border border-slate-200">可选</span>
              <span className="text-sm font-semibold text-slate-750">上传参考文件（可选）</span>
            </div>

            {/* Drag & Drop Stage */}
            <div
              id="dropzone-screenshot"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onPaste={handlePasteScreenshot}
              onClick={() => fileInputRef.current?.click()}
              tabIndex={0}
              role="button"
              aria-label="上传、拖拽或粘贴参考文件"
              className={`flex-1 min-h-[170px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-4 text-center cursor-pointer transition-all ${
                isDragging 
                  ? 'border-emerald-500 bg-emerald-50' 
                  : screenshotPreview 
                    ? 'border-slate-200 bg-slate-50/50' 
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/55'
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*,audio/*,video/*"
                className="hidden"
              />

              {!screenshotPreview ? (
                <div className="space-y-2.5">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
                    <Upload className="w-5 h-5 text-slate-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-700">拖拽或上传参考文件到此</p>
                    <p className="text-[10px] text-slate-400 mt-1">支持图片/截图、音频、视频；图片也可 Ctrl+V 粘贴</p>
                  </div>
                </div>
              ) : (
                <div className="relative w-full h-full flex flex-col items-center justify-center">
                  <div className="relative group overflow-hidden rounded-lg border border-slate-200">
                    {screenshot?.type.startsWith('image/') ? (
                      <img
                        src={screenshotPreview}
                        alt="Uploaded reference preview"
                        className="max-h-[120px] object-contain"
                      />
                    ) : (
                      <div className="min-h-[104px] min-w-[180px] flex flex-col items-center justify-center gap-2 bg-white px-6 py-5 text-slate-600">
                        <FileText className="w-7 h-7 text-emerald-600" />
                        <span className="text-[11px] font-bold">{uploadedReferenceKind}</span>
                        <span className="max-w-[160px] truncate text-[10px] text-slate-400">{screenshot?.name}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-[10px] font-semibold text-white">点击更换文件</span>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full text-[10px] text-slate-700">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span className="max-w-[120px] truncate">{screenshot?.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveScreenshot();
                      }}
                      className="p-0.5 hover:text-red-500 transition-colors"
                      title="移除文件"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              参考文件不是必填：图片/截图用于识别表格或画面；音频按 BGM/音乐参考分析；视频只分析画面与字幕，默认忽略视频内音频。
            </p>
            {pasteMessage && (
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>{pasteMessage}</span>
              </div>
            )}

            {/* Run Generation Button Action */}
            <div className="pt-2 shrink-0">
              <button
                id="btn-generate-requirements"
                disabled={loading || !canGenerateRequirements}
                onClick={() => handleGenerate('replace')}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:from-slate-100 disabled:to-slate-200 text-white font-semibold text-xs py-3 rounded-xl transition-all shadow-md shadow-emerald-500/5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>{activeGenerateMode === 'append' ? 'AI 正在继续追加需求...' : 'AI 正在全力构思与排版...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-white" />
                    <span>一键智能化生成/优化需求表</span>
                  </>
                )}
              </button>
              {rows.length > 0 && hasCurrentRequirementDraft && (
                <button
                  id="btn-append-requirements"
                  disabled={loading || !canGenerateRequirements}
                  onClick={() => handleGenerate('append')}
                  className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-xs font-semibold text-emerald-700 transition-all hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  title="保留当前表格，把新上传或新输入的一批需求追加到表格末尾"
                >
                  {loading && activeGenerateMode === 'append' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  <span>继续添加需求</span>
                </button>
              )}
              {isImageLoading && (
                <p className="text-[9px] text-amber-500 text-center mt-1.5">
                  参考文件正在读取中，读完后即可生成。
                </p>
              )}
              {!isImageLoading && !hasTextSource && !hasImageSource && (
                <p className="text-[9px] text-slate-400 text-center mt-1.5">
                  已选择模板。可直接生成标准表，也可补充文字描述、图片、音频或视频后再生成。
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Loading Steps Screen overlay / progress indicator */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="bg-white/95 border border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center space-y-5 shadow-2xl"
          >
            <div className="relative">
              <div className="w-12 h-12 rounded-full border-2 border-emerald-500/20 border-t-emerald-600 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-emerald-600 animate-pulse" />
              </div>
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-bold text-slate-800">AI 音频设计师正在全力处理中</p>
              <p className="text-[11px] text-emerald-600 font-mono tracking-wider animate-pulse">
                {LOADING_STEPS[loadingStep]}
              </p>
            </div>
            <p className="text-[10px] text-slate-400 max-w-sm text-center leading-relaxed">
              Gemini 正在针对参考文件进行多模态识别与高级转译。为了确保技术参数、字幕与配音语境的准确性，可能需要 15-30 秒的时间。
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error / Alert Bar */}
      {error && (
        <div id="req-error-alert" className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-red-700">处理失败</h4>
            <p className="text-[10px] text-red-600/80 mt-1 leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {/* Success Notification Bar */}
      {success && (
        <div id="req-success-alert" className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <div>
              <h4 className="text-xs font-bold text-emerald-700">生成成功！</h4>
              <p className="text-[10px] text-emerald-600">{successMessage}</p>
            </div>
          </div>
          <button
            onClick={() => setSuccess(false)}
            className="text-emerald-700 hover:text-emerald-800 text-[10px] font-bold"
          >
            知道了
          </button>
        </div>
      )}

      {/* Main Requirement Sheet Interactive Table */}
      <div id="card-table-stage" className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
        {/* Table Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>{currentTemplate.name}</span>
              <span className="text-[10px] bg-slate-55 text-slate-500 border border-slate-200 px-2 py-0.5 rounded-full font-normal">
                {rows.length} 个条目
              </span>
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
              编辑下方任意输入框即可动态更改内容，双击/点击即可修改、调整、补充或翻译。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              id="btn-add-row"
              onClick={handleAddRow}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-850 rounded-xl text-[11px] font-semibold transition-all border border-slate-200"
            >
              <Plus className="w-3 h-3 text-emerald-600" />
              <span>添加行</span>
            </button>
            <button
              id="btn-clear-table"
              onClick={handleClearTable}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-[11px] font-semibold transition-all border border-red-100"
              title="清空当前表格"
            >
              <Trash2 className="w-3 h-3 text-red-500" />
              <span>清空</span>
            </button>
            <div className="w-[1px] h-4 bg-slate-250 mx-1" />
            <button
              id="btn-export-csv"
              disabled={rows.length === 0}
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl text-[11px] font-bold transition-all shadow-sm"
              title="直接导出符合 Excel 国标的 CSV 格式表格"
            >
              <Download className="w-3 h-3" />
              <span>直接导出下载</span>
            </button>
          </div>
        </div>

        {/* Scrollable Table Stage */}
        <div className={`overflow-x-auto w-full custom-scrollbar border border-slate-200 rounded-xl bg-white ${resizingColumn !== null ? 'select-none' : ''}`}>
          {rows.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center space-y-3">
              <ClipboardList className="w-10 h-10 text-slate-200" />
              <div>
                <p className="text-xs font-semibold text-slate-400">表格内容为空</p>
                <p className="text-[10px] text-slate-400 mt-1">您可点击 “添加行” 按钮手动录入，或使用上方 AI 自动一键智能生成</p>
              </div>
              <button
                onClick={handleRestoreDefaults}
                className="px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all"
              >
                导入示例模板行
              </button>
            </div>
          ) : (
            <table id="req-table-element" className="w-full text-left border-collapse table-fixed min-w-[800px]">
              <colgroup>
                {currentTemplate.keys.map((key, idx) => (
                  <col
                    key={key}
                    style={{ width: `${currentColumnWidths[idx] || 140}px` }}
                  />
                ))}
                <col style={{ width: '64px' }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {currentTemplate.headers.map((h, idx) => (
                    <th 
                      key={idx} 
                      className={`relative px-3.5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider ${
                        h === "序号" ? "w-[50px]" : ""
                      }`}
                    >
                      {h}
                      <button
                        type="button"
                        aria-label={`调整列宽：${h}`}
                        title={`拖动调整“${h}”列宽`}
                        onPointerDown={(event) => handleColumnResizeStart(event, idx)}
                        className="group absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize touch-none"
                      >
                        <span className="absolute inset-y-2 left-1/2 w-px bg-transparent transition-colors group-hover:bg-emerald-400" />
                      </button>
                    </th>
                  ))}
                  <th className="px-3.5 py-3 text-[10px] font-bold text-slate-500 text-center w-[50px]">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-slate-50/60 transition-colors">
                    {currentTemplate.keys.map((key) => {
                      const value = getRequirementCellValue(row, key);
                      const isIndex = key === 'index';
                      return (
                        <td key={key} className="p-1 px-2.5">
                          {isIndex ? (
                            <span className="text-[11px] font-bold text-slate-400 px-1 font-mono">{value}</span>
                          ) : (
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => handleCellChange(rowIndex, key, e.target.value)}
                              className="w-full bg-transparent border-0 focus:ring-1 focus:ring-emerald-500 focus:bg-white px-2 py-1.5 rounded text-xs text-slate-700 outline-none transition-all placeholder-slate-300"
                              placeholder="..."
                            />
                          )}
                        </td>
                      );
                    })}
                    {/* Delete action cell */}
                    <td className="p-1 px-2.5 text-center">
                      <button
                        onClick={() => handleDeleteRow(rowIndex)}
                        className="p-1.5 text-slate-400 hover:text-red-500 rounded hover:bg-red-50 transition-all"
                        title="删除该行"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Informative Help Card */}
        <div id="footer-export-info" className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-start gap-2.5 shadow-sm">
          <HelpCircle className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
          <p className="text-[10px] text-slate-400 leading-relaxed">
            <strong className="text-slate-600">导出提示：</strong>
            生成的表格完美支持 Microsoft Excel、Google Sheets 及 WPS 等办公软件。
            本工具在导出时已自动附带 <strong className="text-slate-700">UTF-8 with BOM (\ufeff)</strong> 字符编码，解决在 Excel 中直接双击打开中文表格时由于编码不匹配导致的乱码问题，确保您的项目合作体验顺畅无阻。
          </p>
        </div>
      </div>
    </div>
  );
}
