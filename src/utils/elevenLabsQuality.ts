export type ElevenLabsQualityMode = 'standard' | 'pro';

export const normalizeElevenLabsQualityMode = (value: unknown): ElevenLabsQualityMode => (
  value === 'standard' ? 'standard' : 'pro'
);

export const getElevenLabsQualityMode = (): ElevenLabsQualityMode => {
  return 'pro';
};

export const isElevenLabsProQualityMode = (mode: ElevenLabsQualityMode) => mode === 'pro';
