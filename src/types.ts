/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AudioDesignResult } from './services/geminiService';

export type TabType = 'workbench' | 'audio-director' | 'music-studio' | 'sfx-studio' | 'dubbing-studio' | 'settings' | 'sfx-library' | 'sfx-requirements';

export interface FileItem {
  file: File;
  preview: string;
  type: string;
}

export interface HistoryItem {
  id: string;
  type: 'sfx' | 'music' | 'voice' | 'director';
  title: string;
  prompt: string;
  url: string;
  timestamp: string;
  details?: string;
  speed?: number;
}
