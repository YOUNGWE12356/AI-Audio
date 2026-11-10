export const ONLINE_SFX_SOURCES = [
  { id: 'envato', name: 'Envato Elements', url: 'https://elements.envato.com/sound-effects', searchable: true },
  { id: 'pse', name: 'Pro Sound Effects', url: 'https://www.prosoundeffects.com/search?type=sounds', searchable: true },
  { id: 'epidemic', name: 'Epidemic Sound', url: 'https://www.epidemicsound.com/sound-effects/', searchable: true },
  { id: 'mixkit', name: 'Mixkit', url: 'https://mixkit.co/free-sound-effects/', searchable: true },
  { id: 'web', name: '全网搜索', url: 'https://duckduckgo.com/', searchable: true },
  { id: 'pond5', name: 'Pond5', url: 'https://www.pond5.com/zh/', searchable: false },
] as const;

export const ONLINE_SFX_MAX_RESULTS = 100;
export const ONLINE_SFX_BATCH_COMPANY_POINTS = 1;
export const ONLINE_SFX_PRICING_VERSION = 'company-v2-online-sfx-batch';

export type OnlineSfxItem = {
  id: string; title: string; author: string; source: string; sourceUrl: string;
};
export type OnlineSfxCandidate = Omit<OnlineSfxItem, 'id'> & { previewUrl: string };
export type OnlineSfxSourceStatus = {
  source: string;
  count: number;
  unavailable: boolean;
  reason?: string;
};
export type CapturedOnlineSfx = {
  url: string; duration: number; elapsedMs: number; limited: boolean;
};

export function onlineSfxSearchUrl(source: string, query: string, page = 1) {
  const encoded = encodeURIComponent(query.trim());
  const pageNumber = Number.isSafeInteger(page) && page > 1 ? page : 1;
  const envatoPage = pageNumber > 1 ? `/pg-${pageNumber}` : '';
  switch (source) {
    case 'mixkit': return `https://mixkit.co/free-sound-effects/${encodeURIComponent(query.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}/${pageNumber > 1 ? `?page=${pageNumber}` : ''}`;
    case 'envato': return `https://elements.envato.com/sound-effects/${encoded}${envatoPage}`;
    case 'pse': return `https://www.prosoundeffects.com/search?type=sounds&keywords=${encoded}`;
    case 'epidemic': return `https://www.epidemicsound.com/sound-effects/?term=${encoded}`;
    case 'pond5': return `https://www.pond5.com/sound-effects/tag/${encoded}/`;
    case 'web': return `https://duckduckgo.com/?q=${encoded}%20sound%20effect`;
    default: return 'https://elements.envato.com/sound-effects';
  }
}
