import React from 'react';
import { 
  Plus, 
  Play, 
  Pause, 
  Trash2, 
  FolderOpen, 
  Zap, 
  Search, 
  Activity,
  Layers,
  ArrowDownCircle
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
    <header className="h-14 px-5 bg-[#0f131f] border-b border-[#1f273d] flex items-center justify-between gap-4 select-none z-20">
      {/* Brand & Left Actions */}
      <div className="flex items-center gap-4">
        {/* Brand Icon & Title */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-600 p-[1px] shadow-lg shadow-cyan-500/10 flex items-center justify-center">
            <div className="w-full h-full bg-[#0f131f] rounded-[7px] flex items-center justify-center">
              <Zap className="w-4 h-4 text-cyan-400 fill-cyan-400/20" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-slate-100 tracking-wide">
                HYPER<span className="text-cyan-400 font-light">DOWNLOADER</span>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/30 text-[9px] font-mono font-bold text-cyan-400 uppercase tracking-wider">
                64-Turbo
              </span>
            </div>
          </div>
        </div>

        <div className="w-[1px] h-6 bg-[#1f273d] mx-1 hidden md:block" />

        {/* Primary Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onAddUrl}
            className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-cyan-500/15 active:scale-95 transition-all"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3]" />
            <span>New Download</span>
            <kbd className="hidden lg:inline px-1 py-0.2 rounded bg-black/25 text-[9px] font-mono text-cyan-200">
              Ctrl+N
            </kbd>
          </button>

          <button
            onClick={onResumeAll}
            className="px-3 py-1.5 rounded-lg bg-[#161b2b] hover:bg-[#20273d] border border-[#26314d] text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 transition-all"
            title="Resume All Downloads"
          >
            <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400/20" />
            <span className="hidden sm:inline">Resume All</span>
          </button>

          <button
            onClick={onPauseAll}
            className="px-3 py-1.5 rounded-lg bg-[#161b2b] hover:bg-[#20273d] border border-[#26314d] text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 transition-all"
            title="Pause All Downloads"
          >
            <Pause className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Pause All</span>
          </button>

          <button
            onClick={onDeleteSelected}
            disabled={selectedCount === 0}
            className="px-3 py-1.5 rounded-lg bg-[#161b2b] hover:bg-rose-950/60 border border-[#26314d] hover:border-rose-500/40 text-xs font-semibold text-slate-300 hover:text-rose-400 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1.5 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Delete {selectedCount > 0 ? `(${selectedCount})` : ''}</span>
          </button>

          <button
            onClick={onOpenFolder}
            className="px-3 py-1.5 rounded-lg bg-[#161b2b] hover:bg-[#20273d] border border-[#26314d] text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 transition-all hidden sm:flex"
            title="Open Downloads Folder"
          >
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>Folder</span>
          </button>
        </div>
      </div>

      {/* Right Telemetry & Search */}
      <div className="flex items-center gap-3">
        {/* Speed Badge */}
        <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-lg bg-[#151b2b] border border-[#222b42] shadow-inner">
          <Activity className={`w-3.5 h-3.5 ${stats.totalSpeedBps > 0 ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
          <div className="text-right flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase text-slate-400">Total:</span>
            <span className="text-xs font-mono font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-300">
              {formatSpeed(stats.totalSpeedBps)}
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="relative w-56 hidden sm:block">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by filename or url..."
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#121624] border border-[#222b42] focus:border-cyan-500 text-xs font-mono text-slate-200 placeholder-slate-500 outline-none transition-colors"
          />
        </div>
      </div>
    </header>
  );
};
