const splitTerms = (value: string) => value
  .split(/[\s,，、/\\|;；:：()[\]{}"'“”‘’._-]+/)
  .map(term => term.trim())
  .filter(Boolean);

export const normalizeSfxSearchText = (value: unknown) => String(value || '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[\\/_.-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const SFX_SEARCH_LEXICON: string[][] = [
  ['点击', '按钮', '按键', '轻点', '点按', 'ui', 'click', 'tap', 'button', 'press', 'select'],
  ['弹出', '跳出', '出现', '冒出', 'pop', 'popup', 'appear', 'spawn'],
  ['确认', '成功', '完成', '胜利', '结算', '领取', '奖励', 'success', 'confirm', 'complete', 'victory', 'win', 'reward', 'collect'],
  ['失败', '错误', '拒绝', '禁止', '取消', 'fail', 'failure', 'error', 'deny', 'wrong', 'cancel'],
  ['提示', '通知', '提醒', '消息', 'notification', 'notify', 'prompt', 'alert', 'toast'],
  ['菜单', '界面', '窗口', '面板', '打开', '关闭', 'menu', 'interface', 'window', 'panel', 'open', 'close'],
  ['翻页', '翻书', '页面', '纸张', '书本', 'page', 'book', 'paper', 'flip', 'turn'],
  ['滑动', '滚动', '拖拽', '移动', 'swipe', 'scroll', 'drag', 'slide', 'move'],
  ['转场', '划过', '飞过', '嗖', '呼啸', 'whoosh', 'swoosh', 'swish', 'transition', 'passby'],
  ['上升', '升起', '蓄力', '渐强', 'riser', 'rise', 'build', 'buildup', 'uplift'],
  ['下降', '落下', '收尾', '跌落', 'downer', 'drop', 'fall', 'descend'],
  ['闪光', '闪烁', '亮晶晶', '星星', '粒子', 'sparkle', 'shimmer', 'twinkle', 'glitter', 'particle'],
  ['魔法', '法术', '施法', '奇幻', '奥术', 'magic', 'spell', 'fantasy', 'arcane'],
  ['能量', '充能', '冲击波', '脉冲', '护盾', 'energy', 'charge', 'pulse', 'blast', 'shield'],
  ['治疗', '回血', '恢复', '治愈', 'heal', 'healing', 'recover', 'restore'],
  ['增益', '减益', 'buff', 'debuff', 'powerup', 'curse'],
  ['火', '火焰', '燃烧', '爆燃', 'fire', 'flame', 'burn', 'ignite'],
  ['冰', '冰冻', '冻结', '寒冷', 'ice', 'freeze', 'frost', 'cold'],
  ['雷', '闪电', '电击', '电流', 'thunder', 'lightning', 'electric', 'zap'],
  ['水', '液体', '水滴', '浪', 'water', 'liquid', 'drip', 'splash', 'wave'],
  ['风', '风声', '空气', '气流', 'wind', 'air', 'gust', 'breath'],
  ['爆炸', '爆破', '轰鸣', '炸裂', '巨响', 'explosion', 'explode', 'boom', 'blast'],
  ['撞击', '碰撞', '击中', '打击', '重击', 'impact', 'hit', 'strike', 'slam', 'thud'],
  ['金属', '铁', '钢', '铿锵', '叮当', 'metal', 'steel', 'iron', 'clang', 'clank', 'clink'],
  ['木头', '木板', '木质', 'wood', 'wooden', 'plank'],
  ['石头', '岩石', '碎石', 'stone', 'rock', 'rubble'],
  ['玻璃', '破碎', '碎裂', '裂开', 'glass', 'break', 'shatter', 'crack'],
  ['沉闷', '厚重', '低频', '重低音', '闷响', 'heavy', 'dull', 'muffled', 'bass', 'sub'],
  ['尖锐', '刺耳', '高频', 'sharp', 'piercing', 'bright', 'high'],
  ['清脆', '轻快', '明亮', 'crisp', 'clean', 'light', 'bright'],
  ['柔和', '温暖', '舒缓', 'soft', 'warm', 'gentle', 'calm'],
  ['环境', '背景', '氛围', '声景', 'ambient', 'background', 'atmosphere', 'soundscape'],
  ['自然', '森林', '鸟', '海浪', '雨', 'nature', 'forest', 'bird', 'sea', 'rain'],
  ['机械', '机器', '齿轮', '工业', 'mechanical', 'machine', 'gear', 'industrial'],
  ['科幻', '未来', '赛博', '激光', '飞船', 'sci fi', 'scifi', 'cyber', 'laser', 'space', 'ship'],
  ['武器', '刀', '剑', '枪', '射击', 'weapon', 'sword', 'knife', 'gun', 'shot', 'shoot'],
  ['脚步', '走路', '跑步', '步伐', 'footstep', 'step', 'walk', 'run'],
  ['衣服', '布料', '摩擦', '装备', 'cloth', 'fabric', 'rustle', 'gear', 'foley'],
  ['怪物', '怪兽', '咆哮', '吼叫', '生物', 'monster', 'creature', 'growl', 'roar'],
  ['人声', '呼吸', '喊叫', '受击', '死亡', 'voice', 'vocal', 'breath', 'shout', 'hurt', 'death'],
  ['音乐', '配乐', '背景音乐', '循环', 'music', 'bgm', 'soundtrack', 'loop'],
  ['战斗', '紧张', '动作', '热血', 'combat', 'battle', 'action', 'intense'],
  ['休闲', '可爱', '卡通', '欢乐', 'casual', 'cute', 'cartoon', 'happy'],
  ['恐怖', '悬疑', '惊悚', '诡异', 'horror', 'suspense', 'scary', 'eerie'],
];

const TERM_EXPANSION_MAP = new Map<string, Set<string>>();

for (const group of SFX_SEARCH_LEXICON) {
  const normalizedGroup = Array.from(new Set(group.map(normalizeSfxSearchText).filter(Boolean)));
  for (const term of normalizedGroup) {
    const existing = TERM_EXPANSION_MAP.get(term) || new Set<string>();
    normalizedGroup.forEach(item => existing.add(item));
    TERM_EXPANSION_MAP.set(term, existing);
  }
}

const addExpandedTerm = (terms: Set<string>, term: string) => {
  const normalized = normalizeSfxSearchText(term);
  if (!normalized) return;
  terms.add(normalized);
  normalized.replace(/\s+/g, '') && terms.add(normalized.replace(/\s+/g, ''));
  splitTerms(normalized).forEach(token => terms.add(token));

  for (const [key, expansions] of TERM_EXPANSION_MAP.entries()) {
    const hasHan = /[\u3400-\u9fff]/.test(normalized);
    const canUsePartialKey = hasHan && normalized.length >= 2;
    if (normalized === key || normalized.includes(key) || (canUsePartialKey && key.includes(normalized))) {
      expansions.forEach(expanded => {
        terms.add(expanded);
        const compact = expanded.replace(/\s+/g, '');
        if (compact) terms.add(compact);
      });
    }
  }
};

export const getExpandedSfxSearchTerms = (query: string): string[] => {
  const terms = new Set<string>();
  addExpandedTerm(terms, query);
  return Array.from(terms).filter(term => term.length > 0);
};

export const buildExpandedSfxSearchText = (...values: unknown[]) => {
  const terms = new Set<string>();
  values.flatMap(value => Array.isArray(value) ? value : [value]).forEach(value => {
    const text = normalizeSfxSearchText(value);
    if (!text) return;
    terms.add(text);
    splitTerms(text).forEach(token => addExpandedTerm(terms, token));
  });
  return Array.from(terms).join(' ');
};

export const scoreSfxSearchCandidate = (query: string, fields: {
  name?: unknown;
  fileName?: unknown;
  category?: unknown;
  subcategory?: unknown;
  childCategory?: unknown;
  designer?: unknown;
  path?: unknown;
  tags?: unknown[];
  searchText?: unknown;
}) => {
  const normalizedQuery = normalizeSfxSearchText(query);
  const queryTerms = getExpandedSfxSearchTerms(query);
  if (queryTerms.length === 0) return 0;

  const rawName = normalizeSfxSearchText(fields.name);
  const rawFileName = normalizeSfxSearchText(fields.fileName);
  const name = buildExpandedSfxSearchText(fields.name);
  const fileName = buildExpandedSfxSearchText(fields.fileName);
  const nameTokens = new Set(splitTerms(name));
  const fileNameTokens = new Set(splitTerms(fileName));
  const categoryText = buildExpandedSfxSearchText(fields.category, fields.subcategory, fields.childCategory);
  const tagText = buildExpandedSfxSearchText(fields.tags || []);
  const broadText = buildExpandedSfxSearchText(
    fields.name,
    fields.fileName,
    fields.category,
    fields.subcategory,
    fields.childCategory,
    fields.designer,
    fields.path,
    fields.tags || [],
    fields.searchText,
  );
  const broadTokens = new Set(splitTerms(broadText));

  let score = 0;
  for (const term of queryTerms) {
    const hasHan = /[\u3400-\u9fff]/.test(term);
    if (!hasHan && term.length < 3 && normalizedQuery !== term) continue;
    if (rawName === term || nameTokens.has(term)) score += 140;
    if (rawFileName === term || fileNameTokens.has(term)) score += 125;
    if (hasHan ? rawName.includes(term) : splitTerms(rawName).some(token => token.includes(term))) score += 70;
    if (hasHan ? rawFileName.includes(term) : splitTerms(rawFileName).some(token => token.includes(term))) score += 64;
    if (hasHan ? tagText.includes(term) : splitTerms(tagText).includes(term)) score += 42;
    if (hasHan ? categoryText.includes(term) : splitTerms(categoryText).includes(term)) score += 30;
    if (hasHan ? broadText.includes(term) : broadTokens.has(term)) score += 10;
  }

  return score;
};
