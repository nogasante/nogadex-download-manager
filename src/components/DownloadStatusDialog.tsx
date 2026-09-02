import React, { useState } from 'react';
import { DownloadItem } from '../types/download';
import { WindowsDialog } from './common/WindowsDialog';
import { WinCheckbox, WinInput, WinButton, WinTabs, WinGroupBox } from './common/WinControls';

interface DownloadStatusDialogProps {
  isOpen: boolean;
  download: DownloadItem | null;
  onClose: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}

export const DownloadStatusDialog: React.FC<DownloadStatusDialogProps> = ({
  isOpen,
  download,
  onClose,
  onPause,
  onResume,
}) => {
  const [activeTab, setActiveTab] = useState<'status' | 'limiter' | 'options'>('status');
  const [showDetails, setShowDetails] = useState<boolean>(true);
  const [speedLimitEnabled, setSpeedLimitEnabled] = useState<boolean>(false);
  const [speedLimitKB, setSpeedLimitKB] = useState<number>(500);

  // Options on completion
  const [notifyOnComplete, setNotifyOnComplete] = useState<boolean>(true);
  const [shutdownOnComplete, setShutdownOnComplete] = useState<boolean>(false);
  const [hangupOnComplete, setHangupOnComplete] = useState<boolean>(false);

  if (!isOpen || !download) return null;

  const totalBytes = download.totalBytes || 0;
  const downloadedBytes = download.downloadedBytes || 0;
  const pct = totalBytes > 0
    ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 1000) / 10)
    : 0;

  const isDownloading = download.status === 'downloading' || download.status === 'probing';

  const formatSize = (bytes: number) => {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 KB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} MB`;
    return `${(bytes / 1024).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
  };

  const formatSpeed = (bps: number) => {
    if (!bps || isNaN(bps) || bps <= 0) return '0.00 KB/s';
    const kb = bps / 1024;
    const mb = kb / 1024;
    if (mb >= 1) return `${mb.toFixed(2)} MB/s`;
    return `${kb.toFixed(2)} KB/s`;
  };

  const formatEta = (sec: number) => {
    if (!sec || isNaN(sec) || sec <= 0 || !isFinite(sec)) return '0 sec';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    if (m > 0) return `${m} min ${s} sec`;
    return `${s} sec`;
  };

  const tabs = [
    { id: 'status', label: 'Download status' },
    { id: 'limiter', label: 'Speed Limiter' },
    { id: 'options', label: 'Options on completion' },
  ];

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
        {isDownloading ? (
          <WinButton
            variant="secondary"
            onClick={() => onPause(download.id)}
            className="min-w-[80px]"
          >
            Pause
          </WinButton>
        ) : (
          <WinButton
            variant="primary"
            onClick={() => onResume(download.id)}
            className="min-w-[80px]"
          >
            Resume
          </WinButton>
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
      title={`${pct}% ${download.filename}`}
      width="w-[600px]"
      footer={footer}
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
          {/* URL Header */}
          <div className="space-y-1">
            <label className="text-[#64748b] text-[11px] font-medium">Source URL:</label>
            <WinInput
              type="text"
              readOnly
              value={download.url}
              className="w-full font-mono text-[11px] text-[#005a9e] bg-[#f8fafc]"
            />
          </div>

          {/* Download Details Grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] bg-[#f8fafc] p-2.5 rounded-[3px] border border-[#e2e8f0]">
            <div>
              <span className="text-[#64748b]">Status:</span>{' '}
              <span className="font-semibold capitalize text-[#005a9e]">{download.status}</span>
            </div>
            <div>
              <span className="text-[#64748b]">File size:</span>{' '}
              <span className="font-semibold text-[#0f172a]">{formatSize(totalBytes)}</span>
            </div>
            <div>
              <span className="text-[#64748b]">Downloaded:</span>{' '}
              <span className="font-semibold text-[#0f172a]">
                {formatSize(downloadedBytes)} ({pct}%)
              </span>
            </div>
            <div>
              <span className="text-[#64748b]">Transfer rate:</span>{' '}
              <span className="font-semibold text-[#16a34a] font-mono">
                {formatSpeed(download.speedBps || 0)}
              </span>
            </div>
            <div>
              <span className="text-[#64748b]">Time left:</span>{' '}
              <span className="font-semibold text-[#0f172a]">
                {formatEta(download.etaSeconds || 0)}
              </span>
            </div>
            <div>
              <span className="text-[#64748b]">Resume capability:</span>{' '}
              <span className={`font-semibold ${download.resumable ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
                {download.resumable ? 'Yes' : 'No'}
              </span>
            </div>
          </div>

          {/* Windows Classic Segmented Progress Bar */}
          <div className="space-y-1">
            <div className="w-full h-5 bg-[#e2e8f0] border border-[#94a3b8] rounded-[2px] p-[1px] overflow-hidden shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-[#2563eb] to-[#3b82f6] rounded-[1px] transition-all duration-300 relative overflow-hidden"
                style={{ width: `${pct}%` }}
              >
                {/* Visual Glass Sheen */}
                <div className="absolute inset-0 bg-white/20 h-1/2" />
              </div>
            </div>
          </div>

          {/* Details Collapsible Area */}
          {showDetails && (
            <div className="space-y-2 pt-1 border-t border-[#e2e8f0]">
              <div className="text-[11px] font-semibold text-[#475569]">
                Start positions and download progress by connections:
              </div>

              {/* Chunk Visualization Ribbon */}
              <div className="w-full h-3 bg-[#e2e8f0] border border-[#cbd5e1] rounded-[2px] overflow-hidden flex">
                {(download.chunks && download.chunks.length > 0
                  ? download.chunks
                  : [{ id: 0, start: 0, end: totalBytes, downloaded: downloadedBytes, status: 'downloading' }]
                ).map((c, i) => {
                  const chunkTotal = Math.max(1, (c.end || 0) - (c.start || 0) + 1);
                  const chunkDownloaded = typeof c.downloaded === 'number' && !isNaN(c.downloaded) ? c.downloaded : 0;
                  const chunkPct = Math.min(100, (chunkDownloaded / chunkTotal) * 100);
                  const flexWeight = Math.max(1, chunkTotal);

                  return (
                    <div
                      key={i}
                      className="h-full border-r border-white/50 relative bg-[#cbd5e1]"
                      style={{ flex: flexWeight }}
                    >
                      <div
                        className="h-full bg-[#2563eb]"
                        style={{ width: `${chunkPct}%` }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Connections Table */}
              <div className="border border-[#cbd5e1] rounded-[2px] bg-white max-h-32 overflow-y-auto font-sans text-[11px]">
                <table className="w-full border-collapse">
                  <thead className="bg-[#f1f5f9] sticky top-0 border-b border-[#cbd5e1] text-[#475569]">
                    <tr>
                      <th className="py-1 px-2 w-10 text-center font-semibold">N.</th>
                      <th className="py-1 px-2 text-left font-semibold">Downloaded</th>
                      <th className="py-1 px-2 text-left font-semibold">Status / Info</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f1f5f9]">
                    {(download.chunks && download.chunks.length > 0
                      ? download.chunks
                      : [{ id: 0, start: 0, end: totalBytes, downloaded: downloadedBytes, status: download.status }]
                    ).map((chunk, idx) => {
                      const cDownloaded = typeof chunk.downloaded === 'number' && !isNaN(chunk.downloaded) ? chunk.downloaded : 0;
                      return (
                        <tr key={idx} className="hover:bg-[#f8fafc]">
                          <td className="py-1 px-2 text-center font-mono text-[#64748b]">{idx + 1}</td>
                          <td className="py-1 px-2 font-mono">{formatSize(cDownloaded)}</td>
                          <td className="py-1 px-2 text-[#005a9e]">
                            {chunk.status === 'completed' ? 'Completed' : 'Receiving data (HTTP 206 Partial)'}
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
              onChange={setSpeedLimitEnabled}
              label="Enable Speed Limiter for this download"
            />
            <div className="flex items-center gap-2 pl-6">
              <WinInput
                type="number"
                disabled={!speedLimitEnabled}
                value={speedLimitKB}
                onChange={(e) => setSpeedLimitKB(Number(e.target.value))}
                className="w-28 font-mono"
              />
              <span className="text-[#64748b]">KB/s maximum transfer speed</span>
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
    </WindowsDialog>
  );
};
