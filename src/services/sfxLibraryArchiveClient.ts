type ArchiveResponse = { downloadUrl?: unknown; error?: unknown };
type ArchiveFallback = { libraryIds: string[]; revision: number };

const readArchiveResponse = async (response: Response): Promise<ArchiveResponse | null> => {
  const body = await response.text();
  try {
    return JSON.parse(body) as ArchiveResponse;
  } catch {
    return null;
  }
};

const archiveUrlFromResponse = (result: ArchiveResponse | null): string | null => (
  typeof result?.downloadUrl === 'string' && result.downloadUrl.startsWith('/api/sfx/library/archive/')
    ? result.downloadUrl
    : null
);

const buildFallbackUrl = (ids: string[], fileName: string, fallback?: ArchiveFallback): string | null => {
  if (!fallback || !Number.isSafeInteger(fallback.revision)) return null;
  const indexById = new Map(fallback.libraryIds.map((id, index) => [id, index]));
  const bits = new Uint8Array(Math.ceil(fallback.libraryIds.length / 8));
  for (const id of ids) {
    const index = indexById.get(id);
    if (index === undefined) return null;
    bits[index >> 3] |= 1 << (index & 7);
  }
  const selection = Array.from(bits, byte => byte.toString(16).padStart(2, '0')).join('');
  const params = new URLSearchParams({ revision: String(fallback.revision), selection, fileName });
  return `/api/sfx/library/archive/prepare?${params}`;
};

export const prepareSfxLibraryArchive = async (
  ids: string[],
  fileName: string,
  fallback?: ArchiveFallback,
  fetchRequest: typeof fetch = fetch,
): Promise<string> => {
  const body = JSON.stringify({ ids, fileName });
  const fallbackUrl = buildFallbackUrl(ids, fileName, fallback);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    let result: ArchiveResponse | null;
    try {
      response = await fetchRequest('/api/sfx/library/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      result = await readArchiveResponse(response);
    } catch {
      if (attempt === 0) continue;
      throw new Error('连接下载服务失败，请确认服务器正常运行后重试。');
    }

    if (!response.ok) {
      if (response.status === 404 && typeof result?.error !== 'string' && fallbackUrl) {
        try {
          const fallbackResponse = await fetchRequest(fallbackUrl, { cache: 'no-store' });
          const fallbackResult = await readArchiveResponse(fallbackResponse);
          const fallbackDownloadUrl = fallbackResponse.ok ? archiveUrlFromResponse(fallbackResult) : null;
          if (fallbackDownloadUrl) return fallbackDownloadUrl;
          if (typeof fallbackResult?.error === 'string') throw new Error(fallbackResult.error);
          throw new Error(`下载服务的备用入口不可用（HTTP ${fallbackResponse.status}），请刷新页面后重试。`);
        } catch (error: any) {
          if (error instanceof Error) throw error;
          throw new Error('连接下载服务失败，请稍后重试。');
        }
      }
      if (response.status >= 500 && attempt === 0) continue;
      throw new Error(
        typeof result?.error === 'string'
          ? result.error
          : `下载服务返回异常（HTTP ${response.status}），请稍后重试。`,
      );
    }
    const downloadUrl = archiveUrlFromResponse(result);
    if (downloadUrl) return downloadUrl;
    if (attempt === 0) continue;
    throw new Error('下载服务未返回有效的打包链接，请稍后重试。');
  }

  throw new Error('无法准备打包下载，请稍后重试。');
};
