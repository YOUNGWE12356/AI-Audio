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
  Clipboard
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TimelineClip } from '../types';
import { ELEVENLABS_VOICES, VoiceItem } from '../data/voices';
import { fetchAvailableVoices } from '../services/elevenLabsService';


// Helper to extract keyframes from a video file in the browser using canvas
async function extractVideoKeyframes(file: File, numFrames: number = 8): Promise<Array<{ timestamp: number; base64: string }>> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    // Set a global timeout of 15 seconds in case seeking gets stuck
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('提取视频帧超时'));
    }, 15000);

    const cleanup = () => {
      clearTimeout(timeout);
      try {
        URL.revokeObjectURL(video.src);
      } catch (e) {}
    };

    video.onloadedmetadata = async () => {
      try {
        const duration = video.duration || 10;
        const keyframes: Array<{ timestamp: number; base64: string }> = [];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Target width of 400px for balanced size and fast upload
        const targetWidth = 400;
        const aspect = video.videoWidth / video.videoHeight || 16/9;
        canvas.width = targetWidth;
        canvas.height = Math.round(targetWidth / aspect);

        // Generate timestamps evenly distributed
        const timestamps: number[] = [];
        for (let i = 0; i < numFrames; i++) {
          const t = (i + 0.5) * (duration / numFrames);
          if (t < duration) {
            timestamps.push(t);
          }
        }

        for (const t of timestamps) {
          await new Promise<void>((res) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              res();
            };
            video.addEventListener('seeked', onSeeked);
            video.currentTime = t;
            // Seeked fallback timeout
            setTimeout(res, 800);
          });

          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
            const base64 = dataUrl.split(',')[1];
            if (base64) {
              keyframes.push({
                timestamp: parseFloat(t.toFixed(1)),
                base64: base64
              });
            }
          }
        }

        cleanup();
        resolve(keyframes);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('无法加载视频元数据进行帧提取'));
    };
  });
}

export interface SoundtrackTrack {
  id: string;
  name: string;
  type: 'bgm' | 'sfx' | 'dubbing';
  isMuted: boolean;
  isSoloed: boolean;
}

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

export default function VideoSoundtrack() {
  // Project saving and loading states
  const [isProjectActive, setIsProjectActive] = useState<boolean>(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [showSaveProjectModal, setShowSaveProjectModal] = useState<boolean>(false);
  const [showOpenProjectModal, setShowOpenProjectModal] = useState<boolean>(false);
  const [projectNameInput, setProjectNameInput] = useState<string>('');
  const [savedProjectsList, setSavedProjectsList] = useState<SoundtrackProject[]>([]);

  // Layout resizing and Copy/Paste states
  const [copiedClip, setCopiedClip] = useState<TimelineClip | null>(null);
  const [showSyncSuccess, setShowSyncSuccess] = useState<boolean>(false);
  const [timelineHeight, setTimelineHeight] = useState<number>(300);
  const [videoHeight, setVideoHeight] = useState<number>(360);
  const [propertyWidth, setPropertyWidth] = useState<number>(320);
  const [propertyHeight, setPropertyHeight] = useState<number>(600);

  const [isResizingTimeline, setIsResizingTimeline] = useState<boolean>(false);
  const [isResizingVideo, setIsResizingVideo] = useState<boolean>(false);
  const [isResizingPropertyWidth, setIsResizingPropertyWidth] = useState<boolean>(false);
  const [isResizingPropertyHeight, setIsResizingPropertyHeight] = useState<boolean>(false);

  const timelineResizeStartRef = useRef<{ clientY: number; initialHeight: number }>({ clientY: 0, initialHeight: 300 });
  const videoResizeStartRef = useRef<{ clientY: number; initialHeight: number }>({ clientY: 0, initialHeight: 360 });
  const propertyWidthStartRef = useRef<{ clientX: number; initialWidth: number }>({ clientX: 0, initialWidth: 320 });
  const propertyHeightStartRef = useRef<{ clientY: number; initialHeight: number }>({ clientY: 0, initialHeight: 600 });

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

  // Premium voice selection states & audio preview states for Dubbing select
  const [fetchedVoices, setFetchedVoices] = useState<VoiceItem[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState<boolean>(false);
  const [showVoiceDropdown, setShowVoiceDropdown] = useState<boolean>(false);
  const [voiceSearchQuery, setVoiceSearchQuery] = useState<string>('');
  const [voiceGenderFilter, setVoiceGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [voiceActiveCategory, setVoiceActiveCategory] = useState<string>('全部');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

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

  const handleCreateNewProject = () => {
    // Reset workspace states to clean slate
    setVideoFile(null);
    setSelectedFile(null);
    setVideoDuration(30);
    setClips([]);
    setTracks([
      { id: 'bgm', name: '配乐 BGM', type: 'bgm', isMuted: false, isSoloed: false },
      { id: 'sfx', name: '音效 SFX', type: 'sfx', isMuted: false, isSoloed: false },
      { id: 'dubbing', name: '配音旁白', type: 'dubbing', isMuted: false, isSoloed: false },
    ]);
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
      message: '已新建声剪辑工程！请导入您的视频开始制作。',
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
      setVideoLoadFailed(false);
      setVideoFile(project.videoFile);
      setVideoDuration(project.videoDuration);
      setClips(project.clips);
      if (project.tracks && project.tracks.length > 0) {
        setTracks(project.tracks);
      } else {
        setTracks([
          { id: 'bgm', name: '配乐 BGM', type: 'bgm', isMuted: false, isSoloed: false },
          { id: 'sfx', name: '音效 SFX', type: 'sfx', isMuted: false, isSoloed: false },
          { id: 'dubbing', name: '配音旁白', type: 'dubbing', isMuted: false, isSoloed: false },
        ]);
      }
      setBgmEnabled(project.bgmEnabled);
      setSfxEnabled(project.sfxEnabled);
      setDubbingEnabled(project.dubbingEnabled);
      setMixedVideoUrl(project.mixedVideoUrl);
      setExportedMixedUrl(project.exportedMixedUrl || null);
      setExportedBgmUrl(project.exportedBgmUrl || null);
      setExportedSfxUrl(project.exportedSfxUrl || null);
      setExportedDubbingUrl(project.exportedDubbingUrl || null);
      
      setCurrentProjectId(project.id);
      setIsProjectActive(true); // Go to workspace

      // Re-initialize audio instances if any clip has audioUrl
      Object.keys(audioInstancesRef.current).forEach(clipId => {
        try {
          audioInstancesRef.current[clipId].pause();
        } catch (e) {}
        delete audioInstancesRef.current[clipId];
      });

      project.clips.forEach(clip => {
        if (clip.audioUrl) {
          const audio = new Audio(clip.audioUrl);
          audio.volume = clip.volume || 1.0;
          audio.playbackRate = clip.speed || 1.0;
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
    if (showVoiceDropdown) {
      loadVoices();
    }
  }, [showVoiceDropdown]);

  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const playWebSpeechFallback = (voiceName: string, gender: 'male' | 'female', category: string, tags: string[]) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setPlayingVoiceId(null);
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
        setPlayingVoiceId(null);
      };
      utterance.onerror = () => {
        setPlayingVoiceId(null);
      };
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error("Speech synthesis fallback failed:", err);
      setPlayingVoiceId(null);
    }
  };

  const handlePlayVoicePreview = (voiceId: string, url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingVoiceId === voiceId) {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setPlayingVoiceId(null);
    } else {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setPlayingVoiceId(voiceId);
      if (!url) {
        console.warn("No preview URL provided. Running local synthesis fallback...");
        const voiceObj = displayVoices.find(v => v.id === voiceId);
        if (voiceObj) {
          playWebSpeechFallback(voiceObj.name, voiceObj.gender, voiceObj.category, voiceObj.tags);
        } else {
          setPlayingVoiceId(null);
        }
        return;
      }
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      let fallbackTriggered = false;
      const triggerFallback = () => {
        if (fallbackTriggered) return;
        fallbackTriggered = true;
        const voiceObj = displayVoices.find(v => v.id === voiceId);
        if (voiceObj) {
          playWebSpeechFallback(voiceObj.name, voiceObj.gender, voiceObj.category, voiceObj.tags);
        } else {
          setPlayingVoiceId(null);
        }
      };
      audio.onerror = () => {
        console.warn(`Audio error event fired for URL: ${url}. Triggering fallback...`);
        triggerFallback();
      };
      audio.onended = () => {
        if (!fallbackTriggered) {
          setPlayingVoiceId(null);
        }
      };
      audio.play().catch(err => {
        console.warn("Autoplay or preview playback failed:", err);
        triggerFallback();
      });
    }
  };

  // Compute final voices list
  const displayVoices = fetchedVoices.length > 0 
    ? [...ELEVENLABS_VOICES, ...fetchedVoices.filter(fv => !ELEVENLABS_VOICES.some(ev => ev.id === fv.id))]
    : ELEVENLABS_VOICES;

  // Safe duration variable to prevent any division by zero, NaN or Infinity layout errors
  const safeDuration = (typeof videoDuration === 'number' && !isNaN(videoDuration) && isFinite(videoDuration) && videoDuration > 0) ? videoDuration : 30;

  // Timeline tracks & clips
  const [tracks, setTracks] = useState<SoundtrackTrack[]>([
    { id: 'bgm', name: '配乐 BGM', type: 'bgm', isMuted: false, isSoloed: false },
    { id: 'sfx', name: '音效 SFX', type: 'sfx', isMuted: false, isSoloed: false },
    { id: 'dubbing', name: '配音旁白', type: 'dubbing', isMuted: false, isSoloed: false },
  ]);
  const [showAddTrackModal, setShowAddTrackModal] = useState<boolean>(false);
  const [newTrackName, setNewTrackName] = useState<string>('');
  const [newTrackType, setNewTrackType] = useState<'bgm' | 'sfx' | 'dubbing'>('sfx');

  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  
  // Scale / Zoom factor for horizontal scrolling (pixels per second)
  const [pixelsPerSecond, setPixelsPerSecond] = useState<number>(30);

  // Mouse interaction state for dragging and stretching clips
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [interactionType, setInteractionType] = useState<'drag' | 'resize-left' | 'resize-right' | null>(null);
  const [dragStartX, setDragStartX] = useState<number>(0);
  const [initialClipState, setInitialClipState] = useState<{ startTime: number; duration: number } | null>(null);

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
      const newHeight = Math.max(160, Math.min(600, timelineResizeStartRef.current.initialHeight - deltaY));
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

  // 3. Video area height resize mouse events
  useEffect(() => {
    if (!isResizingVideo) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - videoResizeStartRef.current.clientY;
      const newHeight = Math.max(180, Math.min(800, videoResizeStartRef.current.initialHeight + deltaY));
      setVideoHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizingVideo(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingVideo]);

  // 4. Property width resize mouse events
  useEffect(() => {
    if (!isResizingPropertyWidth) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - propertyWidthStartRef.current.clientX;
      const newWidth = Math.max(260, Math.min(600, propertyWidthStartRef.current.initialWidth - deltaX));
      setPropertyWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingPropertyWidth(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingPropertyWidth]);

  // 5. Property height resize mouse events
  useEffect(() => {
    if (!isResizingPropertyHeight) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - propertyHeightStartRef.current.clientY;
      const newHeight = Math.max(300, Math.min(1000, propertyHeightStartRef.current.initialHeight + deltaY));
      setPropertyHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizingPropertyHeight(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingPropertyHeight]);

  // 6. Copy/Paste keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const isCopy = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c';
      const isPaste = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v';

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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedClipId, clips, copiedClip, currentTime, safeDuration]);

  // Drag start trigger functions
  const startTimelineResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingTimeline(true);
    timelineResizeStartRef.current = {
      clientY: e.clientY,
      initialHeight: timelineHeight
    };
  };

  const startVideoResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingVideo(true);
    videoResizeStartRef.current = {
      clientY: e.clientY,
      initialHeight: videoHeight
    };
  };

  const startPropertyWidthResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingPropertyWidth(true);
    propertyWidthStartRef.current = {
      clientX: e.clientX,
      initialWidth: propertyWidth
    };
  };

  const startPropertyHeightResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingPropertyHeight(true);
    const currentEl = document.getElementById('properties-panel-container');
    const currentHeight = currentEl ? currentEl.clientHeight : propertyHeight;
    propertyHeightStartRef.current = {
      clientY: e.clientY,
      initialHeight: currentHeight
    };
    setPropertyHeight(currentHeight);
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
    const pastedClip: TimelineClip = {
      ...copiedClip,
      id: newId,
      startTime: Math.max(0, Math.min(currentTime, safeDuration - copiedClip.duration)),
      name: `${copiedClip.name} (副本)`
    };

    if (copiedClip.audioUrl) {
      const audio = new Audio(copiedClip.audioUrl);
      audio.volume = pastedClip.volume;
      audio.playbackRate = pastedClip.speed || 1.0;
      audioInstancesRef.current[newId] = audio;
    }

    setClips(prev => [...prev, pastedClip]);
    setSelectedClipId(newId);
    
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

    setSelectedClipId(clipId);
    setActiveClipId(clipId);
    setInteractionType(type);
    setDragStartX(e.clientX);
    setInitialClipState({
      startTime: targetClip.startTime,
      duration: targetClip.duration
    });
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

        return { ...clip, startTime: newStartTime, duration: newDuration };
      }));
    };

    const handleMouseUp = () => {
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

  const selectedClip = clips.find(c => c.id === selectedClipId);

  // Clean up all playing audios when component unmounts
  useEffect(() => {
    return () => {
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
    if (!videoRef.current) return;

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
          audioInstancesRef.current[clip.id] = audio;
        }
        
        // Configure loops
        if (clip.trackId === 'bgm') {
          audio.loop = true;
        } else {
          audio.loop = false;
        }

        audio.volume = clip.volume;
        const clipSpeed = clip.speed || 1.0;
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
      const clipSpeed = clip.speed || 1.0;
      
      let maxPlayableDuration = clip.duration;
      if (clip.trackId !== 'bgm' && audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        maxPlayableDuration = Math.min(clip.duration, audio.duration / clipSpeed);
      }

      if (offset >= 0 && offset < maxPlayableDuration && isTrackPlayable(clip.trackId)) {
        if (isPlaying && audio.paused) {
          setMediaTimeSafely(audio, offset * clipSpeed);
          audio.volume = clip.volume;
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

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(e => console.error(e));
      setIsPlaying(true);
    }
  };

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

  // Upload video via chunked uploads with a progress tracker (instant local playback, background sync with fallback to single upload)
  const uploadVideoFile = (file: File) => {
    setVideoLoadFailed(false);
    setSelectedFile(file);
    setIsUploading(true);
    setUploadProgress(0);
    setIsUploadingToServer(true);
    setError(null);
    setMixedVideoUrl(null);

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
    setVideoLoadFailed(false);
    setSelectedFile(file);
    setIsUploading(true);
    setUploadProgress(0);
    setIsUploadingToServer(true);
    setError(null);
    setMixedVideoUrl(null);

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
    if (!file) return;
    await relinkVideoFile(file);
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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

    setIsAnalyzing(true);
    setError(null);
    try {
      let keyframes: any[] = [];
      if (selectedFile) {
        try {
          console.log('Extracting video keyframes client-side...');
          keyframes = await extractVideoKeyframes(selectedFile, 8);
          console.log(`Successfully extracted ${keyframes.length} keyframes.`);
        } catch (kfErr) {
          console.warn('Failed to extract keyframes client-side, falling back to server video:', kfErr);
        }
      }

      // Fallback check: if no keyframes could be extracted, and the video hasn't uploaded to server yet, block
      if (keyframes.length === 0 && (isUploadingToServer || !videoFile.isUploaded)) {
        throw new Error('由于您的视频文件尚未成功同步到服务器，且浏览器端未能成功抓取关键帧，暂无法进行 AI 自动分析。请等待同步完成，或者您可以直接在下方轨道中手动设计并添加音轨块。');
      }

      const res = await fetch('/api/video/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: videoFile.name,
          keyframes: keyframes.length > 0 ? keyframes : undefined,
          bgmEnabled,
          sfxEnabled,
          dubbingEnabled
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '视频分析生成失败，请重试');
      }

      const data = await res.json();
      if (data.clips && Array.isArray(data.clips)) {
        // Map default volume values
        const mappedClips = data.clips.map((clip: any) => ({
          ...clip,
          volume: clip.trackId === 'bgm' ? 0.4 : 0.8,
          isGenerating: false
        }));
        setClips(mappedClips);
        if (mappedClips.length > 0) {
          setSelectedClipId(mappedClips[0].id);
        }
      } else {
        throw new Error('AI 未返回合适的时间轴配置，请重新尝试。');
      }
    } catch (err: any) {
      setError(err.message || '多模态智能分析出错');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Single timeline clip generator using ElevenLabs API on the server
  const handleGenerateAudioClip = async (clipId: string) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    // Update state to isGenerating
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, isGenerating: true, error: undefined } : c));

    try {
      const clipTrack = tracks.find(t => t.id === clip.trackId);
      const trackType = clipTrack ? clipTrack.type : undefined;

      const res = await fetch('/api/video/generate-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: clip.prompt,
          trackId: clip.trackId,
          trackType: trackType,
          text: clip.text,
          voiceId: clip.voiceId,
          duration: clip.duration
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'ElevenLabs 语音合成失败');
      }

      const data = await res.json();
      
      // Update clip with audio URL
      setClips(prev => prev.map(c => c.id === clipId ? { 
        ...c, 
        audioUrl: data.audioUrl, 
        isGenerating: false 
      } : c));

      // Prefetch and cache Audio element
      const audio = new Audio(data.audioUrl);
      audio.volume = clip.volume;
      audio.playbackRate = clip.speed || 1.0;
      audioInstancesRef.current[clipId] = audio;

      // Trigger success toast
      const displayTypeLabel = trackType === 'dubbing' ? '旁白配音' : trackType === 'bgm' ? '配乐BGM' : '专属音效';
      
      setToast({
        message: `成功为“${clip.name}”合成 ${displayTypeLabel}！`,
        type: 'success'
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

  // Generate audios for all clips in sequence
  const handleGenerateAll = async () => {
    for (const clip of clips) {
      if (!clip.audioUrl && !clip.isGenerating) {
        await handleGenerateAudioClip(clip.id);
      }
    }
  };

  // Mix all audio layers into original video using high performance ffmpeg
  const handleExportVideo = async () => {
    if (!videoFile) return;

    if (isUploadingToServer || !videoFile.isUploaded) {
      setError('视频文件尚未成功同步到服务器，无法在服务器端运行 FFmpeg 混音。请等待视频上传完成。');
      return;
    }

    const ungenerated = clips.filter(c => !c.audioUrl);
    if (ungenerated.length > 0) {
      setError('提示：还有一些音频尚未合成。我们将只混合已生成且未被静音的音频轨道。');
    }

    setIsMixing(true);
    setError(null);
    setMixedVideoUrl(null);

    try {
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

      const playableClips = clips.filter(c => c.audioUrl && isTrackPlayable(c.trackId));

      const res = await fetch('/api/video/mix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoFileName: videoFile.name,
          clips: playableClips
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '视频合成导出失败，请重试');
      }

      const data = await res.json();
      setMixedVideoUrl(data.videoUrl);
    } catch (err: any) {
      setError(err.message || 'FFmpeg 音画合成出错');
    } finally {
      setIsMixing(false);
    }
  };

  // Export Master Soundtrack (mixed) or Individual Track Stems (bgm / sfx / dubbing)
  const handleExportAudio = async (trackId: 'mixed' | 'bgm' | 'sfx' | 'dubbing') => {
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
      const hasActiveSolo = tracks.some(t => t.isSoloed);
      const isTrackPlayable = (id: string) => {
        const track = tracks.find(t => t.id === id);
        if (!track) return true;
        if (track.isMuted) return false;
        if (hasActiveSolo) {
          return track.isSoloed;
        }
        return true;
      };

      const generatedClips = clips.filter(c => c.audioUrl && isTrackPlayable(c.trackId));
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
      setError(err.message || 'FFmpeg 音频合成出错');
    } finally {
      if (trackId === 'mixed') setIsExportingMixed(false);
      else if (trackId === 'bgm') setIsExportingBgm(false);
      else if (trackId === 'sfx') setIsExportingSfx(false);
      else if (trackId === 'dubbing') setIsExportingDubbing(false);
    }
  };

  // Timeline seeking by clicking ruler
  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const targetTime = (clickX / rect.width) * safeDuration;
    
    if (targetTime >= 0 && targetTime <= safeDuration) {
      setMediaTimeSafely(videoRef.current, targetTime);
      setCurrentTime(targetTime);
    }
  };

  // Manual clip adjustment helpers
  const updateClipField = (clipId: string, field: keyof TimelineClip, value: any) => {
    setClips(prev => prev.map(c => {
      if (c.id === clipId) {
        const updated = { ...c, [field]: value };
        // Adjust audio volume if it exists
        if (field === 'volume' && audioInstancesRef.current[clipId]) {
          audioInstancesRef.current[clipId].volume = value;
        }
        // Adjust audio speed if it exists
        if (field === 'speed' && audioInstancesRef.current[clipId]) {
          audioInstancesRef.current[clipId].playbackRate = value;
        }
        return updated;
      }
      return c;
    }));
  };

  const handleAddNewClip = (trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    const trackType = track ? track.type : 'sfx';

    const id = `clip-manual-${Date.now()}`;
    const newClip: TimelineClip = {
      id,
      trackId,
      name: trackType === 'bgm' ? '新增配乐' : trackType === 'sfx' ? '新增音效' : '新增配音',
      prompt: trackType === 'bgm' ? 'acoustic light background music' : trackType === 'sfx' ? 'soft swoop impact' : 'please input narration prompt',
      text: trackType === 'dubbing' ? '这是一段配音台词旁白' : undefined,
      voiceId: trackType === 'dubbing' ? '21m00Tcm4TlvDq8ikWAM' : undefined,
      startTime: Math.min(currentTime, safeDuration - 5),
      duration: trackType === 'bgm' ? 10 : trackType === 'sfx' ? 2 : 4,
      volume: trackType === 'bgm' ? 0.4 : 0.8
    };
    
    setClips(prev => [...prev, newClip]);
    setSelectedClipId(id);
  };

  const toggleMuteTrack = (trackId: string) => {
    setTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        return { ...t, isMuted: !t.isMuted };
      }
      return t;
    }));
  };

  const toggleSoloTrack = (trackId: string) => {
    setTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        return { ...t, isSoloed: !t.isSoloed };
      }
      return t;
    }));
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
      isMuted: false,
      isSoloed: false
    };

    setTracks(prev => [...prev, newTrack]);
    setNewTrackName('');
    setShowAddTrackModal(false);

    setToast({
      message: `已成功创建新音轨“${name}”！`,
      type: 'success'
    });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDeleteTrack = (trackId: string) => {
    // Delete any clips belonging to this track
    setClips(prev => prev.filter(c => c.trackId !== trackId));
    setTracks(prev => prev.filter(t => t.id !== trackId));
    
    setToast({
      message: `音轨已删除，关联音频块已清空。`,
      type: 'info'
    });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDeleteClip = (clipId: string) => {
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
            <h1 className="text-2xl font-black text-white tracking-tight">AI视频生成音频</h1>
            <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
              融合多模态 AI 画面内容分析，一键智能编排配乐、音效及语音旁白，助您打造电影级原声大片。
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
              <span className="text-[11px] text-slate-500 mt-2 text-center leading-relaxed">从零开始上传您的视频，由 AI 自动解析画面并进行全轨道音轨编排。</span>
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
              <h1 className="text-sm font-bold text-slate-200">视频生成音频</h1>
              <p className="text-[10px] text-slate-400 flex items-center gap-1">
                <span>当前工程：</span>
                <span className="text-indigo-400 font-bold px-1.5 py-0.5 bg-indigo-950/50 border border-indigo-900/30 rounded">
                  {currentProjectId 
                    ? (savedProjectsList.find(p => p.id === currentProjectId)?.name || '已保存工程')
                    : '未保存的工程 (新)'
                  }
                </span>
              </p>
            </div>
          </div>

          {/* 工程管理控制 */}
          <div className="flex items-center gap-2 pl-4 border-l border-slate-800">
            <button
              onClick={handleCreateNewProject}
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
              onClick={() => setIsProjectActive(false)}
              className="flex items-center gap-1 bg-slate-900 hover:bg-red-950/40 hover:text-red-400 text-slate-400 font-bold text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-800 transition-all cursor-pointer"
              title="关闭当前工程并返回首页"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>返回首页</span>
            </button>
          </div>
        </div>

        {videoFile && (
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
                onClick={handleAnalyzeVideo}
                disabled={isAnalyzing}
                className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-lg shadow-indigo-500/10 disabled:opacity-50 transition-all duration-200 cursor-pointer"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>画面解析中...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI 自动解析画面配乐</span>
                  </>
                )}
              </button>

              <button
                id="btn-generate-all"
                onClick={handleGenerateAll}
                disabled={clips.length === 0}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs px-3 py-1.5 rounded-lg border border-slate-700 disabled:opacity-50 transition-all cursor-pointer"
              >
                <Music className="w-3.5 h-3.5" />
                <span>一键合成全部音轨</span>
              </button>

              <div className="relative">
                {isExportDropdownOpen && (
                  <div className="fixed inset-0 z-40" onClick={() => setIsExportDropdownOpen(false)} />
                )}
                <button
                  id="btn-export-dropdown"
                  onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
                  disabled={clips.length === 0}
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
                              <p className="text-[9px] text-slate-500">将合成音轨混入视频画面</p>
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
                              disabled={clips.length === 0}
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
                              <p className="text-[11px] font-bold text-slate-200">Master 完整混合音轨</p>
                              <p className="text-[9px] text-slate-500">配乐/音效/配音 全部合并 (.mp3)</p>
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
        {!videoFile ? (
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
                  <p className="text-[10px] text-slate-500 mt-1">推荐 MP4 格式，建议文件小于 50MB</p>
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
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
            {/* 左侧：播放器与波形面板 */}
            <div className="flex-1 flex flex-col bg-slate-950 border-r border-slate-800 overflow-y-auto custom-scrollbar p-6">
              
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
                    <span className="text-xs text-emerald-400 font-medium">视频文件已成功同步至服务器！所有 AI 功能与 FFmpeg 混音已就绪。</span>
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

              <div 
                className="w-full flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-xl overflow-hidden relative shadow-inner shrink-0"
                style={{ height: `${videoHeight}px` }}
              >
                {/* Video Height Resizer Handle */}
                <div 
                  className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize bg-slate-800/20 hover:bg-indigo-500/50 active:bg-indigo-600 transition-colors z-40" 
                  onMouseDown={startVideoResize}
                />
                {videoLoadFailed ? (
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
                    className="max-h-full max-w-full object-contain"
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleVideoLoaded}
                    onDurationChange={handleVideoLoaded}
                    onError={handleVideoError}
                    onClick={togglePlay}
                  />
                )}

                {/* 视频浮动控制条 */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-slate-950/90 border border-slate-800/80 px-4 py-2 rounded-full shadow-2xl">
                  <button
                    onClick={togglePlay}
                    className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg cursor-pointer transition-transform duration-150 active:scale-95"
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white translate-x-[1px]" />}
                  </button>

                  <div className="text-xs font-mono text-slate-300 select-none">
                    {currentTime.toFixed(2)}s / {safeDuration.toFixed(2)}s
                  </div>
                </div>
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
                      href={`/api/sfx/download-file?path=${encodeURIComponent(mixedVideoUrl)}&name=${encodeURIComponent(`mixed_${videoFile.name}`)}`}
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
              className="bg-slate-900 border-l border-slate-800 flex flex-col overflow-y-auto custom-scrollbar shrink-0 relative"
              style={{ width: `${propertyWidth}px`, height: `${propertyHeight}px` }}
            >
              {/* Left width resizer handle */}
              <div 
                className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize bg-transparent hover:bg-indigo-500/50 active:bg-indigo-600 transition-colors z-50"
                onMouseDown={startPropertyWidthResize}
              />
              {/* Bottom height resizer handle */}
              <div 
                className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize bg-transparent hover:bg-indigo-500/50 active:bg-indigo-600 transition-colors z-50"
                onMouseDown={startPropertyHeightResize}
              />
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

              <div className="p-4 flex-1 space-y-5">
                {selectedClip ? (
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
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">配音旁白台词 (中文)</label>
                          <textarea
                            value={selectedClip.text || ''}
                            onChange={(e) => updateClipField(selectedClip.id, 'text', e.target.value)}
                            className="w-full h-16 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none custom-scrollbar"
                          />
                        </div>
                        <div className="relative">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">选择配音音色 (ElevenLabs 官方音色库)</label>
                          
                          {/* Selected Voice Display & Trigger Button */}
                          {(() => {
                            const selectedVoiceId = selectedClip.voiceId || '21m00Tcm4TlvDq8ikWAM';
                            const selectedVoiceObj = displayVoices.find(v => v.id === selectedVoiceId);
                            return (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setShowVoiceDropdown(!showVoiceDropdown)}
                                  className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-lg py-2 px-3 text-xs text-left text-slate-200 focus:outline-none focus:border-indigo-500 transition-all flex items-center justify-between cursor-pointer"
                                >
                                  {selectedVoiceObj ? (
                                    <div className="flex items-center gap-2">
                                      <span className={`w-1.5 h-1.5 rounded-full ${selectedVoiceObj.gender === 'male' ? 'bg-blue-500' : 'bg-pink-500'}`} />
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-bold text-slate-200">{selectedVoiceObj.name}</span>
                                        <span className="text-[9px] text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.2 rounded font-bold">
                                          {selectedVoiceObj.category}
                                        </span>
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="text-slate-500">请选择精品配音角色...</span>
                                  )}
                                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${showVoiceDropdown ? 'rotate-180' : ''}`} />
                                </button>

                                {/* Interactive Voice Dropdown Popover */}
                                {showVoiceDropdown && (
                                  <div className="absolute top-full left-0 right-0 mt-1.5 bg-slate-900 border border-slate-800 rounded-xl shadow-xl z-50 p-3 space-y-2.5">
                                    {/* Keyword Search Input */}
                                    <div className="relative">
                                      <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
                                      <input
                                        type="text"
                                        value={voiceSearchQuery}
                                        onChange={(e) => setVoiceSearchQuery(e.target.value)}
                                        placeholder="搜索音色名称、分类、标签..."
                                        className="w-full bg-slate-950 border border-slate-800 rounded-lg py-1.5 pl-8 pr-7 text-[11px] text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all placeholder-slate-500"
                                      />
                                      {voiceSearchQuery && (
                                        <button
                                          type="button"
                                          onClick={() => setVoiceSearchQuery('')}
                                          className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>

                                    {/* Gender filters */}
                                    <div className="flex items-center gap-1 border-b border-slate-800 pb-1.5">
                                      <span className="text-[9px] font-bold text-slate-500 uppercase mr-1">声弹性别:</span>
                                      {['all', 'male', 'female'].map(g => (
                                        <button
                                          key={g}
                                          type="button"
                                          onClick={() => setVoiceGenderFilter(g as any)}
                                          className={`text-[9px] px-2 py-0.5 rounded font-bold transition-all ${
                                            voiceGenderFilter === g
                                              ? g === 'male' ? 'bg-blue-600 text-white' : g === 'female' ? 'bg-pink-600 text-white' : 'bg-indigo-600 text-white'
                                              : 'bg-slate-950 hover:bg-slate-800 text-slate-400'
                                          }`}
                                        >
                                          {g === 'all' ? '全部' : g === 'male' ? '男声' : '女声'}
                                        </button>
                                      ))}
                                    </div>

                                    {/* Category Filter Tabs */}
                                    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
                                      {['全部', '经典人声', '游戏动漫', '叙事小说', '媒体广告', '高雅格调', '我的克隆'].map(cat => {
                                        if (cat === '我的克隆' && !displayVoices.some(v => v.category === '我的克隆')) {
                                          return null;
                                        }
                                        return (
                                          <button
                                            key={cat}
                                            type="button"
                                            onClick={() => setVoiceActiveCategory(cat)}
                                            className={`text-[9px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap transition-all shrink-0 ${
                                              voiceActiveCategory === cat
                                                ? 'bg-indigo-950/40 border-indigo-500/40 text-indigo-300 font-bold'
                                                : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-400'
                                            }`}
                                          >
                                            {cat}
                                          </button>
                                        );
                                      })}
                                    </div>

                                    {/* Scrollable List container */}
                                    <div className="max-h-48 overflow-y-auto divide-y divide-slate-800/60 custom-scrollbar pr-0.5">
                                      {isLoadingVoices ? (
                                        <div className="py-8 flex flex-col items-center justify-center gap-1.5 text-slate-500 text-[11px]">
                                          <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                                          <span>正在同步 ElevenLabs 声线库...</span>
                                        </div>
                                      ) : (() => {
                                        const filteredVoices = displayVoices.filter(voice => {
                                          if (voiceActiveCategory !== '全部' && voice.category !== voiceActiveCategory) return false;
                                          if (voiceGenderFilter !== 'all' && voice.gender !== voiceGenderFilter) return false;
                                          if (voiceSearchQuery.trim()) {
                                            const q = voiceSearchQuery.toLowerCase();
                                            return voice.name.toLowerCase().includes(q) ||
                                                   voice.englishName.toLowerCase().includes(q) ||
                                                   voice.category.toLowerCase().includes(q) ||
                                                   voice.description.toLowerCase().includes(q) ||
                                                   voice.tags.some(t => t.toLowerCase().includes(q));
                                          }
                                          return true;
                                        });

                                        if (filteredVoices.length === 0) {
                                          return (
                                            <div className="py-6 text-center text-slate-500 text-[11px]">
                                              未找到匹配的优质声线
                                            </div>
                                          );
                                        }

                                        return filteredVoices.map(voice => {
                                          const isSelected = selectedVoiceId === voice.id;
                                          const isVoicePlaying = playingVoiceId === voice.id;
                                          return (
                                            <div
                                              key={voice.id}
                                              onClick={() => {
                                                updateClipField(selectedClip.id, 'voiceId', voice.id);
                                                setShowVoiceDropdown(false);
                                              }}
                                              className={`py-1.5 px-2 rounded-lg flex items-start justify-between gap-2.5 cursor-pointer transition-colors ${
                                                isSelected ? 'bg-indigo-500/10' : 'hover:bg-slate-800/40'
                                              }`}
                                            >
                                              <div className="min-w-0 flex-1 space-y-0.5">
                                                <div className="flex items-center flex-wrap gap-1">
                                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${voice.gender === 'male' ? 'bg-blue-500' : 'bg-pink-500'}`} />
                                                  <span className="text-xs font-bold text-slate-200">{voice.name}</span>
                                                  <span className="text-[9px] text-slate-400 bg-slate-950 px-1 py-0.2 rounded border border-slate-800 font-mono">
                                                    {voice.category}
                                                  </span>
                                                </div>
                                                <p className="text-[10px] text-slate-400 truncate leading-normal">{voice.description}</p>
                                                <div className="flex flex-wrap gap-1">
                                                  {voice.tags.slice(0, 3).map((tag, tIdx) => (
                                                    <span key={tIdx} className="text-[9px] text-indigo-400 bg-indigo-500/10 px-1 rounded-sm">
                                                      #{tag}
                                                    </span>
                                                  ))}
                                                </div>
                                              </div>

                                              <div className="flex items-center gap-1 shrink-0 pt-0.5">
                                                {/* Play Preview */}
                                                <button
                                                  type="button"
                                                  onClick={(e) => handlePlayVoicePreview(voice.id, voice.previewUrl, e)}
                                                  className={`w-6 h-6 rounded-full flex items-center justify-center border transition-all ${
                                                    isVoicePlaying
                                                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm animate-pulse'
                                                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border-slate-800 hover:bg-slate-800'
                                                  }`}
                                                  title={isVoicePlaying ? '暂停试听' : '点击试听音质'}
                                                >
                                                  {isVoicePlaying ? (
                                                    <Pause className="w-3 h-3 fill-current" />
                                                  ) : (
                                                    <Play className="w-3 h-3 fill-current ml-0.5" />
                                                  )}
                                                </button>

                                                {/* Selection mark */}
                                                <div className={`w-4 h-4 rounded-full flex items-center justify-center border ${
                                                  isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-800 bg-slate-950'
                                                }`}>
                                                  {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        });
                                      })()}
                                    </div>
                                  </div>
                                )}

                                {/* Selected Voice Detailed Card */}
                                {selectedVoiceObj && (
                                  <div className="mt-1.5 p-2 bg-gradient-to-br from-indigo-950/25 to-slate-950/40 border border-indigo-500/20 rounded-lg text-[10px] text-slate-400 space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="font-semibold text-indigo-300">已选声线：{selectedVoiceObj.name}</span>
                                      <span className="text-[9px] text-slate-400 font-mono bg-slate-950 px-1 py-0.2 rounded border border-slate-800">{selectedVoiceObj.category}</span>
                                    </div>
                                    <p className="text-[10px] text-slate-400 leading-relaxed">
                                      {selectedVoiceObj.description}
                                    </p>
                                    <div className="flex flex-wrap gap-1 pt-0.5">
                                      {selectedVoiceObj.tags.map((tag, idx) => (
                                        <span key={idx} className="text-[9px] text-indigo-400 bg-indigo-500/10 px-1 rounded-sm">
                                          #{tag}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>

                        {/* 语速调整 */}
                        <div className="mt-3.5 pt-3.5 border-t border-slate-800/60">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <Gauge className="w-3.5 h-3.5 text-indigo-400" />
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">配音语速</label>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono font-bold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.2 rounded">
                                {(selectedClip.speed || 1.0).toFixed(2)}x
                              </span>
                              {(selectedClip.speed && selectedClip.speed !== 1.0) ? (
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
                              value={selectedClip.speed || 1.0}
                              onChange={(e) => updateClipField(selectedClip.id, 'speed', parseFloat(e.target.value))}
                              className="flex-1 accent-indigo-500 bg-slate-950 h-1 rounded-lg cursor-pointer"
                            />
                            <span className="text-[9px] text-slate-500 font-medium">极快</span>
                          </div>
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
                          <div className="flex items-center gap-2 p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs font-semibold justify-center">
                            <Check className="w-4 h-4 shrink-0" />
                            <span>音频已成功生成</span>
                          </div>
                          <button
                            onClick={() => handleGenerateAudioClip(selectedClip.id)}
                            className="w-full flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs py-2 rounded-lg border border-slate-700 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>重新合成此轨道</span>
                          </button>
                        </div>
                      ) : (
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
                              <span>一键合成此单条音轨</span>
                            </>
                          )}
                        </button>
                      )}

                      {selectedClip.error && (
                        <p className="text-[10px] text-red-400 mt-2 text-center bg-red-500/5 border border-red-500/10 p-2 rounded">
                          {selectedClip.error}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 p-4 space-y-3">
                    <Sliders className="w-8 h-8 text-slate-700 stroke-[1.5]" />
                    <div className="space-y-1">
                      <p className="text-xs">未选中任何时间轴音频块</p>
                      <p className="text-[10px] text-slate-600 leading-normal">点击下部时间轨上的音频块，即可在此处配置提示词及声音属性。</p>
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
      {videoFile && (
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
          {/* Timeline Header with Zoom Controls */}
          <div className="flex items-center justify-between mb-3 px-2 pt-1">
            <div className="flex items-center gap-2 min-w-0">
              <Sliders className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="text-xs font-bold text-slate-300 truncate">多轨时间轴剪辑区</span>
              <span className="text-[10px] text-slate-500 font-medium truncate hidden md:inline">（支持拖拽移动位置、左右边缘拉伸长度）</span>
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
            
            {/* Zoom Controls */}
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-2 py-1 rounded-lg shrink-0">
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
            
            {/* Left Column: Track Headers */}
            <div className="w-32 shrink-0 bg-slate-900/80 border-r border-slate-800 flex flex-col">
              {/* Spacer for ruler height (32px) */}
              <div className="h-8 bg-slate-950/40 border-b border-slate-800/60 flex items-center justify-end pr-3 select-none text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                轨道列表
              </div>
              
              {/* Row headers corresponding to each track */}
              <div className="flex-1 flex flex-col space-y-2.5 p-2 bg-slate-900 overflow-y-auto custom-scrollbar">
                {/* 1. Video Preview Track Header */}
                <div className="h-9 flex items-center justify-end pr-2 text-right shrink-0">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 justify-end">
                    <Film className="w-3 h-3 text-indigo-400" />
                    视频画面
                  </span>
                </div>
                
                {/* Dynamic Track Headers */}
                {tracks.map((track) => {
                  const IconComponent = track.type === 'bgm' ? Music : track.type === 'dubbing' ? Mic : Waves;
                  const iconColor = track.type === 'bgm' ? 'text-emerald-400' : track.type === 'dubbing' ? 'text-purple-400' : 'text-blue-400';
                  const isDefaultTrack = ['bgm', 'sfx', 'dubbing'].includes(track.id);
                  
                  return (
                    <div key={track.id} className="h-12 flex flex-col justify-between p-1.5 bg-slate-950/45 border border-slate-800/40 rounded-lg group shrink-0">
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
                        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider truncate flex-1 flex items-center gap-1 min-w-0">
                          <IconComponent className={`w-3 h-3 shrink-0 ${iconColor}`} />
                          <span className="truncate">{track.name}</span>
                        </span>
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

                      {/* Bottom row: Mute and Solo buttons */}
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
                            title="静音 (Mute)"
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
                            title="独奏 (Solo)"
                          >
                            S
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Add Track Button */}
                <button
                  type="button"
                  onClick={() => {
                    setNewTrackName('');
                    setNewTrackType('sfx');
                    setShowAddTrackModal(true);
                  }}
                  className="w-full h-10 border border-dashed border-slate-800 hover:border-indigo-500/65 bg-slate-950/20 hover:bg-indigo-500/5 text-slate-500 hover:text-indigo-400 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer text-[10px] font-bold mt-2 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>新建轨道</span>
                </button>
              </div>
            </div>
            
            {/* Right Column: Horizontally Scrollable Timeline Body */}
            <div className="flex-1 overflow-x-auto custom-scrollbar bg-slate-950/20" ref={timelineRef}>
              <div 
                className="relative flex flex-col select-none"
                style={{ width: '100%', minWidth: `${safeDuration * pixelsPerSecond}px` }}
              >
                
                {/* Timeline Ruler Row */}
                <div 
                  onClick={handleRulerClick}
                  className="h-8 bg-slate-900 border-b border-slate-800 relative cursor-col-resize select-none overflow-hidden shrink-0"
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
                
                {/* Track rows corresponding directly to headers */}
                <div className="flex-1 flex flex-col space-y-2.5 p-2 bg-slate-950/30 relative">
                  
                  {/* Vertical Playhead Line running across ALL rows! */}
                  <div 
                    className="absolute top-0 bottom-0 w-[1.5px] bg-rose-500 z-30 pointer-events-none"
                    style={{ left: `${(currentTime / safeDuration) * 100}%` }}
                  >
                    <div className="w-2.5 h-2.5 bg-rose-500 rounded-full absolute -top-1 -left-1 shadow-lg shadow-rose-500/50" />
                  </div>

                  {/* 1. Video Preview Track Row */}
                  <div className="h-9 bg-indigo-950/10 rounded-lg border border-indigo-900/20 overflow-hidden relative">
                    <div className="absolute inset-0 flex items-center justify-around opacity-15 text-[9px] text-indigo-400 font-mono">
                      <span>镜头 A</span>
                      <span>镜头 B</span>
                      <span>镜头 C</span>
                      <span>镜头 D</span>
                    </div>
                  </div>
                  
                  {/* Dynamic Track Rows */}
                  {(() => {
                    const hasActiveSolo = tracks.some(t => t.isSoloed);
                    return tracks.map((track) => {
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
                        <div 
                          key={track.id} 
                          className={`h-12 rounded-lg border relative transition-all ${
                            track.isMuted 
                              ? 'bg-red-950/5 border-red-900/10 opacity-60' 
                              : hasActiveSolo && !track.isSoloed
                                ? 'bg-slate-900/20 border-slate-800/40 opacity-40'
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
                                    setSelectedClipId(clip.id);
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
                      );
                    });
                  })()}
                  
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
              toast.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              {toast.type === 'success' ? (
                <CheckCircle2 className="w-4.5 h-4.5" />
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
