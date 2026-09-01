import React from 'react';
import { Plus, Play, Pause, FolderOpen, Search, Activity } from 'lucide-react';
import { EngineStats } from '../types/download';

interface HeaderProps {
  onAddUrl: () => void;
  onResumeAll: () => void;
  onPauseAll: () => void;
  onOpenFolder: () => void;
  onSearchChange: (q: string) => void;
  selectedFilter: string;
  onSelectFilter: (filter: string) => void;
  stats: EngineStats;
  counts: { all: number; active: number; completed: number; paused: number };
}

export const Header: React.FC<HeaderProps> = ({
  onAddUrl,
  onResumeAll,
  onPauseAll,
  onOpenFolder,
  onSearchChange,
  selectedFilter,
  onSelectFilter,
  stats,
  counts,
}) => {
  const formatSpeed = (bps: number) => {
    if (!bps || bps === 0) return '0.00 MB/s';
    if (bps >= 1024 * 1024 * 1024) return `${(bps / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
    if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
    if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${bps} B/s`;
  };

  const tabs = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'active', label: 'Active', count: counts.active },
    { id: 'completed', label: 'Completed', count: counts.completed },
    { id: 'paused', label: 'Paused', count: counts.paused },
  ];

  return (
    <header className="h-16 px-6 border-b border-[#27272a] bg-[#09090b] flex items-center justify-between select-none z-20">
      {/* Left: Brand + Filter Tabs */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-[#d8c8b4] flex items-center justify-center font-bold text-black text-xs font-mono">
            ↓
          </div>
          <span className="text-sm font-semibold text-white tracking-tight">
            HyperDownloader
          </span>
        </div>

        {/* Clean Segmented Tab Control */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#141417] border border-[#27272a]">
          {tabs.map((tab) => {
            const isSelected = selectedFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onSelectFilter(tab.id)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  isSelected
                    ? 'bg-[#d8c8b4] text-black font-semibold shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`ml-1.5 text-[10px] font-mono ${isSelected ? 'text-black/70' : 'text-zinc-500'}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Actions & Global Speed */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative w-48">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search..."
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#141417] border border-[#27272a] focus:border-[#d8c8b4] text-xs text-white placeholder-zinc-500 outline-none transition-colors"
          />
        </div>

        {/* Global Speed Telemetry */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#141417] border border-[#27272a] text-xs font-mono text-zinc-300">
          <Activity className={`w-3.5 h-3.5 ${stats.totalSpeedBps > 0 ? 'text-[#d8c8b4]' : 'text-zinc-600'}`} />
          <span className="font-semibold text-[#d8c8b4]">{formatSpeed(stats.totalSpeedBps)}</span>
        </div>

        <div className="w-[1px] h-4 bg-[#27272a] mx-1" />

        {/* Bulk Action Buttons */}
        <button
          onClick={onResumeAll}
          className="p-2 rounded-lg bg-[#141417] hover:bg-[#1f1f25] border border-[#27272a] text-zinc-300 hover:text-white transition-colors"
          title="Resume All"
        >
          <Play className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onPauseAll}
          className="p-2 rounded-lg bg-[#141417] hover:bg-[#1f1f25] border border-[#27272a] text-zinc-300 hover:text-white transition-colors"
          title="Pause All"
        >
          <Pause className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onOpenFolder}
          className="p-2 rounded-lg bg-[#141417] hover:bg-[#1f1f25] border border-[#27272a] text-zinc-300 hover:text-white transition-colors"
          title="Open Downloads Folder"
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </button>

        {/* Primary + New Download Button */}
        <button
          onClick={onAddUrl}
          className="px-4 py-1.5 rounded-lg bg-[#d8c8b4] hover:bg-[#e8ded0] text-black font-semibold text-xs flex items-center gap-1.5 active:scale-95 transition-all shadow-sm"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>New</span>
        </button>
      </div>
    </header>
  );
};
