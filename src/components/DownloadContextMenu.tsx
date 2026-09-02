import React, { useEffect, useRef } from 'react';
import { DownloadItem } from '../types/download';

interface DownloadContextMenuProps {
  x: number;
  y: number;
  download: DownloadItem;
  onClose: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenFile: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onOpenProperties: (download: DownloadItem) => void;
}

export const DownloadContextMenu: React.FC<DownloadContextMenuProps> = ({
  x,
  y,
  download,
  onClose,
  onPause,
  onResume,
  onDelete,
  onOpenFile,
  onOpenFolder,
  onOpenProperties,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const isDownloading = download.status === 'downloading' || download.status === 'probing';
  const isPaused = download.status === 'paused' || download.status === 'queued';

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Constrain position within viewport
  const adjustedX = Math.min(x, window.innerWidth - 270);
  const adjustedY = Math.min(y, window.innerHeight - 280);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(download.url);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{ left: `${adjustedX}px`, top: `${adjustedY}px` }}
      className="fixed z-50 w-64 bg-[#ffffff] border border-[#a0a0a0] shadow-md py-1 text-[12px] text-[#000000] select-none font-sans"
    >
      {/* Resume / Pause */}
      {isPaused && (
        <button
          type="button"
          onClick={() => { onResume(download.id); onClose(); }}
          className="w-full px-4 py-1 flex items-center justify-between hover:bg-[#2563eb] hover:text-white text-left transition-none"
        >
          <span className="font-semibold">Resume Download</span>
          <span className="text-[11px] opacity-70">Space</span>
        </button>
      )}

      {isDownloading && (
        <button
          type="button"
          onClick={() => { onPause(download.id); onClose(); }}
          className="w-full px-4 py-1 flex items-center justify-between hover:bg-[#2563eb] hover:text-white text-left transition-none"
        >
          <span>Pause Download</span>
          <span className="text-[11px] opacity-70">Space</span>
        </button>
      )}

      {/* Open & Open Folder */}
      <button
        type="button"
        onClick={() => { onOpenFile(download.id); onClose(); }}
        className="w-full px-4 py-1 flex items-center justify-between hover:bg-[#2563eb] hover:text-white text-left transition-none font-medium"
      >
        <span>Open</span>
        <span className="text-[11px] opacity-70">Enter</span>
      </button>

      <button
        type="button"
        onClick={() => { onOpenFolder(download.id); onClose(); }}
        className="w-full px-4 py-1 flex items-center justify-between hover:bg-[#2563eb] hover:text-white text-left transition-none"
      >
        <span>Open Containing Folder</span>
      </button>

      <div className="my-1 border-t border-[#e0e0e0]" />

      {/* Copy URL */}
      <button
        type="button"
        onClick={handleCopyUrl}
        className="w-full px-4 py-1 flex items-center justify-between hover:bg-[#2563eb] hover:text-white text-left transition-none"
      >
        <span>Copy Address to Clipboard</span>
        <span className="text-[11px] opacity-70">Ctrl+C</span>
      </button>

      {/* Redownload */}
      <button
        type="button"
        onClick={() => { onResume(download.id); onClose(); }}
        className="w-full px-4 py-1 flex items-center justify-between hover:bg-[#2563eb] hover:text-white text-left transition-none"
      >
        <span>Redownload</span>
      </button>

      <div className="my-1 border-t border-[#e0e0e0]" />

      {/* Delete */}
      <button
        type="button"
        onClick={() => { onDelete(download.id); onClose(); }}
        className="w-full px-4 py-1 flex items-center justify-between hover:bg-[#2563eb] hover:text-white text-left transition-none"
      >
        <span>Delete Download</span>
        <span className="text-[11px] opacity-70">Del</span>
      </button>

      <div className="my-1 border-t border-[#e0e0e0]" />

      {/* Properties */}
      <button
        type="button"
        onClick={() => { onOpenProperties(download); onClose(); }}
        className="w-full px-4 py-1 flex items-center justify-between hover:bg-[#2563eb] hover:text-white text-left transition-none"
      >
        <span>Properties</span>
        <span className="text-[11px] opacity-70">Alt+Enter</span>
      </button>
    </div>
  );
};
