/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileAudio,
  Loader2,
  Music2,
  Sparkles,
  Upload,
} from 'lucide-react';

type MusicNamingStatus = 'pending' | 'analyzing' | 'done' | 'error';
type Confidence = '高' | '中' | '低';

interface MusicNamingItem {
  id: string;
  file: File;
  sourcePath: string;
  status: MusicNamingStatus;
  progress: number;
  duration?: number;
  bpm?: number;
  keyName?: string;
  keyConfidence?: Confidence;
  style?: string;
  scene?: string;
  styleConfidence?: Confidence;
  sceneConfidence?: Confidence;
  styleCandidates?: string[];
  sceneCandidates?: string[];
  semanticReason?: string;
  semanticModel?: string;
  energy?: string;
  mood?: string;
  bassPercent?: number;
  midPercent?: number;
  highPercent?: number;
  rms?: number;
  categoryKey?: string;
  outputName?: string;
  error?: string;
}

const AUDIO_FILE_EXTENSION_REGEX = /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm|opus|aif|aiff|caf)$/i;
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const STYLE_OPTIONS = ['Review', 'Epic', 'Battle', 'Casual', 'Healing', 'Mystery', 'Ambient', 'Electronic', 'Chinese', 'Cinematic', 'Orchestral', 'Rock', 'Piano', 'LoFi'];
const SCENE_OPTIONS = ['Manual', 'Battle', 'Home', 'Lobby', 'Event', 'Gift', 'Puzzle', 'Victory', 'Suspense', 'Explore', 'Menu', 'Cutscene', 'Reward', 'Store'];

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const formatDuration = (seconds = 0) => {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
};

const sanitizeFileNamePart = (value: string) => (
  value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'Music'
);

const getFilePath = (file: File) => ((file as any).webkitRelativePath || file.name).replace(/\\/g, '/');
const isAudioFile = (file: File) => file.type.startsWith('audio/') || AUDIO_FILE_EXTENSION_REGEX.test(file.name);
const getExtension = (name: string) => {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : 'wav';
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const toMono = (buffer: AudioBuffer) => {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / buffer.numberOfChannels;
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

  const novelty = new Float32Array(envelope.length);
  let previous = 0;
  for (let i = 0; i < envelope.length; i += 1) {
    const current = Math.max(0, envelope[i] - mean);
    novelty[i] = Math.max(0, current - previous);
    previous = current;
  }

  const candidates: Array<{ bpm: number; score: number }> = [];
  for (let bpm = 60; bpm <= 200; bpm += 1) {
    const lag = Math.round((60 / bpm) * envelopeRate);
    let score = 0;
    for (let i = lag; i < novelty.length; i += 1) score += novelty[i] * novelty[i - lag];
    candidates.push({ bpm, score });
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.bpm || 120;
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

const computeChroma = (mono: Float32Array, sampleRate: number) => {
  const chroma = new Array(12).fill(0) as number[];
  const windowSize = Math.min(4096, Math.max(1024, Math.floor(sampleRate * 0.09)));
  const hop = Math.max(windowSize * 4, Math.floor(sampleRate * 0.5));
  const safeEnd = Math.max(windowSize, mono.length - windowSize);
  let windows = 0;

  for (let start = 0; start < safeEnd && windows < 120; start += hop) {
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

const rotateProfile = (profile: number[], root: number) => profile.map((_, index) => profile[(index - root + 12) % 12]);

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
  scores.sort((left, right) => right.score - left.score);
  const best = scores[0] || { root: 0, mode: 'Major' as const, score: 0 };
  const second = scores[1] || best;
  const margin = best.score - second.score;
  return {
    name: `${NOTES[best.root]} ${best.mode}`,
    confidence: (margin > 0.08 ? '中' : '低') as Confidence,
  };
};

const analyzeSpectrum = (mono: Float32Array, sampleRate: number) => {
  const size = Math.min(8192, mono.length);
  const start = Math.max(0, Math.floor((mono.length - size) / 2));
  let bass = 0;
  let mid = 0;
  let high = 0;
  let zeroCrossings = 0;
  let rms = 0;

  for (let i = 0; i < mono.length; i += 1) {
    const sample = mono[i];
    rms += sample * sample;
    if (i > 0 && Math.sign(sample) !== Math.sign(mono[i - 1])) zeroCrossings += 1;
  }
  rms = Math.sqrt(rms / Math.max(mono.length, 1));

  for (let frequency = 80; frequency <= Math.min(sampleRate / 2, 8000); frequency += 120) {
    const power = goertzelPower(mono, start, size, sampleRate, frequency);
    if (frequency < 250) bass += power;
    else if (frequency < 2200) mid += power;
    else high += power;
  }

  const total = bass + mid + high || 1;
  return {
    rms,
    zeroCrossingRate: zeroCrossings / Math.max(mono.length, 1),
    bassPercent: (bass / total) * 100,
    midPercent: (mid / total) * 100,
    highPercent: (high / total) * 100,
  };
};

const addScore = (scores: Map<string, number>, key: string, amount: number) => {
  scores.set(key, (scores.get(key) || 0) + amount);
};

const sortedCandidates = (scores: Map<string, number>) => (
  Array.from(scores.entries())
    .sort((left, right) => right[1] - left[1])
);

const scoreConfidence = (candidates: Array<[string, number]>): Confidence => {
  const best = candidates[0]?.[1] || 0;
  const second = candidates[1]?.[1] || 0;
  if (best >= 7 && best - second >= 3) return '高';
  if (best >= 4 && best - second >= 1.5) return '中';
  return '低';
};

const inferMusicTags = (
  fileName: string,
  bpm: number,
  keyName: string,
  profile: ReturnType<typeof analyzeSpectrum>,
) => {
  const normalizedName = fileName.toLowerCase();
  const minor = /Minor/.test(keyName);
  const highEnergy = profile.rms > 0.09 || bpm >= 132;
  const lowEnergy = profile.rms < 0.035 || bpm < 86;
  const styleScores = new Map<string, number>();
  const sceneScores = new Map<string, number>();

  [
    [/战斗|battle|combat|fight|boss|attack|war|热血/, 'Battle', 'Battle', 8],
    [/胜利|victory|win|success|clear|结算|奖励|reward/, 'Epic', 'Victory', 8],
    [/失败|fail|lose|gameover|警告|危机/, 'Mystery', 'Suspense', 7],
    [/主页|首页|home|main|lobby|大厅|登录|login/, 'Casual', 'Lobby', 8],
    [/board[\s_-]?game|tabletop|dice|cozy|桌游|棋盘|棋牌/, 'Casual', 'Lobby', 8],
    [/afternoon|evening|night|sunday|coffee|cafe|日常|午后|夜晚|咖啡/, 'Healing', 'Home', 6],
    [/菜单|menu|ui|界面/, 'Casual', 'Menu', 7],
    [/活动|event|festival|运营/, 'Cinematic', 'Event', 8],
    [/礼物|gift|avatar|入场|present/, 'Casual', 'Gift', 8],
    [/商店|store|shop|商城/, 'Casual', 'Store', 7],
    [/剧情|cutscene|story|cinematic|过场/, 'Cinematic', 'Cutscene', 8],
    [/探索|explore|adventure|map|world/, 'Ambient', 'Explore', 6],
    [/悬疑|恐怖|horror|suspense|mystery|dark/, 'Mystery', 'Suspense', 8],
    [/国风|仙侠|古风|chinese|oriental|erhu|guzheng|pipa/, 'Chinese', 'Explore', 8],
    [/钢琴|piano/, 'Piano', 'Home', 7],
    [/摇滚|rock|guitar/, 'Rock', 'Battle', 6],
    [/电子|electro|edm|synth|cyber/, 'Electronic', 'Event', 7],
    [/环境|ambient|atmo|氛围/, 'Ambient', 'Explore', 7],
    [/治愈|温暖|healing|calm|soft|relax|peace/, 'Healing', 'Home', 7],
  ].forEach(([pattern, style, scene, score]) => {
    if ((pattern as RegExp).test(normalizedName)) {
      addScore(styleScores, style as string, score as number);
      addScore(sceneScores, scene as string, score as number);
    }
  });

  if (bpm >= 140 && profile.highPercent > 22) {
    addScore(styleScores, 'Electronic', 3);
    addScore(sceneScores, 'Battle', 2);
  }
  if (bpm >= 122 && profile.bassPercent > 32) {
    addScore(styleScores, 'Battle', 3);
    addScore(sceneScores, 'Battle', 3);
  }
  if (lowEnergy && profile.highPercent < 18) {
    addScore(styleScores, 'Ambient', 3);
    addScore(sceneScores, minor ? 'Suspense' : 'Explore', 2);
  }
  if (bpm < 105 && !minor) {
    addScore(styleScores, 'Healing', 2);
    addScore(sceneScores, 'Home', 2);
  }
  if (minor && profile.midPercent > 52) {
    addScore(styleScores, 'Mystery', 3);
    addScore(sceneScores, 'Suspense', 3);
  }
  if (profile.bassPercent > 38 && bpm >= 100) {
    addScore(styleScores, 'Cinematic', 2);
    addScore(sceneScores, 'Event', 2);
  }
  if (styleScores.size === 0) addScore(styleScores, 'Casual', 1);
  if (sceneScores.size === 0) addScore(sceneScores, bpm >= 116 ? 'Event' : 'Lobby', 1);

  const styleCandidates = sortedCandidates(styleScores);
  const sceneCandidates = sortedCandidates(sceneScores);
  const styleConfidence = scoreConfidence(styleCandidates);
  const sceneConfidence = scoreConfidence(sceneCandidates);
  const selectedStyle = styleConfidence === '低' ? 'Review' : styleCandidates[0][0];
  const selectedScene = sceneConfidence === '低' ? 'Manual' : sceneCandidates[0][0];

  return {
    style: selectedStyle,
    scene: selectedScene,
    styleConfidence,
    sceneConfidence,
    styleCandidates: styleCandidates.slice(0, 3).map(([name]) => name),
    sceneCandidates: sceneCandidates.slice(0, 3).map(([name]) => name),
    energy: lowEnergy ? 'Low' : highEnergy ? 'High' : 'Medium',
    mood: minor ? (highEnergy ? 'Tense' : 'SoftDark') : highEnergy ? 'Excited' : 'Bright',
  };
};

const decodeAudioFile = async (file: File) => {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) throw new Error('当前浏览器不支持音频分析。');
  const context = new AudioContextClass();
  try {
    const arrayBuffer = await file.arrayBuffer();
    return await context.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void context.close?.();
  }
};

const analyzeMusicFile = async (file: File) => {
  const buffer = await decodeAudioFile(file);
  const mono = toMono(buffer);
  const bpm = estimateTempo(mono, buffer.sampleRate);
  const key = estimateKey(computeChroma(mono, buffer.sampleRate));
  const profile = analyzeSpectrum(mono, buffer.sampleRate);
  const tags = inferMusicTags(file.name, bpm, key.name, profile);
  return {
    duration: buffer.duration,
    bpm,
    keyName: key.name,
    keyConfidence: key.confidence,
    bassPercent: profile.bassPercent,
    midPercent: profile.midPercent,
    highPercent: profile.highPercent,
    rms: profile.rms,
    ...tags,
  };
};

const requestSemanticMusicNaming = async (items: MusicNamingItem[]) => {
  const response = await fetch('/api/ai/music-analysis-naming', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      items: items.map((item, index) => ({
        index,
        sourceName: item.sourcePath || item.file.name,
        duration: item.duration,
        bpm: item.bpm,
        keyName: item.keyName,
        keyConfidence: item.keyConfidence,
        energy: item.energy,
        mood: item.mood,
        bassPercent: item.bassPercent,
        midPercent: item.midPercent,
        highPercent: item.highPercent,
        rms: item.rms,
      })),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `音乐语义分析失败（${response.status}）。`);
  }
  return payload as {
    provider?: string;
    model?: string;
    items?: Array<{
      index: number;
      style: string;
      scene: string;
      mood: string;
      namingCategory: string;
      confidence: Confidence;
      reason: string;
    }>;
  };
};

const getDroppedFiles = async (dataTransfer: DataTransfer) => {
  const entryReaders: Promise<File[]>[] = [];
  const readEntry = async (entry: any): Promise<File[]> => {
    if (!entry) return [];
    if (entry.isFile) {
      return new Promise((resolve) => entry.file((file: File) => resolve([file]), () => resolve([])));
    }
    if (!entry.isDirectory) return [];
    const reader = entry.createReader();
    const children: any[] = [];
    const readBatch = async (): Promise<any[]> => new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
    let batch = await readBatch();
    while (batch.length > 0) {
      children.push(...batch);
      batch = await readBatch();
    }
    const nested = await Promise.all(children.map(readEntry));
    return nested.flat();
  };

  if (dataTransfer.items?.length) {
    for (const item of Array.from(dataTransfer.items)) {
      const entry = (item as any).webkitGetAsEntry?.();
      if (entry) entryReaders.push(readEntry(entry));
    }
  }
  const files = entryReaders.length > 0
    ? (await Promise.all(entryReaders)).flat()
    : Array.from(dataTransfer.files || []);
  return files.filter(isAudioFile);
};

export default function MusicAnalysisNaming() {
  const [items, setItems] = useState<MusicNamingItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [numberStart, setNumberStart] = useState(1);
  const [numberPadding, setNumberPadding] = useState(3);
  const [numberSeparator, setNumberSeparator] = useState('_');
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const bindFolderInput = (element: HTMLInputElement | null) => {
    if (!element) return;
    folderInputRef.current = element;
    element.setAttribute('webkitdirectory', '');
    element.setAttribute('directory', '');
  };

  const addFiles = (files: File[]) => {
    const audioFiles = files.filter(isAudioFile);
    if (audioFiles.length === 0) {
      setError('没有识别到可分析的音乐文件，请上传 MP3、WAV、M4A、OGG、FLAC 等音频。');
      return;
    }
    setError(null);
    setStatus(`已载入 ${audioFiles.length} 个音乐文件，点击“开始分析并命名”。`);
    setItems(audioFiles.map((file, index) => ({
      id: `music-naming-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      sourcePath: getFilePath(file),
      status: 'pending',
      progress: 0,
    })));
  };

  const buildOutputNames = (sourceItems: MusicNamingItem[]) => {
    const counters = new Map<string, number>();
    return sourceItems.map((item) => {
      if (item.status !== 'done') return item;
      const style = sanitizeFileNamePart(item.style || 'Music');
      const scene = sanitizeFileNamePart(item.scene || 'Scene');
      const key = sanitizeFileNamePart((item.keyName || 'UnknownKey').replace(/\s+/g, ''));
      const bpm = Math.round(item.bpm || 0);
      const categoryKey = `${style}_${scene}`;
      const nextNumber = counters.get(categoryKey) ?? numberStart;
      counters.set(categoryKey, nextNumber + 1);
      const prefix = String(nextNumber).padStart(numberPadding, '0');
      return {
        ...item,
        categoryKey,
        outputName: `${prefix}${numberSeparator}${style}_${scene}_${key}_${bpm}BPM.${getExtension(item.file.name)}`,
      };
    });
  };

  const previewItems = useMemo(() => buildOutputNames(items), [items, numberPadding, numberSeparator, numberStart]);
  const doneCount = previewItems.filter(item => item.status === 'done').length;

  const analyzeAll = async () => {
    if (items.length === 0 || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setStatus(`正在分析 1/${items.length}...`);
    let nextItems = items.map(item => ({ ...item, status: 'pending' as const, progress: 0, error: undefined }));
    setItems(nextItems);

    for (let index = 0; index < nextItems.length; index += 1) {
      const target = nextItems[index];
      setStatus(`正在分析 ${index + 1}/${nextItems.length}：${target.file.name}`);
      nextItems = nextItems.map(item => item.id === target.id ? { ...item, status: 'analyzing', progress: 30 } : item);
      setItems(buildOutputNames(nextItems));
      try {
        const result = await analyzeMusicFile(target.file);
        nextItems = nextItems.map(item => item.id === target.id ? {
          ...item,
          ...result,
          status: 'done',
          progress: 100,
        } : item);
      } catch (reason: any) {
        nextItems = nextItems.map(item => item.id === target.id ? {
          ...item,
          status: 'error',
          progress: 0,
          error: reason?.message || '分析失败，请检查音频格式。',
        } : item);
      }
      setItems(buildOutputNames(nextItems));
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    setItems(buildOutputNames(nextItems));
    const doneItems = buildOutputNames(nextItems).filter(item => item.status === 'done');
    if (doneItems.length > 0) {
      try {
        setStatus(`本地参数分析完成，正在调用 API 判断风格和适合场景...`);
        const semanticResult = await requestSemanticMusicNaming(doneItems);
        const semanticByOriginalIndex = new Map<number, NonNullable<typeof semanticResult.items>[number]>();
        (semanticResult.items || []).forEach(item => semanticByOriginalIndex.set(item.index, item));
        let doneIndex = 0;
        nextItems = nextItems.map((item) => {
          if (item.status !== 'done') return item;
          const semantic = semanticByOriginalIndex.get(doneIndex);
          doneIndex += 1;
          if (!semantic) return item;
          return {
            ...item,
            style: semantic.style || item.style,
            scene: semantic.scene || item.scene,
            mood: semantic.mood || item.mood,
            styleConfidence: semantic.confidence,
            sceneConfidence: semantic.confidence,
            styleCandidates: [semantic.style].filter(Boolean),
            sceneCandidates: [semantic.scene].filter(Boolean),
            semanticReason: semantic.reason,
            semanticModel: semanticResult.model,
          };
        });
        setItems(buildOutputNames(nextItems));
        setStatus(`API 分析完成：${doneItems.length}/${nextItems.length} 个文件已生成语义命名。`);
      } catch (reason: any) {
        setItems(buildOutputNames(nextItems));
        setError(reason?.message || 'API 风格/场景分析失败。');
        setStatus('本地 BPM/调式已完成，但风格/场景 API 分析失败；请配置 API 后重新分析。');
      }
    } else {
      setStatus(`分析完成：0/${nextItems.length} 个文件已生成命名。`);
    }
    setAnalyzing(false);
  };

  const updateItem = (id: string, patch: Partial<MusicNamingItem>) => {
    setItems(current => buildOutputNames(current.map(item => item.id === id ? { ...item, ...patch } : item)));
  };

  const exportCsv = () => {
    const rows = [
      ['原始路径', '新文件名', 'BPM', '调式', '风格', '适合场景', '能量', '情绪', '状态'],
      ...previewItems.map(item => [
        item.sourcePath,
        item.outputName || '',
        item.bpm ? String(Math.round(item.bpm)) : '',
        item.keyName || '',
        item.style || '',
        item.scene || '',
        item.energy || '',
        item.mood || '',
        item.status === 'done' ? '已命名' : item.status === 'error' ? (item.error || '分析失败') : '未分析',
      ]),
    ];
    const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `music_analysis_naming_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const exportZip = async () => {
    const exportableItems = previewItems.filter((item): item is MusicNamingItem & { outputName: string } => (
      item.status === 'done' && Boolean(item.outputName)
    ));
    if (exportableItems.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      if (exportableItems.length === 1) {
        downloadBlob(exportableItems[0].file, exportableItems[0].outputName);
        setStatus(`已开始下载 ${exportableItems[0].outputName}。`);
        return;
      }
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const rootName = `music_analysis_naming_${new Date().toISOString().slice(0, 10)}`;
      exportableItems.forEach((item) => {
        zip.file(`${rootName}/${item.outputName}`, item.file, { binary: true });
      });
      setStatus(`正在打包 ${exportableItems.length} 个分析命名后的音乐文件...`);
      const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'STORE', streamFiles: true },
        metadata => setStatus(`正在生成 ZIP ${Math.round(metadata.percent)}%...`),
      );
      downloadBlob(zipBlob, `${rootName}.zip`);
      setStatus(`已生成并开始下载 ${rootName}.zip。`);
    } catch (reason: any) {
      setError(reason?.message || '导出失败。');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">音乐分析命名</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
              批量或单个上传音乐后，本地分析 BPM、调式、风格与适合场景，并把分析结果作为新文件名。相同类别会自动在前方加序号，序号起始区间可手动设置。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-100 bg-slate-50 p-2 text-[10px] font-bold text-slate-500">
            <label className="space-y-1">
              <span>起始序号</span>
              <input
                type="number"
                min={1}
                value={numberStart}
                onChange={(event) => setNumberStart(Math.max(1, Number(event.target.value) || 1))}
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-emerald-400"
              />
            </label>
            <label className="space-y-1">
              <span>位数</span>
              <input
                type="number"
                min={1}
                max={6}
                value={numberPadding}
                onChange={(event) => setNumberPadding(Math.max(1, Math.min(6, Number(event.target.value) || 3)))}
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-emerald-400"
              />
            </label>
            <label className="space-y-1">
              <span>分隔符</span>
              <input
                value={numberSeparator}
                onChange={(event) => setNumberSeparator(event.target.value.slice(0, 3) || '_')}
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-emerald-400"
              />
            </label>
          </div>
        </div>

        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={async (event) => {
            event.preventDefault();
            setDragActive(false);
            addFiles(await getDroppedFiles(event.dataTransfer));
          }}
          onClick={() => inputRef.current?.click()}
          className={`mt-5 flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed px-5 py-8 text-center transition-all ${
            dragActive ? 'border-emerald-500 bg-emerald-50/70' : 'border-slate-200 bg-slate-50/40 hover:border-emerald-300 hover:bg-emerald-50/30'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) addFiles(Array.from(event.target.files));
              event.currentTarget.value = '';
            }}
          />
          <input
            ref={bindFolderInput}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) addFiles(Array.from(event.target.files));
              event.currentTarget.value = '';
            }}
          />
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-white text-emerald-600 shadow-sm">
            <Upload className="h-6 w-6" />
          </div>
          <p className="text-sm font-black text-slate-800">点击上传、多选音乐，或拖入音乐文件/文件夹</p>
          <p className="mt-1 text-[11px] text-slate-400">支持 MP3、WAV、M4A、OGG、FLAC 等浏览器可解码格式；不会覆盖原文件。</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                inputRef.current?.click();
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 shadow-sm hover:text-emerald-700"
            >
              选择音乐文件
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                folderInputRef.current?.click();
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 shadow-sm hover:text-emerald-700"
            >
              选择文件夹
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between">
          <div className="text-xs text-slate-500">
            <span className="font-black text-slate-800">{items.length}</span> 个文件 · 已生成 <span className="font-black text-emerald-700">{doneCount}</span> 个命名
            {status && <p className="mt-1 text-[11px] font-semibold text-slate-500">{status}</p>}
            {error && <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-rose-600"><AlertCircle className="h-3.5 w-3.5" />{error}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={items.length === 0 || analyzing}
              onClick={analyzeAll}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {analyzing ? '分析中...' : '开始分析并命名'}
            </button>
            <button
              type="button"
              disabled={doneCount === 0}
              onClick={exportCsv}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 shadow-sm hover:text-emerald-700 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              导出 CSV
            </button>
            <button
              type="button"
              disabled={doneCount === 0 || exporting}
              onClick={exportZip}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700 shadow-sm hover:bg-emerald-100 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              导出重命名文件
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-900">分析命名预览</h3>
            <p className="mt-1 text-[11px] text-slate-500">
              风格和适合场景会显示候选与置信度；低置信度时默认标为 Review / Manual，建议人工确认后再导出。
            </p>
          </div>
        </div>

        {previewItems.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/60 text-center">
            <Music2 className="mb-3 h-8 w-8 text-slate-300" />
            <p className="text-sm font-black text-slate-500">还没有待分析音乐</p>
            <p className="mt-1 text-xs text-slate-400">上传后会在这里显示 BPM、调式、风格、场景和新文件名。</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <div className="grid grid-cols-[1.3fr_0.7fr_0.7fr_0.8fr_0.8fr_1.8fr] gap-3 bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-wide text-slate-400">
              <span>原文件</span>
              <span>BPM / 调式</span>
              <span>能量情绪</span>
              <span>风格</span>
              <span>场景</span>
              <span>新文件名</span>
            </div>
            <div className="divide-y divide-slate-100">
              {previewItems.map((item) => (
                <div key={item.id} className="grid grid-cols-[1.3fr_0.7fr_0.7fr_0.8fr_0.8fr_1.8fr] gap-3 px-4 py-3 text-xs">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileAudio className="h-4 w-4 shrink-0 text-emerald-600" />
                      <p className="truncate font-bold text-slate-800" title={item.sourcePath}>{item.file.name}</p>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">{formatBytes(item.file.size)}{item.duration ? ` · ${formatDuration(item.duration)}` : ''}</p>
                  </div>
                  <div className="text-slate-600">
                    {item.status === 'analyzing' && <span className="inline-flex items-center gap-1 font-bold text-emerald-700"><Loader2 className="h-3.5 w-3.5 animate-spin" />分析中</span>}
                    {item.status === 'error' && <span className="font-bold text-rose-600">{item.error}</span>}
                    {item.status === 'pending' && <span className="text-slate-400">待分析</span>}
                    {item.status === 'done' && (
                      <>
                        <p className="font-black text-slate-800">{Math.round(item.bpm || 0)} BPM</p>
                        <p className="text-[10px] text-slate-500">{item.keyName} · {item.keyConfidence}置信</p>
                      </>
                    )}
                  </div>
                  <div className="text-slate-600">
                    <p className="font-bold">{item.energy || '-'}</p>
                    <p className="text-[10px] text-slate-400">{item.mood || '-'}</p>
                  </div>
                  <select
                    value={item.style || ''}
                    disabled={item.status !== 'done'}
                    onChange={(event) => updateItem(item.id, { style: event.target.value })}
                    className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none disabled:bg-slate-50 disabled:text-slate-300"
                  >
                    <option value="">-</option>
                    {STYLE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <select
                    value={item.scene || ''}
                    disabled={item.status !== 'done'}
                    onChange={(event) => updateItem(item.id, { scene: event.target.value })}
                    className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none disabled:bg-slate-50 disabled:text-slate-300"
                  >
                    <option value="">-</option>
                    {SCENE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <div className="min-w-0">
                    {item.status === 'done' && (
                      <p className="mb-1 truncate text-[10px] font-bold text-slate-400" title={`风格候选：${item.styleCandidates?.join(' / ') || '-'}；场景候选：${item.sceneCandidates?.join(' / ') || '-'}`}>
                        {item.semanticModel ? 'API' : '本地'} · 风格{item.styleConfidence}置信 · 场景{item.sceneConfidence}置信
                      </p>
                    )}
                    <p className="truncate rounded-xl bg-slate-50 px-3 py-2 font-mono text-[11px] font-bold text-slate-700" title={item.outputName}>
                      {item.outputName || '分析后生成'}
                    </p>
                    {item.status === 'done' && (
                      <p className="mt-1 flex items-center gap-1 truncate text-[10px] font-bold text-emerald-600" title={item.semanticReason || `类别：${item.categoryKey}`}>
                        <CheckCircle2 className="h-3 w-3 shrink-0" />{item.semanticReason || `类别：${item.categoryKey}`}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
