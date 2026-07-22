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
  Lock,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TimelineClip } from '../types';
import { ELEVENLABS_VOICES, VoiceItem } from '../data/voices';
import { fetchAvailableVoices } from '../services/elevenLabsService';
import { extractVideoKeyframes } from '../utils/mediaPreparation';

const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;
const DEFAULT_DUBBING_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const MIN_DUBBING_AUTO_SPEED = 0.25;
const MAX_DUBBING_AUTO_SPEED = 4;
const ANALYSIS_UNDO_KEY_PREFIX = 'video_soundtrack_analysis_undo:';

type SoundtrackProjectMode = 'preserve-original' | 'remake';
type AnalysisScope =
  | { kind: 'enabled-tracks' }
  | { kind: 'track'; trackId: 'bgm' | 'sfx' | 'dubbing' };
type ExportJobKind = 'video' | 'mixed' | 'bgm' | 'sfx' | 'dubbing';

const EXPORT_JOB_KINDS: ExportJobKind[] = ['video', 'mixed', 'bgm', 'sfx', 'dubbing'];

export interface SoundtrackTrack {
  id: string;
  name: string;
  type: 'bgm' | 'sfx' | 'dubbing';
  volume: number;
  isMuted: boolean;
  isSoloed: boolean;
  defaultVoiceId?: string;
}

const normalizeUnitVolume = (value: unknown, fallback = 1) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
};

const getTrackVolume = (trackId: string, tracks: SoundtrackTrack[]) => (
  normalizeUnitVolume(tracks.find(track => track.id === trackId)?.volume, 1)
);

const getEffectiveClipVolume = (clip: TimelineClip, tracks: SoundtrackTrack[]) => (
  normalizeUnitVolume(clip.volume, 1) * getTrackVolume(clip.trackId, tracks)
);

const normalizePositiveNumber = (value: unknown, fallback: number) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
);

const normalizeOptionalTime = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
);

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
  { id: 'bgm', name: '配乐 BGM', type: 'bgm', volume: 1, isMuted: false, isSoloed: false },
  { id: 'sfx', name: '音效 SFX', type: 'sfx', volume: 1, isMuted: false, isSoloed: false },
  {
    id: 'dubbing',
    name: '配音旁白',
    type: 'dubbing',
    volume: 1,
    isMuted: false,
    isSoloed: false,
    defaultVoiceId: DEFAULT_DUBBING_VOICE_ID,
  },
];

const VOICE_CATEGORIES = ['全部', '经典人声', '游戏动漫', '叙事小说', '媒体广告', '高雅格调', '我的克隆'];

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
  mode?: SoundtrackProjectMode;
  sourceAudioEnabled?: boolean;
  sourceAudioVolume?: number;
}

interface AnalysisUndoSnapshot {
  version: 1;
  projectId: string;
  videoFileName: string;
  videoDuration: number;
  createdAt: number;
  scopeLabel: string;
  clips: TimelineClip[];
  selectedClipId: string | null;
  selectedTrackId: string | null;
  mixedVideoUrl: string | null;
  exportedMixedUrl: string | null;
  exportedBgmUrl: string | null;
  exportedSfxUrl: string | null;
  exportedDubbingUrl: string | null;
}

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
  const [projectMode, setProjectMode] = useState<SoundtrackProjectMode>('preserve-original');
  const [showCreateModeModal, setShowCreateModeModal] = useState<boolean>(false);
  const [showAnalysisScopeModal, setShowAnalysisScopeModal] = useState<boolean>(false);
  const [analysisUndoSnapshot, setAnalysisUndoSnapshot] = useState<AnalysisUndoSnapshot | null>(null);

  // Layout resizing and Copy/Paste states
  const [copiedClip, setCopiedClip] = useState<TimelineClip | null>(null);
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
  const [sourceAudioEnabled, setSourceAudioEnabled] = useState<boolean>(true);
  const [sourceAudioVolume, setSourceAudioVolume] = useState<number>(1);
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

  // Audio export and tracks stem states
  const [isExportingMixed, setIsExportingMixed] = useState<boolean>(false);
  const [isExportingBgm, setIsExportingBgm] = useState<boolean>(false);
  const [isExportingSfx, setIsExportingSfx] = useState<boolean>(false);
  const [isExportingDubbing, setIsExportingDubbing] = useState<boolean>(false);

  const [exportedMixedUrl, setExportedMixedUrl] = useState<string | null>(null);
  const [exportedBgmUrl, setExportedBgmUrl] = useState<string | null>(null);
  const [exportedSfxUrl, setExportedSfxUrl] = useState<string | null>(null);
  const [exportedDubbingUrl, setExportedDubbingUrl] = useState<string | null>(null);

  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState<boolean>(false);

  const exportControllersRef = useRef<Partial<Record<ExportJobKind, AbortController>>>({});
  const exportVersionsRef = useRef<Record<ExportJobKind, number>>({
    video: 0,
    mixed: 0,
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
    cancelExportJobs(['video', 'mixed', trackType]);
    setMixedVideoUrl(null);
    setExportedMixedUrl(null);
    if (trackType === 'bgm') setExportedBgmUrl(null);
    else if (trackType === 'sfx') setExportedSfxUrl(null);
    else setExportedDubbingUrl(null);
  };

  // Premium voice selection states & audio preview states for Dubbing select
  const [fetchedVoices, setFetchedVoices] = useState<VoiceItem[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState<boolean>(false);
  const [voiceSearchQuery, setVoiceSearchQuery] = useState<string>('');
  const [voiceGenderFilter, setVoiceGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [voiceActiveCategory, setVoiceActiveCategory] = useState<string>('全部');
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
        const allowedCategories = ['premade', 'cloned', 'professional'];
        const filteredApiVoices = apiVoices.filter(av => allowedCategories.includes(av.category));

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
          const category = av.category === 'premade' ? '经典人声' : (av.category === 'cloned' || av.category === 'professional') ? '我的克隆' : '自定义声线';

          return {
            id: av.voice_id,
            name: av.name,
            englishName: av.name,
            gender: isMale ? 'male' as const : 'female' as const,
            category: category,
            tags: Object.values(av.labels || {}).filter(Boolean) as string[],
            description: av.labels?.description || `您在 ElevenLabs 中配置的${category}`,
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

  const handleCreateNewProject = (mode: SoundtrackProjectMode) => {
    cancelExportJobs();
    analysisAbortRef.current?.abort('user');
    stopVoicePreview();
    videoRef.current?.pause();
    setMediaTimeSafely(videoRef.current, 0);
    setIsPlaying(false);
    setCurrentTime(0);
    // Reset workspace states to clean slate
    setProjectMode(mode);
    setSourceAudioEnabled(mode === 'preserve-original');
    setSourceAudioVolume(1);
    setShowCreateModeModal(false);
    setShowAnalysisScopeModal(false);
    setAnalysisUndoSnapshot(null);
    setVideoFile(null);
    setSelectedFile(null);
    setVideoDuration(30);
    setClips([]);
    const defaultTracks = createDefaultTracks();
    tracksRef.current = defaultTracks;
    setTracks(defaultTracks);
    setSelectedClipId(null);
    setSelectedTrackId(null);
    setBgmEnabled(true);
    setSfxEnabled(true);
    setDubbingEnabled(true);
    setMixedVideoUrl(null);
    setExportedMixedUrl(null);
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
      delete audioInstancesRef.current[clipId];
    });

    setToast({
      message: mode === 'preserve-original'
        ? '已创建“保留原声，局部修改”工程，请导入视频开始制作。'
        : '已创建“重新制作声音”工程，视频原声默认关闭。',
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
            exportedDubbingUrl,
            mode: projectMode,
            sourceAudioEnabled,
            sourceAudioVolume
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
      exportedDubbingUrl,
      mode: projectMode,
      sourceAudioEnabled,
      sourceAudioVolume
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
      const restoredMode = project.mode ?? 'preserve-original';
      const hasExplicitSourceAudioState = project.mode !== undefined
        && typeof project.sourceAudioEnabled === 'boolean';
      const restoredSourceAudioEnabled = project.sourceAudioEnabled ?? (restoredMode !== 'remake');
      setVideoFile(project.videoFile);
      setVideoDuration(project.videoDuration);
      setProjectMode(restoredMode);
      setSourceAudioEnabled(restoredSourceAudioEnabled);
      setSourceAudioVolume(normalizeUnitVolume(project.sourceAudioVolume, 1));
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
          volume: normalizeUnitVolume(track.volume, 1),
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
        if (linkedSubtitleWindow) {
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
      setSelectedTrackId(null);
      setBgmEnabled(project.bgmEnabled);
      setSfxEnabled(project.sfxEnabled);
      setDubbingEnabled(project.dubbingEnabled);
      setMixedVideoUrl(
        hasStaleDubbingAudio || !hasExplicitSourceAudioState
          ? null
          : project.mixedVideoUrl,
      );
      setExportedMixedUrl(hasStaleDubbingAudio ? null : project.exportedMixedUrl || null);
      setExportedBgmUrl(project.exportedBgmUrl || null);
      setExportedSfxUrl(project.exportedSfxUrl || null);
      setExportedDubbingUrl(hasStaleDubbingAudio ? null : project.exportedDubbingUrl || null);
      
      setCurrentProjectId(project.id);
      setIsProjectActive(true); // Go to workspace

      try {
        const undoStored = localStorage.getItem(`${ANALYSIS_UNDO_KEY_PREFIX}${project.id}`);
        const undoSnapshot = undoStored ? JSON.parse(undoStored) as AnalysisUndoSnapshot : null;
        const isMatchingSnapshot = undoSnapshot?.version === 1
          && undoSnapshot.projectId === project.id
          && undoSnapshot.videoFileName === project.videoFile?.name;
        setAnalysisUndoSnapshot(isMatchingSnapshot ? undoSnapshot : null);
      } catch (undoError) {
        console.warn('Failed to load AI planning undo snapshot:', undoError);
        setAnalysisUndoSnapshot(null);
      }

      // Re-initialize audio instances if any clip has audioUrl
      Object.keys(audioInstancesRef.current).forEach(clipId => {
        try {
          audioInstancesRef.current[clipId].pause();
        } catch (e) {}
        delete audioInstancesRef.current[clipId];
      });

      normalizedClips.forEach(clip => {
        if (clip.audioUrl) {
          const audio = new Audio(clip.audioUrl);
          preserveAudioPitch(audio);
          audio.volume = getEffectiveClipVolume(clip, normalizedTracks);
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
        localStorage.removeItem(`${ANALYSIS_UNDO_KEY_PREFIX}${projectId}`);
        setSavedProjectsList(projects);
        if (currentProjectId === projectId) {
          setAnalysisUndoSnapshot(null);
        }
        
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
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  
  // We show the DAW editor if the project is active AND (we have a video file OR we have already loaded a project)
  const showDAW = isProjectActive && (!!videoFile || !!currentProjectId || clips.length > 0);
  
  // Scale / Zoom factor for horizontal scrolling (pixels per second)
  const [pixelsPerSecond, setPixelsPerSecond] = useState<number>(30);

  // Mouse interaction state for dragging and stretching clips
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [interactionType, setInteractionType] = useState<'drag' | 'resize-left' | 'resize-right' | null>(null);
  const [dragStartX, setDragStartX] = useState<number>(0);
  const [initialClipState, setInitialClipState] = useState<{ startTime: number; duration: number } | null>(null);

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
        exportedDubbingUrl,
        mode: projectMode,
        sourceAudioEnabled,
        sourceAudioVolume
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
          exportedDubbingUrl,
          mode: projectMode,
          sourceAudioEnabled,
          sourceAudioVolume
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
    exportedDubbingUrl,
    projectMode,
    sourceAudioEnabled,
    sourceAudioVolume
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
      audio.volume = getEffectiveClipVolume(pastedClip, tracksRef.current);
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

  const startDragOrResize = (e: React.MouseEvent, clipId: string, type: 'drag' | 'resize-left' | 'resize-right') => {
    e.stopPropagation();
    e.preventDefault();
    const targetClip = clips.find(c => c.id === clipId);
    if (!targetClip) return;

    handleSelectClip(clipId);
    setActiveClipId(clipId);
    setInteractionType(type);
    setDragStartX(e.clientX);
    setInitialClipState({
      startTime: targetClip.startTime,
      duration: targetClip.duration
    });
    const pastedTrack = tracksRef.current.find(track => track.id === targetClip.trackId);
    if (pastedTrack) invalidateTrackOutputs(pastedTrack.type);
  };

  // Handle mouse move & up on window for smooth dragging/resizing experience
  useEffect(() => {
    if (!activeClipId || !interactionType || !initialClipState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX;
      const deltaTime = deltaX / pixelsPerSecond;

      setClips(prev => prev.map(clip => {
        if (clip.id !== activeClipId) return clip;

        let newStartTime = clip.startTime;
        let newDuration = clip.duration;

        if (interactionType === 'drag') {
          newStartTime = initialClipState.startTime + deltaTime;
          // Clamp startTime so clip stays within video duration bounds
          newStartTime = Math.max(0, Math.min(newStartTime, safeDuration - clip.duration));
          // Round to 2 decimal places for neatness
          newStartTime = parseFloat(newStartTime.toFixed(2));
        } else if (interactionType === 'resize-right') {
          newDuration = initialClipState.duration + deltaTime;
          newDuration = Math.max(0.5, Math.min(newDuration, safeDuration - clip.startTime));
          newDuration = parseFloat(newDuration.toFixed(2));
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
        }

        const linkedSubtitleWindow = getLinkedSubtitleWindow(clip);
        if (linkedSubtitleWindow) {
          const subtitleDuration = linkedSubtitleWindow.end - linkedSubtitleWindow.start;
          const minimumDuration = Math.min(0.5, subtitleDuration);
          newDuration = Math.min(
            subtitleDuration,
            Math.max(minimumDuration, newDuration),
          );
          newStartTime = Math.min(
            Math.max(linkedSubtitleWindow.start, newStartTime),
            linkedSubtitleWindow.end - newDuration,
          );
          newStartTime = Number(newStartTime.toFixed(3));
          newDuration = Number(newDuration.toFixed(3));
        }

        const isDubbingClip = tracksRef.current.find(
          track => track.id === clip.trackId,
        )?.type === 'dubbing';
        const updatedClip: TimelineClip = {
          ...clip,
          startTime: newStartTime,
          duration: newDuration,
          ...(isDubbingClip ? {
            autoSpeed: calculateDubbingAutoSpeed(clip.sourceAudioDuration, newDuration),
            timingDirty: true,
          } : {}),
        };
        const cachedAudio = audioInstancesRef.current[clip.id];
        if (cachedAudio && isDubbingClip) {
          cachedAudio.playbackRate = getEffectiveClipSpeed(updatedClip);
        }
        return updatedClip;
      }));
    };

    const handleMouseUp = () => {
      const activeClip = clipsRef.current.find(clip => clip.id === activeClipId);
      const activeTrack = activeClip
        ? tracksRef.current.find(track => track.id === activeClip.trackId)
        : undefined;
      if (activeTrack) invalidateTrackOutputs(activeTrack.type);
      setActiveClipId(null);
      setInteractionType(null);
      setInitialClipState(null);
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
    }
    const nextAudio = new Audio(audioUrl);
    preserveAudioPitch(nextAudio);
    nextAudio.volume = normalizeUnitVolume(volume, 1) * getTrackVolume(trackId, tracksRef.current);
    nextAudio.playbackRate = speed;
    audioInstancesRef.current[clipId] = nextAudio;
  };

  const selectedClip = clips.find(c => c.id === selectedClipId);
  const selectedTrack = tracks.find(track => track.id === selectedTrackId);
  const hasActiveSoloTrack = tracks.some(track => track.isSoloed);
  const effectiveSourceAudioEnabled = sourceAudioEnabled && !hasActiveSoloTrack;
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
  const filteredVoiceOptions = displayVoices.filter(voice => {
    if (voiceActiveCategory !== '全部' && voice.category !== voiceActiveCategory) return false;
    if (voiceGenderFilter !== 'all' && voice.gender !== voiceGenderFilter) return false;
    const query = voiceSearchQuery.trim().toLowerCase();
    if (!query) return true;
    return voice.name.toLowerCase().includes(query)
      || voice.englishName.toLowerCase().includes(query)
      || voice.category.toLowerCase().includes(query)
      || voice.description.toLowerCase().includes(query)
      || voice.tags.some(tag => tag.toLowerCase().includes(query));
  });

  const handleSelectTrack = (trackId: string) => {
    stopVoicePreview();
    setSelectedTrackId(trackId);
    setSelectedClipId(null);
  };

  const handleSelectClip = (clipId: string) => {
    stopVoicePreview();
    setSelectedClipId(clipId);
    setSelectedTrackId(null);
  };

  const updateTrackName = (trackId: string, name: string) => {
    setTracks(prev => prev.map(track => track.id === trackId ? { ...track, name } : track));
  };

  const updateTrackVolume = (trackId: string, value: number) => {
    const volume = normalizeUnitVolume(value, 1);
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
        audio.volume = getEffectiveClipVolume(clip, nextTracks);
      }
    });

    invalidateTrackOutputs(currentTrack.type);
  };

  const updateSourceAudioEnabled = (enabled: boolean) => {
    invalidateMixedVideo();
    setSourceAudioEnabled(enabled);
  };

  const updateSourceAudioVolume = (value: number) => {
    invalidateMixedVideo();
    setSourceAudioVolume(normalizeUnitVolume(value, 1));
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !effectiveSourceAudioEnabled;
    video.volume = normalizeUnitVolume(sourceAudioVolume, 1);
  }, [effectiveSourceAudioEnabled, sourceAudioVolume, videoFile?.url]);

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

        audio.volume = getEffectiveClipVolume(clip, tracks);
        const clipSpeed = getEffectiveClipSpeed(clip);
        audio.playbackRate = clipSpeed;
        const offset = currentTime - clip.startTime;
        
        // Determine maximum playable duration for non-BGM clips (e.g. dubbing/sfx shouldn't loop/replay)
        let maxPlayableDuration = clip.duration;
        if (clip.trackId !== 'bgm' && audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
          maxPlayableDuration = Math.min(clip.duration, audio.duration / clipSpeed);
        }

        if (offset >= 0 && offset < maxPlayableDuration && isTrackPlayable(clip.trackId)) {
          // Clip should be playing
          const expectedAudioTime = offset * clipSpeed;
          if (audio.paused) {
            setMediaTimeSafely(audio, expectedAudioTime);
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
      
      let maxPlayableDuration = clip.duration;
      if (clip.trackId !== 'bgm' && audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        maxPlayableDuration = Math.min(clip.duration, audio.duration / clipSpeed);
      }

      if (offset >= 0 && offset < maxPlayableDuration && isTrackPlayable(clip.trackId)) {
        if (isPlaying && audio.paused) {
          setMediaTimeSafely(audio, offset * clipSpeed);
          audio.volume = getEffectiveClipVolume(clip, tracks);
          audio.playbackRate = clipSpeed;
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
    setShowAnalysisScopeModal(false);
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
      const isSpace = e.code === 'Space' || e.key === ' ';

      if (isCopy) {
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
      } else if (isSpace) {
        e.preventDefault();
        togglePlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedClipId, clips, copiedClip, currentTime, safeDuration, isPlaying, videoLoadFailed, togglePlay]);

  const handleVideoLoaded = () => {
    if (videoRef.current) {
      const d = videoRef.current.duration;
      if (typeof d === 'number' && !isNaN(d) && isFinite(d) && d > 0) {
        setVideoDuration(d);
      } else {
        setVideoDuration(30);
      }
    }
  };

  // Automatic fallback in case the local object URL fails inside iframe sandbox
  const handleVideoError = () => {
    if (videoFile && videoFile.url.startsWith('blob:')) {
      console.warn('Blob URL playback failed, falling back to server URL.');
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

  const isProtectedTimelineClip = (clip: TimelineClip) => (
    clip.origin === 'manual'
    || clip.audioSource === 'uploaded'
    || clip.timingSource === 'manual'
    || clip.timingSource === 'manual-copy'
    || clip.id.startsWith('clip-manual-')
    || clip.id.startsWith('clip-copied-')
    || clip.trackId.startsWith('track-custom-')
  );

  const saveAnalysisUndoSnapshot = (scopeLabel: string) => {
    if (!currentProjectId || !videoFile) return null;
    const snapshot: AnalysisUndoSnapshot = {
      version: 1,
      projectId: currentProjectId,
      videoFileName: videoFile.name,
      videoDuration,
      createdAt: Date.now(),
      scopeLabel,
      clips: clipsRef.current.map(clip => ({ ...clip, isGenerating: false })),
      selectedClipId,
      selectedTrackId,
      mixedVideoUrl,
      exportedMixedUrl,
      exportedBgmUrl,
      exportedSfxUrl,
      exportedDubbingUrl,
    };

    try {
      localStorage.setItem(
        `${ANALYSIS_UNDO_KEY_PREFIX}${currentProjectId}`,
        JSON.stringify(snapshot),
      );
      setAnalysisUndoSnapshot(snapshot);
      return snapshot;
    } catch (snapshotError) {
      console.error('Failed to save AI planning undo snapshot:', snapshotError);
      return null;
    }
  };

  const handleUndoLastAnalysis = () => {
    const snapshot = analysisUndoSnapshot;
    if (!snapshot || !currentProjectId || !videoFile) return;
    const isMatchingProject = snapshot.version === 1
      && snapshot.projectId === currentProjectId
      && snapshot.videoFileName === videoFile.name
      && Math.abs(snapshot.videoDuration - videoDuration) < 0.5;
    if (!isMatchingProject) {
      setToast({ message: '恢复点与当前视频不匹配，无法撤销。', type: 'error' });
      window.setTimeout(() => setToast(null), 3_000);
      return;
    }

    stopPlayback(true);
    cancelExportJobs();
    audioInstancesRef.current = {};
    const restoredClips = snapshot.clips.map(clip => ({ ...clip, isGenerating: false }));
    setClips(restoredClips);
    const restoredClipId = snapshot.selectedClipId
      && restoredClips.some(clip => clip.id === snapshot.selectedClipId)
      ? snapshot.selectedClipId
      : null;
    setSelectedClipId(restoredClipId);
    setSelectedTrackId(restoredClipId ? null : snapshot.selectedTrackId);
    setMixedVideoUrl(snapshot.mixedVideoUrl);
    setExportedMixedUrl(snapshot.exportedMixedUrl);
    setExportedBgmUrl(snapshot.exportedBgmUrl);
    setExportedSfxUrl(snapshot.exportedSfxUrl);
    setExportedDubbingUrl(snapshot.exportedDubbingUrl);
    localStorage.removeItem(`${ANALYSIS_UNDO_KEY_PREFIX}${currentProjectId}`);
    setAnalysisUndoSnapshot(null);
    setToast({ message: `已撤销“${snapshot.scopeLabel}”，恢复修改前时间线。`, type: 'success' });
    window.setTimeout(() => setToast(null), 3_500);
  };

  // Call Gemini visual multimodal model to auto-create soundtrack timeline
  const handleAnalyzeVideo = async (scope: AnalysisScope) => {
    if (!videoFile) return;

    const scopedTrack = scope.kind === 'track'
      ? tracksRef.current.find(track => track.id === scope.trackId)
      : null;
    if (scope.kind === 'track' && !scopedTrack) {
      setError('当前音轨无法重新规划，请重新选择系统音轨。');
      return;
    }
    const analysisBgmEnabled = scope.kind === 'track'
      ? scopedTrack?.type === 'bgm'
      : bgmEnabled;
    const analysisSfxEnabled = scope.kind === 'track'
      ? scopedTrack?.type === 'sfx'
      : sfxEnabled;
    const analysisDubbingEnabled = scope.kind === 'track'
      ? scopedTrack?.type === 'dubbing'
      : dubbingEnabled;
    const targetTrackIds = new Set<string>([
      ...(analysisBgmEnabled ? ['bgm'] : []),
      ...(analysisSfxEnabled ? ['sfx'] : []),
      ...(analysisDubbingEnabled ? ['dubbing'] : []),
    ]);
    if (targetTrackIds.size === 0) {
      setError('请至少启用一条需要 AI 规划的音轨。');
      return;
    }
    const scopeLabel = scope.kind === 'track'
      ? `${scopedTrack?.name || '当前音轨'}重新规划`
      : '已启用音轨重新规划';
    setShowAnalysisScopeModal(false);

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
          return {
            ...clip,
            id: `clip-ai-${clip.trackId}-${analysisRunId}-${clipIndex}`,
            origin: 'ai' as const,
            startTime: clipStartTime,
            duration: clipDuration,
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
            volume: clip.trackId === 'bgm' ? 0.4 : 0.8,
            isGenerating: false,
            voiceDirty: false,
            timingDirty: false,
          };
        });
        const returnedTrackIds = new Set(mappedClips.map(clip => clip.trackId));
        const previousClips = clipsRef.current;

        if (mappedClips.length === 0) {
          setToast({
            message: `${scopeLabel}已完成，但 AI 没有找到可替换方案，原时间线已完整保留。`,
            type: 'info',
          });
          window.setTimeout(() => setToast(null), 4_000);
          return;
        }

        if (previousClips.length > 0 && !saveAnalysisUndoSnapshot(scopeLabel)) {
          throw new Error('无法建立安全恢复点，已停止应用新的 AI 规划。请清理浏览器存储后重试。');
        }

        const preservedClips = previousClips.filter(clip => (
          !returnedTrackIds.has(clip.trackId) || isProtectedTimelineClip(clip)
        ));
        const nextClips = [...preservedClips, ...mappedClips].sort((a, b) => (
          a.startTime - b.startTime || a.trackId.localeCompare(b.trackId)
        ));
        const nextClipIds = new Set(nextClips.map(clip => clip.id));
        (Object.entries(audioInstancesRef.current) as Array<[string, HTMLAudioElement]>).forEach(([clipId, audio]) => {
          if (nextClipIds.has(clipId)) return;
          audio.pause();
          delete audioInstancesRef.current[clipId];
        });
        const affectedExportKinds = (['bgm', 'sfx', 'dubbing'] as const).filter(kind => (
          returnedTrackIds.has(kind)
        ));
        cancelExportJobs(['video', 'mixed', ...affectedExportKinds]);
        setClips(nextClips);
        setMixedVideoUrl(null);
        setExportedMixedUrl(null);
        if (returnedTrackIds.has('bgm')) setExportedBgmUrl(null);
        if (returnedTrackIds.has('sfx')) setExportedSfxUrl(null);
        if (returnedTrackIds.has('dubbing')) setExportedDubbingUrl(null);

        if (!selectedClipId || !nextClipIds.has(selectedClipId)) {
          handleSelectClip(mappedClips[0].id);
        }

        const analysisSource = typeof data.analysisSource === 'string'
          ? data.analysisSource.toLowerCase()
          : '';
        const dubbingCueCount = typeof data.dubbingCueCount === 'number'
          ? data.dubbingCueCount
          : mappedClips.filter((clip: TimelineClip) => (
            tracks.find(track => track.id === clip.trackId)?.type === 'dubbing'
          )).length;
        const usedNativeVideo = analysisSource === 'server-native-video';
        const usedServerFrames = analysisSource === 'server-ffmpeg';
        setToast({
          message: usingFullVideoDubbingAnalysis && dubbingCueCount === 0
            ? `${scopeLabel}已完成，但没有识别到可配音字幕；原配音片段及其他音轨已保留。`
            : usingFullVideoDubbingAnalysis
            ? `${scopeLabel}完成：已识别字幕、对白与口型，并按字幕逐句建立配音片段。`
            : usedNativeVideo
            ? `${scopeLabel}完成：系统已自动改用完整视频与原音轨完成分析。`
            : usedServerFrames || usingServerFallback
              ? `${scopeLabel}完成：系统已从服务器原视频重新提取画面。`
              : `${scopeLabel}完成：已使用本地关键帧快速编排时间轴。`,
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

  // Generate audios for all clips in sequence
  const handleGenerateAll = async () => {
    for (const clip of clipsRef.current) {
      if ((!clip.audioUrl || clip.voiceDirty || clip.timingDirty) && !clip.isGenerating) {
        await handleGenerateAudioClip(clip.id);
      }
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
      setError(`有 ${staleDubbingClips.length} 个配音片段的声音、台词或时间已变化，请先点击“合成待更新音频”。`);
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
          includeOriginalAudio: sourceAudioEnabled,
          originalAudioVolume: sourceAudioVolume,
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

      const res = await fetch('/api/audio/mix-tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          clips: targetClips,
          trackId: undefined
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
      ['startTime', 'duration', 'volume', 'speed', 'autoSpeed'].includes(field)
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
          audioInstancesRef.current[clipId].volume = getEffectiveClipVolume(updated, tracksRef.current);
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
    const trackType = track ? track.type : 'sfx';
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
      volume: trackType === 'bgm' ? 0.4 : 0.8,
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
    invalidateTrackOutputs(currentTrack.type);
    const nextTracks = tracksRef.current.map(track => (
      track.id === trackId ? { ...track, isMuted: !track.isMuted } : track
    ));
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
  };

  const toggleSoloTrack = (trackId: string) => {
    const nextTracks = tracksRef.current.map(track => (
      track.id === trackId ? { ...track, isSoloed: !track.isSoloed } : track
    ));
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
  };

  const moveTrack = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= tracks.length) return;
    const updated = [...tracks];
    const temp = updated[index];
    updated[index] = updated[newIndex];
    updated[newIndex] = temp;
    setTracks(updated);
  };

  const handleAddTrackConfirm = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const id = `track-custom-${Date.now()}`;
    const name = newTrackName.trim() || `自定义音轨_${tracks.length + 1}`;
    
    const newTrack: SoundtrackTrack = {
      id,
      name,
      type: newTrackType,
      volume: 1,
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
    if (targetTrack) invalidateTrackOutputs(targetTrack.type);
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
    const targetTrack = targetClip
      ? tracksRef.current.find(track => track.id === targetClip.trackId)
      : undefined;
    if (targetTrack) invalidateTrackOutputs(targetTrack.type);
    // Stop audio
    if (audioInstancesRef.current[clipId]) {
      audioInstancesRef.current[clipId].pause();
      delete audioInstancesRef.current[clipId];
    }
    setClips(prev => prev.filter(c => c.id !== clipId));
    if (selectedClipId === clipId) {
      setSelectedClipId(null);
    }
  };

  const pendingGenerationCount = clips.filter(clip => (
    (!clip.audioUrl || clip.voiceDirty || clip.timingDirty) && !clip.isGenerating
  )).length;
  const inferredReplanTrack = tracks.find(track => (
    track.id === (selectedTrackId || selectedClip?.trackId)
  ));
  const canReplanCurrentTrack = Boolean(
    inferredReplanTrack && ['bgm', 'sfx', 'dubbing'].includes(inferredReplanTrack.id),
  );

  const handleAnalyzeButtonClick = () => {
    if (isAnalyzing) {
      analysisAbortRef.current?.abort('user');
      return;
    }
    if (clipsRef.current.length > 0) {
      setShowAnalysisScopeModal(true);
      return;
    }
    void handleAnalyzeVideo({ kind: 'enabled-tracks' });
  };

  const renderCreateModeModal = () => showCreateModeModal ? (
    <div className="fixed inset-0 z-[9995] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm"
        onClick={() => setShowCreateModeModal(false)}
      />
      <div className="relative z-10 max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl custom-scrollbar">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-black text-white">你想怎样处理这个视频的声音？</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">两种方式共用同一套多轨时间线，之后仍可随时调整原声开关和需要制作的轨道。</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModeModal(false)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white"
            aria-label="关闭制作方式选择"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => handleCreateNewProject('preserve-original')}
            className="group relative rounded-2xl border border-emerald-500/35 bg-emerald-950/20 p-5 text-left transition-all hover:border-emerald-400 hover:bg-emerald-950/35"
          >
            <span className="absolute right-4 top-4 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-300">推荐</span>
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <p className="text-sm font-bold text-slate-100">保留原声，局部修改</p>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">锁定视频原始声音，只替换不满意的配音句子、音乐段或音效，随时可以恢复原声。</p>
          </button>
          <button
            type="button"
            onClick={() => handleCreateNewProject('remake')}
            className="group rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-5 text-left transition-all hover:border-indigo-400 hover:bg-indigo-950/35"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-500/25 bg-indigo-500/10 text-indigo-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="text-sm font-bold text-slate-100">重新制作声音</p>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">默认关闭视频原声，再选择要重新制作的配乐、音效和配音轨道；全部勾选就是完整重制。</p>
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const renderAnalysisScopeModal = () => showAnalysisScopeModal ? (
    <div className="fixed inset-0 z-[9995] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm"
        onClick={() => setShowAnalysisScopeModal(false)}
      />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-black text-white">选择 AI 规划范围</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">手动创建和本地上传的片段会受到保护；应用新方案前会自动建立一层恢复点。</p>
          </div>
          <button
            type="button"
            onClick={() => setShowAnalysisScopeModal(false)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white"
            aria-label="关闭 AI 规划范围选择"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <button
            type="button"
            disabled={!canReplanCurrentTrack}
            onClick={() => {
              if (!inferredReplanTrack || !canReplanCurrentTrack) return;
              void handleAnalyzeVideo({
                kind: 'track',
                trackId: inferredReplanTrack.id as 'bgm' | 'sfx' | 'dubbing',
              });
            }}
            className="w-full rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-950/35 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <p className="text-xs font-bold text-indigo-200">当前音轨重新规划（整条）</p>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
              {canReplanCurrentTrack
                ? `只替换“${inferredReplanTrack?.name}”中的 AI 规划片段，其他音轨保持不变。`
                : '请先在时间线上选择配乐、音效或配音系统轨道。'}
            </p>
          </button>
          <button
            type="button"
            onClick={() => void handleAnalyzeVideo({ kind: 'enabled-tracks' })}
            className="w-full rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-left transition-colors hover:border-emerald-400 hover:bg-emerald-950/35"
          >
            <p className="text-xs font-bold text-emerald-200">重新规划已启用音轨</p>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">按照顶栏勾选的配乐、音效和配音进行规划；未勾选及自定义轨道完整保留。</p>
          </button>
        </div>
      </div>
    </div>
  ) : null;

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
            <h1 className="text-2xl font-black text-white tracking-tight">AI 视频声音制作</h1>
            <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
              保留并局部修改已有声音，或重新制作视频的配乐、音效与配音。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-4">
            {/* Create New Project */}
            <button
              onClick={() => setShowCreateModeModal(true)}
              className="group flex flex-col items-center justify-center p-6 bg-slate-900/60 hover:bg-indigo-600/10 border border-slate-800 hover:border-indigo-500/40 rounded-xl cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/5 hover:-translate-y-0.5"
            >
              <div className="p-3 bg-indigo-500/10 group-hover:bg-indigo-500/20 text-indigo-400 rounded-xl mb-4 transition-colors">
                <Plus className="w-6 h-6" />
              </div>
              <span className="text-sm font-bold text-slate-200 group-hover:text-white">新建工程</span>
              <span className="text-[11px] text-slate-500 mt-2 text-center leading-relaxed">下一步选择保留原声局部修改，或关闭原声重新制作。</span>
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
        {renderCreateModeModal()}
      </div>
    );
  }

  const currentProjectName = currentProjectId
    ? savedProjectsList.find(project => project.id === currentProjectId)?.name || '已保存工程'
    : '未保存的工程 (新)';

  return (
    <div id="video-soundtrack-container" className="flex flex-col h-full bg-slate-900 text-slate-100 overflow-hidden">
      {/* 顶部工具栏 */}
      <header id="daw-header" className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between shadow-md shrink-0 select-none">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-200">视频声音制作</h1>
              <div className="text-[10px] text-slate-400 flex items-center gap-1">
                <span>当前工程：</span>
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
                    className="w-40 rounded border border-indigo-500/60 bg-slate-950 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/30"
                  />
                ) : currentProjectId ? (
                  <button
                    type="button"
                    onClick={beginRenameCurrentProject}
                    className="group flex max-w-48 items-center gap-1 rounded border border-indigo-900/30 bg-indigo-950/50 px-1.5 py-0.5 font-bold text-indigo-400 transition-colors hover:border-indigo-600/50 hover:bg-indigo-900/40 hover:text-indigo-300"
                    title="点击修改工程名称"
                    aria-label={`修改工程名称：${currentProjectName}`}
                  >
                    <span className="truncate">{currentProjectName}</span>
                    <Pencil className="h-2.5 w-2.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
                  </button>
                ) : (
                  <span className="rounded border border-indigo-900/30 bg-indigo-950/50 px-1.5 py-0.5 font-bold text-indigo-400">
                    {currentProjectName}
                  </span>
                )}
                <span className={`ml-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${
                  projectMode === 'preserve-original'
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                    : 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300'
                }`}>
                  {projectMode === 'preserve-original' ? '原声编辑' : '重新制作'}
                </span>
              </div>
            </div>
          </div>

          {/* 工程管理控制 */}
          <div className="flex items-center gap-2 pl-4 border-l border-slate-800">
            <button
              onClick={() => setShowCreateModeModal(true)}
              className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-800 transition-all cursor-pointer"
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
              className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-800 transition-all cursor-pointer"
              title="打开已保存的工程"
            >
              <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
              <span>打开工程</span>
            </button>

            <button
              onClick={handleSaveProject}
              className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-800 transition-all cursor-pointer"
              title="实时保存当前工程"
            >
              <Save className="w-3.5 h-3.5 text-emerald-400" />
              <span>实时保存</span>
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
              className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-800 transition-all cursor-pointer"
              title="工程另存为新工程"
            >
              <FileDown className="w-3.5 h-3.5 text-blue-400" />
              <span>另存为</span>
            </button>

            <button
              onClick={handleReturnHome}
              className="flex items-center gap-1 bg-slate-900 hover:bg-red-950/40 hover:text-red-400 text-slate-400 font-bold text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-800 transition-all cursor-pointer"
              title="关闭当前工程并返回首页"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>返回首页</span>
            </button>
          </div>
        </div>

        {showDAW && (
          <div className="flex items-center gap-6">
            {/* 轨道独立控制 */}
            <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs">
              <span className="text-slate-400 font-medium mr-1">生成轨道:</span>
              <label className="flex items-center gap-1.5 cursor-pointer hover:text-indigo-400">
                <input 
                  type="checkbox" 
                  checked={bgmEnabled} 
                  onChange={(e) => setBgmEnabled(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-0 focus:ring-offset-0"
                />
                <span>配乐</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer hover:text-indigo-400">
                <input 
                  type="checkbox" 
                  checked={sfxEnabled} 
                  onChange={(e) => setSfxEnabled(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-0 focus:ring-offset-0"
                />
                <span>音效</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer hover:text-indigo-400">
                <input 
                  type="checkbox" 
                  checked={dubbingEnabled} 
                  onChange={(e) => setDubbingEnabled(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-0 focus:ring-offset-0"
                />
                <span>配音</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="btn-ai-analyze"
                onClick={handleAnalyzeButtonClick}
                className={`flex items-center gap-1.5 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-lg transition-all duration-200 cursor-pointer ${
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
                    <span>{clips.length > 0 ? 'AI 优化音轨' : 'AI 规划音轨'}</span>
                  </>
                )}
              </button>

              {analysisUndoSnapshot && (
                <button
                  type="button"
                  onClick={handleUndoLastAnalysis}
                  className="flex items-center gap-1 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-bold text-amber-300 transition-colors hover:bg-amber-500/20"
                  title={`撤销：${analysisUndoSnapshot.scopeLabel}`}
                  aria-label="撤销上次 AI 规划"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>撤销规划</span>
                </button>
              )}

              <button
                id="btn-generate-all"
                onClick={handleGenerateAll}
                disabled={pendingGenerationCount === 0}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs px-3 py-1.5 rounded-lg border border-slate-700 disabled:opacity-50 transition-all cursor-pointer"
              >
                <Music className="w-3.5 h-3.5" />
                <span>{pendingGenerationCount > 0 ? `合成待更新音频 (${pendingGenerationCount})` : '音频已全部就绪'}</span>
              </button>

              <div className="relative">
                {isExportDropdownOpen && (
                  <div className="fixed inset-0 z-40" onClick={() => setIsExportDropdownOpen(false)} />
                )}
                <button
                  id="btn-export-dropdown"
                  onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
                  disabled={!videoFile && clips.length === 0}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-lg shadow-emerald-500/10 disabled:opacity-50 transition-all cursor-pointer z-50 relative"
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

                    <div className="space-y-2.5">
                      {/* 1. Mix & Export Video */}
                      <div className="p-2.5 bg-slate-950 hover:bg-slate-950/80 rounded-lg border border-slate-800/60 transition-all">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FileVideo className="w-3.5 h-3.5 text-emerald-400" />
                            <div>
                              <p className="text-[11px] font-bold text-slate-200">导出已混音视频</p>
                              <p className="text-[9px] text-slate-500">{sourceAudioEnabled ? '保留视频原声并混入制作音轨' : '关闭视频原声，仅混入制作音轨'}</p>
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
                              <p className="text-[9px] text-slate-500">配乐/音效/配音合并，不含视频原声 (.mp3)</p>
                            </div>
                          </div>
                          {isExportingMixed ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                          ) : exportedMixedUrl ? (
                            <a
                              href={`/api/sfx/download-file?path=${encodeURIComponent(exportedMixedUrl)}&name=${encodeURIComponent('master_mixed_soundtrack.mp3')}`}
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

                      {/* 3. BGM Stem */}
                      <div className="p-2.5 bg-slate-950 hover:bg-slate-950/80 rounded-lg border border-slate-800/60 transition-all">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Music className="w-3.5 h-3.5 text-emerald-400" />
                            <div>
                              <p className="text-[11px] font-bold text-slate-200">BGM 背景配乐分轨</p>
                              <p className="text-[9px] text-slate-500">仅包含配乐音轨 (.mp3)</p>
                            </div>
                          </div>
                          {isExportingBgm ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                          ) : exportedBgmUrl ? (
                            <a
                              href={`/api/sfx/download-file?path=${encodeURIComponent(exportedBgmUrl)}&name=${encodeURIComponent('bgm_track_stem.mp3')}`}
                              className="text-[10px] font-bold bg-emerald-600 text-white px-2 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <Download className="w-2.5 h-2.5" />
                              下载
                            </a>
                          ) : (
                            <button
                              onClick={() => handleExportAudio('bgm')}
                              disabled={clips.filter(c => c.audioUrl && c.trackId === 'bgm').length === 0}
                              className="text-[10px] font-bold bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white px-2 py-1 rounded transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              导出
                            </button>
                          )}
                        </div>
                        {exportedBgmUrl && (
                          <div className="mt-2 pt-1.5 border-t border-slate-800/40">
                            <audio src={exportedBgmUrl} controls className="w-full h-6 rounded bg-slate-900" />
                          </div>
                        )}
                      </div>

                      {/* 4. SFX Stem */}
                      <div className="p-2.5 bg-slate-950 hover:bg-slate-950/80 rounded-lg border border-slate-800/60 transition-all">
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
                      <div className="p-2.5 bg-slate-950 hover:bg-slate-950/80 rounded-lg border border-slate-800/60 transition-all">
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
                    muted={!effectiveSourceAudioEnabled}
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
                      href={`/api/sfx/download-file?path=${encodeURIComponent(mixedVideoUrl)}&name=${encodeURIComponent(`mixed_${videoFile?.name || 'video.mp4'}`)}`}
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
                {selectedClip && (
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
                          ) : (
                            <Waves className="h-4 w-4 shrink-0 text-blue-400" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-slate-200">
                              {selectedTrack.type === 'dubbing' ? '配音轨设置' : '轨道设置'}
                            </p>
                            <p className="mt-0.5 truncate text-[10px] text-slate-500">{selectedTrack.name}</p>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-400">
                          {selectedTrack.type === 'dubbing' ? '配音' : selectedTrack.type === 'bgm' ? '配乐' : '音效'}
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
                          {Math.round(normalizeUnitVolume(selectedTrack.volume, 1) * 100)}%
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
                          value={normalizeUnitVolume(selectedTrack.volume, 1)}
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

                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-center">
                        <p className="text-[9px] font-bold uppercase text-slate-600">类型</p>
                        <p className="mt-1 text-[10px] font-semibold text-slate-300">
                          {selectedTrack.type === 'dubbing' ? '配音' : selectedTrack.type === 'bgm' ? '配乐' : '音效'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-center">
                        <p className="text-[9px] font-bold uppercase text-slate-600">片段</p>
                        <p className="mt-1 text-[10px] font-semibold text-slate-300">
                          {clips.filter(clip => clip.trackId === selectedTrack.id).length} 个
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-center">
                        <p className="text-[9px] font-bold uppercase text-slate-600">状态</p>
                        <p className={`mt-1 text-[10px] font-semibold ${
                          selectedTrack.isMuted
                            ? 'text-red-400'
                            : selectedTrack.isSoloed
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                        }`}>
                          {selectedTrack.isMuted ? '已静音' : selectedTrack.isSoloed ? '独奏中' : '正常'}
                        </p>
                      </div>
                    </div>

                    {selectedTrack.type === 'dubbing' ? (
                      <div className="space-y-3 border-t border-slate-800 pt-4">
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
                        <span className="text-[10px] font-mono text-slate-400">{Math.round(selectedClip.volume * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Volume2 className="w-4 h-4 text-slate-500" />
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={selectedClip.volume}
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
                              {selectedClip.voiceDirty || selectedClip.timingDirty
                                ? selectedClip.timingDirty
                                  ? '台词或时间已变化，等待重新合成'
                                  : '等待应用新的轨道声音'
                                : resolveClipAudioSource(selectedClip) === 'uploaded'
                                  ? '本地音频已关联'
                                  : '音频已成功生成'}
                            </span>
                          </div>
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

                    {/* 本地音频上传 */}
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
              <span className="text-[10px] text-slate-500 font-medium truncate hidden lg:inline">（拖拽移动、拉伸长度）</span>
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

                  {/* Locked source audio row: never deleted or regenerated. */}
                  <div data-testid="source-audio-track" className="flex h-12 shrink-0 gap-0">
                    <div className="sticky left-0 z-20 flex w-[160px] shrink-0 flex-col justify-between rounded-l-lg border-r border-amber-500/20 bg-amber-950/20 p-1.5 shadow-md">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Lock className="h-3 w-3 shrink-0 text-amber-400" />
                        <span className="truncate text-[10px] font-bold text-amber-200">视频原声</span>
                        <span className="ml-auto rounded border border-amber-500/20 px-1 text-[8px] font-bold text-amber-400">锁定</span>
                      </div>
                      <div className="flex items-center gap-1.5 border-t border-amber-500/10 pt-1">
                        <button
                          type="button"
                          onClick={() => updateSourceAudioEnabled(!sourceAudioEnabled)}
                          disabled={!videoFile || videoLoadFailed}
                          className={`rounded border px-1.5 py-0.5 text-[9px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                            sourceAudioEnabled
                              ? 'border-amber-500/40 bg-amber-500/20 text-amber-300'
                              : 'border-red-500/30 bg-red-500/15 text-red-300'
                          }`}
                          aria-label={sourceAudioEnabled ? '静音视频原声' : '开启视频原声'}
                          title={sourceAudioEnabled ? '静音视频原声' : '开启视频原声'}
                        >
                          M
                        </button>
                        <Volume2 className="h-3 w-3 shrink-0 text-slate-500" />
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={sourceAudioVolume}
                          onChange={(event) => updateSourceAudioVolume(Number.parseFloat(event.target.value))}
                          disabled={!videoFile || videoLoadFailed}
                          className="h-1 min-w-0 flex-1 cursor-pointer accent-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="视频原声音量"
                        />
                        <span className="w-7 text-right font-mono text-[8px] text-slate-500">{Math.round(sourceAudioVolume * 100)}%</span>
                      </div>
                    </div>
                    <div className={`relative flex-1 overflow-hidden rounded-r-lg border-y border-r ${
                      effectiveSourceAudioEnabled
                        ? 'border-amber-500/25 bg-amber-950/15'
                        : 'border-slate-800 bg-slate-900/40 opacity-60'
                    }`}>
                      <div className="absolute inset-1.5 flex items-center justify-between rounded-md border border-amber-500/15 bg-gradient-to-r from-amber-500/10 via-amber-400/5 to-amber-500/10 px-3">
                        <span className="truncate text-[9px] font-semibold text-amber-200/80">
                          {hasActiveSoloTrack && sourceAudioEnabled
                            ? 'Solo 试听期间原声暂时静音'
                            : sourceAudioEnabled
                              ? '视频原始混合声音 · 全程保护'
                              : '视频原声已关闭'}
                        </span>
                        {sourceAudioEnabled && clips.some(clip => (
                          clip.audioUrl && tracks.find(track => track.id === clip.trackId)?.type === 'dubbing'
                        )) && (
                          <span className="ml-3 shrink-0 text-[8px] font-bold text-amber-400" title="原声与新配音可能同时播放">注意配音重叠</span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Dynamic Track Rows */}
                  {(() => {
                    const hasActiveSolo = tracks.some(t => t.isSoloed);
                    return tracks.map((track) => {
                      const IconComponent = track.type === 'bgm' ? Music : track.type === 'dubbing' ? Mic : Waves;
                      const iconColor = track.type === 'bgm' ? 'text-emerald-400' : track.type === 'dubbing' ? 'text-purple-400' : 'text-blue-400';
                      const isDefaultTrack = ['bgm', 'sfx', 'dubbing'].includes(track.id);
                      const isTrackSelected = track.id === selectedTrackId;

                      // Custom styles depending on track type
                      const clipBgActive = track.type === 'bgm' 
                        ? 'bg-emerald-600/95 text-white ring-2 ring-emerald-300 shadow-lg shadow-emerald-600/20 z-10' 
                        : track.type === 'dubbing' 
                          ? 'bg-purple-600/95 text-white ring-2 ring-purple-300 shadow-lg shadow-purple-600/20 z-10' 
                          : 'bg-blue-600/95 text-white ring-2 ring-blue-300 shadow-lg shadow-blue-600/20 z-10';
                          
                      const clipBgInactive = track.type === 'bgm' 
                        ? 'bg-emerald-950/50 hover:bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 hover:border-emerald-700' 
                        : track.type === 'dubbing' 
                          ? 'bg-purple-950/50 hover:bg-purple-950/80 text-purple-300 border border-purple-800/60 hover:border-purple-700' 
                          : 'bg-blue-950/50 hover:bg-blue-950/80 text-blue-300 border border-blue-800/60 hover:border-blue-700';

                      const loaderColor = track.type === 'bgm' ? 'text-emerald-400' : track.type === 'dubbing' ? 'text-purple-400' : 'text-blue-400';
                      const checkColor = track.type === 'bgm' ? 'text-emerald-300' : track.type === 'dubbing' ? 'text-purple-300' : 'text-blue-300';

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
                                className="p-0.5 hover:bg-slate-800 text-indigo-400 hover:text-white rounded transition-colors cursor-pointer shrink-0"
                                title="添加音频片段"
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
                                    : 'bg-slate-900/50 border-slate-800'
                            }`}
                          >
                            {/* Background track indicator text for empty states */}
                            {clips.filter(c => c.trackId === track.id).length === 0 && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 text-[9px] text-slate-500 font-medium">
                                点击左侧加号在此轨道创建音频片段
                              </div>
                            )}

                            {clips
                              .filter(c => c.trackId === track.id)
                              .map(clip => {
                                const left = (clip.startTime / safeDuration) * 100;
                                const width = (clip.duration / safeDuration) * 100;
                                const isSelected = clip.id === selectedClipId;
                                return (
                                  <div
                                    key={clip.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSelectClip(clip.id);
                                    }}
                                    className={`absolute top-1 bottom-1 rounded-md px-2 py-1 cursor-grab active:cursor-grabbing flex flex-col justify-between text-left select-none transition-all group/clip ${
                                      isSelected ? clipBgActive : clipBgInactive
                                    }`}
                                    style={{ left: `${left}%`, width: `${width}%` }}
                                    onMouseDown={(e) => startDragOrResize(e, clip.id, 'drag')}
                                  >
                                    {/* Left stretch handle */}
                                    <div 
                                      className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize opacity-0 group-hover/clip:opacity-100 hover:bg-white/30 transition-opacity rounded-l-md z-20"
                                      onMouseDown={(e) => startDragOrResize(e, clip.id, 'resize-left')}
                                    />

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
                                    <div 
                                      className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize opacity-0 group-hover/clip:opacity-100 hover:bg-white/30 transition-opacity rounded-r-md z-20"
                                      onMouseDown={(e) => startDragOrResize(e, clip.id, 'resize-right')}
                                    />
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

      {renderCreateModeModal()}
      {renderAnalysisScopeModal()}

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
