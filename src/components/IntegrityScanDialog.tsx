import React, { useState } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { WinButton } from './common/WinControls';
import { api } from '../api/client';
import type { IntegrityScanReport } from '../types/download';

interface IntegrityScanDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onScanned?: () => void;
}

const STATUS_STYLES: Record<string, { cls: string; label: string }> = {
  verified: { cls: 'bg-green-100 text-green-700 border-green-300', label: 'Verified' },
  mismatch: { cls: 'bg-red-100 text-red-700 border-red-300', label: 'Mismatch' },
  unverified: { cls: 'bg-neutral-100 text-neutral-600 border-neutral-300', label: 'Unverified' },
  missing: { cls: 'bg-orange-100 text-orange-700 border-orange-300', label: 'Missing' },
  unreadable: { cls: 'bg-orange-100 text-orange-700 border-orange-300', label: 'Unreadable' },
};

export const IntegrityScanDialog: React.FC<IntegrityScanDialogProps> = ({ isOpen, onClose, onScanned }) => {
  const [report, setReport] = useState<IntegrityScanReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    try {
      try {
        const r = await api.downloads.integrityScan();
        setReport(r);
        onScanned?.();
        return;
      } catch {
        // The engine may still be waking up (e.g. right after the app
        // opens) — give it a moment, then try once more before giving up.
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      const r = await api.downloads.integrityScan();
      setReport(r);
      onScanned?.();
    } catch (e: any) {
      setError(e?.message || 'Scan failed. Make sure NDM is running, then click Re-scan.');
    } finally {
      setScanning(false);
    }
  };

  // Auto-run the first scan when the dialog opens.
  React.useEffect(() => {
    if (isOpen && !report && !scanning && !error) {
      void runScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const fmtSize = (n: number) =>
    n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`;

  return (
    <WindowsDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Integrity Scan"
      icon="🛡️"
      width="640px"
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-[11px] text-neutral-500">
            {report
              ? `${report.scanned} completed download${report.scanned === 1 ? '' : 's'} checked`
              : 'Ready'}
          </span>
          <div className="flex gap-2">
            <WinButton onClick={runScan} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Re-scan'}
            </WinButton>
            <WinButton onClick={onClose}>Close</WinButton>
          </div>
        </div>
      }
    >
      {error && (
        <div className="mb-3 text-[12px] text-red-600 border border-red-200 bg-red-50 rounded px-3 py-2">{error}</div>
      )}

      {!report && !error && (
        <div className="py-8 text-center text-[12px] text-neutral-500">Scanning completed downloads…</div>
      )}

      {report && (
        <div className="space-y-3">
          {/* Summary chips */}
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
            <span className="px-2 py-1 rounded border bg-green-100 text-green-700 border-green-300">
              {report.verified} verified
            </span>
            <span className="px-2 py-1 rounded border bg-red-100 text-red-700 border-red-300">
              {report.mismatch} mismatch
            </span>
            <span className="px-2 py-1 rounded border bg-neutral-100 text-neutral-600 border-neutral-300">
              {report.unverified} unverified
            </span>
            {(report.missing > 0 || report.unreadable > 0) && (
              <span className="px-2 py-1 rounded border bg-orange-100 text-orange-700 border-orange-300">
                {report.missing} missing · {report.unreadable} unreadable
              </span>
            )}
          </div>

          <div className="text-[11px] text-neutral-500">
            Test-server files are verified byte-exactly (SHA-256).
            Other files are remembered as a baseline and flagged if they change.
          </div>

          {/* Per-file results */}
          <div className="border border-neutral-200 rounded divide-y divide-neutral-100 max-h-[320px] overflow-y-auto">
            {report.results.length === 0 && (
              <div className="px-3 py-6 text-center text-[12px] text-neutral-500">No completed downloads to check.</div>
            )}
            {report.results.map((r) => {
              const st = STATUS_STYLES[r.status] ?? STATUS_STYLES.unverified;
              return (
                <div key={r.id} className="px-3 py-2 flex items-start gap-2">
                  <span className={`shrink-0 mt-[1px] px-1.5 py-[1px] rounded border text-[10px] font-semibold ${st.cls}`}>
                    {st.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium truncate" title={r.path}>
                      {r.filename} <span className="text-neutral-400 font-normal">· {fmtSize(r.size)}</span>
                    </div>
                    {(r.status === 'mismatch' || r.status === 'missing' || r.status === 'unreadable') && r.error && (
                      <div className="text-[11px] text-red-600 mt-0.5">{r.error}</div>
                    )}
                    {r.status === 'mismatch' && r.expectedSha256 && r.actualSha256 && (
                      <div className="text-[10px] font-mono text-neutral-500 mt-0.5 break-all">
                        expected {r.expectedSha256.slice(0, 16)}… · got {r.actualSha256.slice(0, 16)}…
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </WindowsDialog>
  );
};
