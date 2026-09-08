export type AudioLanguageDefinition = {
  code: string;
  label: string;
  elevenLabsName: string;
  elevenLabsCode: string;
  localChatterbox: boolean;
  localCosyVoice: boolean;
  cloudDubbing: boolean;
};

// Keep language capabilities in one place. A language being translatable does
// not imply that every local voice engine can synthesize or clone it.
const currentLocalLanguages = new Set([
  'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'ar', 'hi',
  'tr', 'nl', 'pl', 'sv', 'da', 'fi', 'no', 'el', 'he', 'ms',
]);

const currentCosyVoiceLanguages = new Set(['zh', 'en', 'ja', 'ko', 'de', 'es', 'fr', 'it', 'ru']);

const elevenLabsLanguages: Array<[string, string, string, string]> = [
  ['en', '英文', 'English', 'en'],
  ['zh', '中文', 'Chinese Mandarin', 'zh'],
  ['ja', '日文', 'Japanese', 'ja'],
  ['ko', '韩文', 'Korean', 'ko'],
  ['fr', '法文', 'French', 'fr'],
  ['de', '德文', 'German', 'de'],
  ['es', '西班牙文', 'Spanish', 'es'],
  ['pt', '葡萄牙文', 'Portuguese', 'pt'],
  ['it', '意大利文', 'Italian', 'it'],
  ['ru', '俄文', 'Russian', 'ru'],
  ['hi', '印地文', 'Hindi', 'hi'],
  ['id', '印尼文', 'Indonesian', 'id'],
  ['vi', '越南文', 'Vietnamese', 'vi'],
  ['th', '泰文', 'Thai', 'th'],
  ['ar', '阿拉伯文', 'Arabic', 'ar'],
  ['tr', '土耳其文', 'Turkish', 'tr'],
  ['nl', '荷兰文', 'Dutch', 'nl'],
  ['pl', '波兰文', 'Polish', 'pl'],
  ['sv', '瑞典文', 'Swedish', 'sv'],
  ['da', '丹麦文', 'Danish', 'da'],
  ['fi', '芬兰文', 'Finnish', 'fi'],
  ['no', '挪威文', 'Norwegian', 'no'],
  ['el', '希腊文', 'Greek', 'el'],
  ['cs', '捷克文', 'Czech', 'cs'],
  ['ro', '罗马尼亚文', 'Romanian', 'ro'],
  ['hu', '匈牙利文', 'Hungarian', 'hu'],
  ['uk', '乌克兰文', 'Ukrainian', 'uk'],
  ['he', '希伯来文', 'Hebrew', 'he'],
  ['ms', '马来文', 'Malay', 'ms'],
  ['fil', '菲律宾文', 'Filipino', 'fil'],
  ['bn', '孟加拉文', 'Bengali', 'bn'],
  ['ur', '乌尔都文', 'Urdu', 'ur'],
  ['ta', '泰米尔文', 'Tamil', 'ta'],
];

export const AUDIO_LANGUAGE_REGISTRY: ReadonlyArray<AudioLanguageDefinition> = elevenLabsLanguages.map(
  ([code, label, elevenLabsName, elevenLabsCode]) => ({
    code,
    label,
    elevenLabsName,
    elevenLabsCode,
    localChatterbox: currentLocalLanguages.has(code),
    localCosyVoice: currentCosyVoiceLanguages.has(code),
    cloudDubbing: true,
  }),
);

export const COMMON_AUDIO_LANGUAGE_CODES = [
  'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'ar', 'hi',
] as const;

export const EXTENDED_AUDIO_LANGUAGE_CODES = AUDIO_LANGUAGE_REGISTRY
  .map(language => language.code)
  .filter(code => !COMMON_AUDIO_LANGUAGE_CODES.includes(code as typeof COMMON_AUDIO_LANGUAGE_CODES[number]));

export const SEED_VC_TARGET_LANGUAGE_OPTIONS = AUDIO_LANGUAGE_REGISTRY.map(language => [
  language.code,
  language.label,
] as const);

export const LOCAL_CLONE_LANGUAGE_OPTIONS = AUDIO_LANGUAGE_REGISTRY
  .filter(language => language.localChatterbox)
  .map(language => ({ value: language.code, label: language.label }));

export const LOCAL_CLONE_LANGUAGE_TUPLES = LOCAL_CLONE_LANGUAGE_OPTIONS
  .map(language => [language.value, language.label] as const);

export const COSYVOICE_LANGUAGE_OPTIONS = AUDIO_LANGUAGE_REGISTRY
  .filter(language => language.localCosyVoice)
  .map(language => ({ value: language.code, label: language.label }));

export const DUBBING_TARGET_LANGUAGE_OPTIONS = AUDIO_LANGUAGE_REGISTRY.map(language => ({
  value: language.elevenLabsName,
  label: language.label,
}));

export const DUBBING_SOURCE_LANGUAGE_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  ...AUDIO_LANGUAGE_REGISTRY.map(language => ({ value: language.elevenLabsCode, label: language.label })),
];

export const getAudioLanguage = (code: string) => AUDIO_LANGUAGE_REGISTRY.find(language => language.code === code);

export const isExtendedAudioLanguage = (code: string) => EXTENDED_AUDIO_LANGUAGE_CODES.includes(code);
