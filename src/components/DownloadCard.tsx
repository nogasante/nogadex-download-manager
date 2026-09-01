import React, { useState } from 'react';
import { 
  Pause, 
  Play, 
  Trash2, 
  FolderOpen, 
  ExternalLink, 
  FileArchive, 
  Video, 
  Music, 
  FileCode, 
  FileText, 
  File, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Clock,
  Gauge
} from 'lucide-react';
import { DownloadItem } from '../types/download';
import { ChunkVisualizer } from './ChunkVisualizer';

interface DownloadCardProps {
  item: DownloadItem;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string, deleteFile: boolean) => void;
  onOpenFolder: (filePath: string) => void;
  onOpenFile: (filePath: string) => void;
}

export const DownloadCard: React.FC<DownloadCardProps> = ({
  item,
  onPause,
  onResume,
  onRemove,
  onOpenFolder,
  onOpenFile,
}) => {
  const [showChunks, setShowChunks] = useState(true);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const formatSpeed = (bps: number) => {
    if (bps >= 1024 * 1024 * 1024) return `${(bps / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
    if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
    if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${bps} B/s`;
  };

  const formatEta = (seconds: number) => {
    if (seconds <= 0 || !isFinite(seconds)) return '--';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  };

  const getCategoryIcon = (category: DownloadItem['category']) => {
    switch (category) {
      case 'video': return <Video className="w-5 h-5 text-indigo-400" />;
      case 'audio': return <Music className="w-5 h-5 text-pink-400" />;
      case 'compressed': return <FileArchive className="w-5 h-5 text-amber-400" />;
      case 'program': return <FileCode className="w-5 h-5 text-cyan-400" />;
      case 'document': return <FileText className="w-5 h-5 text-blue-400" />;
      default: return <File className="w-5 h-5 text-slate-400" />;
    }
  };

  const progressPercent = item.totalBytes > 0 
    ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100))
    : (item.status === 'completed' ? 100 : 0);

  return (
    <div className="bg-slate-900/70 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-4.5 backdrop-blur-md transition-all duration-200 shadow-lg space-y-3.5 group">
      {/* Top Row: Icon, File Name, Controls */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-inner">
            {getCategoryIcon(item.category)}
          </div>
          <div className="min-w-0">
            <h3 
              className="text-sm font-semibold text-slate-100 truncate cursor-pointer hover:text-cyan-400 transition-colors"
              title={item.filename}
              onClick={() => item.status === 'completed' && onOpenFile(item.destinationPath)}
            >
              {item.filename}
            </h3>
            <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400 mt-0.5">
              <span>{formatBytes(item.downloadedBytes)} / {item.totalBytes > 0 ? formatBytes(item.totalBytes) : 'Unknown'}</span>
              <span className="text-slate-600">•</span>
              <span className="truncate max-w-[200px] text-slate-500" title={item.url}>{item.url}</span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {item.status === 'downloading' && (
            <button
              onClick={() => onPause(item.id)}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-all active:scale-95"
              title="Pause Download"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}

          {(item.status === 'paused' || item.status === 'error') && (
            <button
              onClick={() => onResume(item.id)}
              className="p-2 rounded-xl bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/30 text-cyan-400 transition-all active:scale-95"
              title="Resume Download"
            >
              <Play className="w-4 h-4 fill-cyan-400/20" />
            </button>
          )}

          {item.status === 'completed' && (
            <button
              onClick={() => onOpenFile(item.destinationPath)}
              className="p-2 rounded-xl bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/30 text-emerald-400 transition-all active:scale-95"
              title="Open File"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => onOpenFolder(item.destinationPath)}
            className="p-2 rounded-xl bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white transition-all active:scale-95"
            title="Show in Folder"
          >
            <FolderOpen className="w-4 h-4" />
          </button>

          <button
            onClick={() => onRemove(item.id, false)}
            className="p-2 rounded-xl bg-slate-800/60 hover:bg-rose-950/80 hover:text-rose-400 text-slate-400 transition-all active:scale-95"
            title="Remove from list"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Overall Progress Bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2">
            {item.status === 'downloading' && (
              <span className="flex items-center gap-1 text-cyan-400 font-bold">
                <Gauge className="w-3.5 h-3.5" />
                {formatSpeed(item.speedBps)}
              </span>
            )}
            {item.status === 'probing' && (
              <span className="flex items-center gap-1 text-amber-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Probing Stream...
              </span>
            )}
            {item.status === 'completed' && (
              <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Complete
              </span>
            )}
            {item.status === 'paused' && (
              <span className="flex items-center gap-1 text-slate-400">
                <Pause className="w-3.5 h-3.5" />
                Paused
              </span>
            )}
            {item.status === 'error' && (
              <span className="flex items-center gap-1 text-rose-400">
                <AlertCircle className="w-3.5 h-3.5" />
                Error: {item.error || 'Failed'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-slate-400">
            {item.status === 'downloading' && item.etaSeconds > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-500" />
                ETA: {formatEta(item.etaSeconds)}
              </span>
            )}
            <span className="font-bold text-slate-200">{progressPercent}%</span>
          </div>
        </div>

        <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800/80 p-[1px]">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              item.status === 'completed'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400 glow-emerald'
                : item.status === 'downloading'
                ? 'bg-gradient-to-r from-cyan-500 to-emerald-400 shadow-[0_0_10px_rgba(6,182,212,0.5)]'
                : item.status === 'error'
                ? 'bg-rose-500'
                : 'bg-slate-700'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Expandable Chunk Segment Visualizer */}
      {item.chunks && item.chunks.length > 0 && (
        <div className="pt-1">
          <button
            onClick={() => setShowChunks(!showChunks)}
            className="flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-cyan-400 transition-colors mb-2"
          >
            {showChunks ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>{showChunks ? 'Hide Threads' : 'Show Threads'} ({item.chunks.length} Streams)</span>
          </button>

          {showChunks && (
            <ChunkVisualizer chunks={item.chunks} totalBytes={item.totalBytes} />
          )}
        </div>
      )}
    </div>
  );
};
