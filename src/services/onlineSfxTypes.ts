export const ONLINE_SFX_SOURCES = [
  { id: 'envato', name: 'Envato Elements', url: 'https://elements.envato.com/sound-effects', searchable: true },
  { id: 'pse', name: 'Pro Sound Effects', url: 'https://www.prosoundeffects.com/sound-effects', searchable: false },
  { id: 'epidemic', name: 'Epidemic Sound', url: 'https://www.epidemicsound.com/sound-effects/', searchable: false },
  { id: 'pond5', name: 'Pond5', url: 'https://www.pond5.com/zh/', searchable: false },
] as const;

export const ONLINE_SFX_MAX_RESULTS = 100;
export const ONLINE_SFX_SOURCE_PAGES_PER_BATCH = 5;
export const ONLINE_SFX_BATCH_COMPANY_POINTS = 1;
export const ONLINE_SFX_PRICING_VERSION = 'company-v2-online-sfx-batch';

export type OnlineSfxItem = {
  id: string; title: string; author: string; source: string; sourceUrl: string;
};
export type CapturedOnlineSfx = {
  url: string; duration: number; elapsedMs: number; limited: boolean;
};

export function onlineSfxSearchUrl(source: string, query: string, page = 1) {
  const encoded = encodeURIComponent(query.trim());
  const pageNumber = Number.isSafeInteger(page) && page > 1 ? page : 1;
  const envatoPage = pageNumber > 1 ? `/pg-${pageNumber}` : '';
  switch (source) {
    case 'envato': return `https://elements.envato.com/sound-effects/${encoded}${envatoPage}`;
    case 'pse': return `https://www.prosoundeffects.com/search?type=sounds&keywords=${encoded}`;
    case 'epidemic': return `https://www.epidemicsound.com/sound-effects/search/?term=${encoded}`;
    case 'pond5': return `https://www.pond5.com/sound-effects/tag/${encoded}/`;
    default: return 'https://elements.envato.com/sound-effects';
  }
}
