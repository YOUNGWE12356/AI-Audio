/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Square, 
  Plus, 
  Trash2, 
  Volume2, 
  VolumeX, 
  Scissors, 
  Download, 
  Upload, 
  Music, 
  Layers, 
  Info, 
  Volume1,
  FileAudio,
  Radio,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import { encodeWav } from '../services/audioEncoderService';

interface AudioClip {
  id: string;
  name: string;
  startTime: number; // in seconds from track start
  duration: number;  // in seconds
  buffer: AudioBuffer;
  color: string;     // Tailwind classes for bg/border
  fadeIn?: number;   // fade in duration in seconds
  fadeOut?: number;  // fade out duration in seconds
}

interface AudioTrack {
  id: string;
  name: string;
  volume: number;    // 0 to 100
  muted: boolean;
  solo: boolean;
  clips: AudioClip[];
}

// Colors list for visual representation of clips
const CLIP_COLORS = [
  { bg: 'bg-emerald-100 border-emerald-300 text-emerald-800', wave: '#10b981' },
  { bg: 'bg-indigo-100 border-indigo-300 text-indigo-800', wave: '#6366f1' },
  { bg: 'bg-amber-100 border-amber-300 text-amber-800', wave: '#f59e0b' },
  { bg: 'bg-rose-100 border-rose-300 text-rose-800', wave: '#f43f5e' },
  { bg: 'bg-sky-100 border-sky-300 text-sky-800', wave: '#0ea5e9' },
  { bg: 'bg-violet-100 border-violet-300 text-violet-800', wave: '#8b5cf6' },
  { bg: 'bg-teal-100 border-teal-300 text-teal-800', wave: '#14b8a6' },
];

export default function AudioWorkstation() {
  // Web Audio Context reference
  const audioCtxRef = useRef<AudioContext | null>(null);
  
  // Tracks state
  const [tracks, setTracks] = useState<AudioTrack[]>([
    { id: 'track-1', name: '人声主轨', volume: 80, muted: false, solo: false, clips: [] },
    { id: 'track-2', name: '伴奏轨', volume: 60, muted: false, solo: false, clips: [] },
  ]);

  // Global Transport States
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0); // Playhead in seconds
  const [selectedClip, setSelectedClip] = useState<{ trackId: string; clipId: string } | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [isDecoding, setIsDecoding] = useState<boolean>(false);

  // Timeline configuration
  const ZOOM_PX_PER_SECOND = 20; // 1 second = 20 pixels
  const TIMELINE_MAX_SECONDS = 180; // default 3 minutes, expands dynamically
  const trackLaneHeight = 84; // px for precise drag calculations
  
  // Audio sources keeping track of what's playing in real time
  const activeSourcesRef = useRef<{ source: AudioBufferSourceNode; gainNode: GainNode }[]>([]);
  const playbackStartTimeRef = useRef<number>(0);
  const playbackStartPlayheadRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Synchronized refs for real-time playhead loop to avoid stale React closures
  const isPlayingRef = useRef<boolean>(false);
  const tracksRef = useRef<AudioTrack[]>(tracks);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  // Drag and Drop clip states
  const [draggingClip, setDraggingClip] = useState<{
    trackId: string;
    clipId: string;
    originalStartTime: number;
    startX: number;
    startY: number;
  } | null>(null);

  const [dragOverInfo, setDragOverInfo] = useState<{
    trackId: string;
    targetStartTime: number;
  } | null>(null);

  // Initialize Audio Context on demand
  const getAudioContext = (): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  // Stop playback when component unmounts
  useEffect(() => {
    return () => {
      stopAllPlayback();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Helper to apply linear fades in Web Audio context
  const applyFadeEnvelope = (
    clipGain: GainNode, 
    clip: AudioClip, 
    playheadTime: number, 
    ctx: BaseAudioContext
  ) => {
    const clipStart = clip.startTime;
    const clipEnd = clip.startTime + clip.duration;
    const fadeIn = clip.fadeIn || 0;
    const fadeOut = clip.fadeOut || 0;

    // Helper to map absolute timeline time (s) to ctx.currentTime
    const getCtxTime = (timelineTime: number) => {
      return ctx.currentTime + Math.max(0, timelineTime - playheadTime);
    };

    // Ensure default initial state at ctx.currentTime is 1.0 (no volume impact if no fades)
    clipGain.gain.setValueAtTime(1.0, ctx.currentTime);

    // Apply Fade In
    if (fadeIn > 0) {
      const fadeInEnd = clipStart + fadeIn;
      if (clipStart >= playheadTime) {
        // Fade starts in the future relative to the playhead
        const startCtxTime = getCtxTime(clipStart);
        const endCtxTime = getCtxTime(fadeInEnd);
        
        clipGain.gain.setValueAtTime(0, startCtxTime);
        clipGain.gain.linearRampToValueAtTime(1.0, endCtxTime);
      } else if (playheadTime < fadeInEnd) {
        // Currently starting in the middle of a fade-in
        const currentProgress = (playheadTime - clipStart) / fadeIn;
        const endCtxTime = getCtxTime(fadeInEnd);
        
        clipGain.gain.setValueAtTime(currentProgress, ctx.currentTime);
        clipGain.gain.linearRampToValueAtTime(1.0, endCtxTime);
      }
    }

    // Apply Fade Out
    if (fadeOut > 0) {
      const fadeOutStart = clipEnd - fadeOut;
      if (fadeOutStart >= playheadTime) {
        // Fade out starts in the future
        const startCtxTime = getCtxTime(fadeOutStart);
        const endCtxTime = getCtxTime(clipEnd);
        
        // Hold value at 1.0 until the fadeout begins
        clipGain.gain.setValueAtTime(1.0, startCtxTime);
        clipGain.gain.linearRampToValueAtTime(0.0, endCtxTime);
      } else if (playheadTime < clipEnd) {
        // Currently starting in the middle of a fade-out
        const currentProgress = 1.0 - (playheadTime - fadeOutStart) / fadeOut;
        const endCtxTime = getCtxTime(clipEnd);
        
        clipGain.gain.setValueAtTime(Math.max(0, currentProgress), ctx.currentTime);
        clipGain.gain.linearRampToValueAtTime(0.0, endCtxTime);
      }
    }
  };

  // Sync playhead position during active playback using updatePlayheadPositionRef
  const updatePlayheadPositionRef = useRef<() => void>();
  updatePlayheadPositionRef.current = () => {
    if (!isPlayingRef.current || !audioCtxRef.current) return;
    
    const elapsed = audioCtxRef.current.currentTime - playbackStartTimeRef.current;
    const newTime = playbackStartPlayheadRef.current + elapsed;
    
    // Find absolute maximum time of all clips to auto-stop or wrap
    let maxClipTime = 10; // default check
    tracksRef.current.forEach(t => {
      t.clips.forEach(c => {
        maxClipTime = Math.max(maxClipTime, c.startTime + c.duration);
      });
    });

    if (newTime >= maxClipTime) {
      stopAllPlayback();
      setCurrentTime(0);
      setIsPlaying(false);
      return;
    }

    setCurrentTime(newTime);
    animationFrameRef.current = requestAnimationFrame(() => updatePlayheadPositionRef.current?.());
  };

  // Stop playback and clean up source nodes
  const stopAllPlayback = () => {
    isPlayingRef.current = false;
    activeSourcesRef.current.forEach(item => {
      try {
        item.source.stop();
      } catch (e) {
        // already stopped
      }
    });
    activeSourcesRef.current = [];
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  // Play audio project
  const handlePlay = () => {
    if (isPlaying) {
      handlePause();
      return;
    }

    const ctx = getAudioContext();
    stopAllPlayback();

    // Check solo constraints: if some track is soloed, only those play
    const hasSolo = tracks.some(t => t.solo && !t.muted);

    // Track play state in refs for precise timing mapping
    playbackStartTimeRef.current = ctx.currentTime;
    playbackStartPlayheadRef.current = currentTime;

    // Schedule sources for each active track
    tracks.forEach(track => {
      // Skip muted tracks. If there are soloed tracks, skip non-soloed ones.
      if (track.muted) return;
      if (hasSolo && !track.solo) return;

      // Track Gain node for volume control
      const trackGain = ctx.createGain();
      trackGain.gain.value = track.volume / 100;
      trackGain.connect(ctx.destination);

      track.clips.forEach(clip => {
        const clipEnd = clip.startTime + clip.duration;
        
        // Schedule if the clip falls after or around current playhead
        if (clipEnd > currentTime) {
          const source = ctx.createBufferSource();
          source.buffer = clip.buffer;

          // Clip level gain node for fades
          const clipGain = ctx.createGain();
          applyFadeEnvelope(clipGain, clip, currentTime, ctx);

          source.connect(clipGain);
          clipGain.connect(trackGain);

          // Calculate timing variables in seconds
          const delay = Math.max(0, clip.startTime - currentTime);
          const offset = Math.max(0, currentTime - clip.startTime);
          const duration = clip.duration - offset;

          try {
            source.start(ctx.currentTime + delay, offset, duration);
            activeSourcesRef.current.push({ source, gainNode: trackGain });
          } catch (err) {
            console.error('Error starting source:', err);
          }
        }
      });
    });

    setIsPlaying(true);
    isPlayingRef.current = true;
    animationFrameRef.current = requestAnimationFrame(() => updatePlayheadPositionRef.current?.());
  };

  // Pause playback
  const handlePause = () => {
    stopAllPlayback();
    setIsPlaying(false);
  };

  // Stop playback and rewind to start
  const handleStop = () => {
    stopAllPlayback();
    setIsPlaying(false);
    setCurrentTime(0);
  };

  // Jump playhead position on click ruler
  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left + e.currentTarget.scrollLeft;
    const time = Math.max(0, clickX / ZOOM_PX_PER_SECOND);
    
    if (isPlayingRef.current) {
      stopAllPlayback();
      setIsPlaying(false);
      setCurrentTime(time);
      playbackStartPlayheadRef.current = time;
      
      // We schedule a minor delay to restart smoothly
      setTimeout(() => {
        handlePlay();
      }, 50);
    } else {
      setCurrentTime(time);
    }
  };

  // Add a new track
  const handleAddTrack = () => {
    const nextId = `track-${Date.now()}`;
    const nextNum = tracks.length + 1;
    setTracks([
      ...tracks,
      { id: nextId, name: `音频轨 ${nextNum}`, volume: 80, muted: false, solo: false, clips: [] }
    ]);
  };

  // Delete a track
  const handleDeleteTrack = (trackId: string) => {
    const updated = tracks.filter(t => t.id !== trackId);
    setTracks(updated);
    if (selectedClip?.trackId === trackId) {
      setSelectedClip(null);
    }
    // Re-trigger audio playing to exclude deleted track
    if (isPlaying) {
      setTimeout(() => {
        handlePause();
        handlePlay();
      }, 30);
    }
  };

  // Update track properties
  const updateTrackProp = (trackId: string, prop: keyof AudioTrack, value: any) => {
    const updated = tracks.map(t => {
      if (t.id === trackId) {
        return { ...t, [prop]: value };
      }
      return t;
    });
    setTracks(updated);

    // If volume changed, dynamically update active gain nodes if playing
    if (prop === 'volume' && isPlaying) {
      // For simplicity, we just restart playback, or let it apply on next start
    }
  };

  // Slices an AudioBuffer into a smaller AudioBuffer
  const sliceAudioBuffer = (ctx: AudioContext, buffer: AudioBuffer, startSec: number, endSec: number): AudioBuffer => {
    const sampleRate = buffer.sampleRate;
    const startSample = Math.floor(startSec * sampleRate);
    const endSample = Math.min(buffer.length, Math.ceil(endSec * sampleRate));
    const frameCount = endSample - startSample;
    
    if (frameCount <= 0) {
      return buffer; // fall back
    }
    
    const newBuffer = ctx.createBuffer(buffer.numberOfChannels, frameCount, sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const origData = buffer.getChannelData(channel);
      const newData = newBuffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) {
        newData[i] = origData[startSample + i];
      }
    }
    return newBuffer;
  };

  // Split clip at current playhead position
  const handleSplitClip = () => {
    if (!selectedClip) return;
    const track = tracks.find(t => t.id === selectedClip.trackId);
    if (!track) return;
    
    const clip = track.clips.find(c => c.id === selectedClip.clipId);
    if (!clip) return;

    // Check if playhead is within clip boundaries
    if (currentTime > clip.startTime && currentTime < clip.startTime + clip.duration) {
      const ctx = getAudioContext();
      const splitOffset = currentTime - clip.startTime; // offset inside clip
      
      try {
        const buffer1 = sliceAudioBuffer(ctx, clip.buffer, 0, splitOffset);
        const buffer2 = sliceAudioBuffer(ctx, clip.buffer, splitOffset, clip.duration);

        const clip1Id = `clip-${Date.now()}-a`;
        const clip2Id = `clip-${Date.now()}-b`;

        const clip1: AudioClip = {
          id: clip1Id,
          name: `${clip.name} (前)`,
          startTime: clip.startTime,
          duration: splitOffset,
          buffer: buffer1,
          color: clip.color,
          fadeIn: clip.fadeIn ? Math.min(clip.fadeIn, splitOffset) : 0,
          fadeOut: 0
        };

        const clip2: AudioClip = {
          id: clip2Id,
          name: `${clip.name} (后)`,
          startTime: currentTime,
          duration: clip.duration - splitOffset,
          buffer: buffer2,
          color: clip.color,
          fadeIn: 0,
          fadeOut: clip.fadeOut ? Math.min(clip.fadeOut, clip.duration - splitOffset) : 0
        };

        const updatedTracks = tracks.map(t => {
          if (t.id === track.id) {
            // Remove old clip, insert two new ones
            const filteredClips = t.clips.filter(c => c.id !== clip.id);
            return {
              ...t,
              clips: [...filteredClips, clip1, clip2]
            };
          }
          return t;
        });

        setTracks(updatedTracks);
        setSelectedClip({ trackId: track.id, clipId: clip2Id });

        // Update live playing if active
        if (isPlaying) {
          handlePause();
          setTimeout(() => handlePlay(), 100);
        }
      } catch (err) {
        console.error("Failed to split clip:", err);
      }
    }
  };

  // Delete selected clip
  const handleDeleteClip = () => {
    if (!selectedClip) return;
    const updated = tracks.map(t => {
      if (t.id === selectedClip.trackId) {
        return {
          ...t,
          clips: t.clips.filter(c => c.id !== selectedClip.clipId)
        };
      }
      return t;
    });
    setTracks(updated);
    setSelectedClip(null);

    // Stop and play to apply instantly
    if (isPlaying) {
      handlePause();
      setTimeout(() => handlePlay(), 50);
    }
  };

  // Handle local audio file selection/upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsDecoding(true);
    const ctx = getAudioContext();
    const newClips: { file: File; buffer: AudioBuffer }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const arrayBuffer = await file.arrayBuffer();
        const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
        newClips.push({ file, buffer: decodedBuffer });
      } catch (err) {
        console.error(`Error decoding file ${file.name}:`, err);
        alert(`无法加载 ${file.name}，文件损坏或格式不受系统支持。`);
      }
    }

    if (newClips.length > 0 && tracks.length > 0) {
      // Distribute imported clips to the first track or spread them
      const updatedTracks = [...tracks];
      const targetTrack = updatedTracks[0];

      newClips.forEach((item, index) => {
        const randomColor = CLIP_COLORS[(targetTrack.clips.length + index) % CLIP_COLORS.length].bg;
        const newClip: AudioClip = {
          id: `clip-${Date.now()}-${index}`,
          name: item.file.name.replace(/\.[^/.]+$/, ""), // remove extension
          startTime: currentTime, // place right at playhead
          duration: item.buffer.duration,
          buffer: item.buffer,
          color: randomColor,
          fadeIn: 0,
          fadeOut: 0
        };
        targetTrack.clips.push(newClip);
      });

      setTracks(updatedTracks);
    }

    setIsDecoding(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Custom visual waveform SVG representation
  const renderClipWaveform = (buffer: AudioBuffer): string => {
    // Generate high-fidelity vertical line paths for a beautiful wave
    const steps = 120;
    const points: string[] = [];
    const stepLength = Math.floor(buffer.length / steps);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < steps; i++) {
      let max = 0;
      const index = i * stepLength;
      // sample more frames for a detailed peak value
      const sampleChunkSize = Math.min(stepLength, 150);
      for (let j = 0; j < sampleChunkSize; j++) {
        if (data[index + j]) {
          max = Math.max(max, Math.abs(data[index + j]));
        }
      }
      // Val from 4 to 90 (stays inside 100 vertical viewBox limit)
      const val = Math.min(90, Math.max(4, max * 110));
      const x = (i / steps) * 200; // Map perfectly to 200px viewBox width
      const y1 = 50 - val / 2;
      const y2 = 50 + val / 2;
      points.push(`M ${x.toFixed(1)} ${y1.toFixed(1)} L ${x.toFixed(1)} ${y2.toFixed(1)}`);
    }
    return points.join(' ');
  };

  // Drag Clip Handler - mouse down
  const onClipMouseDown = (
    e: React.MouseEvent, 
    trackId: string, 
    clipId: string, 
    startTime: number
  ) => {
    e.stopPropagation();
    setSelectedClip({ trackId, clipId });

    setDraggingClip({
      trackId,
      clipId,
      originalStartTime: startTime,
      startX: e.clientX,
      startY: e.clientY
    });
  };

  // Mouse move and drag implementation
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingClip) return;
      
      const dx = e.clientX - draggingClip.startX;
      const deltaTime = dx / ZOOM_PX_PER_SECOND;
      let newTime = Math.max(0, draggingClip.originalStartTime + deltaTime);
      
      // Snapping to nearest 0.1 second if close
      if (Math.abs(newTime - Math.round(newTime)) < 0.15) {
        newTime = Math.round(newTime);
      }

      // Vertical track index search based on relative page coordinates
      const dy = e.clientY - draggingClip.startY;
      const trackIndexOffset = Math.round(dy / trackLaneHeight);
      
      const currentTrackIndex = tracks.findIndex(t => t.id === draggingClip.trackId);
      let targetTrackIndex = currentTrackIndex + trackIndexOffset;
      targetTrackIndex = Math.max(0, Math.min(tracks.length - 1, targetTrackIndex));
      const targetTrack = tracks[targetTrackIndex];

      setDragOverInfo({
        trackId: targetTrack.id,
        targetStartTime: parseFloat(newTime.toFixed(2))
      });
    };

    const handleMouseUp = () => {
      if (draggingClip && dragOverInfo) {
        // Find moving clip
        const sourceTrack = tracks.find(t => t.id === draggingClip.trackId);
        const movingClip = sourceTrack?.clips.find(c => c.id === draggingClip.clipId);

        if (movingClip) {
          // Perform state transformation
          const finalTracks = tracks.map(t => {
            if (t.id === draggingClip.trackId) {
              // filter out clip if it moves to another track
              if (draggingClip.trackId !== dragOverInfo.trackId) {
                return { ...t, clips: t.clips.filter(c => c.id !== draggingClip.clipId) };
              } else {
                // update startTime inside same track
                return {
                  ...t,
                  clips: t.clips.map(c => c.id === draggingClip.clipId ? { ...c, startTime: dragOverInfo.targetStartTime } : c)
                };
              }
            }
            if (t.id === dragOverInfo.trackId && draggingClip.trackId !== dragOverInfo.trackId) {
              // append to new track with updated start time
              const updatedClip = { ...movingClip, startTime: dragOverInfo.targetStartTime };
              return { ...t, clips: [...t.clips, updatedClip] };
            }
            return t;
          });

          setTracks(finalTracks);
          setSelectedClip({ trackId: dragOverInfo.trackId, clipId: draggingClip.clipId });

          // Restart playing to apply changes instantly
          if (isPlaying) {
            handlePause();
            setTimeout(() => handlePlay(), 100);
          }
        }
      }
      setDraggingClip(null);
      setDragOverInfo(null);
    };

    if (draggingClip) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingClip, dragOverInfo, tracks, isPlaying]);

  // Mixed multitrack export down to offline context
  const handleExportMix = async () => {
    // 1. Calculate end timeline
    let maxDuration = 5;
    tracks.forEach(track => {
      track.clips.forEach(clip => {
        maxDuration = Math.max(maxDuration, clip.startTime + clip.duration);
      });
    });

    setIsExporting(true);
    setExportProgress(10);

    const targetSampleRate = 44100;
    const OfflineContext = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    if (!OfflineContext) {
      alert("当前浏览器不支持离线渲染合成音频。");
      setIsExporting(false);
      return;
    }

    // 2. Setup offline renderer context
    const totalFrames = Math.ceil(maxDuration * targetSampleRate);
    const offlineCtx = new OfflineContext(2, totalFrames, targetSampleRate);

    // Apply tracks
    setExportProgress(30);
    const hasSolo = tracks.some(t => t.solo && !t.muted);

    tracks.forEach(track => {
      if (track.muted) return;
      if (hasSolo && !track.solo) return;

      const trackGain = offlineCtx.createGain();
      trackGain.gain.value = track.volume / 100;
      trackGain.connect(offlineCtx.destination);

      track.clips.forEach(clip => {
        const source = offlineCtx.createBufferSource();
        source.buffer = clip.buffer;

        // Clip-level gain node for fades during offline mixing export
        const clipGain = offlineCtx.createGain();
        applyFadeEnvelope(clipGain, clip, 0, offlineCtx); // playhead starts at 0 for offline render

        source.connect(clipGain);
        clipGain.connect(trackGain);

        // start physical offset
        source.start(clip.startTime);
      });
    });

    setExportProgress(60);

    try {
      const renderedBuffer = await offlineCtx.startRendering();
      setExportProgress(90);

      // Encode buffer to WAV format
      const wavBlob = encodeWav(renderedBuffer);
      setExportProgress(100);

      const downloadUrl = URL.createObjectURL(wavBlob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `DAW_混音输出_${new Date().toISOString().slice(0, 10)}.wav`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up export status
      setTimeout(() => {
        setIsExporting(false);
        setExportProgress(0);
      }, 1000);
    } catch (err) {
      console.error(err);
      alert("音频渲染混流失败，请重试。");
      setIsExporting(false);
    }
  };

  // Format second to nice stopwatch text
  const formatTimeStr = (sec: number): string => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    const cents = Math.floor((sec % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${cents.toString().padStart(2, '0')}`;
  };

  // Generate ruler grid markings
  const rulerTicks = [];
  for (let i = 0; i <= TIMELINE_MAX_SECONDS; i += 5) {
    rulerTicks.push(i);
  }

  // Count total clips loaded
  const totalClipsCount = tracks.reduce((sum, t) => sum + t.clips.length, 0);

  return (
    <div id="audio-workstation" className="space-y-6">
      {/* DAW Header Info bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-emerald-50 text-emerald-700 rounded-lg">
              <Layers className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-800 tracking-tight flex items-center gap-2">
                <span>多轨音频工作站</span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">DAW Engine</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                支持导入多轨声音，自由拖拽移动位置，剪切波形拼接段落，一键离线无损渲染双声道混音。
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* Main Grid Viewport */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden text-slate-200">
        
        {/* Top Control Panel Toolbar */}
        <div className="bg-slate-950 px-5 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            multiple
            accept="audio/*"
            className="hidden"
          />
          
          {/* Playback Controls */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handlePlay}
              className={`p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-center ${
                isPlaying 
                  ? 'bg-amber-500 hover:bg-amber-600 text-slate-950' 
                  : 'bg-emerald-500 hover:bg-emerald-600 text-slate-950'
              }`}
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>
            
            <button
              onClick={handleStop}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl cursor-pointer text-slate-300 transition-all"
              title="重置到起点"
            >
              <Square className="w-5 h-5 fill-current" />
            </button>

            {/* Time Indicator */}
            <div className="px-3.5 py-1.5 bg-slate-900 border border-slate-800 rounded-xl font-mono text-emerald-400 font-bold text-sm tracking-widest min-w-28 text-center shadow-inner">
              {formatTimeStr(currentTime)}
            </div>
          </div>

          {/* Context Tools (Scissors / Split & Delete Clip) */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {selectedClip ? (
              <>
                <div className="text-xs text-slate-400 mr-2 max-w-44 truncate">
                  已选片段: <span className="text-emerald-400 font-bold">{
                    (() => {
                      const tr = tracks.find(t => t.id === selectedClip.trackId);
                      const cl = tr?.clips.find(c => c.id === selectedClip.clipId);
                      return cl ? cl.name : "未知";
                    })()
                  }</span>
                </div>

                <button
                  onClick={handleSplitClip}
                  title="在当前红线播放轴处将片段切断"
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-300 font-bold text-xs px-3 py-2 rounded-lg border border-slate-700 transition-all cursor-pointer"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>剪切拆分</span>
                </button>

                <button
                  onClick={handleDeleteClip}
                  title="删除选中的音频片段"
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-rose-600 hover:text-white text-slate-300 font-bold text-xs px-3 py-2 rounded-lg border border-slate-700 transition-all cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>删除片段</span>
                </button>
              </>
            ) : (
              <div className="text-xs text-slate-500 italic flex items-center gap-1">
                <Info className="w-3.5 h-3.5" />
                <span>提示: 点击轨道上的彩色音频块可激活剪切、删除或进行左右拖移。</span>
              </div>
            )}

            <div className="mx-1 hidden h-6 w-px bg-slate-800 sm:block" />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isDecoding}
              className="flex items-center gap-2 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-sm transition-all hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 cursor-pointer"
            >
              {isDecoding ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                  <span>解码中...</span>
                </span>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>导入音频</span>
                </>
              )}
            </button>

            <button
              onClick={handleAddTrack}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition-all hover:bg-slate-700 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-emerald-400" />
              <span>添加音轨</span>
            </button>

            <button
              onClick={handleExportMix}
              disabled={totalClipsCount === 0 || isExporting}
              className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-bold text-slate-200 shadow-sm transition-all hover:border-emerald-500 hover:text-emerald-300 disabled:bg-slate-900 disabled:text-slate-600 disabled:border-slate-800 disabled:cursor-not-allowed cursor-pointer"
            >
              {isExporting ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <span>混音 {exportProgress}%</span>
                </span>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>导出 WAV</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Selected Clip Properties Row: Fade-in / Fade-out duration slider */}
        {selectedClip && (() => {
          const track = tracks.find(t => t.id === selectedClip.trackId);
          const clip = track?.clips.find(c => c.id === selectedClip.clipId);
          if (!clip) return null;
          
          return (
            <div className="bg-slate-950 border-b border-slate-850 px-5 py-4 flex flex-wrap items-center justify-between gap-6">
              <div className="flex items-center gap-2.5">
                <span className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl shrink-0">
                  <Sparkles className="w-4 h-4 animate-pulse" />
                </span>
                <div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider font-mono">Selected Clip / 片段编辑</div>
                  <input
                    type="text"
                    value={clip.name}
                    onChange={(e) => {
                      const updated = tracks.map(t => {
                        if (t.id === selectedClip.trackId) {
                          return {
                            ...t,
                            clips: t.clips.map(c => c.id === selectedClip.clipId ? { ...c, name: e.target.value } : c)
                          };
                        }
                        return t;
                      });
                      setTracks(updated);
                    }}
                    className="bg-slate-900 border border-slate-800 rounded-lg text-xs font-bold text-slate-200 px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-emerald-500 w-48 mt-1 transition-all"
                  />
                </div>
              </div>

              {/* Envelope Adjusters: Fade In & Fade Out */}
              <div className="flex flex-wrap items-center gap-6 flex-1 justify-end">
                {/* Fade In slider */}
                <div className="flex flex-col gap-1 min-w-[170px] bg-slate-900/50 p-2.5 rounded-xl border border-slate-850">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                    <span className="flex items-center gap-1">🔊 淡入时长 (Fade-in)</span>
                    <span className="text-emerald-400 font-bold font-mono">{(clip.fadeIn || 0).toFixed(1)} 秒</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9px] text-slate-600 font-mono">0s</span>
                    <input
                      type="range"
                      min="0"
                      max={(clip.duration / 2).toFixed(1)} // safe limit: max half duration of clip
                      step="0.1"
                      value={clip.fadeIn || 0}
                      onChange={(e) => {
                        const val = parseFloat(parseFloat(e.target.value).toFixed(1));
                        const updated = tracks.map(t => {
                          if (t.id === selectedClip.trackId) {
                            return {
                              ...t,
                              clips: t.clips.map(c => c.id === selectedClip.clipId ? { ...c, fadeIn: val } : c)
                            };
                          }
                          return t;
                        });
                        setTracks(updated);
                      }}
                      className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                    <span className="text-[9px] text-slate-600 font-mono">{(clip.duration / 2).toFixed(1)}s</span>
                  </div>
                </div>

                {/* Fade Out slider */}
                <div className="flex flex-col gap-1 min-w-[170px] bg-slate-900/50 p-2.5 rounded-xl border border-slate-850">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                    <span className="flex items-center gap-1">静音 淡出时长 (Fade-out)</span>
                    <span className="text-rose-400 font-bold font-mono">{(clip.fadeOut || 0).toFixed(1)} 秒</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9px] text-slate-600 font-mono">0s</span>
                    <input
                      type="range"
                      min="0"
                      max={(clip.duration / 2).toFixed(1)} // safe limit: max half duration of clip
                      step="0.1"
                      value={clip.fadeOut || 0}
                      onChange={(e) => {
                        const val = parseFloat(parseFloat(e.target.value).toFixed(1));
                        const updated = tracks.map(t => {
                          if (t.id === selectedClip.trackId) {
                            return {
                              ...t,
                              clips: t.clips.map(c => c.id === selectedClip.clipId ? { ...c, fadeOut: val } : c)
                            };
                          }
                          return t;
                        });
                        setTracks(updated);
                      }}
                      className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
                    />
                    <span className="text-[9px] text-slate-600 font-mono">{(clip.duration / 2).toFixed(1)}s</span>
                  </div>
                </div>

                {/* Graphic Visual Envelope representation */}
                <div className="hidden sm:flex flex-col items-center justify-center p-2 bg-slate-950 border border-slate-850 rounded-xl w-32 h-14 relative overflow-hidden shrink-0">
                  <svg className="w-full h-full text-emerald-500/20" viewBox="0 0 100 40" preserveAspectRatio="none">
                    {/* Background guideline */}
                    <path d="M 0 35 L 100 35" stroke="#1e293b" strokeWidth="1.5" strokeDasharray="3,3" />
                    {/* Fade envelope visual line */}
                    <path 
                      d={`
                        M 0 35 
                        L ${(clip.fadeIn || 0) / clip.duration * 100} 5 
                        L ${100 - (clip.fadeOut || 0) / clip.duration * 100} 5 
                        L 100 35
                      `} 
                      fill="none" 
                      stroke={clip.fadeIn || clip.fadeOut ? "#10b981" : "#475569"} 
                      strokeWidth="2.5" 
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute bottom-1 text-[8px] font-bold font-sans text-slate-500 leading-none select-none uppercase tracking-wider">
                    Envelope / 曲线
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Scrollable Tracks Area */}
        <div className="relative flex flex-col overflow-x-auto select-none" style={{ minHeight: '260px' }}>
          
          {/* Absolute Playhead indicator */}
          <div 
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none transition-transform duration-75"
            style={{ 
              left: `${180 + currentTime * ZOOM_PX_PER_SECOND}px`, // 180px matches track header width
              boxShadow: '0 0 8px #ef4444'
            }}
          />

          {/* Time ruler (Ruler clicks) */}
          <div className="flex bg-slate-950 border-b border-slate-800 shrink-0 h-8">
            {/* Header placeholder spacer */}
            <div className="w-44 border-r border-slate-800 shrink-0 bg-slate-950 h-full flex items-center px-4">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">timeline</span>
            </div>

            {/* Scale markings container */}
            <div 
              onClick={handleRulerClick}
              className="flex-1 relative bg-slate-900/60 cursor-ew-resize h-full"
              style={{ width: `${TIMELINE_MAX_SECONDS * ZOOM_PX_PER_SECOND}px` }}
            >
              {rulerTicks.map((tick) => (
                <div 
                  key={tick}
                  className="absolute bottom-0 text-[10px] font-mono text-slate-500 flex flex-col items-center justify-end"
                  style={{ 
                    left: `${tick * ZOOM_PX_PER_SECOND}px`, 
                    transform: 'translateX(-50%)',
                    height: '100%'
                  }}
                >
                  <span className="mb-1">{tick}s</span>
                  <div className="w-px h-1.5 bg-slate-700" />
                </div>
              ))}
            </div>
          </div>

          {/* Tracks Lanes */}
          {tracks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-500 bg-slate-900/40">
              <Radio className="w-8 h-8 text-slate-600 mb-2 animate-pulse" />
              <p className="text-xs">无可用音频轨道，请点击“添加音轨”或直接导入音频文件。</p>
            </div>
          ) : (
            <div className="flex flex-col flex-1 divide-y divide-slate-850 bg-slate-900">
              {tracks.map((track, trackIndex) => {
                const isDragOverTrack = dragOverInfo?.trackId === track.id;

                return (
                  <div 
                    key={track.id} 
                    className="flex shrink-0 relative duration-100 transition-colors"
                    style={{ height: `${trackLaneHeight}px` }}
                  >
                    {/* Track Controller Header */}
                    <div className="w-44 bg-slate-950 border-r border-slate-800 shrink-0 flex flex-col p-3 justify-between z-10 shadow-md">
                      
                      {/* Name & Delete */}
                      <div className="flex items-center justify-between gap-1.5">
                        <input
                          type="text"
                          value={track.name}
                          onChange={(e) => updateTrackProp(track.id, 'name', e.target.value)}
                          className="bg-transparent text-xs font-bold text-slate-200 border-none hover:bg-slate-900 focus:bg-slate-900 px-1 py-0.5 rounded outline-none w-28 truncate"
                        />
                        
                        <button
                          onClick={() => handleDeleteTrack(track.id)}
                          title="删除此轨道"
                          className="text-slate-500 hover:text-rose-400 p-0.5 rounded transition-all cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Controls Mute / Solo / Vol */}
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {/* Mute Button */}
                        <button
                          onClick={() => updateTrackProp(track.id, 'muted', !track.muted)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border transition-all cursor-pointer ${
                            track.muted 
                              ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' 
                              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                          }`}
                          title="静音这轨 (Mute)"
                        >
                          M
                        </button>

                        {/* Solo Button */}
                        <button
                          onClick={() => updateTrackProp(track.id, 'solo', !track.solo)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border transition-all cursor-pointer ${
                            track.solo 
                              ? 'bg-amber-400 text-slate-950 border-amber-400' 
                              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                          }`}
                          title="独奏这轨 (Solo)"
                        >
                          S
                        </button>

                        {/* Volume icon and slider */}
                        <div className="flex items-center gap-1 ml-1 flex-1 min-w-0">
                          {track.muted ? (
                            <VolumeX className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                          ) : track.volume === 0 ? (
                            <VolumeX className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          ) : track.volume < 40 ? (
                            <Volume1 className="w-3.5 h-3.5 text-emerald-500/70 shrink-0" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          )}
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={track.volume}
                            onChange={(e) => updateTrackProp(track.id, 'volume', parseInt(e.target.value))}
                            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>
                      </div>

                    </div>

                    {/* Track Wave Lane content */}
                    <div 
                      className={`flex-1 relative bg-slate-900/30 duration-200 overflow-hidden ${
                        isDragOverTrack ? 'bg-slate-800/40 border-y border-emerald-500/20' : ''
                      }`}
                      style={{ width: `${TIMELINE_MAX_SECONDS * ZOOM_PX_PER_SECOND}px` }}
                    >
                      {/* Grid background ticks lines */}
                      <div className="absolute inset-0 pointer-events-none flex">
                        {rulerTicks.map(tick => (
                          <div 
                            key={tick}
                            className="absolute top-0 bottom-0 w-px border-l border-slate-800/30"
                            style={{ left: `${tick * ZOOM_PX_PER_SECOND}px` }}
                          />
                        ))}
                      </div>

                      {/* Display loaded Audio Clips in this track */}
                      {track.clips.map((clip) => {
                        const isSelected = selectedClip?.trackId === track.id && selectedClip?.clipId === clip.id;
                        const isThisClipDragging = draggingClip?.trackId === track.id && draggingClip?.clipId === clip.id;
                        
                        // Calculate real-time coordinates
                        let startPos = clip.startTime * ZOOM_PX_PER_SECOND;
                        if (isThisClipDragging && dragOverInfo && dragOverInfo.trackId === track.id) {
                          startPos = dragOverInfo.targetStartTime * ZOOM_PX_PER_SECOND;
                        }

                        const widthPos = clip.duration * ZOOM_PX_PER_SECOND;

                        return (
                          <div
                            key={clip.id}
                            onMouseDown={(e) => onClipMouseDown(e, track.id, clip.id, clip.startTime)}
                            className={`absolute top-2 bottom-2 rounded-lg border px-3 py-1.5 flex flex-col justify-between cursor-grab active:cursor-grabbing transition-shadow overflow-hidden group select-none ${
                              clip.color
                            } ${
                              isSelected ? 'ring-2 ring-emerald-500 shadow-md border-transparent' : 'shadow-sm'
                            } ${
                              isThisClipDragging ? 'opacity-40 scale-[0.98]' : ''
                            }`}
                            style={{ 
                              left: `${startPos}px`, 
                              width: `${widthPos}px`,
                              minWidth: '24px'
                            }}
                          >
                            {/* Waveform graphic inside clip block */}
                            <svg 
                              viewBox="0 0 200 100" 
                              preserveAspectRatio="none" 
                              className="absolute inset-0 w-full h-full opacity-35 pointer-events-none"
                            >
                              <path 
                                d={renderClipWaveform(clip.buffer)} 
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                              />
                            </svg>

                            {/* Diagonal Fade-in Visual Zone */}
                            {clip.fadeIn && clip.fadeIn > 0 ? (
                              <div 
                                className="absolute left-0 top-0 bottom-0 bg-gradient-to-tr from-black/20 via-black/5 to-transparent pointer-events-none border-r border-dashed border-black/20"
                                style={{ width: `${clip.fadeIn * ZOOM_PX_PER_SECOND}px` }}
                                title={`淡入: ${clip.fadeIn}s`}
                              />
                            ) : null}

                            {/* Diagonal Fade-out Visual Zone */}
                            {clip.fadeOut && clip.fadeOut > 0 ? (
                              <div 
                                className="absolute right-0 top-0 bottom-0 bg-gradient-to-tl from-black/20 via-black/5 to-transparent pointer-events-none border-l border-dashed border-black/20"
                                style={{ width: `${clip.fadeOut * ZOOM_PX_PER_SECOND}px` }}
                                title={`淡出: ${clip.fadeOut}s`}
                              />
                            ) : null}

                            {/* Clip Title and Info */}
                            <div className="relative z-10 flex items-center justify-between gap-1">
                              <span className="text-[10px] font-bold truncate pr-1 text-slate-800/90 leading-tight">
                                {clip.name}
                              </span>
                              <span className="text-[9px] font-mono font-medium shrink-0 bg-slate-900/10 px-1 rounded">
                                {clip.duration.toFixed(1)}s
                              </span>
                            </div>

                            {/* Position hint */}
                            <div className="relative z-10 text-[8px] font-mono text-slate-700/80">
                              起: {clip.startTime.toFixed(2)}s
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Guide Help Card info */}
      <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-5 flex items-start gap-4">
        <Sparkles className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <h4 className="text-xs font-bold text-emerald-800">智能音频工作室剪裁拼接指南：</h4>
          <ul className="text-[11px] text-emerald-700/90 list-disc list-inside space-y-1 leading-relaxed">
            <li><strong>导入音频</strong>: 点击 DAW 顶部工具栏里的“导入音频”选择一个或多个 MP3/WAV，文件会被加载并解码成真正的波形。</li>
            <li><strong>移动位置</strong>: 鼠标按住彩色音频片段块，即可<strong>任意左右拖动</strong>到指定的时间。</li>
            <li><strong>移动轨道</strong>: 将彩色片段<strong>上下拖动</strong>即可直接跨轨道重组混流。</li>
            <li><strong>精准切分(剪切)</strong>: 拖拽或在时间轴点一下红线播放头，点击已选片段，然后点击上方“剪切拆分”，可实现完美物理剪断！</li>
            <li><strong>音量与静音/独奏</strong>: 调节对应轨道左侧的 M (静音) 或 S (独奏) 按钮，可灵活排他性试听指定声音层。</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
