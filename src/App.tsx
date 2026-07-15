/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { analyzeAudioDesign, AudioDesignResult, regenerateLyrics, translateToEnglish } from './services/geminiService';
import { generateSoundEffect, generateMusic, generateVoice } from './services/elevenLabsService';
import { FileItem, HistoryItem, TabType } from './types';
import { ELEVENLABS_VOICES } from './data/voices';

// Modular Components
import Sidebar from './components/Sidebar';
import Workbench from './components/Workbench';
import AudioDirector from './components/AudioDirector';
import MusicStudio from './components/MusicStudio';
import SfxStudio from './components/SfxStudio';
import DubbingStudio from './components/DubbingStudio';
import AudioTools from './components/AudioTools';
import SettingsComponent from './components/Settings';
import SfxLibrary from './components/SfxLibrary';
import SfxRequirements from './components/SfxRequirements';

export default function App() {
  const [currentTab, setCurrentTab] = useState<TabType>('workbench');
  
  // API key states & dynamic check
  const [hasGeminiKey, setHasGeminiKey] = useState(() => 
    Boolean(process.env.GEMINI_API_KEY || (typeof window !== 'undefined' && localStorage.getItem('GEMINI_API_KEY')))
  );
  const [hasElevenLabsKey, setHasElevenLabsKey] = useState(() => 
    Boolean(process.env.ELEVENLABS_API_KEY || (typeof window !== 'undefined' && localStorage.getItem('ELEVENLABS_API_KEY')))
  );

  const handleKeysUpdated = () => {
    setHasGeminiKey(Boolean(process.env.GEMINI_API_KEY || (typeof window !== 'undefined' && localStorage.getItem('GEMINI_API_KEY'))));
    setHasElevenLabsKey(Boolean(process.env.ELEVENLABS_API_KEY || (typeof window !== 'undefined' && localStorage.getItem('ELEVENLABS_API_KEY'))));
  };

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
      title: '角色配音 - Rachel (知性御姐)',
      prompt: '欢迎来到AI多模态音频创作中心。在这里，我们将文字、画面与声音完美融合，创造前所未有的视听享受。',
      url: 'https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg',
      timestamp: '2026-07-08 00:28',
      details: '12秒 · 平静自然'
    }
  ]);

  // Audio Director States
  const [files, setFiles] = useState<FileItem[]>([]);
  const [requirements, setRequirements] = useState('');
  const [target, setTarget] = useState({ game: true, video: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AudioDesignResult | null>(null);
  const [activeTab, setActiveTab] = useState<'sfx' | 'bgm'>('sfx');
  const [selectedLyrics, setSelectedLyrics] = useState<{ sectionIndex: number; text: string } | null>(null);
  const [lyricEditDirection, setLyricEditDirection] = useState('');
  const [editingLyrics, setEditingLyrics] = useState(false);
  const [isInstrumental, setIsInstrumental] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Standalone SFX Generator States
  const [standalonePrompt, setStandalonePrompt] = useState('');
  const [standaloneDuration, setStandaloneDuration] = useState(5);
  const [standaloneLoading, setStandaloneLoading] = useState(false);
  const [standaloneAudioUrl, setStandaloneAudioUrl] = useState<string | null>(null);
  const [standaloneError, setStandaloneError] = useState<string | null>(null);
  const standaloneAudioRef = useRef<HTMLAudioElement | null>(null);

  // Standalone Music Generator States
  const [standaloneMusicPrompt, setStandaloneMusicPrompt] = useState('');
  const [standaloneMusicDuration, setStandaloneMusicDuration] = useState(30);
  const [standaloneMusicType, setStandaloneMusicType] = useState<'instrumental' | 'vocal'>('instrumental');
  const [standaloneMusicLyrics, setStandaloneMusicLyrics] = useState('');
  const [standaloneMusicLoading, setStandaloneMusicLoading] = useState(false);
  const [standaloneMusicAudioUrl, setStandaloneMusicAudioUrl] = useState<string | null>(null);
  const [standaloneMusicError, setStandaloneMusicError] = useState<string | null>(null);
  const standaloneMusicAudioRef = useRef<HTMLAudioElement | null>(null);

  // Standalone Voiceover Generator States
  const [standaloneVoiceText, setStandaloneVoiceText] = useState('');
  const [standaloneVoiceGender, setStandaloneVoiceGender] = useState<'male' | 'female'>('female');
  const [standaloneVoiceRole, setStandaloneVoiceRole] = useState('21m00Tcm4TlvDq8ikWAM'); 
  const [standaloneVoiceEmotion, setStandaloneVoiceEmotion] = useState('');
  const [standaloneVoiceLang, setStandaloneVoiceLang] = useState('zh');
  const [standaloneVoiceSpeed, setStandaloneVoiceSpeed] = useState<number>(1.0);
  const [standaloneVoiceLoading, setStandaloneVoiceLoading] = useState(false);
  const [standaloneVoiceAudioUrl, setStandaloneVoiceAudioUrl] = useState<string | null>(null);
  const [standaloneVoiceError, setStandaloneVoiceError] = useState<string | null>(null);
  const standaloneVoiceAudioRef = useRef<HTMLAudioElement | null>(null);

  // Two alternatives state for standalone voiceover generation
  const [pendingVoiceOptions, setPendingVoiceOptions] = useState<{
    optionA: { url: string; voiceLabel: string; emotionLabel: string; processedText: string; timestamp: string; details: string; speed: number } | null;
    optionB: { url: string; voiceLabel: string; emotionLabel: string; processedText: string; timestamp: string; details: string; speed: number } | null;
  }>({ optionA: null, optionB: null });

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      files.forEach(f => URL.revokeObjectURL(f.preview));
      if (standaloneAudioUrl) URL.revokeObjectURL(standaloneAudioUrl);
      if (standaloneMusicAudioUrl) URL.revokeObjectURL(standaloneMusicAudioUrl);
      if (standaloneVoiceAudioUrl) URL.revokeObjectURL(standaloneVoiceAudioUrl);
      if (pendingVoiceOptions.optionA) URL.revokeObjectURL(pendingVoiceOptions.optionA.url);
      if (pendingVoiceOptions.optionB) URL.revokeObjectURL(pendingVoiceOptions.optionB.url);
    };
  }, [files, standaloneAudioUrl, standaloneMusicAudioUrl, standaloneVoiceAudioUrl, pendingVoiceOptions]);

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

      // Strip all bracketed expressions completely from the text sent to ElevenLabs to prevent them from being spoken aloud!
      // The spoken text should ONLY contain the plain dialogue content.
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
      } else if (/男|male|man|sir|boy|uncle|大叔|老头|绅士|爷爷|爸爸|Josh|Adam|Arnold/i.test(standaloneVoiceRole)) {
        detectedGender = 'male';
      } else if (/女|female|woman|lady|girl|princess|公主|御姐|loli|萝莉|Rachel|Glinda|Domi/i.test(standaloneVoiceRole)) {
        detectedGender = 'female';
      } else {
        detectedGender = standaloneVoiceGender || 'female';
      }
      setStandaloneVoiceGender(detectedGender);

      // Intelligent parsing for unified emotions
      const rawEmoDesc = bracketMatches.map(m => m[1].trim()).filter(Boolean).join(', ');
      
      // 语调控制已去除，不再根据情绪标签动态调整配音稳定性、相似度或语气风格，以保持发音的自然与平顺。
      const stability = 0.50;
      const similarity = 0.75;
      const styleExaggeration = 0.0;

      // Intelligent fallback parsing for custom voice descriptions
      const voiceDesc = englishRole;
      let voiceId = detectedGender === 'male' ? 'pNInz6obpg7IdgWAs6g8' : '21m00Tcm4TlvDq8ikWAM'; // Default Adam / Rachel

      // Check if voiceDesc matches any predefined ELEVENLABS_VOICES ID or is a direct 20-character ID
      const directVoiceMatch = ELEVENLABS_VOICES.find(v => v.id === voiceDesc);
      if (directVoiceMatch) {
        voiceId = directVoiceMatch.id;
      } else if (/^[a-zA-Z0-9_]{20}$/.test(voiceDesc)) {
        voiceId = voiceDesc;
      } else {
        if (detectedGender === 'male') {
          if (/旁白|稳重|磁性|深沉|男声|默认|narrator|deep|mature|calm|voiceover|default/.test(voiceDesc)) {
            voiceId = 'pNInz6obpg7IdgWAs6g8'; // Adam
          } else if (/冒险|战士|热血|强壮|粗犷|活力|勇敢|青年|warrior|brave|adventure|excited|strong|young/.test(voiceDesc)) {
            voiceId = 'VR6A4Yft7Sg8ulqRrrWh'; // Arnold
          } else if (/智者|老人|长者|老头|沙哑|沧桑|sage|old|elder|wise|hoarse|raspy/.test(voiceDesc)) {
            voiceId = 'TxGEqn7CgACfIwFn9zCc'; // Josh
          }
        } else {
          if (/知性|温柔|御姐|老师|干练|女声|默认|intellectual|gentle|sweet|mature|default/.test(voiceDesc)) {
            voiceId = '21m00Tcm4TlvDq8ikWAM'; // Rachel
          } else if (/公主|优雅|甜美|高贵|唯美|少女|princess|elegant|noble|beautiful|young lady|girl/.test(voiceDesc)) {
            voiceId = 'z9fAnlkF97DxeAlidscJ'; // Glinda
          } else if (/二次元|动漫|可爱|萝莉|活泼|赛博|cyber|cute|anime|loli|lively|energetic/.test(voiceDesc)) {
            voiceId = 'AZnzlk1XhkZOKCF79rt9'; // Domi
          }
        }
      }

      const [blobA, blobB] = await Promise.all([
        generateVoice(
          finalSpokenText,
          voiceId,
          stability,
          similarity,
          styleExaggeration
        ),
        generateVoice(
          finalSpokenText,
          voiceId,
          stability,
          similarity,
          styleExaggeration
        )
      ]);
      const urlA = URL.createObjectURL(blobA);
      const urlB = URL.createObjectURL(blobB);
      
      // Auto-set standard URL to Option A for direct back-compatibility/default play controls if needed
      setStandaloneVoiceAudioUrl(urlA);

      const matchedVoice = ELEVENLABS_VOICES.find(v => v.id === voiceId);
      const voiceLabel = matchedVoice ? matchedVoice.name : (voiceDesc || (detectedGender === 'male' ? '自定义男声' : '自定义女声'));
      const emotionLabel = rawEmoDesc || '默认情绪';
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
      const details = `${processedText.length}字 · ${standaloneVoiceLang.toUpperCase()}语种 · 语速${standaloneVoiceSpeed}x`;

      setPendingVoiceOptions({
        optionA: {
          url: urlA,
          voiceLabel: `${voiceLabel} (版本 A)`,
          emotionLabel,
          processedText,
          timestamp,
          details,
          speed: standaloneVoiceSpeed
        },
        optionB: {
          url: urlB,
          voiceLabel: `${voiceLabel} (版本 B)`,
          emotionLabel,
          processedText,
          timestamp,
          details,
          speed: standaloneVoiceSpeed
        }
      });

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
      const blob = await generateSoundEffect(standalonePrompt.trim(), standaloneDuration);
      const url = URL.createObjectURL(blob);
      setStandaloneAudioUrl(url);

      const newHistoryItem: HistoryItem = {
        id: `sfx-${Date.now()}`,
        type: 'sfx',
        title: `独立音效 - ${standalonePrompt.trim().substring(0, 20)}${standalonePrompt.trim().length > 20 ? '...' : ''}`,
        prompt: standalonePrompt.trim(),
        url: url,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
        details: `${standaloneDuration}秒 · 电影声效`
      };
      setHistoryList(prev => [newHistoryItem, ...prev]);
      
      // Auto play
      setTimeout(() => {
        if (standaloneAudioRef.current) {
          standaloneAudioRef.current.play().catch(e => console.error(e));
        }
      }, 150);
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
    try {
      const blob = await generateMusic(
        standaloneMusicPrompt.trim(), 
        standaloneMusicDuration, 
        standaloneMusicType === 'instrumental',
        standaloneMusicLyrics.trim()
      );
      const url = URL.createObjectURL(blob);
      setStandaloneMusicAudioUrl(url);
      
      const newHistoryItem: HistoryItem = {
        id: `music-${Date.now()}`,
        type: 'music',
        title: `独立音乐 - ${standaloneMusicPrompt.trim().substring(0, 20)}${standaloneMusicPrompt.trim().length > 20 ? '...' : ''}`,
        prompt: standaloneMusicPrompt.trim(),
        url: url,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
        details: `${standaloneMusicDuration}秒 · ${standaloneMusicType === 'instrumental' ? '纯伴奏' : '歌词人声'}`
      };
      setHistoryList(prev => [newHistoryItem, ...prev]);

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
    if (files.length === 0 && !requirements.trim()) {
      setError('请至少选择上传一个创意素材文件或填写补充设计需求文本');
      return;
    }
    
    setLoading(true);
    setError(null);
    setResult(null);

    if (!hasGeminiKey) {
      setError('GEMINI_API_KEY 未配置，请前往设置页面或 Secrets 面板添加。');
      setLoading(false);
      return;
    }

    try {
      // Process files into base64 structures
      const fileData = await Promise.all(files.map(async f => {
        return new Promise<{ data: string; mimeType: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const resData = reader.result as string;
            resolve({ data: resData, mimeType: f.type });
          };
          reader.onerror = () => reject(new Error(`创意素材导入失败: ${f.file.name}`));
          reader.readAsDataURL(f.file);
        });
      }));

      // Call Gemini multimodal analyzer service
      const res = await analyzeAudioDesign(fileData, requirements, target, isInstrumental);
      
      if (!res || (!res.sfxSchemes && !res.bgmRecommendations)) {
        throw new Error('多模态解析未返回合理的音频排程推荐，请尝试修改您的输入。');
      }
      
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
      console.error('Director generation failed:', err);
      setError(err.message || '生成失败，请重新检查大模型状态。');
    } finally {
      setLoading(false);
    }
  };

  // Helper utility functions
  const copyToClipboard = (text: string, id?: string) => {
    navigator.clipboard.writeText(text);
    if (id) {
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
    <div id="app-root-container" className="flex h-screen w-full bg-slate-50 text-slate-800 overflow-hidden font-sans antialiased">
      {/* Global Sidebar Component */}
      <Sidebar currentTab={currentTab} setCurrentTab={setCurrentTab} />
      
      {/* Right Side Workspace Frame */}
      <main id="app-workspace-viewport" className="flex-1 overflow-y-auto bg-slate-50 relative custom-scrollbar">
        {currentTab === 'workbench' && (
          <Workbench 
            setCurrentTab={setCurrentTab} 
            historyList={historyList} 
            hasGeminiKey={hasGeminiKey}
            hasElevenLabsKey={hasElevenLabsKey}
          />
        )}

        {currentTab === 'audio-director' && (
          <AudioDirector
            files={files}
            setFiles={setFiles}
            requirements={requirements}
            setRequirements={setRequirements}
            target={target}
            setTarget={setTarget}
            loading={loading}
            error={error}
            setError={setError}
            result={result}
            onGenerate={onGenerate}
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
          />
        )}

        {currentTab === 'music-studio' && (
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
            standaloneMusicError={standaloneMusicError}
            standaloneMusicAudioRef={standaloneMusicAudioRef}
            handleStandaloneMusicGenerate={handleStandaloneMusicGenerate}
            historyList={historyList}
          />
        )}

        {currentTab === 'sfx-studio' && (
          <SfxStudio
            standalonePrompt={standalonePrompt}
            setStandalonePrompt={setStandalonePrompt}
            standaloneDuration={standaloneDuration}
            setStandaloneDuration={setStandaloneDuration}
            standaloneLoading={standaloneLoading}
            standaloneAudioUrl={standaloneAudioUrl}
            setStandaloneAudioUrl={setStandaloneAudioUrl}
            standaloneError={standaloneError}
            standaloneAudioRef={standaloneAudioRef}
            handleStandaloneGenerate={handleStandaloneGenerate}
            historyList={historyList}
          />
        )}

        {currentTab === 'dubbing-studio' && (
          <DubbingStudio
            standaloneVoicePrompt={standaloneVoiceText}
            setStandaloneVoicePrompt={setStandaloneVoiceText}
            standaloneVoiceGender={standaloneVoiceGender}
            setStandaloneVoiceGender={setStandaloneVoiceGender}
            standaloneVoiceRole={standaloneVoiceRole}
            setStandaloneVoiceRole={setStandaloneVoiceRole}
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
        )}

        {currentTab === 'audio-tools' && (
          <AudioTools />
        )}

        {currentTab === 'settings' && (
          <SettingsComponent 
            onKeysUpdated={handleKeysUpdated}
          />
        )}

        {currentTab === 'sfx-library' && (
          <SfxLibrary />
        )}

        {currentTab === 'sfx-requirements' && (
          <SfxRequirements 
            hasGeminiKey={hasGeminiKey}
          />
        )}
      </main>
    </div>
  );
}
