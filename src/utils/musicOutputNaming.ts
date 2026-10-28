export interface MusicOutputItem {
  file: { name: string };
  status: string;
  mood?: string;
  scene?: string;
  keyName?: string;
  bpm?: number;
  manualOutputName?: string;
}

export interface MusicNameFields {
  includeSource: boolean;
  includeMood: boolean;
  includeScene: boolean;
  includeKey: boolean;
  includeBpm: boolean;
}

export const sanitizeMusicNamePart = (value: string, maxLength = 80) => value
  .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
  .replace(/[,，、\s]+/g, '_')
  .replace(/_+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, maxLength) || 'Unknown';

const extensionOf = (name: string) => name.match(/\.([^.]+)$/)?.[1].toLowerCase() || 'wav';

const sanitizeOutputName = (value: string, extension: string) => {
  const clean = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 180);
  return !clean ? '' : /\.[A-Za-z0-9]{2,5}$/.test(clean) ? clean : `${clean}.${extension}`;
};

export function buildMusicOutputNames<T extends MusicOutputItem>(
  items: T[],
  options: { includeNumber: boolean; startCode: string; numberSeparator: string } & Partial<MusicNameFields>,
): Array<T & { categoryKey?: string; outputName?: string }> {
  const counters = new Map<string, number>();
  const startCode = options.startCode.replace(/\D/g, '') || '001';
  const start = Math.max(1, Number(startCode) || 1);
  const padding = Math.min(6, startCode.length);
  const separator = options.numberSeparator.replace(/[<>:"/\\|?*\x00-\x1F\s]/g, '_') || '_';
  return items.map(item => {
    if (item.status !== 'done') return { ...item, categoryKey: undefined, outputName: undefined };
    const source = sanitizeMusicNamePart(item.file.name.replace(/\.[^/.]+$/, ''), Infinity);
    const mood = sanitizeMusicNamePart(item.mood || 'Uncertain');
    const scene = sanitizeMusicNamePart(item.scene || 'Manual');
    const key = sanitizeMusicNamePart((item.keyName || 'UnknownKey').replace(/\s+/g, ''));
    const categoryKey = [options.includeMood !== false ? mood : '', options.includeScene !== false ? scene : ''].filter(Boolean).join('_') || 'Music';
    const number = counters.get(categoryKey) ?? start;
    counters.set(categoryKey, number + 1);
    const suffixParts = [
      options.includeMood !== false ? mood : '',
      options.includeScene !== false ? scene : '',
      options.includeKey !== false ? key : '',
      options.includeBpm !== false ? `${Math.round(item.bpm || 0)}BPM` : '',
    ].filter(Boolean);
    const suffix = suffixParts.join('_');
    const numberedSuffix = options.includeNumber
      ? `${String(number).padStart(padding, '0')}${suffix ? separator + suffix : ''}`
      : suffix;
    const extension = extensionOf(item.file.name);
    const stem = [options.includeSource !== false ? source : '', numberedSuffix].filter(Boolean).join('_') || source;
    const generated = `${stem}.${extension}`;
    return { ...item, categoryKey, outputName: sanitizeOutputName(item.manualOutputName || '', extension) || generated };
  });
}
