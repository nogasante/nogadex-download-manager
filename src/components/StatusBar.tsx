import React from 'react';
import { EngineStats } from '../types/download';

interface StatusBarProps {
  totalCount: number;
  filteredCount: number;
  selectedCount: number;
  selectedBytes: number;
  activeCount: number;
  completedCount: number;
  failedCount: number;
  stats: EngineStats;
  currentCategoryName?: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  filteredCount,
  selectedCount,
  selectedBytes,
  activeCount,
  completedCount,
  stats,
}) => {
  const formatSpeed = (bps: number) => {
    if (bps <= 0) return '0.00 KB/s';
    const mbps = bps / (1024 * 1024);
    if (mbps >= 1) return `${mbps.toFixed(2)} MB/s`;
    return `${(bps / 1024).toFixed(2)} KB/s`;
  };

  const formatSize = (bytes: number) => {
    if (bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="h-6 bg-[#f1f5f9] border-t border-[#cbd5e1] flex items-center text-[12px] text-[#334155] select-none font-sans px-2 divide-x divide-[#cbd5e1]">
      {/* Pane 1: Filtered Folder Items Count */}
      <div className="pr-3 font-medium min-w-[70px]">
        {filteredCount} {filteredCount === 1 ? 'item' : 'items'}
      </div>

      {/* Pane 2: Selection Count & Byte Size */}
      <div className="px-3 min-w-[140px]">
        {selectedCount > 0 ? (
          <span className="text-[#0f172a] font-medium">
            {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected{selectedBytes > 0 ? ` (${formatSize(selectedBytes)})` : ''}
          </span>
        ) : (
          <span className="text-[#94a3b8]">No selection</span>
        )}
      </div>

      {/* Pane 3: Active & Completed Breakdown */}
      <div className="px-3">
        {activeCount} downloading • {completedCount} finished
      </div>

      {/* Pane 4: Bandwidth Speed */}
      <div className="px-3 font-mono font-medium text-[#0f172a]">
        Speed: {formatSpeed(stats.totalSpeedBps)}
      </div>

      {/* Pane 5: Overall Status */}
      <div className="px-3 flex-1 text-right text-[#64748b]">
        {activeCount > 0 ? `Downloading at ${formatSpeed(stats.totalSpeedBps)}` : 'Ready'}
      </div>
    </div>
  );
};
