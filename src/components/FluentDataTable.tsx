import React, { useState } from 'react';
import { DownloadItem } from '../types/download';
import { 
  FileArchive, 
  Video, 
  Music, 
  FileCode, 
  FileText, 
  File, 
  Play, 
  Pause, 
  FolderOpen, 
  ExternalLink, 
  Zap, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  HardDrive,
  Layers,
  Sparkles
} from 'lucide-react';
import { ChunkVisualizer } from './ChunkVisualizer';

interface FluentDataTableProps {
  downloads: DownloadItem[];
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onOpenFile: (filePath: string) => void;
  onOpenFolder: (filePath: string) => void;
}

export const FluentDataTable: React.FC<FluentDataTableProps> = ({
  downloads,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onPause,
  onResume,
  onOpenFile,
  onOpenFolder,
}) => {
  const [inspectedId, setInspectedId] = useState<string | null>(downloads.length > 0 ? downloads[0].id : null);

  const inspectedItem = downloads.find(d => d.id === inspectedId) || (downloads.length > 0 ? downloads[0] : null);

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
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };

  const getFileIcon = (category: string, filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (['zip', 'rar', '7z', 'iso', 'tar', 'gz'].includes(ext || '')) return <FileArchive className="w-4 h-4 text-amber-400 flex-shrink-0" />;
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext || '')) return <Video className="w-4 h-4 text-indigo-400 flex-shrink-0" />;
    if (['mp3', 'wav', 'flac', 'aac'].includes(ext || '')) return <Music className="w-4 h-4 text-pink-400 flex-shrink-0" />;
    if (['exe', 'msi', 'dmg', 'pkg'].includes(ext || '')) return <FileCode className="w-4 h-4 text-cyan-400 flex-shrink-0" />;
    if (['pdf', 'docx', 'txt', 'ppt', 'xlsx'].includes(ext || '')) return <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />;
    return <File className="w-4 h-4 text-slate-400 flex-shrink-0" />;
  };

  const getStatusBadge = (item: DownloadItem) => {
    const percent = item.totalBytes > 0 
      ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100))
      : 0;

    switch (item.status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950/80 border border-emerald-500/30 text-emerald-400">
            <CheckCircle2 className="w-3 h-3" />
            Complete
          </span>
        );
      case 'downloading':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-950/80 border border-cyan-500/30 text-cyan-300">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
            {percent}% ({formatSpeed(item.speedBps)})
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/70 border border-amber-500/30 text-amber-300">
            <Pause className="w-3 h-3" />
            Paused ({percent}%)
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-950/80 border border-rose-500/30 text-rose-300">
            <AlertCircle className="w-3 h-3" />
            Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400">
            Connecting...
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#090d16] select-none">
      {/* Upper Data Table (Flexible height) */}
      <div className="flex-1 flex flex-col overflow-hidden border-b border-[#1f273d]">
        {/* Table Header */}
        <div className="h-9 bg-[#0e1320] border-b border-[#1f273d] flex items-center text-[11px] font-bold text-slate-400 px-4 font-mono">
          <div className="w-7 flex items-center justify-center">
            <input
              type="checkbox"
              checked={downloads.length > 0 && selectedIds.length === downloads.length}
              onChange={onSelectAll}
              className="rounded border-[#344060] bg-[#0c101a] text-blue-600 focus:ring-0 cursor-pointer"
            />
          </div>
          <div className="flex-1 min-w-[240px] px-3">File Name</div>
          <div className="w-20 text-center">Streams</div>
          <div className="w-28 px-3 text-right">Size</div>
          <div className="w-48 px-3 text-left">Status & Progress</div>
          <div className="w-24 px-3 text-right">Time Left</div>
          <div className="w-40 px-3 text-right">Added Date</div>
          <div className="w-24 px-3 text-center">Actions</div>
        </div>

        {/* Table Rows */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#171e2e]">
          {downloads.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <Zap className="w-6 h-6 text-cyan-400" />
              </div>
              <div className="text-sm font-bold text-slate-200">No active downloads</div>
              <p className="text-xs text-slate-500 max-w-sm font-mono">
                Click "+ New Download" or press Ctrl+N to start 64-thread accelerated downloading.
              </p>
            </div>
          ) : (
            downloads.map((item) => {
              const isSelected = selectedIds.includes(item.id);
              const isInspected = inspectedId === item.id;
              const percent = item.totalBytes > 0 
                ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100))
                : (item.status === 'completed' ? 100 : 0);

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setInspectedId(item.id);
                  }}
                  onDoubleClick={() => item.status === 'completed' && onOpenFile(item.destinationPath)}
                  className={`download-row h-11 flex items-center text-xs px-4 cursor-pointer ${
                    isInspected ? 'bg-[#172033] border-l-2 border-cyan-400' : ''
                  } ${isSelected ? 'selected' : ''}`}
                >
                  {/* Checkbox */}
                  <div className="w-7 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(item.id)}
                      className="rounded border-[#344060] bg-[#0c101a] text-blue-600 focus:ring-0 cursor-pointer"
                    />
                  </div>

                  {/* File Name + Icon */}
                  <div className="flex-1 min-w-[240px] px-3 flex items-center gap-3 truncate">
                    {getFileIcon(item.category, item.filename)}
                    <div className="truncate min-w-0">
                      <span className="truncate text-slate-100 font-semibold hover:text-cyan-400 transition-colors block text-xs" title={item.filename}>
                        {item.filename}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono truncate block" title={item.url}>
                        {item.url}
                      </span>
                    </div>
                  </div>

                  {/* Threads Badge */}
                  <div className="w-20 flex items-center justify-center font-mono">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#131b2c] border border-cyan-500/30 text-cyan-300">
                      {item.chunks?.length || item.connections}x Turbo
                    </span>
                  </div>

                  {/* Size */}
                  <div className="w-28 px-3 text-right text-slate-300 font-mono text-[11px] font-medium">
                    {formatBytes(item.totalBytes || item.downloadedBytes)}
                  </div>

                  {/* Status Badge & Mini Progress Bar */}
                  <div className="w-48 px-3 flex flex-col justify-center gap-1">
                    {getStatusBadge(item)}
                    {item.status === 'downloading' && (
                      <div className="w-full h-1 bg-[#1a2236] rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300" style={{ width: `${percent}%` }} />
                      </div>
                    )}
                  </div>

                  {/* Time Left */}
                  <div className="w-24 px-3 text-right text-slate-400 font-mono text-[11px]">
                    {item.status === 'downloading' ? formatEta(item.etaSeconds) : '--'}
                  </div>

                  {/* Added Date */}
                  <div className="w-40 px-3 text-right text-slate-400 font-mono text-[11px] truncate">
                    {formatDate(item.createdAt)}
                  </div>

                  {/* Actions */}
                  <div className="w-24 px-3 flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {item.status === 'downloading' ? (
                      <button
                        onClick={() => onPause(item.id)}
                        className="p-1.5 rounded-lg bg-[#161c2c] hover:bg-[#20293f] text-slate-300 hover:text-white transition-all"
                        title="Pause"
                      >
                        <Pause className="w-3.5 h-3.5 text-amber-400" />
                      </button>
                    ) : item.status === 'paused' || item.status === 'error' ? (
                      <button
                        onClick={() => onResume(item.id)}
                        className="p-1.5 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/30 text-cyan-300 transition-all"
                        title="Resume"
                      >
                        <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400/20" />
                      </button>
                    ) : (
                      <button
                        onClick={() => onOpenFile(item.destinationPath)}
                        className="p-1.5 rounded-lg bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/30 text-emerald-400 transition-all"
                        title="Open File"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      onClick={() => onOpenFolder(item.destinationPath)}
                      className="p-1.5 rounded-lg bg-[#161c2c] hover:bg-[#20293f] text-slate-400 hover:text-white transition-all"
                      title="Show in Folder"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Lower Dedicated Inspection & Multi-Stream Visualizer Panel */}
      {inspectedItem && (
        <div className="h-44 bg-[#0d111c] p-4 flex flex-col justify-between select-none overflow-hidden animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                Live 64-Thread Engine Telemetry: <span className="text-cyan-400 font-mono">{inspectedItem.filename}</span>
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                Downloaded: <strong className="text-slate-200">{formatBytes(inspectedItem.downloadedBytes)}</strong> of {formatBytes(inspectedItem.totalBytes)}
              </span>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="text-slate-400">Rate: <strong className="text-emerald-400">{formatSpeed(inspectedItem.speedBps)}</strong></span>
              <span className="text-slate-400">Status: <strong className="text-cyan-300 uppercase">{inspectedItem.status}</strong></span>
            </div>
          </div>

          {/* Active 64-Thread Multi-Segment Block Visualizer */}
          <div className="py-2">
            <ChunkVisualizer chunks={inspectedItem.chunks} totalBytes={inspectedItem.totalBytes} />
          </div>

          {/* Bottom File Destination Info */}
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1 border-t border-[#1a2133]">
            <span className="truncate max-w-lg" title={inspectedItem.destinationPath}>
              Path: {inspectedItem.destinationPath}
            </span>
            <span>Direct Zero-Copy Disk Writing: ACTIVE</span>
          </div>
        </div>
      )}
    </div>
  );
};
