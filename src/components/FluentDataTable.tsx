import React from 'react';
import { DownloadItem } from '../types/download';
import { FileArchive, Video, Music, FileCode, FileText, File, Clock } from 'lucide-react';

interface FluentDataTableProps {
  downloads: DownloadItem[];
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
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
  onDelete,
  onOpenFile,
  onOpenFolder,
}) => {
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '--';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
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
      {/* Table Header matching screenshot */}
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
        <div className="w-8 text-center text-slate-500">Q</div>
        <div className="w-24 px-2 text-right">Size</div>
        <div className="w-28 px-2 text-left">Status</div>
        <div className="w-20 px-2 text-right">Time Left</div>
        <div className="w-24 px-2 text-right">Transfer rate</div>
        <div className="w-36 px-2 text-right">Last try date</div>
      </div>

      {/* Table Rows */}
      <div className="flex-1 overflow-y-auto">
        {downloads.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            No downloads in this category. Click "+ Add URL" to start.
          </div>
        ) : (
          downloads.map((item) => {
            const isSelected = selectedIds.includes(item.id);
            const percent = item.totalBytes > 0 
              ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100))
              : (item.status === 'completed' ? 100 : 0);

            let statusText = 'Not started';
            if (item.status === 'completed') statusText = 'Complete';
            else if (item.status === 'downloading') statusText = `${percent.toFixed(2)}%`;
            else if (item.status === 'paused') statusText = `${percent.toFixed(2)}% (Paused)`;
            else if (item.status === 'error') statusText = 'Error';
            else if (item.status === 'probing') statusText = 'Connecting...';

            return (
              <div
                key={item.id}
                onClick={() => onToggleSelect(item.id)}
                onDoubleClick={() => item.status === 'completed' && onOpenFile(item.destinationPath)}
                className={`fluent-row h-8 flex items-center text-xs border-b border-[#1c2130] px-3 cursor-pointer ${
                  isSelected ? 'selected' : ''
                }`}
              >
                {/* Selection Checkbox */}
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
                  <span className="truncate text-slate-200 hover:text-white" title={item.filename}>
                    {item.filename}
                  </span>
                </div>

                {/* Q (Queue icon) */}
                <div className="w-8 flex items-center justify-center text-slate-500 text-[10px]">
                  {item.status === 'queued' ? <Clock className="w-3 h-3 text-amber-400" /> : ''}
                </div>

                {/* Size */}
                <div className="w-24 px-2 text-right text-slate-300 font-mono text-[11px]">
                  {formatBytes(item.totalBytes || item.downloadedBytes)}
                </div>

                {/* Status with mini progress */}
                <div className="w-28 px-2 flex items-center gap-1.5 text-[11px] font-mono">
                  {item.status === 'downloading' && (
                    <div className="w-12 h-1.5 bg-[#252b3d] rounded-full overflow-hidden flex-shrink-0">
                      <div className="h-full bg-blue-500 rounded-full transition-all duration-200" style={{ width: `${percent}%` }} />
                    </div>
                  )}
                  <span className={`truncate ${
                    item.status === 'completed' ? 'text-slate-300' :
                    item.status === 'downloading' ? 'text-blue-400 font-medium' :
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
                <div className="w-24 px-2 text-right text-emerald-400 font-mono text-[11px]">
                  {item.status === 'downloading' ? formatSpeed(item.speedBps) : ''}
                </div>

                {/* Last Try Date */}
                <div className="w-36 px-2 text-right text-slate-500 font-mono text-[11px] truncate">
                  {formatDate(item.createdAt)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
