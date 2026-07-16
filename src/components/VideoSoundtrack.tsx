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
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TimelineClip } from '../types';

export default function VideoSoundtrack() {
  // Video and file states
  const [videoFile, setVideoFile] = useState<{ name: string; url: string } | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(30); // Default placeholder duration
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  
  // AI Generation configuration options
  const [bgmEnabled, setBgmEnabled] = useState<boolean>(true);
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(true);
  const [dubbingEnabled, setDubbingEnabled] = useState<boolean>(true);
  
  // AI analysis and mixing status
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isMixing, setIsMixing] = useState<boolean>(false);
  const [mixedVideoUrl, setMixedVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Timeline tracks & clips
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  
  // Mouse interaction state for dragging clips
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [dragStartX, setDragStartX] = useState<number>(0);
  const [dragStartOffset, setDragStartOffset] = useState<number>(0);

  // Refs for audio synchronization
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const audioInstancesRef = useRef<{ [clipId: string]: HTMLAudioElement }>({});

  const selectedClip = clips.find(c => c.id === selectedClipId);

  // Clean up all playing audios when component unmounts
  useEffect(() => {
    return () => {
      (Object.values(audioInstancesRef.current) as HTMLAudioElement[]).forEach(audio => {
        audio.pause();
      });
    };
  }, []);

  // Sync play/pause of audio clips with video state
  useEffect(() => {
    if (!videoRef.current) return;

    if (isPlaying) {
      clips.forEach(clip => {
        if (!clip.audioUrl) return;
        
        let audio = audioInstancesRef.current[clip.id];
        if (!audio) {
          audio = new Audio(clip.audioUrl);
          audioInstancesRef.current[clip.id] = audio;
        }
        
        audio.volume = clip.volume;
        const offset = currentTime - clip.startTime;
        
        if (offset >= 0 && offset < clip.duration) {
          // Clip should be playing
          if (audio.paused) {
            audio.currentTime = offset;
            audio.play().catch(e => console.log('Audio play blocked:', e));
          } else {
            // Adjust current time if it drifts by more than 0.2s
            if (Math.abs(audio.currentTime - offset) > 0.2) {
              audio.currentTime = offset;
            }
          }
        } else {
          // Clip should not be playing
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
  }, [isPlaying, clips]);

  // Track playback time update
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;
    setCurrentTime(t);

    // Sync audios that should stop or start precisely during timeupdate
    clips.forEach(clip => {
      if (!clip.audioUrl) return;
      const audio = audioInstancesRef.current[clip.id];
      if (!audio) return;

      const offset = t - clip.startTime;
      if (offset >= 0 && offset < clip.duration) {
        if (isPlaying && audio.paused) {
          audio.currentTime = offset;
          audio.volume = clip.volume;
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
      setVideoDuration(videoRef.current.duration || 30);
    }
  };

  // Upload video via existing multipart API
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setMixedVideoUrl(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/sfx/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error('视频文件上传失败，请稍后重试');
      }

      const data = await res.json();
      setVideoFile({
        name: data.fileName,
        url: data.url
      });
      setCurrentTime(0);
      setIsPlaying(false);
    } catch (err: any) {
      setError(err.message || '上传视频时出错');
    } finally {
      setIsUploading(false);
    }
  };

  // Call Gemini visual multimodal model to auto-create soundtrack timeline
  const handleAnalyzeVideo = async () => {
    if (!videoFile) return;

    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await fetch('/api/video/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: videoFile.name,
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
      const res = await fetch('/api/video/generate-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: clip.prompt,
          trackId: clip.trackId,
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
      audioInstancesRef.current[clipId] = audio;

    } catch (err: any) {
      setClips(prev => prev.map(c => c.id === clipId ? { 
        ...c, 
        isGenerating: false, 
        error: err.message 
      } : c));
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

    const ungenerated = clips.filter(c => !c.audioUrl);
    if (ungenerated.length > 0) {
      setError('提示：还有一些音频尚未合成。我们将只混合已生成音频的轨道。');
    }

    setIsMixing(true);
    setError(null);
    setMixedVideoUrl(null);

    try {
      const res = await fetch('/api/video/mix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoFileName: videoFile.name,
          clips: clips.filter(c => c.audioUrl)
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

  // Timeline seeking by clicking ruler
  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !videoRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left - 128; // Adjust for track titles width
    const trackWidth = rect.width - 128;
    
    if (clickX >= 0 && clickX <= trackWidth) {
      const targetTime = (clickX / trackWidth) * videoDuration;
      videoRef.current.currentTime = targetTime;
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
        return updated;
      }
      return c;
    }));
  };

  const handleAddNewClip = (trackId: 'bgm' | 'sfx' | 'dubbing') => {
    const id = `clip-manual-${Date.now()}`;
    const newClip: TimelineClip = {
      id,
      trackId,
      name: trackId === 'bgm' ? '新增配乐轨' : trackId === 'sfx' ? '新增音效轨' : '新增配音轨',
      prompt: trackId === 'bgm' ? 'acoustic light background music' : trackId === 'sfx' ? 'soft swoop impact' : 'please input narration prompt',
      text: trackId === 'dubbing' ? '这是一段配音台词旁白' : undefined,
      voiceId: trackId === 'dubbing' ? '21m00Tcm4TlvDq8ikWAM' : undefined,
      startTime: Math.min(currentTime, videoDuration - 5),
      duration: trackId === 'bgm' ? 10 : trackId === 'sfx' ? 2 : 4,
      volume: trackId === 'bgm' ? 0.4 : 0.8
    };
    
    setClips(prev => [...prev, newClip]);
    setSelectedClipId(id);
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

  return (
    <div id="video-soundtrack-container" className="flex flex-col h-full bg-slate-900 text-slate-100 overflow-hidden">
      {/* 顶部工具栏 */}
      <header id="daw-header" className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between shadow-md shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
            <Film className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-200">视频一键自动配音配乐</h1>
            <p className="text-[10px] text-slate-400">基于多模态 AI 智能画面解析与 ElevenLabs DAW 音频合成</p>
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

              <button
                id="btn-export-mix"
                onClick={handleExportVideo}
                disabled={isMixing || clips.length === 0}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-lg shadow-emerald-500/10 disabled:opacity-50 transition-all cursor-pointer"
              >
                {isMixing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>音画重组中...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>混音并导出视频</span>
                  </>
                )}
              </button>
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

              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-800 hover:border-indigo-500/50 bg-slate-900/50 hover:bg-indigo-500/5 rounded-xl cursor-pointer group transition-all">
                <div className="flex flex-col items-center justify-center pt-5 pb-6 px-4">
                  {isUploading ? (
                    <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
                  ) : (
                    <Upload className="w-8 h-8 text-slate-500 group-hover:text-indigo-400 mb-3 transition-colors" />
                  )}
                  <p className="text-xs font-semibold text-slate-400 group-hover:text-slate-200">
                    {isUploading ? '正在上传您的视频并提取时长...' : '点击或拖拽视频到此处上传'}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">推荐 MP4 格式，建议文件小于 30MB</p>
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
              <div className="flex-1 flex flex-col items-center justify-center min-h-[280px] bg-slate-900 border border-slate-800 rounded-xl overflow-hidden relative shadow-inner">
                <video
                  ref={videoRef}
                  src={videoFile.url}
                  className="max-h-full max-w-full object-contain"
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleVideoLoaded}
                  onClick={togglePlay}
                />

                {/* 视频浮动控制条 */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-slate-950/90 border border-slate-800/80 px-4 py-2 rounded-full shadow-2xl">
                  <button
                    onClick={togglePlay}
                    className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg cursor-pointer transition-transform duration-150 active:scale-95"
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white translate-x-[1px]" />}
                  </button>

                  <div className="text-xs font-mono text-slate-300 select-none">
                    {currentTime.toFixed(2)}s / {videoDuration.toFixed(2)}s
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
                      href={mixedVideoUrl} 
                      download={`mixed_${videoFile.name}`}
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
            <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col overflow-y-auto custom-scrollbar shrink-0">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-slate-300">属性配置面板</span>
                </div>
                {selectedClip && (
                  <button
                    onClick={() => handleDeleteClip(selectedClip.id)}
                    className="text-slate-500 hover:text-red-400 p-1 rounded hover:bg-slate-800 transition-colors"
                    title="删除此音频块"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
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
                    {selectedClip.trackId === 'dubbing' && (
                      <>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">配音旁白台词 (中文)</label>
                          <textarea
                            value={selectedClip.text || ''}
                            onChange={(e) => updateClipField(selectedClip.id, 'text', e.target.value)}
                            className="w-full h-16 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none custom-scrollbar"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">选择配音音色</label>
                          <select
                            value={selectedClip.voiceId || '21m00Tcm4TlvDq8ikWAM'}
                            onChange={(e) => updateClipField(selectedClip.id, 'voiceId', e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                          >
                            <option value="21m00Tcm4TlvDq8ikWAM">Rachel (柔美女声)</option>
                            <option value="pNInz6obpg7IdgWAs6g8">Adam (磁性男声)</option>
                            <option value="iP95p4xoKVk53GoZ742B">Domi (活泼女声)</option>
                            <option value="VR6AHRvj9K9Ge6v96XmY">Glinda (童音女声)</option>
                          </select>
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
                          max={videoDuration}
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
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 p-4">
                    <Sliders className="w-8 h-8 mb-3 text-slate-700 stroke-[1.5]" />
                    <p className="text-xs">未选中任何时间轴音频块</p>
                    <p className="text-[10px] text-slate-600 mt-1 leading-normal">点击下部时间轨上的音频块，即可在此处配置提示词及声音属性。</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 下部：多轨道时间轴 (DAW Timeline) */}
      {videoFile && (
        <div id="daw-timeline-section" className="bg-slate-950 border-t border-slate-800 p-4 flex flex-col shrink-0 select-none">
          {/* 时间轴标尺与播放控制 */}
          <div className="flex items-center mb-3 text-slate-400 text-xs px-2 select-none">
            <span className="w-32 font-bold text-[10px] text-slate-500 uppercase tracking-wider text-right pr-4">时间轨道</span>
            
            <div 
              ref={timelineRef}
              onClick={handleRulerClick}
              className="flex-1 h-6 bg-slate-900 rounded border border-slate-800 relative cursor-col-resize overflow-hidden"
            >
              {/* 刻度渲染 */}
              {Array.from({ length: Math.ceil(videoDuration) }).map((_, i) => {
                const percent = (i / videoDuration) * 100;
                if (i % 2 === 0) {
                  return (
                    <div 
                      key={i} 
                      className="absolute top-0 bottom-0 border-l border-slate-800 text-[9px] font-mono pl-1 text-slate-600 flex items-end pb-0.5"
                      style={{ left: `${percent}%` }}
                    >
                      {i}s
                    </div>
                  );
                }
                return (
                  <div 
                    key={i} 
                    className="absolute top-2 bottom-0 border-l border-slate-800/50"
                    style={{ left: `${percent}%` }}
                  />
                );
              })}

              {/* 移动播放红线 */}
              <div 
                className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-10 pointer-events-none"
                style={{ left: `${(currentTime / videoDuration) * 100}%` }}
              >
                <div className="w-2.5 h-2.5 bg-red-500 rounded-full absolute -top-1 -left-1 shadow-lg shadow-red-500/50" />
              </div>
            </div>
          </div>

          {/* 轨道层 */}
          <div className="space-y-2.5 max-h-56 overflow-y-auto custom-scrollbar pr-1">
            {/* 1. 视频预览轨道 */}
            <div className="flex items-center">
              <div className="w-32 flex items-center justify-between pr-4 select-none">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 ml-auto">
                  <Film className="w-3.5 h-3.5 text-indigo-400" />
                  视频预览轨
                </span>
              </div>
              <div className="flex-1 h-9 bg-indigo-950/20 rounded-lg border border-indigo-900/30 overflow-hidden relative">
                {/* 简单的背景色分段或模拟帧图 */}
                <div className="absolute inset-0 flex items-center justify-around opacity-20 text-[10px] text-indigo-300 font-mono">
                  <span>镜头 A</span>
                  <span>镜头 B</span>
                  <span>镜头 C</span>
                  <span>镜头 D</span>
                </div>
              </div>
            </div>

            {/* 2. 背景音乐 BGM 轨道 */}
            <div className="flex items-center">
              <div className="w-32 flex items-center justify-between pr-4">
                <button
                  onClick={() => handleAddNewClip('bgm')}
                  className="p-1 hover:bg-slate-800 text-indigo-400 hover:text-white rounded ml-1 transition-colors"
                  title="添加背景音乐片段"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5 text-emerald-400" />
                  背景音乐轨
                </span>
              </div>
              <div className="flex-1 h-12 bg-slate-900 rounded-lg border border-slate-800 relative overflow-hidden">
                {clips
                  .filter(c => c.trackId === 'bgm')
                  .map(clip => {
                    const left = (clip.startTime / videoDuration) * 100;
                    const width = (clip.duration / videoDuration) * 100;
                    const isSelected = clip.id === selectedClipId;
                    return (
                      <div
                        key={clip.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedClipId(clip.id);
                        }}
                        className={`absolute top-1 bottom-1 rounded-md px-2 py-1 cursor-pointer flex flex-col justify-between text-left select-none transition-all ${
                          isSelected 
                            ? 'bg-emerald-600/95 text-white ring-2 ring-emerald-300 shadow-lg shadow-emerald-600/20' 
                            : 'bg-emerald-950/50 hover:bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                        }`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      >
                        <div className="flex items-center justify-between min-w-0">
                          <span className="text-[10px] font-bold truncate pr-1">{clip.name}</span>
                          {clip.isGenerating ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin text-emerald-400" />
                          ) : clip.audioUrl ? (
                            <Check className="w-2.5 h-2.5 text-emerald-300" />
                          ) : null}
                        </div>
                        <span className="text-[8px] font-mono truncate opacity-60">
                          {clip.prompt}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* 3. 音效 SFX 轨道 */}
            <div className="flex items-center">
              <div className="w-32 flex items-center justify-between pr-4">
                <button
                  onClick={() => handleAddNewClip('sfx')}
                  className="p-1 hover:bg-slate-800 text-indigo-400 hover:text-white rounded ml-1 transition-colors"
                  title="添加短音效片段"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Waves className="w-3.5 h-3.5 text-blue-400" />
                  音效SFX轨
                </span>
              </div>
              <div className="flex-1 h-12 bg-slate-900 rounded-lg border border-slate-800 relative overflow-hidden">
                {clips
                  .filter(c => c.trackId === 'sfx')
                  .map(clip => {
                    const left = (clip.startTime / videoDuration) * 100;
                    const width = (clip.duration / videoDuration) * 100;
                    const isSelected = clip.id === selectedClipId;
                    return (
                      <div
                        key={clip.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedClipId(clip.id);
                        }}
                        className={`absolute top-1 bottom-1 rounded-md px-2 py-1 cursor-pointer flex flex-col justify-between text-left select-none transition-all ${
                          isSelected 
                            ? 'bg-blue-600/95 text-white ring-2 ring-blue-300 shadow-lg shadow-blue-600/20' 
                            : 'bg-blue-950/50 hover:bg-blue-950/80 text-blue-300 border border-blue-800/60'
                        }`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      >
                        <div className="flex items-center justify-between min-w-0">
                          <span className="text-[10px] font-bold truncate pr-1">{clip.name}</span>
                          {clip.isGenerating ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin text-blue-400" />
                          ) : clip.audioUrl ? (
                            <Check className="w-2.5 h-2.5 text-blue-300" />
                          ) : null}
                        </div>
                        <span className="text-[8px] font-mono truncate opacity-60">
                          {clip.prompt}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* 4. 配音 Dubbing 轨道 */}
            <div className="flex items-center">
              <div className="w-32 flex items-center justify-between pr-4">
                <button
                  onClick={() => handleAddNewClip('dubbing')}
                  className="p-1 hover:bg-slate-800 text-indigo-400 hover:text-white rounded ml-1 transition-colors"
                  title="添加旁白配音片段"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-purple-400" />
                  配音旁白轨
                </span>
              </div>
              <div className="flex-1 h-12 bg-slate-900 rounded-lg border border-slate-800 relative overflow-hidden">
                {clips
                  .filter(c => c.trackId === 'dubbing')
                  .map(clip => {
                    const left = (clip.startTime / videoDuration) * 100;
                    const width = (clip.duration / videoDuration) * 100;
                    const isSelected = clip.id === selectedClipId;
                    return (
                      <div
                        key={clip.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedClipId(clip.id);
                        }}
                        className={`absolute top-1 bottom-1 rounded-md px-2 py-1 cursor-pointer flex flex-col justify-between text-left select-none transition-all ${
                          isSelected 
                            ? 'bg-purple-600/95 text-white ring-2 ring-purple-300 shadow-lg shadow-purple-600/20' 
                            : 'bg-purple-950/50 hover:bg-purple-950/80 text-purple-300 border border-purple-800/60'
                        }`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                      >
                        <div className="flex items-center justify-between min-w-0">
                          <span className="text-[10px] font-bold truncate pr-1">{clip.name}</span>
                          {clip.isGenerating ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin text-purple-400" />
                          ) : clip.audioUrl ? (
                            <Check className="w-2.5 h-2.5 text-purple-300" />
                          ) : null}
                        </div>
                        <span className="text-[8px] font-mono truncate opacity-60">
                          "{clip.text || clip.prompt}"
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
