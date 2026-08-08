/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  Copy, 
  Download, 
  RefreshCw, 
  Plus, 
  Trash2, 
  Loader2, 
  X, 
  ClipboardList,
  AlertCircle,
  HelpCircle,
  Sparkles,
  ArrowRight,
  FileSpreadsheet
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { generateSfxRequirements } from '../services/geminiService';

type TemplateType = 'game_sfx_general' | 'game_sfx_middleware' | 'voiceover_general' | 'voiceover_multilang';

interface SfxRequirementsProps {
  hasGeminiKey: boolean;
}

// Demo data matching our standard design principles
const DEMO_ROWS: Record<TemplateType, any[]> = {
  game_sfx_general: [
    {
      index: 1,
      filename: "sfx_ui_common_button_click",
      duration_logic: "1s, 单次播放",
      scene: "通用与主界面&游戏内的ui点击按键",
      description: "清脆的交互点击声，带有轻微的拟物触感与中高频数字质感",
      remarks: "常用全局 UI 按钮，声音要小巧，响度控制在 -14 LUFS 左右",
      video_link: "UI点击演示.mp4"
    },
    {
      index: 2,
      filename: "bgm_battle",
      duration_logic: "loop, 循环播放",
      scene: "关卡内战斗场景、遭遇战",
      description: "热血、紧张有战斗感的电子摇滚乐，由重击鼓点、失真吉他与动感合成器主导",
      remarks: "需要无缝循环，包含一个 4s 的 Intro 前奏，BPM 135",
      video_link: "核心战斗参考.mp4"
    },
    {
      index: 3,
      filename: "sfx_player_dash",
      duration_logic: "0.8s, 单次播放",
      scene: "主角执行前冲闪避、瞬移的一瞬间",
      description: "带有疾风气流撕裂声，高频气流破空音色叠合电声粒子回馈",
      remarks: "瞬态触发极快，高音需要做压限，避免连续触发破音",
      video_link: "前冲动作.mp4"
    },
    {
      index: 4,
      filename: "sfx_item_pickup_gold",
      duration_logic: "1.2s, 随机多样本",
      scene: "玩家拾取金币或重要战利品时",
      description: "清脆悦耳的高频金属撞击声，带有闪闪发光的粒子声尾音",
      remarks: "提供 3 个随机音调微调样本，增强连续拾取时的多变性",
      video_link: "拾取反馈.mp4"
    }
  ],
  game_sfx_middleware: [
    {
      index: 1,
      filename: "sfx_footstep_grass",
      event_name: "event:/SFX/Player/Footstep_Grass",
      duration: "0.5s",
      scene: "角色在草地上行走或奔跑时",
      description: "细腻的草叶摩擦声，带有泥土微弱的松软触击反馈",
      remarks: "配置 FMOD Multi-Sound，放入 5 个随机样本避免单调",
      video_link: "无",
      reference: "参考《塞尔达传说：荒野之息》草地脚步",
      playback_logic: "3D 空间，设置随机音高 (Pitch) 与音量 (Volume)",
      distance_3d: "20"
    },
    {
      index: 2,
      filename: "sfx_magic_fireball_launch",
      event_name: "event:/SFX/Magic/Fireball_Launch",
      duration: "1.2s",
      scene: "法师角色咏唱结束发射火球一瞬间",
      description: "火焰呼啸喷薄而出的轰鸣声，高频热气浪扑面感，叠合魔力蓄能释放",
      remarks: "需要关联 RTPC 参数：法力强度（改变低频厚度与爆破感）",
      video_link: "火球技能.mp4",
      reference: "参考《魔兽世界》法术释放音效",
      playback_logic: "3D 空间，限制最大发声数 3，最老发声覆盖",
      distance_3d: "20"
    }
  ],
  voiceover_general: [
    {
      index: 1,
      scene: "主线关卡第一章，主角目睹家园毁灭时的内心独白",
      tone: "悲愤、压抑，随后转为坚毅，略带沙哑的呼吸声",
      filename: "vo_hero_monologue",
      script: "我曾经以为... 只要守在这里，就能避开这世间的纷争。但我错了，他们夺走了我的一切..."
    },
    {
      index: 2,
      scene: "新手教学，指引精灵莉莉首次向玩家作自我介绍",
      tone: "活泼、俏皮、空灵，语速稍快，带着笑意",
      filename: "vo_fairy_lili_intro",
      script: "哈喽，旅行者！我是莉莉，也是你接下来的向导。别傻站着啦，快跟我出发吧！"
    }
  ],
  voiceover_multilang: [
    {
      index: 1,
      filename: "vo_villain_boss_laugh",
      scene: "战役最后一关，反派魔王在王座上嘲笑主角",
      tone: "狂妄、傲慢，带着阴冷沙哑的胸腔共鸣低笑",
      script_zh: "不自量力的凡人，你们以为这点微末的挣扎，就能改变既定的宿命吗？",
      script_en: "Foolish mortals... do you truly believe your petty struggles can shatter the chains of destiny?",
      script_ko: "어리석은 필멸자들이여, 너희의 그 사소한 발버둥이 정해진 숙명을 바꿀 수 있을 거라 생각하느냐?"
    },
    {
      index: 2,
      filename: "vo_npc_guide_farewell",
      scene: "主城守卫给即将出征的勇士们送行致敬",
      tone: "庄重、神圣、沉稳，铿锵有力，富有史诗仪式感",
      script_zh: "愿晨曦的微光指引你们的方向，勇士们，平安归来！",
      script_en: "May the twilight guide your blade, warriors. Return to us in victory and peace!",
      script_ko: "여명의 미광이 그대들의 길을 비추기를, 용사들이여, 부디 무사히 돌아오라!"
    }
  ]
};

const TEMPLATE_INFO = {
  game_sfx_general: {
    name: "游戏音效配乐通用表",
    desc: "适合各类游戏基础开发，涵盖经典命名、场景及听觉特征描述",
    headers: ["序号", "文件命名", "时长&播放逻辑", "应用场景", "描述", "备注", "动效视频"],
    keys: ["index", "filename", "duration_logic", "scene", "description", "remarks", "video_link"]
  },
  game_sfx_middleware: {
    name: "FMOD / Wwise 引擎中间件需求表",
    desc: "适合专业音频设计师，包含事件路径、播放参数逻辑与音频参考",
    headers: ["序号", "文件命名", "事件命名", "时长", "应用场景", "描述", "备注", "动效视频", "参考", "播放逻辑", "3D距离"],
    keys: ["index", "filename", "event_name", "duration", "scene", "description", "remarks", "video_link", "reference", "playback_logic", "distance_3d"]
  },
  voiceover_general: {
    name: "通用角色配音表",
    desc: "针对配音导演和配音演员，精准定义应用场景、情感语气与台词脚本",
    headers: ["序号", "应用场景", "语气描述", "文件命名", "台词文案"],
    keys: ["index", "scene", "tone", "filename", "script"]
  },
  voiceover_multilang: {
    name: "多语种配音本地化表",
    desc: "适合多国语言配音项目，支持中、英、韩等多语种台词对照和语气约束",
    headers: ["序号", "文件命名", "应用场景", "语气描述", "台词文案（简中）", "英语", "韩语"],
    keys: ["index", "filename", "scene", "tone", "script_zh", "script_en", "script_ko"]
  }
};

const LOADING_STEPS = [
  "AI 正在识别用户上传的截图及文字...",
  "正在提取表格框架与数据条目...",
  "正在应用专业音频工程规范重构文件名...",
  "正在扩充细致、具体的声学材质与动效描述...",
  "正在转换语境并生成多国台词对照...",
  "正在为您进行高精度的排版排程，即将呈现..."
];

const stripGeneratedVariantSuffix = (value: unknown) => (
  typeof value === 'string' ? value.trim().replace(/_(\d{2,3})$/i, '') : ''
);

const normalizeGeneratedFilename = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
};

const includesAny = (value: string, keywords: string[]) => (
  keywords.some(keyword => value.includes(keyword.toLowerCase()))
);

const hasSceneTermsInOrder = (sceneText: string, firstTerms: string[], secondTerms: string[]) => (
  firstTerms.some(firstTerm => (
    secondTerms.some(secondTerm => {
      const firstIndex = sceneText.indexOf(firstTerm.toLowerCase());
      const secondIndex = sceneText.indexOf(secondTerm.toLowerCase());
      return firstIndex >= 0 && secondIndex >= 0 && firstIndex <= secondIndex;
    })
  ))
);

const inferScenarioFirstFilename = (item: any, normalizedFilename: string) => {
  const sceneText = [
    item?.scene,
    item?.duration_logic,
    item?.duration,
    item?.playback_logic,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!sceneText || !normalizedFilename.startsWith('sfx_')) return normalizedFilename;

  const upgradeTerms = ['升级', '升級', 'upgrade', 'level up', 'levelup'];
  const successTerms = ['成功', '完成', '达成', '達成', 'success', 'complete', 'completed'];
  const failTerms = ['失败', '失敗', 'fail', 'failed', 'error'];
  const pageTerms = ['页面', '頁面', '界面', '页', '頁', 'page', 'screen'];
  const openTerms = ['打开', '开启', '进入', '出現', '出现', '弹出', '彈出', 'open', 'enter', 'show', 'popup'];
  const closeTerms = ['关闭', '关掉', '退出', '返回', '收起', 'close', 'exit', 'back', 'dismiss'];
  const claimTerms = ['领取', '获得', '收取', '结算', 'claim', 'collect', 'receive'];
  const rewardTerms = ['奖励', '獎勵', 'reward'];
  const coinTerms = ['金币', '金幣', 'coin', 'coins', 'gold'];
  const pickupTerms = ['拾取', '捡起', '撿起', 'pickup', 'pick up', 'collect'];

  if (includesAny(sceneText, upgradeTerms) && includesAny(sceneText, pageTerms) && includesAny(sceneText, closeTerms)) {
    return 'sfx_ui_upgrade_page_close';
  }
  if (includesAny(sceneText, upgradeTerms) && includesAny(sceneText, pageTerms) && includesAny(sceneText, openTerms)) {
    return 'sfx_ui_upgrade_page_open';
  }
  if (hasSceneTermsInOrder(sceneText, upgradeTerms, successTerms)) {
    return 'sfx_ui_upgrade_success';
  }
  if (hasSceneTermsInOrder(sceneText, upgradeTerms, failTerms)) {
    return 'sfx_ui_upgrade_fail';
  }
  if (includesAny(sceneText, rewardTerms) && includesAny(sceneText, claimTerms)) {
    return 'sfx_ui_reward_claim';
  }
  if (includesAny(sceneText, coinTerms) && includesAny(sceneText, pickupTerms)) {
    return 'sfx_item_coin_pickup';
  }

  return normalizedFilename;
};

const replaceEventNameFilenameTail = (
  eventName: unknown,
  previousFilename: string,
  nextFilename: string,
) => {
  if (typeof eventName !== 'string' || !previousFilename || previousFilename === nextFilename) {
    return eventName;
  }
  const escapedPrevious = previousFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedNormalizedPrevious = normalizeGeneratedFilename(previousFilename)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return eventName
    .replace(new RegExp(`${escapedPrevious}$`, 'i'), nextFilename)
    .replace(new RegExp(`${escapedNormalizedPrevious}$`, 'i'), nextFilename);
};

const normalizeRequirementFilenames = (items: any[]) => items.map((item) => {
  const originalFilename = typeof item?.filename === 'string' ? item.filename.trim() : '';
  const normalizedFilename = normalizeGeneratedFilename(originalFilename);
  const scenarioFirstFilename = inferScenarioFirstFilename(item, normalizedFilename);
  if (!scenarioFirstFilename || scenarioFirstFilename === originalFilename) return item;
  return {
    ...item,
    filename: scenarioFirstFilename,
    event_name: replaceEventNameFilenameTail(item.event_name, originalFilename, scenarioFirstFilename),
  };
});

const simplifySingletonFilenameSuffixes = (items: any[]) => {
  const normalizedItems = normalizeRequirementFilenames(items);
  const baseNameCounts = new Map<string, number>();
  normalizedItems.forEach((item) => {
    const filename = typeof item?.filename === 'string' ? item.filename.trim() : '';
    if (!/_\d{2,3}$/i.test(filename)) return;
    const baseName = stripGeneratedVariantSuffix(filename);
    if (!baseName) return;
    baseNameCounts.set(baseName, (baseNameCounts.get(baseName) || 0) + 1);
  });

  return normalizedItems.map((item) => {
    const filename = typeof item?.filename === 'string' ? item.filename.trim() : '';
    if (!/_\d{2,3}$/i.test(filename)) return item;

    const baseName = stripGeneratedVariantSuffix(filename);
    if ((baseNameCounts.get(baseName) || 0) !== 1) return item;

    const simplifiedItem = { ...item, filename: baseName };
    if (typeof simplifiedItem.event_name === 'string') {
      simplifiedItem.event_name = replaceEventNameFilenameTail(simplifiedItem.event_name, filename, baseName);
    }
    return simplifiedItem;
  });
};

export default function SfxRequirements({ hasGeminiKey }: SfxRequirementsProps) {
  const [templateType, setTemplateType] = useState<TemplateType>('game_sfx_general');
  const [inputText, setInputText] = useState('');
  const [rows, setRows] = useState<any[]>(DEMO_ROWS.game_sfx_general);
  
  // Screenshot states
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);

  // Loading & Error states
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-switch rows when changing template type if they haven't been customized, or let user reset
  const handleTemplateChange = (type: TemplateType) => {
    setTemplateType(type);
    setRows(DEMO_ROWS[type]);
  };

  // Restore defaults
  const handleRestoreDefaults = () => {
    setRows(DEMO_ROWS[templateType]);
    setSuccess(false);
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const processImageFile = (file: File, source: 'upload' | 'drop' | 'paste' = 'upload') => {
    if (!file.type.startsWith('image/')) {
      setError('只支持上传截图（图片格式文件）');
      return;
    }
    setError(null);
    setPasteMessage(source === 'paste' ? '已从剪贴板粘贴截图，可以直接生成/优化需求表。' : null);
    setScreenshot(file);
    if (screenshotPreview) {
      URL.revokeObjectURL(screenshotPreview);
    }
    const previewUrl = URL.createObjectURL(file);
    setScreenshotPreview(previewUrl);

    // Read as base64
    const reader = new FileReader();
    reader.onload = () => {
      setScreenshotBase64(reader.result as string);
    };
    reader.onerror = () => {
      setError('截图文件读取失败');
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processImageFile(e.dataTransfer.files[0], 'drop');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processImageFile(e.target.files[0], 'upload');
    }
  };

  const getClipboardImageFile = (clipboardData: DataTransfer | null): File | null => {
    if (!clipboardData) return null;

    const clipboardItems = Array.from(clipboardData.items || []);
    const imageItem = clipboardItems.find(item => item.kind === 'file' && item.type.startsWith('image/'));
    const pastedFile = imageItem?.getAsFile();
    if (pastedFile) {
      const extension = pastedFile.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      return new File(
        [pastedFile],
        `pasted-requirements-screenshot-${Date.now()}.${extension}`,
        { type: pastedFile.type || 'image/png' },
      );
    }

    const clipboardFiles = Array.from(clipboardData.files || []);
    return clipboardFiles.find(file => file.type.startsWith('image/')) || null;
  };

  const handlePasteScreenshot = (e: React.ClipboardEvent | ClipboardEvent) => {
    const imageFile = getClipboardImageFile(e.clipboardData);
    if (!imageFile) return;
    e.preventDefault();
    processImageFile(imageFile, 'paste');
  };

  const handleRemoveScreenshot = () => {
    setScreenshot(null);
    if (screenshotPreview) {
      URL.revokeObjectURL(screenshotPreview);
    }
    setScreenshotPreview(null);
    setScreenshotBase64(null);
    setPasteMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    const handleWindowPaste = (event: ClipboardEvent) => {
      handlePasteScreenshot(event);
    };
    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [screenshotPreview]);

  // Table rows actions
  const handleCellChange = (rowIndex: number, key: string, value: string | number) => {
    const updated = [...rows];
    updated[rowIndex] = {
      ...updated[rowIndex],
      [key]: value
    };
    setRows(updated);
  };

  const handleAddRow = () => {
    const currentKeys = TEMPLATE_INFO[templateType].keys;
    const newIndex = rows.length > 0 ? Math.max(...rows.map(r => Number(r.index) || 0)) + 1 : 1;
    
    const newRow: any = { index: newIndex };
    currentKeys.forEach(key => {
      if (key !== 'index') {
        if (key === 'filename') {
          newRow[key] = templateType.startsWith('voiceover') ? `vo_character_new_${newIndex}` : `sfx_module_new_${newIndex}`;
        } else if (key === 'event_name') {
          newRow[key] = `event:/SFX/Module/new_${newIndex}`;
        } else if (key === 'duration' || key === 'duration_logic') {
          newRow[key] = "1s";
        } else if (key === 'distance_3d') {
          newRow[key] = "20";
        } else {
          newRow[key] = "";
        }
      }
    });

    setRows([...rows, newRow]);
  };

  const handleDeleteRow = (rowIndex: number) => {
    const updated = rows.filter((_, idx) => idx !== rowIndex).map((row, idx) => ({
      ...row,
      index: idx + 1 // Re-index neatly
    }));
    setRows(updated);
  };

  const handleClearTable = () => {
    setRows([]);
  };

  // Generate / Optimize handler using Gemini model
  const handleGenerate = async () => {
    if (!hasGeminiKey) {
      setError('GEMINI_API_KEY 未配置，请前往设置页面或 Secrets 面板添加。');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);
    setLoadingStep(0);

    // Start automated loading step simulator
    const interval = setInterval(() => {
      setLoadingStep(prev => (prev < LOADING_STEPS.length - 1 ? prev + 1 : prev));
    }, 4500);

    try {
      let imageObj = null;
      if (screenshotBase64 && screenshot) {
        imageObj = {
          data: screenshotBase64,
          mimeType: screenshot.type
        };
      }

      const response = await generateSfxRequirements(inputText, imageObj, templateType);
      
      if (response && Array.isArray(response.items)) {
        setRows(simplifySingletonFilenameSuffixes(response.items));
        setSuccess(true);
      } else {
        throw new Error('AI 返回了不完整的数据，请稍后重试');
      }
    } catch (err: any) {
      console.error('Error generating SFX requirements:', err);
      setError(err.message || '生成音效需求表失败，请检查大模型调用状态并重试。');
    } finally {
      clearInterval(interval);
      setLoading(false);
    }
  };

  // Export to CSV UTF-8 with BOM
  const handleExportCSV = () => {
    const info = TEMPLATE_INFO[templateType];
    const headers = info.headers;
    const keys = info.keys;

    // Build lines
    const rowsContent = rows.map(row => {
      return keys.map(key => {
        const val = row[key] !== undefined && row[key] !== null ? String(row[key]) : "";
        // Escape quotes
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',');
    });

    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rowsContent
    ].join('\n');

    // Add BOM marker to make sure Microsoft Excel opens Chinese characters correctly
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.id = 'download-csv-link';
    link.setAttribute('href', url);
    link.setAttribute('download', `音效配乐需求表_${info.name}_${new Date().toISOString().substring(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Fast text templates helper
  const handleApplyPresetPrompt = (text: string) => {
    setInputText(text);
  };

  // Clean preview URL on unmount
  useEffect(() => {
    return () => {
      if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    };
  }, [screenshotPreview]);

  const currentTemplate = TEMPLATE_INFO[templateType];

  return (
    <div id="sfx-requirements-main" className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div id="sfx-req-header" className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <ClipboardList className="text-emerald-600 w-5 h-5" />
            <h2 id="sfx-req-title" className="text-xl font-bold tracking-tight text-slate-800">音效需求表优化</h2>
          </div>
          <p className="text-xs text-slate-500">
            支持输入简短想法或上传已有需求表的草稿截图，通过 AI 精准识别、翻译并一键优化为标准化、工业级的音频制作排程需求表。
          </p>
        </div>
        <div className="flex gap-2.5">
          <button
            id="btn-restore-defaults"
            onClick={handleRestoreDefaults}
            className="flex items-center gap-1.5 px-3.5 py-1.5 border border-slate-200 bg-white text-slate-600 hover:text-slate-800 hover:bg-slate-50 rounded-xl text-xs font-semibold transition-all shadow-sm"
            title="恢复当前模板为精美示例行"
          >
            <RefreshCw className="w-3.5 h-3.5 text-emerald-600" />
            <span>恢复默认示例</span>
          </button>
        </div>
      </div>

      {/* Grid Configuration and Screen Upload */}
      <div id="sfx-req-config-grid" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Control Column (8 cols in big screens) */}
        <div className="lg:col-span-8 space-y-6">
          <div id="card-step-1" className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold font-mono border border-emerald-200/50">1</span>
                <span className="text-sm font-semibold text-slate-750">选择目标数据表格式模板</span>
              </div>
            </div>

            {/* Template Selector Radio Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(Object.keys(TEMPLATE_INFO) as TemplateType[]).map((type) => {
                const info = TEMPLATE_INFO[type];
                const isSelected = templateType === type;
                return (
                  <button
                    key={type}
                    id={`template-btn-${type}`}
                    onClick={() => handleTemplateChange(type)}
                    className={`flex flex-col text-left p-3.5 rounded-xl border transition-all ${
                      isSelected 
                        ? 'bg-emerald-50/45 border-emerald-500 shadow-sm shadow-emerald-500/5' 
                        : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className={`text-xs font-bold ${isSelected ? 'text-emerald-700' : 'text-slate-700'}`}>{info.name}</span>
                      <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${isSelected ? 'border-emerald-600 bg-emerald-600' : 'border-slate-300 bg-white'}`}>
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-400 leading-relaxed truncate-3-lines">{info.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt Draft Input Card */}
          <div id="card-step-2" className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold font-mono border border-emerald-200/50">2</span>
                <span className="text-sm font-semibold text-slate-750">填写需求描述</span>
              </div>
              <HelpCircle className="w-4 h-4 text-slate-400" title="可输入您对音效库的需求想法，AI 将自动融合至表格中" />
            </div>

            <div className="space-y-3">
              <textarea
                id="input-text-prompt"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="例如：生成一份末日丧尸游戏的基础音效表，包含UI按钮声、撕咬声、沉重脚步、警报器、电锯启动声以及低沉的背景音乐，并且帮我规范化英文命名与技术实现细节..."
                className="w-full h-28 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 focus:bg-white transition-all resize-none leading-relaxed"
              />

              {/* Quick Prompt Presets */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-slate-450">点击应用快速构思预设：</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleApplyPresetPrompt("帮我生成一份科幻太空飞行射击游戏的音效需求表，要求有激光束开火、护盾碰撞、重力引擎超频、UI警告音效，命名要极度规范。")}
                    className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] text-slate-600 hover:text-slate-850 hover:bg-slate-100 hover:border-slate-300 transition-all"
                  >
                    🚀 科幻飞船战
                  </button>
                  <button
                    onClick={() => handleApplyPresetPrompt("生成一份萌系闯关休闲手游的配音脚本需求表。角色是小狐狸，语气要活泼傲娇。包含普通问候、大招技能、战败低落和宝箱开启。")}
                    className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] text-slate-600 hover:text-slate-850 hover:bg-slate-100 hover:border-slate-300 transition-all"
                  >
                    🦊 萌系手游配音
                  </button>
                  <button
                    onClick={() => handleApplyPresetPrompt("生成一份横版魂系动作游戏音效中间件需求表（FMOD），包含重击格挡、刀刃附魔、暗影闪避，包含细致的Wwise/FMOD随机样本播放参数配置。")}
                    className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] text-slate-600 hover:text-slate-850 hover:bg-slate-100 hover:border-slate-300 transition-all"
                  >
                    ⚔️ 魂系动作(FMOD)
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Drag-and-Drop Column (4 cols in big screens) */}
        <div className="lg:col-span-4">
          <div id="card-screenshot" className="bg-white border border-slate-200 rounded-2xl p-5 h-full flex flex-col justify-between space-y-4 shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 shrink-0">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold font-mono border border-emerald-200/50">3</span>
              <span className="text-sm font-semibold text-slate-750">导入已有需求表截图（可选）</span>
            </div>

            {/* Drag & Drop Stage */}
            <div
              id="dropzone-screenshot"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onPaste={handlePasteScreenshot}
              onClick={() => fileInputRef.current?.click()}
              tabIndex={0}
              role="button"
              aria-label="上传、拖拽或粘贴需求表截图"
              className={`flex-1 min-h-[170px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-4 text-center cursor-pointer transition-all ${
                isDragging 
                  ? 'border-emerald-500 bg-emerald-50' 
                  : screenshotPreview 
                    ? 'border-slate-200 bg-slate-50/50' 
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/55'
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />

              {!screenshotPreview ? (
                <div className="space-y-2.5">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
                    <Upload className="w-5 h-5 text-slate-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-700">拖拽或粘贴已有表格截图到此</p>
                    <p className="text-[10px] text-slate-400 mt-1">支持 Ctrl+V 粘贴，也可点击浏览文件（PNG, JPG 等）</p>
                  </div>
                </div>
              ) : (
                <div className="relative w-full h-full flex flex-col items-center justify-center">
                  <div className="relative group overflow-hidden rounded-lg border border-slate-200">
                    <img
                      src={screenshotPreview}
                      alt="Uploaded screenshot preview"
                      className="max-h-[120px] object-contain"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-[10px] font-semibold text-white">点击更换图片</span>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full text-[10px] text-slate-700">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span className="max-w-[120px] truncate">{screenshot?.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveScreenshot();
                      }}
                      className="p-0.5 hover:text-red-500 transition-colors"
                      title="移除图片"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
            {pasteMessage && (
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>{pasteMessage}</span>
              </div>
            )}

            {/* Run Generation Button Action */}
            <div className="pt-2 shrink-0">
              <button
                id="btn-generate-requirements"
                disabled={loading || (!inputText.trim() && !screenshot)}
                onClick={handleGenerate}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:from-slate-100 disabled:to-slate-200 text-white font-semibold text-xs py-3 rounded-xl transition-all shadow-md shadow-emerald-500/5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>AI 正在全力构思与排版...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-white" />
                    <span>一键智能化生成/优化需求表</span>
                  </>
                )}
              </button>
              {(!inputText.trim() && !screenshot) && (
                <p className="text-[9px] text-slate-400 text-center mt-1.5">
                  提示：请输入文字或拖入一张需求表截图以激活生成
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Loading Steps Screen overlay / progress indicator */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="bg-white/95 border border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center space-y-5 shadow-2xl"
          >
            <div className="relative">
              <div className="w-12 h-12 rounded-full border-2 border-emerald-500/20 border-t-emerald-600 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-emerald-600 animate-pulse" />
              </div>
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-bold text-slate-800">AI 音频设计师正在全力处理中</p>
              <p className="text-[11px] text-emerald-600 font-mono tracking-wider animate-pulse">
                {LOADING_STEPS[loadingStep]}
              </p>
            </div>
            <p className="text-[10px] text-slate-400 max-w-sm text-center leading-relaxed">
              Gemini 正在针对截图进行多模态识别与高级转译。为了确保技术参数与双语翻译的最高品质，可能需要 15-30 秒的时间。
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error / Alert Bar */}
      {error && (
        <div id="req-error-alert" className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-red-700">处理失败</h4>
            <p className="text-[10px] text-red-600/80 mt-1 leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {/* Success Notification Bar */}
      {success && (
        <div id="req-success-alert" className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <div>
              <h4 className="text-xs font-bold text-emerald-700">生成成功！</h4>
              <p className="text-[10px] text-emerald-600">已根据您的要求完美扩充并格式化。您可直接在下方表格中修改任何单元格！</p>
            </div>
          </div>
          <button
            onClick={() => setSuccess(false)}
            className="text-emerald-700 hover:text-emerald-800 text-[10px] font-bold"
          >
            知道了
          </button>
        </div>
      )}

      {/* Main Requirement Sheet Interactive Table */}
      <div id="card-table-stage" className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
        {/* Table Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>{currentTemplate.name}</span>
              <span className="text-[10px] bg-slate-55 text-slate-500 border border-slate-200 px-2 py-0.5 rounded-full font-normal">
                {rows.length} 个条目
              </span>
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
              编辑下方任意输入框即可动态更改内容，双击/点击即可修改、调整、补充或翻译。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              id="btn-add-row"
              onClick={handleAddRow}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-850 rounded-xl text-[11px] font-semibold transition-all border border-slate-200"
            >
              <Plus className="w-3 h-3 text-emerald-600" />
              <span>添加行</span>
            </button>
            <button
              id="btn-clear-table"
              onClick={handleClearTable}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-[11px] font-semibold transition-all border border-red-100"
              title="清空当前表格"
            >
              <Trash2 className="w-3 h-3 text-red-500" />
              <span>清空</span>
            </button>
            <div className="w-[1px] h-4 bg-slate-250 mx-1" />
            <button
              id="btn-export-csv"
              disabled={rows.length === 0}
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl text-[11px] font-bold transition-all shadow-sm"
              title="直接导出符合 Excel 国标的 CSV 格式表格"
            >
              <Download className="w-3 h-3" />
              <span>直接导出下载</span>
            </button>
          </div>
        </div>

        {/* Scrollable Table Stage */}
        <div className="overflow-x-auto w-full custom-scrollbar border border-slate-200 rounded-xl bg-white">
          {rows.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center space-y-3">
              <ClipboardList className="w-10 h-10 text-slate-200" />
              <div>
                <p className="text-xs font-semibold text-slate-400">表格内容为空</p>
                <p className="text-[10px] text-slate-400 mt-1">您可点击 “添加行” 按钮手动录入，或使用上方 AI 自动一键智能生成</p>
              </div>
              <button
                onClick={handleRestoreDefaults}
                className="px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all"
              >
                导入示例模板行
              </button>
            </div>
          ) : (
            <table id="req-table-element" className="w-full text-left border-collapse table-auto min-w-[800px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {currentTemplate.headers.map((h, idx) => (
                    <th 
                      key={idx} 
                      className={`px-3.5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider ${
                        h === "序号" ? "w-[50px]" : ""
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                  <th className="px-3.5 py-3 text-[10px] font-bold text-slate-500 text-center w-[50px]">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-slate-50/60 transition-colors">
                    {currentTemplate.keys.map((key) => {
                      const value = row[key] !== undefined && row[key] !== null ? row[key] : "";
                      const isIndex = key === 'index';
                      return (
                        <td key={key} className="p-1 px-2.5">
                          {isIndex ? (
                            <span className="text-[11px] font-bold text-slate-400 px-1 font-mono">{value}</span>
                          ) : (
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => handleCellChange(rowIndex, key, e.target.value)}
                              className="w-full bg-transparent border-0 focus:ring-1 focus:ring-emerald-500 focus:bg-white px-2 py-1.5 rounded text-xs text-slate-700 outline-none transition-all placeholder-slate-300"
                              placeholder="..."
                            />
                          )}
                        </td>
                      );
                    })}
                    {/* Delete action cell */}
                    <td className="p-1 px-2.5 text-center">
                      <button
                        onClick={() => handleDeleteRow(rowIndex)}
                        className="p-1.5 text-slate-400 hover:text-red-500 rounded hover:bg-red-50 transition-all"
                        title="删除该行"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Informative Help Card */}
        <div id="footer-export-info" className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-start gap-2.5 shadow-sm">
          <HelpCircle className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
          <p className="text-[10px] text-slate-400 leading-relaxed">
            <strong className="text-slate-600">导出提示：</strong>
            生成的表格完美支持 Microsoft Excel、Google Sheets 及 WPS 等办公软件。
            本工具在导出时已自动附带 <strong className="text-slate-700">UTF-8 with BOM (\ufeff)</strong> 字符编码，解决在 Excel 中直接双击打开中文表格时由于编码不匹配导致的乱码问题，确保您的项目合作体验顺畅无阻。
          </p>
        </div>
      </div>
    </div>
  );
}
