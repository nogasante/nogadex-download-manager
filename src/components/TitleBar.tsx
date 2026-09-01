import React, { useState, useEffect } from 'react';
import { Minus, Square, X, Zap } from 'lucide-react';

export const TitleBar: React.FC = () => {
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    if ((window as any).electronAPI) {
      setIsElectron(true);
    }
  }, []);

  const handleMinimize = () => {
    (window as any).electronAPI?.minimize();
  };

  const handleMaximize = () => {
    (window as any).electronAPI?.maximize();
  };

  const handleClose = () => {
    (window as any).electronAPI?.close();
  };

  return (
    <div 
      className="h-8 bg-[#09090b] border-b border-[#1c1c20] flex items-center justify-between px-3 select-none z-50 text-xs text-zinc-400 font-mono"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* App Branding */}
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded bg-[#d8c8b4] flex items-center justify-center">
          <span className="text-[10px] text-black font-black leading-none">↓</span>
        </div>
        <span className="text-white text-[11px] font-semibold tracking-wide">
          HyperDownloader
        </span>
        <span className="text-[10px] text-zinc-500">v1.0.0</span>
      </div>

      {/* Window Controls for Native Desktop App */}
      <div 
        className="flex items-center h-full -mr-3"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        <button
          onClick={handleMinimize}
          className="h-full px-3 hover:bg-[#1f1f24] text-zinc-400 hover:text-white transition-colors flex items-center justify-center"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={handleMaximize}
          className="h-full px-3 hover:bg-[#1f1f24] text-zinc-400 hover:text-white transition-colors flex items-center justify-center"
          title="Maximize"
        >
          <Square className="w-3 h-3" />
        </button>

        <button
          onClick={handleClose}
          className="h-full px-3 hover:bg-rose-600 text-zinc-400 hover:text-white transition-colors flex items-center justify-center"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
