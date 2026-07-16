/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AudioDesignResult } from './services/geminiService';

export type TabType = 'workbench' | 'audio-director' | 'music-studio' | 'sfx-studio' | 'dubbing-studio' | 'settings' | 'sfx-library' | 'sfx-requirements' | 'audio-tools' | 'video-soundtrack';

export interface FileItem {
  file: File;
  preview: string;
  type: string;
}

export interface HistoryItem {
  id: string;
  type: 'sfx' | 'music' | 'voice' | 'director' | 'video-soundtrack';
  title: string;
  prompt: string;
  url: string;
  timestamp: string;
  details?: string;
  speed?: number;
}

export interface TimelineClip {
  id: string;
  trackId: 'bgm' | 'sfx' | 'dubbing';
  name: string;
  prompt: string;
  text?: string; // For dubbing TTS
  voiceId?: string; // For dubbing voice
  startTime: number; // in seconds
  duration: number; // in seconds
  volume: number; // 0 to 1
  audioUrl?: string; // Generated file URL
  isGenerating?: boolean;
  error?: string;
}
