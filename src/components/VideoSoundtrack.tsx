/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Play, 
  Pause, 
  Plus, 
  Trash2, 
  Music, 
  Volume2, 
  Mic, 
  Waves, 
  Download, 
  Film, 
  Sparkles, 
  RotateCcw, 
  Check, 
  Loader2, 
  Sliders,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileVideo,
  Search,
  X,
  Info,
  CheckCircle2,
  FolderOpen,
  Save,
  FileDown,
  Gauge,
  Copy,
  Clipboard,
  Square,
  Pencil,
  Scissors,
  Combine,
  AudioLines,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TimelineClip } from '../types';
import { ELEVENLABS_VOICES, VoiceItem } from '../data/voices';
import { fetchAvailableVoices } from '../services/elevenLabsService';
import { extractVideoKeyframes } from '../utils/mediaPreparation';

const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;
const DEFAULT_DUBBING_VOICE_ID = '';
const MIN_DUBBING_AUTO_SPEED = 0.25;
const MAX_DUBBING_AUTO_SPEED = 4;
const ORIGINAL_AUDIO_TRACK_ID = 'original-audio';
const ORIGINAL_AUDIO_CLIP_ID = 'clip-original-audio';
const SPLIT_VOCAL_TRACK_ID = 'split-vocal-track';
const SPLIT_MUSIC_TRACK_ID = 'split-music-track';
const SPLIT_AMBIENCE_TRACK_ID = 'split-ambience-track';
const SPLIT_DUBBING_EDIT_TRACK_ID = 'split-dubbing-edit-track';
const SPLIT_VOCAL_CLIP_ID = 'clip-split-vocal';
const SPLIT_MUSIC_CLIP_ID = 'clip-split-music';
const DEFAULT_VOLUME_FADER = 0.8;
const MAX_VOLUME_FADER = 1;

type SoundtrackTrackType = 'bgm' | 'sfx' | 'dubbing' | 'original';

type ExportJobKind = 'video' | 'mixed' | 'stems' | 'bgm' | 'sfx' | 'dubbing';

const EXPORT_JOB_KINDS: ExportJobKind[] = ['video', 'mixed', 'stems', 'bgm', 'sfx', 'dubbing'];

type ExportAudioFormat = 'mp3' | 'wav' | 'aac';
type ExportBitDepth = 16 | 24 | 32;
type OriginalAudioSplitStatus = 'idle' | 'running' | 'completed' | 'error';
type OriginalAudioSplitSegmentRequest = {
  id: string;
  startTime: number;
  duration: number;
};
type OriginalAudioSeparationResult = {
  engine?: string;
  stems?: {
    vocalUrl?: string;
    musicUrl?: string;
    originalUrl?: string;
  };
  vocalSegments?: Array<{
    id: string;
    audioUrl: string;
    sourceAudioDuration?: number;
  }>;
};
type SimilarVoiceRecommendation = {
  voiceId: string;
  score: number;
  reason: string;
};

type TimelineUndoSnapshot = {
  label: string;
  tracks: SoundtrackTrack[];
  clips: TimelineClip[];
  selectedClipId: string | null;
  selectedClipIds: string[];
  selectedTrackId: string | null;
};

type ClipAlignmentGuide = {
  time: number;
  source: 'start' | 'end';
  target: 'start' | 'end';
};

export interface SoundtrackTrack {
  id: string;
  name: string;
  type: SoundtrackTrackType;
  volume: number;
  isMuted: boolean;
  isSoloed: boolean;
  defaultVoiceId?: string;
}

const normalizeUnitVolume = (value: unknown, fallback = 1) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_VOLUME_FADER, Math.max(0, value));
};

const getTrackVolume = (trackId: string, tracks: SoundtrackTrack[]) => (
  normalizeUnitVolume(tracks.find(track => track.id === trackId)?.volume, DEFAULT_VOLUME_FADER)
);

const faderToGain = (value: unknown, fallback = DEFAULT_VOLUME_FADER) => (
  normalizeUnitVolume(value, fallback) / DEFAULT_VOLUME_FADER
);

const getEffectiveClipVolume = (clip: TimelineClip, tracks: SoundtrackTrack[]) => (
  faderToGain(clip.volume) * faderToGain(getTrackVolume(clip.trackId, tracks))
);

const normalizePositiveNumber = (value: unknown, fallback: number) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
);

const normalizeOptionalTime = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
);

const getClipSourceOffset = (clip: TimelineClip) => normalizeOptionalTime(clip.sourceOffset) ?? 0;

const normalizeClipFade = (value: unknown, clipDuration = 0) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(5, Math.max(0, Math.min(value, Math.max(0, clipDuration / 2))));
};

const getAudioEnhancementPresetLabel = (preset: TimelineClip['audioEnhancementPreset']) => {
  switch (preset) {
    case 'voice_clean':
      return '人声清晰';
    case 'voice_warm':
      return '人声温暖';
    case 'sfx_punch':
      return '音效冲击';
    case 'bgm_bed':
      return 'BGM 避让';
    case 'broadcast':
      return '广播质感';
    default:
      return '不处理';
  }
};

const normalizeManualSpeed = (value: unknown) => Math.min(
  2,
  Math.max(0.5, normalizePositiveNumber(value, 1)),
);

const normalizeAutoSpeed = (value: unknown) => Math.min(
  MAX_DUBBING_AUTO_SPEED,
  Math.max(MIN_DUBBING_AUTO_SPEED, normalizePositiveNumber(value, 1)),
);

const calculateDubbingAutoSpeed = (sourceDuration: unknown, targetDuration: unknown) => {
  const source = normalizePositiveNumber(sourceDuration, 0);
  const target = normalizePositiveNumber(targetDuration, 0);
  if (source <= 0 || target <= 0) return 1;
  return normalizeAutoSpeed(source / target);
};

const getEffectiveClipSpeed = (clip: TimelineClip) => Math.min(
  MAX_DUBBING_AUTO_SPEED,
  Math.max(
    MIN_DUBBING_AUTO_SPEED,
    normalizeAutoSpeed(clip.autoSpeed) * normalizeManualSpeed(clip.speed),
  ),
);

const getLinkedSubtitleWindow = (clip: TimelineClip) => {
  if (!clip.subtitleId) return null;
  const start = normalizeOptionalTime(clip.subtitleStartTime);
  const end = normalizeOptionalTime(clip.subtitleEndTime);
  if (start === undefined || end === undefined || end <= start) return null;
  return { start, end };
};

const formatTimingSourceLabel = (source: string | undefined) => {
  const normalized = (source || '').trim().toLowerCase();
  if (!normalized) return '旧工程时间线';
  if (normalized === 'subtitle+lip') return '字幕与口型';
  if (normalized === 'speech+subtitle') return '对白与字幕';
  if (normalized === 'subtitle' || normalized === 'subtitle-only') return '字幕时间';
  if (normalized === 'visual-estimate') return '画面估算';
  if (normalized === 'full-video') return '完整视频分析';
  if (normalized === 'legacy-timeline') return '旧工程时间线';
  if (normalized === 'manual-copy') return '手动复制片段';
  return source || '旧工程时间线';
};

const preserveAudioPitch = (audio: HTMLAudioElement) => {
  audio.preservesPitch = true;
  const vendorAudio = audio as HTMLAudioElement & {
    webkitPreservesPitch?: boolean;
    mozPreservesPitch?: boolean;
  };
  if ('webkitPreservesPitch' in vendorAudio) vendorAudio.webkitPreservesPitch = true;
  if ('mozPreservesPitch' in vendorAudio) vendorAudio.mozPreservesPitch = true;
};

const getDubbingTimingSignature = (clip: TimelineClip) => JSON.stringify([
  clip.text || '',
  clip.startTime,
  clip.duration,
  clip.subtitleStartTime,
  clip.subtitleEndTime,
  clip.lipStartTime,
  clip.lipEndTime,
]);

const getAudioDuration = (audioUrl: string) => new Promise<number>((resolve, reject) => {
  const audio = new Audio();
  let settled = false;
  const timeoutId = window.setTimeout(() => finish(new Error('读取配音时长超时')), 12_000);
  const cleanup = () => {
    window.clearTimeout(timeoutId);
    audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    audio.removeEventListener('durationchange', handleLoadedMetadata);
    audio.removeEventListener('error', handleError);
    audio.removeAttribute('src');
    audio.load();
  };
  const finish = (error?: Error, duration?: number) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (error) reject(error);
    else resolve(duration as number);
  };
  const handleLoadedMetadata = () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      finish(undefined, audio.duration);
    }
  };
  const handleError = () => finish(new Error('无法读取配音音频时长'));

  audio.preload = 'metadata';
  audio.addEventListener('loadedmetadata', handleLoadedMetadata);
  audio.addEventListener('durationchange', handleLoadedMetadata);
  audio.addEventListener('error', handleError);
  audio.src = audioUrl;
  audio.load();
});

const formatSyncTime = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--:--.--';
  const safeValue = Math.max(0, value);
  const minutes = Math.floor(safeValue / 60);
  const seconds = safeValue - (minutes * 60);
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
};

const createDefaultTracks = (): SoundtrackTrack[] => [
  { id: 'bgm', name: '配乐 BGM', type: 'bgm', volume: DEFAULT_VOLUME_FADER, isMuted: false, isSoloed: false },
  { id: 'sfx', name: '音效 SFX', type: 'sfx', volume: DEFAULT_VOLUME_FADER, isMuted: false, isSoloed: false },
  {
    id: 'dubbing',
    name: '配音旁白',
    type: 'dubbing',
    volume: DEFAULT_VOLUME_FADER,
    isMuted: false,
    isSoloed: false,
    defaultVoiceId: DEFAULT_DUBBING_VOICE_ID,
  },
];

const createOriginalAudioTrack = (): SoundtrackTrack => ({
  id: ORIGINAL_AUDIO_TRACK_ID,
  name: '视频原声',
  type: 'original',
  volume: DEFAULT_VOLUME_FADER,
  isMuted: false,
  isSoloed: false,
});

const createOriginalAudioClip = (
  videoName: string,
  audioUrl: string,
  duration: number,
): TimelineClip => ({
  id: ORIGINAL_AUDIO_CLIP_ID,
  trackId: ORIGINAL_AUDIO_TRACK_ID,
  origin: 'manual',
  name: '视频原声',
  prompt: `源视频原声音轨：${videoName}`,
  startTime: 0,
  duration: normalizePositiveNumber(duration, 30),
  volume: DEFAULT_VOLUME_FADER,
  audioUrl,
  audioSource: 'uploaded',
  speed: 1,
  autoSpeed: 1,
  sourceAudioDuration: normalizePositiveNumber(duration, 30),
  timingDirty: false,
  voiceDirty: false,
});

const VOICE_CATEGORIES = ['全部', 'ElevenLabs 人声库', '我的克隆'];

const resolveClipAudioSource = (clip: TimelineClip): TimelineClip['audioSource'] => {
  if (clip.audioSource) return clip.audioSource;
  if (!clip.audioUrl) return undefined;
  const fileName = clip.audioUrl.split(/[?#]/, 1)[0].split('/').pop() || '';
  return fileName.startsWith('el_') ? 'generated' : 'uploaded';
};

const isGeneratedVoiceStale = (clip: TimelineClip, expectedVoiceId: string) => (
  Boolean(clip.audioUrl)
  && resolveClipAudioSource(clip) === 'generated'
  && (clip.voiceId || DEFAULT_DUBBING_VOICE_ID) !== expectedVoiceId
);

export interface SoundtrackProject {
  id: string;
  name: string;
  createdAt: number;
  videoFile: { name: string; url: string; isUploaded?: boolean } | null;
  videoDuration: number;
  clips: TimelineClip[];
  tracks?: SoundtrackTrack[];
  bgmEnabled: boolean;
  sfxEnabled: boolean;
  dubbingEnabled: boolean;
  mixedVideoUrl: string | null;
  exportedMixedUrl?: string | null;
  exportedBgmUrl?: string | null;
  exportedSfxUrl?: string | null;
  exportedDubbingUrl?: string | null;
}

const isOriginalAudioClip = (clip?: Pick<TimelineClip, 'id' | 'trackId'> | null) => (
  Boolean(clip && (clip.id === ORIGINAL_AUDIO_CLIP_ID || clip.trackId === ORIGINAL_AUDIO_TRACK_ID))
);

const getUrlFileExtension = (url: string | null | undefined, fallback: string) => {
  const match = String(url || '').split('?')[0].match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() || fallback;
};

export default function VideoSoundtrack() {
  // Project saving and loading states
  const [isProjectActive, setIsProjectActive] = useState<boolean>(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [showSaveProjectModal, setShowSaveProjectModal] = useState<boolean>(false);
  const [showOpenProjectModal, setShowOpenProjectModal] = useState<boolean>(false);
  const [projectNameInput, setProjectNameInput] = useState<string>('');
  const [projectNameDraft, setProjectNameDraft] = useState<string>('');
  const [isRenamingProject, setIsRenamingProject] = useState<boolean>(false);
  const [savedProjectsList, setSavedProjectsList] = useState<SoundtrackProject[]>([]);

  // Layout resizing and Copy/Paste states
  const [copiedClip, setCopiedClip] = useState<TimelineClip | null>(null);
  const [undoStack, setUndoStack] = useState<TimelineUndoSnapshot[]>([]);
  const [showSyncSuccess, setShowSyncSuccess] = useState<boolean>(false);
  const [timelineHeight, setTimelineHeight] = useState<number>(300);
  const [propertyWidth, setPropertyWidth] = useState<number>(320);
  const [propertyHeight, setPropertyHeight] = useState<number>(260);

  const [isResizingTimeline, setIsResizingTimeline] = useState<boolean>(false);
  const [propertyResizeAxis, setPropertyResizeAxis] = useState<'width' | 'height' | 'both' | null>(null);

  const timelineResizeStartRef = useRef<{ clientY: number; initialHeight: number; maxHeight: number }>({ clientY: 0, initialHeight: 300, maxHeight: 600 });
  const propertyResizeStartRef = useRef<{
    active: boolean;
    axis: 'width' | 'height' | 'both';
    pointerId: number;
    clientX: number;
    clientY: number;
    initialWidth: number;
    initialTimelineHeight: number;
    initialMobileHeight: number;
    maxWidth: number;
    maxTimelineHeight: number;
    maxMobileHeight: number;
    desktop: boolean;
  }>({
    active: false,
    axis: 'width',
    pointerId: -1,
    clientX: 0,
    clientY: 0,
    initialWidth: 320,
    initialTimelineHeight: 300,
    initialMobileHeight: 260,
    maxWidth: 600,
    maxTimelineHeight: 600,
    maxMobileHeight: 600
  });
  const propertyResizeCleanupRef = useRef<() => void>(() => undefined);

  // Video and file states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<{ name: string; url: string; isUploaded?: boolean } | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(30); // Default placeholder duration
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploadingToServer, setIsUploadingToServer] = useState<boolean>(false);
  const [videoLoadFailed, setVideoLoadFailed] = useState<boolean>(false);
  
  // AI Generation configuration options
  const [bgmEnabled, setBgmEnabled] = useState<boolean>(true);
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(true);
  const [dubbingEnabled, setDubbingEnabled] = useState<boolean>(true);
  
  // AI analysis and mixing status
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisStage, setAnalysisStage] = useState<string>('准备解析画面...');
  const analysisAbortRef = useRef<AbortController | null>(null);
  const analysisLockRef = useRef(false);
  const [isMixing, setIsMixing] = useState<boolean>(false);
  const [mixedVideoUrl, setMixedVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [originalAudioSplitStatus, setOriginalAudioSplitStatus] = useState<OriginalAudioSplitStatus>('idle');
  const [originalAudioSplitProgress, setOriginalAudioSplitProgress] = useState<number>(0);
  const [originalAudioSplitStage, setOriginalAudioSplitStage] = useState<string>('等待开始');
  const originalAudioSplitRunRef = useRef(0);
  const [subtitleSegmentStatus, setSubtitleSegmentStatus] = useState<OriginalAudioSplitStatus>('idle');
  const [subtitleSegmentProgress, setSubtitleSegmentProgress] = useState<number>(0);
  const [subtitleSegmentStage, setSubtitleSegmentStage] = useState<string>('等待识别字幕');
  const [subtitleSegmentCount, setSubtitleSegmentCount] = useState<number>(0);
  const subtitleSegmentRunRef = useRef(0);

  // Audio export and tracks stem states
  const [isExportingMixed, setIsExportingMixed] = useState<boolean>(false);
  const [isExportingStems, setIsExportingStems] = useState<boolean>(false);
  const [isExportingBgm, setIsExportingBgm] = useState<boolean>(false);
  const [isExportingSfx, setIsExportingSfx] = useState<boolean>(false);
  const [isExportingDubbing, setIsExportingDubbing] = useState<boolean>(false);

  const [exportedMixedUrl, setExportedMixedUrl] = useState<string | null>(null);
  const [exportedStemsUrl, setExportedStemsUrl] = useState<string | null>(null);
  const [exportedBgmUrl, setExportedBgmUrl] = useState<string | null>(null);
  const [exportedSfxUrl, setExportedSfxUrl] = useState<string | null>(null);
  const [exportedDubbingUrl, setExportedDubbingUrl] = useState<string | null>(null);

  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState<boolean>(false);
  const [exportAudioFormat, setExportAudioFormat] = useState<ExportAudioFormat>('mp3');
  const [exportSampleRate, setExportSampleRate] = useState<number>(48000);
  const [exportBitrate, setExportBitrate] = useState<string>('192k');
  const [exportBitDepth, setExportBitDepth] = useState<ExportBitDepth>(24);

  const exportControllersRef = useRef<Partial<Record<ExportJobKind, AbortController>>>({});
  const exportVersionsRef = useRef<Record<ExportJobKind, number>>({
    video: 0,
    mixed: 0,
    stems: 0,
    bgm: 0,
    sfx: 0,
    dubbing: 0,
  });

  const beginExportJob = (kind: ExportJobKind) => {
    exportControllersRef.current[kind]?.abort();
    const controller = new AbortController();
    const version = exportVersionsRef.current[kind] + 1;
    exportVersionsRef.current[kind] = version;
    exportControllersRef.current[kind] = controller;
    return { controller, version };
  };

  const isCurrentExportJob = (
    kind: ExportJobKind,
    version: number,
    controller: AbortController,
  ) => (
    !controller.signal.aborted
    && exportVersionsRef.current[kind] === version
    && exportControllersRef.current[kind] === controller
  );

  const cancelExportJobs = (kinds: ExportJobKind[] = EXPORT_JOB_KINDS) => {
    kinds.forEach(kind => {
      exportVersionsRef.current[kind] += 1;
      exportControllersRef.current[kind]?.abort();
      delete exportControllersRef.current[kind];
      if (kind === 'video') setIsMixing(false);
      else if (kind === 'mixed') setIsExportingMixed(false);
      else if (kind === 'stems') setIsExportingStems(false);
      else if (kind === 'bgm') setIsExportingBgm(false);
      else if (kind === 'sfx') setIsExportingSfx(false);
      else if (kind === 'dubbing') setIsExportingDubbing(false);
    });
  };

  const invalidateMixedVideo = () => {
    cancelExportJobs(['video']);
    setMixedVideoUrl(null);
  };

  const invalidateTrackOutputs = (trackType: SoundtrackTrack['type']) => {
    const jobsToCancel: ExportJobKind[] = ['video', 'mixed'];
    if (trackType === 'bgm' || trackType === 'sfx' || trackType === 'dubbing') {
      jobsToCancel.push(trackType);
    }
    cancelExportJobs(jobsToCancel);
    setMixedVideoUrl(null);
    setExportedMixedUrl(null);
    setExportedStemsUrl(null);
    if (trackType === 'bgm') setExportedBgmUrl(null);
    else if (trackType === 'sfx') setExportedSfxUrl(null);
    else if (trackType === 'dubbing') setExportedDubbingUrl(null);
  };

  // Premium voice selection states & audio preview states for Dubbing select
  const [fetchedVoices, setFetchedVoices] = useState<VoiceItem[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState<boolean>(false);
  const [voiceSearchQuery, setVoiceSearchQuery] = useState<string>('');
  const [voiceGenderFilter, setVoiceGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [voiceActiveCategory, setVoiceActiveCategory] = useState<string>('全部');
  const [isMatchingSimilarVoices, setIsMatchingSimilarVoices] = useState<boolean>(false);
  const [similarVoiceRecommendations, setSimilarVoiceRecommendations] = useState<SimilarVoiceRecommendation[]>([]);
  const [similarVoiceSourceDescription, setSimilarVoiceSourceDescription] = useState<string>('');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTokenRef = useRef(0);

  const stopVoicePreview = () => {
    previewTokenRef.current += 1;
    const previewAudio = previewAudioRef.current;
    if (previewAudio) {
      previewAudio.onerror = null;
      previewAudio.onended = null;
      previewAudio.pause();
      previewAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setPlayingVoiceId(null);
  };

  // Floating notification / prompt toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const loadVoices = async () => {
    setIsLoadingVoices(true);
    try {
      const apiVoices = await fetchAvailableVoices();
      if (apiVoices && apiVoices.length > 0) {
        const filteredApiVoices = apiVoices.filter(av =>
          av.source === 'voice_library' ||
          ['professional', 'cloned', 'generated'].includes(av.category)
        );

        const mapped: VoiceItem[] = filteredApiVoices.map(av => {
          const existing = ELEVENLABS_VOICES.find(ev => ev.id === av.voice_id);
          if (existing) return existing;

          const genderLabel = (av.labels?.gender || '').toLowerCase();
          let isMale = false;
          if (genderLabel) {
            if (genderLabel.includes('female')) {
              isMale = false;
            } else if (genderLabel.includes('male')) {
              isMale = true;
            }
          } else {
            isMale = /\b(adam|arnold|josh|clyde|antoni|sam|drew|paul|george|thomas|michael|marcus|ethan|henry)\b/i.test(av.name);
          }
          const category = av.source === 'voice_library'
            ? 'ElevenLabs 人声库'
            : (av.category === 'cloned' || av.category === 'professional' || av.category === 'generated')
              ? '我的克隆'
              : '自定义声线';
          const tags = [
            ...Object.values(av.labels || {}).filter(Boolean),
            av.source === 'voice_library' ? 'Voice Library' : '',
            'v3',
          ].filter(Boolean) as string[];

          return {
            id: av.voice_id,
            name: av.name,
            englishName: av.name,
            gender: isMale ? 'male' as const : 'female' as const,
            category: category,
            tags,
            description: av.labels?.description || `ElevenLabs ${category} · 已适配 eleven_v3`,
            previewUrl: av.preview_url || ''
          };
        });
        setFetchedVoices(mapped);
      } else {
        setFetchedVoices([]);
      }
    } catch (err) {
      console.error("Failed to load voices from ElevenLabs:", err);
    } finally {
      setIsLoadingVoices(false);
    }
  };

  const loadSavedProjects = () => {
    try {
      const stored = localStorage.getItem('video_soundtrack_projects');
      if (stored) {
        setSavedProjectsList(JSON.parse(stored));
      } else {
        setSavedProjectsList([]);
      }
    } catch (err) {
      console.error('Failed to load projects from localStorage:', err);
    }
  };

  const showProjectRenameError = (message: string) => {
    setToast({ message, type: 'error' });
    setTimeout(() => setToast(null), 3000);
  };

  const beginRenameCurrentProject = () => {
    if (!currentProjectId) return;

    try {
      const stored = localStorage.getItem('video_soundtrack_projects');
      const parsed = stored ? JSON.parse(stored) : [];
      const projects: SoundtrackProject[] = Array.isArray(parsed) ? parsed : [];
      const currentProject = projects.find(project => project.id === currentProjectId);

      if (!currentProject) {
        showProjectRenameError('找不到当前工程记录，请重新打开工程后再试。');
        return;
      }

      setProjectNameDraft(currentProject.name);
      setIsRenamingProject(true);
    } catch (err) {
      console.error('Failed to prepare project rename:', err);
      showProjectRenameError('读取工程名称失败，请稍后重试。');
    }
  };

  const commitRenameCurrentProject = () => {
    if (!currentProjectId) {
      setIsRenamingProject(false);
      return;
    }

    try {
      const stored = localStorage.getItem('video_soundtrack_projects');
      const parsed = stored ? JSON.parse(stored) : [];
      const projects: SoundtrackProject[] = Array.isArray(parsed) ? parsed : [];
      const currentProjectIndex = projects.findIndex(project => project.id === currentProjectId);

      if (currentProjectIndex === -1) {
        setIsRenamingProject(false);
        showProjectRenameError('找不到当前工程记录，请重新打开工程后再试。');
        return;
      }

      const nextName = projectNameDraft.trim();
      if (!nextName) {
        setProjectNameDraft(projects[currentProjectIndex].name);
        setIsRenamingProject(false);
        showProjectRenameError('工程名称不能为空。');
        return;
      }

      if (nextName === projects[currentProjectIndex].name) {
        setIsRenamingProject(false);
        return;
      }

      const updatedProjects = [...projects];
      updatedProjects[currentProjectIndex] = {
        ...updatedProjects[currentProjectIndex],
        name: nextName
      };
      localStorage.setItem('video_soundtrack_projects', JSON.stringify(updatedProjects));
      setSavedProjectsList(updatedProjects);
      setProjectNameDraft(nextName);
      setIsRenamingProject(false);
      setToast({ message: `工程已重命名为“${nextName}”`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      console.error('Failed to rename project:', err);
      setIsRenamingProject(false);
      showProjectRenameError('工程重命名失败，请稍后重试。');
    }
  };

  const handleCreateNewProject = () => {
    cancelExportJobs();
    analysisAbortRef.current?.abort('user');
    stopVoicePreview();
    videoRef.current?.pause();
    setMediaTimeSafely(videoRef.current, 0);
    setIsPlaying(false);
    setCurrentTime(0);
    // Reset workspace states to clean slate
    setVideoFile(null);
    setSelectedFile(null);
    setVideoDuration(30);
    setClips([]);
    const defaultTracks = createDefaultTracks();
    tracksRef.current = defaultTracks;
    setTracks(defaultTracks);
    setSelectedClipId(null);
    setSelectedClipIds([]);
    setSelectedTrackId(null);
    setBgmEnabled(true);
    setSfxEnabled(true);
    setDubbingEnabled(true);
    setMixedVideoUrl(null);
    setExportedMixedUrl(null);
    setExportedStemsUrl(null);
    setExportedBgmUrl(null);
    setExportedSfxUrl(null);
    setExportedDubbingUrl(null);
    setCurrentProjectId(null); // No active project ID yet
    setIsProjectActive(true); // Open the DAW workspace
    
    // Stop and clear any existing playing instances
    Object.keys(audioInstancesRef.current).forEach(clipId => {
      try {
        audioInstancesRef.current[clipId].pause();
      } catch (e) {}
      disconnectClipAudioRouting(clipId);
      delete audioInstancesRef.current[clipId];
    });

    setToast({
      message: '已新建视频音频工程，请导入视频开始制作。',
      type: 'success'
    });
    setTimeout(() => setToast(null), 3000);
  };

  // Real-time Save (保存 / 覆盖当前)
  const handleSaveProject = () => {
    if (!videoFile) {
      setToast({
        message: '请先导入并上传视频，再保存工程。',
        type: 'info'
      });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    if (currentProjectId) {
      try {
        const stored = localStorage.getItem('video_soundtrack_projects');
        let projects: SoundtrackProject[] = [];
        if (stored) {
          projects = JSON.parse(stored);
        }
        
        const existingIdx = projects.findIndex(p => p.id === currentProjectId);
        if (existingIdx !== -1) {
          const currentName = projects[existingIdx].name;
          const updatedProject: SoundtrackProject = {
            id: currentProjectId,
            name: currentName,
            createdAt: Date.now(),
            videoFile,
            videoDuration,
            clips,
            tracks,
            bgmEnabled,
            sfxEnabled,
            dubbingEnabled,
            mixedVideoUrl,
            exportedMixedUrl,
            exportedBgmUrl,
            exportedSfxUrl,
            exportedDubbingUrl
          };
          projects[existingIdx] = updatedProject;
          localStorage.setItem('video_soundtrack_projects', JSON.stringify(projects));
          
          setToast({
            message: `已实时保存工程“${currentName}”！`,
            type: 'success'
          });
          setTimeout(() => setToast(null), 3000);
          loadSavedProjects();
          return;
        }
      } catch (err: any) {
        setError(`实时保存失败: ${err.message}`);
        return;
      }
    }

    // No currentProjectId loaded, default to Save As / Save New
    setProjectNameInput(`未命名工程_${new Date().toLocaleDateString()}`);
    setShowSaveProjectModal(true);
  };

  // Save As / Save New Confirm
  const handleSaveProjectConfirm = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const name = projectNameInput.trim() || `工程_${new Date().toLocaleDateString()}`;
    const newId = `project-${Date.now()}`;
    
    const newProject: SoundtrackProject = {
      id: newId,
      name,
      createdAt: Date.now(),
      videoFile,
      videoDuration,
      clips,
      tracks,
      bgmEnabled,
      sfxEnabled,
      dubbingEnabled,
      mixedVideoUrl,
      exportedMixedUrl,
      exportedBgmUrl,
      exportedSfxUrl,
      exportedDubbingUrl
    };

    try {
      const stored = localStorage.getItem('video_soundtrack_projects');
      let projects: SoundtrackProject[] = [];
      if (stored) {
        projects = JSON.parse(stored);
      }
      projects.unshift(newProject);
      localStorage.setItem('video_soundtrack_projects', JSON.stringify(projects));
      
      setCurrentProjectId(newId); // Now working on this saved project
      
      setToast({
        message: `成功保存并创建新工程“${name}”！`,
        type: 'success'
      });
      setTimeout(() => setToast(null), 3000);

      setShowSaveProjectModal(false);
      setProjectNameInput('');
      loadSavedProjects();
    } catch (err: any) {
      setError(`保存工程失败: ${err.message}`);
    }
  };

  const handleOpenProject = (project: SoundtrackProject) => {
    try {
      cancelExportJobs();
      analysisAbortRef.current?.abort('user');
      stopVoicePreview();
      setVideoLoadFailed(false);
      videoRef.current?.pause();
      setMediaTimeSafely(videoRef.current, 0);
      setIsPlaying(false);
      setCurrentTime(0);
      setVideoFile(project.videoFile);
      setVideoDuration(project.videoDuration);
      // Clean clips of any active generating states
      const cleanedClips = (project.clips || []).map(clip => ({
        ...clip,
        isGenerating: false
      }));
      const storedTracks = project.tracks && project.tracks.length > 0
        ? project.tracks
        : createDefaultTracks();
      const normalizedTracks = storedTracks.map(track => {
        const normalizedTrack = {
          ...track,
          volume: normalizeUnitVolume(track.volume, DEFAULT_VOLUME_FADER),
        };
        if (track.type !== 'dubbing') return normalizedTrack;
        const legacyVoiceId = (project.clips || []).find(
          clip => clip.trackId === track.id && Boolean(clip.voiceId),
        )?.voiceId;
        return {
          ...normalizedTrack,
          defaultVoiceId: track.defaultVoiceId || legacyVoiceId || DEFAULT_DUBBING_VOICE_ID,
        };
      });
      const voiceByTrackId = new Map(
        normalizedTracks
          .filter(track => track.type === 'dubbing')
          .map(track => [track.id, track.defaultVoiceId || DEFAULT_DUBBING_VOICE_ID]),
      );
      const normalizedClips = cleanedClips.map(clip => {
        const audioSource = resolveClipAudioSource(clip);
        const inheritedVoiceId = voiceByTrackId.get(clip.trackId);
        if (!inheritedVoiceId) {
          return {
            ...clip,
            audioSource,
            speed: normalizeManualSpeed(clip.speed),
            autoSpeed: 1,
            timingDirty: false,
          };
        }

        const voiceId = clip.audioUrl && audioSource === 'generated'
          ? clip.voiceId || DEFAULT_DUBBING_VOICE_ID
          : inheritedVoiceId;
        const subtitleStartTime = normalizeOptionalTime(clip.subtitleStartTime) ?? clip.startTime;
        const subtitleEndTime = normalizeOptionalTime(clip.subtitleEndTime)
          ?? subtitleStartTime + clip.duration;
        const normalizedClip: TimelineClip = {
          ...clip,
          audioSource,
          voiceId,
          speed: normalizeManualSpeed(clip.speed),
          autoSpeed: normalizeAutoSpeed(clip.autoSpeed),
          subtitleStartTime,
          subtitleEndTime,
          lipStartTime: normalizeOptionalTime(clip.lipStartTime),
          lipEndTime: normalizeOptionalTime(clip.lipEndTime),
          timingSource: clip.timingSource || 'legacy-timeline',
          timingDirty: Boolean(clip.timingDirty),
        };
        const linkedSubtitleWindow = getLinkedSubtitleWindow(normalizedClip);
        if (linkedSubtitleWindow && !normalizedClip.timingDirty) {
          const subtitleDuration = linkedSubtitleWindow.end - linkedSubtitleWindow.start;
          const boundedDuration = Math.min(normalizedClip.duration, subtitleDuration);
          const boundedStartTime = Math.min(
            Math.max(linkedSubtitleWindow.start, normalizedClip.startTime),
            linkedSubtitleWindow.end - boundedDuration,
          );
          const wasOutsideSubtitleWindow = Math.abs(boundedStartTime - normalizedClip.startTime) > 0.001
            || Math.abs(boundedDuration - normalizedClip.duration) > 0.001;
          normalizedClip.startTime = boundedStartTime;
          normalizedClip.duration = boundedDuration;
          normalizedClip.autoSpeed = calculateDubbingAutoSpeed(
            normalizedClip.sourceAudioDuration,
            boundedDuration,
          );
          normalizedClip.timingDirty = Boolean(normalizedClip.timingDirty || wasOutsideSubtitleWindow);
        }
        return {
          ...normalizedClip,
          voiceDirty: audioSource === 'generated' && Boolean(
            clip.voiceDirty || isGeneratedVoiceStale(normalizedClip, inheritedVoiceId),
          ),
        };
      });
      const hasStaleDubbingAudio = normalizedClips.some(
        clip => clip.voiceDirty || clip.timingDirty,
      );
      tracksRef.current = normalizedTracks;
      setTracks(normalizedTracks);
      setClips(normalizedClips);
      setSelectedClipId(null);
      setSelectedClipIds([]);
      setSelectedTrackId(null);
      setBgmEnabled(project.bgmEnabled);
      setSfxEnabled(project.sfxEnabled);
      setDubbingEnabled(project.dubbingEnabled);
      setMixedVideoUrl(hasStaleDubbingAudio ? null : project.mixedVideoUrl);
      setExportedMixedUrl(hasStaleDubbingAudio ? null : project.exportedMixedUrl || null);
      setExportedBgmUrl(project.exportedBgmUrl || null);
      setExportedSfxUrl(project.exportedSfxUrl || null);
      setExportedDubbingUrl(hasStaleDubbingAudio ? null : project.exportedDubbingUrl || null);
      
      setCurrentProjectId(project.id);
      setIsProjectActive(true); // Go to workspace

      // Re-initialize audio instances if any clip has audioUrl
      Object.keys(audioInstancesRef.current).forEach(clipId => {
        try {
          audioInstancesRef.current[clipId].pause();
        } catch (e) {}
        disconnectClipAudioRouting(clipId);
        delete audioInstancesRef.current[clipId];
      });

      normalizedClips.forEach(clip => {
        if (clip.audioUrl) {
          const audio = new Audio(clip.audioUrl);
          preserveAudioPitch(audio);
          setClipPlaybackGain(clip.id, audio, getEffectiveClipVolume(clip, normalizedTracks));
          audio.playbackRate = getEffectiveClipSpeed(clip);
          audioInstancesRef.current[clip.id] = audio;
        }
      });

      setToast({
        message: `成功加载工程“${project.name}”！`,
        type: 'success'
      });
      setTimeout(() => setToast(null), 3000);

      setShowOpenProjectModal(false);
    } catch (err: any) {
      setError(`打开工程失败: ${err.message}`);
    }
  };

  const handleDeleteProject = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const stored = localStorage.getItem('video_soundtrack_projects');
      if (stored) {
        let projects: SoundtrackProject[] = JSON.parse(stored);
        const targetProj = projects.find(p => p.id === projectId);
        projects = projects.filter(p => p.id !== projectId);
        localStorage.setItem('video_soundtrack_projects', JSON.stringify(projects));
        setSavedProjectsList(projects);
        
        setToast({
          message: `已删除工程“${targetProj?.name || ''}”`,
          type: 'info' as any
        });
        setTimeout(() => {
          setToast(null);
        }, 3000);
      }
    } catch (err: any) {
      setError(`删除工程失败: ${err.message}`);
    }
  };

  const handleExportProjectToFile = (project: SoundtrackProject, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(project, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `${project.name}.vsa.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (err: any) {
      setError(`导出工程文件失败: ${err.message}`);
    }
  };

  const handleImportProjectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const project = JSON.parse(content) as SoundtrackProject;
        
        if (!project.id || !project.name || !Array.isArray(project.clips)) {
          throw new Error('无效的工程文件格式');
        }

        project.id = `project-imported-${Date.now()}`;
        project.name = `${project.name} (导入)`;

        const stored = localStorage.getItem('video_soundtrack_projects');
        let projects: SoundtrackProject[] = [];
        if (stored) {
          projects = JSON.parse(stored);
        }
        projects.unshift(project);
        localStorage.setItem('video_soundtrack_projects', JSON.stringify(projects));
        
        handleOpenProject(project);
      } catch (err: any) {
        setToast({
          message: `导入工程失败: ${err.message}`,
          type: 'error'
        });
        setTimeout(() => {
          setToast(null);
        }, 3000);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  useEffect(() => {
    loadVoices();
    loadSavedProjects();
  }, []);

  useEffect(() => {
    return () => {
      previewTokenRef.current += 1;
      const previewAudio = previewAudioRef.current;
      if (previewAudio) {
        previewAudio.onerror = null;
        previewAudio.onended = null;
        previewAudio.pause();
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const playWebSpeechFallback = (
    voiceName: string,
    gender: 'male' | 'female',
    category: string,
    tags: string[],
    previewToken: number,
  ) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      if (previewTokenRef.current === previewToken) setPlayingVoiceId(null);
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const text = `你好！我是 AI 配音助理 ${voiceName}。这是我为您准备的专属声线。我擅长 ${tags.join('、')}等不同风格的拟真配音，期待能为您生成完美的音频。`;
      const utterance = new SpeechSynthesisUtterance(text);
      const nativeVoices = window.speechSynthesis.getVoices();
      let chineseVoices = nativeVoices.filter(v => v.lang.includes('zh') || v.lang.includes('ZH'));
      if (chineseVoices.length === 0) {
        chineseVoices = nativeVoices;
      }
      let selectedNativeVoice = null;
      if (gender === 'female') {
        selectedNativeVoice = chineseVoices.find(v => 
          v.name.includes('Xiaoxiao') || 
          v.name.includes('Tingting') || 
          v.name.includes('female') || 
          v.name.includes('Female') ||
          v.name.includes('Huihui') ||
          v.name.includes('Yaoyao') ||
          v.name.includes('Meijia')
        ) || chineseVoices[0];
      } else {
        selectedNativeVoice = chineseVoices.find(v => 
          v.name.includes('Yunxi') || 
          v.name.includes('Kangkang') || 
          v.name.includes('male') || 
          v.name.includes('Male') ||
          v.name.includes('Zhiwei')
        ) || chineseVoices[0];
      }
      if (selectedNativeVoice) {
        utterance.voice = selectedNativeVoice;
      }
      utterance.rate = 1.0;
      utterance.pitch = gender === 'female' ? 1.15 : 0.9;
      utterance.onend = () => {
        if (previewTokenRef.current === previewToken) setPlayingVoiceId(null);
      };
      utterance.onerror = () => {
        if (previewTokenRef.current === previewToken) setPlayingVoiceId(null);
      };
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error("Speech synthesis fallback failed:", err);
      if (previewTokenRef.current === previewToken) setPlayingVoiceId(null);
    }
  };

  const handlePlayVoicePreview = (voiceId: string, url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const shouldStop = playingVoiceId === voiceId;
    stopVoicePreview();
    if (shouldStop) return;

    const previewToken = previewTokenRef.current;
    setPlayingVoiceId(voiceId);
    if (!url) {
      console.warn("No preview URL provided. Running local synthesis fallback...");
      const voiceObj = displayVoices.find(v => v.id === voiceId);
      if (voiceObj) {
        playWebSpeechFallback(voiceObj.name, voiceObj.gender, voiceObj.category, voiceObj.tags, previewToken);
      } else if (previewTokenRef.current === previewToken) {
        setPlayingVoiceId(null);
      }
      return;
    }
    const audio = new Audio(url);
    previewAudioRef.current = audio;
    let fallbackTriggered = false;
    const triggerFallback = () => {
      if (
        fallbackTriggered
        || previewTokenRef.current !== previewToken
        || previewAudioRef.current !== audio
      ) return;
      fallbackTriggered = true;
      audio.onerror = null;
      audio.onended = null;
      previewAudioRef.current = null;
      const voiceObj = displayVoices.find(v => v.id === voiceId);
      if (voiceObj) {
        playWebSpeechFallback(voiceObj.name, voiceObj.gender, voiceObj.category, voiceObj.tags, previewToken);
      } else {
        setPlayingVoiceId(null);
      }
    };
    audio.onerror = () => {
      console.warn(`Audio error event fired for URL: ${url}. Triggering fallback...`);
      triggerFallback();
    };
    audio.onended = () => {
      if (
        !fallbackTriggered
        && previewTokenRef.current === previewToken
        && previewAudioRef.current === audio
      ) {
        previewAudioRef.current = null;
        setPlayingVoiceId(null);
      }
    };
    audio.play().catch(err => {
      console.warn("Autoplay or preview playback failed:", err);
      triggerFallback();
    });
  };

  // Compute final voices list
  const displayVoices = fetchedVoices.length > 0 
    ? [...ELEVENLABS_VOICES, ...fetchedVoices.filter(fv => !ELEVENLABS_VOICES.some(ev => ev.id === fv.id))]
    : ELEVENLABS_VOICES;

  // Safe duration variable to prevent any division by zero, NaN or Infinity layout errors
  const safeDuration = (typeof videoDuration === 'number' && !isNaN(videoDuration) && isFinite(videoDuration) && videoDuration > 0) ? videoDuration : 30;

  // Timeline tracks & clips
  const [tracks, setTracks] = useState<SoundtrackTrack[]>(createDefaultTracks);
  const tracksRef = useRef<SoundtrackTrack[]>(tracks);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);
  const [showAddTrackModal, setShowAddTrackModal] = useState<boolean>(false);
  const [newTrackName, setNewTrackName] = useState<string>('');
  const [newTrackType, setNewTrackType] = useState<'bgm' | 'sfx' | 'dubbing'>('sfx');

  const [clips, setClips] = useState<TimelineClip[]>([]);
  const clipsRef = useRef<TimelineClip[]>(clips);
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  
  // We show the DAW editor if the project is active AND (we have a video file OR we have already loaded a project)
  const showDAW = isProjectActive && (!!videoFile || !!currentProjectId || clips.length > 0);
  
  // Scale / Zoom factor for horizontal scrolling (pixels per second)
  const [pixelsPerSecond, setPixelsPerSecond] = useState<number>(30);

  // Mouse interaction state for dragging and stretching clips
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [interactionType, setInteractionType] = useState<'drag' | 'resize-left' | 'resize-right' | 'fade-in' | 'fade-out' | null>(null);
  const [dragStartX, setDragStartX] = useState<number>(0);
  const [initialClipState, setInitialClipState] = useState<{ startTime: number; duration: number; trackId: string; fadeIn: number; fadeOut: number } | null>(null);
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);
  const [clipAlignmentGuide, setClipAlignmentGuide] = useState<ClipAlignmentGuide | null>(null);

  // Auto-initialize project ID and default name if a video is uploaded and we are in active project workspace but have no ID yet
  useEffect(() => {
    if (isProjectActive && videoFile && !currentProjectId) {
      const defaultName = `工程_${videoFile.name.replace(/\.[^/.]+$/, "")}`;
      const newId = `project-${Date.now()}`;
      setCurrentProjectId(newId);
      
      const newProject: SoundtrackProject = {
        id: newId,
        name: defaultName,
        createdAt: Date.now(),
        videoFile,
        videoDuration,
        clips,
        tracks,
        bgmEnabled,
        sfxEnabled,
        dubbingEnabled,
        mixedVideoUrl,
        exportedMixedUrl,
        exportedBgmUrl,
        exportedSfxUrl,
        exportedDubbingUrl
      };

      try {
        const stored = localStorage.getItem('video_soundtrack_projects');
        let projects: SoundtrackProject[] = [];
        if (stored) {
          projects = JSON.parse(stored);
        }
        projects.unshift(newProject);
        localStorage.setItem('video_soundtrack_projects', JSON.stringify(projects));
        setSavedProjectsList(projects);
        console.log(`Auto-initialized project: ${defaultName}`);
      } catch (err) {
        console.error('Failed to auto-initialize project:', err);
      }
    }
  }, [isProjectActive, videoFile, currentProjectId]);

  // Auto-Save Effect
  useEffect(() => {
    if (!isProjectActive || !currentProjectId || !videoFile) return;

    try {
      const stored = localStorage.getItem('video_soundtrack_projects');
      let projects: SoundtrackProject[] = [];
      if (stored) {
        projects = JSON.parse(stored);
      }
      
      const existingIdx = projects.findIndex(p => p.id === currentProjectId);
      if (existingIdx !== -1) {
        // Prepare the updated clips with clean isGenerating states for storage
        const cleanClips = clips.map(c => ({
          ...c,
          isGenerating: false
        }));

        const updatedProject: SoundtrackProject = {
          id: currentProjectId,
          name: projects[existingIdx].name,
          createdAt: projects[existingIdx].createdAt || Date.now(),
          videoFile,
          videoDuration,
          clips: cleanClips,
          tracks,
          bgmEnabled,
          sfxEnabled,
          dubbingEnabled,
          mixedVideoUrl,
          exportedMixedUrl,
          exportedBgmUrl,
          exportedSfxUrl,
          exportedDubbingUrl
        };

        // Deep-comparison check to avoid redundant localStorage write and state updates
        const currentStoredStr = JSON.stringify(projects[existingIdx]);
        const updatedStr = JSON.stringify(updatedProject);
        if (currentStoredStr !== updatedStr) {
          projects[existingIdx] = updatedProject;
          localStorage.setItem('video_soundtrack_projects', JSON.stringify(projects));
          setSavedProjectsList(projects);
          console.log(`Auto-saved project: ${updatedProject.name}`);
        }
      }
    } catch (err) {
      console.error('Failed to auto-save project:', err);
    }
  }, [
    isProjectActive,
    currentProjectId,
    videoFile,
    videoDuration,
    clips,
    tracks,
    bgmEnabled,
    sfxEnabled,
    dubbingEnabled,
    mixedVideoUrl,
    exportedMixedUrl,
    exportedBgmUrl,
    exportedSfxUrl,
    exportedDubbingUrl
  ]);

  // 1. Auto-dismiss Sync success alert after 5 seconds
  useEffect(() => {
    if (videoFile?.isUploaded) {
      setShowSyncSuccess(true);
      const timer = setTimeout(() => {
        setShowSyncSuccess(false);
      }, 5000);
      return () => clearTimeout(timer);
    } else {
      setShowSyncSuccess(false);
    }
  }, [videoFile?.isUploaded, videoFile?.name]);

  // 2. Timeline height resize mouse events
  useEffect(() => {
    if (!isResizingTimeline) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - timelineResizeStartRef.current.clientY;
      const newHeight = Math.max(160, Math.min(timelineResizeStartRef.current.maxHeight, timelineResizeStartRef.current.initialHeight - deltaY));
      setTimelineHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizingTimeline(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingTimeline]);

  // Property panel pointer resizing feedback and emergency cancellation.
  useEffect(() => {
    if (!propertyResizeAxis) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = propertyResizeAxis === 'both'
      ? 'nesw-resize'
      : propertyResizeAxis === 'width'
        ? 'ew-resize'
        : 'ns-resize';
    document.body.style.userSelect = 'none';

    const cancelResize = () => {
      propertyResizeStartRef.current.active = false;
      propertyResizeCleanupRef.current();
      propertyResizeCleanupRef.current = () => undefined;
      setPropertyResizeAxis(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelResize();
    };

    window.addEventListener('blur', cancelResize);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('blur', cancelResize);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [propertyResizeAxis]);

  useEffect(() => () => propertyResizeCleanupRef.current(), []);

  const getPropertyResizeBounds = () => {
    const workspace = document.getElementById('video-workspace-pane');
    const timeline = document.getElementById('daw-timeline-section');
    const propertyPanel = document.getElementById('properties-panel-container');
    const currentTimelineHeight = timeline?.clientHeight ?? timelineHeight;
    const currentWorkspaceHeight = workspace?.clientHeight ?? 180;
    const currentPanelHeight = propertyPanel?.clientHeight ?? propertyHeight;
    const totalResizableHeight = currentWorkspaceHeight + currentTimelineHeight;
    const workspaceWidth = workspace?.clientWidth ?? window.innerWidth;

    return {
      currentTimelineHeight,
      currentPanelHeight,
      maxWidth: Math.max(280, Math.min(640, workspaceWidth - 420)),
      maxTimelineHeight: Math.max(160, Math.min(600, totalResizableHeight - 180)),
      maxMobileHeight: Math.max(180, Math.min(600, currentWorkspaceHeight - 60))
    };
  };

  // Drag start trigger functions
  const startTimelineResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const bounds = getPropertyResizeBounds();
    setIsResizingTimeline(true);
    timelineResizeStartRef.current = {
      clientY: e.clientY,
      initialHeight: bounds.currentTimelineHeight,
      maxHeight: bounds.maxTimelineHeight
    };
  };

  const startPropertyResize = (
    e: React.PointerEvent<HTMLDivElement>,
    axis: 'width' | 'height' | 'both'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const bounds = getPropertyResizeBounds();
    const desktop = window.matchMedia('(min-width: 768px)').matches;
    propertyResizeCleanupRef.current();
    propertyResizeStartRef.current = {
      active: true,
      axis,
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      initialWidth: propertyWidth,
      initialTimelineHeight: bounds.currentTimelineHeight,
      initialMobileHeight: bounds.currentPanelHeight,
      maxWidth: bounds.maxWidth,
      maxTimelineHeight: bounds.maxTimelineHeight,
      maxMobileHeight: bounds.maxMobileHeight,
      desktop
    };
    setPropertyResizeAxis(axis);

    const updateSize = (clientX: number, clientY: number) => {
      const start = propertyResizeStartRef.current;
      if (!start.active) return;

      if (start.desktop && (start.axis === 'width' || start.axis === 'both')) {
        const deltaX = clientX - start.clientX;
        setPropertyWidth(Math.max(280, Math.min(start.maxWidth, start.initialWidth - deltaX)));
      }

      if (start.axis === 'height' || start.axis === 'both') {
        const deltaY = clientY - start.clientY;
        if (start.desktop) {
          setTimelineHeight(Math.max(160, Math.min(start.maxTimelineHeight, start.initialTimelineHeight - deltaY)));
        } else {
          setPropertyHeight(Math.max(180, Math.min(start.maxMobileHeight, start.initialMobileHeight + deltaY)));
        }
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => updateSize(moveEvent.clientX, moveEvent.clientY);
    const handleMouseMove = (moveEvent: MouseEvent) => updateSize(moveEvent.clientX, moveEvent.clientY);
    const finishResize = () => {
      propertyResizeStartRef.current.active = false;
      propertyResizeCleanupRef.current();
      propertyResizeCleanupRef.current = () => undefined;
      setPropertyResizeAxis(null);
    };
    const removeListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('mouseup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
    };

    propertyResizeCleanupRef.current = removeListeners;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('mouseup', finishResize);
    window.addEventListener('pointercancel', finishResize);
  };

  const handlePropertyWidthKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.shiftKey ? 40 : 16;
    const direction = e.key === 'ArrowLeft' ? 1 : -1;
    const { maxWidth } = getPropertyResizeBounds();
    setPropertyWidth((current) => Math.max(280, Math.min(maxWidth, current + direction * step)));
  };

  const handlePropertyHeightKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const step = e.shiftKey ? 40 : 16;
    const direction = e.key === 'ArrowDown' ? 1 : -1;
    const bounds = getPropertyResizeBounds();

    if (window.matchMedia('(min-width: 768px)').matches) {
      setTimelineHeight((current) => Math.max(160, Math.min(bounds.maxTimelineHeight, current - direction * step)));
    } else {
      setPropertyHeight((current) => Math.max(180, Math.min(bounds.maxMobileHeight, current + direction * step)));
    }
  };

  const handlePropertyCornerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      handlePropertyWidthKeyDown(e);
    } else {
      handlePropertyHeightKeyDown(e);
    }
  };

  const resetPropertyPanelSize = () => {
    const bounds = getPropertyResizeBounds();
    setPropertyWidth(Math.max(280, Math.min(bounds.maxWidth, 320)));
    if (window.matchMedia('(min-width: 768px)').matches) {
      setTimelineHeight(Math.max(160, Math.min(bounds.maxTimelineHeight, 300)));
    } else {
      setPropertyHeight(Math.max(180, Math.min(bounds.maxMobileHeight, 260)));
    }
  };

  // Copy/Paste helper actions
  const handleCopyClip = (clip: TimelineClip) => {
    if (isOriginalAudioClip(clip)) {
      setToast({
        message: '视频原声片段是系统自动关联的整段音频，不需要复制。',
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 3_000);
      return;
    }
    setCopiedClip(clip);
    setToast({
      message: `已复制音频片段：${clip.name}`,
      type: 'success'
    });
    setTimeout(() => {
      setToast(null);
    }, 2000);
  };

  const handlePasteClip = () => {
    if (!copiedClip) return;
    if (isOriginalAudioClip(copiedClip)) {
      setCopiedClip(null);
      setToast({
        message: '视频原声片段不能作为普通音频块粘贴；请通过轨道音量或静音控制原声。',
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 3_000);
      return;
    }
    pushUndoSnapshot('粘贴音频片段');
    
    const newId = `clip-copied-${Date.now()}`;
    const pastedTrack = tracks.find(track => track.id === copiedClip.trackId);
    const inheritedVoiceId = pastedTrack?.type === 'dubbing'
      ? pastedTrack.defaultVoiceId || DEFAULT_DUBBING_VOICE_ID
      : copiedClip.voiceId;
    const audioSource = resolveClipAudioSource(copiedClip);
    const pastedVoiceId = pastedTrack?.type === 'dubbing'
      && copiedClip.audioUrl
      && audioSource === 'generated'
      ? copiedClip.voiceId || DEFAULT_DUBBING_VOICE_ID
      : inheritedVoiceId;
    const pastedVoiceDirty = pastedTrack?.type === 'dubbing'
      ? audioSource === 'generated' && Boolean(
        copiedClip.voiceDirty || isGeneratedVoiceStale(
          { ...copiedClip, audioSource, voiceId: pastedVoiceId },
          inheritedVoiceId || DEFAULT_DUBBING_VOICE_ID,
        ),
      )
      : copiedClip.voiceDirty;
    const pastedStartTime = Math.max(0, Math.min(currentTime, safeDuration - copiedClip.duration));
    const pastedClip: TimelineClip = {
      ...copiedClip,
      id: newId,
      startTime: pastedStartTime,
      name: `${copiedClip.name} (副本)`,
      origin: 'manual',
      voiceId: pastedVoiceId,
      audioSource,
      voiceDirty: pastedVoiceDirty,
      // A pasted clip is a manual timeline item, not another occurrence of the
      // source subtitle. Clearing the link avoids showing false lip-sync data.
      subtitleId: undefined,
      subtitleStartTime: undefined,
      subtitleEndTime: undefined,
      lipStartTime: undefined,
      lipEndTime: undefined,
      lipSyncConfidence: undefined,
      timingSource: 'manual-copy',
    };

    if (copiedClip.audioUrl) {
      const audio = new Audio(copiedClip.audioUrl);
      preserveAudioPitch(audio);
      setClipPlaybackGain(newId, audio, getEffectiveClipVolume(pastedClip, tracksRef.current));
      audio.playbackRate = getEffectiveClipSpeed(pastedClip);
      audioInstancesRef.current[newId] = audio;
    }

    setClips(prev => [...prev, pastedClip]);
    handleSelectClip(newId);
    
    setToast({
      message: `已粘贴音频片段到当前位置：${pastedClip.name}`,
      type: 'success'
    });
    setTimeout(() => {
      setToast(null);
    }, 2000);
  };

  const getTrackLaneIdFromPoint = (clientX: number, clientY: number) => {
    const lane = document
      .elementsFromPoint(clientX, clientY)
      .find((element): element is HTMLElement => (
        element instanceof HTMLElement
        && Boolean(element.dataset.trackLaneId)
      ));
    return lane?.dataset.trackLaneId || null;
  };

  const canMoveClipToTrack = (clip: TimelineClip, targetTrack?: SoundtrackTrack) => (
    Boolean(targetTrack)
    && targetTrack?.type !== 'original'
    && !isOriginalAudioClip(clip)
  );

  const adaptClipForTrack = (clip: TimelineClip, targetTrack: SoundtrackTrack): TimelineClip => {
    const movedClip: TimelineClip = {
      ...clip,
      trackId: targetTrack.id,
    };

    if (targetTrack.type === 'dubbing') {
      const inheritedVoiceId = targetTrack.defaultVoiceId || DEFAULT_DUBBING_VOICE_ID;
      const audioSource = resolveClipAudioSource(clip);
      return {
        ...movedClip,
        text: movedClip.text || movedClip.prompt,
        voiceId: movedClip.audioUrl && audioSource === 'generated'
          ? movedClip.voiceId || inheritedVoiceId
          : inheritedVoiceId,
        audioSource,
        autoSpeed: normalizeAutoSpeed(movedClip.autoSpeed),
        speed: normalizeManualSpeed(movedClip.speed),
        voiceDirty: movedClip.audioUrl && audioSource === 'generated'
          ? isGeneratedVoiceStale({ ...movedClip, audioSource }, inheritedVoiceId)
          : false,
      };
    }

    return {
      ...movedClip,
      voiceDirty: false,
      timingDirty: false,
    };
  };

  const getClipAlignmentGuide = (
    timelineClips: TimelineClip[],
    clipId: string,
    _trackId: string,
    startTime: number,
    duration: number,
  ) => {
    const snapThresholdSeconds = Math.max(0.08, Math.min(0.5, 16 / pixelsPerSecond));
    const activeEdges = [
      { source: 'start' as const, time: startTime },
      { source: 'end' as const, time: startTime + duration },
    ];
    const targetEdges = timelineClips
      .filter(clip => (
        clip.id !== clipId
        && !isOriginalAudioClip(clip)
      ))
      .flatMap(clip => [
        { target: 'start' as const, time: clip.startTime },
        { target: 'end' as const, time: clip.startTime + clip.duration },
      ]);

    let closest: (ClipAlignmentGuide & { distance: number; snappedStartTime: number }) | null = null;
    for (const activeEdge of activeEdges) {
      for (const targetEdge of targetEdges) {
        const distance = Math.abs(activeEdge.time - targetEdge.time);
        if (distance > snapThresholdSeconds) continue;
        const snappedStartTime = activeEdge.source === 'start'
          ? targetEdge.time
          : targetEdge.time - duration;
        if (snappedStartTime < 0 || snappedStartTime + duration > safeDuration) continue;

        if (!closest || distance < closest.distance) {
          closest = {
            time: targetEdge.time,
            source: activeEdge.source,
            target: targetEdge.target,
            distance,
            snappedStartTime: parseFloat(snappedStartTime.toFixed(2)),
          };
        }
      }
    }

    return closest;
  };

  const startDragOrResize = (e: React.MouseEvent, clipId: string, type: 'drag' | 'resize-left' | 'resize-right' | 'fade-in' | 'fade-out') => {
    e.stopPropagation();
    e.preventDefault();
    const targetClip = clips.find(c => c.id === clipId);
    if (!targetClip) return;
    if (isOriginalAudioClip(targetClip)) {
      setToast({
        message: '视频原声片段会自动锁定为整段视频长度，不能拖动或拉伸。',
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 3_000);
      return;
    }

    handleSelectClip(clipId);
    pushUndoSnapshot(
      type === 'drag'
        ? '移动音频片段'
        : type === 'fade-in' || type === 'fade-out'
          ? '调整音频淡入淡出'
          : '调整音频片段长度',
    );
    setActiveClipId(clipId);
    setInteractionType(type);
    setDragStartX(e.clientX);
    setInitialClipState({
      startTime: targetClip.startTime,
      duration: targetClip.duration,
      trackId: targetClip.trackId,
      fadeIn: normalizeClipFade(targetClip.fadeIn, targetClip.duration),
      fadeOut: normalizeClipFade(targetClip.fadeOut, targetClip.duration),
    });
    setDragOverTrackId(type === 'drag' ? targetClip.trackId : null);
    const pastedTrack = tracksRef.current.find(track => track.id === targetClip.trackId);
    if (pastedTrack) invalidateTrackOutputs(pastedTrack.type);
  };

  // Handle mouse move & up on window for smooth dragging/resizing experience
  useEffect(() => {
    if (!activeClipId || !interactionType || !initialClipState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX;
      const deltaTime = deltaX / pixelsPerSecond;
      const pointerTrackId = interactionType === 'drag'
        ? getTrackLaneIdFromPoint(e.clientX, e.clientY)
        : null;
      const targetTrack = pointerTrackId
        ? tracksRef.current.find(track => track.id === pointerTrackId)
        : undefined;
      const nextDragOverTrackId = pointerTrackId && targetTrack?.type !== 'original'
        ? pointerTrackId
        : initialClipState.trackId;

      if (interactionType === 'drag') {
        setDragOverTrackId(nextDragOverTrackId);
      }

      const activeClipBeforeUpdate = clipsRef.current.find(clip => clip.id === activeClipId);
      let computedDragStartTime = activeClipBeforeUpdate?.startTime ?? initialClipState.startTime;
      let computedDragTrackId = activeClipBeforeUpdate?.trackId ?? initialClipState.trackId;
      let computedAlignmentGuide: ClipAlignmentGuide | null = null;

      if (activeClipBeforeUpdate && interactionType === 'drag') {
        computedDragStartTime = initialClipState.startTime + deltaTime;
        computedDragStartTime = Math.max(0, Math.min(computedDragStartTime, safeDuration - activeClipBeforeUpdate.duration));
        computedDragStartTime = parseFloat(computedDragStartTime.toFixed(2));

        if (targetTrack && canMoveClipToTrack(activeClipBeforeUpdate, targetTrack)) {
          computedDragTrackId = targetTrack.id;
          if (targetTrack.id !== initialClipState.trackId) {
            computedDragStartTime = initialClipState.startTime;
          }
        } else {
          computedDragTrackId = initialClipState.trackId;
        }

        const guide = getClipAlignmentGuide(
          clipsRef.current,
          activeClipBeforeUpdate.id,
          computedDragTrackId,
          computedDragStartTime,
          activeClipBeforeUpdate.duration,
        );
        if (guide) {
          computedDragStartTime = guide.snappedStartTime;
          computedAlignmentGuide = {
            time: guide.time,
            source: guide.source,
            target: guide.target,
          };
        }
      }

      setClipAlignmentGuide(computedAlignmentGuide);

      setClips(prev => {
        const nextClips = prev.map(clip => {
        if (clip.id !== activeClipId) return clip;

        let newStartTime = clip.startTime;
        let newDuration = clip.duration;
        let nextTrackId = clip.trackId;
        let nextFadeIn = normalizeClipFade(clip.fadeIn, clip.duration);
        let nextFadeOut = normalizeClipFade(clip.fadeOut, clip.duration);

        if (interactionType === 'drag') {
          newStartTime = computedDragStartTime;
          nextTrackId = computedDragTrackId;
        } else if (interactionType === 'resize-right') {
          newDuration = initialClipState.duration + deltaTime;
          newDuration = Math.max(0.5, Math.min(newDuration, safeDuration - clip.startTime));
          newDuration = parseFloat(newDuration.toFixed(2));
          nextFadeIn = normalizeClipFade(nextFadeIn, newDuration);
          nextFadeOut = normalizeClipFade(nextFadeOut, newDuration);
        } else if (interactionType === 'resize-left') {
          newStartTime = initialClipState.startTime + deltaTime;
          newDuration = initialClipState.duration - deltaTime;

          if (newStartTime < 0) {
            newStartTime = 0;
            newDuration = initialClipState.startTime + initialClipState.duration;
          }
          if (newDuration < 0.5) {
            newDuration = 0.5;
            newStartTime = initialClipState.startTime + initialClipState.duration - 0.5;
          }

          newStartTime = parseFloat(newStartTime.toFixed(2));
          newDuration = parseFloat(newDuration.toFixed(2));
          nextFadeIn = normalizeClipFade(nextFadeIn, newDuration);
          nextFadeOut = normalizeClipFade(nextFadeOut, newDuration);
        } else if (interactionType === 'fade-in') {
          nextFadeIn = normalizeClipFade(initialClipState.fadeIn + deltaTime, initialClipState.duration);
        } else if (interactionType === 'fade-out') {
          nextFadeOut = normalizeClipFade(initialClipState.fadeOut - deltaTime, initialClipState.duration);
        }

        const destinationTrack = tracksRef.current.find(track => track.id === nextTrackId);
        const movedClip = destinationTrack && nextTrackId !== clip.trackId
          ? adaptClipForTrack(clip, destinationTrack)
          : clip;
        const isDubbingClip = destinationTrack?.type === 'dubbing';
        const updatedClip: TimelineClip = {
          ...movedClip,
          trackId: nextTrackId,
          startTime: newStartTime,
          duration: newDuration,
          fadeIn: nextFadeIn,
          fadeOut: nextFadeOut,
          ...(isDubbingClip ? {
            autoSpeed: calculateDubbingAutoSpeed(movedClip.sourceAudioDuration, newDuration),
            timingDirty: true,
          } : {}),
        };
        const cachedAudio = audioInstancesRef.current[clip.id];
        if (cachedAudio && isDubbingClip) {
          cachedAudio.playbackRate = getEffectiveClipSpeed(updatedClip);
        }
        if (cachedAudio && nextTrackId !== clip.trackId) {
          setClipPlaybackGain(clip.id, cachedAudio, getEffectiveClipVolume(updatedClip, tracksRef.current));
        }
        return updatedClip;
        });
        clipsRef.current = nextClips;
        return nextClips;
      });
    };

    const handleMouseUp = () => {
      const activeClip = clipsRef.current.find(clip => clip.id === activeClipId);
      const activeTrack = activeClip
        ? tracksRef.current.find(track => track.id === activeClip.trackId)
        : undefined;
      if (activeTrack) invalidateTrackOutputs(activeTrack.type);
      if (initialClipState?.trackId && initialClipState.trackId !== activeClip?.trackId) {
        const previousTrack = tracksRef.current.find(track => track.id === initialClipState.trackId);
        if (previousTrack) invalidateTrackOutputs(previousTrack.type);
        setToast({
          message: `已移动到轨道：${activeTrack?.name || '目标轨道'}`,
          type: 'success',
        });
        window.setTimeout(() => setToast(null), 2_000);
      }
      setActiveClipId(null);
      setInteractionType(null);
      setInitialClipState(null);
      setDragOverTrackId(null);
      setClipAlignmentGuide(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeClipId, interactionType, initialClipState, pixelsPerSecond, safeDuration]);

  // Refs for audio synchronization
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const audioInstancesRef = useRef<{ [clipId: string]: HTMLAudioElement }>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioRoutingRef = useRef<Record<string, { source: MediaElementAudioSourceNode; gain: GainNode }>>({});

  const getOrCreateAudioContext = () => {
    if (typeof window === 'undefined') return null;
    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return null;
      audioContextRef.current = new AudioContextCtor();
    }
    return audioContextRef.current;
  };

  const disconnectClipAudioRouting = (clipId: string) => {
    const routing = audioRoutingRef.current[clipId];
    if (!routing) return;
    try { routing.source.disconnect(); } catch {}
    try { routing.gain.disconnect(); } catch {}
    delete audioRoutingRef.current[clipId];
  };

  const setClipPlaybackGain = (clipId: string, audio: HTMLAudioElement, gain: number) => {
    const safeGain = Math.max(0, Math.min(4, Number.isFinite(gain) ? gain : 1));
    try {
      const audioContext = getOrCreateAudioContext();
      if (audioContext) {
        if (!audioRoutingRef.current[clipId]) {
          const source = audioContext.createMediaElementSource(audio);
          const gainNode = audioContext.createGain();
          source.connect(gainNode);
          gainNode.connect(audioContext.destination);
          audioRoutingRef.current[clipId] = { source, gain: gainNode };
        }
        audioRoutingRef.current[clipId].gain.gain.value = safeGain;
        audio.volume = 1;
        return;
      }
    } catch (error) {
      console.warn('WebAudio gain routing failed, falling back to native volume:', error);
    }
    audio.volume = Math.min(1, safeGain);
  };

  const resumeAudioContextForPlayback = () => {
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }
  };

  const syncAudioInstancesForTimelineState = (
    nextClips: TimelineClip[],
    nextTracks: SoundtrackTrack[],
  ) => {
    const nextClipIds = new Set(nextClips.map(clip => clip.id));
    Object.entries(audioInstancesRef.current).forEach(([clipId, audio]: [string, HTMLAudioElement]) => {
      if (!nextClipIds.has(clipId)) {
        audio.pause();
        disconnectClipAudioRouting(clipId);
        delete audioInstancesRef.current[clipId];
      }
    });

    nextClips.forEach(clip => {
      if (!clip.audioUrl) return;
      const existingAudio = audioInstancesRef.current[clip.id];
      if (!existingAudio || existingAudio.src !== clip.audioUrl) {
        replaceCachedClipAudio(
          clip.id,
          clip.audioUrl,
          clip.volume,
          getEffectiveClipSpeed(clip),
          clip.trackId,
        );
        return;
      }
      setClipPlaybackGain(clip.id, existingAudio, getEffectiveClipVolume(clip, nextTracks));
      existingAudio.playbackRate = getEffectiveClipSpeed(clip);
    });
  };

  const pushUndoSnapshot = (label: string) => {
    setUndoStack(prev => [
      ...prev.slice(-39),
      {
        label,
        tracks: tracksRef.current.map(track => ({ ...track })),
        clips: clipsRef.current.map(clip => ({ ...clip })),
        selectedClipId,
        selectedClipIds,
        selectedTrackId,
      },
    ]);
  };

  const handleUndoTimelineEdit = () => {
    const snapshot = undoStack[undoStack.length - 1];
    if (!snapshot) {
      setToast({
        message: '没有可撤回的时间轴操作。',
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 2_000);
      return;
    }

    setUndoStack(prev => prev.slice(0, -1));
    tracksRef.current = snapshot.tracks;
    clipsRef.current = snapshot.clips;
    setTracks(snapshot.tracks);
    setClips(snapshot.clips);
    setSelectedClipId(snapshot.selectedClipId);
    setSelectedClipIds(snapshot.selectedClipIds || (snapshot.selectedClipId ? [snapshot.selectedClipId] : []));
    setSelectedTrackId(snapshot.selectedTrackId);
    syncAudioInstancesForTimelineState(snapshot.clips, snapshot.tracks);
    invalidateTrackOutputs('bgm');
    invalidateTrackOutputs('sfx');
    invalidateTrackOutputs('dubbing');
    invalidateTrackOutputs('original');
    setToast({
      message: `已撤回：${snapshot.label}`,
      type: 'success',
    });
    window.setTimeout(() => setToast(null), 2_000);
  };

  const replaceCachedClipAudio = (
    clipId: string,
    audioUrl: string,
    volume: number,
    speed: number,
    trackId: string,
  ) => {
    const previousAudio = audioInstancesRef.current[clipId];
    if (previousAudio) {
      previousAudio.pause();
      try { previousAudio.currentTime = 0; } catch {}
      disconnectClipAudioRouting(clipId);
    }
    const nextAudio = new Audio(audioUrl);
    preserveAudioPitch(nextAudio);
    setClipPlaybackGain(clipId, nextAudio, faderToGain(volume) * faderToGain(getTrackVolume(trackId, tracksRef.current)));
    nextAudio.playbackRate = speed;
    audioInstancesRef.current[clipId] = nextAudio;
  };

  const upsertOriginalAudioTrack = (
    videoName: string,
    audioUrl: string,
    duration = safeDuration,
  ) => {
    if (!audioUrl) return;
    const nextTracks = tracksRef.current.some(track => track.id === ORIGINAL_AUDIO_TRACK_ID)
      ? tracksRef.current.map(track => (
        track.id === ORIGINAL_AUDIO_TRACK_ID
          ? { ...track, name: track.name || '视频原声', type: 'original' as const }
          : track
      ))
      : [createOriginalAudioTrack(), ...tracksRef.current];
    tracksRef.current = nextTracks;
    setTracks(nextTracks);

    const nextClip = createOriginalAudioClip(videoName, audioUrl, duration);
    setClips(prev => {
      const hasOriginalClip = prev.some(clip => clip.id === ORIGINAL_AUDIO_CLIP_ID);
      if (hasOriginalClip) {
        return prev.map(clip => (
          clip.id === ORIGINAL_AUDIO_CLIP_ID
            ? {
              ...clip,
              ...nextClip,
              duration: normalizePositiveNumber(duration, clip.duration),
              sourceAudioDuration: normalizePositiveNumber(duration, clip.sourceAudioDuration || clip.duration),
            }
            : clip
        ));
      }
      return [nextClip, ...prev];
    });
    replaceCachedClipAudio(
      ORIGINAL_AUDIO_CLIP_ID,
      audioUrl,
      nextClip.volume,
      getEffectiveClipSpeed(nextClip),
      ORIGINAL_AUDIO_TRACK_ID,
    );
    invalidateTrackOutputs('original');
  };

  const updateOriginalAudioClipDuration = (duration: number) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    setClips(prev => prev.map(clip => (
      clip.id === ORIGINAL_AUDIO_CLIP_ID
        ? {
          ...clip,
          startTime: 0,
          duration,
          sourceAudioDuration: duration,
        }
        : clip
    )));
  };

  const getSplitSourceDubbingCues = (
    sourceClip: TimelineClip,
    existingTracks = tracksRef.current,
  ) => {
    const sourceStart = normalizeOptionalTime(sourceClip.startTime) ?? 0;
    const sourceDuration = normalizePositiveNumber(sourceClip.duration, safeDuration);
    const sourceEnd = sourceStart + sourceDuration;
    return clipsRef.current
      .filter(clip => {
        const track = existingTracks.find(item => item.id === clip.trackId);
        const clipStart = normalizeOptionalTime(clip.startTime) ?? 0;
        const clipDuration = normalizePositiveNumber(clip.duration, 0);
        const clipEnd = clipStart + clipDuration;
        return track?.type === 'dubbing'
          && clip.trackId !== SPLIT_VOCAL_TRACK_ID
          && typeof clip.text === 'string'
          && clip.text.trim().length > 0
          && clipEnd > sourceStart
          && clipStart < sourceEnd;
      })
      .sort((a, b) => a.startTime - b.startTime);
  };

  const buildOriginalAudioSplitSegments = (sourceClip: TimelineClip): OriginalAudioSplitSegmentRequest[] => {
    const sourceStart = normalizeOptionalTime(sourceClip.startTime) ?? 0;
    const sourceDuration = normalizePositiveNumber(sourceClip.duration, safeDuration);
    const sourceEnd = sourceStart + sourceDuration;
    const sourceDubbingCues = getSplitSourceDubbingCues(sourceClip);
    if (sourceDubbingCues.length === 0) {
      return [{
        id: SPLIT_VOCAL_CLIP_ID,
        startTime: sourceStart,
        duration: sourceDuration,
      }];
    }
    return sourceDubbingCues.map((cue, index) => {
      const cueStart = Math.max(
        sourceStart,
        normalizeOptionalTime(cue.subtitleStartTime) ?? normalizeOptionalTime(cue.startTime) ?? sourceStart,
      );
      const cueEnd = Math.min(
        sourceEnd,
        normalizeOptionalTime(cue.subtitleEndTime) ?? cueStart + normalizePositiveNumber(cue.duration, 1),
      );
      return {
        id: `clip-split-vocal-${index + 1}`,
        startTime: cueStart,
        duration: Math.max(0.05, cueEnd - cueStart),
      };
    });
  };

  const upsertSplitResultTracksAndClips = (
    sourceClip: TimelineClip,
    separationResult?: OriginalAudioSeparationResult,
  ) => {
    const splitTrackDefinitions: SoundtrackTrack[] = [
      {
        id: SPLIT_VOCAL_TRACK_ID,
        name: '拆分人声 / 台词',
        type: 'dubbing',
        volume: DEFAULT_VOLUME_FADER,
        isMuted: false,
        isSoloed: false,
        defaultVoiceId: DEFAULT_DUBBING_VOICE_ID,
      },
      {
        id: SPLIT_MUSIC_TRACK_ID,
        name: '拆分音乐',
        type: 'bgm',
        volume: DEFAULT_VOLUME_FADER,
        isMuted: false,
        isSoloed: false,
      },
    ];

    const existingTracks = tracksRef.current;
    const nextTracks = [...existingTracks];
    for (const splitTrack of splitTrackDefinitions) {
      const existingIndex = nextTracks.findIndex(track => track.id === splitTrack.id);
      if (existingIndex >= 0) {
        nextTracks[existingIndex] = {
          ...nextTracks[existingIndex],
          name: splitTrack.name,
          type: splitTrack.type,
          defaultVoiceId: splitTrack.defaultVoiceId ?? nextTracks[existingIndex].defaultVoiceId,
        };
      } else {
        nextTracks.push(splitTrack);
      }
    }
    const cleanedNextTracks = nextTracks.filter(track => track.id !== SPLIT_AMBIENCE_TRACK_ID);
    tracksRef.current = cleanedNextTracks;
    setTracks(cleanedNextTracks);

    const sourceStart = normalizeOptionalTime(sourceClip.startTime) ?? 0;
    const sourceDuration = normalizePositiveNumber(sourceClip.duration, safeDuration);
    const sourceEnd = sourceStart + sourceDuration;
    const sourceDubbingCues = getSplitSourceDubbingCues(sourceClip, existingTracks);
    const vocalSegmentAudioById = new Map(
      (separationResult?.vocalSegments || [])
        .filter(segment => segment?.id && segment.audioUrl)
        .map(segment => [segment.id, segment]),
    );
    const splitVocalClips: TimelineClip[] = sourceDubbingCues.length > 0
      ? sourceDubbingCues.map((cue, index) => {
        const cueStart = Math.max(
          sourceStart,
          normalizeOptionalTime(cue.subtitleStartTime) ?? normalizeOptionalTime(cue.startTime) ?? sourceStart,
        );
        const cueEnd = Math.min(
          sourceEnd,
          normalizeOptionalTime(cue.subtitleEndTime) ?? cueStart + normalizePositiveNumber(cue.duration, 1),
        );
        const safeCueDuration = Math.max(0.05, cueEnd - cueStart);
        const subtitleStartTime = normalizeOptionalTime(cue.subtitleStartTime) ?? cueStart;
        const subtitleEndTime = normalizeOptionalTime(cue.subtitleEndTime) ?? cueStart + safeCueDuration;
        const segmentId = `clip-split-vocal-${index + 1}`;
        const segmentAudio = vocalSegmentAudioById.get(segmentId);
        return {
          id: segmentId,
          trackId: SPLIT_VOCAL_TRACK_ID,
          origin: 'manual',
          name: `拆分台词 ${index + 1}`,
          prompt: `Separated dialogue cue from source video audio: ${cue.text?.trim() || cue.prompt}`,
          text: cue.text,
          voiceId: DEFAULT_DUBBING_VOICE_ID,
          startTime: cueStart,
          duration: safeCueDuration,
          volume: DEFAULT_VOLUME_FADER,
          audioUrl: segmentAudio?.audioUrl,
          audioSource: segmentAudio?.audioUrl ? 'uploaded' : undefined,
          speed: 1,
          autoSpeed: 1,
          sourceAudioDuration: segmentAudio?.sourceAudioDuration ?? safeCueDuration,
          subtitleId: cue.subtitleId || `split-subtitle-${index + 1}`,
          subtitleStartTime,
          subtitleEndTime,
          lipStartTime: normalizeOptionalTime(cue.lipStartTime) ?? subtitleStartTime,
          lipEndTime: normalizeOptionalTime(cue.lipEndTime) ?? subtitleEndTime,
          lipSyncConfidence: normalizeUnitVolume(cue.lipSyncConfidence, 0),
          timingSource: cue.timingSource || 'split-from-dubbing-cue',
          voiceDirty: false,
          timingDirty: false,
        };
      })
      : [
        {
          id: SPLIT_VOCAL_CLIP_ID,
          trackId: SPLIT_VOCAL_TRACK_ID,
          origin: 'manual',
          name: '拆分人声 / 台词（待识别）',
          prompt: 'Separated dialogue and vocal stem from source video audio',
          text: '等待台词识别后生成可编辑短句',
          startTime: sourceStart,
          duration: sourceDuration,
          volume: DEFAULT_VOLUME_FADER,
          audioUrl: vocalSegmentAudioById.get(SPLIT_VOCAL_CLIP_ID)?.audioUrl,
          audioSource: vocalSegmentAudioById.get(SPLIT_VOCAL_CLIP_ID)?.audioUrl ? 'uploaded' : undefined,
          speed: 1,
          autoSpeed: 1,
          sourceAudioDuration: vocalSegmentAudioById.get(SPLIT_VOCAL_CLIP_ID)?.sourceAudioDuration ?? sourceDuration,
          subtitleStartTime: sourceStart,
          subtitleEndTime: sourceEnd,
          lipStartTime: sourceStart,
          lipEndTime: sourceEnd,
          lipSyncConfidence: 0,
          timingSource: 'split-pending',
          voiceDirty: false,
          timingDirty: false,
        },
      ];
    const splitClipDefinitions: TimelineClip[] = [
      ...splitVocalClips,
      {
        id: SPLIT_MUSIC_CLIP_ID,
        trackId: SPLIT_MUSIC_TRACK_ID,
        origin: 'manual',
        name: '拆分音乐（待生成）',
        prompt: 'Separated background music stem from source video audio',
        startTime: sourceStart,
        duration: sourceDuration,
        volume: DEFAULT_VOLUME_FADER,
        audioUrl: separationResult?.stems?.musicUrl,
        audioSource: separationResult?.stems?.musicUrl ? 'uploaded' : undefined,
        speed: 1,
        autoSpeed: 1,
        sourceAudioDuration: sourceDuration,
        voiceDirty: false,
        timingDirty: false,
      },
    ];

    const splitClipIds = new Set(splitClipDefinitions.map(clip => clip.id));
    setClips(prev => {
      const preservedClips = prev.filter(clip => (
        !splitClipIds.has(clip.id)
        && clip.trackId !== SPLIT_VOCAL_TRACK_ID
        && clip.trackId !== SPLIT_MUSIC_TRACK_ID
        && clip.trackId !== SPLIT_AMBIENCE_TRACK_ID
      ));
      return [...preservedClips, ...splitClipDefinitions].sort((a, b) => (
        a.startTime - b.startTime || a.trackId.localeCompare(b.trackId)
      ));
    });
    splitClipDefinitions.forEach(clip => {
      if (clip.audioUrl) {
        replaceCachedClipAudio(
          clip.id,
          clip.audioUrl,
          clip.volume,
          getEffectiveClipSpeed(clip),
          clip.trackId,
        );
      }
    });
    const firstVocalClip = splitVocalClips[0];
    if (firstVocalClip) {
      setSelectedTrackId(SPLIT_VOCAL_TRACK_ID);
      setSelectedClipId(firstVocalClip.id);
      setSelectedClipIds([firstVocalClip.id]);
    }
    invalidateTrackOutputs('dubbing');
    invalidateTrackOutputs('bgm');
    Object.keys(audioInstancesRef.current).forEach(clipId => {
      const cachedClip = clipsRef.current.find(clip => clip.id === clipId);
      if (cachedClip?.trackId === SPLIT_AMBIENCE_TRACK_ID) {
        audioInstancesRef.current[clipId].pause();
        disconnectClipAudioRouting(clipId);
        delete audioInstancesRef.current[clipId];
      }
    });
  };

  const selectedClip = clips.find(c => c.id === selectedClipId);
  const selectedTrack = tracks.find(track => track.id === selectedTrackId);
  const selectedClipTrack = selectedClip
    ? tracks.find(track => track.id === selectedClip.trackId)
    : undefined;
  const selectedClipIsOriginalAudio = selectedClipTrack?.type === 'original';
  const hasOriginalAudioClip = clips.some(clip => (
    clip.trackId === ORIGINAL_AUDIO_TRACK_ID && Boolean(clip.audioUrl)
  ));
  const isTrackVolumeLocked = isMixing
    || isExportingMixed
    || isExportingBgm
    || isExportingSfx
    || isExportingDubbing;
  const selectedTrackVoiceId = selectedTrack?.type === 'dubbing'
    ? selectedTrack.defaultVoiceId || DEFAULT_DUBBING_VOICE_ID
    : undefined;
  const selectedTrackVoice = selectedTrackVoiceId
    ? displayVoices.find(voice => voice.id === selectedTrackVoiceId)
    : undefined;
  const similarVoiceRecommendationById = new Map<string, SimilarVoiceRecommendation>(
    similarVoiceRecommendations.map(recommendation => [recommendation.voiceId, recommendation]),
  );
  const filteredVoiceOptions = displayVoices.filter(voice => {
    if (similarVoiceRecommendations.length > 0 && !similarVoiceRecommendationById.has(voice.id)) return false;
    if (voiceActiveCategory !== '全部' && voice.category !== voiceActiveCategory) return false;
    if (voiceGenderFilter !== 'all' && voice.gender !== voiceGenderFilter) return false;
    const query = voiceSearchQuery.trim().toLowerCase();
    if (!query) return true;
    return voice.name.toLowerCase().includes(query)
      || voice.englishName.toLowerCase().includes(query)
      || voice.category.toLowerCase().includes(query)
      || voice.description.toLowerCase().includes(query)
      || voice.tags.some(tag => tag.toLowerCase().includes(query));
  }).sort((left, right) => {
    if (similarVoiceRecommendations.length === 0) return 0;
    return (similarVoiceRecommendationById.get(right.id)?.score || 0)
      - (similarVoiceRecommendationById.get(left.id)?.score || 0);
  });

  const getOrCreateSplitDubbingEditTrack = () => {
    const existingTrack = tracksRef.current.find(track => track.id === SPLIT_DUBBING_EDIT_TRACK_ID);
    if (existingTrack) return existingTrack;

    const baseDubbingTrack = tracksRef.current.find(track => track.id === 'dubbing')
      || tracksRef.current.find(track => (
        track.type === 'dubbing'
        && track.id !== SPLIT_VOCAL_TRACK_ID
        && track.id !== SPLIT_DUBBING_EDIT_TRACK_ID
      ));
    const nextTrack: SoundtrackTrack = {
      id: SPLIT_DUBBING_EDIT_TRACK_ID,
      name: '可编辑配音片段',
      type: 'dubbing',
      volume: DEFAULT_VOLUME_FADER,
      isMuted: false,
      isSoloed: false,
      defaultVoiceId: baseDubbingTrack?.defaultVoiceId || DEFAULT_DUBBING_VOICE_ID,
    };
    const nextTracks = [...tracksRef.current, nextTrack];
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    return nextTrack;
  };

  const handleSelectTrack = (trackId: string) => {
    stopVoicePreview();
    setSimilarVoiceRecommendations([]);
    setSimilarVoiceSourceDescription('');
    setSelectedTrackId(trackId);
    setSelectedClipId(null);
    setSelectedClipIds([]);
  };

  const handleSelectClip = (clipId: string, additive = false) => {
    stopVoicePreview();
    setSimilarVoiceRecommendations([]);
    setSimilarVoiceSourceDescription('');
    setSelectedClipId(clipId);
    setSelectedClipIds(prev => {
      if (!additive) return [clipId];
      if (prev.includes(clipId)) {
        const next = prev.filter(id => id !== clipId);
        return next.length > 0 ? next : [clipId];
      }
      return [...prev, clipId].slice(-2);
    });
    setSelectedTrackId(null);
  };

  const updateTrackName = (trackId: string, name: string) => {
    setTracks(prev => prev.map(track => track.id === trackId ? { ...track, name } : track));
  };

  const updateTrackVolume = (trackId: string, value: number) => {
    const volume = normalizeUnitVolume(value, DEFAULT_VOLUME_FADER);
    const currentTrack = tracksRef.current.find(track => track.id === trackId);
    if (!currentTrack || currentTrack.volume === volume) return;

    const nextTracks = tracksRef.current.map(track => (
      track.id === trackId ? { ...track, volume } : track
    ));
    tracksRef.current = nextTracks;
    setTracks(nextTracks);

    clips.forEach(clip => {
      if (clip.trackId !== trackId) return;
      const audio = audioInstancesRef.current[clip.id];
      if (audio) {
        setClipPlaybackGain(clip.id, audio, getEffectiveClipVolume(clip, nextTracks));
      }
    });

    invalidateTrackOutputs(currentTrack.type);
  };

  const getRecommendedEnhancementPreset = (trackType?: SoundtrackTrackType): TimelineClip['audioEnhancementPreset'] => {
    if (trackType === 'dubbing') return 'voice_clean';
    if (trackType === 'sfx') return 'sfx_punch';
    if (trackType === 'bgm') return 'bgm_bed';
    return 'none';
  };

  const handleApplyClipAudioPreset = (
    clipId: string,
    preset: TimelineClip['audioEnhancementPreset'],
    options?: { fadeIn?: number; fadeOut?: number; volume?: number },
  ) => {
    const targetClip = clipsRef.current.find(clip => clip.id === clipId);
    if (!targetClip || isOriginalAudioClip(targetClip)) return;
    const targetTrack = tracksRef.current.find(track => track.id === targetClip.trackId);
    pushUndoSnapshot('应用片段声音处理');
    const nextClips = clipsRef.current.map(clip => {
      if (clip.id !== clipId) return clip;
      const nextDuration = normalizePositiveNumber(clip.duration, 0);
      return {
        ...clip,
        audioEnhancementPreset: preset || 'none',
        fadeIn: options?.fadeIn !== undefined ? normalizeClipFade(options.fadeIn, nextDuration) : clip.fadeIn,
        fadeOut: options?.fadeOut !== undefined ? normalizeClipFade(options.fadeOut, nextDuration) : clip.fadeOut,
        volume: options?.volume !== undefined ? normalizeUnitVolume(options.volume, clip.volume) : clip.volume,
      };
    });
    clipsRef.current = nextClips;
    setClips(nextClips);
    const updatedClip = nextClips.find(clip => clip.id === clipId);
    const audio = audioInstancesRef.current[clipId];
    if (audio && updatedClip) {
      setClipPlaybackGain(clipId, audio, getEffectiveClipVolume(updatedClip, tracksRef.current));
    }
    if (targetTrack) invalidateTrackOutputs(targetTrack.type);
    setToast({
      message: `已应用声音处理：${getAudioEnhancementPresetLabel(preset)}`,
      type: 'success',
    });
    window.setTimeout(() => setToast(null), 2_500);
  };

  const handleApplyMixAssistantPreset = (preset: 'voice_first' | 'clean_master') => {
    pushUndoSnapshot('应用自动混音预设');
    const nextTracks = tracksRef.current.map(track => {
      if (preset === 'voice_first') {
        if (track.type === 'dubbing') return { ...track, volume: 1 };
        if (track.type === 'bgm') return { ...track, volume: 0.32 };
        if (track.type === 'sfx') return { ...track, volume: 0.78 };
      } else if (preset === 'clean_master') {
        if (track.type === 'dubbing') return { ...track, volume: 0.9 };
        if (track.type === 'bgm') return { ...track, volume: 0.28 };
        if (track.type === 'sfx') return { ...track, volume: 0.72 };
      }
      return track;
    });

    const nextTrackById = new Map<string, SoundtrackTrack>(nextTracks.map(track => [track.id, track]));
    const nextClips = clipsRef.current.map(clip => {
      if (isOriginalAudioClip(clip)) return clip;
      const track = nextTrackById.get(clip.trackId);
      const clipDuration = normalizePositiveNumber(clip.duration, 0);
      const presetForTrack = getRecommendedEnhancementPreset(track?.type);
      const isBgm = track?.type === 'bgm';
      const isSfx = track?.type === 'sfx';
      const smartFade = isBgm
        ? Math.min(1.2, clipDuration / 4)
        : isSfx
          ? Math.min(0.08, clipDuration / 6)
          : Math.min(0.04, clipDuration / 8);
      return {
        ...clip,
        audioEnhancementPreset: clip.audioEnhancementPreset && clip.audioEnhancementPreset !== 'none'
          ? clip.audioEnhancementPreset
          : presetForTrack,
        fadeIn: normalizeClipFade(clip.fadeIn || smartFade, clipDuration),
        fadeOut: normalizeClipFade(clip.fadeOut || smartFade, clipDuration),
      };
    });

    tracksRef.current = nextTracks;
    clipsRef.current = nextClips;
    setTracks(nextTracks);
    setClips(nextClips);
    Object.entries(audioInstancesRef.current).forEach(([clipId, audio]: [string, HTMLAudioElement]) => {
      const clip = nextClips.find(item => item.id === clipId);
      if (clip) setClipPlaybackGain(clipId, audio, getEffectiveClipVolume(clip, nextTracks));
    });
    invalidateTrackOutputs('bgm');
    invalidateTrackOutputs('sfx');
    invalidateTrackOutputs('dubbing');
    invalidateTrackOutputs('original');
    setToast({
      message: preset === 'voice_first'
        ? '已应用“人声优先”混音：BGM 自动压低，人声更靠前。'
        : '已应用“干净母版”混音：峰值更安全，层次更稳。',
      type: 'success',
    });
    window.setTimeout(() => setToast(null), 3_000);
  };

  const handleTrackVoiceChange = (trackId: string, voiceId: string) => {
    const track = tracks.find(item => item.id === trackId);
    if (
      !track
      || track.type !== 'dubbing'
      || (track.defaultVoiceId || DEFAULT_DUBBING_VOICE_ID) === voiceId
    ) return;

    const affectedClips = clips.filter(clip => clip.trackId === trackId);
    const staleGeneratedCount = affectedClips.filter(
      clip => isGeneratedVoiceStale(clip, voiceId),
    ).length;
    stopVoicePreview();
    setTracks(prev => {
      const nextTracks = prev.map(item => item.id === trackId
        ? { ...item, defaultVoiceId: voiceId }
        : item);
      tracksRef.current = nextTracks;
      return nextTracks;
    });
    setClips(prev => prev.map(clip => {
      if (clip.trackId !== trackId) return clip;
      const audioSource = resolveClipAudioSource(clip);
      if (clip.audioUrl && audioSource === 'generated') {
        return {
          ...clip,
          audioSource,
          voiceDirty: isGeneratedVoiceStale({ ...clip, audioSource }, voiceId),
        };
      }
      return { ...clip, audioSource, voiceId, voiceDirty: false };
    }));

    if (staleGeneratedCount > 0) {
      invalidateTrackOutputs('dubbing');
    }

    setToast({
      message: staleGeneratedCount > 0
        ? `已将“${track.name}”的默认声音应用到 ${affectedClips.length} 个片段；其中 ${staleGeneratedCount} 个已生成片段需要重新合成。`
        : `已将“${track.name}”的默认声音应用到本轨全部 ${affectedClips.length} 个片段。`,
      type: staleGeneratedCount > 0 ? 'info' : 'success',
    });
    window.setTimeout(() => setToast(null), 4_000);
  };

  // Clean up all playing audios when component unmounts
  useEffect(() => {
    return () => {
      analysisAbortRef.current?.abort('user');
      (Object.values(exportControllersRef.current) as AbortController[]).forEach(controller => controller.abort());
      (Object.values(audioInstancesRef.current) as HTMLAudioElement[]).forEach(audio => {
        try {
          audio.pause();
        } catch (e) {
          console.warn(e);
        }
      });
    };
  }, []);

  // Clean up local object URL when videoFile changes or unmounts
  useEffect(() => {
    const currentUrl = videoFile?.url;
    return () => {
      if (currentUrl && currentUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(currentUrl);
        } catch (e) {
          console.error('Failed to revoke object URL:', e);
        }
      }
    };
  }, [videoFile?.url]);

  // Helper to safely set currentTime on media elements without throwing DOMExceptions
  const setMediaTimeSafely = (media: HTMLMediaElement | null, time: number) => {
    if (!media) return;
    try {
      // Check readyState (must be > 0: HAVE_METADATA, HAVE_CURRENT_DATA, HAVE_FUTURE_DATA, HAVE_ENOUGH_DATA)
      if (media.readyState > 0 && isFinite(time) && !isNaN(time) && time >= 0) {
        media.currentTime = time;
      }
    } catch (e) {
      console.warn('Failed to set media currentTime safely:', e);
    }
  };

  // Sync play/pause of audio clips with video state
  useEffect(() => {
    const hasActiveSolo = tracks.some(t => t.isSoloed);
    const isTrackPlayable = (trackId: string) => {
      const track = tracks.find(t => t.id === trackId);
      if (!track) return true;
      if (track.isMuted) return false;
      if (hasActiveSolo) {
        return track.isSoloed;
      }
      return true;
    };

    if (isPlaying) {
      clips.forEach(clip => {
        if (!clip.audioUrl) return;
        
        let audio = audioInstancesRef.current[clip.id];
        if (!audio) {
          audio = new Audio(clip.audioUrl);
          preserveAudioPitch(audio);
          audioInstancesRef.current[clip.id] = audio;
        }
        
        // Configure loops
        if (clip.trackId === 'bgm') {
          audio.loop = true;
        } else {
          audio.loop = false;
        }

        setClipPlaybackGain(clip.id, audio, getEffectiveClipVolume(clip, tracks));
        const clipSpeed = getEffectiveClipSpeed(clip);
        audio.playbackRate = clipSpeed;
        const offset = currentTime - clip.startTime;
        const sourceOffset = getClipSourceOffset(clip);
        
        // Determine maximum playable duration for non-BGM clips (e.g. dubbing/sfx shouldn't loop/replay)
        let maxPlayableDuration = clip.duration;
        if (clip.trackId !== 'bgm' && audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
          maxPlayableDuration = Math.min(clip.duration, Math.max(0, audio.duration - sourceOffset) / clipSpeed);
        }

        if (offset >= 0 && offset < maxPlayableDuration && isTrackPlayable(clip.trackId)) {
          // Clip should be playing
          const expectedAudioTime = sourceOffset + offset * clipSpeed;
          if (audio.paused) {
            setMediaTimeSafely(audio, expectedAudioTime);
            resumeAudioContextForPlayback();
            audio.play().catch(e => console.log('Audio play blocked:', e));
          } else {
            // Adjust current time if it drifts by more than 0.2s
            if (Math.abs(audio.currentTime - expectedAudioTime) > 0.2) {
              setMediaTimeSafely(audio, expectedAudioTime);
            }
          }
        } else {
          // Clip should not be playing (or has naturally finished)
          if (!audio.paused) {
            audio.pause();
          }
        }
      });
    } else {
      // Pause all audios when video is paused
      (Object.values(audioInstancesRef.current) as HTMLAudioElement[]).forEach(audio => {
        if (!audio.paused) {
          audio.pause();
        }
      });
    }
  }, [isPlaying, clips, tracks, currentTime]);

  // Fallback playback timer when video is not available or has failed to load
  useEffect(() => {
    if (!isPlaying) return;

    // Check if the video is actually playing and driving time updates
    const isVideoFunctional = videoFile && !videoLoadFailed && videoRef.current;
    
    if (isVideoFunctional) {
      // Let the video element drive the updates
      return;
    }

    // Fallback timer
    let lastTime = performance.now();
    let animationFrameId: number;

    const tick = () => {
      const now = performance.now();
      const elapsed = (now - lastTime) / 1000;
      lastTime = now;

      setCurrentTime(prevTime => {
        const nextTime = prevTime + elapsed;
        if (nextTime >= safeDuration) {
          setIsPlaying(false);
          return 0;
        }
        return nextTime;
      });

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, videoFile, videoLoadFailed, safeDuration]);

  // Track playback time update
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;
    setCurrentTime(t);

    const hasActiveSolo = tracks.some(t => t.isSoloed);
    const isTrackPlayable = (trackId: string) => {
      const track = tracks.find(t => t.id === trackId);
      if (!track) return true;
      if (track.isMuted) return false;
      if (hasActiveSolo) {
        return track.isSoloed;
      }
      return true;
    };

    // Sync audios that should stop or start precisely during timeupdate
    clips.forEach(clip => {
      if (!clip.audioUrl) return;
      const audio = audioInstancesRef.current[clip.id];
      if (!audio) return;

      const offset = t - clip.startTime;
      const clipSpeed = getEffectiveClipSpeed(clip);
      const sourceOffset = getClipSourceOffset(clip);
      
      let maxPlayableDuration = clip.duration;
      if (clip.trackId !== 'bgm' && audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        maxPlayableDuration = Math.min(clip.duration, Math.max(0, audio.duration - sourceOffset) / clipSpeed);
      }

      if (offset >= 0 && offset < maxPlayableDuration && isTrackPlayable(clip.trackId)) {
        if (isPlaying && audio.paused) {
          setMediaTimeSafely(audio, sourceOffset + offset * clipSpeed);
          setClipPlaybackGain(clip.id, audio, getEffectiveClipVolume(clip, tracks));
          audio.playbackRate = clipSpeed;
          resumeAudioContextForPlayback();
          audio.play().catch(e => console.log('Audio sync play failed:', e));
        }
      } else {
        if (!audio.paused) {
          audio.pause();
        }
      }
    });
  };

  const stopPlayback = (resetToStart = true) => {
    videoRef.current?.pause();
    (Object.values(audioInstancesRef.current) as HTMLAudioElement[]).forEach(audio => {
      audio.pause();
      if (resetToStart) setMediaTimeSafely(audio, 0);
    });
    setIsPlaying(false);
    if (resetToStart) {
      setCurrentTime(0);
      setMediaTimeSafely(videoRef.current, 0);
    }
  };

  const handleReturnHome = () => {
    stopPlayback(true);
    stopVoicePreview();
    analysisAbortRef.current?.abort('user');
    cancelExportJobs();
    setIsProjectActive(false);
  };

  const togglePlay = () => {
    const isVideoFunctional = videoRef.current && !videoLoadFailed;
    if (isPlaying) {
      stopPlayback(false);
    } else {
      // Loop back if at the end
      if (currentTime >= safeDuration) {
        setCurrentTime(0);
        if (isVideoFunctional) {
          setMediaTimeSafely(videoRef.current!, 0);
        }
      }
      if (isVideoFunctional) {
        videoRef.current?.play()
          .then(() => setIsPlaying(true))
          .catch(e => {
            console.error(e);
            setError('浏览器未能开始播放视频，请再次点击播放。');
          });
      } else {
        setIsPlaying(true);
      }
    }
  };

  // Copy/Paste and Playback keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const isCopy = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c';
      const isPaste = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v';
      const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z';
      const isMoveClipUp = e.altKey && e.key === 'ArrowUp';
      const isMoveClipDown = e.altKey && e.key === 'ArrowDown';
      const isSplitClip = !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 's';
      const isMergeClip = !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'j';
      const isSpace = e.code === 'Space' || e.key === ' ';

      if (isUndo) {
        e.preventDefault();
        handleUndoTimelineEdit();
      } else if (isMoveClipUp || isMoveClipDown) {
        if (selectedClipId) {
          e.preventDefault();
          moveClipToAdjacentTrack(selectedClipId, isMoveClipUp ? 'up' : 'down');
        }
      } else if (isCopy) {
        if (selectedClipId) {
          const clip = clips.find(c => c.id === selectedClipId);
          if (clip) {
            e.preventDefault();
            handleCopyClip(clip);
          }
        }
      } else if (isPaste) {
        e.preventDefault();
        handlePasteClip();
      } else if (isSplitClip) {
        if (selectedClipId) {
          e.preventDefault();
          handleSplitSelectedClipAtPlayhead();
        }
      } else if (isMergeClip) {
        if (selectedClipId) {
          e.preventDefault();
          handleMergeSelectedClipWithAdjacent();
        }
      } else if (isSpace) {
        e.preventDefault();
        togglePlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedClipId, selectedClipIds, clips, copiedClip, currentTime, safeDuration, isPlaying, videoLoadFailed, togglePlay, undoStack]);

  const handleVideoLoaded = () => {
    if (videoRef.current) {
      const d = videoRef.current.duration;
      if (typeof d === 'number' && !isNaN(d) && isFinite(d) && d > 0) {
        setVideoDuration(d);
        updateOriginalAudioClipDuration(d);
      } else {
        setVideoDuration(30);
      }
    }
  };

  // Automatic fallback in case the local object URL fails inside iframe sandbox
  const handleVideoError = () => {
    if (videoFile && videoFile.url.startsWith('blob:')) {
      console.warn('Blob URL playback failed, falling back to server URL.');
      upsertOriginalAudioTrack(videoFile.name, `/uploads/${videoFile.name}`, videoDuration);
      setVideoFile({
        name: videoFile.name,
        url: `/uploads/${videoFile.name}`,
        isUploaded: videoFile.isUploaded
      });
    } else {
      console.warn('Video element error - both local blob and server URL are inaccessible.');
      setVideoLoadFailed(true);
    }
  };

  const validateVideoFile = (file: File) => {
    const hasVideoType = file.type.startsWith('video/');
    const hasVideoExtension = /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name);
    let message = '';

    if (!hasVideoType && !hasVideoExtension) {
      message = '请选择有效的视频文件。';
    } else if (file.size <= 0) {
      message = '视频文件为空，请重新选择。';
    } else if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      message = '视频超过 100MB 上限，请压缩或裁剪后重新上传。';
    }

    if (!message) return true;

    setError(message);
    setToast({ message, type: 'error' });
    window.setTimeout(() => setToast(null), 3_000);
    return false;
  };

  // Upload video via chunked uploads with a progress tracker (instant local playback, background sync with fallback to single upload)
  const uploadVideoFile = (file: File) => {
    if (!validateVideoFile(file)) return;

    setVideoLoadFailed(false);
    setSelectedFile(file);
    setIsUploading(true);
    setUploadProgress(0);
    setIsUploadingToServer(true);
    setError(null);
    cancelExportJobs();
    setMixedVideoUrl(null);
    setExportedMixedUrl(null);
    setExportedStemsUrl(null);
    setExportedBgmUrl(null);
    setExportedSfxUrl(null);
    setExportedDubbingUrl(null);

    // Pause and clean up any playing audio instances from previous session
    (Object.values(audioInstancesRef.current) as HTMLAudioElement[]).forEach(audio => {
      try {
        audio.pause();
      } catch (e) {
        console.warn('Error pausing audio:', e);
      }
    });
    audioInstancesRef.current = {};
    setClips([]);

    // 1. Instantly load locally using object URL for seamless, lag-free user experience
    let localUrl = '';
    try {
      localUrl = URL.createObjectURL(file);
    } catch (e) {
      console.error('Failed to create local Object URL:', e);
    }

    setVideoFile({
      name: file.name,
      url: localUrl,
      isUploaded: false
    });
    upsertOriginalAudioTrack(file.name, localUrl, safeDuration);
    setCurrentTime(0);
    setIsPlaying(false);

    // 2. Perform chunked upload to bypass proxy and server size limits
    const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const fileName = file.name;

    let currentChunk = 0;

    const uploadNextChunk = () => {
      if (currentChunk >= totalChunks) return;

      const start = currentChunk * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/sfx/upload-chunk', true);

      // Track individual chunk upload progress to make progress bar smoother
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const chunkProgress = event.loaded / event.total;
          const totalProgress = Math.round(((currentChunk + chunkProgress) / totalChunks) * 100);
          setUploadProgress(Math.min(99, totalProgress));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.completed) {
              // Entire file uploaded and assembled successfully!
              setUploadProgress(100);
              setIsUploadingToServer(false);
              setIsUploading(false);
              upsertOriginalAudioTrack(data.fileName, `/uploads/${data.fileName}`, videoDuration);
              setVideoFile(prev => {
                if (!prev) return null;
                return {
                  ...prev,
                  name: data.fileName, // Map to server's unique safe filename for API calls
                  isUploaded: true
                };
              });
              setToast({
                message: '视频文件已成功同步到服务器！',
                type: 'success'
              });
              setTimeout(() => setToast(null), 3000);
            } else {
              // Proceed to next chunk
              currentChunk++;
              const percent = Math.round((currentChunk / totalChunks) * 100);
              setUploadProgress(percent);
              uploadNextChunk();
            }
          } catch (e) {
            console.error('Failed to parse chunk upload response:', e);
            fallbackToSingleUpload();
          }
        } else {
          console.warn(`Chunk upload failed on chunk ${currentChunk}. Falling back to single-request upload...`);
          fallbackToSingleUpload();
        }
      };

      xhr.onerror = () => {
        console.warn(`XHR network error during chunk ${currentChunk} upload. Falling back to single-request upload...`);
        fallbackToSingleUpload();
      };

      const formData = new FormData();
      formData.append('file', chunk, `${fileName}.chunk`);
      formData.append('chunkIndex', currentChunk.toString());
      formData.append('totalChunks', totalChunks.toString());
      formData.append('fileName', fileName);
      formData.append('uploadId', uploadId);

      xhr.send(formData);
    };

    // Fallback to standard upload if chunked upload fails or is not supported
    const fallbackToSingleUpload = () => {
      console.log('Initiating fallback standard upload...');
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/sfx/upload', true);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(percentComplete);
        }
      };

      xhr.onload = () => {
        setIsUploadingToServer(false);
        setIsUploading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            console.log('Fallback upload success:', data);
            upsertOriginalAudioTrack(data.fileName, `/uploads/${data.fileName}`, videoDuration);
            setVideoFile(prev => {
              if (!prev) return null;
              return {
                ...prev,
                name: data.fileName,
                isUploaded: true
              };
            });
            setToast({
              message: '视频文件已成功同步到服务器！',
              type: 'success'
            });
            setTimeout(() => setToast(null), 3000);
          } catch (e: any) {
            console.error('Failed to parse fallback response:', e);
            setError('服务器上传成功，但解析响应失败。AI 画面分析与 FFmpeg 混音可能不可用。');
          }
        } else {
          let errMsg = '视频上传服务器失败';
          try {
            const resJson = JSON.parse(xhr.responseText);
            errMsg = resJson.error || errMsg;
          } catch (e) {}
          setError(`视频已在本地加载：服务器上传未成功（${errMsg}）。由于网络传输受限，AI 分析及混音合成功能暂不可用，但您依然可以完美播放并手动设计、预览音轨。`);
        }
      };

      xhr.onerror = () => {
        setIsUploadingToServer(false);
        setIsUploading(false);
        setError('视频已在本地加载：网络连接失败，未成功同步到服务器。AI 画面多模态分析不可用，但您依然可以手动设计、预览音轨。');
      };

      const formData = new FormData();
      formData.append('file', file);
      xhr.send(formData);
    };

    // Start with chunked upload if file is larger than 1MB
    if (file.size > 1 * 1024 * 1024) {
      uploadNextChunk();
    } else {
      fallbackToSingleUpload();
    }
  };

  const relinkVideoFile = (file: File) => {
    if (!validateVideoFile(file)) return;

    setVideoLoadFailed(false);
    setSelectedFile(file);
    setIsUploading(true);
    setUploadProgress(0);
    setIsUploadingToServer(true);
    setError(null);
    invalidateMixedVideo();

    // Pause any playing audio instances
    (Object.values(audioInstancesRef.current) as HTMLAudioElement[]).forEach(audio => {
      try {
        audio.pause();
      } catch (e) {
        console.warn('Error pausing audio:', e);
      }
    });

    let localUrl = '';
    try {
      localUrl = URL.createObjectURL(file);
    } catch (e) {
      console.error('Failed to create local Object URL:', e);
    }

    setVideoFile({
      name: file.name,
      url: localUrl,
      isUploaded: false
    });
    upsertOriginalAudioTrack(file.name, localUrl, safeDuration);
    setCurrentTime(0);
    setIsPlaying(false);

    const CHUNK_SIZE = 2 * 1024 * 1024;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const fileName = file.name;

    let currentChunk = 0;

    const uploadNextChunk = () => {
      if (currentChunk >= totalChunks) return;

      const start = currentChunk * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/sfx/upload-chunk', true);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const chunkProgress = event.loaded / event.total;
          const totalProgress = Math.round(((currentChunk + chunkProgress) / totalChunks) * 100);
          setUploadProgress(Math.min(99, totalProgress));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.completed) {
              setUploadProgress(100);
              setIsUploadingToServer(false);
              setIsUploading(false);
              upsertOriginalAudioTrack(data.fileName, `/uploads/${data.fileName}`, videoDuration);
              setVideoFile(prev => {
                if (!prev) return null;
                return {
                  ...prev,
                  name: data.fileName,
                  isUploaded: true
                };
              });
              setToast({
                message: '关联视频文件已成功同步到服务器！',
                type: 'success'
              });
              setTimeout(() => setToast(null), 3000);
            } else {
              currentChunk++;
              const percent = Math.round((currentChunk / totalChunks) * 100);
              setUploadProgress(percent);
              uploadNextChunk();
            }
          } catch (e) {
            console.error('Failed to parse chunk upload response:', e);
            fallbackToSingleUpload();
          }
        } else {
          fallbackToSingleUpload();
        }
      };

      xhr.onerror = () => {
        fallbackToSingleUpload();
      };

      const formData = new FormData();
      formData.append('file', chunk, `${fileName}.chunk`);
      formData.append('chunkIndex', currentChunk.toString());
      formData.append('totalChunks', totalChunks.toString());
      formData.append('fileName', fileName);
      formData.append('uploadId', uploadId);

      xhr.send(formData);
    };

    const fallbackToSingleUpload = () => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/sfx/upload', true);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(percentComplete);
        }
      };

      xhr.onload = () => {
        setIsUploadingToServer(false);
        setIsUploading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            upsertOriginalAudioTrack(data.fileName, `/uploads/${data.fileName}`, videoDuration);
            setVideoFile(prev => {
              if (!prev) return null;
              return {
                ...prev,
                name: data.fileName,
                isUploaded: true
              };
            });
            setToast({
              message: '关联视频文件已成功同步到服务器！',
              type: 'success'
            });
            setTimeout(() => setToast(null), 3000);
          } catch (e: any) {
            setError('服务器上传成功，但解析响应失败。AI 画面分析与 FFmpeg 混音可能不可用。');
          }
        } else {
          let errMsg = '视频上传服务器失败';
          try {
            const resJson = JSON.parse(xhr.responseText);
            errMsg = resJson.error || errMsg;
          } catch (e) {}
          setError(`视频已在本地加载：服务器上传未成功（${errMsg}）。由于网络传输受限，AI 分析及混音合成功能暂不可用，但您依然可以完美播放并手动设计、预览音轨。`);
        }
      };

      xhr.onerror = () => {
        setIsUploadingToServer(false);
        setIsUploading(false);
        setError('视频已在本地加载：网络连接失败，未成功同步到服务器。AI 画面多模态分析不可用，但您依然可以手动设计、预览音轨。');
      };

      const formData = new FormData();
      formData.append('file', file);
      xhr.send(formData);
    };

    if (file.size > 1 * 1024 * 1024) {
      uploadNextChunk();
    } else {
      fallbackToSingleUpload();
    }
  };

  const handleVideoRelink = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await relinkVideoFile(file);
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await uploadVideoFile(file);
  };

  // Drag and drop events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = () => {
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await uploadVideoFile(file);
    }
  };

  // Call Gemini visual multimodal model to auto-create soundtrack timeline
  const handleAnalyzeVideo = async () => {
    if (!videoFile) return;

    const analysisBgmEnabled = bgmEnabled;
    const analysisSfxEnabled = sfxEnabled;
    const analysisDubbingEnabled = dubbingEnabled;
    const targetTrackIds = new Set<string>([
      ...(analysisBgmEnabled ? ['bgm'] : []),
      ...(analysisSfxEnabled ? ['sfx'] : []),
      ...(analysisDubbingEnabled ? ['dubbing'] : []),
    ]);
    if (targetTrackIds.size === 0) {
      setError('请至少启用一条需要 AI 规划的音轨。');
      return;
    }
    // React state updates are asynchronous, so use a ref as the authoritative
    // lock to prevent a rapid double click from starting duplicate AI jobs.
    if (analysisLockRef.current) {
      analysisAbortRef.current?.abort('user');
      return;
    }

    const controller = new AbortController();
    analysisLockRef.current = true;
    analysisAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort('timeout'), 240_000);
    setIsAnalyzing(true);
    setAnalysisStage('准备解析画面...');
    setError(null);
    try {
      let keyframes: any[] = [];
      let usingServerFallback = false;
      const usingFullVideoDubbingAnalysis = analysisDubbingEnabled;
      if (usingFullVideoDubbingAnalysis) {
        if (isUploadingToServer || !videoFile.isUploaded) {
          throw new Error('配音同步需要分析完整视频。请等待视频上传到服务器完成后再试。');
        }
        setAnalysisStage('正在分析完整视频中的字幕、对白与口型...');
      } else if (selectedFile) {
        try {
          setAnalysisStage('正在提取关键帧...');
          keyframes = await extractVideoKeyframes(selectedFile, {
            maxFrames: 6,
            maxDimension: 512,
            jpegQuality: 0.68,
            signal: controller.signal,
            onProgress: (completed, total) => {
              setAnalysisStage(`正在提取关键帧 ${completed}/${total}...`);
            },
          });
        } catch (kfErr) {
          if (controller.signal.aborted) throw kfErr;
          console.warn('Failed to extract keyframes client-side, falling back to server video:', kfErr);
        }
      }

      if (!usingFullVideoDubbingAnalysis && keyframes.length === 0) {
        // The server can extract fallback frames from its uploaded copy, but it
        // must never be asked to do so while the background upload is incomplete.
        if (isUploadingToServer || !videoFile.isUploaded) {
          throw new Error('浏览器未能提取关键帧，且视频仍未同步到服务器。请等待上传完成后再试，或转换为 H.264 编码的 MP4。');
        }
        usingServerFallback = true;
        setAnalysisStage('本地取帧不可用，正在由服务器重新提取画面...');
      } else if (!usingFullVideoDubbingAnalysis) {
        setAnalysisStage('AI 正在根据关键帧编排配乐与音效...');
      }

      const res = await fetch('/api/video/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          fileName: videoFile.name,
          keyframes: usingFullVideoDubbingAnalysis
            ? undefined
            : keyframes.length > 0 ? keyframes : undefined,
          videoDuration,
          bgmEnabled: analysisBgmEnabled,
          sfxEnabled: analysisSfxEnabled,
          dubbingEnabled: analysisDubbingEnabled,
          analysisMode: usingFullVideoDubbingAnalysis ? 'full-video-dubbing-sync' : 'keyframes',
          dubbingSyncMode: usingFullVideoDubbingAnalysis ? 'subtitle-and-lip' : undefined,
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '视频分析生成失败，请重试');
      }

      const data = await res.json();
      if (data.clips && Array.isArray(data.clips)) {
        setAnalysisStage('正在整理时间轴...');
        const analysisRunId = Date.now().toString(36);
        // Map default volume values
        const mappedClips: TimelineClip[] = data.clips
          .filter((clip: any) => targetTrackIds.has(String(clip.trackId || '')))
          .map((clip: any, clipIndex: number) => {
          const sourceClipId = String(clip.subtitleId || clip.id || '');
          const clipTrack = tracks.find(track => track.id === clip.trackId);
          const isDubbingClip = clipTrack?.type === 'dubbing';
          const clipStartTime = normalizeOptionalTime(clip.startTime) ?? 0;
          const clipDuration = normalizePositiveNumber(clip.duration, 3);
          const subtitleStartTime = normalizeOptionalTime(
            clip.subtitleStartTime ?? clip.subtitleStart,
          ) ?? clipStartTime;
          const subtitleEndTime = normalizeOptionalTime(
            clip.subtitleEndTime ?? clip.subtitleEnd,
          ) ?? subtitleStartTime + clipDuration;
          const timelineStartTime = isDubbingClip ? subtitleStartTime : clipStartTime;
          const timelineDuration = isDubbingClip
            ? Math.max(0.05, subtitleEndTime - subtitleStartTime)
            : clipDuration;
          return {
            ...clip,
            id: `clip-ai-${clip.trackId}-${analysisRunId}-${clipIndex}`,
            origin: 'ai' as const,
            startTime: timelineStartTime,
            duration: timelineDuration,
            voiceId: isDubbingClip
              ? clipTrack.defaultVoiceId || DEFAULT_DUBBING_VOICE_ID
              : clip.voiceId,
            speed: 1,
            autoSpeed: 1,
            sourceAudioDuration: undefined,
            speaker: isDubbingClip && typeof clip.speaker === 'string'
              ? clip.speaker.trim()
              : undefined,
            subtitleId: isDubbingClip
              ? sourceClipId
              : undefined,
            subtitleStartTime: isDubbingClip ? subtitleStartTime : undefined,
            subtitleEndTime: isDubbingClip ? subtitleEndTime : undefined,
            lipStartTime: isDubbingClip
              ? normalizeOptionalTime(clip.lipStartTime ?? clip.lipStart)
              : undefined,
            lipEndTime: isDubbingClip
              ? normalizeOptionalTime(clip.lipEndTime ?? clip.lipEnd)
              : undefined,
            lipSyncConfidence: isDubbingClip
              ? normalizeUnitVolume(clip.lipSyncConfidence ?? clip.syncConfidence, 0)
              : undefined,
            timingSource: isDubbingClip && typeof clip.timingSource === 'string'
              ? clip.timingSource
              : isDubbingClip ? 'full-video' : undefined,
            volume: DEFAULT_VOLUME_FADER,
            isGenerating: false,
            voiceDirty: false,
            timingDirty: false,
          };
        });
        if (mappedClips.length === 0) {
          const dubbingStatus = typeof data.dubbingStatus === 'string'
            ? data.dubbingStatus
            : '';
          if (usingFullVideoDubbingAnalysis && targetTrackIds.size === 1) {
            const message = dubbingStatus === 'unavailable'
              ? '完整视频字幕/口型分析暂时不可用，没有生成配音片段。你可以稍后重试，或先开启音乐/音效轨生成基础设计。'
              : 'AI分析完成，但没有识别到可拆成配音片段的台词/字幕。原视频轨已保留，可以换一个有清晰人声或字幕的视频再试。';
            setAnalysisStage(message);
            setToast({ message, type: 'info' });
            window.setTimeout(() => setToast(null), 4_000);
            return;
          }
          throw new Error('AI 未返回合适的时间轴配置，请重新尝试。');
        }

        const preservedOriginalAudioClips = clipsRef.current.filter(isOriginalAudioClip);
        const nextClips = [
          ...preservedOriginalAudioClips,
          ...mappedClips,
        ].sort((a, b) => (
          a.startTime - b.startTime || a.trackId.localeCompare(b.trackId)
        ));
        (Object.values(audioInstancesRef.current) as HTMLAudioElement[]).forEach((audio) => {
          audio.pause();
        });
        audioInstancesRef.current = {};
        cancelExportJobs();
        setClips(nextClips);
        setMixedVideoUrl(null);
        setExportedMixedUrl(null);
        setExportedStemsUrl(null);
        setExportedBgmUrl(null);
        setExportedSfxUrl(null);
        setExportedDubbingUrl(null);
        handleSelectClip(mappedClips[0].id);

        const analysisSource = typeof data.analysisSource === 'string'
          ? data.analysisSource.toLowerCase()
          : '';
        const dubbingCueCount = typeof data.dubbingCueCount === 'number'
          ? data.dubbingCueCount
          : mappedClips.filter((clip: TimelineClip) => (
            tracks.find(track => track.id === clip.trackId)?.type === 'dubbing'
          )).length;
        const dubbingStatus = typeof data.dubbingStatus === 'string'
          ? data.dubbingStatus
          : '';
        const usedNativeVideo = analysisSource === 'server-native-video';
        const usedServerFrames = analysisSource === 'server-ffmpeg';
        setToast({
          message: usingFullVideoDubbingAnalysis && dubbingCueCount === 0
            ? 'AI 分析完成，但没有识别到可配音字幕。'
            : usingFullVideoDubbingAnalysis
            ? 'AI 分析完成：已识别字幕、对白与口型，并按字幕逐句建立配音片段。'
            : usedNativeVideo
            ? 'AI 分析完成：系统已自动改用完整视频与原音轨完成分析。'
            : usedServerFrames || usingServerFallback
              ? 'AI 分析完成：系统已从服务器原视频重新提取画面。'
              : 'AI 分析完成：已使用本地关键帧快速编排时间轴。',
          type: usingFullVideoDubbingAnalysis && dubbingCueCount === 0
            ? 'info'
            : usingFullVideoDubbingAnalysis
            ? 'success'
            : usedNativeVideo || usedServerFrames || usingServerFallback ? 'info' : 'success',
        });
        window.setTimeout(() => setToast(null), 4_000);
      } else {
        throw new Error('AI 未返回合适的时间轴配置，请重新尝试。');
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        if (controller.signal.reason === 'timeout') {
          setError('画面解析超过 4 分钟，已自动停止。请缩短视频或稍后重试。');
        } else {
          // User cancellation is a neutral action, not a failed analysis.
          setError(null);
          setAnalysisStage('准备解析画面...');
        }
      } else {
        setError(err.message || '多模态智能分析出错');
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = null;
        analysisLockRef.current = false;
        setIsAnalyzing(false);
      }
    }
  };

  // Single timeline clip generator using ElevenLabs API on the server
  const handleGenerateAudioClip = async (clipId: string) => {
    const clip = clipsRef.current.find(c => c.id === clipId);
    if (!clip) return;
    if (clip.trackId === SPLIT_VOCAL_TRACK_ID) {
      const targetTrack = getOrCreateSplitDubbingEditTrack();
      const editableClipId = `clip-editable-from-${clip.id}`;
      const existingEditableClip = clipsRef.current.find(item => item.id === editableClipId);
      const editableClip: TimelineClip = {
        ...clip,
        ...existingEditableClip,
        id: editableClipId,
        trackId: targetTrack.id,
        name: existingEditableClip?.name || `${clip.name}（重配）`,
        prompt: clip.prompt,
        text: clip.text,
        voiceId: targetTrack.defaultVoiceId || existingEditableClip?.voiceId || DEFAULT_DUBBING_VOICE_ID,
        startTime: clip.startTime,
        duration: clip.duration,
        speaker: clip.speaker,
        subtitleId: clip.subtitleId,
        subtitleStartTime: clip.subtitleStartTime,
        subtitleEndTime: clip.subtitleEndTime,
        lipStartTime: clip.lipStartTime,
        lipEndTime: clip.lipEndTime,
        lipSyncConfidence: clip.lipSyncConfidence,
        timingSource: clip.timingSource || 'split-vocal-reference',
        audioUrl: existingEditableClip?.audioUrl,
        audioSource: existingEditableClip?.audioSource,
        sourceAudioDuration: existingEditableClip?.sourceAudioDuration,
        origin: 'ai',
        isGenerating: false,
        error: undefined,
        voiceDirty: false,
        timingDirty: false,
      };
      const nextClips = existingEditableClip
        ? clipsRef.current.map(item => item.id === editableClipId ? editableClip : item)
        : [...clipsRef.current, editableClip];
      clipsRef.current = nextClips;
      setClips(nextClips);
      setSelectedTrackId(null);
      setSelectedClipId(editableClipId);
      setSelectedClipIds([editableClipId]);
      setToast({
        message: '已保留拆分人声，并在“可编辑配音片段”轨生成新的配音片段。',
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 3_000);
      await handleGenerateAudioClip(editableClipId);
      return;
    }
    const generationTimingSignature = getDubbingTimingSignature(clip);

    // Update state to isGenerating
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, isGenerating: true, error: undefined } : c));

    try {
      const clipTrack = tracksRef.current.find(t => t.id === clip.trackId);
      const trackType = clipTrack ? clipTrack.type : undefined;
      const effectiveVoiceId = trackType === 'dubbing'
        ? clipTrack?.defaultVoiceId || DEFAULT_DUBBING_VOICE_ID
        : clip.voiceId;

      const res = await fetch('/api/video/generate-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: clip.prompt,
          trackId: clip.trackId,
          trackType: trackType,
          text: clip.text,
          voiceId: effectiveVoiceId,
          duration: clip.duration,
          targetDuration: clip.duration,
          subtitleStartTime: clip.subtitleStartTime,
          subtitleEndTime: clip.subtitleEndTime,
          lipStartTime: clip.lipStartTime,
          lipEndTime: clip.lipEndTime,
          lipSyncConfidence: clip.lipSyncConfidence,
          timingSource: clip.timingSource,
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'ElevenLabs 语音合成失败');
      }

      const data = await res.json();
      let sourceAudioDuration: number | undefined;
      let durationReadFailed = false;
      if (trackType === 'dubbing') {
        try {
          sourceAudioDuration = await getAudioDuration(data.audioUrl);
        } catch (durationError) {
          const serverDuration = normalizePositiveNumber(
            data.sourceAudioDuration ?? data.sourceDuration ?? data.naturalDuration,
            0,
          );
          if (serverDuration > 0) {
            sourceAudioDuration = serverDuration;
          } else {
            durationReadFailed = true;
          }
        }
      }
      const latestTrack = tracksRef.current.find(track => track.id === clip.trackId);
      const latestVoiceId = latestTrack?.type === 'dubbing'
        ? latestTrack.defaultVoiceId || DEFAULT_DUBBING_VOICE_ID
        : undefined;
      const voiceChangedDuringGeneration = trackType === 'dubbing'
        && latestVoiceId !== effectiveVoiceId;
      const latestClip = clipsRef.current.find(item => item.id === clipId) || clip;
      const timingChangedDuringGeneration = trackType === 'dubbing'
        && getDubbingTimingSignature(latestClip) !== generationTimingSignature;
      const nextAutoSpeed = trackType === 'dubbing'
        ? calculateDubbingAutoSpeed(sourceAudioDuration, latestClip.duration)
        : 1;
      const cachedClip: TimelineClip = {
        ...latestClip,
        audioUrl: data.audioUrl,
        audioSource: 'generated',
        sourceAudioDuration,
        autoSpeed: nextAutoSpeed,
        speed: normalizeManualSpeed(latestClip.speed),
        voiceId: trackType === 'dubbing' ? effectiveVoiceId : latestClip.voiceId,
        voiceDirty: voiceChangedDuringGeneration,
        timingDirty: trackType === 'dubbing'
          ? timingChangedDuringGeneration || durationReadFailed
          : false,
      };
      
      // Update clip with audio URL
      setClips(prev => prev.map(c => {
        if (c.id !== clipId) return c;
        const didTimingChange = trackType === 'dubbing'
          && getDubbingTimingSignature(c) !== generationTimingSignature;
        return {
          ...c,
          audioUrl: data.audioUrl,
          audioSource: 'generated',
          isGenerating: false,
          sourceAudioDuration,
          autoSpeed: trackType === 'dubbing'
            ? calculateDubbingAutoSpeed(sourceAudioDuration, c.duration)
            : 1,
          speed: normalizeManualSpeed(c.speed),
          voiceId: trackType === 'dubbing' ? effectiveVoiceId : c.voiceId,
          voiceDirty: voiceChangedDuringGeneration,
          timingDirty: trackType === 'dubbing'
            ? didTimingChange || durationReadFailed
            : false,
        };
      }));

      if (trackType) invalidateTrackOutputs(trackType);
      else invalidateMixedVideo();

      // Prefetch and cache Audio element
      replaceCachedClipAudio(
        clipId,
        data.audioUrl,
        latestClip.volume,
        getEffectiveClipSpeed(cachedClip),
        latestClip.trackId,
      );

      // Trigger success toast
      const displayTypeLabel = trackType === 'dubbing' ? '旁白配音' : trackType === 'bgm' ? '配乐BGM' : '专属音效';
      
      setToast({
        message: voiceChangedDuringGeneration
          ? `“${clip.name}”已完成合成，但轨道声音已在生成期间变更，请重新合成一次。`
          : timingChangedDuringGeneration
            ? `“${clip.name}”已完成合成，但台词或时间在生成期间发生变化，请重新合成。`
            : durationReadFailed
              ? `“${clip.name}”已完成合成，但未能读取自然时长，请重新合成或手动微调。`
              : trackType === 'dubbing'
                ? `“${clip.name}”已按 ${nextAutoSpeed.toFixed(2)}x 自动匹配字幕时长。`
                : `成功为“${clip.name}”合成 ${displayTypeLabel}！`,
        type: voiceChangedDuringGeneration || timingChangedDuringGeneration || durationReadFailed
          ? 'info'
          : 'success'
      });
      setTimeout(() => {
        setToast(current => current?.message.includes(clip.name) ? null : current);
      }, 3500);

    } catch (err: any) {
      setClips(prev => prev.map(c => c.id === clipId ? { 
        ...c, 
        isGenerating: false, 
        error: err.message 
      } : c));
      
      setToast({
        message: `“${clip.name}”合成失败：${err.message}`,
        type: 'error'
      });
      setTimeout(() => {
        setToast(current => current?.message.includes(clip.name) ? null : current);
      }, 4500);
    }
  };

  // Upload custom local audio file for a timeline clip
  const handleUploadClipAudio = async (clipId: string, file: File) => {
    const clip = clipsRef.current.find(c => c.id === clipId);
    if (!clip) return;
    const uploadTimingSignature = getDubbingTimingSignature(clip);

    // Update state to isGenerating (to show loading state on the UI)
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, isGenerating: true, error: undefined } : c));

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/sfx/upload', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '上传音频文件失败');
      }

      const data = await res.json();
      
      // Determine the exact duration of the uploaded audio file dynamically
      const audioUrl = data.url;
      const currentTrackType = tracksRef.current.find(track => track.id === clip.trackId)?.type;
      if (currentTrackType) invalidateTrackOutputs(currentTrackType);
      else invalidateMixedVideo();
      let sourceAudioDuration: number | undefined;
      let durationReadFailed = false;
      try {
        sourceAudioDuration = await getAudioDuration(audioUrl);
      } catch {
        durationReadFailed = true;
      }

      const latestClip = clipsRef.current.find(item => item.id === clipId) || clip;
      const timingChangedDuringUpload = currentTrackType === 'dubbing'
        && getDubbingTimingSignature(latestClip) !== uploadTimingSignature;
      const nextClip: TimelineClip = {
        ...latestClip,
        audioUrl,
        audioSource: 'uploaded',
        duration: currentTrackType === 'dubbing'
          ? latestClip.duration
          : normalizePositiveNumber(sourceAudioDuration, latestClip.duration),
        sourceAudioDuration: currentTrackType === 'dubbing'
          ? sourceAudioDuration
          : undefined,
        autoSpeed: currentTrackType === 'dubbing'
          ? calculateDubbingAutoSpeed(sourceAudioDuration, latestClip.duration)
          : 1,
        speed: normalizeManualSpeed(latestClip.speed),
        name: file.name.replace(/\.[^/.]+$/, ''),
        isGenerating: false,
        voiceDirty: false,
        timingDirty: currentTrackType === 'dubbing'
          ? timingChangedDuringUpload || durationReadFailed
          : false,
      };

      // Dubbing keeps the subtitle/lip slot; only BGM/SFX adopt the uploaded file duration.
      setClips(prev => prev.map(c => {
        if (c.id !== clipId) return c;
        const didTimingChange = currentTrackType === 'dubbing'
          && getDubbingTimingSignature(c) !== uploadTimingSignature;
        return {
          ...c,
          audioUrl,
          audioSource: 'uploaded',
          duration: currentTrackType === 'dubbing'
            ? c.duration
            : normalizePositiveNumber(sourceAudioDuration, c.duration),
          sourceAudioDuration: currentTrackType === 'dubbing'
            ? sourceAudioDuration
            : undefined,
          autoSpeed: currentTrackType === 'dubbing'
            ? calculateDubbingAutoSpeed(sourceAudioDuration, c.duration)
            : 1,
          speed: normalizeManualSpeed(c.speed),
          name: file.name.replace(/\.[^/.]+$/, ''),
          isGenerating: false,
          voiceDirty: false,
          timingDirty: currentTrackType === 'dubbing'
            ? didTimingChange || durationReadFailed
            : false,
        };
      }));

      replaceCachedClipAudio(
        clipId,
        audioUrl,
        latestClip.volume,
        getEffectiveClipSpeed(nextClip),
        latestClip.trackId,
      );

      setToast({
        message: durationReadFailed
          ? `已关联“${file.name}”，但未能读取自然时长，请手动微调配音语速。`
          : currentTrackType === 'dubbing'
            ? `已关联“${file.name}”，并按 ${nextClip.autoSpeed?.toFixed(2)}x 自动匹配字幕时长。`
            : `已成功上传并关联本地音频：“${file.name}” (${sourceAudioDuration?.toFixed(1)}秒)！`,
        type: durationReadFailed || timingChangedDuringUpload ? 'info' : 'success',
      });
      setTimeout(() => setToast(null), 3500);

    } catch (err: any) {
      setClips(prev => prev.map(c => c.id === clipId ? { 
        ...c, 
        isGenerating: false, 
        error: err.message 
      } : c));
      
      setToast({
        message: `“${clip.name}”音频上传失败：${err.message}`,
        type: 'error'
      });
      setTimeout(() => setToast(null), 4500);
    }
  };

  const showAudioRepairWorkflowToast = (message: string) => {
    setToast({ message, type: 'info' });
    window.setTimeout(() => setToast(null), 4_000);
  };

  const handleSplitOriginalAudioWorkflow = async () => {
    if (originalAudioSplitStatus === 'running') return;
    if (!videoFile) {
      setOriginalAudioSplitStatus('error');
      setOriginalAudioSplitStage('请先上传或重新关联一个视频。');
      setOriginalAudioSplitProgress(0);
      return;
    }
    if (isUploadingToServer || !videoFile.isUploaded) {
      setOriginalAudioSplitStatus('error');
      setOriginalAudioSplitStage('视频仍在同步到服务器，请等待上传完成后再拆分。');
      setOriginalAudioSplitProgress(0);
      return;
    }
    const sourceClip = selectedClip && isOriginalAudioClip(selectedClip)
      ? selectedClip
      : clipsRef.current.find(isOriginalAudioClip);
    if (!sourceClip) {
      setOriginalAudioSplitStatus('error');
      setOriginalAudioSplitStage('未找到可拆分的视频原声音频片段，请重新上传或关联视频。');
      setOriginalAudioSplitProgress(0);
      return;
    }

    const runId = originalAudioSplitRunRef.current + 1;
    originalAudioSplitRunRef.current = runId;
    setOriginalAudioSplitStatus('running');
    setOriginalAudioSplitProgress(8);
    setOriginalAudioSplitStage('准备读取视频原声音频...');
    setError(null);

    try {
      const vocalSegments = buildOriginalAudioSplitSegments(sourceClip);
      setOriginalAudioSplitProgress(18);
      setOriginalAudioSplitStage('正在准备台词片段与源视频音频范围...');

      const sourceStartTime = normalizeOptionalTime(sourceClip.startTime) ?? 0;
      const sourceDuration = normalizePositiveNumber(sourceClip.duration, safeDuration);
      setOriginalAudioSplitProgress(38);
      setOriginalAudioSplitStage('正在服务器提取原声并分离人声、音乐/伴奏...');

      const response = await fetch('/api/video/separate-original-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoFileName: videoFile.name,
          sourceStartTime,
          sourceDuration,
          vocalSegments,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || '视频原声音频拆分失败，请稍后重试。');
      }
      if (originalAudioSplitRunRef.current !== runId) return;

      setOriginalAudioSplitProgress(88);
      setOriginalAudioSplitStage('正在把拆分音频写入多轨并保留台词/口型属性...');
      upsertSplitResultTracksAndClips(sourceClip, data as OriginalAudioSeparationResult);

      setOriginalAudioSplitProgress(100);
      setOriginalAudioSplitStatus('completed');
      setOriginalAudioSplitStage('已生成可播放的人声、音乐/伴奏拆分音频，并已写入多轨。');
      showAudioRepairWorkflowToast(
        `已完成原声拆分：人声短句、音乐/伴奏都已绑定音频。${data.engine ? ` 引擎：${data.engine}` : ''}`,
      );
    } catch (err: any) {
      if (originalAudioSplitRunRef.current !== runId) return;
      setOriginalAudioSplitStatus('error');
      setOriginalAudioSplitProgress(0);
      setOriginalAudioSplitStage(err?.message || '视频原声音频拆分失败，请稍后重试。');
      setError(err?.message || '视频原声音频拆分失败，请稍后重试。');
    }
  };

  const handleMusicReplacementWorkflow = () => {
    showAudioRepairWorkflowToast('已放置“音乐替换分析”入口：下一步会同时分析画面和原音乐，生成替换音乐风格说明与 Suno / ElevenLabs 提示词。');
  };

  const handleCloneVoiceWorkflow = () => {
    showAudioRepairWorkflowToast('已放置“声音克隆/参考”入口：下一步会从拆分出来的人声轨提取参考音色，并应用到当前配音轨。');
  };

  const handleMatchSimilarVoicesWorkflow = async () => {
    if (!selectedTrack || selectedTrack.type !== 'dubbing') return;
    if (isMatchingSimilarVoices) return;

    const selectedReferenceClip = selectedClip
      && selectedClip.audioUrl
      && selectedClipTrack?.type === 'dubbing'
      ? selectedClip
      : clipsRef.current.find(clip => (
        clip.trackId === selectedTrack.id && Boolean(clip.audioUrl)
      )) || clipsRef.current.find(clip => (
        clip.trackId === SPLIT_VOCAL_TRACK_ID && Boolean(clip.audioUrl)
      ));

    const referenceAudioUrl = selectedReferenceClip?.audioUrl;
    if (!referenceAudioUrl) {
      showAudioRepairWorkflowToast('请先拆分出可播放的人声片段，或选中一个带音频的人声短句后再匹配相似声音。');
      return;
    }

    setIsMatchingSimilarVoices(true);
    setSimilarVoiceRecommendations([]);
    setSimilarVoiceSourceDescription('');
    setVoiceSearchQuery('');
    setVoiceGenderFilter('all');
    setVoiceActiveCategory('全部');
    try {
      const response = await fetch('/api/video/match-similar-voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioUrl: referenceAudioUrl,
          voices: displayVoices,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || '匹配相似声音失败，请稍后重试。');
      }
      const recommendations: SimilarVoiceRecommendation[] = Array.isArray(data.recommendations)
        ? data.recommendations
          .map((item: any) => ({
            voiceId: String(item?.voiceId || ''),
            score: Number(item?.score || 0),
            reason: String(item?.reason || '音色接近。'),
          }))
          .filter((item: SimilarVoiceRecommendation) => (
            item.voiceId && displayVoices.some(voice => voice.id === item.voiceId)
          ))
        : [];
      if (recommendations.length === 0) {
        throw new Error('没有在当前声音库中找到相似声音，请刷新 ElevenLabs 声音库后再试。');
      }
      setSimilarVoiceRecommendations(recommendations);
      setSimilarVoiceSourceDescription(String(data.sourceDescription || '已根据拆分人声音频匹配相似声音。'));
      setToast({ message: `已匹配到 ${recommendations.length} 个相似声音，声音库已切换为推荐列表。`, type: 'success' });
      window.setTimeout(() => setToast(null), 4_000);
    } catch (err: any) {
      const message = err?.message || '匹配相似声音失败，请稍后重试。';
      setToast({ message, type: 'error' });
      window.setTimeout(() => setToast(null), 4_000);
    } finally {
      setIsMatchingSimilarVoices(false);
    }
  };

  const handleDeprecatedLipFriendlyRewriteWorkflow = () => {
    showAudioRepairWorkflowToast('已放置“口型友好局部修改”入口：下一步会评估新台词长度、原句停顿和口型风险，再局部重配这一句。');
  };

  const handleLipFriendlyRewriteWorkflow = async () => {
    if (subtitleSegmentStatus === 'running') return;
    if (!videoFile) {
      setSubtitleSegmentStatus('error');
      setSubtitleSegmentProgress(0);
      setSubtitleSegmentStage('请先上传一个带字幕/台词的视频。');
      return;
    }
    if (isUploadingToServer || !videoFile.isUploaded) {
      setSubtitleSegmentStatus('error');
      setSubtitleSegmentProgress(0);
      setSubtitleSegmentStage('视频还在上传到服务器，请上传完成后再识别字幕。');
      return;
    }

    const isUsingSplitVocalAsSource = selectedClip?.trackId === SPLIT_VOCAL_TRACK_ID
      || selectedTrack?.id === SPLIT_VOCAL_TRACK_ID;
    const targetTrack = isUsingSplitVocalAsSource
      ? getOrCreateSplitDubbingEditTrack()
      : selectedClipTrack?.type === 'dubbing'
        ? selectedClipTrack
        : selectedTrack?.type === 'dubbing'
          ? selectedTrack
          : tracksRef.current.find(track => track.type === 'dubbing');
    if (!targetTrack) {
      setSubtitleSegmentStatus('error');
      setSubtitleSegmentProgress(0);
      setSubtitleSegmentStage('没有找到可写入的配音轨道，请先添加一条配音轨。');
      return;
    }

    const runId = subtitleSegmentRunRef.current + 1;
    subtitleSegmentRunRef.current = runId;
    setSubtitleSegmentStatus('running');
    setSubtitleSegmentProgress(8);
    setSubtitleSegmentCount(0);
    setSubtitleSegmentStage('正在读取视频字幕变化和口型窗口...');
    setError(null);

    try {
      setSubtitleSegmentProgress(28);
      const response = await fetch('/api/video/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: videoFile.name,
          videoDuration,
          bgmEnabled: false,
          sfxEnabled: false,
          dubbingEnabled: true,
          analysisMode: 'full-video-dubbing-sync',
          dubbingSyncMode: 'subtitle-and-lip',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || '字幕识别失败，请稍后重试。');
      }
      if (subtitleSegmentRunRef.current !== runId) return;

      setSubtitleSegmentProgress(68);
      setSubtitleSegmentStage('正在按字幕变化生成可编辑配音片段...');

      const existingTargetClips = clipsRef.current.filter(clip => clip.trackId === targetTrack.id);
      const matchedExistingClipIds = new Set<string>();
      const findReusableClip = (
        subtitleId: string,
        startTime: number,
        duration: number,
      ) => {
        const endTime = startTime + duration;
        const exactSubtitleMatch = existingTargetClips.find(clip => (
          clip.subtitleId
          && clip.subtitleId === subtitleId
          && !matchedExistingClipIds.has(clip.id)
        ));
        if (exactSubtitleMatch) return exactSubtitleMatch;
        let bestMatch: TimelineClip | undefined;
        let bestOverlap = 0;
        existingTargetClips.forEach(clip => {
          if (matchedExistingClipIds.has(clip.id)) return;
          const clipStart = normalizeOptionalTime(clip.startTime) ?? 0;
          const clipDuration = normalizePositiveNumber(clip.duration, 0);
          const clipEnd = clipStart + clipDuration;
          const overlap = Math.max(0, Math.min(endTime, clipEnd) - Math.max(startTime, clipStart));
          const overlapRatio = overlap / Math.max(duration, clipDuration, 0.001);
          if (overlapRatio > bestOverlap) {
            bestOverlap = overlapRatio;
            bestMatch = clip;
          }
        });
        return bestOverlap >= 0.45 ? bestMatch : undefined;
      };

      const analysisRunId = Date.now().toString(36);
      const subtitleClips: TimelineClip[] = Array.isArray(data.clips)
        ? data.clips
          .filter((clip: any) => String(clip?.trackId || '') === 'dubbing')
          .map((clip: any, index: number): TimelineClip | null => {
            const rawText = String(clip?.text ?? clip?.dialogue ?? clip?.caption ?? '').trim();
            if (!rawText) return null;
            const rawStart = normalizeOptionalTime(clip?.subtitleStartTime ?? clip?.subtitleStart ?? clip?.startTime) ?? 0;
            const rawEnd = normalizeOptionalTime(clip?.subtitleEndTime ?? clip?.subtitleEnd);
            const rawDuration = normalizePositiveNumber(clip?.duration, 0);
            const startTime = Math.min(safeDuration, Math.max(0, rawStart));
            const fallbackEndTime = startTime + (rawDuration > 0 ? rawDuration : 2);
            const endTime = Math.min(
              safeDuration,
              Math.max(startTime + 0.05, rawEnd ?? fallbackEndTime),
            );
            const duration = Number(Math.max(0.05, endTime - startTime).toFixed(3));
            const subtitleId = String(
              clip?.subtitleId || clip?.id || `subtitle-${String(index + 1).padStart(3, '0')}`,
            );
            const reusableClip = findReusableClip(subtitleId, startTime, duration);
            if (reusableClip) matchedExistingClipIds.add(reusableClip.id);
            const prompt = String(
              clip?.prompt
              || clip?.tonePrompt
              || clip?.emotionPrompt
              || `Tone reference: match the on-screen character's emotion, pace, breath, and delivery for this subtitle line.`,
            ).trim();
            return {
              ...reusableClip,
              id: reusableClip?.id || `clip-subtitle-dubbing-${analysisRunId}-${index}`,
              trackId: targetTrack.id,
              name: `字幕配音 ${String(index + 1).padStart(2, '0')}`,
              prompt,
              text: rawText,
              voiceId: targetTrack.defaultVoiceId || reusableClip?.voiceId || DEFAULT_DUBBING_VOICE_ID,
              startTime,
              duration,
              volume: reusableClip?.volume ?? DEFAULT_VOLUME_FADER,
              origin: 'ai',
              isGenerating: false,
              error: undefined,
              speed: normalizeManualSpeed(reusableClip?.speed),
              autoSpeed: normalizeAutoSpeed(reusableClip?.autoSpeed),
              sourceAudioDuration: reusableClip?.sourceAudioDuration,
              audioUrl: reusableClip?.audioUrl,
              audioSource: reusableClip?.audioSource,
              speaker: typeof clip?.speaker === 'string' ? clip.speaker.trim() : reusableClip?.speaker,
              subtitleId,
              subtitleStartTime: startTime,
              subtitleEndTime: endTime,
              lipStartTime: normalizeOptionalTime(clip?.lipStartTime ?? clip?.lipStart) ?? startTime,
              lipEndTime: normalizeOptionalTime(clip?.lipEndTime ?? clip?.lipEnd) ?? endTime,
              lipSyncConfidence: normalizeUnitVolume(clip?.lipSyncConfidence ?? clip?.syncConfidence, 0),
              timingSource: typeof clip?.timingSource === 'string' ? clip.timingSource : 'subtitle',
              timingDirty: false,
              voiceDirty: false,
            };
          })
          .filter(Boolean) as TimelineClip[]
        : [];

      if (subtitleClips.length === 0) {
        throw new Error('没有识别到可按字幕切分的台词片段；请确认视频里有清晰字幕或人声台词。');
      }

      setSubtitleSegmentProgress(88);
      const nextClipIds = new Set(subtitleClips.map(clip => clip.id));
      clipsRef.current
        .filter(clip => clip.trackId === targetTrack.id && !nextClipIds.has(clip.id))
        .forEach(clip => {
          const cachedAudio = audioInstancesRef.current[clip.id];
          if (cachedAudio) {
            cachedAudio.pause();
            disconnectClipAudioRouting(clip.id);
            delete audioInstancesRef.current[clip.id];
          }
        });

      setClips(prev => [
        ...prev.filter(clip => clip.trackId !== targetTrack.id),
        ...subtitleClips,
      ].sort((left, right) => left.startTime - right.startTime));
      subtitleClips.forEach(clip => {
        if (clip.audioUrl) {
          replaceCachedClipAudio(
            clip.id,
            clip.audioUrl,
            clip.volume,
            getEffectiveClipSpeed(clip),
            clip.trackId,
          );
        }
      });
      setSelectedTrackId(null);
      setSelectedClipId(subtitleClips[0]?.id || null);
      setSelectedClipIds(subtitleClips[0]?.id ? [subtitleClips[0].id] : []);

      setSubtitleSegmentCount(subtitleClips.length);
      setSubtitleSegmentProgress(100);
      setSubtitleSegmentStatus('completed');
      setSubtitleSegmentStage(
        isUsingSplitVocalAsSource
          ? `已在“可编辑配音片段”轨生成 ${subtitleClips.length} 个片段，拆分人声已保留。`
          : `已按字幕变化生成 ${subtitleClips.length} 个可编辑配音片段。`,
      );
      setToast({
        message: isUsingSplitVocalAsSource
          ? `已新建/更新“可编辑配音片段”轨，拆分人声轨不会被覆盖。`
          : `已按字幕变化生成 ${subtitleClips.length} 个配音片段；每段都带台词文案和语气提示词。`,
        type: 'success',
      });
      window.setTimeout(() => setToast(null), 4_000);
    } catch (err: any) {
      if (subtitleSegmentRunRef.current !== runId) return;
      const message = err?.message || '字幕识别失败，请稍后重试。';
      setSubtitleSegmentStatus('error');
      setSubtitleSegmentProgress(0);
      setSubtitleSegmentStage(message);
      setError(message);
      setToast({ message, type: 'error' });
      window.setTimeout(() => setToast(null), 4_000);
    }
  };

  // Mix all audio layers into original video using high performance ffmpeg
  const handleExportVideo = async () => {
    if (!videoFile) return;

    const isTrackExportable = (trackId: string) => {
      const track = tracks.find(item => item.id === trackId);
      return track ? !track.isMuted : true;
    };
    const staleDubbingClips = clips.filter(clip => {
      const track = tracks.find(item => item.id === clip.trackId);
      return track?.type === 'dubbing'
        && Boolean(clip.voiceDirty || clip.timingDirty)
        && isTrackExportable(clip.trackId);
    });
    if (staleDubbingClips.length > 0) {
      setError(`有 ${staleDubbingClips.length} 个配音片段的声音、台词或时间已变化，请先选中对应片段并重新合成。`);
      return;
    }

    if (isUploadingToServer || !videoFile.isUploaded) {
      setError('视频文件尚未成功同步到服务器，无法在服务器端运行 FFmpeg 混音。请等待视频上传完成。');
      return;
    }

    const ungenerated = clips.filter(c => !c.audioUrl);
    if (ungenerated.length > 0) {
      setToast({
        message: `还有 ${ungenerated.length} 个片段尚未合成，本次只导出已生成且未静音的音频。`,
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 4_000);
    }

    const { controller, version } = beginExportJob('video');
    setIsMixing(true);
    setError(null);
    setMixedVideoUrl(null);

    try {
      const playableClips = clips
        .filter(c => c.audioUrl && isTrackExportable(c.trackId))
        .map(clip => ({
          ...clip,
          trackType: tracks.find(track => track.id === clip.trackId)?.type,
          volume: getEffectiveClipVolume(clip, tracks),
          speed: getEffectiveClipSpeed(clip),
        }));

      const res = await fetch('/api/video/mix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          videoFileName: videoFile.name,
          clips: playableClips,
          audioFormat: exportAudioFormat,
          sampleRate: exportSampleRate,
          bitrate: exportBitrate,
          bitDepth: exportBitDepth,
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '视频合成导出失败，请重试');
      }

      const data = await res.json();
      if (!isCurrentExportJob('video', version, controller)) return;
      setMixedVideoUrl(data.videoUrl);
    } catch (err: any) {
      if (controller.signal.aborted || !isCurrentExportJob('video', version, controller)) return;
      setError(err.message || 'FFmpeg 音画合成出错');
    } finally {
      if (isCurrentExportJob('video', version, controller)) {
        delete exportControllersRef.current.video;
        setIsMixing(false);
      }
    }
  };

  // Export Master Soundtrack (mixed) or Individual Track Stems (bgm / sfx / dubbing)
  const handleExportAudio = async (trackId: 'mixed' | 'bgm' | 'sfx' | 'dubbing') => {
    const isTrackExportable = (id: string) => {
      const track = tracks.find(item => item.id === id);
      return track ? !track.isMuted : true;
    };
    const staleDubbingClips = clips.filter(clip => {
      const track = tracks.find(item => item.id === clip.trackId);
      return Boolean(
        track?.type === 'dubbing'
        && (clip.voiceDirty || clip.timingDirty)
        && isTrackExportable(clip.trackId)
        && (trackId === 'mixed' || track?.type === trackId),
      );
    });
    if (staleDubbingClips.length > 0) {
      setToast({
        message: `有 ${staleDubbingClips.length} 个配音片段的声音、台词或时间已变化，请先重新合成。`,
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 4_000);
      return;
    }

    const { controller, version } = beginExportJob(trackId);
    // Determine which loading state to set
    if (trackId === 'mixed') {
      setIsExportingMixed(true);
      setExportedMixedUrl(null);
    } else if (trackId === 'bgm') {
      setIsExportingBgm(true);
      setExportedBgmUrl(null);
    } else if (trackId === 'sfx') {
      setIsExportingSfx(true);
      setExportedSfxUrl(null);
    } else if (trackId === 'dubbing') {
      setIsExportingDubbing(true);
      setExportedDubbingUrl(null);
    }

    setError(null);

    try {
      const generatedClips = clips
        .filter(c => c.audioUrl && isTrackExportable(c.trackId))
        .map(clip => ({
          ...clip,
          trackType: tracks.find(track => track.id === clip.trackId)?.type,
          volume: getEffectiveClipVolume(clip, tracks),
          speed: getEffectiveClipSpeed(clip),
        }));
      let targetClips = generatedClips;
      if (trackId !== 'mixed') {
        targetClips = generatedClips.filter(c => {
          const track = tracks.find(t => t.id === c.trackId);
          return track && track.type === trackId;
        });
      }
      
      if (targetClips.length === 0) {
        throw new Error(`当前选择导出的轨道中没有任何已生成且未静音的音频片段。请先合成所需音频。`);
      }

      const res = await fetch('/api/audio/mix-tracks-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          clips: targetClips,
          trackId: trackId === 'mixed' ? undefined : trackId,
          audioFormat: exportAudioFormat,
          sampleRate: exportSampleRate,
          bitrate: exportBitrate,
          bitDepth: exportBitDepth,
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '音频分轨导出失败，请重试');
      }

      const data = await res.json();
      if (!isCurrentExportJob(trackId, version, controller)) return;
      
      // Store output URL in corresponding state
      if (trackId === 'mixed') {
        setExportedMixedUrl(data.audioUrl);
      } else if (trackId === 'bgm') {
        setExportedBgmUrl(data.audioUrl);
      } else if (trackId === 'sfx') {
        setExportedSfxUrl(data.audioUrl);
      } else if (trackId === 'dubbing') {
        setExportedDubbingUrl(data.audioUrl);
      }

    } catch (err: any) {
      if (controller.signal.aborted || !isCurrentExportJob(trackId, version, controller)) return;
      setError(err.message || 'FFmpeg 音频合成出错');
    } finally {
      if (isCurrentExportJob(trackId, version, controller)) {
        delete exportControllersRef.current[trackId];
        if (trackId === 'mixed') setIsExportingMixed(false);
        else if (trackId === 'bgm') setIsExportingBgm(false);
        else if (trackId === 'sfx') setIsExportingSfx(false);
        else if (trackId === 'dubbing') setIsExportingDubbing(false);
      }
    }
  };

  const handleExportStems = async () => {
    const isTrackExportable = (id: string) => {
      const track = tracks.find(item => item.id === id);
      return track ? !track.isMuted : true;
    };
    const staleDubbingClips = clips.filter(clip => {
      const track = tracks.find(item => item.id === clip.trackId);
      return Boolean(
        track?.type === 'dubbing'
        && (clip.voiceDirty || clip.timingDirty)
        && isTrackExportable(clip.trackId),
      );
    });
    if (staleDubbingClips.length > 0) {
      setToast({
        message: `有 ${staleDubbingClips.length} 个配音片段需要重新合成，请先更新后再分轨导出。`,
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 4_000);
      return;
    }

    const exportableClips = clips
      .filter(clip => clip.audioUrl && isTrackExportable(clip.trackId))
      .map(clip => ({
        ...clip,
        trackType: tracks.find(track => track.id === clip.trackId)?.type,
        volume: getEffectiveClipVolume(clip, tracks),
        speed: getEffectiveClipSpeed(clip),
      }));
    const exportableTrackIds = new Set(exportableClips.map(clip => clip.trackId));
    const exportableTracks = tracks.filter(track => exportableTrackIds.has(track.id) && !track.isMuted);

    if (exportableTracks.length === 0) {
      setError('没有可分轨导出的未静音音轨。');
      return;
    }

    const { controller, version } = beginExportJob('stems');
    setIsExportingStems(true);
    setExportedStemsUrl(null);
    setError(null);

    try {
      const res = await fetch('/api/audio/export-stems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          tracks: exportableTracks,
          clips: exportableClips,
          audioFormat: exportAudioFormat,
          sampleRate: exportSampleRate,
          bitrate: exportBitrate,
          bitDepth: exportBitDepth,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '分轨导出失败，请重试');
      }

      const data = await res.json();
      if (!isCurrentExportJob('stems', version, controller)) return;
      setExportedStemsUrl(data.zipUrl);
    } catch (err: any) {
      if (controller.signal.aborted || !isCurrentExportJob('stems', version, controller)) return;
      setError(err.message || '分轨导出失败');
    } finally {
      if (isCurrentExportJob('stems', version, controller)) {
        delete exportControllersRef.current.stems;
        setIsExportingStems(false);
      }
    }
  };

  // Timeline seeking by clicking ruler
  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const targetTime = (clickX / rect.width) * safeDuration;
    
    if (targetTime >= 0 && targetTime <= safeDuration) {
      if (videoRef.current && !videoLoadFailed) {
        setMediaTimeSafely(videoRef.current, targetTime);
      }
      setCurrentTime(targetTime);
    }
  };

  // Manual clip adjustment helpers
  const updateClipField = (clipId: string, field: keyof TimelineClip, value: any) => {
    const targetClip = clipsRef.current.find(clip => clip.id === clipId);
    const targetTrack = targetClip
      ? tracksRef.current.find(track => track.id === targetClip.trackId)
      : undefined;
    const isDubbingClip = targetTrack?.type === 'dubbing';
    const timingFields: Array<keyof TimelineClip> = [
      'text',
      'startTime',
      'duration',
      'subtitleStartTime',
      'subtitleEndTime',
      'lipStartTime',
      'lipEndTime',
    ];
    const invalidatesTiming = Boolean(
      isDubbingClip
      && timingFields.includes(field)
      && targetClip?.[field] !== value,
    );
    const changesExistingMix = Boolean(
      ['startTime', 'duration', 'volume', 'speed', 'autoSpeed', 'fadeIn', 'fadeOut', 'audioEnhancementPreset'].includes(field)
      && targetClip?.[field] !== value,
    );

    if (invalidatesTiming || changesExistingMix) {
      if (targetTrack) invalidateTrackOutputs(targetTrack.type);
      else invalidateMixedVideo();
    }

    setClips(prev => prev.map(c => {
      if (c.id === clipId) {
        const normalizedValue = field === 'speed'
          ? normalizeManualSpeed(value)
          : field === 'autoSpeed'
            ? normalizeAutoSpeed(value)
            : field === 'fadeIn' || field === 'fadeOut'
              ? normalizeClipFade(value, c.duration)
            : value;
        const updated: TimelineClip = {
          ...c,
          [field]: normalizedValue,
          ...(invalidatesTiming ? { timingDirty: true } : {}),
        };
        const linkedSubtitleWindow = getLinkedSubtitleWindow(c);
        if (linkedSubtitleWindow && field === 'startTime') {
          const subtitleDuration = linkedSubtitleWindow.end - linkedSubtitleWindow.start;
          const safeDuration = Math.min(c.duration, subtitleDuration);
          const requestedStart = typeof normalizedValue === 'number' && Number.isFinite(normalizedValue)
            ? normalizedValue
            : c.startTime;
          updated.startTime = Math.min(
            Math.max(linkedSubtitleWindow.start, requestedStart),
            linkedSubtitleWindow.end - safeDuration,
          );
          updated.duration = Math.min(safeDuration, linkedSubtitleWindow.end - updated.startTime);
        } else if (linkedSubtitleWindow && field === 'duration') {
          const maximumDuration = Math.max(0.05, linkedSubtitleWindow.end - c.startTime);
          const minimumDuration = Math.min(0.5, maximumDuration);
          const requestedDuration = typeof normalizedValue === 'number' && Number.isFinite(normalizedValue)
            ? normalizedValue
            : c.duration;
          updated.duration = Math.min(
            maximumDuration,
            Math.max(minimumDuration, requestedDuration),
          );
        }
        if (isDubbingClip && (field === 'duration' || field === 'startTime')) {
          updated.autoSpeed = calculateDubbingAutoSpeed(
            c.sourceAudioDuration,
            updated.duration,
          );
        }
        // Adjust audio volume if it exists
        if (field === 'volume' && audioInstancesRef.current[clipId]) {
          setClipPlaybackGain(clipId, audioInstancesRef.current[clipId], getEffectiveClipVolume(updated, tracksRef.current));
        }
        // Automatic fitting and manual fine tuning always combine for preview.
        if (
          (field === 'speed' || field === 'autoSpeed' || field === 'duration' || field === 'startTime')
          && audioInstancesRef.current[clipId]
        ) {
          audioInstancesRef.current[clipId].playbackRate = getEffectiveClipSpeed(updated);
        }
        return updated;
      }
      return c;
    }));
  };

  const handleAddNewClip = (trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (track?.type === 'original') {
      setToast({
        message: '视频原声轨会自动对应整段视频。如需额外声音，请在 BGM/SFX/配音轨添加片段。',
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 3_000);
      return;
    }
    const trackType = track ? track.type : 'sfx';
    pushUndoSnapshot('新增音频片段');
    invalidateTrackOutputs(trackType);

    const id = `clip-manual-${Date.now()}`;
    const newClip: TimelineClip = {
      id,
      trackId,
      origin: 'manual',
      name: trackType === 'bgm' ? '新增配乐' : trackType === 'sfx' ? '新增音效' : '新增配音',
      prompt: trackType === 'bgm' ? 'acoustic light background music' : trackType === 'sfx' ? 'soft swoop impact' : 'please input narration prompt',
      text: trackType === 'dubbing' ? '这是一段配音台词旁白' : undefined,
      voiceId: trackType === 'dubbing'
        ? track?.defaultVoiceId || DEFAULT_DUBBING_VOICE_ID
        : undefined,
      voiceDirty: false,
      startTime: Math.min(currentTime, safeDuration - 5),
      duration: trackType === 'bgm' ? 10 : trackType === 'sfx' ? 2 : 4,
      volume: DEFAULT_VOLUME_FADER,
      speed: 1,
      autoSpeed: 1,
      subtitleStartTime: trackType === 'dubbing' ? Math.min(currentTime, safeDuration - 5) : undefined,
      subtitleEndTime: trackType === 'dubbing' ? Math.min(currentTime, safeDuration - 5) + 4 : undefined,
      lipSyncConfidence: trackType === 'dubbing' ? 0 : undefined,
      timingSource: trackType === 'dubbing' ? 'manual' : undefined,
      timingDirty: false,
    };
    
    setClips(prev => [...prev, newClip]);
    handleSelectClip(id);
  };

  const toggleMuteTrack = (trackId: string) => {
    const currentTrack = tracksRef.current.find(track => track.id === trackId);
    if (!currentTrack) return;
    pushUndoSnapshot(currentTrack.isMuted ? '取消轨道静音' : '轨道静音');
    invalidateTrackOutputs(currentTrack.type);
    const nextTracks = tracksRef.current.map(track => (
      track.id === trackId ? { ...track, isMuted: !track.isMuted } : track
    ));
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
  };

  const toggleSoloTrack = (trackId: string) => {
    const currentTrack = tracksRef.current.find(track => track.id === trackId);
    if (!currentTrack) return;
    pushUndoSnapshot(currentTrack.isSoloed ? '取消轨道独奏' : '轨道独奏');
    const nextTracks = tracksRef.current.map(track => (
      track.id === trackId ? { ...track, isSoloed: !track.isSoloed } : track
    ));
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
  };

  const moveTrack = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= tracks.length) return;
    pushUndoSnapshot(direction === 'up' ? '上移轨道' : '下移轨道');
    const updated = [...tracks];
    const temp = updated[index];
    updated[index] = updated[newIndex];
    updated[newIndex] = temp;
    tracksRef.current = updated;
    setTracks(updated);
  };

  const handleDuplicateTrack = (trackId: string) => {
    const sourceTrack = tracksRef.current.find(track => track.id === trackId);
    if (!sourceTrack) return;
    if (sourceTrack.type === 'original') {
      setToast({
        message: '视频原声轨是系统轨，不能复制；需要备份时请复制拆分后的人声/音乐轨。',
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 3_000);
      return;
    }

    pushUndoSnapshot('复制轨道');
    const now = Date.now();
    const duplicatedTrackId = `track-copy-${now}`;
    const duplicatedTrack: SoundtrackTrack = {
      ...sourceTrack,
      id: duplicatedTrackId,
      name: `${sourceTrack.name} 副本`,
      isMuted: false,
      isSoloed: false,
    };
    const sourceTrackIndex = tracksRef.current.findIndex(track => track.id === trackId);
    const nextTracks = [...tracksRef.current];
    nextTracks.splice(sourceTrackIndex + 1, 0, duplicatedTrack);
    const sourceClips = clipsRef.current.filter(clip => clip.trackId === trackId && !isOriginalAudioClip(clip));
    const duplicatedClips = sourceClips.map((clip, index): TimelineClip => ({
      ...clip,
      id: `${clip.id}-copy-${now}-${index}`,
      trackId: duplicatedTrackId,
      name: `${clip.name} 副本`,
      origin: 'manual',
      subtitleId: undefined,
      subtitleStartTime: undefined,
      subtitleEndTime: undefined,
      lipStartTime: undefined,
      lipEndTime: undefined,
      lipSyncConfidence: undefined,
      timingSource: 'manual-copy',
    }));
    const nextClips = [...clipsRef.current, ...duplicatedClips];

    tracksRef.current = nextTracks;
    clipsRef.current = nextClips;
    setTracks(nextTracks);
    setClips(nextClips);
    handleSelectTrack(duplicatedTrackId);
    syncAudioInstancesForTimelineState(nextClips, nextTracks);
    invalidateTrackOutputs(sourceTrack.type);

    setToast({
      message: `已复制轨道“${sourceTrack.name}”，包含 ${duplicatedClips.length} 个片段。`,
      type: 'success',
    });
    window.setTimeout(() => setToast(null), 3_000);
  };

  const getAdjacentEditableTrack = (trackId: string, direction: 'up' | 'down') => {
    const currentIndex = tracksRef.current.findIndex(track => track.id === trackId);
    if (currentIndex < 0) return null;

    const step = direction === 'up' ? -1 : 1;
    for (
      let index = currentIndex + step;
      index >= 0 && index < tracksRef.current.length;
      index += step
    ) {
      const candidate = tracksRef.current[index];
      if (candidate.type !== 'original') return candidate;
    }
    return null;
  };

  const moveClipToAdjacentTrack = (clipId: string, direction: 'up' | 'down') => {
    const sourceClip = clipsRef.current.find(clip => clip.id === clipId);
    if (!sourceClip) return;
    if (isOriginalAudioClip(sourceClip)) {
      setToast({
        message: '视频原声片段是系统锁定片段，不能移动到其他轨道。',
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 3_000);
      return;
    }

    const sourceTrack = tracksRef.current.find(track => track.id === sourceClip.trackId);
    const targetTrack = getAdjacentEditableTrack(sourceClip.trackId, direction);
    if (!targetTrack || !canMoveClipToTrack(sourceClip, targetTrack)) {
      setToast({
        message: direction === 'up' ? '上方没有可移动到的普通音轨。' : '下方没有可移动到的普通音轨。',
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 2_500);
      return;
    }

    pushUndoSnapshot(direction === 'up' ? '片段上移到其他音轨' : '片段下移到其他音轨');
    const movedClip = adaptClipForTrack(sourceClip, targetTrack);
    const alignedClip: TimelineClip = {
      ...movedClip,
      startTime: sourceClip.startTime,
      duration: sourceClip.duration,
    };
    const nextClips = clipsRef.current.map(clip => (
      clip.id === clipId ? alignedClip : clip
    ));

    clipsRef.current = nextClips;
    setClips(nextClips);
    handleSelectClip(clipId);
    syncAudioInstancesForTimelineState(nextClips, tracksRef.current);
    if (sourceTrack) invalidateTrackOutputs(sourceTrack.type);
    invalidateTrackOutputs(targetTrack.type);

    setToast({
      message: `已${direction === 'up' ? '上移' : '下移'}到“${targetTrack.name}”，时间轴位置保持 ${sourceClip.startTime.toFixed(2)}s。`,
      type: 'success',
    });
    window.setTimeout(() => setToast(null), 2_500);
  };

  const splitTextByRatio = (value: string | undefined, ratio: number): [string | undefined, string | undefined] => {
    const text = String(value || '').trim();
    if (!text) return [undefined, undefined];
    const chars = Array.from(text);
    if (chars.length <= 1) return [text, undefined];
    const splitIndex = Math.min(
      chars.length - 1,
      Math.max(1, Math.round(chars.length * Math.min(0.95, Math.max(0.05, ratio)))),
    );
    return [
      chars.slice(0, splitIndex).join('').trim() || undefined,
      chars.slice(splitIndex).join('').trim() || undefined,
    ];
  };

  const joinClipText = (left?: string, right?: string) => {
    const first = String(left || '').trim();
    const second = String(right || '').trim();
    if (!first) return second || undefined;
    if (!second) return first || undefined;
    if (/[\u4e00-\u9fa5]$/.test(first) || /^[\u4e00-\u9fa5，。！？、；：）】》”’]/.test(second)) {
      return `${first}${second}`;
    }
    return `${first} ${second}`;
  };

  const canSplitClipAtCurrentTime = (clip?: TimelineClip | null) => {
    if (!clip || isOriginalAudioClip(clip)) return false;
    const splitTime = Number(currentTime.toFixed(3));
    return splitTime > clip.startTime + 0.05 && splitTime < clip.startTime + clip.duration - 0.05;
  };

  const getSelectedMergeableClipPair = () => {
    if (selectedClipIds.length !== 2) return null;
    const selectedClips = selectedClipIds
      .map(id => clipsRef.current.find(clip => clip.id === id))
      .filter((clip): clip is TimelineClip => Boolean(clip));
    if (selectedClips.length !== 2) return null;
    if (selectedClips.some(clip => isOriginalAudioClip(clip))) return null;
    const [firstClip, secondClip] = selectedClips
      .sort((left, right) => left.startTime - right.startTime);
    if (firstClip.trackId !== secondClip.trackId) return null;
    const firstEndTime = firstClip.startTime + firstClip.duration;
    if (Math.abs(secondClip.startTime - firstEndTime) > 0.15) return null;
    return [firstClip, secondClip] as const;
  };

  const handleSplitSelectedClipAtPlayhead = () => {
    const clip = selectedClipId
      ? clipsRef.current.find(item => item.id === selectedClipId)
      : null;
    if (!clip) return;
    if (!canSplitClipAtCurrentTime(clip)) {
      setToast({
        message: '请把播放头放在选中音频片段内部，再使用剪刀剪开。',
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 2_500);
      return;
    }

    const splitTime = Number(currentTime.toFixed(3));
    const leftDuration = Number((splitTime - clip.startTime).toFixed(3));
    const rightDuration = Number((clip.duration - leftDuration).toFixed(3));
    const ratio = leftDuration / Math.max(clip.duration, 0.001);
    const [leftText, rightText] = splitTextByRatio(clip.text, ratio);
    const [leftPrompt, rightPrompt] = splitTextByRatio(clip.prompt, ratio);
    const clipSpeed = getEffectiveClipSpeed(clip);
    const sourceOffset = getClipSourceOffset(clip);
    const sourceSplitOffset = Number((sourceOffset + leftDuration * clipSpeed).toFixed(3));
    const sourceLeftDuration = Number((leftDuration * clipSpeed).toFixed(3));
    const sourceRightDuration = Number((rightDuration * clipSpeed).toFixed(3));
    const splitId = `${clip.id}-split-${Date.now()}`;
    const leftSubtitleStart = normalizeOptionalTime(clip.subtitleStartTime) ?? clip.startTime;
    const rightSubtitleEnd = normalizeOptionalTime(clip.subtitleEndTime) ?? (clip.startTime + clip.duration);
    const lipStart = normalizeOptionalTime(clip.lipStartTime);
    const lipEnd = normalizeOptionalTime(clip.lipEndTime);
    const leftClip: TimelineClip = {
      ...clip,
      name: `${clip.name} A`,
      prompt: leftPrompt || clip.prompt,
      text: leftText,
      duration: leftDuration,
      sourceOffset,
      sourceAudioDuration: clip.sourceAudioDuration ? sourceLeftDuration : clip.sourceAudioDuration,
      subtitleStartTime: clip.subtitleStartTime !== undefined ? leftSubtitleStart : undefined,
      subtitleEndTime: clip.subtitleEndTime !== undefined ? splitTime : undefined,
      lipStartTime: lipStart,
      lipEndTime: lipEnd !== undefined ? Math.min(lipEnd, splitTime) : undefined,
    };
    const rightClip: TimelineClip = {
      ...clip,
      id: splitId,
      name: `${clip.name} B`,
      prompt: rightPrompt || clip.prompt,
      text: rightText,
      startTime: splitTime,
      duration: rightDuration,
      sourceOffset: sourceSplitOffset,
      sourceAudioDuration: clip.sourceAudioDuration ? sourceRightDuration : clip.sourceAudioDuration,
      subtitleStartTime: clip.subtitleStartTime !== undefined ? splitTime : undefined,
      subtitleEndTime: clip.subtitleEndTime !== undefined ? rightSubtitleEnd : undefined,
      lipStartTime: lipStart !== undefined ? Math.max(lipStart, splitTime) : undefined,
      lipEndTime: lipEnd,
    };

    pushUndoSnapshot('剪开音频片段');
    const nextClips = clipsRef.current
      .flatMap(item => item.id === clip.id ? [leftClip, rightClip] : [item])
      .sort((left, right) => left.startTime - right.startTime);
    clipsRef.current = nextClips;
    setClips(nextClips);
    setSelectedClipId(rightClip.id);
    setSelectedClipIds([rightClip.id]);
    setSelectedTrackId(null);
    syncAudioInstancesForTimelineState(nextClips, tracksRef.current);
    const track = tracksRef.current.find(item => item.id === clip.trackId);
    if (track) invalidateTrackOutputs(track.type);
    setToast({
      message: `已在 ${splitTime.toFixed(2)}s 剪开片段，并自动拆分台词。`,
      type: 'success',
    });
    window.setTimeout(() => setToast(null), 2_500);
  };

  const handleMergeSelectedClipWithAdjacent = () => {
    const selectedPair = getSelectedMergeableClipPair();
    if (!selectedPair) {
      setToast({
        message: '请先选中同一轨道里前后相邻的两个音频片段，再粘合。',
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 2_500);
      return;
    }

    const [firstClip, secondClip] = selectedPair;
    const mergedStartTime = firstClip.startTime;
    const mergedEndTime = Math.max(
      firstClip.startTime + firstClip.duration,
      secondClip.startTime + secondClip.duration,
    );
    const sameAudioSource = Boolean(firstClip.audioUrl && firstClip.audioUrl === secondClip.audioUrl);
    const mergedText = joinClipText(firstClip.text, secondClip.text);
    const mergedPrompt = joinClipText(firstClip.prompt, secondClip.prompt) || firstClip.prompt;
    const mergedClip: TimelineClip = {
      ...firstClip,
      id: firstClip.id,
      name: firstClip.name.replace(/\s+[AB]$/, ''),
      prompt: mergedPrompt,
      text: mergedText,
      startTime: Number(mergedStartTime.toFixed(3)),
      duration: Number((mergedEndTime - mergedStartTime).toFixed(3)),
      sourceOffset: getClipSourceOffset(firstClip),
      sourceAudioDuration: firstClip.sourceAudioDuration && secondClip.sourceAudioDuration
        ? Number((firstClip.sourceAudioDuration + secondClip.sourceAudioDuration).toFixed(3))
        : firstClip.sourceAudioDuration || secondClip.sourceAudioDuration,
      audioUrl: sameAudioSource ? firstClip.audioUrl : undefined,
      audioSource: sameAudioSource ? firstClip.audioSource : undefined,
      subtitleStartTime: firstClip.subtitleStartTime ?? secondClip.subtitleStartTime,
      subtitleEndTime: secondClip.subtitleEndTime ?? firstClip.subtitleEndTime,
      lipStartTime: firstClip.lipStartTime ?? secondClip.lipStartTime,
      lipEndTime: secondClip.lipEndTime ?? firstClip.lipEndTime,
      timingDirty: sameAudioSource ? firstClip.timingDirty || secondClip.timingDirty : true,
      voiceDirty: firstClip.voiceDirty || secondClip.voiceDirty,
      error: sameAudioSource ? undefined : '合并后的片段来自不同音频源，请重新生成音频。',
    };

    pushUndoSnapshot('合并音频片段');
    const nextClips = clipsRef.current
      .filter(item => item.id !== firstClip.id && item.id !== secondClip.id)
      .concat(mergedClip)
      .sort((left, right) => left.startTime - right.startTime);
    clipsRef.current = nextClips;
    setClips(nextClips);
    setSelectedClipId(mergedClip.id);
    setSelectedClipIds([mergedClip.id]);
    setSelectedTrackId(null);
    syncAudioInstancesForTimelineState(nextClips, tracksRef.current);
    const track = tracksRef.current.find(item => item.id === mergedClip.trackId);
    if (track) invalidateTrackOutputs(track.type);
    setToast({
      message: sameAudioSource
        ? '已合并相邻片段，并自动合并台词。'
        : '已合并台词；两个片段音频源不同，需要重新生成合并后的声音。',
      type: sameAudioSource ? 'success' : 'info',
    });
    window.setTimeout(() => setToast(null), 3_000);
  };

  const handleAddTrackConfirm = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    pushUndoSnapshot('新建轨道');
    const id = `track-custom-${Date.now()}`;
    const name = newTrackName.trim() || `自定义音轨_${tracks.length + 1}`;
    
    const newTrack: SoundtrackTrack = {
      id,
      name,
      type: newTrackType,
      volume: DEFAULT_VOLUME_FADER,
      isMuted: false,
      isSoloed: false,
      defaultVoiceId: newTrackType === 'dubbing' ? DEFAULT_DUBBING_VOICE_ID : undefined,
    };

    setTracks(prev => [...prev, newTrack]);
    handleSelectTrack(id);
    setNewTrackName('');
    setShowAddTrackModal(false);

    setToast({
      message: `已成功创建新音轨“${name}”！`,
      type: 'success'
    });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDeleteTrack = (trackId: string) => {
    const targetTrack = tracksRef.current.find(track => track.id === trackId);
    if (targetTrack?.type === 'original') {
      setToast({
        message: '视频原声轨是随视频自动生成的系统轨，不能删除。需要去掉原声时请静音该轨道。',
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 3_000);
      return;
    }
    if (targetTrack) invalidateTrackOutputs(targetTrack.type);
    pushUndoSnapshot('删除轨道');
    // Delete any clips belonging to this track
    setClips(prev => prev.filter(c => c.trackId !== trackId));
    const nextTracks = tracksRef.current.filter(track => track.id !== trackId);
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    if (selectedTrackId === trackId) setSelectedTrackId(null);
    
    setToast({
      message: `音轨已删除，关联音频块已清空。`,
      type: 'info'
    });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDeleteClip = (clipId: string) => {
    const targetClip = clipsRef.current.find(clip => clip.id === clipId);
    if (isOriginalAudioClip(targetClip)) {
      setToast({
        message: '视频原声轨是随视频自动生成的系统轨，不能单独删除。需要去掉原声时请静音该轨道。',
        type: 'info',
      });
      window.setTimeout(() => setToast(null), 3_000);
      return;
    }
    const targetTrack = targetClip
      ? tracksRef.current.find(track => track.id === targetClip.trackId)
      : undefined;
    if (targetTrack) invalidateTrackOutputs(targetTrack.type);
    pushUndoSnapshot('删除音频片段');
    // Stop audio
    if (audioInstancesRef.current[clipId]) {
      audioInstancesRef.current[clipId].pause();
      disconnectClipAudioRouting(clipId);
      delete audioInstancesRef.current[clipId];
    }
    setClips(prev => prev.filter(c => c.id !== clipId));
    if (selectedClipId === clipId) {
      setSelectedClipId(null);
    }
    setSelectedClipIds(prev => prev.filter(id => id !== clipId));
  };

  if (!isProjectActive) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] h-full bg-slate-900 text-slate-100 p-8 relative overflow-hidden select-none">
        {/* Decorative ambient gradients */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full filter blur-[100px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full filter blur-[100px] pointer-events-none" />

        <div className="max-w-2xl w-full bg-slate-950/60 border border-slate-800/80 rounded-2xl p-8 backdrop-blur-md shadow-2xl relative z-10 text-center space-y-8">
          <div className="space-y-3">
            <div className="inline-flex p-3 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-indigo-400 rounded-2xl shadow-inner border border-indigo-500/10">
              <Film className="w-10 h-10" />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">视频生成音频</h1>
            <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
              导入视频，在多轨时间线上规划配乐、音效与配音。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-4">
            {/* Create New Project */}
            <button
              onClick={handleCreateNewProject}
              className="group flex flex-col items-center justify-center p-6 bg-slate-900/60 hover:bg-indigo-600/10 border border-slate-800 hover:border-indigo-500/40 rounded-xl cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/5 hover:-translate-y-0.5"
            >
              <div className="p-3 bg-indigo-500/10 group-hover:bg-indigo-500/20 text-indigo-400 rounded-xl mb-4 transition-colors">
                <Plus className="w-6 h-6" />
              </div>
              <span className="text-sm font-bold text-slate-200 group-hover:text-white">新建工程</span>
              <span className="text-[11px] text-slate-500 mt-2 text-center leading-relaxed">创建一个空白多轨音频工程。</span>
            </button>

            {/* Open Existing Project */}
            <button
              onClick={() => {
                loadSavedProjects();
                setShowOpenProjectModal(true);
              }}
              className="group flex flex-col items-center justify-center p-6 bg-slate-900/60 hover:bg-emerald-600/10 border border-slate-800 hover:border-emerald-500/40 rounded-xl cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-emerald-500/5 hover:-translate-y-0.5"
            >
              <div className="p-3 bg-emerald-500/10 group-hover:bg-emerald-500/20 text-emerald-400 rounded-xl mb-4 transition-colors">
                <FolderOpen className="w-6 h-6" />
              </div>
              <span className="text-sm font-bold text-slate-200 group-hover:text-emerald-400">打开已有工程</span>
              <span className="text-[11px] text-slate-500 mt-2 text-center leading-relaxed">加载您之前在浏览器本地保存的工程配置，实时还原时间轴、音效及历史生成。</span>
            </button>
          </div>

          {/* Quick Stats / Recent projects */}
          {savedProjectsList.length > 0 && (
            <div className="pt-4 border-t border-slate-900 text-left">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-3">最近编辑的工程</span>
              <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                {savedProjectsList.slice(0, 3).map((proj) => (
                  <div
                    key={proj.id}
                    onClick={() => handleOpenProject(proj)}
                    className="flex items-center justify-between p-2.5 bg-slate-900/40 hover:bg-slate-900 border border-slate-800/60 hover:border-slate-800 rounded-lg cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FolderOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span className="text-xs font-bold text-slate-300 truncate">{proj.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-[10px] text-slate-500 font-mono">
                      <span>{proj.clips.length} 个音轨片段</span>
                      <span>{new Date(proj.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Startup view Open Project modal */}
        {showOpenProjectModal && (
          <div className="fixed inset-0 z-[9990] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm" onClick={() => setShowOpenProjectModal(false)} />
            <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 overflow-hidden z-10 flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between mb-4 shrink-0">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-sm font-bold text-slate-200">工程库管理</h3>
                </div>
                <button onClick={() => setShowOpenProjectModal(false)} className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-4 mb-4 shrink-0 flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-300">从本地文件导入</h4>
                  <p className="text-[10px] text-slate-500 mt-0.5">选择备份的工程配置文件（*.vsa.json）载入当前工作区</p>
                </div>
                <label className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-lg shadow-indigo-500/15 cursor-pointer transition-colors shrink-0">
                  <Upload className="w-3.5 h-3.5" />
                  <span>导入本地工程</span>
                  <input type="file" accept=".json" onChange={handleImportProjectFile} className="hidden" />
                </label>
              </div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 shrink-0">
                本地已保存的工程 ({savedProjectsList.length})
              </div>
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-[220px]">
                {savedProjectsList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-xl bg-slate-950/30">
                    <FolderOpen className="w-8 h-8 opacity-30 mb-2 text-slate-500" />
                    <p className="text-xs">还没有保存过任何工程</p>
                  </div>
                ) : (
                  savedProjectsList.map((project) => (
                    <div key={project.id} onClick={() => handleOpenProject(project)} className="group flex items-center justify-between p-3.5 bg-slate-950 hover:bg-slate-950/60 border border-slate-800 hover:border-indigo-500/50 rounded-lg transition-all duration-200 cursor-pointer text-left">
                      <div className="min-w-0 flex-1 pr-4">
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-bold text-slate-200 truncate group-hover:text-indigo-400 transition-colors">{project.name}</span>
                          <span className="text-[9px] text-slate-500 shrink-0 font-mono">{new Date(project.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-4 mt-1.5 text-[10px] text-slate-400">
                          <span className="flex items-center gap-1">
                            <Film className="w-3 h-3 text-slate-500" />
                            <span className="truncate max-w-[150px]">{project.videoFile?.name || '未加载视频'}</span>
                          </span>
                          <span className="font-mono">{project.clips.length} 个音轨片段</span>
                          <span className="font-mono">{(project.videoDuration || 0).toFixed(1)}s 时长</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button onClick={(e) => handleExportProjectToFile(project, e)} title="备份并导出为文件" className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors cursor-pointer">
                          <FileDown className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={(e) => handleDeleteProject(project.id, e)} title="删除此工程" className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const currentProjectName = currentProjectId
    ? savedProjectsList.find(project => project.id === currentProjectId)?.name || '已保存工程'
    : '未保存的工程 (新)';
  const getCompactProjectName = (name: string) => {
    const normalized = name.trim().replace(/^工程[_\s-]*/i, '');
    if (!normalized) return name;
    if (normalized === '未保存的工程 (新)' || normalized === '已保存工程') return normalized;

    const parts = normalized
      .split(/[-_—–]+/)
      .map(part => part.trim())
      .filter(Boolean);

    const compact = parts.length >= 2 ? `${parts[0]} · ${parts[1]}` : normalized;
    return compact.length > 18 ? `${compact.slice(0, 12)}…${compact.slice(-4)}` : compact;
  };
  const currentProjectDisplayName = getCompactProjectName(currentProjectName);

  return (
    <div id="video-soundtrack-container" className="flex flex-col h-full bg-slate-900 text-slate-100 overflow-hidden">
      {/* 顶部工具栏 */}
      <header id="daw-header" className="px-4 py-3 lg:px-6 lg:py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between gap-3 shadow-md shrink-0 select-none overflow-visible">
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-3 overflow-x-auto overflow-y-hidden pr-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:gap-6">
          <div className="flex min-w-[220px] max-w-[360px] shrink-0 items-center gap-3">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
              <Film className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-slate-200 whitespace-nowrap">视频声音制作</h1>
              <div className="text-[10px] text-slate-400 flex min-w-0 items-center gap-1">
                <span className="shrink-0">当前工程：</span>
                {currentProjectId && isRenamingProject ? (
                  <input
                    type="text"
                    value={projectNameDraft}
                    onChange={(event) => setProjectNameDraft(event.target.value)}
                    onBlur={commitRenameCurrentProject}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitRenameCurrentProject();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        setIsRenamingProject(false);
                      }
                    }}
                    onFocus={(event) => event.currentTarget.select()}
                    maxLength={80}
                    autoFocus
                    aria-label="修改工程名称"
                    className="w-40 max-w-[48vw] rounded border border-indigo-500/60 bg-slate-950 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/30"
                  />
                ) : currentProjectId ? (
                  <button
                    type="button"
                    onClick={beginRenameCurrentProject}
                    className="group flex min-w-0 max-w-[11rem] items-center gap-1 rounded border border-indigo-900/30 bg-indigo-950/50 px-1.5 py-0.5 font-bold text-indigo-400 transition-colors hover:border-indigo-600/50 hover:bg-indigo-900/40 hover:text-indigo-300"
                    title={`完整工程名：${currentProjectName}，点击修改`}
                    aria-label={`修改工程名称：${currentProjectName}`}
                  >
                    <span className="truncate">{currentProjectDisplayName}</span>
                    <Pencil className="h-2.5 w-2.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
                  </button>
                ) : (
                  <span className="truncate rounded border border-indigo-900/30 bg-indigo-950/50 px-1.5 py-0.5 font-bold text-indigo-400">
                    {currentProjectDisplayName}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 工程管理控制 */}
          <div className="flex shrink-0 flex-nowrap items-center gap-2 border-slate-800 pl-0 lg:border-l lg:pl-4">
            <button
              onClick={handleCreateNewProject}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-800 transition-all cursor-pointer"
              title="新建工程"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              <span>新建工程</span>
            </button>

            <button
              onClick={() => {
                loadSavedProjects();
                setShowOpenProjectModal(true);
              }}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-800 transition-all cursor-pointer"
              title="打开已保存的工程"
            >
              <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
              <span>打开工程</span>
            </button>

            <button
              onClick={handleSaveProject}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-800 transition-all cursor-pointer"
              title="保存当前工程"
            >
              <Save className="w-3.5 h-3.5 text-emerald-400" />
              <span>保存</span>
            </button>

            <button
              onClick={() => {
                setProjectNameInput(
                  currentProjectId 
                    ? `${savedProjectsList.find(p => p.id === currentProjectId)?.name || '工程'}_副本`
                    : `未命名工程_${new Date().toLocaleDateString()}`
                );
                setShowSaveProjectModal(true);
              }}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-800 transition-all cursor-pointer"
              title="工程另存为新工程"
            >
              <FileDown className="w-3.5 h-3.5 text-blue-400" />
              <span>另存为</span>
            </button>

            <button
              onClick={handleReturnHome}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap bg-slate-900 hover:bg-red-950/40 hover:text-red-400 text-slate-400 font-bold text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-800 transition-all cursor-pointer"
              title="关闭当前工程并返回首页"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>返回首页</span>
            </button>
          </div>
        </div>

        {showDAW && (
          <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2 overflow-visible lg:gap-4">
            {/* 轨道独立控制 */}
            <div className="flex shrink-0 flex-nowrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs sm:gap-3 sm:px-3">
              <span className="mr-0.5 shrink-0 whitespace-nowrap text-slate-400 font-medium sm:mr-1">生成轨道:</span>
              <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap cursor-pointer hover:text-indigo-400">
                <input 
                  type="checkbox" 
                  checked={bgmEnabled} 
                  onChange={(e) => setBgmEnabled(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-0 focus:ring-offset-0"
                />
                <span>配乐</span>
              </label>
              <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap cursor-pointer hover:text-indigo-400">
                <input 
                  type="checkbox" 
                  checked={sfxEnabled} 
                  onChange={(e) => setSfxEnabled(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-0 focus:ring-offset-0"
                />
                <span>音效</span>
              </label>
              <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap cursor-pointer hover:text-indigo-400">
                <input 
                  type="checkbox" 
                  checked={dubbingEnabled} 
                  onChange={(e) => setDubbingEnabled(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-0 focus:ring-offset-0"
                />
                <span>配音</span>
              </label>
            </div>

            <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
              <button
                id="btn-ai-analyze"
                onClick={() => {
                  if (isAnalyzing) analysisAbortRef.current?.abort('user');
                  else void handleAnalyzeVideo();
                }}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap text-white font-bold text-xs px-3 py-1.5 sm:px-3.5 rounded-lg shadow-lg transition-all duration-200 cursor-pointer ${
                  isAnalyzing
                    ? 'bg-red-600 hover:bg-red-500 shadow-red-500/10'
                    : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-indigo-500/10'
                }`}
              >
                {isAnalyzing ? (
                  <>
                    <X className="w-3.5 h-3.5" />
                    <span>{analysisStage} 点击取消</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI画面分析</span>
                  </>
                )}
              </button>

              <div className="relative">
                {isExportDropdownOpen && (
                  <div className="fixed inset-0 z-40" onClick={() => setIsExportDropdownOpen(false)} />
                )}
                <button
                  id="btn-export-dropdown"
                  onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
                  disabled={!videoFile && clips.length === 0}
                  className="flex shrink-0 items-center gap-1.5 whitespace-nowrap bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-lg shadow-emerald-500/10 disabled:opacity-50 transition-all cursor-pointer z-50 relative"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>导出</span>
                  <ChevronDown className="w-3 h-3 ml-0.5" />
                </button>

                {isExportDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 p-3.5 space-y-3.5 animate-fade-in text-left">
                    <div className="border-b border-slate-800 pb-2">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">选择导出格式与音轨</span>
                    </div>

                    <div className="grid grid-cols-4 gap-2 rounded-lg border border-slate-800 bg-slate-950/70 p-2">
                      <label className="space-y-1">
                        <span className="block text-[9px] font-bold uppercase text-slate-500">格式</span>
                        <select
                          value={exportAudioFormat}
                          onChange={(event) => {
                            setExportAudioFormat(event.target.value as ExportAudioFormat);
                            setMixedVideoUrl(null);
                            setExportedMixedUrl(null);
                            setExportedStemsUrl(null);
                          }}
                          className="w-full rounded border border-slate-800 bg-slate-900 px-1.5 py-1 text-[10px] font-bold text-slate-200 outline-none focus:border-indigo-500"
                        >
                          <option value="mp3">MP3</option>
                          <option value="wav">WAV</option>
                          <option value="aac">AAC</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[9px] font-bold uppercase text-slate-500">采样率</span>
                        <select
                          value={exportSampleRate}
                          onChange={(event) => {
                            setExportSampleRate(Number(event.target.value));
                            setMixedVideoUrl(null);
                            setExportedMixedUrl(null);
                            setExportedStemsUrl(null);
                          }}
                          className="w-full rounded border border-slate-800 bg-slate-900 px-1.5 py-1 text-[10px] font-bold text-slate-200 outline-none focus:border-indigo-500"
                        >
                          <option value={44100}>44.1k</option>
                          <option value={48000}>48k</option>
                          <option value={96000}>96k</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[9px] font-bold uppercase text-slate-500">比特率</span>
                        <select
                          value={exportBitrate}
                          onChange={(event) => {
                            setExportBitrate(event.target.value);
                            setMixedVideoUrl(null);
                            setExportedMixedUrl(null);
                            setExportedStemsUrl(null);
                          }}
                          disabled={exportAudioFormat === 'wav'}
                          className="w-full rounded border border-slate-800 bg-slate-900 px-1.5 py-1 text-[10px] font-bold text-slate-200 outline-none focus:border-indigo-500 disabled:opacity-40"
                        >
                          <option value="128k">128k</option>
                          <option value="192k">192k</option>
                          <option value="256k">256k</option>
                          <option value="320k">320k</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[9px] font-bold uppercase text-slate-500">Bit</span>
                        <select
                          value={exportBitDepth}
                          onChange={(event) => {
                            setExportBitDepth(Number(event.target.value) as ExportBitDepth);
                            setMixedVideoUrl(null);
                            setExportedMixedUrl(null);
                            setExportedStemsUrl(null);
                          }}
                          disabled={exportAudioFormat !== 'wav'}
                          title={exportAudioFormat === 'wav' ? 'WAV PCM 比特深度' : 'Bit depth 仅适用于 WAV/PCM'}
                          className="w-full rounded border border-slate-800 bg-slate-900 px-1.5 py-1 text-[10px] font-bold text-slate-200 outline-none focus:border-indigo-500 disabled:opacity-40"
                        >
                          <option value={16}>16bit</option>
                          <option value={24}>24bit</option>
                          <option value={32}>32bit</option>
                        </select>
                      </label>
                    </div>

                    <div className="space-y-2.5">
                      {/* 1. Mix & Export Video */}
                      <div className="p-2.5 bg-slate-950 hover:bg-slate-950/80 rounded-lg border border-slate-800/60 transition-all">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FileVideo className="w-3.5 h-3.5 text-emerald-400" />
                            <div>
                              <p className="text-[11px] font-bold text-slate-200">导出已混音视频</p>
                              <p className="text-[9px] text-slate-500">将制作音轨混合到视频中</p>
                            </div>
                          </div>
                          {isMixing ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                          ) : (
                            <button
                              onClick={() => {
                                handleExportVideo();
                                setIsExportDropdownOpen(false);
                              }}
                              disabled={!videoFile}
                              className="text-[10px] font-bold bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white px-2 py-1 rounded transition-colors cursor-pointer"
                            >
                              开始合成
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 2. Master Mixed Audio */}
                      <div className="p-2.5 bg-slate-950 hover:bg-slate-950/80 rounded-lg border border-slate-800/60 transition-all">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                            <div>
                              <p className="text-[11px] font-bold text-slate-200">制作音轨 Master</p>
                              <p className="text-[9px] text-slate-500">所有未静音音轨合并 (.{exportAudioFormat})</p>
                            </div>
                          </div>
                          {isExportingMixed ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                          ) : exportedMixedUrl ? (
                            <a
                              href={`/api/sfx/download-file?path=${encodeURIComponent(exportedMixedUrl)}&name=${encodeURIComponent(`master_mixed_soundtrack_${exportSampleRate}_${exportBitDepth}bit_${exportBitrate}.${exportAudioFormat}`)}`}
                              className="text-[10px] font-bold bg-indigo-600 text-white px-2 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <Download className="w-2.5 h-2.5" />
                              下载
                            </a>
                          ) : (
                            <button
                              onClick={() => handleExportAudio('mixed')}
                              disabled={clips.filter(c => c.audioUrl).length === 0}
                              className="text-[10px] font-bold bg-indigo-600/20 hover:bg-indigo-600 text-indigo-400 hover:text-white px-2 py-1 rounded transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              导出
                            </button>
                          )}
                        </div>
                        {exportedMixedUrl && (
                          <div className="mt-2 pt-1.5 border-t border-slate-800/40">
                            <audio src={exportedMixedUrl} controls className="w-full h-6 rounded bg-slate-900" />
                          </div>
                        )}
                      </div>

                      {/* 3. Export all stems */}
                      <div className="p-2.5 bg-slate-950 hover:bg-slate-950/80 rounded-lg border border-slate-800/60 transition-all">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                            <div>
                              <p className="text-[11px] font-bold text-slate-200">分轨导出</p>
                              <p className="text-[9px] text-slate-500">下方每个未静音轨道单独导出并打包 ZIP</p>
                            </div>
                          </div>
                          {isExportingStems ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                          ) : exportedStemsUrl ? (
                            <a
                              href={`/api/sfx/download-file?path=${encodeURIComponent(exportedStemsUrl)}&name=${encodeURIComponent(`track_stems_${exportAudioFormat}_${exportSampleRate}_${exportBitDepth}bit_${exportBitrate}.zip`)}`}
                              className="text-[10px] font-bold bg-cyan-600 text-white px-2 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <Download className="w-2.5 h-2.5" />
                              下载
                            </a>
                          ) : (
                            <button
                              onClick={handleExportStems}
                              disabled={clips.filter(c => c.audioUrl && !tracks.find(track => track.id === c.trackId)?.isMuted).length === 0}
                              className="text-[10px] font-bold bg-cyan-600/20 hover:bg-cyan-600 text-cyan-400 hover:text-white px-2 py-1 rounded transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              导出
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 4. SFX Stem */}
                      <div className="hidden p-2.5 bg-slate-950 hover:bg-slate-950/80 rounded-lg border border-slate-800/60 transition-all">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Waves className="w-3.5 h-3.5 text-blue-400" />
                            <div>
                              <p className="text-[11px] font-bold text-slate-200">SFX 独立音效分轨</p>
                              <p className="text-[9px] text-slate-500">仅包含短音效音轨 (.mp3)</p>
                            </div>
                          </div>
                          {isExportingSfx ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                          ) : exportedSfxUrl ? (
                            <a
                              href={`/api/sfx/download-file?path=${encodeURIComponent(exportedSfxUrl)}&name=${encodeURIComponent('sfx_track_stem.mp3')}`}
                              className="text-[10px] font-bold bg-blue-600 text-white px-2 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <Download className="w-2.5 h-2.5" />
                              下载
                            </a>
                          ) : (
                            <button
                              onClick={() => handleExportAudio('sfx')}
                              disabled={clips.filter(c => c.audioUrl && c.trackId === 'sfx').length === 0}
                              className="text-[10px] font-bold bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white px-2 py-1 rounded transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              导出
                            </button>
                          )}
                        </div>
                        {exportedSfxUrl && (
                          <div className="mt-2 pt-1.5 border-t border-slate-800/40">
                            <audio src={exportedSfxUrl} controls className="w-full h-6 rounded bg-slate-900" />
                          </div>
                        )}
                      </div>

                      {/* 5. Dubbing Stem */}
                      <div className="hidden p-2.5 bg-slate-950 hover:bg-slate-950/80 rounded-lg border border-slate-800/60 transition-all">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Mic className="w-3.5 h-3.5 text-purple-400" />
                            <div>
                              <p className="text-[11px] font-bold text-slate-200">Dubbing 旁白配音分轨</p>
                              <p className="text-[9px] text-slate-500">仅包含旁白台词音轨 (.mp3)</p>
                            </div>
                          </div>
                          {isExportingDubbing ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                          ) : exportedDubbingUrl ? (
                            <a
                              href={`/api/sfx/download-file?path=${encodeURIComponent(exportedDubbingUrl)}&name=${encodeURIComponent('dubbing_track_stem.mp3')}`}
                              className="text-[10px] font-bold bg-purple-600 text-white px-2 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <Download className="w-2.5 h-2.5" />
                              下载
                            </a>
                          ) : (
                            <button
                              onClick={() => handleExportAudio('dubbing')}
                              disabled={clips.filter(c => c.audioUrl && c.trackId === 'dubbing').length === 0}
                              className="text-[10px] font-bold bg-purple-600/20 hover:bg-purple-600 text-purple-400 hover:text-white px-2 py-1 rounded transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              导出
                            </button>
                          )}
                        </div>
                        {exportedDubbingUrl && (
                          <div className="mt-2 pt-1.5 border-t border-slate-800/40">
                            <audio src={exportedDubbingUrl} controls className="w-full h-6 rounded bg-slate-900" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* 核心工作流画布 */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {!showDAW ? (
          /* 上传导入界面 */
          <div id="daw-empty-state" className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-900">
            <div className="max-w-md w-full bg-slate-950 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl relative overflow-hidden">
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
              <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />

              <div className="w-16 h-16 bg-indigo-500/10 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner">
                <Film className="w-8 h-8" />
              </div>

              <h2 className="text-base font-bold text-slate-200 mb-2">导入视频开始创作</h2>
              <p className="text-xs text-slate-400 mb-6 leading-relaxed">
                上传您的视频（支持 MP4 格式），多模态 AI 将自动解析视频并推荐完美的音效、BGM 与配音时间轴。
              </p>

              <label 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer group transition-all ${
                  isDraggingOver 
                    ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02]' 
                    : 'border-slate-800 hover:border-indigo-500/50 bg-slate-900/50 hover:bg-indigo-500/5'
                }`}
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6 px-4 pointer-events-none">
                  {isUploading ? (
                    <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
                  ) : (
                    <Upload className={`w-8 h-8 mb-3 transition-colors ${isDraggingOver ? 'text-indigo-400' : 'text-slate-500 group-hover:text-indigo-400'}`} />
                  )}
                  <p className={`text-xs font-semibold transition-colors ${isDraggingOver ? 'text-indigo-300' : 'text-slate-400 group-hover:text-slate-200'}`}>
                    {isUploading ? '正在上传您的视频并提取时长...' : isDraggingOver ? '松开鼠标立即上传视频' : '点击或拖拽视频到此处上传'}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">推荐 H.264 MP4，单个视频最大 100MB</p>
                </div>
                <input 
                  type="file" 
                  accept="video/mp4,video/*" 
                  className="hidden" 
                  onChange={handleVideoUpload}
                  disabled={isUploading}
                />
              </label>

              {error && (
                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2.5 text-xs text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="text-left font-medium leading-normal">{error}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* DAW 剪辑视图 */
          <div id="video-workspace-pane" className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
            {/* 左侧：播放器与波形面板 */}
            <div className="flex-1 min-h-0 flex flex-col bg-slate-950 border-r border-slate-800 overflow-y-auto custom-scrollbar px-6 pt-6 pb-0">
              
              {/* 后台同步上传进度条 */}
              {isUploadingToServer && (
                <div className="mb-4 bg-slate-900 border border-indigo-500/20 rounded-xl p-3 flex items-center justify-between shadow-lg">
                  <div className="flex items-center gap-2.5">
                    <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-200">正在后台传输视频到服务器...</span>
                      <span className="text-[10px] text-slate-400">大视频需要时间上传。传输完成后即可开启 AI 自动解析及混音。</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold font-mono text-indigo-400 shrink-0">{uploadProgress}%</span>
                    <div className="w-24 bg-slate-800 rounded-full h-1.5 overflow-hidden hidden sm:block">
                      <div 
                        className="bg-gradient-to-r from-indigo-500 to-violet-500 h-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {showSyncSuccess && (
                <div className="mb-4 bg-emerald-950/20 border border-emerald-500/20 rounded-xl p-3 flex items-center justify-between gap-2.5 shadow-sm animate-fade-in">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0" />
                    <span className="text-xs text-emerald-400 font-medium">视频文件已成功同步至服务器；AI 分析与最终混音会在使用时检查对应服务。</span>
                  </div>
                  <button
                    onClick={() => setShowSyncSuccess(false)}
                    className="text-emerald-500 hover:text-emerald-400 p-1 rounded hover:bg-emerald-900/20 transition-colors cursor-pointer"
                    title="关闭"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="w-full flex-1 min-h-[180px] flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-t-xl overflow-hidden relative shadow-inner">
                {/* Shared workspace/timeline height resizer */}
                <div 
                  className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize bg-slate-800/20 hover:bg-indigo-500/50 active:bg-indigo-600 transition-colors z-40" 
                  onMouseDown={startTimelineResize}
                />
                {!videoFile ? (
                  <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center z-20">
                    <Film className="w-12 h-12 text-slate-600 mb-3 animate-pulse" />
                    <h3 className="text-sm font-bold text-slate-200 mb-1">无视频文件</h3>
                    <p className="text-xs text-slate-400 max-w-sm mb-4 leading-relaxed">
                      当前工程没有关联的视频文件。您仍然可以正常播放、编辑和调试所有音频轨道。
                    </p>
                    <label className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-lg shadow-indigo-600/20 cursor-pointer transition-colors">
                      <Upload className="w-4 h-4" />
                      <span>导入并关联本地视频</span>
                      <input type="file" accept="video/mp4,video/*" onChange={handleVideoRelink} className="hidden" />
                    </label>
                  </div>
                ) : videoLoadFailed ? (
                  <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center z-20">
                    <AlertCircle className="w-12 h-12 text-amber-500 mb-3" />
                    <h3 className="text-sm font-bold text-slate-200 mb-1">视频无法加载播放</h3>
                    <p className="text-xs text-slate-400 max-w-sm mb-4">
                      这可能是因为本地临时缓存已失效、浏览器被清理、或服务器已重启。
                    </p>
                    <label className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-lg shadow-indigo-600/20 cursor-pointer transition-colors">
                      <Upload className="w-4 h-4" />
                      <span>重新关联并再次上传本地视频</span>
                      <input type="file" accept="video/mp4,video/*" onChange={handleVideoRelink} className="hidden" />
                    </label>
                    <p className="text-[10px] text-slate-500 mt-2">重新关联相同的视频文件即可恢复画面播放，您的已有音轨片段将不受影响。</p>
                  </div>
                ) : (
                  <video
                    ref={videoRef}
                    src={videoFile.url}
                    muted={hasOriginalAudioClip}
                    className="max-h-full max-w-full object-contain"
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleVideoLoaded}
                    onDurationChange={handleVideoLoaded}
                    onError={handleVideoError}
                    onEnded={() => setIsPlaying(false)}
                    onClick={togglePlay}
                  />
                )}
 
                {/* 视频浮动控制条 (已去掉播放按键，仅显示进度时间) */}
                {videoFile && !videoLoadFailed && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-slate-950/90 border border-slate-800/80 px-4 py-1.5 rounded-full shadow-2xl">
                    <div className="text-xs font-mono text-slate-300 select-none">
                      {currentTime.toFixed(2)}s / {safeDuration.toFixed(2)}s
                    </div>
                  </div>
                )}
              </div>
 
              {/* 导出混音视频后的播放展示 */}
              {mixedVideoUrl && (
                <motion.div 
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 p-4 bg-emerald-950/30 border border-emerald-500/20 rounded-xl"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                      <span className="text-xs font-bold text-emerald-400">已混音视频生成完毕！</span>
                    </div>
                    <a 
                      href={`/api/sfx/download-file?path=${encodeURIComponent(mixedVideoUrl)}&name=${encodeURIComponent(`mixed_${(videoFile?.name || 'video').replace(/\.[^/.]+$/, '')}.${getUrlFileExtension(mixedVideoUrl, 'mp4')}`)}`}
                      className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-md transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      下载最终视频
                    </a>
                  </div>
                  <video 
                    controls 
                    src={mixedVideoUrl} 
                    className="w-full rounded-lg border border-slate-800 aspect-video max-h-56 bg-black"
                  />
                </motion.div>
              )}



              {error && (
                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2.5 text-xs text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-medium leading-normal">{error}</span>
                </div>
              )}
            </div>

            {/* 右侧：属性调节面板 (Property Panel) */}
            <div 
              id="properties-panel-container"
              className="bg-slate-900 border-l border-slate-800 flex flex-col overflow-hidden shrink-0 relative w-full h-[var(--property-panel-mobile-height)] max-h-[calc(100%-3.75rem)] md:w-[var(--property-panel-width)] md:h-full md:max-h-none"
              style={{
                '--property-panel-width': `${propertyWidth}px`,
                '--property-panel-mobile-height': `${propertyHeight}px`
              } as React.CSSProperties}
            >
              {/* Docked panel: drag left, bottom, or the bottom-left corner. */}
              <div 
                data-testid="property-resize-width"
                role="separator"
                tabIndex={0}
                aria-label="调整属性配置面板宽度"
                aria-orientation="vertical"
                aria-valuemin={280}
                aria-valuemax={640}
                aria-valuenow={Math.round(propertyWidth)}
                title="左右拖动调整属性面板宽度；双击恢复默认"
                className={`absolute top-0 bottom-0 left-0 hidden md:block w-2 cursor-ew-resize touch-none transition-colors z-50 focus:outline-none focus:bg-indigo-500/40 ${propertyResizeAxis === 'width' ? 'bg-indigo-500/50' : 'bg-transparent hover:bg-indigo-500/35'}`}
                onPointerDown={(e) => startPropertyResize(e, 'width')}
                onKeyDown={handlePropertyWidthKeyDown}
                onDoubleClick={resetPropertyPanelSize}
              >
                <span className="pointer-events-none absolute left-0.5 top-1/2 -translate-y-1/2 w-1 h-12 rounded-full bg-slate-600/60" />
              </div>
              <div 
                data-testid="property-resize-height"
                role="separator"
                tabIndex={0}
                aria-label="调整属性配置面板高度"
                aria-orientation="horizontal"
                title="上下拖动调整属性面板高度；双击恢复默认"
                className={`absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize touch-none transition-colors z-50 focus:outline-none focus:bg-indigo-500/40 ${propertyResizeAxis === 'height' ? 'bg-indigo-500/50' : 'bg-transparent hover:bg-indigo-500/35'}`}
                onPointerDown={(e) => startPropertyResize(e, 'height')}
                onKeyDown={handlePropertyHeightKeyDown}
                onDoubleClick={resetPropertyPanelSize}
              >
                <span className="pointer-events-none absolute left-1/2 bottom-0.5 -translate-x-1/2 w-12 h-1 rounded-full bg-slate-600/60" />
              </div>
              <div
                data-testid="property-resize-corner"
                role="button"
                tabIndex={0}
                aria-label="同时调整属性配置面板宽度和高度"
                title="斜向拖动同时调整宽度和高度；双击恢复默认"
                className={`absolute bottom-0 left-0 hidden md:flex w-5 h-5 items-end justify-start cursor-nesw-resize touch-none z-[60] rounded-tr-md transition-colors focus:outline-none focus:bg-indigo-500/60 ${propertyResizeAxis === 'both' ? 'bg-indigo-500/60' : 'bg-slate-800/80 hover:bg-indigo-500/50'}`}
                onPointerDown={(e) => startPropertyResize(e, 'both')}
                onKeyDown={handlePropertyCornerKeyDown}
                onDoubleClick={resetPropertyPanelSize}
              >
                <span className="pointer-events-none mb-1 ml-1 block w-2 h-2 border-l border-b border-slate-400" />
              </div>
              <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
                <div className="flex items-center gap-2 pl-2">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-slate-300">属性配置面板</span>
                </div>
                {selectedClip && !selectedClipIsOriginalAudio && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleCopyClip(selectedClip)}
                      className="text-slate-500 hover:text-indigo-400 p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                      title="复制片段 (Ctrl+C)"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteClip(selectedClip.id)}
                      className="text-slate-500 hover:text-red-400 p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                      title="删除此音频块"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div data-testid="properties-panel-scroll" className="p-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-5">
                {selectedTrack ? (
                  <div data-testid={`track-properties-${selectedTrack.id}`} className="space-y-4">
                    <div className={`rounded-xl border p-3 ${
                      selectedTrack.type === 'dubbing'
                        ? 'border-purple-500/25 bg-purple-950/20'
                        : 'border-indigo-500/20 bg-indigo-950/15'
                    }`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          {selectedTrack.type === 'dubbing' ? (
                            <Mic className="h-4 w-4 shrink-0 text-purple-400" />
                          ) : selectedTrack.type === 'bgm' ? (
                            <Music className="h-4 w-4 shrink-0 text-emerald-400" />
                          ) : selectedTrack.type === 'original' ? (
                            <Film className="h-4 w-4 shrink-0 text-amber-400" />
                          ) : (
                            <Waves className="h-4 w-4 shrink-0 text-blue-400" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-slate-200">
                              {selectedTrack.type === 'dubbing' ? '配音轨设置' : selectedTrack.type === 'original' ? '视频原声轨设置' : '轨道设置'}
                            </p>
                            <p className="mt-0.5 truncate text-[10px] text-slate-500">{selectedTrack.name}</p>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-400">
                          {selectedTrack.type === 'dubbing' ? '配音' : selectedTrack.type === 'bgm' ? '配乐' : selectedTrack.type === 'original' ? '原声' : '音效'}
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">轨道名称</label>
                      <input
                        type="text"
                        value={selectedTrack.name}
                        onChange={(event) => updateTrackName(selectedTrack.id, event.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <label
                            htmlFor={`track-volume-${selectedTrack.id}`}
                            className="text-[10px] font-bold uppercase tracking-wider text-slate-400"
                          >
                            轨道总音量
                          </label>
                          <p className="mt-0.5 text-[9px] leading-relaxed text-slate-600">
                            统一控制本轨全部片段，片段独立音量保持不变
                          </p>
                        </div>
                        <span className="shrink-0 rounded-md bg-indigo-500/10 px-2 py-1 font-mono text-[10px] font-bold text-indigo-300">
                          {Math.round(normalizeUnitVolume(selectedTrack.volume, DEFAULT_VOLUME_FADER) * 100)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Volume2 className="h-4 w-4 shrink-0 text-slate-500" />
                        <input
                          id={`track-volume-${selectedTrack.id}`}
                          data-testid={`track-volume-${selectedTrack.id}`}
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={normalizeUnitVolume(selectedTrack.volume, DEFAULT_VOLUME_FADER)}
                          onChange={(event) => updateTrackVolume(selectedTrack.id, Number.parseFloat(event.target.value))}
                          disabled={isTrackVolumeLocked}
                          aria-label={`${selectedTrack.name}轨道总音量`}
                          className="h-1.5 flex-1 cursor-pointer rounded-lg bg-slate-950 accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </div>
                      {isTrackVolumeLocked && (
                        <p className="mt-2 text-[9px] text-amber-400">正在混音或导出，完成后可继续调整。</p>
                      )}
                    </div>

                    {selectedTrack.type === 'original' && (
                      <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">视频原声轨说明</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                          这里用于控制整条原声轨的音量、静音和导出参与状态。需要拆分人声/音乐时，请点击时间轴里的“视频原声”音频片段，在片段属性面板中处理；单独音效建议在音效轨里新增或上传。
                        </p>
                      </div>
                    )}

                    {selectedTrack.type === 'bgm' && (
                      <div className="space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-950/15 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">音乐替换分析</p>
                          <Music className="h-5 w-5 shrink-0 text-emerald-400" />
                        </div>
                        <button
                          type="button"
                          onClick={handleMusicReplacementWorkflow}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold text-emerald-200 transition-colors hover:bg-emerald-500/20 hover:text-white"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>分析画面与原音乐，生成替换提示词</span>
                        </button>
                      </div>
                    )}

                    {selectedTrack.type === 'dubbing' ? (
                      <div className="space-y-3 border-t border-slate-800 pt-4">
                        <div className="space-y-3 rounded-xl border border-purple-500/25 bg-purple-950/20 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-purple-300">相似声音匹配 / 参考</p>
                              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                                从拆分出来的人声轨提取当前角色的音色、语气和情绪参考，再应用到本配音轨的局部重配。
                              </p>
                            </div>
                            <Mic className="h-5 w-5 shrink-0 text-purple-400" />
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleMatchSimilarVoicesWorkflow()}
                            disabled={isMatchingSimilarVoices}
                            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-[10px] font-bold text-purple-200 transition-colors hover:bg-purple-500/20 hover:text-white disabled:cursor-wait disabled:opacity-60"
                          >
                            {isMatchingSimilarVoices ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                            <span>{isMatchingSimilarVoices ? '正在匹配相似声音...' : '匹配 ElevenLabs 相似声音'}</span>
                          </button>
                          <p className="text-[9px] leading-relaxed text-slate-600">
                            建议优先使用已授权声音；匹配后可在下方声音库中试听并应用到整条配音轨，或只用于选中短句的局部修补。
                          </p>
                        </div>

                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">轨道默认声音</p>
                            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                              本轨所有配音片段默认使用此声音。更换后，已生成片段需要重新合成。
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void loadVoices()}
                            disabled={isLoadingVoices}
                            className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-slate-800 bg-slate-950 px-2 text-[9px] font-bold text-slate-400 hover:text-white disabled:cursor-wait disabled:opacity-50"
                            aria-label="刷新声音库"
                            title="刷新声音库"
                          >
                            <RotateCcw className={`h-3 w-3 ${isLoadingVoices ? 'animate-spin' : ''}`} />
                            <span>刷新</span>
                          </button>
                        </div>

                        <div className="rounded-lg border border-purple-500/25 bg-purple-950/20 p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className={`h-2 w-2 shrink-0 rounded-full ${selectedTrackVoice?.gender === 'male' ? 'bg-blue-500' : 'bg-pink-500'}`} />
                              <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-purple-200">
                                  {selectedTrackVoice?.name || '默认配音声音'}
                                </p>
                                <p className="mt-0.5 truncate text-[9px] text-slate-500">
                                  {selectedTrackVoice?.category || selectedTrackVoiceId}
                                </p>
                              </div>
                            </div>
                            {selectedTrackVoice && (
                              <button
                                type="button"
                                onClick={(event) => handlePlayVoicePreview(selectedTrackVoice.id, selectedTrackVoice.previewUrl, event)}
                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all ${
                                  playingVoiceId === selectedTrackVoice.id
                                    ? 'border-purple-500 bg-purple-600 text-white'
                                    : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-white'
                                }`}
                                aria-label={playingVoiceId === selectedTrackVoice.id ? `暂停试听${selectedTrackVoice.name}` : `试听${selectedTrackVoice.name}`}
                                title={playingVoiceId === selectedTrackVoice.id ? '暂停试听' : '试听当前声音'}
                              >
                                {playingVoiceId === selectedTrackVoice.id ? (
                                  <Pause className="h-3 w-3 fill-current" />
                                ) : (
                                  <Play className="ml-0.5 h-3 w-3 fill-current" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="relative">
                          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                          <input
                            type="text"
                            aria-label="搜索声音"
                            value={voiceSearchQuery}
                            onChange={(event) => setVoiceSearchQuery(event.target.value)}
                            placeholder="搜索声音名称、分类或标签..."
                            className="w-full rounded-lg border border-slate-800 bg-slate-950 py-2 pl-8 pr-8 text-[11px] text-slate-200 placeholder-slate-600 focus:border-purple-500 focus:outline-none"
                          />
                          {voiceSearchQuery && (
                            <button
                              type="button"
                              onClick={() => setVoiceSearchQuery('')}
                              className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-300"
                              aria-label="清除声音搜索"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          {(['all', 'male', 'female'] as const).map(gender => (
                            <button
                              key={gender}
                              type="button"
                              onClick={() => setVoiceGenderFilter(gender)}
                              aria-pressed={voiceGenderFilter === gender}
                              className={`rounded px-2 py-1 text-[9px] font-bold transition-colors ${
                                voiceGenderFilter === gender
                                  ? gender === 'male'
                                    ? 'bg-blue-600 text-white'
                                    : gender === 'female'
                                      ? 'bg-pink-600 text-white'
                                      : 'bg-purple-600 text-white'
                                  : 'bg-slate-950 text-slate-400 hover:bg-slate-800'
                              }`}
                            >
                              {gender === 'all' ? '全部' : gender === 'male' ? '男声' : '女声'}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar">
                          {VOICE_CATEGORIES.map(category => {
                            if (category === '我的克隆' && !displayVoices.some(voice => voice.category === '我的克隆')) return null;
                            return (
                              <button
                                key={category}
                                type="button"
                                onClick={() => setVoiceActiveCategory(category)}
                                aria-pressed={voiceActiveCategory === category}
                                className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-bold transition-colors ${
                                  voiceActiveCategory === category
                                    ? 'border-purple-500/50 bg-purple-950/50 text-purple-300'
                                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                                }`}
                              >
                                {category}
                              </button>
                            );
                          })}
                        </div>

                        {similarVoiceRecommendations.length > 0 && (
                          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2 text-[10px] leading-relaxed text-emerald-100">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-emerald-300">已显示相似声音推荐</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setSimilarVoiceRecommendations([]);
                                  setSimilarVoiceSourceDescription('');
                                }}
                                className="shrink-0 rounded border border-emerald-500/30 px-1.5 py-0.5 text-[9px] font-bold text-emerald-200 hover:bg-emerald-500/20"
                              >
                                清除推荐
                              </button>
                            </div>
                            {similarVoiceSourceDescription && (
                              <p className="mt-1 text-emerald-100/70">{similarVoiceSourceDescription}</p>
                            )}
                          </div>
                        )}

                        <div className="max-h-72 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
                          {isLoadingVoices ? (
                            <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-slate-500">
                              <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                              <span>正在同步 ElevenLabs 声音库...</span>
                            </div>
                          ) : filteredVoiceOptions.length === 0 ? (
                            <div className="py-8 text-center text-[11px] text-slate-500">未找到匹配的声音</div>
                          ) : (
                            filteredVoiceOptions.map(voice => {
                              const isSelected = selectedTrackVoiceId === voice.id;
                              const isVoicePlaying = playingVoiceId === voice.id;
                              const similarRecommendation = similarVoiceRecommendationById.get(voice.id);
                              return (
                                <div
                                  key={voice.id}
                                  className={`flex items-start justify-between gap-2 rounded-lg border p-2 transition-all ${
                                    isSelected
                                      ? 'border-purple-500/45 bg-purple-500/10'
                                      : 'border-transparent hover:border-slate-800 hover:bg-slate-800/40'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    data-testid={`track-voice-option-${voice.id}`}
                                    onClick={() => handleTrackVoiceChange(selectedTrack.id, voice.id)}
                                    aria-pressed={isSelected}
                                    className="min-w-0 flex-1 cursor-pointer text-left"
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${voice.gender === 'male' ? 'bg-blue-500' : 'bg-pink-500'}`} />
                                      <span className="truncate text-xs font-bold text-slate-200">{voice.name}</span>
                                      <span className="shrink-0 rounded border border-slate-800 bg-slate-950 px-1 text-[9px] text-slate-500">{voice.category}</span>
                                    </div>
                                    <p className="mt-1 truncate text-[10px] text-slate-500">{voice.description}</p>
                                    {similarRecommendation && (
                                      <div className="mt-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[9px] leading-relaxed text-emerald-200">
                                        <span className="font-bold text-emerald-300">相似度 {Math.round(similarRecommendation.score)}%</span>
                                        <span className="ml-1 text-emerald-200/80">{similarRecommendation.reason}</span>
                                      </div>
                                    )}
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {voice.tags.slice(0, 3).map(tag => (
                                        <span key={tag} className="rounded-sm bg-purple-500/10 px-1 text-[9px] text-purple-400">#{tag}</span>
                                      ))}
                                    </div>
                                  </button>
                                  <div className="flex shrink-0 items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={(event) => handlePlayVoicePreview(voice.id, voice.previewUrl, event)}
                                      className={`flex h-6 w-6 items-center justify-center rounded-full border transition-all ${
                                        isVoicePlaying
                                          ? 'border-purple-500 bg-purple-600 text-white'
                                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                                      }`}
                                      aria-label={isVoicePlaying ? `暂停试听${voice.name}` : `试听${voice.name}`}
                                      title={isVoicePlaying ? '暂停试听' : '试听声音'}
                                    >
                                      {isVoicePlaying ? (
                                        <Pause className="h-3 w-3 fill-current" />
                                      ) : (
                                        <Play className="ml-0.5 h-3 w-3 fill-current" />
                                      )}
                                    </button>
                                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                                      isSelected
                                        ? 'border-purple-600 bg-purple-600 text-white'
                                        : 'border-slate-700 bg-slate-950'
                                    }`}>
                                      {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                                    </span>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>

                        {selectedTrackVoice && (
                          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-[10px] text-slate-400">
                            <p className="font-semibold text-purple-300">{selectedTrackVoice.name} · {selectedTrackVoice.category}</p>
                            <p className="mt-1 leading-relaxed">{selectedTrackVoice.description}</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[10px] leading-relaxed text-slate-500">
                        此轨道包含 {clips.filter(clip => clip.trackId === selectedTrack.id).length} 个音频片段，当前
                        {selectedTrack.isMuted
                          ? '处于静音状态，试听与导出均不参与'
                          : selectedTrack.isSoloed
                            ? '处于独奏试听状态，导出仍按静音状态决定'
                            : '正常参与播放与导出'}。
                      </div>
                    )}
                  </div>
                ) : selectedClip ? (
                  <div className="space-y-4">
                    {/* 标题 */}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">音频显示名称</label>
                      <input
                        type="text"
                        value={selectedClip.name}
                        onChange={(e) => updateClipField(selectedClip.id, 'name', e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    {/* 提示词 / Prompt */}
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">AI 生成提示词 (英文)</label>
                      <textarea
                        value={selectedClip.prompt}
                        onChange={(e) => updateClipField(selectedClip.id, 'prompt', e.target.value)}
                        className="w-full h-16 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none custom-scrollbar"
                      />
                    </div>

                    {selectedClipIsOriginalAudio && (
                      <div className="space-y-2 rounded-xl border border-amber-500/25 bg-amber-950/15 p-3">
                        <button
                          type="button"
                          onClick={() => void handleSplitOriginalAudioWorkflow()}
                          disabled={originalAudioSplitStatus === 'running'}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] font-bold text-amber-200 transition-colors hover:bg-amber-500/20 hover:text-white disabled:cursor-wait disabled:opacity-70"
                        >
                          {originalAudioSplitStatus === 'running' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Waves className="h-3.5 w-3.5" />
                          )}
                          <span>
                            {originalAudioSplitStatus === 'running'
                              ? '正在拆分与分析...'
                              : '拆分轨道并生成可编辑配音片段'}
                          </span>
                        </button>
                        {originalAudioSplitStatus !== 'idle' && (
                          <div className={`rounded-lg border p-2.5 ${
                            originalAudioSplitStatus === 'error'
                              ? 'border-red-500/25 bg-red-500/10'
                              : originalAudioSplitStatus === 'completed'
                                ? 'border-emerald-500/25 bg-emerald-500/10'
                                : 'border-amber-500/25 bg-slate-950/50'
                          }`}>
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <span className={`text-[10px] font-bold ${
                                originalAudioSplitStatus === 'error'
                                  ? 'text-red-300'
                                  : originalAudioSplitStatus === 'completed'
                                    ? 'text-emerald-300'
                                    : 'text-amber-200'
                              }`}>
                                {originalAudioSplitStage}
                              </span>
                              <span className="shrink-0 font-mono text-[10px] font-bold text-slate-400">
                                {Math.round(originalAudioSplitProgress)}%
                              </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-slate-950">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  originalAudioSplitStatus === 'error'
                                    ? 'bg-red-500'
                                    : originalAudioSplitStatus === 'completed'
                                      ? 'bg-emerald-500'
                                      : 'bg-amber-400'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(0, originalAudioSplitProgress))}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 配音文本内容 */}
                    {(selectedClip.trackId === 'dubbing' || tracks.find(t => t.id === selectedClip.trackId)?.type === 'dubbing') && (
                      <>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">字幕台词（每条字幕独立）</label>
                          <textarea
                            value={selectedClip.text || ''}
                            onChange={(e) => updateClipField(selectedClip.id, 'text', e.target.value)}
                            className="w-full h-16 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none custom-scrollbar"
                          />
                        </div>
                        <div className="rounded-xl border border-cyan-500/25 bg-cyan-950/20 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-200">字幕识别 / 可编辑台词片段</p>
                              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                                按视频画面里的字幕变化来分段；每个片段会带台词文案、语气提示词，并保留字幕时间和口型参考。
                              </p>
                            </div>
                            <Gauge className="h-5 w-5 shrink-0 text-cyan-300" />
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleLipFriendlyRewriteWorkflow()}
                            disabled={subtitleSegmentStatus === 'running'}
                            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[10px] font-bold text-cyan-100 transition-colors hover:bg-cyan-500/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {subtitleSegmentStatus === 'running' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                            <span>{subtitleSegmentStatus === 'running' ? '正在识别字幕并生成片段...' : '识别字幕并生成配音片段'}</span>
                          </button>
                          {subtitleSegmentStatus !== 'idle' && (
                            <div className={`mt-3 rounded-lg border px-2.5 py-2 ${
                              subtitleSegmentStatus === 'error'
                                ? 'border-red-500/25 bg-red-500/10'
                                : subtitleSegmentStatus === 'completed'
                                  ? 'border-emerald-500/25 bg-emerald-500/10'
                                  : 'border-cyan-500/25 bg-slate-950/50'
                            }`}>
                              <div className="mb-1.5 flex items-center justify-between gap-2">
                                <span className={`text-[10px] font-bold ${
                                  subtitleSegmentStatus === 'error'
                                    ? 'text-red-300'
                                    : subtitleSegmentStatus === 'completed'
                                      ? 'text-emerald-300'
                                      : 'text-cyan-200'
                                }`}>
                                  {subtitleSegmentStage}
                                </span>
                                <span className="shrink-0 font-mono text-[10px] font-bold text-slate-400">
                                  {Math.round(subtitleSegmentProgress)}%
                                </span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-950">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    subtitleSegmentStatus === 'error'
                                      ? 'bg-red-500'
                                      : subtitleSegmentStatus === 'completed'
                                        ? 'bg-emerald-500'
                                        : 'bg-cyan-400'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(0, subtitleSegmentProgress))}%` }}
                                />
                              </div>
                              {subtitleSegmentStatus === 'completed' && subtitleSegmentCount > 0 && (
                                <p className="mt-1.5 text-[10px] text-emerald-200">
                                  已写入 {subtitleSegmentCount} 个按字幕变化切分的配音片段。
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        {false && (
                        <div className="rounded-xl border border-rose-500/20 bg-rose-950/15 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-rose-300">局部文案修改 / 口型约束</p>
                              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                                修改这一句时优先保持原起止时间、停顿和情绪。后续会根据口型窗口提示“低/中/高”风险，并生成更贴口型的短句版本。
                              </p>
                            </div>
                            <Gauge className="h-5 w-5 shrink-0 text-rose-400" />
                          </div>
                          <button
                            type="button"
                            onClick={handleLipFriendlyRewriteWorkflow}
                            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[10px] font-bold text-rose-200 transition-colors hover:bg-rose-500/20 hover:text-white"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>检查口型风险并局部重配此句</span>
                          </button>
                        </div>
                        )}
                        {(() => {
                          const dubbingTrack = tracks.find(track => track.id === selectedClip.trackId);
                          const inheritedVoiceId = dubbingTrack?.defaultVoiceId || DEFAULT_DUBBING_VOICE_ID;
                          const inheritedVoice = displayVoices.find(voice => voice.id === inheritedVoiceId);
                          const usesUploadedAudio = Boolean(
                            selectedClip.audioUrl
                            && resolveClipAudioSource(selectedClip) === 'uploaded',
                          );
                          return (
                            <div className="rounded-xl border border-purple-500/20 bg-purple-950/15 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">配音声音</p>
                                  <p className="mt-1 truncate text-xs font-semibold text-purple-200">
                                    {usesUploadedAudio
                                      ? '本地音频覆盖轨道默认声音'
                                      : `继承自轨道：${inheritedVoice?.name || '默认配音声音'}`}
                                  </p>
                                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                                    {usesUploadedAudio
                                      ? `当前播放上传的原音频；重新 AI 合成后将使用“${dubbingTrack?.name || '配音轨'}”的 ${inheritedVoice?.name || '默认声音'}。`
                                      : `本片段跟随“${dubbingTrack?.name || '配音轨'}”的默认声音。`}
                                  </p>
                                </div>
                                <Mic className="h-5 w-5 shrink-0 text-purple-400" />
                              </div>
                              {selectedClip.voiceDirty && (
                                <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-300">
                                  轨道声音已变更，请重新合成此片段后再导出。
                                </div>
                              )}
                              {dubbingTrack && (
                                <button
                                  type="button"
                                  data-testid={`open-track-properties-${dubbingTrack.id}`}
                                  onClick={() => handleSelectTrack(dubbingTrack.id)}
                                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 py-2 text-[10px] font-bold text-purple-300 transition-colors hover:bg-purple-500/20 hover:text-white"
                                >
                                  <Sliders className="h-3.5 w-3.5" />
                                  <span>打开配音轨设置</span>
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        {/* 字幕 / 口型同步与自动语速 */}
                        {(() => {
                          const autoSpeed = normalizeAutoSpeed(selectedClip.autoSpeed);
                          const manualSpeed = normalizeManualSpeed(selectedClip.speed);
                          const effectiveSpeed = getEffectiveClipSpeed(selectedClip);
                          const hasLipWindow = normalizeOptionalTime(selectedClip.lipStartTime) !== undefined
                            && normalizeOptionalTime(selectedClip.lipEndTime) !== undefined
                            && (selectedClip.lipEndTime as number) > (selectedClip.lipStartTime as number);
                          const confidence = normalizeUnitVolume(selectedClip.lipSyncConfidence, 0);
                          const isAtAutoLimit = Boolean(
                            selectedClip.sourceAudioDuration
                            && (autoSpeed <= MIN_DUBBING_AUTO_SPEED || autoSpeed >= MAX_DUBBING_AUTO_SPEED),
                          );
                          return (
                            <div
                              data-testid={`dubbing-sync-details-${selectedClip.id}`}
                              className="mt-3.5 space-y-2 rounded-xl border border-indigo-500/20 bg-indigo-950/15 p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                  <Gauge className="h-3.5 w-3.5 text-indigo-400" />
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">字幕与口型同步</span>
                                </div>
                                <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-indigo-300">
                                  自动 {autoSpeed.toFixed(2)}x
                                </span>
                              </div>

                              <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 text-[10px] leading-relaxed">
                                <span className="text-slate-500">字幕区间</span>
                                <span className="font-mono text-slate-300">
                                  {formatSyncTime(selectedClip.subtitleStartTime)} – {formatSyncTime(selectedClip.subtitleEndTime)}
                                </span>
                                <span className="text-slate-500">口型区间</span>
                                <span className="font-mono text-slate-300">
                                  {hasLipWindow
                                    ? `${formatSyncTime(selectedClip.lipStartTime)} – ${formatSyncTime(selectedClip.lipEndTime)}`
                                    : '未可靠识别，使用字幕时间'}
                                </span>
                                <span className="text-slate-500">识别依据</span>
                                <span className="text-slate-300">
                                  {formatTimingSourceLabel(selectedClip.timingSource)}
                                  {selectedClip.speaker ? ` · ${selectedClip.speaker}` : ''}
                                  {confidence > 0 ? ` · 置信度 ${Math.round(confidence * 100)}%` : ''}
                                </span>
                                <span className="text-slate-500">时长拟合</span>
                                <span className="font-mono text-slate-300">
                                  {selectedClip.sourceAudioDuration
                                    ? `${selectedClip.sourceAudioDuration.toFixed(2)}s → ${selectedClip.duration.toFixed(2)}s`
                                    : `生成后自动匹配 ${selectedClip.duration.toFixed(2)}s`}
                                </span>
                              </div>

                              {selectedClip.timingDirty ? (
                                <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-300">
                                  台词或时间已发生变化，需要重新合成后才能混音或导出。
                                </div>
                              ) : isAtAutoLimit ? (
                                <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-300">
                                  自动语速已达到安全范围边界，建议缩短台词或调整字幕时间，以免影响自然度。
                                </div>
                              ) : (
                                <p className="text-[10px] leading-relaxed text-slate-500">
                                  系统按整句自然时长自动匹配字幕与口型窗口，不会在一句话中途改变语速。
                                </p>
                              )}

                              <div className="rounded-lg bg-slate-950/50 px-2.5 py-2 text-[10px] text-slate-400">
                                最终预览与导出速度：<span className="font-mono font-bold text-indigo-300">{effectiveSpeed.toFixed(2)}x</span>
                                <span className="ml-1 text-slate-600">（自动 × 后期微调）</span>
                              </div>
                            </div>
                          );
                        })()}

                        {/* 后期语速微调 */}
                        <div className="mt-3.5 pt-3.5 border-t border-slate-800/60">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <Gauge className="w-3.5 h-3.5 text-indigo-400" />
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">后期语速微调</label>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono font-bold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.2 rounded">
                                {normalizeManualSpeed(selectedClip.speed).toFixed(2)}x
                              </span>
                              {normalizeManualSpeed(selectedClip.speed) !== 1 ? (
                                <button
                                  type="button"
                                  onClick={() => updateClipField(selectedClip.id, 'speed', 1.0)}
                                  className="text-[9px] font-bold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-1.5 py-0.2 rounded transition-colors cursor-pointer"
                                >
                                  重置
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[9px] text-slate-500 font-medium">极慢</span>
                            <input
                              type="range"
                              min="0.5"
                              max="2.0"
                              step="0.05"
                              value={normalizeManualSpeed(selectedClip.speed)}
                              onChange={(e) => updateClipField(selectedClip.id, 'speed', parseFloat(e.target.value))}
                              className="flex-1 accent-indigo-500 bg-slate-950 h-1 rounded-lg cursor-pointer"
                            />
                            <span className="text-[9px] text-slate-500 font-medium">极快</span>
                          </div>
                          <p className="mt-2 text-[9px] leading-relaxed text-slate-600">
                            仅用于最后的听感微调；系统计算的字幕自动语速会继续保留。
                          </p>
                        </div>
                      </>
                    )}

                    {/* 音量控制 */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">独立音量</label>
                        <span className="text-[10px] font-mono text-slate-400">{Math.round(normalizeUnitVolume(selectedClip.volume, DEFAULT_VOLUME_FADER) * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Volume2 className="w-4 h-4 text-slate-500" />
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={normalizeUnitVolume(selectedClip.volume, DEFAULT_VOLUME_FADER)}
                          onChange={(e) => updateClipField(selectedClip.id, 'volume', parseFloat(e.target.value))}
                          className="flex-1 accent-indigo-500 bg-slate-950 h-1.5 rounded-lg cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* 时间参数 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">开始时间 (秒)</label>
                        <input
                          type="number"
                          min="0"
                          max={safeDuration}
                          step="0.1"
                          value={parseFloat(selectedClip.startTime.toFixed(2))}
                          onChange={(e) => updateClipField(selectedClip.id, 'startTime', Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono text-center"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">持续长度 (秒)</label>
                        <input
                          type="number"
                          min="0.5"
                          max="120"
                          step="0.5"
                          value={parseFloat(selectedClip.duration.toFixed(2))}
                          onChange={(e) => updateClipField(selectedClip.id, 'duration', Math.max(0.5, parseFloat(e.target.value) || 1))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono text-center"
                        />
                      </div>
                    </div>

                    {/* 单轨道合成状态 */}
                    <div className="pt-2 border-t border-slate-800">
                      {selectedClip.audioUrl ? (
                        <div className="flex flex-col gap-2">
                          <div className={`flex items-center justify-center gap-2 rounded-lg border p-2 text-xs font-semibold ${
                            selectedClip.voiceDirty || selectedClip.timingDirty
                              ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
                              : resolveClipAudioSource(selectedClip) === 'uploaded'
                                ? 'border-blue-500/20 bg-blue-500/10 text-blue-300'
                                : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                          }`}>
                            {selectedClip.voiceDirty || selectedClip.timingDirty ? (
                              <RotateCcw className="h-4 w-4 shrink-0" />
                            ) : (
                              <Check className="h-4 w-4 shrink-0" />
                            )}
                            <span>
                              {selectedClipIsOriginalAudio
                                ? '视频原声已关联'
                                : selectedClip.voiceDirty || selectedClip.timingDirty
                                ? selectedClip.timingDirty
                                  ? '台词或时间已变化，等待重新合成'
                                  : '等待应用新的轨道声音'
                                : resolveClipAudioSource(selectedClip) === 'uploaded'
                                  ? '本地音频已关联'
                                  : '音频已成功生成'}
                            </span>
                          </div>
                          {selectedClipIsOriginalAudio ? (
                            <p className="rounded-lg border border-amber-500/15 bg-amber-500/5 p-2 text-center text-[10px] leading-relaxed text-amber-200/80">
                              这条片段直接读取源视频里的原声音频。调整轨道音量或静音即可控制它，不需要 AI 合成。
                            </p>
                          ) : (
                            <button
                              onClick={() => handleGenerateAudioClip(selectedClip.id)}
                              disabled={selectedClip.isGenerating}
                              className="w-full flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60"
                            >
                              {selectedClip.isGenerating ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                              <span>
                                {selectedClip.isGenerating
                                  ? '合成音轨中...'
                                  : selectedClip.timingDirty
                                    ? '按新台词和时间重新合成'
                                    : selectedClip.voiceDirty
                                      ? '应用轨道声音并重新合成'
                                    : '重新合成此片段'}
                              </span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <div>
                          <button
                            onClick={() => handleGenerateAudioClip(selectedClip.id)}
                            disabled={selectedClip.isGenerating}
                            className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-2.5 rounded-lg shadow-lg shadow-indigo-500/20 disabled:opacity-50 cursor-pointer"
                          >
                            {selectedClip.isGenerating ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>合成音轨中...</span>
                              </>
                            ) : (
                              <>
                                <Music className="w-3.5 h-3.5" />
                                <span>合成此片段</span>
                              </>
                            )}
                          </button>
                          {!selectedClip.isGenerating && (
                            <p className="mt-1.5 text-center text-[9px] leading-relaxed text-slate-600">只生成当前片段，不会重新分析画面或改动其他音轨。</p>
                          )}
                        </div>
                      )}

                      {selectedClip.error && (
                        <p className="text-[10px] text-red-400 mt-2 text-center bg-red-500/5 border border-red-500/10 p-2 rounded">
                          {selectedClip.error}
                        </p>
                      )}
                    </div>

                    {!selectedClipIsOriginalAudio && (
                      <div className="pt-4 border-t border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">本地音频文件</label>
                          {selectedClip.audioUrl && (
                            <span className="text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold">
                              已关联音频
                            </span>
                          )}
                        </div>
                        <label className="flex flex-col items-center justify-center border border-dashed border-slate-800 hover:border-indigo-500/50 bg-slate-950/40 hover:bg-slate-950/80 rounded-xl p-3.5 text-center cursor-pointer transition-all group">
                          <Upload className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 mb-1 transition-colors" />
                          <span className="text-[10.5px] font-bold text-slate-400 group-hover:text-slate-200">
                            {selectedClip.isGenerating ? '正在上传音频...' : '选择本地音频上传'}
                          </span>
                          <span className="text-[9px] text-slate-600 mt-0.5">支持 MP3, WAV, AAC, M4A 格式</span>
                          <input
                            type="file"
                            accept="audio/*"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                await handleUploadClipAudio(selectedClip.id, file);
                              }
                              // Reset input value to allow uploading the same file again if needed
                              e.target.value = '';
                            }}
                            disabled={selectedClip.isGenerating}
                            className="hidden"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 p-4 space-y-3">
                    <Sliders className="w-8 h-8 text-slate-700 stroke-[1.5]" />
                    <div className="space-y-1">
                      <p className="text-xs">未选中轨道或音频片段</p>
                      <p className="text-[10px] text-slate-600 leading-normal">点击轨道名称配置整条轨道，或点击音频片段编辑片段属性。</p>
                    </div>
                    {copiedClip && (
                      <button
                        onClick={handlePasteClip}
                        className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-lg shadow-indigo-500/20 transition-all cursor-pointer"
                        title="粘贴已复制的片段 (Ctrl+V)"
                      >
                        <Clipboard className="w-3.5 h-3.5" />
                        <span>粘贴“{copiedClip.name}”</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 下部：多轨道时间轴 (DAW Timeline) */}
      {showDAW && (
        <div 
          id="daw-timeline-section" 
          className="bg-slate-950 border-t border-slate-800 p-4 flex flex-col shrink-0 select-none relative"
          style={{ height: `${timelineHeight}px` }}
        >
          {/* Timeline Height Resizer Handle */}
          <div 
            className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize bg-transparent hover:bg-indigo-500/50 active:bg-indigo-600 transition-colors z-50" 
            onMouseDown={startTimelineResize}
          />
          {/* Timeline Header with Zoom and Playback Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 px-2 pt-1">
            <div className="flex items-center gap-2 min-w-0">
              <Sliders className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="text-xs font-bold text-slate-300 truncate">多轨时间轴剪辑区</span>
              <button
                type="button"
                onClick={handleUndoTimelineEdit}
                disabled={undoStack.length === 0}
                aria-label="撤回上一步时间轴编辑"
                className="ml-2 flex h-7 w-7 items-center justify-center rounded border border-slate-700/70 bg-slate-900 text-slate-400 transition-all hover:border-indigo-500/50 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-35"
                title="撤回上一步时间轴编辑 (Ctrl+Z)"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleSplitSelectedClipAtPlayhead}
                disabled={!canSplitClipAtCurrentTime(selectedClip)}
                aria-label="剪开选中片段"
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-700/70 bg-slate-900 text-slate-400 transition-all hover:border-cyan-500/50 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-35"
                title="按播放头位置剪开选中片段，并自动拆分台词 (S)"
              >
                <Scissors className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleMergeSelectedClipWithAdjacent}
                disabled={!getSelectedMergeableClipPair()}
                aria-label="合并同轨相邻片段"
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-700/70 bg-slate-900 text-slate-400 transition-all hover:border-emerald-500/50 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-35"
                title="粘合已选中的两个同轨相邻片段，并自动合并台词 (J)"
              >
                <Combine className="h-3.5 w-3.5" />
              </button>
              <div className="ml-2 hidden items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/60 px-1 py-1 xl:flex">
                <button
                  type="button"
                  onClick={() => handleApplyMixAssistantPreset('voice_first')}
                  aria-label="应用人声优先自动混音"
                  className="flex h-7 w-7 items-center justify-center rounded border border-purple-500/25 bg-purple-500/10 text-purple-200 transition-colors hover:bg-purple-500/20 hover:text-white"
                  title="人声优先：压低 BGM，突出人声和配音"
                >
                  <AudioLines className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyMixAssistantPreset('clean_master')}
                  aria-label="应用干净母版自动混音"
                  className="flex h-7 w-7 items-center justify-center rounded border border-emerald-500/25 bg-emerald-500/10 text-emerald-200 transition-colors hover:bg-emerald-500/20 hover:text-white"
                  title="干净母版：更保守的峰值保护和层次"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                </button>
              </div>
              {copiedClip && (
                <button
                  type="button"
                  onClick={handlePasteClip}
                  className="flex items-center gap-1 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white font-bold text-[9px] px-2.5 py-0.5 rounded border border-indigo-500/30 transition-all cursor-pointer ml-3 shrink-0 animate-pulse"
                  title="粘贴已复制的片段 (Ctrl+V)"
                >
                  <Clipboard className="w-2.5 h-2.5" />
                  <span>粘贴“{copiedClip.name}”</span>
                </button>
              )}
            </div>

            {/* DAW Playback Controls Center */}
            <div className="flex items-center justify-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1 rounded-xl shadow-inner shrink-0">
              <button
                type="button"
                onClick={togglePlay}
                className={`flex items-center gap-1.5 font-bold text-[11px] px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  isPlaying 
                    ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/20' 
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20'
                }`}
                title="播放/暂停 (空格键)"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5 fill-white" />
                    <span>暂停</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-white translate-x-[0.5px]" />
                    <span>播放</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => stopPlayback(true)}
                className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-[11px] px-2.5 py-1 rounded-lg border border-slate-700/80 transition-colors cursor-pointer"
                title="停止并归零"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>停止</span>
              </button>

              <div className="h-4 w-[1px] bg-slate-800 mx-1" />

              <div className="text-xs font-mono font-bold text-indigo-400 select-none">
                {currentTime.toFixed(2)}s <span className="text-slate-600 font-normal">/</span> {safeDuration.toFixed(2)}s
              </div>
            </div>
            
            {/* Zoom Controls */}
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-2 py-1 rounded-lg shrink-0 justify-end">
              <span className="text-[10px] text-slate-400 font-bold">时间轴缩放:</span>
              <button 
                type="button"
                onClick={() => setPixelsPerSecond(prev => Math.max(10, prev - 5))}
                className="text-slate-400 hover:text-white p-0.5 rounded hover:bg-slate-800 transition-colors cursor-pointer text-[10px]"
                title="缩小"
              >
                缩小 -
              </button>
              <input 
                type="range"
                min="10"
                max="100"
                value={pixelsPerSecond}
                onChange={(e) => setPixelsPerSecond(parseInt(e.target.value))}
                className="w-20 accent-indigo-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
              />
              <button 
                type="button"
                onClick={() => setPixelsPerSecond(prev => Math.min(100, prev + 5))}
                className="text-slate-400 hover:text-white p-0.5 rounded hover:bg-slate-800 transition-colors cursor-pointer text-[10px]"
                title="放大"
              >
                放大 +
              </button>
            </div>
          </div>

          {/* Main DAW Editor Layout */}
          <div className="flex-1 min-h-0 flex border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
            
            {/* Unified Scroll Container (Handles both vertical and horizontal scrolling) */}
            <div className="flex-1 overflow-auto custom-scrollbar bg-slate-950/20 relative" ref={timelineRef}>
              
              {/* Outer timeline wrapper with horizontal min-width to support zooming */}
              <div 
                className="relative flex flex-col select-none min-h-full"
                style={{ width: '100%', minWidth: `${safeDuration * pixelsPerSecond + 160}px` }}
              >
                
                {/* 1. TOP ROW: Ruler & Spacer (Sticky top to stay visible vertically) */}
                <div className="sticky top-0 z-30 flex h-8 shrink-0 bg-slate-950 border-b border-slate-800">
                  {/* Top-Left Spacer: Sticky Left and Sticky Top! */}
                  <div className="sticky left-0 top-0 w-[160px] shrink-0 bg-slate-900 border-r border-slate-800/80 z-40 flex items-center justify-between px-3 select-none text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <span>轨道列表</span>
                    <button
                      type="button"
                      onClick={() => {
                        setNewTrackName('');
                        setNewTrackType('sfx');
                        setShowAddTrackModal(true);
                      }}
                      className="p-1 hover:bg-slate-800 text-indigo-400 hover:text-white rounded transition-colors cursor-pointer"
                      title="新建轨道"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Ruler Ticks Area: Sticky Top, scrolls horizontally */}
                  <div 
                    onClick={handleRulerClick}
                    className="flex-1 h-8 bg-slate-900 relative cursor-col-resize select-none overflow-hidden"
                  >
                    {/* Ticks rendering */}
                    {Array.from({ length: Math.ceil(safeDuration) + 1 }).map((_, i) => {
                      const percent = (i / safeDuration) * 100;
                      if (i % 2 === 0) {
                        return (
                          <div 
                            key={i} 
                            className="absolute top-0 bottom-0 border-l border-slate-800 text-[9px] font-mono pl-1 text-slate-500 flex items-end pb-0.5 select-none"
                            style={{ left: `${percent}%` }}
                          >
                            {i}s
                          </div>
                        );
                      }
                      return (
                        <div 
                          key={i} 
                          className="absolute top-3.5 bottom-0 border-l border-slate-800/60"
                          style={{ left: `${percent}%` }}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Main scrollable body with track rows */}
                <div className="flex-1 flex flex-col py-2 pr-2 bg-slate-950/30 relative space-y-2.5">
                  
                  {/* Vertical Playhead Line running across ALL rows! (Offsets by sticky header width of 160px) */}
                  <div 
                    className="absolute top-0 bottom-0 left-[160px] right-2 pointer-events-none z-30"
                  >
                    <div
                      className="absolute top-0 bottom-0 w-[1.5px] bg-rose-500"
                      style={{ left: `${(currentTime / safeDuration) * 100}%` }}
                    >
                      <div className="w-2.5 h-2.5 bg-rose-500 rounded-full absolute -top-1 -left-1 shadow-lg shadow-rose-500/50" />
                    </div>
                  </div>

                  {clipAlignmentGuide && interactionType === 'drag' && (
                    <div className="absolute top-0 bottom-0 left-[160px] right-2 pointer-events-none z-[60]">
                      <div
                        className="absolute top-0 bottom-0 w-[2px] bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.95)]"
                        style={{ left: `${(clipAlignmentGuide.time / safeDuration) * 100}%` }}
                      >
                        <div className="absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-cyan-300/70 bg-cyan-950/95 px-2 py-0.5 text-[9px] font-bold text-cyan-100 shadow-lg shadow-cyan-500/20">
                          {clipAlignmentGuide.source === 'start' ? '开头' : '结尾'}对齐
                        </div>
                        <div className="absolute inset-y-0 -left-[4px] border-l border-dashed border-cyan-100/80" />
                        <div className="absolute inset-y-0 left-[5px] border-l border-dashed border-cyan-100/50" />
                      </div>
                    </div>
                  )}

                  {/* 1. Video Preview Row */}
                  <div className="flex h-9 shrink-0 gap-0">
                    {/* Video Header: Sticky Left */}
                    <div className="sticky left-0 w-[160px] shrink-0 bg-slate-900 border-r border-slate-800 z-20 flex items-center justify-end pr-3 select-none text-[10px] font-bold text-slate-400 uppercase tracking-wider shadow-md">
                      <Film className="w-3 h-3 text-indigo-400 mr-1.5" />
                      视频画面
                    </div>
                    {/* Video Content Cell */}
                    <div className="flex-1 bg-indigo-950/10 rounded-r-lg border-y border-r border-indigo-900/20 overflow-hidden relative">
                      <div className="absolute inset-0 flex items-center justify-around opacity-15 text-[9px] text-indigo-400 font-mono">
                        <span>镜头 A</span>
                        <span>镜头 B</span>
                        <span>镜头 C</span>
                        <span>镜头 D</span>
                      </div>
                    </div>
                  </div>

                  {/* Dynamic Track Rows */}
                  {(() => {
                    const hasActiveSolo = tracks.some(t => t.isSoloed);
                    return tracks.map((track) => {
                      const IconComponent = track.type === 'bgm' ? Music : track.type === 'dubbing' ? Mic : track.type === 'original' ? Film : Waves;
                      const iconColor = track.type === 'bgm' ? 'text-emerald-400' : track.type === 'dubbing' ? 'text-purple-400' : track.type === 'original' ? 'text-amber-400' : 'text-blue-400';
                      const isDefaultTrack = ['bgm', 'sfx', 'dubbing', ORIGINAL_AUDIO_TRACK_ID].includes(track.id);
                      const isTrackSelected = track.id === selectedTrackId;

                      // Custom styles depending on track type
                      const clipBgActive = track.type === 'bgm' 
                        ? 'bg-emerald-600/95 text-white ring-2 ring-emerald-300 shadow-lg shadow-emerald-600/20 z-10' 
                        : track.type === 'dubbing' 
                          ? 'bg-purple-600/95 text-white ring-2 ring-purple-300 shadow-lg shadow-purple-600/20 z-10' 
                          : track.type === 'original'
                            ? 'bg-amber-600/95 text-white ring-2 ring-amber-300 shadow-lg shadow-amber-600/20 z-10'
                            : 'bg-blue-600/95 text-white ring-2 ring-blue-300 shadow-lg shadow-blue-600/20 z-10';
                          
                      const clipBgInactive = track.type === 'bgm' 
                        ? 'bg-emerald-950/50 hover:bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 hover:border-emerald-700' 
                        : track.type === 'dubbing' 
                          ? 'bg-purple-950/50 hover:bg-purple-950/80 text-purple-300 border border-purple-800/60 hover:border-purple-700' 
                          : track.type === 'original'
                            ? 'bg-amber-950/50 hover:bg-amber-950/80 text-amber-300 border border-amber-800/60 hover:border-amber-700'
                            : 'bg-blue-950/50 hover:bg-blue-950/80 text-blue-300 border border-blue-800/60 hover:border-blue-700';

                      const loaderColor = track.type === 'bgm' ? 'text-emerald-400' : track.type === 'dubbing' ? 'text-purple-400' : track.type === 'original' ? 'text-amber-400' : 'text-blue-400';
                      const checkColor = track.type === 'bgm' ? 'text-emerald-300' : track.type === 'dubbing' ? 'text-purple-300' : track.type === 'original' ? 'text-amber-300' : 'text-blue-300';

                      return (
                        <div key={track.id} className="flex h-12 shrink-0 gap-0">
                          {/* Left Sticky Track Header */}
                          <div className={`sticky left-0 w-[160px] shrink-0 border-r p-1.5 rounded-l-lg z-20 flex flex-col justify-between group shadow-md transition-all ${
                            isTrackSelected
                              ? track.type === 'dubbing'
                                ? 'bg-purple-950/45 border-purple-500/70 ring-1 ring-inset ring-purple-500/60'
                                : 'bg-indigo-950/40 border-indigo-500/60 ring-1 ring-inset ring-indigo-500/50'
                              : 'bg-slate-900 border-slate-800'
                          }`}>
                            {/* Top row: plus, title, delete */}
                            <div className="flex items-center justify-between gap-1 min-w-0">
                              <button
                                type="button"
                                onClick={() => handleAddNewClip(track.id)}
                                disabled={track.type === 'original'}
                                className="p-0.5 hover:bg-slate-800 text-indigo-400 hover:text-white rounded transition-colors cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-30"
                                title={track.type === 'original' ? '视频原声轨会自动对应整段视频' : '添加音频片段'}
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                data-testid={`track-selector-${track.id}`}
                                onClick={() => handleSelectTrack(track.id)}
                                className="text-[10px] font-bold text-slate-300 uppercase tracking-wider truncate flex-1 flex items-center gap-1 min-w-0 text-left cursor-pointer hover:text-white"
                                title={`配置${track.name}轨道`}
                              >
                                <IconComponent className={`w-3 h-3 shrink-0 ${iconColor}`} />
                                <span className="truncate">{track.name}</span>
                              </button>
                              {track.type !== 'original' && (
                                <button
                                  type="button"
                                  data-testid={`duplicate-track-${track.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDuplicateTrack(track.id);
                                  }}
                                  className="p-0.5 hover:bg-indigo-950/50 text-slate-500 hover:text-indigo-300 rounded transition-colors cursor-pointer shrink-0"
                                  title="复制此轨道及其片段"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              )}
                              {!isDefaultTrack && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTrack(track.id)}
                                  className="p-0.5 hover:bg-red-950/40 text-slate-500 hover:text-red-400 rounded transition-colors cursor-pointer shrink-0"
                                  title="删除此轨道"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            {/* Bottom row: Mute, Solo, and Ordering buttons */}
                            <div className="flex items-center gap-1.5 justify-between pt-1 border-t border-slate-800/10 w-full">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const idx = tracks.findIndex(t => t.id === track.id);
                                    moveTrack(idx, 'up');
                                  }}
                                  disabled={tracks.findIndex(t => t.id === track.id) === 0}
                                  className="p-0.5 text-slate-500 hover:text-slate-300 disabled:opacity-30 rounded transition-colors cursor-pointer"
                                  title="上移音轨"
                                >
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const idx = tracks.findIndex(t => t.id === track.id);
                                    moveTrack(idx, 'down');
                                  }}
                                  disabled={tracks.findIndex(t => t.id === track.id) === tracks.length - 1}
                                  className="p-0.5 text-slate-500 hover:text-slate-300 disabled:opacity-30 rounded transition-colors cursor-pointer"
                                  title="下移音轨"
                                >
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => toggleMuteTrack(track.id)}
                                  className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-all cursor-pointer ${
                                    track.isMuted
                                      ? 'bg-red-500/25 text-red-400 border border-red-500/40 shadow-sm shadow-red-500/10'
                                      : 'bg-slate-950/50 hover:bg-slate-800/80 text-slate-500 border border-slate-800/60'
                                  }`}
                                  title="静音（试听与导出均不参与）"
                                >
                                  M
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleSoloTrack(track.id)}
                                  className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-all cursor-pointer ${
                                    track.isSoloed
                                      ? 'bg-amber-500/25 text-amber-400 border border-amber-500/40 shadow-sm shadow-amber-500/10'
                                      : 'bg-slate-950/50 hover:bg-slate-800/80 text-slate-500 border border-slate-800/60'
                                  }`}
                                  title="独奏试听（不影响导出）"
                                >
                                  S
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Right Timeline Track Cell */}
                          <div 
                            data-testid={`track-lane-${track.id}`}
                            data-track-lane-id={track.id}
                            onClick={() => handleSelectTrack(track.id)}
                            className={`flex-1 rounded-r-lg border-y border-r relative transition-all ${
                              track.isMuted 
                                ? 'bg-red-950/5 border-red-900/10 opacity-60' 
                                : hasActiveSolo && !track.isSoloed
                                  ? 'bg-slate-900/20 border-slate-800/40 opacity-40'
                                  : isTrackSelected
                                    ? track.type === 'dubbing'
                                      ? 'bg-purple-950/25 border-purple-500/60 ring-1 ring-inset ring-purple-500/40'
                                      : 'bg-indigo-950/20 border-indigo-500/50 ring-1 ring-inset ring-indigo-500/30'
                                    : dragOverTrackId === track.id && interactionType === 'drag'
                                      ? 'bg-indigo-500/10 border-indigo-400/70 ring-1 ring-inset ring-indigo-400/60'
                                    : 'bg-slate-900/50 border-slate-800'
                            }`}
                          >
                            {/* Background track indicator text for empty states */}
                            {clips.filter(c => c.trackId === track.id).length === 0 && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 text-[9px] text-slate-500 font-medium">
                                {track.type === 'original'
                                  ? '上传有声音的视频后会自动生成整段视频原声'
                                  : dragOverTrackId === track.id && interactionType === 'drag'
                                    ? '释放后移动到此轨道'
                                  : '点击左侧加号在此轨道创建音频片段'}
                              </div>
                            )}

                            {clips
                              .filter(c => c.trackId === track.id)
                              .map(clip => {
                                const left = (clip.startTime / safeDuration) * 100;
                                const width = (clip.duration / safeDuration) * 100;
                                const isSelected = selectedClipIds.includes(clip.id);
                                const clipIsOriginalAudio = isOriginalAudioClip(clip);
                                const fadeInSeconds = normalizeClipFade(clip.fadeIn, clip.duration);
                                const fadeOutSeconds = normalizeClipFade(clip.fadeOut, clip.duration);
                                const fadeInPercent = clip.duration > 0 ? Math.min(100, (fadeInSeconds / clip.duration) * 100) : 0;
                                const fadeOutPercent = clip.duration > 0 ? Math.min(100, (fadeOutSeconds / clip.duration) * 100) : 0;
                                return (
                                  <div
                                    key={clip.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
                                      handleSelectClip(clip.id);
                                    }}
                                    className={`absolute top-1 bottom-1 rounded-md px-2 py-1 ${clipIsOriginalAudio ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'} flex flex-col justify-between text-left select-none transition-all group/clip ${
                                      isSelected ? clipBgActive : clipBgInactive
                                    }`}
                                    style={{ left: `${left}%`, width: `${width}%` }}
                                    onMouseDown={clipIsOriginalAudio ? undefined : (e) => {
                                      if (e.ctrlKey || e.metaKey || e.shiftKey) {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        handleSelectClip(clip.id, true);
                                        return;
                                      }
                                      startDragOrResize(e, clip.id, 'drag');
                                    }}
                                  >
                                    {fadeInPercent > 0 && (
                                      <div
                                        className="pointer-events-none absolute inset-y-0 left-0 z-10 overflow-hidden rounded-l-md bg-gradient-to-r from-white/10 to-transparent"
                                        style={{ width: `${fadeInPercent}%` }}
                                      >
                                        <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                                          <line x1="0" y1="0" x2="100" y2="100" stroke="rgba(255,255,255,0.55)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                                        </svg>
                                      </div>
                                    )}
                                    {fadeOutPercent > 0 && (
                                      <div
                                        className="pointer-events-none absolute inset-y-0 right-0 z-10 overflow-hidden rounded-r-md bg-gradient-to-l from-white/10 to-transparent"
                                        style={{ width: `${fadeOutPercent}%` }}
                                      >
                                        <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                                          <line x1="100" y1="0" x2="0" y2="100" stroke="rgba(255,255,255,0.55)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                                        </svg>
                                      </div>
                                    )}

                                    {/* Top corner fade handles */}
                                    {!clipIsOriginalAudio && (
                                      <>
                                        <div
                                          className={`absolute left-0 top-0 z-30 h-3 w-5 cursor-ew-resize rounded-br-md rounded-tl-md border-b border-r border-white/25 bg-white/20 opacity-0 transition-opacity hover:bg-cyan-300/45 group-hover/clip:opacity-100 ${isSelected ? 'opacity-80' : ''}`}
                                          onMouseDown={(e) => startDragOrResize(e, clip.id, 'fade-in')}
                                          title={`拖动调整淡入：${fadeInSeconds.toFixed(2)}s`}
                                        />
                                        <div
                                          className={`absolute right-0 top-0 z-30 h-3 w-5 cursor-ew-resize rounded-bl-md rounded-tr-md border-b border-l border-white/25 bg-white/20 opacity-0 transition-opacity hover:bg-cyan-300/45 group-hover/clip:opacity-100 ${isSelected ? 'opacity-80' : ''}`}
                                          onMouseDown={(e) => startDragOrResize(e, clip.id, 'fade-out')}
                                          title={`拖动调整淡出：${fadeOutSeconds.toFixed(2)}s`}
                                        />
                                      </>
                                    )}

                                    {/* Bottom corner stretch handles */}
                                    {!clipIsOriginalAudio && (
                                      <div 
                                        className="absolute bottom-0 left-0 z-20 h-1/2 w-3 cursor-ew-resize rounded-bl-md rounded-tr-sm opacity-0 transition-opacity hover:bg-white/30 group-hover/clip:opacity-100"
                                        onMouseDown={(e) => startDragOrResize(e, clip.id, 'resize-left')}
                                        title="拖动调整片段起点"
                                      />
                                    )}

                                    <div className="flex items-center justify-between min-w-0 pointer-events-none px-0.5">
                                      <span className="text-[10px] font-bold truncate pr-1">{clip.name}</span>
                                      {clip.isGenerating ? (
                                        <Loader2 className={`w-2.5 h-2.5 animate-spin shrink-0 ${loaderColor}`} />
                                      ) : clip.voiceDirty || clip.timingDirty ? (
                                        <RotateCcw className="w-2.5 h-2.5 shrink-0 text-amber-300" />
                                      ) : clip.audioUrl ? (
                                        <Check className={`w-2.5 h-2.5 shrink-0 ${checkColor}`} />
                                      ) : null}
                                    </div>
                                    <span className="text-[8px] font-mono truncate opacity-60 px-0.5 pointer-events-none">
                                      {track.type === 'dubbing' ? `"${clip.text || clip.prompt}"` : clip.prompt}
                                    </span>

                                    {/* Right stretch handle */}
                                    {!clipIsOriginalAudio && (
                                      <div 
                                        className="absolute bottom-0 right-0 z-20 h-1/2 w-3 cursor-ew-resize rounded-br-md rounded-tl-sm opacity-0 transition-opacity hover:bg-white/30 group-hover/clip:opacity-100"
                                        onMouseDown={(e) => startDragOrResize(e, clip.id, 'resize-right')}
                                        title="拖动调整片段终点"
                                      />
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      );
                    });
                  })()}

                  {/* Add Track Row */}
                  <div className="flex h-10 shrink-0 gap-0">
                    <div className="sticky left-0 w-[160px] shrink-0 bg-transparent z-20" />
                    <div className="flex-1">
                      <button
                        type="button"
                        onClick={() => {
                          setNewTrackName('');
                          setNewTrackType('sfx');
                          setShowAddTrackModal(true);
                        }}
                        className="w-full h-10 border border-dashed border-slate-800 hover:border-indigo-500/65 bg-slate-950/20 hover:bg-indigo-500/5 text-slate-500 hover:text-indigo-400 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer text-[10px] font-bold"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>新建轨道</span>
                      </button>
                    </div>
                  </div>
                  
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Banner */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed bottom-6 right-6 z-[9999] flex items-center gap-3 bg-slate-900/95 backdrop-blur-md border border-slate-800 p-4 rounded-xl shadow-2xl max-w-sm"
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              toast.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : toast.type === 'info'
                  ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                  : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              {toast.type === 'success' ? (
                <CheckCircle2 className="w-4.5 h-4.5" />
              ) : toast.type === 'info' ? (
                <Info className="w-4.5 h-4.5" />
              ) : (
                <AlertCircle className="w-4.5 h-4.5" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-bold text-slate-200">
                {toast.type === 'success' ? '成功' : toast.type === 'error' ? '出错' : '提示'}
              </h4>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{toast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-slate-500 hover:text-slate-300 transition-colors p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 新建音轨 Modal */}
      <AnimatePresence>
        {showAddTrackModal && (
          <div className="fixed inset-0 z-[9990] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddTrackModal(false)}
              className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm"
            />

            {/* Modal Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 overflow-hidden z-10"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-sm font-bold text-slate-200">新建自定义音轨</h3>
                </div>
                <button
                  onClick={() => setShowAddTrackModal(false)}
                  className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAddTrackConfirm} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    音轨名称
                  </label>
                  <input
                    type="text"
                    required
                    value={newTrackName}
                    onChange={(e) => setNewTrackName(e.target.value)}
                    placeholder="例如：环境白噪音、爆破特效、旁白补充..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    音轨类型（决定默认生成风格与长度）
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { type: 'sfx', label: '音效 SFX', desc: '简短、高爆发' },
                      { type: 'bgm', label: '配乐 BGM', desc: '支持循环、背景' },
                      { type: 'dubbing', label: '配音旁白', desc: '人声、台词' }
                    ].map((opt) => (
                      <button
                        key={opt.type}
                        type="button"
                        onClick={() => setNewTrackType(opt.type as 'bgm' | 'sfx' | 'dubbing')}
                        className={`p-2.5 rounded-lg border flex flex-col items-center text-center gap-1 transition-all cursor-pointer ${
                          newTrackType === opt.type
                            ? 'bg-indigo-600/10 border-indigo-500 text-indigo-400 font-bold'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                        }`}
                      >
                        <span className="text-[10px]">{opt.label}</span>
                        <span className="text-[8px] opacity-60 leading-tight">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddTrackModal(false)}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-lg transition-colors cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg shadow-lg shadow-indigo-500/10 transition-colors cursor-pointer"
                  >
                    创建音轨
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 保存工程 Modal */}
      <AnimatePresence>
        {showSaveProjectModal && (
          <div className="fixed inset-0 z-[9990] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSaveProjectModal(false)}
              className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm"
            />

            {/* Modal Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 overflow-hidden z-10"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Save className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-sm font-bold text-slate-200">保存当前工程</h3>
                </div>
                <button
                  onClick={() => setShowSaveProjectModal(false)}
                  className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveProjectConfirm} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    工程名称
                  </label>
                  <input
                    type="text"
                    required
                    value={projectNameInput}
                    onChange={(e) => setProjectNameInput(e.target.value)}
                    placeholder="请输入工程名称..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
                    autoFocus
                  />
                </div>

                <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-800/60 text-[10px] text-slate-400 space-y-1.5">
                  <div className="flex justify-between">
                    <span>视频文件:</span>
                    <span className="text-slate-200 truncate max-w-[200px]">{videoFile?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>音轨片段数:</span>
                    <span className="text-slate-200 font-mono">{clips.length} 个片段</span>
                  </div>
                  <div className="flex justify-between">
                    <span>视频总时长:</span>
                    <span className="text-slate-200 font-mono">{safeDuration.toFixed(1)} 秒</span>
                  </div>
                </div>

                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowSaveProjectModal(false)}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-lg transition-colors cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-lg shadow-lg shadow-emerald-500/10 transition-colors cursor-pointer"
                  >
                    保存工程
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 打开工程 Modal */}
      <AnimatePresence>
        {showOpenProjectModal && (
          <div className="fixed inset-0 z-[9990] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowOpenProjectModal(false)}
              className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm"
            />

            {/* Modal Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 overflow-hidden z-10 flex flex-col max-h-[85vh]"
            >
              <div className="flex items-center justify-between mb-4 shrink-0">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-sm font-bold text-slate-200">工程库管理</h3>
                </div>
                <button
                  onClick={() => setShowOpenProjectModal(false)}
                  className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Import project from file */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-4 mb-4 shrink-0 flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-300">从本地文件导入</h4>
                  <p className="text-[10px] text-slate-500 mt-0.5">选择备份的工程配置文件（*.vsa.json）载入当前工作区</p>
                </div>
                <label className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-lg shadow-indigo-500/15 cursor-pointer transition-colors shrink-0">
                  <Upload className="w-3.5 h-3.5" />
                  <span>导入本地工程</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportProjectFile}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 shrink-0">
                本地已保存的工程 ({savedProjectsList.length})
              </div>

              {/* Projects List */}
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-[220px]">
                {savedProjectsList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-xl bg-slate-950/30">
                    <FolderOpen className="w-8 h-8 opacity-30 mb-2 text-slate-500" />
                    <p className="text-xs">还没有保存过任何工程</p>
                    <p className="text-[10px] opacity-70 mt-0.5">在工作区配置配乐后点击“保存工程”按钮将自动存入此列表</p>
                  </div>
                ) : (
                  savedProjectsList.map((project) => (
                    <div
                      key={project.id}
                      onClick={() => handleOpenProject(project)}
                      className="group flex items-center justify-between p-3.5 bg-slate-950 hover:bg-slate-950/60 border border-slate-800 hover:border-indigo-500/50 rounded-lg transition-all duration-200 cursor-pointer text-left"
                    >
                      <div className="min-w-0 flex-1 pr-4">
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-bold text-slate-200 truncate group-hover:text-indigo-400 transition-colors">
                            {project.name}
                          </span>
                          <span className="text-[9px] text-slate-500 shrink-0 font-mono">
                            {new Date(project.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-1.5 text-[10px] text-slate-400">
                          <span className="flex items-center gap-1">
                            <Film className="w-3 h-3 text-slate-500" />
                            <span className="truncate max-w-[150px]">{project.videoFile?.name || '未加载视频'}</span>
                          </span>
                          <span className="font-mono">{project.clips.length} 个音轨片段</span>
                          <span className="font-mono">{(project.videoDuration || 0).toFixed(1)}s 时长</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {/* Export to File Button */}
                        <button
                          onClick={(e) => handleExportProjectToFile(project, e)}
                          title="备份并导出为文件"
                          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                        >
                          <FileDown className="w-3.5 h-3.5" />
                        </button>
                        
                        {/* Delete Button */}
                        <button
                          onClick={(e) => handleDeleteProject(project.id, e)}
                          title="删除此工程"
                          className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
