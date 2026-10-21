import type { AudioDesignResult } from '../services/aiService';

// Normalize identifiers only; scene and sound-design prose keep their spacing.
export const normalizeAudioDesignSfxSchemes = (
  schemes: AudioDesignResult['sfxSchemes'],
): AudioDesignResult['sfxSchemes'] => schemes.map(scheme => ({
  ...scheme,
  items: scheme.items.map(item => ({
    ...item,
    name: item.name.trim().replace(/\s+/gu, '_'),
  })),
}));
