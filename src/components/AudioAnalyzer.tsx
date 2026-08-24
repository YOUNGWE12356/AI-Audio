/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  FileAudio,
  Gauge,
  Guitar,
  Loader2,
  Music2,
  Piano,
  Upload,
  Waves,
} from 'lucide-react';

type Confidence = '高' | '中' | '低';

interface AnalyzerResult {
  fileName: string;
  duration: number;
  sampleRate: number;
  channels: number;
  bpm: {
    value: number;
    confidence: Confidence;
    alternatives: number[];
  };
  key: {
    name: string;
    mode: 'Major' | 'Minor';
    confidence: Confidence;
  };
  chords: Array<{
    section: string;
    chord: string;
    confidence: Confidence;
  }>;
  instruments: Array<{
    name: string;
    reason: string;
    confidence: Confidence;
  }>;
  audioProfile: {
    peakDb: number;
    rmsDb: number;
    dynamicRangeDb: number;
    noiseFloorRmsDb: number;
    snrDb: number;
    spectralCentroid: number;
    bassPercent: number;
    midPercent: number;
    highPercent: number;
    stereoWidth: number;
    zeroCrossingRate: number;
  };
  productionNotes: string[];
}

type AnalysisItemStatus = 'pending' | 'analyzing' | 'done' | 'error';

interface AnalysisQueueItem {
  id: string;
  file: File;
  status: AnalysisItemStatus;
  progress: number;
  result?: AnalyzerResult;
  error?: string;
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const AUDIO_FILE_EXTENSION_REGEX = /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm|opus|aif|aiff|caf)$/i;

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
};

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const dbFromPower = (value: number) => 20 * Math.log10(Math.max(value, 1e-9));

const toMono = (buffer: AudioBuffer) => {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      mono[i] += data[i] / buffer.numberOfChannels;
    }
  }
  return mono;
};

const estimateTempo = (mono: Float32Array, sampleRate: number) => {
  const envelopeRate = 100;
  const hop = Math.max(1, Math.floor(sampleRate / envelopeRate));
  const envelopeLength = Math.floor(mono.length / hop);
  const envelope = new Float32Array(envelopeLength);

  for (let i = 0; i < envelopeLength; i += 1) {
    let sum = 0;
    const start = i * hop;
    for (let j = 0; j < hop && start + j < mono.length; j += 1) {
      const sample = mono[start + j];
      sum += sample * sample;
    }
    envelope[i] = Math.sqrt(sum / hop);
  }

  let mean = 0;
  for (let i = 0; i < envelope.length; i += 1) mean += envelope[i];
  mean /= Math.max(envelope.length, 1);

  let previous = 0;
  const novelty = new Float32Array(envelope.length);
  for (let i = 0; i < envelope.length; i += 1) {
    const current = Math.max(0, envelope[i] - mean);
    novelty[i] = Math.max(0, current - previous);
    previous = current;
  }

  const candidates: Array<{ bpm: number; score: number }> = [];
  for (let bpm = 60; bpm <= 200; bpm += 1) {
    const lag = Math.round((60 / bpm) * envelopeRate);
    let score = 0;
    for (let i = lag; i < novelty.length; i += 1) {
      score += novelty[i] * novelty[i - lag];
    }
    candidates.push({ bpm, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] || { bpm: 120, score: 0 };
  const second = candidates.find(candidate => Math.abs(candidate.bpm - best.bpm) > 4);
  const confidence: Confidence = best.score > 0 && second
    ? best.score / Math.max(second.score, 1e-9) > 1.25
      ? '中'
      : '低'
    : '低';

  return {
    value: best.bpm,
    confidence,
    alternatives: candidates
      .filter(candidate => Math.abs(candidate.bpm - best.bpm) > 4)
      .slice(0, 3)
      .map(candidate => candidate.bpm),
  };
};

const goertzelPower = (samples: Float32Array, start: number, size: number, sampleRate: number, frequency: number) => {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;

  for (let i = 0; i < size; i += 1) {
    const sample = samples[start + i] || 0;
    q0 = coeff * q1 - q2 + sample;
    q2 = q1;
    q1 = q0;
  }

  return q1 * q1 + q2 * q2 - q1 * q2 * coeff;
};

const computeChroma = (
  mono: Float32Array,
  sampleRate: number,
  startSample = 0,
  endSample = mono.length,
) => {
  const chroma = new Array(12).fill(0) as number[];
  const windowSize = Math.min(4096, Math.max(1024, Math.floor(sampleRate * 0.09)));
  const hop = Math.max(windowSize * 3, Math.floor(sampleRate * 0.35));
  const safeEnd = Math.max(startSample + windowSize, endSample - windowSize);
  let windows = 0;

  for (let start = startSample; start < safeEnd && windows < 180; start += hop) {
    for (let note = 0; note < 12; note += 1) {
      for (let octave = 2; octave <= 6; octave += 1) {
        const midi = (octave + 1) * 12 + note;
        const frequency = 440 * Math.pow(2, (midi - 69) / 12);
        if (frequency > 60 && frequency < Math.min(sampleRate / 2, 4200)) {
          chroma[note] += Math.sqrt(goertzelPower(mono, start, windowSize, sampleRate, frequency));
        }
      }
    }
    windows += 1;
  }

  const total = chroma.reduce((sum, value) => sum + value, 0) || 1;
  return chroma.map(value => value / total);
};

const rotateProfile = (profile: number[], root: number) => (
  profile.map((_, index) => profile[(index - root + 12) % 12])
);

const correlation = (a: number[], b: number[]) => {
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let top = 0;
  let bottomA = 0;
  let bottomB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    top += da * db;
    bottomA += da * da;
    bottomB += db * db;
  }
  return top / Math.sqrt(Math.max(bottomA * bottomB, 1e-9));
};

const estimateKey = (chroma: number[]) => {
  const scores: Array<{ root: number; mode: 'Major' | 'Minor'; score: number }> = [];
  for (let root = 0; root < 12; root += 1) {
    scores.push({ root, mode: 'Major', score: correlation(chroma, rotateProfile(MAJOR_PROFILE, root)) });
    scores.push({ root, mode: 'Minor', score: correlation(chroma, rotateProfile(MINOR_PROFILE, root)) });
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  const margin = best.score - second.score;
  return {
    name: `${NOTES[best.root]} ${best.mode}`,
    mode: best.mode,
    confidence: margin > 0.08 ? '中' : '低' as Confidence,
    root: best.root,
  };
};

const estimateChord = (chroma: number[]) => {
  const chordTypes = [
    { suffix: '', intervals: [0, 4, 7] },
    { suffix: 'm', intervals: [0, 3, 7] },
    { suffix: 'sus4', intervals: [0, 5, 7] },
    { suffix: '7', intervals: [0, 4, 7, 10] },
    { suffix: 'm7', intervals: [0, 3, 7, 10] },
  ];
  const scores: Array<{ chord: string; score: number }> = [];

  for (let root = 0; root < 12; root += 1) {
    for (const type of chordTypes) {
      const score = type.intervals.reduce((sum, interval) => sum + chroma[(root + interval) % 12], 0)
        - chroma.reduce((sum, value, index) => type.intervals.includes((index - root + 12) % 12) ? sum : sum + value * 0.16, 0);
      scores.push({ chord: `${NOTES[root]}${type.suffix}`, score });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  return {
    chord: best.chord,
    confidence: best.score - second.score > 0.035 ? '中' : '低' as Confidence,
  };
};

const analyzeSpectrumProfile = (mono: Float32Array, sampleRate: number) => {
  const sampleCount = Math.min(160000, mono.length);
  const step = Math.max(1, Math.floor(mono.length / sampleCount));
  let peak = 0;
  let rmsSum = 0;
  let zeroCrossings = 0;
  let previous = 0;

  for (let i = 0; i < mono.length; i += step) {
    const value = mono[i];
    const abs = Math.abs(value);
    peak = Math.max(peak, abs);
    rmsSum += value * value;
    if ((value >= 0 && previous < 0) || (value < 0 && previous >= 0)) zeroCrossings += 1;
    previous = value;
  }

  const inspected = Math.ceil(mono.length / step);
  const rms = Math.sqrt(rmsSum / Math.max(inspected, 1));
  const noiseWindowSize = Math.max(512, Math.floor(sampleRate * 0.05));
  const noiseFrameRmsValues: number[] = [];
  for (let start = 0; start + noiseWindowSize < mono.length; start += noiseWindowSize) {
    let framePower = 0;
    for (let i = 0; i < noiseWindowSize; i += 1) {
      const sample = mono[start + i];
      framePower += sample * sample;
    }
    noiseFrameRmsValues.push(Math.sqrt(framePower / noiseWindowSize));
  }
  noiseFrameRmsValues.sort((a, b) => a - b);
  const quietFrameCount = Math.max(1, Math.floor(noiseFrameRmsValues.length * 0.1));
  const quietRmsSum = noiseFrameRmsValues
    .slice(0, quietFrameCount)
    .reduce((sum, value) => sum + value * value, 0);
  const noiseFloorRms = Math.sqrt(quietRmsSum / quietFrameCount);
  const noiseFloorRmsDb = dbFromPower(noiseFloorRms);
  const snrDb = Math.max(0, Math.min(96, dbFromPower(rms) - noiseFloorRmsDb));
  const chroma = computeChroma(mono, sampleRate);
  const key = estimateKey(chroma);

  const bandEnergy = { bass: 0, mid: 0, high: 0 };
  let centroidTop = 0;
  let centroidBottom = 0;
  const windowSize = 2048;
  const hop = Math.max(windowSize * 8, Math.floor(sampleRate * 0.4));
  let windows = 0;
  for (let start = 0; start + windowSize < mono.length && windows < 120; start += hop) {
    for (let frequency = 55; frequency <= Math.min(8000, sampleRate / 2); frequency += frequency < 1000 ? 55 : 160) {
      const magnitude = Math.sqrt(goertzelPower(mono, start, windowSize, sampleRate, frequency));
      if (frequency < 180) bandEnergy.bass += magnitude;
      else if (frequency < 2500) bandEnergy.mid += magnitude;
      else bandEnergy.high += magnitude;
      centroidTop += frequency * magnitude;
      centroidBottom += magnitude;
    }
    windows += 1;
  }

  const totalEnergy = bandEnergy.bass + bandEnergy.mid + bandEnergy.high || 1;
  return {
    peakDb: dbFromPower(peak),
    rmsDb: dbFromPower(rms),
    dynamicRangeDb: dbFromPower(peak) - dbFromPower(rms),
    noiseFloorRmsDb,
    snrDb,
    spectralCentroid: centroidTop / Math.max(centroidBottom, 1e-9),
    bassPercent: Math.round((bandEnergy.bass / totalEnergy) * 100),
    midPercent: Math.round((bandEnergy.mid / totalEnergy) * 100),
    highPercent: Math.round((bandEnergy.high / totalEnergy) * 100),
    zeroCrossingRate: zeroCrossings / Math.max(inspected, 1),
    chroma,
    key,
  };
};

const estimateStereoWidth = (buffer: AudioBuffer) => {
  if (buffer.numberOfChannels < 2) return 0;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const step = Math.max(1, Math.floor(buffer.length / 100000));
  let side = 0;
  let mid = 0;
  for (let i = 0; i < buffer.length; i += step) {
    const midValue = (left[i] + right[i]) * 0.5;
    const sideValue = (left[i] - right[i]) * 0.5;
    mid += midValue * midValue;
    side += sideValue * sideValue;
  }
  return Math.min(100, Math.round((Math.sqrt(side) / Math.max(Math.sqrt(mid), 1e-9)) * 100));
};

const estimateInstruments = (
  profile: AnalyzerResult['audioProfile'],
  bpm: number,
): AnalyzerResult['instruments'] => {
  const instruments: AnalyzerResult['instruments'] = [];
  if (profile.bassPercent > 28) {
    instruments.push({ name: 'Bass / 低音乐器', confidence: '中', reason: '低频能量占比较高，可能有贝斯、低音合成器或底鼓支撑。' });
  }
  if (profile.highPercent > 24 || profile.zeroCrossingRate > 0.14) {
    instruments.push({ name: 'Drums / Hi-hat / Cymbal', confidence: '中', reason: '高频与瞬态较明显，适合判断为鼓组、镲片或电子打击。' });
  }
  if (profile.midPercent > 45) {
    instruments.push({ name: 'Piano / Guitar / Synth Lead', confidence: '低', reason: '中频主体突出，可能包含钢琴、吉他、合成器主奏或人声旋律。' });
  }
  if (profile.spectralCentroid < 1200 && profile.dynamicRangeDb < 16) {
    instruments.push({ name: 'Pad / Ambient Texture', confidence: '低', reason: '整体频谱偏暗且动态较平稳，可能有铺底 Pad 或环境氛围层。' });
  }
  if (bpm >= 120 && profile.highPercent > 18) {
    instruments.push({ name: 'Electronic Percussion / Sequencer', confidence: '低', reason: '速度偏快且高频节奏能量明显，可能包含电子节奏或序列器音色。' });
  }
  return instruments.length ? instruments.slice(0, 5) : [
    { name: 'Mixed Full Track', confidence: '低', reason: '当前音频更像完整混音，浏览器本地分析无法稳定拆出单一乐器。' },
  ];
};

const buildChordSections = (mono: Float32Array, sampleRate: number, duration: number) => {
  const sectionCount = Math.min(8, Math.max(3, Math.round(duration / 18)));
  return Array.from({ length: sectionCount }, (_, index) => {
    const startSecond = (duration / sectionCount) * index;
    const endSecond = (duration / sectionCount) * (index + 1);
    const chroma = computeChroma(
      mono,
      sampleRate,
      Math.floor(startSecond * sampleRate),
      Math.floor(endSecond * sampleRate),
    );
    const chord = estimateChord(chroma);
    return {
      section: `${formatTime(startSecond)} - ${formatTime(endSecond)}`,
      chord: chord.chord,
      confidence: chord.confidence,
    };
  });
};

const buildProductionNotes = (result: Omit<AnalyzerResult, 'productionNotes'>) => {
  const notes: string[] = [];
  notes.push(`建议工程 Tempo 先设为 ${result.bpm.value} BPM，再根据鼓点或小节网格微调。`);
  notes.push(`调性可先按 ${result.key.name} 建工程，写旋律/和声时优先围绕该调内音。`);
  if (result.audioProfile.peakDb > -1) notes.push('峰值接近 0 dBFS，后续混音建议预留 3-6 dB headroom。');
  if (result.audioProfile.bassPercent > 32) notes.push('低频占比较高，替换音乐时注意不要让贝斯和低鼓抢对白/音效空间。');
  if (result.audioProfile.highPercent > 28) notes.push('高频存在感明显，做游戏或视频配乐时可适当降低镲片/噪声层避免疲劳。');
  if (result.audioProfile.stereoWidth > 70) notes.push('立体声宽度较大，转单声道或手机外放前建议检查相位兼容。');
  if (result.audioProfile.snrDb < 24) notes.push('SNR 信噪比较低，素材可能有明显底噪；做人声、采样或二次混音前建议先降噪。');
  if (result.audioProfile.noiseFloorRmsDb > -45) notes.push('底噪 RMS 偏高，静音段可能能听到环境噪声、风噪、电流声或压缩噪声。');
  notes.push('乐器和和弦为本地算法估算，复杂混音建议作为创作参考而不是最终乐谱。');
  return notes;
};

async function decodeAudioFile(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass();
  try {
    return await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await audioCtx.close();
  }
}

async function analyzeAudioFile(file: File): Promise<AnalyzerResult> {
  const buffer = await decodeAudioFile(file);
  const mono = toMono(buffer);
  const tempo = estimateTempo(mono, buffer.sampleRate);
  const spectrum = analyzeSpectrumProfile(mono, buffer.sampleRate);
  const audioProfile = {
    peakDb: spectrum.peakDb,
    rmsDb: spectrum.rmsDb,
    dynamicRangeDb: spectrum.dynamicRangeDb,
    noiseFloorRmsDb: spectrum.noiseFloorRmsDb,
    snrDb: spectrum.snrDb,
    spectralCentroid: spectrum.spectralCentroid,
    bassPercent: spectrum.bassPercent,
    midPercent: spectrum.midPercent,
    highPercent: spectrum.highPercent,
    stereoWidth: estimateStereoWidth(buffer),
    zeroCrossingRate: spectrum.zeroCrossingRate,
  };
  const baseResult = {
    fileName: file.name,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    bpm: tempo,
    key: {
      name: spectrum.key.name,
      mode: spectrum.key.mode,
      confidence: spectrum.key.confidence,
    },
    chords: buildChordSections(mono, buffer.sampleRate, buffer.duration),
    instruments: estimateInstruments(audioProfile, tempo.value),
    audioProfile,
  };

  return {
    ...baseResult,
    productionNotes: buildProductionNotes(baseResult),
  };
}

const MetricCard = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    <p className="mt-1 text-lg font-black text-slate-900">{value}</p>
    {hint && <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{hint}</p>}
  </div>
);

const ConfidencePill = ({ value }: { value: Confidence }) => (
  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
    value === '高'
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
      : value === '中'
      ? 'bg-amber-50 text-amber-700 border border-amber-100'
      : 'bg-slate-50 text-slate-500 border border-slate-200'
  }`}>
    {value}置信
  </span>
);

interface AudioAnalyzerProps {
  initialFiles?: File[];
}

export default function AudioAnalyzer({ initialFiles = [] }: AudioAnalyzerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [analysisItems, setAnalysisItems] = useState<AnalysisQueueItem[]>([]);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  React.useEffect(() => {
    if (!initialFiles.length || loading) return;
    handleFiles(initialFiles);
    // The assistant passes a new file list only when a new task is confirmed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  const totalSelectedSize = analysisItems.reduce((sum, item) => sum + item.file.size, 0);
  const completedCount = analysisItems.filter(item => item.status === 'done').length;
  const failedCount = analysisItems.filter(item => item.status === 'error').length;
  const selectedItem = analysisItems.find(item => item.id === selectedResultId);

  const isSupportedAudioFile = (nextFile: File) => (
    nextFile.type.startsWith('audio/') || AUDIO_FILE_EXTENSION_REGEX.test(nextFile.name)
  );

  const handleFiles = (nextFiles: FileList | File[]) => {
    if (loading) return;
    const incomingFiles = Array.from(nextFiles);
    if (!incomingFiles.length) return;

    const supportedFiles = incomingFiles.filter(isSupportedAudioFile);
    const ignoredCount = incomingFiles.length - supportedFiles.length;

    if (!supportedFiles.length) {
      setError('请上传音乐或音频文件，当前分析器暂不处理视频容器。');
      return;
    }

    const nextItems = supportedFiles.map((nextFile, index) => ({
      id: `${nextFile.name}-${nextFile.size}-${nextFile.lastModified}-${index}`,
      file: nextFile,
      status: 'pending' as AnalysisItemStatus,
      progress: 0,
    }));

    setAnalysisItems(nextItems);
    setSelectedResultId(null);
    setResult(null);
    setProgress(0);
    setError(ignoredCount ? `已忽略 ${ignoredCount} 个非音频文件。` : null);
  };

  const clearQueue = () => {
    if (loading) return;
    setAnalysisItems([]);
    setSelectedResultId(null);
    setResult(null);
    setProgress(0);
    setError(null);
  };

  const handleAnalyze = async () => {
    if (!analysisItems.length || loading) return;
    setLoading(true);
    setError(null);
    setProgress(0);
    setResult(null);
    setSelectedResultId(null);
    setAnalysisItems(previous => previous.map(item => ({
      ...item,
      status: 'pending',
      progress: 0,
      result: undefined,
      error: undefined,
    })));

    const queueSnapshot = analysisItems;
    let finished = 0;
    let failed = 0;

    try {
      for (const item of queueSnapshot) {
        setAnalysisItems(previous => previous.map(queueItem => (
          queueItem.id === item.id
            ? { ...queueItem, status: 'analyzing', progress: 12, error: undefined, result: undefined }
            : queueItem
        )));

        const timer = window.setInterval(() => {
          setAnalysisItems(previous => previous.map(queueItem => (
            queueItem.id === item.id && queueItem.status === 'analyzing'
              ? { ...queueItem, progress: Math.min(queueItem.progress + 12, 86) }
              : queueItem
          )));
        }, 260);

        try {
          const nextResult = await analyzeAudioFile(item.file);
          window.clearInterval(timer);
          finished += 1;
          setProgress(Math.round((finished / queueSnapshot.length) * 100));
          setResult(nextResult);
          setSelectedResultId(item.id);
          setAnalysisItems(previous => previous.map(queueItem => (
            queueItem.id === item.id
              ? { ...queueItem, status: 'done', progress: 100, result: nextResult, error: undefined }
              : queueItem
          )));
        } catch (err: any) {
          window.clearInterval(timer);
          finished += 1;
          failed += 1;
          setProgress(Math.round((finished / queueSnapshot.length) * 100));
          setAnalysisItems(previous => previous.map(queueItem => (
            queueItem.id === item.id
              ? {
                  ...queueItem,
                  status: 'error',
                  progress: 0,
                  error: err?.message || '音频分析失败，请确认文件格式可被浏览器解码。',
                }
              : queueItem
          )));
        }
      }

      if (failed) {
        setError(`已完成 ${queueSnapshot.length - failed} 个音频，${failed} 个文件分析失败；请检查失败文件的格式或重新导出后再试。`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-900">音频测速 / 测调 / 乐器和弦分析</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
              上传一首或多首音乐后，本地逐个解析音频并估算 BPM、调性、主要和弦、乐器/音色倾向、响度、动态范围、底噪 RMS、SNR 信噪比、频段分布和立体声宽度。
            </p>
          </div>
          <button
            type="button"
            disabled={!analysisItems.length || loading}
            onClick={handleAnalyze}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-xs font-black text-white shadow-lg shadow-emerald-600/15 transition-all hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
            {loading ? `批量分析中 ${progress}%` : analysisItems.length > 1 ? `分析 ${analysisItems.length} 个音频` : '开始分析'}
          </button>
        </div>

        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            if (event.dataTransfer.files?.length) handleFiles(event.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`mt-6 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition-all ${
            dragActive
              ? 'border-emerald-400 bg-emerald-50'
              : analysisItems.length
              ? 'border-emerald-100 bg-emerald-50/40'
              : 'border-slate-200 bg-slate-50 hover:border-emerald-300 hover:bg-emerald-50/40'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) handleFiles(event.target.files);
              event.currentTarget.value = '';
            }}
          />
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-emerald-600 shadow-sm">
            {analysisItems.length ? <FileAudio className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
          </div>
          {analysisItems.length ? (
            <>
              <p className="max-w-xl truncate text-sm font-black text-slate-800">
                {analysisItems.length === 1 ? analysisItems[0].file.name : `已选择 ${analysisItems.length} 个音频`}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {analysisItems.length === 1
                  ? `${formatBytes(analysisItems[0].file.size)} · ${analysisItems[0].file.type || '未知格式'}`
                  : `合计 ${formatBytes(totalSelectedSize)} · 将按顺序逐个分析`}
              </p>
              {analysisItems.length > 1 && (
                <div className="mt-3 flex max-w-2xl flex-wrap justify-center gap-1.5">
                  {analysisItems.slice(0, 5).map(item => (
                    <span key={item.id} className="max-w-[180px] truncate rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                      {item.file.name}
                    </span>
                  ))}
                  {analysisItems.length > 5 && (
                    <span className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                      +{analysisItems.length - 5}
                    </span>
                  )}
                </div>
              )}
              <p className="mt-3 text-[11px] font-bold text-emerald-700">点击可重新选择，或直接点右上角开始分析。</p>
            </>
          ) : (
            <>
              <p className="text-sm font-black text-slate-800">点击上传或把一首/多首音乐拖到这里</p>
              <p className="mt-1 text-xs text-slate-500">支持 MP3 / WAV / M4A / OGG 等浏览器可解码音频。</p>
            </>
          )}
        </div>

        {(loading || error) && (
          <div className={`mt-4 rounded-2xl border p-4 text-xs ${
            error ? 'border-rose-100 bg-rose-50 text-rose-700' : 'border-emerald-100 bg-emerald-50 text-slate-700'
          }`}>
            <div className="flex items-start gap-2">
              {error ? <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-600" />}
              <div className="flex-1">
                <p className="font-bold">{error || '正在分析节拍、调性、频谱、和弦与乐器倾向...'}</p>
                {loading && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {analysisItems.length > 0 && (
          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-black text-slate-900">批量分析队列</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {analysisItems.length} 个音频 · 已完成 {completedCount} 个{failedCount ? ` · 失败 ${failedCount} 个` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={clearQueue}
                disabled={loading}
                className="inline-flex h-8 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-500 hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                清空列表
              </button>
            </div>

            <div className="space-y-2">
              {analysisItems.map((item, index) => {
                const isActive = item.id === selectedResultId;
                const statusText = item.status === 'pending'
                  ? '等待分析'
                  : item.status === 'analyzing'
                  ? '分析中'
                  : item.status === 'done'
                  ? '已完成'
                  : '失败';
                const statusClass = item.status === 'done'
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                  : item.status === 'analyzing'
                  ? 'border-blue-100 bg-blue-50 text-blue-700'
                  : item.status === 'error'
                  ? 'border-rose-100 bg-rose-50 text-rose-700'
                  : 'border-slate-200 bg-white text-slate-500';

                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border bg-white p-3 transition-all ${
                      isActive ? 'border-emerald-300 shadow-sm shadow-emerald-600/10' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-500">
                            {index + 1}
                          </span>
                          <p className="truncate text-xs font-black text-slate-800">{item.file.name}</p>
                        </div>
                        <p className="mt-1 pl-8 text-[10px] text-slate-400">{formatBytes(item.file.size)} · {item.file.type || '未知格式'}</p>
                        {(item.status === 'analyzing' || item.status === 'error') && (
                          <div className="mt-2 pl-8">
                            {item.status === 'analyzing' ? (
                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${item.progress}%` }} />
                              </div>
                            ) : (
                              <p className="text-[10px] font-bold text-rose-600">{item.error}</p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-5 lg:min-w-[520px]">
                        <div className={`flex items-center justify-center rounded-xl border px-2 py-1.5 font-black ${statusClass}`}>
                          {item.status === 'analyzing' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                          {statusText}
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-2 py-1.5 text-center">
                          <p className="font-bold text-slate-400">BPM</p>
                          <p className="font-black text-slate-800">{item.result?.bpm.value || '-'}</p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-2 py-1.5 text-center">
                          <p className="font-bold text-slate-400">Key</p>
                          <p className="truncate font-black text-slate-800">{item.result?.key.name || '-'}</p>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-2 py-1.5 text-center">
                          <p className="font-bold text-slate-400">时长</p>
                          <p className="font-black text-slate-800">{item.result ? formatTime(item.result.duration) : '-'}</p>
                        </div>
                        <button
                          type="button"
                          disabled={!item.result}
                          onClick={() => {
                            if (!item.result) return;
                            setResult(item.result);
                            setSelectedResultId(item.id);
                          }}
                          className="rounded-xl bg-slate-900 px-3 py-1.5 font-black text-white transition hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400"
                        >
                          查看详情
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {result && (
        <div className="space-y-6">
          {analysisItems.length > 1 && (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
              <span className="font-black">详细分析：</span>
              {selectedItem?.file.name || result.fileName}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="速度 BPM" value={`${result.bpm.value}`} hint={`备选：${result.bpm.alternatives.join(' / ') || '-'} · ${result.bpm.confidence}置信`} />
            <MetricCard label="调性 Key" value={result.key.name} hint={`${result.key.mode === 'Major' ? '大调' : '小调'}倾向 · ${result.key.confidence}置信`} />
            <MetricCard label="时长 / 规格" value={formatTime(result.duration)} hint={`${result.sampleRate.toLocaleString()} Hz · ${result.channels} 声道`} />
            <MetricCard label="响度 / 峰值" value={`${result.audioProfile.rmsDb.toFixed(1)} dB`} hint={`Peak ${result.audioProfile.peakDb.toFixed(1)} dBFS · DR ${result.audioProfile.dynamicRangeDb.toFixed(1)} dB`} />
            <MetricCard label="底噪 RMS" value={`${result.audioProfile.noiseFloorRmsDb.toFixed(1)} dBFS`} hint="按最低 10% 能量帧估算，越低越干净。" />
            <MetricCard label="信噪比 SNR" value={`${result.audioProfile.snrDb.toFixed(1)} dB`} hint={result.audioProfile.snrDb >= 36 ? '较干净，适合二次制作。' : '偏低时建议先做降噪或修复。'} />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
              <div className="mb-4 flex items-center gap-2">
                <Piano className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black text-slate-900">和弦段落倾向</h3>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {result.chords.map((item, index) => (
                  <div key={`${item.section}-${item.chord}-${index}`} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400">{item.section}</p>
                      <p className="mt-0.5 text-base font-black text-slate-900">{item.chord}</p>
                    </div>
                    <ConfidencePill value={item.confidence} />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Guitar className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black text-slate-900">乐器 / 音色倾向</h3>
              </div>
              <div className="space-y-3">
                {result.instruments.map((instrument) => (
                  <div key={instrument.name} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-black text-slate-800">{instrument.name}</p>
                      <ConfidencePill value={instrument.confidence} />
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{instrument.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
              <div className="mb-4 flex items-center gap-2">
                <Waves className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black text-slate-900">频段与混音信息</h3>
              </div>
              {[
                ['低频 Bass', result.audioProfile.bassPercent],
                ['中频 Mid', result.audioProfile.midPercent],
                ['高频 High', result.audioProfile.highPercent],
                ['立体声宽度', result.audioProfile.stereoWidth],
              ].map(([label, value]) => (
                <div key={label} className="mb-3 last:mb-0">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">{label}</span>
                    <span className="font-black text-slate-900">{value}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${value}%` }} />
                  </div>
                </div>
              ))}
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <MetricCard label="频谱重心" value={`${Math.round(result.audioProfile.spectralCentroid)} Hz`} hint="数值越高，整体听感越亮。" />
                <MetricCard label="过零率" value={result.audioProfile.zeroCrossingRate.toFixed(3)} hint="可辅助判断噪声、鼓镲和高频瞬态。" />
                <MetricCard label="底噪 RMS" value={`${result.audioProfile.noiseFloorRmsDb.toFixed(1)} dBFS`} hint="用于判断静音段噪声底。" />
                <MetricCard label="SNR 信噪比" value={`${result.audioProfile.snrDb.toFixed(1)} dB`} hint="有效信号相对底噪的距离。" />
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Gauge className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-black text-slate-900">制作建议</h3>
              </div>
              <div className="space-y-2">
                {result.productionNotes.map((note) => (
                  <div key={note} className="flex gap-2 rounded-2xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span>{note}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-[11px] leading-relaxed text-amber-800">
            <strong>说明：</strong>当前版本使用浏览器本地 DSP 估算，适合快速判断素材方向。复杂歌曲的转调、借用和弦、密集打击乐或强混响会降低调性/和弦/乐器识别准确度；后续如果接入专业 MIR 模型，可以把这里升级成更准确的服务器分析。
          </div>
        </div>
      )}
    </div>
  );
}
