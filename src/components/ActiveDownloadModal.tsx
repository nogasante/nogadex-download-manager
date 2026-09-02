// @ts-nocheck
import React, { useState } from 'react';
import { DownloadItem } from '../types/download';
import { 
  X, 
  Pause, 
  Play, 
  FolderOpen, 
  ExternalLink, 
  Zap, 
  Clock, 
  Activity, 
  HardDrive, 
  CheckCircle2, 
  AlertCircle,
  Minimize2,
  FileArchive,
  Video,
  Music,
  FileCode,
  FileText,
  File
} from 'lucide-react';
import { ChunkVisualizer } from './ChunkVisualizer';

interface ActiveDownloadModalProps {
  item: DownloadItem | null;
  onClose: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onOpenFile: (filePath: string) => void;
  onOpenFolder: (filePath: string) => void;
}

export const ActiveDownloadModal: React.FC<ActiveDownloadModalProps> = ({
  item,
  onClose,
  onPause,
  onResume,
  onCancel,
  onOpenFile,
  onOpenFolder,
}) => {
  const [closeOnComplete, setCloseOnComplete] = useState(true);

  if (!item) return null;

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const formatSpeed = (bps: number) => {
    if (!bps || bps === 0) return '0 B/s';
    if (bps >= 1024 * 1024 * 1024) return `${(bps / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
    if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
    if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${bps} B/s`;
  };

  const formatEta = (seconds: number) => {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--';
    if (seconds < 60) return `${seconds} sec`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins} min ${secs} sec`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} hr ${mins % 60} min`;
  };

  const percent = item.totalBytes > 0 
    ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100))
    : (item.status === 'completed' ? 100 : 0);

  const getFileIcon = (category: string, filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (['zip', 'rar', '7z', 'iso'].includes(ext || '')) return <FileArchive className="w-5 h-5 text-[#d8c8b4]" />;
    if (['mp4', 'mkv', 'avi', 'mov'].includes(ext || '')) return <Video className="w-5 h-5 text-zinc-300" />;
    if (['mp3', 'wav', 'flac'].includes(ext || '')) return <Music className="w-5 h-5 text-zinc-300" />;
    if (['exe', 'msi'].includes(ext || '')) return <FileCode className="w-5 h-5 text-[#d8c8b4]" />;
    if (['pdf', 'docx', 'txt', 'ppt'].includes(ext || '')) return <FileText className="w-5 h-5 text-zinc-300" />;
    return <File className="w-5 h-5 text-zinc-400" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150 select-none">
      {/* Standalone IDM-Style Download Window */}
      <div className="w-full max-w-xl bg-[#121215] border border-[#2e2e34] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Window Title Bar */}
        <div className="h-10 px-4 bg-[#18181c] border-b border-[#27272a] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#d8c8b4] animate-pulse"></span>
            <span className="text-xs font-semibold text-white font-mono truncate max-w-md">
              {percent}% — {item.filename}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={onClose}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#27272a] transition-colors"
              title="Minimize to list"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-[#27272a] transition-colors"
              title="Close window"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 font-mono text-xs">
          {/* Header File Card */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-[#0a0a0c] border border-[#222226]">
            <div className="w-10 h-10 rounded-lg bg-[#18181c] border border-[#2a2a30] flex items-center justify-center flex-shrink-0">
              {getFileIcon(item.category, item.filename)}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-xs font-bold text-white truncate" title={item.filename}>
                {item.filename}
              </h3>
              <div className="text-[10px] text-zinc-500 truncate mt-0.5" title={item.url}>
                {item.url}
              </div>
            </div>
          </div>

          {/* Detailed Metric Grid (Classic IDM Table layout in modern luxury styling) */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-[#18181c] border border-[#24242a] flex justify-between items-center">
              <span className="text-zinc-500">Status:</span>
              <strong className={`uppercase ${
                item.status === 'completed' ? 'text-emerald-400' :
                item.status === 'downloading' ? 'text-[#d8c8b4]' :
                item.status === 'error' ? 'text-rose-400' : 'text-zinc-400'
              }`}>
                {item.status}
              </strong>
            </div>

            <div className="p-2.5 rounded-lg bg-[#18181c] border border-[#24242a] flex justify-between items-center">
              <span className="text-zinc-500">Transfer Rate:</span>
              <strong className="text-white">{item.status === 'downloading' ? formatSpeed(item.speedBps) : '0 B/s'}</strong>
            </div>

            <div className="p-2.5 rounded-lg bg-[#18181c] border border-[#24242a] flex justify-between items-center">
              <span className="text-zinc-500">Downloaded:</span>
              <strong className="text-white">{formatBytes(item.downloadedBytes)}</strong>
            </div>

            <div className="p-2.5 rounded-lg bg-[#18181c] border border-[#24242a] flex justify-between items-center">
              <span className="text-zinc-500">Total File Size:</span>
              <strong className="text-[#d8c8b4]">{item.totalBytes > 0 ? formatBytes(item.totalBytes) : 'Unknown'}</strong>
            </div>

            <div className="p-2.5 rounded-lg bg-[#18181c] border border-[#24242a] flex justify-between items-center">
              <span className="text-zinc-500">Time Left (ETA):</span>
              <strong className="text-white">{item.status === 'downloading' ? formatEta(item.etaSeconds) : '--'}</strong>
            </div>

            <div className="p-2.5 rounded-lg bg-[#18181c] border border-[#24242a] flex justify-between items-center">
              <span className="text-zinc-500">Stream Channels:</span>
              <strong className="text-[#d8c8b4]">{item.chunks?.length || item.connections} Parallel Streams</strong>
            </div>
          </div>

          {/* Main Progress Bar */}
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-zinc-400">Overall Progress</span>
              <span className="font-bold text-white">{percent}%</span>
            </div>
            <div className="h-3 w-full bg-[#0a0a0c] rounded-full overflow-hidden border border-[#27272a] p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  item.status === 'completed'
                    ? 'bg-emerald-400'
                    : item.status === 'downloading'
                    ? 'bg-[#d8c8b4]'
                    : item.status === 'error'
                    ? 'bg-rose-500'
                    : 'bg-zinc-700'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {/* 64-Thread Multi-Segment Matrix */}
          <div className="pt-2">
            <ChunkVisualizer chunks={item.chunks} totalBytes={item.totalBytes} />
          </div>

          {/* Destination Folder Preview */}
          <div className="flex items-center gap-2 text-[10px] text-zinc-500 truncate pt-1 border-t border-[#222226]">
            <HardDrive className="w-3 h-3 text-zinc-400 flex-shrink-0" />
            <span className="truncate">{item.destinationPath}</span>
          </div>
        </div>

        {/* Window Footer Actions */}
        <div className="p-4 bg-[#16161a] border-t border-[#27272a] flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs font-mono text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={closeOnComplete}
              onChange={(e) => setCloseOnComplete(e.target.checked)}
              className="rounded border-[#3f3f46] bg-[#0a0a0d] text-[#d8c8b4] focus:ring-0"
            />
            <span>Close when completed</span>
          </label>

          <div className="flex items-center gap-2">
            {item.status === 'downloading' ? (
              <button
                onClick={() => onPause(item.id)}
                className="px-4 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#34343a] text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </button>
            ) : item.status === 'paused' || item.status === 'error' ? (
              <button
                onClick={() => onResume(item.id)}
                className="px-4 py-1.5 rounded-lg bg-[#d8c8b4] hover:bg-[#e8ded0] text-black text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-black" />
                <span>Resume</span>
              </button>
            ) : (
              <button
                onClick={() => onOpenFile(item.destinationPath)}
                className="px-4 py-1.5 rounded-lg bg-[#1a281e] hover:bg-[#233829] border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open File</span>
              </button>
            )}

            <button
              onClick={() => onOpenFolder(item.destinationPath)}
              className="px-4 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#34343a] text-zinc-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Open Folder</span>
            </button>

            <button
              onClick={() => {
                onCancel(item.id);
                onClose();
              }}
              className="px-4 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-300 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
