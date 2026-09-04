/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  Copy, 
  Download, 
  RefreshCw, 
  ChevronRight, 
  Loader2, 
  X, 
  Volume2, 
  Music, 
  AlertCircle,
  Gamepad2,
  Clapperboard,
  Sliders,
  Sparkles,
  DownloadCloud,
  Clock,
  Sun
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { FileItem } from '../types';
import { AudioDesignResult } from '../services/geminiService';
import { generateSoundEffect, generateMusic } from '../services/elevenLabsService';

// Self-contained ElevenLabs Player for Demo Sound Effects inside table
const ElevenLabsPlayer = ({
  text,
  id,
  type = 'sfx',
  onSendToMusicStudio,
}: {
  text: string;
  id: string;
  type?: 'sfx' | 'music';
  onSendToMusicStudio?: (prompt: string) => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const extractDuration = (input: string) => {
    const match = input.match(/\[Duration:\s*(\d+)s\]/i);
    return match ? parseInt(match[1]) : (type === 'music' ? 30 : 5);
  };

  const handleGenerate = async () => {
    if (type === 'music' && onSendToMusicStudio) {
      onSendToMusicStudio(text.trim());
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const duration = extractDuration(text);
      const blob = type === 'music' 
        ? await generateMusic(text, duration)
        : await generateSoundEffect(text, duration);

      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      
      // Auto play
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.play();
        }
      }, 100);
    } catch (err: any) {
      setError(err.message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  if (type === 'music' && onSendToMusicStudio) {
    return (
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => onSendToMusicStudio(text.trim())}
        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-[10px] flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Music className="w-3 h-3" />
        <span>生成音乐</span>
        <ChevronRight className="w-3 h-3" />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 mt-1">
      <div className="flex items-center gap-2">
        {!audioUrl ? (
          <button
            onClick={handleGenerate}
            disabled={loading}
            className={`flex items-center gap-1 text-[10px] font-semibold text-white ${
              type === 'music' 
                ? 'bg-indigo-600 hover:bg-indigo-700' 
                : 'bg-emerald-600 hover:bg-emerald-700'
            } px-2.5 py-1 rounded-lg transition-all disabled:opacity-50`}
          >
            {loading ? (
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <Volume2 className="w-2.5 h-2.5" />
            )}
            {loading ? '生成中...' : (type === 'music' ? '生成音乐' : '声效试听')}
          </button>
        ) : (
          <div className="flex items-center gap-2 bg-[#12141D] border border-gray-800 px-2 py-0.5 rounded-lg">
            <audio 
              ref={audioRef} 
              src={audioUrl} 
              controls 
              className="h-6 w-32 custom-audio-player-mini" 
            />
            <a
              href={audioUrl}
              download={`${type}_demo_${id}.mp3`}
              className="p-1 text-gray-400 hover:text-emerald-400 transition-colors flex items-center justify-center"
              title="下载"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
            <button
              onClick={() => {
                URL.revokeObjectURL(audioUrl);
                setAudioUrl(null);
              }}
              className="p-1 text-gray-400 hover:text-red-400 transition-colors"
              title="清除"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {error && <span className="text-[9px] text-red-400 max-w-[120px] truncate" title={error}>{error}</span>}
      </div>
    </div>
  );
};

// High-fidelity film & TV commercial audio design demo data
const filmDemoResult: AudioDesignResult = {
  sfxAnalysis: {
    summary: "针对该部影视广告创意片的视觉特征，音频设计主打「写实微观细节」与「宏大史诗乐段」的强烈视听反差。画幅始于一片空旷寂静的森林，露水低垂，随着神秘主角推门登场，镜头切换为特写，此时音效重点表现木门干涩扭曲的轴承声和踩在潮湿落叶上的动作触感。随后的魔法蓄力过程，音效采用高频粒子合成与低音次声波层叠，最终以清脆的定格余韵收尾，为后续情绪张力留足空间。",
    keyElements: ["微观写实Foley", "影视级时码对齐", "魔法粒子合成音效", "史诗级情绪起伏"],
    pacing: "前慢后快，起伏剧烈，在20秒处达到视听感官高潮"
  },
  musicAnalysis: {
    mood: "寂静神圣 -> 悬疑渐进 -> 史诗爆发 -> 延音余韵",
    rhythm: "慢速自由（Rubato）到中速进行曲风，速度约 72-118 BPM",
    suggestedInstruments: ["立式钢琴", "爱尔兰竖琴", "管弦乐交响合唱团", "空灵女声吟唱", "低频大鼓"],
    emotionalCurve: "0-5s 宁静神秘；5-12s 悬念递增；12-20s 气势磅礴；20-24s 戛然而止留下无尽回味。"
  },
  sfxSchemes: [
    {
      title: "「影视/广告」时码高精度音效 Foley 制作排程表",
      items: [
        {
          name: "sfx_foley_forest_amb_loop_01",
          description: "极细微的清晨森林底噪，夹杂微弱的风声与昆虫羽翼振动。频段控制在中低频，避免喧宾夺主。[Duration: 5s]",
          scene: "00:00.000 - 00:05.000 (全景镜头：清晨微光的原始森林，树叶挂着露珠，雾气弥漫)",
          logic: "采样合成：使用真实森林环境录音进行高通滤波，叠加上升的合成空腔垫音（ambient pad）。"
        },
        {
          name: "sfx_foley_footstep_leaf_wet_01",
          description: "主角轻踏湿润碎石与落叶的脚步声。要求听出皮靴皮革的挤压感与水分踩出时的微弱黏滞声。[Duration: 3s]",
          scene: "00:01.200 - 00:02.800 (中景：一双皮靴迈入画面，踏在林间潮湿的落叶堆上，共有两步脚步触点)",
          logic: "实物拟音：在录音棚模拟湿润树叶与碎石路面，使用中密度皮革靴踩踏，多通道电容话筒近距离拾音。"
        },
        {
          name: "sfx_foley_door_creak_dry_02",
          description: "古老厚重木门被缓缓推开时，铰链干涩扭曲摩擦出的刺耳高频响动。0.8s处叠加一声沉闷的撞墙声。[Duration: 4s]",
          scene: "00:03.100 - 00:05.000 (特写：主角伸出戴着皮手套的手推开神秘木门，铰链随之缓慢变形)",
          logic: "多轨叠加：真实生锈铁铰链摩擦声叠加油脂干涸的旧衣柜轴承声，并在末端叠加皮革手套挤压与木板撞击声。"
        },
        {
          name: "sfx_magic_laser_charge_01",
          description: "魔法符文蓄力的粒子合成音。高频的空灵啸叫随着低音次声波在后半程急剧隆隆爬升。[Duration: 5s]",
          scene: "00:12.500 - 00:15.800 (特写至全景：主角手中法杖符文点亮，周围空气因能量聚集而扭曲颤动)",
          logic: "FM调频合成器：使用低频正弦波做LFO调制主载波频率，叠加粉红噪声并用自动化滤波截止频率向上扫频（filter sweep）。"
        },
        {
          name: "sfx_cinematic_riser_sub_03",
          description: "影院级次低频上升音效（Sub Riser），在接近20秒高潮画面瞬间达到能量顶点，随后立即切断，留下巨大反差。[Duration: 5s]",
          scene: "00:15.500 - 00:20.000 (中景至特写：法杖聚能达到最刺眼状态，主角向前挥动法杖，画面在定格瞬间进入爆破高潮)",
          logic: "物理合成：使用低音波形通过包络控制音量与基频同步上升，并在19.8s加入一声清脆的金属定音编钟作为收尾撞击（climax hit）。"
        }
      ]
    }
  ],
  bgmRecommendations: [
    {
      style: "新古典奇幻史诗交响乐 (Neo-Classical Epic Fantasy Orchestral)",
      instrumentation: "独奏钢琴, 凯尔特竖琴, 史诗弦乐群, 圣洁女声合唱团, 大号与圆号群, 影视大鼓",
      sunoPrompt: {
        chinese: "新古典史诗奇幻管弦配乐；完整连贯的歌曲；核心乐器：独奏钢琴、凯尔特竖琴、史诗弦乐、圆号、影视大鼓；105 BPM；D minor；空灵女声与圣洁合唱。",
        english: "Neo-classical epic fantasy orchestral; cohesive full-length song; featuring solo piano, Celtic harp, cinematic strings, French horns, taiko; 105 BPM; D minor; ethereal female vocals and sacred choir.",
        bpm: "105",
        key: "D minor",
        structure: "Intro (0-5s) -> Build-up (5-12s) -> Climax Verse (12-20s) -> Reverb Outro (20-24s)",
        dynamics: "由极弱（pp）随着管弦和合唱的加入逐级渐强，最终在高潮处达到极强（ff），并在最后一秒切音收尾"
      },
      timelineDesign: [
        {
          timecode: "00:00 - 00:05",
          instruments: "独奏钢琴 + 凯尔特竖琴 + 环境音铺垫 (Pad)",
          emotion: "营造神圣世界初现、寂静与神秘空灵的氛围",
          description: "高音区清脆的钢琴单音缓缓落下，配合竖琴的琶音流动，烘托出古老森林与斑驳雾气的开阔画面，为全片定下高雅艺术基调。"
        },
        {
          timecode: "00:05 - 00:12",
          instruments: "中提琴/大提琴渐进 + 空灵女声吟唱 + 柔和圆号",
          emotion: "凸显神秘主角登场，悬念与期待感缓缓拉升",
          description: "低沉的弦乐组以长音垫底进入，空灵悠扬的女高音开始单字吟唱，圆号在远方响起。音量呈线性渐强（Crescendo），画面配合主角特写推门。"
        },
        {
          timecode: "00:12 - 00:20",
          instruments: "管弦乐全奏 + 交响合唱团 + 史诗打击乐 (Taiko)",
          emotion: "情绪持续高歌猛进，能量积聚并达到华丽爆破高潮",
          description: "大鼓和编钟加入，合唱团爆发出宏大的拉丁语和声。小提琴快速的三连音律动将张力拉满，铜管群全力托起，完美同步手中法杖点亮的视觉爆点。"
        },
        {
          timecode: "00:20 - 00:24",
          instruments: "高潮切音 (Climax Break) + 巨幅大厅混响余韵 (Reverb Tail)",
          emotion: "双人并肩定格画面，留下意味深长的神圣余韵",
          description: "在20秒爆点瞬间，所有声学轨道瞬间休止，只留下长达4秒的超大空间高频衰减混响尾音，配合画面定格渐暗，为观众带来空灵、余音绕梁的视听结尾。"
        }
      ]
    },
    {
      style: "神秘北欧民谣融合现代电子声景 (Nordic Ambient Folk & Cyber Soundscape)",
      instrumentation: "尼古赫帕琴 (Nyckelharpa), 尼泊尔竹笛, 重低音合成器 (Sub-bass), 模拟脉冲敲击, 迷幻合唱",
      sunoPrompt: {
        chinese: "北欧极简民谣融合赛博电子声景；完整连贯的歌曲；核心乐器：尼古赫帕琴、竹笛、重低音合成器、模拟脉冲、电子鼓；80 BPM；A minor；冷峻克制的吟唱。",
        english: "Nordic minimal folk with cyber soundscape; cohesive full-length song; featuring Nyckelharpa, bamboo flute, sub-bass synth, analog pulses, electronic drums; 80 BPM; A minor; restrained cold vocal chanting.",
        bpm: "80",
        key: "A minor",
        structure: "Intro (0-5s) -> Cyber Rise (5-12s) -> Heavy Beat (12-20s) -> Silence Tail (20-24s)",
        dynamics: "极简纯声学器乐，随着失真重低音的介入变得异常冷峻饱满，高潮乐段节拍坚硬，最终戛然而止"
      },
      timelineDesign: [
        {
          timecode: "00:00 - 00:05",
          instruments: "尼泊尔竹笛 + 极简环境底噪 (Drone)",
          emotion: "冷峻极简，透露着北欧苔原般的苍凉感",
          description: "飘逸、带有微弱气流声的竹笛吹出下行音阶，背景是冰冷空旷的低频持续音，配合雾气弥漫的画面，传达极简冷调美学。"
        },
        {
          timecode: "00:05 - 00:12",
          instruments: "尼古赫帕琴 (拉弦琴) + 赛博重低音 (Sub-bass)",
          emotion: "冷酷而富有张力，科技与原始碰撞的诡谲感",
          description: "尼古赫帕琴沙哑个性的拉弦质感进入，深沉的模拟合成器超低频（sub-bass）暗中涌动，配合主角推门时显露出的机械义肢特写。"
        },
        {
          timecode: "00:12 - 00:20",
          instruments: "金属脉冲敲击 + 电子节拍 (Glitch Beat) + 迷幻人声",
          emotion: "工业与科技律动爆发，画面节奏显著加快，进入战斗蓄力",
          description: "坚硬、冰冷的电子节拍与切片人声哼唱同步砸下，声音包络极具弹性，低音下潜极深，音场拓宽到极致，与画面法杖高亮聚能完美契合。"
        },
        {
          timecode: "00:20 - 00:24",
          instruments: "高潮戛然而止 + 模拟延时回声 (Delay Tail)",
          emotion: "戛然而止，画面定格渐入黑暗，悬念重重",
          description: "高潮部分的电子鼓点瞬间收断，只留下拉弦琴和女声的延时回声（Ping-pong delay）在左右声道交替弱化消散，视觉定格双人特写。"
        }
      ]
    }
  ]
};

interface AudioDirectorProps {
  files: FileItem[];
  setFiles: React.Dispatch<React.SetStateAction<FileItem[]>>;
  requirements: string;
  setRequirements: (req: string) => void;
  target: { game: boolean; video: boolean; avatar?: boolean; sunnyIsland?: boolean };
  setTarget: React.Dispatch<React.SetStateAction<{ game: boolean; video: boolean; avatar?: boolean; sunnyIsland?: boolean }>>;
  loading: boolean;
  analysisStage: string;
  error: string | null;
  setError: (err: string | null) => void;
  result: AudioDesignResult | null;
  onGenerate: () => void;
  onCancel: () => void;
  copyToClipboard: (text: string, id?: string) => void;
  copyTableToClipboard: (scheme: any, id: string) => void;
  downloadTableAsCSV: (scheme: any) => void;
  copiedId: string | null;
  isUploading: boolean;
  setIsUploading: (val: boolean) => void;
  isInstrumental: boolean;
  setIsInstrumental: (val: boolean) => void;
  activeTab: 'sfx' | 'bgm';
  setActiveTab: (tab: 'sfx' | 'bgm') => void;
  selectedLyrics: { sectionIndex: number; text: string } | null;
  setSelectedLyrics: (lyrics: { sectionIndex: number; text: string } | null) => void;
  lyricEditDirection: string;
  setLyricEditDirection: (dir: string) => void;
  editingLyrics: boolean;
  handleRegenerateLyrics: () => void;
  onLoadDemo?: (demo: AudioDesignResult) => void;
  onSendMusicPrompt?: (prompt: string) => void;
}

export default function AudioDirector({
  files,
  setFiles,
  requirements,
  setRequirements,
  target,
  setTarget,
  loading,
  analysisStage,
  error,
  setError,
  result,
  onGenerate,
  onCancel,
  copyToClipboard,
  copyTableToClipboard,
  downloadTableAsCSV,
  copiedId,
  isUploading,
  setIsUploading,
  isInstrumental,
  setIsInstrumental,
  activeTab,
  setActiveTab,
  selectedLyrics,
  setSelectedLyrics,
  lyricEditDirection,
  setLyricEditDirection,
  editingLyrics,
  handleRegenerateLyrics,
  onLoadDemo,
  onSendMusicPrompt,
}: AudioDirectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const isProfessionalTarget = Boolean(target.video || target.avatar);
  const isGameTrack = target.game && !target.video && !target.avatar && !target.sunnyIsland;
  const videoFileCount = files.filter(item => item.type.startsWith('video/')).length;
  const isProfessionalVideoReady = isProfessionalTarget && videoFileCount === 1 && files.length === 1;
  const hasInvalidProfessionalSelection = isProfessionalTarget
    && videoFileCount > 0
    && (videoFileCount !== 1 || files.length !== 1);
  const usesProfessionalFallback = isProfessionalTarget && videoFileCount === 0;

  const processFiles = async (selectedFiles: FileList | File[] | null, source: 'upload' | 'paste' = 'upload') => {
    if (selectedFiles && selectedFiles.length > 0) {
      const filesToProcess = Array.from(selectedFiles);
      const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
      const MAX_DIRECT_SIZE = 20 * 1024 * 1024;
      const oversizedFiles = filesToProcess.filter((file) => (
        file.type.startsWith('video/')
          ? file.size > MAX_VIDEO_SIZE
          : file.size > MAX_DIRECT_SIZE
      ));
      
      if (oversizedFiles.length > 0) {
        setError(`文件过大：视频上限 100MB，图片、音频和 PDF 上限 20MB。请处理：${oversizedFiles.map(f => f.name).join(', ')}`);
        return;
      }

      setIsUploading(true);
      setError(null);
      setPasteMessage(source === 'paste' ? '已从剪贴板导入截图，可直接开始分析。' : null);

      const newFiles = filesToProcess.map((file: File) => ({
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `file-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        file,
        preview: URL.createObjectURL(file),
        type: file.type
      }));
      setFiles(prev => [...prev, ...newFiles]);
      setIsUploading(false);
      
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
  };

  const getClipboardImageFile = (clipboardData: DataTransfer | null): File | null => {
    if (!clipboardData) return null;
    const imageItem = Array.from(clipboardData.items || [])
      .find(item => item.kind === 'file' && item.type.startsWith('image/'));
    const pastedFile = imageItem?.getAsFile();
    if (pastedFile) {
      const extension = pastedFile.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      return new File(
        [pastedFile],
        `pasted-screenshot-${Date.now()}.${extension}`,
        { type: pastedFile.type || 'image/png' },
      );
    }
    return Array.from(clipboardData.files || []).find(file => file.type.startsWith('image/')) || null;
  };

  const handlePaste = (e: React.ClipboardEvent | ClipboardEvent) => {
    if (isUploading) return;
    const imageFile = getClipboardImageFile(e.clipboardData);
    if (!imageFile) return;
    e.preventDefault();
    e.stopPropagation();
    void processFiles([imageFile], 'paste');
  };

  useEffect(() => {
    const handleWindowPaste = (event: ClipboardEvent) => handlePaste(event);
    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [isUploading]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (isUploading) return;
    processFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const removeFile = (index: number) => {
    const fileToRemove = files[index];
    if (fileToRemove) {
      URL.revokeObjectURL(fileToRemove.preview);
    }
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSunoClick = (prompt: string) => {
    const englishPrompt = prompt.trim();
    if (!englishPrompt) return;
    copyToClipboard(englishPrompt);
    window.open('https://suno.com/create', '_blank');
  };

  return (
    <div id="audiodirector-view" className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
      {/* Intro Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h2 className="text-xl font-black text-slate-800">AI 音频设计</h2>
          <p className="text-xs text-slate-500 mt-1">多模态一次解析：自动产出全片声音轨道（音效与音乐）设计方案。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Setup & Inputs */}
        <div className="lg:col-span-5 space-y-5">
          {/* File Upload Drag-and-Drop */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
              <Upload className="w-3.5 h-3.5 text-emerald-600" />
              <span>上传创意素材</span>
            </h3>
            
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onPaste={handlePaste}
              tabIndex={0}
              role="button"
              aria-label="上传、拖拽或粘贴创意素材"
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
                isUploading 
                  ? 'border-emerald-500 bg-emerald-500/5' 
                  : 'border-slate-200 hover:border-emerald-500/50 hover:bg-slate-50/50'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*,video/*,audio/*,application/pdf"
                multiple
                className="hidden"
              />
              
              {isUploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                  <p className="text-xs font-bold text-slate-700">正在导入文件，解析编码...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 group">
                  <Upload className="w-8 h-8 text-slate-400 group-hover:text-emerald-600 transition-colors" />
                  <p className="text-xs font-bold text-slate-700">拖拽文件到这里，或点击浏览</p>
                  <p className="text-[10px] text-slate-400">视频最大 100MB；图片、音频与 PDF 最大 20MB；截图可直接 Ctrl+V 粘贴</p>
                </div>
              )}
            </div>

            {pasteMessage && (
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>{pasteMessage}</span>
              </div>
            )}

            {/* Uploaded Files Queue */}
            {files.length > 0 && (
              <div id="uploaded-files-list" className="space-y-2">
                <p className="text-[10px] font-bold text-slate-450 uppercase">待分析队列 ({files.length})</p>
                <div className="max-h-40 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {files.map((item, index) => {
                    const isVideo = item.type.startsWith('video/');
                    const isImage = item.type.startsWith('image/');
                    const isAudio = item.type.startsWith('audio/');
                    const preuploadTone = item.preupload?.status === 'ready'
                      ? 'text-emerald-600'
                      : item.preupload?.status === 'error'
                        ? 'text-amber-600'
                        : 'text-sky-600';
                    const preuploadLabel = item.preupload
                      ? item.preupload.status === 'ready'
                        ? '预上传已就绪'
                        : item.preupload.status === 'error'
                          ? item.preupload.message || '预上传失败，将走原流程'
                          : item.preupload.message || '正在后台预上传'
                      : null;
                    
                    return (
                      <div key={item.id} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          {isImage && <img src={item.preview} className="w-8 h-8 rounded-lg object-cover shrink-0" />}
                          {isVideo && <Clapperboard className="w-5 h-5 text-emerald-600 shrink-0" />}
                          {isAudio && <Volume2 className="w-5 h-5 text-emerald-600 shrink-0" />}
                          {!isImage && !isVideo && !isAudio && <FileText className="w-5 h-5 text-slate-400 shrink-0" />}
                          
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-slate-700 truncate">{item.file.name}</p>
                            <p className="text-[9px] text-slate-400">{(item.file.size / (1024 * 1024)).toFixed(1)} MB</p>
                            {isVideo && preuploadLabel && (
                              <p
                                className={`text-[9px] font-bold truncate ${preuploadTone}`}
                                title={item.preupload?.error || preuploadLabel}
                              >
                                {preuploadLabel}
                                {item.preupload?.status !== 'ready' && item.preupload?.status !== 'error'
                                  ? ` ${item.preupload?.progress || 0}%`
                                  : ''}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                          className="p-1 hover:bg-red-50 hover:text-red-500 text-slate-400 rounded-lg transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Core Configuration & Extra Prompts */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-emerald-600" />
              <span>音频调校设置</span>
            </h3>

            {/* Target Settings */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-700">输出场景定位</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setTarget({ game: true, video: false, avatar: false, sunnyIsland: false })}
                  className={`flex items-center justify-center gap-2 py-2 px-3 border rounded-xl text-xs font-semibold transition-all ${
                    target.game 
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-700 font-bold shadow-sm' 
                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Gamepad2 className="w-4 h-4 shrink-0" />
                  <span>游戏音轨</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTarget({ game: false, video: true, avatar: false, sunnyIsland: false })}
                  className={`flex items-center justify-center gap-2 py-2 px-3 border rounded-xl text-xs font-semibold transition-all ${
                    target.video 
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-700 font-bold shadow-sm' 
                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Clapperboard className="w-4 h-4 shrink-0" />
                  <span>影视/广告</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTarget({ game: false, video: false, avatar: true, sunnyIsland: false })}
                  className={`flex items-center justify-center gap-2 py-2 px-3 border rounded-xl text-xs font-semibold transition-all ${
                    target.avatar 
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-700 font-bold shadow-sm' 
                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Sparkles className="w-4 h-4 shrink-0 text-sky-500" />
                  <span>Avatar</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTarget({ game: false, video: false, avatar: false, sunnyIsland: true })}
                  className={`flex items-center justify-center gap-2 py-2 px-3 border rounded-xl text-xs font-semibold transition-all ${
                    target.sunnyIsland 
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-700 font-bold shadow-sm' 
                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Sun className="w-4 h-4 shrink-0 text-amber-500 animate-pulse" />
                  <span>小岛有晴天</span>
                </button>
              </div>
              <div className={`rounded-xl border px-3 py-2.5 text-[10px] leading-relaxed ${
                hasInvalidProfessionalSelection
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : isProfessionalVideoReady
                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                    : usesProfessionalFallback
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              }`}>
                <div className="flex items-center gap-1.5 font-bold">
                  {hasInvalidProfessionalSelection || usesProfessionalFallback
                    ? <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    : <Clock className="h-3.5 w-3.5 shrink-0" />}
                  <span>
                    {hasInvalidProfessionalSelection
                      ? '专业视频素材需要调整'
                      : isProfessionalVideoReady
                        ? '专业完整视频分析已就绪'
                        : usesProfessionalFallback
                          ? '当前将使用快速素材分析'
                          : '快速关键帧模式'}
                  </span>
                </div>
                <p className="mt-1 opacity-80">
                  {hasInvalidProfessionalSelection
                    ? `完整视频分析只能单独使用 1 个视频；当前共有 ${files.length} 份素材，其中 ${videoFileCount} 个视频。请移除其他素材后继续。`
                    : isProfessionalVideoReady
                      ? target.avatar
                        ? '将上传完整视频，以约 2 FPS 精细分析画面与原音轨；配乐按真实转折自适应规划，通常每段约 5-8 秒。'
                        : '将上传完整视频，以约 1 FPS 分析画面与原音轨；配乐按镜头群和情绪转折自适应排程。'
                      : usesProfessionalFallback
                        ? '未检测到视频，将根据图片、音频、PDF 或文字进行快速分析，不会分析完整视频和原音轨。若要启用专业模式，请仅上传 1 个视频。'
                        : '提取少量压缩关键帧，速度更快，适合游戏音轨和方案预览。'}
                </p>
              </div>
            </div>

            {/* Instrumental/Vocal Toggle */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-700">音乐轨道生成偏好</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setIsInstrumental(true)}
                  className={`py-2 px-3 border rounded-xl text-xs font-semibold transition-all ${
                    isInstrumental 
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-700' 
                      : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}
                >
                  纯音乐 (Instrumental)
                </button>
                <button
                  type="button"
                  onClick={() => setIsInstrumental(false)}
                  className={`py-2 px-3 border rounded-xl text-xs font-semibold transition-all ${
                    !isInstrumental 
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-700' 
                      : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}
                >
                  带歌词/伴奏 (Vocal)
                </button>
              </div>
            </div>

            {/* Custom Text Requirements */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-700">输入您的文字设计需求（选填）</label>
              <textarea
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder="例如：生成充满赛博朋克科幻感的背景音乐，并重点标记战斗中光剑碰撞及脚步声的声音出现时刻..."
                className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all resize-none placeholder-slate-400"
              />
            </div>

            {/* Submit Action */}
            <button
              onClick={onGenerate}
              disabled={loading || hasInvalidProfessionalSelection || (files.length === 0 && !requirements.trim())}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3.5 rounded-xl text-xs tracking-wider uppercase transition-all shadow-md shadow-emerald-600/10 disabled:opacity-50 flex items-center justify-center gap-2 mt-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>分析中</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{hasInvalidProfessionalSelection ? '请先调整专业视频素材' : '开始生成设计方案'}</span>
                </>
              )}
            </button>
            {loading && (
              <button
                type="button"
                onClick={onCancel}
                className="w-full border border-slate-200 bg-white hover:bg-red-50 hover:border-red-200 text-slate-500 hover:text-red-600 font-semibold py-2.5 rounded-xl text-xs transition-all"
              >
                取消本次分析
              </button>
            )}
          </div>
        </div>

        {/* Right Side: Execution Output */}
        <div className="lg:col-span-7">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-600 p-4 rounded-xl flex items-start gap-3 shadow-sm">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold">发生错误</p>
                <p className="mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {loading && (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 flex flex-col items-center text-center space-y-4 shadow-sm">
              <Loader2 className="w-10 h-10 text-emerald-600 animate-spin" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-800">多模态大模型正在协同创作中</p>
                <p className="text-xs text-slate-500">{analysisStage}</p>
              </div>
            </div>
          )}

          {!loading && !result && (
            <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center space-y-4 shadow-sm">
              <div className="w-12 h-12 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center mx-auto text-slate-400">
                <Volume2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-700">尚未生成音频方案</p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">在左侧上传您的游戏场景视频/画稿或填写详细背景文本，即可生成完整的音效 cue sheet 与背景音乐配置方案。</p>
              </div>
              {onLoadDemo && (
                <div className="pt-2 flex flex-col items-center gap-2">
                  <span className="text-[10px] text-slate-400">或直接体验精心打造的高级模版：</span>
                  <button
                    type="button"
                    onClick={() => {
                      setTarget({ game: false, video: true, avatar: false, sunnyIsland: false });
                      setIsInstrumental(false);
                      onLoadDemo(filmDemoResult);
                    }}
                    className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-bold px-4 py-2.5 rounded-xl transition-all flex items-center gap-2 shadow-sm cursor-pointer"
                  >
                    <Clapperboard className="w-4 h-4 shrink-0 text-emerald-600" />
                    <span>载入「影视广告级」精选设计预设演示案</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Results Render Area */}
          {!loading && result && (
            <div className="space-y-5">
              {/* Output Tabs Selection */}
              <div className="bg-white border border-slate-200 p-1.5 rounded-xl flex shadow-sm">
                <button
                  onClick={() => setActiveTab('sfx')}
                  className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    activeTab === 'sfx' 
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>音效 Foley 制作排程</span>
                </button>
                <button
                  onClick={() => setActiveTab('bgm')}
                  className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    activeTab === 'bgm' 
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" />
                  <span>背景音乐配乐方案</span>
                </button>
              </div>

              {/* TAB 1: SFX CUE SHEET TABLE */}
              {activeTab === 'sfx' && (
                <div className="space-y-4">
                  {/* Summary Overview */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest">设计意图 & 画外说明</h4>
                    <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-200 font-semibold">
                      {result.sfxAnalysis.summary}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1.5">
                      {result.sfxAnalysis.keyElements.map((item, idx) => (
                        <span key={idx} className="text-[10px] bg-emerald-50 border border-emerald-100 text-emerald-700 px-2.5 py-0.5 rounded-full font-semibold">
                          #{item}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Schemes tables */}
                  {result.sfxSchemes.map((scheme, sidx) => (
                    <div key={sidx} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                      <div className="px-5 py-4 bg-slate-50/50 border-b border-slate-200 flex items-center justify-between">
                        <h4 className="text-xs font-black text-slate-800">{scheme.title}</h4>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => copyTableToClipboard(scheme, `tbl-${sidx}`)}
                            className="text-[10px] bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 px-2.5 py-1.5 rounded flex items-center gap-1 transition-all shadow-sm cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                            <span>{copiedId === `tbl-${sidx}` ? '已复制 Markdown' : '复制表格'}</span>
                          </button>
                          <button
                            onClick={() => downloadTableAsCSV(scheme)}
                            className="text-[10px] bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 px-2.5 py-1.5 rounded flex items-center gap-1 transition-all shadow-sm cursor-pointer"
                          >
                            <DownloadCloud className="w-3 h-3" />
                            <span>导出 CSV</span>
                          </button>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[500px]">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">
                              <th className="py-3 px-4">音效命名</th>
                              <th className="py-3 px-4">出现动作场景</th>
                              <th className="py-3 px-4">技术逻辑</th>
                              <th className="py-3 px-4">制作详细描述 / DEMO</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 text-[11px]">
                            {scheme.items.map((item, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                                <td className="py-3.5 px-4 font-mono font-bold text-emerald-700">{item.name}</td>
                                <td className="py-3.5 px-4 text-slate-700 leading-relaxed font-semibold">{item.scene}</td>
                                <td className="py-3.5 px-4 text-slate-500 leading-relaxed">{item.logic}</td>
                                <td className="py-3.5 px-4 text-slate-700 leading-relaxed">
                                  <p>{item.description}</p>
                                  {/* Auto-render instant preview player based on ElevenLabs */}
                                  <ElevenLabsPlayer text={item.description} id={`dir-sfx-${sidx}-${idx}`} type="sfx" />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 2: BGM RECOMMENDATIONS */}
              {activeTab === 'bgm' && (
                <div className="space-y-4">
                  {!isGameTrack && <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-1">
                    <h5 className="text-[10px] font-bold text-slate-450 uppercase">画面整体情绪基线（两套方案共同参考）</h5>
                    <p className="text-xs text-slate-700 leading-relaxed font-semibold">
                      {result.musicAnalysis.emotionalCurve}
                    </p>
                  </div>}

                  {/* BGM Specs Cards */}
                  {result.bgmRecommendations.map((bgm, idx) => (
                    <div
                      key={idx}
                      data-testid={`bgm-recommendation-${idx}`}
                      className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm"
                    >
                      {/* Section Head */}
                      <div className="px-5 py-4 bg-slate-50/50 border-b border-slate-200 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] bg-emerald-50 border border-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-bold uppercase mr-2">推荐配乐 #{idx+1}</span>
                          <span className="text-xs font-bold text-slate-800">{bgm.style}</span>
                        </div>
                      </div>

                      {/* Music parameters */}
                      <div className="p-5 space-y-4 text-xs">
                        {!isGameTrack && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                          <div>
                            <p className="text-[10px] text-slate-450 uppercase font-bold">配乐乐器</p>
                            <p className="text-slate-700 font-semibold mt-0.5 truncate">{bgm.instrumentation}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-450 uppercase font-bold">估算速度</p>
                            <p className="text-slate-700 font-semibold mt-0.5">{bgm.sunoPrompt.bpm} BPM</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-450 uppercase font-bold">建议调性</p>
                            <p className="text-slate-700 font-semibold mt-0.5">{bgm.sunoPrompt.key}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-450 uppercase font-bold">曲式结构</p>
                            <p className="text-slate-700 font-semibold mt-0.5 truncate">{bgm.sunoPrompt.structure}</p>
                          </div>
                        </div>}

                        {isGameTrack && <div className="space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                            <div>
                              <p className="text-[10px] text-slate-450 uppercase font-bold">核心配器</p>
                              <p className="text-slate-700 font-semibold mt-0.5 leading-relaxed">{bgm.instrumentation}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-450 uppercase font-bold">建议速度</p>
                              <p className="text-slate-700 font-semibold mt-0.5">{bgm.sunoPrompt.bpm} BPM</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-450 uppercase font-bold">建议调性</p>
                              <p className="text-slate-700 font-semibold mt-0.5">{bgm.sunoPrompt.key}</p>
                            </div>
                          </div>

                          {bgm.visualRationale && <div className="space-y-1">
                            <h5 className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>画面适配说明</span>
                            </h5>
                            <p className="text-slate-700 bg-emerald-50/50 p-3.5 rounded-xl leading-relaxed border border-emerald-100 font-semibold">
                              {bgm.visualRationale}
                            </p>
                          </div>}
                        </div>}

                        {/* Music emotional curve description */}
                        {!isGameTrack && <div className="space-y-1">
                          <h5 className="text-[10px] font-bold text-slate-450 uppercase">本方案动态曲线与剪辑点</h5>
                          <p className="text-slate-700 bg-slate-50 p-3.5 rounded-xl leading-relaxed border border-slate-200 font-semibold">
                            {bgm.sunoPrompt.dynamics}
                          </p>
                        </div>}

                        {/* Timeline Music Design copy */}
                        {!isGameTrack && bgm.timelineDesign && bgm.timelineDesign.length > 0 && (
                          <div className="space-y-3 pt-2">
                            <h5 className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>自适应配乐段落设计案 (Music Production Timeline)</span>
                            </h5>
                            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4.5 space-y-4 shadow-sm">
                              <div className="relative border-l border-emerald-200 ml-3 pl-5 space-y-5">
                                {bgm.timelineDesign.map((timeItem, tIdx) => (
                                  <div key={tIdx} className="relative group">
                                    {/* Bullet badge indicator */}
                                    <div className="absolute -left-[28px] top-1.5 w-3 h-3 rounded-full bg-white border-2 border-emerald-600 flex items-center justify-center transition-all">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-650" />
                                    </div>

                                    <div className="space-y-1.5">
                                      {/* Time and Emotion */}
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded">
                                          {timeItem.timecode}
                                        </span>
                                        <span className="text-xs font-bold text-slate-800">
                                          {timeItem.emotion}
                                        </span>
                                      </div>

                                      {/* Instruments */}
                                      <p className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                                        <span className="text-[9px] text-slate-400 font-bold uppercase">乐器声相配置:</span>
                                        <span>{timeItem.instruments}</span>
                                      </p>

                                      {/* Details description */}
                                      <p className="text-[11px] text-slate-500 leading-relaxed pt-0.5">
                                        {timeItem.description}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Prompt for Suno creation */}
                        <div className="space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm">
                          <div className="flex items-center justify-between">
                            <h5 className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest flex items-center gap-1">
                              <Music className="w-3 h-3 text-emerald-600" />
                              <span>Suno 整体音乐生成词</span>
                            </h5>
                            <button
                              type="button"
                              data-testid={`copy-suno-english-${idx}`}
                              title="仅复制英文 Suno 生成词"
                              disabled={!bgm.sunoPrompt.english.trim()}
                              onClick={() => copyToClipboard(bgm.sunoPrompt.english.trim(), `suno-p-${idx}`)}
                              className="text-[10px] text-slate-500 hover:text-emerald-700 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Copy className="w-3 h-3" />
                              <span>{copiedId === `suno-p-${idx}` ? '已复制英文' : '复制英文生成词'}</span>
                            </button>
                          </div>

                          <p className="text-[10px] text-slate-400">
                            整首音乐的简短风格概述，不含时间线；复制时仅复制英文。
                          </p>

                          <div className="space-y-1.5">
                            <p className="text-[10px] font-bold text-slate-500">中文理解版</p>
                            <p
                              data-testid={`suno-prompt-chinese-${idx}`}
                              className="text-[11px] text-slate-700 bg-emerald-50/50 p-3 rounded-lg border border-emerald-100 leading-relaxed"
                            >
                              {bgm.sunoPrompt.chinese}
                            </p>
                          </div>

                          <div className="space-y-1.5">
                            <p className="text-[10px] font-bold text-slate-500">English Prompt（复制内容）</p>
                            <p
                              data-testid={`suno-prompt-english-${idx}`}
                              className="font-mono text-[11px] text-slate-850 bg-white p-3 rounded-lg border border-slate-200 leading-relaxed italic select-all"
                            >
                              {bgm.sunoPrompt.english}
                            </p>
                          </div>
                          
                          <div className="pt-2 flex flex-wrap justify-end gap-2">
                            <ElevenLabsPlayer
                              text={bgm.sunoPrompt.english}
                              id={`dir-bgm-${idx}`}
                              type="music"
                              onSendToMusicStudio={onSendMusicPrompt}
                            />

                            <button
                              type="button"
                              disabled={!bgm.sunoPrompt.english.trim()}
                              onClick={() => handleSunoClick(bgm.sunoPrompt.english)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-[10px] flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <span>复制英文并跳转 Suno 创作</span>
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Lyrics editing block (if Vocal is enabled) */}
                        {!isGameTrack && bgm.lyrics && !isInstrumental && (
                          <div className="space-y-3 pt-2">
                            <h5 className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">配曲歌词智能设计 (Lyrical Architecture)</h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {bgm.lyrics.content.map((sec, sidx) => (
                                <div key={sidx} className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 relative group hover:border-emerald-500/30 transition-all">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded">{sec.section}</span>
                                    <button
                                      onClick={() => setSelectedLyrics({ sectionIndex: sidx, text: sec.text })}
                                      className="text-[10px] text-slate-450 hover:text-emerald-700 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      <RefreshCw className="w-3 h-3" />
                                      <span>重写片段</span>
                                    </button>
                                  </div>
                                  <p className="text-[11px] text-slate-700 leading-relaxed whitespace-pre-line font-medium italic">
                                    {sec.text}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Lyrics modifier modal */}
      <AnimatePresence>
        {selectedLyrics && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-850 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-emerald-600" />
                  <span>重写歌词片段</span>
                </h3>
                <button onClick={() => setSelectedLyrics(null)} className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-850 rounded-lg transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
                  <span className="text-[9px] font-bold text-slate-450 uppercase block mb-1">当前歌词内容</span>
                  <p className="text-xs text-slate-700 italic font-medium">"{selectedLyrics.text}"</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 block">输入修改方向与情感倾向</label>
                  <textarea 
                    value={lyricEditDirection}
                    onChange={(e) => setLyricEditDirection(e.target.value)}
                    placeholder="例如：更伤感绝望一点、增加一些太空的冰冷画面描述、增加副歌的爆点和韵律感..."
                    className="w-full h-24 bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 rounded-xl p-3.5 text-xs focus:outline-none text-slate-800 transition-all resize-none placeholder-slate-400"
                  />
                </div>
                <button 
                  onClick={handleRegenerateLyrics}
                  disabled={editingLyrics || !lyricEditDirection.trim()}
                  className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white py-3 rounded-xl text-xs font-bold disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {editingLyrics ? <Loader2 className="animate-spin w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                  <span>{editingLyrics ? '正在重新起草歌词...' : '确认并重新生成片段'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
