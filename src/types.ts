/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AudioDesignResult } from './services/geminiService';

export type TabType = 'workbench' | 'audio-director' | 'music-studio' | 'sfx-studio' | 'dubbing-studio' | 'settings' | 'sfx-library' | 'sfx-requirements' | 'audio-tools' | 'video-soundtrack';

export interface FileItem {
  id: string;
  file: File;
  preview: string;
  type: string;
  preupload?: {
    status: 'uploading' | 'processing' | 'ready' | 'error';
    progress: number;
    uploadId?: string;
    message?: string;
    error?: string;
  };
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
  trackId: string;
  name: string;
  prompt: string;
  text?: string; // For dubbing TTS
  voiceId?: string; // Voice used by generated audio, or the inherited voice before generation
  startTime: number; // in seconds
  duration: number; // in seconds
  volume: number; // Clip-relative volume from 0 to 1; multiplied by its track volume
  audioUrl?: string; // Generated or uploaded file URL
  audioSource?: 'generated' | 'uploaded';
  origin?: 'ai' | 'manual'; // Whether the timeline item came from AI planning or a user action
  isGenerating?: boolean;
  error?: string;
  speed?: number; // User-controlled fine tuning multiplier (0.5 to 2.0)
  autoSpeed?: number; // Automatic dubbing fit multiplier derived from source/target duration
  sourceAudioDuration?: number; // Natural duration before automatic speed fitting
  speaker?: string; // Speaker/role detected from the source video
  subtitleId?: string; // Stable source subtitle/caption cue identifier
  subtitleStartTime?: number; // Source subtitle cue start time in seconds
  subtitleEndTime?: number; // Source subtitle cue end time in seconds
  lipStartTime?: number; // Detected visible mouth movement start in seconds
  lipEndTime?: number; // Detected visible mouth movement end in seconds
  lipSyncConfidence?: number; // 0 to 1 confidence for subtitle/lip timing
  timingSource?: string; // How the timing was obtained (subtitle, speech, lip, fallback, etc.)
  timingDirty?: boolean; // Text or timing changed after the current audio was fitted
  voiceDirty?: boolean; // Track voice changed after this audio was generated
}
