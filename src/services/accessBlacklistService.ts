import { getSfxLibraryAdminHeaders } from './sfxLibraryAdminService';

const parseResponse = async (response: Response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
  return payload as { ips?: unknown };
};

export const fetchAccessBlacklist = async () => {
  const response = await fetch('/api/access/blacklist', {
    headers: getSfxLibraryAdminHeaders(),
  });
  const payload = await parseResponse(response);
  return Array.isArray(payload.ips) ? payload.ips.filter((ip): ip is string => typeof ip === 'string') : [];
};

export const saveAccessBlacklist = async (ips: string[]) => {
  const response = await fetch('/api/access/blacklist', {
    method: 'PUT',
    headers: getSfxLibraryAdminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ips }),
  });
  const payload = await parseResponse(response);
  return Array.isArray(payload.ips) ? payload.ips.filter((ip): ip is string => typeof ip === 'string') : ips;
};
