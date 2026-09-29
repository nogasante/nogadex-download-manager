import React, { useRef } from 'react';
import { DownloadItem } from '../types/download';
import { useOutsideClick } from '../hooks/useOutsideClick';
import { useEscapeKey } from '../hooks/useEscapeKey';

export const WinFilterFolderIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="1" width="9" height="10" rx="1" fill="#7dd3fc" />
    <rect x="2.5" y="2.5" width="9" height="10" rx="1" fill="#38bdf8" />
    <rect x="1" y="4" width="9" height="9.5" rx="1" fill="#0284c7" stroke="#0369a1" strokeWidth="0.6" />
    <path d="M2 5.2H8.5" stroke="#bae6fd" strokeWidth="0.6" strokeLinecap="round" />
  </svg>
);

export interface FilterOption {
  id: string;
  label: string;
  test: (item: DownloadItem) => boolean;
}

export const COLUMN_FILTER_CONFIGS: Record<string, FilterOption[]> = {
  filename: [
    { id: '0-9', label: '0 – 9', test: (d) => /^[0-9]/.test(d.filename) },
    { id: 'A-H', label: 'A – H', test: (d) => /^[A-Ha-h]/.test(d.filename) },
    { id: 'I-P', label: 'I – P', test: (d) => /^[I-Pi-p]/.test(d.filename) },
    { id: 'Q-Z', label: 'Q – Z', test: (d) => /^[Q-Zq-z]/.test(d.filename) },
    { id: 'other', label: 'Other', test: (d) => !/^[0-9A-Za-z]/.test(d.filename) },
  ],
  totalBytes: [
    { id: 'tiny', label: 'Tiny (0 – 10 KB)', test: (d) => d.totalBytes <= 10 * 1024 },
    { id: 'small', label: 'Small (10 – 100 KB)', test: (d) => d.totalBytes > 10 * 1024 && d.totalBytes <= 100 * 1024 },
    { id: 'medium', label: 'Medium (100 KB – 1 MB)', test: (d) => d.totalBytes > 100 * 1024 && d.totalBytes <= 1024 * 1024 },
    { id: 'large', label: 'Large (1 – 16 MB)', test: (d) => d.totalBytes > 1024 * 1024 && d.totalBytes <= 16 * 1024 * 1024 },
    { id: 'huge', label: 'Huge (16 – 128 MB)', test: (d) => d.totalBytes > 16 * 1024 * 1024 && d.totalBytes <= 128 * 1024 * 1024 },
    { id: 'gigantic', label: 'Gigantic (> 128 MB)', test: (d) => d.totalBytes > 128 * 1024 * 1024 },
  ],
  status: [
    { id: 'downloading', label: 'Downloading', test: (d) => d.status === 'downloading' },
    { id: 'completed', label: 'Complete', test: (d) => d.status === 'completed' },
    { id: 'paused', label: 'Paused', test: (d) => d.status === 'paused' },
    { id: 'queued', label: 'Queued', test: (d) => d.status === 'queued' },
    { id: 'error', label: 'Error', test: (d) => d.status === 'error' },
  ],
  etaSeconds: [
    { id: 'under_1m', label: '< 1 minute', test: (d) => (d.etaSeconds ?? 0) > 0 && (d.etaSeconds ?? 0) < 60 },
    { id: '1m_10m', label: '1 – 10 minutes', test: (d) => (d.etaSeconds ?? 0) >= 60 && (d.etaSeconds ?? 0) <= 600 },
    { id: 'over_10m', label: '> 10 minutes', test: (d) => (d.etaSeconds ?? 0) > 600 },
    { id: 'unknown', label: 'Unknown / Idle', test: (d) => !d.etaSeconds || d.etaSeconds <= 0 },
  ],
  speedBps: [
    { id: 'fast', label: 'Fast (> 1 MB/s)', test: (d) => (d.speedBps ?? 0) >= 1024 * 1024 },
    { id: 'active', label: 'Active (> 0 KB/s)', test: (d) => (d.speedBps ?? 0) > 0 && (d.speedBps ?? 0) < 1024 * 1024 },
    { id: 'idle', label: 'Stopped (0 KB/s)', test: (d) => !d.speedBps || d.speedBps === 0 },
  ],
  createdAt: [
    {
      id: 'today',
      label: 'Today',
      test: (d) => {
        const date = new Date(d.createdAt || Date.now());
        const today = new Date();
        return date.toDateString() === today.toDateString();
      },
    },
    {
      id: 'yesterday',
      label: 'Yesterday',
      test: (d) => {
        const date = new Date(d.createdAt || Date.now());
        const yest = new Date();
        yest.setDate(yest.getDate() - 1);
        return date.toDateString() === yest.toDateString();
      },
    },
    {
      id: 'this_week',
      label: 'Earlier this week',
      test: (d) => {
        const diff = Date.now() - new Date(d.createdAt || Date.now()).getTime();
        return diff > 86400000 && diff <= 7 * 86400000;
      },
    },
    {
      id: 'older',
      label: 'A long time ago',
      test: (d) => {
        const diff = Date.now() - new Date(d.createdAt || Date.now()).getTime();
        return diff > 7 * 86400000;
      },
    },
  ],
  url: [
    { id: 'https', label: 'HTTPS Secure', test: (d) => d.url.startsWith('https://') },
    { id: 'http', label: 'HTTP Standard', test: (d) => d.url.startsWith('http://') },
    { id: 'other', label: 'Other Protocols', test: (d) => !d.url.startsWith('http') },
  ],
};

interface ColumnFilterDropdownProps {
  field: string;
  selectedFilterIds: Set<string>;
  onToggleFilter: (filterId: string) => void;
  onClearFilters: () => void;
  onClose: () => void;
  position: { top: number; left: number };
}

export const ColumnFilterDropdown: React.FC<ColumnFilterDropdownProps> = ({
  field,
  selectedFilterIds,
  onToggleFilter,
  onClearFilters,
  onClose,
  position,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const options = COLUMN_FILTER_CONFIGS[field] || [];

  useOutsideClick(containerRef, onClose);
  useEscapeKey(onClose);

  if (options.length === 0) return null;

  return (
    <div
      ref={containerRef}
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      className="fixed z-50 min-w-[155px] bg-white border border-neutral-400 rounded-[2px] shadow-[0_4px_16px_rgba(0,0,0,0.18)] py-1 text-[12px] font-sans select-none animate-in fade-in duration-75"
    >
      <div className="px-1 space-y-0.5 max-h-[260px] overflow-y-auto">
        {options.map((opt) => {
          const isChecked = selectedFilterIds.has(opt.id);
          return (
            <div
              key={opt.id}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFilter(opt.id);
              }}
              className={`flex items-center gap-2 px-1.5 py-1 rounded-[2px] cursor-pointer transition-colors border ${
                isChecked
                  ? 'bg-brand-tint/60 border-brand-tintEdge text-brand'
                  : 'hover:bg-brand-tint hover:border-brand-tintEdge text-neutral-800 border-transparent'
              }`}
            >
              {/* Windows 3D-Style Checkbox */}
              <div
                className={`w-[13px] h-[13px] rounded-[2px] flex items-center justify-center shrink-0 border transition-all ${
                  isChecked
                    ? 'bg-brand border-brand text-white shadow-xs'
                    : 'bg-white border-neutral-400 hover:border-brand'
                }`}
              >
                {isChecked && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>

              {/* Blue 3D Folder Stack Icon (from user screenshot) */}
              <WinFilterFolderIcon className="w-3.5 h-3.5 shrink-0" />

              {/* Label */}
              <span className="truncate flex-1 font-normal text-[11.5px]">{opt.label}</span>
            </div>
          );
        })}
      </div>

      {/* Clear Filter Footer if any filters are active */}
      {selectedFilterIds.size > 0 && (
        <div className="mt-1 pt-1 border-t border-neutral-200 px-2 flex justify-between items-center text-[11px]">
          <span className="text-neutral-500">{selectedFilterIds.size} selected</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClearFilters();
            }}
            className="text-brand hover:underline font-medium cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
};
