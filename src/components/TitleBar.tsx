import React from 'react';
import { Minus, Square, X } from 'lucide-react';

export const TitleBar: React.FC = () => {
  const handleMinimize = () => {
    if ((window as any).electronAPI?.minimize) (window as any).electronAPI.minimize();
  };

  const handleMaximize = () => {
    if ((window as any).electronAPI?.maximize) (window as any).electronAPI.maximize();
  };

  const handleClose = () => {
    if ((window as any).electronAPI?.close) (window as any).electronAPI.close();
  };

  return (
    <div 
      style={{ WebkitAppRegion: 'drag' } as any}
      className="h-8 bg-[#ffffff] border-b border-[#e2e8f0] flex items-center justify-between px-3 select-none text-[13px] font-sans shrink-0 z-50 shadow-sm"
    >
      {/* Brand & Logo */}
      <div className="flex items-center gap-2">
        <img
          src="/logo.png"
          alt="Nogadex Logo"
          className="w-5 h-5 rounded-[4px] object-contain drop-shadow-sm pointer-events-none"
        />
        <span className="font-semibold text-[#1e293b] tracking-tight">
          Nogadex Download Manager
        </span>
      </div>

      {/* Windows System Control Buttons */}
      <div 
        style={{ WebkitAppRegion: 'no-drag' } as any}
        className="flex items-center h-full -mr-3"
      >
        <button
          onClick={handleMinimize}
          className="w-11 h-full flex items-center justify-center hover:bg-[#f1f5f9] text-[#475569] transition-colors"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={handleMaximize}
          className="w-11 h-full flex items-center justify-center hover:bg-[#f1f5f9] text-[#475569] transition-colors"
          title="Maximize"
        >
          <Square className="w-3 h-3 stroke-[1.5]" />
        </button>

        <button
          onClick={handleClose}
          className="w-11 h-full flex items-center justify-center hover:bg-[#e11d48] hover:text-white text-[#475569] transition-colors"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
