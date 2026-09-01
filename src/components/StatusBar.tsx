import React from 'react';
import { HardDrive, Activity, CheckCircle2, DownloadCloud, PauseCircle, ShieldCheck } from 'lucide-react';
import { DownloadItem, EngineStats } from '../types/download';

interface StatusBarProps {
  stats: EngineStats;
  downloads: DownloadItem[];
  defaultPath: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({ stats, downloads, defaultPath }) => {
  const activeCount = downloads.filter(d => d.status === 'downloading' || d.status === 'probing').length;
  const completedCount = downloads.filter(d => d.status === 'completed').length;
  const totalDownloadedBytes = downloads.reduce((acc, d) => acc + d.downloadedBytes, 0);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  return (
    <footer className="h-8 bg-[#0a0a0c] border-t border-[#222226] px-4 flex items-center justify-between text-[11px] font-mono text-zinc-400 select-none z-30">
      {/* Left: Task Aggregation */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#d8c8b4] animate-pulse"></span>
          <span className="font-semibold text-white">Engine Online</span>
        </div>

        <div className="w-[1px] h-3.5 bg-[#27272a]" />

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[#d8c8b4] font-semibold">
            <DownloadCloud className="w-3.5 h-3.5" />
            {activeCount} Active
          </span>
          <span className="flex items-center gap-1.5 text-zinc-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            {completedCount} Finished
          </span>
          <span className="text-zinc-500">({downloads.length} Total Tasks)</span>
        </div>
      </div>

      {/* Right: Data Transferred & Disk Location */}
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Total Transferred:</span>
          <strong className="text-white font-bold">{formatBytes(totalDownloadedBytes)}</strong>
        </div>

        <div className="w-[1px] h-3.5 bg-[#27272a]" />

        <div className="flex items-center gap-1.5 text-zinc-400 truncate max-w-xs" title={defaultPath}>
          <HardDrive className="w-3.5 h-3.5 text-[#d8c8b4]" />
          <span className="truncate">{defaultPath || 'Downloads/HyperDownloader'}</span>
        </div>
      </div>
    </footer>
  );
};
