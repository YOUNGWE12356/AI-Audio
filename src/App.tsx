/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useState, useRef, useEffect } from 'react';
import { Menu } from 'lucide-react';
import {
  analyzeAudioDesign,
  analyzeAudioDesignPreuploadedVideo,
  analyzeAudioDesignVideo,
  AudioDesignResult,
  preuploadAudioDesignVideo,
  regenerateLyrics,
  translateToEnglish,
} from './services/geminiService';
import { generateSoundEffect, generateMusic, generateVoice } from './services/elevenLabsService';
import { FileItem, HistoryItem, TabType } from './types';
import { ELEVENLABS_VOICES, VoiceItem } from './data/voices';
import { fetchPlatformHealth } from './services/platformService';
import { prepareFilesForGemini } from './utils/mediaPreparation';

export interface PendingMusicOption {
  id: 'A' | 'B';
  url: string;
  title: string;
  prompt: string;
  timestamp: string;
  details: string;
  duration: number;
  type: 'instrumental' | 'vocal';
}

// Modular Components
import Sidebar from './components/Sidebar';
import Workbench from './components/Workbench';

const AudioDirector = lazy(() => import('./components/AudioDirector'));
const MusicStudio = lazy(() => import('./components/MusicStudio'));
const SfxStudio = lazy(() => import('./components/SfxStudio'));
const DubbingStudio = lazy(() => import('./components/DubbingStudio'));
const AudioTools = lazy(() => import('./components/AudioTools'));
const SettingsComponent = lazy(() => import('./components/Settings'));
const SfxLibrary = lazy(() => import('./components/SfxLibrary'));
const SfxRequirements = lazy(() => import('./components/SfxRequirements'));
const VideoSoundtrack = lazy(() => import('./components/VideoSoundtrack'));

function WorkspaceLoading() {
  return (
    <div className="flex min-h-full items-center justify-center p-8" role="status" aria-live="polite">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-600 shadow-sm">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" aria-hidden="true" />
        正在加载工作空间…
      </div>
    </div>
  );
}

export default function App() {
  const [currentTab, setCurrentTab] = useState<TabType>('workbench');
  const [visitedTabs, setVisitedTabs] = useState<Set<TabType>>(() => new Set(['workbench']));
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  
  // The HTML5 client only reads service availability from the same-origin API.
  // Secret values remain on the server and are never embedded into the bundle.
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [hasElevenLabsKey, setHasElevenLabsKey] = useState(false);
  const elevenLabsQualityMode = 'pro' as const;
  const isElevenLabsProMode = true;

  const handleKeysUpdated = () => {
    fetchPlatformHealth()
      .then((health) => {
        setHasGeminiKey(health.services.gemini);
        setHasElevenLabsKey(health.services.elevenLabs);
      })
      .catch(() => {
        setHasGeminiKey(false);
        setHasElevenLabsKey(false);
      });
  };

  useEffect(() => {
    handleKeysUpdated();
  }, []);

  useEffect(() => {
    setVisitedTabs(prev => {
      if (prev.has(currentTab)) return prev;
      const next = new Set(prev);
      next.add(currentTab);
      return next;
    });
  }, [currentTab]);

  // Pre-filled sample historic creations for a complete look on first load
  const [historyList, setHistoryList] = useState<HistoryItem[]>([
    {
      id: 'h-1',
      type: 'music',
      title: '独立音乐 - Epic Cyberpunk Horizon',
      prompt: 'epic synthwave track with heavy bass, retro drums, space guitar, and glowing cyber vibe',
      url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
      timestamp: '2026-07-08 00:05',
      details: '30秒 · 纯音乐'
    },
    {
      id: 'h-2',
      type: 'sfx',
      title: '独立音效 - Mechanical Footstep (Foley)',
      prompt: 'robotic heavy metallic steps on solid surface, slow pacing, high detail',
      url: 'https://actions.google.com/sounds/v1/science_fiction/heavy_industrial_machine.ogg',
      timestamp: '2026-07-08 00:15',
      details: '5秒 · 电影声效'
    },
    {
      id: 'h-3',
      type: 'voice',
      title: '角色配音',
      prompt: '欢迎来到AI多模态音频创作中心。在这里，我们将文字、画面与声音完美融合，创造前所未有的视听享受。',
      url: 'https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg',
      timestamp: '2026-07-08 00:28',
      details: '12秒 · 平静自然'
    }
  ]);

  // Audio Director States
  const [files, setFiles] = useState<FileItem[]>([]);
  const [requirements, setRequirements] = useState('');
  const [target, setTarget] = useState({ game: true, video: false, avatar: false, sunnyIsland: false });
  const [loading, setLoading] = useState(false);
  const [analysisStage, setAnalysisStage] = useState('正在准备素材...');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AudioDesignResult | null>(null);
  const [activeTab, setActiveTab] = useState<'sfx' | 'bgm'>('sfx');
  const [selectedLyrics, setSelectedLyrics] = useState<{ sectionIndex: number; text: string } | null>(null);
  const [lyricEditDirection, setLyricEditDirection] = useState('');
  const [editingLyrics, setEditingLyrics] = useState(false);
  const [isInstrumental, setIsInstrumental] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const analysisRunningRef = useRef(false);
  const filesRef = useRef<FileItem[]>([]);
  const previousFilesRef = useRef<FileItem[]>([]);
  const objectUrlsRef = useRef<{
    pendingSfxOptionAUrl: string | null;
    pendingSfxOptionBUrl: string | null;
    pendingMusicOptionAUrl: string | null;
    pendingMusicOptionBUrl: string | null;
    pendingVoiceOptionAUrl: string | null;
    pendingVoiceOptionBUrl: string | null;
  }>({
    pendingSfxOptionAUrl: null,
    pendingSfxOptionBUrl: null,
    pendingMusicOptionAUrl: null,
    pendingMusicOptionBUrl: null,
    pendingVoiceOptionAUrl: null,
    pendingVoiceOptionBUrl: null,
  });
  const preuploadAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const preuploadPromisesRef = useRef<Map<string, Promise<void>>>(new Map());

  // Standalone SFX Generator States
  const [standalonePrompt, setStandalonePrompt] = useState('');
  const [standaloneDuration, setStandaloneDuration] = useState(1);
  const [standaloneLoading, setStandaloneLoading] = useState(false);
  const [standaloneError, setStandaloneError] = useState<string | null>(null);
  const [pendingSfxOptions, setPendingSfxOptions] = useState<{
    optionA: { url: string; title: string; prompt: string; timestamp: string; details: string; duration: number } | null;
    optionB: { url: string; title: string; prompt: string; timestamp: string; details: string; duration: number } | null;
  }>({ optionA: null, optionB: null });

  // Standalone Music Generator States
  const [standaloneMusicPrompt, setStandaloneMusicPrompt] = useState('');
  const [standaloneMusicDuration, setStandaloneMusicDuration] = useState(30);
  const [standaloneMusicType, setStandaloneMusicType] = useState<'instrumental' | 'vocal'>('instrumental');
  const [standaloneMusicLyrics, setStandaloneMusicLyrics] = useState('');
  const [standaloneMusicLoading, setStandaloneMusicLoading] = useState(false);
  const [standaloneMusicAudioUrl, setStandaloneMusicAudioUrl] = useState<string | null>(null);
  const [pendingMusicOptions, setPendingMusicOptions] = useState<{
    optionA: PendingMusicOption | null;
    optionB: PendingMusicOption | null;
  }>({ optionA: null, optionB: null });
  const [standaloneMusicError, setStandaloneMusicError] = useState<string | null>(null);
  const standaloneMusicAudioRef = useRef<HTMLAudioElement | null>(null);

  // Standalone Voiceover Generator States
  const [standaloneVoiceText, setStandaloneVoiceText] = useState('');
  const [standaloneVoiceGender, setStandaloneVoiceGender] = useState<'male' | 'female'>('male');
  const [standaloneVoiceRole, setStandaloneVoiceRole] = useState(''); 
  const [selectedStandaloneVoice, setSelectedStandaloneVoice] = useState<VoiceItem | null>(null);
  const [standaloneVoiceEmotion, setStandaloneVoiceEmotion] = useState('');
  const [standaloneVoiceLang, setStandaloneVoiceLang] = useState('zh');
  const [standaloneVoiceSpeed, setStandaloneVoiceSpeed] = useState<number>(1.0);
  const [standaloneVoiceLoading, setStandaloneVoiceLoading] = useState(false);
  const [standaloneVoiceAudioUrl, setStandaloneVoiceAudioUrl] = useState<string | null>(null);
  const [standaloneVoiceError, setStandaloneVoiceError] = useState<string | null>(null);
  const standaloneVoiceAudioRef = useRef<HTMLAudioElement | null>(null);

  // Two alternatives state for standalone voiceover generation
  const [pendingVoiceOptions, setPendingVoiceOptions] = useState<{
    optionA: { url: string; voiceLabel: string; displayName: string; emotionLabel: string; processedText: string; timestamp: string; details: string; speed: number } | null;
    optionB: { url: string; voiceLabel: string; displayName: string; emotionLabel: string; processedText: string; timestamp: string; details: string; speed: number } | null;
  }>({ optionA: null, optionB: null });

  useEffect(() => {
    const currentPreviewUrls = new Set(files.map(file => file.preview));
    previousFilesRef.current.forEach((file) => {
      if (!currentPreviewUrls.has(file.preview)) {
        URL.revokeObjectURL(file.preview);
      }
    });
    previousFilesRef.current = files;
  }, [files]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      const latestUrls = objectUrlsRef.current;
      previousFilesRef.current.forEach(f => URL.revokeObjectURL(f.preview));
      if (latestUrls.pendingSfxOptionAUrl) URL.revokeObjectURL(latestUrls.pendingSfxOptionAUrl);
      if (latestUrls.pendingSfxOptionBUrl) URL.revokeObjectURL(latestUrls.pendingSfxOptionBUrl);
      if (latestUrls.pendingMusicOptionAUrl) URL.revokeObjectURL(latestUrls.pendingMusicOptionAUrl);
      if (latestUrls.pendingMusicOptionBUrl) URL.revokeObjectURL(latestUrls.pendingMusicOptionBUrl);
      if (latestUrls.pendingVoiceOptionAUrl) URL.revokeObjectURL(latestUrls.pendingVoiceOptionAUrl);
      if (latestUrls.pendingVoiceOptionBUrl) URL.revokeObjectURL(latestUrls.pendingVoiceOptionBUrl);
    };
  }, []);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    objectUrlsRef.current = {
      pendingSfxOptionAUrl: pendingSfxOptions.optionA?.url || null,
      pendingSfxOptionBUrl: pendingSfxOptions.optionB?.url || null,
      pendingMusicOptionAUrl: pendingMusicOptions.optionA?.url || null,
      pendingMusicOptionBUrl: pendingMusicOptions.optionB?.url || null,
      pendingVoiceOptionAUrl: pendingVoiceOptions.optionA?.url || null,
      pendingVoiceOptionBUrl: pendingVoiceOptions.optionB?.url || null,
    };
  }, [pendingSfxOptions, pendingMusicOptions, pendingVoiceOptions]);

  useEffect(() => {
    const liveFileIds = new Set(files.map(item => item.id));
    preuploadAbortControllersRef.current.forEach((controller, fileId) => {
      if (!liveFileIds.has(fileId)) {
        controller.abort('removed');
        preuploadAbortControllersRef.current.delete(fileId);
        preuploadPromisesRef.current.delete(fileId);
      }
    });

    if (!hasGeminiKey) return;

    const updatePreuploadState = (fileId: string, patch: NonNullable<FileItem['preupload']>) => {
      setFiles(prev => prev.map(item => {
        if (item.id !== fileId) return item;
        return {
          ...item,
          preupload: {
            ...(item.preupload || { status: 'uploading' as const, progress: 0 }),
            ...patch,
          },
        };
      }));
    };

    files.forEach((item) => {
      if (!item.type.startsWith('video/')) return;
      if (item.preupload || preuploadPromisesRef.current.has(item.id)) return;

      const controller = new AbortController();
      preuploadAbortControllersRef.current.set(item.id, controller);
      updatePreuploadState(item.id, {
        status: 'uploading',
        progress: 0,
        message: '正在后台预上传视频...',
      });

      const preuploadPromise = preuploadAudioDesignVideo(item.file, {
        signal: controller.signal,
        onProgress: (progress, message) => {
          updatePreuploadState(item.id, {
            status: progress >= 96 ? 'processing' : 'uploading',
            progress,
            message,
          });
        },
      })
        .then((upload) => {
          updatePreuploadState(item.id, {
            status: 'ready',
            progress: 100,
            uploadId: upload.uploadId,
            message: '视频已预上传，点击分析会更快。',
          });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          updatePreuploadState(item.id, {
            status: 'error',
            progress: 0,
            error: error instanceof Error ? error.message : '视频预上传失败。',
            message: '预上传失败，点击分析时会尝试原流程。',
          });
        })
        .finally(() => {
          preuploadAbortControllersRef.current.delete(item.id);
        });

      preuploadPromisesRef.current.set(item.id, preuploadPromise);
    });
  }, [files, hasGeminiKey]);

  useEffect(() => {
    return () => {
      preuploadAbortControllersRef.current.forEach(controller => controller.abort('unmount'));
      preuploadAbortControllersRef.current.clear();
      preuploadPromisesRef.current.clear();
    };
  }, []);

  // Voiceover generator handler
  const handleStandaloneVoiceGenerate = async () => {
    if (!hasElevenLabsKey) {
      setStandaloneVoiceError('ELEVENLABS_API_KEY 未配置，请前往设置页面或 Secrets 面板添加。');
      return;
    }
    if (!standaloneVoiceText.trim()) {
      setStandaloneVoiceError('请输入要配音的角色台词文本');
      return;
    }
    if (!standaloneVoiceRole.trim()) {
      setStandaloneVoiceError('当前配音库暂无可用声线，请先在 ElevenLabs 添加或恢复声线');
      return;
    }

    setStandaloneVoiceLoading(true);
    setStandaloneVoiceError(null);
    try {
      const processedText = standaloneVoiceText.trim();
      
      // Extract, translate and convert inline bracketed emotions into separate English brackets for slider/synthesis logic
      // Matches square brackets [] and ［］
      const bracketRegex = /[\[［]([^\]］]+)[\]］]/g;
      const bracketMatches = [...processedText.matchAll(bracketRegex)];
      
      // We will also keep track of all translated emotions to adjust synthesis sliders intelligently
      const allTranslatedEmotions: string[] = [];

      for (const match of bracketMatches) {
        const insideText = match[1].trim();
        
        let englishParts: string[] = [];
        try {
          let englishTranslation = insideText;
          if (/[\u4e00-\u9fa5]/.test(insideText)) {
            const translated = await translateToEnglish(insideText);
            if (translated) {
              englishTranslation = translated;
            }
          }
          
          englishParts = englishTranslation
            .split(/、|,|，|\/|\s+|and/)
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
          
          allTranslatedEmotions.push(...englishParts);
        } catch (e) {
          console.error("Failed to translate inline emotion:", e);
          englishParts = insideText.split(/、|,|，|\/|\s+/).map(s => s.trim().toLowerCase());
          allTranslatedEmotions.push(...englishParts);
        }
      }

      // Eleven v3 understands bracketed performance directions such as [excited] / [whispering].
      // Keep the bracketed text for v3, but provide a clean fallback text for older models so tags are not spoken aloud.
      const elevenV3Text = processedText;
      const finalSpokenText = processedText
        .replace(bracketRegex, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Translate voice role/setting to English
      let englishRole = standaloneVoiceRole.trim();
      if (englishRole && !/^[a-zA-Z0-9\s\.,!\?'"\(\)\-\/]*$/.test(englishRole)) {
        try {
          const translated = await translateToEnglish(englishRole);
          if (translated) {
            englishRole = translated;
          }
        } catch (e) {
          console.error("Failed to translate voice role:", e);
        }
      }

      // Automatically determine gender based on selected voice or custom description
      let detectedGender: 'male' | 'female' = 'female';
      const selectedVoiceObj = ELEVENLABS_VOICES.find(v => v.id === standaloneVoiceRole);
      if (selectedVoiceObj) {
        detectedGender = selectedVoiceObj.gender;
      } else if (/男|male|man|sir|boy|uncle|大叔|老头|绅士|爷爷|爸爸/i.test(standaloneVoiceRole)) {
        detectedGender = 'male';
      } else if (/女|female|woman|lady|girl|princess|公主|御姐|loli|萝莉|Glinda/i.test(standaloneVoiceRole)) {
        detectedGender = 'female';
      } else {
        detectedGender = standaloneVoiceGender || 'female';
      }
      setStandaloneVoiceGender(detectedGender);

      // Intelligent parsing for unified emotions
      const rawEmoDesc = bracketMatches.map(m => m[1].trim()).filter(Boolean).join(', ');
      
      const normalizedEmotionText = allTranslatedEmotions.join(' ').toLowerCase();
      const isHighEnergyEmotion = /excited|energetic|angry|furious|shout|shouting|surprised|fear|scared|urgent|tense|happy|joy|cheerful|激动|兴奋|愤怒|惊讶|紧张|开心|高兴|热血/.test(normalizedEmotionText);
      const isSoftEmotion = /whisper|whispering|soft|calm|gentle|sad|cry|crying|tired|weak|warm|温柔|轻声|低语|悲伤|难过|哭|平静|疲惫/.test(normalizedEmotionText);
      const stability = isSoftEmotion ? (isElevenLabsProMode ? 0.50 : 0.55) : (isElevenLabsProMode ? 0.45 : 0.50);
      const similarity = isElevenLabsProMode ? 0.82 : 0.75;
      const styleExaggeration = isHighEnergyEmotion
        ? (isElevenLabsProMode ? 0.28 : 0.16)
        : isSoftEmotion
          ? (isElevenLabsProMode ? 0.10 : 0.04)
          : (isElevenLabsProMode ? 0.14 : 0.0);

      // Intelligent fallback parsing for custom voice descriptions
      const voiceDesc = englishRole;
      let voiceId = englishRole;

      // Check if voiceDesc matches any predefined ELEVENLABS_VOICES ID or is a direct 20-character ID
      const directVoiceMatch = ELEVENLABS_VOICES.find(v => v.id === voiceDesc);
      if (directVoiceMatch) {
        voiceId = directVoiceMatch.id;
      } else if (/^[a-zA-Z0-9_]{20}$/.test(voiceDesc)) {
        voiceId = voiceDesc;
      } else {
        if (detectedGender === 'male') {
          if (/旁白|稳重|磁性|深沉|男声|默认|narrator|deep|mature|calm|voiceover|default/.test(voiceDesc)) {
            voiceId = standaloneVoiceRole;
          } else if (/冒险|战士|热血|强壮|粗犷|活力|勇敢|青年|warrior|brave|adventure|excited|strong|young/.test(voiceDesc)) {
            voiceId = standaloneVoiceRole;
          } else if (/智者|老人|长者|老头|沙哑|沧桑|sage|old|elder|wise|hoarse|raspy/.test(voiceDesc)) {
            voiceId = standaloneVoiceRole;
          }
        } else {
          if (/知性|温柔|御姐|老师|干练|女声|默认|intellectual|gentle|sweet|mature|default/.test(voiceDesc)) {
            voiceId = standaloneVoiceRole;
          } else if (/公主|优雅|甜美|高贵|唯美|少女|princess|elegant|noble|beautiful|young lady|girl/.test(voiceDesc)) {
            voiceId = 'z9fAnlkF97DxeAlidscJ'; // Glinda
          } else if (/二次元|动漫|可爱|萝莉|活泼|赛博|cyber|cute|anime|loli|lively|energetic/.test(voiceDesc)) {
            voiceId = standaloneVoiceRole;
          }
        }
      }

      const selectedGeneratedVoice = selectedStandaloneVoice?.id === voiceId ? selectedStandaloneVoice : null;
      const sharedVoiceOptions = selectedGeneratedVoice?.source === 'voice_library'
        ? {
            voiceSource: 'voice_library' as const,
            publicOwnerId: selectedGeneratedVoice.publicOwnerId,
            voiceName: selectedGeneratedVoice.name,
          }
        : {};
      const takeSeedBase = Date.now() % 1_000_000_000;

      // Generate the two selectable takes sequentially for the same ElevenLabs voice.
      // Voice Library voices can trigger an internal "add voice" step on first use;
      // parallel requests for the same voice may collide and return
      // "Multiple voice additions/deletions for the same voice were called at the same time".
      const blobA = await generateVoice(
        elevenV3Text,
        voiceId,
        stability,
        similarity,
        styleExaggeration,
        {
          qualityMode: elevenLabsQualityMode,
          fallbackText: finalSpokenText,
          seed: takeSeedBase,
          ...sharedVoiceOptions,
        },
      );
      const blobB = await generateVoice(
        elevenV3Text,
        voiceId,
        stability,
        similarity,
        styleExaggeration,
        {
          qualityMode: elevenLabsQualityMode,
          fallbackText: finalSpokenText,
          seed: takeSeedBase + 1,
          ...sharedVoiceOptions,
        },
      );
      const urlA = URL.createObjectURL(blobA);
      const urlB = URL.createObjectURL(blobB);
      
      // Auto-set standard URL to Option A for direct back-compatibility/default play controls if needed
      setStandaloneVoiceAudioUrl(urlA);

      const matchedVoice = ELEVENLABS_VOICES.find(v => v.id === voiceId);
      const voiceLabel = matchedVoice ? matchedVoice.name : (voiceDesc || (detectedGender === 'male' ? '自定义男声' : '自定义女声'));
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
      const details = `${processedText.length}字 · ${standaloneVoiceLang.toUpperCase()}语种 · 语速${standaloneVoiceSpeed}x`;

      setPendingVoiceOptions({
        optionA: {
          url: urlA,
          voiceLabel: `${voiceLabel} (版本 A)`,
          displayName: `角色配音 - ${voiceLabel} (版本 A)`,
          emotionLabel: rawEmoDesc || '默认情绪',
          processedText,
          timestamp,
          details,
          speed: standaloneVoiceSpeed
        },
        optionB: {
          url: urlB,
          voiceLabel: `${voiceLabel} (版本 B)`,
          displayName: `角色配音 - ${voiceLabel} (版本 B)`,
          emotionLabel: rawEmoDesc || '默认情绪',
          processedText,
          timestamp,
          details,
          speed: standaloneVoiceSpeed
        }
      });
      setHistoryList(prev => [
        {
          id: `voice-A-${Date.now()}`,
          type: 'voice',
          title: `角色配音 - ${voiceLabel} (版本 A)`,
          prompt: processedText,
          url: urlA,
          timestamp,
          details,
          speed: standaloneVoiceSpeed
        },
        {
          id: `voice-B-${Date.now()}`,
          type: 'voice',
          title: `角色配音 - ${voiceLabel} (版本 B)`,
          prompt: processedText,
          url: urlB,
          timestamp,
          details,
          speed: standaloneVoiceSpeed
        },
        ...prev,
      ]);

      // Auto play Option A to give instant feedback
      setTimeout(() => {
        if (standaloneVoiceAudioRef.current) {
          standaloneVoiceAudioRef.current.playbackRate = standaloneVoiceSpeed;
          standaloneVoiceAudioRef.current.src = urlA;
          standaloneVoiceAudioRef.current.play().catch(e => console.error(e));
        }
      }, 150);
    } catch (err: any) {
      setStandaloneVoiceError(err.message || '生成失败，请重试');
    } finally {
      setStandaloneVoiceLoading(false);
    }
  };

  // SFX generator handler
  const handleStandaloneGenerate = async () => {
    if (!hasElevenLabsKey) {
      setStandaloneError('ELEVENLABS_API_KEY 未配置，请前往设置页面或 Secrets 面板添加。');
      return;
    }
    if (!standalonePrompt.trim()) {
      setStandaloneError('请输入音效描述文字');
      return;
    }

    setStandaloneLoading(true);
    setStandaloneError(null);
    try {
      if (pendingSfxOptions.optionA?.url) URL.revokeObjectURL(pendingSfxOptions.optionA.url);
      if (pendingSfxOptions.optionB?.url) URL.revokeObjectURL(pendingSfxOptions.optionB.url);

      const prompt = standalonePrompt.trim();
      const englishPrompt = await translateToEnglish(prompt);
      const generationPrompt = englishPrompt.trim() || prompt;
      const [blobA, blobB] = await Promise.all([
        generateSoundEffect(generationPrompt, standaloneDuration, {
          qualityMode: elevenLabsQualityMode,
        }),
        generateSoundEffect(generationPrompt, standaloneDuration, {
          qualityMode: elevenLabsQualityMode,
        }),
      ]);
      const urlA = URL.createObjectURL(blobA);
      const urlB = URL.createObjectURL(blobB);

      const baseTitle = `独立音效 - ${prompt.substring(0, 20)}${prompt.length > 20 ? '...' : ''}`;
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
      const details = generationPrompt !== prompt
        ? `${standaloneDuration}秒 · 电影声效 · 已自动英译`
        : `${standaloneDuration}秒 · 电影声效`;
      setPendingSfxOptions({
        optionA: {
          url: urlA,
          title: `${baseTitle}（版本 A）`,
          prompt,
          timestamp,
          details,
          duration: standaloneDuration,
        },
        optionB: {
          url: urlB,
          title: `${baseTitle}（版本 B）`,
          prompt,
          timestamp,
          details,
          duration: standaloneDuration,
        },
      });
      
      // Auto play option A
    } catch (err: any) {
      setStandaloneError(err.message || '生成失败，请重试');
    } finally {
      setStandaloneLoading(false);
    }
  };

  // Standalone Music generator handler
  const handleStandaloneMusicGenerate = async () => {
    if (!hasElevenLabsKey) {
      setStandaloneMusicError('ELEVENLABS_API_KEY 未配置，请前往设置页面或 Secrets 面板添加。');
      return;
    }
    if (!standaloneMusicPrompt.trim()) {
      setStandaloneMusicError('请输入背景音乐描述关键词');
      return;
    }

    setStandaloneMusicLoading(true);
    setStandaloneMusicError(null);
    if (standaloneMusicAudioUrl) URL.revokeObjectURL(standaloneMusicAudioUrl);
    if (pendingMusicOptions.optionA?.url) URL.revokeObjectURL(pendingMusicOptions.optionA.url);
    if (pendingMusicOptions.optionB?.url) URL.revokeObjectURL(pendingMusicOptions.optionB.url);
    setStandaloneMusicAudioUrl(null);
    setPendingMusicOptions({ optionA: null, optionB: null });
    try {
      const prompt = standaloneMusicPrompt.trim();
      let generationPrompt = prompt;
      let usedAutoTranslation = false;

      try {
        const translatedPrompt = await translateToEnglish(prompt);
        generationPrompt = translatedPrompt.trim() || prompt;
        usedAutoTranslation = generationPrompt !== prompt;
      } catch (translationError) {
        console.error('Music prompt auto-translation failed:', translationError);
        throw new Error('自动翻译成英文失败，请检查 Gemini 配置后重试，或先手动输入英文提示词。');
      }

      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
      const details = `${standaloneMusicDuration}秒 · ${standaloneMusicType === 'instrumental' ? '纯伴奏' : '歌词人声'}${usedAutoTranslation ? ' · 已自动英译' : ''}`;
      const baseTitle = `独立音乐 - ${prompt.substring(0, 20)}${prompt.length > 20 ? '...' : ''}`;
      const createMusicOption = async (id: 'A' | 'B'): Promise<PendingMusicOption> => {
        const versionPrompt = id === 'A'
          ? generationPrompt
          : `${generationPrompt}. Alternate take, different arrangement and performance variation while keeping the same core mood.`;
        const blob = await generateMusic(
          versionPrompt,
          standaloneMusicDuration,
          standaloneMusicType === 'instrumental',
          standaloneMusicLyrics.trim(),
          { qualityMode: elevenLabsQualityMode },
        );
        return {
          id,
          url: URL.createObjectURL(blob),
          title: `${baseTitle}（版本 ${id}）`,
          prompt,
          timestamp,
          details,
          duration: standaloneMusicDuration,
          type: standaloneMusicType,
        };
      };
      const optionA = await createMusicOption('A');
      const optionB = await createMusicOption('B');
      setPendingMusicOptions({ optionA, optionB });
      setStandaloneMusicAudioUrl(optionA.url);
      
      const historyItems: HistoryItem[] = [optionA, optionB].map((option) => ({
        id: `music-${Date.now()}-${option.id}`,
        type: 'music',
        title: option.title,
        prompt,
        url: option.url,
        timestamp,
        details,
      }));
      setHistoryList(prev => [...historyItems, ...prev]);

      // Auto play
      setTimeout(() => {
        if (standaloneMusicAudioRef.current) {
          standaloneMusicAudioRef.current.play().catch(e => console.error(e));
        }
      }, 150);
    } catch (err: any) {
      setStandaloneMusicError(err.message || '生成失败，请重试');
    } finally {
      setStandaloneMusicLoading(false);
    }
  };

  // AI Multimodal director planner handler
  const onGenerate = async () => {
    if (analysisRunningRef.current) return;

    if (files.length === 0 && !requirements.trim()) {
      setError('请至少选择上传一个创意素材文件或填写补充设计需求文本');
      return;
    }

    if (!hasGeminiKey) {
      setError('GEMINI_API_KEY 未配置，请前往设置页面添加。');
      return;
    }

    const videoFiles = files.filter(item => item.type.startsWith('video/'));
    const wantsProfessionalVideo = Boolean(target.video || target.avatar);
    if (wantsProfessionalVideo && videoFiles.length > 0 && (videoFiles.length !== 1 || files.length !== 1)) {
      setError('影视/广告与 Avatar 的完整视频分析一次只能单独使用 1 个视频。请移除其他视频、图片、音频或 PDF；如需综合多份素材，请改用快速分析模式。');
      return;
    }

    analysisRunningRef.current = true;
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setLoading(true);
    setAnalysisStage('正在准备素材...');
    setError(null);

    try {
      const useProfessionalVideo = wantsProfessionalVideo && videoFiles.length === 1;
      const waitForReadyPreupload = async (fileItem: FileItem) => {
        const latestBeforeWait = filesRef.current.find(item => item.id === fileItem.id) || fileItem;
        if (latestBeforeWait.preupload?.status === 'ready' && latestBeforeWait.preupload.uploadId) {
          return latestBeforeWait.preupload.uploadId;
        }

        const preuploadPromise = preuploadPromisesRef.current.get(fileItem.id);
        const canWaitForPreupload = preuploadPromise
          && latestBeforeWait.preupload
          && ['uploading', 'processing'].includes(latestBeforeWait.preupload.status);
        if (!canWaitForPreupload) return null;

        setAnalysisStage('视频正在后台预上传，等待完成后直接分析...');
        await preuploadPromise;
        if (controller.signal.aborted) {
          throw new Error('已取消本次分析。');
        }

        const latestAfterWait = filesRef.current.find(item => item.id === fileItem.id);
        if (latestAfterWait?.preupload?.status === 'ready' && latestAfterWait.preupload.uploadId) {
          return latestAfterWait.preupload.uploadId;
        }
        return null;
      };

      const canUseSingleVideoPreupload = videoFiles.length === 1 && files.length === 1;
      let res: AudioDesignResult;

      if (useProfessionalVideo) {
        const preuploadId = canUseSingleVideoPreupload
          ? await waitForReadyPreupload(videoFiles[0])
          : null;
        if (preuploadId) {
          setAnalysisStage(target.avatar
            ? '视频已预上传，正在进行 Avatar 高精度分析...'
            : '视频已预上传，正在进行影视级完整分析...');
          res = await analyzeAudioDesignPreuploadedVideo(
            preuploadId,
            requirements,
            target,
            isInstrumental,
            {
              signal: controller.signal,
              analysisMode: 'professional',
            },
          );
        } else {
          setAnalysisStage(target.avatar
            ? '正在上传视频，准备 Avatar 高精度分析...'
            : '正在上传视频，准备影视级完整分析...');
          res = await analyzeAudioDesignVideo(
            videoFiles[0].file,
            requirements,
            target,
            isInstrumental,
            {
              signal: controller.signal,
              onProgress: setAnalysisStage,
            },
          );
        }
      } else {
        const preuploadId = canUseSingleVideoPreupload
          ? await waitForReadyPreupload(videoFiles[0])
          : null;
        if (preuploadId) {
          setAnalysisStage('视频已预上传，正在直接分析完整画面并生成音频方案...');
          res = await analyzeAudioDesignPreuploadedVideo(
            preuploadId,
            requirements,
            target,
            isInstrumental,
            {
              signal: controller.signal,
              analysisMode: 'fallback',
            },
          );
        } else {
        // Fast mode reduces videos to compact keyframes and resizes images.
        let fileData: Awaited<ReturnType<typeof prepareFilesForGemini>> | null = null;
        try {
          fileData = await prepareFilesForGemini(files.map(item => item.file), {
            signal: controller.signal,
            onProgress: setAnalysisStage,
          });
        } catch (prepareError) {
          const canUseServerVideoFallback = videoFiles.length === 1 && files.length === 1;
          if (!canUseServerVideoFallback || controller.signal.aborted) {
            throw prepareError;
          }

          console.warn('Local video keyframe extraction failed; falling back to server video analysis:', prepareError);
          setAnalysisStage('浏览器抽帧失败，正在上传完整视频交由服务器分析...');
          res = await analyzeAudioDesignVideo(
            videoFiles[0].file,
            requirements,
            target,
            isInstrumental,
            {
              signal: controller.signal,
              onProgress: setAnalysisStage,
              analysisMode: 'fallback',
            },
          );
        }

        if (fileData) {
          setAnalysisStage('正在上传关键帧并生成音频方案...');
          res = await analyzeAudioDesign(
            fileData,
            requirements,
            target,
            isInstrumental,
            { signal: controller.signal },
          );
        }
        }
      }
      
      if (!res || (!res.sfxSchemes && !res.bgmRecommendations)) {
        throw new Error('多模态解析未返回合理的音频排程推荐，请尝试修改您的输入。');
      }
      
      setAnalysisStage('正在整理音效与配乐结果...');
      setResult(res);

      // Save plan result to history log
      const newHistoryItem: HistoryItem = {
        id: `director-${Date.now()}`,
        type: 'director',
        title: `全片设计 - ${(requirements || '自动画幅解析').substring(0, 20)}`,
        prompt: requirements || '根据上传媒体文件进行全片音轨规划',
        url: '#',
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
        details: `${res.sfxSchemes?.[0]?.items?.length || 0}项音效排程 · 1项BGM推荐`
      };
      setHistoryList(prev => [newHistoryItem, ...prev]);

    } catch (err: any) {
      if (controller.signal.aborted) {
        setAnalysisStage('已取消本次分析。');
        setError(null);
      } else {
        console.error('Director generation failed:', err);
        setError(err.message || '生成失败，请重新检查大模型状态。');
      }
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = null;
        analysisRunningRef.current = false;
        setLoading(false);
      }
    }
  };

  const cancelAnalysis = () => {
    const controller = analysisAbortRef.current;
    if (controller && !controller.signal.aborted) {
      setAnalysisStage('正在取消本次分析...');
      controller.abort('user');
    }
  };

  const sendDirectorPromptToMusicStudio = (prompt: string) => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return;
    setStandaloneMusicPrompt(normalizedPrompt);
    setStandaloneMusicType(isInstrumental ? 'instrumental' : 'vocal');
    setCurrentTab('music-studio');
  };

  // Helper utility functions
  const copyToClipboard = async (text: string, id?: string) => {
    if (!text) return;

    // Keep a synchronous fallback for embedded HTML5 browsers, where the
    // asynchronous Clipboard API may lose its user-gesture permission.
    const copyWithSelection = () => {
      let copiedByEvent = false;
      const handleCopy = (event: ClipboardEvent) => {
        if (!event.clipboardData) return;
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
        copiedByEvent = true;
      };
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      document.addEventListener('copy', handleCopy);
      try {
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const commandCopied = document.execCommand('copy');
        return commandCopied || copiedByEvent;
      } catch {
        return false;
      } finally {
        document.removeEventListener('copy', handleCopy);
        textarea.remove();
      }
    };

    let copied = copyWithSelection();
    if (!copied) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }
    }

    if (copied && id) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const copyTableToClipboard = (scheme: any, id: string) => {
    const headers = ['文件命名', '动作场景', '技术细节', '详细描述'];
    const rows = scheme.items.map((item: any) => [
      item.name,
      item.scene,
      item.logic,
      item.description
    ]);
    
    const markdownTable = [
      `| ${headers.join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...rows.map((row: string[]) => `| ${row.join(' | ')} |`)
    ].join('\n');

    copyToClipboard(markdownTable, id);
  };

  const downloadTableAsCSV = (scheme: any) => {
    const headers = ['文件命名', '场景画面', '合成技术', '详细设计与制作描述'];
    const rows = scheme.items.map((item: any) => [
      `"${item.name.replace(/"/g, '""')}"`,
      `"${item.scene.replace(/"/g, '""')}"`,
      `"${item.logic.replace(/"/g, '""')}"`,
      `"${item.description.replace(/"/g, '""')}"`
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map((row: string[]) => row.join(','))
    ].join('\n');
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${scheme.title || '音频排程表'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Lyric regeneration handler
  const handleRegenerateLyrics = async () => {
    if (!selectedLyrics || !result) return;
    setEditingLyrics(true);
    try {
      const originalLyrics = result.bgmRecommendations[0].lyrics?.content.map(c => `[${c.section}]\n${c.text}`).join('\n') || '';
      const newText = await regenerateLyrics(originalLyrics, selectedLyrics.text, lyricEditDirection);
      
      const newResult = { ...result };
      if (newResult.bgmRecommendations[0].lyrics) {
        newResult.bgmRecommendations[0].lyrics!.content[selectedLyrics.sectionIndex].text = newText;
        setResult(newResult);
      }
      setSelectedLyrics(null);
      setLyricEditDirection('');
    } catch (err) {
      console.error(err);
    } finally {
      setEditingLyrics(false);
    }
  };

  return (
    <div id="app-root-container" className="flex h-dvh min-h-0 w-full overflow-hidden bg-slate-50 font-sans text-slate-800 antialiased">
      {/* Global Sidebar Component */}
      <Sidebar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        isMobileOpen={isMobileNavOpen}
        onMobileClose={() => setIsMobileNavOpen(false)}
      />
      
      <div
        className="flex min-w-0 flex-1 flex-col"
        aria-hidden={isMobileNavOpen ? true : undefined}
        inert={isMobileNavOpen ? true : undefined}
      >
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setIsMobileNavOpen(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            aria-label="打开导航菜单"
            aria-expanded={isMobileNavOpen}
            aria-controls="sidebar-mobile"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-slate-800">AI Audio Suite</p>
            <p className="truncate text-[10px] font-semibold text-emerald-600">多模态音频创作中心</p>
          </div>
        </header>

        {/* Right Side Workspace Frame */}
        <main id="app-workspace-viewport" className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-slate-50 custom-scrollbar">
          <Suspense fallback={<WorkspaceLoading />}>
            {visitedTabs.has('workbench') && (
              <section hidden={currentTab !== 'workbench'} className="min-h-full">
                <Workbench
                  setCurrentTab={setCurrentTab}
                  historyList={historyList}
                />
              </section>
            )}

            {visitedTabs.has('audio-director') && (
              <section hidden={currentTab !== 'audio-director'} className="min-h-full">
                <AudioDirector
                  files={files}
                  setFiles={setFiles}
                  requirements={requirements}
                  setRequirements={setRequirements}
                  target={target}
                  setTarget={setTarget}
                  loading={loading}
                  analysisStage={analysisStage}
                  error={error}
                  setError={setError}
                  result={result}
                  onGenerate={onGenerate}
                  onCancel={cancelAnalysis}
                  copyToClipboard={copyToClipboard}
                  copyTableToClipboard={copyTableToClipboard}
                  downloadTableAsCSV={downloadTableAsCSV}
                  copiedId={copiedId}
                  isUploading={isUploading}
                  setIsUploading={setIsUploading}
                  isInstrumental={isInstrumental}
                  setIsInstrumental={setIsInstrumental}
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                  selectedLyrics={selectedLyrics}
                  setSelectedLyrics={setSelectedLyrics}
                  lyricEditDirection={lyricEditDirection}
                  setLyricEditDirection={setLyricEditDirection}
                  editingLyrics={editingLyrics}
                  handleRegenerateLyrics={handleRegenerateLyrics}
                  onLoadDemo={setResult}
                  onSendMusicPrompt={sendDirectorPromptToMusicStudio}
                />
              </section>
            )}

            {visitedTabs.has('music-studio') && (
              <section hidden={currentTab !== 'music-studio'} className="min-h-full">
                <MusicStudio
                  standaloneMusicPrompt={standaloneMusicPrompt}
                  setStandaloneMusicPrompt={setStandaloneMusicPrompt}
                  standaloneMusicDuration={standaloneMusicDuration}
                  setStandaloneMusicDuration={setStandaloneMusicDuration}
                  standaloneMusicType={standaloneMusicType}
                  setStandaloneMusicType={setStandaloneMusicType}
                  standaloneMusicLyrics={standaloneMusicLyrics}
                  setStandaloneMusicLyrics={setStandaloneMusicLyrics}
                  standaloneMusicLoading={standaloneMusicLoading}
                  standaloneMusicAudioUrl={standaloneMusicAudioUrl}
                  setStandaloneMusicAudioUrl={setStandaloneMusicAudioUrl}
                  pendingMusicOptions={pendingMusicOptions}
                  setPendingMusicOptions={setPendingMusicOptions}
                  standaloneMusicError={standaloneMusicError}
                  standaloneMusicAudioRef={standaloneMusicAudioRef}
                  handleStandaloneMusicGenerate={handleStandaloneMusicGenerate}
                  historyList={historyList}
                />
              </section>
            )}

            {visitedTabs.has('sfx-studio') && (
              <section hidden={currentTab !== 'sfx-studio'} className="min-h-full">
                <SfxStudio
                  standalonePrompt={standalonePrompt}
                  setStandalonePrompt={setStandalonePrompt}
                  standaloneDuration={standaloneDuration}
                  setStandaloneDuration={setStandaloneDuration}
                  standaloneLoading={standaloneLoading}
                  standaloneError={standaloneError}
                  handleStandaloneGenerate={handleStandaloneGenerate}
                  historyList={historyList}
                  pendingSfxOptions={pendingSfxOptions}
                  setPendingSfxOptions={setPendingSfxOptions}
                />
              </section>
            )}

            {visitedTabs.has('dubbing-studio') && (
              <section hidden={currentTab !== 'dubbing-studio'} className="min-h-full">
                <DubbingStudio
                  standaloneVoicePrompt={standaloneVoiceText}
                  setStandaloneVoicePrompt={setStandaloneVoiceText}
                  standaloneVoiceGender={standaloneVoiceGender}
                  setStandaloneVoiceGender={setStandaloneVoiceGender}
                  standaloneVoiceRole={standaloneVoiceRole}
                  setStandaloneVoiceRole={setStandaloneVoiceRole}
                  setSelectedStandaloneVoice={setSelectedStandaloneVoice}
                  standaloneVoiceLang={standaloneVoiceLang}
                  setStandaloneVoiceLang={setStandaloneVoiceLang}
                  standaloneVoiceSpeed={standaloneVoiceSpeed}
                  setStandaloneVoiceSpeed={setStandaloneVoiceSpeed}
                  standaloneVoiceLoading={standaloneVoiceLoading}
                  standaloneVoiceAudioUrl={standaloneVoiceAudioUrl}
                  setStandaloneVoiceAudioUrl={setStandaloneVoiceAudioUrl}
                  standaloneVoiceError={standaloneVoiceError}
                  standaloneVoiceAudioRef={standaloneVoiceAudioRef}
                  handleStandaloneVoiceGenerate={handleStandaloneVoiceGenerate}
                  historyList={historyList}
                  setHistoryList={setHistoryList}
                  pendingVoiceOptions={pendingVoiceOptions}
                  setPendingVoiceOptions={setPendingVoiceOptions}
                />
              </section>
            )}

            {visitedTabs.has('audio-tools') && (
              <section hidden={currentTab !== 'audio-tools'} className="min-h-full">
                <AudioTools />
              </section>
            )}

            {visitedTabs.has('settings') && (
              <section hidden={currentTab !== 'settings'} className="min-h-full">
                <SettingsComponent
                  onKeysUpdated={handleKeysUpdated}
                />
              </section>
            )}

            {visitedTabs.has('sfx-library') && (
              <section hidden={currentTab !== 'sfx-library'} className="min-h-full">
                <SfxLibrary />
              </section>
            )}

            {visitedTabs.has('sfx-requirements') && (
              <section hidden={currentTab !== 'sfx-requirements'} className="min-h-full">
                <SfxRequirements
                  hasGeminiKey={hasGeminiKey}
                />
              </section>
            )}

            {visitedTabs.has('video-soundtrack') && (
              <section hidden={currentTab !== 'video-soundtrack'} className="min-h-full">
                <VideoSoundtrack />
              </section>
            )}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
