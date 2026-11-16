const blobUrls = new WeakMap<Blob, string>();
const uploading = new WeakMap<Blob, Promise<string>>();
const savingUrls = new Map<string, Promise<string>>();
export const rememberMediaUrl = (blob: Blob, url: string) => { blobUrls.set(blob, url); };

export async function readMediaBlob(response: Response) {
  const blob = await response.blob();
  const url = response.headers.get('X-Audio-CDN-URL') || (response.url.startsWith('https://') ? response.url : '');
  if (url.startsWith('https://')) blobUrls.set(blob, url);
  return blob;
}
export const createMediaUrl = (blob: Blob) => blobUrls.get(blob) || URL.createObjectURL(blob);

export async function uploadMediaBlob(blob: Blob, name = 'audio.wav'): Promise<string> {
  const existing = blobUrls.get(blob);
  if (existing) return existing;
  let pending = uploading.get(blob);
  if (!pending) {
    pending = (async () => {
      const response = await fetch('/api/sfx/upload', { method: 'POST', headers: {
        'Content-Type': blob.type || 'application/octet-stream', 'x-filename': encodeURIComponent(name),
      }, body: blob });
      const payload = await response.json();
      if (!response.ok || typeof payload.url !== 'string') throw new Error(payload.error || '素材保存到 CDN 失败，请重试。');
      blobUrls.set(blob, payload.url); return payload.url;
    })().finally(() => uploading.delete(blob));
    uploading.set(blob, pending);
  }
  return pending;
}
export async function persistMediaUrl(url: string, name?: string) {
  if (!url.startsWith('blob:') && !url.startsWith('data:')) return url;
  let pending = savingUrls.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('本地音频无法读取，尚未保存。');
      const blob = await response.blob();
      const extension = blob.type.includes('mpeg') ? '.mp3' : blob.type.includes('ogg') ? '.ogg' : blob.type.includes('mp4') ? '.mp4' : '.wav';
      return uploadMediaBlob(blob, `${name || 'audio'}${extension}`);
    })();
    savingUrls.set(url, pending);
    pending.catch(() => savingUrls.delete(url));
  }
  return pending;
}
