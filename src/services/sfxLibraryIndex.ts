export const SFX_LIBRARY_CATEGORIES_KEY = 'sfx_library_categories';
export const SFX_LIBRARY_SOUNDS_KEY = 'sfx_library_sounds';
export const SFX_LIBRARY_INDEX_EVENT = 'sfx-library-index-updated';

export interface SfxLibraryIndexEntry {
  id: string;
  kind: 'sound' | 'directory';
  name: string;
  fileName?: string;
  category?: string;
  subcategory?: string;
  path?: string;
  tags?: string[];
  searchText: string;
}

export interface SfxLibraryIndex {
  entries: SfxLibraryIndexEntry[];
  updatedAt: string;
}

export const EMPTY_SFX_LIBRARY_INDEX: SfxLibraryIndex = {
  entries: [],
  updatedAt: '',
};

const asText = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const normalizeIndexText = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[\\/_.-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const makeSearchText = (...values: unknown[]) => normalizeIndexText(
  values.flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => asText(value))
    .filter(Boolean)
    .join(' '),
);

export const buildSfxLibraryIndex = (
  categories: unknown,
  sounds: unknown,
): SfxLibraryIndex => {
  const entries: SfxLibraryIndexEntry[] = [];
  const seenDirectories = new Set<string>();
  const categoryList = Array.isArray(categories) ? categories : [];
  const soundList = Array.isArray(sounds) ? sounds : [];

  categoryList.forEach((category, categoryIndex) => {
    if (!category || typeof category !== 'object') return;
    const group = category as Record<string, unknown>;
    const categoryName = asText(group.name);
    if (!categoryName) return;
    const categoryId = asText(group.id) || `category-${categoryIndex}`;
    const categoryKey = `category:${normalizeIndexText(categoryName)}`;
    if (!seenDirectories.has(categoryKey)) {
      entries.push({
        id: categoryId,
        kind: 'directory',
        name: categoryName,
        category: categoryName,
        searchText: makeSearchText(categoryName, group.english),
      });
      seenDirectories.add(categoryKey);
    }

    const subCategories = Array.isArray(group.subCategories) ? group.subCategories : [];
    subCategories.forEach((subcategory, subcategoryIndex) => {
      if (!subcategory || typeof subcategory !== 'object') return;
      const sub = subcategory as Record<string, unknown>;
      const subcategoryName = asText(sub.name);
      if (!subcategoryName) return;
      const subcategoryId = asText(sub.id) || `${categoryId}-sub-${subcategoryIndex}`;
      const subcategoryKey = `subcategory:${normalizeIndexText(categoryName)}:${normalizeIndexText(subcategoryName)}`;
      if (seenDirectories.has(subcategoryKey)) return;
      entries.push({
        id: subcategoryId,
        kind: 'directory',
        name: subcategoryName,
        category: categoryName,
        subcategory: subcategoryName,
        searchText: makeSearchText(categoryName, subcategoryName, sub.english, sub.description),
      });
      seenDirectories.add(subcategoryKey);
    });
  });

  soundList.forEach((sound, soundIndex) => {
    if (!sound || typeof sound !== 'object') return;
    const item = sound as Record<string, unknown>;
    const name = asText(item.name) || asText(item.fileName);
    if (!name) return;
    const tags = Array.isArray(item.tags) ? item.tags.map(asText).filter(Boolean) : [];
    entries.push({
      id: asText(item.id) || `sound-${soundIndex}`,
      kind: 'sound',
      name,
      fileName: asText(item.fileName) || undefined,
      category: asText(item.category) || undefined,
      subcategory: asText(item.subcategory) || undefined,
      path: asText(item.path) || undefined,
      tags,
      searchText: makeSearchText(name, item.fileName, item.category, item.subcategory, item.path, tags),
    });
  });

  return { entries, updatedAt: new Date().toISOString() };
};

export const readSfxLibraryIndex = (): SfxLibraryIndex => {
  if (typeof window === 'undefined') return EMPTY_SFX_LIBRARY_INDEX;
  try {
    const categories = JSON.parse(window.localStorage.getItem(SFX_LIBRARY_CATEGORIES_KEY) || '[]');
    const sounds = JSON.parse(window.localStorage.getItem(SFX_LIBRARY_SOUNDS_KEY) || '[]');
    return buildSfxLibraryIndex(categories, sounds);
  } catch {
    return EMPTY_SFX_LIBRARY_INDEX;
  }
};

export const publishSfxLibraryIndex = (categories: unknown, sounds: unknown) => {
  if (typeof window === 'undefined') return;
  const index = buildSfxLibraryIndex(categories, sounds);
  window.dispatchEvent(new CustomEvent<SfxLibraryIndex>(SFX_LIBRARY_INDEX_EVENT, { detail: index }));
};

export const findSfxLibraryMatches = (prompt: string, index: SfxLibraryIndex) => {
  const normalizedPrompt = normalizeIndexText(prompt);
  if (!normalizedPrompt) return [] as SfxLibraryIndexEntry[];
  const compactPrompt = normalizedPrompt.replace(/\s+/g, '');
  return index.entries
    .filter(entry => {
      const normalizedName = normalizeIndexText(entry.name);
      const compactName = normalizedName.replace(/\s+/g, '');
      if (compactPrompt.length < 2 || compactName.length < 2) return false;
      return compactPrompt.includes(compactName) || compactName.includes(compactPrompt);
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return b.name.length - a.name.length;
    });
};

export const normalizeSfxLibraryText = normalizeIndexText;
