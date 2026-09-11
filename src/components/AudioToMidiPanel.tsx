import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileAudio,
  FileVideo,
  Guitar,
  Loader2,
  Music2,
  Pause,
  Piano,
  Play,
  RefreshCw,
  Upload,
  Waves,
} from 'lucide-react';

type MidiMainTab = 'general' | 'specialized';
type MidiMode = 'basic-pitch' | 'piano' | 'drums' | 'guitar' | 'bass' | 'strings' | 'multitrack';

interface MidiEngineStatus {
  id: MidiMode;
  label: string;
  available: boolean;
  engine: string;
  status: string;
  detail: string;
  env?: string[];
}

interface MidiStatusResponse {
  engines: MidiEngineStatus[];
}

interface MidiConversionResult {
  midiUrl: string;
  midiFileName: string;
  mode: MidiMode;
  engine: string;
  sourceName: string;
  sourceSize: number;
  inputDuration?: number;
  notes: string[];
}

interface MidiPreviewNote {
  id: string;
  name: string;
  midi: number;
  time: number;
  duration: number;
  velocity: number;
  track: number;
}

interface MidiPreviewData {
  notes: MidiPreviewNote[];
  duration: number;
  tempo: number;
  trackCount: number;
}

interface TimelineProps {
  currentTime: number;
  duration: number;
  label: string;
  onSeek: (seconds: number) => void;
}

const GENERAL_MODE: MidiEngineStatus = {
  id: 'basic-pitch',
  label: '通用转 MIDI',
  available: false,
  engine: 'Basic Pitch',
  status: 'checking',
  detail: '适合人声哼唱、单乐器旋律、简单和声和快速 MIDI Demo。',
};

const SPECIALIZED_MODE_FALLBACKS: MidiEngineStatus[] = [
  {
    id: 'piano',
    label: '钢琴专用',
    available: false,
    engine: 'Piano Transcription',
    status: 'checking',
    detail: '适合钢琴独奏、和弦、左右手与踏板信息，优先接入本机 piano trans。',
  },
  {
    id: 'drums',
    label: '鼓专用',
    available: false,
    engine: 'Drum Transcription',
    status: 'checking',
    detail: '适合 Kick / Snare / Hi-hat / Cymbal 等鼓组节奏转 MIDI。',
  },
  {
    id: 'guitar',
    label: '吉他专用',
    available: false,
    engine: '实验通道',
    status: 'planned',
    detail: '吉他专用转录模型工程化成熟度不稳定，当前建议先用通用转 MIDI。',
  },
  {
    id: 'bass',
    label: 'Bass 专用',
    available: false,
    engine: '通用模式推荐',
    status: 'planned',
    detail: 'Bass 独立专用模型暂不稳定，当前建议用 Basic Pitch 通用模式。',
  },
  {
    id: 'strings',
    label: '弦乐专用',
    available: false,
    engine: '通用模式推荐',
    status: 'planned',
    detail: '弦乐专用模型暂不稳定，当前建议用 Basic Pitch 通用模式。',
  },
  {
    id: 'multitrack',
    label: '多乐器实验',
    available: false,
    engine: 'MuScriptor / MT3 实验',
    status: 'checking',
    detail: '尝试从混音里拆出多乐器 MIDI，结果需要人工检查，适合研究和 Demo。',
  },
];

const WAVEFORM_POINTS = 180;
const EMPTY_WAVEFORM = Array.from({ length: WAVEFORM_POINTS }, () => 0.04);
const MIDI_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#0ea5e9', '#ec4899', '#64748b'];

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatTime = (seconds: number) => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const statusTone = (status: MidiEngineStatus) => (
  status.available
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : status.status === 'planned'
      ? 'border-slate-200 bg-slate-50 text-slate-500'
      : 'border-amber-200 bg-amber-50 text-amber-800'
);

const readAudioWaveform = async (file: File) => {
  const AudioContextClass = window.AudioContext
    || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error('当前浏览器不支持音频波形解码。');

  const context = new AudioContextClass();
  try {
    const audioBuffer = await context.decodeAudioData(await file.arrayBuffer());
    const peaks = new Array<number>(WAVEFORM_POINTS).fill(0);
    const samplesPerPoint = Math.max(1, Math.floor(audioBuffer.length / WAVEFORM_POINTS));
    for (let pointIndex = 0; pointIndex < WAVEFORM_POINTS; pointIndex += 1) {
      const start = pointIndex * samplesPerPoint;
      const end = pointIndex === WAVEFORM_POINTS - 1
        ? audioBuffer.length
        : Math.min(audioBuffer.length, start + samplesPerPoint);
      let peak = 0;
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
        const samples = audioBuffer.getChannelData(channel);
        for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
          peak = Math.max(peak, Math.abs(samples[sampleIndex] || 0));
        }
      }
      peaks[pointIndex] = peak;
    }
    const maxPeak = Math.max(...peaks, 0.0001);
    return {
      duration: audioBuffer.duration,
      peaks: peaks.map(peak => Math.max(0.025, peak / maxPeak)),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
};

const WaveformTimeline = React.memo(function WaveformTimeline({
  peaks,
  loading,
  currentTime,
  duration,
  label,
  onSeek,
}: TimelineProps & { peaks: number[]; loading: boolean }) {
  const clipId = `source-waveform-${useId().replace(/:/g, '')}`;
  const waveform = peaks.length > 0 ? peaks : EMPTY_WAVEFORM;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const barWidth = 1000 / waveform.length;

  return (
    <div className="relative h-24 min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={progress * 1000} height="100" />
          </clipPath>
        </defs>
        {waveform.map((peak, index) => {
          const height = Math.max(3, Math.min(88, peak * 88));
          return (
            <rect
              key={index}
              x={index * barWidth + barWidth * 0.16}
              y={(100 - height) / 2}
              width={Math.max(1.3, barWidth * 0.68)}
              height={height}
              rx="1.4"
              fill="#cbd5e1"
            />
          );
        })}
        <g clipPath={`url(#${clipId})`}>
          {waveform.map((peak, index) => {
            const height = Math.max(3, Math.min(88, peak * 88));
            return (
              <rect
                key={index}
                x={index * barWidth + barWidth * 0.16}
                y={(100 - height) / 2}
                width={Math.max(1.3, barWidth * 0.68)}
                height={height}
                rx="1.4"
                fill="#10b981"
              />
            );
          })}
        </g>
        <line x1={progress * 1000} x2={progress * 1000} y1="7" y2="93" stroke="#047857" strokeWidth="2" />
      </svg>
      <input
        type="range"
        min="0"
        max={Math.max(duration, 0.01)}
        step="0.01"
        value={Math.min(currentTime, Math.max(duration, 0.01))}
        onChange={event => onSeek(Number(event.target.value))}
        aria-label={label}
        disabled={duration <= 0}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
      />
      {loading ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/70 text-[11px] font-bold text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在提取波形
        </div>
      ) : null}
    </div>
  );
});

const PianoRollTimeline = React.memo(function PianoRollTimeline({
  notes,
  currentTime,
  duration,
  label,
  onSeek,
}: TimelineProps & { notes: MidiPreviewNote[] }) {
  const geometry = useMemo(() => {
    let lowestPitch = 48;
    let highestPitch = 72;
    if (notes.length > 0) {
      lowestPitch = notes[0].midi;
      highestPitch = notes[0].midi;
      for (const note of notes) {
        lowestPitch = Math.min(lowestPitch, note.midi);
        highestPitch = Math.max(highestPitch, note.midi);
      }
    }
    const minPitch = Math.max(0, lowestPitch - 2);
    const maxPitch = Math.min(127, highestPitch + 2);
    const pitchSpan = Math.max(12, maxPitch - minPitch + 1);
    return { maxPitch, pitchSpan };
  }, [notes]);
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <div className="grid min-w-0 grid-cols-[42px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
      <div className="relative h-40 border-r border-slate-700 bg-slate-100 text-[9px] font-bold text-slate-500" aria-hidden="true">
        {Array.from({ length: geometry.pitchSpan }, (_, index) => {
          const pitch = geometry.maxPitch - index;
          if (pitch % 12 !== 0) return null;
          return (
            <span key={pitch} className="absolute left-1" style={{ top: `${(index / geometry.pitchSpan) * 100}%` }}>
              C{Math.floor(pitch / 12) - 1}
            </span>
          );
        })}
      </div>
      <div className="relative h-40 min-w-0 overflow-hidden">
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
          {Array.from({ length: geometry.pitchSpan + 1 }, (_, index) => (
            <line
              key={`pitch-${index}`}
              x1="0"
              x2="1000"
              y1={(index / geometry.pitchSpan) * 200}
              y2={(index / geometry.pitchSpan) * 200}
              stroke={index % 12 === 0 ? '#475569' : '#1e293b'}
              strokeWidth={index % 12 === 0 ? 1.2 : 0.6}
            />
          ))}
          {Array.from({ length: 17 }, (_, index) => (
            <line
              key={`time-${index}`}
              x1={(index / 16) * 1000}
              x2={(index / 16) * 1000}
              y1="0"
              y2="200"
              stroke={index % 4 === 0 ? '#475569' : '#273449'}
              strokeWidth={index % 4 === 0 ? 1.2 : 0.7}
            />
          ))}
          {notes.map(note => (
            <rect
              key={note.id}
              x={duration > 0 ? (note.time / duration) * 1000 : 0}
              y={((geometry.maxPitch - note.midi) / geometry.pitchSpan) * 200 + 1}
              width={duration > 0 ? Math.max(2.5, (note.duration / duration) * 1000) : 2.5}
              height={Math.max(2.5, 200 / geometry.pitchSpan - 2)}
              rx="2"
              fill={MIDI_COLORS[note.track % MIDI_COLORS.length]}
              opacity={0.55 + note.velocity * 0.45}
            />
          ))}
          <line x1={progress * 1000} x2={progress * 1000} y1="0" y2="200" stroke="#f8fafc" strokeWidth="2" />
        </svg>
        <input
          type="range"
          min="0"
          max={Math.max(duration, 0.01)}
          step="0.01"
          value={Math.min(currentTime, Math.max(duration, 0.01))}
          onChange={event => onSeek(Number(event.target.value))}
          aria-label={label}
          disabled={duration <= 0}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        />
        {notes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-400">
            MIDI 文件中没有检测到可显示的音符
          </div>
        ) : null}
      </div>
    </div>
  );
});

export default function AudioToMidiPanel() {
  const [activeTab, setActiveTab] = useState<MidiMainTab>('general');
  const [selectedMode, setSelectedMode] = useState<MidiMode>('piano');
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<MidiStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MidiConversionResult | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceWaveform, setSourceWaveform] = useState<number[]>([]);
  const [sourceWaveformLoading, setSourceWaveformLoading] = useState(false);
  const [sourcePreviewError, setSourcePreviewError] = useState<string | null>(null);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [sourceCurrentTime, setSourceCurrentTime] = useState(0);
  const [sourcePlaying, setSourcePlaying] = useState(false);
  const [midiPreview, setMidiPreview] = useState<MidiPreviewData | null>(null);
  const [midiPreviewLoading, setMidiPreviewLoading] = useState(false);
  const [midiPreviewError, setMidiPreviewError] = useState<string | null>(null);
  const [midiCurrentTime, setMidiCurrentTime] = useState(0);
  const [midiPlaying, setMidiPlaying] = useState(false);
  const [comparing, setComparing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null);
  const midiCleanupRef = useRef<(() => void) | null>(null);
  const midiAnimationRef = useRef<number | null>(null);
  const midiPlaybackTokenRef = useRef(0);

  const engines = useMemo(() => {
    const statusMap = new Map((status?.engines || []).map(engine => [engine.id, engine]));
    return {
      general: statusMap.get('basic-pitch') || GENERAL_MODE,
      specialized: SPECIALIZED_MODE_FALLBACKS.map(item => statusMap.get(item.id) || item),
    };
  }, [status]);

  const activeEngine = activeTab === 'general'
    ? engines.general
    : engines.specialized.find(item => item.id === selectedMode) || engines.specialized[0];

  const refreshStatus = async () => {
    setLoadingStatus(true);
    try {
      const response = await fetch('/api/audio-to-midi/status');
      if (!response.ok) throw new Error('无法读取 MIDI 模型状态。');
      setStatus(await response.json());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取 MIDI 模型状态失败。');
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    if (!file) {
      setSourceUrl('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setSourceUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    setSourceWaveform([]);
    setSourceCurrentTime(0);
    setSourceDuration(0);
    setSourcePreviewError(null);
    if (!file) return undefined;

    setSourceWaveformLoading(true);
    void readAudioWaveform(file)
      .then(({ peaks, duration }) => {
        if (cancelled) return;
        setSourceWaveform(peaks);
        setSourceDuration(duration);
      })
      .catch((reason) => {
        if (cancelled) return;
        setSourcePreviewError(reason instanceof Error ? reason.message : '无法生成原始音频波形。');
      })
      .finally(() => {
        if (!cancelled) setSourceWaveformLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    setMidiPreview(null);
    setMidiCurrentTime(0);
    setMidiPreviewError(null);
    if (!result) return undefined;

    setMidiPreviewLoading(true);
    void Promise.all([
      import('@tonejs/midi'),
      fetch(result.midiUrl),
    ])
      .then(async ([{ Midi }, response]) => {
        if (!response.ok) throw new Error('无法读取生成的 MIDI 文件。');
        const midi = new Midi(await response.arrayBuffer());
        const notes = midi.tracks
          .flatMap((track, trackIndex) => track.notes.map((note, noteIndex) => ({
            id: `${trackIndex}-${noteIndex}-${note.ticks}`,
            name: note.name,
            midi: note.midi,
            time: note.time,
            duration: Math.max(0.04, note.duration),
            velocity: note.velocity,
            track: trackIndex,
          })))
          .sort((first, second) => first.time - second.time || first.midi - second.midi);
        let duration = midi.duration || 0;
        for (const note of notes) duration = Math.max(duration, note.time + note.duration);
        if (cancelled) return;
        setMidiPreview({
          notes,
          duration,
          tempo: midi.header.tempos[0]?.bpm || 120,
          trackCount: midi.tracks.filter(track => track.notes.length > 0).length,
        });
        void import('tone');
      })
      .catch((reason) => {
        if (cancelled) return;
        setMidiPreviewError(reason instanceof Error ? reason.message : '无法解析生成的 MIDI 文件。');
      })
      .finally(() => {
        if (!cancelled) setMidiPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [result]);

  const stopMidiPlayback = useCallback((resetTime = false) => {
    midiPlaybackTokenRef.current += 1;
    midiCleanupRef.current?.();
    midiCleanupRef.current = null;
    if (midiAnimationRef.current !== null) {
      window.cancelAnimationFrame(midiAnimationRef.current);
      midiAnimationRef.current = null;
    }
    setMidiPlaying(false);
    if (resetTime) setMidiCurrentTime(0);
  }, []);

  useEffect(() => () => {
    sourceAudioRef.current?.pause();
    stopMidiPlayback();
  }, [stopMidiPlayback]);

  const startMidiPlayback = useCallback(async (offset: number) => {
    if (!midiPreview || midiPreview.notes.length === 0 || midiPreview.duration <= 0) {
      setMidiPreviewError('MIDI 文件中没有可播放的音符。');
      return false;
    }

    stopMidiPlayback();
    const token = midiPlaybackTokenRef.current;
    const safeOffset = offset >= midiPreview.duration ? 0 : Math.max(0, offset);
    try {
      const Tone = await import('tone');
      await Tone.start();
      if (token !== midiPlaybackTokenRef.current) return false;

      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.01, decay: 0.12, sustain: 0.35, release: 0.8 },
      }).toDestination();
      synth.volume.value = -9;
      const transport = Tone.getTransport();
      transport.stop();
      transport.cancel();
      const part = new Tone.Part<MidiPreviewNote>(
        (time, note) => synth.triggerAttackRelease(
          note.name,
          Math.max(0.04, note.duration),
          time,
          Math.max(0.08, note.velocity),
        ),
        midiPreview.notes.map(note => [note.time, note] as [number, MidiPreviewNote]),
      );
      part.start(0);
      transport.start(undefined, safeOffset);
      midiCleanupRef.current = () => {
        transport.stop();
        transport.cancel();
        part.dispose();
        synth.releaseAll();
        synth.dispose();
      };
      setMidiCurrentTime(safeOffset);
      setMidiPlaying(true);
      setMidiPreviewError(null);

      let lastPaint = 0;
      const updatePlayhead = (timestamp: number) => {
        if (token !== midiPlaybackTokenRef.current) return;
        const current = Math.min(midiPreview.duration, Number(transport.seconds) || 0);
        if (timestamp - lastPaint >= 50) {
          lastPaint = timestamp;
          setMidiCurrentTime(current);
        }
        if (current >= midiPreview.duration) {
          stopMidiPlayback();
          setMidiCurrentTime(midiPreview.duration);
          setComparing(false);
          return;
        }
        midiAnimationRef.current = window.requestAnimationFrame(updatePlayhead);
      };
      midiAnimationRef.current = window.requestAnimationFrame(updatePlayhead);
      return true;
    } catch (reason) {
      if (token === midiPlaybackTokenRef.current) {
        setMidiPreviewError(reason instanceof Error ? reason.message : 'MIDI 播放器启动失败。');
        stopMidiPlayback();
      }
      return false;
    }
  }, [midiPreview, stopMidiPlayback]);

  const handleFile = (nextFile: File | null) => {
    sourceAudioRef.current?.pause();
    stopMidiPlayback(true);
    setSourcePlaying(false);
    setComparing(false);
    setFile(nextFile);
    setError(null);
    setResult(null);
    if (nextFile) setProgress('已载入音频，选择模式后即可转 MIDI。');
  };

  const handleConvert = async () => {
    if (!file || !activeEngine) return;
    stopMidiPlayback(true);
    setConverting(true);
    setError(null);
    setResult(null);
    setProgress(`正在使用 ${activeEngine.engine} 转换 MIDI…`);
    try {
      const formData = new FormData();
      formData.append('media', file, file.name);
      formData.append('mode', activeTab === 'general' ? 'basic-pitch' : activeEngine.id);
      const response = await fetch('/api/audio-to-midi/convert', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || `转换失败（${response.status}）。`);
      }
      setResult(payload as MidiConversionResult);
      setProgress('MIDI 已生成，可以试听、对比或下载。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '音频转 MIDI 失败。');
      setProgress('');
    } finally {
      setConverting(false);
    }
  };

  const seekSource = (seconds: number) => {
    const audio = sourceAudioRef.current;
    if (audio) audio.currentTime = seconds;
    setSourceCurrentTime(seconds);
    if (comparing) {
      setMidiCurrentTime(seconds);
      void startMidiPlayback(seconds);
      setComparing(true);
    }
  };

  const seekMidi = (seconds: number) => {
    setMidiCurrentTime(seconds);
    if (comparing) {
      const audio = sourceAudioRef.current;
      if (audio) audio.currentTime = Math.min(seconds, sourceDuration || seconds);
      void startMidiPlayback(seconds);
      setComparing(true);
    } else if (midiPlaying) {
      void startMidiPlayback(seconds);
    }
  };

  const toggleSourcePlayback = async () => {
    const audio = sourceAudioRef.current;
    if (!audio) return;
    setComparing(false);
    if (sourcePlaying) {
      audio.pause();
      return;
    }
    stopMidiPlayback();
    if (audio.currentTime >= (sourceDuration || audio.duration) - 0.05) audio.currentTime = 0;
    await audio.play().catch(() => setSourcePreviewError('浏览器无法播放这个源文件。'));
  };

  const toggleMidiPlayback = async () => {
    setComparing(false);
    sourceAudioRef.current?.pause();
    if (midiPlaying) {
      stopMidiPlayback();
      return;
    }
    await startMidiPlayback(midiCurrentTime);
  };

  const toggleComparison = async () => {
    const audio = sourceAudioRef.current;
    if (!audio || !midiPreview || midiPreview.notes.length === 0) return;
    if (comparing) {
      audio.pause();
      stopMidiPlayback();
      setComparing(false);
      return;
    }

    audio.currentTime = 0;
    setSourceCurrentTime(0);
    setMidiCurrentTime(0);
    const audioPlay = audio.play();
    const midiStarted = await startMidiPlayback(0);
    if (!midiStarted) {
      audio.pause();
      return;
    }
    await audioPlay.catch(() => {
      stopMidiPlayback();
      setSourcePreviewError('浏览器无法播放这个源文件。');
    });
    if (!audio.paused) setComparing(true);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <nav className="grid grid-cols-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-1">
        {([
          ['general', '通用转 MIDI', '适合旋律、哼唱和单乐器'],
          ['specialized', '乐器专用转 MIDI', '钢琴 / 鼓 / 吉他 / Bass / 弦乐 / 多乐器实验'],
        ] as const).map(([id, label, description]) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`rounded-lg px-3 py-2 text-left transition-all ${active ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500 hover:bg-white/60 hover:text-slate-800'}`}
            >
              <span className="flex items-center gap-1.5 text-xs font-black">
                {label}
                {id === 'general' ? (
                  <span
                    role="status"
                    aria-label={engines.general.available ? '通用模型已就绪' : '通用模型未就绪'}
                    title={engines.general.available ? '通用模型已就绪' : '通用模型未就绪'}
                    className={`h-2 w-2 shrink-0 rounded-full ring-2 ring-white ${engines.general.available ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  />
                ) : null}
              </span>
              <span className="mt-0.5 block text-[9px] font-semibold leading-tight">{description}</span>
            </button>
          );
        })}
      </nav>

      <div className="w-full">
        <section className="space-y-5">
          {activeTab === 'specialized' && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {engines.specialized.map((mode) => {
                const selected = selectedMode === mode.id;
                const Icon = mode.id === 'piano' ? Piano : mode.id === 'guitar' || mode.id === 'bass' ? Guitar : Music2;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setSelectedMode(mode.id)}
                    className={`rounded-2xl border p-4 text-left transition-all ${selected ? 'border-emerald-300 bg-white shadow-sm ring-2 ring-emerald-100' : 'border-slate-200 bg-white hover:border-emerald-200 hover:shadow-sm'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 text-xs font-black text-slate-800">
                        <Icon className="h-4 w-4 text-emerald-600" />
                        {mode.label}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${statusTone(mode)}`}>
                        {mode.available ? '可用' : mode.status === 'planned' ? '待接入' : '需配置'}
                      </span>
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{mode.detail}</p>
                  </button>
                );
              })}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-800">
                  {activeTab === 'general' ? '通用转 MIDI' : `${activeEngine.label}：${activeEngine.engine}`}
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{activeEngine.detail}</p>
              </div>
              <button
                type="button"
                onClick={() => void refreshStatus()}
                disabled={loadingStatus}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[10px] font-bold text-slate-600 hover:bg-white disabled:opacity-50"
              >
                {loadingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                检测模型
              </button>
            </div>

            <div
              onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                handleFile(event.dataTransfer.files?.[0] || null);
              }}
              onClick={() => inputRef.current?.click()}
              className={`flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-5 text-center transition-all ${dragActive ? 'scale-[0.99] border-emerald-500 bg-emerald-50' : file ? 'border-emerald-200 bg-emerald-50/30 hover:bg-emerald-50/50' : 'border-slate-200 bg-slate-50/60 hover:border-emerald-300 hover:bg-slate-50'}`}
            >
              <input
                ref={inputRef}
                type="file"
                accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.flac,.aif,.aiff,.mp4,.mov,.webm,.mkv"
                className="hidden"
                onChange={(event) => handleFile(event.target.files?.[0] || null)}
              />
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-white bg-white text-emerald-600 shadow-sm">
                {file?.type.startsWith('video/') ? <FileVideo className="h-5 w-5" /> : file ? <FileAudio className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
              </div>
              {file ? (
                <>
                  <p className="max-w-md truncate text-xs font-black text-slate-800">{file.name}</p>
                  <p className="mt-1 text-[10px] font-semibold text-slate-500">原始大小：{formatBytes(file.size)} · 点击可重新选择</p>
                </>
              ) : (
                <>
                  <p className="text-xs font-black text-slate-700">点击上传或拖入音频 / 视频文件</p>
                  <p className="mt-1 max-w-md text-[10px] leading-relaxed text-slate-400">
                    支持 WAV、MP3、M4A、FLAC、OGG、MP4 等；单个文件不超过 100 MB。旋律越清晰，MIDI 结果越稳定。
                  </p>
                </>
              )}
            </div>

            {(progress || error) && (
              <div className={`mt-4 rounded-xl border px-4 py-3 text-xs ${error ? 'border-rose-100 bg-rose-50 text-rose-700' : 'border-emerald-100 bg-emerald-50 text-emerald-800'}`}>
                <div className="flex items-start gap-2">
                  {converting ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : error ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span className="font-semibold leading-relaxed">{error || progress}</span>
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={!file || converting || !activeEngine.available}
              onClick={() => void handleConvert()}
              className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-xs font-black text-white shadow-lg shadow-emerald-600/15 transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
            >
              {converting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music2 className="h-4 w-4" />}
              {converting ? '正在转换 MIDI…' : activeEngine.available ? '开始音频转 MIDI' : '当前模型未配置'}
            </button>
          </div>
        </section>

      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Waves className="h-4 w-4 text-emerald-600" />
              <h3 className="text-sm font-black text-slate-800">试听与对比</h3>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">对照源音频波形与 MIDI 音符卷帘，支持分别试听或从开头同步播放。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!sourceUrl || !midiPreview || midiPreview.notes.length === 0}
              onClick={() => void toggleComparison()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-[11px] font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              {comparing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
              {comparing ? '暂停对比' : '同步对比'}
            </button>
            {result ? (
              <a
                href={result.midiUrl}
                download={result.midiFileName}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-[11px] font-black text-white transition-colors hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" />
                下载 MIDI
              </a>
            ) : null}
          </div>
        </div>

        <audio
          ref={sourceAudioRef}
          src={sourceUrl || undefined}
          preload="metadata"
          className="hidden"
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration || 0;
            setSourceDuration(current => current || duration);
          }}
          onTimeUpdate={event => setSourceCurrentTime(event.currentTarget.currentTime)}
          onPlay={() => setSourcePlaying(true)}
          onPause={() => setSourcePlaying(false)}
          onEnded={() => {
            setSourcePlaying(false);
            setComparing(false);
          }}
        />

        <div className="divide-y divide-slate-200">
          <div className="grid min-w-0 gap-4 px-5 py-5 lg:grid-cols-[180px_minmax(0,1fr)] lg:items-center">
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase text-emerald-700">A · 原始音频</span>
              <p className="mt-1 truncate text-xs font-black text-slate-800">{file?.name || '等待上传音频'}</p>
              <p className="mt-1 text-[10px] font-semibold text-slate-500">
                {file ? `${formatBytes(file.size)} · ${formatTime(sourceDuration)}` : '上传后显示真实波形'}
              </p>
              <button
                type="button"
                disabled={!sourceUrl}
                onClick={() => void toggleSourcePlayback()}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-700 hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
              >
                {sourcePlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                {sourcePlaying ? '暂停原音' : '播放原音'}
              </button>
            </div>
            <div className="min-w-0">
              <WaveformTimeline
                peaks={sourceWaveform}
                loading={sourceWaveformLoading}
                currentTime={sourceCurrentTime}
                duration={sourceDuration}
                label="原始音频波形播放位置"
                onSeek={seekSource}
              />
              <div className="mt-1.5 flex justify-between text-[9px] font-bold tabular-nums text-slate-400">
                <span>{formatTime(sourceCurrentTime)}</span>
                <span>{formatTime(sourceDuration)}</span>
              </div>
              {sourcePreviewError ? <p className="mt-2 text-[10px] font-semibold text-amber-700">{sourcePreviewError}</p> : null}
            </div>
          </div>

          <div className="grid min-w-0 gap-4 px-5 py-5 lg:grid-cols-[180px_minmax(0,1fr)] lg:items-center">
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase text-indigo-600">B · MIDI 音符</span>
              <p className="mt-1 truncate text-xs font-black text-slate-800">{result?.midiFileName || '等待转换 MIDI'}</p>
              <p className="mt-1 text-[10px] font-semibold text-slate-500">
                {midiPreview
                  ? `${midiPreview.notes.length} 个音符 · ${midiPreview.trackCount} 轨 · ${Math.round(midiPreview.tempo)} BPM`
                  : midiPreviewLoading ? '正在解析 MIDI 音符' : '转换后显示钢琴卷帘'}
              </p>
              <button
                type="button"
                disabled={!midiPreview || midiPreview.notes.length === 0 || midiPreviewLoading}
                onClick={() => void toggleMidiPlayback()}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-700 hover:border-indigo-200 hover:text-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
              >
                {midiPreviewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : midiPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                {midiPlaying ? '暂停 MIDI' : '播放 MIDI'}
              </button>
            </div>
            <div className="min-w-0">
              <PianoRollTimeline
                notes={midiPreview?.notes || []}
                currentTime={midiCurrentTime}
                duration={midiPreview?.duration || 0}
                label="MIDI 音符播放位置"
                onSeek={seekMidi}
              />
              <div className="mt-1.5 flex justify-between text-[9px] font-bold tabular-nums text-slate-400">
                <span>{formatTime(midiCurrentTime)}</span>
                <span>{formatTime(midiPreview?.duration || 0)}</span>
              </div>
              {midiPreviewError ? <p className="mt-2 text-[10px] font-semibold text-amber-700">{midiPreviewError}</p> : null}
            </div>
          </div>
        </div>

        {result ? (
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
            <div className="flex flex-col gap-2 text-[10px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <p><span className="font-black text-slate-700">转换模型：</span>{result.engine}</p>
              <p><span className="font-black text-slate-700">源文件：</span>{result.sourceName} · {formatBytes(result.sourceSize)}</p>
            </div>
            {result.notes.length > 0 ? (
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{result.notes.join(' ')}</p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
