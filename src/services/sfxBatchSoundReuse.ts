import { normalizeSoundOccurrences, type SfxBatchRequirement } from './sfxBatch';

export const batchSoundReusePrompt = `最终清单按“需要制作的不同音效素材”整理，而不是按触发次数计数。仍逐次列出真实事件及time/endTime，但为可以复用同一个声音的事件填写完全相同的soundGroup。系统会将同组整理成一条制作需求，并保留每个出现位置。
判断是否可复用，要比较实际声源、发声动作、数量密度、力度、节奏、材质和听感。仅出现时间、画面位置、序号、颜色或措辞不同，不构成新音效。例如相同转轮再次旋转、相同按钮再次点击、相同数量/节奏的硬币再次落下，应使用相同soundGroup，不要用01/02或时间码拆成多组。
只有听感或制作需求有明确区别才分组：少量硬币零星掉落与大量硬币密集倾泻必须分开；轻碰与重击、单次落地与连续滚动、不同材质/声源、不同节奏或明显不同音色均保留。不能只凭同名、同关键词、同搜索词就合并，不确定是否可复用时分别保留，不丢弃不同声音层。
同组description、keywords应描述同一种可复用声音，画面依据和各次位置放scene；name使用不带出现次序编号的音效名。soundGroup为本次清单内的简短声音标识，例如coin_drop_sparse、coin_drop_shower、reel_spin。不要新增触发次数、不要删除重复出现的真实时间点；相同素材不需要重复制作、搜索或下载。`;

/** Semantic groups come from the existing final review, never from keyword similarity. */
export function consolidateBatchVideoSounds(items: SfxBatchRequirement[], soundGroups: unknown[]) {
  const groups = new Map<string, SfxBatchRequirement>();
  for (const [index, item] of items.entries()) {
    const value = soundGroups[index];
    const key = typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.trim()) ? value.trim() : `unique:${index}`;
    const current = groups.get(key);
    if (!current) { groups.set(key, { ...item, occurrences: item.occurrences?.map(point => ({ ...point })) }); continue; }
    const points = [current, ...(current.occurrences || []), item, ...(item.occurrences || [])]
      .filter((point): point is typeof point & { time: number; endTime: number } =>
        typeof point.time === 'number' && typeof point.endTime === 'number');
    const occurrences = normalizeSoundOccurrences(points).sort((a, b) => a.time - b.time || a.endTime - b.endTime);
    groups.set(key, { ...current, duration: Math.max(current.duration, item.duration),
      ...(occurrences.length ? { time: occurrences[0].time, endTime: occurrences[0].endTime, occurrences: occurrences.slice(1) } : {}),
      scene: [...new Set([current.scene, item.scene].filter(Boolean))].join('；').slice(0, 1000) });
  }
  return [...groups.values()].map((item, index) => ({ ...item, id: `sfx-${index + 1}` }));
}
