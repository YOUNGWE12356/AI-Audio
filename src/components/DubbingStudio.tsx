/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { 
  Mic, 
  Loader2, 
  Play, 
  Pause, 
  Download, 
  X, 
  Sliders, 
  CheckCircle2, 
  AlertCircle,
  Sparkles,
  Volume2,
  Users,
  Globe,
  Pencil,
  Check,
  Search,
  ChevronDown,
  Info,
  Languages,
  UploadCloud,
  FileAudio
} from 'lucide-react';
import { HistoryItem } from '../types';
import { ELEVENLABS_VOICES, VoiceItem } from '../data/voices';
import { fetchAvailableVoices, generateSpeechToSpeech } from '../services/elevenLabsService';
import SpeechToSpeech from './SpeechToSpeech';
import SpeechToText from './SpeechToText';
import CrossLanguageDubbing from './CrossLanguageDubbing';
import { downloadAudioHelper } from '../utils/downloadHelper';

interface PendingVoiceOption {
  url: string;
  voiceLabel: string;
  displayName: string;
  emotionLabel: string;
  processedText: string;
  timestamp: string;
  details: string;
  speed: number;
}
interface DubbingStudioProps {
  standaloneVoicePrompt: string;
  setStandaloneVoicePrompt: (prompt: string) => void;
  standaloneVoiceGender: 'male' | 'female';
  setStandaloneVoiceGender: (gender: 'male' | 'female') => void;
  standaloneVoiceRole: string;
  setStandaloneVoiceRole: (role: string) => void;
  setSelectedStandaloneVoice?: (voice: VoiceItem | null) => void;
  standaloneVoiceLang: string;
  setStandaloneVoiceLang: (lang: string) => void;
  standaloneVoiceSpeed: number;
  setStandaloneVoiceSpeed: (speed: number) => void;
  standaloneVoiceLoading: boolean;
  standaloneVoiceAudioUrl: string | null;
  setStandaloneVoiceAudioUrl: (url: string | null) => void;
  standaloneVoiceError: string | null;
  standaloneVoiceAudioRef: React.RefObject<HTMLAudioElement | null>;
  handleStandaloneVoiceGenerate: () => void;
  historyList: HistoryItem[];
  setHistoryList: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
  pendingVoiceOptions: {
    optionA: PendingVoiceOption | null;
    optionB: PendingVoiceOption | null;
  };
  setPendingVoiceOptions: React.Dispatch<React.SetStateAction<{
    optionA: PendingVoiceOption | null;
    optionB: PendingVoiceOption | null;
  }>>;
}

export default function DubbingStudio({
  standaloneVoicePrompt,
  setStandaloneVoicePrompt,
  standaloneVoiceGender,
  setStandaloneVoiceGender,
  standaloneVoiceRole,
  setStandaloneVoiceRole,
  setSelectedStandaloneVoice,
  standaloneVoiceLang,
  setStandaloneVoiceLang,
  standaloneVoiceSpeed,
  setStandaloneVoiceSpeed,
  standaloneVoiceLoading,
  standaloneVoiceAudioUrl,
  setStandaloneVoiceAudioUrl,
  standaloneVoiceError,
  standaloneVoiceAudioRef,
  handleStandaloneVoiceGenerate,
  historyList,
  setHistoryList,
  pendingVoiceOptions,
  setPendingVoiceOptions
}: DubbingStudioProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingHistoryId, setPlayingHistoryId] = useState<string | null>(null);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [fetchedVoices, setFetchedVoices] = useState<VoiceItem[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [previewPlayingId, setPreviewPlayingId] = useState<'A' | 'B' | null>(null);
  const [previewDurations, setPreviewDurations] = useState<Record<'A' | 'B', number | null>>({ A: null, B: null });
  const generatedPreviewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Active sub-tab state ('tts' = Text-to-Speech, 'sts' = Speech-to-Speech, 'stt' = Speech-to-Text)
  const [activeSubTab, setActiveSubTab] = useState<'tts' | 'sts' | 'translate' | 'stt'>('tts');
  const [visitedSubTabs, setVisitedSubTabs] = useState<Set<'tts' | 'sts' | 'translate' | 'stt'>>(() => new Set(['tts']));
  const [subNavWidth, setSubNavWidth] = useState(() => {
    if (typeof window === 'undefined') return 240;
    const saved = Number(window.localStorage.getItem('ai-audio-dubbing-subnav-width'));
    return Number.isFinite(saved) ? Math.max(180, Math.min(360, saved)) : 240;
  });
  const [isResizingSubNav, setIsResizingSubNav] = useState(false);

  // STS File Upload & Playing States
  const [stsFile, setStsFile] = useState<File | null>(null);
  const [stsFileUrl, setStsFileUrl] = useState<string | null>(null);
  const [stsDragActive, setStsDragActive] = useState(false);
  const stsInputRef = useRef<HTMLInputElement | null>(null);
  const [stsInputIsPlaying, setStsInputIsPlaying] = useState(false);
  const stsInputAudioRef = useRef<HTMLAudioElement | null>(null);

  // STS Voice Selection States
  const [stsVoiceRole, setStsVoiceRole] = useState('');
  const [stsVoiceGender, setStsVoiceGender] = useState<'male' | 'female'>('male');
  const [stsVoiceSearchQuery, setStsVoiceSearchQuery] = useState('');
  const [stsVoiceActiveCategory, setStsVoiceActiveCategory] = useState('全部');
  const [stsVoiceGenderFilter, setStsVoiceGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [stsShowVoiceDropdown, setStsShowVoiceDropdown] = useState(false);

  // STS Conversion API & Playing States
  const [stsLoading, setStsLoading] = useState(false);
  const [stsAudioUrl, setStsAudioUrl] = useState<string | null>(null);
  const [stsError, setStsError] = useState<string | null>(null);
  const [stsIsPlaying, setStsIsPlaying] = useState(false);
  const stsAudioRef = useRef<HTMLAudioElement | null>(null);
  const subNavResizeStartRef = useRef({ width: 240, x: 0 });

  useEffect(() => {
    if (!isResizingSubNav) return;

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = subNavResizeStartRef.current.width + event.clientX - subNavResizeStartRef.current.x;
      setSubNavWidth(Math.max(180, Math.min(360, nextWidth)));
    };

    const handleMouseUp = () => {
      setIsResizingSubNav(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSubNav]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('ai-audio-dubbing-subnav-width', String(subNavWidth));
  }, [subNavWidth]);

  useEffect(() => {
    setVisitedSubTabs(prev => {
      if (prev.has(activeSubTab)) return prev;
      const next = new Set(prev);
      next.add(activeSubTab);
      return next;
    });
  }, [activeSubTab]);

  useEffect(() => {
    return () => {
      if (stsFileUrl) {
        URL.revokeObjectURL(stsFileUrl);
      }
      if (stsAudioUrl) {
        URL.revokeObjectURL(stsAudioUrl);
      }
    };
  }, []);

  const handleStsDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setStsDragActive(true);
    } else if (e.type === "dragleave") {
      setStsDragActive(false);
    }
  };

  const handleStsDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setStsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleStsFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleStsFileChange = (file: File) => {
    if (stsFileUrl) {
      URL.revokeObjectURL(stsFileUrl);
    }
    setStsFile(file);
    setStsFileUrl(URL.createObjectURL(file));
    setStsInputIsPlaying(false);
    setStsAudioUrl(null); // Reset converted url when new file uploaded
  };

  const toggleStsInputPlay = () => {
    if (stsInputAudioRef.current) {
      if (stsInputIsPlaying) {
        stsInputAudioRef.current.pause();
        setStsInputIsPlaying(false);
      } else {
        // Pause other active playbacks to keep audio environment clean
        if (stsAudioRef.current) {
          stsAudioRef.current.pause();
          setStsIsPlaying(false);
        }
        if (standaloneVoiceAudioRef.current) {
          standaloneVoiceAudioRef.current.pause();
          setIsPlaying(false);
        }
        stsInputAudioRef.current.play().catch(err => console.error(err));
        setStsInputIsPlaying(true);
      }
    }
  };

  const handleStsGenerate = async () => {
    if (!stsFile) {
      setStsError('请先上传需要变声的源音频文件');
      return;
    }
    if (!stsVoiceRole) {
      setStsError('当前配音库暂无可用声线，请先在 ElevenLabs 添加或恢复声线');
      return;
    }

    setStsLoading(true);
    setStsError(null);
    try {
      const blob = await generateSpeechToSpeech(stsFile, stsVoiceRole);
      const url = URL.createObjectURL(blob);
      setStsAudioUrl(url);

      const matchedVoice = displayVoices.find(v => v.id === stsVoiceRole);
      const voiceLabel = matchedVoice ? matchedVoice.name : '自定义声线';
      
      const newHistoryItem: HistoryItem = {
        id: `sts-${Date.now()}`,
        type: 'voice',
        title: `语音变声 - ${voiceLabel}`,
        prompt: `源音频：${stsFile.name} → 变声目标：${voiceLabel}`,
        url: url,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
        details: `${(stsFile.size / 1024 / 1024).toFixed(2)}MB · ${stsVoiceGender === 'male' ? '男声' : '女声'}`,
        speed: 1.0
      };
      setHistoryList(prev => [newHistoryItem, ...prev]);

      // Auto play the converted audio to give instant feedback
      setTimeout(() => {
        if (stsAudioRef.current) {
          stsAudioRef.current.src = url;
          stsAudioRef.current.play().catch(e => console.error(e));
          setStsIsPlaying(true);
        }
      }, 150);
    } catch (err: any) {
      setStsError(err.message || '语音变声生成失败，请重试');
    } finally {
      setStsLoading(false);
    }
  };

  // Voice selection states
  const [voiceSearchQuery, setVoiceSearchQuery] = useState('');
  const [voiceActiveCategory, setVoiceActiveCategory] = useState('全部');
  const [voiceGenderFilter, setVoiceGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Highlighting and scroll-sync refs
  const highlightRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleScroll = () => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const renderHighlightedText = (text: string) => {
    if (!text) {
      return (
        <span className="text-slate-400 leading-normal block">
          在此输入要配音的文本，在台词中使用中括号标注情绪，例如 <span className="text-emerald-600 font-bold rounded-sm shadow-[inset_0_-0.7em_0_rgba(16,185,129,0.14)]">[激动地]</span> 我们终于抵达了这颗被称为蔚蓝家园的星球...
        </span>
      );
    }

    // Split by bracket expressions like [excited] or [开心地]
    const parts = text.split(/(\[[^\]]+\])/g);
    return parts.map((part, index) => {
      if (part.startsWith("[") && part.endsWith("]")) {
        return (
          <span 
            key={index} 
            className="text-emerald-600 font-bold rounded-sm shadow-[inset_0_-0.7em_0_rgba(16,185,129,0.16)]"
          >
            {part}
          </span>
        );
      }
      return <React.Fragment key={index}>{part}</React.Fragment>;
    });
  };

  const shouldHideDubbingVoice = (voice: VoiceItem) => {
    const category = String(voice.category || '').toLowerCase();
    const tags = (voice.tags || []).map(tag => String(tag).toLowerCase());
    const searchable = [category, ...tags].join(' ');
    return (
      searchable.includes('premade') ||
      searchable.includes('default') ||
      searchable.includes('legacy')
    );
  };

  const loadVoices = async () => {
    setIsLoadingVoices(true);
    try {
      const apiVoices = await fetchAvailableVoices();
      if (apiVoices && apiVoices.length > 0) {
        // Keep high-quality ElevenLabs Voice Library voices and the user's own non-default voices.
        // Premade/default voices are intentionally excluded because they were removed from the product library.
        const filteredApiVoices = apiVoices.filter(av =>
          av.source === 'voice_library' ||
          ['professional', 'cloned', 'generated'].includes(av.category)
        );

        // Map API voices to our VoiceItem structure
        const mapped: VoiceItem[] = filteredApiVoices.map(av => {
          // Check if we already have detailed metadata for this voice in ELEVENLABS_VOICES
          const existing = ELEVENLABS_VOICES.find(ev => ev.id === av.voice_id);
          if (existing) {
            return existing;
          }
          
          // Otherwise, construct a nice dynamic VoiceItem
          const genderLabel = (av.labels?.gender || '').toLowerCase();
          let isMale = false;
          if (genderLabel) {
            if (genderLabel.includes('female')) {
              isMale = false;
            } else if (genderLabel.includes('male')) {
              isMale = true;
            }
          } else {
            // Check name with word boundary to avoid partial matching (e.g. Samantha matching "sam", or Georgia matching "george")
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
            previewUrl: av.preview_url || '',
            source: av.source,
            publicOwnerId: av.public_owner_id,
          };
        });
        setFetchedVoices(mapped.filter(voice => !shouldHideDubbingVoice(voice)));
      } else {
        setFetchedVoices([]);
      }
    } catch (err) {
      console.error("Failed to load voices from ElevenLabs:", err);
    } finally {
      setIsLoadingVoices(false);
    }
  };

  // Load voices on mount
  useEffect(() => {
    loadVoices();
  }, []);

  // Re-fetch voices when the dropdown is opened to ensure up-to-date custom/cloned voices
  useEffect(() => {
    if (showVoiceDropdown) {
      loadVoices();
    }
  }, [showVoiceDropdown]);

  // Compute final voices list to display (merge pre-made voices with user's fetched custom voices, filtering duplicates)
  const displayVoices = (
    fetchedVoices.length > 0
      ? [...ELEVENLABS_VOICES, ...fetchedVoices.filter(fv => !ELEVENLABS_VOICES.some(ev => ev.id === fv.id))]
      : ELEVENLABS_VOICES
  ).filter(voice => !shouldHideDubbingVoice(voice));
  const voiceCategories = ['全部', ...Array.from(new Set(displayVoices.map(voice => voice.category).filter(Boolean)))];
  const filteredVoiceOptions = displayVoices.filter((voice) => {
    const query = voiceSearchQuery.trim().toLowerCase();
    if (voiceActiveCategory !== '全部' && voice.category !== voiceActiveCategory) return false;
    if (voiceGenderFilter !== 'all' && voice.gender !== voiceGenderFilter) return false;
    if (!query) return true;
    return [
      voice.name,
      voice.englishName,
      voice.category,
      voice.description,
      ...(voice.tags || []),
    ].join(' ').toLowerCase().includes(query);
  });

  // Derived state to check if current standaloneVoiceRole is an ElevenLabs Premium Voice ID
  const isPremiumVoiceSelected = displayVoices.some(v => v.id === standaloneVoiceRole);
  const voiceMode = 'premium';

  // Ensure standaloneVoiceRole is always set to a valid premium voice ID
  useEffect(() => {
    if (standaloneVoiceRole && !displayVoices.some(v => v.id === standaloneVoiceRole)) {
      if (displayVoices.length > 0) {
        setStandaloneVoiceRole(displayVoices[0].id);
        setSelectedStandaloneVoice?.(displayVoices[0]);
        setStandaloneVoiceGender(displayVoices[0].gender);
      } else {
        setStandaloneVoiceRole('');
        setSelectedStandaloneVoice?.(null);
        setStandaloneVoiceGender('male');
      }
    }
  }, [standaloneVoiceRole, displayVoices]);

  // Sync / Stop preview audio on unmount or tab change
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
    e.stopPropagation(); // Avoid triggering dropdown selection when listening
    
    // Pause main playback if playing
    if (standaloneVoiceAudioRef.current) {
      standaloneVoiceAudioRef.current.pause();
      setIsPlaying(false);
    }

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

      // If no preview URL is available, trigger Speech Synthesis fallback immediately
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

      previewAudioRef.current = audio;
      
      audio.play().catch(err => {
        console.warn("Audio element play rejected. Triggering fallback...", err);
        triggerFallback();
      });
    }
  };

  const handleSelectVoice = (voice: VoiceItem) => {
    setStandaloneVoiceRole(voice.id);
    setSelectedStandaloneVoice?.(voice);
    setStandaloneVoiceGender(voice.gender);
    setShowVoiceDropdown(false);
  };
  
  const historyAudioRefs = useRef<{ [key: string]: HTMLAudioElement | null }>({});

  // Sync playback speed rate on preview audio player
  useEffect(() => {
    if (standaloneVoiceAudioRef.current) {
      standaloneVoiceAudioRef.current.playbackRate = standaloneVoiceSpeed;
    }
  }, [standaloneVoiceSpeed, standaloneVoiceAudioUrl]);

  const toggleMainPlay = () => {
    if (standaloneVoiceAudioRef.current) {
      if (isPlaying) {
        standaloneVoiceAudioRef.current.pause();
        setIsPlaying(false);
      } else {
        if (playingHistoryId && historyAudioRefs.current[playingHistoryId]) {
          historyAudioRefs.current[playingHistoryId]?.pause();
          setPlayingHistoryId(null);
        }
        standaloneVoiceAudioRef.current.play().catch(e => console.error(e));
        setIsPlaying(true);
      }
    }
  };

  const handleHistoryPlayPause = (id: string) => {
    if (isPlaying && standaloneVoiceAudioRef.current) {
      standaloneVoiceAudioRef.current.pause();
      setIsPlaying(false);
    }
    if (stsInputIsPlaying && stsInputAudioRef.current) {
      stsInputAudioRef.current.pause();
      setStsInputIsPlaying(false);
    }
    if (stsIsPlaying && stsAudioRef.current) {
      stsAudioRef.current.pause();
      setStsIsPlaying(false);
    }

    if (playingHistoryId && playingHistoryId !== id && historyAudioRefs.current[playingHistoryId]) {
      historyAudioRefs.current[playingHistoryId]?.pause();
    }

    const audioObj = historyAudioRefs.current[id];
    if (audioObj) {
      if (playingHistoryId === id) {
        audioObj.pause();
        setPlayingHistoryId(null);
      } else {
        const histItem = historyList.find(item => item.id === id);
        audioObj.playbackRate = histItem?.speed || 1.0;
        audioObj.play().catch(e => console.error(e));
        setPlayingHistoryId(id);
      }
    }
  };

  const handleSaveRename = (id: string) => {
    if (!editingTitle.trim()) return;
    setHistoryList(prev => prev.map(item => item.id === id ? { ...item, title: editingTitle.trim() } : item));
    setEditingHistoryId(null);
  };

  const langsList = [
    { id: 'zh', name: '中文 普通话 (Chinese)' },
    { id: 'en', name: '英语 美式/英式 (English)' },
    { id: 'ja', name: '日语 (Japanese)' },
    { id: 'fr', name: '法语 (French)' },
    { id: 'de', name: '德语 (German)' },
  ];

  const detectLanguage = (text: string): string | null => {
    if (!text.trim()) return null;
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
      return 'ja';
    }
    if (/[\u4e00-\u9fa5]/.test(text)) {
      return 'zh';
    }
    if (/[盲枚眉脽脛脰脺]/.test(text)) {
      return 'de';
    }
    if (/[茅脿猫霉莽芒锚卯么没毛茂眉脣脧脺脗脢脦脭脹脡脌脠脵脟]/.test(text)) {
      return 'fr';
    }
    if (/[a-zA-Z]/.test(text)) {
      return 'en';
    }
    return null;
  };

  const handleTextChange = (val: string) => {
    setStandaloneVoicePrompt(val);
    const detected = detectLanguage(val);
    if (detected) {
      setStandaloneVoiceLang(detected);
    }
  };

  const detectedLangCode = detectLanguage(standaloneVoicePrompt);
  const detectedLangObj = langsList.find(l => l.id === detectedLangCode);

  const voiceHistory = historyList.filter(item => item.type === 'voice');
  const selectedVoiceObj = displayVoices.find(v => v.id === standaloneVoiceRole);
  const generatedVoiceOptions = [
    pendingVoiceOptions.optionA ? { id: 'A' as const, label: '版本 A', option: pendingVoiceOptions.optionA } : null,
    pendingVoiceOptions.optionB ? { id: 'B' as const, label: '版本 B', option: pendingVoiceOptions.optionB } : null,
  ].filter(Boolean) as Array<{ id: 'A' | 'B'; label: string; option: PendingVoiceOption }>;

  const formatDuration = (duration?: number | null) => {
    if (!duration || !Number.isFinite(duration)) return '--:--';
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const sanitizeDownloadName = (name: string) => (
    name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || `generated_voiceover_${Date.now()}`
  );

  const updateGeneratedVoiceName = (id: 'A' | 'B', name: string) => {
    const key = id === 'A' ? 'optionA' : 'optionB';
    const current = pendingVoiceOptions[key];
    setPendingVoiceOptions(prev => ({
      ...prev,
      [key]: prev[key] ? { ...prev[key], displayName: name } : prev[key],
    }));
    if (current?.url) {
      const normalizedName = name.trim() || current.displayName;
      setHistoryList(prev => prev.map(item => (
        item.url === current.url ? { ...item, title: normalizedName } : item
      )));
    }
  };

  const getWaveHeight = (versionId: 'A' | 'B', index: number) => {
    const seed = versionId === 'A' ? 7 : 17;
    return 20 + ((index * 37 + seed * 13) % 72);
  };

  const toggleGeneratedPreview = (id: 'A' | 'B', url: string, speed: number) => {
    if (!generatedPreviewAudioRef.current) {
      generatedPreviewAudioRef.current = new Audio();
    }

    const audio = generatedPreviewAudioRef.current;
    if (previewPlayingId === id && !audio.paused) {
      audio.pause();
      setPreviewPlayingId(null);
      return;
    }

    audio.pause();
    audio.src = url;
    audio.playbackRate = speed;
    audio.onended = () => setPreviewPlayingId(null);
    audio.onpause = () => setPreviewPlayingId(prev => (prev === id ? null : prev));
    audio.play()
      .then(() => setPreviewPlayingId(id))
      .catch(error => console.error('Play generated voice preview failed:', error));
  };

  useEffect(() => {
    if (selectedVoiceObj) {
      setSelectedStandaloneVoice?.(selectedVoiceObj);
    } else if (!standaloneVoiceRole) {
      setSelectedStandaloneVoice?.(null);
    }
  }, [selectedVoiceObj, standaloneVoiceRole, setSelectedStandaloneVoice]);

  useEffect(() => {
    generatedVoiceOptions.forEach(({ id, option }) => {
      if (previewDurations[id] != null) return;
      const audio = new Audio(option.url);
      audio.onloadedmetadata = () => {
        const duration = Number.isFinite(audio.duration) ? audio.duration : null;
        setPreviewDurations(prev => ({ ...prev, [id]: duration }));
      };
      audio.onerror = () => setPreviewDurations(prev => ({ ...prev, [id]: null }));
    });
  }, [pendingVoiceOptions.optionA?.url, pendingVoiceOptions.optionB?.url]);

  useEffect(() => () => {
    if (generatedPreviewAudioRef.current) {
      generatedPreviewAudioRef.current.pause();
    }
  }, []);

  return (
    <div id="dubbingstudio-view" className="flex-1 flex flex-col md:flex-row bg-slate-50 min-h-screen overflow-hidden">
      {/* Sub-navigation Sidebar */}
      <div
        className="relative w-full md:w-[var(--dubbing-subnav-width)] bg-white border-b md:border-b-0 md:border-r border-slate-200 flex flex-col p-4 md:p-5 shrink-0 select-none"
        style={{ '--dubbing-subnav-width': `${subNavWidth}px` } as React.CSSProperties}
      >
        <div className="space-y-1.5">
          <p className="px-3 text-[10px] font-bold text-emerald-800/80 tracking-wider uppercase mb-2">AI配音</p>
          
          {/* Subtab Button 1: 文本转语音 */}
          <button
            onClick={() => {
              setActiveSubTab('tts');
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
              activeSubTab === 'tts'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Mic className={`w-4 h-4 transition-colors ${activeSubTab === 'tts' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>文本转语音</span>
          </button>

          {/* Subtab Button 2: 语音转语音 */}
          <button
            onClick={() => {
              setActiveSubTab('sts');
              if (standaloneVoiceAudioRef.current) standaloneVoiceAudioRef.current.pause();
              setIsPlaying(false);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
              activeSubTab === 'sts'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Volume2 className={`w-4 h-4 transition-colors ${activeSubTab === 'sts' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>语音转语音</span>
          </button>

          {/* Subtab Button 3: 跨语种转换 */}
          <button
            onClick={() => {
              setActiveSubTab('translate');
              if (standaloneVoiceAudioRef.current) standaloneVoiceAudioRef.current.pause();
              setIsPlaying(false);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
              activeSubTab === 'translate'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Languages className={`w-4 h-4 transition-colors ${activeSubTab === 'translate' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>跨语种转换</span>
          </button>

          <button
            onClick={() => {
              setActiveSubTab('stt');
              if (standaloneVoiceAudioRef.current) standaloneVoiceAudioRef.current.pause();
              setIsPlaying(false);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
              activeSubTab === 'stt'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <FileAudio className={`w-4 h-4 transition-colors ${activeSubTab === 'stt' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>语音转文本</span>
          </button>
        </div>
        <button
          type="button"
          aria-label="拖拽调整配音导航宽度"
          onMouseDown={(event) => {
            event.preventDefault();
            subNavResizeStartRef.current = { width: subNavWidth, x: event.clientX };
            setIsResizingSubNav(true);
          }}
          className="absolute right-[-4px] top-0 z-30 hidden h-full w-2 cursor-col-resize bg-transparent transition-colors hover:bg-emerald-400/25 md:block"
        >
          <span className="sr-only">调整配音导航宽度</span>
        </button>
      </div>

      {/* Main Workspace Panel */}
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        {/* Workspace Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6 mb-6">
          <div>
            <h2 className="text-xl font-black text-slate-800">AI 配音</h2>
            <p className="text-xs text-slate-500 mt-1">输入文字或上传语音，自定义声音库，多场景拟真人声配音、跨语种转换体验。</p>
          </div>
        </div>

        {visitedSubTabs.has('tts') && (
          <div hidden={activeSubTab !== 'tts'}>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Core parameters */}
              <div className="lg:col-span-7 space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
            {/* Dialogue textarea with dynamic bracket highlighting */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 block uppercase tracking-wider">配音台词 / 输入文本</label>
                {detectedLangObj && (
                  <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100 flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5 animate-pulse text-emerald-600" />
                    已智能检测语种：{detectedLangObj.name.split(' ')[0]}
                  </span>
                )}
              </div>
              
              <style>{`
                .sync-input-textarea {
                  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
                  font-size: 13px !important;
                  line-height: 1.625 !important;
                  padding: 16px !important;
                  margin: 0 !important;
                  border: 0 !important;
                  width: 100% !important;
                  height: 100% !important;
                  box-sizing: border-box !important;
                  letter-spacing: normal !important;
                  word-spacing: normal !important;
                  text-transform: none !important;
                  text-indent: 0px !important;
                  text-shadow: none !important;
                  text-align: start !important;
                }
                .sync-input-textarea::-webkit-scrollbar {
                  display: none !important;
                }
              `}</style>
              
              <div className="relative w-full h-32 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:ring-1 focus-within:ring-emerald-500 focus-within:border-emerald-500 transition-all shadow-inner">
                {/* Highlighted layer (behind) */}
                <div 
                  ref={highlightRef}
                  className="sync-input-textarea absolute inset-0 pointer-events-none select-none overflow-y-auto text-slate-800 whitespace-pre-wrap break-words"
                  style={{ msOverflowStyle: 'none', scrollbarWidth: 'none' }}
                >
                  {renderHighlightedText(standaloneVoicePrompt)}
                </div>
                
                {/* Actual textarea (foreground, transparent text but visible caret) */}
                <textarea
                  ref={textareaRef}
                  value={standaloneVoicePrompt}
                  onChange={(e) => handleTextChange(e.target.value)}
                  onScroll={handleScroll}
                  placeholder=""
                  className="sync-input-textarea absolute inset-0 bg-transparent text-transparent caret-slate-800 focus:ring-0 focus:outline-none resize-none overflow-y-auto"
                  style={{ WebkitTextFillColor: 'transparent' }}
                />
              </div>
            </div>

            {/* Premium Voice Library vs Custom Voice Setting block */}
            <div className="space-y-3">
              <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>声线设定方式（精品人声库）</span>
                </span>
                <span className="text-[10px] text-slate-450 font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">ElevenLabs 引擎支持</span>
              </label>

              {/* PREMIUM VOICE SELECTION WIDGET */}
              <div className="space-y-3 relative">
                  {/* Selected Voice Display & Trigger Button */}
                        <button
                          type="button"
                          onClick={() => setShowVoiceDropdown(!showVoiceDropdown)}
                          className="w-full bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-xl py-3 px-4 text-xs text-left text-slate-800 focus:outline-none transition-all flex items-center justify-between cursor-pointer shadow-sm"
                        >
                          {selectedVoiceObj ? (
                            <div className="flex items-center gap-2.5">
                              <span className={`w-2 h-2 rounded-full ${selectedVoiceObj.gender === 'male' ? 'bg-blue-500' : 'bg-pink-500'}`} />
                              <div>
                                <span className="font-bold text-slate-850">已选：{selectedVoiceObj.name}</span>
                                <span className="text-[10px] text-slate-500 bg-slate-150 border border-slate-200 px-1.5 py-0.5 rounded ml-2 font-bold">
                                  {selectedVoiceObj.category}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400">请选择精品配音角色...</span>
                          )}
                          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${showVoiceDropdown ? 'rotate-180' : ''}`} />
                        </button>

                        {showVoiceDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 space-y-3">
                            <div className="relative">
                              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                              <input
                                type="text"
                                value={voiceSearchQuery}
                                onChange={(event) => setVoiceSearchQuery(event.target.value)}
                                placeholder="搜索声音名称、分类、标签或音色特点..."
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-8 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all placeholder-slate-400"
                              />
                              {voiceSearchQuery && (
                                <button
                                  type="button"
                                  onClick={() => setVoiceSearchQuery('')}
                                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-2">
                              <span className="text-[9px] font-bold text-slate-400 uppercase mr-1">分类:</span>
                              {voiceCategories.map(category => (
                                <button
                                  key={category}
                                  type="button"
                                  onClick={() => setVoiceActiveCategory(category)}
                                  className={`text-[9px] px-2.5 py-0.5 rounded font-bold transition-all ${
                                    voiceActiveCategory === category
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {category}
                                </button>
                              ))}
                            </div>

                            <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
                              <span className="text-[9px] font-bold text-slate-400 uppercase mr-1">性别:</span>
                              {[
                                { value: 'all', label: '全部', activeClassName: 'bg-emerald-600 text-white' },
                                { value: 'male', label: '男声', activeClassName: 'bg-blue-600 text-white' },
                                { value: 'female', label: '女声', activeClassName: 'bg-pink-600 text-white' },
                              ].map(option => (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => setVoiceGenderFilter(option.value as 'all' | 'male' | 'female')}
                                  className={`text-[9px] px-2.5 py-0.5 rounded font-bold transition-all ${
                                    voiceGenderFilter === option.value
                                      ? option.activeClassName
                                      : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>

                            <div className="max-h-72 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                              {isLoadingVoices ? (
                                <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  正在加载声音库...
                                </div>
                              ) : displayVoices.length === 0 ? (
                                <div className="py-10 px-4 text-center flex flex-col items-center justify-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 border border-amber-100">
                                    <Info className="w-5 h-5" />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-xs font-bold text-slate-700">配音声音库为空</p>
                                    <p className="text-[11px] text-slate-500 max-w-xs leading-relaxed">
                                      请检查 ElevenLabs 服务状态，或先同步/添加可用声线。
                                    </p>
                                  </div>
                                </div>
                              ) : filteredVoiceOptions.length === 0 ? (
                                <div className="py-8 text-center text-slate-400 text-xs">
                                  未找到匹配的声音，请换一个搜索词或筛选条件。
                                </div>
                              ) : filteredVoiceOptions.map(voice => {
                                const isSelected = standaloneVoiceRole === voice.id;
                                return (
                                  <div
                                    key={voice.id}
                                    onClick={() => handleSelectVoice(voice)}
                                    className={`w-full py-2 px-2.5 rounded-xl flex items-start justify-between gap-3 cursor-pointer transition-colors text-left ${
                                      isSelected ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1 space-y-0.5">
                                      <div className="flex items-center flex-wrap gap-1">
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${voice.gender === 'male' ? 'bg-blue-500' : 'bg-pink-500'}`} />
                                        <span className="text-xs font-bold text-slate-850">{voice.name}</span>
                                        <span className="text-[9px] text-slate-400 bg-slate-50 px-1 py-0.2 rounded border border-slate-100 font-mono">
                                          {voice.category}
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-slate-500 truncate leading-normal">{voice.description}</p>
                                      <div className="flex flex-wrap gap-1">
                                        {(voice.tags || []).slice(0, 3).map((tag, index) => (
                                          <span key={index} className="text-[9px] text-emerald-700 bg-emerald-50 px-1 rounded-sm">
                                            #{tag}
                                          </span>
                                        ))}
                                      </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-1 mt-1">
                                      <button
                                        type="button"
                                        onClick={(event) => handlePlayVoicePreview(voice.id, voice.previewUrl || '', event)}
                                        aria-label={`试听 ${voice.name}`}
                                        title="试听"
                                        className={`w-5.5 h-5.5 rounded-full flex items-center justify-center border transition-colors ${
                                          playingVoiceId === voice.id
                                            ? 'bg-emerald-600 border-emerald-500 text-white'
                                            : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-700'
                                        }`}
                                      >
                                        {playingVoiceId === voice.id ? (
                                          <Pause className="w-2.5 h-2.5 fill-current" />
                                        ) : (
                                          <Play className="w-2.5 h-2.5 fill-current ml-0.2" />
                                        )}
                                      </button>

                                      <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                                        isSelected ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-200 bg-white'
                                      }`}>
                                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Selected Voice Detailed Card */}
                        {selectedVoiceObj && (
                          <div className="bg-gradient-to-br from-emerald-50/50 to-teal-50/30 border border-emerald-500/20 rounded-2xl p-4 space-y-2.5 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-black text-emerald-950">{selectedVoiceObj.name}</span>
                                  <span className="text-[9px] text-slate-500 bg-slate-100 border border-slate-200 px-1.5 rounded-full font-semibold">
                                    {selectedVoiceObj.category}
                                  </span>
                                  <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                                    selectedVoiceObj.gender === 'male' 
                                      ? 'bg-blue-50 text-blue-700 border border-blue-100' 
                                      : 'bg-pink-50 text-pink-700 border border-pink-100'
                                  }`}>
                                    {selectedVoiceObj.gender === 'male' ? '男声 (Male)' : '女声 (Female)'}
                                  </span>
                                </div>
                                <p className="text-[10px] text-slate-600 mt-1 leading-relaxed">{selectedVoiceObj.description}</p>
                              </div>

                              <button
                                type="button"
                                onClick={(e) => handlePlayVoicePreview(selectedVoiceObj.id, selectedVoiceObj.previewUrl, e)}
                                className={`w-8 h-8 rounded-full flex items-center justify-center border shrink-0 transition-all ${
                                  playingVoiceId === selectedVoiceObj.id
                                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-md animate-pulse'
                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-150 shadow-sm'
                                }`}
                                title="试听当前声线"
                              >
                                {playingVoiceId === selectedVoiceObj.id ? (
                                  <Pause className="w-3.5 h-3.5 fill-current" />
                                ) : (
                                  <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                                )}
                              </button>
                            </div>

                            <div className="flex flex-wrap gap-1 pt-1.5 border-t border-emerald-500/10">
                              {selectedVoiceObj.tags.map((tag, idx) => (
                                <span
                                  key={idx}
                                  className="text-[9px] font-semibold text-emerald-800 bg-emerald-100/50 px-2 py-0.5 rounded-full"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                </div>
            </div>

            {/* Error alerts */}
            {standaloneVoiceError && (
              <div className="bg-red-50 border border-red-200 text-red-600 p-3.5 rounded-xl text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{standaloneVoiceError}</span>
              </div>
            )}

            {/* Dub generation button */}
            <button
              onClick={handleStandaloneVoiceGenerate}
              disabled={standaloneVoiceLoading || !standaloneVoicePrompt.trim() || !standaloneVoiceRole}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3.5 rounded-xl text-xs tracking-wider uppercase transition-all shadow-md shadow-emerald-600/10 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {standaloneVoiceLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>ElevenLabs 正在生成配音...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>合成并输出人物配音</span>
                </>
              )}
            </button>

          </div>
        </div>

        {/* Player preview columns */}
        <div className="lg:col-span-5 space-y-5">
          {/* Main active preview player */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">配音预览与播放控制</h3>
            
            {standaloneVoiceLoading ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-3">
                <div className="w-12 h-12 bg-emerald-50 border border-emerald-200 rounded-full flex items-center justify-center animate-spin">
                  <Mic className="w-5 h-5 text-emerald-600 animate-pulse" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-slate-700">正在生成配音作品...</p>
                  <p className="text-[10px] text-slate-400">大约需要 5 - 10 秒</p>
                </div>
              </div>
            ) : generatedVoiceOptions.length > 0 ? (
              <div className="space-y-3">
                {generatedVoiceOptions.map(({ id, label, option }) => {
                  const isPreviewPlaying = previewPlayingId === id;
                  return (
                    <div key={id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 blur-xl pointer-events-none" />
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => toggleGeneratedPreview(id, option.url, option.speed)}
                          className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                            isPreviewPlaying
                              ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-500/20'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 hover:text-slate-950'
                          }`}
                        >
                          {isPreviewPlaying ? <Pause className="w-4.5 h-4.5 fill-current" /> : <Play className="w-4.5 h-4.5 fill-current ml-0.5" />}
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-700">{label}</span>
                            <input
                              type="text"
                              value={option.displayName}
                              onChange={(event) => updateGeneratedVoiceName(id, event.target.value)}
                              className="min-w-0 flex-1 rounded-md border border-transparent bg-white/70 px-2 py-1 text-xs font-bold text-slate-800 outline-none transition-all hover:border-slate-200 focus:border-emerald-400 focus:bg-white focus:ring-1 focus:ring-emerald-200"
                              aria-label={`${label} 配音名称`}
                            />
                            <span className="text-[10px] font-mono font-bold text-slate-400 shrink-0">{formatDuration(previewDurations[id])}</span>
                          </div>
                          <p className="text-[10px] text-slate-500 truncate italic mt-0.5">"{option.processedText}"</p>
                          <span className="text-[9px] text-emerald-600 font-semibold mt-1 block">
                            属性：{standaloneVoiceGender === 'male' ? '男声' : '女声'} · {standaloneVoiceLang.toUpperCase()} · {option.speed}x
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center h-10 bg-slate-200/50 p-2 rounded-lg gap-0.5 border border-slate-200 overflow-hidden">
                        {Array.from({ length: 44 }).map((_, index) => (
                          <span
                            key={index}
                            className={`rounded-full w-1 transition-all ${isPreviewPlaying ? 'bg-emerald-500' : 'bg-emerald-400/70'}`}
                            style={{ height: `${getWaveHeight(id, index)}%` }}
                          />
                        ))}
                      </div>

                      <button
                        onClick={() => downloadAudioHelper(option.url, `${sanitizeDownloadName(option.displayName)}.mp3`)}
                        className="w-full bg-white hover:bg-emerald-50 border border-slate-200 text-slate-700 hover:text-emerald-700 py-2 rounded-xl text-[10px] font-bold text-center transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>下载 MP3 配音（{label}）</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="border border-dashed border-slate-200 bg-slate-50 rounded-xl p-10 text-center text-slate-400 text-xs leading-relaxed">
                <Mic className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <span>输入台词，指定人设和语气偏好，点击生成高品质配音音轨。</span>
              </div>
            )}
          </div>

          {/* Voice History Tracks */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
              <span>已归档配音 ({voiceHistory.length})</span>
              <span className="text-[10px] text-slate-400 font-normal">本次会话</span>
            </h3>

            {voiceHistory.length === 0 ? (
              <p className="text-slate-400 text-[10px] text-center py-6">暂无历史配音。配音生成成功后，将在此自动归档。</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                {voiceHistory.map((item) => {
                  const isHistPlaying = playingHistoryId === item.id;
                  return (
                    <div key={item.id} className="p-3 bg-slate-50 border border-slate-200 hover:border-emerald-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                      <audio 
                        ref={el => { historyAudioRefs.current[item.id] = el; }} 
                        src={item.url} 
                        onEnded={() => setPlayingHistoryId(null)}
                      />
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <button
                          onClick={() => handleHistoryPlayPause(item.id)}
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                            isHistPlaying 
                              ? 'bg-emerald-600 text-white border-emerald-500' 
                              : 'bg-white text-slate-500 border-slate-200 hover:text-slate-905 hover:bg-slate-50'
                          }`}
                        >
                          {isHistPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          {editingHistoryId === item.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                className="bg-white border border-emerald-300 rounded px-1.5 py-0.5 text-[11px] text-slate-850 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-full"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveRename(item.id);
                                  if (e.key === 'Escape') setEditingHistoryId(null);
                                }}
                              />
                              <button
                                onClick={() => handleSaveRename(item.id)}
                                className="p-0.5 hover:bg-emerald-50 text-emerald-600 rounded transition-colors shrink-0"
                                title="保存"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingHistoryId(null)}
                                className="p-0.5 hover:bg-red-50 text-red-600 rounded transition-colors shrink-0"
                                title="取消"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 group">
                              <p className="font-bold text-slate-750 truncate text-[11px]">{item.title}</p>
                              <button
                                onClick={() => {
                                  setEditingHistoryId(item.id);
                                  setEditingTitle(item.title);
                                }}
                                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-0.5 text-slate-400 hover:text-emerald-600 rounded transition-opacity shrink-0"
                                title="重命名"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          <p className="text-[9px] text-slate-400 truncate italic">"{item.prompt}"</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[9px] text-slate-400 font-mono hidden sm:inline">{item.timestamp.split(' ')[1]}</span>
                        <button
                          onClick={() => downloadAudioHelper(item.url, `${item.id}.mp3`)}
                          className="p-1 hover:bg-emerald-50 hover:text-emerald-700 text-slate-400 rounded transition-colors cursor-pointer"
                          title="下载"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
          </div>
          )}
          {visitedSubTabs.has('sts') && (
            <div hidden={activeSubTab !== 'sts'}>
              <SpeechToSpeech
                historyList={historyList}
                setHistoryList={setHistoryList}
                displayVoices={displayVoices}
                playingVoiceId={playingVoiceId}
                handlePlayVoicePreview={handlePlayVoicePreview}
                onAudioPlay={() => {
                  if (standaloneVoiceAudioRef.current) {
                    standaloneVoiceAudioRef.current.pause();
                    setIsPlaying(false);
                  }
                }}
              />
            </div>
          )}
          {visitedSubTabs.has('translate') && (
            <div hidden={activeSubTab !== 'translate'}>
              <CrossLanguageDubbing
                displayVoices={displayVoices}
                setHistoryList={setHistoryList}
                playingVoiceId={playingVoiceId}
                handlePlayVoicePreview={handlePlayVoicePreview}
                onAudioPlay={() => {
                  if (standaloneVoiceAudioRef.current) {
                    standaloneVoiceAudioRef.current.pause();
                    setIsPlaying(false);
                  }
                }}
              />
            </div>
          )}
          {visitedSubTabs.has('stt') && (
            <div hidden={activeSubTab !== 'stt'}>
              <SpeechToText />
            </div>
          )}
      </div>
    </div>
  );
}
