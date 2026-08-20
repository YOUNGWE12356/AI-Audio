/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from 'react';
import { 
  Upload, 
  FileAudio, 
  FileVideo, 
  Download, 
  Loader2, 
  Settings, 
  Sliders, 
  Zap, 
  CheckCircle2, 
  AlertCircle,
  HardDrive,
  Percent,
  Play,
  Pause,
  RefreshCw,
  FolderOpen,
  Music,
  Sparkles,
  BarChart3,
  FileText
} from 'lucide-react';
import { 
  resampleAudioBuffer, 
  encodeWav, 
  encodeMp3 
} from '../services/audioEncoderService';
import { isolateAudio } from '../services/elevenLabsService';
import AudioWorkstation from './AudioWorkstation';

const AudioAnalyzer = React.lazy(() => import('./AudioAnalyzer'));

interface FactoryConversionResult {
  id: string;
  sourceName: string;
  sourceRelativePath?: string;
  sourceSize: number;
  sourceType: string;
  duration?: number;
  blob?: Blob;
  url?: string;
  error?: string;
  loudness?: FactoryLoudnessInfo;
}

interface FactoryLoudnessInfo {
  beforeLufs: number;
  afterLufs: number;
  targetLufs: number;
  requestedGainDb: number;
  appliedGainDb: number;
  peakCeilingDb: number;
  peakDb: number;
}

type FactoryAudioFormat = 'mp3' | 'wav' | 'ogg' | 'flac' | 'aac' | 'm4a';

type RenameRuleType = 'remove' | 'replace' | 'prefix' | 'suffix' | 'number' | 'case' | 'removeRange' | 'regexReplace';
type RenameCaseMode = 'lower' | 'upper' | 'title';

interface RenameOperation {
  id: string;
  type: RenameRuleType;
  findText: string;
  replaceText: string;
  insertText?: string;
  numberStart?: number;
  numberPadding?: number;
  numberSeparator?: string;
  caseMode?: RenameCaseMode;
  rangeStart?: number;
  rangeCount?: number;
}

interface RenameRules {
  operations: RenameOperation[];
  normalizeFileName: boolean;
}

interface RenamePreviewItem {
  id: string;
  file: File;
  sourceName: string;
  sourceRelativePath: string;
  outputName: string;
  outputRelativePath: string;
  status: 'ready' | 'changed' | 'duplicate-fixed' | 'manual';
  statusLabel: string;
}

const FACTORY_LOUDNESS_PRESETS = [
  { label: 'Avatar 出场', value: -13.5, hint: '-12 ~ -15 LUFS', group: '导出' },
  { label: '礼物', value: -16, hint: '-15 ~ -17 LUFS', group: '导出' },
  { label: 'JK 击杀', value: -21.5, hint: '-20 ~ -23 LUFS', group: '导出' },
  { label: 'JK 其他', value: -26.5, hint: '-25 ~ -28 LUFS', group: '导出' },
  { label: '酒馆质疑', value: -20, hint: '-20 LUFS', group: '导出' },
  { label: '酒馆出牌', value: -25, hint: '-25 LUFS', group: '导出' },
  { label: '游戏 BGM 音乐', value: -21.5, hint: '-20 ~ -23 LUFS', group: '游戏' },
  { label: '游戏环境氛围', value: -35, hint: '-30 ~ -40 LUFS', group: '游戏' },
  { label: '游戏音效', value: -25, hint: '-20 ~ -30 LUFS', group: '游戏' },
  { label: '游戏语音', value: -16.5, hint: '-15 ~ -18 LUFS', group: '游戏' },
];

const MIN_ANALYSIS_DB = -80;
const AUDIO_TOOLS_SUBNAV_MIN_WIDTH = 64;
const AUDIO_TOOLS_SUBNAV_COMPACT_WIDTH = 128;
const AUDIO_TOOLS_SUBNAV_DEFAULT_WIDTH = 240;
const AUDIO_TOOLS_SUBNAV_MAX_WIDTH = 520;

const FACTORY_FORMAT_OPTIONS: Array<{
  value: FactoryAudioFormat;
  label: string;
  description: string;
  supported: boolean;
}> = [
  { value: 'mp3', label: 'MP3', description: '高兼容压缩，适合快速交付/预览', supported: true },
  { value: 'wav', label: 'WAV', description: '无损 PCM，适合后期制作/入库', supported: true },
  { value: 'ogg', label: 'OGG', description: '游戏常用压缩格式，待接入编码器', supported: false },
  { value: 'flac', label: 'FLAC', description: '无损压缩归档格式，待接入编码器', supported: false },
  { value: 'aac', label: 'AAC', description: '移动端常用高效压缩，待接入编码器', supported: false },
  { value: 'm4a', label: 'M4A', description: 'Apple/移动端封装，待接入编码器', supported: false },
];

const DEFAULT_RENAME_RULES: RenameRules = {
  operations: [],
  normalizeFileName: true,
};

// Helper to extract audio from video/audio files via MediaElement fallback
async function extractAudioViaMediaElement(file: File): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.crossOrigin = 'anonymous';
    video.muted = false; // We need audio, but will mute it via GainNode
    video.playsInline = true;
    
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    
    // We must connect MediaElement to AudioContext before playing
    const source = audioCtx.createMediaElementSource(video);
    
    // Use ScriptProcessorNode to record the audio samples
    const bufferSize = 4096;
    const numberOfChannels = 2; // Default to stereo
    const scriptNode = audioCtx.createScriptProcessor(bufferSize, numberOfChannels, numberOfChannels);
    
    const recordedChunks: Float32Array[][] = Array.from({ length: numberOfChannels }, () => []);
    let totalSamples = 0;
    let isRecording = true;
    
    scriptNode.onaudioprocess = (event) => {
      if (!isRecording) return;
      
      const inputBuffer = event.inputBuffer;
      const channels = inputBuffer.numberOfChannels;
      
      for (let ch = 0; ch < numberOfChannels; ch++) {
        const srcCh = ch < channels ? ch : 0;
        const channelData = inputBuffer.getChannelData(srcCh);
        recordedChunks[ch].push(new Float32Array(channelData));
      }
      totalSamples += inputBuffer.length;
    };
    
    // Mute destination so there is no high-speed squeaking
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 0;
    
    source.connect(scriptNode);
    scriptNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    // Set max possible playback speed to decode as fast as possible
    video.playbackRate = 16;
    video.preservesPitch = false;
    
    let timeoutId: any = null;
    
    const cleanup = () => {
      isRecording = false;
      if (timeoutId) clearTimeout(timeoutId);
      video.pause();
      try {
        source.disconnect();
        scriptNode.disconnect();
        gainNode.disconnect();
      } catch (e) {}
      URL.revokeObjectURL(video.src);
      audioCtx.close().catch(() => {});
    };
    
    const finishRecording = () => {
      if (!isRecording) return;
      cleanup();
      
      if (totalSamples === 0) {
        reject(new Error('未检测到任何音频信号，可能该视频不包含可识别的音频轨道。'));
        return;
      }
      
      try {
        const outCtx = new AudioContextClass();
        const mergedBuffer = outCtx.createBuffer(numberOfChannels, totalSamples, audioCtx.sampleRate);
        
        for (let ch = 0; ch < numberOfChannels; ch++) {
          const channelData = mergedBuffer.getChannelData(ch);
          let offset = 0;
          for (const chunk of recordedChunks[ch]) {
            channelData.set(chunk, offset);
            offset += chunk.length;
          }
        }
        
        outCtx.close().catch(() => {});
        resolve(mergedBuffer);
      } catch (e) {
        reject(new Error('封装音频缓冲区失败：' + (e as Error).message));
      }
    };
    
    video.oncanplaythrough = async () => {
      try {
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        await video.play();
      } catch (err: any) {
        reject(new Error('无法播放此视频文件以提取音频：' + err.message));
        cleanup();
      }
    };
    
    video.onended = () => {
      finishRecording();
    };
    
    video.onerror = (e) => {
      reject(new Error('载入视频文件失败，可能文件损坏或格式不受浏览器支持。'));
      cleanup();
    };
    
    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (duration && !isNaN(duration) && isFinite(duration)) {
        const expectedTimeMs = (duration / video.playbackRate) * 1000 + 2000;
        timeoutId = setTimeout(() => {
          if (isRecording) {
            console.warn("Extraction hit timeout buffer, force finishing.");
            finishRecording();
          }
        }, Math.max(expectedTimeMs, 5000));
      }
    };
  });
}

// Main entry with fallback
async function decodeAudioWithFallback(file: File, arrayBuffer: ArrayBuffer, audioCtx: AudioContext): Promise<AudioBuffer> {
  try {
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      audioCtx.decodeAudioData(
        arrayBuffer.slice(0), // copy arrayBuffer as decodeAudioData will neuter it
        (buffer) => resolve(buffer),
        (err) => reject(err)
      );
    });
    return decoded;
  } catch (err) {
    console.warn("Standard decodeAudioData failed, attempting MediaElement audio extraction fallback...", err);
    return await extractAudioViaMediaElement(file);
  }
}

function linearToDb(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return MIN_ANALYSIS_DB;
  return Math.max(MIN_ANALYSIS_DB, 20 * Math.log10(value));
}

function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

function analyzeAudioLoudness(buffer: AudioBuffer) {
  let sumSquares = 0;
  let peak = 0;
  let sampleCount = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    sampleCount += data.length;
    for (let index = 0; index < data.length; index += 1) {
      const sample = data[index];
      sumSquares += sample * sample;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
    }
  }

  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;

  return {
    lufs: linearToDb(rms),
    peak,
    peakDb: linearToDb(peak),
  };
}

function normalizeAudioBuffer(
  sourceBuffer: AudioBuffer,
  targetLufs: number,
  peakCeilingDb: number,
): { buffer: AudioBuffer; loudness: FactoryLoudnessInfo } {
  const before = analyzeAudioLoudness(sourceBuffer);
  const requestedGainDb = targetLufs - before.lufs;
  const requestedGainLinear = dbToLinear(requestedGainDb);
  const peakCeilingLinear = dbToLinear(peakCeilingDb);

  let appliedGainLinear = requestedGainLinear;
  const projectedPeak = before.peak * requestedGainLinear;
  if (before.peak > 0 && projectedPeak > peakCeilingLinear) {
    appliedGainLinear = peakCeilingLinear / before.peak;
  }

  const outputBuffer = new AudioBuffer({
    length: sourceBuffer.length,
    numberOfChannels: sourceBuffer.numberOfChannels,
    sampleRate: sourceBuffer.sampleRate,
  });

  for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
    const input = sourceBuffer.getChannelData(channel);
    const output = outputBuffer.getChannelData(channel);
    for (let index = 0; index < input.length; index += 1) {
      output[index] = Math.max(-1, Math.min(1, input[index] * appliedGainLinear));
    }
  }

  const after = analyzeAudioLoudness(outputBuffer);
  const appliedGainDb = linearToDb(appliedGainLinear);

  return {
    buffer: outputBuffer,
    loudness: {
      beforeLufs: before.lufs,
      afterLufs: after.lufs,
      targetLufs,
      requestedGainDb,
      appliedGainDb,
      peakCeilingDb,
      peakDb: after.peakDb,
    },
  };
}

export default function AudioTools() {
  const [activeSubTab, setActiveSubTab] = useState<'workstation' | 'analysis' | 'factory' | 'renamer' | 'isolation'>('workstation');
  const [subNavWidth, setSubNavWidth] = useState(() => {
    if (typeof window === 'undefined') return AUDIO_TOOLS_SUBNAV_DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem('ai-audio-tools-subnav-width'));
    return Number.isFinite(saved)
      ? Math.max(AUDIO_TOOLS_SUBNAV_MIN_WIDTH, Math.min(AUDIO_TOOLS_SUBNAV_MAX_WIDTH, saved))
      : AUDIO_TOOLS_SUBNAV_DEFAULT_WIDTH;
  });
  const [isResizingSubNav, setIsResizingSubNav] = useState(false);
  const subNavResizeStartRef = useRef({ width: AUDIO_TOOLS_SUBNAV_DEFAULT_WIDTH, x: 0 });
  const isSubNavCompact = subNavWidth < AUDIO_TOOLS_SUBNAV_COMPACT_WIDTH;

  useEffect(() => {
    if (!isResizingSubNav) return;

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = subNavResizeStartRef.current.width + event.clientX - subNavResizeStartRef.current.x;
      setSubNavWidth(Math.max(AUDIO_TOOLS_SUBNAV_MIN_WIDTH, Math.min(AUDIO_TOOLS_SUBNAV_MAX_WIDTH, nextWidth)));
    };

    const handleMouseUp = () => {
      setIsResizingSubNav(false);
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
  }, [isResizingSubNav]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('ai-audio-tools-subnav-width', String(subNavWidth));
  }, [subNavWidth]);

  // ==========================================================
  // COMMON STATE / FUNCTIONS
  // ==========================================================
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = 2;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const formatLufs = (value: number): string => {
    if (!Number.isFinite(value) || value <= MIN_ANALYSIS_DB + 0.1) return '静音';
    return `${value.toFixed(1)} LUFS`;
  };

  const formatSignedDb = (value: number): string => {
    if (!Number.isFinite(value)) return '0.0 dB';
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)} dB`;
  };

  const getFactoryFilePath = (file: File): string => (
    (file as any).webkitRelativePath || file.name
  );

  const getFactoryOutputFileName = (sourceName: string): string => {
    const baseName = sourceName.substring(0, sourceName.lastIndexOf('.')) || sourceName;
    return `${baseName}_converted.${factoryFormat}`;
  };

  const sanitizeArchiveName = (name: string): string => (
    name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'converted_audio'
  );

  const getFactoryOutputFolderName = (): string => {
    const relativePaths = factoryResults
      .map((item) => item.sourceRelativePath)
      .filter((path): path is string => Boolean(path && path.includes('/')));
    const rootCandidates = relativePaths
      .map((path) => path.split('/')[0])
      .filter((root): root is string => Boolean(root));
    const uniqueRoots = Array.from(new Set<string>(rootCandidates));

    if (uniqueRoots.length === 1) return `${sanitizeArchiveName(uniqueRoots[0])}_1`;

    if (factoryFile) {
      const baseName = factoryFile.name.substring(0, factoryFile.name.lastIndexOf('.')) || factoryFile.name;
      return `${sanitizeArchiveName(baseName)}_1`;
    }

    return 'converted_audio_1';
  };

  const getFactoryOutputRelativePath = (item: FactoryConversionResult): string => {
    const relativePath = item.sourceRelativePath || item.sourceName;
    const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const pathParts = normalizedPath.split('/').filter(Boolean);
    const fileName = pathParts.pop() || item.sourceName;
    if (pathParts.length > 0) pathParts.shift();
    return [...pathParts, getFactoryOutputFileName(fileName)].join('/') || getFactoryOutputFileName(item.sourceName);
  };

  // ==========================================================
  // VOCAL ISOLATION STATE
  // ==========================================================
  const [isolationFile, setIsolationFile] = useState<File | null>(null);
  const [isolationStatus, setIsolationStatus] = useState<string>('');
  const [isolationLoading, setIsolationLoading] = useState<boolean>(false);
  const [isolationProgress, setIsolationProgress] = useState<number>(0);
  const [isolationError, setIsolationError] = useState<string | null>(null);
  const [isolationAudioUrl, setIsolationAudioUrl] = useState<string | null>(null);
  const [isolationBlob, setIsolationBlob] = useState<Blob | null>(null);
  const [isolationDragActive, setIsolationDragActive] = useState<boolean>(false);
  const isolationInputRef = useRef<HTMLInputElement>(null);

  const handleIsolationFileChange = (file: File) => {
    if (!file) return;
    setIsolationFile(file);
    setIsolationError(null);
    setIsolationAudioUrl(null);
    setIsolationBlob(null);
    setIsolationStatus('已载入待处理音频文件，点击下方“开始提取人声”进行极速云端分离。');
  };

  const handleIsolationSubmit = async () => {
    if (!isolationFile) return;

    setIsolationLoading(true);
    setIsolationError(null);
    setIsolationAudioUrl(null);
    setIsolationBlob(null);
    setIsolationProgress(20);
    setIsolationStatus('正在上传多媒体文件至 ElevenLabs 极速云端分离中枢...');

    try {
      // Show simulated progress intervals
      const interval = setInterval(() => {
        setIsolationProgress((prev) => {
          if (prev < 85) return prev + 10;
          return prev;
        });
      }, 500);

      const resultBlob = await isolateAudio(isolationFile);
      clearInterval(interval);

      setIsolationProgress(100);
      setIsolationStatus('人声分离成功！已完美消除背景杂音，提取出高保真独立人声音轨。');
      
      const url = URL.createObjectURL(resultBlob);
      setIsolationAudioUrl(url);
      setIsolationBlob(resultBlob);

    } catch (err: any) {
      console.error(err);
      const errMsg = err.message || '人声分离失败，请确认 API Key 或音频格式是否正确。';
      setIsolationError(errMsg);
      setIsolationStatus(errMsg);
      setIsolationProgress(0);
    } finally {
      setIsolationLoading(false);
    }
  };

  // Drag and drop for isolation
  const handleIsolationDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsolationDragActive(true);
    } else if (e.type === "dragleave") {
      setIsolationDragActive(false);
    }
  };

  const handleIsolationDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsolationDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleIsolationFileChange(e.dataTransfer.files[0]);
    }
  };

  // ==========================================================
  // MUSIC CONVERSION STATE
  // ==========================================================
  const [factoryFiles, setFactoryFiles] = useState<File[]>([]);
  const [factoryFormat, setFactoryFormat] = useState<FactoryAudioFormat>('mp3');
  const [factorySampleRate, setFactorySampleRate] = useState<number>(44100);
  const [factoryBitrate, setFactoryBitrate] = useState<number>(128); // for MP3
  const [factoryNormalizeEnabled, setFactoryNormalizeEnabled] = useState<boolean>(false);
  const [factoryTargetLufs, setFactoryTargetLufs] = useState<number>(-16);
  const [factoryPeakCeilingDb, setFactoryPeakCeilingDb] = useState<number>(-1);
  const [factoryStatus, setFactoryStatus] = useState<string>('');
  const [factoryLoading, setFactoryLoading] = useState<boolean>(false);
  const [factoryProgress, setFactoryProgress] = useState<number>(0);
  const [factoryError, setFactoryError] = useState<string | null>(null);
  const [factoryResults, setFactoryResults] = useState<FactoryConversionResult[]>([]);

  const factoryInputRef = useRef<HTMLInputElement>(null);
  const factoryFolderInputRef = useRef<HTMLInputElement>(null);
  const [factoryDragActive, setFactoryDragActive] = useState<boolean>(false);
  const factoryFile = factoryFiles[0] || null;
  const selectedFactoryFormatOption = FACTORY_FORMAT_OPTIONS.find(option => option.value === factoryFormat) || FACTORY_FORMAT_OPTIONS[0];
  const primaryFactoryResult = factoryResults.find(item => item.blob && item.url) || null;
  const factoryAudioUrl = primaryFactoryResult?.url || null;
  const factoryBlob = primaryFactoryResult?.blob || null;
  const factoryOriginalDuration = primaryFactoryResult?.duration || null;

  const bindFactoryFolderInput = React.useCallback((node: HTMLInputElement | null) => {
    factoryFolderInputRef.current = node;
    if (!node) return;
    node.webkitdirectory = true;
    node.setAttribute('webkitdirectory', '');
    node.setAttribute('directory', '');
  }, []);

  const openFactoryFilePicker = React.useCallback(() => {
    if (factoryInputRef.current) factoryInputRef.current.value = '';
    factoryInputRef.current?.click();
  }, []);

  const openFactoryFolderPicker = React.useCallback(() => {
    const folderInput = factoryFolderInputRef.current;
    if (!folderInput) return;
    folderInput.value = '';
    folderInput.webkitdirectory = true;
    folderInput.setAttribute('webkitdirectory', '');
    folderInput.setAttribute('directory', '');
    folderInput.click();
  }, []);

  const revokeFactoryResultUrls = (results: FactoryConversionResult[]) => {
    results.forEach((item) => {
      if (item.url) URL.revokeObjectURL(item.url);
    });
  };

  const updatePrimaryFactoryResult = (patch: Partial<FactoryConversionResult> | null) => {
    if (patch === null) {
      revokeFactoryResultUrls(factoryResults);
      setFactoryResults([]);
      return;
    }
    setFactoryResults((prev) => {
      const base = prev[0] || {
        id: factoryFile ? `${factoryFile.name}-${factoryFile.size}-${factoryFile.lastModified}` : `converted-${Date.now()}`,
        sourceName: factoryFile?.name || 'converted-audio',
        sourceRelativePath: factoryFile ? getFactoryFilePath(factoryFile) : undefined,
        sourceSize: factoryFile?.size || 0,
        sourceType: factoryFile?.type || 'unknown',
      };
      return [{ ...base, ...patch }, ...prev.slice(1)];
    });
  };

  const setFactoryFile = (file: File | null) => {
    setFactoryFiles(file ? [file] : []);
  };
  const setFactoryAudioUrl = (url: string | null) => updatePrimaryFactoryResult(url ? { url } : null);
  const setFactoryBlob = (blob: Blob | null) => updatePrimaryFactoryResult(blob ? { blob } : null);
  const setFactoryOriginalDuration = (duration: number | null) => {
    if (duration !== null) updatePrimaryFactoryResult({ duration });
  };

  // ==========================================================
  // BATCH RENAMER STATE
  // ==========================================================
  const [renameFiles, setRenameFiles] = useState<File[]>([]);
  const [renameRules, setRenameRules] = useState<RenameRules>(DEFAULT_RENAME_RULES);
  const [renameRuleHistory, setRenameRuleHistory] = useState<RenameRules[]>([]);
  const [renameManualNames, setRenameManualNames] = useState<Record<string, string>>({});
  const [renameDragActive, setRenameDragActive] = useState<boolean>(false);
  const [renameStatus, setRenameStatus] = useState<string>('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameExporting, setRenameExporting] = useState<boolean>(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameFolderInputRef = useRef<HTMLInputElement>(null);

  const bindRenameFolderInput = React.useCallback((node: HTMLInputElement | null) => {
    renameFolderInputRef.current = node;
    if (!node) return;
    node.webkitdirectory = true;
    node.setAttribute('webkitdirectory', '');
    node.setAttribute('directory', '');
  }, []);

  const openRenameFilePicker = React.useCallback(() => {
    if (renameInputRef.current) renameInputRef.current.value = '';
    renameInputRef.current?.click();
  }, []);

  const openRenameFolderPicker = React.useCallback(() => {
    const folderInput = renameFolderInputRef.current;
    if (!folderInput) return;
    folderInput.value = '';
    folderInput.webkitdirectory = true;
    folderInput.setAttribute('webkitdirectory', '');
    folderInput.setAttribute('directory', '');
    folderInput.click();
  }, []);

  // ==========================================================
  // MUSIC CONVERSION ACTION
  // ==========================================================
  const isFactorySupportedFile = (file: File) => (
    file.type.startsWith('audio/')
    || file.type.startsWith('video/')
    || /\.(mp3|wav|m4a|aac|ogg|flac|webm|mp4|mov|mkv|avi)$/i.test(file.name)
  );

  const handleFactoryFilesChange = (files: FileList | File[]) => {
    const selectedFiles = Array.from(files).filter(isFactorySupportedFile);
    if (selectedFiles.length === 0) {
      setFactoryError('请选择音频/视频文件，或包含音频/视频的文件夹。');
      return;
    }
    setFactoryFiles(selectedFiles);
    setFactoryError(null);
    revokeFactoryResultUrls(factoryResults);
    setFactoryResults([]);
    setFactoryProgress(0);
    setFactoryStatus(`已载入 ${selectedFiles.length} 个待转换文件，请设置参数后点击“开始批量转换”。`);
  };

  const convertFactoryFile = async (
    file: File,
    onStepProgress: (stepProgress: number, message: string) => void,
  ): Promise<FactoryConversionResult> => {
    if (factoryFormat !== 'mp3' && factoryFormat !== 'wav') {
      throw new Error(`${factoryFormat.toUpperCase()} 格式编码暂未接入，请先选择 MP3 或 WAV。`);
    }

    onStepProgress(0.15, `正在读取：${file.name}`);
    const arrayBuffer = await file.arrayBuffer();

    onStepProgress(0.35, `正在解码：${file.name}`);
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContext();
    let decodedBuffer: AudioBuffer;
    try {
      decodedBuffer = await decodeAudioWithFallback(file, arrayBuffer, audioCtx);
    } finally {
      await audioCtx.close();
    }

    let processingBuffer = decodedBuffer;
    let loudness: FactoryLoudnessInfo | undefined;
    if (factoryNormalizeEnabled) {
      onStepProgress(0.52, `正在统一响度至 ${factoryTargetLufs.toFixed(1)} LUFS：${file.name}`);
      const normalized = normalizeAudioBuffer(decodedBuffer, factoryTargetLufs, factoryPeakCeilingDb);
      processingBuffer = normalized.buffer;
      loudness = normalized.loudness;
    }

    onStepProgress(0.68, `正在重采样至 ${factorySampleRate.toLocaleString()} Hz：${file.name}`);
    const resampledBuffer = await resampleAudioBuffer(processingBuffer, factorySampleRate);

    onStepProgress(0.85, `正在封装为 ${factoryFormat.toUpperCase()}：${file.name}`);
    const finalBlob = factoryFormat === 'wav'
      ? encodeWav(resampledBuffer)
      : encodeMp3(resampledBuffer, factoryBitrate);

    return {
      id: `${file.name}-${file.size}-${file.lastModified}`,
      sourceName: file.name,
      sourceRelativePath: getFactoryFilePath(file),
      sourceSize: file.size,
      sourceType: file.type || 'unknown',
      duration: decodedBuffer.duration,
      blob: finalBlob,
      url: URL.createObjectURL(finalBlob),
      loudness,
    };
  };

  const handleFactoryFileChange = (file: File) => {
    if (!file) return;
    setFactoryFile(file);
    setFactoryError(null);
    setFactoryAudioUrl(null);
    setFactoryBlob(null);
    setFactoryOriginalDuration(null);
    setFactoryStatus('文件已载入格式工厂，请调整下方属性，然后点击“开始格式转换”。');
  };

  const handleFactorySubmit = async () => {
    if (!factoryFile) return;

    if (factoryFiles.length >= 1) {
      setFactoryLoading(true);
      setFactoryError(null);
      revokeFactoryResultUrls(factoryResults);
      setFactoryResults([]);
      setFactoryProgress(1);
      setFactoryStatus(factoryFiles.length > 1 ? `准备批量转换 ${factoryFiles.length} 个文件...` : '准备转换 1 个文件...');

      try {
        const nextResults: FactoryConversionResult[] = [];
        for (let index = 0; index < factoryFiles.length; index += 1) {
          const file = factoryFiles[index];
          try {
            const result = await convertFactoryFile(file, (stepProgress, message) => {
              const overallProgress = Math.round(((index + stepProgress) / factoryFiles.length) * 100);
              setFactoryProgress(Math.min(99, Math.max(1, overallProgress)));
              setFactoryStatus(`[${index + 1}/${factoryFiles.length}] ${message}`);
            });
            nextResults.push(result);
          } catch (err: any) {
            nextResults.push({
              id: `${file.name}-${file.size}-${file.lastModified}-error`,
              sourceName: file.name,
              sourceRelativePath: getFactoryFilePath(file),
              sourceSize: file.size,
              sourceType: file.type || 'unknown',
              error: err?.message || '转换失败，请确认文件格式是否能被浏览器解码。',
            });
          }
          setFactoryResults([...nextResults]);
        }

        const successCount = nextResults.filter(item => item.blob).length;
        const failedCount = nextResults.length - successCount;
        setFactoryProgress(100);
        setFactoryStatus(`批量转换完成：成功 ${successCount} 个，失败 ${failedCount} 个。`);
        setFactoryError(successCount === 0 ? '全部文件转换失败，请检查文件格式或浏览器解码支持。' : null);
      } catch (err: any) {
        const errMsg = err?.message || '批量转换出错，请重新核对音频选项。';
        setFactoryError(errMsg);
        setFactoryStatus(errMsg);
        setFactoryProgress(0);
      } finally {
        setFactoryLoading(false);
      }
      return;
    }

    setFactoryLoading(true);
    setFactoryError(null);
    setFactoryAudioUrl(null);
    setFactoryBlob(null);
    setFactoryProgress(10);
    setFactoryStatus('正在读取多媒体文件二进制流...');

    try {
      const reader = new FileReader();
      
      const fileDataLoaded = new Promise<ArrayBuffer>((resolve, reject) => {
        reader.onload = (e) => {
          if (e.target?.result instanceof ArrayBuffer) {
            resolve(e.target.result);
          } else {
            reject(new Error('无法读取文件内容。'));
          }
        };
        reader.onerror = () => reject(new Error('文件读取出错。'));
      });

      reader.readAsArrayBuffer(factoryFile);
      const arrayBuffer = await fileDataLoaded;

      setFactoryProgress(30);
      setFactoryStatus(`正在使用高级核心解码音视频通道 (当前采样率: ${factorySampleRate} Hz)...`);

      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContext();
      
      let decodedBuffer: AudioBuffer;
      try {
        decodedBuffer = await decodeAudioWithFallback(factoryFile, arrayBuffer, audioCtx);
      } catch (err: any) {
        throw new Error(err.message || '音视频解码失败，请确认文件格式是否受您的浏览器直接播放支持。');
      } finally {
        await audioCtx.close();
      }

      setFactoryOriginalDuration(decodedBuffer.duration);
      setFactoryProgress(50);
      setFactoryStatus(`重采样处理：将原始声道重新对齐至 ${factorySampleRate.toLocaleString()} Hz...`);

      // Resample to user selected Sample Rate
      const resampledBuffer = await resampleAudioBuffer(decodedBuffer, factorySampleRate);

      setFactoryProgress(75);
      setFactoryStatus(`正在封装成指定格式: [${factoryFormat.toUpperCase()}] ...`);

      let finalBlob: Blob;
      if (factoryFormat === 'wav') {
        finalBlob = encodeWav(resampledBuffer);
      } else if (factoryFormat === 'mp3') {
        // MP3
        finalBlob = encodeMp3(resampledBuffer, factoryBitrate);
      } else {
        throw new Error(`${factoryFormat.toUpperCase()} 格式编码暂未接入，请先选择 MP3 或 WAV。`);
      }

      setFactoryProgress(100);
      setFactoryStatus(`转换成功！已完美转化为高兼容性 [${factoryFormat.toUpperCase()}] 目标媒体。`);
      
      const url = URL.createObjectURL(finalBlob);
      setFactoryAudioUrl(url);
      setFactoryBlob(finalBlob);

    } catch (err: any) {
      console.error(err);
      const errMsg = err.message || '转换出错，请重新核对音频选项。';
      setFactoryError(errMsg);
      setFactoryStatus(errMsg);
      setFactoryProgress(0);
    } finally {
      setFactoryLoading(false);
    }
  };

  const attachFactoryRelativePath = (file: File, relativePath: string): File => {
    if (!relativePath) return file;
    try {
      Object.defineProperty(file, 'webkitRelativePath', {
        value: relativePath.replace(/^\/+/, ''),
        configurable: true,
      });
    } catch (err) {
      console.warn('Unable to attach dropped file relative path.', err);
    }
    return file;
  };

  const readDroppedEntryFiles = async (entry: any): Promise<File[]> => {
    if (!entry) return [];
    if (entry.isFile) {
      return new Promise<File[]>((resolve) => {
        entry.file(
          (file: File) => resolve([attachFactoryRelativePath(file, entry.fullPath || file.name)]),
          () => resolve([]),
        );
      });
    }

    if (!entry.isDirectory) return [];

    const reader = entry.createReader();
    const readBatch = async (): Promise<any[]> => new Promise((resolve) => {
      reader.readEntries(
        (entries: any[]) => resolve(entries),
        () => resolve([]),
      );
    });

    const children: any[] = [];
    let batch = await readBatch();
    while (batch.length > 0) {
      children.push(...batch);
      batch = await readBatch();
    }

    const nestedFiles = await Promise.all(children.map(readDroppedEntryFiles));
    return nestedFiles.flat();
  };

  const getFactoryDroppedFiles = async (dataTransfer: DataTransfer): Promise<File[]> => {
    const items = Array.from(dataTransfer.items || []);
    const entries = items
      .map((item: any) => item.webkitGetAsEntry?.())
      .filter(Boolean);

    if (entries.length > 0) {
      const files = await Promise.all(entries.map(readDroppedEntryFiles));
      return files.flat();
    }

    return Array.from(dataTransfer.files || []);
  };

  const isRenameSupportedFile = (file: File) => (
    file.type.startsWith('audio/')
    || /\.(mp3|wav|m4a|aac|ogg|flac|webm|aif|aiff|opus)$/i.test(file.name)
  );

  const getRenameFileId = (file: File): string => `${getFactoryFilePath(file)}-${file.size}-${file.lastModified}`;

  const splitFileName = (fileName: string): { base: string; extension: string } => {
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex <= 0) return { base: fileName, extension: '' };
    return {
      base: fileName.slice(0, dotIndex),
      extension: fileName.slice(dotIndex),
    };
  };

  const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const normalizeRenameText = (value: string): string => (
    value
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
  );

  const getRenameOperationLabel = (operation: RenameOperation) => {
    if (operation.type === 'remove') return `删除「${operation.findText || '未填写'}」`;
    return `把「${operation.findText || '未填写'}」替换成「${operation.replaceText || '空'}」`;
  };

  const createRenameOperation = (type: RenameRuleType): RenameOperation => ({
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    findText: '',
    replaceText: '',
  });

  const createEnhancedRenameOperation = (type: RenameRuleType): RenameOperation => ({
    ...createRenameOperation(type),
    insertText: type === 'prefix' ? 'SFX_' : type === 'suffix' ? '_v1' : '',
    numberStart: 1,
    numberPadding: 3,
    numberSeparator: '_',
    caseMode: 'lower',
    rangeStart: 1,
    rangeCount: 1,
  });

  const getEnhancedRenameOperationLabel = (operation: RenameOperation) => {
    if (operation.type === 'remove') return `删除「${operation.findText || '未填写'}」`;
    if (operation.type === 'replace') return `把「${operation.findText || '未填写'}」替换成「${operation.replaceText || '空'}」`;
    if (operation.type === 'prefix') return `添加前缀「${operation.insertText || '未填写'}」`;
    if (operation.type === 'suffix') return `添加后缀「${operation.insertText || '未填写'}」`;
    if (operation.type === 'number') return `自动编号 ${operation.numberSeparator || '_'}${String(operation.numberStart || 1).padStart(operation.numberPadding || 3, '0')}`;
    if (operation.type === 'case') return `大小写：${operation.caseMode === 'upper' ? '全部大写' : operation.caseMode === 'title' ? '首字母大写' : '全部小写'}`;
    if (operation.type === 'removeRange') return `删除第 ${operation.rangeStart || 1} 位起 ${operation.rangeCount || 1} 个字符`;
    if (operation.type === 'regexReplace') return `正则替换 /${operation.findText || 'pattern'}/`;
    return '命名规则';
  };

  const titleCaseRenameText = (value: string): string => (
    value.replace(/(^|[\s_\-]+)([\p{L}\p{N}])/gu, (match, separator, char) => `${separator}${String(char).toUpperCase()}`)
  );

  const commitRenameRules = React.useCallback((updater: (prev: RenameRules) => RenameRules) => {
    setRenameRules((prev) => {
      const next = updater(prev);
      setRenameRuleHistory((history) => [prev, ...history].slice(0, 20));
      return next;
    });
  }, []);

  const undoRenameRules = React.useCallback(() => {
    setRenameRuleHistory((history) => {
      const [previous, ...rest] = history;
      if (!previous) return history;
      setRenameRules(previous);
      setRenameStatus('已撤回上一次命名规则修改，右侧预览已同步更新。');
      return rest;
    });
  }, []);

  const addRenameOperation = React.useCallback((type: RenameRuleType) => {
    commitRenameRules((prev) => ({
      ...prev,
      operations: [...prev.operations, createEnhancedRenameOperation(type)],
    }));
  }, [commitRenameRules]);

  const updateRenameOperation = React.useCallback((id: string, patch: Partial<RenameOperation>) => {
    commitRenameRules((prev) => ({
      ...prev,
      operations: prev.operations.map((operation) => (
        operation.id === id ? { ...operation, ...patch } : operation
      )),
    }));
  }, [commitRenameRules]);

  const removeRenameOperation = React.useCallback((id: string) => {
    commitRenameRules((prev) => ({
      ...prev,
      operations: prev.operations.filter((operation) => operation.id !== id),
    }));
  }, [commitRenameRules]);

  const applyRenameRulesToBase = (sourceBase: string, fileIndex: number): string => {
    let processedBase = sourceBase;

    renameRules.operations.forEach((operation) => {
      if (operation.type === 'remove') {
        if (!operation.findText) return;
        processedBase = processedBase.replace(new RegExp(escapeRegExp(operation.findText), 'g'), '');
        return;
      }
      if (operation.type === 'replace') {
        if (!operation.findText) return;
        processedBase = processedBase.replace(new RegExp(escapeRegExp(operation.findText), 'g'), operation.replaceText);
        return;
      }
      if (operation.type === 'regexReplace') {
        if (!operation.findText) return;
        try {
          processedBase = processedBase.replace(new RegExp(operation.findText, 'g'), operation.replaceText);
        } catch {
          // Invalid regex is ignored so preview/export never crashes.
        }
        return;
      }
      if (operation.type === 'prefix') {
        processedBase = `${operation.insertText || ''}${processedBase}`;
        return;
      }
      if (operation.type === 'suffix') {
        processedBase = `${processedBase}${operation.insertText || ''}`;
        return;
      }
      if (operation.type === 'number') {
        const start = Number.isFinite(operation.numberStart) ? Number(operation.numberStart) : 1;
        const padding = Math.max(1, Math.min(8, Number(operation.numberPadding) || 3));
        const separator = operation.numberSeparator ?? '_';
        processedBase = `${processedBase}${separator}${String(start + fileIndex).padStart(padding, '0')}`;
        return;
      }
      if (operation.type === 'case') {
        if (operation.caseMode === 'upper') processedBase = processedBase.toUpperCase();
        else if (operation.caseMode === 'title') processedBase = titleCaseRenameText(processedBase.toLowerCase());
        else processedBase = processedBase.toLowerCase();
        return;
      }
      if (operation.type === 'removeRange') {
        const start = Math.max(1, Number(operation.rangeStart) || 1) - 1;
        const count = Math.max(1, Number(operation.rangeCount) || 1);
        processedBase = `${processedBase.slice(0, start)}${processedBase.slice(start + count)}`;
      }
    });

    return renameRules.normalizeFileName
      ? normalizeRenameText(processedBase) || 'renamed_audio'
      : processedBase.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'renamed_audio';
  };

  const getRenameOutputRootName = (): string => {
    const relativePaths = renameFiles
      .map((file) => getFactoryFilePath(file))
      .filter((path) => path.includes('/'));
    const roots = Array.from(new Set<string>(relativePaths
      .map((path) => path.split('/')[0])
      .filter((root): root is string => Boolean(root))));
    if (roots.length === 1) return `${sanitizeArchiveName(roots[0])}_renamed`;
    return 'renamed_audio_1';
  };

  const getUniqueRenamePath = (relativePath: string, usedPaths: Set<string>): { path: string; fixed: boolean } => {
    const safePath = relativePath
      .split('/')
      .filter(Boolean)
      .map(sanitizeArchiveName)
      .join('/');

    if (!usedPaths.has(safePath)) {
      usedPaths.add(safePath);
      return { path: safePath, fixed: false };
    }

    const parts = safePath.split('/');
    const fileName = parts.pop() || 'renamed_audio';
    const { base, extension } = splitFileName(fileName);
    let counter = 2;

    while (true) {
      const candidate = [...parts, `${base}_${counter}${extension}`].join('/');
      if (!usedPaths.has(candidate)) {
        usedPaths.add(candidate);
        return { path: candidate, fixed: true };
      }
      counter += 1;
    }
  };

  const renamePreviewItems = React.useMemo<RenamePreviewItem[]>(() => {
    const usedPaths = new Set<string>();
    return renameFiles.map((file) => {
      const id = getRenameFileId(file);
      const sourceRelativePath = getFactoryFilePath(file).replace(/\\/g, '/').replace(/^\/+/, '');
      const sourceParts = sourceRelativePath.split('/').filter(Boolean);
      const sourceName = sourceParts.pop() || file.name;
      if (sourceParts.length > 0) sourceParts.shift();

      const { base, extension } = splitFileName(sourceName);
      const manualName = renameManualNames[id]?.trim();
      let outputName = manualName || `${applyRenameRulesToBase(base, renameFiles.indexOf(file))}${extension}`;
      if (manualName && !splitFileName(manualName).extension) outputName = `${manualName}${extension}`;
      outputName = sanitizeArchiveName(outputName);

      const { path: outputRelativePath, fixed } = getUniqueRenamePath([...sourceParts, outputName].join('/'), usedPaths);
      const finalOutputName = outputRelativePath.split('/').pop() || outputName;
      const changed = finalOutputName !== sourceName || outputRelativePath !== [...sourceParts, sourceName].join('/');
      const status: RenamePreviewItem['status'] = manualName ? 'manual' : fixed ? 'duplicate-fixed' : changed ? 'changed' : 'ready';

      return {
        id,
        file,
        sourceName,
        sourceRelativePath,
        outputName: finalOutputName,
        outputRelativePath,
        status,
        statusLabel: manualName ? '手动命名' : fixed ? '重名已修正' : changed ? '已改名' : '未变化',
      };
    });
  }, [renameFiles, renameManualNames, renameRules]);

  const handleRenameFilesChange = (files: FileList | File[]) => {
    const selectedFiles = Array.from(files).filter(isRenameSupportedFile);
    if (selectedFiles.length === 0) {
      setRenameError('请选择音频文件，或包含音频文件的文件夹。');
      return;
    }
    setRenameFiles(selectedFiles);
    setRenameManualNames({});
    setRenameError(null);
    setRenameStatus(`已载入 ${selectedFiles.length} 个音频文件，可在右侧实时预览新命名。`);
  };

  const handleRenameDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setRenameDragActive(true);
    } else if (e.type === 'dragleave') {
      setRenameDragActive(false);
    }
  };

  const handleRenameDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRenameDragActive(false);
    const droppedFiles = await getFactoryDroppedFiles(e.dataTransfer);
    if (droppedFiles.length > 0) handleRenameFilesChange(droppedFiles);
  };

  const downloadRenameCsv = () => {
    if (renamePreviewItems.length === 0) return;
    const rows = [
      ['原始路径', '原文件名', '新路径', '新文件名', '状态'],
      ...renamePreviewItems.map((item) => [
        item.sourceRelativePath,
        item.sourceName,
        item.outputRelativePath,
        item.outputName,
        item.statusLabel,
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    downloadNamedBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `${getRenameOutputRootName()}_命名对照.csv`);
  };

  const exportRenamedAudio = async () => {
    if (renamePreviewItems.length === 0) return;
    setRenameExporting(true);
    setRenameError(null);
    try {
      if (renamePreviewItems.length === 1) {
        const item = renamePreviewItems[0];
        const outputFileName = item.outputRelativePath.split('/').pop() || item.outputName;
        setRenameStatus(`正在导出 ${outputFileName}...`);
        downloadNamedBlob(item.file, outputFileName);
        setRenameStatus(`已开始下载 ${outputFileName}。`);
        return;
      }

      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const rootName = getRenameOutputRootName();

      renamePreviewItems.forEach((item) => {
        zip.file(`${rootName}/${item.outputRelativePath}`, item.file, { binary: true });
      });

      setRenameStatus(`正在打包 ${renamePreviewItems.length} 个重命名音频为 ${rootName}.zip...`);
      const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'STORE', streamFiles: true },
        (metadata) => setRenameStatus(`正在生成重命名 ZIP ${Math.round(metadata.percent)}%：${rootName}.zip`),
      );
      downloadNamedBlob(zipBlob, `${rootName}.zip`);
      setRenameStatus(`已生成并开始下载 ${rootName}.zip。`);
    } catch (err: any) {
      setRenameError(err?.message || '导出失败。');
    } finally {
      setRenameExporting(false);
    }
  };

  // Drag and drop for factory
  const handleFactoryDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setFactoryDragActive(true);
    } else if (e.type === "dragleave") {
      setFactoryDragActive(false);
    }
  };

  const handleFactoryDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFactoryDragActive(false);
    const droppedFiles = await getFactoryDroppedFiles(e.dataTransfer);
    if (droppedFiles.length > 0) {
      handleFactoryFilesChange(droppedFiles);
    }
  };

  // Trigger downloads
  const downloadFile = (blob: Blob, originalName: string, suffix: string) => {
    const baseName = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}_converted.${suffix}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadNamedBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const writeFactoryResultToDirectory = async (
    rootHandle: any,
    relativePath: string,
    blob: Blob,
  ) => {
    const pathParts = relativePath.split('/').filter(Boolean);
    const fileName = pathParts.pop();
    if (!fileName) return;

    let currentHandle = rootHandle;
    for (const folderName of pathParts) {
      currentHandle = await currentHandle.getDirectoryHandle(sanitizeArchiveName(folderName), { create: true });
    }

    const fileHandle = await currentHandle.getFileHandle(sanitizeArchiveName(fileName), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  };

  const downloadFactoryResultsIndividually = (successfulResults: Array<FactoryConversionResult & { blob: Blob }>) => {
    successfulResults.forEach((item, index) => {
      window.setTimeout(() => {
        const outputPath = getFactoryOutputRelativePath(item);
        const outputFileName = outputPath.split('/').pop() || getFactoryOutputFileName(item.sourceName);
        downloadNamedBlob(item.blob, outputFileName);
      }, index * 250);
    });
  };

  const getUniqueFactoryArchivePath = (path: string, usedPaths: Set<string>): string => {
    const safePath = path
      .split('/')
      .filter(Boolean)
      .map(sanitizeArchiveName)
      .join('/');

    if (!usedPaths.has(safePath)) {
      usedPaths.add(safePath);
      return safePath;
    }

    const parts = safePath.split('/');
    const fileName = parts.pop() || 'converted_audio';
    const dotIndex = fileName.lastIndexOf('.');
    const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    const extension = dotIndex > 0 ? fileName.slice(dotIndex) : '';
    let counter = 2;

    while (true) {
      const candidate = [...parts, `${baseName}_${counter}${extension}`].join('/');
      if (!usedPaths.has(candidate)) {
        usedPaths.add(candidate);
        return candidate;
      }
      counter += 1;
    }
  };

  const downloadFactoryResultsAsZip = async (successfulResults: Array<FactoryConversionResult & { blob: Blob }>) => {
    const outputFolderName = getFactoryOutputFolderName();
    const zipFileName = `${outputFolderName}.zip`;
    const totalBytes = successfulResults.reduce((sum, item) => sum + item.blob.size, 0);
    const usedPaths = new Set<string>();

    setFactoryStatus(`正在打包 ${successfulResults.length} 个文件为 ${zipFileName}（${formatBytes(totalBytes)}），完成后会直接触发浏览器下载。`);

    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();

    successfulResults.forEach((item) => {
      const relativePath = getUniqueFactoryArchivePath(
        `${outputFolderName}/${getFactoryOutputRelativePath(item)}`,
        usedPaths,
      );
      zip.file(relativePath, item.blob, { binary: true });
    });

    const zipBlob = await zip.generateAsync(
      {
        type: 'blob',
        compression: 'STORE',
        streamFiles: true,
      },
      (metadata) => {
        setFactoryStatus(`正在生成压缩包 ${Math.round(metadata.percent)}%：${zipFileName}`);
      },
    );

    downloadNamedBlob(zipBlob, zipFileName);
    setFactoryStatus(`已生成并开始下载 ${zipFileName}，压缩包内保留 ${outputFolderName} 文件夹结构。`);
    setFactoryError(null);
  };

  const downloadFactoryResults = async () => {
    const successfulResults = factoryResults
      .filter((item): item is FactoryConversionResult & { blob: Blob } => Boolean(item.blob));

    if (successfulResults.length === 0) return;

    if (successfulResults.length === 1) {
      downloadFile(successfulResults[0].blob, successfulResults[0].sourceName, factoryFormat);
      return;
    }

    try {
      await downloadFactoryResultsAsZip(successfulResults);
    } catch (err) {
      console.warn('Zip download failed, falling back to individual downloads.', err);
      setFactoryError('压缩包下载失败，已改为逐个下载全部成功文件。');
      setFactoryStatus('压缩包生成失败，正在逐个触发浏览器下载。');
      downloadFactoryResultsIndividually(successfulResults);
    }
  };

  return (
    <div id="audio-tools-view" className="flex-1 flex flex-col md:flex-row bg-slate-50 min-h-screen overflow-hidden">
      {/* Sub-navigation Sidebar */}
      <div
        className={`relative w-full md:w-[var(--audio-tools-subnav-width)] bg-white border-b md:border-b-0 md:border-r border-slate-200 flex flex-col shrink-0 select-none ${
          isSubNavCompact ? 'p-2 md:p-3' : 'p-4 md:p-5'
        }`}
        style={{ '--audio-tools-subnav-width': `${subNavWidth}px` } as React.CSSProperties}
      >
        <div className="space-y-1.5">
          {/* Subtab Button 0: 音频工作站 */}
          <button
            onClick={() => setActiveSubTab('workstation')}
            title="音频工作站"
            className={`w-full flex items-center rounded-xl text-xs font-semibold transition-all duration-200 ${
              isSubNavCompact ? 'justify-center gap-0 px-0 py-3' : 'gap-3 px-3 py-2.5'
            } ${
              activeSubTab === 'workstation'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Music className={`w-4 h-4 transition-colors ${activeSubTab === 'workstation' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className={isSubNavCompact ? 'hidden' : ''}>音频工作站</span>
          </button>

          {/* Subtab Button: 音频分析 */}
          <button
            onClick={() => setActiveSubTab('analysis')}
            title="音频分析"
            className={`w-full flex items-center rounded-xl text-xs font-semibold transition-all duration-200 ${
              isSubNavCompact ? 'justify-center gap-0 px-0 py-3' : 'gap-3 px-3 py-2.5'
            } ${
              activeSubTab === 'analysis'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <BarChart3 className={`w-4 h-4 transition-colors ${activeSubTab === 'analysis' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className={isSubNavCompact ? 'hidden' : ''}>音频分析</span>
          </button>

          {/* Subtab Button 1: 音频转换 */}
          <button
            onClick={() => setActiveSubTab('factory')}
            title="音频转换/压缩"
            className={`w-full flex items-center rounded-xl text-xs font-semibold transition-all duration-200 ${
              isSubNavCompact ? 'justify-center gap-0 px-0 py-3' : 'gap-3 px-3 py-2.5'
            } ${
              activeSubTab === 'factory'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <RefreshCw className={`w-4 h-4 transition-colors ${activeSubTab === 'factory' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className={isSubNavCompact ? 'hidden' : ''}>音频转换/压缩</span>
          </button>

          {/* Subtab Button: 批量命名 */}
          <button
            onClick={() => setActiveSubTab('renamer')}
            title="批量命名"
            className={`w-full flex items-center rounded-xl text-xs font-semibold transition-all duration-200 ${
              isSubNavCompact ? 'justify-center gap-0 px-0 py-3' : 'gap-3 px-3 py-2.5'
            } ${
              activeSubTab === 'renamer'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <FileText className={`w-4 h-4 transition-colors ${activeSubTab === 'renamer' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className={isSubNavCompact ? 'hidden' : ''}>批量命名</span>
          </button>

          {/* Subtab Button 2: 人声分离 */}
          <button
            onClick={() => setActiveSubTab('isolation')}
            title="人声分离 (AI)"
            className={`w-full flex items-center rounded-xl text-xs font-semibold transition-all duration-200 ${
              isSubNavCompact ? 'justify-center gap-0 px-0 py-3' : 'gap-3 px-3 py-2.5'
            } ${
              activeSubTab === 'isolation'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Sparkles className={`w-4 h-4 transition-colors ${activeSubTab === 'isolation' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className={isSubNavCompact ? 'hidden' : ''}>人声分离 (AI)</span>
          </button>
        </div>
        <button
          type="button"
          aria-label="拖拽调整音频工具导航宽度"
          onMouseDown={(event) => {
            event.preventDefault();
            subNavResizeStartRef.current = { width: subNavWidth, x: event.clientX };
            setIsResizingSubNav(true);
          }}
          className="absolute right-[-4px] top-0 z-30 hidden h-full w-2 cursor-col-resize bg-transparent transition-colors hover:bg-emerald-400/25 md:block"
        >
          <span className="sr-only">调整音频工具导航宽度</span>
        </button>
      </div>

      {/* Main Workspace Panel */}
      <div className={`flex-1 overflow-y-auto ${activeSubTab === 'workstation' ? 'p-4 md:p-6' : 'p-6 md:p-8'}`}>

      {/* ==========================================================
          SUB-TAB 0: AUDIO WORKSTATION
          ========================================================== */}
      {activeSubTab === 'workstation' && (
        <AudioWorkstation />
      )}

      {/* ==========================================================
          SUB-TAB 1: AUDIO ANALYZER
          ========================================================== */}
      {activeSubTab === 'analysis' && (
        <React.Suspense
          fallback={
            <div className="flex min-h-[360px] items-center justify-center rounded-3xl border border-slate-200 bg-white text-sm font-semibold text-slate-500 shadow-sm">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-600" />
              正在加载音频分析器…
            </div>
          }
        >
          <AudioAnalyzer />
        </React.Suspense>
      )}

      {/* ==========================================================
          SUB-TAB 2: BATCH RENAMER
          ========================================================== */}
      {activeSubTab === 'renamer' && (
        <div className="max-w-6xl mx-auto grid grid-cols-1 xl:grid-cols-5 gap-6">
          <div className="xl:col-span-3 space-y-5">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
              <div>
                <h3 className="text-sm font-bold text-slate-800">批量命名</h3>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  面向音效资产的批量重命名工具。支持查找替换、删除字符、前后缀、自动编号、命名模板和实时预览。
                </p>
              </div>

              <div
                onDragEnter={handleRenameDrag}
                onDragOver={handleRenameDrag}
                onDragLeave={handleRenameDrag}
                onDrop={handleRenameDrop}
                onClick={openRenameFilePicker}
                className={`border-2 border-dashed rounded-2xl p-7 flex flex-col items-center justify-center cursor-pointer transition-all ${
                  renameDragActive
                    ? 'border-emerald-500 bg-emerald-50/60 scale-[0.99]'
                    : renameFiles.length > 0
                    ? 'border-slate-250 bg-slate-50/20 hover:bg-slate-50/60'
                    : 'border-slate-200 hover:border-emerald-400 hover:bg-slate-50'
                }`}
              >
                <input
                  ref={renameInputRef}
                  type="file"
                  accept="audio/*"
                  multiple
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) handleRenameFilesChange(e.target.files);
                  }}
                  className="hidden"
                />
                <input
                  ref={bindRenameFolderInput}
                  type="file"
                  multiple
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) handleRenameFilesChange(e.target.files);
                  }}
                  className="hidden"
                />

                <div className="text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto text-emerald-600 shadow-sm">
                    <FileText className="w-6 h-6" />
                  </div>
                  {renameFiles.length > 0 ? (
                    <div>
                      <p className="text-xs font-bold text-slate-800">已载入 {renameFiles.length} 个音频文件</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        合计 {formatBytes(renameFiles.reduce((sum, file) => sum + file.size, 0))} · 输出文件夹 {getRenameOutputRootName()}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-bold text-slate-700">点击上传、多选音频，或拖入音频文件/文件夹</p>
                      <p className="text-[10px] text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
                        不覆盖原文件，导出时会生成包含新命名文件的 ZIP，并可导出命名前后对照 CSV。
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      className="text-[10px] text-slate-500 hover:text-emerald-700 font-bold border border-slate-200 px-3 py-1 rounded-lg bg-white shadow-sm cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        openRenameFilePicker();
                      }}
                    >
                      选择音频文件
                    </button>
                    <button
                      type="button"
                      className="text-[10px] text-slate-500 hover:text-emerald-700 font-bold border border-slate-200 px-3 py-1 rounded-lg bg-white shadow-sm cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        openRenameFolderPicker();
                      }}
                    >
                      选择文件夹
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-150 p-5 rounded-2xl space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <Sliders className="mt-0.5 w-4 h-4 text-emerald-600" />
                    <div>
                      <span className="text-xs font-bold text-slate-700">命名规则</span>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                        默认不添加规则，文件名只做基础清理；需要时再添加“删除文本”或“替换文本”。
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      commitRenameRules(() => DEFAULT_RENAME_RULES);
                      setRenameManualNames({});
                      setRenameStatus('已重置规则，右侧实时预览已恢复基础清理结果。');
                    }}
                    className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1 text-[10px] font-bold text-slate-500 hover:text-emerald-700"
                  >
                    重置规则
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => addRenameOperation('remove')}
                    className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[10px] font-black text-emerald-700 hover:border-emerald-200 hover:bg-emerald-100"
                  >
                    + 删除文本
                  </button>
                  <button
                    type="button"
                    onClick={() => addRenameOperation('replace')}
                    className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1.5 text-[10px] font-black text-sky-700 hover:border-sky-200 hover:bg-sky-100"
                  >
                    + 替换文本
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {[
                    { type: 'prefix' as const, label: '+ 前缀', className: 'border-indigo-100 bg-indigo-50 text-indigo-700 hover:border-indigo-200 hover:bg-indigo-100' },
                    { type: 'suffix' as const, label: '+ 后缀', className: 'border-violet-100 bg-violet-50 text-violet-700 hover:border-violet-200 hover:bg-violet-100' },
                    { type: 'number' as const, label: '+ 自动编号', className: 'border-amber-100 bg-amber-50 text-amber-700 hover:border-amber-200 hover:bg-amber-100' },
                    { type: 'case' as const, label: '+ 大小写', className: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100' },
                    { type: 'removeRange' as const, label: '+ 删除位置', className: 'border-rose-100 bg-rose-50 text-rose-700 hover:border-rose-200 hover:bg-rose-100' },
                    { type: 'regexReplace' as const, label: '+ 正则替换', className: 'border-cyan-100 bg-cyan-50 text-cyan-700 hover:border-cyan-200 hover:bg-cyan-100' },
                  ].map((option) => (
                    <button
                      key={option.type}
                      type="button"
                      onClick={() => addRenameOperation(option.type)}
                      className={`rounded-full border px-3 py-1.5 text-[10px] font-black ${option.className}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {renameRules.operations.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 text-center">
                    <p className="text-[11px] font-black text-slate-700">暂无命名规则</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                      上传文件后会保留原名，只清理空格、重复下划线和非法字符。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {renameRules.operations.map((operation, operationIndex) => (
                      <div
                        key={operation.id}
                        className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-50 border border-slate-200 text-[10px] font-black text-slate-500">
                              {operationIndex + 1}
                            </span>
                            <p className="truncate text-[11px] font-bold text-slate-700">
                              {getEnhancedRenameOperationLabel(operation)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeRenameOperation(operation.id)}
                            className="shrink-0 rounded-lg border border-rose-100 bg-white px-2.5 py-1.5 text-[10px] font-black text-rose-500 hover:border-rose-200 hover:bg-rose-50"
                          >
                            删除
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-[150px_1fr_1fr] gap-3">
                          <label className="space-y-1.5">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">规则类型</span>
                            <select
                              value={operation.type}
                              onChange={(e) => updateRenameOperation(operation.id, {
                                type: e.target.value as RenameRuleType,
                                replaceText: e.target.value === 'remove' ? '' : operation.replaceText,
                              })}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all font-semibold"
                            >
                              <option value="remove">删除文本</option>
                              <option value="replace">替换文本</option>
                              <option value="prefix">添加前缀</option>
                              <option value="suffix">添加后缀</option>
                              <option value="number">自动编号</option>
                              <option value="case">大小写转换</option>
                              <option value="removeRange">删除指定位置</option>
                              <option value="regexReplace">正则替换</option>
                            </select>
                          </label>

                          {operation.type === 'remove' || operation.type === 'replace' || operation.type === 'regexReplace' ? (
                            <label className="space-y-1.5">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                                {operation.type === 'regexReplace' ? '正则表达式' : '查找内容'}
                              </span>
                              <input
                                value={operation.findText}
                                onChange={(e) => updateRenameOperation(operation.id, { findText: e.target.value })}
                                placeholder={operation.type === 'regexReplace' ? '例如：\\s+|copy' : operation.type === 'remove' ? '要删除的文字/符号，例如：copy' : '要查找的文字/符号，例如：空格'}
                                className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all"
                              />
                            </label>
                          ) : (
                            <div className="hidden md:block" />
                          )}

                          {operation.type === 'replace' || operation.type === 'regexReplace' ? (
                            <label className="space-y-1.5">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">替换成</span>
                              <input
                                value={operation.replaceText}
                                onChange={(e) => updateRenameOperation(operation.id, { replaceText: e.target.value })}
                                placeholder={operation.type === 'regexReplace' ? '正则替换结果，例如：_' : '替换成，例如：_'}
                                className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all"
                              />
                            </label>
                          ) : (
                            <div className="hidden md:block" />
                          )}
                        </div>

                        {(operation.type === 'prefix' || operation.type === 'suffix') && (
                          <label className="block space-y-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              {operation.type === 'prefix' ? '前缀内容' : '后缀内容'}
                            </span>
                            <input
                              value={operation.insertText || ''}
                              onChange={(e) => updateRenameOperation(operation.id, { insertText: e.target.value })}
                              placeholder={operation.type === 'prefix' ? '例如：SFX_' : '例如：_v1'}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none transition-all focus:ring-1 focus:ring-emerald-500"
                            />
                          </label>
                        )}

                        {operation.type === 'number' && (
                          <div className="grid grid-cols-3 gap-3">
                            <label className="space-y-1.5">
                              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">起始编号</span>
                              <input
                                type="number"
                                value={operation.numberStart ?? 1}
                                onChange={(e) => updateRenameOperation(operation.id, { numberStart: Number(e.target.value) || 1 })}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none transition-all focus:ring-1 focus:ring-emerald-500"
                              />
                            </label>
                            <label className="space-y-1.5">
                              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">编号位数</span>
                              <input
                                type="number"
                                min={1}
                                max={8}
                                value={operation.numberPadding ?? 3}
                                onChange={(e) => updateRenameOperation(operation.id, { numberPadding: Number(e.target.value) || 3 })}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none transition-all focus:ring-1 focus:ring-emerald-500"
                              />
                            </label>
                            <label className="space-y-1.5">
                              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">分隔符</span>
                              <input
                                value={operation.numberSeparator ?? '_'}
                                onChange={(e) => updateRenameOperation(operation.id, { numberSeparator: e.target.value })}
                                placeholder="_"
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none transition-all focus:ring-1 focus:ring-emerald-500"
                              />
                            </label>
                          </div>
                        )}

                        {operation.type === 'case' && (
                          <label className="block space-y-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">大小写模式</span>
                            <select
                              value={operation.caseMode || 'lower'}
                              onChange={(e) => updateRenameOperation(operation.id, { caseMode: e.target.value as RenameCaseMode })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 outline-none transition-all focus:ring-1 focus:ring-emerald-500"
                            >
                              <option value="lower">全部小写</option>
                              <option value="upper">全部大写</option>
                              <option value="title">首字母大写</option>
                            </select>
                          </label>
                        )}

                        {operation.type === 'removeRange' && (
                          <div className="grid grid-cols-2 gap-3">
                            <label className="space-y-1.5">
                              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">从第几位开始</span>
                              <input
                                type="number"
                                min={1}
                                value={operation.rangeStart ?? 1}
                                onChange={(e) => updateRenameOperation(operation.id, { rangeStart: Number(e.target.value) || 1 })}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none transition-all focus:ring-1 focus:ring-emerald-500"
                              />
                            </label>
                            <label className="space-y-1.5">
                              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">删除几个字符</span>
                              <input
                                type="number"
                                min={1}
                                value={operation.rangeCount ?? 1}
                                onChange={(e) => updateRenameOperation(operation.id, { rangeCount: Number(e.target.value) || 1 })}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none transition-all focus:ring-1 focus:ring-emerald-500"
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    checked={renameRules.normalizeFileName}
                    onChange={(e) => commitRenameRules((prev) => ({ ...prev, normalizeFileName: e.target.checked }))}
                    className="accent-emerald-600"
                  />
                  自动清理空格、重复下划线和非法字符
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const changedCount = renamePreviewItems.filter((item) => item.status !== 'ready').length;
                      setRenameStatus(`已生成预览：${renamePreviewItems.length} 个文件，${changedCount} 个将改名。右侧可实时查看并手动覆盖单个文件名。`);
                    }}
                    disabled={renamePreviewItems.length === 0}
                    className="h-10 rounded-xl bg-emerald-600 text-[11px] font-black text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    生成预览
                  </button>
                  <button
                    type="button"
                    onClick={undoRenameRules}
                    disabled={renameRuleHistory.length === 0}
                    className="h-10 rounded-xl border border-slate-200 bg-white text-[11px] font-black text-slate-600 transition-colors hover:bg-slate-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    撤回规则
                  </button>
                </div>
              </div>

            </div>
          </div>

          <div className="xl:col-span-2 space-y-5">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4 sticky top-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">命名实时预览</h3>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    先预览，再导出。不会覆盖原文件。
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700 border border-emerald-100">
                  {renamePreviewItems.length} 个
                </span>
              </div>

              {renameStatus && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800">
                  {renameStatus}
                </div>
              )}
              {renameError && (
                <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                  {renameError}
                </div>
              )}

              <div className="max-h-[520px] overflow-y-auto pr-1 custom-scrollbar space-y-2">
                {renamePreviewItems.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                    <FileAudio className="w-8 h-8 mx-auto text-slate-300" />
                    <p className="mt-3 text-xs font-bold text-slate-500">还没有待命名的音频</p>
                    <p className="mt-1 text-[10px] text-slate-400">上传文件后这里会显示原文件名和新文件名。</p>
                  </div>
                ) : (
                  renamePreviewItems.map((item, index) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-[11px] text-slate-600"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-500">
                            {index + 1}. {item.sourceName}
                          </p>
                          <p className="mt-1 truncate font-black text-slate-900">{item.outputName}</p>
                          {item.outputRelativePath.includes('/') && (
                            <p className="mt-1 truncate font-mono text-[10px] text-slate-400">{item.outputRelativePath}</p>
                          )}
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ${
                          item.status === 'ready'
                            ? 'bg-slate-100 text-slate-500'
                            : item.status === 'duplicate-fixed'
                            ? 'bg-amber-50 text-amber-700 border border-amber-100'
                            : item.status === 'manual'
                            ? 'bg-sky-50 text-sky-700 border border-sky-100'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                        }`}>
                          {item.statusLabel}
                        </span>
                      </div>
                      <input
                        value={renameManualNames[item.id] || ''}
                        onChange={(e) => setRenameManualNames((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder="可选：手动覆盖这个文件的新文件名"
                        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-700 outline-none focus:border-emerald-500"
                      />
                    </div>
                  ))
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  disabled={renamePreviewItems.length === 0}
                  onClick={downloadRenameCsv}
                  className="h-10 rounded-xl border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:text-emerald-700 disabled:opacity-50 disabled:hover:text-slate-600"
                >
                  导出 CSV 对照
                </button>
                <button
                  type="button"
                  disabled={renamePreviewItems.length === 0 || renameExporting}
                  onClick={exportRenamedAudio}
                  className="h-10 rounded-xl bg-slate-900 text-[11px] font-black text-white shadow-lg hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {renameExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span>导出</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================
          SUB-TAB 3: MUSIC CONVERSION FACTORY
          ========================================================== */}
      {activeSubTab === 'factory' && (
        <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Form Options Side */}
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
              <div>
                <h3 className="text-sm font-bold text-slate-800">格式转换、压缩、音量标准化</h3>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  支持批量格式转换、音频压缩、采样率/比特率调整，并可统一目标响度。
                </p>
              </div>

              {/* Upload Dropzone */}
              <div
                onDragEnter={handleFactoryDrag}
                onDragOver={handleFactoryDrag}
                onDragLeave={handleFactoryDrag}
                onDrop={handleFactoryDrop}
                onClick={openFactoryFilePicker}
                className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all ${
                  factoryDragActive
                    ? 'border-emerald-500 bg-emerald-50/50 scale-[0.99]'
                    : factoryFile
                    ? 'border-slate-250 bg-slate-50/20 hover:bg-slate-50/60'
                    : 'border-slate-200 hover:border-emerald-400 hover:bg-slate-50'
                }`}
                style={{ minHeight: '180px' }}
              >
                <input
                  ref={factoryInputRef}
                  type="file"
                  accept="audio/*,video/*"
                  multiple
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFactoryFilesChange(e.target.files);
                    }
                  }}
                  className="hidden"
                />
                <input
                  ref={bindFactoryFolderInput}
                  type="file"
                  multiple
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFactoryFilesChange(e.target.files);
                    }
                  }}
                  className="hidden"
                />

                {factoryFile ? (
                  <div className="text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto text-emerald-600 shadow-sm animate-pulse">
                      {factoryFile.type.startsWith('video/') ? (
                        <FileVideo className="w-6 h-6" />
                      ) : (
                        <FileAudio className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 max-w-xs truncate mx-auto">{factoryFile.name}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        原始大小: {formatBytes(factoryFile.size)} · 格式: {factoryFile.type || '未知'}
                      </p>
                      {factoryFiles.length > 1 && (
                        <p className="text-[10px] text-emerald-700 font-bold mt-1">
                          已加入批量队列：{factoryFiles.length} 个文件 · 合计 {formatBytes(factoryFiles.reduce((sum, item) => sum + item.size, 0))}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        className="text-[10px] text-slate-500 hover:text-emerald-700 font-bold border border-slate-200 px-3 py-1 rounded-lg bg-white shadow-sm cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          openFactoryFilePicker();
                        }}
                      >
                        重新选择文件
                      </button>
                      <button
                        type="button"
                        className="text-[10px] text-slate-500 hover:text-emerald-700 font-bold border border-slate-200 px-3 py-1 rounded-lg bg-white shadow-sm cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          openFactoryFolderPicker();
                        }}
                      >
                        选择文件夹
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mx-auto text-slate-400">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-700">点击上传、批量多选，或将媒体文件/文件夹拖拽到此处</p>
                      <p className="text-[10px] text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                        支持多文件和文件夹批量转换，可转换为高保真 WAV 或高压缩 MP3 格式。
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-[10px] text-emerald-700 hover:text-emerald-800 font-bold border border-emerald-100 px-3 py-1 rounded-lg bg-white shadow-sm cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        openFactoryFolderPicker();
                      }}
                    >
                      选择文件夹批量上传
                    </button>
                  </div>
                )}
              </div>

              {/* Conversion Config */}
              <div className="bg-slate-50 border border-slate-150 p-5 rounded-2xl space-y-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <Settings className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-bold text-slate-700">格式转换高级属性设定</span>
                </div>

                <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-[10px] font-semibold text-emerald-800 flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>推荐压缩参数：<strong className="font-black">32kHz / 96kbps</strong>，适合人声批量压缩。</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* Format Selector */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">目标音频封装格式</label>
                    <select
                      value={factoryFormat}
                      onChange={(e) => {
                        const nextFormat = e.target.value as FactoryAudioFormat;
                        const option = FACTORY_FORMAT_OPTIONS.find(item => item.value === nextFormat);
                        if (!option?.supported) return;
                        setFactoryFormat(nextFormat);
                      }}
                      className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all font-semibold"
                    >
                      {FACTORY_FORMAT_OPTIONS.map(option => (
                        <option key={option.value} value={option.value} disabled={!option.supported}>
                          {option.label} - {option.supported ? option.description : `${option.description}（暂不可选）`}
                        </option>
                      ))}
                    </select>
                    <p className="text-[9px] text-slate-400 leading-relaxed">
                      当前：<span className="font-bold text-emerald-700">{selectedFactoryFormatOption.label}</span>
                      {' · '}
                      {selectedFactoryFormatOption.description}
                    </p>
                  </div>

                  {/* Sample Rate Selector */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">目标采样率 (Sample Rate)</label>
                    <select
                      value={factorySampleRate}
                      onChange={(e) => setFactorySampleRate(Number(e.target.value))}
                      className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all font-semibold"
                    >
                      <option value={8000}>8,000 Hz (电话窄带音质)</option>
                      <option value={16000}>16,000 Hz (常规配音/语音提取)</option>
                      <option value={32000}>32,000 Hz (高品质人声库标准)</option>
                      <option value={44100}>44,100 Hz (标准 CD 音乐级)</option>
                      <option value={48000}>48,000 Hz (专业影视/超高清)</option>
                    </select>
                  </div>

                  {/* Bitrate Selector (Only for MP3) */}
                  {factoryFormat === 'mp3' && (
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">目标压缩比特率 (Bitrate)</label>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 bg-slate-200/50 p-1 rounded-xl border border-slate-200/60">
                        {[64, 96, 128, 192, 256, 320].map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => setFactoryBitrate(rate)}
                            className={`py-1 rounded text-[10px] font-bold transition-all text-center ${
                              factoryBitrate === rate
                                ? 'bg-white text-emerald-700 shadow-sm border border-slate-250'
                                : 'text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            {rate} kbps
                          </button>
                        ))}
                      </div>
                      <p className="text-[9px] text-slate-400 italic">
                        96-128kbps 适合普通配音对话；192-320kbps 适合专业高保真歌曲伴奏。
                      </p>
                    </div>
                  )}

                  {/* Loudness Normalization */}
                  <div className="md:col-span-2 rounded-2xl border border-emerald-100 bg-white p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">目标响度统一 (LUFS)</label>
                        <p className="text-[10px] text-slate-400 mt-0.5">可用预设，也可自定义目标响度；转换时会自动做峰值保护。</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFactoryNormalizeEnabled((prev) => !prev)}
                        className={`rounded-full px-3 py-1.5 text-[10px] font-black transition-all ${
                          factoryNormalizeEnabled
                            ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {factoryNormalizeEnabled ? '已启用响度统一' : '启用响度统一'}
                      </button>
                    </div>

                    <div className={`grid grid-cols-2 lg:grid-cols-5 gap-2 transition-opacity ${factoryNormalizeEnabled ? 'opacity-100' : 'opacity-60'}`}>
                      {FACTORY_LOUDNESS_PRESETS.map((preset) => {
                        const isActive = factoryNormalizeEnabled && Math.abs(factoryTargetLufs - preset.value) < 0.01;
                        return (
                          <button
                            key={`${preset.group}-${preset.label}`}
                            type="button"
                            onClick={() => {
                              if (isActive) {
                                setFactoryNormalizeEnabled(false);
                              } else {
                                setFactoryNormalizeEnabled(true);
                                setFactoryTargetLufs(preset.value);
                              }
                            }}
                            className={`rounded-xl border px-2.5 py-2 text-left transition-all ${
                              isActive
                                ? 'border-emerald-400 bg-emerald-50 text-emerald-800 shadow-sm'
                                : 'border-slate-200 bg-slate-50/70 text-slate-600 hover:border-emerald-200 hover:bg-white'
                            }`}
                          >
                            <span className="block text-[10px] font-black leading-tight">{preset.label}</span>
                            <span className="mt-0.5 block text-[9px] font-semibold text-slate-400">{preset.hint}</span>
                          </button>
                        );
                      })}
                    </div>

                    <p className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] font-semibold text-slate-500">
                      {factoryNormalizeEnabled
                        ? '当前会按所选 LUFS 统一响度；再次点击已选中的预设，可切回“使用音频本身音量”。'
                        : '当前使用音频本身音量，不做响度统一。点击任意预设或自定义 LUFS 后再启用。'}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">自定义目标响度</label>
                        <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3">
                          <input
                            type="number"
                            min={-45}
                            max={-6}
                            step={0.5}
                            value={factoryTargetLufs}
                            onFocus={() => setFactoryNormalizeEnabled(true)}
                            onChange={(e) => {
                              const nextValue = Number(e.target.value);
                              if (Number.isFinite(nextValue)) {
                                setFactoryNormalizeEnabled(true);
                                setFactoryTargetLufs(nextValue);
                              }
                            }}
                            className="w-full bg-transparent py-2 text-xs font-bold text-slate-800 outline-none"
                          />
                          <span className="text-[10px] font-bold text-slate-400">LUFS</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">峰值上限保护</label>
                        <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3">
                          <input
                            type="number"
                            min={-6}
                            max={0}
                            step={0.1}
                            value={factoryPeakCeilingDb}
                            onFocus={() => setFactoryNormalizeEnabled(true)}
                            onChange={(e) => {
                              const nextValue = Number(e.target.value);
                              if (Number.isFinite(nextValue)) {
                                setFactoryNormalizeEnabled(true);
                                setFactoryPeakCeilingDb(nextValue);
                              }
                            }}
                            className="w-full bg-transparent py-2 text-xs font-bold text-slate-800 outline-none"
                          />
                          <span className="text-[10px] font-bold text-slate-400">dBFS</span>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] text-slate-500 leading-relaxed">
                        当前模式：<span className="font-black text-slate-800">{factoryNormalizeEnabled ? `${factoryTargetLufs.toFixed(1)} LUFS` : '使用原音量'}</span>
                        <br />
                        峰值不超过：<span className="font-black text-slate-800">{factoryPeakCeilingDb.toFixed(1)} dBFS</span>
                      </div>
                    </div>
                  </div>

                </div>

              </div>


              {/* Progress and status */}
              {factoryStatus && (
                <div className={`p-3.5 rounded-xl text-xs flex items-start gap-2 border ${
                  factoryError 
                    ? 'bg-rose-50 border-rose-100 text-rose-700' 
                    : 'bg-slate-50 border-slate-150 text-slate-700'
                }`}>
                  {factoryLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-600 shrink-0 mt-0.5" />
                  ) : factoryError ? (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <p className="font-semibold leading-relaxed">{factoryStatus}</p>
                    {factoryLoading && (
                      <div className="w-48 bg-slate-200 rounded-full h-1.5 overflow-hidden mt-1.5">
                        <div 
                          className="bg-emerald-600 h-1.5 rounded-full transition-all duration-300" 
                          style={{ width: `${factoryProgress}%` }}
                        ></div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Convert Button */}
              <button
                type="button"
                disabled={!factoryFile || factoryLoading}
                onClick={handleFactorySubmit}
                className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white disabled:text-slate-400 font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/15 disabled:shadow-none transition-all flex items-center justify-center gap-2 cursor-pointer border border-emerald-700/10"
              >
                {factoryLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>音频转换压制中 ({factoryProgress}%)...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>{factoryFiles.length > 1 ? `开始批量转换 (${factoryFiles.length})` : '开始音频转换'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Result Panel Side */}
          <div className="space-y-5">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
              <h3 className="text-sm font-bold text-slate-800">音频转换结果</h3>
              
              {factoryResults.length === 0 ? (
                <div className="py-8 text-center text-slate-400 space-y-2">
                  <FolderOpen className="w-8 h-8 mx-auto stroke-1" />
                  <p className="text-xs">等待转换文件</p>
                  <p className="text-[10px] text-slate-400">配置完左侧选项后，点击开始转换获取高保真音频结果。支持多文件和文件夹批量转换。</p>
                </div>
              ) : (
                <div className="space-y-5">
                  
                  {/* File Metadata */}
                  <div className="p-4 bg-emerald-50/40 border border-emerald-150/60 rounded-xl space-y-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="text-xs font-bold text-emerald-800">高质转码输出已就绪</span>
                    </div>

                    <div className="space-y-1.5 text-[11px] text-slate-600 border-t border-emerald-100/50 pt-2.5">
                      {factoryFile && factoryBlob && (
                        <div className="flex justify-between">
                          <span>输出文件大小</span>
                          <span className="font-bold text-slate-800">{formatBytes(factoryBlob.size)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-slate-100/50 pt-1.5">
                        <span>输出采样率</span>
                        <span className="font-bold text-slate-800">{(factorySampleRate / 1000).toFixed(3)} kHz</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-100/50 pt-1.5">
                        <span>封装格式</span>
                        <span className="font-bold text-slate-800 bg-emerald-50 border border-emerald-200 px-1 rounded uppercase scale-95">{factoryFormat}</span>
                      </div>
                      {factoryFormat === 'mp3' && (
                        <div className="flex justify-between border-t border-slate-100/50 pt-1.5">
                          <span>恒定比特率 (CBR)</span>
                          <span className="font-bold text-slate-800">{factoryBitrate} kbps</span>
                        </div>
                      )}
                      {factoryOriginalDuration && (
                        <div className="flex justify-between border-t border-slate-100/50 pt-1.5">
                          <span>媒体时长</span>
                          <span className="font-bold text-slate-800">{factoryOriginalDuration.toFixed(1)} 秒</span>
                        </div>
                      )}
                      {primaryFactoryResult?.loudness && (
                        <div className="grid grid-cols-2 gap-2 border-t border-slate-100/50 pt-2">
                          <div className="rounded-lg bg-white/70 px-2 py-1.5">
                            <span className="block text-[9px] text-slate-400">原始响度</span>
                            <span className="font-bold text-slate-800">{formatLufs(primaryFactoryResult.loudness.beforeLufs)}</span>
                          </div>
                          <div className="rounded-lg bg-white/70 px-2 py-1.5">
                            <span className="block text-[9px] text-slate-400">处理后 / 目标</span>
                            <span className="font-bold text-slate-800">
                              {formatLufs(primaryFactoryResult.loudness.afterLufs)} / {primaryFactoryResult.loudness.targetLufs.toFixed(1)}
                            </span>
                          </div>
                          <div className="rounded-lg bg-white/70 px-2 py-1.5">
                            <span className="block text-[9px] text-slate-400">实际增益</span>
                            <span className="font-bold text-slate-800">{formatSignedDb(primaryFactoryResult.loudness.appliedGainDb)}</span>
                          </div>
                          <div className="rounded-lg bg-white/70 px-2 py-1.5">
                            <span className="block text-[9px] text-slate-400">峰值上限</span>
                            <span className="font-bold text-slate-800">{primaryFactoryResult.loudness.peakCeilingDb.toFixed(1)} dBFS</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {factoryResults.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">批量转换队列</label>
                      </div>
                      <div className="max-h-64 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                        {factoryResults.map((item, index) => (
                          <div
                            key={item.id}
                            className={`rounded-xl border p-3 text-[11px] ${
                              item.error
                                ? 'border-rose-100 bg-rose-50 text-rose-700'
                                : 'border-emerald-100 bg-emerald-50/50 text-slate-700'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-bold text-slate-800">
                                  {index + 1}. {item.sourceName}
                                </p>
                                <p className="mt-0.5 text-[10px] text-slate-500">
                                  {formatBytes(item.sourceSize)}
                                  {item.duration ? ` · ${item.duration.toFixed(1)} 秒` : ''}
                                  {item.blob ? ` · 输出 ${formatBytes(item.blob.size)}` : ''}
                                </p>
                                {item.loudness && (
                                  <p className="mt-1 rounded-lg bg-white/70 px-2 py-1 text-[10px] font-semibold text-slate-600">
                                    响度 {formatLufs(item.loudness.beforeLufs)} → {formatLufs(item.loudness.afterLufs)}
                                    {' · '}
                                    目标 {item.loudness.targetLufs.toFixed(1)} LUFS
                                    {' · '}
                                    增益 {formatSignedDb(item.loudness.appliedGainDb)}
                                  </p>
                                )}
                                {item.error && <p className="mt-1 text-[10px] text-rose-600">{item.error}</p>}
                              </div>
                              {item.blob && (
                                <button
                                  type="button"
                                  onClick={() => downloadFile(item.blob!, item.sourceName, factoryFormat)}
                                  className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 hover:text-emerald-700"
                                >
                                  下载
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Audio Preview */}
                  {factoryAudioUrl && (
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">音质即时预览</label>
                      <audio
                        src={factoryAudioUrl}
                        controls
                        className="w-full h-8 accent-emerald-600 outline-none rounded-lg"
                      />
                    </div>
                  )}

                  {/* Download Button */}
                  {factoryBlob && factoryFile && (
                    <button
                      type="button"
                      onClick={() => {
                        if (factoryResults.length > 1) {
                          void downloadFactoryResults();
                        } else {
                          downloadFile(factoryBlob, factoryFile.name, factoryFormat);
                        }
                      }}
                      className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer border border-slate-800"
                    >
                      <Download className="w-4 h-4" />
                      <span>{factoryResults.length > 1 ? '打包 ZIP 下载全部结果' : `立即下载转换后音频 (${factoryFormat.toUpperCase()})`}</span>
                    </button>
                  )}

                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* ==========================================================
          SUB-TAB 3: VOCAL ISOLATION
          ========================================================== */}
      {activeSubTab === 'isolation' && (
        <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Form Options Side */}
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
              <div>
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-emerald-600 animate-pulse" />
                  <span>AI 人声提取与分离</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  使用 ElevenLabs 顶尖的 AI Audio Isolation（音频隔离）模型。一键剔除音频或视频中的各种嘈杂背景音、乐器声或杂音，提取出极度纯净、无损的高保真人声。
                </p>
              </div>

              {/* Upload Dropzone */}
              <div
                onDragEnter={handleIsolationDrag}
                onDragOver={handleIsolationDrag}
                onDragLeave={handleIsolationDrag}
                onDrop={handleIsolationDrop}
                onClick={() => isolationInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all ${
                  isolationDragActive
                    ? 'border-emerald-500 bg-emerald-50/50 scale-[0.99]'
                    : isolationFile
                    ? 'border-slate-250 bg-slate-50/20 hover:bg-slate-50/60'
                    : 'border-slate-200 hover:border-emerald-400 hover:bg-slate-50'
                }`}
                style={{ minHeight: '180px' }}
              >
                <input
                  ref={isolationInputRef}
                  type="file"
                  accept="audio/*,video/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleIsolationFileChange(e.target.files[0]);
                    }
                  }}
                  className="hidden"
                />

                {isolationFile ? (
                  <div className="text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto text-emerald-600 shadow-sm animate-pulse">
                      {isolationFile.type.startsWith('video/') ? (
                        <FileVideo className="w-6 h-6" />
                      ) : (
                        <FileAudio className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 max-w-xs truncate mx-auto">{isolationFile.name}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        原始大小: {formatBytes(isolationFile.size)} · 格式: {isolationFile.type || '未知'}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-[10px] text-slate-500 hover:text-emerald-700 font-bold border border-slate-200 px-3 py-1 rounded-lg bg-white shadow-sm cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        isolationInputRef.current?.click();
                      }}
                    >
                      重新选择文件
                    </button>
                  </div>
                ) : (
                  <div className="text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mx-auto text-slate-400">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-700">点击上传或将待分离的音频文件拖拽到此处</p>
                      <p className="text-[10px] text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                        支持 MP3, WAV, M4A, MP4 等常见音频和视频文件。
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Status or Progress Block */}
              {isolationStatus && (
                <div className={`p-4 rounded-xl text-xs flex items-start gap-2.5 border ${
                  isolationError 
                    ? 'bg-rose-50 border-rose-100 text-rose-700' 
                    : 'bg-emerald-50/50 border-emerald-100/60 text-slate-700'
                }`}>
                  {isolationLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-600 shrink-0 mt-0.5" />
                  ) : isolationError ? (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1.5 flex-1">
                    <p className="font-semibold leading-relaxed">{isolationStatus}</p>
                    {isolationLoading && (
                      <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden mt-1.5">
                        <div 
                          className="bg-emerald-600 h-1.5 rounded-full transition-all duration-300 animate-pulse" 
                          style={{ width: `${isolationProgress}%` }}
                        ></div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action Button */}
              <button
                type="button"
                disabled={!isolationFile || isolationLoading}
                onClick={handleIsolationSubmit}
                className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white disabled:text-slate-400 font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/15 disabled:shadow-none transition-all flex items-center justify-center gap-2 cursor-pointer border border-emerald-700/10"
              >
                {isolationLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>ElevenLabs 极速提取人声中 ({isolationProgress}%)...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>开始人声分离 / 消除噪音</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Result Panel Side */}
          <div className="space-y-5">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
              <h3 className="text-sm font-bold text-slate-800">分离音轨结果</h3>
              
              {!isolationAudioUrl ? (
                <div className="py-8 text-center text-slate-400 space-y-2">
                  <FolderOpen className="w-8 h-8 mx-auto stroke-1" />
                  <p className="text-xs">等待提取人声</p>
                  <p className="text-[10px] text-slate-400">在左侧上传带有杂音或背景音的音频/视频，点击开始提取以获取纯净的独立人声轨道。</p>
                </div>
              ) : (
                <div className="space-y-5 animate-fade-in">
                  
                  {/* File Metadata */}
                  <div className="p-4 bg-emerald-50/40 border border-emerald-150/60 rounded-xl space-y-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="text-xs font-bold text-emerald-800">纯净人声轨道已提取</span>
                    </div>

                    <div className="space-y-1.5 text-[11px] text-slate-600 border-t border-emerald-100/50 pt-2.5">
                      {isolationFile && isolationBlob && (
                        <>
                          <div className="flex justify-between">
                            <span>输入文件大小</span>
                            <span className="font-bold text-slate-700">{formatBytes(isolationFile.size)}</span>
                          </div>
                          <div className="flex justify-between border-t border-slate-100/50 pt-1.5">
                            <span>纯净输出大小</span>
                            <span className="font-bold text-slate-800">{formatBytes(isolationBlob.size)}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between border-t border-slate-100/50 pt-1.5">
                        <span>提取算法</span>
                        <span className="font-bold text-slate-800">ElevenLabs Audio Isolation v1</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-100/50 pt-1.5">
                        <span>音质状态</span>
                        <span className="font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 rounded scale-95 uppercase">Studio Quality</span>
                      </div>
                    </div>
                  </div>

                  {/* Audio Player */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">纯人声即时试听</label>
                    <audio 
                      src={isolationAudioUrl} 
                      controls 
                      className="w-full h-8 accent-emerald-600 outline-none rounded-lg"
                    />
                  </div>

                  {/* Download Button */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isolationBlob && isolationFile) {
                        downloadFile(isolationBlob, isolationFile.name, 'mp3');
                      }
                    }}
                    className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer border border-slate-800"
                  >
                    <Download className="w-4 h-4" />
                    <span>下载纯净人声音轨 (MP3)</span>
                  </button>

                </div>
              )}

            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
