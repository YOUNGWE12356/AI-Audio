/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Database, Trash2 } from 'lucide-react';

interface SettingsProps {
  onKeysUpdated?: () => void;
}

export default function SettingsComponent({ onKeysUpdated }: SettingsProps) {
  const [cleared, setCleared] = useState(false);

  const handleClearCache = () => {
    if (typeof window !== 'undefined' && confirm('确定要清空本地浏览器缓存与历史工程记录吗？这不会影响服务器已保存的文件，但会清空您的本地操作历史。')) {
      localStorage.clear();
      setCleared(true);
      if (onKeysUpdated) {
        onKeysUpdated();
      }
      setTimeout(() => setCleared(false), 2500);
      window.location.reload();
    }
  };

  return (
    <div id="settings-view" className="flex-1 p-6 max-w-4xl mx-auto w-full">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3">
          <Database className="w-4 h-4 text-slate-600" />
          <span>数据与本地存储</span>
        </h3>

        <div className="space-y-2 text-xs text-slate-500">
          <p>为了给您提供连贯的体验，您的创意工程进度（如剪辑轨道、配音列表、上传的文件记录）会临时保存在本地浏览器的 LocalStorage 中。</p>
          <p className="text-[10px] text-slate-400 leading-relaxed mt-1">如果您在使用过程中遇到页面卡顿、数据不同步或需要全新重置，可以选择清空本地浏览器缓存。该操作将彻底重置本地的所有会话与历史记录。</p>
        </div>

        <div className="pt-2">
          <button
            onClick={handleClearCache}
            className="w-full bg-slate-50 hover:bg-red-50 text-slate-700 hover:text-red-600 border border-slate-200 hover:border-red-200 font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
          >
            <Trash2 className="w-4 h-4" />
            <span>{cleared ? '本地缓存已清空，正在重载页面...' : '清空本地缓存并重置应用'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
