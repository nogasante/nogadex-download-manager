import React, { useState } from 'react';
import { DownloadItem } from '../types/download';
import { FileArchive, Video, Music, FileCode, FileText, File, Play, Pause, FolderOpen, ExternalLink, Zap } from 'lucide-react';
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
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '--';
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
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return '';
    }
  };

  const getFileIcon = (category: string, filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (['zip', 'rar', '7z', 'iso'].includes(ext || '')) return <FileArchive className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />;
    if (['mp4', 'mkv', 'avi', 'mov'].includes(ext || '')) return <Video className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />;
    if (['mp3', 'wav', 'flac'].includes(ext || '')) return <Music className="w-3.5 h-3.5 text-pink-400 flex-shrink-0" />;
    if (['exe', 'msi'].includes(ext || '')) return <FileCode className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />;
    if (['pdf', 'docx', 'txt', 'ppt', 'pptx'].includes(ext || '')) return <FileText className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />;
    return <File className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />;
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#131622] select-none">
      {/* Table Header */}
      <div className="h-8 border-b border-[#282e42] bg-[#181c2b] flex items-center text-[11px] font-semibold text-slate-400 px-3">
        <div className="w-6 flex items-center justify-center">
          <input
            type="checkbox"
            checked={downloads.length > 0 && selectedIds.length === downloads.length}
            onChange={onSelectAll}
            className="rounded border-[#39425e] bg-[#10131c] text-blue-600 focus:ring-0 cursor-pointer"
          />
        </div>
        <div className="flex-1 min-w-[200px] px-2">File name</div>
        <div className="w-16 text-center text-cyan-400 font-mono text-[10px]">Threads</div>
        <div className="w-24 px-2 text-right">Size</div>
        <div className="w-32 px-2 text-left">Progress & Status</div>
        <div className="w-20 px-2 text-right">Time Left</div>
        <div className="w-24 px-2 text-right">Transfer rate</div>
        <div className="w-36 px-2 text-right">Added Date</div>
        <div className="w-20 px-2 text-center">Actions</div>
      </div>

      {/* Table Rows */}
      <div className="flex-1 overflow-y-auto">
        {downloads.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <Zap className="w-6 h-6 text-cyan-400" />
            </div>
            <div className="text-xs font-semibold text-slate-300">No downloads yet</div>
            <p className="text-[11px] text-slate-500 max-w-sm">
              Click <span className="text-cyan-400 font-semibold font-mono">+ New Download</span> above or press <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-300">Ctrl+N</kbd> to start multi-stream downloading.
            </p>
          </div>
        ) : (
          downloads.map((item) => {
            const isSelected = selectedIds.includes(item.id);
            const isExpanded = expandedItemId === item.id;
            const percent = item.totalBytes > 0 
              ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100))
              : (item.status === 'completed' ? 100 : 0);

            let statusText = 'Connecting...';
            if (item.status === 'completed') statusText = 'Complete';
            else if (item.status === 'downloading') statusText = `${percent.toFixed(1)}%`;
            else if (item.status === 'paused') statusText = `${percent.toFixed(1)}% (Paused)`;
            else if (item.status === 'error') statusText = 'Failed';

            return (
              <React.Fragment key={item.id}>
                <div
                  onClick={() => onToggleSelect(item.id)}
                  onDoubleClick={() => item.status === 'completed' && onOpenFile(item.destinationPath)}
                  className={`fluent-row h-9 flex items-center text-xs border-b border-[#1c2130] px-3 cursor-pointer ${
                    isSelected ? 'selected' : ''
                  }`}
                >
                  {/* Checkbox */}
                  <div className="w-6 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(item.id)}
                      className="rounded border-[#39425e] bg-[#10131c] text-blue-600 focus:ring-0 cursor-pointer"
                    />
                  </div>

                  {/* File Name + Icon */}
                  <div className="flex-1 min-w-[200px] px-2 flex items-center gap-2 truncate">
                    {getFileIcon(item.category, item.filename)}
                    <span 
                      className="truncate text-slate-200 font-medium hover:text-cyan-400 transition-colors" 
                      title={item.filename}
                    >
                      {item.filename}
                    </span>
                  </div>

                  {/* Thread Count / Visualizer Toggle */}
                  <div 
                    className="w-16 flex items-center justify-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedItemId(isExpanded ? null : item.id);
                    }}
                  >
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#1d2336] text-cyan-400 hover:bg-cyan-950 border border-cyan-500/30 transition-colors cursor-pointer" title="Click to view parallel chunk streams">
                      {item.chunks?.length || item.connections}x
                    </span>
                  </div>

                  {/* Size */}
                  <div className="w-24 px-2 text-right text-slate-300 font-mono text-[11px]">
                    {formatBytes(item.totalBytes || item.downloadedBytes)}
                  </div>

                  {/* Status with mini progress bar */}
                  <div className="w-32 px-2 flex items-center gap-2 text-[11px] font-mono">
                    {item.status === 'downloading' && (
                      <div className="w-12 h-1.5 bg-[#252b3d] rounded-full overflow-hidden flex-shrink-0">
                        <div className="h-full bg-cyan-400 rounded-full transition-all duration-200" style={{ width: `${percent}%` }} />
                      </div>
                    )}
                    <span className={`truncate ${
                      item.status === 'completed' ? 'text-emerald-400 font-medium' :
                      item.status === 'downloading' ? 'text-cyan-300 font-bold' :
                      item.status === 'error' ? 'text-rose-400' : 'text-slate-400'
                    }`}>
                      {statusText}
                    </span>
                  </div>

                  {/* Time Left */}
                  <div className="w-20 px-2 text-right text-slate-400 font-mono text-[11px]">
                    {item.status === 'downloading' ? formatEta(item.etaSeconds) : ''}
                  </div>

                  {/* Transfer Rate */}
                  <div className="w-24 px-2 text-right text-emerald-400 font-mono text-[11px] font-bold">
                    {item.status === 'downloading' ? formatSpeed(item.speedBps) : ''}
                  </div>

                  {/* Added Date */}
                  <div className="w-36 px-2 text-right text-slate-500 font-mono text-[11px] truncate">
                    {formatDate(item.createdAt)}
                  </div>

                  {/* Quick Action Buttons */}
                  <div className="w-20 px-2 flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {item.status === 'downloading' ? (
                      <button
                        onClick={() => onPause(item.id)}
                        className="p-1 rounded hover:bg-slate-700 text-slate-300 hover:text-white"
                        title="Pause"
                      >
                        <Pause className="w-3.5 h-3.5 text-amber-400" />
                      </button>
                    ) : item.status === 'paused' || item.status === 'error' ? (
                      <button
                        onClick={() => onResume(item.id)}
                        className="p-1 rounded hover:bg-slate-700 text-slate-300 hover:text-white"
                        title="Resume"
                      >
                        <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400/20" />
                      </button>
                    ) : (
                      <button
                        onClick={() => onOpenFile(item.destinationPath)}
                        className="p-1 rounded hover:bg-slate-700 text-slate-300 hover:text-white"
                        title="Open File"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                      </button>
                    )}

                    <button
                      onClick={() => onOpenFolder(item.destinationPath)}
                      className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white"
                      title="Show in Folder"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expanded 64-Thread Chunk Visualizer Panel */}
                {isExpanded && item.chunks && item.chunks.length > 0 && (
                  <div className="bg-[#181c2b] border-b border-[#282e42] p-3 px-10 animate-in fade-in duration-150">
                    <ChunkVisualizer chunks={item.chunks} totalBytes={item.totalBytes} />
                  </div>
                )}
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
};
