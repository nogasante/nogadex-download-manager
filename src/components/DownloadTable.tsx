import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadItem } from '../types/download';
import { FileIcon } from './FileIcon';
import { ColumnFilterDropdown, COLUMN_FILTER_CONFIGS } from './ColumnFilterDropdown';
import { formatSize, formatSpeed, formatEta, formatDateTime } from '../utils/formatters';
import { DownloadStatusBadge } from './common/DownloadStatusBadge';

interface DownloadTableProps {
  downloads: DownloadItem[];
  selectedIds: Set<string>;
  onSelectionChange: (selectedIds: Set<string>) => void;
  onDoubleClick: (item: DownloadItem) => void;
  onContextMenu: (item: DownloadItem, e: React.MouseEvent) => void;
  onAddUrl?: () => void;
  /** downloadId -> queueId (Q column). */
  queueAssignments?: Record<string, string>;
  /** queueId -> display name, for the badge tooltip. */
  queueNames?: Record<string, string>;
}

const DEFAULT_COLUMN_WIDTHS = {
  filename: 280,
  totalBytes: 95,
  status: 125,
  etaSeconds: 95,
  speedBps: 110,
  queue: 90,
  createdAt: 135,
  url: 320,
};

type ColumnKey = keyof typeof DEFAULT_COLUMN_WIDTHS;

const describeAutoStreams = (d: DownloadItem): string => {
  if (!d.autoStreams) return '';
  if (!d.resumable) return 'Auto · 1 (this server can\'t split downloads)';
  if (!d.totalBytes) return 'Auto · 1 (file size not known yet)';
  const MB = 1024 * 1024;
  const tier =
    d.totalBytes <= 1 * MB ? 'small file' :
    d.totalBytes <= 8 * MB ? 'small-to-medium file' :
    d.totalBytes <= 64 * MB ? 'medium file' :
    'large file';
  return `Auto · ${d.connections} connection${d.connections === 1 ? '' : 's'} (${tier})`;
};

export const DownloadTable: React.FC<DownloadTableProps> = ({
  downloads,
  selectedIds,
  onSelectionChange,
  onDoubleClick,
  onContextMenu,
  queueAssignments = {},
  queueNames = {},
}) => {
  const { t } = useTranslation();
  const [sortField, setSortField] = useState<keyof DownloadItem>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  // Column filtering state
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({});
  const [openFilter, setOpenFilter] = useState<{
    field: string;
    position: { top: number; left: number };
  } | null>(null);

  // Resizable column widths with persistence
  const [colWidths, setColWidths] = useState<typeof DEFAULT_COLUMN_WIDTHS>(() => {
    try {
      const saved = localStorage.getItem('ndm_column_widths');
      if (saved) {
        return { ...DEFAULT_COLUMN_WIDTHS, ...JSON.parse(saved) };
      }
    } catch {}
    return DEFAULT_COLUMN_WIDTHS;
  });

  const resizingRef = useRef<{
    col: ColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleResizeStart = useCallback((col: ColumnKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = {
      col,
      startX: e.clientX,
      startWidth: colWidths[col],
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = moveEvent.clientX - resizingRef.current.startX;
      const newWidth = Math.max(50, resizingRef.current.startWidth + delta);
      setColWidths((prev) => {
        const next = { ...prev, [resizingRef.current!.col]: newWidth };
        try {
          localStorage.setItem('ndm_column_widths', JSON.stringify(next));
        } catch {}
        return next;
      });
    };

    const handleMouseUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [colWidths]);

  const handleResetWidth = (col: ColumnKey, e: React.MouseEvent) => {
    e.stopPropagation();
    setColWidths((prev) => {
      const next = { ...prev, [col]: DEFAULT_COLUMN_WIDTHS[col] };
      try {
        localStorage.setItem('ndm_column_widths', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleSort = (field: keyof DownloadItem) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const handleToggleColumnFilter = (field: string, filterId: string) => {
    setColumnFilters((prev) => {
      const current = new Set(prev[field] || []);
      if (current.has(filterId)) {
        current.delete(filterId);
      } else {
        current.add(filterId);
      }
      return { ...prev, [field]: current };
    });
  };

  const handleClearColumnFilters = (field: string) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  // Filter downloads by column filters first
  const filteredDownloads = useMemo(() => {
    return downloads.filter((d) => {
      for (const [field, filterSet] of Object.entries(columnFilters)) {
        if (!filterSet || filterSet.size === 0) continue;
        const configs = COLUMN_FILTER_CONFIGS[field];
        if (!configs) continue;
        const matchesAny = Array.from(filterSet).some((fId) => {
          const opt = configs.find((c) => c.id === fId);
          return opt ? opt.test(d) : true;
        });
        if (!matchesAny) return false;
      }
      return true;
    });
  }, [downloads, columnFilters]);

  // Then sort
  const sortedDownloads = useMemo(() => {
    return [...filteredDownloads].sort((a, b) => {
      const valA = a[sortField] ?? '';
      const valB = b[sortField] ?? '';
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [filteredDownloads, sortField, sortAsc]);

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

  const totalTableWidth = useMemo(() => {
    return Object.values(colWidths).reduce((sum, w) => sum + w, 0);
  }, [colWidths]);

  // Renders a Windows File Explorer style column header with chevron indicator
  const renderHeaderCell = (
    // 'queue' is a synthetic column (not a DownloadItem field) — Q column.
    field: keyof DownloadItem | 'queue',
    colKey: ColumnKey,
    title: string,
    prefix?: React.ReactNode
  ) => {
    const isSorted = field !== 'queue' && sortField === field;
    const hasActiveFilter = field !== 'queue' && (columnFilters[field]?.size || 0) > 0;
    const hasColumnFilter = field !== 'queue'; // 'queue' is synthetic — no filter/sort model

    return (
      <th
        key={colKey}
        onClick={() => field !== 'queue' && handleSort(field)}
        className={`relative h-[28px] py-0 px-2 text-left text-[11.5px] font-normal text-neutral-700 whitespace-nowrap overflow-hidden border-r border-neutral-300 border-b border-neutral-300 bg-neutral-50 hover:bg-neutral-200 active:bg-neutral-300 transition-colors group/th select-none ${
          hasColumnFilter ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        {/* Windows Explorer Top Sort Indicator (Centered at top edge) */}
        {isSorted && (
          <div className="absolute top-[1.5px] left-1/2 -translate-x-1/2 text-neutral-700 pointer-events-none flex justify-center z-10">
            <svg
              width="9"
              height="5"
              viewBox="0 0 9 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {sortAsc ? (
                <path d="M1 4L4.5 1L8 4" />
              ) : (
                <path d="M1 1L4.5 4L8 1" />
              )}
            </svg>
          </div>
        )}

        <div className="flex items-center justify-between h-full w-full">
          {/* Left: Optional checkbox + title */}
          <div className="flex items-center gap-2 truncate pr-1">
            {prefix}
            <span className="truncate font-medium text-neutral-700 group-hover/th:text-neutral-900">
              {title}
            </span>
          </div>

          {/* Right: Windows Explorer Fast Filtering Dropdown Chevron & Divider */}
          {hasColumnFilter && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setOpenFilter((prev) =>
                prev?.field === field
                  ? null
                  : {
                      field,
                      position: {
                        top: rect.bottom + 2,
                        left: Math.max(10, rect.right - 155),
                      },
                    }
              );
            }}
            title="Fast filter by column"
            className={`flex items-center pl-1 shrink-0 transition-opacity hover:!opacity-100 ${
              hasActiveFilter
                ? 'opacity-100 text-brand'
                : 'opacity-0 group-hover/th:opacity-60 text-neutral-500'
            }`}
          >
            <div className="w-[1px] h-3.5 bg-neutral-400 mr-1.5 shrink-0" />
            <svg
              width="8"
              height="5"
              viewBox="0 0 8 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <path d="M1 1L4 4L7 1" />
            </svg>
            {hasActiveFilter && (
              <span className="ml-1 w-1.5 h-1.5 rounded-full bg-brand" />
            )}
          </div>
          )}
        </div>

        {/* Column Resizer Handle */}
        <div
          onMouseDown={(e) => handleResizeStart(colKey, e)}
          onDoubleClick={(e) => handleResetWidth(colKey, e)}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize hover:bg-brand/80 active:bg-brand z-30 transition-colors"
          title="Drag to resize, double-click to reset"
        />
      </th>
    );
  };

  const selectAllCheckbox = (
    <div 
      onClick={handleToggleSelectAll}
      className={`w-4 h-4 flex items-center justify-center cursor-pointer shrink-0 transition-all ${
        isAllSelected
          ? 'ndm-checkbox-3d-checked text-white opacity-100 scale-105'
          : isPartiallySelected
          ? 'ndm-checkbox-3d-indeterminate text-white opacity-100'
          : 'ndm-checkbox-3d-unchecked opacity-0 group-hover/th:opacity-100 hover:border-brand'
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
  );

  return (
    <div className="flex-1 bg-white overflow-auto select-none font-sans text-[12px] relative">
      <table 
        className="border-collapse text-left table-fixed" 
        style={{ minWidth: '100%', width: `${totalTableWidth}px` }}
      >
        <colgroup>
          <col style={{ width: `${colWidths.filename}px` }} />
          <col style={{ width: `${colWidths.totalBytes}px` }} />
          <col style={{ width: `${colWidths.status}px` }} />
          <col style={{ width: `${colWidths.etaSeconds}px` }} />
          <col style={{ width: `${colWidths.speedBps}px` }} />
          <col style={{ width: `${colWidths.queue}px` }} />
          <col style={{ width: `${colWidths.createdAt}px` }} />
          <col style={{ width: `${colWidths.url}px` }} />
        </colgroup>

        <thead className="sticky top-0 z-20 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
          <tr>
            {renderHeaderCell('filename', 'filename', t('table.fileName'), selectAllCheckbox)}
            {renderHeaderCell('totalBytes', 'totalBytes', t('table.size'))}
            {renderHeaderCell('status', 'status', t('table.status'))}
            {renderHeaderCell('etaSeconds', 'etaSeconds', t('table.timeLeft'))}
            {renderHeaderCell('speedBps', 'speedBps', t('table.transferRate'))}
            {renderHeaderCell('queue', 'queue', t('table.queue'))}
            {renderHeaderCell('createdAt', 'createdAt', t('table.lastTryDate'))}
            {renderHeaderCell('url', 'url', t('table.description'))}
          </tr>
        </thead>

        <tbody className="divide-y divide-neutral-100">
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
                    ? 'bg-brand-tint border-y border-brand-tintEdge text-neutral-900'
                    : 'hover:bg-brand-tint text-neutral-800 border-y border-transparent'
                }`}
              >
                {/* File Name */}
                <td className="py-1 px-2 truncate whitespace-nowrap overflow-hidden border-r border-neutral-100">
                  <div className="flex items-center gap-2 truncate">
                    {/* Item Checkbox */}
                    <div
                      onClick={(e) => handleCheckboxToggle(d.id, e)}
                      className={`w-4 h-4 flex items-center justify-center shrink-0 cursor-pointer transition-all ${
                        isSelected
                          ? 'ndm-checkbox-3d-checked text-white opacity-100 shadow-xs'
                          : hasAnySelection
                          ? 'ndm-checkbox-3d-unchecked opacity-50 hover:opacity-100 hover:border-brand'
                          : 'ndm-checkbox-3d-unchecked opacity-0 group-hover/row:opacity-100 hover:border-brand'
                      }`}
                      title={isSelected ? 'Deselect' : 'Select'}
                    >
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" className="filter drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>

                    {/* File Icon */}
                    <FileIcon filename={d.filename} filePath={d.destinationPath} className="w-4 h-4 shrink-0" />
                    <span className="truncate font-medium">{d.filename}</span>
                    {d.autoStreams && d.status !== 'error' && (
                      <span
                        className="ml-1.5 shrink-0 rounded bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-[1px] text-[10px] font-semibold"
                        title={describeAutoStreams(d) || 'Auto: the app picks the best number of connections for this file'}
                      >
                        {d.status === 'downloading' || d.status === 'paused'
                          ? `Auto · ${d.connections}`
                          : 'Auto'}
                      </span>
                    )}
                  </div>
                </td>

                <td className="py-1 px-2.5 whitespace-nowrap truncate overflow-hidden border-r border-neutral-100">
                  {formatSize(d.totalBytes)}
                </td>

                <td className="py-1 px-2.5 whitespace-nowrap truncate overflow-hidden border-r border-neutral-100">
                  <DownloadStatusBadge status={d.status} downloadedBytes={d.downloadedBytes} totalBytes={d.totalBytes} />
                </td>

                <td className="py-1 px-2.5 whitespace-nowrap truncate overflow-hidden border-r border-neutral-100">
                  {formatEta(d.etaSeconds)}
                </td>

                <td className="py-1 px-2.5 whitespace-nowrap truncate overflow-hidden border-r border-neutral-100">
                  {formatSpeed(d.speedBps)}
                </td>

                {/* Q column: which queue this file belongs to. */}
                <td className="py-1 px-2.5 whitespace-nowrap truncate overflow-hidden border-r border-neutral-100 text-[11px]">
                  {queueAssignments[d.id] ? (
                    <span
                      className="inline-block max-w-full px-1.5 py-[1px] rounded-[2px] bg-neutral-100 border border-neutral-300 text-neutral-700 truncate"
                      title={`Queue: ${queueNames[queueAssignments[d.id]] || queueAssignments[d.id]}`}
                    >
                      {queueNames[queueAssignments[d.id]] || queueAssignments[d.id]}
                    </span>
                  ) : (
                    <span className="text-neutral-300">-</span>
                  )}
                </td>

                <td className="py-1 px-2.5 whitespace-nowrap truncate overflow-hidden opacity-80 text-[11px] border-r border-neutral-100">
                  {formatDateTime(d.createdAt)}
                </td>

                <td className="py-1 px-2.5 truncate whitespace-nowrap overflow-hidden opacity-75 font-mono text-[11px]">
                  {d.url}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Windows File Explorer Column Filter Dropdown */}
      {openFilter && (
        <ColumnFilterDropdown
          field={openFilter.field}
          selectedFilterIds={columnFilters[openFilter.field] || new Set()}
          onToggleFilter={(fId) => handleToggleColumnFilter(openFilter.field, fId)}
          onClearFilters={() => handleClearColumnFilters(openFilter.field)}
          onClose={() => setOpenFilter(null)}
          position={openFilter.position}
        />
      )}
    </div>
  );
};
