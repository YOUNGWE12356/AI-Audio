/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface VoiceItem {
  id: string; // ElevenLabs Voice ID
  name: string; // Chinese Name
  englishName: string; // English Name
  gender: 'male' | 'female';
  category: string; // 分类
  tags: string[]; // 标签
  description: string; // 描述
  previewUrl: string; // 试听 URL
  source?: 'my_voices' | 'voice_library';
  publicOwnerId?: string;
}

export const ELEVENLABS_VOICES: VoiceItem[] = [];
