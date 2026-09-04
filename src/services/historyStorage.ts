import type { HistoryItem } from '../types';

const DB_NAME = 'ai-audio-history-v1';
const STORE_NAME = 'entries';
const METADATA_KEY = 'ai-audio-history-metadata-v1';
const MAX_BINARY_ENTRIES = 50;
const MAX_BINARY_BYTES = 500 * 1024 * 1024;

type StoredHistoryEntry = {
  id: string;
  item: HistoryItem;
  blob?: Blob;
  attachmentBlobs?: Blob[];
};

const blobCache = new Map<string, Blob>();

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
  const database = await openDatabase();
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
          ...(stored?.blob ? { url: URL.createObjectURL(stored.blob) } : {}),
          ...(attachments ? { attachments } : {}),
        };
      });
  } finally {
    database.close();
  }
}

export async function persistHistory(items: HistoryItem[]): Promise<void> {
  try {
    window.localStorage.setItem(METADATA_KEY, JSON.stringify(items.map(item => ({
      ...item,
      // Blob URLs are tab-scoped; IndexedDB (when available) restores the file.
      // Keep the metadata record usable in browsers without IndexedDB.
      ...(item.url.startsWith('blob:') ? { url: '' } : {}),
    }))));
  } catch {
    // Storage quota or privacy mode should not interrupt generation.
  }
  if (!canUseIndexedDb()) return;
  const database = await openDatabase();
  try {
    const entries: StoredHistoryEntry[] = [];
    let binaryEntryCount = 0;
    let binaryBytes = 0;
    for (const item of items) {
      const entry: StoredHistoryEntry = {
        id: item.id,
        item: {
          ...item,
          attachments: item.attachments?.map(({ file: _file, ...metadata }) => metadata),
        },
      };
      if (item.url.startsWith('blob:') && binaryEntryCount < MAX_BINARY_ENTRIES) {
        try {
          const cachedBlob = blobCache.get(item.url);
          if (cachedBlob) {
            if (binaryBytes + cachedBlob.size <= MAX_BINARY_BYTES) {
              entry.blob = cachedBlob;
              binaryEntryCount += 1;
              binaryBytes += cachedBlob.size;
            }
          } else {
            const response = await fetch(item.url);
            if (response.ok) {
              const blob = await response.blob();
              blobCache.set(item.url, blob);
              if (binaryBytes + blob.size <= MAX_BINARY_BYTES) {
                entry.blob = blob;
                binaryEntryCount += 1;
                binaryBytes += blob.size;
              }
            }
          }
        } catch {
          // A revoked object URL can no longer be copied; keep its metadata.
        }
      }
      const attachmentFiles = item.attachments?.map(attachment => attachment.file).filter(Boolean) as File[] | undefined;
      if (attachmentFiles && attachmentFiles.length > 0 && binaryBytes < MAX_BINARY_BYTES) {
        const available = MAX_BINARY_BYTES - binaryBytes;
        const attachmentBytes = attachmentFiles.reduce((total, file) => total + file.size, 0);
        // Keep attachment indexes aligned with metadata; skip the whole set if
        // it would exceed the remaining budget.
        if (attachmentBytes <= available) {
          entry.attachmentBlobs = attachmentFiles;
          binaryBytes += attachmentBytes;
        }
      }
      entries.push(entry);
    }
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
      entries.forEach(entry => store.put(entry));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Unable to write history storage'));
      transaction.onabort = () => reject(transaction.error || new Error('Unable to write history storage'));
    });
  } finally {
    database.close();
  }
}
