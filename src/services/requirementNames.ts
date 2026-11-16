import catalog from '../data/ucs-v8.2.1.json';
import { isUcsSfxRow, normalizeRequirementEngineeringNames } from './ucsNaming';

const categories = new Map(catalog.map(category => [category.catId.toLowerCase(), category]));
const readableCategories: Record<string, string> = {
  FEETHmn: 'Footstep', FOLYFeet: 'Footstep', MAGSpel: 'Magic', WHSH: 'Whoosh',
  OBJBook: 'Book', PAPRHndl: 'Paper', FOLYProp: 'Prop', UIMisc: 'Ui',
};
const words = (value: string) => value.split(/[^a-z0-9]+/i).filter(Boolean);
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

/** Requirements use readable object/action names; library imports keep UCS names. */
export function simplifyRequirementNames<T extends Record<string, unknown>>(items: T[], templateType: string): T[] {
  return normalizeRequirementEngineeringNames(items).map(item => {
    if (!templateType.startsWith('game_sfx_') || !isUcsSfxRow(item, templateType) || typeof item.filename !== 'string') return item;
    const original = item.filename;
    const stem = original.replace(/^(?:sfx_)+/i, '').replace(/\.(?:wav|mp3|ogg|flac)$/i, '');
    const [code, ...tail] = stem.split('_');
    const category = categories.get(code.toLowerCase());
    if (!category || !tail.join('')) return item;
    const label = readableCategories[category.catId]
      || (category.subcategory === 'MISC' ? category.category : category.subcategory);
    const detail = words(tail.join('_'));
    const detailWords = new Set(detail.map(word => word.toLowerCase()));
    const prefix = words(label).filter(word => !detailWords.has(word.toLowerCase()));
    const filename = `Sfx_${[...prefix, ...detail].map(titleCase).join('_')}`;
    const normalized = { ...item, filename };
    // Keep middleware paths intact; update only a filename mirrored at the end.
    if (typeof item.event_name === 'string' && item.event_name.endsWith(original)) {
      Object.assign(normalized, { event_name: item.event_name.slice(0, -original.length) + filename });
    }
    return normalized;
  });
}
