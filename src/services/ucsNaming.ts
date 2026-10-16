import catalog from '../data/ucs-v8.2.1.json';

type UcsCategory = { catId: string; category: string; subcategory: string };
const categories = catalog as UcsCategory[];
const catIdByLowercase = new Map(categories.map(({ catId }) => [catId.toLowerCase(), catId]));

export const UCS_CATALOG_VERSION = '8.2.1';

export const UCS_CATALOG_PROMPT = categories
  .map(({ catId, category, subcategory }) => `${catId}:${category}/${subcategory}`)
  .join(', ');

export const normalizeUcsSfxFilename = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const filename = value.trim().replace(/\.(?:wav|mp3|ogg|flac)$/i, '');
  const blocks = filename.split('_');
  if (blocks.length !== 2 && blocks.length !== 4 && blocks.length !== 5) return null;
  const catId = catIdByLowercase.get(blocks[0].toLowerCase());
  const fxName = blocks[1].trim();
  if (!catId || !/^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(fxName)) return null;
  if (blocks.length > 2 && blocks.slice(2).some(block => !/^[A-Za-z0-9-]+$/.test(block))) return null;
  return [catId, fxName, ...blocks.slice(2)].join('_');
};

const AUDIO_EXTENSION = /\.(wav|mp3|ogg|flac|m4a|aac)$/i;

export const normalizeUcsImportFileName = (value: unknown, originalName: string): string | null => {
  const extension = originalName.match(AUDIO_EXTENSION)?.[0];
  if (!extension || typeof value !== 'string') return null;
  const candidate = value.trim();
  if (candidate.match(AUDIO_EXTENSION)?.[0].toLowerCase() !== extension.toLowerCase()) return null;
  const normalized = normalizeUcsSfxFilename(candidate.slice(0, -extension.length));
  if (!normalized || /^(?:asset|audio|sound|unknown|untitled)(?:\s|$)/i.test(normalized.split('_')[1])) return null;
  return `${normalized}${extension}`;
};

export const isUcsImportFileName = (value: string, originalName: string) => (
  normalizeUcsImportFileName(value, originalName) === value
);

export const isBgmImportFileName = (value: string, originalName: string) => {
  const extension = originalName.match(AUDIO_EXTENSION)?.[0].toLowerCase();
  if (!extension || !value.toLowerCase().endsWith(extension)) return false;
  const stem = value.slice(0, -extension.length);
  return /^bgm_[A-Za-z0-9][A-Za-z0-9_-]*$/i.test(stem)
    && !/(?:^|_)asset(?:_|$)/i.test(stem);
};

export const isUcsSfxRow = (item: Record<string, unknown>, templateType: string): boolean => {
  if (templateType === 'game_sfx_general') {
    const explicit = String(item.audio_type || '').trim().toUpperCase();
    if (explicit === 'BGM' || explicit === 'VO') return false;
    if (explicit === 'SFX') return true;
  }
  const filename = String(item.filename || '').trim();
  return !/^(?:bgm|vo)_/i.test(filename);
};

export const normalizeUcsRequirementItems = (items: Record<string, unknown>[], templateType: string) => {
  const invalid: number[] = [];
  const normalized = items.map((item, index) => {
    if (!isUcsSfxRow(item, templateType)) return item;
    // The requirements table uses an engineering prefix around the UCS name.
    // Keep bare UCS validation unchanged for sound-library imports.
    const candidate = typeof item.filename === 'string'
      ? item.filename.trim().replace(/^(?:sfx_)+/i, '')
      : item.filename;
    const filename = normalizeUcsSfxFilename(candidate);
    if (!filename) {
      invalid.push(index + 1);
      return item;
    }
    return { ...item, filename: `Sfx_${filename}` };
  });
  return { items: normalized, invalid };
};
