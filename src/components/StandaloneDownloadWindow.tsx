import React, { useEffect, useState } from 'react';
import { DownloadItem } from '../types/download';
import { ChunkVisualizer } from './ChunkVisualizer';
import { Play, Pause, X, ExternalLink, FolderOpen, AlertCircle } from 'lucide-react';

interface StandaloneDownloadWindowProps {
  downloadId: string;
}

export const StandaloneDownloadWindow: React.FC<StandaloneDownloadWindowProps> = ({ downloadId }) => {
  const [download, setDownload] = useState<DownloadItem | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/downloads/${downloadId}`)
      .then(res => {
        if (!res.ok) throw new Error('Download not found');
        return res.json();
      })
      .then(data => setDownload(data))
      .catch(() => setIsNotFound(true));

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'DOWNLOAD_UPDATE' && msg.data?.id === downloadId) {
          setDownload(msg.data);
        } else if (msg.type === 'STATE_UPDATE' && Array.isArray(msg.data?.downloads)) {
          const found = msg.data.downloads.find((d: DownloadItem) => d.id === downloadId);
          if (found) setDownload(found);
        }
      } catch {}
    };

    const timer = setTimeout(() => {
      setDownload(prev => {
        if (!prev) setIsNotFound(true);
        return prev;
      });
    }, 4000);

    return () => {
      ws.close();
      clearTimeout(timer);
    };
  }, [downloadId]);

  const handlePause = async () => {
    try {
      await fetch(`/api/downloads/${downloadId}/pause`, { method: 'POST' });
    } catch {}
  };

  const handleResume = async () => {
    try {
      await fetch(`/api/downloads/${downloadId}/resume`, { method: 'POST' });
    } catch {}
  };

  const handleOpenFile = async () => {
    if (download) {
      try {
        await fetch('/api/open-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: download.destinationPath }),
        });
      } catch {}
    }
  };

  const handleOpenFolder = async () => {
    if (download) {
      try {
        await fetch('/api/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: download.destinationPath }),
        });
      } catch {}
    }
  };

  const handleClose = () => {
    window.close();
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0)} ${sizes[i]}`;
  };

  const formatSpeed = (bps: number) => {
    if (!bps || bps === 0) return '—';
    if (bps >= 1024 * 1024 * 1024) return `${(bps / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
    if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
    if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${bps} B/s`;
  };

  const formatEta = (seconds: number) => {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '—';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  if (isNotFound) {
    return (
      <div className="h-screen w-screen bg-[#f3f3f2] flex flex-col items-center justify-center p-6 text-center select-none text-xs text-[#202020]">
        <AlertCircle className="w-8 h-8 text-[#a80000] mb-2" />
        <h2 className="font-semibold text-sm">Download Unavailable</h2>
        <p className="text-[#606060] mt-1 max-w-xs">
          This download has completed or is no longer present in HyperDownloader.
        </p>
        <button
          onClick={handleClose}
          className="mt-4 px-4 py-1.5 bg-[#ffffff] hover:bg-[#e8e8e6] active:bg-[#dedede] border border-[#adadad] rounded text-xs font-medium"
        >
          Close
        </button>
      </div>
    );
  }

  if (!download) {
    return (
      <div className="h-screen w-screen bg-[#f3f3f2] flex flex-col items-center justify-center p-6 text-center select-none text-xs text-[#606060]">
        <div className="w-5 h-5 border-2 border-[#adadad] border-t-[#202020] rounded-full animate-spin mb-2" />
        <p>Connecting to download engine...</p>
      </div>
    );
  }

  const percentage = download.totalBytes > 0 
    ? Math.min(100, Math.round((download.downloadedBytes / download.totalBytes) * 100)) 
    : 0;

  const isCompleted = download.status === 'completed';
  const isDownloading = download.status === 'downloading';
  const isPaused = download.status === 'paused';

  return (
    <div className="h-screen w-screen bg-[#ffffff] flex flex-col select-none overflow-hidden text-xs text-[#1e1e1e]">
      {/* Mini Titlebar */}
      <div className="h-8 bg-[#f3f3f2] border-b border-[#e5e5e3] px-3 flex items-center justify-between app-drag-region shrink-0">
        <span className="font-semibold truncate max-w-xs">{download.filename}</span>
        <button
          onClick={handleClose}
          aria-label="Close"
          className="app-no-drag p-1 text-[#606060] hover:text-[#1e1e1e] hover:bg-[#e5e5e3] rounded"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3.5">
        {/* Info Grid */}
        <div className="p-3 bg-[#f9f9f8] border border-[#e5e5e3] rounded space-y-1.5 font-mono text-[11px]">
          <div className="truncate">
            <span className="text-[#707070]">File: </span>
            <span className="font-semibold text-[#1e1e1e]">{download.filename}</span>
          </div>
          <div className="truncate">
            <span className="text-[#707070]">URL: </span>
            <span className="text-[#0067b8]" title={download.url}>{download.url}</span>
          </div>
          <div className="truncate">
            <span className="text-[#707070]">Save to: </span>
            <span title={download.destinationPath}>{download.destinationPath}</span>
          </div>
          <div className="grid grid-cols-2 pt-1 border-t border-[#e5e5e3]">
            <div>Status: <span className="font-semibold uppercase">{download.status}</span></div>
            <div>Streams: <span>{download.connections || 1} active</span></div>
          </div>
        </div>

        {/* Progress Section */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between font-mono text-[11px]">
            <span>{formatBytes(download.downloadedBytes)} of {formatBytes(download.totalBytes)} ({percentage}%)</span>
            <span className="font-semibold">{formatSpeed(download.speedBps)}</span>
          </div>

          <div className="h-3 w-full bg-[#e5e5e3] rounded-sm overflow-hidden">
            <div
              className={`h-full transition-all duration-150 ${
                isCompleted ? 'bg-[#107c41]' : isPaused ? 'bg-[#8a6600]' : 'bg-[#c4b5a3]'
              }`}
              style={{ width: `${percentage}%` }}
            />
          </div>

          <div className="flex items-center justify-between font-mono text-[11px] text-[#707070]">
            <span>Time Left: {formatEta(download.etaSeconds)}</span>
            <span>Resume: {download.resumable ? 'Supported' : 'No'}</span>
          </div>
        </div>

        {/* Streams Visualizer */}
        <div className="p-2.5 bg-[#f9f9f8] border border-[#e5e5e3] rounded">
          <ChunkVisualizer chunks={download.chunks || []} totalBytes={download.totalBytes} />
        </div>
      </div>

      {/* Windows Dialog Buttons */}
      <div className="h-11 bg-[#f3f3f2] border-t border-[#e5e5e3] px-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          {isCompleted && (
            <>
              <button
                onClick={handleOpenFile}
                className="px-3 py-1 bg-[#ffffff] hover:bg-[#e8e8e6] active:bg-[#dedede] border border-[#adadad] rounded text-xs flex items-center gap-1 font-medium"
              >
                <ExternalLink className="w-3 h-3 text-[#0067b8]" />
                <span>Open File</span>
              </button>
              <button
                onClick={handleOpenFolder}
                className="px-3 py-1 bg-[#ffffff] hover:bg-[#e8e8e6] active:bg-[#dedede] border border-[#adadad] rounded text-xs flex items-center gap-1"
              >
                <FolderOpen className="w-3 h-3 text-[#d8a436]" />
                <span>Open Folder</span>
              </button>
            </>
          )}

          {isDownloading && (
            <button
              onClick={handlePause}
              className="px-3 py-1 bg-[#ffffff] hover:bg-[#e8e8e6] active:bg-[#dedede] border border-[#adadad] rounded text-xs flex items-center gap-1 font-medium"
            >
              <Pause className="w-3 h-3 text-[#8a6600]" />
              <span>Pause</span>
            </button>
          )}

          {isPaused && (
            <button
              onClick={handleResume}
              className="px-3 py-1 bg-[#e6d8c7] hover:bg-[#dccebc] active:bg-[#cdbfae] text-[#3a2d1d] border border-[#c4b5a3] rounded text-xs flex items-center gap-1 font-semibold"
            >
              <Play className="w-3 h-3 text-[#107c41] fill-current" />
              <span>Resume</span>
            </button>
          )}
        </div>

        <button
          onClick={handleClose}
          className="px-4 py-1 bg-[#ffffff] hover:bg-[#e8e8e6] active:bg-[#dedede] border border-[#adadad] rounded text-xs font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
};
