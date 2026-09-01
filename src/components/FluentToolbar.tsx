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
  ArrowDown
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
    <header className="h-14 px-5 bg-[#0d0d10] border-b border-[#222226] flex items-center justify-between gap-4 select-none z-20">
      {/* Brand & Left Actions */}
      <div className="flex items-center gap-4">
        {/* Brand Icon & Title */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#d8c8b4] flex items-center justify-center shadow-md">
            <Zap className="w-4 h-4 text-black fill-black" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-white tracking-wider font-mono">
                HYPER<span className="text-[#d8c8b4] font-light">DOWNLOADER</span>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-[#1f1d19] border border-[#d8c8b4]/30 text-[9px] font-mono font-bold text-[#d8c8b4] uppercase">
                64-Thread
              </span>
            </div>
          </div>
        </div>

        <div className="w-[1px] h-6 bg-[#27272a] mx-1 hidden md:block" />

        {/* Primary Action Buttons */}
        <div className="flex items-center gap-2">
          {/* New Download in Warm Beige Accent */}
          <button
            onClick={onAddUrl}
            className="px-3.5 py-1.5 rounded-lg bg-[#d8c8b4] hover:bg-[#e8ded0] text-black font-bold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3] text-black" />
            <span>New Download</span>
            <kbd className="hidden lg:inline px-1 py-0.2 rounded bg-black/15 text-[9px] font-mono text-black/80 ml-1">
              Ctrl+N
            </kbd>
          </button>

          <button
            onClick={onResumeAll}
            className="px-3 py-1.5 rounded-lg bg-[#18181c] hover:bg-[#232328] border border-[#2e2e33] text-xs font-semibold text-[#d4d4d8] hover:text-white flex items-center gap-1.5 transition-all"
            title="Resume All Downloads"
          >
            <Play className="w-3.5 h-3.5 text-[#d8c8b4] fill-[#d8c8b4]/20" />
            <span className="hidden sm:inline">Resume All</span>
          </button>

          <button
            onClick={onPauseAll}
            className="px-3 py-1.5 rounded-lg bg-[#18181c] hover:bg-[#232328] border border-[#2e2e33] text-xs font-semibold text-[#d4d4d8] hover:text-white flex items-center gap-1.5 transition-all"
            title="Pause All Downloads"
          >
            <Pause className="w-3.5 h-3.5 text-zinc-400" />
            <span className="hidden sm:inline">Pause All</span>
          </button>

          <button
            onClick={onDeleteSelected}
            disabled={selectedCount === 0}
            className="px-3 py-1.5 rounded-lg bg-[#18181c] hover:bg-rose-950/60 border border-[#2e2e33] hover:border-rose-500/40 text-xs font-semibold text-[#d4d4d8] hover:text-rose-300 disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1.5 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Delete {selectedCount > 0 ? `(${selectedCount})` : ''}</span>
          </button>

          <button
            onClick={onOpenFolder}
            className="px-3 py-1.5 rounded-lg bg-[#18181c] hover:bg-[#232328] border border-[#2e2e33] text-xs font-semibold text-[#d4d4d8] hover:text-white flex items-center gap-1.5 transition-all hidden sm:flex"
            title="Open Downloads Folder"
          >
            <FolderOpen className="w-3.5 h-3.5 text-[#d8c8b4]" />
            <span>Folder</span>
          </button>
        </div>
      </div>

      {/* Right Telemetry & Search */}
      <div className="flex items-center gap-3">
        {/* Speed Badge in Black & Beige */}
        <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-lg bg-[#141417] border border-[#27272a]">
          <Activity className={`w-3.5 h-3.5 ${stats.totalSpeedBps > 0 ? 'text-[#d8c8b4] animate-pulse' : 'text-zinc-500'}`} />
          <div className="text-right flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase text-zinc-400">Throughput:</span>
            <span className="text-xs font-mono font-bold text-[#d8c8b4]">
              {formatSpeed(stats.totalSpeedBps)}
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="relative w-56 hidden sm:block">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search downloads..."
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#141417] border border-[#27272a] focus:border-[#d8c8b4] text-xs font-mono text-white placeholder-zinc-500 outline-none transition-colors"
          />
        </div>
      </div>
    </header>
  );
};
