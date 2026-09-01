import React, { useState } from 'react';
import { DownloadItem } from '../types/download';
import { 
  Play, 
  Pause, 
  Trash2, 
  FolderOpen, 
  ExternalLink, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  AlertCircle,
  RotateCcw,
  FileArchive,
  Video,
  Music,
  FileCode,
  FileText,
  File
} from 'lucide-react';
import { ChunkVisualizer } from './ChunkVisualizer';

interface DownloadRowProps {
  item: DownloadItem;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenFile: (filePath: string) => void;
  onOpenFolder: (filePath: string) => void;
}

export const DownloadRow: React.FC<DownloadRowProps> = ({
  item,
  onPause,
  onResume,
  onDelete,
  onOpenFile,
  onOpenFolder,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const formatSpeed = (bps: number) => {
    if (!bps || bps === 0) return '';
    if (bps >= 1024 * 1024 * 1024) return `${(bps / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
    if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
    if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${bps} B/s`;
  };

  const formatEta = (seconds: number) => {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '';
    if (seconds < 60) return `${seconds}s left`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs}s left`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m left`;
  };

  const getFileIcon = (category: string, filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (['zip', 'rar', '7z', 'iso'].includes(ext || '')) return <FileArchive className="w-4 h-4 text-[#d8c8b4]" />;
    if (['mp4', 'mkv', 'avi', 'mov'].includes(ext || '')) return <Video className="w-4 h-4 text-zinc-300" />;
    if (['mp3', 'wav', 'flac'].includes(ext || '')) return <Music className="w-4 h-4 text-zinc-300" />;
    if (['exe', 'msi'].includes(ext || '')) return <FileCode className="w-4 h-4 text-[#d8c8b4]" />;
    if (['pdf', 'docx', 'txt', 'ppt'].includes(ext || '')) return <FileText className="w-4 h-4 text-zinc-300" />;
    return <File className="w-4 h-4 text-zinc-400" />;
  };

  const percent = item.totalBytes > 0 
    ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100))
    : (item.status === 'completed' ? 100 : 0);

  return (
    <div className={`item-row bg-[#0e0e11] border rounded-xl p-4 space-y-3 group ${
      item.status === 'error' ? 'border-rose-500/40 bg-rose-950/10' : 'border-[#222226]'
    }`}>
      {/* Top Line: Icon, Title, Status & Live Speed */}
      <div className="flex items-center justify-between gap-4">
        {/* File Name + Category Icon */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#18181c] border border-[#27272a] flex items-center justify-center flex-shrink-0">
            {getFileIcon(item.category, item.filename)}
          </div>
          <div className="min-w-0">
            <h3 
              className="text-xs font-semibold text-white hover:text-[#d8c8b4] cursor-pointer truncate transition-colors"
              title={item.filename}
              onClick={() => item.status === 'completed' && onOpenFile(item.destinationPath)}
            >
              {item.filename}
            </h3>
            <div className="text-[11px] font-mono text-zinc-500 truncate mt-0.5" title={item.destinationPath}>
              {item.destinationPath}
            </div>
          </div>
        </div>

        {/* Right Status & Speed Metrics */}
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right font-mono">
            {item.status === 'downloading' && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#d8c8b4]">{formatSpeed(item.speedBps)}</span>
                <span className="text-zinc-600">•</span>
                <span className="text-xs text-zinc-400">{formatEta(item.etaSeconds)}</span>
                <span className="text-zinc-600">•</span>
                <span className="text-xs font-bold text-white">{percent}%</span>
              </div>
            )}

            {item.status === 'completed' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Complete
              </span>
            )}

            {item.status === 'paused' && (
              <span className="text-xs text-zinc-400 font-medium">
                Paused ({percent}%)
              </span>
            )}

            {item.status === 'error' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400">
                <AlertCircle className="w-3.5 h-3.5" />
                Failed
              </span>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1">
            {item.status === 'downloading' ? (
              <button
                onClick={() => onPause(item.id)}
                className="p-1.5 rounded-md hover:bg-[#222228] text-zinc-400 hover:text-white transition-colors"
                title="Pause"
              >
                <Pause className="w-3.5 h-3.5" />
              </button>
            ) : item.status === 'paused' || item.status === 'error' ? (
              <button
                onClick={() => onResume(item.id)}
                className="p-1.5 rounded-md hover:bg-[#222228] text-[#d8c8b4] hover:text-white transition-colors"
                title="Retry / Resume"
              >
                <Play className="w-3.5 h-3.5 fill-[#d8c8b4]/20" />
              </button>
            ) : (
              <button
                onClick={() => onOpenFile(item.destinationPath)}
                className="p-1.5 rounded-md hover:bg-[#222228] text-emerald-400 hover:text-white transition-colors"
                title="Open File"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              onClick={() => onOpenFolder(item.destinationPath)}
              className="p-1.5 rounded-md hover:bg-[#222228] text-zinc-400 hover:text-white transition-colors"
              title="Show in Folder"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => onDelete(item.id)}
              className="p-1.5 rounded-md hover:bg-rose-950/40 text-zinc-500 hover:text-rose-400 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Error explanation banner if failed */}
      {item.status === 'error' && item.error && (
        <div className="text-[11px] font-mono text-rose-300 bg-rose-950/30 border border-rose-500/20 px-3 py-1.5 rounded-lg flex items-center justify-between">
          <span>Error: {item.error}</span>
          <button 
            onClick={() => onResume(item.id)}
            className="text-xs underline text-[#d8c8b4] hover:text-white flex items-center gap-1 font-bold"
          >
            <RotateCcw className="w-3 h-3" /> Retry Download
          </button>
        </div>
      )}

      {/* Middle Progress Bar */}
      <div className="space-y-1.5">
        <div className="h-1.5 w-full bg-[#18181c] rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 rounded-full ${
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

        {/* Subtitle Line: Downloaded of Total • Threads info */}
        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500">
          <div>
            <strong className="text-zinc-300 font-semibold">{formatBytes(item.downloadedBytes)}</strong>
            <span> of </span>
            <strong className="text-zinc-300 font-semibold">{item.totalBytes > 0 ? formatBytes(item.totalBytes) : 'Unknown'}</strong>
          </div>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-zinc-500 hover:text-[#d8c8b4] transition-colors"
          >
            <span>{item.chunks?.length || item.connections} streams</span>
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Expandable Stream Matrix */}
      {isExpanded && item.chunks && item.chunks.length > 0 && (
        <div className="pt-2 border-t border-[#1f1f24] animate-in fade-in duration-150">
          <ChunkVisualizer chunks={item.chunks} totalBytes={item.totalBytes} />
        </div>
      )}
    </div>
  );
};
