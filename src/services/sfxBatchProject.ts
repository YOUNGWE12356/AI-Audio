import type { SfxBatchRequirement } from './sfxBatch';
import type { AudioDownloadRange } from './audioRangeExport';
export type BatchVersion = {
  id: string; title: string; kind: 'search' | 'generate'; source?: string; sourceUrl?: string; ticketId?: string;
  url?: string; blob?: Blob; duration?: number; draftRange?: AudioDownloadRange | null;
  confirmedBlob?: Blob; confirmedRange?: AudioDownloadRange;
};
export type BatchRow = SfxBatchRequirement & {
  selected: boolean; versions: BatchVersion[]; activeVersionId?: string; confirmedVersionId?: string;
  status: string; error?: string; excludedSources: string[];
};
export const batchId = () => globalThis.crypto?.randomUUID?.() || `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function confirmedVersion(row: BatchRow) { return row.versions.find(v => v.id === row.confirmedVersionId && v.confirmedBlob); }
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
      url: v.blob ? URL.createObjectURL(v.blob) : v.url?.startsWith('/uploads/') ? v.url : undefined })),
  };
}
export async function loadBatchProject(): Promise<BatchRow[]> {
  const db = await open();
  try {
    const rows = await new Promise<BatchRow[]>((resolve, reject) => {
      const req = db.transaction('project').objectStore('project').get('current');
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []); req.onerror = () => reject(req.error);
    });
    return rows.map(restoreBatchProjectRow);
  } finally { db.close(); }
}
export async function saveBatchProject(rows: BatchRow[]) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('project', 'readwrite');
      tx.objectStore('project').put(rows.map(row => ({ ...row, versions: row.versions.map(v => ({ ...v,
        url: v.url?.startsWith('blob:') ? undefined : v.url })) })), 'current');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
