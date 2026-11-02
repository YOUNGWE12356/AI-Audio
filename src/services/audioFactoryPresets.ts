/** Shared by the actual factory controls and the assistant's capability discovery. */
export const FACTORY_LOUDNESS_PRESETS = [
  { label: 'Avatar 出场', value: -13.5, hint: '-12 ~ -15 LUFS', group: '导出' },
  { label: '礼物', value: -16, hint: '-15 ~ -17 LUFS', group: '导出' },
  { label: 'JK 击杀', value: -21.5, hint: '-20 ~ -23 LUFS', group: '导出' },
  { label: 'JK 其他', value: -26.5, hint: '-25 ~ -28 LUFS', group: '导出' },
  { label: '酒馆质疑', value: -20, hint: '-20 LUFS', group: '导出' },
  { label: '酒馆出牌', value: -25, hint: '-25 LUFS', group: '导出' },
  { label: '游戏配乐', value: -21.5, hint: '-20 ~ -23 LUFS', group: '游戏' },
  { label: '游戏环境氛围', value: -35, hint: '-30 ~ -40 LUFS', group: '游戏' },
  { label: '游戏音效', value: -25, hint: '-20 ~ -30 LUFS', group: '游戏' },
  { label: '游戏语音', value: -16.5, hint: '-15 ~ -18 LUFS', group: '游戏' },
];

const normalize = (text: string) => text.toLowerCase().replace(/[\s_-]+/g, '');
export function findFactoryLoudnessPreset(name: string) {
  const key = normalize(name);
  return FACTORY_LOUDNESS_PRESETS.find(preset => normalize(preset.label) === key
    || (preset.label === '游戏配乐' && ['游戏bgm', '游戏bgm音乐'].includes(key)));
}

/** Reuse named page presets; never invent values for an unknown company standard. */
export function applyFactoryLoudnessPreset<T extends Record<string, any>>(args: T, prompt = ''): T & { lufs?: number; loudnessPreset?: string } {
  const explicit = [...prompt.matchAll(/(?:响度|LUFS)[^\d\n]{0,12}(-\d+(?:\.\d+)?)|(-\d+(?:\.\d+)?)\s*LUFS/gi)].at(-1);
  const requested = args.loudnessPreset ? findFactoryLoudnessPreset(String(args.loudnessPreset)) : undefined;
  if (args.loudnessPreset && !requested) throw new Error('没有这个响度预设，请先检查 inspect_tools 返回的预设，不能编造标准。');
  // Follow-ups such as “调到礼物的响度标准” override an earlier named preset.
  const matches = FACTORY_LOUDNESS_PRESETS.map(preset => ({ preset, index: normalize(prompt).lastIndexOf(normalize(preset.label)) }))
    .filter(item => item.index >= 0).sort((a, b) => b.index - a.index);
  const lastNamed = /响度|lufs|标准|预设/i.test(prompt) ? matches[0] : undefined;
  if (explicit && (!lastNamed || normalize(prompt.slice(0, explicit.index)).length > lastNamed.index)) {
    return { ...args, lufs: Number(explicit[1] || explicit[2]), loudnessPreset: undefined };
  }
  const named = lastNamed?.preset;
  const preset = named || requested;
  return preset ? { ...args, lufs: preset.value, loudnessPreset: preset.label } : args;
}
