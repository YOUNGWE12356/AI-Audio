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
