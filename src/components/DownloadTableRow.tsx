import React from 'react';
import { DownloadItem } from '../types/download';
import { 
  Semi3DZip, 
  Semi3DDocument, 
  Semi3DMusic, 
  Semi3DProgram, 
  Semi3DVideo 
} from './CategoryIcons3D';

interface DownloadTableRowProps {
  download: DownloadItem;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent, id: string) => void;
  onDoubleClick: (download: DownloadItem) => void;
  onContextMenu: (e: React.MouseEvent, download: DownloadItem) => void;
}

export const DownloadTableRow: React.FC<DownloadTableRowProps> = ({
  download,
  isSelected,
  onSelect,
  onDoubleClick,
  onContextMenu,
}) => {
  const getFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'iso'].includes(ext)) return <Semi3DZip className="w-4 h-4 shrink-0" />;
    if (['pdf', 'doc', 'docx', 'txt', 'xlsx', 'pptx'].includes(ext)) return <Semi3DDocument className="w-4 h-4 shrink-0" />;
    if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return <Semi3DMusic className="w-4 h-4 shrink-0" />;
    if (['exe', 'msi', 'dmg', 'apk', 'deb'].includes(ext)) return <Semi3DProgram className="w-4 h-4 shrink-0" />;
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return <Semi3DVideo className="w-4 h-4 shrink-0" />;
    return <Semi3DDocument className="w-4 h-4 shrink-0" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes <= 0) return '0 KB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatSpeed = (bps: number) => {
    if (bps <= 0) return '0 KB/s';
    const mbps = bps / (1024 * 1024);
    if (mbps >= 1) return `${mbps.toFixed(2)} MB/s`;
    return `${(bps / 1024).toFixed(1)} KB/s`;
  };

  const formatEta = (sec: number) => {
    if (sec <= 0 || !isFinite(sec)) return '0s';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const pct = download.totalBytes > 0
    ? Math.min(100, Math.round((download.downloadedBytes / download.totalBytes) * 100))
    : 0;

  return (
    <tr
      onClick={(e) => onSelect(e, download.id)}
      onDoubleClick={() => onDoubleClick(download)}
      onContextMenu={(e) => onContextMenu(e, download)}
      className={`h-[28px] text-[12.5px] border-b border-[#f1f5f9] cursor-pointer transition-colors ${
        isSelected
          ? 'bg-[#eff6ff] text-[#1e40af] font-medium'
          : 'hover:bg-[#f8fafc] text-[#1e293b]'
      }`}
    >
      {/* File Name + Semi-3D Icon */}
      <td className="px-2.5 truncate max-w-[220px]">
        <div className="flex items-center gap-2 truncate">
          {getFileIcon(download.filename)}
          <span className="truncate">{download.filename}</span>
        </div>
      </td>

      {/* Size */}
      <td className="px-2.5 font-mono text-[#475569]">{formatSize(download.totalBytes)}</td>

      {/* Status */}
      <td className="px-2.5 capitalize">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold ${
          download.status === 'downloading'
            ? 'bg-[#dbeafe] text-[#1d4ed8]'
            : download.status === 'completed'
              ? 'bg-[#dcfce7] text-[#15803d]'
              : download.status === 'paused'
                ? 'bg-[#fef3c7] text-[#b45309]'
                : 'bg-[#f1f5f9] text-[#64748b]'
        }`}>
          {download.status}
        </span>
      </td>

      {/* Progress Track */}
      <td className="px-2.5">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-[#e2e8f0] rounded-full overflow-hidden shadow-inner">
            <div
              className={`h-full transition-all duration-300 ${
                download.status === 'completed' ? 'bg-[#16a34a]' : 'bg-[#2563eb]'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-[11.5px] text-[#64748b] w-9 text-right">{pct}%</span>
        </div>
      </td>

      {/* Speed */}
      <td className="px-2.5 font-mono text-[#475569]">
        {download.status === 'downloading' ? formatSpeed(download.speedBps) : '-'}
      </td>

      {/* Time Left */}
      <td className="px-2.5 text-[#64748b]">
        {download.status === 'downloading' ? formatEta(download.etaSeconds) : '-'}
      </td>

      {/* Added Date */}
      <td className="px-2.5 text-[#64748b] font-mono text-[11.5px]">
        {new Date(download.createdAt).toLocaleDateString()}
      </td>
    </tr>
  );
};
