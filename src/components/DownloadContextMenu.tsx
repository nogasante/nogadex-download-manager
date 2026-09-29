import React, { useRef } from 'react';
import { DownloadItem } from '../types/download';
import { useOutsideClick } from '../hooks/useOutsideClick';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { isDownloadActive, isDownloadResumable } from '../utils/downloadHelpers';

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
  /** Available queues for the "Move to queue" submenu. */
  queues?: Array<{ id: string; name: string }>;
  /** Currently owning queue id for this download (shown checked). */
  currentQueueId?: string;
  onMoveToQueue?: (downloadId: string, queueId: string) => void;
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
  queues = [],
  currentQueueId,
  onMoveToQueue,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const isDownloading = isDownloadActive(download.status);
  const isPaused = isDownloadResumable(download.status);

  useOutsideClick(menuRef, onClose);
  useEscapeKey(onClose);

  // Constrain position within viewport
  const estimatedHeight = 300 + queues.length * 26;
  const adjustedX = Math.min(x, window.innerWidth - 270);
  const adjustedY = Math.min(y, window.innerHeight - estimatedHeight);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(download.url);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{ left: `${adjustedX}px`, top: `${adjustedY}px` }}
      className="fixed z-50 w-64 bg-white border border-neutral-400 shadow-md py-1 text-[12px] text-black select-none font-sans"
    >
      {/* Resume / Pause */}
      {isPaused && (
        <button
          type="button"
          onClick={() => { onResume(download.id); onClose(); }}
          className="w-full px-4 py-1 flex items-center justify-between hover:bg-brand-glow hover:text-white text-left transition-none"
        >
          <span className="font-semibold">Resume Download</span>
          <span className="text-[11px] opacity-70">Space</span>
        </button>
      )}

      {isDownloading && (
        <button
          type="button"
          onClick={() => { onPause(download.id); onClose(); }}
          className="w-full px-4 py-1 flex items-center justify-between hover:bg-brand-glow hover:text-white text-left transition-none"
        >
          <span>Pause Download</span>
          <span className="text-[11px] opacity-70">Space</span>
        </button>
      )}

      {/* Open & Open Folder */}
      <button
        type="button"
        onClick={() => { onOpenFile(download.id); onClose(); }}
        className="w-full px-4 py-1 flex items-center justify-between hover:bg-brand-glow hover:text-white text-left transition-none font-medium"
      >
        <span>Open</span>
        <span className="text-[11px] opacity-70">Enter</span>
      </button>

      <button
        type="button"
        onClick={() => { onOpenFolder(download.id); onClose(); }}
        className="w-full px-4 py-1 flex items-center justify-between hover:bg-brand-glow hover:text-white text-left transition-none"
      >
        <span>Open Containing Folder</span>
      </button>

      <div className="my-1 border-t border-neutral-200" />

      {/* Copy URL */}
      <button
        type="button"
        onClick={handleCopyUrl}
        className="w-full px-4 py-1 flex items-center justify-between hover:bg-brand-glow hover:text-white text-left transition-none"
      >
        <span>Copy Address to Clipboard</span>
        <span className="text-[11px] opacity-70">Ctrl+C</span>
      </button>

      {/* Redownload */}
      <button
        type="button"
        onClick={() => { onResume(download.id); onClose(); }}
        className="w-full px-4 py-1 flex items-center justify-between hover:bg-brand-glow hover:text-white text-left transition-none"
      >
        <span>Redownload</span>
      </button>

      {/* Refresh Download Address */}
      <button
        type="button"
        onClick={() => {
          if ((window as any).electronAPI?.openWindow) {
            (window as any).electronAPI.openWindow('refresh-url', { id: download.id });
          }
          onClose();
        }}
        className="w-full px-4 py-1 flex items-center justify-between hover:bg-brand-glow hover:text-white text-left transition-none"
      >
        <span>Refresh Download Address</span>
      </button>

      {/* Move to queue: only when queues exist and a handler is wired. */}
      {queues.length > 0 && onMoveToQueue && (
        <>
          <div className="my-1 border-t border-neutral-200" />
          <div className="px-4 py-1 text-[10.5px] uppercase tracking-wide text-neutral-400">Move to queue</div>
          {queues.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => { onMoveToQueue(download.id, q.id); onClose(); }}
              className="w-full px-4 py-1 flex items-center justify-between hover:bg-brand-glow hover:text-white text-left transition-none"
            >
              <span>{q.name}</span>
              {currentQueueId === q.id && <span className="text-[11px] opacity-70">current</span>}
            </button>
          ))}
        </>
      )}

      <div className="my-1 border-t border-neutral-200" />

      {/* Delete */}
      <button
        type="button"
        onClick={() => { onDelete(download.id); onClose(); }}
        className="w-full px-4 py-1 flex items-center justify-between hover:bg-brand-glow hover:text-white text-left transition-none"
      >
        <span>Delete Download</span>
        <span className="text-[11px] opacity-70">Del</span>
      </button>

      <div className="my-1 border-t border-neutral-200" />

      {/* Properties */}
      <button
        type="button"
        onClick={() => { onOpenProperties(download); onClose(); }}
        className="w-full px-4 py-1 flex items-center justify-between hover:bg-brand-glow hover:text-white text-left transition-none"
      >
        <span>Properties</span>
        <span className="text-[11px] opacity-70">Alt+Enter</span>
      </button>
    </div>
  );
};
