import React, { useState, useMemo, useRef, useEffect } from 'react';
import { DownloadItem } from '../types/download';
import { FileIcon } from './FileIcon';

interface DownloadTableProps {
  downloads: DownloadItem[];
  selectedIds: Set<string>;
  onSelectionChange: (selectedIds: Set<string>) => void;
  onDoubleClick: (item: DownloadItem) => void;
  onContextMenu: (item: DownloadItem, e: React.MouseEvent) => void;
  onAddUrl?: () => void;
}

export const DownloadTable: React.FC<DownloadTableProps> = ({
  downloads,
  selectedIds,
  onSelectionChange,
  onDoubleClick,
  onContextMenu,
}) => {
  const [sortField, setSortField] = useState<keyof DownloadItem>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const handleSort = (field: keyof DownloadItem) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const sortedDownloads = useMemo(() => {
    return [...downloads].sort((a, b) => {
      const valA = a[sortField] ?? '';
      const valB = b[sortField] ?? '';
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [downloads, sortField, sortAsc]);

  const isAllSelected = sortedDownloads.length > 0 && selectedIds.size === sortedDownloads.length;
  const isPartiallySelected = selectedIds.size > 0 && selectedIds.size < sortedDownloads.length;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isPartiallySelected;
    }
  }, [isPartiallySelected]);

  const handleToggleSelectAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAllSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(sortedDownloads.map((d) => d.id)));
    }
  };

  const handleCheckboxToggle = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange(next);
  };

  const handleRowClick = (d: DownloadItem, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedIds);
      if (next.has(d.id)) next.delete(d.id);
      else next.add(d.id);
      onSelectionChange(next);
    } else if (e.shiftKey && selectedIds.size > 0) {
      const lastSelectedId = Array.from(selectedIds).pop();
      const lastIdx = sortedDownloads.findIndex((item) => item.id === lastSelectedId);
      const currIdx = sortedDownloads.findIndex((item) => item.id === d.id);
      if (lastIdx !== -1 && currIdx !== -1) {
        const start = Math.min(lastIdx, currIdx);
        const end = Math.max(lastIdx, currIdx);
        const next = new Set(selectedIds);
        for (let i = start; i <= end; i++) {
          next.add(sortedDownloads[i].id);
        }
        onSelectionChange(next);
      }
    } else {
      onSelectionChange(new Set([d.id]));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes <= 0) return '0 KB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatSpeed = (bps?: number) => {
    if (!bps || bps <= 0) return '';
    const kb = bps / 1024;
    if (kb >= 1024) return `${(kb / 1024).toFixed(2)} MB/s`;
    return `${kb.toFixed(1)} KB/s`;
  };

  const formatEta = (seconds?: number) => {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '';
    if (seconds < 60) return `${Math.round(seconds)} sec`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins} min ${secs} sec`;
  };

  const formatStatus = (d: DownloadItem) => {
    const pct = d.totalBytes > 0
      ? Math.min(100, Math.round((d.downloadedBytes / d.totalBytes) * 100))
      : 0;

    switch (d.status) {
      case 'downloading':
        return <span className="text-[#2563eb] font-semibold">Downloading ({pct}%)</span>;
      case 'completed':
        return <span className="text-[#16a34a] font-medium">Complete</span>;
      case 'paused':
        return <span className="text-[#d97706]">Paused ({pct}%)</span>;
      case 'error':
        return <span className="text-[#dc2626]">Error</span>;
      case 'queued':
        return <span className="text-[#64748b]">Queued</span>;
      default:
        return <span className="capitalize">{d.status}</span>;
    }
  };

  return (
    <div className="flex-1 bg-[#ffffff] overflow-auto select-none font-sans text-[12px]">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 bg-[#f1f5f9] border-b border-[#cbd5e1] text-[#475569] font-medium shadow-xs z-10 group/header">
          <tr>
            {/* File Name Column with Windows File Explorer Select-All Checkbox */}
            <th
              onClick={() => handleSort('filename')}
              className="py-1 px-2 cursor-pointer hover:bg-[#e2e8f0] border-r border-[#cbd5e1] w-[290px]"
            >
              <div className="flex items-center gap-2">
                {/* Header Checkbox */}
                <div 
                  onClick={handleToggleSelectAll}
                  className={`w-4 h-4 flex items-center justify-center cursor-pointer transition-all ${
                    isAllSelected
                      ? 'ndm-checkbox-3d-checked text-white opacity-100 scale-105'
                      : isPartiallySelected
                      ? 'ndm-checkbox-3d-indeterminate text-white opacity-100'
                      : 'ndm-checkbox-3d-unchecked opacity-0 group-hover/header:opacity-100 hover:border-[#005a9e]'
                  }`}
                  title="Select all"
                >
                  {isAllSelected && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" className="filter drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  {isPartiallySelected && (
                    <div className="w-2 h-0.5 bg-white rounded-xs shadow-xs" />
                  )}
                </div>
                <span>File Name {sortField === 'filename' && (sortAsc ? '▲' : '▼')}</span>
              </div>
            </th>
            <th
              onClick={() => handleSort('totalBytes')}
              className="py-1 px-3 cursor-pointer hover:bg-[#e2e8f0] border-r border-[#cbd5e1] w-[90px]"
            >
              Size {sortField === 'totalBytes' && (sortAsc ? '▲' : '▼')}
            </th>
            <th
              onClick={() => handleSort('status')}
              className="py-1 px-3 cursor-pointer hover:bg-[#e2e8f0] border-r border-[#cbd5e1] w-[130px]"
            >
              Status {sortField === 'status' && (sortAsc ? '▲' : '▼')}
            </th>
            <th
              onClick={() => handleSort('etaSeconds')}
              className="py-1 px-3 cursor-pointer hover:bg-[#e2e8f0] border-r border-[#cbd5e1] w-[90px]"
            >
              Time left {sortField === 'etaSeconds' && (sortAsc ? '▲' : '▼')}
            </th>
            <th
              onClick={() => handleSort('speedBps')}
              className="py-1 px-3 cursor-pointer hover:bg-[#e2e8f0] border-r border-[#cbd5e1] w-[100px]"
            >
              Transfer rate {sortField === 'speedBps' && (sortAsc ? '▲' : '▼')}
            </th>
            <th
              onClick={() => handleSort('createdAt')}
              className="py-1 px-3 cursor-pointer hover:bg-[#e2e8f0] border-r border-[#cbd5e1] w-[130px]"
            >
              Last Try Date {sortField === 'createdAt' && (sortAsc ? '▲' : '▼')}
            </th>
            <th
              onClick={() => handleSort('url')}
              className="py-1 px-3 cursor-pointer hover:bg-[#e2e8f0]"
            >
              Description {sortField === 'url' && (sortAsc ? '▲' : '▼')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f1f5f9]">
          {sortedDownloads.map((d) => {
            const isSelected = selectedIds.has(d.id);
            const hasAnySelection = selectedIds.size > 0;
            return (
              <tr
                key={d.id}
                onClick={(e) => handleRowClick(d, e)}
                onDoubleClick={() => onDoubleClick(d)}
                onContextMenu={(e) => onContextMenu(d, e)}
                className={`cursor-pointer transition-none group/row ${
                  isSelected
                    ? 'bg-[#cde8ff] border-y border-[#70baff] text-[#0f172a]'
                    : 'hover:bg-[#eef6ff] text-[#1e293b] border-y border-transparent'
                }`}
              >
                {/* File Name with Windows File Explorer Item Checkbox (appears on hover or when selected) */}
                <td className="py-1 px-2 truncate max-w-[290px]">
                  <div className="flex items-center gap-2 truncate">
                    {/* Item Checkbox */}
                    <div
                      onClick={(e) => handleCheckboxToggle(d.id, e)}
                      className={`w-4 h-4 flex items-center justify-center shrink-0 cursor-pointer transition-all ${
                        isSelected
                          ? 'ndm-checkbox-3d-checked text-white opacity-100 shadow-xs'
                          : hasAnySelection
                          ? 'ndm-checkbox-3d-unchecked opacity-50 hover:opacity-100 hover:border-[#005a9e]'
                          : 'ndm-checkbox-3d-unchecked opacity-0 group-hover/row:opacity-100 hover:border-[#005a9e]'
                      }`}
                      title={isSelected ? 'Deselect' : 'Select'}
                    >
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" className="filter drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>

                    {/* Windows Application File Icon */}
                    <FileIcon filename={d.filename} className="w-4 h-4 shrink-0" />
                    <span className="truncate font-medium">{d.filename}</span>
                  </div>
                </td>

                <td className="py-1 px-3 whitespace-nowrap">
                  {formatSize(d.totalBytes)}
                </td>

                <td className="py-1 px-3 whitespace-nowrap">
                  {formatStatus(d)}
                </td>

                <td className="py-1 px-3 whitespace-nowrap">
                  {formatEta(d.etaSeconds)}
                </td>

                <td className="py-1 px-3 whitespace-nowrap">
                  {formatSpeed(d.speedBps)}
                </td>

                <td className="py-1 px-3 whitespace-nowrap opacity-80 text-[11px]">
                  {new Date(d.createdAt || Date.now()).toLocaleDateString()} {new Date(d.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </td>

                <td className="py-1 px-3 truncate max-w-[300px] opacity-75 font-mono text-[11px]">
                  {d.url}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
