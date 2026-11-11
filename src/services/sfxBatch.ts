export type BatchSoundOccurrence = { time: number; endTime: number };
export type SfxBatchRequirement = {
  id: string; name: string; description: string; keywords: string; searchQuery: string; duration: number; scene: string;
  time?: number; endTime?: number;
  /** Additional placements of the same reusable sound, excluding the primary range. */
  occurrences?: BatchSoundOccurrence[];
};
export const SFX_BATCH_MAX_ROWS = 300;
export const batchQuerySource = (row: { keywords: string; description: string }) => JSON.stringify(['sound-keywords-v4', row.keywords.trim(), row.description.trim()]);
export const batchSearchWordCount = (value: string) => (value.match(/[a-z]+(?:'[a-z]+)?/gi) || []).length;
export function validateBatchSearchQuery(value: string) {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) throw new Error('关键词尚未完成自动转换，请调整中文关键词后重试。');
  if (Array.from(text).some(char => /\p{L}/u.test(char) && !/\p{Script=Latin}/u.test(char))) {
    throw new Error('关键词自动转换结果不是有效英文，请调整中文关键词后重试。');
  }
  const count = batchSearchWordCount(text);
  if (count < 1 || count > 2 || text.length > 160) throw new Error(`关键词自动转换结果应为1～2个核心英文单词${count > 2 ? `（当前${count}个）` : ''}，请调整中文关键词后重试。`);
  return text;
}
export function existingBatchSearchQuery(value: string): string | null {
  try { return validateBatchSearchQuery(value); } catch { return null; }
}
/** Both actions use the prepared English query for the visible Chinese keywords. */
export function createBatchSfxRequest(row: Pick<SfxBatchRequirement, 'searchQuery' | 'duration'>, kind: 'search' | 'generate', excludedSources: string[] = [], searchBatchId?: string, searchBatchItemId?: string) {
  const text = validateBatchSearchQuery(row.searchQuery);
  if (kind === 'search') return { endpoint: '/api/ai/sfx-batch/search', body: { query: text, excludeSourceUrls: excludedSources, searchBatchId, searchBatchItemId } };
  if (!Number.isFinite(row.duration) || row.duration < 0.5 || row.duration > 30) throw new Error('时长应为0.5～30秒。');
  return { endpoint: '/api/ai/elevenlabs/sound-effect', body: { text, duration: row.duration, qualityMode: 'standard', usageSource: 'sfx-batch' } };
}
export function batchFileStem(value: string, fallback = 'Sfx_Untitled') {
  return String(value || '').trim().replace(/\.(wav|mp3|ogg|flac)$/i, '').normalize('NFC')
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f\s]+/g, '_').replace(/_+/g, '_').replace(/^[_ .]+|[_ .]+$/g, '').slice(0, 100) || fallback;
}
export function normalizeBatchRequirements(items: unknown): SfxBatchRequirement[] {
  if (!Array.isArray(items) || items.length > SFX_BATCH_MAX_ROWS) throw new Error(`每次最多制作 ${SFX_BATCH_MAX_ROWS} 条音效，请拆分需求表。`);
  return items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 条需求无效。`);
    const text = (key: string, max: number) => typeof item[key] === 'string' ? item[key].trim().slice(0, max) : '';
    const duration = Number(item.duration);
    if (!text('description', 2000)) throw new Error(`第 ${index + 1} 条缺少音效描述。`);
    if (!Number.isFinite(duration) || duration < 0.5 || duration > 30) throw new Error(`第 ${index + 1} 条时长应为 0.5～30 秒。`);
    return { id: `sfx-${index + 1}`, name: batchFileStem(text('name', 200), `Sfx_${index + 1}`),
      // Analysis only requires Chinese keywords. The hidden English query is
      // prepared on search/generate; invalid legacy caches cannot reject a list.
      description: text('description', 2000), keywords: text('keywords', 300), searchQuery: existingBatchSearchQuery(text('searchQuery', 1000)) || '',
      duration, scene: text('scene', 1000),
      ...(Array.isArray(item.occurrences) ? { occurrences: normalizeSoundOccurrences(item.occurrences) } : {}),
      ...(typeof item.time === 'number' && Number.isFinite(item.time) && item.time >= 0 ? {
        time: Math.round(item.time * 1000) / 1000,
        ...(typeof item.endTime === 'number' && Number.isFinite(item.endTime) && item.endTime > item.time
          ? { endTime: Math.round(item.endTime * 1000) / 1000 } : {}),
      } : {}) };
  });
}
export function normalizeSoundOccurrences(value: unknown): BatchSoundOccurrence[] {
  if (!Array.isArray(value) || value.length > SFX_BATCH_MAX_ROWS) throw new Error('音效复用点位无效或过多。');
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || !Number.isFinite(item.time) || !Number.isFinite(item.endTime) || item.time < 0 || item.endTime <= item.time) {
      throw new Error('音效复用点位须有有效的起止时间。');
    }
    return { time: Math.round(item.time * 1000) / 1000, endTime: Math.round(item.endTime * 1000) / 1000 };
  }).filter(item => {
    const key = `${item.time}:${item.endTime}`;
    if (item.endTime <= item.time || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
// Protect spreadsheet formulas without damaging ordinary commas, quotes or newlines.
const csvCell = (value: unknown) => {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export function batchRequirementsCsv(rows: Array<SfxBatchRequirement & { confirmedDuration?: number }>) {
  const cells = [['序号', '命名', '音效描述', '关键词', '需求时长（秒）', '场景', '确认音频时长（秒）', '视频点位（秒）', '视频结束（秒）', '其他复用范围（秒）'],
    ...rows.map((row, index) => [index + 1, batchFileStem(row.name), row.description, row.keywords,
      row.duration, row.scene, row.confirmedDuration ?? '', row.time ?? '', row.time === undefined ? '' : row.endTime ?? row.time + row.duration,
      row.occurrences?.map(item => `${item.time}—${item.endTime}`).join('；') || ''])];
  return '\uFEFF' + cells.map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function uniqueBatchFileNames(names: string[]) {
  const used = new Set<string>();
  return names.map((name, index) => {
    const stem = batchFileStem(name, `Sfx_${index + 1}`);
    let candidate = `${stem}.wav`, suffix = 2;
    while (used.has(candidate.toLocaleLowerCase())) candidate = `${stem}_${suffix++}.wav`;
    used.add(candidate.toLocaleLowerCase()); return candidate;
  });
}
