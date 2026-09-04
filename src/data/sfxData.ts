/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SubCategory {
  id: string;
  name: string;
  english: string;
  description: string;
  childCategories?: SubCategory[];
}

export interface CategoryGroup {
  id: string;
  name: string;
  english: string;
  subCategories: SubCategory[];
}

export interface SoundEffect {
  id: string;
  name: string;
  fileName: string;
  category: string;
  subcategory?: string;
  childCategory?: string;
  tags: string[];
  duration: number; // in seconds
  format: 'WAV' | 'OGG' | 'MP3';
  size: string;
  sampleRate: string;
  channels: 'Mono' | 'Stereo';
  designer: string;
  path: string;
  url: string;
  storageKey?: string;
  previewUrl?: string;
  downloadUrl?: string;
  processingStatus?: 'ready' | 'processing' | 'error';
  source?: 'uploaded' | 'generated' | 'external' | 'library';
  generatedKind?: 'music' | 'sfx';
  isFavorite?: boolean;
}

export const DEFAULT_CATEGORIES: CategoryGroup[] = [
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
      { id: 'space_drone', name: '空间背景', english: '空间背景 (Drone)', description: '飞船舱内低频、废土遗迹风蚀、机械工业 background 嗡鸣' },
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

export const INITIAL_SOUNDS: SoundEffect[] = [
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
    subcategory: '枪械与射击',
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
    tags: ['Q版', '清脆', '点击', '反馈', '简洁', '可爱'],
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
    subcategory: '爆炸与重低音',
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
    tags: ['脚步', '泥地', '重装', '奔跑', '拟音', '写实'],
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
    tags: ['刀剑', '利刃', '挥砍', '金属', '极速', '打击'],
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
