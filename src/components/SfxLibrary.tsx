/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import JSZip from 'jszip';
import { 
  Database, 
  Search, 
  Folder, 
  FolderOpen, 
  Tag, 
  Volume2, 
  Play, 
  Pause, 
  RotateCw, 
  Clock, 
  Copy, 
  Download, 
  Share2, 
  Sparkles, 
  Plus, 
  Trash2, 
  SlidersHorizontal, 
  User, 
  Heart, 
  FileAudio,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Info,
  Check,
  X,
  UploadCloud,
  FileCode,
  Shield,
  HelpCircle,
  Edit2,
  ArrowUp,
  ArrowDown,
  FolderPlus,
  Lock,
  LockOpen,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react';
import { HistoryItem } from '../types';
import { optimizeImportMetadata } from '../services/geminiService';
import { DEFAULT_CATEGORIES, INITIAL_SOUNDS } from '../data/sfxData';
import type { SoundEffect, SubCategory, CategoryGroup } from '../data/sfxData';

interface ImportItem {
  id: string;
  originalFile: File;
  relativePath?: string;
  name: string;
  fileName: string;
  category: string;
  subcategory?: string;
  tags: string[];
  size: string;
  type: string;
  duration: number;
  status?: 'pending' | 'uploading' | 'success' | 'error';
}

interface AudioAssetLibraryStats {
  total: number;
  uploaded: number;
  generated: number;
  external: number;
  library: number;
  byCategory: Record<string, number>;
  byFormat: Record<string, number>;
  bySource: Record<string, number>;
  byKind: Record<string, number>;
  topTags: Array<{ tag: string; count: number }>;
  indexedAt: string;
}

const isUploadedAudioAsset = (sound: SoundEffect) => {
  const url = (sound.url || '').toLowerCase();
  const fileName = (sound.fileName || '').toLowerCase();
  return url.startsWith('/uploads/') || fileName.startsWith('upload_') || fileName.startsWith('audio_');
};

const inferAudioAssetKind = (sound: SoundEffect): 'music' | 'sfx' => {
  const text = `${sound.category || ''} ${sound.subcategory || ''} ${sound.fileName || ''} ${sound.path || ''}`.toLowerCase();
  return text.includes('music') || text.includes('bgm') || text.includes('配乐') || text.includes('音乐') || text.includes('闊充箰')
    ? 'music'
    : 'sfx';
};

export const LOCAL_DEFAULT_CATEGORIES: CategoryGroup[] = [
  {
    id: 'music_all',
    name: '全部音乐',
    english: 'All Music',
    subCategories: [
      { id: 'music_epic', name: '史诗交响', english: 'Epic Orchestral', description: '震撼、恢弘大气，适合BOSS战、宏大叙事' },
      { id: 'music_cyber', name: '赛博电子', english: 'Cyberpunk & Electro', description: '霓虹动感、电声迷幻，适合科幻、格斗、追逐' },
      { id: 'music_chinese', name: '国风仙侠', english: 'Traditional Chinese', description: '笛箫琴瑟、悠扬典雅，适合仙侠、武侠、国风游戏' },
      { id: 'music_casual', name: '日常休闲', english: 'Casual & Happy', description: '欢快跳跃、轻松治愈，适合大厅、模拟经营、解谜' },
      { id: 'music_combat', name: '战斗热血', english: 'Intense Combat', description: '重摇滚、快节奏、金属打击，适合热血动作、射击关卡' },
      { id: 'music_suspense', name: '惊悚悬疑', english: 'Horror & Suspense', description: '诡异低频、不协和和弦，适合解密、惊悚恐怖、迷宫' },
    ]
  },
  {
    id: 'company_sfx',
    name: '公司游戏音效',
    english: 'Company Game SFX',
    subCategories: [
      { id: 'company_classic', name: '历史经典项目', english: 'Classic Projects', description: '以往制作的经典、完结项目的高品质沉淀音效' },
      { id: 'company_melee', name: '近景手感武器', english: 'Melee Weapons', description: '定制打击感动作游戏专属兵器切挥敲击音' },
    ]
  },
  {
    id: 'char_foley',
    name: '角色与拟音',
    english: 'Character & Foley',
    subCategories: [
      { id: 'character_action', name: '角色动作', english: 'Character Action', description: '角色一般行动、攀爬、战术动作' },
      { id: 'footsteps', name: '脚步材质', english: '脚步材质 (Footsteps)', description: '不同材质地面的行走与跑步脚步声' },
      { id: 'foley_movement', name: '肢体装束', english: '肢体装束 (Foley)', description: '护甲摩擦、衣物抖动、战术装备碰撞' },
      { id: 'vocalization', name: '人声拟音', english: '人声拟音 (Vocalization)', description: '角色受击、喘息、跃起、死亡呼喊' },
    ]
  },
  {
    id: 'weapons_combat',
    name: '武器与战斗',
    english: 'Weapons & Combat',
    subCategories: [
      { id: 'melee_weapon', name: '冷兵器砍击', english: '冷兵器砍击 (Melee)', description: '刀剑挥砍、金属碰撞、钝器击打、防守' },
      { id: 'physics_impact', name: '物理碰撞', english: '物理碰撞 (Impact)', description: '物体跌落、物理撞击、碎裂、弹射' },
      { id: 'firearms', name: '枪械与射击', english: '枪械与射击 (Firearms)', description: '各类手枪、步枪点射、换弹、拉栓、机构运转' },
      { id: 'explosions', name: '爆炸与重低音', english: '爆炸与重低音 (Explosion)', description: '破片手雷、重型火炮、火箭弹轰鸣、碎屑掉落' },
    ]
  },
  {
    id: 'magic_skills',
    name: '魔法与奇幻',
    english: 'Magic & Fantasy',
    subCategories: [
      { id: 'elemental_spells', name: '元素魔法', english: '元素魔法 (Elemental)', description: '火焰爆裂、冰冻凝结、闪电链暴击、奥术涌动' },
      { id: 'buff_debuff', name: '增益减益', english: '增益减益 (Buff/Debuff)', description: '神圣治疗、法阵、诅咒减速、复活音效' },
      { id: 'magic_shields', name: '奇幻护盾', english: '奇幻护盾 (Shield)', description: '能量护盾、物理偏斜、结界启动与破裂' },
    ]
  },
  {
    id: 'creatures_monsters',
    name: '怪兽与生物',
    english: 'Creatures & Monsters',
    subCategories: [
      { id: 'monster_vocals', name: '怪兽咆哮', english: '怪兽咆哮 (Growls)', description: '巨兽怒吼、异形低吟、撕咬咀嚼、昆虫爬行声' },
      { id: 'monster_impact', name: '怪物受击', english: '怪物受击 (Impact)', description: '怪物受击、尾部扫击、翅膀煽动、骨骼脆断' },
      { id: 'alien_biology', name: '异形生物', english: '异形生物 (Alien)', description: '酸液喷吐、触手拍击、寄生爬行拟音' },
    ]
  },
  {
    id: 'ambient_nature',
    name: '环境与声景',
    english: 'Ambient & Audio-scapes',
    subCategories: [
      { id: 'natural_ambient', name: '自然环境', english: '自然环境 (Nature)', description: '森林风啸、雨滴落叶、雷暴大雨、海浪拍击' },
      { id: 'space_drone', name: '空间背景', english: '空间背景 (Drone)', description: '飞船舱内低频、废土遗迹风蚀、机械工业背景嗡鸣' },
      { id: 'emitter_sounds', name: '点声源(Emitter)', english: '点声源 (Emitter)', description: '火把燃烧、滴水、蒸汽喷射、机械齿轮咬合' },
    ]
  },
  {
    id: 'system_ui',
    name: '系统与界面',
    english: 'System UI & UX',
    subCategories: [
      { id: 'ui_feedback', name: 'UI 反馈', english: 'UI 反馈 (UX)', description: '按钮点击、菜单切页、滑动条拖拽、Q版弹窗' },
      { id: 'rewards_achievements', name: '胜利奖励', english: '胜利奖励 (Rewards)', description: '关卡胜利、宝箱开启、升级提示、金币掉落' },
      { id: 'warnings_errors', name: '警报失败', english: '警报失败 (Alert)', description: '生命值过低、任务失败、红屏报错、连击打断' },
    ]
  }
];

export const AUDIO_CATEGORIES = DEFAULT_CATEGORIES;

export const LOCAL_INITIAL_SOUNDS: SoundEffect[] = [
  {
    id: 'sfx-company-1',
    name: '公司以往制作：荒野战机飞跃轰鸣',
    fileName: 'sfx_company_classic_fighter_pass_01.wav',
    category: '公司游戏音效',
    subcategory: '历史经典项目',
    tags: ['经典', '公司资产', '载具', '轰鸣', '历史制作'],
    duration: 3.2,
    format: 'WAV',
    size: '720 KB',
    sampleRate: '48.0 kHz',
    channels: 'Stereo',
    designer: '公司音效师_Kevin',
    path: 'assets/sfx/company/sfx_company_classic_fighter_pass_01.wav',
    url: 'https://assets.mixkit.co/active_storage/sfx/1498/1498-84.wav',
  },
  {
    id: 'sfx-company-2',
    name: '公司以往制作：上古神剑出鞘清脆音',
    fileName: 'sfx_company_melee_sword_drawn_01.wav',
    category: '公司游戏音效',
    subcategory: '近景手感武器',
    tags: ['利刃', '金属', '出鞘', '写实', '经典项目'],
    duration: 1.1,
    format: 'WAV',
    size: '290 KB',
    sampleRate: '96.0 kHz',
    channels: 'Mono',
    designer: '公司音效师_Milly',
    path: 'assets/sfx/company/sfx_company_melee_sword_drawn_01.wav',
    url: 'https://assets.mixkit.co/active_storage/sfx/1460/1460-84.wav',
  },
  {
    id: 'sfx-1',
    name: '沉闷重金属撞击音',
    fileName: 'sfx_weapon_impact_metal_heavy_01.wav',
    category: '武器与战斗',
    subcategory: '物理碰撞',
    tags: ['金属', '撞击', '沉闷', '写实', '重击', '物理'],
    duration: 1.2,
    format: 'WAV',
    size: '320 KB',
    sampleRate: '48.0 kHz',
    channels: 'Mono',
    designer: 'AD_Design',
    path: 'assets/sfx/weapons/sfx_weapon_impact_metal_heavy_01.wav',
    url: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-84.wav',
    isFavorite: true,
  },
  {
    id: 'sfx-2',
    name: '科幻脉冲激光枪点射',
    fileName: 'sfx_weapon_firearms_laser_cyber_01.wav',
    category: '武器与战斗',
    subcategory: '枪械火器',
    tags: ['科幻', '尖锐', '激光', '电子', '能量', '枪声'],
    duration: 0.8,
    format: 'WAV',
    size: '240 KB',
    sampleRate: '96.0 kHz',
    channels: 'Stereo',
    designer: 'Gemini_AI',
    path: 'assets/sfx/weapons/sfx_weapon_firearms_laser_cyber_01.wav',
    url: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-84.wav',
  },
  {
    id: 'sfx-3',
    name: 'Q版气泡反馈点击音效',
    fileName: 'sfx_ui_uiclick_bubble_pop_01.mp3',
    category: '系统与界面',
    subcategory: 'UI 反馈',
    tags: ['Q版', '清脆', '点击', '简洁', '可爱', '反馈'],
    duration: 0.4,
    format: 'MP3',
    size: '80 KB',
    sampleRate: '44.1 kHz',
    channels: 'Mono',
    designer: 'AD_Design',
    path: 'assets/sfx/ui/sfx_ui_uiclick_bubble_pop_01.mp3',
    url: 'https://assets.mixkit.co/active_storage/sfx/951/951-84.wav',
  },
  {
    id: 'sfx-4',
    name: '荒野风啸紧张背景声景',
    fileName: 'bgm_ambient_nature_wind_loop_01.wav',
    category: '环境与声景',
    subcategory: '自然环境',
    tags: ['自然', '紧张感', '低频', '风声', 'Loop', '环境'],
    duration: 12.5,
    format: 'WAV',
    size: '2.4 MB',
    sampleRate: '48.0 kHz',
    channels: 'Stereo',
    designer: 'ElevenLabs_Bot',
    path: 'assets/sfx/ambient/bgm_ambient_nature_wind_loop_01.wav',
    url: 'https://assets.mixkit.co/active_storage/sfx/1498/1498-84.wav',
    isFavorite: false,
  },
  {
    id: 'sfx-5',
    name: '复古像素重低音爆炸声',
    fileName: 'sfx_weapon_explosion_retro_boom_01.wav',
    category: '武器与战斗',
    subcategory: '爆炸轰鸣',
    tags: ['爆炸', '恐怖', '电子', '复古', '震撼', '重低音'],
    duration: 1.5,
    format: 'WAV',
    size: '410 KB',
    sampleRate: '44.1 kHz',
    channels: 'Stereo',
    designer: 'Gemini_AI',
    path: 'assets/sfx/weapons/sfx_weapon_explosion_retro_boom_01.wav',
    url: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-84.wav',
  },
  {
    id: 'sfx-6',
    name: '赛博朋克警报环绕音',
    fileName: 'sfx_ui_alert_cyber_siren_01.ogg',
    category: '系统与界面',
    subcategory: '警报失败',
    tags: ['科幻', '紧张感', '电子', '警报', '尖锐', '报错'],
    duration: 4.2,
    format: 'OGG',
    size: '890 KB',
    sampleRate: '48.0 kHz',
    channels: 'Stereo',
    designer: 'ElevenLabs_Bot',
    path: 'assets/sfx/ui/sfx_ui_alert_cyber_siren_01.ogg',
    url: 'https://assets.mixkit.co/active_storage/sfx/2192/2192-84.wav',
  },
  {
    id: 'sfx-7',
    name: '重装战士泥地跑步脚步声',
    fileName: 'sfx_char_footstep_mud_heavy_01.wav',
    category: '角色与拟音',
    subcategory: '脚步材质',
    tags: ['脚步', '泥地', '重装', '写实', '奔跑', '拟音'],
    duration: 1.8,
    format: 'WAV',
    size: '420 KB',
    sampleRate: '48.0 kHz',
    channels: 'Mono',
    designer: 'AD_Design',
    path: 'assets/sfx/foley/sfx_char_footstep_mud_heavy_01.wav',
    url: 'https://assets.mixkit.co/active_storage/sfx/1614/1614-84.wav',
    isFavorite: true,
  },
  {
    id: 'sfx-8',
    name: '圣光奇幻护佑治愈法术',
    fileName: 'sfx_magic_spell_holy_buff_01.wav',
    category: '魔法与奇幻',
    subcategory: '元素魔法',
    tags: ['魔法', '治愈', '舒缓', '奇幻', '圣光', '技能'],
    duration: 2.1,
    format: 'WAV',
    size: '520 KB',
    sampleRate: '48.0 kHz',
    channels: 'Stereo',
    designer: 'Gemini_AI',
    path: 'assets/sfx/magic/sfx_magic_spell_holy_buff_01.wav',
    url: 'https://assets.mixkit.co/active_storage/sfx/2013/2013-84.wav',
  },
  {
    id: 'sfx-9',
    name: '刺客钢刃空气极速切挥',
    fileName: 'sfx_weapon_melee_blade_slash_01.wav',
    category: '武器与战斗',
    subcategory: '冷兵器砍击',
    tags: ['刀剑', '利刃', '挥砍', '金属', '疾风', '打击'],
    duration: 0.6,
    format: 'WAV',
    size: '150 KB',
    sampleRate: '96.0 kHz',
    channels: 'Mono',
    designer: 'AD_Design',
    path: 'assets/sfx/weapons/sfx_weapon_melee_blade_slash_01.wav',
    url: 'https://assets.mixkit.co/active_storage/sfx/1460/1460-84.wav',
  },
  {
    id: 'sfx-10',
    name: '地狱恶魔暴怒低吼拟音',
    fileName: 'sfx_creature_growl_beast_angry_01.wav',
    category: '怪兽与生物',
    subcategory: '怪兽咆哮',
    tags: ['怪兽', '咆哮', '低沉', '野兽', '拟音', '撕咬'],
    duration: 2.5,
    format: 'WAV',
    size: '680 KB',
    sampleRate: '48.0 kHz',
    channels: 'Mono',
    designer: 'ElevenLabs_Bot',
    path: 'assets/sfx/creatures/sfx_creature_growl_beast_angry_01.wav',
    url: 'https://assets.mixkit.co/active_storage/sfx/1677/1677-84.wav',
  },
  {
    id: 'sfx-11',
    name: '神圣天使光之洗礼护盾',
    fileName: 'sfx_magic_shield_angel_light_01.ogg',
    category: '魔法与奇幻',
    subcategory: '奇幻护盾',
    tags: ['护盾', '魔法', '神圣', '守护', '高频', '结界'],
    duration: 1.4,
    format: 'OGG',
    size: '280 KB',
    sampleRate: '44.1 kHz',
    channels: 'Stereo',
    designer: 'Gemini_AI',
    path: 'assets/sfx/magic/sfx_magic_shield_angel_light_01.ogg',
    url: 'https://assets.mixkit.co/active_storage/sfx/1987/1987-84.wav',
  },
  {
    id: 'sfx-12',
    name: '宇宙飞船舱低频空腔(Loop)',
    fileName: 'bgm_ambient_space_room_tone_01.wav',
    category: '环境与声景',
    subcategory: '空间背景',
    tags: ['太空舱', '低频', 'Loop', '飞船', '工业', '声景'],
    duration: 15.0,
    format: 'WAV',
    size: '3.2 MB',
    sampleRate: '48.0 kHz',
    channels: 'Stereo',
    designer: 'ElevenLabs_Bot',
    path: 'assets/sfx/ambient/bgm_ambient_space_room_tone_01.wav',
    url: 'https://assets.mixkit.co/active_storage/sfx/2193/2193-84.wav',
  },
  {
    id: 'sfx-13',
    name: '战役关卡胜利辉煌铜管乐',
    fileName: 'sfx_ui_win_level_complete_01.mp3',
    category: '系统与界面',
    subcategory: '胜利奖励',
    tags: ['胜利', '奖励', '通关', '铜管', '高亢', '游戏反馈'],
    duration: 3.5,
    format: 'MP3',
    size: '350 KB',
    sampleRate: '44.1 kHz',
    channels: 'Stereo',
    designer: 'AD_Design',
    path: 'assets/sfx/ui/sfx_ui_win_level_complete_01.mp3',
    url: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-84.wav',
  },
  {
    id: 'sfx-14',
    name: '天启之怒 史诗管弦战斗曲',
    fileName: 'bgm_music_epic_boss_orchestra_01.mp3',
    category: '全部音乐',
    subcategory: '史诗交响',
    tags: ['史诗', '管弦乐', 'BOSS战', '震撼', '唱腔', '背景音乐'],
    duration: 184.2,
    format: 'MP3',
    size: '4.2 MB',
    sampleRate: '44.1 kHz',
    channels: 'Stereo',
    designer: 'BGM_Composer',
    path: 'assets/music/bgm_music_epic_boss_orchestra_01.mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    isFavorite: true,
  },
  {
    id: 'sfx-15',
    name: '霓虹深渊 赛博朋克重低音',
    fileName: 'bgm_music_cyber_neon_drive_01.mp3',
    category: '全部音乐',
    subcategory: '赛博电子',
    tags: ['赛博朋克', '电音', 'Synthwave', '动感', '重低音', '背景音乐'],
    duration: 215.4,
    format: 'MP3',
    size: '4.9 MB',
    sampleRate: '44.1 kHz',
    channels: 'Stereo',
    designer: 'ElevenLabs_Bot',
    path: 'assets/music/bgm_music_cyber_neon_drive_01.mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  },
  {
    id: 'sfx-16',
    name: '桃源仙境 国风典雅竹笛曲',
    fileName: 'bgm_music_chinese_xianxia_valley_01.mp3',
    category: '全部音乐',
    subcategory: '国风仙侠',
    tags: ['国风', '仙侠', '古风', '竹笛', '悠扬', '唯美', '背景音乐'],
    duration: 195.1,
    format: 'MP3',
    size: '3.8 MB',
    sampleRate: '48.0 kHz',
    channels: 'Stereo',
    designer: 'AD_Design',
    path: 'assets/music/bgm_music_chinese_xianxia_valley_01.mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
  },
  {
    id: 'sfx-17',
    name: '夏日晴空 欢快像素解谜音乐',
    fileName: 'bgm_music_casual_puzzle_sunny_day_01.mp3',
    category: '全部音乐',
    subcategory: '日常休闲',
    tags: ['休闲', '欢快', '像素', '解谜', '轻松', '快乐', '背景音乐'],
    duration: 162.3,
    format: 'MP3',
    size: '3.1 MB',
    sampleRate: '44.1 kHz',
    channels: 'Stereo',
    designer: 'Gemini_AI',
    path: 'assets/music/bgm_music_casual_puzzle_sunny_day_01.mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
  },
  {
    id: 'sfx-18',
    name: '无尽超载 热血重金属战斗',
    fileName: 'bgm_music_combat_metal_overdrive_01.mp3',
    category: '全部音乐',
    subcategory: '战斗热血',
    tags: ['战斗', '热血', '重摇滚', '金属打击', '刺激', '极速', '背景音乐'],
    duration: 178.6,
    format: 'MP3',
    size: '4.1 MB',
    sampleRate: '44.1 kHz',
    channels: 'Stereo',
    designer: 'ElevenLabs_Bot',
    path: 'assets/music/bgm_music_combat_metal_overdrive_01.mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
  },
  {
    id: 'sfx-19',
    name: '黑暗深渊 惊悚悬疑氛围乐',
    fileName: 'bgm_music_suspense_horror_shadow_01.mp3',
    category: '全部音乐',
    subcategory: '惊悚悬疑',
    tags: ['惊悚', '悬疑', '恐怖', '氛围', '低频', '神秘', '背景音乐'],
    duration: 240.5,
    format: 'MP3',
    size: '5.5 MB',
    sampleRate: '48.0 kHz',
    channels: 'Stereo',
    designer: 'BGM_Composer',
    path: 'assets/music/bgm_music_suspense_horror_shadow_01.mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
  }
];

export default function SfxLibrary() {
  // --- States ---
  // Security lock states
  const [isAuthorized, setIsAuthorized] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('OWNER_AUTHORIZED') === 'true';
    }
    return false;
  });

  const checkOwnerPermission = (): boolean => {
    const authorized = localStorage.getItem('OWNER_AUTHORIZED') === 'true';
    if (!authorized) {
      showCustomAlert("需要验证", "此修改操作需要所有者身份验证。请前往“设置”面板并输入您的管理邮箱解锁全部高级权限。");
      return false;
    }
    return true;
  };

  // Sync security authorization reactively
  useEffect(() => {
    const handleStateChange = () => {
      const authorized = localStorage.getItem('OWNER_AUTHORIZED') === 'true';
      setIsAuthorized(authorized);
    };
    window.addEventListener('security-state-changed', handleStateChange);
    return () => {
      window.removeEventListener('security-state-changed', handleStateChange);
    };
  }, []);
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');
  const [expandedGroups, setExpandedGroups] = useState<{ [key: string]: boolean }>({
    'char_foley': true,
    'weapons_combat': true,
    'magic_skills': true,
    'creatures_monsters': true,
    'ambient_nature': true,
    'system_ui': true,
    'music_all': true,
    'company_sfx': true
  });
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchHistory, setSearchHistory] = useState<string[]>(['金属撞击', '科幻激光', 'Q版点击']);
  const [showFilters, setShowFilters] = useState<boolean>(true);
  
  // Custom expandable parent sections
  const [isCompanySfxParentExpanded, setIsCompanySfxParentExpanded] = useState<boolean>(true);
  const [isMusicParentExpanded, setIsMusicParentExpanded] = useState<boolean>(true);
  const [isStandardSfxParentExpanded, setIsStandardSfxParentExpanded] = useState<boolean>(true);

  // Dynamic Categories state
  const [categories, setCategories] = useState<CategoryGroup[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sfx_library_categories');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error("Failed to parse saved categories from localStorage", e);
        }
      }
    }
    return DEFAULT_CATEGORIES;
  });

  // Category management helper states
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingSubCategoryId, setEditingSubCategoryId] = useState<string | null>(null);
  const [editNameInput, setEditNameInput] = useState<string>('');
  const [isAddingSubToId, setIsAddingSubToId] = useState<string | null>(null);
  const [newSubNameInput, setNewSubNameInput] = useState<string>('');
  const [isAddingGroup, setIsAddingGroup] = useState<boolean>(false);
  const [newGroupNameInput, setNewGroupNameInput] = useState<string>('');

  // Multidimensional Filters
  const [filterDuration, setFilterDuration] = useState<string>('全部'); // 全部, <1s, 1-3s, >3s
  const [filterChannel, setFilterChannel] = useState<string>('全部'); // 全部, Mono, Stereo
  const [filterFormat, setFilterFormat] = useState<string>('全部'); // 全部, WAV, OGG, MP3
  const [filterDesigner, setFilterDesigner] = useState<string>('全部'); // 全部, AD_Design, Gemini_AI, ElevenLabs_Bot
  const [filterSampleRate, setFilterSampleRate] = useState<string>('全部'); // 全部, 44.1, 48.0, 96.0

  // Dynamic Sounds state with backend synchronization
  const [sounds, setSounds] = useState<SoundEffect[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sfx_library_sounds');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error("Failed to parse saved sounds from localStorage", e);
        }
      }
    }
    return INITIAL_SOUNDS;
  });

  const isLoadedFromServer = useRef(false);
  const [serverAssetStats, setServerAssetStats] = useState<AudioAssetLibraryStats | null>(null);
  const [isRefreshingAssetIndex, setIsRefreshingAssetIndex] = useState(false);

  const localAssetStats = useMemo<AudioAssetLibraryStats>(() => {
    const byCategory: Record<string, number> = {};
    const byFormat: Record<string, number> = {};
    const bySource: Record<string, number> = {
      uploaded: 0,
      generated: 0,
      external: 0,
      library: 0,
    };
    const byKind: Record<string, number> = {
      music: 0,
      sfx: 0,
    };
    const tagCounts: Record<string, number> = {};

    sounds.forEach(sound => {
      const source = isUploadedAudioAsset(sound)
        ? 'uploaded'
        : (sound.url || '').startsWith('http')
          ? 'external'
          : ((sound.designer || '').toLowerCase().includes('ai') || (sound.designer || '').toLowerCase().includes('gemini') || (sound.designer || '').toLowerCase().includes('elevenlabs'))
            ? 'generated'
            : 'library';
      const kind = inferAudioAssetKind(sound);
      byCategory[sound.category || '未分类'] = (byCategory[sound.category || '未分类'] || 0) + 1;
      byFormat[sound.format || 'UNKNOWN'] = (byFormat[sound.format || 'UNKNOWN'] || 0) + 1;
      bySource[source] = (bySource[source] || 0) + 1;
      byKind[kind] = (byKind[kind] || 0) + 1;
      (sound.tags || []).forEach(tag => {
        if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });

    return {
      total: sounds.length,
      uploaded: bySource.uploaded || 0,
      generated: bySource.generated || 0,
      external: bySource.external || 0,
      library: bySource.library || 0,
      byCategory,
      byFormat,
      bySource,
      byKind,
      topTags: Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([tag, count]) => ({ tag, count })),
      indexedAt: new Date().toISOString(),
    };
  }, [sounds]);

  const assetStats = serverAssetStats && serverAssetStats.total === localAssetStats.total
    ? serverAssetStats
    : localAssetStats;

  const refreshAudioAssetIndex = async () => {
    setIsRefreshingAssetIndex(true);
    try {
      const response = await fetch('/api/audio-assets/reindex', { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.stats) {
        setServerAssetStats(payload.stats);
        showCustomAlert(
          '素材索引已刷新',
          `当前可调取音频素材 ${payload.stats.total} 个，其中本地上传 ${payload.stats.uploaded} 个。`
        );
      }
    } catch (err: any) {
      console.error('Failed to refresh audio asset index:', err);
      setServerAssetStats(localAssetStats);
      showCustomAlert('索引刷新失败', `已使用本地缓存统计继续显示。详情: ${err.message || '未知错误'}`);
    } finally {
      setIsRefreshingAssetIndex(false);
    }
  };

  const fetchJsonIfAvailable = async <T,>(url: string): Promise<T | null> => {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) return null;

    return response.json() as Promise<T>;
  };

  // Load categories and sounds from full-stack backend on mount
  useEffect(() => {
    const loadServerData = async () => {
      try {
        const [catData, soundData, assetStatsData] = await Promise.all([
          fetchJsonIfAvailable<CategoryGroup[]>('/api/sfx/categories'),
          fetchJsonIfAvailable<SoundEffect[]>('/api/sfx/sounds'),
          fetchJsonIfAvailable<AudioAssetLibraryStats>('/api/audio-assets/stats')
        ]);
        if (Array.isArray(catData)) {
          setCategories(catData);
          localStorage.setItem('sfx_library_categories', JSON.stringify(catData));
        }
        if (Array.isArray(soundData)) {
          setSounds(soundData);
          localStorage.setItem('sfx_library_sounds', JSON.stringify(soundData));
        }
        if (assetStatsData) {
          setServerAssetStats(assetStatsData);
        }
      } catch (err) {
        console.error("Failed to load sfx library database from server:", err);
      } finally {
        isLoadedFromServer.current = true;
      }
    };
    loadServerData();
  }, []);

  // Save categories to localStorage and server
  useEffect(() => {
    if (!isLoadedFromServer.current) return;
    localStorage.setItem('sfx_library_categories', JSON.stringify(categories));
    const syncCategories = async () => {
      try {
        await fetch('/api/sfx/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(categories)
        });
      } catch (err) {
        console.error("Failed to sync categories with backend:", err);
      }
    };
    if (categories && categories.length > 0) {
      syncCategories();
    }
  }, [categories]);

  // Save sounds to localStorage and server
  useEffect(() => {
    if (!isLoadedFromServer.current) return;
    localStorage.setItem('sfx_library_sounds', JSON.stringify(sounds));
    const syncSounds = async () => {
      try {
        await fetch('/api/sfx/sounds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sounds)
        });
      } catch (err) {
        console.error("Failed to sync sounds with backend:", err);
      }
    };
    if (sounds && sounds.length > 0) {
      syncSounds();
    }
  }, [sounds]);

  // Edit Sound state
  const [editingSound, setEditingSound] = useState<SoundEffect | null>(null);

  // Add Sound state
  const [isAddSoundModalOpen, setIsAddSoundModalOpen] = useState<boolean>(false);
  const [addSoundForm, setAddSoundForm] = useState<Omit<SoundEffect, 'id'>>({
    name: '全新音效资产',
    fileName: 'sfx_new_effect_01.wav',
    category: '全部音乐',
    subcategory: '史诗交响',
    tags: ['新添加', '自定义'],
    duration: 1.2,
    format: 'WAV',
    size: '120 KB',
    sampleRate: '48.0 kHz',
    channels: 'Stereo',
    designer: 'AD_Design',
    path: 'assets/sfx/sfx_new_effect_01.wav',
    url: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-84.wav',
  });

  // Custom references for uploaded local files
  const uploadedFilesRef = useRef<{ [fileName: string]: File }>({});
  const resolvedBlobUrlsRef = useRef<{ [fileName: string]: string }>({});

  // Helper to open IndexedDB
  const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SfxLibraryDB', 1);
      request.onupgradeneeded = (e) => {
        const db = request.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  // Helper to save a file to IndexedDB
  const saveFileToDB = async (fileName: string, file: File) => {
    try {
      const db = await openDB();
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      store.put(file, fileName);
      return new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.error("Failed to save file to IndexedDB:", e);
    }
  };

  // Helper to load all files from IndexedDB
  const loadFilesFromDB = async () => {
    try {
      const db = await openDB();
      const tx = db.transaction('files', 'readonly');
      const store = tx.objectStore('files');
      const request = store.openCursor();
      request.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          const fileName = cursor.key as string;
          const file = cursor.value as File;
          uploadedFilesRef.current[fileName] = file;
          cursor.continue();
        }
      };
    } catch (e) {
      console.error("Failed to load files from IndexedDB:", e);
    }
  };

  // Load files from DB on mount
  useEffect(() => {
    loadFilesFromDB();
  }, []);

  const getAudioSourceUrl = (sound: SoundEffect) => {
    if (!sound) return '';
    const localFile = uploadedFilesRef.current[sound.fileName] || uploadedFilesRef.current[sound.name];
    if (localFile) {
      const cacheKey = localFile.name + '-' + sound.id;
      if (!resolvedBlobUrlsRef.current[cacheKey]) {
        resolvedBlobUrlsRef.current[cacheKey] = URL.createObjectURL(localFile);
      }
      return resolvedBlobUrlsRef.current[cacheKey];
    }
    if (sound.url) {
      return sound.url;
    }
    return 'https://assets.mixkit.co/active_storage/sfx/2568/2568-84.wav';
  };

  const handleDownloadSingleSound = (sound: SoundEffect) => {
    if (!sound) return;
    const url = getAudioSourceUrl(sound);
    const link = document.createElement('a');
    link.href = url;
    link.download = sound.fileName || `${sound.name}.${sound.format.toLowerCase()}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadFolderAsZip = async (folderName: string, isGroup: boolean) => {
    // Find all sounds that belong to this category or subcategory
    const folderSounds = sounds.filter(sound => {
      if (isGroup) {
        const matchedGroup = categories.find(g => g.name === folderName);
        if (matchedGroup) {
          const subNames = matchedGroup.subCategories.map(s => s.name);
          return sound.category === folderName || subNames.includes(sound.category) || (sound.subcategory && subNames.includes(sound.subcategory));
        }
        return sound.category === folderName;
      } else {
        return sound.category === folderName || sound.subcategory === folderName;
      }
    });

    if (folderSounds.length === 0) {
      showCustomAlert("目录为空", `目录 "${folderName}" 内没有可下载的音效资产。`);
      return;
    }

    setCustomDialog({
      isOpen: true,
      title: "正在打包...",
      message: `正在准备打包下载 "${folderName}" 目录下的 ${folderSounds.length} 个音效文件，请稍候...`,
      isConfirm: false
    });

    try {
      const zip = new JSZip();
      const nameCounts: { [key: string]: number } = {};

      await Promise.all(
        folderSounds.map(async (sound) => {
          try {
            let fileBlob: Blob;
            const resolvedUrl = getAudioSourceUrl(sound);

            if (resolvedUrl.startsWith('blob:')) {
              const localFile = uploadedFilesRef.current[sound.fileName] || uploadedFilesRef.current[sound.name];
              if (localFile) {
                fileBlob = localFile;
              } else {
                const res = await fetch(resolvedUrl);
                fileBlob = await res.blob();
              }
            } else {
              const res = await fetch(resolvedUrl);
              fileBlob = await res.blob();
            }

            let zipFileName = sound.fileName || `${sound.name}.${sound.format.toLowerCase()}`;
            if (nameCounts[zipFileName] !== undefined) {
              nameCounts[zipFileName]++;
              const parts = zipFileName.split('.');
              const ext = parts.pop();
              const base = parts.join('.');
              zipFileName = `${base}_(${nameCounts[zipFileName]}).${ext}`;
            } else {
              nameCounts[zipFileName] = 0;
            }

            zip.file(zipFileName, fileBlob);
          } catch (err) {
            console.error(`Failed to pack sound ${sound.name}:`, err);
          }
        })
      );

      const zipContent = await zip.generateAsync({ type: 'blob' });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipContent);
      link.download = `${folderName}_音效打包_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      setCustomDialog(null);
      // Wait a moment before showing success to allow state update
      setTimeout(() => {
        showCustomAlert("打包成功", `成功打包并下载 "${folderName}" 目录下的 ${folderSounds.length} 个音效文件！`);
      }, 100);
    } catch (error: any) {
      console.error("ZIP packaging error:", error);
      setCustomDialog(null);
      setTimeout(() => {
        showCustomAlert("打包失败", `打包过程中出现错误: ${error.message || '未知错误'}`);
      }, 100);
    }
  };

  const downloadFilteredSoundsAsZip = async () => {
    if (filteredSounds.length === 0) {
      showCustomAlert("列表为空", "当前检索结果中没有可供下载的音效资产。");
      return;
    }

    const zipName = selectedCategory !== '全部' 
      ? `${selectedCategory}_音效检索包` 
      : `游戏音效资产检索包`;

    setCustomDialog({
      isOpen: true,
      title: "正在打包全部检索音效...",
      message: `正在准备打包下载当前检索结果下的 ${filteredSounds.length} 个音效文件，请稍候...`,
      isConfirm: false
    });

    try {
      const zip = new JSZip();
      const nameCounts: { [key: string]: number } = {};

      await Promise.all(
        filteredSounds.map(async (sound) => {
          try {
            let fileBlob: Blob;
            const resolvedUrl = getAudioSourceUrl(sound);

            if (resolvedUrl.startsWith('blob:')) {
              const localFile = uploadedFilesRef.current[sound.fileName] || uploadedFilesRef.current[sound.name];
              if (localFile) {
                fileBlob = localFile;
              } else {
                const res = await fetch(resolvedUrl);
                fileBlob = await res.blob();
              }
            } else {
              const res = await fetch(resolvedUrl);
              fileBlob = await res.blob();
            }

            let zipFileName = sound.fileName || `${sound.name}.${sound.format.toLowerCase()}`;
            if (nameCounts[zipFileName] !== undefined) {
              nameCounts[zipFileName]++;
              const parts = zipFileName.split('.');
              const ext = parts.pop();
              const base = parts.join('.');
              zipFileName = `${base}_(${nameCounts[zipFileName]}).${ext}`;
            } else {
              nameCounts[zipFileName] = 0;
            }

            zip.file(zipFileName, fileBlob);
          } catch (err) {
            console.error(`Failed to pack sound ${sound.name}:`, err);
          }
        })
      );

      const zipContent = await zip.generateAsync({ type: 'blob' });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipContent);
      link.download = `${zipName}_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      setCustomDialog(null);
      setTimeout(() => {
        showCustomAlert("打包成功", `已成功打包并下载当前检索结果下的 ${filteredSounds.length} 个音效文件！`);
      }, 100);
    } catch (error: any) {
      console.error("ZIP packaging error:", error);
      setCustomDialog(null);
      setTimeout(() => {
        showCustomAlert("打包失败", `打包过程中出现错误: ${error.message || '未知错误'}`);
      }, 100);
    }
  };

  // Custom Confirmation Dialog state
  const [customDialog, setCustomDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    isConfirm: boolean;
    onConfirm?: () => void;
  } | null>(null);

  const showCustomAlert = (title: string, message: string) => {
    setCustomDialog({
      isOpen: true,
      title,
      message,
      isConfirm: false
    });
  };

  const showCustomConfirm = (title: string, message: string, onConfirm: () => void) => {
    setCustomDialog({
      isOpen: true,
      title,
      message,
      isConfirm: true,
      onConfirm
    });
  };

  const handleSaveEditSound = (updated: SoundEffect) => {
    setSounds(prev => prev.map(s => s.id === updated.id ? updated : s));
    setEditingSound(null);
    showCustomAlert("保存成功", `已成功更新 "${updated.name}" 的元数据信息。`);
  };

  const handleAddSound = () => {
    if (!addSoundForm.name.trim()) {
      showCustomAlert("输入错误", "请输入资产显示名称！");
      return;
    }
    if (!addSoundForm.fileName.trim()) {
      showCustomAlert("输入错误", "请输入工程化物理文件名！");
      return;
    }
    const newId = `sfx-custom-${Date.now()}`;
    const newSound: SoundEffect = {
      ...addSoundForm,
      id: newId,
      path: addSoundForm.category === '全部音乐' 
        ? `assets/music/${addSoundForm.fileName}` 
        : `assets/sfx/${addSoundForm.fileName}`
    };
    setSounds(prev => [newSound, ...prev]);
    setSelectedSoundId(newId);
    setIsAddSoundModalOpen(false);
    showCustomAlert("新建成功", `已成功在 "${addSoundForm.category} -> ${addSoundForm.subcategory || '无'}" 下创建了全新音效资产 "${addSoundForm.name}"。`);
  };

  // --- Category / Directory Tree Management Functions ---
  const moveCategory = (catId: string, direction: 'up' | 'down') => {
    const isSpecial = catId === 'music_all' || catId === 'company_sfx';
    if (isSpecial) return; // These are now standalone parent groups and cannot be reordered inside their sections
    const sectionCats = categories.filter(c => c.id !== 'music_all' && c.id !== 'company_sfx');
    const idx = sectionCats.findIndex(c => c.id === catId);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === sectionCats.length - 1) return;
    
    const swapWithCat = sectionCats[direction === 'up' ? idx - 1 : idx + 1];
    
    setCategories(prev => {
      const list = [...prev];
      const targetIdx = list.findIndex(c => c.id === catId);
      const swapIdx = list.findIndex(c => c.id === swapWithCat.id);
      const temp = list[targetIdx];
      list[targetIdx] = list[swapIdx];
      list[swapIdx] = temp;
      return list;
    });
  };

  const moveSubCategory = (groupId: string, subId: string, direction: 'up' | 'down') => {
    setCategories(prev => {
      return prev.map(group => {
        if (group.id !== groupId) return group;
        const idx = group.subCategories.findIndex(s => s.id === subId);
        if (idx === -1) return group;
        if (direction === 'up' && idx === 0) return group;
        if (direction === 'down' && idx === group.subCategories.length - 1) return group;
        
        const newSubs = [...group.subCategories];
        const target = newSubs[idx];
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        newSubs[idx] = newSubs[swapIdx];
        newSubs[swapIdx] = target;
        return { ...group, subCategories: newSubs };
      });
    });
  };

  const handleAddSubCategory = (groupId: string) => {
    if (!checkOwnerPermission()) return;
    if (!newSubNameInput.trim()) return;
    const newSubName = newSubNameInput.trim();
    const newSub = {
      id: `sub_${Date.now()}`,
      name: newSubName,
      english: 'Custom Subcategory',
      description: '用户自定义分类目录'
    };
    setCategories(prev => prev.map(group => {
      if (group.id !== groupId) return group;
      return {
        ...group,
        subCategories: [...group.subCategories, newSub]
      };
    }));
    setNewSubNameInput('');
    setIsAddingSubToId(null);
  };

  const handleAddGroup = () => {
    if (!checkOwnerPermission()) return;
    if (!newGroupNameInput.trim()) return;
    const newGroup: CategoryGroup = {
      id: `custom_group_${Date.now()}`,
      name: newGroupNameInput.trim(),
      english: 'Custom Category',
      subCategories: []
    };
    setCategories(prev => [...prev, newGroup]);
    setNewGroupNameInput('');
    setIsAddingGroup(false);
  };

  const handleDeleteCategory = (catId: string, catName: string) => {
    if (!checkOwnerPermission()) return;
    // Count sounds to delete
    const soundsToDeleteCount = sounds.filter(s => s.category === catName).length;
    showCustomConfirm(
      `确定要删除整个目录分类 "${catName}" 吗？`,
      `⚠️ 警告：删除此目录将同时永久物理删除该目录下属的 ${soundsToDeleteCount} 个音频文件，该操作不可撤销！`,
      () => {
        setCategories(prev => prev.filter(c => c.id !== catId));
        setSounds(prev => {
          const remaining = prev.filter(s => s.category !== catName);
          // If the currently playing / selected sound is deleted, select another one
          if (selectedSoundId && prev.find(s => s.id === selectedSoundId)?.category === catName) {
            if (remaining.length > 0) {
              setSelectedSoundId(remaining[0].id);
            }
          }
          return remaining;
        });
        if (selectedCategory === catName) {
          setSelectedCategory('全部');
        }
      }
    );
  };

  const handleDeleteSubCategory = (groupId: string, subId: string, subName: string) => {
    if (!checkOwnerPermission()) return;
    // Count sounds to delete
    const soundsToDeleteCount = sounds.filter(s => s.subcategory === subName).length;
    showCustomConfirm(
      `确定要删除子文件夹 "${subName}" 吗？`,
      `⚠️ 警告：删除此子文件夹将同时永久物理删除该子文件夹下属的 ${soundsToDeleteCount} 个音频文件，该操作不可撤销！`,
      () => {
        setCategories(prev => prev.map(group => {
          if (group.id !== groupId) return group;
          return {
            ...group,
            subCategories: group.subCategories.filter(sub => sub.id !== subId)
          };
        }));
        setSounds(prev => {
          const remaining = prev.filter(s => s.subcategory !== subName);
          // If the currently playing / selected sound is deleted, select another one
          if (selectedSoundId && prev.find(s => s.id === selectedSoundId)?.subcategory === subName) {
            if (remaining.length > 0) {
              setSelectedSoundId(remaining[0].id);
            }
          }
          return remaining;
        });
        if (selectedCategory === subName) {
          setSelectedCategory('全部');
        }
      }
    );
  };

  const startRenameCategory = (catId: string, name: string) => {
    if (!checkOwnerPermission()) return;
    setEditingCategoryId(catId);
    setEditNameInput(name);
  };

  const confirmRenameCategory = (catId: string, oldName: string) => {
    if (!checkOwnerPermission()) return;
    if (!editNameInput.trim()) return;
    const newName = editNameInput.trim();
    setCategories(prev => prev.map(c => c.id === catId ? { ...c, name: newName } : c));
    setSounds(prev => prev.map(s => s.category === oldName ? { ...s, category: newName } : s));
    if (selectedCategory === oldName) {
      setSelectedCategory(newName);
    }
    setEditingCategoryId(null);
  };

  const startRenameSubCategory = (subId: string, name: string) => {
    if (!checkOwnerPermission()) return;
    setEditingSubCategoryId(subId);
    setEditNameInput(name);
  };

  const confirmRenameSubCategory = (groupId: string, subId: string, oldName: string) => {
    if (!checkOwnerPermission()) return;
    if (!editNameInput.trim()) return;
    const newName = editNameInput.trim();
    setCategories(prev => prev.map(group => {
      if (group.id !== groupId) return group;
      return {
        ...group,
        subCategories: group.subCategories.map(sub => sub.id === subId ? { ...sub, name: newName } : sub)
      };
    }));
    setSounds(prev => prev.map(s => s.subcategory === oldName ? { ...s, subcategory: undefined } : s));
    if (selectedCategory === oldName) {
      setSelectedCategory(newName);
    }
    setEditingSubCategoryId(null);
  };

  const [selectedSoundId, setSelectedSoundId] = useState<string>('sfx-1');
  const selectedSound = sounds.find(s => s.id === selectedSoundId) || sounds[0] || { duration: 1, name: '', fileName: '', format: '', tags: [], size: '', channels: '', sampleRate: '', designer: '', path: '' };

  // Global playback control states
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [loadedDuration, setLoadedDuration] = useState<number | null>(null);
  const [volume, setVolume] = useState<number>(0.8);
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const [copiedPath, setCopiedPath] = useState<boolean>(false);

  // Audio elements map for each sound to render waveform progress
  const [playbackProgress, setPlaybackProgress] = useState<{ [key: string]: number }>({});

  // Core Flow A: Import / Drag-and-drop file upload states
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isAiBatchOptimizing, setIsAiBatchOptimizing] = useState<boolean>(false);
  const [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Batch upload naming and category states
  const [namingStrategy, setNamingStrategy] = useState<'smart' | 'original' | 'standard'>('smart');
  const [batchMainCategory, setBatchMainCategory] = useState<string>('');
  const [batchSubCategory, setBatchSubCategory] = useState<string>('');

  // Synchronize batch subcategories dynamically
  useEffect(() => {
    if (categories.length > 0) {
      if (!batchMainCategory) {
        setBatchMainCategory(categories[0].name);
      }
      const matchedGroup = categories.find(g => g.name === batchMainCategory);
      if (matchedGroup && matchedGroup.subCategories.length > 0) {
        const hasSub = matchedGroup.subCategories.some(sub => sub.name === batchSubCategory);
        if (!hasSub) {
          setBatchSubCategory(matchedGroup.subCategories[0].name);
        }
      } else {
        setBatchSubCategory('');
      }
    }
  }, [batchMainCategory, categories, batchSubCategory]);

  const isRegularNaming = (filename: string): boolean => {
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    const standardPrefixes = ['sfx_', 'bgm_', 'ui_', 'mus_', 'vox_'];
    const hasStandardPrefix = standardPrefixes.some(prefix => nameWithoutExt.toLowerCase().startsWith(prefix));
    const underscoreCount = (nameWithoutExt.match(/_/g) || []).length;
    
    const containsChinese = /[\u4e00-\u9fa5]/.test(nameWithoutExt);
    const isGeneric = /^(recording|voice|audio|track|sound|music|new_sound|file|test|unnamed)\d*$/i.test(nameWithoutExt);
    
    if (containsChinese) return false;
    if (isGeneric) return false;
    
    return (hasStandardPrefix && underscoreCount >= 2) || underscoreCount >= 3;
  };

  const handleNamingStrategyChange = (strategy: 'smart' | 'original' | 'standard') => {
    setNamingStrategy(strategy);
    setImportItems(prev => prev.map(item => {
      const file = item.originalFile;
      const cleanBaseName = file.name.replace(/\.[^/.]+$/, "");
      const ext = file.name.split('.').pop() || 'wav';
      
      let catSlug = 'char';
      if (item.category === '武器与战斗') catSlug = 'weapon';
      else if (item.category === '魔法与奇幻') catSlug = 'magic';
      else if (item.category === '怪兽与生物') catSlug = 'creature';
      else if (item.category === '环境与声景') catSlug = 'ambient';
      else if (item.category === '系统与界面') catSlug = 'ui';
      else if (item.category === '全部音乐') catSlug = 'music';
      
      let subSlug = 'foley';
      if (item.subcategory === '脚步材质') subSlug = 'footstep';
      else if (item.subcategory === '肢体装束') subSlug = 'foley';
      else if (item.subcategory === '人声拟音') subSlug = 'vocal';
      else if (item.subcategory === '冷兵器砍击') subSlug = 'melee';
      else if (item.subcategory === '物理碰撞') subSlug = 'impact';
      else if (item.subcategory === '枪械火器' || item.subcategory === '枪械与射击') subSlug = 'firearms';
      else if (item.subcategory === '爆炸轰鸣' || item.subcategory === '爆炸与重低音') subSlug = 'explosion';
      else if (item.subcategory === '元素魔法') subSlug = 'spell';
      else if (item.subcategory === '奇幻护盾') subSlug = 'shield';
      else if (item.subcategory === '怪兽咆哮') subSlug = 'growl';
      else if (item.subcategory === '自然环境') subSlug = 'nature';
      else if (item.subcategory === '空间背景') subSlug = 'space';
      else if (item.subcategory === 'UI 反馈') subSlug = 'uiclick';
      else if (item.subcategory === '胜利奖励') subSlug = 'win';
      else if (item.subcategory === '警报失败') subSlug = 'alert';
      else if (item.subcategory === '史诗交响') subSlug = 'epic';
      else if (item.subcategory === '赛博电子') subSlug = 'cyber';
      else if (item.subcategory === '国风仙侠') subSlug = 'chinese';
      else if (item.subcategory === '日常休闲') subSlug = 'casual';
      else if (item.subcategory === '战斗热血') subSlug = 'combat';
      else if (item.subcategory === '惊悚悬疑') subSlug = 'suspense';

      let descSlug = cleanBaseName
        .replace(/[\u4e00-\u9fa5]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '_')
        .toLowerCase()
        .split('_')
        .filter(Boolean)
        .join('_');
         
      if (!descSlug) {
        descSlug = 'asset';
      }
      
      const suggestedFileName = item.category === '全部音乐' 
        ? `bgm_music_${subSlug}_${descSlug}_01.${ext}`
        : `sfx_${catSlug}_${subSlug}_${descSlug}_01.${ext}`;

      let finalFileName = suggestedFileName;
      if (strategy === 'smart') {
        finalFileName = isRegularNaming(file.name) ? file.name : suggestedFileName;
      } else if (strategy === 'original') {
        finalFileName = file.name;
      } else {
        finalFileName = suggestedFileName;
      }

      return {
        ...item,
        fileName: finalFileName
      };
    }));
  };

  const handleApplyBatchCategory = () => {
    if (!batchMainCategory) return;
    setImportItems(prev => prev.map(item => {
      const file = item.originalFile;
      const cleanBaseName = file.name.replace(/\.[^/.]+$/, "");
      const ext = file.name.split('.').pop() || 'wav';
      
      let catSlug = 'char';
      if (batchMainCategory === '武器与战斗') catSlug = 'weapon';
      else if (batchMainCategory === '魔法与奇幻') catSlug = 'magic';
      else if (batchMainCategory === '怪兽与生物') catSlug = 'creature';
      else if (batchMainCategory === '环境与声景') catSlug = 'ambient';
      else if (batchMainCategory === '系统与界面') catSlug = 'ui';
      else if (batchMainCategory === '全部音乐') catSlug = 'music';
      
      let subSlug = 'foley';
      if (batchSubCategory === '脚步材质') subSlug = 'footstep';
      else if (batchSubCategory === '肢体装束') subSlug = 'foley';
      else if (batchSubCategory === '人声拟音') subSlug = 'vocal';
      else if (batchSubCategory === '冷兵器砍击') subSlug = 'melee';
      else if (batchSubCategory === '物理碰撞') subSlug = 'impact';
      else if (batchSubCategory === '枪械火器' || batchSubCategory === '枪械与射击') subSlug = 'firearms';
      else if (batchSubCategory === '爆炸轰鸣' || batchSubCategory === '爆炸与重低音') subSlug = 'explosion';
      else if (batchSubCategory === '元素魔法') subSlug = 'spell';
      else if (batchSubCategory === '奇幻护盾') subSlug = 'shield';
      else if (batchSubCategory === '怪兽咆哮') subSlug = 'growl';
      else if (batchSubCategory === '自然环境') subSlug = 'nature';
      else if (batchSubCategory === '空间背景') subSlug = 'space';
      else if (batchSubCategory === 'UI 反馈') subSlug = 'uiclick';
      else if (batchSubCategory === '胜利奖励') subSlug = 'win';
      else if (batchSubCategory === '警报失败') subSlug = 'alert';
      else if (batchSubCategory === '史诗交响') subSlug = 'epic';
      else if (batchSubCategory === '赛博电子') subSlug = 'cyber';
      else if (batchSubCategory === '国风仙侠') subSlug = 'chinese';
      else if (batchSubCategory === '日常休闲') subSlug = 'casual';
      else if (batchSubCategory === '战斗热血') subSlug = 'combat';
      else if (batchSubCategory === '惊悚悬疑') subSlug = 'suspense';

      let descSlug = cleanBaseName
        .replace(/[\u4e00-\u9fa5]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '_')
        .toLowerCase()
        .split('_')
        .filter(Boolean)
        .join('_');
         
      if (!descSlug) {
        descSlug = 'asset';
      }
      
      const suggestedFileName = batchMainCategory === '全部音乐' 
        ? `bgm_music_${subSlug}_${descSlug}_01.${ext}`
        : `sfx_${catSlug}_${subSlug}_${descSlug}_01.${ext}`;

      let finalFileName = item.fileName;
      if (namingStrategy === 'smart') {
        finalFileName = isRegularNaming(file.name) ? file.name : suggestedFileName;
      } else if (namingStrategy === 'original') {
        finalFileName = file.name;
      } else if (namingStrategy === 'standard') {
        finalFileName = suggestedFileName;
      }

      return {
        ...item,
        category: batchMainCategory,
        subcategory: batchSubCategory,
        fileName: finalFileName
      };
    }));
    
    showCustomAlert("批量应用成功", `已将待入库的所有音效分类一键批量调整为: "${batchMainCategory} -> ${batchSubCategory || '无'}"。`);
  };

  // Refs
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // A ref to keep track of the latest state values to avoid closure issues during asynchronous operations
  const stateRef = useRef({ sounds, selectedSoundId, isPlaying });
  useEffect(() => {
    stateRef.current = { sounds, selectedSoundId, isPlaying };
  }, [sounds, selectedSoundId, isPlaying]);

  // --- HTML5 Audio Control Sync ---
  useEffect(() => {
    // Whenever selectedSound changes, load, pause, and reset progress indicators
    setIsPlaying(false);
    setCurrentTime(0);
    setLoadedDuration(null);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.load();
    }
    // Instantly reset playback progress of the selected item to prevent stale visualization
    setPlaybackProgress(prev => ({
      ...prev,
      [selectedSoundId]: 0
    }));
  }, [selectedSoundId]);

  useEffect(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.loop = isLooping;
    }
  }, [isLooping]);

  // Spacebar to play/pause selected sound
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid firing when writing in text inputs
      if (
        document.activeElement?.tagName === 'INPUT' || 
        document.activeElement?.tagName === 'TEXTAREA' || 
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedSoundId, isPlaying]);

  const handlePlaybackError = (err: any) => {
    console.warn("Audio playback failed, attempting fallback URL:", err);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.src = 'https://assets.mixkit.co/active_storage/sfx/2568/2568-84.wav';
      audioPlayerRef.current.load();
      audioPlayerRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(fallbackErr => {
          console.error("Fallback playback also failed:", fallbackErr);
        });
    }
  };

  const handlePlaySound = (soundId: string) => {
    if (!audioPlayerRef.current) return;

    const currentSelectedId = stateRef.current.selectedSoundId;
    const currentIsPlaying = stateRef.current.isPlaying;

    if (currentSelectedId === soundId) {
      if (currentIsPlaying) {
        audioPlayerRef.current.pause();
        setIsPlaying(false);
      } else {
        audioPlayerRef.current.play()
          .then(() => setIsPlaying(true))
          .catch(err => handlePlaybackError(err));
      }
    } else {
      setSelectedSoundId(soundId);
      setIsPlaying(false);
      setLoadedDuration(null);

      const targetSound = stateRef.current.sounds.find(s => s.id === soundId);
      if (targetSound) {
        const targetSrc = getAudioSourceUrl(targetSound);
        audioPlayerRef.current.src = targetSrc;
        audioPlayerRef.current.load();
        
        // Wait a tiny tick for the browser/ref to register the src swap, then play
        setTimeout(() => {
          if (audioPlayerRef.current) {
            audioPlayerRef.current.play()
              .then(() => setIsPlaying(true))
              .catch(err => handlePlaybackError(err));
          }
        }, 30);
      }
    }
  };

  const togglePlayPause = () => {
    handlePlaySound(stateRef.current.selectedSoundId);
  };

  const handleTimeUpdate = () => {
    if (audioPlayerRef.current) {
      const cur = audioPlayerRef.current.currentTime;
      const dur = audioPlayerRef.current.duration;
      
      // Safeguard against NaN/Infinity/unloaded audio metadata
      if (isNaN(cur) || isNaN(dur) || !isFinite(dur) || dur <= 0) {
        return;
      }
      
      setCurrentTime(cur);
      
      // Keep loadedDuration in sync with the real audio element
      setLoadedDuration(dur);
      
      // Update progress map for current selected item
      setPlaybackProgress(prev => ({
        ...prev,
        [selectedSoundId]: (cur / dur) * 100
      }));
    }
  };

  const handleAudioEnded = () => {
    if (!isLooping) {
      setIsPlaying(false);
      setCurrentTime(0);
      setPlaybackProgress(prev => ({
        ...prev,
        [selectedSoundId]: 0
      }));
    }
  };

  // --- Intelligent Fuzzy Semantic Search Engine ---
  // Returns a score of how well a sound matches the search query based on keywords, synonyms, and description
  const getMatchScore = (sound: SoundEffect, query: string): number => {
    if (!query.trim()) return 1;
    const lowerQuery = query.toLowerCase().trim();
    
    let score = 0;
    
    // Exact word matching in filename, name, category, designer
    if (sound.name.toLowerCase().includes(lowerQuery)) score += 10;
    if (sound.fileName.toLowerCase().includes(lowerQuery)) score += 8;
    if (sound.category.toLowerCase().includes(lowerQuery)) score += 5;
    if (sound.subcategory?.toLowerCase().includes(lowerQuery)) score += 5;
    if (sound.designer.toLowerCase().includes(lowerQuery)) score += 4;

    // Check tags matching
    sound.tags.forEach(tag => {
      if (lowerQuery.includes(tag.toLowerCase()) || tag.toLowerCase().includes(lowerQuery)) {
        score += 6;
      }
    });

    // Semantic Synonyms Mapping (Translating descriptions like '沉闷的金属撞击' into our tags)
    // Map words that user might use to our database values
    const synonyms: { [key: string]: string[] } = {
      '金属': ['铁', '钢', '敲击', '磕碰', '硬', 'metal', 'clang', 'clink'],
      '撞击': ['打击', '击打', '碰撞', '落', '打', '砸', 'impact', 'hit'],
      '沉闷': ['重', '低频', '闷', '重击', '厚重', 'dull', 'heavy', 'muffled'],
      '科幻': ['激光', '外星', '未来', '脉冲', '赛博', '能量', 'cyber', 'sci-fi', 'space'],
      '点击': ['按钮', 'UI', '反馈', '简洁', '清脆', 'click', 'pop', 'bubble'],
      '尖锐': ['刺耳', '高频', '激光', '警报', 'sharp', 'piercing'],
      '爆炸': ['轰鸣', '炸', '重低音', '巨响', '震动', 'explosion', 'boom'],
      '环境': ['背景', '自然', '风声', '流动', '环绕', 'ambient', 'loop']
    };

    Object.keys(synonyms).forEach(mainTag => {
      const matchWords = synonyms[mainTag];
      const foundMatchWord = matchWords.some(word => lowerQuery.includes(word));
      if (foundMatchWord) {
        // If query mentions synonymous words, reward sounds with this mainTag
        if (sound.tags.includes(mainTag) || sound.name.includes(mainTag)) {
          score += 5;
        }
      }
    });

    return score;
  };

  // Filtered sounds list
  const filteredSounds = sounds.filter(sound => {
    // 1. Left side category tree filter
    if (selectedCategory !== '全部') {
      if (selectedCategory === '我的收藏') {
        if (!sound.isFavorite) return false;
      } else {
        // Try to match selectedCategory with a top-level CategoryGroup name
        const matchedGroup = categories.find(g => g.name === selectedCategory);
        if (matchedGroup) {
          // If it's a main group, sound must belong to this group or its subcategories
          const subNames = matchedGroup.subCategories.map(s => s.name);
          const matchesGroup = 
            sound.category === selectedCategory || 
            subNames.includes(sound.category) || 
            (sound.subcategory && subNames.includes(sound.subcategory));
          if (!matchesGroup) return false;
        } else {
          // It's a leaf subcategory, check direct match
          if (sound.category !== selectedCategory && sound.subcategory !== selectedCategory) {
            return false;
          }
        }
      }
    }

    // 2. Right tag cloud filter
    if (selectedTag && !sound.tags.includes(selectedTag)) {
      return false;
    }

    // 3. AI Semantic Search Match Score Check
    if (searchQuery.trim().length > 0) {
      if (getMatchScore(sound, searchQuery) === 0) {
        return false;
      }
    }

    // 4. Secondary Multi-dimensional Filters
    // Duration
    if (filterDuration === '< 1秒' && sound.duration >= 1) return false;
    if (filterDuration === '1-3秒' && (sound.duration < 1 || sound.duration > 3)) return false;
    if (filterDuration === '> 3秒' && sound.duration <= 3) return false;

    // Channel
    if (filterChannel !== '全部' && sound.channels !== filterChannel) return false;

    // Format
    if (filterFormat !== '全部' && sound.format !== filterFormat) return false;

    // Designer
    if (filterDesigner !== '全部' && sound.designer !== filterDesigner) return false;

    // Sample Rate
    if (filterSampleRate !== '全部' && !sound.sampleRate.includes(filterSampleRate)) return false;

    return true;
  });

  // Sort filtered results so that higher semantic match score comes first
  if (searchQuery.trim().length > 0) {
    filteredSounds.sort((a, b) => getMatchScore(b, searchQuery) - getMatchScore(a, searchQuery));
  }

  // --- Tag Cloud Extraction (Extract all tags from sound database dynamically) ---
  const allTags = Array.from(new Set(sounds.flatMap(s => s.tags)));

  // --- Handlers ---
  const handleFuzzySearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim() && !searchHistory.includes(searchQuery.trim())) {
      setSearchHistory(prev => [searchQuery.trim(), ...prev.slice(0, 4)]);
    }
  };

  const selectHistoryQuery = (q: string) => {
    setSearchQuery(q);
  };

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSounds(prev => prev.map(s => s.id === id ? { ...s, isFavorite: !s.isFavorite } : s));
  };

  const copySoundPath = () => {
    navigator.clipboard.writeText(selectedSound.path);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  // --- File Drag & Drop + Upload Simulator ---
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const traverseFileTree = async (entry: any, path = ""): Promise<File[]> => {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file((file: File) => {
          Object.defineProperty(file, 'relativePath', {
            value: path + file.name,
            writable: true,
            enumerable: true,
            configurable: true
          });
          resolve([file]);
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const allEntries: any[] = [];
        
        const readEntries = () => {
          dirReader.readEntries(async (results: any[]) => {
            if (results.length === 0) {
              const filePromises = allEntries.map(subEntry => 
                traverseFileTree(subEntry, path + entry.name + "/")
              );
              const nestedFiles = await Promise.all(filePromises);
              resolve(nestedFiles.flat());
            } else {
              allEntries.push(...results);
              readEntries();
            }
          });
        };
        readEntries();
      } else {
        resolve([]);
      }
    });
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!checkOwnerPermission()) {
      return;
    }

    const items = e.dataTransfer.items;
    const filesList: File[] = [];

    if (items && items.length > 0) {
      setIsAnalyzing(true);
      setIsImportModalOpen(true);
      
      const promises: Promise<File[]>[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (typeof item.webkitGetAsEntry === 'function') {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            promises.push(traverseFileTree(entry));
          }
        } else {
          const file = item.getAsFile();
          if (file) {
            filesList.push(file);
          }
        }
      }

      if (promises.length > 0) {
        const nestedFiles = await Promise.all(promises);
        filesList.push(...(nestedFiles.flat() as File[]));
      }

      processFilesForImport(filesList);
    } else {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        processFilesForImport(Array.from(files));
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFilesForImport(Array.from(files) as File[]);
    }
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const filesArray = Array.from(files) as File[];
      filesArray.forEach(file => {
        if ((file as any).webkitRelativePath) {
          Object.defineProperty(file, 'relativePath', {
            value: (file as any).webkitRelativePath,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      });
      processFilesForImport(filesArray);
    }
  };

  const analyzeSingleFile = (file: File): ImportItem => {
    const relativePath = (file as any).relativePath || (file as any).webkitRelativePath || file.name;
    const nameLower = relativePath.toLowerCase();
    
    // Heuristics for category, subcategory, tags, and standard filenames
    let category = '角色与拟音';
    let subcategory = '角色动作';
    let tags: string[] = ['写实'];
    
    if (
      nameLower.includes('bgm') || nameLower.includes('music') || nameLower.includes('song') || nameLower.includes('theme') ||
      nameLower.includes('音乐') || nameLower.includes('背景音乐') || nameLower.includes('乐曲') || nameLower.includes('伴奏') || 
      nameLower.includes('旋律') || nameLower.includes('歌') || nameLower.includes('曲')
    ) {
      category = '全部音乐';
      if (nameLower.includes('epic') || nameLower.includes('orchestr') || nameLower.includes('symphon') || nameLower.includes('史诗') || nameLower.includes('管弦') || nameLower.includes('交响')) {
        subcategory = '史诗交响';
        tags = ['史诗', '管弦乐', '震撼', '背景音乐', '音乐'];
      } else if (nameLower.includes('cyber') || nameLower.includes('electro') || nameLower.includes('synth') || nameLower.includes('赛博') || nameLower.includes('电音') || nameLower.includes('电子')) {
        subcategory = '赛博电子';
        tags = ['赛博朋克', '合成器', '电音', '背景音乐', '音乐'];
      } else if (nameLower.includes('china') || nameLower.includes('guofeng') || nameLower.includes('xianxia') || nameLower.includes('国风') || nameLower.includes('古风') || nameLower.includes('仙侠')) {
        subcategory = '国风仙侠';
        tags = ['国风', '仙侠', '古典', '背景音乐', '音乐'];
      } else if (nameLower.includes('casual') || nameLower.includes('happy') || nameLower.includes('relax') || nameLower.includes('休闲') || nameLower.includes('轻松') || nameLower.includes('日常') || nameLower.includes('治愈')) {
        subcategory = '日常休闲';
        tags = ['休闲', '欢快', '轻松', '背景音乐', '音乐'];
      } else if (nameLower.includes('combat') || nameLower.includes('fight') || nameLower.includes('rock') || nameLower.includes('metal') || nameLower.includes('战斗') || nameLower.includes('热血') || nameLower.includes('摇滚')) {
        subcategory = '战斗热血';
        tags = ['战斗', '热血', '重摇滚', '背景音乐', '音乐'];
      } else if (nameLower.includes('suspense') || nameLower.includes('horror') || nameLower.includes('ghost') || nameLower.includes('惊悚') || nameLower.includes('悬疑') || nameLower.includes('恐怖') || nameLower.includes('暗黑')) {
        subcategory = '惊悚悬疑';
        tags = ['惊悚', '悬疑', '恐怖', '背景音乐', '音乐'];
      } else {
        subcategory = '日常休闲';
        tags = ['游戏音乐', 'BGM', '循环', '背景音乐', '音乐'];
      }
    } else if (
      nameLower.includes('ui') || nameLower.includes('click') || nameLower.includes('button') || 
      nameLower.includes('select') || nameLower.includes('confirm') || nameLower.includes('cancel') || 
      nameLower.includes('pop') || nameLower.includes('bubble') || nameLower.includes('menu') ||
      nameLower.includes('点') || nameLower.includes('按') || nameLower.includes('确认') || nameLower.includes('取消')
    ) {
      category = '系统与界面';
      subcategory = 'UI 反馈';
      tags = ['UI', '清脆', '点击', '反馈', '简洁'];
    } else if (
      nameLower.includes('win') || nameLower.includes('victory') || nameLower.includes('reward') || 
      nameLower.includes('level') || nameLower.includes('achievement') || nameLower.includes('coin') || 
      nameLower.includes('金币') || nameLower.includes('胜') || nameLower.includes('奖励') || nameLower.includes('升')
    ) {
      category = '系统与界面';
      subcategory = '胜利奖励';
      tags = ['UI', '通关', '奖励', '号角', '成就'];
    } else if (
      nameLower.includes('warn') || nameLower.includes('fail') || nameLower.includes('alert') || 
      nameLower.includes('error') || nameLower.includes('danger') || nameLower.includes('hp_low') || 
      nameLower.includes('败') || nameLower.includes('错') || nameLower.includes('警')
    ) {
      category = '系统与界面';
      subcategory = '警报失败';
      tags = ['UI', '报错', '警告', '失败', '红屏'];
    } else if (
      nameLower.includes('magic') || nameLower.includes('spell') || nameLower.includes('fireball') || 
      nameLower.includes('laser') || nameLower.includes('energy') || nameLower.includes('electric') || 
      nameLower.includes('thunder') || nameLower.includes('teleport') ||
      nameLower.includes('法') || nameLower.includes('术') || nameLower.includes('光') || nameLower.includes('闪') || nameLower.includes('电')
    ) {
      category = '魔法与奇幻';
      subcategory = '元素魔法';
      tags = ['魔法', '能量', '虚幻', '科幻', '技能'];
    } else if (
      nameLower.includes('buff') || nameLower.includes('debuff') || nameLower.includes('shield') || 
      nameLower.includes('protect') || nameLower.includes('heal') || nameLower.includes('cure') || 
      nameLower.includes('护盾') || nameLower.includes('治')
    ) {
      category = '魔法与奇幻';
      subcategory = '奇幻护盾';
      tags = ['护盾', '魔法', '守护', '奇幻', '增益'];
    } else if (
      nameLower.includes('monster') || nameLower.includes('growl') || nameLower.includes('roar') || 
      nameLower.includes('beast') || nameLower.includes('creature') || nameLower.includes('alien') || 
      nameLower.includes('shriek') || nameLower.includes('兽') || nameLower.includes('吼') || nameLower.includes('怪')
    ) {
      category = '怪兽与生物';
      subcategory = '怪兽咆哮';
      tags = ['怪物', '声放', '嘶吼', '异形', '拟音'];
    } else if (
      nameLower.includes('ambient') || nameLower.includes('wind') || nameLower.includes('rain') || 
      nameLower.includes('loop') || nameLower.includes('background') || 
      nameLower.includes('风') || nameLower.includes('环境') || nameLower.includes('背景')
    ) {
      category = '环境与声景';
      subcategory = '自然环境';
      tags = ['环境', '自然', '背景', 'Loop', '气流'];
    } else if (
      nameLower.includes('space') || nameLower.includes('room') || nameLower.includes('drone') || 
      nameLower.includes('industrial') || nameLower.includes('ship') || nameLower.includes('engine') || 
      nameLower.includes('舱') || nameLower.includes('机')
    ) {
      category = '环境与声景';
      subcategory = '空间背景';
      tags = ['空间', '低频', '舱内', '工业', 'Loop'];
    } else if (
      nameLower.includes('sword') || nameLower.includes('slash') || nameLower.includes('blade') || 
      nameLower.includes('axe') || nameLower.includes('刀') || nameLower.includes('剑') || nameLower.includes('劈') || nameLower.includes('砍')
    ) {
      category = '武器与战斗';
      subcategory = '冷兵器砍击';
      tags = ['冷兵器', '刀剑', '挥砍', '写实', '打击'];
    } else if (
      nameLower.includes('metal') || nameLower.includes('crash') || nameLower.includes('smash') || 
      nameLower.includes('clash') || nameLower.includes('shatter') || nameLower.includes('物理') || 
      nameLower.includes('碰') || nameLower.includes('撞') || nameLower.includes('打')
    ) {
      category = '武器与战斗';
      subcategory = '物理碰撞';
      tags = ['碰撞', '撞击', '物理', '摩擦', '金属'];
    } else if (
      nameLower.includes('gun') || nameLower.includes('rifle') || nameLower.includes('shot') || 
      nameLower.includes('ammo') || nameLower.includes('firearm') || nameLower.includes('shoot') || 
      nameLower.includes('reload') || nameLower.includes('枪') || nameLower.includes('弹')
    ) {
      category = '武器与战斗';
      subcategory = '枪械火器';
      tags = ['枪声', '火器', '单发', '现代武器', '写实'];
    } else if (
      nameLower.includes('explod') || nameLower.includes('explos') || nameLower.includes('bomb') || 
      nameLower.includes('grenade') || nameLower.includes('blast') || nameLower.includes('炸') || nameLower.includes('爆')
    ) {
      category = '武器与战斗';
      subcategory = '爆炸轰鸣';
      tags = ['爆炸', '重低音', '轰鸣', '震撼', '科幻'];
    } else if (
      nameLower.includes('footstep') || nameLower.includes('step') || nameLower.includes('run') || 
      nameLower.includes('walk') || nameLower.includes('jump') || nameLower.includes('land') || 
      nameLower.includes('脚') || nameLower.includes('步') || nameLower.includes('跑')
    ) {
      category = '角色与拟音';
      subcategory = '脚步材质';
      tags = ['脚步', '材质', '重装', '走路', '写实'];
    } else if (
      nameLower.includes('cloth') || nameLower.includes('armor') || nameLower.includes('movement') || 
      nameLower.includes('foley') || nameLower.includes('摩') || nameLower.includes('擦')
    ) {
      category = '角色与拟音';
      subcategory = '肢体装束';
      tags = ['摩擦', '拟音', '装备', '防具', '布料'];
    } else {
      category = '角色与拟音';
      subcategory = '角色动作';
      tags = ['动作', '写实', '打击', '物理', '运动'];
    }

    const cleanBaseName = file.name.replace(/\.[^/.]+$/, "");
    const ext = file.name.split('.').pop() || 'wav';
    
    let catSlug = 'char';
    if (category === '武器与战斗') catSlug = 'weapon';
    else if (category === '魔法与奇幻') catSlug = 'magic';
    else if (category === '怪兽与生物') catSlug = 'creature';
    else if (category === '环境与声景') catSlug = 'ambient';
    else if (category === '系统与界面') catSlug = 'ui';
    else if (category === '全部音乐') catSlug = 'music';
    
    let subSlug = 'foley';
    if (subcategory === '脚步材质') subSlug = 'footstep';
    else if (subcategory === '肢体装束') subSlug = 'foley';
    else if (subcategory === '人声拟音') subSlug = 'vocal';
    else if (subcategory === '冷兵器砍击') subSlug = 'melee';
    else if (subcategory === '物理碰撞') subSlug = 'impact';
    else if (subcategory === '枪械火器' || subcategory === '枪械与射击') subSlug = 'firearms';
    else if (subcategory === '爆炸轰鸣' || subcategory === '爆炸与重低音') subSlug = 'explosion';
    else if (subcategory === '元素魔法') subSlug = 'spell';
    else if (subcategory === '奇幻护盾') subSlug = 'shield';
    else if (subcategory === '怪兽咆哮') subSlug = 'growl';
    else if (subcategory === '自然环境') subSlug = 'nature';
    else if (subcategory === '空间背景') subSlug = 'space';
    else if (subcategory === 'UI 反馈') subSlug = 'uiclick';
    else if (subcategory === '胜利奖励') subSlug = 'win';
    else if (subcategory === '警报失败') subSlug = 'alert';
    else if (subcategory === '史诗交响') subSlug = 'epic';
    else if (subcategory === '赛博电子') subSlug = 'cyber';
    else if (subcategory === '国风仙侠') subSlug = 'chinese';
    else if (subcategory === '日常休闲') subSlug = 'casual';
    else if (subcategory === '战斗热血') subSlug = 'combat';
    else if (subcategory === '惊悚悬疑') subSlug = 'suspense';

    let descSlug = cleanBaseName
      .replace(/[\u4e00-\u9fa5]/g, '') // remove Chinese
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toLowerCase()
      .split('_')
      .filter(Boolean)
      .join('_');
       
    if (!descSlug) {
      descSlug = 'asset';
    }
    
    // For music, the naming prefix is "bgm_music_"
    const suggestedFileName = category === '全部音乐' 
      ? `bgm_music_${subSlug}_${descSlug}_01.${ext}`
      : `sfx_${catSlug}_${subSlug}_${descSlug}_01.${ext}`;
      
    let suggestedDisplayName = cleanBaseName
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    suggestedDisplayName = suggestedDisplayName.charAt(0).toUpperCase() + suggestedDisplayName.slice(1);

    let finalFileName = suggestedFileName;
    if (namingStrategy === 'smart') {
      finalFileName = isRegularNaming(file.name) ? file.name : suggestedFileName;
    } else if (namingStrategy === 'original') {
      finalFileName = file.name;
    } else {
      finalFileName = suggestedFileName;
    }

    return {
      id: `import-${Math.random().toString(36).substr(2, 9)}`,
      originalFile: file,
      relativePath,
      name: suggestedDisplayName,
      fileName: finalFileName,
      category,
      subcategory,
      tags,
      size: `${(file.size / 1024).toFixed(1)} KB`,
      type: ext.toUpperCase(),
      duration: Math.random() > 0.5 ? 1.5 : 0.8
    };
  };

  const processFilesForImport = async (files: File[]) => {
    const audioFiles = files.filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ['wav', 'ogg', 'mp3', 'flac', 'm4a', 'aac'].includes(ext || '');
    });

    if (audioFiles.length === 0) {
      setIsAnalyzing(false);
      setIsImportModalOpen(false);
      showCustomAlert("格式不支持", "未在选择的文件或文件夹中检测到支持的音频文件（WAV, OGG, MP3, FLAC, AAC）。");
      return;
    }

    setIsImportModalOpen(true);
    setIsAnalyzing(true);

    try {
      const items = await Promise.all(
        audioFiles.map(async (file) => {
          const analyzed = analyzeSingleFile(file);
          // Measure actual audio duration using temporary Audio element
          const duration = await new Promise<number>((resolve) => {
            const audio = new Audio();
            const objectUrl = URL.createObjectURL(file);
            audio.src = objectUrl;
            audio.onloadedmetadata = () => {
              resolve(audio.duration || 1.0);
              URL.revokeObjectURL(objectUrl);
            };
            audio.onerror = () => {
              resolve(1.0);
              URL.revokeObjectURL(objectUrl);
            };
            // Set a timeout of 3 seconds just in case
            setTimeout(() => {
              resolve(1.0);
              URL.revokeObjectURL(objectUrl);
            }, 3000);
          });
          return {
            ...analyzed,
            duration: parseFloat(duration.toFixed(2))
          };
        })
      );
      setImportItems(items);
    } catch (err) {
      console.error("Error processing import files:", err);
      const items = audioFiles.map(file => analyzeSingleFile(file));
      setImportItems(items);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (importItems.length === 0) return;
    setIsUploading(true);

    const itemsToUpload = [...importItems];
    const soundsToAdd: SoundEffect[] = [];

    for (let i = 0; i < itemsToUpload.length; i++) {
      const item = itemsToUpload[i];
      if (item.status === 'success') {
        continue;
      }

      // 1. Set status to uploading
      item.status = 'uploading';
      setImportItems([...itemsToUpload]);

      // 2. Perform actual file upload to Express backend
      let isSuccess = false;
      let finalFileUrl = '';
      let cleanFilenameOnServer = '';

      if (item.originalFile) {
        try {
          const response = await fetch('/api/sfx/upload', {
            method: 'POST',
            headers: {
              'Content-Type': item.originalFile.type || 'application/octet-stream',
              'x-filename': encodeURIComponent(item.fileName)
            },
            body: item.originalFile
          });
          if (response.ok) {
            const uploadRes = await response.json();
            finalFileUrl = uploadRes.url;
            cleanFilenameOnServer = uploadRes.fileName;
            isSuccess = true;
          }
        } catch (uploadErr) {
          console.error("Failed to upload audio file to server:", uploadErr);
        }
      } else {
        isSuccess = true; // fallback
      }

      if (isSuccess) {
        item.status = 'success';
        
        let slug = 'foley';
        if (item.category === '角色与拟音') slug = 'foley';
        else if (item.category === '武器与战斗') slug = 'weapons';
        else if (item.category === '魔法与奇幻') slug = 'magic';
        else if (item.category === '怪兽与生物') slug = 'creatures';
        else if (item.category === '环境与声景') slug = 'ambient';
        else if (item.category === '系统与界面') slug = 'ui';
        else if (item.category === '全部音乐') slug = 'music';

        const fileUrl = finalFileUrl || (item.originalFile ? URL.createObjectURL(item.originalFile) : 'https://assets.mixkit.co/active_storage/sfx/2568/2568-84.wav');

        const newSound: SoundEffect = {
          id: `sfx-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 5)}`,
          name: item.name.trim() || (item.originalFile ? item.originalFile.name : 'Unknown'),
          fileName: cleanFilenameOnServer || item.fileName.trim() || (item.originalFile ? item.originalFile.name : 'Unknown'),
          category: item.category,
          subcategory: item.subcategory,
          tags: item.tags,
          duration: item.duration,
          format: (item.type === 'MP3' || item.type === 'OGG' || item.type === 'WAV') ? item.type as 'WAV' | 'MP3' | 'OGG' : 'WAV',
          size: item.size,
          sampleRate: '48.0 kHz',
          channels: Math.random() > 0.4 ? 'Stereo' : 'Mono',
          designer: 'AD_Design (音效师)',
          path: item.category === '全部音乐' ? `assets/music/${slug}/${cleanFilenameOnServer || item.fileName}` : `assets/sfx/${slug}/${cleanFilenameOnServer || item.fileName}`,
          url: fileUrl,
        };

        if (item.originalFile) {
          uploadedFilesRef.current[newSound.fileName] = item.originalFile;
          uploadedFilesRef.current[newSound.name] = item.originalFile;
          saveFileToDB(newSound.fileName, item.originalFile);
          saveFileToDB(newSound.name, item.originalFile);
        }

        soundsToAdd.push(newSound);
      } else {
        item.status = 'error';
      }

      setImportItems([...itemsToUpload]);
    }

    setIsUploading(false);

    // Add successful ones to library
    if (soundsToAdd.length > 0) {
      // Deduplicate inside the newly added list first (keep the last one if duplicates exist in the same batch)
      const uniqueSoundsToAdd: SoundEffect[] = [];
      for (let i = soundsToAdd.length - 1; i >= 0; i--) {
        const sound = soundsToAdd[i];
        const isDup = uniqueSoundsToAdd.some(s => 
          s.fileName.toLowerCase() === sound.fileName.toLowerCase() ||
          s.name.toLowerCase() === sound.name.toLowerCase()
        );
        if (!isDup) {
          uniqueSoundsToAdd.unshift(sound);
        }
      }

      setSounds(prev => {
        // Filter out any existing library sounds that match the name or fileName of any newly uploaded sound
        const filteredPrev = prev.filter(existingSound => 
          !uniqueSoundsToAdd.some(newSound => 
            newSound.fileName.toLowerCase() === existingSound.fileName.toLowerCase() ||
            newSound.name.toLowerCase() === existingSound.name.toLowerCase()
          )
        );
        return [...uniqueSoundsToAdd, ...filteredPrev];
      });
      setSelectedSoundId(uniqueSoundsToAdd[0].id);
    }

    const failedCount = itemsToUpload.filter(item => item.status === 'error').length;
    const successCount = itemsToUpload.filter(item => item.status === 'success').length;

    if (failedCount === 0) {
      showCustomAlert("🎉 批量导入成功", `共 ${successCount} 个音效资产已全部成功上传并入库分类！`);
      setTimeout(() => {
        setIsImportModalOpen(false);
        setImportItems([]);
      }, 1500);
    } else {
      showCustomAlert(
        "⚠️ 导入未全部完成",
        `已成功上传并导入 ${successCount} 个音效资产。其中有 ${failedCount} 个项目由于网络抖动或格式校验导致上传失败。\n\n您可尝试重新上传失败项，或者直接关闭窗口。`
      );
    }
  };

  const handleAiBatchOptimize = async () => {
    if (importItems.length === 0) return;
    setIsAiBatchOptimizing(true);
    try {
      const mappedForAi = importItems.map(item => ({
        id: item.id,
        originalName: item.originalFile.name,
        path: item.relativePath || item.originalFile.name,
        size: item.size,
        type: item.type
      }));
      const optimized = await optimizeImportMetadata(mappedForAi);
      
      setImportItems(prev => {
        return prev.map(item => {
          const opt = optimized.find(o => o.id === item.id);
          if (opt) {
            return {
              ...item,
              name: opt.name,
              fileName: opt.fileName,
              category: opt.category,
              tags: opt.tags
            };
          }
          return item;
        });
      });
    } catch (err: any) {
      console.error("AI batch optimize error:", err);
      showCustomAlert("AI 优化失败", `请检查网络或 GEMINI_API_KEY 配置。详情: ${err.message || '未知错误'}`);
    } finally {
      setIsAiBatchOptimizing(false);
    }
  };

  const removeSound = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!checkOwnerPermission()) return;
    showCustomConfirm(
      "确定要移除此文件吗？",
      "此操作将从音效资产库中永久删除此文件元数据，此操作不可撤销。",
      () => {
        const remaining = sounds.filter(s => s.id !== id);
        setSounds(remaining);
        if (selectedSoundId === id && remaining.length > 0) {
          setSelectedSoundId(remaining[0].id);
        }
      }
    );
  };

  const handleExportSelected = () => {
    handleDownloadSingleSound(selectedSound);
    showCustomAlert(
      "音效导出并下载成功",
      `已成功为您打包导出并物理下载音频文件: ${selectedSound.fileName}\n路径: ${selectedSound.path}\n格式: ${selectedSound.format} | 大小: ${selectedSound.size}\n\n[提示] 该音效文件已同时推送至引擎共享资产缓存，可在 Unity/Unreal 资产同步器中直接读取！`
    );
  };

  // Reset all filters
  const resetFilters = () => {
    setFilterDuration('全部');
    setFilterChannel('全部');
    setFilterFormat('全部');
    setFilterDesigner('全部');
    setFilterSampleRate('全部');
    setSelectedTag(null);
  };

  return (
    <div id="sfx-library-workbench" className="flex-1 flex flex-col h-screen overflow-hidden bg-slate-50" onDragOver={handleDragOver} onDrop={handleDrop}>
      
      {/* Hidden file selector */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileSelect} 
        className="hidden" 
        accept="audio/*" 
        multiple
      />

      {/* Hidden folder selector */}
      <input 
        type="file" 
        ref={folderInputRef} 
        onChange={handleFolderSelect} 
        className="hidden" 
        accept="audio/*" 
        // @ts-ignore
        webkitdirectory=""
        // @ts-ignore
        directory=""
      />

      {/* 1. Header Toolbar (菜单栏：导入/导出 | 设置 | 关于 & Mode Permission Switch) */}
      <header id="sfx-lib-header" className="h-14 border-b border-slate-200 px-6 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-emerald-600" />
          <h2 className="text-sm font-black text-slate-800 tracking-wider flex items-center gap-1.5">
            <span>游戏音效资产库</span>
            <span className="text-[10px] bg-emerald-50 text-emerald-700 font-mono py-0.5 px-2 rounded-full border border-emerald-100">V1.2 Live</span>
          </h2>
          
          <div className="hidden lg:flex items-center gap-1.5 ml-6 border-l border-slate-200 pl-6 text-xs text-slate-400">
            <span className="hover:text-emerald-600 cursor-pointer transition-colors" onClick={() => showCustomAlert("模拟清单导出", "已成功为您模拟并导出当前的音效/音乐资产完整数据清单（JSON 格式）。")}>导出清单</span>
            <span className="text-slate-200">·</span>
            <span className="hover:text-emerald-600 cursor-pointer transition-colors" onClick={() => setIsImportModalOpen(true)}>资产导入</span>
            <span className="text-slate-200">·</span>
            <span className="hover:text-emerald-600 cursor-pointer transition-colors" onClick={() => showCustomAlert("引擎 & DAW 同步通道已开启", "⚙️ 音频引擎资产同步通道(Unity / Unreal Integration)与DAW工作流(Reaper Link)集成服务已被唤醒并建立桥接。")}>同步通道</span>
          </div>
        </div>

        {/* Help Guidelines */}
        <div className="flex items-center gap-3">

          <button 
            onClick={() => showCustomAlert("💡 操作使用指南", "1. 双轨制目录设计：左侧为“音效分类”、“全部音乐”与“公司游戏音效”树形目录树，支持无限层级拓展与手动删减/重命名，右侧支持一键AI智能标签匹配检索。\n\n2. 模糊意图智能搜索：输入“低频重击”等人类描述词时，Gemini 会自动声音情绪、物理特性并映射对齐 #低频、#撞击等对应资产标签。\n\n3. 键盘空格键热键：在浏览任何界面时，按下键盘“空格键 (Space)”可以一键控制当前选中音频文件的播放或暂停试听。\n\n4. 工作站拖动桥接：支持将右侧的资产卡片直接通过鼠标拖动投递到正在运行中的 Unity / Unreal 引擎及 Reaper DAW 轨道中自动同步。")}
            className="p-2 bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-800 rounded-xl hover:bg-slate-200/50 transition-all"
            title="操作指南"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Three-Column Layout Container */}
      <div id="sfx-library-columns" className="flex-1 flex overflow-hidden">
        
        {/* ==================== LEFT COLUMN: Directory Tree & Tag Cloud ==================== */}
        <aside id="sfx-lib-left-panel" className="w-60 bg-white border-r border-slate-200 flex flex-col justify-between shrink-0 overflow-y-auto custom-scrollbar">
          <div className="p-4 space-y-6">

            {/* Audio Asset Index Status */}
            <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-slate-50 p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Asset Index</p>
                  <h3 className="mt-1 text-xs font-black text-slate-800">可调取音频素材库</h3>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                    保留本地上传；上传成功的音效会自动进入索引，其他人可按分类、标签、文件名检索调用。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={refreshAudioAssetIndex}
                  disabled={isRefreshingAssetIndex}
                  className="rounded-lg border border-emerald-100 bg-white p-1.5 text-emerald-700 shadow-sm transition-all hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  title="刷新服务端素材索引"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingAssetIndex ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded-xl border border-white/70 bg-white/80 p-2">
                  <p className="font-mono text-base font-black text-slate-800">{assetStats.total}</p>
                  <p className="font-bold text-slate-400">总素材</p>
                </div>
                <div className="rounded-xl border border-white/70 bg-white/80 p-2">
                  <p className="font-mono text-base font-black text-emerald-700">{assetStats.uploaded}</p>
                  <p className="font-bold text-slate-400">本地上传</p>
                </div>
                <div className="rounded-xl border border-white/70 bg-white/80 p-2">
                  <p className="font-mono text-sm font-black text-indigo-700">{assetStats.byKind.sfx || 0}</p>
                  <p className="font-bold text-slate-400">音效</p>
                </div>
                <div className="rounded-xl border border-white/70 bg-white/80 p-2">
                  <p className="font-mono text-sm font-black text-amber-700">{assetStats.byKind.music || 0}</p>
                  <p className="font-bold text-slate-400">音乐</p>
                </div>
              </div>

              {assetStats.topTags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {assetStats.topTags.slice(0, 4).map(item => (
                    <span key={item.tag} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-700">
                      #{item.tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            
            {/* Standard Directory Tree */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-slate-400 uppercase px-1">
                <span>标准目录树</span>
                <span className="text-[10px] text-slate-400">Categories</span>
              </div>
              <nav className="space-y-2">
                {/* 1. 全部 */}
                <button
                  onClick={() => {
                    setSelectedCategory('全部');
                    setSelectedTag(null);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    selectedCategory === '全部' 
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold' 
                      : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Folder className="w-3.5 h-3.5 text-slate-400" />
                    <span>全部音效</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-450 bg-slate-100 px-1.5 py-0.2 rounded">{sounds.length}</span>
                </button>

                {/* ----------------- PARENT GROUP A: 公司游戏音效 ----------------- */}
                <div className="border border-slate-150 rounded-xl bg-slate-50/50 p-1.5 space-y-1">
                  <div 
                    onClick={() => setIsCompanySfxParentExpanded(!isCompanySfxParentExpanded)}
                    className="flex items-center justify-between px-2 py-1.5 rounded-lg text-[10.5px] font-black text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100/50 transition-all"
                  >
                    <span className="flex items-center gap-1">
                      {isCompanySfxParentExpanded ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
                      公司游戏音效
                    </span>
                    <span className="text-[9px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.2 rounded font-bold font-mono">
                      {categories.filter(c => c.id === 'company_sfx').reduce((acc, c) => acc + sounds.filter(s => s.category === c.name || c.subCategories.map(sub => sub.name).includes(s.category) || (s.subcategory && c.subCategories.map(sub => sub.name).includes(s.subcategory))).length, 0)}
                    </span>
                  </div>

                  {isCompanySfxParentExpanded && (
                    <div className="space-y-1 pl-0.5">
                      {categories
                        .filter(c => c.id === 'company_sfx')
                        .map((group) => {
                          const isExpanded = !!expandedGroups[group.id];
                          const isGroupActive = selectedCategory === group.name;
                          const groupCount = sounds.filter(s => {
                            const subNames = group.subCategories.map(sub => sub.name);
                            return s.category === group.name || subNames.includes(s.category) || (s.subcategory && subNames.includes(s.subcategory));
                          }).length;

                          return (
                            <div key={group.id} className="space-y-0.5 border border-slate-100 bg-white rounded-lg p-1 shadow-sm">
                              {/* Top level group header with hover editing tools */}
                              <div
                                onClick={() => {
                                  setSelectedCategory(group.name);
                                  setSelectedTag(null);
                                }}
                                className={`group flex items-center justify-between px-1.5 py-1 rounded text-xs font-semibold cursor-pointer transition-all ${
                                  isGroupActive
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center gap-1 min-w-0 flex-1">
                                  {/* Collapse toggle */}
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedGroups(prev => ({ ...prev, [group.id]: !isExpanded }));
                                    }}
                                    className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
                                  >
                                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                  </div>
                                  
                                  {editingCategoryId === group.id ? (
                                    <input
                                      type="text"
                                      value={editNameInput}
                                      onChange={(e) => setEditNameInput(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') confirmRenameCategory(group.id, group.name);
                                        if (e.key === 'Escape') setEditingCategoryId(null);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="px-1.5 py-0.5 rounded border border-emerald-300 focus:border-emerald-500 bg-white text-[10.5px] font-bold text-slate-800 w-28 outline-none"
                                      autoFocus
                                    />
                                  ) : (
                                    <span className="truncate text-[11px] font-bold" title={group.english}>{group.name}</span>
                                  )}
                                </div>
                                
                                {/* Edit tools overlay on hover */}
                                <div className="flex items-center gap-0.5 shrink-0">
                                  {editingCategoryId !== group.id && (
                                    <div className="hidden group-hover:flex items-center gap-0.5 bg-slate-50 border border-slate-150 p-0.5 rounded shadow-sm mr-1">
                                      {/* Download Folder */}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          downloadFolderAsZip(group.name, true);
                                        }}
                                        className="p-0.5 text-slate-400 hover:text-indigo-650 hover:bg-slate-150 rounded cursor-pointer"
                                        title="一键打包下载当前目录下全部音效"
                                      >
                                        <Download className="w-2.5 h-2.5" />
                                      </button>
                                      {isAuthorized && (
                                        <>
                                          {/* Rename */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              startRenameCategory(group.id, group.name);
                                            }}
                                            className="p-0.5 text-slate-400 hover:text-emerald-600 hover:bg-slate-150 rounded"
                                            title="重命名目录"
                                          >
                                            <Edit2 className="w-2.5 h-2.5" />
                                          </button>
                                          {/* Add subfolder */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setIsAddingSubToId(group.id);
                                              setNewSubNameInput('');
                                            }}
                                            className="p-0.5 text-slate-400 hover:text-blue-600 hover:bg-slate-150 rounded"
                                            title="新建子文件夹"
                                          >
                                            <Plus className="w-2.5 h-2.5" />
                                          </button>
                                          {/* Delete */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteCategory(group.id, group.name);
                                            }}
                                            className="p-0.5 text-slate-400 hover:text-red-600 hover:bg-slate-150 rounded"
                                            title="删除目录"
                                          >
                                            <Trash2 className="w-2.5 h-2.5" />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  )}

                                  {editingCategoryId === group.id ? (
                                    <div className="flex items-center gap-0.5 mr-1 shrink-0">
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); confirmRenameCategory(group.id, group.name); }}
                                        className="p-0.5 text-emerald-600 bg-emerald-50 border border-emerald-100 rounded"
                                      >
                                        <Check className="w-2.5 h-2.5" />
                                      </button>
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); setEditingCategoryId(null); }}
                                        className="p-0.5 text-slate-400 bg-slate-50 border border-slate-150 rounded"
                                      >
                                        <X className="w-2.5 h-2.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[9px] font-mono text-slate-450 bg-slate-100 px-1 rounded shrink-0">
                                      {groupCount}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Form to add subcategory */}
                              {isAddingSubToId === group.id && (
                                <div className="p-1 border border-slate-100 rounded bg-slate-50 flex items-center gap-1 my-1 ml-4 mr-1">
                                  <input
                                    type="text"
                                    value={newSubNameInput}
                                    onChange={(e) => setNewSubNameInput(e.target.value)}
                                    placeholder="输入子目录名"
                                    className="px-1 py-0.5 border border-slate-200 rounded text-[9.5px] w-24 outline-none focus:border-emerald-500"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleAddSubCategory(group.id);
                                      if (e.key === 'Escape') setIsAddingSubToId(null);
                                    }}
                                  />
                                  <button onClick={() => handleAddSubCategory(group.id)} className="p-0.5 text-emerald-600 bg-emerald-50 border border-emerald-100 rounded hover:bg-emerald-100">
                                    <Check className="w-2.5 h-2.5" />
                                  </button>
                                  <button onClick={() => setIsAddingSubToId(null)} className="p-0.5 text-slate-400 bg-slate-50 border border-slate-150 rounded hover:bg-slate-100">
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              )}

                              {/* Indented subcategories list */}
                              {isExpanded && (
                                <div className="pl-3.5 space-y-0.5 border-l border-slate-100 ml-3.5 my-1">
                                  {group.subCategories.length === 0 ? (
                                    <div className="text-[9.5px] text-slate-400 italic py-1 px-1 flex items-center gap-1">
                                      <span>空文件夹目录</span>
                                      {isAuthorized && (
                                        <span onClick={() => { setIsAddingSubToId(group.id); setNewSubNameInput(''); }} className="text-indigo-600 font-bold underline cursor-pointer">添加</span>
                                      )}
                                    </div>
                                  ) : (
                                    group.subCategories.map((sub, subIdx) => {
                                      const isSubActive = selectedCategory === sub.name;
                                      const subCount = sounds.filter(s => s.category === sub.name || s.subcategory === sub.name).length;

                                      return (
                                        <div
                                          key={sub.id}
                                          className="group/sub flex items-center justify-between py-0.5 rounded transition-all hover:bg-slate-50"
                                        >
                                          {editingSubCategoryId === sub.id ? (
                                            <div className="flex items-center gap-1 flex-1 pl-1">
                                              <input
                                                type="text"
                                                value={editNameInput}
                                                onChange={(e) => setEditNameInput(e.target.value)}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') confirmRenameSubCategory(group.id, sub.id, sub.name);
                                                  if (e.key === 'Escape') setEditingSubCategoryId(null);
                                                }}
                                                className="px-1 py-0.5 rounded border border-emerald-300 focus:border-emerald-500 bg-white text-[10px] w-24 outline-none"
                                                autoFocus
                                              />
                                              <button 
                                                onClick={() => confirmRenameSubCategory(group.id, sub.id, sub.name)}
                                                className="p-0.5 text-emerald-600 bg-emerald-50 border border-emerald-100 rounded shrink-0"
                                              >
                                                <Check className="w-2 h-2" />
                                              </button>
                                              <button 
                                                onClick={() => setEditingSubCategoryId(null)}
                                                className="p-0.5 text-slate-400 bg-slate-50 border border-slate-150 rounded shrink-0"
                                              >
                                                <X className="w-2.5 h-2.5" />
                                              </button>
                                            </div>
                                          ) : (
                                            <button
                                              onClick={() => {
                                                setSelectedCategory(sub.name);
                                                setSelectedTag(null);
                                              }}
                                              className={`flex-1 flex items-center justify-between py-1 px-1.5 rounded text-[10px] font-medium transition-all ${
                                                isSubActive
                                                  ? 'bg-emerald-50/70 text-emerald-700 font-bold'
                                                  : 'text-slate-500 hover:text-slate-800'
                                              }`}
                                            >
                                              <span className="truncate text-left shrink" title={sub.description}>📄 {sub.name}</span>
                                            </button>
                                          )}

                                          {/* Hover tools for subfolders */}
                                          {editingSubCategoryId !== sub.id && (
                                            <div className="hidden group-hover/sub:flex items-center gap-0.5 bg-slate-50 border border-slate-150 p-0.5 rounded shadow-sm mr-1">
                                              {/* Download Subfolder */}
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  downloadFolderAsZip(sub.name, false);
                                                }}
                                                className="p-0.5 text-slate-400 hover:text-indigo-650 hover:bg-slate-150 rounded cursor-pointer"
                                                title="一键打包下载当前子目录下全部音效"
                                              >
                                                <Download className="w-2 h-2" />
                                              </button>
                                              {isAuthorized && (
                                                <>
                                                  {/* Move Up */}
                                                  <button
                                                    onClick={() => moveSubCategory(group.id, sub.id, 'up')}
                                                    disabled={subIdx === 0}
                                                    className="p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-150 rounded disabled:opacity-30"
                                                    title="向上移动"
                                                  >
                                                    <ArrowUp className="w-2 h-2" />
                                                  </button>
                                                  {/* Move Down */}
                                                  <button
                                                    onClick={() => moveSubCategory(group.id, sub.id, 'down')}
                                                    disabled={subIdx === group.subCategories.length - 1}
                                                    className="p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-150 rounded disabled:opacity-30"
                                                    title="向下移动"
                                                  >
                                                    <ArrowDown className="w-2 h-2" />
                                                  </button>
                                                  {/* Rename */}
                                                  <button
                                                    onClick={() => startRenameSubCategory(sub.id, sub.name)}
                                                    className="p-0.5 text-slate-400 hover:text-emerald-600 hover:bg-slate-150 rounded"
                                                    title="重命名子目录"
                                                  >
                                                    <Edit2 className="w-2.5 h-2.5" />
                                                  </button>
                                                  {/* Delete */}
                                                  <button
                                                    onClick={() => handleDeleteSubCategory(group.id, sub.id, sub.name)}
                                                    className="p-0.5 text-slate-400 hover:text-red-600 hover:bg-slate-150 rounded"
                                                    title="删除子目录"
                                                  >
                                                    <Trash2 className="w-2.5 h-2.5" />
                                                  </button>
                                                </>
                                              )}
                                            </div>
                                          )}

                                          {editingSubCategoryId !== sub.id && (
                                            <span className="text-[8px] font-mono text-slate-400 ml-1 shrink-0 mr-1.5">
                                              {subCount}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>

                {/* ----------------- PARENT GROUP B: 全部音乐 ----------------- */}
                <div className="border border-slate-150 rounded-xl bg-slate-50/50 p-1.5 space-y-1">
                  <div 
                    onClick={() => setIsMusicParentExpanded(!isMusicParentExpanded)}
                    className="flex items-center justify-between px-2 py-1.5 rounded-lg text-[10.5px] font-black text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100/50 transition-all"
                  >
                    <span className="flex items-center gap-1">
                      {isMusicParentExpanded ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
                      全部音乐
                    </span>
                    <span className="text-[9px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-1.5 py-0.2 rounded font-bold font-mono">
                      {categories.filter(c => c.id === 'music_all').reduce((acc, c) => acc + sounds.filter(s => s.category === c.name || c.subCategories.map(sub => sub.name).includes(s.category) || (s.subcategory && c.subCategories.map(sub => sub.name).includes(s.subcategory))).length, 0)}
                    </span>
                  </div>

                  {isMusicParentExpanded && (
                    <div className="space-y-1 pl-0.5">
                      {categories
                        .filter(c => c.id === 'music_all')
                        .map((group) => {
                          const isExpanded = !!expandedGroups[group.id];
                          const isGroupActive = selectedCategory === group.name;
                          const groupCount = sounds.filter(s => {
                            const subNames = group.subCategories.map(sub => sub.name);
                            return s.category === group.name || subNames.includes(s.category) || (s.subcategory && subNames.includes(s.subcategory));
                          }).length;

                          return (
                            <div key={group.id} className="space-y-0.5 border border-slate-100 bg-white rounded-lg p-1 shadow-sm">
                              {/* Top level group header with hover editing tools */}
                              <div
                                onClick={() => {
                                  setSelectedCategory(group.name);
                                  setSelectedTag(null);
                                }}
                                className={`group flex items-center justify-between px-1.5 py-1 rounded text-xs font-semibold cursor-pointer transition-all ${
                                  isGroupActive
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center gap-1 min-w-0 flex-1">
                                  {/* Collapse toggle */}
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedGroups(prev => ({ ...prev, [group.id]: !isExpanded }));
                                    }}
                                    className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
                                  >
                                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                  </div>
                                  
                                  {editingCategoryId === group.id ? (
                                    <input
                                      type="text"
                                      value={editNameInput}
                                      onChange={(e) => setEditNameInput(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') confirmRenameCategory(group.id, group.name);
                                        if (e.key === 'Escape') setEditingCategoryId(null);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="px-1.5 py-0.5 rounded border border-emerald-300 focus:border-emerald-500 bg-white text-[10.5px] font-bold text-slate-800 w-28 outline-none"
                                      autoFocus
                                    />
                                  ) : (
                                    <span className="truncate text-[11px] font-bold" title={group.english}>{group.name}</span>
                                  )}
                                </div>
                                
                                {/* Edit tools overlay on hover */}
                                <div className="flex items-center gap-0.5 shrink-0">
                                  {editingCategoryId !== group.id && (
                                    <div className="hidden group-hover:flex items-center gap-0.5 bg-slate-50 border border-slate-150 p-0.5 rounded shadow-sm mr-1">
                                      {/* Download Folder */}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          downloadFolderAsZip(group.name, true);
                                        }}
                                        className="p-0.5 text-slate-400 hover:text-indigo-650 hover:bg-slate-150 rounded cursor-pointer"
                                        title="一键打包下载当前目录下全部音效"
                                      >
                                        <Download className="w-2.5 h-2.5" />
                                      </button>
                                      {isAuthorized && (
                                        <>
                                          {/* Rename */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              startRenameCategory(group.id, group.name);
                                            }}
                                            className="p-0.5 text-slate-400 hover:text-emerald-600 hover:bg-slate-150 rounded"
                                            title="重命名目录"
                                          >
                                            <Edit2 className="w-2.5 h-2.5" />
                                          </button>
                                          {/* Add subfolder */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setIsAddingSubToId(group.id);
                                              setNewSubNameInput('');
                                            }}
                                            className="p-0.5 text-slate-400 hover:text-blue-600 hover:bg-slate-150 rounded"
                                            title="新建子文件夹"
                                          >
                                            <Plus className="w-2.5 h-2.5" />
                                          </button>
                                          {/* Delete */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteCategory(group.id, group.name);
                                            }}
                                            className="p-0.5 text-slate-400 hover:text-red-600 hover:bg-slate-150 rounded"
                                            title="删除目录"
                                          >
                                            <Trash2 className="w-2.5 h-2.5" />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  )}

                                  {editingCategoryId === group.id ? (
                                    <div className="flex items-center gap-0.5 mr-1 shrink-0">
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); confirmRenameCategory(group.id, group.name); }}
                                        className="p-0.5 text-emerald-600 bg-emerald-50 border border-emerald-100 rounded"
                                      >
                                        <Check className="w-2.5 h-2.5" />
                                      </button>
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); setEditingCategoryId(null); }}
                                        className="p-0.5 text-slate-400 bg-slate-50 border border-slate-150 rounded"
                                      >
                                        <X className="w-2.5 h-2.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[9px] font-mono text-slate-450 bg-slate-100 px-1 rounded shrink-0">
                                      {groupCount}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Form to add subcategory */}
                              {isAddingSubToId === group.id && (
                                <div className="p-1 border border-slate-100 rounded bg-slate-50 flex items-center gap-1 my-1 ml-4 mr-1">
                                  <input
                                    type="text"
                                    value={newSubNameInput}
                                    onChange={(e) => setNewSubNameInput(e.target.value)}
                                    placeholder="输入子目录名"
                                    className="px-1 py-0.5 border border-slate-200 rounded text-[9.5px] w-24 outline-none focus:border-emerald-500"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleAddSubCategory(group.id);
                                      if (e.key === 'Escape') setIsAddingSubToId(null);
                                    }}
                                  />
                                  <button onClick={() => handleAddSubCategory(group.id)} className="p-0.5 text-emerald-600 bg-emerald-50 border border-emerald-100 rounded hover:bg-emerald-100">
                                    <Check className="w-2.5 h-2.5" />
                                  </button>
                                  <button onClick={() => setIsAddingSubToId(null)} className="p-0.5 text-slate-400 bg-slate-50 border border-slate-150 rounded hover:bg-slate-100">
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              )}

                              {/* Indented subcategories list */}
                              {isExpanded && (
                                <div className="pl-3.5 space-y-0.5 border-l border-slate-100 ml-3.5 my-1">
                                  {group.subCategories.length === 0 ? (
                                    <div className="text-[9.5px] text-slate-400 italic py-1 px-1 flex items-center gap-1">
                                      <span>空文件夹目录</span>
                                      {isAuthorized && (
                                        <span onClick={() => { setIsAddingSubToId(group.id); setNewSubNameInput(''); }} className="text-indigo-600 font-bold underline cursor-pointer">添加</span>
                                      )}
                                    </div>
                                  ) : (
                                    group.subCategories.map((sub, subIdx) => {
                                      const isSubActive = selectedCategory === sub.name;
                                      const subCount = sounds.filter(s => s.category === sub.name || s.subcategory === sub.name).length;

                                      return (
                                        <div
                                          key={sub.id}
                                          className="group/sub flex items-center justify-between py-0.5 rounded transition-all hover:bg-slate-50"
                                        >
                                          {editingSubCategoryId === sub.id ? (
                                            <div className="flex items-center gap-1 flex-1 pl-1">
                                              <input
                                                type="text"
                                                value={editNameInput}
                                                onChange={(e) => setEditNameInput(e.target.value)}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') confirmRenameSubCategory(group.id, sub.id, sub.name);
                                                  if (e.key === 'Escape') setEditingSubCategoryId(null);
                                                }}
                                                className="px-1 py-0.5 rounded border border-emerald-300 focus:border-emerald-500 bg-white text-[10px] w-24 outline-none"
                                                autoFocus
                                              />
                                              <button 
                                                onClick={() => confirmRenameSubCategory(group.id, sub.id, sub.name)}
                                                className="p-0.5 text-emerald-600 bg-emerald-50 border border-emerald-100 rounded shrink-0"
                                              >
                                                <Check className="w-2 h-2" />
                                              </button>
                                              <button 
                                                onClick={() => setEditingSubCategoryId(null)}
                                                className="p-0.5 text-slate-400 bg-slate-50 border border-slate-150 rounded shrink-0"
                                              >
                                                <X className="w-2.5 h-2.5" />
                                              </button>
                                            </div>
                                          ) : (
                                            <button
                                              onClick={() => {
                                                setSelectedCategory(sub.name);
                                                setSelectedTag(null);
                                              }}
                                              className={`flex-1 flex items-center justify-between py-1 px-1.5 rounded text-[10px] font-medium transition-all ${
                                                isSubActive
                                                  ? 'bg-emerald-50/70 text-emerald-700 font-bold'
                                                  : 'text-slate-500 hover:text-slate-800'
                                              }`}
                                            >
                                              <span className="truncate text-left shrink" title={sub.description}>📄 {sub.name}</span>
                                            </button>
                                          )}

                                          {/* Hover tools for subfolders */}
                                          {editingSubCategoryId !== sub.id && (
                                            <div className="hidden group-hover/sub:flex items-center gap-0.5 bg-slate-50 border border-slate-150 p-0.5 rounded shadow-sm mr-1">
                                              {/* Download Subfolder */}
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  downloadFolderAsZip(sub.name, false);
                                                }}
                                                className="p-0.5 text-slate-400 hover:text-indigo-650 hover:bg-slate-150 rounded cursor-pointer"
                                                title="一键打包下载当前子目录下全部音效"
                                              >
                                                <Download className="w-2 h-2" />
                                              </button>
                                              {isAuthorized && (
                                                <>
                                                  {/* Move Up */}
                                                  <button
                                                    onClick={() => moveSubCategory(group.id, sub.id, 'up')}
                                                    disabled={subIdx === 0}
                                                    className="p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-150 rounded disabled:opacity-30"
                                                    title="向上移动"
                                                  >
                                                    <ArrowUp className="w-2 h-2" />
                                                  </button>
                                                  {/* Move Down */}
                                                  <button
                                                    onClick={() => moveSubCategory(group.id, sub.id, 'down')}
                                                    disabled={subIdx === group.subCategories.length - 1}
                                                    className="p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-150 rounded disabled:opacity-30"
                                                    title="向下移动"
                                                  >
                                                    <ArrowDown className="w-2 h-2" />
                                                  </button>
                                                  {/* Rename */}
                                                  <button
                                                    onClick={() => startRenameSubCategory(sub.id, sub.name)}
                                                    className="p-0.5 text-slate-400 hover:text-emerald-600 hover:bg-slate-150 rounded"
                                                    title="重命名子目录"
                                                  >
                                                    <Edit2 className="w-2.5 h-2.5" />
                                                  </button>
                                                  {/* Delete */}
                                                  <button
                                                    onClick={() => handleDeleteSubCategory(group.id, sub.id, sub.name)}
                                                    className="p-0.5 text-slate-400 hover:text-red-600 hover:bg-slate-150 rounded"
                                                    title="删除子目录"
                                                  >
                                                    <Trash2 className="w-2.5 h-2.5" />
                                                  </button>
                                                </>
                                              )}
                                            </div>
                                          )}

                                          {editingSubCategoryId !== sub.id && (
                                            <span className="text-[8px] font-mono text-slate-400 ml-1 shrink-0 mr-1.5">
                                              {subCount}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>

                {/* ----------------- PARENT GROUP C: 音效分类 ----------------- */}
                <div className="border border-slate-150 rounded-xl bg-slate-50/50 p-1.5 space-y-1">
                  <div 
                    onClick={() => setIsStandardSfxParentExpanded(!isStandardSfxParentExpanded)}
                    className="flex items-center justify-between px-2 py-1.5 rounded-lg text-[10.5px] font-black text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100/50 transition-all"
                  >
                    <span className="flex items-center gap-1">
                      {isStandardSfxParentExpanded ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
                      音效分类
                    </span>
                    <span className="text-[9px] bg-emerald-50 text-emerald-600 border border-emerald-100 px-1.5 py-0.2 rounded font-bold font-mono">
                      {categories.filter(c => c.id !== 'music_all' && c.id !== 'company_sfx').reduce((acc, c) => acc + sounds.filter(s => s.category === c.name || c.subCategories.map(sub => sub.name).includes(s.category) || (s.subcategory && c.subCategories.map(sub => sub.name).includes(s.subcategory))).length, 0)}
                    </span>
                  </div>

                  {isStandardSfxParentExpanded && (
                    <div className="space-y-1 pl-0.5">
                      {categories
                        .filter(c => c.id !== 'music_all' && c.id !== 'company_sfx')
                        .map((group, sectionIdx) => {
                          const isExpanded = !!expandedGroups[group.id];
                          const isGroupActive = selectedCategory === group.name;
                          const groupCount = sounds.filter(s => {
                            const subNames = group.subCategories.map(sub => sub.name);
                            return s.category === group.name || subNames.includes(s.category) || (s.subcategory && subNames.includes(s.subcategory));
                          }).length;

                          return (
                            <div key={group.id} className="space-y-0.5 border border-slate-100 bg-white rounded-lg p-1 shadow-sm">
                              {/* Top level group header */}
                              <div
                                onClick={() => {
                                  setSelectedCategory(group.name);
                                  setSelectedTag(null);
                                }}
                                className={`group flex items-center justify-between px-1.5 py-1 rounded text-xs font-semibold cursor-pointer transition-all ${
                                  isGroupActive
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center gap-1 min-w-0 flex-1">
                                  {/* Collapse toggle */}
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedGroups(prev => ({ ...prev, [group.id]: !isExpanded }));
                                    }}
                                    className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
                                  >
                                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                  </div>
                                  
                                  {editingCategoryId === group.id ? (
                                    <input
                                      type="text"
                                      value={editNameInput}
                                      onChange={(e) => setEditNameInput(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') confirmRenameCategory(group.id, group.name);
                                        if (e.key === 'Escape') setEditingCategoryId(null);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="px-1.5 py-0.5 rounded border border-emerald-300 focus:border-emerald-500 bg-white text-[10.5px] font-bold text-slate-800 w-28 outline-none"
                                      autoFocus
                                    />
                                  ) : (
                                    <span className="truncate text-[11px] font-bold" title={group.english}>{group.name}</span>
                                  )}
                                </div>
                                
                                {/* Edit tools overlay */}
                                <div className="flex items-center gap-0.5 shrink-0">
                                  {editingCategoryId !== group.id && (
                                    <div className="hidden group-hover:flex items-center gap-0.5 bg-slate-50 border border-slate-150 p-0.5 rounded shadow-sm mr-1">
                                      {/* Download Folder */}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          downloadFolderAsZip(group.name, true);
                                        }}
                                        className="p-0.5 text-slate-400 hover:text-indigo-650 hover:bg-slate-150 rounded cursor-pointer"
                                        title="一键打包下载当前目录下全部音效"
                                      >
                                        <Download className="w-2.5 h-2.5" />
                                      </button>
                                      {isAuthorized && (
                                        <>
                                          {/* Move Up */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              moveCategory(group.id, 'up');
                                            }}
                                            disabled={sectionIdx === 0}
                                            className="p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-150 rounded disabled:opacity-30"
                                            title="向上移动"
                                          >
                                            <ArrowUp className="w-2.5 h-2.5" />
                                          </button>
                                          {/* Move Down */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              moveCategory(group.id, 'down');
                                            }}
                                            disabled={sectionIdx === categories.filter(c => c.id !== 'music_all' && c.id !== 'company_sfx').length - 1}
                                            className="p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-150 rounded disabled:opacity-30"
                                            title="向下移动"
                                          >
                                            <ArrowDown className="w-2.5 h-2.5" />
                                          </button>
                                          {/* Rename */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              startRenameCategory(group.id, group.name);
                                            }}
                                            className="p-0.5 text-slate-400 hover:text-emerald-600 hover:bg-slate-150 rounded"
                                            title="重命名目录"
                                          >
                                            <Edit2 className="w-2.5 h-2.5" />
                                          </button>
                                          {/* Add subfolder */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setIsAddingSubToId(group.id);
                                              setNewSubNameInput('');
                                            }}
                                            className="p-0.5 text-slate-400 hover:text-blue-600 hover:bg-slate-150 rounded"
                                            title="新建子文件夹"
                                          >
                                            <Plus className="w-2.5 h-2.5" />
                                          </button>
                                          {/* Delete */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteCategory(group.id, group.name);
                                            }}
                                            className="p-0.5 text-slate-400 hover:text-red-600 hover:bg-slate-150 rounded"
                                            title="删除目录"
                                          >
                                            <Trash2 className="w-2.5 h-2.5" />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  )}

                                  {editingCategoryId === group.id ? (
                                    <div className="flex items-center gap-0.5 mr-1 shrink-0">
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); confirmRenameCategory(group.id, group.name); }}
                                        className="p-0.5 text-emerald-600 bg-emerald-50 border border-emerald-100 rounded"
                                      >
                                        <Check className="w-2.5 h-2.5" />
                                      </button>
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); setEditingCategoryId(null); }}
                                        className="p-0.5 text-slate-400 bg-slate-50 border border-slate-150 rounded"
                                      >
                                        <X className="w-2.5 h-2.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[9px] font-mono text-slate-450 bg-slate-100 px-1 rounded shrink-0">
                                      {groupCount}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Form to add subcategory */}
                              {isAddingSubToId === group.id && (
                                <div className="p-1 border border-slate-100 rounded bg-slate-50 flex items-center gap-1 my-1 ml-4 mr-1">
                                  <input
                                    type="text"
                                    value={newSubNameInput}
                                    onChange={(e) => setNewSubNameInput(e.target.value)}
                                    placeholder="输入子目录名"
                                    className="px-1 py-0.5 border border-slate-200 rounded text-[9.5px] w-24 outline-none focus:border-emerald-500"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleAddSubCategory(group.id);
                                      if (e.key === 'Escape') setIsAddingSubToId(null);
                                    }}
                                  />
                                  <button onClick={() => handleAddSubCategory(group.id)} className="p-0.5 text-emerald-600 bg-emerald-50 border border-emerald-100 rounded hover:bg-emerald-100">
                                    <Check className="w-2.5 h-2.5" />
                                  </button>
                                  <button onClick={() => setIsAddingSubToId(null)} className="p-0.5 text-slate-400 bg-slate-50 border border-slate-150 rounded hover:bg-slate-100">
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              )}

                              {/* Indented subcategories list */}
                              {isExpanded && (
                                <div className="pl-3.5 space-y-0.5 border-l border-slate-100 ml-3.5 my-1">
                                  {group.subCategories.length === 0 ? (
                                    <div className="text-[9.5px] text-slate-400 italic py-1 px-1 flex items-center gap-1">
                                      <span>空文件夹目录</span>
                                      {isAuthorized && (
                                        <span onClick={() => { setIsAddingSubToId(group.id); setNewSubNameInput(''); }} className="text-indigo-600 font-bold underline cursor-pointer">添加</span>
                                      )}
                                    </div>
                                  ) : (
                                    group.subCategories.map((sub, subIdx) => {
                                      const isSubActive = selectedCategory === sub.name;
                                      const subCount = sounds.filter(s => s.category === sub.name || s.subcategory === sub.name).length;

                                      return (
                                        <div
                                          key={sub.id}
                                          className="group/sub flex items-center justify-between py-0.5 rounded transition-all hover:bg-slate-50"
                                        >
                                          {editingSubCategoryId === sub.id ? (
                                            <div className="flex items-center gap-1 flex-1 pl-1">
                                              <input
                                                type="text"
                                                value={editNameInput}
                                                onChange={(e) => setEditNameInput(e.target.value)}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') confirmRenameSubCategory(group.id, sub.id, sub.name);
                                                  if (e.key === 'Escape') setEditingSubCategoryId(null);
                                                }}
                                                className="px-1 py-0.5 rounded border border-emerald-300 focus:border-emerald-500 bg-white text-[10px] w-24 outline-none"
                                                autoFocus
                                              />
                                              <button 
                                                onClick={() => confirmRenameSubCategory(group.id, sub.id, sub.name)}
                                                className="p-0.5 text-emerald-600 bg-emerald-50 border border-emerald-100 rounded shrink-0"
                                              >
                                                <Check className="w-2 h-2" />
                                              </button>
                                              <button 
                                                onClick={() => setEditingSubCategoryId(null)}
                                                className="p-0.5 text-slate-400 bg-slate-50 border border-slate-150 rounded shrink-0"
                                              >
                                                <X className="w-2.5 h-2.5" />
                                              </button>
                                            </div>
                                          ) : (
                                            <button
                                              onClick={() => {
                                                setSelectedCategory(sub.name);
                                                setSelectedTag(null);
                                              }}
                                              className={`flex-1 flex items-center justify-between py-1 px-1.5 rounded text-[10px] font-medium transition-all ${
                                                isSubActive
                                                  ? 'bg-emerald-50/70 text-emerald-700 font-bold'
                                                  : 'text-slate-500 hover:text-slate-800'
                                              }`}
                                            >
                                              <span className="truncate text-left shrink" title={sub.description}>📄 {sub.name}</span>
                                            </button>
                                          )}

                                          {/* Hover tools for subfolders */}
                                          {editingSubCategoryId !== sub.id && (
                                            <div className="hidden group-hover/sub:flex items-center gap-0.5 bg-slate-50 border border-slate-150 p-0.5 rounded shadow-sm mr-1">
                                              {/* Download Subfolder */}
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  downloadFolderAsZip(sub.name, false);
                                                }}
                                                className="p-0.5 text-slate-400 hover:text-indigo-650 hover:bg-slate-150 rounded cursor-pointer"
                                                title="一键打包下载当前子目录下全部音效"
                                              >
                                                <Download className="w-2 h-2" />
                                              </button>
                                              {isAuthorized && (
                                                <>
                                                  {/* Move Up */}
                                                  <button
                                                    onClick={() => moveSubCategory(group.id, sub.id, 'up')}
                                                    disabled={subIdx === 0}
                                                    className="p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-150 rounded disabled:opacity-30"
                                                    title="向上移动"
                                                  >
                                                    <ArrowUp className="w-2 h-2" />
                                                  </button>
                                                  {/* Move Down */}
                                                  <button
                                                    onClick={() => moveSubCategory(group.id, sub.id, 'down')}
                                                    disabled={subIdx === group.subCategories.length - 1}
                                                    className="p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-150 rounded disabled:opacity-30"
                                                    title="向下移动"
                                                  >
                                                    <ArrowDown className="w-2 h-2" />
                                                  </button>
                                                  {/* Rename */}
                                                  <button
                                                    onClick={() => startRenameSubCategory(sub.id, sub.name)}
                                                    className="p-0.5 text-slate-400 hover:text-emerald-600 hover:bg-slate-150 rounded"
                                                    title="重命名子目录"
                                                  >
                                                    <Edit2 className="w-2.5 h-2.5" />
                                                  </button>
                                                  {/* Delete */}
                                                  <button
                                                    onClick={() => handleDeleteSubCategory(group.id, sub.id, sub.name)}
                                                    className="p-0.5 text-slate-400 hover:text-red-600 hover:bg-slate-150 rounded"
                                                    title="删除子目录"
                                                  >
                                                    <Trash2 className="w-2.5 h-2.5" />
                                                  </button>
                                                </>
                                              )}
                                            </div>
                                          )}

                                          {editingSubCategoryId !== sub.id && (
                                            <span className="text-[8px] font-mono text-slate-400 ml-1 shrink-0 mr-1.5">
                                              {subCount}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}

                  {/* Add parent category input (only for designer) */}
                  {isAuthorized && (
                    <div className="pt-2 px-1 border-t border-slate-100">
                      {isAddingGroup ? (
                        <div className="flex items-center gap-1.5 p-1 bg-slate-50 rounded-lg border border-slate-200">
                          <input
                            type="text"
                            value={newGroupNameInput}
                            onChange={(e) => setNewGroupNameInput(e.target.value)}
                            placeholder="输入新主分类名..."
                            className="px-2 py-1 text-[10px] rounded border border-slate-300 w-full outline-none focus:border-emerald-500"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddGroup();
                              if (e.key === 'Escape') setIsAddingGroup(false);
                            }}
                          />
                          <button onClick={handleAddGroup} className="p-1 bg-emerald-600 text-white rounded">
                            <Check className="w-2.5 h-2.5" />
                          </button>
                          <button onClick={() => setIsAddingGroup(false)} className="p-1 bg-slate-200 text-slate-600 rounded">
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setIsAddingGroup(true);
                            setNewGroupNameInput('');
                          }}
                          className="w-full flex items-center justify-center gap-1 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 text-[9.5px] rounded-lg transition-all border border-slate-150 border-dashed"
                        >
                          <FolderPlus className="w-3.5 h-3.5 text-slate-400" />
                          <span>新增音效主分类目录</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div className="border-t border-slate-100 my-2" />

                {/* 我的收藏 */}
                <button
                  onClick={() => {
                    setSelectedCategory('我的收藏');
                    setSelectedTag(null);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    selectedCategory === '我的收藏' 
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold' 
                      : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Heart className="w-3.5 h-3.5 text-red-500" />
                    <span>我的收藏</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-450 bg-slate-100 px-1.5 py-0.2 rounded">{sounds.filter(s => s.isFavorite).length}</span>
                </button>
              </nav>
            </div>

            {/* Smart Tag Cloud */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-slate-400 uppercase px-1">
                <span>动态特征标签云</span>
                <span className="text-[10px] text-slate-400">AI Tags</span>
              </div>
              <div className="flex flex-wrap gap-1.5 p-1">
                <button
                  onClick={() => setSelectedTag(null)}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${
                    selectedTag === null 
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/75'
                  }`}
                >
                  # 全部标签
                </button>
                {allTags.map((tag, i) => {
                  const isActive = selectedTag === tag;
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedTag(isActive ? null : tag)}
                      className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${
                        isActive 
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                          : 'bg-slate-100 border border-transparent text-slate-600 hover:bg-slate-200/75 hover:text-slate-800'
                      }`}
                    >
                      #{tag}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Quick Import Box at Bottom left */}
          <div className="p-4 border-t border-slate-200 bg-white space-y-2">
            <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">批量资产入库</span>
            <div 
              className="border border-dashed border-slate-300 hover:border-emerald-500 bg-slate-50 hover:bg-slate-100 rounded-xl p-3.5 text-center cursor-default transition-all flex flex-col items-center gap-1.5 group"
            >
              <UploadCloud className="w-5.5 h-5.5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
              <p className="text-[10px] font-bold text-slate-500 group-hover:text-slate-850">拖拽文件或文件夹至此</p>
              <div className="flex gap-2 w-full justify-center mt-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!checkOwnerPermission()) {
                      return;
                    }
                    fileInputRef.current?.click();
                  }}
                  className="px-2 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-600 hover:text-white rounded-md text-[9px] font-bold transition-all"
                >
                  + 选文件
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!checkOwnerPermission()) {
                      return;
                    }
                    folderInputRef.current?.click();
                  }}
                  className="px-2 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white rounded-md text-[9px] font-bold transition-all"
                >
                  + 选文件夹
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* ==================== MIDDLE COLUMN: Search & Results List ==================== */}
        <section id="sfx-lib-middle-panel" className="flex-1 bg-slate-50 border-r border-slate-200 flex flex-col overflow-hidden">
          
          {/* Fuzzy Search Bar + Suggestions */}
          <div className="p-4 border-b border-slate-200 space-y-3 bg-white">
            <form onSubmit={handleFuzzySearchSubmit} className="relative">
              <Search className="absolute left-3.5 top-3 w-4 h-4 text-emerald-600" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="输入自然描述, 如 '沉闷的金属撞击'、'科幻激光击打'"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-24 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-all shadow-inner"
              />
              <div className="absolute right-2.5 top-1.5 flex items-center gap-1">
                {searchQuery && (
                  <button 
                    type="button" 
                    onClick={() => setSearchQuery('')} 
                    className="p-1 text-slate-400 hover:text-slate-800 rounded"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] px-2.5 py-1.5 rounded-lg transition-colors shadow-sm"
                >
                  搜索
                </button>
              </div>
            </form>

            {/* Suggestions & Search History */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400 text-[10px] font-bold">高频热词:</span>
              <div className="flex flex-wrap gap-1">
                {searchHistory.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => selectHistoryQuery(q)}
                    className="bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-[10px] text-slate-500 hover:text-emerald-650 transition-colors flex items-center gap-0.5"
                  >
                    <span>{q}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Advanced Filters Expand Toggle */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 hover:text-slate-800 transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600" />
                <span>高级多维资产筛选</span>
              </button>
              {(filterDuration !== '全部' || filterChannel !== '全部' || filterFormat !== '全部' || filterDesigner !== '全部' || filterSampleRate !== '全部' || selectedTag) && (
                <button
                  onClick={resetFilters}
                  className="text-[10px] font-mono text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                >
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  <span>重置所有筛选项</span>
                </button>
              )}
            </div>

            {/* Expanded Advanced Filters Row */}
            {showFilters && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 bg-slate-50 border border-slate-200 p-2.5 rounded-xl transition-all shadow-inner">
                {/* 1. Duration */}
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase block">声音时长</label>
                  <select
                    value={filterDuration}
                    onChange={(e) => setFilterDuration(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-slate-700 text-[10px] rounded p-1 focus:outline-none"
                  >
                    <option value="全部">全部</option>
                    <option value="< 1秒">&lt; 1秒</option>
                    <option value="1-3秒">1-3秒</option>
                    <option value="> 3秒">&gt; 3秒</option>
                  </select>
                </div>
                {/* 2. Format */}
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase block">文件格式</label>
                  <select
                    value={filterFormat}
                    onChange={(e) => setFilterFormat(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-slate-700 text-[10px] rounded p-1 focus:outline-none"
                  >
                    <option value="全部">全部</option>
                    <option value="WAV">WAV</option>
                    <option value="OGG">OGG</option>
                    <option value="MP3">MP3</option>
                  </select>
                </div>
                {/* 3. Channel */}
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase block">声道声道</label>
                  <select
                    value={filterChannel}
                    onChange={(e) => setFilterChannel(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-slate-700 text-[10px] rounded p-1 focus:outline-none"
                  >
                    <option value="全部">全部</option>
                    <option value="Mono">单声道 (Mono)</option>
                    <option value="Stereo">双声道 (Stereo)</option>
                  </select>
                </div>
                {/* 4. Designer */}
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase block">声音设计师</label>
                  <select
                    value={filterDesigner}
                    onChange={(e) => setFilterDesigner(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-slate-700 text-[10px] rounded p-1 focus:outline-none"
                  >
                    <option value="全部">全部</option>
                    <option value="AD_Design">AD_Design</option>
                    <option value="Gemini_AI">Gemini_AI</option>
                    <option value="ElevenLabs_Bot">ElevenLabs_Bot</option>
                  </select>
                </div>
                {/* 5. Sample Rate */}
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase block">采样频率</label>
                  <select
                    value={filterSampleRate}
                    onChange={(e) => setFilterSampleRate(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-slate-700 text-[10px] rounded p-1 focus:outline-none"
                  >
                    <option value="全部">全部</option>
                    <option value="44.1">44.1 kHz</option>
                    <option value="48.0">48.0 kHz</option>
                    <option value="96.0">96.0 kHz</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Table list of matching sounds */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
            <div className="flex justify-between items-center text-[10px] text-slate-450 px-2 uppercase font-bold tracking-wider">
              <div className="flex items-center gap-2">
                <span>共检索到 <strong className="text-emerald-700 font-extrabold">{filteredSounds.length}</strong> 个音效资产</span>
                {filteredSounds.length > 0 && (
                  <button
                    onClick={downloadFilteredSoundsAsZip}
                    className="flex items-center gap-1 bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white px-2 py-0.5 rounded-md border border-emerald-100 hover:border-emerald-600 transition-all font-sans cursor-pointer shrink-0 shadow-sm"
                    title="一键打包下载当前列表下的全部音效"
                  >
                    <Download className="w-3 h-3" />
                    <span>一键打包下载当前结果</span>
                  </button>
                )}
              </div>
              <span>点击行可选中与加载预览</span>
            </div>

            {filteredSounds.length === 0 ? (
              <div className="h-60 bg-slate-100/50 border border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center p-6 text-center space-y-2">
                <FileAudio className="w-8 h-8 text-slate-400 animate-pulse" />
                <h3 className="text-xs font-bold text-slate-600">未找到匹配的音效资产</h3>
                <p className="text-[10px] text-slate-500 max-w-sm">
                  请尝试更改模糊描述、精简高级筛选，或者您可以点击左下角一键“拖入新音效”进行资产扩充！
                </p>
                <button
                  onClick={resetFilters}
                  className="text-xs text-emerald-600 hover:underline font-bold"
                >
                  清除所有筛选重新检索
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredSounds.map((sound) => {
                  const isSelected = selectedSoundId === sound.id;
                  const itemProgress = playbackProgress[sound.id] || 0;
                  const isItemPlaying = isPlaying && selectedSoundId === sound.id;

                  return (
                    <div
                      key={sound.id}
                      onClick={() => setSelectedSoundId(sound.id)}
                      className={`group p-3 rounded-xl border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isSelected 
                          ? 'bg-emerald-50/60 border-emerald-300 shadow-sm' 
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {/* Left Block: Audio trigger & Names */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlaySound(sound.id);
                          }}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                            isItemPlaying 
                              ? 'bg-emerald-600 text-white shadow-md' 
                              : 'bg-slate-100 text-slate-600 group-hover:bg-emerald-600 group-hover:text-white'
                          }`}
                        >
                          {isItemPlaying ? (
                            <Pause className="w-3.5 h-3.5 fill-current animate-pulse" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[11px] font-black truncate ${isSelected ? 'text-emerald-700' : 'text-slate-700 group-hover:text-slate-900'}`} title={sound.name}>
                              {sound.name}
                            </span>
                            <span className="text-[8px] bg-slate-100 text-slate-500 border border-slate-200 px-1 rounded-sm uppercase font-mono font-bold shrink-0">
                              {sound.format}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5 min-w-0">
                            <span className="text-slate-500 whitespace-nowrap shrink-0">{sound.category}</span>
                            <span className="text-slate-300 shrink-0">·</span>
                            <span className="truncate min-w-0" title={sound.fileName}>{sound.fileName}</span>
                          </div>
                        </div>
                      </div>

                      {/* Middle Block: Simplified wave progress display */}
                      <div className="flex-1 max-w-xs px-2 hidden md:block">
                        <div className="h-6 flex items-center gap-0.5 bg-slate-100/70 rounded px-1.5 relative overflow-hidden">
                          {/* Simulated mini waveform heights */}
                          {[40, 60, 20, 80, 50, 70, 90, 40, 30, 60, 80, 20, 50, 60, 80, 30, 50, 40].map((h, i) => {
                            const activeLimit = (i / 18) * 100;
                            const isBarActive = isSelected && itemProgress >= activeLimit;
                            return (
                              <div
                                key={i}
                                className={`flex-1 rounded-full transition-all`}
                                style={{
                                  height: `${h}%`,
                                  backgroundColor: isBarActive 
                                    ? '#059669' // emerald-600
                                    : (isItemPlaying ? '#10b981' : '#cbd5e1') // emerald-500 / slate-300
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>

                      {/* Right Block: Attributes, Tags & Actions */}
                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <div className="flex items-center gap-1">
                          {sound.tags.slice(0, 2).map((tag, idx) => (
                            <span key={idx} className="text-[8px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md font-bold">
                              #{tag}
                            </span>
                          ))}
                          {sound.tags.length > 2 && (
                            <span className="text-[8px] text-slate-400">+{sound.tags.length - 2}</span>
                          )}
                        </div>

                        <div className="text-right font-mono text-[10px] text-slate-400 hidden sm:block shrink-0 min-w-[50px]">
                          <p className="font-bold text-slate-700">{sound.duration}s</p>
                          <p className="text-[8px] text-slate-400">{sound.size}</p>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => toggleFavorite(sound.id, e)}
                            className={`p-1.5 rounded-lg border transition-colors ${
                              sound.isFavorite 
                                ? 'bg-red-50 border-red-100 text-red-500' 
                                : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50'
                            }`}
                            title="加入收藏"
                          >
                            <Heart className={`w-3.5 h-3.5 ${sound.isFavorite ? 'fill-current' : ''}`} />
                          </button>
                          
                          {isAuthorized && (
                            <button
                              onClick={(e) => removeSound(sound.id, e)}
                              className="p-1.5 bg-slate-50 hover:bg-red-50 hover:text-red-600 border border-slate-200 rounded-lg text-slate-400 transition-colors"
                              title="移除资产"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Preview Global Audio Player Drawer */}
          <div className="p-4 border-t border-slate-200 bg-white flex flex-col gap-3">
            {/* Audio Waveform with dynamic tracker */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-emerald-700 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-emerald-600 rounded-full animate-ping" />
                  正在试听试用: {selectedSound.name}
                </span>
                <span className="text-slate-500">
                  {currentTime.toFixed(2)}s / {(loadedDuration !== null ? loadedDuration : (selectedSound.duration || 1)).toFixed(1)}s
                </span>
              </div>
              
              {/* Main Progress Bar Container */}
              <div 
                className="h-10 bg-slate-50 rounded-xl relative cursor-pointer group flex items-end justify-between p-2 overflow-hidden border border-slate-200/80"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const ratio = clickX / rect.width;
                  if (audioPlayerRef.current) {
                    const dur = audioPlayerRef.current.duration;
                    if (dur && !isNaN(dur) && isFinite(dur)) {
                      audioPlayerRef.current.currentTime = ratio * dur;
                    }
                  }
                }}
              >
                {/* Simulated interactive waves */}
                {[20, 40, 60, 30, 80, 50, 90, 70, 85, 40, 20, 60, 80, 50, 30, 70, 95, 60, 40, 80, 70, 50, 90, 40, 20, 60, 80, 30, 50, 40, 60, 30, 80, 50, 90, 40, 20].map((h, i) => {
                  const barLimit = (i / 37) * 100;
                  const displayDur = loadedDuration !== null ? loadedDuration : (selectedSound.duration || 1);
                  const progressRatio = (currentTime / displayDur) * 100;
                  const isBarActive = progressRatio >= barLimit;
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-t-sm transition-colors"
                      style={{
                        height: `${h}%`,
                        backgroundColor: isBarActive ? '#059669' : '#cbd5e1',
                        marginRight: '2px'
                      }}
                    />
                  );
                })}
                {/* Floating progress indicator */}
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-emerald-600 pointer-events-none"
                  style={{ left: `${(currentTime / (loadedDuration !== null ? loadedDuration : (selectedSound.duration || 1))) * 100}%` }}
                />
              </div>
            </div>

            {/* Global Controls Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={togglePlayPause}
                  className={`py-2 px-5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 shadow-md ${
                    isPlaying 
                      ? 'bg-amber-600 text-white' 
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                  }`}
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                  <span>{isPlaying ? '暂停试听 (Space)' : '播放试听 (Space)'}</span>
                </button>

                <button
                  onClick={() => setIsLooping(!isLooping)}
                  className={`p-2 rounded-xl border transition-all ${
                    isLooping 
                      ? 'bg-emerald-50 border-emerald-100 text-emerald-700 font-bold' 
                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                  }`}
                  title="循环播放测试"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isLooping ? 'animate-spin' : ''}`} />
                </button>

                {/* Global Volume Controller */}
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 py-1.5 px-3 rounded-xl shrink-0">
                  <Volume2 className="w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-16 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                  />
                  <span className="text-[9px] font-mono text-slate-500 min-w-[22px] text-right">{Math.round(volume * 100)}%</span>
                </div>
              </div>

              {/* Unity/Reaper Drag Simulator Trigger & Export Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={copySoundPath}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1 bg-slate-50 border ${
                    copiedPath 
                      ? 'border-emerald-300 text-emerald-700 bg-emerald-50' 
                      : 'border-slate-200 text-slate-600 hover:text-slate-800 hover:bg-slate-100'
                  }`}
                >
                  {copiedPath ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedPath ? '已复制物理路径' : '复制引擎路径'}</span>
                </button>

                <button
                  onClick={handleExportSelected}
                  className="py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 bg-slate-50 border border-slate-200 text-emerald-700 hover:bg-emerald-600 hover:text-white"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>导出资产</span>
                </button>
              </div>
            </div>

            {/* Hidden Audio Player */}
            <audio
              ref={audioPlayerRef}
              src={getAudioSourceUrl(selectedSound)}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleAudioEnded}
            />
          </div>

        </section>

        {/* ==================== RIGHT COLUMN: Properties & AI Recommendations ==================== */}
        <aside id="sfx-lib-right-panel" className="w-64 bg-white border-l border-slate-200 flex flex-col overflow-y-auto custom-scrollbar">
          
          {/* Audio Drag Area mockup */}
          <div className="p-4 border-b border-slate-200 bg-slate-50/60 text-center space-y-2 shrink-0">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">游戏开发 & 音频工作站联动</span>
            
            <div 
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", selectedSound.path);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => showCustomAlert("🖱️ 拖拽与导出联动", `已触发拖拽机制模拟：该资产 [${selectedSound.fileName}] 支持在桌面上直接拖拽投递到 Unity 资源层 (Assets) 或 Reaper DAW 时间线上。`)}
              className="bg-white hover:bg-slate-50 border border-dashed border-slate-200 hover:border-emerald-500/60 rounded-xl p-3 text-center cursor-grab active:cursor-grabbing transition-all flex flex-col items-center justify-center gap-1.5"
            >
              <FileAudio className="w-7 h-7 text-emerald-600" />
              <div>
                <p className="text-[11px] font-black text-slate-800">{selectedSound.fileName}</p>
                <p className="text-[9px] text-slate-400 mt-0.5">按住拖拽至 Unity / Unreal / Reaper</p>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-5">
            {/* Meta Properties */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">音效物理元数据</h3>
              
              <div className="bg-slate-50/65 rounded-xl border border-slate-200 p-3.5 space-y-2.5 text-xs shadow-inner">
                <div className="flex justify-between">
                  <span className="text-slate-450">资产名称:</span>
                  <span className="font-bold text-slate-750 truncate max-w-[130px]">{selectedSound.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-450">音频格式:</span>
                  <span className="font-bold text-emerald-600 font-mono">{selectedSound.format}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-450">声道声道:</span>
                  <span className="font-bold text-slate-750">{selectedSound.channels}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-450">采样频率:</span>
                  <span className="font-bold text-slate-750 font-mono">{selectedSound.sampleRate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-450">文件大小:</span>
                  <span className="font-bold text-slate-750 font-mono">{selectedSound.size}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-450">资产长度:</span>
                  <span className="font-bold text-slate-750">{selectedSound.duration} 秒</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-450">归属目录:</span>
                  <span className="font-bold text-indigo-600">{selectedSound.category}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-450">设计师:</span>
                  <span className="font-bold text-slate-750">{selectedSound.designer}</span>
                </div>
              </div>
            </div>

            {/* Engine Path */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">虚拟资产目录映射</h3>
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 font-mono text-[9px] text-slate-500 flex items-center justify-between gap-1.5 break-all">
                <span className="truncate">{selectedSound.path}</span>
                <button
                  onClick={copySoundPath}
                  className="p-1 hover:bg-slate-200 hover:text-emerald-600 rounded shrink-0"
                  title="复制路径"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* AI Recommendation Tags of Selected */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">AI 推荐标签提取</h3>
                <Sparkles className="w-3 h-3 text-emerald-600 animate-pulse" />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  通过 AI 深度学习神经网络分析包络(Envelope)、瞬态(Transients)与声谱特性，为该音频自动赋予标签推荐：
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedSound.tags.map((tag, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                      className="px-2 py-0.5 rounded-md text-[10px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-150 font-bold transition-all"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <div className="border-t border-slate-100 pt-2 flex items-center justify-between text-[9px] text-slate-400">
                  <span>特征可信度: 99.4%</span>
                  <span className="text-emerald-600 font-bold">已写入资产包</span>
                </div>
              </div>
            </div>

            {/* Integration info */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-start gap-2 text-[10px] text-slate-500 leading-normal">
              <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-slate-700">已桥接 Unreal 5.4 / Unity 2023</p>
                <p className="text-slate-450">在音频工作站(DAW)点击拖入本库，工具将触发实时映射同步归档。</p>
              </div>
            </div>

          </div>

        </aside>

      </div>





      {/* ==================== CORE FLOW A: AI IMPORT MODAL DIALOG ==================== */}
      {isImportModalOpen && (
        <div id="import-dialog-overlay" className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0E101B] border border-[#212643] rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="px-6 py-4 bg-[#121526] border-b border-[#212643] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
                <div>
                  <h3 className="text-xs font-black text-white uppercase tracking-wider">AI 辅助音效资产 & 文件夹批量入库工作台</h3>
                  <p className="text-[10px] text-gray-500 mt-0.5">支持智能自动识别、分类和重命名，您也可以在下方手动修改任意字段。</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setIsImportModalOpen(false);
                  setImportItems([]);
                }}
                className="text-gray-500 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar min-h-0">
              {isAnalyzing ? (
                <div className="py-20 flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="relative">
                    <div className="w-14 h-14 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin" />
                    <Sparkles className="absolute inset-0 m-auto w-5 h-5 text-emerald-400 animate-bounce" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">AI 正在读取目录并解析声音特征...</h4>
                    <p className="text-xs text-gray-500 mt-1.5 max-w-sm leading-relaxed">
                      正在根据音频 file 相对路径和名称，提取音频工程规范下的标准小写下划线文件名、智能中文显示名称，并计算其分类与声学标签特征
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Top action bar: AI Optimization */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800">AI 智能元数据高级调优</span>
                        <span className="text-[9px] bg-emerald-150 text-emerald-700 px-1.5 py-0.5 rounded font-bold border border-emerald-200">Gemini 3.5 Flash 驱动</span>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        点击右侧按钮，让大模型针对所有入库项的文件名和文件夹相对路径进行深度的物理声学理解、翻译和超标准音标重命名。
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isAiBatchOptimizing || importItems.length === 0}
                      onClick={handleAiBatchOptimize}
                      className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/10 transition-all shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isAiBatchOptimizing ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                          <span>Gemini 正在翻译调优中...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-white" />
                          <span>Gemini 一键批量调优</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* 一键批量属性配置面板 (Batch Settings Panel) */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-indigo-600" />
                      <span className="text-xs font-bold text-slate-800">批量分类与命名规则配置</span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                      {/* Batch Category selection */}
                      <div className="md:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-500 font-bold block">批量入库目标主分类</label>
                          <select
                            value={batchMainCategory}
                            onChange={(e) => setBatchMainCategory(e.target.value)}
                            className="w-full bg-white border border-slate-200 hover:border-slate-300 focus:border-emerald-500 rounded-lg px-2 py-1.5 text-xs text-slate-750 outline-none transition-all font-medium"
                          >
                            {categories.map(g => (
                              <option key={g.id} value={g.name}>📁 {g.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-500 font-bold block">二级子分类</label>
                          <select
                            value={batchSubCategory}
                            onChange={(e) => setBatchSubCategory(e.target.value)}
                            className="w-full bg-white border border-slate-200 hover:border-slate-300 focus:border-emerald-500 rounded-lg px-2 py-1.5 text-xs text-slate-750 outline-none transition-all font-medium"
                          >
                            {(() => {
                              const group = categories.find(g => g.name === batchMainCategory);
                              const subCategories = group ? group.subCategories : [];
                              return subCategories.map(sub => (
                                <option key={sub.id} value={sub.name}>📄 {sub.name}</option>
                              ));
                            })()}
                          </select>
                        </div>
                      </div>

                      {/* One-click Button to Apply Category */}
                      <div className="md:col-span-2">
                        <button
                          type="button"
                          onClick={handleApplyBatchCategory}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-1 shadow-md transition-all"
                        >
                          <FolderPlus className="w-3.5 h-3.5 text-white" />
                          <span>一键应用分类</span>
                        </button>
                      </div>

                      {/* Batch Naming Strategy selection */}
                      <div className="md:col-span-5 space-y-1">
                        <label className="text-[10px] text-slate-500 font-bold block">批量文件名生成策略</label>
                        <div className="flex bg-white border border-slate-200 rounded-lg p-0.5 gap-1">
                          <button
                            type="button"
                            onClick={() => handleNamingStrategyChange('smart')}
                            className={`flex-1 py-1.5 rounded-md text-[10px] font-extrabold transition-all ${
                              namingStrategy === 'smart'
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'text-slate-500 hover:bg-slate-100'
                            }`}
                            title="有规范命名（如 sfx_xxx）保留原文件名；不规范的（如中文或临时记录）自动生成规范命名"
                          >
                            自动检测 (有规范保留，无则生成)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleNamingStrategyChange('original')}
                            className={`flex-1 py-1.5 rounded-md text-[10px] font-extrabold transition-all ${
                              namingStrategy === 'original'
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'text-slate-500 hover:bg-slate-100'
                            }`}
                            title="强制保留导入时的原始文件名"
                          >
                            保留原名
                          </button>
                          <button
                            type="button"
                            onClick={() => handleNamingStrategyChange('standard')}
                            className={`flex-1 py-1.5 rounded-md text-[10px] font-extrabold transition-all ${
                              namingStrategy === 'standard'
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'text-slate-500 hover:bg-slate-100'
                            }`}
                            title="对所有文件强制生成格式化的规范文件名"
                          >
                            全量生成命名
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Batch Import List Table */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    <table className="w-full text-left border-collapse table-auto text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                          <th className="p-3 w-[180px]">原始路径/相对文件夹</th>
                          <th className="p-3 w-[120px] text-center">上传状态</th>
                          <th className="p-3 w-[150px]">资产名称 (手动修改)</th>
                          <th className="p-3 w-[160px]">工程化文件名 (手动修改)</th>
                          <th className="p-3 w-[130px]">主分类 (可手改)</th>
                          <th className="p-3 w-[140px]">二级子分类 (可手改)</th>
                          <th className="p-3">特征标签 (英文/逗号分隔)</th>
                          <th className="p-3 text-center w-[50px]">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {importItems.map((item, index) => (
                          <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                            {/* Original Path */}
                            <td className="p-2 font-mono text-[10px] text-slate-500 break-all max-w-[180px]">
                              {item.relativePath && item.relativePath !== item.originalFile.name ? (
                                <div className="space-y-0.5">
                                  <div className="text-slate-400 flex items-center gap-1">
                                    <Folder className="w-3 h-3 text-indigo-500 shrink-0" />
                                    <span className="truncate">{item.relativePath.substring(0, item.relativePath.lastIndexOf('/') + 1)}</span>
                                  </div>
                                  <div className="font-bold text-slate-700 truncate">{item.originalFile.name}</div>
                                </div>
                              ) : (
                                <div className="font-bold text-slate-700 flex items-center gap-1">
                                  <FileAudio className="w-3 h-3 text-emerald-600 shrink-0" />
                                  <span className="truncate">{item.originalFile.name}</span>
                                </div>
                              )}
                              <div className="text-[9px] text-slate-400 mt-1">格式: {item.type} | 大小: {item.size}</div>
                            </td>

                            {/* Upload Status */}
                            <td className="p-2 text-center">
                              {item.status === 'success' && (
                                <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-md text-[10px] font-bold">
                                  <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                                  上传成功
                                </span>
                              )}
                              {item.status === 'error' && (
                                <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded-md text-[10px] font-bold animate-pulse">
                                  <X className="w-3 h-3 text-red-600 shrink-0" />
                                  上传失败
                                </span>
                              )}
                              {item.status === 'uploading' && (
                                <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-md text-[10px] font-bold">
                                  <RefreshCw className="w-3 h-3 animate-spin text-indigo-600 shrink-0" />
                                  正在上传...
                                </span>
                              )}
                              {(!item.status || item.status === 'pending') && (
                                <div className="flex flex-col items-center gap-1">
                                  {sounds.some(s => 
                                    s.fileName.toLowerCase() === item.fileName.toLowerCase() || 
                                    s.name.toLowerCase() === item.name.toLowerCase()
                                  ) ? (
                                    <>
                                      <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1.5 rounded-md text-[10px] font-bold" title="检测到同名音效资产，上传后将覆盖并只保留一份">
                                        <Info className="w-3 h-3 text-amber-600 shrink-0" />
                                        同名覆盖
                                      </span>
                                      <span className="text-[9px] text-amber-600 font-medium scale-90">已有同名文件</span>
                                    </>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 bg-slate-50 text-slate-500 border border-slate-200 px-2.5 py-1 rounded-md text-[10px]">
                                      等待上传
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Custom Display Name */}
                            <td className="p-2">
                              <input 
                                type="text"
                                value={item.name}
                                onChange={(e) => {
                                  const updated = [...importItems];
                                  updated[index].name = e.target.value;
                                  setImportItems(updated);
                                }}
                                disabled={isUploading || item.status === 'success'}
                                className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400 rounded-lg px-2.5 py-1.5 text-xs text-slate-850 outline-none transition-all"
                                placeholder="输入中文描述"
                              />
                            </td>

                            {/* Standard File Name */}
                            <td className="p-2">
                              <input 
                                type="text"
                                value={item.fileName}
                                onChange={(e) => {
                                  const updated = [...importItems];
                                  updated[index].fileName = e.target.value;
                                  setImportItems(updated);
                                }}
                                disabled={isUploading || item.status === 'success'}
                                className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400 rounded-lg px-2.5 py-1.5 font-mono text-[11px] text-emerald-700 outline-none transition-all"
                                placeholder="sfx_name_01.wav"
                              />
                            </td>

                            {/* Primary Category selector */}
                            <td className="p-2">
                              <select
                                value={item.category}
                                onChange={(e) => {
                                  const updated = [...importItems];
                                  updated[index].category = e.target.value;
                                  // Automatically assign the first subcategory from the new group
                                  const group = categories.find(g => g.name === e.target.value);
                                  if (group && group.subCategories.length > 0) {
                                    updated[index].subcategory = group.subCategories[0].name;
                                  }
                                  setImportItems(updated);
                                }}
                                disabled={isUploading || item.status === 'success'}
                                className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400 rounded-lg px-1.5 py-1.5 text-xs text-slate-700 outline-none transition-all"
                              >
                                {categories.map(g => (
                                  <option key={g.id} value={g.name}>📁 {g.name}</option>
                                ))}
                              </select>
                            </td>

                            {/* Subcategory selector */}
                            <td className="p-2">
                              <select
                                value={item.subcategory || ''}
                                onChange={(e) => {
                                  const updated = [...importItems];
                                  updated[index].subcategory = e.target.value;
                                  setImportItems(updated);
                                }}
                                disabled={isUploading || item.status === 'success'}
                                className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400 rounded-lg px-1.5 py-1.5 text-xs text-slate-700 outline-none transition-all"
                              >
                                {(() => {
                                  const group = categories.find(g => g.name === item.category);
                                  const subCategories = group ? group.subCategories : [];
                                  return subCategories.map(sub => (
                                    <option key={sub.id} value={sub.name}>📄 {sub.name}</option>
                                  ));
                                })()}
                              </select>
                            </td>

                            {/* Tags list */}
                            <td className="p-2">
                              <input 
                                type="text"
                                value={item.tags.join(', ')}
                                onChange={(e) => {
                                  const updated = [...importItems];
                                  updated[index].tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                                  setImportItems(updated);
                                }}
                                disabled={isUploading || item.status === 'success'}
                                className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none transition-all"
                                placeholder="标签, 用逗号分隔"
                              />
                            </td>

                            {/* Actions (trash) */}
                            <td className="p-2 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = importItems.filter((_, idx) => idx !== index);
                                  setImportItems(updated);
                                  if (updated.length === 0) {
                                    setIsImportModalOpen(false);
                                  }
                                }}
                                disabled={isUploading || item.status === 'success'}
                                className="p-1.5 bg-red-50 hover:bg-red-100 disabled:bg-slate-100 disabled:text-slate-300 border border-red-200 disabled:border-slate-200 rounded-lg text-red-600 transition-colors"
                                title="从待导入队列中移除"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
              <span className="text-[10px] text-slate-500 font-mono">
                待归档入库项目总计: <strong className="text-emerald-700">{importItems.length}</strong> 个音效资产文件
              </span>
              
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsImportModalOpen(false);
                    setImportItems([]);
                  }}
                  disabled={isUploading}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 disabled:text-slate-300 transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={isAnalyzing || isUploading || importItems.length === 0}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-md shadow-emerald-600/10 flex items-center gap-1.5"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                      <span>正在上传入库中...</span>
                    </>
                  ) : importItems.some(item => item.status === 'error') ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>重新上传失败项</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>批量一键确认并分类入库</span>
                    </>
                  )}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* 5. Custom Dialog Alert / Confirm */}
      {customDialog && customDialog.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-150 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className={`p-2.5 rounded-xl ${customDialog.isConfirm ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'} shrink-0`}>
                  {customDialog.isConfirm ? <HelpCircle className="w-6 h-6" /> : <Info className="w-6 h-6" />}
                </div>
                <div className="space-y-1.5 flex-1">
                  <h3 className="text-sm font-bold text-slate-900">{customDialog.title}</h3>
                  <p className="text-xs text-slate-500 whitespace-pre-wrap leading-relaxed">{customDialog.message}</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              {customDialog.isConfirm ? (
                <>
                  <button
                    type="button"
                    onClick={() => setCustomDialog(null)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-all"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (customDialog.onConfirm) customDialog.onConfirm();
                      setCustomDialog(null);
                    }}
                    className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-amber-600/10"
                  >
                    确认
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setCustomDialog(null)}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/10"
                >
                  我知道了
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
