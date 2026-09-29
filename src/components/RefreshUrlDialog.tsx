import React, { useState, useEffect } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { WinButton, WinInput } from './common/WinControls';
import { DownloadItem } from '../types/download';
import { formatSize } from '../utils/formatters';
import { getApiBaseUrl } from '../config/apiConfig';
import { api } from '../api/client';

interface RefreshUrlDialogProps {
  isOpen: boolean;
  onClose: () => void;
  download: DownloadItem | null;
  downloadId?: string;
  isStandalone?: boolean;
}

export const RefreshUrlDialog: React.FC<RefreshUrlDialogProps> = ({
  isOpen,
  onClose,
  download: initialDownload,
  downloadId: propDownloadId,
  isStandalone = false,
}) => {
  const [download, setDownload] = useState<DownloadItem | null>(initialDownload);
  const [newUrl, setNewUrl] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const targetId = download?.id || propDownloadId;

  // Fetch download details if standalone or initialDownload is null
  useEffect(() => {
    if (initialDownload) {
      setDownload(initialDownload);
      setNewUrl(initialDownload.url || '');
    } else if (targetId) {
      fetch(`${getApiBaseUrl()}/api/downloads/${targetId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data && data.id) {
            setDownload(data);
            setNewUrl(data.url || '');
          }
        })
        .catch(() => {});
    }
  }, [initialDownload, targetId]);

  const handleSubmit = async () => {
    const trimmed = newUrl.trim();
    if (!trimmed || !targetId) {
      setErrorMessage('Please enter a valid HTTP/HTTPS download link.');
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      setErrorMessage('The URL must start with http:// or https://');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await api.downloads.updateUrl(targetId, trimmed);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update download address.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const footer = (
    <div className="flex items-center justify-end gap-2 w-full">
      <WinButton
        variant="primary"
        disabled={isSubmitting || !newUrl.trim()}
        onClick={handleSubmit}
        className="min-w-[120px]"
      >
        {isSubmitting ? 'Updating...' : 'Update & Resume'}
      </WinButton>
      <WinButton
        variant="secondary"
        onClick={onClose}
        disabled={isSubmitting}
        className="min-w-[80px]"
      >
        Cancel
      </WinButton>
    </div>
  );

  return (
    <WindowsDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Refresh Download Address"
      width="w-[520px]"
      footer={footer}
      isStandalone={isStandalone}
      autoFitHeight={isStandalone}
    >
      <div className="space-y-3.5 p-1 font-sans">
        <div className="text-[12.5px] text-neutral-800 leading-relaxed">
          Paste the new download link from your browser to resume{' '}
          <strong>{download?.filename || 'the file'}</strong> without restarting from scratch:
        </div>

        <div className="space-y-1.5">
          <label className="text-[11.5px] font-medium text-neutral-600 block">
            New Download URL:
          </label>
          <WinInput
            value={newUrl}
            onChange={(e) => {
              setNewUrl(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder="https://..."
            className="w-full font-mono text-[11.5px] h-[28px]"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
          />
        </div>

        {errorMessage && (
          <div className="text-[11.5px] text-status-error bg-red-50 border border-red-200 px-2 py-1 rounded-[2px]">
            {errorMessage}
          </div>
        )}

        {download && download.downloadedBytes > 0 && (
          <div className="text-[11.5px] text-neutral-500 bg-neutral-50 p-2 rounded-[3px] border border-neutral-200">
            ℹ️ Your previously downloaded{' '}
            <span className="font-semibold text-neutral-900 font-mono">
              {formatSize(download.downloadedBytes)}
            </span>{' '}
            ({((download.downloadedBytes / (download.totalBytes || 1)) * 100).toFixed(1)}%) will be retained and resumed automatically.
          </div>
        )}
      </div>
    </WindowsDialog>
  );
};
