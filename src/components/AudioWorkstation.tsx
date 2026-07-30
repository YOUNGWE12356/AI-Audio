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
  Sparkles,
  MousePointer2,
  Eraser,
  Magnet,
  Copy,
  RotateCcw
} from 'lucide-react';
import { encodeMp3, encodeWav, resampleAudioBuffer } from '../services/audioEncoderService';

interface AudioClip {
  id: string;
  name: string;
  startTime: number; // in seconds from track start
  duration: number;  // in seconds
  buffer: AudioBuffer;
  color: string;     // Tailwind classes for bg/border
  fadeIn?: number;   // fade in duration in seconds
  fadeOut?: number;  // fade out duration in seconds
  gain?: number;     // event gain, 0 to 200
  muted?: boolean;   // event mute
}

interface AudioTrack {
  id: string;
  name: string;
  volume: number;    // 0 to 100
  pan: number;       // -100 left to 100 right
  muted: boolean;
  solo: boolean;
  clips: AudioClip[];
}

interface ClipClipboard {
  clip: AudioClip;
  sourceTrackId: string;
}

type ToolMode = 'select' | 'split' | 'erase' | 'mute';
type ResizeEdge = 'left' | 'right';
type WorkstationExportFormat = 'wav' | 'mp3';
type WorkstationBitDepth = 16 | 24 | 32;

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

const WORKSTATION_SAMPLE_RATE = 48000;
const WORKSTATION_BIT_DEPTH: WorkstationBitDepth = 24;

export default function AudioWorkstation() {
  // Web Audio Context reference
  const audioCtxRef = useRef<AudioContext | null>(null);
  
  // Tracks state
  const [tracks, setTracks] = useState<AudioTrack[]>([
    { id: 'track-1', name: '人声主轨', volume: 80, pan: 0, muted: false, solo: false, clips: [] },
    { id: 'track-2', name: '伴奏轨', volume: 60, pan: 0, muted: false, solo: false, clips: [] },
  ]);

  // Global Transport States
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0); // Playhead in seconds
  const [selectedClip, setSelectedClip] = useState<{ trackId: string; clipId: string } | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [isDecoding, setIsDecoding] = useState<boolean>(false);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [snapStep, setSnapStep] = useState<number>(0.1);
  const [exportFormat, setExportFormat] = useState<WorkstationExportFormat>('wav');
  const [exportSampleRate, setExportSampleRate] = useState<number>(WORKSTATION_SAMPLE_RATE);
  const [exportBitrate, setExportBitrate] = useState<number>(192);
  const [exportBitDepth, setExportBitDepth] = useState<WorkstationBitDepth>(WORKSTATION_BIT_DEPTH);
  const [showExportSetup, setShowExportSetup] = useState<boolean>(false);
  const [copiedClip, setCopiedClip] = useState<ClipClipboard | null>(null);

  // Timeline configuration
  const ZOOM_PX_PER_SECOND = 20; // 1 second = 20 pixels
  const TIMELINE_MAX_SECONDS = 180; // default 3 minutes, expands dynamically
  const trackLaneHeight = 104; // px for precise drag calculations
  const TRACK_HEADER_WIDTH = 248;
  const TIMELINE_CONTENT_WIDTH = TIMELINE_MAX_SECONDS * ZOOM_PX_PER_SECOND;
  
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

  const [fadeDrag, setFadeDrag] = useState<{
    trackId: string;
    clipId: string;
    edge: 'in' | 'out';
    startX: number;
    initialFade: number;
    clipDuration: number;
  } | null>(null);

  const [resizeDrag, setResizeDrag] = useState<{
    trackId: string;
    clipId: string;
    edge: ResizeEdge;
    startX: number;
    originalStartTime: number;
    originalDuration: number;
    originalBuffer: AudioBuffer;
  } | null>(null);

  const clampFade = (value: number, duration: number) => (
    Math.max(0, Math.min(duration / 2, value))
  );

  const snapTime = (time: number) => {
    if (!snapEnabled || snapStep <= 0) return Math.max(0, time);
    return Math.max(0, parseFloat((Math.round(time / snapStep) * snapStep).toFixed(3)));
  };

  const clampClipGain = (value: number) => Math.max(0, Math.min(200, value));

  const formatPanLabel = (pan: number) => {
    if (pan === 0) return 'C';
    return pan < 0 ? `L${Math.abs(pan)}` : `R${pan}`;
  };

  const isEditableKeyboardTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName.toLowerCase();
    return (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      target.isContentEditable
    );
  };

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
    const baseGain = clampClipGain(clip.gain ?? 100) / 100;

    // Helper to map absolute timeline time (s) to ctx.currentTime
    const getCtxTime = (timelineTime: number) => {
      return ctx.currentTime + Math.max(0, timelineTime - playheadTime);
    };

    // Ensure default initial state at ctx.currentTime uses event gain.
    clipGain.gain.setValueAtTime(baseGain, ctx.currentTime);

    // Apply Fade In
    if (fadeIn > 0) {
      const fadeInEnd = clipStart + fadeIn;
      if (clipStart >= playheadTime) {
        // Fade starts in the future relative to the playhead
        const startCtxTime = getCtxTime(clipStart);
        const endCtxTime = getCtxTime(fadeInEnd);
        
        clipGain.gain.setValueAtTime(0, startCtxTime);
        clipGain.gain.linearRampToValueAtTime(baseGain, endCtxTime);
      } else if (playheadTime < fadeInEnd) {
        // Currently starting in the middle of a fade-in
        const currentProgress = (playheadTime - clipStart) / fadeIn;
        const endCtxTime = getCtxTime(fadeInEnd);
        
        clipGain.gain.setValueAtTime(currentProgress * baseGain, ctx.currentTime);
        clipGain.gain.linearRampToValueAtTime(baseGain, endCtxTime);
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
        clipGain.gain.setValueAtTime(baseGain, startCtxTime);
        clipGain.gain.linearRampToValueAtTime(0.0, endCtxTime);
      } else if (playheadTime < clipEnd) {
        // Currently starting in the middle of a fade-out
        const currentProgress = 1.0 - (playheadTime - fadeOutStart) / fadeOut;
        const endCtxTime = getCtxTime(clipEnd);
        
        clipGain.gain.setValueAtTime(Math.max(0, currentProgress) * baseGain, ctx.currentTime);
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

      // Track Gain + Pan nodes for Cubase-style channel control
      const trackGain = ctx.createGain();
      const trackPan = ctx.createStereoPanner();
      trackGain.gain.value = track.volume / 100;
      trackPan.pan.value = track.pan / 100;
      trackGain.connect(trackPan);
      trackPan.connect(ctx.destination);

      track.clips.forEach(clip => {
        if (clip.muted) return;
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
    const time = snapTime(Math.max(0, clickX / ZOOM_PX_PER_SECOND));
    
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
      { id: nextId, name: `音频轨 ${nextNum}`, volume: 80, pan: 0, muted: false, solo: false, clips: [] }
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

    // Apply channel-strip changes immediately during playback.
    if (['volume', 'pan', 'muted', 'solo'].includes(String(prop)) && isPlaying) {
      handlePause();
      setTimeout(() => handlePlay(), 30);
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

  const splitClipAtTime = (trackId: string, clipId: string, splitTime: number) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    
    const clip = track.clips.find(c => c.id === clipId);
    if (!clip) return;

    // Check if playhead is within clip boundaries
    if (splitTime > clip.startTime && splitTime < clip.startTime + clip.duration) {
      const ctx = getAudioContext();
      const splitOffset = splitTime - clip.startTime; // offset inside clip
      
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
          fadeOut: 0,
          gain: clip.gain ?? 100,
          muted: clip.muted
        };

        const clip2: AudioClip = {
          id: clip2Id,
          name: `${clip.name} (后)`,
          startTime: splitTime,
          duration: clip.duration - splitOffset,
          buffer: buffer2,
          color: clip.color,
          fadeIn: 0,
          fadeOut: clip.fadeOut ? Math.min(clip.fadeOut, clip.duration - splitOffset) : 0,
          gain: clip.gain ?? 100,
          muted: clip.muted
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

  // Split clip at current playhead position
  const handleSplitClip = () => {
    if (!selectedClip) return;
    splitClipAtTime(selectedClip.trackId, selectedClip.clipId, currentTime);
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

  const updateSelectedClip = (updater: (clip: AudioClip) => AudioClip) => {
    if (!selectedClip) return;
    const updated = tracks.map(t => (
      t.id !== selectedClip.trackId
        ? t
        : {
            ...t,
            clips: t.clips.map(c => c.id === selectedClip.clipId ? updater(c) : c)
          }
    ));
    setTracks(updated);
    if (isPlaying) {
      handlePause();
      setTimeout(() => handlePlay(), 50);
    }
  };

  const handleDuplicateClip = () => {
    if (!selectedClip) return;
    const track = tracks.find(t => t.id === selectedClip.trackId);
    const clip = track?.clips.find(c => c.id === selectedClip.clipId);
    if (!track || !clip) return;
    const duplicatedClip: AudioClip = {
      ...clip,
      id: `clip-${Date.now()}-copy`,
      name: `${clip.name} Copy`,
      startTime: snapTime(clip.startTime + clip.duration)
    };
    setTracks(tracks.map(t => (
      t.id === track.id ? { ...t, clips: [...t.clips, duplicatedClip] } : t
    )));
    setSelectedClip({ trackId: track.id, clipId: duplicatedClip.id });
  };

  const handleCopySelectedClip = () => {
    if (!selectedClip) return false;
    const track = tracks.find(t => t.id === selectedClip.trackId);
    const clip = track?.clips.find(c => c.id === selectedClip.clipId);
    if (!track || !clip) return false;

    setCopiedClip({
      sourceTrackId: track.id,
      clip: { ...clip }
    });
    return true;
  };

  const handlePasteCopiedClip = () => {
    if (!copiedClip || tracks.length === 0) return false;

    const selectedTrackExists = selectedClip
      ? tracks.some(track => track.id === selectedClip.trackId)
      : false;
    const sourceTrackExists = tracks.some(track => track.id === copiedClip.sourceTrackId);
    const targetTrackId = selectedTrackExists
      ? selectedClip!.trackId
      : sourceTrackExists
        ? copiedClip.sourceTrackId
        : tracks[0].id;

    const pastedClip: AudioClip = {
      ...copiedClip.clip,
      id: `clip-${Date.now()}-paste`,
      name: `${copiedClip.clip.name} Copy`,
      startTime: snapTime(currentTime)
    };

    setTracks(tracks.map(track => (
      track.id === targetTrackId
        ? { ...track, clips: [...track.clips, pastedClip] }
        : track
    )));
    setSelectedClip({ trackId: targetTrackId, clipId: pastedClip.id });

    if (isPlaying) {
      handlePause();
      setTimeout(() => handlePlay(), 50);
    }

    return true;
  };

  const handleToggleSelectedClipMute = () => {
    updateSelectedClip(clip => ({ ...clip, muted: !clip.muted }));
  };

  useEffect(() => {
    const handleKeyboardShortcuts = (event: KeyboardEvent) => {
      if (showExportSetup || isEditableKeyboardTarget(event.target)) return;

      if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (event.repeat) return;
        if (isPlayingRef.current) {
          handlePause();
        } else {
          handlePlay();
        }
        return;
      }

      const isCopyOrPaste = event.ctrlKey || event.metaKey;
      if (!isCopyOrPaste || event.altKey || event.repeat) return;

      const key = event.key.toLowerCase();
      if (key === 'c') {
        if (handleCopySelectedClip()) {
          event.preventDefault();
        }
        return;
      }

      if (key === 'v') {
        if (handlePasteCopiedClip()) {
          event.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyboardShortcuts);
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
  }, [showExportSetup, selectedClip, tracks, copiedClip, currentTime, isPlaying]);

  const createNormalizedBuffer = (buffer: AudioBuffer): AudioBuffer => {
    const ctx = getAudioContext();
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        peak = Math.max(peak, Math.abs(data[i]));
      }
    }
    if (peak <= 0) return buffer;
    const gain = Math.min(8, 0.95 / peak);
    const nextBuffer = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const source = buffer.getChannelData(channel);
      const target = nextBuffer.getChannelData(channel);
      for (let i = 0; i < source.length; i++) {
        target[i] = Math.max(-1, Math.min(1, source[i] * gain));
      }
    }
    return nextBuffer;
  };

  const createReversedBuffer = (buffer: AudioBuffer): AudioBuffer => {
    const ctx = getAudioContext();
    const nextBuffer = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const source = buffer.getChannelData(channel);
      const target = nextBuffer.getChannelData(channel);
      for (let i = 0; i < source.length; i++) {
        target[i] = source[source.length - 1 - i];
      }
    }
    return nextBuffer;
  };

  const handleNormalizeSelectedClip = () => {
    updateSelectedClip(clip => ({
      ...clip,
      buffer: createNormalizedBuffer(clip.buffer),
      gain: 100,
      name: `${clip.name} · Norm`
    }));
  };

  const handleReverseSelectedClip = () => {
    updateSelectedClip(clip => ({
      ...clip,
      buffer: createReversedBuffer(clip.buffer),
      name: `${clip.name} · Rev`
    }));
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
        const workstationBuffer = decodedBuffer.sampleRate === WORKSTATION_SAMPLE_RATE
          ? decodedBuffer
          : await resampleAudioBuffer(decodedBuffer, WORKSTATION_SAMPLE_RATE);
        newClips.push({ file, buffer: workstationBuffer });
      } catch (err) {
        console.error(`Error decoding file ${file.name}:`, err);
        alert(`无法加载 ${file.name}，文件损坏或格式不受系统支持。`);
      }
    }

    if (newClips.length > 0 && tracks.length > 0) {
      setExportFormat('wav');
      setExportSampleRate(WORKSTATION_SAMPLE_RATE);
      setExportBitDepth(WORKSTATION_BIT_DEPTH);
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
          fadeOut: 0,
          gain: 100,
          muted: false
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

    if (toolMode === 'split') {
      const rect = e.currentTarget.getBoundingClientRect();
      const splitTime = snapTime(startTime + (e.clientX - rect.left) / ZOOM_PX_PER_SECOND);
      splitClipAtTime(trackId, clipId, splitTime);
      return;
    }

    if (toolMode === 'erase') {
      setTracks(tracks.map(track => (
        track.id === trackId
          ? { ...track, clips: track.clips.filter(clip => clip.id !== clipId) }
          : track
      )));
      setSelectedClip(null);
      if (isPlaying) {
        handlePause();
        setTimeout(() => handlePlay(), 50);
      }
      return;
    }

    if (toolMode === 'mute') {
      setTracks(tracks.map(track => (
        track.id === trackId
          ? {
              ...track,
              clips: track.clips.map(clip => (
                clip.id === clipId ? { ...clip, muted: !clip.muted } : clip
              ))
            }
          : track
      )));
      if (isPlaying) {
        handlePause();
        setTimeout(() => handlePlay(), 50);
      }
      return;
    }

    setDraggingClip({
      trackId,
      clipId,
      originalStartTime: startTime,
      startX: e.clientX,
      startY: e.clientY
    });
  };

  const onFadeHandleMouseDown = (
    e: React.MouseEvent,
    trackId: string,
    clipId: string,
    edge: 'in' | 'out'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const track = tracks.find(t => t.id === trackId);
    const clip = track?.clips.find(c => c.id === clipId);
    if (!clip) return;

    setSelectedClip({ trackId, clipId });
    setFadeDrag({
      trackId,
      clipId,
      edge,
      startX: e.clientX,
      initialFade: edge === 'in' ? (clip.fadeIn || 0) : (clip.fadeOut || 0),
      clipDuration: clip.duration
    });
  };

  const onResizeHandleMouseDown = (
    e: React.MouseEvent,
    trackId: string,
    clipId: string,
    edge: ResizeEdge
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const track = tracks.find(t => t.id === trackId);
    const clip = track?.clips.find(c => c.id === clipId);
    if (!clip) return;

    setSelectedClip({ trackId, clipId });
    setResizeDrag({
      trackId,
      clipId,
      edge,
      startX: e.clientX,
      originalStartTime: clip.startTime,
      originalDuration: clip.duration,
      originalBuffer: clip.buffer
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!fadeDrag) return;

      const deltaTime = (e.clientX - fadeDrag.startX) / ZOOM_PX_PER_SECOND;
      const nextFade = fadeDrag.edge === 'in'
        ? clampFade(fadeDrag.initialFade + deltaTime, fadeDrag.clipDuration)
        : clampFade(fadeDrag.initialFade - deltaTime, fadeDrag.clipDuration);
      const roundedFade = parseFloat(nextFade.toFixed(2));

      setTracks(prev => prev.map(track => (
        track.id !== fadeDrag.trackId
          ? track
          : {
              ...track,
              clips: track.clips.map(clip => (
                clip.id === fadeDrag.clipId
                  ? {
                      ...clip,
                      ...(fadeDrag.edge === 'in'
                        ? { fadeIn: roundedFade }
                        : { fadeOut: roundedFade })
                    }
                  : clip
              ))
            }
      )));
    };

    const handleMouseUp = () => {
      if (fadeDrag && isPlaying) {
        handlePause();
        setTimeout(() => handlePlay(), 50);
      }
      setFadeDrag(null);
    };

    if (fadeDrag) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [fadeDrag, isPlaying]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeDrag) return;

      const ctx = getAudioContext();
      const rawDelta = (e.clientX - resizeDrag.startX) / ZOOM_PX_PER_SECOND;
      let nextStart = resizeDrag.originalStartTime;
      let nextDuration = resizeDrag.originalDuration;
      let nextBuffer = resizeDrag.originalBuffer;

      if (resizeDrag.edge === 'left') {
        const trimStart = Math.max(0, Math.min(resizeDrag.originalDuration - 0.1, rawDelta));
        nextStart = snapTime(resizeDrag.originalStartTime + trimStart);
        const effectiveTrim = Math.max(0, nextStart - resizeDrag.originalStartTime);
        nextDuration = Math.max(0.1, resizeDrag.originalDuration - effectiveTrim);
        nextBuffer = sliceAudioBuffer(ctx, resizeDrag.originalBuffer, effectiveTrim, resizeDrag.originalDuration);
      } else {
        const rawDuration = resizeDrag.originalDuration + Math.min(0, rawDelta);
        nextDuration = Math.max(0.1, Math.min(resizeDrag.originalDuration, snapTime(rawDuration)));
        nextBuffer = sliceAudioBuffer(ctx, resizeDrag.originalBuffer, 0, nextDuration);
      }

      setTracks(prev => prev.map(track => (
        track.id !== resizeDrag.trackId
          ? track
          : {
              ...track,
              clips: track.clips.map(clip => (
                clip.id === resizeDrag.clipId
                  ? {
                      ...clip,
                      startTime: nextStart,
                      duration: nextDuration,
                      buffer: nextBuffer,
                      fadeIn: clampFade(clip.fadeIn || 0, nextDuration),
                      fadeOut: clampFade(clip.fadeOut || 0, nextDuration)
                    }
                  : clip
              ))
            }
      )));
    };

    const handleMouseUp = () => {
      if (resizeDrag && isPlaying) {
        handlePause();
        setTimeout(() => handlePlay(), 50);
      }
      setResizeDrag(null);
    };

    if (resizeDrag) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizeDrag, isPlaying]);

  // Mouse move and drag implementation
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingClip) return;
      
      const dx = e.clientX - draggingClip.startX;
      const deltaTime = dx / ZOOM_PX_PER_SECOND;
      let newTime = Math.max(0, draggingClip.originalStartTime + deltaTime);
      
      newTime = snapTime(newTime);

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
    setShowExportSetup(false);

    const targetSampleRate = exportSampleRate;
    const OfflineContext = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    if (!OfflineContext) {
      alert("当前浏览器不支持离线渲染合成音频。");
      setIsExporting(false);
      setShowExportSetup(false);
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
      const trackPan = offlineCtx.createStereoPanner();
      trackGain.gain.value = track.volume / 100;
      trackPan.pan.value = track.pan / 100;
      trackGain.connect(trackPan);
      trackPan.connect(offlineCtx.destination);

      track.clips.forEach(clip => {
        if (clip.muted) return;
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

      const finalBlob = exportFormat === 'mp3'
        ? encodeMp3(renderedBuffer, exportBitrate)
        : encodeWav(renderedBuffer, exportBitDepth);
      setExportProgress(100);

      const downloadUrl = URL.createObjectURL(finalBlob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      const exportLabel = exportFormat === 'mp3'
        ? `${exportSampleRate}_${exportBitrate}kbps`
        : `${exportSampleRate}_${exportBitDepth}bit`;
      link.download = `DAW_混音输出_${exportLabel}_${new Date().toISOString().slice(0, 10)}.${exportFormat}`;
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
      setShowExportSetup(false);
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
    <div
      id="audio-workstation"
      className="overflow-hidden rounded-2xl border border-slate-800 bg-[#11161d] text-slate-200 shadow-2xl"
    >
      {/* Cubase-like application chrome */}
      <div className="border-b border-slate-800 bg-[#242a33]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
              <Layers className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-black tracking-tight text-slate-100">多轨音频工作站</h2>
                <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-sky-300">
                  Cubase Style
                </span>
              </div>
              <p className="mt-0.5 truncate text-[10px] text-slate-500">
                Project · Edit · Audio · Transport · Studio · MixConsole
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isDecoding}
              className="flex items-center gap-2 rounded-md border border-emerald-400 bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-sm transition-all hover:bg-emerald-400 disabled:border-slate-800 disabled:bg-slate-800 disabled:text-slate-500 cursor-pointer"
            >
              {isDecoding ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                  <span>解码中...</span>
                </span>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  <span>导入音频</span>
                </>
              )}
            </button>
            <button
              onClick={() => setShowExportSetup(true)}
              disabled={totalClipsCount === 0 || isExporting}
              className="flex items-center gap-2 rounded-md border border-slate-700 bg-[#151a21] px-3.5 py-2 text-xs font-bold text-slate-200 shadow-sm transition-all hover:border-emerald-500 hover:text-emerald-300 disabled:bg-slate-900 disabled:text-slate-600 disabled:border-slate-800 disabled:cursor-not-allowed cursor-pointer"
            >
              {isExporting ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
                  <span>混音 {exportProgress}%</span>
                </span>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  <span>导出音频</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main DAW Viewport */}
      <div className="bg-[#111827] overflow-hidden text-slate-200">
        
        {/* Top Control Panel Toolbar */}
        <div className="bg-[#171c23] px-4 py-2 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
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
              className={`h-9 w-9 rounded-md cursor-pointer transition-all flex items-center justify-center border ${
                isPlaying 
                  ? 'border-amber-400 bg-amber-500 hover:bg-amber-600 text-slate-950'
                  : 'border-emerald-400 bg-emerald-500 hover:bg-emerald-600 text-slate-950'
              }`}
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>
            
            <button
              onClick={handleStop}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 bg-[#222832] text-slate-300 transition-all hover:bg-slate-700 cursor-pointer"
              title="重置到起点"
            >
              <Square className="w-5 h-5 fill-current" />
            </button>

            {/* Time Indicator */}
            <div className="min-w-32 rounded border border-slate-700 bg-black px-3.5 py-1.5 text-center font-mono text-sm font-black tracking-widest text-red-400 shadow-inner">
              {formatTimeStr(currentTime)}
            </div>

            <div className="ml-2 flex items-center rounded-md border border-slate-800 bg-[#10151c] p-1">
              {([
                { id: 'select', label: '选择', icon: MousePointer2 },
                { id: 'split', label: '剪刀', icon: Scissors },
                { id: 'erase', label: '橡皮', icon: Eraser },
                { id: 'mute', label: '静音事件', icon: VolumeX },
              ] as const).map(tool => {
                const ToolIcon = tool.icon;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => setToolMode(tool.id)}
                    title={tool.label}
                    className={`flex h-7 w-7 items-center justify-center rounded transition-all ${
                      toolMode === tool.id
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-500 hover:bg-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <ToolIcon className="h-3.5 w-3.5" />
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-[#10151c] px-2 py-1">
              <button
                type="button"
                onClick={() => setSnapEnabled(value => !value)}
                className={`flex items-center gap-1 text-[10px] font-bold ${
                  snapEnabled ? 'text-sky-300' : 'text-slate-500'
                }`}
                title="Snap / 吸附网格"
              >
                <Magnet className="h-3.5 w-3.5" />
                <span>SNAP</span>
              </button>
              <select
                value={snapStep}
                onChange={(e) => setSnapStep(Number(e.target.value))}
                disabled={!snapEnabled}
                className="rounded border border-slate-800 bg-[#171c23] px-1.5 py-0.5 font-mono text-[10px] text-slate-300 outline-none disabled:opacity-40"
                title="Snap step"
              >
                <option value={0.05}>0.05s</option>
                <option value={0.1}>0.1s</option>
                <option value={0.25}>0.25s</option>
                <option value={0.5}>0.5s</option>
                <option value={1}>1s</option>
              </select>
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
                  className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#222832] px-3 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-emerald-600 hover:text-white cursor-pointer"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>剪切拆分</span>
                </button>

                <button
                  onClick={handleDeleteClip}
                  title="删除选中的音频片段"
                  className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#222832] px-3 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-rose-600 hover:text-white cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>删除片段</span>
                </button>

                <button
                  onClick={handleDuplicateClip}
                  title="Duplicate Event / 复制事件"
                  className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#222832] px-3 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-sky-600 hover:text-white cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>复制</span>
                </button>

                <button
                  onClick={handleToggleSelectedClipMute}
                  title="Mute Event / 静音事件"
                  className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#222832] px-3 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-yellow-500 hover:text-slate-950 cursor-pointer"
                >
                  <VolumeX className="w-3.5 h-3.5" />
                  <span>事件静音</span>
                </button>

                <button
                  onClick={handleNormalizeSelectedClip}
                  title="Normalize Event / 标准化"
                  className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#222832] px-3 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-emerald-600 hover:text-white cursor-pointer"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>Normalize</span>
                </button>

                <button
                  onClick={handleReverseSelectedClip}
                  title="Reverse Event / 反向"
                  className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#222832] px-3 py-2 text-xs font-bold text-slate-300 transition-all hover:bg-indigo-600 hover:text-white cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reverse</span>
                </button>
              </>
            ) : (
              <div className="text-xs text-slate-500 italic flex items-center gap-1">
                <Info className="w-3.5 h-3.5" />
                <span>提示: 点击轨道上的彩色音频块可激活剪切、删除或进行左右拖移。</span>
              </div>
            )}

          </div>
        </div>

        {/* Selected Clip Properties Row: Fade-in / Fade-out duration slider */}
        {selectedClip && (() => {
          const track = tracks.find(t => t.id === selectedClip.trackId);
          const clip = track?.clips.find(c => c.id === selectedClip.clipId);
          if (!clip) return null;
          
          return (
            <div className="bg-[#1d232c] border-b border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
                  <Sparkles className="w-3.5 h-3.5" />
                </span>
                <div>
                  <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-500">Info Line / Selected Audio Event</div>
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
                    className="mt-1 w-56 rounded border border-slate-700 bg-[#11161d] px-2.5 py-1 text-xs font-bold text-slate-200 outline-none transition-all focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Envelope Adjusters: Fade In & Fade Out */}
              <div className="flex flex-wrap items-center gap-3 flex-1 justify-end">
                <div className="flex min-w-[160px] flex-col gap-1 rounded border border-slate-800 bg-[#151a21] p-2">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                    <span>Event Gain</span>
                    <span className="font-mono font-bold text-sky-300">{clip.muted ? 'Muted' : `${clip.gain ?? 100}%`}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    step="1"
                    value={clip.gain ?? 100}
                    disabled={clip.muted}
                    onChange={(e) => {
                      const val = clampClipGain(parseInt(e.target.value, 10));
                      updateSelectedClip(c => ({ ...c, gain: val }));
                    }}
                    className="h-1 rounded-lg bg-slate-800 accent-sky-400 cursor-pointer disabled:opacity-40"
                  />
                </div>

                {/* Fade In slider */}
                <div className="flex min-w-[170px] flex-col gap-1 rounded border border-slate-800 bg-[#151a21] p-2">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                    <span className="flex items-center gap-1">Fade In</span>
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
                <div className="flex min-w-[170px] flex-col gap-1 rounded border border-slate-800 bg-[#151a21] p-2">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                    <span className="flex items-center gap-1">Fade Out</span>
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
                <div className="hidden sm:flex flex-col items-center justify-center p-2 bg-[#11161d] border border-slate-800 rounded w-32 h-14 relative overflow-hidden shrink-0">
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
        <div className="relative flex min-h-[460px] flex-col overflow-x-auto select-none bg-[#0f141b]">
          
          {/* Absolute Playhead indicator */}
          <div 
            className="absolute top-8 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none transition-transform duration-75"
            style={{ 
              left: `${TRACK_HEADER_WIDTH + currentTime * ZOOM_PX_PER_SECOND}px`,
              boxShadow: '0 0 8px #ef4444'
            }}
          />

          {/* Time ruler (Ruler clicks) */}
          <div className="flex bg-[#151a21] border-b border-slate-800 shrink-0 h-8">
            {/* Header placeholder spacer */}
            <div
              className="border-r border-slate-800 shrink-0 bg-[#151a21] h-full flex items-center px-4"
              style={{ width: `${TRACK_HEADER_WIDTH}px` }}
            >
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">timeline</span>
            </div>

            {/* Scale markings container */}
            <div 
              onClick={handleRulerClick}
              className="relative h-full shrink-0 cursor-ew-resize bg-[#111923]"
              style={{ width: `${TIMELINE_CONTENT_WIDTH}px` }}
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
            <div className="flex flex-col flex-1 divide-y divide-slate-800 bg-[#101720]">
              {tracks.map((track, trackIndex) => {
                const isDragOverTrack = dragOverInfo?.trackId === track.id;

                return (
                  <div 
                    key={track.id} 
                    className="flex shrink-0 relative duration-100 transition-colors"
                    style={{ height: `${trackLaneHeight}px` }}
                  >
                    {/* Cubase-inspired Track Controller Header */}
                    <div
                      className="bg-[#20252d] border-r border-slate-800 shrink-0 z-10 shadow-md"
                      style={{ width: `${TRACK_HEADER_WIDTH}px` }}
                    >
                      <div className="flex h-full">
                        <div className="flex w-8 shrink-0 flex-col items-center justify-between border-r border-slate-800 bg-[#171b21] py-2">
                          <span className="font-mono text-[10px] font-bold text-slate-500">{trackIndex + 1}</span>
                          <Layers className="h-3.5 w-3.5 text-slate-500" />
                        </div>
                        <div className="grid min-w-0 flex-1 grid-rows-[22px_24px_18px_18px] gap-1 p-1">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={track.name}
                              onChange={(e) => updateTrackProp(track.id, 'name', e.target.value)}
                              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-bold text-slate-200 outline-none hover:border-slate-700 hover:bg-slate-900 focus:border-emerald-500 focus:bg-slate-950"
                            />
                            <button
                              onClick={() => handleDeleteTrack(track.id)}
                              title="删除此轨道"
                              className="rounded p-0.5 text-slate-500 transition-all hover:bg-rose-500/10 hover:text-rose-400 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-4 gap-1">
                            <button
                              onClick={() => updateTrackProp(track.id, 'muted', !track.muted)}
                              className={`h-6 rounded-sm border text-[10px] font-black transition-all cursor-pointer ${
                                track.muted
                                  ? 'border-yellow-400 bg-yellow-400 text-slate-950 shadow-[0_0_10px_rgba(250,204,21,0.35)]'
                                  : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                              }`}
                              title="Mute / 静音"
                            >
                              M
                            </button>
                            <button
                              onClick={() => updateTrackProp(track.id, 'solo', !track.solo)}
                              className={`h-6 rounded-sm border text-[10px] font-black transition-all cursor-pointer ${
                                track.solo
                                  ? 'border-emerald-400 bg-emerald-400 text-slate-950 shadow-[0_0_10px_rgba(52,211,153,0.35)]'
                                  : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                              }`}
                              title="Solo / 独奏"
                            >
                              S
                            </button>
                            <button
                              type="button"
                              className="h-6 rounded-sm border border-red-900/60 bg-red-950/20 text-[10px] font-black text-red-400/70"
                              title="Record Enable / 录音预备（UI占位）"
                            >
                              R
                            </button>
                            <button
                              type="button"
                              className="h-6 rounded-sm border border-slate-700 bg-slate-900 text-[10px] font-black text-slate-500"
                              title="Automation Write / 自动化写入（UI占位）"
                            >
                              W
                            </button>
                          </div>

                          <div className="grid grid-cols-[16px_1fr_28px] items-center gap-1.5">
                            {track.muted || track.volume === 0 ? (
                              <VolumeX className="w-3.5 h-3.5 text-slate-600 shrink-0" />
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
                              className="min-w-0 h-1 rounded-lg bg-slate-800 accent-emerald-500 cursor-pointer"
                              title={`Volume ${track.volume}%`}
                            />
                            <span className="rounded bg-slate-950 px-1 py-0.5 text-right font-mono text-[9px] text-slate-400">
                              {track.volume}
                            </span>
                          </div>

                          <div className="grid grid-cols-[22px_1fr_28px] items-center gap-1.5">
                            <span className="font-mono text-[9px] font-bold text-slate-500">PAN</span>
                            <input
                              type="range"
                              min="-100"
                              max="100"
                              step="1"
                              value={track.pan}
                              onChange={(e) => updateTrackProp(track.id, 'pan', parseInt(e.target.value))}
                              className="min-w-0 h-1 rounded-lg bg-slate-800 accent-sky-400 cursor-pointer"
                              title={`Pan ${formatPanLabel(track.pan)}`}
                            />
                            <span className="rounded bg-slate-950 px-1 py-0.5 text-center font-mono text-[9px] text-sky-300">
                              {formatPanLabel(track.pan)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Track Wave Lane content */}
                    <div 
                      className={`relative shrink-0 bg-[#101722] duration-200 overflow-hidden ${
                        isDragOverTrack ? 'bg-slate-800/45 border-y border-emerald-500/20' : ''
                      }`}
                      style={{ width: `${TIMELINE_CONTENT_WIDTH}px` }}
                    >
                      {/* Grid background ticks lines */}
                      <div className="absolute inset-0 pointer-events-none flex">
                        {rulerTicks.map(tick => (
                          <div 
                            key={tick}
                            className="absolute top-0 bottom-0 w-px border-l border-slate-700/25"
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
                        const fadeInPx = clampFade(clip.fadeIn || 0, clip.duration) * ZOOM_PX_PER_SECOND;
                        const fadeOutPx = clampFade(clip.fadeOut || 0, clip.duration) * ZOOM_PX_PER_SECOND;
                        const envelopeStartX = Math.min(widthPos / 2, fadeInPx);
                        const envelopeEndX = Math.max(widthPos / 2, widthPos - fadeOutPx);

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

                            {/* Cubase-style event fade triangles + envelope line */}
                            <svg
                              className="pointer-events-none absolute inset-0 h-full w-full"
                              viewBox={`0 0 ${Math.max(1, widthPos)} 64`}
                              preserveAspectRatio="none"
                            >
                              {fadeInPx > 0 && (
                                <polygon
                                  points={`0,64 ${envelopeStartX},12 0,12`}
                                  fill="rgba(15,23,42,0.22)"
                                  stroke="rgba(15,23,42,0.28)"
                                  strokeWidth="1"
                                />
                              )}
                              {fadeOutPx > 0 && (
                                <polygon
                                  points={`${envelopeEndX},12 ${widthPos},12 ${widthPos},64`}
                                  fill="rgba(15,23,42,0.22)"
                                  stroke="rgba(15,23,42,0.28)"
                                  strokeWidth="1"
                                />
                              )}
                              {(fadeInPx > 0 || fadeOutPx > 0) && (
                                <path
                                  d={`M 0 58 L ${envelopeStartX} 12 L ${envelopeEndX} 12 L ${widthPos} 58`}
                                  fill="none"
                                  stroke="rgba(15,23,42,0.72)"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                />
                              )}
                            </svg>

                            <button
                              type="button"
                              onMouseDown={(e) => onFadeHandleMouseDown(e, track.id, clip.id, 'in')}
                              className={`absolute left-0 top-0 z-20 h-4 w-4 cursor-ew-resize border-l border-t border-white/70 bg-white/80 opacity-80 shadow-sm transition-opacity hover:opacity-100 group-hover:opacity-100 ${
                                fadeDrag?.clipId === clip.id && fadeDrag.edge === 'in' ? 'opacity-100 ring-2 ring-emerald-500' : ''
                              }`}
                              style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
                              title={`拖动设置淡入：${(clip.fadeIn || 0).toFixed(2)}s`}
                              aria-label="拖动设置淡入"
                            />

                            <button
                              type="button"
                              onMouseDown={(e) => onFadeHandleMouseDown(e, track.id, clip.id, 'out')}
                              className={`absolute right-0 top-0 z-20 h-4 w-4 cursor-ew-resize border-r border-t border-white/70 bg-white/80 opacity-80 shadow-sm transition-opacity hover:opacity-100 group-hover:opacity-100 ${
                                fadeDrag?.clipId === clip.id && fadeDrag.edge === 'out' ? 'opacity-100 ring-2 ring-rose-500' : ''
                              }`}
                              style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }}
                              title={`拖动设置淡出：${(clip.fadeOut || 0).toFixed(2)}s`}
                              aria-label="拖动设置淡出"
                            />

                            <button
                              type="button"
                              onMouseDown={(e) => onResizeHandleMouseDown(e, track.id, clip.id, 'left')}
                              className={`absolute left-0 top-4 bottom-0 z-20 w-2 cursor-ew-resize bg-slate-950/0 transition-colors hover:bg-slate-950/25 ${
                                resizeDrag?.clipId === clip.id && resizeDrag.edge === 'left' ? 'bg-sky-500/40' : ''
                              }`}
                              title="裁剪事件左边缘"
                              aria-label="裁剪事件左边缘"
                            />

                            <button
                              type="button"
                              onMouseDown={(e) => onResizeHandleMouseDown(e, track.id, clip.id, 'right')}
                              className={`absolute right-0 top-4 bottom-0 z-20 w-2 cursor-ew-resize bg-slate-950/0 transition-colors hover:bg-slate-950/25 ${
                                resizeDrag?.clipId === clip.id && resizeDrag.edge === 'right' ? 'bg-sky-500/40' : ''
                              }`}
                              title="裁剪事件右边缘"
                              aria-label="裁剪事件右边缘"
                            />

                            {(fadeInPx > 0 || fadeOutPx > 0) && (
                              <div className="pointer-events-none absolute bottom-1 left-2 z-10 rounded bg-white/50 px-1 font-mono text-[8px] text-slate-800/75">
                                FI {(clip.fadeIn || 0).toFixed(1)} / FO {(clip.fadeOut || 0).toFixed(1)}
                              </div>
                            )}

                            {clip.muted && (
                              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-slate-950/45">
                                <span className="rounded bg-slate-950/80 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-yellow-300">
                                  Muted
                                </span>
                              </div>
                            )}

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
              <div className="flex h-12 shrink-0 bg-[#0f141b]">
                <div
                  className="shrink-0 border-r border-slate-800 bg-[#171c23] px-3 py-2"
                  style={{ width: `${TRACK_HEADER_WIDTH}px` }}
                >
                  <button
                    type="button"
                    onClick={handleAddTrack}
                    className="flex h-full w-full items-center justify-center gap-2 rounded border border-dashed border-slate-700 bg-[#10151c] text-[11px] font-bold text-slate-400 transition-colors hover:border-emerald-500/60 hover:text-emerald-300 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>添加音轨</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleAddTrack}
                  className="flex shrink-0 items-center justify-center border-y border-dashed border-slate-800 bg-[#101722] text-[11px] font-bold text-slate-600 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/5 hover:text-emerald-300 cursor-pointer"
                  style={{ width: `${TIMELINE_CONTENT_WIDTH}px` }}
                >
                  + Add Audio Track
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DAW Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-[#171c23] px-4 py-2 font-mono text-[10px] text-slate-500">
        <div className="flex flex-wrap items-center gap-3">
          <span>READY</span>
          <span>Snap: 0.1s</span>
          <span>Space: Play/Pause</span>
          <span>Ctrl/Cmd+C/V: Copy/Paste Event</span>
          <span>Drag events to move across tracks</span>
          <span>Top corner handles = Fade In / Fade Out</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Mix: Stereo</span>
          <span>
            Render: Offline {exportFormat.toUpperCase()} · {exportSampleRate}Hz · {exportFormat === 'mp3' ? `${exportBitrate}kbps` : `${exportBitDepth}bit`}
          </span>
        </div>
      </div>

      {showExportSetup && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-700 bg-[#171c23] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <h3 className="text-sm font-black text-slate-100">导出音频</h3>
                <p className="mt-0.5 text-[10px] text-slate-500">选择格式和渲染参数后开始离线导出</p>
              </div>
              <button
                type="button"
                onClick={() => setShowExportSetup(false)}
                className="rounded border border-slate-700 px-2 py-1 text-xs font-bold text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                关闭
              </button>
            </div>

            <div className="space-y-3 p-4">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">格式</span>
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as WorkstationExportFormat)}
                  disabled={isExporting}
                  className="w-full rounded-lg border border-slate-700 bg-[#10151c] px-3 py-2 text-sm font-bold text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                >
                  <option value="wav">WAV</option>
                  <option value="mp3">MP3</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">采样率</span>
                <select
                  value={exportSampleRate}
                  onChange={(e) => setExportSampleRate(Number(e.target.value))}
                  disabled={isExporting}
                  className="w-full rounded-lg border border-slate-700 bg-[#10151c] px-3 py-2 text-sm font-bold text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                >
                  <option value={44100}>44.1 kHz</option>
                  <option value={48000}>48 kHz</option>
                  <option value={96000}>96 kHz</option>
                </select>
              </label>

              {exportFormat === 'mp3' ? (
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">比特率</span>
                  <select
                    value={exportBitrate}
                    onChange={(e) => setExportBitrate(Number(e.target.value))}
                    disabled={isExporting}
                    className="w-full rounded-lg border border-slate-700 bg-[#10151c] px-3 py-2 text-sm font-bold text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                  >
                    <option value={128}>128 kbps</option>
                    <option value={192}>192 kbps</option>
                    <option value={256}>256 kbps</option>
                    <option value={320}>320 kbps</option>
                  </select>
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">位深</span>
                  <select
                    value={exportBitDepth}
                    onChange={(e) => setExportBitDepth(Number(e.target.value) as WorkstationBitDepth)}
                    disabled={isExporting}
                    className="w-full rounded-lg border border-slate-700 bg-[#10151c] px-3 py-2 text-sm font-bold text-slate-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                  >
                    <option value={16}>16 bit</option>
                    <option value={24}>24 bit</option>
                    <option value={32}>32 bit</option>
                  </select>
                </label>
              )}

              <div className="rounded-lg border border-slate-800 bg-[#10151c] p-3 font-mono text-[10px] text-slate-500">
                当前：{exportFormat.toUpperCase()} · {exportSampleRate}Hz · {exportFormat === 'mp3' ? `${exportBitrate}kbps` : `${exportBitDepth}bit`}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-800 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowExportSetup(false)}
                disabled={isExporting}
                className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleExportMix();
                  setShowExportSetup(false);
                }}
                disabled={totalClipsCount === 0 || isExporting}
                className="rounded-lg border border-emerald-400 bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400 disabled:border-slate-800 disabled:bg-slate-800 disabled:text-slate-500"
              >
                开始导出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
