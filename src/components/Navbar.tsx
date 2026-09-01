import React from 'react';
import { Zap, Plus, Download, Activity, FolderOpen } from 'lucide-react';
import { EngineStats } from '../types/download';

interface NavbarProps {
  stats: EngineStats;
  onOpenNewModal: () => void;
  onOpenFolder: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ stats, onOpenNewModal, onOpenFolder }) => {
  const formatSpeed = (bps: number) => {
    if (bps >= 1024 * 1024 * 1024) return `${(bps / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
    if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
    if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${bps} B/s`;
  };

  return (
    <header className="h-16 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md px-6 flex items-center justify-between z-30 sticky top-0">
      {/* Brand & Logo */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-emerald-400 p-[1px] glow-cyan">
          <div className="w-full h-full bg-slate-950 rounded-[11px] flex items-center justify-center">
            <Zap className="w-5 h-5 text-cyan-400 fill-cyan-400/20 animate-pulse-fast" />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-extrabold text-lg tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400">
              HYPER<span className="text-white font-light">DOWNLOADER</span>
            </h1>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-500/30 uppercase tracking-widest">
              64-Thread Turbo
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
            Zero-Copy Direct Disk Engine
          </p>
        </div>
      </div>

      {/* Real-Time Speedometer & Action Buttons */}
      <div className="flex items-center gap-4">
        {/* Global Live Speed Display */}
        <div className="flex items-center gap-3 px-4 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-inner">
          <Activity className={`w-4 h-4 ${stats.totalSpeedBps > 0 ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
          <div className="text-right">
            <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Total Speed</div>
            <div className="text-sm font-mono font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
              {formatSpeed(stats.totalSpeedBps)}
            </div>
          </div>
        </div>

        {/* Open Download Folder Button */}
        <button
          onClick={onOpenFolder}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-900/80 border border-slate-800 hover:border-slate-700 hover:text-white transition-all duration-200 active:scale-95"
          title="Open Downloads Folder"
        >
          <FolderOpen className="w-4 h-4 text-cyan-400" />
          <span className="hidden sm:inline">Folder</span>
        </button>

        {/* New Download Button */}
        <button
          onClick={onOpenNewModal}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 transition-all duration-200 shadow-lg shadow-cyan-500/20 active:scale-95 glow-cyan"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>New Download</span>
          <kbd className="hidden sm:inline ml-1 px-1.5 py-0.5 rounded bg-black/20 text-[10px] font-mono text-slate-900 border border-black/10">
            Ctrl+N
          </kbd>
        </button>
      </div>
    </header>
  );
};
