// ElevenLabs language coverage: https://elevenlabs.io/docs/overview/models
const v4Codes = 'af am ar hy as ast az be bn bs bg my yue ca ceb hr cs da nl en et fil fi fr ff gl ka de el gu ha he hi hu is id it ja jv kam kn kk ko ky lo lv ln lt lg lb mk ms ml mt zh mi mr mn ne no oc or ps fa pl pt pa ro ru sr sn sd sk sl so ckb es sw sv tg ta te th tr uk ur uz vi cy wo zu'.split(' ');
const v3Codes = new Set('af ar hy as ast az be bn bs bg my yue ca ceb ny hr cs da nl en et fil fi fr gl ka de el gu ha he hi hu is id ga it ja jv kn kk ky ko lv ln lt lb mk ms ml mt zh mi mr mn ne no oc or ps fa pl pt pa ro ru sr sd sk sl so es sw sv tg ta te th tr uk ur uz vi cy yo'.split(' '));
const flashCodes = new Set('en ja zh de hi fr ko pt it es id nl tr fil pl sv bg ro ar cs el fi hr ms sk da ta uk ru hu no vi'.split(' '));
const languageNames = new Intl.DisplayNames(['zh-CN'], { type: 'language' });
const labelOverrides: Record<string, string> = { zh: '中文（普通话）', yue: '粤语', fil: '菲律宾语', ff: '富拉语', kam: '坎巴语', ckb: '库尔德语（索拉尼）' };

export const ELEVENLABS_TTS_LANGUAGES = v4Codes.map(code => ({
  code,
  label: labelOverrides[code] || languageNames.of(code) || code,
})).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));

const supportedCodes = new Set(v4Codes);

export function normalizeTtsLanguageCode(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '' || value === 'auto') return undefined;
  if (typeof value !== 'string') throw new Error('请选择有效的配音语言。');
  const code = value.trim().toLowerCase();
  if (code === 'auto' || !code) return undefined;
  if (!supportedCodes.has(code)) throw new Error('请选择支持的配音语言。');
  return code;
}

export const ttsLanguageLabel = (code: string) => code === 'auto'
  ? '自动'
  : ELEVENLABS_TTS_LANGUAGES.find(language => language.code === code)?.label || code;

export function supportsTtsLanguage(modelId: string, languageCode?: string): boolean {
  if (!languageCode) return true;
  if (modelId === 'eleven_v4') return supportedCodes.has(languageCode);
  if (modelId === 'eleven_v3') return v3Codes.has(languageCode);
  if (modelId === 'eleven_flash_v2_5') return flashCodes.has(languageCode);
  // Multilingual v2 does not support enforcing language_code.
  return false;
}
