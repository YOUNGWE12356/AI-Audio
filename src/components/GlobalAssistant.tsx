import React from 'react';
import type { TabType } from '../types';
import AssistantExecutor from './AssistantExecutor';

// Existing request contracts remain available to each manual workspace.
export interface AssistantAudioRequest {
  id: string;
  file?: File;
  task: 'analyze' | 'convert' | 'rename' | 'music-analysis-naming' | 'workstation' | 'isolate' | 'midi' | 'music-separation';
  audioTool?: 'workstation' | 'analysis' | 'factory' | 'renamer' | 'music-analysis-naming' | 'isolation' | 'midi' | 'music-separation';
  targetFormat?: 'mp3' | 'wav' | 'ogg' | 'flac' | 'aac' | 'm4a';
  targetSampleRate?: number;
  targetBitrate?: number;
  targetLufs?: number;
}
export interface AssistantVoiceRequest {
  id: string;
  file?: File;
  text: string;
  sourceText?: string;
  translationApplied?: boolean;
  language: string;
  gender: 'male' | 'female';
  emotion: string;
  role?: string;
  voiceSearchQuery?: string;
  openVoiceLibrary?: boolean;
  mode?: 'tts' | 'sts' | 'translate' | 'stt';
  inputMode?: 'single' | 'batch';
}
export interface AssistantVideoRequest {
  id: string;
  file?: File;
  prompt: string;
  tracks: Array<'bgm' | 'sfx' | 'dubbing'>;
  analyzeSubtitles: boolean;
  autoAnalyze: boolean;
  autoGenerate: boolean;
}
export interface AssistantMusicRequest { id: string; prompt: string; durationSeconds?: number; musicType?: 'instrumental' | 'vocal' }
export interface AssistantSfxRequest { id: string; prompt: string; durationSeconds?: number }
export interface AssistantDirectorRequest { id: string; file?: File; prompt: string }
export interface AssistantRequirementsRequest {
  id: string;
  prompt: string;
  template?: 'game_sfx_general' | 'game_sfx_middleware' | 'voiceover_general' | 'voiceover_multilang';
}
export interface AssistantLibraryRequest { id: string; searchQuery: string; category?: string; subcategory?: string }
interface GlobalAssistantProps {
  onNavigate: (tab: TabType) => void;
  onAudioRequest: (request: AssistantAudioRequest) => void;
  onVoiceRequest: (request: AssistantVoiceRequest) => void | Promise<void>;
  onVideoRequest: (request: AssistantVideoRequest) => void;
  onMusicRequest: (request: AssistantMusicRequest) => void;
  onSfxRequest: (request: AssistantSfxRequest) => void;
  onDirectorRequest?: (request: AssistantDirectorRequest) => void;
  onRequirementsRequest?: (request: AssistantRequirementsRequest) => void;
  onLibraryRequest?: (request: AssistantLibraryRequest) => void;
  externalTaskRunning?: boolean;
  embedded?: boolean;
}
export default function GlobalAssistant(props: GlobalAssistantProps) {
  return <AssistantExecutor embedded={props.embedded} onNavigate={props.onNavigate} />;
}
