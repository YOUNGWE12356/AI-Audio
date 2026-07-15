/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
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
  Sparkles
} from 'lucide-react';
import { 
  resampleAudioBuffer, 
  encodeWav, 
  encodeMp3 
} from '../services/audioEncoderService';
import { isolateAudio } from '../services/elevenLabsService';
import AudioWorkstation from './AudioWorkstation';

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

export default function AudioTools() {
  const [activeSubTab, setActiveSubTab] = useState<'workstation' | 'factory' | 'isolation'>('workstation');

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
  const [factoryFile, setFactoryFile] = useState<File | null>(null);
  const [factoryFormat, setFactoryFormat] = useState<'mp3' | 'wav'>('mp3');
  const [factorySampleRate, setFactorySampleRate] = useState<number>(44100);
  const [factoryBitrate, setFactoryBitrate] = useState<number>(128); // for MP3
  const [factoryStatus, setFactoryStatus] = useState<string>('');
  const [factoryLoading, setFactoryLoading] = useState<boolean>(false);
  const [factoryProgress, setFactoryProgress] = useState<number>(0);
  const [factoryError, setFactoryError] = useState<string | null>(null);
  const [factoryAudioUrl, setFactoryAudioUrl] = useState<string | null>(null);
  const [factoryBlob, setFactoryBlob] = useState<Blob | null>(null);
  const [factoryOriginalDuration, setFactoryOriginalDuration] = useState<number | null>(null);

  const factoryInputRef = useRef<HTMLInputElement>(null);
  const [factoryDragActive, setFactoryDragActive] = useState<boolean>(false);

  // ==========================================================
  // MUSIC CONVERSION ACTION
  // ==========================================================
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
      } else {
        // MP3
        finalBlob = encodeMp3(resampledBuffer, factoryBitrate);
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

  const handleFactoryDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFactoryDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFactoryFileChange(e.dataTransfer.files[0]);
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

  return (
    <div id="audio-tools-view" className="flex-1 flex flex-col md:flex-row bg-slate-50 min-h-screen overflow-hidden">
      {/* Sub-navigation Sidebar */}
      <div className="w-full md:w-60 bg-white border-b md:border-b-0 md:border-r border-slate-200 flex flex-col p-4 md:p-5 shrink-0 select-none">
        <div className="space-y-1.5">
          <p className="px-3 text-[10px] font-bold text-emerald-800/80 tracking-wider uppercase mb-2">音频工具</p>
          
          {/* Subtab Button 0: 音频工作站 */}
          <button
            onClick={() => setActiveSubTab('workstation')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
              activeSubTab === 'workstation'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Music className={`w-4 h-4 transition-colors ${activeSubTab === 'workstation' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>音频工作站</span>
          </button>

          {/* Subtab Button 1: 音频转换 */}
          <button
            onClick={() => setActiveSubTab('factory')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
              activeSubTab === 'factory'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <RefreshCw className={`w-4 h-4 transition-colors ${activeSubTab === 'factory' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>音频转换</span>
          </button>

          {/* Subtab Button 2: 人声分离 */}
          <button
            onClick={() => setActiveSubTab('isolation')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
              activeSubTab === 'isolation'
                ? 'bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Sparkles className={`w-4 h-4 transition-colors ${activeSubTab === 'isolation' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>人声分离 (AI)</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Panel */}
      <div className="flex-1 overflow-y-auto p-6 md:p-8">

      {/* ==========================================================
          SUB-TAB 0: AUDIO WORKSTATION
          ========================================================== */}
      {activeSubTab === 'workstation' && (
        <AudioWorkstation />
      )}

      {/* ==========================================================
          SUB-TAB 2: MUSIC CONVERSION FACTORY
          ========================================================== */}
      {activeSubTab === 'factory' && (
        <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Form Options Side */}
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
              <div>
                <h3 className="text-sm font-bold text-slate-800">音频转换</h3>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  多功能音频转化中枢。支持提取视频音轨、格式转换、自由修改采样率 (Sample Rate) 与压缩比特率。
                </p>
              </div>

              {/* Upload Dropzone */}
              <div
                onDragEnter={handleFactoryDrag}
                onDragOver={handleFactoryDrag}
                onDragLeave={handleFactoryDrag}
                onDrop={handleFactoryDrop}
                onClick={() => factoryInputRef.current?.click()}
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
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFactoryFileChange(e.target.files[0]);
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
                    </div>
                    <button
                      type="button"
                      className="text-[10px] text-slate-500 hover:text-emerald-700 font-bold border border-slate-200 px-3 py-1 rounded-lg bg-white shadow-sm cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        factoryInputRef.current?.click();
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
                      <p className="text-xs font-bold text-slate-700">点击上传或将媒体文件拖拽到此处</p>
                      <p className="text-[10px] text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                        支持任意格式，可转换为高保真 WAV 或高压缩 MP3 格式。
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Conversion Config */}
              <div className="bg-slate-50 border border-slate-150 p-5 rounded-2xl space-y-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <Settings className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-bold text-slate-700">格式转换高级属性设定</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* Format Selector */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">目标音频封装格式</label>
                    <div className="grid grid-cols-2 gap-2 bg-slate-200/50 p-1 rounded-xl border border-slate-200/60">
                      <button
                        type="button"
                        onClick={() => setFactoryFormat('mp3')}
                        className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all text-center ${
                          factoryFormat === 'mp3'
                            ? 'bg-white text-emerald-700 shadow-sm border border-slate-250'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        MP3 (高保真压缩)
                      </button>
                      <button
                        type="button"
                        onClick={() => setFactoryFormat('wav')}
                        className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all text-center ${
                          factoryFormat === 'wav'
                            ? 'bg-white text-emerald-700 shadow-sm border border-slate-250'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        WAV (无损原始)
                      </button>
                    </div>
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
                    <span>开始音频转换</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Result Panel Side */}
          <div className="space-y-5">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
              <h3 className="text-sm font-bold text-slate-800">音频转换结果</h3>
              
              {!factoryAudioUrl ? (
                <div className="py-8 text-center text-slate-400 space-y-2">
                  <FolderOpen className="w-8 h-8 mx-auto stroke-1" />
                  <p className="text-xs">等待转换文件</p>
                  <p className="text-[10px] text-slate-400">配置完左侧选项后，点击开始转换获取高保真音频结果。</p>
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
                    </div>
                  </div>

                  {/* Audio Preview */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">音质即时预览</label>
                    <audio 
                      src={factoryAudioUrl} 
                      controls 
                      className="w-full h-8 accent-emerald-600 outline-none rounded-lg"
                    />
                  </div>

                  {/* Download Button */}
                  <button
                    type="button"
                    onClick={() => {
                      if (factoryBlob && factoryFile) {
                        downloadFile(factoryBlob, factoryFile.name, factoryFormat);
                      }
                    }}
                    className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer border border-slate-800"
                  >
                    <Download className="w-4 h-4" />
                    <span>立即下载转换后音频 ({factoryFormat.toUpperCase()})</span>
                  </button>

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
