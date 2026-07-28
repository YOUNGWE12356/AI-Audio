/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { 
  Music, 
  Loader2, 
  Play, 
  Pause, 
  Download, 
  X, 
  Sliders, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  Sparkles,
  Volume2,
  Languages
} from 'lucide-react';
import { HistoryItem } from '../types';
import { generateLyricsFromMusicStyle, translateToEnglish } from '../services/geminiService';

interface MusicStudioProps {
  standaloneMusicPrompt: string;
  setStandaloneMusicPrompt: (prompt: string) => void;
  standaloneMusicDuration: number;
  setStandaloneMusicDuration: (dur: number) => void;
  standaloneMusicType: 'instrumental' | 'vocal';
  setStandaloneMusicType: (type: 'instrumental' | 'vocal') => void;
  standaloneMusicLyrics: string;
  setStandaloneMusicLyrics: (lyrics: string) => void;
  standaloneMusicLoading: boolean;
  standaloneMusicAudioUrl: string | null;
  setStandaloneMusicAudioUrl: (url: string | null) => void;
  standaloneMusicError: string | null;
  standaloneMusicAudioRef: React.RefObject<HTMLAudioElement | null>;
  handleStandaloneMusicGenerate: () => void;
  historyList: HistoryItem[];
}

export default function MusicStudio({
  standaloneMusicPrompt,
  setStandaloneMusicPrompt,
  standaloneMusicDuration,
  setStandaloneMusicDuration,
  standaloneMusicType,
  setStandaloneMusicType,
  standaloneMusicLyrics,
  setStandaloneMusicLyrics,
  standaloneMusicLoading,
  standaloneMusicAudioUrl,
  setStandaloneMusicAudioUrl,
  standaloneMusicError,
  standaloneMusicAudioRef,
  handleStandaloneMusicGenerate,
  historyList
}: MusicStudioProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingHistoryId, setPlayingHistoryId] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isGeneratingLyrics, setIsGeneratingLyrics] = useState(false);
  const [lyricsGenerationError, setLyricsGenerationError] = useState<string | null>(null);

  const handleTranslate = async () => {
    if (!standaloneMusicPrompt.trim()) return;
    setIsTranslating(true);
    try {
      const translated = await translateToEnglish(standaloneMusicPrompt);
      if (translated) {
        setStandaloneMusicPrompt(translated);
      }
    } catch (err) {
      console.error("Translation error:", err);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleGenerateLyrics = async () => {
    if (!standaloneMusicPrompt.trim()) return;
    setIsGeneratingLyrics(true);
    setLyricsGenerationError(null);
    try {
      const generatedLyrics = await generateLyricsFromMusicStyle(standaloneMusicPrompt);
      if (generatedLyrics.trim()) {
        setStandaloneMusicLyrics(generatedLyrics.trim());
      }
    } catch (err) {
      console.error("Lyrics generation error:", err);
      setLyricsGenerationError(err instanceof Error ? err.message : '歌词生成失败，请稍后重试。');
    } finally {
      setIsGeneratingLyrics(false);
    }
  };
  
  const historyAudioRefs = useRef<{ [key: string]: HTMLAudioElement | null }>({});

  const toggleMainPlay = () => {
    if (standaloneMusicAudioRef.current) {
      if (isPlaying) {
        standaloneMusicAudioRef.current.pause();
        setIsPlaying(false);
      } else {
        // Stop any history playback
        if (playingHistoryId && historyAudioRefs.current[playingHistoryId]) {
          historyAudioRefs.current[playingHistoryId]?.pause();
          setPlayingHistoryId(null);
        }
        standaloneMusicAudioRef.current.play().catch(e => console.error(e));
        setIsPlaying(true);
      }
    }
  };

  const handleHistoryPlayPause = (id: string) => {
    if (isPlaying && standaloneMusicAudioRef.current) {
      standaloneMusicAudioRef.current.pause();
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
        audioObj.play().catch(e => console.error(e));
        setPlayingHistoryId(id);
      }
    }
  };

  const musicPrompts = [
    { label: '史诗级科幻交响', prompt: 'epic orchestral sci-fi cinematic theme, space organ, brass highlights, powerful dynamic build-up' },
    { label: '赛博朋克重型电子', prompt: 'heavy industrial dark techno, cyberpunk combat synthwave, distorted bassline, aggressive beats' },
    { label: '治愈系原声吉他', prompt: 'warm fingerstyle acoustic folk guitar, serene campfire mood, soft mellow pad background, gentle pacing' },
    { label: '低保真复古休闲 Lofi', prompt: 'cozy nostalgic lofi hip-hop beat, dusty vinyl crackle, warm rhodes piano chords, chilled sax melody' },
    { label: '国风水墨新民乐', prompt: 'modern oriental guzheng and bamboo flute fusion, cinematic epic cinematic build, light cinematic beats' },
  ];

  const musicHistory = historyList.filter(item => item.type === 'music');

  return (
    <div id="musicstudio-view" className="flex-1 p-6 space-y-6 max-w-6xl mx-auto w-full">
      {/* Workspace Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">AI Composition Workshop</span>
          </div>
          <h2 className="text-xl font-black text-slate-800 mt-1">AI 音乐</h2>
          <p className="text-xs text-slate-500 mt-1">输入情绪与配乐风格关键词，一键生成契合度极高的背景音乐 Demo。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Generator Controls */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
            {/* Textarea description */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 block uppercase tracking-wider">配乐风格与情感描述</label>
                <button
                  type="button"
                  onClick={handleTranslate}
                  disabled={isTranslating || !standaloneMusicPrompt.trim()}
                  className="text-[10px] text-emerald-600 hover:text-emerald-700 disabled:text-slate-400 font-bold flex items-center gap-1.5 transition-all bg-emerald-50 hover:bg-emerald-100 disabled:bg-slate-50 px-2.5 py-1 rounded-lg border border-emerald-200/50 disabled:border-slate-200 cursor-pointer"
                >
                  {isTranslating ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                      <span>正在翻译...</span>
                    </>
                  ) : (
                    <>
                      <Languages className="w-3 h-3 text-emerald-600" />
                      <span>翻译为英文</span>
                    </>
                  )}
                </button>
              </div>
              <textarea
                value={standaloneMusicPrompt}
                onChange={(e) => setStandaloneMusicPrompt(e.target.value)}
                placeholder="例如：温馨悠扬的木吉他，伴随轻缓的钢琴和微风声，适合温馨生活日常 VLOG..."
                className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all resize-none placeholder-slate-400"
              />
            </div>

            {/* Quick Prompts Tags */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-450 uppercase">点击载入灵感预设：</span>
              <div className="flex flex-wrap gap-2">
                {musicPrompts.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setStandaloneMusicPrompt(item.prompt)}
                    className="text-[10px] bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 text-slate-600 hover:text-emerald-700 px-3 py-1.5 rounded-xl transition-all font-semibold"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration Slider & Type Toggles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
              {/* Duration range */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>期望生成时长 (Suno 限制)</span>
                  <span className="text-emerald-600 font-mono">{standaloneMusicDuration}秒</span>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="10"
                    max="60"
                    step="5"
                    value={standaloneMusicDuration}
                    onChange={(e) => setStandaloneMusicDuration(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                  />
                </div>
                <span className="text-[9px] text-slate-400 block">生成时长介于 10s - 60s 最佳，ElevenLabs 会智能切片。</span>
              </div>

              {/* Toggle instrumental/vocal */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 block">有无人声偏好</label>
                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setStandaloneMusicType('instrumental')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                      standaloneMusicType === 'instrumental'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    纯音乐 Demo
                  </button>
                  <button
                    type="button"
                    onClick={() => setStandaloneMusicType('vocal')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                      standaloneMusicType === 'vocal'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    歌词
                  </button>
                </div>
              </div>
            </div>

            {/* Lyrics Input Box - Shows when "vocal" is selected */}
            {standaloneMusicType === 'vocal' && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-bold text-slate-700 block uppercase tracking-wider">
                    输入背景歌词
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateLyrics}
                    disabled={isGeneratingLyrics || !standaloneMusicPrompt.trim()}
                    className="text-[10px] text-emerald-600 hover:text-emerald-700 disabled:text-slate-400 font-bold flex items-center gap-1.5 transition-all bg-emerald-50 hover:bg-emerald-100 disabled:bg-slate-50 px-2.5 py-1 rounded-lg border border-emerald-200/50 disabled:border-slate-200 cursor-pointer"
                    title={!standaloneMusicPrompt.trim() ? '请先输入配乐风格与情感描述' : '根据当前风格描述生成歌词'}
                  >
                    {isGeneratingLyrics ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                        <span>生成中...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 text-emerald-600" />
                        <span>根据风格生成歌词</span>
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  value={standaloneMusicLyrics}
                  onChange={(e) => setStandaloneMusicLyrics(e.target.value)}
                  placeholder="请输入您希望 AI 歌唱的歌词文本（例如：[Verse] 在深夜的街头... [Chorus] 奔跑吧，迎着风...）"
                  className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all resize-none placeholder-slate-400"
                />
                <p className="text-[10px] text-slate-400 italic">
                  支持使用 [Verse] 或 [Chorus] 等标签来标注结构，生成效果更佳。
                </p>
                {lyricsGenerationError && (
                  <p className="text-[10px] text-red-500 flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{lyricsGenerationError}</span>
                  </p>
                )}
              </div>
            )}

            {/* Error logs */}
            {standaloneMusicError && (
              <div className="bg-red-50 border border-red-200 text-red-600 p-3.5 rounded-xl text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{standaloneMusicError}</span>
              </div>
            )}

            {/* Generate Button */}
            <button
              onClick={handleStandaloneMusicGenerate}
              disabled={standaloneMusicLoading || !standaloneMusicPrompt.trim()}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3.5 rounded-xl text-xs tracking-wider uppercase transition-all shadow-md shadow-emerald-600/10 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {standaloneMusicLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>AI 音频大模型 正在演奏中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>生成背景音乐 Demo</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Output Player Canvas & History */}
        <div className="lg:col-span-5 space-y-5">
          {/* Main Active Player Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">当前音乐预览播放器</h3>
            
            {standaloneMusicLoading ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-3">
                <div className="w-12 h-12 bg-emerald-50 border border-emerald-200 rounded-full flex items-center justify-center animate-spin">
                  <Music className="w-5 h-5 text-emerald-600 animate-pulse" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-slate-700">正在谱写曲调...</p>
                  <p className="text-[10px] text-slate-400">大约需要 10 - 20 秒，视时长而定</p>
                </div>
              </div>
            ) : standaloneMusicAudioUrl ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 blur-xl pointer-events-none" />
                <audio 
                  ref={standaloneMusicAudioRef} 
                  src={standaloneMusicAudioUrl} 
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />

                <div className="flex items-center gap-4">
                  {/* Cassette visualization */}
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
                    <p className="text-xs font-bold text-slate-800 truncate">AI 独立音乐作品</p>
                    <p className="text-[10px] text-slate-500 truncate italic mt-0.5">"{standaloneMusicPrompt}"</p>
                    <span className="text-[9px] text-emerald-600 font-semibold mt-1 block">时长：{standaloneMusicDuration}秒 · {standaloneMusicType === 'instrumental' ? '纯伴奏' : '歌词人声'}</span>
                  </div>

                  <button
                    onClick={() => {
                      if (standaloneMusicAudioUrl) URL.revokeObjectURL(standaloneMusicAudioUrl);
                      setStandaloneMusicAudioUrl(null);
                      setIsPlaying(false);
                    }}
                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                    title="移除"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Simulated waveforms using CSS bars */}
                <div className="flex items-end justify-between h-8 bg-slate-200/50 p-2 rounded-lg gap-0.5 border border-slate-200">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <span 
                      key={i} 
                      className="bg-emerald-500 rounded-t w-1"
                      style={{ 
                        height: isPlaying ? `${Math.floor(Math.random() * 95) + 5}%` : '20%',
                        transition: 'height 0.15s ease-in-out'
                      }} 
                    />
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <a
                    href={standaloneMusicAudioUrl}
                    download="generated_music.mp3"
                    className="w-full bg-white hover:bg-emerald-50 border border-slate-200 text-slate-700 hover:text-emerald-700 py-2 rounded-xl text-[10px] font-bold text-center transition-all flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>下载 MP3 音乐</span>
                  </a>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-slate-200 bg-slate-50 rounded-xl p-10 text-center text-slate-400 text-xs leading-relaxed">
                <Music className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <span>输入配景灵感并点击生成。在这里你可以直接控制音量、播放试听和下载。</span>
              </div>
            )}
          </div>

          {/* History tracks */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
              <span>已保存的音乐 ({musicHistory.length})</span>
              <span className="text-[10px] text-slate-400 font-normal">本会话</span>
            </h3>

            {musicHistory.length === 0 ? (
              <p className="text-slate-400 text-[10px] text-center py-6">暂无历史音乐。每次生成成功的音乐都将自动归档到此处。</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                {musicHistory.map((item) => {
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
                              : 'bg-white text-slate-500 border-slate-200 hover:text-slate-900 hover:bg-slate-50'
                          }`}
                        >
                          {isHistPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                        </button>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-700 truncate text-[11px]">{item.title}</p>
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
