/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Download, 
  X, 
  AlertCircle,
  Sparkles,
  Mic,
  MicOff,
  UploadCloud,
  FileAudio,
  Loader2,
  Copy,
  Check,
  Globe,
  Languages,
  FileText,
  Calendar,
  Layers,
  Sparkle,
  Trash2,
  Volume2,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { transcribeSpeech } from '../services/elevenLabsService';
import { translateTextToLanguage } from '../services/geminiService';

interface TranscriptionHistoryItem {
  id: string;
  filename: string;
  timestamp: string;
  text: string;
  languageCode?: string;
  languageProbability?: number;
}

const translationLanguageOptions = [
  { value: 'Chinese Mandarin', label: '中文', filenameSuffix: 'zh' },
  { value: 'English', label: '英文', filenameSuffix: 'en' },
  { value: 'Japanese', label: '日文', filenameSuffix: 'ja' },
  { value: 'Korean', label: '韩文', filenameSuffix: 'ko' },
  { value: 'French', label: '法文', filenameSuffix: 'fr' },
  { value: 'German', label: '德文', filenameSuffix: 'de' },
  { value: 'Spanish', label: '西班牙文', filenameSuffix: 'es' },
];

export default function SpeechToText() {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Audio Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // ElevenLabs Parameters
  const [languageCode, setLanguageCode] = useState<string>('auto');
  const [tagAudioEvents, setTagAudioEvents] = useState<boolean>(true);

  // Loading & Results
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptionResult, setTranscriptionResult] = useState<{
    text: string;
    language_code?: string;
    language_probability?: number;
  } | null>(null);
  const [targetTranslationLanguage, setTargetTranslationLanguage] = useState('Chinese Mandarin');
  const [translatedText, setTranslatedText] = useState('');
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  // Action Success Alerts
  const [copied, setCopied] = useState(false);
  const [sttHistory, setSttHistory] = useState<TranscriptionHistoryItem[]>([]);

  // Load transcription history from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ELEVENLABS_STT_HISTORY');
      if (saved) {
        try {
          setSttHistory(JSON.parse(saved));
        } catch (e) {
          console.error(e);
        }
      }
    }
  }, []);

  // Save transcription history to localStorage
  const saveHistory = (items: TranscriptionHistoryItem[]) => {
    setSttHistory(items);
    localStorage.setItem('ELEVENLABS_STT_HISTORY', JSON.stringify(items));
  };

  useEffect(() => {
    return () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [fileUrl]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (selectedFile: File) => {
    if (fileUrl) {
      URL.revokeObjectURL(fileUrl);
    }
    setFile(selectedFile);
    setFileUrl(URL.createObjectURL(selectedFile));
    setIsPlaying(false);
    setTranscriptionResult(null);
    setTranslatedText('');
    setTranslationError(null);
    setError(null);
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().catch(err => console.error(err));
        setIsPlaying(true);
      }
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const recordedFile = new File([audioBlob], `recorded_audio_${Date.now()}.wav`, { type: 'audio/wav' });
        handleFileChange(recordedFile);
        
        // Stop stream tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      setError(null);
      
      timerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Error accessing microphone:", err);
      setError("无法访问麦克风。请确保已授予麦克风权限。");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const handleTranscribe = async () => {
    if (!file) {
      setError('请先上传或录制需要转录的音频文件');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await transcribeSpeech(file, languageCode, tagAudioEvents);
      setTranscriptionResult(result);
      setTranslatedText('');
      setTranslationError(null);

      // Add to local history list
      if (result.text && result.text.trim()) {
        const newHistoryItem: TranscriptionHistoryItem = {
          id: `stt_${Date.now()}`,
          filename: file.name,
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          text: result.text,
          languageCode: result.language_code,
          languageProbability: result.language_probability
        };
        saveHistory([newHistoryItem, ...sttHistory]);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || '转录失败，请检查网络或 API Key 状态。');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTranslateText = async () => {
    const sourceText = transcriptionResult?.text?.trim();
    if (!sourceText) return;

    setTranslationLoading(true);
    setTranslationError(null);
    try {
      const translated = await translateTextToLanguage(sourceText, targetTranslationLanguage, { preserveTone: true });
      setTranslatedText(translated);
    } catch (err: any) {
      setTranslationError(err.message || '翻译失败，请稍后重试。');
    } finally {
      setTranslationLoading(false);
    }
  };

  const handleDownloadTxt = (text: string, title: string) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.replace(/\.[^/.]+$/, "")}_transcription.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = sttHistory.filter(item => item.id !== id);
    saveHistory(updated);
  };

  const handleLoadFromHistory = (item: TranscriptionHistoryItem) => {
    setTranscriptionResult({
      text: item.text,
      language_code: item.languageCode,
      language_probability: item.languageProbability
    });
    setTranslatedText('');
    setTranslationError(null);
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const selectedTranslationOption =
    translationLanguageOptions.find((option) => option.value === targetTranslationLanguage) || translationLanguageOptions[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Parameters & Source Input */}
      <div className="lg:col-span-7 space-y-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
          <div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2">
              <Mic className="w-4 h-4 text-emerald-600" />
              音频源输入
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">上传已有音频文件，或直接开始高品质麦克风录音。</p>
          </div>

          {/* Record Control / Drag Area */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Record Live Audio */}
            <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/50 flex flex-col justify-between items-center text-center space-y-3 min-h-[140px]">
              <div className="flex flex-col items-center">
                <span className="text-xs font-bold text-slate-600">麦克风现场录音</span>
                <span className="text-[10px] text-slate-400 mt-0.5">直接用当前设备录音</span>
              </div>
              
              {isRecording ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                    </span>
                    <span className="text-xs font-semibold text-slate-700 font-mono">
                      {formatDuration(recordingDuration)}
                    </span>
                  </div>
                  <button
                    onClick={stopRecording}
                    className="flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white rounded-full px-4 py-2 text-xs font-bold shadow-md cursor-pointer transition-all"
                  >
                    <MicOff className="w-3.5 h-3.5" />
                    停止录音
                  </button>
                </div>
              ) : (
                <button
                  onClick={startRecording}
                  disabled={loading}
                  className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white rounded-full px-5 py-2.5 text-xs font-bold shadow-sm cursor-pointer disabled:opacity-50 transition-all"
                >
                  <Mic className="w-3.5 h-3.5 text-emerald-400" />
                  开始录音
                </button>
              )}
            </div>

            {/* Upload File */}
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={triggerFileInput}
              className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-all duration-200 min-h-[140px] ${
                dragActive 
                  ? 'border-emerald-500 bg-emerald-50/40' 
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
                className="hidden"
              />
              <UploadCloud className="w-7 h-7 text-slate-400 mb-2" />
              <p className="text-xs font-bold text-slate-700">拖拽文件到此处</p>
              <p className="text-[10px] text-slate-400 mt-1">或点击浏览本地音频文件</p>
            </div>
          </div>

          {/* Current Selection Preview */}
          {file && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between p-3.5 bg-emerald-50/50 border border-emerald-100 rounded-xl"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="bg-emerald-100 text-emerald-700 p-2 rounded-lg shrink-0">
                  <FileAudio className="w-4 h-4" />
                </div>
                <div className="text-left overflow-hidden">
                  <p className="text-xs font-bold text-slate-700 truncate">{file.name}</p>
                  <p className="text-[10px] text-slate-400">大小: {(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={togglePlay}
                  className="bg-emerald-600 text-white p-2 rounded-full hover:bg-emerald-700 cursor-pointer shadow-sm"
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-white" />}
                </button>
                <audio
                  ref={audioRef}
                  src={fileUrl || undefined}
                  onEnded={() => setIsPlaying(false)}
                  className="hidden"
                />
                <button
                  onClick={() => {
                    setFile(null);
                    setFileUrl(null);
                    setIsPlaying(false);
                    setTranscriptionResult(null);
                  }}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* ElevenLabs Advanced Scribe Parameters */}
          <div className="border-t border-slate-100 pt-5 space-y-4">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              转录模型参数配置 (ElevenLabs Scribe)
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Force Language */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-500 block uppercase">强制指定语种 (Language Code)</label>
                <div className="relative">
                  <select
                    value={languageCode}
                    onChange={(e) => setLanguageCode(e.target.value)}
                    className="w-full text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-3 py-2.5 font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 appearance-none cursor-pointer"
                  >
                    <option value="auto">自动检测 (Auto Detect)</option>
                    <option value="zh">中文 (Chinese)</option>
                    <option value="en">英语 (English)</option>
                    <option value="ja">日语 (Japanese)</option>
                    <option value="ko">韩语 (Korean)</option>
                    <option value="es">西班牙语 (Spanish)</option>
                    <option value="fr">法语 (French)</option>
                    <option value="de">德语 (German)</option>
                    <option value="it">意大利语 (Italian)</option>
                    <option value="pt">葡萄牙语 (Portuguese)</option>
                    <option value="ru">俄语 (Russian)</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-3.5 pointer-events-none" />
                </div>
              </div>

              {/* Tag Audio Events */}
              <div className="space-y-2 flex flex-col justify-end pb-1">
                <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-left">
                    <p className="text-xs font-bold text-slate-700">识别音频事件</p>
                    <p className="text-[9px] text-slate-400">标记笑声、叹息、掌声或环境杂音</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={tagAudioEvents}
                      onChange={(e) => setTagAudioEvents(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Action Trigger */}
          {error && (
            <div className="flex gap-2 p-3 bg-red-50 text-red-700 rounded-xl border border-red-100 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-left">{error}</p>
            </div>
          )}

          <button
            onClick={handleTranscribe}
            disabled={loading || !file}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-xl text-xs transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                正在智能转录音频...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-emerald-300 fill-emerald-300" />
                开始智能语音转文本
              </>
            )}
          </button>
        </div>
      </div>

      {/* Results panel / history */}
      <div className="lg:col-span-5 space-y-5">
        {/* Transcription Results Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm text-left">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-slate-600" />
              转录结果面板
            </h3>
            {transcriptionResult && (
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-100 px-2 py-1 rounded-lg text-[10px] font-semibold text-slate-500">
                <Globe className="w-3 h-3 text-emerald-500" />
                <span>
                  {transcriptionResult.language_code ? transcriptionResult.language_code.toUpperCase() : 'AUTO'}
                </span>
                {transcriptionResult.language_probability !== undefined && (
                  <span className="text-emerald-600 font-bold">
                    {(transcriptionResult.language_probability * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4.5 min-h-[160px] flex flex-col justify-between">
            {transcriptionResult ? (
              <div className="space-y-4">
                <p className="text-xs text-slate-700 leading-relaxed font-medium select-text break-words">
                  {transcriptionResult.text}
                </p>
                
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                  <button
                    onClick={() => handleCopyText(transcriptionResult.text)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer border border-slate-200"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        已复制
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        复制文本
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleDownloadTxt(transcriptionResult.text, file?.name || 'transcription')}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer border border-slate-200"
                  >
                    <Download className="w-3 h-3" />
                    下载 TXT
                  </button>
                </div>

                <div className="border-t border-slate-100 pt-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5">
                      <Languages className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-[11px] font-bold text-slate-700">翻译</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="sr-only" htmlFor="stt-translation-language">
                        目标语言
                      </label>
                      <select
                        id="stt-translation-language"
                        value={targetTranslationLanguage}
                        onChange={(event) => {
                          setTargetTranslationLanguage(event.target.value);
                          setTranslatedText('');
                          setTranslationError(null);
                        }}
                        className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-600 outline-none hover:border-emerald-200 focus:border-emerald-400"
                      >
                        {translationLanguageOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleTranslateText}
                        disabled={translationLoading || !transcriptionResult.text.trim()}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer border border-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {translationLoading ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            翻译中...
                          </>
                        ) : (
                          <>
                            <Globe className="w-3 h-3" />
                            翻译
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {translationError && (
                    <div className="flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[10px] text-rose-600">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{translationError}</span>
                    </div>
                  )}

                  {translatedText && (
                    <div className="space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                      <p className="text-xs text-slate-800 leading-relaxed font-medium select-text break-words">
                        {translatedText}
                      </p>
                      <div className="flex items-center justify-end gap-2 border-t border-emerald-100 pt-2">
                        <button
                          type="button"
                          onClick={() => handleCopyText(translatedText)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold text-slate-600 hover:text-emerald-700 hover:bg-white/70 rounded-lg transition-colors cursor-pointer border border-emerald-100"
                        >
                          <Copy className="w-3 h-3" />
                          复制译文
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleDownloadTxt(
                              translatedText,
                              `${file?.name || 'transcription'}_${selectedTranslationOption.filenameSuffix}`,
                            )
                          }
                          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold text-slate-600 hover:text-emerald-700 hover:bg-white/70 rounded-lg transition-colors cursor-pointer border border-emerald-100"
                        >
                          <Download className="w-3 h-3" />
                          下载译文 TXT
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center text-slate-400 space-y-2">
                <Sparkle className="w-6 h-6 text-slate-300 animate-pulse" />
                <p className="text-[11px] font-semibold">暂无转录数据</p>
                <p className="text-[10px] text-slate-300">请在左侧上传音频并运行转录。</p>
              </div>
            )}
          </div>
        </div>

        {/* History of Transcriptions */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm text-left">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-slate-600" />
              转录历史记录
            </h3>
            {sttHistory.length > 0 && (
              <button
                onClick={() => saveHistory([])}
                className="text-[10px] text-slate-400 hover:text-red-500 font-semibold transition-colors cursor-pointer"
              >
                清除全部
              </button>
            )}
          </div>

          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
            {sttHistory.length === 0 ? (
              <div className="text-center py-6 border-2 border-dashed border-slate-100 rounded-xl">
                <p className="text-[11px] text-slate-400 font-semibold">历史记录为空</p>
              </div>
            ) : (
              sttHistory.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleLoadFromHistory(item)}
                  className="p-3 bg-slate-50/50 hover:bg-emerald-50/30 border border-slate-100 hover:border-emerald-100 rounded-xl transition-all cursor-pointer flex flex-col justify-between gap-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-600 truncate max-w-[150px]">{item.filename}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-slate-400 font-mono">{item.timestamp}</span>
                      <button
                        onClick={(e) => handleDeleteHistory(item.id, e)}
                        className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed select-text font-medium">{item.text}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
