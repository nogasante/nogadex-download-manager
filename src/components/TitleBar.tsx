import React from 'react';
import { Minus, Square, X } from 'lucide-react';
import { APP_NAME } from '../config/appInfo';
import ndmLogo from '../assets/logo.png';

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
      className="h-8 ndm-titlebar flex items-center justify-between px-3 select-none text-[13px] font-sans shrink-0 z-50"
    >
      {/* Brand & Logo */}
      <div className="flex items-center gap-2">
        <img
          src={ndmLogo}
          alt={APP_NAME}
          className="w-[22px] h-[22px] shrink-0 object-contain pointer-events-none"
          style={{ imageRendering: '-webkit-optimize-contrast' }}
        />
        <span className="font-semibold text-neutral-800 tracking-tight">
          {APP_NAME}
        </span>
      </div>

      {/* Windows System Control Buttons */}
      <div 
        style={{ WebkitAppRegion: 'no-drag' } as any}
        className="flex items-center h-full -mr-3"
      >
        <button
          onClick={handleMinimize}
          className="w-11 h-full flex items-center justify-center hover:bg-neutral-100 text-neutral-600 transition-colors"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={handleMaximize}
          className="w-11 h-full flex items-center justify-center hover:bg-neutral-100 text-neutral-600 transition-colors"
          title="Maximize"
        >
          <Square className="w-3 h-3 stroke-[1.5]" />
        </button>

        <button
          onClick={handleClose}
          className="w-11 h-full flex items-center justify-center hover:bg-danger hover:text-white text-neutral-600 transition-colors"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
