import React from 'react';
import { Minus, Square, X } from 'lucide-react';

export const TitleBar: React.FC = () => {
  const menus = ['Tasks', 'File', 'Downloads', 'View', 'Help', 'Registration'];

  return (
    <div className="h-9 px-3.5 bg-[#161926] border-b border-[#282e42] flex items-center justify-between select-none">
      {/* Left: App Logo & Classic Top Menus */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {/* Windows 11 IDM Colorful Icon */}
          <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-amber-400 via-emerald-400 to-cyan-400 flex items-center justify-center p-[1px] shadow-sm">
            <div className="w-full h-full bg-[#161926] rounded-full flex items-center justify-center text-[8px] font-bold text-cyan-300">
              ↓
            </div>
          </div>
          <span className="text-xs font-semibold text-slate-200 tracking-wide">
            Internet Download Manager
          </span>
        </div>

        {/* Menu Bar Items */}
        <div className="hidden md:flex items-center gap-1 text-[11px] text-slate-400 font-normal">
          {menus.map((m) => (
            <button
              key={m}
              className="px-2 py-0.5 rounded hover:bg-[#252b3d] hover:text-slate-100 transition-colors"
            >
              {m}
            </button>
          ))}
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
