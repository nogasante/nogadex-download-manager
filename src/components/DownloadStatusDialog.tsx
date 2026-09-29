import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DownloadItem } from '../types/download';
import { WindowsDialog } from './common/WindowsDialog';
import { WinCheckbox, WinInput, WinButton, WinTabs, WinGroupBox } from './common/WinControls';
import { formatSize, formatSpeed, formatEta, formatPercentage } from '../utils/formatters';
import { isDownloadActive } from '../utils/downloadHelpers';
import { pickHelpGuideForError } from '../utils/errorHelp';
import { FileIcon } from './FileIcon';
import { getApiBaseUrl, getWsUrl } from '../config/apiConfig';

interface DownloadStatusDialogProps {
  isOpen: boolean;
  download: DownloadItem | null;
  onClose: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel?: (id: string) => void;
  onOpenFile?: (path: string) => void;
  onOpenFolder?: (path: string) => void;
  onSetSpeedLimit?: (id: string, speedLimitKB: number) => void;
  /** Optional hook to open Help Center in-app (browser/modal mode). */
  onOpenHelpCenter?: (tab?: 'howto' | 'faq' | 'bug' | 'feedback' | 'legal', guide?: string) => void;
  isStandalone?: boolean;
}

export const DownloadStatusDialog: React.FC<DownloadStatusDialogProps> = ({
  isOpen,
  download: initialDownload,
  onClose,
  onPause,
  onResume,
  onCancel,
  onOpenFile,
  onOpenFolder,
  onSetSpeedLimit,
  onOpenHelpCenter,
  isStandalone = false,
}) => {
  const [activeTab, setActiveTab] = useState<'status' | 'limiter' | 'options'>('status');
  const [showDetails, setShowDetails] = useState<boolean>(true);
  const [speedLimitEnabled, setSpeedLimitEnabled] = useState<boolean>(false);
  const [speedLimitKB, setSpeedLimitKB] = useState<number>(500);

  // Live real-time download item state
  const [liveDownload, setLiveDownload] = useState<DownloadItem | null>(initialDownload);
  const liveDownloadRef = useRef<DownloadItem | null>(initialDownload);

  // Refresh URL modal state
  const [isRefreshingUrl, setIsRefreshingUrl] = useState<boolean>(false);
  const [newUrlInput, setNewUrlInput] = useState<string>('');
  const [isUpdatingUrl, setIsUpdatingUrl] = useState<boolean>(false);

  useEffect(() => {
    setLiveDownload(initialDownload);
    liveDownloadRef.current = initialDownload;
  }, [initialDownload]);

  // Establish direct live WebSocket & polling listener for 60fps real-time updates
  useEffect(() => {
    if (!isOpen || !initialDownload?.id) return;

    let isMounted = true;
    const downloadId = initialDownload.id;

    // 1. Direct Polling Fallback (every 500ms while active)
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/downloads/${downloadId}`, {
          signal: AbortSignal.timeout(1500),
        });
        if (res.ok && isMounted) {
          const item = await res.json();
          setLiveDownload((prev) => {
            const merged = prev ? { ...prev, ...item } : item;
            liveDownloadRef.current = merged;
            return merged;
          });
        }
      } catch {}
    }, 500);

    // 2. Real-time WebSocket connection for instant 60fps streaming
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(getWsUrl());
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'DOWNLOAD_PROGRESS' && msg.data?.id === downloadId && isMounted) {
            setLiveDownload((prev) => {
              const updated = prev ? { ...prev, ...msg.data } : msg.data;
              liveDownloadRef.current = updated;
              return updated;
            });
          } else if (
            (msg.type === 'STATE_UPDATE' || msg.type === 'DOWNLOADS_UPDATE' || msg.type === 'INIT_STATE') &&
            isMounted
          ) {
            const list = Array.isArray(msg.data) ? msg.data : (msg.data?.downloads || msg.downloads);
            if (Array.isArray(list)) {
              const item = list.find((d: DownloadItem) => d.id === downloadId);
              if (item) {
                setLiveDownload((prev) => {
                  const updated = prev ? { ...prev, ...item } : item;
                  liveDownloadRef.current = updated;
                  return updated;
                });
              }
            }
          }
        } catch {}
      };
    } catch {}

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      if (ws) ws.close();
    };
  }, [isOpen, initialDownload?.id]);

  const download = liveDownload || initialDownload;

  useEffect(() => {
    if (download) {
      const hasLimit = typeof download.speedLimitKB === 'number' && download.speedLimitKB > 0;
      setSpeedLimitEnabled(hasLimit);
      if (hasLimit) setSpeedLimitKB(download.speedLimitKB!);
    }
  }, [download?.id, download?.speedLimitKB]);

  const handleToggleSpeedLimit = (enabled: boolean) => {
    setSpeedLimitEnabled(enabled);
    if (download && onSetSpeedLimit) {
      onSetSpeedLimit(download.id, enabled ? speedLimitKB : 0);
    }
  };

  const handleChangeSpeedLimit = (val: number) => {
    const num = Math.max(0, val);
    setSpeedLimitKB(num);
    if (download && speedLimitEnabled && onSetSpeedLimit) {
      onSetSpeedLimit(download.id, num);
    }
  };

  // Safe file and folder opening with Electron & backend API fallbacks
  const triggerOpenFile = useCallback(() => {
    if (!download?.destinationPath) return;
    if (onOpenFile) {
      onOpenFile(download.destinationPath);
    } else if ((window as any).electronAPI?.openFile) {
      (window as any).electronAPI.openFile(download.destinationPath);
    } else {
      fetch(`${getApiBaseUrl()}/api/open-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: download.destinationPath }),
      }).catch(() => {});
    }
  }, [download?.destinationPath, onOpenFile]);

  const triggerOpenFolder = useCallback(() => {
    if (!download?.destinationPath) return;
    if (onOpenFolder) {
      onOpenFolder(download.destinationPath);
    } else if ((window as any).electronAPI?.showItemInFolder) {
      (window as any).electronAPI.showItemInFolder(download.destinationPath);
    } else {
      fetch(`${getApiBaseUrl()}/api/open-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: download.destinationPath }),
      }).catch(() => {});
    }
  }, [download?.destinationPath, onOpenFolder]);

  // Options on completion
  const [notifyOnComplete, setNotifyOnComplete] = useState<boolean>(true);
  const [shutdownOnComplete, setShutdownOnComplete] = useState<boolean>(false);
  const [hangupOnComplete, setHangupOnComplete] = useState<boolean>(false);

  if (!isOpen || !download) return null;

  const totalBytes = download.totalBytes || 0;
  const downloadedBytes = download.downloadedBytes || 0;
  const numPct = formatPercentage(downloadedBytes, totalBytes, 1);
  const pct = numPct.toFixed(1);

  // Determine Dialog State
  const isCompleted = download.status === 'completed';
  const isPaused = download.status === 'paused';
  const isError = download.status === 'error';
  const isAssembling = (download.status as any) === 'assembling' || (download.status as any) === 'rebuilding';
  void isDownloadActive;

  // The "Get help" link opens the guide matching *why* it failed: login/link
  // trouble goes to the logins guide, network trouble to pause-resume & retry.
  const errorHelp = isError ? pickHelpGuideForError(download.error) : null;

  // Segmented progress model: one segment per parallel connection.
  // Falls back to a single whole-file segment when the engine hasn't sent
  // chunk detail (single-stream / non-resumable downloads).
  const rawChunks: any[] = download.chunks && download.chunks.length > 0
    ? download.chunks
    : [{ startByte: 0, endByte: totalBytes, downloadedBytes, totalBytes, status: download.status }];
  const segments = rawChunks.map((c: any) => {
    const startByte = typeof c.startByte === 'number' ? c.startByte : (typeof c.start === 'number' ? c.start : 0);
    const endByte = typeof c.endByte === 'number' ? c.endByte : (typeof c.end === 'number' ? c.end : 0);
    const cDownloaded = typeof c.downloadedBytes === 'number' ? c.downloadedBytes : (typeof c.downloaded === 'number' ? c.downloaded : 0);
    const cTotal = typeof c.totalBytes === 'number' && c.totalBytes > 0
      ? c.totalBytes
      : (endByte > startByte ? endByte - startByte + 1 : 0);
    const cStatus = c.status || (isCompleted ? 'done' : 'downloading');
    return { startByte, endByte, downloadedBytes: cDownloaded, totalBytes: cTotal, status: cStatus };
  });

  // Dynamic Dialog Title per State
  const dialogTitle = isCompleted
    ? `Download complete - ${download.filename}`
    : isPaused
    ? `Paused - ${download.filename}`
    : isError
    ? `Download failed - ${download.filename}`
    : isAssembling
    ? `Building file... - ${download.filename}`
    : `${pct}% ${download.filename}`;

  const tabs = [
    { id: 'status', label: 'Download status' },
    { id: 'limiter', label: 'Speed Limiter' },
    { id: 'options', label: 'Options on completion' },
  ];

  // Dynamic Footer Actions per State
  const footer = (
    <div className="w-full flex items-center justify-between">
      <WinButton
        variant="secondary"
        onClick={() => setShowDetails(!showDetails)}
        className="min-w-[100px]"
      >
        {showDetails ? '<< Hide details' : 'Details >>'}
      </WinButton>

      <div className="flex items-center gap-2">
        {isCompleted ? (
          <>
            <WinButton
              variant="primary"
              onClick={triggerOpenFile}
              className="min-w-[80px]"
            >
              Open
            </WinButton>
            <WinButton
              variant="secondary"
              onClick={triggerOpenFolder}
              className="min-w-[90px]"
            >
              Open Folder
            </WinButton>
          </>
        ) : isPaused ? (
          <>
            <WinButton
              variant="primary"
              onClick={() => onResume(download.id)}
              className="min-w-[80px]"
            >
              Resume
            </WinButton>
            {onCancel && (
              <WinButton
                variant="secondary"
                onClick={() => onCancel(download.id)}
                className="min-w-[80px]"
              >
                Cancel
              </WinButton>
            )}
          </>
        ) : isError ? (
          <>
            <WinButton
              variant="primary"
              onClick={() => onResume(download.id)}
              className="min-w-[80px]"
            >
              Retry
            </WinButton>
            <WinButton
              variant="secondary"
              onClick={() => {
                if ((window as any).electronAPI?.openWindow) {
                  (window as any).electronAPI.openWindow('refresh-url', { id: download.id });
                } else {
                  setNewUrlInput(download.url || '');
                  setIsRefreshingUrl(true);
                }
              }}
              className="min-w-[95px]"
            >
              Refresh Link
            </WinButton>
            {onCancel && (
              <WinButton
                variant="secondary"
                onClick={() => onCancel(download.id)}
                className="min-w-[80px]"
              >
                Cancel
              </WinButton>
            )}
            <button
              type="button"
              onClick={() => {
                const guide = errorHelp?.guideId || 'pause-resume';
                if ((window as any).electronAPI?.openWindow) {
                  (window as any).electronAPI.openWindow('help-center', { tab: 'howto', guide });
                } else if (onOpenHelpCenter) {
                  onOpenHelpCenter('howto', guide);
                }
              }}
              className="text-[11px] text-brand hover:underline whitespace-nowrap"
              title={errorHelp?.title || 'Open the pause, resume & retry guide'}
            >
              Get help
            </button>
          </>
        ) : isAssembling ? (
          <div className="text-[11px] text-status-assembling font-medium animate-pulse px-2">
            Finalizing assembly...
          </div>
        ) : (
          <>
            <WinButton
              variant="secondary"
              onClick={() => onPause(download.id)}
              className="min-w-[80px]"
            >
              Pause
            </WinButton>
            {onCancel && (
              <WinButton
                variant="secondary"
                onClick={() => onCancel(download.id)}
                className="min-w-[80px]"
              >
                Cancel
              </WinButton>
            )}
          </>
        )}
        <WinButton
          variant="secondary"
          onClick={onClose}
          className="min-w-[80px]"
        >
          Close
        </WinButton>
      </div>
    </div>
  );

  return (
    <WindowsDialog
      isOpen={isOpen}
      onClose={onClose}
      title={dialogTitle}
      width="w-[640px]"
      footer={footer}
      isStandalone={isStandalone}
      autoFitHeight={isStandalone}
      showMinimize={true}
    >
      {/* Tabs */}
      <WinTabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {/* Tab: Download status */}
      {activeTab === 'status' && (
        <div className="space-y-3">
          {/* File & App Icon Header */}
          <div className="flex items-center gap-2.5 p-2 bg-neutral-50 rounded-[3px] border border-neutral-200">
            <FileIcon filename={download.filename} filePath={download.destinationPath} className="w-7 h-7 shrink-0" />
            <div className="truncate flex-1">
              <div className="font-bold text-[13px] text-neutral-900 truncate">{download.filename}</div>
              <div 
                onClick={triggerOpenFolder} 
                className="text-[11px] text-brand hover:underline cursor-pointer truncate font-sans"
                title="Click to open folder in Explorer"
              >
                {download.destinationPath || 'Downloads'}
              </div>
            </div>
          </div>

          {/* URL Header */}
          <div className="space-y-1">
            <label className="text-neutral-500 text-[11px] font-medium">Address:</label>
            <WinInput
              type="text"
              readOnly
              value={download.url}
              className="w-full font-mono text-[11px] text-brand bg-neutral-50"
            />
          </div>

          {/* Download Details - Professional State-Specific Layout */}
          {isCompleted ? (
            <div className="bg-neutral-50 p-3 rounded-[3px] border border-neutral-200 space-y-2 text-[12px]">
              <div className="flex items-center justify-between pb-1.5 border-b border-neutral-200">
                <div className="flex items-center gap-2">
                  <span className="text-neutral-500">Status:</span>
                  <span className="font-bold text-status-completed text-[12.5px] inline-flex items-center gap-1">
                    Download complete
                  </span>
                </div>
                <div className="text-[11px] text-neutral-500 font-mono">
                  {formatSize(totalBytes, true)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 pt-0.5 text-[12px]">
                <div className="truncate">
                  <span className="text-neutral-500">Saved to:</span>{' '}
                  <span
                    onClick={triggerOpenFolder}
                    className="font-medium text-brand hover:underline cursor-pointer truncate"
                    title={download.destinationPath}
                  >
                    {download.destinationPath ? download.destinationPath.split(/[/\\]/).pop() || download.destinationPath : 'Downloads'}
                  </span>
                </div>
                <div>
                  <span className="text-neutral-500">Downloaded:</span>{' '}
                  <span className="font-semibold text-neutral-900">{formatSize(totalBytes)} (100%)</span>
                </div>
                {download.speedBps && download.speedBps > 0 ? (
                  <div>
                    <span className="text-neutral-500">Average speed:</span>{' '}
                    <span className="font-medium text-neutral-900 font-mono">{formatSpeed(download.speedBps)}</span>
                  </div>
                ) : null}
                <div>
                  <span className="text-neutral-500">Total size:</span>{' '}
                  <span className="font-semibold text-neutral-900">{formatSize(totalBytes)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] bg-neutral-50 p-2.5 rounded-[3px] border border-neutral-200">
              <div>
                <span className="text-neutral-500">Status:</span>{' '}
                {isPaused ? (
                  <span className="font-bold text-status-paused">Paused</span>
                ) : isError ? (
                  <span className="font-bold text-status-error">Failed</span>
                ) : isAssembling ? (
                  <span className="font-bold text-status-assembling">Rebuilding File...</span>
                ) : (
                  <span className="font-semibold text-brand">Downloading...</span>
                )}
              </div>

              <div>
                <span className="text-neutral-500">File size:</span>{' '}
                <span className="font-semibold text-neutral-900">{formatSize(totalBytes)}</span>
              </div>

              <div>
                <span className="text-neutral-500">Downloaded:</span>{' '}
                <span className="font-semibold text-neutral-900">
                  {formatSize(downloadedBytes, true)} ({pct}%)
                </span>
              </div>

              <div>
                <span className="text-neutral-500">Transfer rate:</span>{' '}
                {isPaused ? (
                  <span className="text-status-paused font-mono">Paused</span>
                ) : isError ? (
                  <span className="text-status-error font-mono">Stopped</span>
                ) : (
                  <span className="font-semibold text-status-completed font-mono">
                    {formatSpeed(download.speedBps || 0)}
                  </span>
                )}
              </div>

              <div>
                <span className="text-neutral-500">Time left:</span>{' '}
                <span className="font-semibold text-neutral-900">
                  {isPaused ? 'Paused' : formatEta(download.etaSeconds || 0)}
                </span>
              </div>

              <div>
                <span className="text-neutral-500">Resume capability:</span>{' '}
                <span className={`font-semibold ${download.resumable ? 'text-status-completed' : 'text-neutral-500'}`}>
                  {download.resumable ? 'Yes' : 'No'}
                </span>
              </div>

              <div>
                <span className="text-neutral-500">Connections:</span>{' '}
                <span className="font-semibold text-neutral-900 font-mono">
                  {download.connections || segments.length}{download.autoStreams ? ' (auto)' : ''}
                </span>
              </div>

              {isError && download.error && (
                <div className="col-span-2 pt-1">
                  <span className="text-status-error font-semibold">Error details:</span>{' '}
                  <span className="text-status-error font-mono text-[11px] bg-red-50 px-1 py-0.5 rounded border border-red-200 block mt-0.5">
                    {download.error}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Segmented 3D Progress Bar: one glossy block per parallel
              connection with 2px gaps. Single-stream downloads render one
              full-width block. */}
          <div className="space-y-1">
            <div className="w-full h-6 ndm-progress-trench-3d p-[1.5px] flex gap-[2px] overflow-hidden">
              {segments.map((seg, i) => {
                const segTotal = Math.max(1, seg.totalBytes || 1);
                const segDone = isCompleted || seg.status === 'done' || seg.status === 'completed' || seg.downloadedBytes >= segTotal;
                const segPct = segDone ? 100 : Math.min(100, Math.max(0, (seg.downloadedBytes / segTotal) * 100));
                return (
                  <div
                    key={i}
                    className="h-full rounded-[2px] relative overflow-hidden"
                    style={{ flex: Math.max(1, segTotal) }}
                    title={`Connection ${i + 1}: ${formatSize(seg.downloadedBytes)} / ${formatSize(seg.totalBytes)} (${Math.round(segPct)}%)`}
                  >
                    <div
                      className={`h-full transition-all duration-300 relative overflow-hidden ${
                        segDone
                          ? 'ndm-progress-fill-3d-complete'
                          : isPaused
                          ? 'ndm-progress-fill-3d-paused'
                          : isError
                          ? 'ndm-progress-fill-3d-error'
                          : isAssembling
                          ? 'ndm-progress-fill-3d-assembling'
                          : 'ndm-progress-fill-3d-active'
                      }`}
                      style={{ width: `${segPct}%` }}
                    >
                      <div className="absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-white/60 to-transparent pointer-events-none" />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between text-[10.5px] font-mono text-neutral-500 px-0.5">
              <span>
                {segments.length === 1 ? 'Single connection' : `${segments.length} parallel connections`}
                {' · '}{formatSize(downloadedBytes)} of {formatSize(totalBytes)}
              </span>
              <span className="font-bold text-neutral-700">{pct}%</span>
            </div>
          </div>

          {/* Details Collapsible Area (per-connection table) */}
          {showDetails && (
            <div className="space-y-2 pt-1 border-t border-neutral-200">
              <div className="text-[11px] font-semibold text-neutral-600 flex items-center justify-between">
                <span>Download progress by connections:</span>
                <span className="font-mono text-[10.5px] text-neutral-500">
                  {segments.length} {segments.length === 1 ? 'Connection' : 'Parallel Connections'}
                </span>
              </div>

              <div className="border border-neutral-300 rounded-[2px] bg-white max-h-36 overflow-y-auto font-sans text-[11px] custom-scrollbar">
                <table className="w-full border-collapse">
                  <thead className="bg-neutral-100 sticky top-0 border-b border-neutral-300 text-neutral-600 z-10">
                    <tr>
                      <th className="py-1 px-2 w-10 text-center font-semibold">N.</th>
                      <th className="py-1 px-2 text-left font-semibold">Range</th>
                      <th className="py-1 px-2 text-left font-semibold">Downloaded</th>
                      <th className="py-1 px-2 text-left font-semibold">Status / Info</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {segments.map((seg, idx) => {
                      const cDownloaded = Math.max(0, seg.downloadedBytes || 0);
                      const cTotal = Math.max(1, seg.totalBytes || 1);
                      const isChunkDone = isCompleted || seg.status === 'done' || seg.status === 'completed' || cDownloaded >= cTotal;

                      return (
                        <tr key={idx} className="hover:bg-neutral-50">
                          <td className="py-1 px-2 text-center font-mono text-neutral-500">{idx + 1}</td>
                          <td className="py-1 px-2 font-mono text-neutral-600">
                            {seg.startByte.toLocaleString()} – {seg.endByte.toLocaleString()}
                          </td>
                          <td className="py-1 px-2 font-mono">
                            {formatSize(cDownloaded)} {cTotal > 1 ? `/ ${formatSize(cTotal)}` : ''}
                          </td>
                          <td className="py-1 px-2">
                            {isCompleted || isChunkDone ? (
                              <span className="text-status-completed font-semibold">Completed (100%)</span>
                            ) : isPaused ? (
                              <span className="text-status-paused">Stream paused</span>
                            ) : isError ? (
                              <span className="text-status-error">Stream interrupted</span>
                            ) : (
                              <span className="text-brand">Receiving data</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Speed Limiter */}
      {activeTab === 'limiter' && (
        <div className="space-y-4">
          <WinGroupBox title="Bandwidth Throttling" className="space-y-3">
            <WinCheckbox
              checked={speedLimitEnabled}
              onChange={handleToggleSpeedLimit}
              label="Enable Speed Limiter for this download"
            />
            <div className="flex items-center gap-2 pl-6">
              <WinInput
                type="number"
                disabled={!speedLimitEnabled}
                value={speedLimitKB}
                onChange={(e) => handleChangeSpeedLimit(Number(e.target.value))}
                className="w-28 font-mono"
              />
              <span className="text-neutral-500">KB/s maximum transfer speed</span>
            </div>
          </WinGroupBox>
        </div>
      )}

      {/* Tab: Options on completion */}
      {activeTab === 'options' && (
        <div className="space-y-4">
          <WinGroupBox title="Post-Download Actions" className="space-y-3">
            <WinCheckbox
              checked={notifyOnComplete}
              onChange={setNotifyOnComplete}
              label="Show completion notification"
            />
            <div />
            <WinCheckbox
              checked={hangupOnComplete}
              onChange={setHangupOnComplete}
              label="Disconnect network connection when download finishes"
            />
            <div />
            <WinCheckbox
              checked={shutdownOnComplete}
              onChange={setShutdownOnComplete}
              label="Turn off computer when all downloads finish"
            />
          </WinGroupBox>
        </div>
      )}

      {/* Refresh Link Modal */}
      {isRefreshingUrl && (
        <WindowsDialog
          isOpen={isRefreshingUrl}
          onClose={() => setIsRefreshingUrl(false)}
          title="Refresh Download Address"
          width="w-[520px]"
          footer={
            <>
              <WinButton
                variant="primary"
                disabled={isUpdatingUrl || !newUrlInput.trim()}
                onClick={async () => {
                  if (!newUrlInput.trim() || !download) return;
                  setIsUpdatingUrl(true);
                  try {
                    const res = await fetch(`${getApiBaseUrl()}/api/downloads/${download.id}/update-url`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ url: newUrlInput.trim() }),
                    });
                    if (res.ok) {
                      setIsRefreshingUrl(false);
                      setNewUrlInput('');
                      onResume(download.id);
                    }
                  } catch {}
                  setIsUpdatingUrl(false);
                }}
                className="min-w-[90px]"
              >
                {isUpdatingUrl ? 'Updating...' : 'Update & Resume'}
              </WinButton>
              <WinButton
                variant="secondary"
                onClick={() => setIsRefreshingUrl(false)}
                className="min-w-[70px]"
              >
                Cancel
              </WinButton>
            </>
          }
        >
          <div className="space-y-3 p-1">
            <div className="text-[12px] text-neutral-700">
              Paste the new download link from your browser to resume <strong>{download.filename}</strong> without restarting from scratch:
            </div>
            <WinInput
              value={newUrlInput}
              onChange={(e) => setNewUrlInput(e.target.value)}
              placeholder="https://..."
              className="w-full font-mono text-[11.5px]"
              autoFocus
            />
            <div className="text-[11px] text-neutral-500">
              Your previously downloaded <strong>{formatSize(downloadedBytes)}</strong> will be retained.
            </div>
          </div>
        </WindowsDialog>
      )}
    </WindowsDialog>
  );
};
