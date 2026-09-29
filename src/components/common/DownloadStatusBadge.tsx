import React from 'react';
import { DownloadItem } from '../../types/download';
import { formatPercentage } from '../../utils/formatters';

interface DownloadStatusBadgeProps {
  status: DownloadItem['status'];
  downloadedBytes?: number;
  totalBytes?: number;
  className?: string;
  showPercentage?: boolean;
}

/**
 * Canonical semantic-status rendering. Styles come exclusively from the
 * `status.*` design tokens (see tailwind.config.js) — no raw colors here.
 */
const STATUS_STYLES: Record<DownloadItem['status'], string> = {
  downloading: 'text-status-downloading font-semibold',
  probing: 'text-status-downloading font-semibold',
  completed: 'text-status-completed font-medium',
  paused: 'text-status-paused font-medium',
  error: 'text-status-error font-semibold',
  queued: 'text-status-queued font-normal',
};

const STATUS_LABELS: Partial<Record<DownloadItem['status'], string>> = {
  completed: 'Complete',
  probing: 'Downloading',
};

export const DownloadStatusBadge: React.FC<DownloadStatusBadgeProps> = ({
  status,
  downloadedBytes = 0,
  totalBytes = 0,
  className = '',
  showPercentage = true,
}) => {
  const pct = formatPercentage(downloadedBytes, totalBytes);
  const label = STATUS_LABELS[status] ?? status;
  const showPct = showPercentage && status !== 'queued';

  return (
    <span
      className={`capitalize ${STATUS_STYLES[status] ?? 'text-neutral-600 font-normal'} flex items-center gap-1 ${className}`}
    >
      <span>{label}</span>
      {showPct && <span>({pct}%)</span>}
    </span>
  );
};
