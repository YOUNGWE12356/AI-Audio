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
  Volume1,
  FileAudio,
  Radio,
  ArrowRight,
  Sparkles,
  MousePointer2,
  Eraser,
  Copy,
  Maximize2,
  Minimize2,
  Magnet,
  Gauge,
  Timer
} from 'lucide-react';
import { encodeMp3, encodeWav, resampleAudioBuffer } from '../services/audioEncoderService';

interface AudioClip {
  id: string;
  name: string;
  startTime: number; // in seconds from track start
  duration: number;  // in seconds
  buffer: AudioBuffer;
  sourceBuffer?: AudioBuffer; // original/current base buffer used for non-cascading transpose
  color: string;     // Tailwind classes for bg/border
  fadeIn?: number;   // fade in duration in seconds
  fadeOut?: number;  // fade out duration in seconds
  gain?: number;     // event gain, 0 to 200
  muted?: boolean;   // event mute
  transposeSemitones?: number;
  playbackRate?: number; // 0.5x to 2x timeline playback speed
}

interface AudioTrack {
  id: string;
  name: string;
  volume: number;    // channel fader in dB: 0.0 = unity gain
  pan: number;       // -100 left to 100 right
  muted: boolean;
  solo: boolean;
  clips: AudioClip[];
}

interface ClipClipboard {
  clip: AudioClip;
  sourceTrackId: string;
}

interface WorkstationHistorySnapshot {
  tracks: AudioTrack[];
  selectedClip: { trackId: string; clipId: string } | null;
}

type ToolMode = 'select' | 'split' | 'erase' | 'mute';
type ResizeEdge = 'left' | 'right';
type WorkstationExportFormat = 'wav' | 'mp3';
type WorkstationBitDepth = 16 | 24 | 32;
type RulerMode = 'time' | 'bars';
type TimeSignature = '2/4' | '3/4' | '4/4' | '5/4' | '6/8' | '7/8' | '12/8';

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
const DEFAULT_TRACK_HEIGHT = 104;
const MIN_TRACK_HEIGHT = 72;
const MAX_TRACK_HEIGHT = 220;
const DEFAULT_TRACK_HEADER_WIDTH = 248;
const MIN_TRACK_HEADER_WIDTH = 180;
const MAX_TRACK_HEADER_WIDTH = 420;
const MIN_TRACK_VOLUME_DB = -60;
const MAX_TRACK_VOLUME_DB = 6;
const DEFAULT_TRACK_VOLUME_DB = 0;
const DEFAULT_TEMPO_BPM = 120;
const MIN_TEMPO_BPM = 40;
const MAX_TEMPO_BPM = 240;
const DEFAULT_RULER_MODE: RulerMode = 'time';
const DEFAULT_TIME_SIGNATURE: TimeSignature = '4/4';
const MIN_CLIP_PLAYBACK_RATE = 0.5;
const MAX_CLIP_PLAYBACK_RATE = 2;
const TIME_SIGNATURE_OPTIONS: TimeSignature[] = ['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '12/8'];

const createToolCursor = (label: string, fallback: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><rect x="1" y="1" width="26" height="26" rx="7" fill="rgba(15,23,42,0.92)" stroke="rgba(56,189,248,0.95)" stroke-width="2"/><text x="14" y="18" text-anchor="middle" font-size="14" font-family="Arial, sans-serif" font-weight="700" fill="white">${label}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 14 14, ${fallback}`;
};

const TOOL_CURSOR_BY_MODE: Record<ToolMode, string> = {
  select: 'default',
  split: createToolCursor('✂', 'crosshair'),
  erase: createToolCursor('⌫', 'not-allowed'),
  mute: createToolCursor('M', 'pointer'),
};

interface AudioWorkstationProps {
  pendingImport?: { id: string; file: File } | null;
  onPendingImportConsumed?: (id: string) => void;
}

export default function AudioWorkstation({ pendingImport = null, onPendingImportConsumed }: AudioWorkstationProps) {
  // Web Audio Context reference
  const audioCtxRef = useRef<AudioContext | null>(null);
  
  // Tracks state
  const [tracks, setTracks] = useState<AudioTrack[]>([
    { id: 'track-1', name: '人声主轨', volume: DEFAULT_TRACK_VOLUME_DB, pan: 0, muted: false, solo: false, clips: [] },
    { id: 'track-2', name: '伴奏轨', volume: DEFAULT_TRACK_VOLUME_DB, pan: 0, muted: false, solo: false, clips: [] },
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
  const [rulerMode, setRulerMode] = useState<RulerMode>(DEFAULT_RULER_MODE);
  const [tempoBpm, setTempoBpm] = useState<number>(DEFAULT_TEMPO_BPM);
  const [timeSignature, setTimeSignature] = useState<TimeSignature>(DEFAULT_TIME_SIGNATURE);
  const [exportFormat, setExportFormat] = useState<WorkstationExportFormat>('wav');
  const [exportSampleRate, setExportSampleRate] = useState<number>(WORKSTATION_SAMPLE_RATE);
  const [exportBitrate, setExportBitrate] = useState<number>(192);
  const [exportBitDepth, setExportBitDepth] = useState<WorkstationBitDepth>(WORKSTATION_BIT_DEPTH);
  const [showExportSetup, setShowExportSetup] = useState<boolean>(false);
  const [copiedClip, setCopiedClip] = useState<ClipClipboard | null>(null);
  const [transposeSemitones, setTransposeSemitones] = useState<number>(0);
  const [clipPlaybackRate, setClipPlaybackRate] = useState<number>(1);
  const [isMetronomeEnabled, setIsMetronomeEnabled] = useState<boolean>(false);
  const [isPitchShifting, setIsPitchShifting] = useState<boolean>(false);
  const [isFileDragActive, setIsFileDragActive] = useState<boolean>(false);
  const [isWorkstationExpanded, setIsWorkstationExpanded] = useState<boolean>(false);
  const [historyVersion, setHistoryVersion] = useState<number>(0);
  const [trackHeaderWidth, setTrackHeaderWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_TRACK_HEADER_WIDTH;
    const saved = Number(window.localStorage.getItem('ai-audio-workstation-track-header-width'));
    return Number.isFinite(saved)
      ? Math.max(MIN_TRACK_HEADER_WIDTH, Math.min(MAX_TRACK_HEADER_WIDTH, saved))
      : DEFAULT_TRACK_HEADER_WIDTH;
  });
  const [trackHeights, setTrackHeights] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const parsed = JSON.parse(window.localStorage.getItem('ai-audio-workstation-track-heights') || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });
  const [trackHeaderResizeDrag, setTrackHeaderResizeDrag] = useState<{ startX: number; initialWidth: number } | null>(null);
  const [trackHeightResizeDrag, setTrackHeightResizeDrag] = useState<{ trackId: string; startY: number; initialHeight: number } | null>(null);
  const [panKnobDrag, setPanKnobDrag] = useState<{ trackId: string; startX: number; initialPan: number } | null>(null);

  // Timeline configuration
  const ZOOM_PX_PER_SECOND = 20; // 1 second = 20 pixels
  const TIMELINE_MAX_SECONDS = 180; // default 3 minutes, expands dynamically
  const TIMELINE_CONTENT_WIDTH = TIMELINE_MAX_SECONDS * ZOOM_PX_PER_SECOND;
  const [timeSignatureBeatsRaw, timeSignatureUnitRaw] = timeSignature.split('/').map(Number);
  const beatsPerBar = Number.isFinite(timeSignatureBeatsRaw) ? timeSignatureBeatsRaw : 4;
  const beatUnit = Number.isFinite(timeSignatureUnitRaw) ? timeSignatureUnitRaw : 4;
  const beatDurationSeconds = (60 / tempoBpm) * (4 / beatUnit);
  const barDurationSeconds = beatDurationSeconds * beatsPerBar;
  const activeSnapStep = rulerMode === 'bars' ? beatDurationSeconds : snapStep;
  
  // Audio sources keeping track of what's playing in real time
  const activeSourcesRef = useRef<{ source: AudioBufferSourceNode; gainNode: GainNode }[]>([]);
  const activeMetronomeSourcesRef = useRef<OscillatorNode[]>([]);
  const playbackStartTimeRef = useRef<number>(0);
  const playbackStartPlayheadRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileDragDepthRef = useRef<number>(0);
  const consumedPendingImportRef = useRef<string | null>(null);

  // Synchronized refs for real-time playhead loop to avoid stale React closures
  const isPlayingRef = useRef<boolean>(false);
  const tracksRef = useRef<AudioTrack[]>(tracks);
  const selectedClipRef = useRef<{ trackId: string; clipId: string } | null>(selectedClip);
  const undoStackRef = useRef<WorkstationHistorySnapshot[]>([]);
  const redoStackRef = useRef<WorkstationHistorySnapshot[]>([]);
  const lastTracksSnapshotRef = useRef<AudioTrack[]>(tracks);
  const lastSelectedClipSnapshotRef = useRef<{ trackId: string; clipId: string } | null>(selectedClip);
  const isApplyingHistoryRef = useRef<boolean>(false);
  const historyTransactionRef = useRef<WorkstationHistorySnapshot | null>(null);
  const transposeJobIdRef = useRef<number>(0);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    selectedClipRef.current = selectedClip;
    lastSelectedClipSnapshotRef.current = selectedClip;
  }, [selectedClip]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('ai-audio-workstation-track-header-width', String(trackHeaderWidth));
  }, [trackHeaderWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('ai-audio-workstation-track-heights', JSON.stringify(trackHeights));
  }, [trackHeights]);

  useEffect(() => {
    if (!isWorkstationExpanded) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsWorkstationExpanded(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isWorkstationExpanded]);

  useEffect(() => {
    if (!trackHeaderResizeDrag) return;

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = trackHeaderResizeDrag.initialWidth + event.clientX - trackHeaderResizeDrag.startX;
      setTrackHeaderWidth(Math.max(MIN_TRACK_HEADER_WIDTH, Math.min(MAX_TRACK_HEADER_WIDTH, nextWidth)));
    };

    const handleMouseUp = () => {
      setTrackHeaderResizeDrag(null);
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
  }, [trackHeaderResizeDrag]);

  useEffect(() => {
    if (!trackHeightResizeDrag) return;

    const handleMouseMove = (event: MouseEvent) => {
      const nextHeight = trackHeightResizeDrag.initialHeight + event.clientY - trackHeightResizeDrag.startY;
      setTrackHeights(prev => ({
        ...prev,
        [trackHeightResizeDrag.trackId]: Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, nextHeight)),
      }));
    };

    const handleMouseUp = () => {
      setTrackHeightResizeDrag(null);
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [trackHeightResizeDrag]);

  useEffect(() => {
    if (!panKnobDrag) return;

    const handleMouseMove = (event: MouseEvent) => {
      const nextPan = clampPan(panKnobDrag.initialPan + event.clientX - panKnobDrag.startX);
      updateTrackProp(panKnobDrag.trackId, 'pan', nextPan);
    };

    const handleMouseUp = () => {
      setPanKnobDrag(null);
    };

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [panKnobDrag, tracks, isPlaying]);

  const isSelectedClipStillValid = (
    snapshotTracks: AudioTrack[],
    snapshotSelectedClip: { trackId: string; clipId: string } | null,
  ) => {
    if (!snapshotSelectedClip) return false;
    return snapshotTracks.some(track => (
      track.id === snapshotSelectedClip.trackId &&
      track.clips.some(clip => clip.id === snapshotSelectedClip.clipId)
    ));
  };

  const pushUndoSnapshot = (snapshot: WorkstationHistorySnapshot) => {
    undoStackRef.current = [...undoStackRef.current, snapshot].slice(-80);
    redoStackRef.current = [];
    setHistoryVersion(version => version + 1);
  };

  const beginHistoryTransaction = () => {
    if (historyTransactionRef.current) return;
    historyTransactionRef.current = {
      tracks: tracksRef.current,
      selectedClip: selectedClipRef.current,
    };
  };

  const endHistoryTransaction = () => {
    const snapshot = historyTransactionRef.current;
    historyTransactionRef.current = null;
    if (!snapshot || snapshot.tracks === tracksRef.current) return;
    pushUndoSnapshot(snapshot);
  };

  useEffect(() => {
    if (isApplyingHistoryRef.current) {
      isApplyingHistoryRef.current = false;
      lastTracksSnapshotRef.current = tracks;
      tracksRef.current = tracks;
      return;
    }

    if (historyTransactionRef.current) {
      lastTracksSnapshotRef.current = tracks;
      tracksRef.current = tracks;
      return;
    }

    if (lastTracksSnapshotRef.current !== tracks) {
      pushUndoSnapshot({
        tracks: lastTracksSnapshotRef.current,
        selectedClip: lastSelectedClipSnapshotRef.current,
      });
      lastTracksSnapshotRef.current = tracks;
      tracksRef.current = tracks;
    }
  }, [tracks]);

  const applyHistorySnapshot = (snapshot: WorkstationHistorySnapshot) => {
    isApplyingHistoryRef.current = true;
    if (isPlayingRef.current) {
      handlePause();
    }
    setTracks(snapshot.tracks);
    setSelectedClip(isSelectedClipStillValid(snapshot.tracks, snapshot.selectedClip) ? snapshot.selectedClip : null);
  };

  const handleUndo = () => {
    const snapshot = undoStackRef.current.pop();
    if (!snapshot) return false;
    redoStackRef.current = [
      ...redoStackRef.current,
      { tracks: tracksRef.current, selectedClip: selectedClipRef.current },
    ].slice(-80);
    applyHistorySnapshot(snapshot);
    setHistoryVersion(version => version + 1);
    return true;
  };

  const handleRedo = () => {
    const snapshot = redoStackRef.current.pop();
    if (!snapshot) return false;
    undoStackRef.current = [
      ...undoStackRef.current,
      { tracks: tracksRef.current, selectedClip: selectedClipRef.current },
    ].slice(-80);
    applyHistorySnapshot(snapshot);
    setHistoryVersion(version => version + 1);
    return true;
  };

  useEffect(() => {
    if (!selectedClip) {
      setTransposeSemitones(0);
      setClipPlaybackRate(1);
      return;
    }

    const track = tracksRef.current.find(t => t.id === selectedClip.trackId);
    const clip = track?.clips.find(c => c.id === selectedClip.clipId);
    setTransposeSemitones(clip?.transposeSemitones ?? 0);
    setClipPlaybackRate(clip?.playbackRate ?? 1);
  }, [selectedClip?.trackId, selectedClip?.clipId]);

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
    originalPlaybackRate: number;
  } | null>(null);

  const clampFade = (value: number, duration: number) => (
    Math.max(0, Math.min(duration / 2, value))
  );

  const snapTime = (time: number) => {
    if (!snapEnabled || activeSnapStep <= 0) return Math.max(0, time);
    return Math.max(0, parseFloat((Math.round(time / activeSnapStep) * activeSnapStep).toFixed(3)));
  };

  const clampTempoBpm = (value: number) => (
    Number.isFinite(value) ? Math.max(MIN_TEMPO_BPM, Math.min(MAX_TEMPO_BPM, value)) : DEFAULT_TEMPO_BPM
  );

  const clampClipGain = (value: number) => Math.max(0, Math.min(200, value));

  const formatPanLabel = (pan: number) => {
    if (pan === 0) return 'C';
    return pan < 0 ? `L${Math.abs(pan)}` : `R${pan}`;
  };

  const clampVolumeDb = (value: number) => (
    Number.isFinite(value) ? Math.max(MIN_TRACK_VOLUME_DB, Math.min(MAX_TRACK_VOLUME_DB, value)) : DEFAULT_TRACK_VOLUME_DB
  );

  const trackVolumeDbToGain = (volumeDb: number) => (
    volumeDb <= MIN_TRACK_VOLUME_DB ? 0 : Math.pow(10, volumeDb / 20)
  );

  const formatVolumeDbLabel = (volumeDb: number) => {
    if (volumeDb <= MIN_TRACK_VOLUME_DB) return '-∞';
    if (Math.abs(volumeDb) < 0.05) return '0.0';
    return volumeDb > 0 ? `+${volumeDb.toFixed(1)}` : volumeDb.toFixed(1);
  };

  const clampPan = (value: number) => (
    Number.isFinite(value) ? Math.max(-100, Math.min(100, Math.round(value))) : 0
  );

  const clampSemitoneValue = (value: number) => (
    Number.isFinite(value) ? Math.max(-12, Math.min(12, Math.round(value))) : 0
  );

  const clampPlaybackRate = (value: number) => (
    Number.isFinite(value)
      ? Math.max(MIN_CLIP_PLAYBACK_RATE, Math.min(MAX_CLIP_PLAYBACK_RATE, Math.round(value * 100) / 100))
      : 1
  );

  const getTrackHeight = (trackId: string) => (
    Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, trackHeights[trackId] ?? DEFAULT_TRACK_HEIGHT))
  );

  const getTrackIndexOffsetFromDelta = (sourceTrackId: string, deltaY: number) => {
    const sourceIndex = tracksRef.current.findIndex(track => track.id === sourceTrackId);
    if (sourceIndex < 0) return 0;
    if (deltaY === 0) return 0;

    let remaining = Math.abs(deltaY);
    let offset = 0;
    const direction = deltaY > 0 ? 1 : -1;
    let index = sourceIndex;

    while (remaining > getTrackHeight(tracksRef.current[index]?.id || sourceTrackId) / 2) {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= tracksRef.current.length) break;
      remaining -= getTrackHeight(tracksRef.current[index].id);
      offset += direction;
      index = nextIndex;
    }

    return offset;
  };

  const nudgeTransposeSemitones = (delta: number) => {
    if (!selectedClip || isPitchShifting) return;
    void handleTransposeValueChange(transposeSemitones + delta);
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

  const getProjectEndTime = (snapshotTracks: AudioTrack[] = tracksRef.current) => {
    let endTime = 10;
    snapshotTracks.forEach(track => {
      track.clips.forEach(clip => {
        endTime = Math.max(endTime, clip.startTime + clip.duration);
      });
    });
    return endTime;
  };

  const stopMetronomePlayback = () => {
    activeMetronomeSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch {
        // The click has already finished.
      }
    });
    activeMetronomeSourcesRef.current = [];
  };

  const scheduleMetronome = (
    ctx: AudioContext,
    playheadTime: number,
    bpm: number = tempoBpm,
    signature: TimeSignature = timeSignature,
  ) => {
    stopMetronomePlayback();

    const [rawBeatsPerBar, rawBeatUnit] = signature.split('/').map(Number);
    const scheduledBeatsPerBar = Number.isFinite(rawBeatsPerBar) ? rawBeatsPerBar : 4;
    const scheduledBeatUnit = Number.isFinite(rawBeatUnit) ? rawBeatUnit : 4;
    const scheduledBeatDuration = (60 / clampTempoBpm(bpm)) * (4 / scheduledBeatUnit);
    const firstBeatIndex = Math.max(0, Math.ceil((playheadTime - 0.001) / scheduledBeatDuration));
    const projectEndTime = getProjectEndTime();

    for (
      let beatIndex = firstBeatIndex;
      beatIndex * scheduledBeatDuration <= projectEndTime;
      beatIndex += 1
    ) {
      const beatTimelineTime = beatIndex * scheduledBeatDuration;
      const startAt = ctx.currentTime + Math.max(0, beatTimelineTime - playheadTime);
      const isDownbeat = beatIndex % scheduledBeatsPerBar === 0;
      const oscillator = ctx.createOscillator();
      const clickGain = ctx.createGain();

      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(isDownbeat ? 1320 : 880, startAt);
      clickGain.gain.setValueAtTime(isDownbeat ? 0.14 : 0.075, startAt);
      clickGain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.045);
      oscillator.connect(clickGain);
      clickGain.connect(ctx.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.05);
      activeMetronomeSourcesRef.current.push(oscillator);
    }
  };

  const getLivePlayheadTime = () => {
    if (!isPlayingRef.current || !audioCtxRef.current) return currentTime;
    return playbackStartPlayheadRef.current + (
      audioCtxRef.current.currentTime - playbackStartTimeRef.current
    );
  };

  const rescheduleActiveMetronome = (bpm: number, signature: TimeSignature) => {
    if (!isMetronomeEnabled || !isPlayingRef.current) return;
    const ctx = getAudioContext();
    scheduleMetronome(ctx, getLivePlayheadTime(), bpm, signature);
  };

  const handleToggleMetronome = () => {
    const nextEnabled = !isMetronomeEnabled;
    setIsMetronomeEnabled(nextEnabled);
    if (!isPlayingRef.current) return;
    if (nextEnabled) {
      const ctx = getAudioContext();
      scheduleMetronome(ctx, getLivePlayheadTime());
    } else {
      stopMetronomePlayback();
    }
  };

  const handleTempoBpmChange = (value: number) => {
    const nextBpm = clampTempoBpm(value);
    setTempoBpm(nextBpm);
    rescheduleActiveMetronome(nextBpm, timeSignature);
  };

  const handleTimeSignatureChange = (signature: TimeSignature) => {
    setTimeSignature(signature);
    rescheduleActiveMetronome(tempoBpm, signature);
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
    stopMetronomePlayback();
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
      trackGain.gain.value = trackVolumeDbToGain(track.volume);
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
          const playbackRate = clampPlaybackRate(clip.playbackRate ?? 1);
          source.playbackRate.setValueAtTime(playbackRate, ctx.currentTime);

          // Clip level gain node for fades
          const clipGain = ctx.createGain();
          applyFadeEnvelope(clipGain, clip, currentTime, ctx);

          source.connect(clipGain);
          clipGain.connect(trackGain);

          // Calculate timing variables in seconds
          const delay = Math.max(0, clip.startTime - currentTime);
          const timelineOffset = Math.max(0, currentTime - clip.startTime);
          const offset = Math.min(clip.buffer.duration, timelineOffset * playbackRate);
          const duration = Math.min(
            Math.max(0, clip.buffer.duration - offset),
            Math.max(0, (clip.duration - timelineOffset) * playbackRate),
          );

          try {
            source.start(ctx.currentTime + delay, offset, duration);
            activeSourcesRef.current.push({ source, gainNode: trackGain });
          } catch (err) {
            console.error('Error starting source:', err);
          }
        }
      });
    });

    if (isMetronomeEnabled) {
      scheduleMetronome(ctx, currentTime);
    }

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
      { id: nextId, name: `音频轨 ${nextNum}`, volume: DEFAULT_TRACK_VOLUME_DB, pan: 0, muted: false, solo: false, clips: [] }
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
      const playbackRate = clampPlaybackRate(clip.playbackRate ?? 1);
      const bufferSplitOffset = splitOffset * playbackRate;
      
      try {
        const buffer1 = sliceAudioBuffer(ctx, clip.buffer, 0, bufferSplitOffset);
        const buffer2 = sliceAudioBuffer(ctx, clip.buffer, bufferSplitOffset, clip.buffer.duration);

        const clip1Id = `clip-${Date.now()}-a`;
        const clip2Id = `clip-${Date.now()}-b`;

        const clip1: AudioClip = {
          id: clip1Id,
          name: `${clip.name} (前)`,
          startTime: clip.startTime,
          duration: splitOffset,
          buffer: buffer1,
          sourceBuffer: buffer1,
          color: clip.color,
          fadeIn: clip.fadeIn ? Math.min(clip.fadeIn, splitOffset) : 0,
          fadeOut: 0,
          gain: clip.gain ?? 100,
          muted: clip.muted,
          transposeSemitones: 0,
          playbackRate
        };

        const clip2: AudioClip = {
          id: clip2Id,
          name: `${clip.name} (后)`,
          startTime: splitTime,
          duration: clip.duration - splitOffset,
          buffer: buffer2,
          sourceBuffer: buffer2,
          color: clip.color,
          fadeIn: 0,
          fadeOut: clip.fadeOut ? Math.min(clip.fadeOut, clip.duration - splitOffset) : 0,
          gain: clip.gain ?? 100,
          muted: clip.muted,
          transposeSemitones: 0,
          playbackRate
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

  const handleClipPlaybackRateChange = (value: number) => {
    if (!selectedClip) return;
    const nextRate = clampPlaybackRate(value);
    setClipPlaybackRate(nextRate);
    updateSelectedClip(clip => {
      const nextDuration = clip.buffer.duration / nextRate;
      return {
        ...clip,
        playbackRate: nextRate,
        duration: nextDuration,
        fadeIn: clampFade(clip.fadeIn || 0, nextDuration),
        fadeOut: clampFade(clip.fadeOut || 0, nextDuration),
      };
    });
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

      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat) {
        const plainKey = event.key.toLowerCase();
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (selectedClipRef.current) {
            event.preventDefault();
            handleDeleteClip();
          }
          return;
        }
        if (plainKey === 's') {
          if (selectedClipRef.current) {
            event.preventDefault();
            handleSplitClip();
          }
          return;
        }
        if (plainKey === 'm') {
          if (selectedClipRef.current) {
            event.preventDefault();
            handleToggleSelectedClipMute();
          }
          return;
        }
        if (plainKey === '1') {
          event.preventDefault();
          setToolMode('select');
          return;
        }
        if (plainKey === '2') {
          event.preventDefault();
          setToolMode('split');
          return;
        }
        if (plainKey === '3') {
          event.preventDefault();
          setToolMode('erase');
          return;
        }
        if (plainKey === '4') {
          event.preventDefault();
          setToolMode('mute');
          return;
        }
      }

      const isCommandShortcut = event.ctrlKey || event.metaKey;
      if (!isCommandShortcut || event.altKey || event.repeat) return;

      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (key === 'y') {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (key === 'c') {
        if (handleCopySelectedClip()) {
          event.preventDefault();
        }
        return;
      }

      if (key === 'x') {
        if (handleCopySelectedClip()) {
          event.preventDefault();
          handleDeleteClip();
        }
        return;
      }

      if (key === 'v') {
        if (handlePasteCopiedClip()) {
          event.preventDefault();
        }
        return;
      }

      if (key === 'd') {
        if (selectedClipRef.current) {
          event.preventDefault();
          handleDuplicateClip();
        }
      }
    };

    window.addEventListener('keydown', handleKeyboardShortcuts);
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
  }, [showExportSetup, selectedClip, tracks, copiedClip, currentTime, isPlaying, historyVersion]);

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

  const createTransposedBuffer = (
    buffer: AudioBuffer,
    semitones: number,
  ): AudioBuffer => {
    const ctx = getAudioContext();
    const pitchRatio = Math.pow(2, semitones / 12);
    const grainSize = Math.max(1024, Math.round(buffer.sampleRate * 0.08));
    const hopSize = Math.max(128, Math.floor(grainSize / 4));
    const nextBuffer = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const source = buffer.getChannelData(channel);
      const target = nextBuffer.getChannelData(channel);
      const weights = new Float32Array(buffer.length);
      const maxInputStart = Math.max(0, buffer.length - grainSize);

      for (let outputStart = 0; outputStart < buffer.length; outputStart += hopSize) {
        const inputStart = Math.min(maxInputStart, Math.max(0, Math.round(outputStart * pitchRatio)));

        for (let frame = 0; frame < grainSize; frame++) {
          const outputIndex = outputStart + frame;
          const inputIndex = inputStart + frame;
          if (outputIndex >= buffer.length || inputIndex >= buffer.length) break;

          const windowValue = 0.5 - 0.5 * Math.cos((2 * Math.PI * frame) / Math.max(1, grainSize - 1));
          target[outputIndex] += source[inputIndex] * windowValue;
          weights[outputIndex] += windowValue;
        }
      }

      for (let index = 0; index < buffer.length; index++) {
        target[index] = weights[index] > 0
          ? Math.max(-1, Math.min(1, target[index] / weights[index]))
          : 0;
      }
    }

    return nextBuffer;
  };

  const handleNormalizeSelectedClip = () => {
    updateSelectedClip(clip => {
      const normalizedBuffer = createNormalizedBuffer(clip.buffer);
      setTransposeSemitones(0);
      return {
        ...clip,
        buffer: normalizedBuffer,
        sourceBuffer: normalizedBuffer,
        transposeSemitones: 0,
        gain: 100,
        name: `${clip.name} · Norm`
      };
    });
  };

  const handleReverseSelectedClip = () => {
    updateSelectedClip(clip => {
      const reversedBuffer = createReversedBuffer(clip.buffer);
      setTransposeSemitones(0);
      return {
        ...clip,
        buffer: reversedBuffer,
        sourceBuffer: reversedBuffer,
        transposeSemitones: 0,
        name: `${clip.name} · Rev`
      };
    });
  };

  const handleTransposeValueChange = async (value: number) => {
    if (!selectedClip) return;
    const nextSemitones = clampSemitoneValue(value);
    const track = tracks.find(t => t.id === selectedClip.trackId);
    const clip = track?.clips.find(c => c.id === selectedClip.clipId);
    if (!track || !clip) return;

    setTransposeSemitones(nextSemitones);
    if ((clip.transposeSemitones ?? 0) === nextSemitones) return;

    const jobId = transposeJobIdRef.current + 1;
    transposeJobIdRef.current = jobId;
    setIsPitchShifting(true);
    if (isPlaying) handlePause();

    try {
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (transposeJobIdRef.current !== jobId) return;
      const sourceBuffer = clip.sourceBuffer ?? clip.buffer;
      const transposedBuffer = nextSemitones === 0
        ? sourceBuffer
        : createTransposedBuffer(sourceBuffer, nextSemitones);
      if (transposeJobIdRef.current !== jobId) return;
      setTracks(prev => prev.map(t => (
        t.id !== track.id
          ? t
          : {
              ...t,
              clips: t.clips.map(c => (
                c.id === clip.id
                  ? {
                      ...c,
                      buffer: transposedBuffer,
                      sourceBuffer,
                      duration: transposedBuffer.duration / clampPlaybackRate(c.playbackRate ?? 1),
                      fadeIn: clampFade(c.fadeIn || 0, transposedBuffer.duration / clampPlaybackRate(c.playbackRate ?? 1)),
                      fadeOut: clampFade(c.fadeOut || 0, transposedBuffer.duration / clampPlaybackRate(c.playbackRate ?? 1)),
                      transposeSemitones: nextSemitones
                    }
                  : c
              ))
            }
      )));
    } catch (error) {
      console.error('Failed to transpose clip:', error);
      alert('移调处理失败，请换一个较短的片段或稍后再试。');
    } finally {
      if (transposeJobIdRef.current === jobId) {
        setIsPitchShifting(false);
      }
    }
  };

  const importAudioFiles = async (
    files: File[],
    placement?: { trackId?: string; startTime?: number },
  ) => {
    const audioFiles = files.filter(file => (
      file.type.startsWith('audio/') || /\.(aac|aif|aiff|flac|m4a|mp3|ogg|opus|wav|webm)$/i.test(file.name)
    ));

    if (audioFiles.length === 0) {
      alert('请拖入音频文件，例如 WAV、MP3、AIFF、FLAC 或 M4A。');
      return;
    }

    setIsDecoding(true);
    const ctx = getAudioContext();
    const newClips: { file: File; buffer: AudioBuffer }[] = [];

    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
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
      const updatedTracks = [...tracks];
      const targetTrack = updatedTracks.find(track => track.id === placement?.trackId) || updatedTracks[0];
      let nextStartTime = snapTime(placement?.startTime ?? currentTime);

      newClips.forEach((item, index) => {
        const randomColor = CLIP_COLORS[(targetTrack.clips.length + index) % CLIP_COLORS.length].bg;
        const newClip: AudioClip = {
          id: `clip-${Date.now()}-${index}`,
          name: item.file.name.replace(/\.[^/.]+$/, ""), // remove extension
          startTime: parseFloat(nextStartTime.toFixed(3)),
          duration: item.buffer.duration,
          buffer: item.buffer,
          sourceBuffer: item.buffer,
          color: randomColor,
          fadeIn: 0,
          fadeOut: 0,
          gain: 100,
          muted: false,
          transposeSemitones: 0,
          playbackRate: 1
        };
        targetTrack.clips.push(newClip);
        nextStartTime += item.buffer.duration;
      });

      setTracks(updatedTracks);
    }

    setIsDecoding(false);
  };

  useEffect(() => {
    if (!pendingImport || consumedPendingImportRef.current === pendingImport.id) return;
    consumedPendingImportRef.current = pendingImport.id;
    void importAudioFiles([pendingImport.file]).finally(() => {
      onPendingImportConsumed?.(pendingImport.id);
    });
  }, [pendingImport, onPendingImportConsumed]);

  // Handle local audio file selection/upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    await importAudioFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const hasAudioFilesInDrag = (event: React.DragEvent) => {
    const { items } = event.dataTransfer;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item.kind === 'file' && (item.type.startsWith('audio/') || item.type === '')) {
        return true;
      }
    }
    return false;
  };

  const getDropPlacement = (event: React.DragEvent): { trackId?: string; startTime?: number } => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const lane = target?.closest<HTMLElement>('[data-workstation-track-id]');
    if (!lane) return { trackId: tracks[0]?.id, startTime: currentTime };

    const rect = lane.getBoundingClientRect();
    const dropX = Math.max(0, event.clientX - rect.left);
    return {
      trackId: lane.dataset.workstationTrackId,
      startTime: snapTime(dropX / ZOOM_PX_PER_SECOND),
    };
  };

  const handleWorkstationDragEnter = (event: React.DragEvent) => {
    if (!hasAudioFilesInDrag(event)) return;
    event.preventDefault();
    fileDragDepthRef.current += 1;
    setIsFileDragActive(true);
  };

  const handleWorkstationDragOver = (event: React.DragEvent) => {
    if (!hasAudioFilesInDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleWorkstationDragLeave = (event: React.DragEvent) => {
    if (!hasAudioFilesInDrag(event)) return;
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) {
      setIsFileDragActive(false);
    }
  };

  const handleWorkstationDrop = async (event: React.DragEvent) => {
    const files: File[] = [];
    for (let index = 0; index < event.dataTransfer.files.length; index++) {
      files.push(event.dataTransfer.files[index]);
    }
    if (files.length === 0) return;

    event.preventDefault();
    fileDragDepthRef.current = 0;
    setIsFileDragActive(false);
    await importAudioFiles(files, getDropPlacement(event));
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
    beginHistoryTransaction();
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
    beginHistoryTransaction();
    setResizeDrag({
      trackId,
      clipId,
      edge,
      startX: e.clientX,
      originalStartTime: clip.startTime,
      originalDuration: clip.duration,
      originalBuffer: clip.buffer,
      originalPlaybackRate: clampPlaybackRate(clip.playbackRate ?? 1)
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
      endHistoryTransaction();
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
        nextBuffer = sliceAudioBuffer(
          ctx,
          resizeDrag.originalBuffer,
          effectiveTrim * resizeDrag.originalPlaybackRate,
          resizeDrag.originalBuffer.duration,
        );
      } else {
        const rawDuration = resizeDrag.originalDuration + Math.min(0, rawDelta);
        nextDuration = Math.max(0.1, Math.min(resizeDrag.originalDuration, snapTime(rawDuration)));
        nextBuffer = sliceAudioBuffer(
          ctx,
          resizeDrag.originalBuffer,
          0,
          nextDuration * resizeDrag.originalPlaybackRate,
        );
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
      endHistoryTransaction();
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
      const trackIndexOffset = getTrackIndexOffsetFromDelta(draggingClip.trackId, dy);
      
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
      trackGain.gain.value = trackVolumeDbToGain(track.volume);
      trackPan.pan.value = track.pan / 100;
      trackGain.connect(trackPan);
      trackPan.connect(offlineCtx.destination);

      track.clips.forEach(clip => {
        if (clip.muted) return;
        const source = offlineCtx.createBufferSource();
        source.buffer = clip.buffer;
        source.playbackRate.setValueAtTime(
          clampPlaybackRate(clip.playbackRate ?? 1),
          clip.startTime,
        );

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

  const formatBarsBeatsStr = (sec: number): string => {
    const totalBeats = Math.max(0, sec) / beatDurationSeconds;
    const wholeBeats = Math.floor(totalBeats);
    const bar = Math.floor(wholeBeats / beatsPerBar) + 1;
    const beat = (wholeBeats % beatsPerBar) + 1;
    const subBeat = Math.round((totalBeats - wholeBeats) * 100);
    return `${bar}.${beat}.${subBeat.toString().padStart(2, '0')}`;
  };

  const formatTimelinePosition = (sec: number): string => (
    rulerMode === 'bars' ? formatBarsBeatsStr(sec) : `${sec.toFixed(2)}s`
  );

  const formatTimelineDuration = (sec: number): string => (
    rulerMode === 'bars' ? `${(sec / barDurationSeconds).toFixed(2)}bar` : `${sec.toFixed(1)}s`
  );

  // Generate ruler grid markings
  const rulerTicks: Array<{ id: string; time: number; label: string; major: boolean }> = [];
  if (rulerMode === 'bars') {
    const totalBeats = Math.ceil(TIMELINE_MAX_SECONDS / beatDurationSeconds);
    for (let beatIndex = 0; beatIndex <= totalBeats; beatIndex += 1) {
      const major = beatIndex % beatsPerBar === 0;
      const barNumber = Math.floor(beatIndex / beatsPerBar) + 1;
      rulerTicks.push({
        id: `bar-${beatIndex}`,
        time: beatIndex * beatDurationSeconds,
        label: major ? String(barNumber) : '',
        major,
      });
    }
  } else {
    for (let i = 0; i <= TIMELINE_MAX_SECONDS; i += 1) {
      rulerTicks.push({
        id: `time-${i}`,
        time: i,
        label: i % 5 === 0 ? `${i}s` : '',
        major: i % 5 === 0,
      });
    }
  }

  // Count total clips loaded
  const totalClipsCount = tracks.reduce((sum, t) => sum + t.clips.length, 0);
  const workstationCursor = TOOL_CURSOR_BY_MODE[toolMode];

  return (
    <div
      id="audio-workstation"
      onDragEnter={handleWorkstationDragEnter}
      onDragOver={handleWorkstationDragOver}
      onDragLeave={handleWorkstationDragLeave}
      onDrop={handleWorkstationDrop}
      className={`min-h-full w-full overflow-hidden rounded-2xl border bg-[#11161d] text-slate-200 shadow-2xl transition-colors ${
        isWorkstationExpanded ? 'fixed inset-4 z-[9997] flex flex-col' : 'relative'
      } ${
        isFileDragActive ? 'border-emerald-400 ring-2 ring-emerald-400/40' : 'border-slate-800'
      }`}
    >
      {isFileDragActive && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-emerald-950/35 backdrop-blur-[1px]">
          <div className="flex items-center gap-3 rounded-xl border border-emerald-400/50 bg-slate-950/90 px-5 py-3 text-sm font-black text-emerald-200 shadow-2xl shadow-emerald-950/40">
            <Upload className="h-5 w-5" />
            <span>松开鼠标导入音频到工作站</span>
          </div>
        </div>
      )}

      {/* Cubase-like application chrome */}
      <div className="border-b border-slate-800 bg-[#242a33]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
              <Layers className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-black tracking-tight text-slate-100">DAW</h2>
              </div>
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
                  <span>导入</span>
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
                  <span>导出</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsWorkstationExpanded(prev => !prev)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-[#151a21] text-slate-300 shadow-sm transition-all hover:border-sky-400 hover:text-sky-300 cursor-pointer"
              title={isWorkstationExpanded ? '退出放大视图 Esc' : '放大 DAW 视图'}
              aria-label={isWorkstationExpanded ? '退出放大视图' : '放大 DAW 视图'}
            >
              {isWorkstationExpanded ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main DAW Viewport */}
      <div className={`bg-[#111827] overflow-hidden text-slate-200 ${isWorkstationExpanded ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
        
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
                    title={`${tool.label} (${tool.id === 'select' ? '1' : tool.id === 'split' ? '2 / S' : tool.id === 'erase' ? '3' : '4 / M'})`}
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

            <div className="flex h-8 items-center gap-1 rounded-md border border-slate-800 bg-[#10151c] px-1.5">
              <span className="text-[9px] font-black leading-none text-violet-300">移调</span>
              <div
                className={`flex h-6 items-center overflow-hidden rounded border ${
                  selectedClip && !isPitchShifting
                    ? 'border-violet-500/40 bg-[#171c23]'
                    : 'border-slate-800 bg-slate-900 opacity-55'
                }`}
                onWheel={(e) => {
                  if (!selectedClip || isPitchShifting) return;
                  e.preventDefault();
                  nudgeTransposeSemitones(e.deltaY < 0 ? 1 : -1);
                }}
                title="鼠标滚轮或键盘上下键调整半音"
              >
                <input
                  type="number"
                  min="-12"
                  max="12"
                  step="1"
                  value={transposeSemitones}
                  disabled={!selectedClip || isPitchShifting}
                  onChange={(e) => void handleTransposeValueChange(parseInt(e.target.value, 10))}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      nudgeTransposeSemitones(1);
                    }
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      nudgeTransposeSemitones(-1);
                    }
                  }}
                  aria-label="移调半音数"
                  className="h-full w-8 border-0 bg-transparent px-0 text-center font-mono text-[11px] font-black text-violet-100 outline-none disabled:text-slate-500"
                />
              </div>
              <span className="font-mono text-[9px] font-bold text-violet-300">st</span>
            </div>

            <div
              className={`flex h-8 items-center gap-1 rounded-md border px-1.5 ${
                selectedClip
                  ? 'border-cyan-500/40 bg-[#10151c]'
                  : 'border-slate-800 bg-[#10151c] opacity-55'
              }`}
              title="改变选中片段的播放速度与时间线长度（0.50x - 2.00x）"
            >
              <Gauge className="h-3.5 w-3.5 text-cyan-300" />
              <span className="text-[9px] font-black leading-none text-cyan-300">拉伸</span>
              <input
                type="number"
                min={MIN_CLIP_PLAYBACK_RATE}
                max={MAX_CLIP_PLAYBACK_RATE}
                step="0.05"
                value={Number(clipPlaybackRate.toFixed(2))}
                disabled={!selectedClip}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (Number.isFinite(value)) handleClipPlaybackRateChange(value);
                }}
                aria-label="片段拉伸速度"
                className="h-6 w-11 border-0 bg-transparent px-0 text-center font-mono text-[11px] font-black text-cyan-100 outline-none disabled:text-slate-500"
              />
              <span className="font-mono text-[9px] font-bold text-cyan-300">x</span>
            </div>

            <div className="flex h-8 items-center gap-1 rounded-md border border-slate-800 bg-[#10151c] px-1.5" title="工程速度 BPM，默认 120">
              <Music className="h-3.5 w-3.5 text-amber-300" />
              <input
                type="number"
                min={MIN_TEMPO_BPM}
                max={MAX_TEMPO_BPM}
                step="1"
                value={tempoBpm}
                onChange={(e) => handleTempoBpmChange(parseFloat(e.target.value))}
                aria-label="工程速度 BPM"
                className="h-6 w-11 border-0 bg-transparent text-center font-mono text-[11px] font-black text-amber-100 outline-none"
              />
              <span className="text-[9px] font-black text-amber-300">BPM</span>
            </div>

            <button
              type="button"
              onClick={handleToggleMetronome}
              className={`flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-[9px] font-black shadow-sm transition-all cursor-pointer ${
                isMetronomeEnabled
                  ? 'border-amber-300 bg-amber-400 text-slate-950 shadow-amber-950/30'
                  : 'border-slate-800 bg-[#10151c] text-slate-500 hover:border-amber-500/60 hover:text-amber-300'
              }`}
              title={isMetronomeEnabled ? '节拍器已开启，播放时按当前 BPM 发声' : '开启节拍器'}
              aria-label={isMetronomeEnabled ? '关闭节拍器' : '开启节拍器'}
              aria-pressed={isMetronomeEnabled}
            >
              <Timer className="h-3.5 w-3.5" />
              <span>节拍</span>
            </button>

            <label
              className="relative flex h-8 items-center rounded-md border border-slate-800 bg-[#10151c]"
              title={`工程拍号：当前 ${timeSignature}`}
            >
              <span className="sr-only">工程拍号</span>
              <select
                value={timeSignature}
                onChange={(e) => handleTimeSignatureChange(e.target.value as TimeSignature)}
                aria-label="工程拍号"
                className="h-full cursor-pointer appearance-none border-0 bg-transparent py-0 pl-2.5 pr-6 font-mono text-[11px] font-black text-slate-100 outline-none hover:text-emerald-200 focus:text-emerald-200"
              >
                {TIME_SIGNATURE_OPTIONS.map(signature => (
                  <option key={signature} value={signature}>{signature}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-500">▾</span>
            </label>

            <button
              type="button"
              onClick={() => setSnapEnabled(prev => !prev)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border shadow-sm transition-all cursor-pointer ${
                snapEnabled
                  ? 'border-sky-400 bg-sky-500 text-slate-950 shadow-sky-950/30'
                  : 'border-slate-800 bg-[#10151c] text-slate-500 hover:border-slate-600 hover:text-slate-300'
              }`}
              title={snapEnabled ? '网格吸附已开启' : '网格吸附已关闭'}
              aria-label={snapEnabled ? '关闭网格吸附' : '开启网格吸附'}
              aria-pressed={snapEnabled}
            >
              <Magnet className="h-3.5 w-3.5" />
            </button>

          </div>
        </div>

        {/* Scrollable Tracks Area */}
        <div
          className={`relative flex flex-col overflow-x-auto select-none bg-[#0f141b] ${
            isWorkstationExpanded ? 'min-h-0 flex-1' : 'min-h-[560px]'
          }`}
          style={{ cursor: workstationCursor }}
        >
          
          {/* Absolute Playhead indicator */}
          <div 
            className="absolute top-8 bottom-0 w-0.5 bg-slate-400 z-30 pointer-events-none transition-transform duration-75"
            style={{ 
              left: `${trackHeaderWidth + currentTime * ZOOM_PX_PER_SECOND}px`,
              boxShadow: '0 0 8px rgba(148, 163, 184, 0.45)'
            }}
          />

          {/* Time ruler (Ruler clicks) */}
          <div className="flex bg-[#151a21] border-b border-slate-800 shrink-0 h-8">
            {/* Header placeholder spacer */}
            <div
              className="shrink-0 bg-[#151a21] h-full flex items-center justify-between gap-2 px-3"
              style={{ width: `${trackHeaderWidth}px` }}
            >
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">
                {rulerMode === 'bars' ? `${timeSignature} · bars` : 'timeline'}
              </span>
              <label className="relative flex items-center">
                <span className="sr-only">时间尺显示模式</span>
                <select
                  value={rulerMode}
                  onChange={(e) => setRulerMode(e.target.value as RulerMode)}
                  title={rulerMode === 'time' ? '时间线：按秒显示和吸附' : `小节线：按 ${timeSignature} 小节与拍显示和吸附`}
                  aria-label="选择时间尺显示模式"
                  className="h-6 cursor-pointer appearance-none rounded-md border border-slate-700 bg-slate-950/80 py-0 pl-2 pr-6 text-[10px] font-black text-slate-200 outline-none transition-colors hover:border-emerald-500/70 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30"
                >
                  <option value="time">时间</option>
                  <option value="bars">小节</option>
                </select>
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-500">▾</span>
              </label>
            </div>

            {/* Scale markings container */}
            <div 
              onClick={handleRulerClick}
              className="relative h-full shrink-0 cursor-ew-resize bg-[#111923]"
              style={{ width: `${TIMELINE_CONTENT_WIDTH}px` }}
            >
              {rulerTicks.map((tick) => (
                <div 
                  key={tick.id}
                  className={`absolute bottom-0 flex h-full flex-col items-center justify-end font-mono text-[10px] ${
                    tick.major ? 'text-slate-400' : 'text-slate-600'
                  }`}
                  style={{ 
                    left: `${tick.time * ZOOM_PX_PER_SECOND}px`, 
                    transform: 'translateX(-50%)',
                    height: '100%'
                  }}
                >
                  {tick.label && <span className="mb-1">{tick.label}</span>}
                  <div className={`${tick.major ? 'h-2 bg-emerald-500/55' : 'h-1 bg-slate-700/70'} w-px`} />
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
                const trackHeight = getTrackHeight(track.id);
                const showTrackName = trackHeight >= 84;
                const showTrackPan = trackHeight >= 104;
                const panKnobRotation = (track.pan / 100) * 135;

                return (
                  <div 
                    key={track.id} 
                    className="flex shrink-0 relative duration-100 transition-colors"
                    style={{ height: `${trackHeight}px` }}
                  >
                    {/* Cubase-inspired Track Controller Header */}
                    <div
                      className="relative bg-[#20252d] shrink-0 z-10 shadow-md"
                      style={{ width: `${trackHeaderWidth}px` }}
                    >
                      <button
                        type="button"
                        aria-label="左右调整轨道控制区宽度"
                        title="左右拖拽调整轨道控制区宽度"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setTrackHeaderResizeDrag({ startX: event.clientX, initialWidth: trackHeaderWidth });
                        }}
                        className="absolute right-[-4px] top-0 z-30 h-full w-2 cursor-col-resize bg-transparent"
                      />
                      <div className="flex h-full">
                        <div className="flex w-8 shrink-0 flex-col items-center justify-between border-r border-slate-800 bg-[#171b21] py-2">
                          <span className="font-mono text-[10px] font-bold text-slate-500">{trackIndex + 1}</span>
                          <Layers className="h-3.5 w-3.5 text-slate-500" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-1">
                          {showTrackName && (
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
                          )}

                          <div className="grid grid-cols-[16px_1fr_28px] items-center gap-1.5">
                            {track.muted || track.volume <= MIN_TRACK_VOLUME_DB ? (
                              <VolumeX className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                            ) : track.volume < -18 ? (
                              <Volume1 className="w-3.5 h-3.5 text-emerald-500/70 shrink-0" />
                            ) : (
                              <Volume2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            )}
                            <input
                              type="range"
                              min={MIN_TRACK_VOLUME_DB}
                              max={MAX_TRACK_VOLUME_DB}
                              step="0.1"
                              value={track.volume}
                              onChange={(e) => updateTrackProp(track.id, 'volume', clampVolumeDb(parseFloat(e.target.value)))}
                              className="min-w-0 h-1 rounded-lg bg-slate-800 accent-emerald-500 cursor-pointer"
                              title={`音量 ${formatVolumeDbLabel(track.volume)} dB`}
                            />
                            <span className="rounded bg-slate-950 px-1 py-0.5 text-right font-mono text-[9px] text-slate-400">
                              {formatVolumeDbLabel(track.volume)}
                            </span>
                          </div>

                          {showTrackPan && (
                            <div className="ml-[17.5px] flex items-center gap-1.5">
                              <button
                                type="button"
                                aria-label={`声像 ${formatPanLabel(track.pan)}`}
                                title={`声像 ${formatPanLabel(track.pan)} · 左右拖动或滚轮调整`}
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setPanKnobDrag({ trackId: track.id, startX: event.clientX, initialPan: track.pan });
                                }}
                                onWheel={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  updateTrackProp(track.id, 'pan', clampPan(track.pan + (event.deltaY > 0 ? -5 : 5)));
                                }}
                                className="relative h-5 w-5 cursor-ew-resize rounded-full border border-sky-500/50 bg-slate-950 shadow-inner transition-all hover:border-sky-300 hover:bg-sky-950/50"
                              >
                                <span className="absolute left-1/2 top-0.5 h-1 w-px -translate-x-1/2 rounded-full bg-sky-500/60" />
                                <span className="absolute left-1 top-1/2 h-px w-1 -translate-y-1/2 rounded-full bg-sky-700/60" />
                                <span className="absolute right-1 top-1/2 h-px w-1 -translate-y-1/2 rounded-full bg-sky-700/60" />
                                <span
                                  className="absolute left-1/2 top-1/2 h-2 w-0.5 origin-[50%_8px] rounded-full bg-sky-300 shadow-[0_0_6px_rgba(56,189,248,0.65)]"
                                  style={{ transform: `translate(-50%, -100%) rotate(${panKnobRotation}deg)` }}
                                />
                                <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500" />
                              </button>
                              <span
                                className="min-w-8 rounded bg-slate-950 px-1 py-0.5 text-center font-mono text-[9px] text-sky-300"
                                title={`声像 ${formatPanLabel(track.pan)}`}
                              >
                                {formatPanLabel(track.pan)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="上下调整轨道高度"
                        title="上下拖拽调整当前音轨高度"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setTrackHeightResizeDrag({ trackId: track.id, startY: event.clientY, initialHeight: trackHeight });
                        }}
                        className="absolute bottom-[-4px] left-0 right-0 z-30 h-2 cursor-row-resize bg-transparent transition-colors hover:bg-emerald-400/25"
                      />
                    </div>

                    {/* Track Wave Lane content */}
                    <div 
                      data-workstation-track-id={track.id}
                      className={`relative shrink-0 bg-[#101722] duration-200 overflow-hidden ${
                        isDragOverTrack ? 'bg-slate-800/45 border-y border-emerald-500/20' : ''
                      }`}
                      style={{ width: `${TIMELINE_CONTENT_WIDTH}px`, cursor: workstationCursor }}
                    >
                      <button
                        type="button"
                        aria-label="上下调整轨道高度"
                        title="上下拖拽调整当前音轨高度"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setTrackHeightResizeDrag({ trackId: track.id, startY: event.clientY, initialHeight: trackHeight });
                        }}
                        className="absolute bottom-[-4px] left-0 right-0 z-30 h-2 cursor-row-resize bg-transparent transition-colors hover:bg-emerald-400/20"
                      />
                      {/* Grid background ticks lines */}
                      <div className="absolute inset-0 pointer-events-none flex">
                        {rulerTicks.map(tick => (
                          <div 
                            key={tick.id}
                            className={`absolute top-0 bottom-0 w-px border-l ${
                              tick.major ? 'border-emerald-400/18' : 'border-slate-700/18'
                            }`}
                            style={{ left: `${tick.time * ZOOM_PX_PER_SECOND}px` }}
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
                            className={`absolute top-2 bottom-2 rounded-lg border px-3 py-1.5 flex flex-col justify-between transition-shadow overflow-hidden group select-none ${
                              clip.color
                            } ${
                              isSelected ? 'ring-2 ring-emerald-500 shadow-md border-transparent' : 'shadow-sm'
                            } ${
                              isThisClipDragging ? 'opacity-40 scale-[0.98]' : ''
                            }`}
                            style={{ 
                              left: `${startPos}px`, 
                              width: `${widthPos}px`,
                              minWidth: '24px',
                              cursor: toolMode === 'select' ? (isThisClipDragging ? 'grabbing' : 'grab') : workstationCursor
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
                              <span className="flex shrink-0 items-center gap-1">
                                {Math.abs((clip.playbackRate ?? 1) - 1) > 0.001 && (
                                  <span className="rounded bg-cyan-900/15 px-1 font-mono text-[8px] font-black text-cyan-900/75">
                                    {(clip.playbackRate ?? 1).toFixed(2)}x
                                  </span>
                                )}
                                <span className="rounded bg-slate-900/10 px-1 font-mono text-[9px] font-medium">
                                  {formatTimelineDuration(clip.duration)}
                                </span>
                              </span>
                            </div>

                            {/* Position hint */}
                            <div className="relative z-10 text-[8px] font-mono text-slate-700/80">
                              起: {formatTimelinePosition(clip.startTime)}
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
                  className="shrink-0 bg-[#171c23] px-3 py-2"
                  style={{ width: `${trackHeaderWidth}px` }}
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
