import type { HistoryItem } from '../types';
import { persistMediaUrl, uploadMediaBlob } from './mediaClient';

const DB_NAME = 'ai-audio-history-v1';
const STORE_NAME = 'entries';
const METADATA_KEY = 'ai-audio-history-metadata-v1';

type StoredHistoryEntry = {
  id: string;
  item: HistoryItem;
  blob?: Blob;
  attachmentBlobs?: Blob[];
};


const canUseIndexedDb = () => typeof window !== 'undefined' && 'indexedDB' in window;

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (!canUseIndexedDb()) {
    reject(new Error('IndexedDB unavailable'));
    return;
  }
  const request = window.indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Unable to open history storage'));
});

export async function loadPersistentHistory(): Promise<HistoryItem[]> {
  let metadata: HistoryItem[] = [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(METADATA_KEY) || '[]');
    if (Array.isArray(parsed)) metadata = parsed as HistoryItem[];
  } catch {
    metadata = [];
  }
  if (!canUseIndexedDb()) return metadata;
  let database: IDBDatabase;
  try {
    database = await openDatabase();
  } catch {
    return metadata;
  }
  try {
    const entries = await new Promise<StoredHistoryEntry[]>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result || []) as StoredHistoryEntry[]);
      request.onerror = () => reject(request.error || new Error('Unable to read history storage'));
    });
    const storedById = new Map(entries.map(entry => [entry.id, entry]));
    return metadata
      .sort((left, right) => left.timestamp < right.timestamp ? 1 : -1)
      .map(item => {
        const stored = storedById.get(item.id);
        const attachments = item.attachments?.map((attachment, index) => {
          const storedBlob = stored?.attachmentBlobs?.[index];
          return storedBlob
            ? { ...attachment, file: new File([storedBlob], attachment.name, { type: attachment.type || storedBlob.type }) }
            : attachment;
        });
        return {
          ...item,
          ...(stored?.blob && !item.url?.startsWith('https://') ? { url: URL.createObjectURL(stored.blob) } : {}),
          ...(attachments ? { attachments } : {}),
        };
      });
  } catch {
    return metadata;
  } finally {
    database.close();
  }
}

export async function persistHistory(items: HistoryItem[]): Promise<void> {
  // Upload first. A failed upload leaves the previous persisted history intact.
  const saved = await Promise.all(items.map(async item => ({
    ...item,
    url: await persistMediaUrl(item.url, item.title),
    attachments: item.attachments ? await Promise.all(item.attachments.map(async ({ file, ...attachment }) => ({
      ...attachment,
      url: file ? await uploadMediaBlob(file, attachment.name) : attachment.url,
    }))) : undefined,
  })));
  window.localStorage.setItem(METADATA_KEY, JSON.stringify(saved));
  if (!canUseIndexedDb()) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
      saved.forEach(item => store.put({ id: item.id, item }));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Unable to write history storage'));
      transaction.onabort = () => reject(transaction.error || new Error('Unable to write history storage'));
    });
  } finally { database.close(); }
}
