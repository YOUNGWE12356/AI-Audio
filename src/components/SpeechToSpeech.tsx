/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Download, 
  X, 
  AlertCircle,
  Sparkles,
  Volume2,
  Mic,
  Search,
  ChevronDown,
  UploadCloud,
  FileAudio,
  Loader2,
  Pencil,
  Check
} from 'lucide-react';
import { HistoryItem } from '../types';
import { VoiceItem } from '../data/voices';
import { generateSpeechToSpeech } from '../services/elevenLabsService';
import { downloadAudioHelper } from '../utils/downloadHelper';

interface SpeechToSpeechProps {
  historyList: HistoryItem[];
  setHistoryList: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
  displayVoices: VoiceItem[];
  playingVoiceId: string | null;
  handlePlayVoicePreview: (voiceId: string, url: string, e: React.MouseEvent) => void;
  onAudioPlay: () => void;
}

export default function SpeechToSpeech({
  historyList,
  setHistoryList,
  displayVoices,
  playingVoiceId,
  handlePlayVoicePreview,
  onAudioPlay
}: SpeechToSpeechProps) {
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

  // History play states in sub-component
  const [playingHistoryId, setPlayingHistoryId] = useState<string | null>(null);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const historyAudioRefs = useRef<{ [key: string]: HTMLAudioElement | null }>({});

  useEffect(() => {
    return () => {
      if (stsFileUrl) URL.revokeObjectURL(stsFileUrl);
      if (stsAudioUrl) URL.revokeObjectURL(stsAudioUrl);
    };
  }, [stsFileUrl, stsAudioUrl]);

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
    setStsAudioUrl(null);
  };

  const toggleStsInputPlay = () => {
    if (stsInputAudioRef.current) {
      if (stsInputIsPlaying) {
        stsInputAudioRef.current.pause();
        setStsInputIsPlaying(false);
      } else {
        // Pause other active playbacks
        onAudioPlay();
        if (stsAudioRef.current) {
          stsAudioRef.current.pause();
          setStsIsPlaying(false);
        }
        if (playingHistoryId && historyAudioRefs.current[playingHistoryId]) {
          historyAudioRefs.current[playingHistoryId]?.pause();
          setPlayingHistoryId(null);
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
        prompt: `源音频：${stsFile.name} ➡️ 变声目标：${voiceLabel}`,
        url: url,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
        details: `${(stsFile.size / 1024 / 1024).toFixed(2)}MB · ${stsVoiceGender === 'male' ? '男声' : '女声'}`,
        speed: 1.0
      };
      setHistoryList(prev => [newHistoryItem, ...prev]);

      // Auto play the converted audio to give instant feedback
      setTimeout(() => {
        if (stsAudioRef.current) {
          onAudioPlay();
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

  const handleHistoryPlayPause = (id: string) => {
    if (stsInputIsPlaying && stsInputAudioRef.current) {
      stsInputAudioRef.current.pause();
      setStsInputIsPlaying(false);
    }
    if (stsIsPlaying && stsAudioRef.current) {
      stsAudioRef.current.pause();
      setStsIsPlaying(false);
    }
    onAudioPlay(); // stops parent TTS audio

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
    setHistoryList(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, title: editingTitle.trim() };
      }
      return item;
    }));
    setEditingHistoryId(null);
  };

  const voiceHistory = historyList.filter(item => item.type === 'voice');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fade-in">
      {/* Left Column: Input Panel */}
      <div className="lg:col-span-7 space-y-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
          {/* Section title */}
          <div>
            <h3 className="text-sm font-bold text-slate-800">语音转语音 (Speech-to-Speech)</h3>
            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              ElevenLabs 变声器。上传一段语音或视频文件，选择声音库里的目标声线，即可一键将您的语气、情感与节奏完美移植到新声线上。
            </p>
          </div>

          {/* Upload Area */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 block uppercase tracking-wider">上传源音频文件</label>
            <div
              onDragEnter={handleStsDrag}
              onDragOver={handleStsDrag}
              onDragLeave={handleStsDrag}
              onDrop={handleStsDrop}
              onClick={() => stsInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all ${
                stsDragActive
                  ? 'border-emerald-500 bg-emerald-50/50 scale-[0.99]'
                  : stsFile
                  ? 'border-slate-250 bg-slate-50/20 hover:bg-slate-50/60'
                  : 'border-slate-200 hover:border-emerald-400 hover:bg-slate-50'
              }`}
              style={{ minHeight: '140px' }}
            >
              <input
                ref={stsInputRef}
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleStsFileChange(e.target.files[0]);
                  }
                }}
                className="hidden"
              />

              {stsFile ? (
                <div className="text-center space-y-3 w-full" onClick={(e) => e.stopPropagation()}>
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto text-emerald-600 shadow-sm">
                    <FileAudio className="w-6 h-6 animate-pulse" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-700 truncate max-w-md mx-auto">{stsFile.name}</p>
                    <p className="text-[10px] text-slate-400">{(stsFile.size / 1024 / 1024).toFixed(2)} MB · {stsFile.type || '音频文件'}</p>
                  </div>
                  
                  {/* Local preview player */}
                  {stsFileUrl && (
                    <div className="bg-slate-50 border border-slate-150 rounded-xl p-2.5 max-w-xs mx-auto flex items-center justify-between gap-3">
                      <audio
                        ref={stsInputAudioRef}
                        src={stsFileUrl}
                        onPlay={() => setStsInputIsPlaying(true)}
                        onPause={() => setStsInputIsPlaying(false)}
                        onEnded={() => setStsInputIsPlaying(false)}
                      />
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={toggleStsInputPlay}
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                            stsInputIsPlaying
                              ? 'bg-emerald-600 text-white border-emerald-500'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {stsInputIsPlaying ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-0.5" />}
                        </button>
                        <span className="text-[10px] font-bold text-slate-600 truncate">试听源音频</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (stsFileUrl) URL.revokeObjectURL(stsFileUrl);
                          setStsFile(null);
                          setStsFileUrl(null);
                          setStsInputIsPlaying(false);
                        }}
                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center space-y-2">
                  <UploadCloud className="w-8 h-8 text-slate-400 mx-auto" />
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-slate-700">拖拽源音频文件到此处，或点击上传</p>
                    <p className="text-[10px] text-slate-400">支持 MP3、WAV、M4A、AAC 等常见音频格式</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Target Voice Selection */}
          <div className="space-y-3">
            <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>选择变声目标声线 (精品人声库)</span>
              </span>
              <span className="text-[10px] text-slate-450 font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">ElevenLabs 变声引擎</span>
            </label>

            <div className="space-y-3 relative">
              {(() => {
                const selectedVoiceObj = displayVoices.find(v => v.id === stsVoiceRole);
                return (
                  <>
                    <button
                      type="button"
                      onClick={() => setStsShowVoiceDropdown(!stsShowVoiceDropdown)}
                      className="w-full bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-xl py-3 px-4 text-xs text-left text-slate-800 focus:outline-none transition-all flex items-center justify-between cursor-pointer shadow-sm"
                    >
                      {selectedVoiceObj ? (
                        <div className="flex items-center gap-2.5">
                          <span className={`w-2 h-2 rounded-full ${selectedVoiceObj.gender === 'male' ? 'bg-blue-500' : 'bg-pink-500'}`} />
                          <div>
                            <span className="font-bold text-slate-850">目标：{selectedVoiceObj.name}</span>
                            <span className="text-[10px] text-slate-500 bg-slate-150 border border-slate-200 px-1.5 py-0.5 rounded ml-2 font-bold">
                              {selectedVoiceObj.category}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">请选择精品目标声线...</span>
                      )}
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${stsShowVoiceDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Dropdown Popover */}
                    {stsShowVoiceDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 space-y-3">
                        <div className="relative">
                          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                          <input
                            type="text"
                            value={stsVoiceSearchQuery}
                            onChange={(e) => setStsVoiceSearchQuery(e.target.value)}
                            placeholder="搜索声线名称、分类、标签或音色特点..."
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-8 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all placeholder-slate-400"
                          />
                          {stsVoiceSearchQuery && (
                            <button
                              type="button"
                              onClick={() => setStsVoiceSearchQuery('')}
                              className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Gender filter */}
                        <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
                          <span className="text-[9px] font-bold text-slate-400 uppercase mr-1">声弹性别:</span>
                          <button
                            type="button"
                            onClick={() => setStsVoiceGenderFilter('all')}
                            className={`text-[9px] px-2.5 py-0.5 rounded font-bold transition-all ${
                              stsVoiceGenderFilter === 'all'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                            }`}
                          >
                            全部
                          </button>
                          <button
                            type="button"
                            onClick={() => setStsVoiceGenderFilter('male')}
                            className={`text-[9px] px-2.5 py-0.5 rounded font-bold transition-all ${
                              stsVoiceGenderFilter === 'male'
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                            }`}
                          >
                            男声
                          </button>
                          <button
                            type="button"
                            onClick={() => setStsVoiceGenderFilter('female')}
                            className={`text-[9px] px-2.5 py-0.5 rounded font-bold transition-all ${
                              stsVoiceGenderFilter === 'female'
                                ? 'bg-pink-600 text-white'
                                : 'bg-slate-50 hover:bg-slate-100 text-slate-600'
                            }`}
                          >
                            女声
                          </button>
                        </div>

                        {/* Category filter */}
                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                          {['全部', 'ElevenLabs 人声库', '我的克隆'].map(cat => {
                            if (cat === '我的克隆' && !displayVoices.some(v => v.category === '我的克隆')) {
                              return null;
                            }
                            return (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => setStsVoiceActiveCategory(cat)}
                                className={`text-[9px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap transition-all shrink-0 ${
                                  stsVoiceActiveCategory === cat
                                    ? 'bg-emerald-50 border-emerald-500/40 text-emerald-800 font-black'
                                    : 'bg-white border-slate-200 hover:border-slate-300 text-slate-600'
                                }`}
                              >
                                {cat}
                              </button>
                            );
                          })}
                        </div>

                        {/* List */}
                        <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 custom-scrollbar pr-1">
                          {(() => {
                            const filtered = displayVoices.filter(voice => {
                              if (stsVoiceActiveCategory !== '全部' && voice.category !== stsVoiceActiveCategory) return false;
                              if (stsVoiceGenderFilter !== 'all' && voice.gender !== stsVoiceGenderFilter) return false;
                              if (stsVoiceSearchQuery.trim()) {
                                const q = stsVoiceSearchQuery.toLowerCase();
                                return voice.name.toLowerCase().includes(q) ||
                                       voice.englishName.toLowerCase().includes(q) ||
                                       voice.category.toLowerCase().includes(q) ||
                                       voice.description.toLowerCase().includes(q) ||
                                       voice.tags.some(t => t.toLowerCase().includes(q));
                              }
                              return true;
                            });

                            if (filtered.length === 0) {
                              return (
                                <div className="py-8 text-center text-slate-400 text-xs">
                                  未找到匹配的声线
                                </div>
                              );
                            }

                            return filtered.map(voice => {
                              const isSelected = stsVoiceRole === voice.id;
                              return (
                                <div
                                  key={voice.id}
                                  onClick={() => {
                                    setStsVoiceRole(voice.id);
                                    setStsVoiceGender(voice.gender);
                                    setStsShowVoiceDropdown(false);
                                  }}
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
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => handlePlayVoicePreview(voice.id, voice.previewUrl || '', e)}
                                    className={`w-5.5 h-5.5 rounded-full flex items-center justify-center border shrink-0 transition-colors ${
                                      playingVoiceId === voice.id
                                        ? 'bg-emerald-600 border-emerald-500 text-white'
                                        : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-700'
                                    }`}
                                  >
                                    {playingVoiceId === voice.id ? <Pause className="w-2.5 h-2.5 fill-current" /> : <Play className="w-2.5 h-2.5 fill-current ml-0.2" />}
                                  </button>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Selected detailed info card */}
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
                                {selectedVoiceObj.gender === 'male' ? '男声' : '女声'}
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

          {/* Error panel */}
          {stsError && (
            <div className="bg-red-50 border border-red-200 text-red-600 p-3.5 rounded-xl text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{stsError}</span>
            </div>
          )}

          {/* Trigger button */}
          <button
            onClick={handleStsGenerate}
            disabled={stsLoading || !stsFile || !stsVoiceRole}
            className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3.5 rounded-xl text-xs tracking-wider uppercase transition-all shadow-md shadow-emerald-600/10 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {stsLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>ElevenLabs 变声引擎正在全力解析转换中...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>合成并转换音色</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Right Column: Player & History Panel */}
      <div className="lg:col-span-5 space-y-5">
        {/* Playback card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">变声结果预览与回放控制</h3>

          {stsLoading ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-12 h-12 bg-emerald-50 border border-emerald-200 rounded-full flex items-center justify-center animate-spin">
                <Mic className="w-5 h-5 text-emerald-600 animate-pulse" />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-slate-700">正在生成变声作品...</p>
                <p className="text-[10px] text-slate-400">大约需要 5 - 10 秒</p>
              </div>
            </div>
          ) : stsAudioUrl ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 blur-xl pointer-events-none" />
              <audio
                ref={stsAudioRef}
                src={stsAudioUrl}
                onPlay={() => setStsIsPlaying(true)}
                onPause={() => setStsIsPlaying(false)}
                onEnded={() => setStsIsPlaying(false)}
              />

              <div className="flex items-center gap-4">
                <button
                  onClick={() => {
                    if (stsAudioRef.current) {
                      if (stsIsPlaying) {
                        stsAudioRef.current.pause();
                        setStsIsPlaying(false);
                      } else {
                        onAudioPlay();
                        if (stsInputAudioRef.current) {
                          stsInputAudioRef.current.pause();
                          setStsInputIsPlaying(false);
                        }
                        if (playingHistoryId && historyAudioRefs.current[playingHistoryId]) {
                          historyAudioRefs.current[playingHistoryId]?.pause();
                          setPlayingHistoryId(null);
                        }
                        stsAudioRef.current.play().catch(e => console.error(e));
                        setStsIsPlaying(true);
                      }
                    }
                  }}
                  className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                    stsIsPlaying
                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-500/20'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 hover:text-slate-950'
                  }`}
                >
                  {stsIsPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                </button>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-800 truncate">AI 语音变声转换后</p>
                  <p className="text-[10px] text-slate-500 truncate italic mt-0.5">源音频: "{stsFile?.name}"</p>
                  <span className="text-[9px] text-emerald-600 font-semibold mt-1 block">
                    音色：{stsVoiceGender === 'male' ? '男声' : '女声'} · {(() => {
                      const matched = displayVoices.find(v => v.id === stsVoiceRole);
                      return matched ? matched.name : '经典声线';
                    })()}
                  </span>
                </div>

                <button
                  onClick={() => {
                    if (stsAudioUrl) URL.revokeObjectURL(stsAudioUrl);
                    setStsAudioUrl(null);
                    setStsIsPlaying(false);
                  }}
                  className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                  title="清除"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Waveform visual simulator */}
              <div className="flex items-end justify-between h-8 bg-slate-200/50 p-2 rounded-lg gap-0.5 border border-slate-200">
                {Array.from({ length: 24 }).map((_, i) => (
                  <span
                    key={i}
                    className="bg-emerald-500 rounded-t w-1"
                    style={{
                      height: stsIsPlaying ? `${Math.floor(Math.random() * 95) + 5}%` : '15%',
                      transition: 'height 0.12s ease-in-out'
                    }}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => stsAudioUrl && downloadAudioHelper(stsAudioUrl, `converted_${stsVoiceRole}.mp3`)}
                  className="w-full bg-white hover:bg-emerald-50 border border-slate-200 text-slate-700 hover:text-emerald-700 py-2 rounded-xl text-[10px] font-bold text-center transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下载 MP3 变声文件</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="border border-dashed border-slate-200 bg-slate-50 rounded-xl p-10 text-center text-slate-400 text-xs leading-relaxed">
              <Mic className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <span>上传本地人声源文件，并指定变声目标，点击立刻生成移植音色后的声音。</span>
            </div>
          )}
        </div>

        {/* Saved archive history */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
            <span>已归档配音与变声 ({voiceHistory.length})</span>
            <span className="text-[10px] text-slate-400 font-normal">本会话</span>
          </h3>

          {voiceHistory.length === 0 ? (
            <p className="text-slate-400 text-[10px] text-center py-6">暂无历史记录。渲染成功后，将在此自动归档。</p>
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
  );
}
