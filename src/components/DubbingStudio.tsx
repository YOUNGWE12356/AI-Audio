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
  Smile,
  Globe,
  Pencil,
  Check,
  Search,
  ChevronDown,
  Info,
  PlusCircle,
  Trash2,
  Languages
} from 'lucide-react';
import { HistoryItem } from '../types';
import { ELEVENLABS_VOICES, VoiceItem } from '../data/voices';
import { fetchAvailableVoices } from '../services/elevenLabsService';
import { translateToEnglish } from '../services/geminiService';

interface PendingVoiceOption {
  url: string;
  voiceLabel: string;
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

  // Dual option play states & ref
  const [playingOptionId, setPlayingOptionId] = useState<'A' | 'B' | null>(null);
  const optionAudioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlayOptionAudio = (id: 'A' | 'B', url: string, speed: number) => {
    if (!optionAudioRef.current) {
      optionAudioRef.current = new Audio();
    }

    if (playingOptionId === id) {
      optionAudioRef.current.pause();
      setPlayingOptionId(null);
    } else {
      optionAudioRef.current.src = url;
      optionAudioRef.current.playbackRate = speed;
      optionAudioRef.current.play()
        .then(() => setPlayingOptionId(id))
        .catch(e => console.error("Play option audio failed:", e));
      
      optionAudioRef.current.onended = () => {
        setPlayingOptionId(null);
      };
    }
  };

  const handleSaveSingleOption = (id: 'A' | 'B') => {
    const selected = id === 'A' ? pendingVoiceOptions.optionA : pendingVoiceOptions.optionB;
    const other = id === 'A' ? pendingVoiceOptions.optionB : pendingVoiceOptions.optionA;

    if (selected) {
      const newItem: HistoryItem = {
        id: `voice-${Date.now()}`,
        type: 'voice',
        title: `角色配音 - ${selected.voiceLabel}`,
        prompt: selected.processedText,
        url: selected.url,
        timestamp: selected.timestamp,
        details: selected.details,
        speed: selected.speed
      };

      setHistoryList(prev => [newItem, ...prev]);

      // Revoke the other option's object URL to free memory, and keep the saved one
      if (other) {
        URL.revokeObjectURL(other.url);
      }

      // Clear pending options
      setPendingVoiceOptions({ optionA: null, optionB: null });
      setPlayingOptionId(null);
      if (optionAudioRef.current) {
        optionAudioRef.current.pause();
      }
    }
  };

  const handleSaveBothOptions = () => {
    const items: HistoryItem[] = [];
    const nowTime = Date.now();

    if (pendingVoiceOptions.optionA) {
      items.push({
        id: `voice-A-${nowTime}`,
        type: 'voice',
        title: `角色配音 - ${pendingVoiceOptions.optionA.voiceLabel}`,
        prompt: pendingVoiceOptions.optionA.processedText,
        url: pendingVoiceOptions.optionA.url,
        timestamp: pendingVoiceOptions.optionA.timestamp,
        details: pendingVoiceOptions.optionA.details,
        speed: pendingVoiceOptions.optionA.speed
      });
    }

    if (pendingVoiceOptions.optionB) {
      items.push({
        id: `voice-B-${nowTime}`,
        type: 'voice',
        title: `角色配音 - ${pendingVoiceOptions.optionB.voiceLabel}`,
        prompt: pendingVoiceOptions.optionB.processedText,
        url: pendingVoiceOptions.optionB.url,
        timestamp: pendingVoiceOptions.optionB.timestamp,
        details: pendingVoiceOptions.optionB.details,
        speed: pendingVoiceOptions.optionB.speed
      });
    }

    if (items.length > 0) {
      setHistoryList(prev => [...items, ...prev]);
    }

    setPendingVoiceOptions({ optionA: null, optionB: null });
    setPlayingOptionId(null);
    if (optionAudioRef.current) {
      optionAudioRef.current.pause();
    }
  };

  const handleDiscardOptions = () => {
    if (pendingVoiceOptions.optionA) {
      URL.revokeObjectURL(pendingVoiceOptions.optionA.url);
    }
    if (pendingVoiceOptions.optionB) {
      URL.revokeObjectURL(pendingVoiceOptions.optionB.url);
    }
    setPendingVoiceOptions({ optionA: null, optionB: null });
    setPlayingOptionId(null);
    if (optionAudioRef.current) {
      optionAudioRef.current.pause();
    }
  };

  useEffect(() => {
    return () => {
      if (optionAudioRef.current) {
        optionAudioRef.current.pause();
      }
    };
  }, []);
  
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

  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const handleTranslateSelectionToEmotion = async () => {
    if (!textareaRef.current) return;
    
    const selectionStart = textareaRef.current.selectionStart;
    const selectionEnd = textareaRef.current.selectionEnd;
    
    const selectedText = standaloneVoicePrompt.substring(selectionStart, selectionEnd);
    if (!selectedText.trim()) {
      setTranslationError('请先在下方输入框中选中需要转为情绪的文字（如：开心、悲伤）');
      setTimeout(() => setTranslationError(null), 4000);
      return;
    }

    setIsTranslating(true);
    setTranslationError(null);

    try {
      // Split by common Chinese/English punctuation/symbols and spaces
      const rawWords = selectedText
        .split(/[,，、／\/;\s+＆&+\-_\|]+/g)
        .map(w => w.trim())
        .filter(Boolean);
      
      // Translate each word and wrap with []
      const processedWords = await Promise.all(
        rawWords.map(async (word) => {
          let translated = word;
          // Only translate if contains non-English characters
          if (/[\u4e00-\u9fa5]/.test(word)) {
            translated = await translateToEnglish(word);
          }
          // Normalize to lowercase, trim, remove brackets if Gemini accidentally output them
          translated = translated.replace(/[\[\]]/g, '').trim().toLowerCase();
          return `[${translated}]`;
        })
      );

      const replacement = processedWords.join('');
      
      const beforeText = standaloneVoicePrompt.substring(0, selectionStart);
      const afterText = standaloneVoicePrompt.substring(selectionEnd);
      const newPrompt = beforeText + replacement + afterText;
      
      // Update state
      handleTextChange(newPrompt);
      
      // Refocus textarea and place selection right after the inserted bracket
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          const newCursorPos = beforeText.length + replacement.length;
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 50);

    } catch (err: any) {
      console.error("Emotion translation failed:", err);
      setTranslationError('情绪翻译失败，请检查网络或重试: ' + (err.message || err));
    } finally {
      setIsTranslating(false);
    }
  };

  const handleScroll = () => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const renderHighlightedText = (text: string) => {
    if (!text) {
      return (
        <span className="text-slate-400 leading-normal block">
          在此输入要配音的文本，直接在台词中（例如开头）使用中括号来控制情绪（例如：<span className="text-emerald-600 font-bold bg-emerald-50 px-1 py-0.5 rounded border border-emerald-200">[激动地]</span> 我们终于抵达了这颗被称为蔚蓝家园的星球...）
        </span>
      );
    }
    
    // Split by bracket expressions like [excited] or ［激动地］
    const parts = text.split(/([\[［][^\]］]*[\]］])/g);
    return parts.map((part, index) => {
      if ((part.startsWith('[') && part.endsWith(']')) || (part.startsWith('［') && part.endsWith('］'))) {
        return (
          <span 
            key={index} 
            className="text-emerald-600 font-bold bg-emerald-100/60 px-1.5 py-0.5 rounded border border-emerald-300"
          >
            {part}
          </span>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  // Dynamically fetched voices from ElevenLabs API
  const [fetchedVoices, setFetchedVoices] = useState<VoiceItem[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);

  const loadVoices = async () => {
    setIsLoadingVoices(true);
    try {
      const apiVoices = await fetchAvailableVoices();
      if (apiVoices && apiVoices.length > 0) {
        // Only keep official ElevenLabs premade voices or user's own instant/professional cloned voices
        const allowedCategories = ['premade', 'cloned', 'professional'];
        const filteredApiVoices = apiVoices.filter(av => allowedCategories.includes(av.category));

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
  const displayVoices = fetchedVoices.length > 0 
    ? [...ELEVENLABS_VOICES, ...fetchedVoices.filter(fv => !ELEVENLABS_VOICES.some(ev => ev.id === fv.id))]
    : ELEVENLABS_VOICES;

  // Derived state to check if current standaloneVoiceRole is an ElevenLabs Premium Voice ID
  const isPremiumVoiceSelected = displayVoices.some(v => v.id === standaloneVoiceRole);
  const voiceMode = 'premium';

  // Ensure standaloneVoiceRole is always set to a valid premium voice ID
  useEffect(() => {
    if (standaloneVoiceRole && !displayVoices.some(v => v.id === standaloneVoiceRole)) {
      if (displayVoices.length > 0) {
        setStandaloneVoiceRole(displayVoices[0].id);
        setStandaloneVoiceGender(displayVoices[0].gender);
      } else {
        setStandaloneVoiceRole('21m00Tcm4TlvDq8ikWAM');
        setStandaloneVoiceGender('female');
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
    { id: 'en', name: '英语 美英式 (English)' },
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
    if (/[äöüßÄÖÜ]/.test(text)) {
      return 'de';
    }
    if (/[éàèùçâêîôûëïüËÏÜÂÊÎÔÛÉÀÈÙÇ]/.test(text)) {
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

  return (
    <div id="dubbingstudio-view" className="flex-1 p-6 space-y-6 max-w-6xl mx-auto w-full">
      {/* Workspace Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">AI Character Dubbing Studio</span>
          </div>
          <h2 className="text-xl font-black text-slate-800 mt-1">AI 配音</h2>
          <p className="text-xs text-slate-500 mt-1">输入任意文字配音，自动检测输入语种；自定义文字输入描述您心仪的声线与情感，一键渲染拟真人声。</p>
        </div>
      </div>

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
                    已智能检测语种为: {detectedLangObj.name.split(' ')[0]}
                  </span>
                )}
              </div>
              
              <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200/85 rounded-xl p-2.5">
                <div className="flex items-center gap-1.5">
                  <Smile className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-[11px] text-slate-600">
                    💡 用鼠标划选中文字词，点击右键自动翻译并生成情绪括号
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleTranslateSelectionToEmotion}
                  disabled={isTranslating}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-sm transition-all cursor-pointer select-none ${
                    isTranslating
                      ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 hover:shadow'
                  }`}
                >
                  {isTranslating ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Languages className="w-3 h-3" />
                  )}
                  <span>划选转英文情绪 [ ]</span>
                </button>
              </div>

              {translationError && (
                <div className="text-[10px] text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 flex items-center gap-1.5 animate-fade-in">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{translationError}</span>
                </div>
              )}
              
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

            {/* Config Dials: Speed control takes full width or a nice layout */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                <Sliders className="w-3.5 h-3.5 text-emerald-600" />
                <span>语速调控 ({standaloneVoiceSpeed.toFixed(1)}x)</span>
              </label>
              <select
                value={standaloneVoiceSpeed}
                onChange={(e) => setStandaloneVoiceSpeed(parseFloat(e.target.value))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all cursor-pointer"
              >
                <option value="0.5">0.5x (极慢)</option>
                <option value="0.8">0.8x (慢速)</option>
                <option value="1">1.0x (正常默认)</option>
                <option value="1.2">1.2x (稍快)</option>
                <option value="1.5">1.5x (快速)</option>
                <option value="1.8">1.8x (极快)</option>
                <option value="2">2.0x (飞快)</option>
              </select>
            </div>

            {/* Premium Voice Library vs Custom Voice Setting block */}
            <div className="space-y-3">
              <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>声线设定方式 (精品人声库)</span>
                </span>
                <span className="text-[10px] text-slate-450 font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">ElevenLabs 引擎支持</span>
              </label>

              {/* PREMIUM VOICE SELECTION WIDGET */}
              <div className="space-y-3 relative">
                  {/* Selected Voice Display & Trigger Button */}
                  {(() => {
                    const selectedVoiceObj = displayVoices.find(v => v.id === standaloneVoiceRole);
                    return (
                      <>
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

                        {/* Interactive Voice Dropdown Popover */}
                        {showVoiceDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 space-y-3">
                            {/* Keyword Search Input */}
                            <div className="relative">
                              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                              <input
                                type="text"
                                value={voiceSearchQuery}
                                onChange={(e) => setVoiceSearchQuery(e.target.value)}
                                placeholder="搜索声线名称、分类、标签或音色特点..."
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

                            {/* Gender filters */}
                            <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
                              <span className="text-[9px] font-bold text-slate-400 uppercase mr-1">声弹性别:</span>
                              <button
                                type="button"
                                onClick={() => setVoiceGenderFilter('all')}
                                className={`text-[9px] px-2.5 py-0.5 rounded font-bold transition-all ${
                                  voiceGenderFilter === 'all'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                                }`}
                              >
                                全部
                              </button>
                              <button
                                type="button"
                                onClick={() => setVoiceGenderFilter('male')}
                                className={`text-[9px] px-2.5 py-0.5 rounded font-bold transition-all ${
                                  voiceGenderFilter === 'male'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                                }`}
                              >
                                男声
                              </button>
                              <button
                                type="button"
                                onClick={() => setVoiceGenderFilter('female')}
                                className={`text-[9px] px-2.5 py-0.5 rounded font-bold transition-all ${
                                  voiceGenderFilter === 'female'
                                    ? 'bg-pink-600 text-white'
                                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                                }`}
                              >
                                女声
                              </button>
                            </div>

                            {/* Category Filter Tabs */}
                            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                              {['全部', '经典人声', '游戏动漫', '叙事小说', '媒体广告', '高雅格调', '我的克隆'].map(cat => {
                                if (cat === '我的克隆' && !displayVoices.some(v => v.category === '我的克隆')) {
                                  return null;
                                }
                                return (
                                  <button
                                    key={cat}
                                    type="button"
                                    onClick={() => setVoiceActiveCategory(cat)}
                                    className={`text-[9px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap transition-all shrink-0 ${
                                      voiceActiveCategory === cat
                                        ? 'bg-emerald-50 border-emerald-500/40 text-emerald-800 font-black'
                                        : 'bg-white border-slate-200 hover:border-slate-300 text-slate-600'
                                    }`}
                                  >
                                    {cat}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Scrollable List container */}
                            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 custom-scrollbar pr-1">
                              {isLoadingVoices ? (
                                <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
                                  <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                                  <span>正在同步您的 ElevenLabs 声线库...</span>
                                </div>
                              ) : (() => {
                                const categories = ['全部', '经典人声', '游戏动漫', '叙事小说', '媒体广告', '高雅格调', '我的克隆'];
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

                                if (displayVoices.length === 0) {
                                  const hasKey = Boolean(process.env.ELEVENLABS_API_KEY || (typeof window !== 'undefined' && localStorage.getItem('ELEVENLABS_API_KEY')));
                                  return (
                                    <div className="py-12 px-4 text-center flex flex-col items-center justify-center gap-3">
                                      <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 border border-amber-100">
                                        <Info className="w-5 h-5 animate-bounce" />
                                      </div>
                                      <div className="space-y-1">
                                        <p className="text-xs font-bold text-slate-700">精品人声库为空</p>
                                        <p className="text-[11px] text-slate-500 max-w-xs leading-relaxed">
                                          {hasKey 
                                            ? "您的 ElevenLabs 账户中暂无声线资产。请登录 ElevenLabs 官网添加、订阅或克隆您的声线。"
                                            : "尚未配置 ElevenLabs API Key。请前往“设置”页面配置您的 API Key 以同步真实 ElevenLabs 声线。"}
                                        </p>
                                      </div>
                                      {!hasKey && (
                                        <span className="text-[9px] bg-slate-100 border border-slate-200 text-slate-600 px-2 py-1 rounded-md font-mono mt-1">
                                          ELEVENLABS_API_KEY 未配置
                                        </span>
                                      )}
                                    </div>
                                  );
                                }

                                if (filteredVoices.length === 0) {
                                  return (
                                    <div className="py-8 text-center text-slate-400 text-xs">
                                      未找到匹配的优质声线，请尝试其他搜索词
                                    </div>
                                  );
                                }

                                return filteredVoices.map(voice => {
                                  const isSelected = standaloneVoiceRole === voice.id;
                                  const isVoicePlaying = playingVoiceId === voice.id;
                                  return (
                                    <div
                                      key={voice.id}
                                      onClick={() => handleSelectVoice(voice)}
                                      className={`py-2 px-2.5 rounded-xl flex items-start justify-between gap-3 cursor-pointer transition-colors ${
                                        isSelected ? 'bg-emerald-50/40' : 'hover:bg-slate-50'
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
                                          {voice.tags.slice(0, 3).map((tag, tIdx) => (
                                            <span key={tIdx} className="text-[9px] text-emerald-700 bg-emerald-50 px-1 rounded-sm">
                                              #{tag}
                                            </span>
                                          ))}
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-1.5 shrink-0 pt-1">
                                        {/* Play Preview */}
                                        <button
                                          type="button"
                                          onClick={(e) => handlePlayVoicePreview(voice.id, voice.previewUrl, e)}
                                          className={`w-7 h-7 rounded-full flex items-center justify-center border transition-all ${
                                            isVoicePlaying
                                              ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm animate-pulse'
                                              : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200 hover:bg-slate-100'
                                          }`}
                                          title={isVoicePlaying ? '暂停试听' : '点击试听音质'}
                                        >
                                          {isVoicePlaying ? (
                                            <Pause className="w-3.5 h-3.5 fill-current" />
                                          ) : (
                                            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                                          )}
                                        </button>

                                        {/* Selection mark */}
                                        <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                                          isSelected ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-200 bg-white'
                                        }`}>
                                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>

                            {/* Reassuring tip about playback stability */}
                            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                              <span>💡 提示：点击 ▶ 按钮即可一键试听音质特点。</span>
                              <span className="text-emerald-600 font-semibold flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> 已开启 WebSpeech 试听容灾保障
                              </span>
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
                      </>
                    );
                  })()}
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
              disabled={standaloneVoiceLoading || !standaloneVoicePrompt.trim()}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3.5 rounded-xl text-xs tracking-wider uppercase transition-all shadow-md shadow-emerald-600/10 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {standaloneVoiceLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>ElevenLabs 合成引擎正在全力咬字配音中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>合成并输出人物配音</span>
                </>
              )}
            </button>

            {/* COMPONENT: DOUBLE OPTION CHOICE PICKER */}
            {(pendingVoiceOptions.optionA || pendingVoiceOptions.optionB) && (
              <div className="bg-emerald-50/40 border-2 border-emerald-500/30 rounded-2xl p-5 space-y-4 shadow-md animate-fade-in mt-4">
                <div className="flex items-center justify-between border-b border-emerald-500/10 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-600 animate-pulse" />
                    <h4 className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">
                      AI 智能多重配音方案（已生成双版本供对比）
                    </h4>
                  </div>
                  <span className="text-[9px] text-emerald-700 font-bold bg-emerald-100 px-2 py-0.5 rounded-full">
                    对比推荐
                  </span>
                </div>

                <p className="text-[10px] text-slate-600 leading-relaxed">
                  系统已为您一次性生成了两个略有不同的演绎版本。请试听并选择您满意的保留到历史记录中：
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* OPTION A CARD */}
                  {pendingVoiceOptions.optionA && (
                    <div className="bg-white border border-emerald-100 rounded-xl p-3 space-y-3 relative overflow-hidden group shadow-sm hover:border-emerald-200 transition-all flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-black text-slate-850 flex items-center gap-1.5">
                            <span className="w-4.5 h-4.5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[9px] font-black">A</span>
                            方案版本 A
                          </span>
                        </div>

                        {/* Custom Audio Player for A */}
                        <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handlePlayOptionAudio('A', pendingVoiceOptions.optionA!.url, pendingVoiceOptions.optionA!.speed)}
                            className={`w-7 h-7 rounded-full flex items-center justify-center border transition-all shrink-0 ${
                              playingOptionId === 'A'
                                ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                                : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {playingOptionId === 'A' ? (
                              <Pause className="w-3 h-3 fill-current" />
                            ) : (
                              <Play className="w-3 h-3 fill-current ml-0.5" />
                            )}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-bold text-slate-700 truncate">
                              {pendingVoiceOptions.optionA.voiceLabel}
                            </div>
                            <div className="text-[9px] text-slate-400 truncate">
                              情绪：{pendingVoiceOptions.optionA.emotionLabel} · 语速 {pendingVoiceOptions.optionA.speed}x
                            </div>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSaveSingleOption('A')}
                        className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer shadow-sm mt-2"
                      >
                        <Check className="w-3 h-3 stroke-[2.5]" />
                        <span>仅保留此版本 (A)</span>
                      </button>
                    </div>
                  )}

                  {/* OPTION B CARD */}
                  {pendingVoiceOptions.optionB && (
                    <div className="bg-white border border-emerald-100 rounded-xl p-3 space-y-3 relative overflow-hidden group shadow-sm hover:border-emerald-200 transition-all flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-black text-slate-850 flex items-center gap-1.5">
                            <span className="w-4.5 h-4.5 rounded-full bg-teal-600 text-white flex items-center justify-center text-[9px] font-black">B</span>
                            方案版本 B
                          </span>
                        </div>

                        {/* Custom Audio Player for B */}
                        <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handlePlayOptionAudio('B', pendingVoiceOptions.optionB!.url, pendingVoiceOptions.optionB!.speed)}
                            className={`w-7 h-7 rounded-full flex items-center justify-center border shrink-0 transition-all ${
                              playingOptionId === 'B'
                                ? 'bg-teal-600 text-white border-teal-500 shadow-sm'
                                : 'bg-white text-slate-600 hover:text-slate-900 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {playingOptionId === 'B' ? (
                              <Pause className="w-3 h-3 fill-current" />
                            ) : (
                              <Play className="w-3 h-3 fill-current ml-0.5" />
                            )}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-bold text-slate-700 truncate">
                              {pendingVoiceOptions.optionB.voiceLabel}
                            </div>
                            <div className="text-[9px] text-slate-400 truncate">
                              情绪：{pendingVoiceOptions.optionB.emotionLabel} · 语速 {pendingVoiceOptions.optionB.speed}x
                            </div>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSaveSingleOption('B')}
                        className="w-full py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer shadow-sm mt-2"
                      >
                        <Check className="w-3 h-3 stroke-[2.5]" />
                        <span>仅保留此版本 (B)</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* TWO OPTIONS ACTION BAR */}
                <div className="flex items-center gap-2 pt-2 border-t border-emerald-500/10">
                  <button
                    type="button"
                    onClick={handleSaveBothOptions}
                    className="flex-1 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-[10px] font-black rounded-lg transition-all flex items-center justify-center gap-1 shadow-sm cursor-pointer"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>两个版本都保留</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscardOptions}
                    className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-0.5 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>全部放弃</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Player preview columns */}
        <div className="lg:col-span-5 space-y-5">
          {/* Main active preview player */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">配音预览与回放控制</h3>
            
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
            ) : standaloneVoiceAudioUrl ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 blur-xl pointer-events-none" />
                <audio 
                  ref={standaloneVoiceAudioRef} 
                  src={standaloneVoiceAudioUrl} 
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />

                <div className="flex items-center gap-4">
                  <button
                    onClick={toggleMainPlay}
                    className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                      isPlaying 
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-500/20' 
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 hover:text-slate-950'
                    }`}
                  >
                    {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 truncate">AI 独立人设配音</p>
                    <p className="text-[10px] text-slate-500 truncate italic mt-0.5">"{standaloneVoicePrompt}"</p>
                    <span className="text-[9px] text-emerald-600 font-semibold mt-1 block">
                      属性：{standaloneVoiceGender === 'male' ? '男声' : '女声'} · {(() => {
                        const bracketRegex = /[\[［]([^\]］]+)[\]］]/g;
                        const matches = [...standaloneVoicePrompt.matchAll(bracketRegex)];
                        return matches.length > 0 ? matches.map(m => m[1]).join(', ') : '默认情绪';
                      })()} · {standaloneVoiceLang.toUpperCase()}语种
                    </span>
                  </div>

                  <button
                    onClick={() => {
                      if (standaloneVoiceAudioUrl) URL.revokeObjectURL(standaloneVoiceAudioUrl);
                      setStandaloneVoiceAudioUrl(null);
                      setIsPlaying(false);
                    }}
                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                    title="清除"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Simulated waveforms */}
                <div className="flex items-end justify-between h-8 bg-slate-200/50 p-2 rounded-lg gap-0.5 border border-slate-200">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <span 
                      key={i} 
                      className="bg-emerald-500 rounded-t w-1"
                      style={{ 
                        height: isPlaying ? `${Math.floor(Math.random() * 95) + 5}%` : '15%',
                        transition: 'height 0.12s ease-in-out'
                      }} 
                    />
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <a
                    href={standaloneVoiceAudioUrl}
                    download="generated_voiceover.mp3"
                    className="w-full bg-white hover:bg-emerald-50 border border-slate-200 text-slate-700 hover:text-emerald-700 py-2 rounded-xl text-[10px] font-bold text-center transition-all flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>下载 MP3 配音</span>
                  </a>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-slate-200 bg-slate-50 rounded-xl p-10 text-center text-slate-400 text-xs leading-relaxed">
                <Mic className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <span>输入台词，指定人设调校偏好，点击立刻渲染高品质配音音轨。</span>
              </div>
            )}
          </div>

          {/* Voice History Tracks */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
              <span>已归档配音 ({voiceHistory.length})</span>
              <span className="text-[10px] text-slate-400 font-normal">本会话</span>
            </h3>

            {voiceHistory.length === 0 ? (
              <p className="text-slate-400 text-[10px] text-center py-6">暂无历史配音。配音渲染成功后，将在此自动归档。</p>
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
                        <a
                          href={item.url}
                          download={`${item.id}.mp3`}
                          className="p-1 hover:bg-emerald-50 hover:text-emerald-700 text-slate-400 rounded transition-colors"
                          title="下载"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
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
  );
}
