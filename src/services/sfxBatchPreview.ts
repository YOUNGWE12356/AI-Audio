import { ONLINE_SFX_GROUP_WEIGHTS, onlineSfxGroupIndex } from './onlineSfxTypes';

export function isUnavailableBatchPreview(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === 'SFX_PREVIEW_EXPIRED' || code === 'SFX_PREVIEW_UNAVAILABLE';
}

/** Start with the catalog's first pick, then balance successful previews across the batch. */
export function orderBatchPreviews<T extends { source?: string }>(candidates: T[], picked: ReadonlyMap<string, number>) {
  const groupCounts = [0, 0, 0];
  for (const [source, count] of picked) groupCounts[onlineSfxGroupIndex(source)] += count;
  const load = (source?: string) => {
    const group = onlineSfxGroupIndex(source);
    return groupCounts[group] / ONLINE_SFX_GROUP_WEIGHTS[group];
  };
  return [...candidates].sort((a, b) => load(a.source) - load(b.source)
    || (picked.get(a.source || '') || 0) - (picked.get(b.source || '') || 0));
}
