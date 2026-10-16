/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef, useState } from 'react';
import { extractLocalAudioEvidence } from '../services/audioAnalysisClient';
import type { AudioMetricEvidence } from '../utils/audioEvidence';
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
import PointCostHint from './PointCostHint';

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
  audioMetrics?: AudioMetricEvidence;
  energy?: string;
  mood?: string;
  bassPercent?: number;
  midPercent?: number;
  highPercent?: number;
  rms?: number;
  categoryKey?: string;
  outputName?: string;
  manualOutputName?: string;
  error?: string;
}

const AUDIO_FILE_EXTENSION_REGEX = /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm|opus|aif|aiff|caf)$/i;

const STYLE_OPTIONS = [
  'Review',
  'Epic',
  'Battle',
  'Casual',
  'Healing',
  'Mystery',
  'Ambient',
  'Electronic',
  'Chinese',
  'Cinematic',
  'Orchestral',
  'Rock',
  'Piano',
  'LoFi',
  'SwingJazz',
  'GypsyJazz',
  'AcousticJazz',
  'AcousticLounge',
  'Jazz',
];
const SCENE_OPTIONS = [
  'Manual',
  'Battle',
  'Home',
  'Lobby',
  'Event',
  'Gift',
  'Puzzle',
  'Victory',
  'Suspense',
  'Explore',
  'Menu',
  'UI',
  'Cutscene',
  'Reward',
  'Store',
  'BoardGame',
  'Tabletop',
  'CasualLounge',
  'MiniGame',
];

const normalizeTagToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');

const STYLE_ALIASES: Record<string, string> = {
  swingjazz: 'SwingJazz',
  swing: 'SwingJazz',
  gypsyjazz: 'GypsyJazz',
  acousticjazz: 'AcousticJazz',
  acousticlounge: 'AcousticLounge',
  casuallounge: 'AcousticLounge',
  lounge: 'AcousticLounge',
  jazz: 'Jazz',
  boardgamejazz: 'SwingJazz',
  tabletopjazz: 'SwingJazz',
  chinese: 'Chinese',
  oriental: 'Chinese',
  guofeng: 'Chinese',
  cinematic: 'Cinematic',
  orchestral: 'Orchestral',
  ambient: 'Ambient',
  electronic: 'Electronic',
  piano: 'Piano',
  lofi: 'LoFi',
};

const SCENE_ALIASES: Record<string, string> = {
  boardgame: 'BoardGame',
  tabletop: 'Tabletop',
  tablegame: 'BoardGame',
  casualboardgame: 'BoardGame',
  casuallobby: 'Lobby',
  casuallounge: 'CasualLounge',
  lounge: 'CasualLounge',
  minigame: 'MiniGame',
  gameui: 'UI',
  ui: 'UI',
  lobby: 'Lobby',
  home: 'Home',
  menu: 'Menu',
  event: 'Event',
  gift: 'Gift',
  reward: 'Reward',
  victory: 'Victory',
  battle: 'Battle',
  suspense: 'Suspense',
  explore: 'Explore',
};

const normalizeStyleLabel = (value: string) => {
  if (STYLE_OPTIONS.includes(value)) return value;
  return STYLE_ALIASES[normalizeTagToken(value)] || '';
};

const normalizeSceneLabel = (value: string) => {
  if (SCENE_OPTIONS.includes(value)) return value;
  return SCENE_ALIASES[normalizeTagToken(value)] || '';
};

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
    .replace(/[,，、\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'Music'
);

const sanitizeOutputFileName = (value: string, fallbackExtension: string) => {
  const clean = value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  if (!clean) return '';
  return /\.[A-Za-z0-9]{2,5}$/.test(clean) ? clean : `${clean}.${fallbackExtension}`;
};

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

const analyzeMusicFile = async (file: File) => {
  const audioMetrics = await extractLocalAudioEvidence(file);
  const { metrics } = audioMetrics;
  return { duration: audioMetrics.sourceDuration, bpm: metrics.bpm.value,
    keyName: metrics.key.name, keyConfidence: metrics.key.confidence,
    bassPercent: metrics.audioProfile.bassPercent, midPercent: metrics.audioProfile.midPercent,
    highPercent: metrics.audioProfile.highPercent, rms: Math.pow(10, metrics.audioProfile.rmsDb / 20),
    audioMetrics };
};

type NamingResponseItem = { index: number; style: string; scene: string; mood: string;
  namingCategory: string; confidence: Confidence; reason: string; model?: string; error?: string };
const requestAudioSemanticMusicNaming = async (items: MusicNamingItem[]) => {
  const output: NamingResponseItem[] = [];
  let model: string | undefined;
  for (let offset = 0; offset < items.length; offset += 10) {
    const batch = items.slice(offset, offset + 10);
    try {
      const response = await fetch('/api/ai/music-analysis-naming', {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({ items: batch.map(item => ({ sourceName: item.sourcePath || item.file.name, audioMetrics: item.audioMetrics })) }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || `GPT 命名分析失败（${response.status}）。`);
      if (!Array.isArray(payload?.items) || payload.items.length !== batch.length
        || new Set(payload.items.map((item: NamingResponseItem) => item.index)).size !== batch.length
        || payload.items.some((item: NamingResponseItem) => !Number.isInteger(item.index) || item.index < 0 || item.index >= batch.length)) {
        throw new Error('GPT 命名结果不完整，请重试。');
      }
      model = payload.model;
      output.push(...payload.items.map((item: NamingResponseItem) => ({ ...item, index: offset + item.index, model: payload.model })));
    } catch (error: any) {
      output.push(...batch.map((_, index) => ({ index: offset + index, style: 'Review', scene: 'Manual', mood: '不确定',
        namingCategory: 'Review_Manual', confidence: '低' as const, reason: '',
        error: error?.name === 'TimeoutError' ? 'GPT 命名分析超时，请重试。' : error?.message || 'GPT 命名分析失败。' })));
    }
  }
  return { model, items: output };
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
  const [startCode, setStartCode] = useState('001');
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

  const clearGeneratedNaming = (item: MusicNamingItem): MusicNamingItem => ({
    ...item,
    style: undefined,
    scene: undefined,
    styleConfidence: undefined,
    sceneConfidence: undefined,
    styleCandidates: undefined,
    sceneCandidates: undefined,
    semanticReason: undefined,
    semanticModel: undefined,
    categoryKey: undefined,
    outputName: undefined,
  });

  const buildOutputNames = (sourceItems: MusicNamingItem[]) => {
    const counters = new Map<string, number>();
    const cleanStartCode = startCode.replace(/\D/g, '') || '001';
    const numberStart = Math.max(1, Number(cleanStartCode) || 1);
    const numberPadding = Math.min(6, Math.max(1, cleanStartCode.length));
    return sourceItems.map((item) => {
      if (item.status !== 'done') {
        return {
          ...item,
          categoryKey: undefined,
          outputName: undefined,
        };
      }
      const style = sanitizeFileNamePart(item.style || 'Music');
      const scene = sanitizeFileNamePart(item.scene || 'Scene');
      const key = sanitizeFileNamePart((item.keyName || 'UnknownKey').replace(/\s+/g, ''));
      const bpm = Math.round(item.bpm || 0);
      const categoryKey = `${style}_${scene}`;
      const nextNumber = counters.get(categoryKey) ?? numberStart;
      counters.set(categoryKey, nextNumber + 1);
      const prefix = String(nextNumber).padStart(numberPadding, '0');
      const automaticOutputName = `${prefix}${numberSeparator}${style}_${scene}_${key}_${bpm}BPM.${getExtension(item.file.name)}`;
      const manualOutputName = sanitizeOutputFileName(item.manualOutputName || '', getExtension(item.file.name));
      return {
        ...item,
        categoryKey,
        outputName: manualOutputName || automaticOutputName,
      };
    });
  };

  const previewItems = useMemo(() => buildOutputNames(items), [items, numberSeparator, startCode]);
  const doneCount = previewItems.filter(item => item.status === 'done').length;

  const analyzeAll = async () => {
    if (items.length === 0 || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setStatus(`正在分析 1/${items.length}...`);
    let nextItems = items.map(item => ({
      ...clearGeneratedNaming(item),
      status: 'pending' as const,
      progress: 0,
      error: undefined,
    }));
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
          status: 'analyzing',
          progress: 70,
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
    const locallyAnalyzedItems = nextItems.filter(item => item.status === 'analyzing' && item.audioMetrics);
    if (locallyAnalyzedItems.length > 0) {
      try {
        setStatus('本地参数检测完成，正在请求 GPT 解读并生成待审核命名...');
        const semanticResult = await requestAudioSemanticMusicNaming(locallyAnalyzedItems);
        const semanticByOriginalIndex = new Map<number, NonNullable<typeof semanticResult.items>[number]>();
        (semanticResult.items || []).forEach(item => semanticByOriginalIndex.set(item.index, item));
        let doneIndex = 0;
        nextItems = nextItems.map((item) => {
          if (item.status !== 'analyzing' || !item.audioMetrics) return item;
          const semantic = semanticByOriginalIndex.get(doneIndex);
          doneIndex += 1;
          if (!semantic || semantic.error) {
            return {
              ...item,
              status: 'error',
              progress: 0,
              error: semantic?.error || 'GPT 未返回该音乐的命名建议。',
            };
          }
          const normalizedStyle = normalizeStyleLabel(semantic.style);
          const normalizedScene = normalizeSceneLabel(semantic.scene);
          const categoryParts = String(semantic.namingCategory || '')
            .split(/[_\s/-]+/)
            .filter(Boolean);
          const categoryStyle = normalizedStyle || normalizeStyleLabel(categoryParts[0] || '');
          const categoryScene = normalizedScene || normalizeSceneLabel(categoryParts.slice(1).join(' ') || categoryParts[1] || '');
          return {
            ...item,
            status: 'done',
            progress: 100,
            style: categoryStyle || 'Review',
            scene: categoryScene || 'Manual',
            mood: semantic.mood || item.mood,
            styleConfidence: semantic.confidence,
            sceneConfidence: semantic.confidence,
            styleCandidates: [semantic.style, categoryStyle].filter(Boolean),
            sceneCandidates: [semantic.scene, categoryScene].filter(Boolean),
            semanticReason: semantic.reason,
            semanticModel: semantic.model || semanticResult.model,
          };
        });
        setItems(buildOutputNames(nextItems));
        const semanticDoneCount = nextItems.filter(item => item.status === 'done').length;
        const failedCount = nextItems.filter(item => item.status === 'error').length;
        setStatus(`GPT 指标解读完成：${semanticDoneCount}/${nextItems.length} 个文件已生成命名建议；未直接听音。${failedCount ? ` ${failedCount} 个失败，可重新分析。` : ''}`);
      } catch (reason: any) {
        nextItems = nextItems.map(item => item.status === 'analyzing' ? {
          ...item,
          status: 'error',
          progress: 0,
          error: reason?.message || 'API 风格/场景分析失败。',
        } : item);
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
      ['原始路径', '新文件名', 'BPM', '调式', '风格建议', '场景建议', '能量', '情绪建议', '状态', '分析方式', '已检测秒数', '命名依据'],
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
        item.audioMetrics ? '本地指标 + GPT解读（未直接听音）' : '',
        item.audioMetrics ? String(item.audioMetrics.analyzedSeconds) : '',
        item.semanticReason || '',
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
              上传音乐后，本地检测 BPM、调式与频谱（最长前 5 分钟），再由 GPT 结合指标和文件名线索给出命名建议，未直接听音。缺少风格或场景证据时标记 Review / Manual，分类可手动修改。相同类别按序编号，默认从 001 开始。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-100 bg-slate-50 p-2 text-[10px] font-bold text-slate-500">
            <label className="space-y-1">
              <span>起始编号</span>
              <input
                inputMode="numeric"
                value={startCode}
                onChange={(event) => {
                  const nextCode = event.target.value.replace(/\D/g, '').slice(0, 6);
                  setStartCode(nextCode || '001');
                }}
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
            {error && <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-rose-600"><AlertCircle className="h-3.5 w-3.5" />{error}</p>}
            {status && <p role="status" className="mt-1 text-[11px] leading-relaxed text-slate-500">{status}</p>}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col items-end gap-1.5">
              <button
                type="button"
                disabled={items.length === 0 || analyzing}
                onClick={analyzeAll}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {analyzing ? '分析中...' : '开始分析并命名'}
              </button>
              <PointCostHint kind="token" />
            </div>
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
              AI 会先给建议；风格、场景和新文件名都可以手动改。风格/场景支持填写多个标签，用逗号或空格分隔。
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
          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <datalist id="music-style-suggestions">
              {STYLE_OPTIONS.map(option => <option key={option} value={option} />)}
            </datalist>
            <datalist id="music-scene-suggestions">
              {SCENE_OPTIONS.map(option => <option key={option} value={option} />)}
            </datalist>
            <div className="grid min-w-[820px] grid-cols-[minmax(190px,1fr)_82px_82px_120px_120px_180px] gap-3 bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-wide text-slate-400">
              <span className="pl-6">原文件</span>
              <span>BPM / 调式</span>
              <span>能量情绪</span>
              <span className="px-2">风格</span>
              <span className="px-2">场景</span>
              <span className="px-3">新文件名</span>
            </div>
            <div className="divide-y divide-slate-100">
              {previewItems.map((item) => (
                <div key={item.id} className="grid min-w-[820px] grid-cols-[minmax(190px,1fr)_82px_82px_120px_120px_180px] gap-3 px-4 py-3 text-xs">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileAudio className="h-4 w-4 shrink-0 text-emerald-600" />
                      <p className="truncate font-bold text-slate-800" title={item.sourcePath}>{item.file.name}</p>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">{formatBytes(item.file.size)}{item.duration ? ` · ${formatDuration(item.duration)}` : ''}</p>
                    {item.audioMetrics && <p className="mt-1 text-[10px] text-slate-400">已检测前 {formatDuration(item.audioMetrics.analyzedSeconds)}</p>}
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
                    {item.status === 'done' ? (
                      <>
                        <p className="font-bold">{item.energy || '-'}</p>
                        <p className="text-[10px] text-slate-400">{item.mood || '-'}</p>
                      </>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </div>
                  <input
                    value={item.status === 'done' ? (item.style || '') : ''}
                    disabled={item.status !== 'done'}
                    onChange={(event) => updateItem(item.id, { style: event.target.value })}
                    list="music-style-suggestions"
                    placeholder={item.status === 'done' ? '可填多个风格' : ''}
                    className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400 disabled:bg-slate-50 disabled:text-slate-300"
                  />
                  <input
                    value={item.status === 'done' ? (item.scene || '') : ''}
                    disabled={item.status !== 'done'}
                    onChange={(event) => updateItem(item.id, { scene: event.target.value })}
                    list="music-scene-suggestions"
                    placeholder={item.status === 'done' ? '可填多个场景' : ''}
                    className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400 disabled:bg-slate-50 disabled:text-slate-300"
                  />
                  <div className="min-w-0">
                    {item.status === 'done' && (
                      <p className="mb-1 truncate px-3 text-[10px] font-bold text-slate-400" title={`风格候选：${item.styleCandidates?.join(' / ') || '-'}；场景候选：${item.sceneCandidates?.join(' / ') || '-'}`}>
                        风格{item.styleConfidence}置信 · 场景{item.sceneConfidence}置信
                      </p>
                    )}
                    <input
                      value={item.status === 'done' ? (item.manualOutputName ?? item.outputName ?? '') : ''}
                      disabled={item.status !== 'done'}
                      onChange={(event) => updateItem(item.id, { manualOutputName: event.target.value })}
                      placeholder={item.status === 'done' ? '分析后生成，可手动修改' : ''}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] font-bold text-slate-700 outline-none focus:border-emerald-400 focus:bg-white disabled:text-slate-400"
                      title={item.outputName}
                    />
                    {item.manualOutputName && (
                      <button
                        type="button"
                        onClick={() => updateItem(item.id, { manualOutputName: '' })}
                        className="mt-1 text-[10px] font-bold text-slate-400 hover:text-emerald-700"
                      >
                        恢复自动命名
                      </button>
                    )}
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
