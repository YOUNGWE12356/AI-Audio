import { generateSoundEffect } from './elevenLabsService';
import { prepareSoundEffectPrompt } from './sfxPromptService';
import { readGeneratedSoundEffectDuration } from '../utils/soundEffectAudio';
import type { ElevenLabsQualityMode } from '../utils/elevenLabsQuality';

export type SoundEffectVersionResult = { version: 'A' | 'B' } & (
  | { status: 'fulfilled'; blob: Blob; duration: number; generationPrompt: string }
  | { status: 'rejected'; error: string }
);

/** Publish each successful version immediately; a sibling failure must not discard it. */
export async function generateSoundEffectVersions(options: {
  prompt: string;
  duration?: number;
  qualityMode: ElevenLabsQualityMode;
  onResult: (result: SoundEffectVersionResult) => void;
}): Promise<SoundEffectVersionResult[]> {
  const generationPrompt = await prepareSoundEffectPrompt(options.prompt);
  return Promise.all((['A', 'B'] as const).map(async version => {
    let result: SoundEffectVersionResult;
    try {
      const blob = await generateSoundEffect(generationPrompt, options.duration, { qualityMode: options.qualityMode });
      const duration = await readGeneratedSoundEffectDuration(blob);
      result = { version, status: 'fulfilled', blob, duration, generationPrompt };
    } catch (error) {
      result = { version, status: 'rejected', error: error instanceof Error ? error.message : '生成失败，请重试' };
    }
    options.onResult(result);
    return result;
  }));
}
