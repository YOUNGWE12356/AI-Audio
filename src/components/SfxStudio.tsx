/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { 
  Waves, 
  Loader2, 
  Play, 
  Pause, 
  Download, 
  X, 
  Sliders, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  Sparkles,
  Volume2
} from 'lucide-react';
import { HistoryItem } from '../types';

interface SfxStudioProps {
  standalonePrompt: string;
  setStandalonePrompt: (prompt: string) => void;
  standaloneDuration: number;
  setStandaloneDuration: (dur: number) => void;
  standaloneLoading: boolean;
  standaloneAudioUrl: string | null;
  setStandaloneAudioUrl: (url: string | null) => void;
  standaloneError: string | null;
  standaloneAudioRef: React.RefObject<HTMLAudioElement | null>;
  handleStandaloneGenerate: () => void;
  historyList: HistoryItem[];
}

export default function SfxStudio({
  standalonePrompt,
  setStandalonePrompt,
  standaloneDuration,
  setStandaloneDuration,
  standaloneLoading,
  standaloneAudioUrl,
  setStandaloneAudioUrl,
  standaloneError,
  standaloneAudioRef,
  handleStandaloneGenerate,
  historyList
}: SfxStudioProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingHistoryId, setPlayingHistoryId] = useState<string | null>(null);
  
  const historyAudioRefs = useRef<{ [key: string]: HTMLAudioElement | null }>({});

  const toggleMainPlay = () => {
    if (standaloneAudioRef.current) {
      if (isPlaying) {
        standaloneAudioRef.current.pause();
        setIsPlaying(false);
      } else {
        if (playingHistoryId && historyAudioRefs.current[playingHistoryId]) {
          historyAudioRefs.current[playingHistoryId]?.pause();
          setPlayingHistoryId(null);
        }
        standaloneAudioRef.current.play().catch(e => console.error(e));
        setIsPlaying(true);
      }
    }
  };

  const handleHistoryPlayPause = (id: string) => {
    if (isPlaying && standaloneAudioRef.current) {
      standaloneAudioRef.current.pause();
      setIsPlaying(false);
    }

    if (playingHistoryId && playingHistoryId !== id && historyAudioRefs.current[playingHistoryId]) {
      historyAudioRefs.current[playingHistoryId]?.pause();
    }

    const audioObj = historyAudioRefs.current[id];
    if (audioObj) {
      if (playingHistoryId === id) {
        audioObj.pause();
        setPlayingHistoryId(null);
      } else {
        audioObj.play().catch(e => console.error(e));
        setPlayingHistoryId(id);
      }
    }
  };

  const sfxPresets = [
    { label: '激光爆能枪', prompt: 'futuristic high-tech plasma laser cannon blast, sci-fi energy shockwave, sharp transient punch' },
    { label: '金属轰然倒塌', prompt: 'catastrophic destruction, heavy metallic structure collapsing on concrete, dusty debris, resonant reverb' },
    { label: '魔幻治愈涟漪', prompt: 'magical high-pitched healing chime, sparkling positive glitter synth wave, fantasy restoration spell foley' },
    { label: '雨夜林间漫步', prompt: 'gentle pouring rain on dense forest leaves, soft organic footsteps on damp mud, distant rolling thunder rumble' },
    { label: '拟真玻璃粉碎', prompt: 'high pitch glass window shattering, crystal sharp glass shards falling and scattering on wood floor' },
  ];

  const sfxHistory = historyList.filter(item => item.type === 'sfx');

  return (
    <div id="sfxstudio-view" className="flex-1 p-6 space-y-6 max-w-6xl mx-auto w-full">
      {/* Workspace Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <Waves className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">AI Sound Design Studio</span>
          </div>
          <h2 className="text-xl font-black text-slate-800 mt-1">AI 音效</h2>
          <p className="text-xs text-slate-500 mt-1">专业拟音与科幻特技合成，输入文字描述即刻收获极具张力的电影声效。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Input parameters */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
            {/* Description textarea */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block uppercase tracking-wider">音效声音画面描述</label>
              <textarea
                value={standalonePrompt}
                onChange={(e) => setStandalonePrompt(e.target.value)}
                placeholder="例如：重型装甲车履带碾压碎石前进的声音，带有低沉的柴油机轰鸣和石块摩擦细节..."
                className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all resize-none placeholder-slate-400"
              />
            </div>

            {/* Presets Grid */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-450 uppercase">点击载入音效快捷模版：</span>
              <div className="flex flex-wrap gap-2">
                {sfxPresets.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setStandalonePrompt(item.prompt)}
                    className="text-[10px] bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 text-slate-600 hover:text-emerald-700 px-3 py-1.5 rounded-xl transition-all font-semibold"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration slider */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>指定音效长度</span>
                <span className="text-emerald-600 font-mono">{standaloneDuration}秒</span>
              </div>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={standaloneDuration}
                  onChange={(e) => setStandaloneDuration(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                />
              </div>
              <span className="text-[9px] text-slate-400 block">生成范围支持 1s - 20s。由于是音效，推荐保持在 2s - 8s 以内。</span>
            </div>

            {/* Error indicators */}
            {standaloneError && (
              <div className="bg-red-50 border border-red-200 text-red-600 p-3.5 rounded-xl text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{standaloneError}</span>
              </div>
            )}

            {/* Action Generation Button */}
            <button
              onClick={handleStandaloneGenerate}
              disabled={standaloneLoading || !standalonePrompt.trim()}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3.5 rounded-xl text-xs tracking-wider uppercase transition-all shadow-md shadow-emerald-600/10 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {standaloneLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>音效物理引擎 正在渲染中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>生成高保真独立音效</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Output list & card */}
        <div className="lg:col-span-5 space-y-5">
          {/* Main Active Player */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">音效预览及输出波形</h3>
            
            {standaloneLoading ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-10 flex flex-col items-center justify-center text-center space-y-3">
                <div className="w-12 h-12 bg-emerald-50 border border-emerald-200 rounded-full flex items-center justify-center animate-spin">
                  <Waves className="w-5 h-5 text-emerald-600 animate-pulse" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-slate-700">正在录制物理音效...</p>
                  <p className="text-[10px] text-slate-400">大约需要 5 - 10 秒</p>
                </div>
              </div>
            ) : standaloneAudioUrl ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 blur-xl pointer-events-none" />
                <audio 
                  ref={standaloneAudioRef} 
                  src={standaloneAudioUrl} 
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />

                <div className="flex items-center gap-4">
                  <button
                    onClick={toggleMainPlay}
                    className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                      isPlaying 
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-500/20' 
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 hover:text-slate-950'
                    }`}
                  >
                    {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 truncate">AI 独立音效作品</p>
                    <p className="text-[10px] text-slate-500 truncate italic mt-0.5">"{standalonePrompt}"</p>
                    <span className="text-[9px] text-emerald-600 font-semibold mt-1 block">物理长度：{standaloneDuration}秒</span>
                  </div>

                  <button
                    onClick={() => {
                      if (standaloneAudioUrl) URL.revokeObjectURL(standaloneAudioUrl);
                      setStandaloneAudioUrl(null);
                      setIsPlaying(false);
                    }}
                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                    title="清除"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Simulated waveforms */}
                <div className="flex items-end justify-between h-8 bg-slate-200/50 p-2 rounded-lg gap-0.5 border border-slate-200">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <span 
                      key={i} 
                      className="bg-emerald-500 rounded-t w-1"
                      style={{ 
                        height: isPlaying ? `${Math.floor(Math.random() * 95) + 5}%` : '15%',
                        transition: 'height 0.1s ease-in-out'
                      }} 
                    />
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <a
                    href={standaloneAudioUrl}
                    download="generated_sfx.mp3"
                    className="w-full bg-white hover:bg-emerald-50 border border-slate-200 text-slate-700 hover:text-emerald-700 py-2 rounded-xl text-[10px] font-bold text-center transition-all flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>下载 MP3 声音</span>
                  </a>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-slate-200 bg-slate-50 rounded-xl p-10 text-center text-slate-400 text-xs leading-relaxed">
                <Waves className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <span>输入音效设计画面，点击一键录制。系统将自动生成 MP3 声道以供立即试听 and 下载。</span>
              </div>
            )}
          </div>

          {/* Sfx History list */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
              <span>已归档的音效 ({sfxHistory.length})</span>
              <span className="text-[10px] text-slate-400 font-normal">本会话</span>
            </h3>

            {sfxHistory.length === 0 ? (
              <p className="text-slate-400 text-[10px] text-center py-6">暂无历史音效。成功生成的音效将在下面自动保存。</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                {sfxHistory.map((item) => {
                  const isHistPlaying = playingHistoryId === item.id;
                  return (
                    <div key={item.id} className="p-3 bg-slate-50 border border-slate-200 hover:border-emerald-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                      <audio 
                        ref={el => { historyAudioRefs.current[item.id] = el; }} 
                        src={item.url} 
                        onEnded={() => setPlayingHistoryId(null)}
                      />
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <button
                          onClick={() => handleHistoryPlayPause(item.id)}
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                            isHistPlaying 
                              ? 'bg-emerald-600 text-white border-emerald-500' 
                              : 'bg-white text-slate-500 border-slate-200 hover:text-slate-905 hover:bg-slate-50'
                          }`}
                        >
                          {isHistPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                        </button>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-700 truncate text-[11px]">{item.title}</p>
                          <p className="text-[9px] text-slate-400 truncate italic">"{item.prompt}"</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[9px] text-slate-400 font-mono hidden sm:inline">{item.timestamp.split(' ')[1]}</span>
                        <a
                          href={item.url}
                          download={`${item.id}.mp3`}
                          className="p-1 hover:bg-emerald-50 hover:text-emerald-700 text-slate-400 rounded transition-colors"
                          title="下载"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
