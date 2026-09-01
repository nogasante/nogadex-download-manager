import React from 'react';
import { 
  Plus, 
  Play, 
  Pause, 
  Trash2, 
  FolderOpen, 
  Zap, 
  Search, 
  Settings,
  Activity
} from 'lucide-react';
import { EngineStats } from '../types/download';

interface FluentToolbarProps {
  onAddUrl: () => void;
  onResumeAll: () => void;
  onPauseAll: () => void;
  onDeleteSelected: () => void;
  onOpenFolder: () => void;
  onSearchChange: (q: string) => void;
  selectedCount: number;
  stats: EngineStats;
}

export const FluentToolbar: React.FC<FluentToolbarProps> = ({
  onAddUrl,
  onResumeAll,
  onPauseAll,
  onDeleteSelected,
  onOpenFolder,
  onSearchChange,
  selectedCount,
  stats,
}) => {
  const formatSpeed = (bps: number) => {
    if (!bps || bps === 0) return '0.00 MB/s';
    if (bps >= 1024 * 1024 * 1024) return `${(bps / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
    if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
    if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${bps} B/s`;
  };

  return (
    <div className="px-4 py-2 bg-[#1b1f2e] border-b border-[#282e42] flex items-center justify-between gap-3 overflow-x-auto select-none">
      {/* Functional Engine Action Buttons */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* + Add URL (Primary Action) */}
        <button
          onClick={onAddUrl}
          className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
        >
          <Plus className="w-3.5 h-3.5 stroke-[3]" />
          <span>New Download</span>
          <span className="hidden sm:inline px-1 py-0.2 rounded bg-black/25 text-[9px] font-mono text-cyan-200 ml-1">
            Ctrl+N
          </span>
        </button>

        {/* Resume All */}
        <button
          onClick={onResumeAll}
          className="fluent-toolbar-btn px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white"
          title="Resume active downloads"
        >
          <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400/20" />
          <span>Resume All</span>
        </button>

        {/* Pause All */}
        <button
          onClick={onPauseAll}
          className="fluent-toolbar-btn px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white"
          title="Pause all downloads"
        >
          <Pause className="w-3.5 h-3.5 text-amber-400" />
          <span>Pause All</span>
        </button>

        {/* Delete Selected */}
        <button
          onClick={onDeleteSelected}
          disabled={selectedCount === 0}
          className="fluent-toolbar-btn px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-rose-400 disabled:opacity-40 disabled:pointer-events-none"
        >
          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
          <span>Delete ({selectedCount})</span>
        </button>

        <div className="w-[1px] h-5 bg-[#2d3448] mx-1" />

        {/* Open Download Folder */}
        <button
          onClick={onOpenFolder}
          className="fluent-toolbar-btn px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white"
          title="Open Downloads Folder"
        >
          <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
          <span>Open Folder</span>
        </button>
      </div>

      {/* Right: Live Global Speedometer & Search */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Live Throughput Badge */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[#121520] border border-[#282e42] text-xs font-mono">
          <Activity className={`w-3.5 h-3.5 ${stats.totalSpeedBps > 0 ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
          <span className="text-slate-400 text-[11px]">Speed:</span>
          <span className="font-bold text-cyan-300">{formatSpeed(stats.totalSpeedBps)}</span>
        </div>

        {/* Search */}
        <div className="relative w-44">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search downloads..."
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1 rounded-lg bg-[#141722] border border-[#2b3145] focus:border-cyan-500 text-xs text-slate-200 placeholder-slate-500 outline-none transition-colors"
          />
        </div>
      </div>
    </div>
  );
};
