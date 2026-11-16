import { batchFileStem, uniqueBatchFileNames, type SfxBatchRequirement } from './sfxBatch';
import { createMediaUrl, persistMediaUrl, readMediaBlob, rememberMediaUrl, uploadMediaBlob } from './mediaClient';
import type { AudioDownloadRange } from './audioRangeExport';
export type BatchVersion = {
  id: string; title: string; kind: 'search' | 'generate'; source?: string; sourceUrl?: string; ticketId?: string;
  url?: string; blob?: Blob; duration?: number; draftRange?: AudioDownloadRange | null;
  confirmedBlob?: Blob; confirmedRange?: AudioDownloadRange;
  confirmedUrl?: string;
};
export type BatchRow = SfxBatchRequirement & {
  selected: boolean; versions: BatchVersion[]; activeVersionId?: string; confirmedVersionId?: string; confirmedVersionIds?: string[];
  status: string; error?: string; excludedSources: string[];
  videoId?: string; placedVersionId?: string;
  rangeReviewParentId?: string; rangeReviewFingerprint?: string;
  searchQuerySource?: string;
};
export type BatchVideoAsset = { id: string; file: File };
export const batchId = () => globalThis.crypto?.randomUUID?.() || `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function confirmedVersions(row: BatchRow): BatchVersion[] {
  // Old projects may retain blobs from previously replaced choices. Only migrate
  // the explicit singleton selection, never every historical confirmed blob.
  const ids = row.confirmedVersionIds ?? (row.confirmedVersionId ? [row.confirmedVersionId] : []);
  const versions = new Map(row.versions.map(version => [version.id, version]));
  return [...new Set(ids)].flatMap(id => {
    const version = versions.get(id);
    return version?.confirmedBlob ? [version] : [];
  });
}
// Video placement keeps its primary choice while downloads include every choice.
export function confirmedVersion(row: BatchRow) {
  const versions = confirmedVersions(row);
  return versions.find(version => version.id === row.confirmedVersionId) || versions[0];
}
export function confirmBatchVersion(row: BatchRow, id: string, blob: Blob, range: AudioDownloadRange): BatchRow {
  if (!row.versions.some(version => version.id === id)) return row;
  const ids = [...new Set([...confirmedVersions(row).map(version => version.id), id])];
  return { ...row, confirmedVersionIds: ids, confirmedVersionId: confirmedVersion(row)?.id || id,
    status: '已确认音效', error: undefined, versions: row.versions.map(version => version.id === id
      ? { ...version, confirmedBlob: blob, confirmedRange: range, draftRange: range } : version) };
}
export function unconfirmBatchVersion(row: BatchRow, id: string): BatchRow {
  const ids = confirmedVersions(row).filter(version => version.id !== id).map(version => version.id);
  return { ...row, confirmedVersionIds: ids,
    confirmedVersionId: ids.includes(row.confirmedVersionId || '') ? row.confirmedVersionId : ids[0],
    ...(row.placedVersionId === id ? { placedVersionId: undefined } : {}),
    status: ids.length ? '已确认音效' : row.versions.length ? '待试听与确认' : '待制作',
    versions: row.versions.map(version => version.id === id
      ? { ...version, confirmedBlob: undefined, confirmedUrl: undefined, confirmedRange: undefined } : version) };
}
export function updateBatchVersionRange(row: BatchRow, id: string, range: AudioDownloadRange | null): BatchRow {
  const version = row.versions.find(version => version.id === id);
  if (!version || sameBatchRange(version.draftRange, range, version.duration || version.confirmedRange?.end)) return row;
  const next = version.confirmedBlob && !sameBatchRange(range, version.confirmedRange, version.duration || version.confirmedRange?.end)
    ? unconfirmBatchVersion(row, id) : row;
  return { ...next, versions: next.versions.map(version => version.id === id ? { ...version, draftRange: range } : version) };
}
export type BatchAudioExport = { row: BatchRow; version: BatchVersion; name: string };
export function batchAudioExports(rows: BatchRow[]): BatchAudioExport[] {
  const entries = rows.flatMap(row => {
    const versions = confirmedVersions(row);
    return versions.map((version, index) => {
      const suffix = versions.length > 1 ? `_${index + 1}` : '';
      return { row, version, name: `${batchFileStem(row.name).slice(0, 100 - suffix.length)}${suffix}` };
    });
  });
  const names = uniqueBatchFileNames(entries.map(entry => entry.name));
  return entries.map((entry, index) => ({ ...entry, name: names[index] }));
}
export function batchExportRequirements(rows: BatchRow[]) {
  const byRow = new Map<string, BatchAudioExport[]>();
  for (const entry of batchAudioExports(rows)) {
    const entries = byRow.get(entry.row.id) || [];
    entries.push(entry); byRow.set(entry.row.id, entries);
  }
  return rows.flatMap(row => {
    const entries = byRow.get(row.id);
    return entries?.length ? entries.map(({ name, version }) => ({ ...row, name: name.replace(/\.wav$/i, ''),
      confirmedDuration: version.confirmedRange ? Number((version.confirmedRange.end - version.confirmedRange.start).toFixed(3)) : undefined }))
      : [{ ...row, confirmedDuration: undefined }];
  });
}
export function sameBatchRange(a?: AudioDownloadRange | null, b?: AudioDownloadRange | null, duration = 0) {
  return Math.abs((a?.start || 0) - (b?.start || 0)) < 0.0001 && Math.abs((a?.end ?? duration) - (b?.end ?? duration)) < 0.0001;
}
const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('ai-audio-sfx-batch-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('project');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export function restoreBatchProjectRow(row: BatchRow): BatchRow {
  // Earlier batch versions translated description instead of using searchQuery.
  // Only that obsolete failure is cleared; retain genuine search/download errors.
  const error = /^音效描述翻译(?:失败|未完成)/.test(row.error || '') ? undefined : row.error;
  return { ...row, error,
    status: error ? '制作失败，可重试' : confirmedVersion(row) ? '已确认剪辑' : row.versions.length ? '待试听与确认' : '待制作',
    versions: row.versions.map(v => ({ ...v,
      url: v.blob ? createMediaUrl(v.blob) : /^(?:https:\/\/|\/uploads\/)/.test(v.url || '') ? v.url : undefined })),
  };
}
export async function loadBatchProject(): Promise<BatchRow[]> {
  const db = await open();
  try {
    const rows = await new Promise<BatchRow[]>((resolve, reject) => {
      const req = db.transaction('project').objectStore('project').get('current');
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []); req.onerror = () => reject(req.error);
    });
    return Promise.all(rows.map(async row => restoreBatchProjectRow({ ...row, versions: await Promise.all(row.versions.map(async version => ({
      ...version,
      confirmedBlob: version.confirmedBlob || (version.confirmedUrl ? await fetch(version.confirmedUrl, { referrerPolicy: 'no-referrer' }).then(response => {
        if (!response.ok) throw new Error('已确认音效加载失败，请检查网络后重试。');
        return readMediaBlob(response);
      }) : undefined),
    }))) })));
  } finally { db.close(); }
}
export async function saveBatchProject(rows: BatchRow[]) {
  const saved = await Promise.all(rows.map(async row => ({ ...row, versions: await Promise.all(row.versions.map(async ({ blob, confirmedBlob, ...version }) => ({
    ...version,
    url: blob ? await uploadMediaBlob(blob, `${row.name}.wav`) : version.url ? await persistMediaUrl(version.url, row.name) : undefined,
    confirmedUrl: confirmedBlob ? await uploadMediaBlob(confirmedBlob, `${row.name}_confirmed.wav`) : version.confirmedUrl,
  }))) })));
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('project', 'readwrite');
      tx.objectStore('project').put(saved, 'current');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function loadBatchVideo(): Promise<BatchVideoAsset | null> {
  const db = await open();
  try {
    const video = await new Promise<any>((resolve, reject) => {
      const req = db.transaction('project').objectStore('project').get('video');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (!video || video.file instanceof Blob) return video;
    if (!video.url) return null;
    const response = await fetch(video.url, { referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('视频加载失败，请检查网络后重试。');
    const file = new File([await readMediaBlob(response)], video.name, { type: video.type });
    rememberMediaUrl(file, video.url);
    return { id: video.id, file };
  } finally { db.close(); }
}
export async function saveBatchVideo(video: BatchVideoAsset | null) {
  const saved = video ? { id: video.id, name: video.file.name, type: video.file.type, url: await uploadMediaBlob(video.file, video.file.name) } : null;
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('project', 'readwrite');
      if (saved) tx.objectStore('project').put(saved, 'video');
      else tx.objectStore('project').delete('video');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function clearBatchWorkspace() {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('project', 'readwrite');
      const store = tx.objectStore('project');
      store.delete('current');
      store.delete('video');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
