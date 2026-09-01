import React from 'react';
import { Zap, Minus, Square, X, ShieldCheck } from 'lucide-react';

interface TitleBarProps {
  activeCount: number;
}

export const TitleBar: React.FC<TitleBarProps> = ({ activeCount }) => {
  return (
    <div className="h-9 px-3.5 bg-[#161926] border-b border-[#282e42] flex items-center justify-between select-none">
      {/* Left: Brand + Status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-cyan-500 to-emerald-400 flex items-center justify-center p-[1px]">
            <div className="w-full h-full bg-[#161926] rounded-[5px] flex items-center justify-center">
              <Zap className="w-3 h-3 text-cyan-400 fill-cyan-400/20" />
            </div>
          </div>
          <span className="text-xs font-bold text-slate-100 tracking-wide">
            HyperDownloader <span className="text-cyan-400 font-mono text-[10px] font-normal px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/20 ml-1">64-THREAD TURBO</span>
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400 border-l border-slate-700/60 pl-3">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>100% Free & Open-Source</span>
        </div>
      </div>

      {/* Right: Window Controls */}
      <div className="flex items-center -mr-1">
        <button className="w-9 h-7 flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#262d40] transition-colors rounded-sm">
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button className="w-9 h-7 flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#262d40] transition-colors rounded-sm">
          <Square className="w-3 h-3" />
        </button>
        <button className="w-9 h-7 flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-600 transition-colors rounded-sm">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
