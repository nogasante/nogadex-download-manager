import React, { useState } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { MessageBoxDialog, MessageBoxOptions } from './MessageBoxDialog';
import { WinRadio, WinButton, WinGroupBox } from './common/WinControls';

interface HistoryExportImportDialogProps {
  isOpen: boolean;
  mode: 'export' | 'import';
  onClose: () => void;
  onRefreshDownloads?: () => void;
}

export const HistoryExportImportDialog: React.FC<HistoryExportImportDialogProps> = ({
  isOpen,
  mode,
  onClose,
  onRefreshDownloads,
}) => {
  const [format, setFormat] = useState<'csv' | 'json' | 'text'>('csv');
  const [importText, setImportText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [msgBox, setMsgBox] = useState<MessageBoxOptions | null>(null);

  const handleExport = async () => {
    setIsProcessing(true);
    try {
      const res = await fetch(`/api/history/export?format=${format}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nogadex_history_${new Date().toISOString().slice(0, 10)}.${format === 'text' ? 'txt' : format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      onClose();
    } catch (err: any) {
      setMsgBox({
        title: 'Nogadex Download Manager',
        type: 'error',
        message: `Failed to export history: ${err?.message || 'Error'}`,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) {
      setMsgBox({
        title: 'Nogadex Download Manager',
        type: 'warning',
        message: 'Please paste the export content or URL list to import.',
      });
      return;
    }

    setIsProcessing(true);
    try {
      const res = await fetch('/api/history/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: importText, format }),
      });

      if (!res.ok) throw new Error('Import failed');
      const data = await res.json();
      setMsgBox({
        title: 'Nogadex Download Manager',
        type: 'info',
        message: `Successfully imported ${data.importedCount || 0} downloads into the download manager.`,
      });
      if (onRefreshDownloads) onRefreshDownloads();
      setTimeout(onClose, 1200);
    } catch (err: any) {
      setMsgBox({
        title: 'Nogadex Download Manager',
        type: 'error',
        message: `Failed to import history: ${err?.message || 'Invalid format'}`,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const footer = (
    <>
      {mode === 'export' ? (
        <WinButton
          variant="primary"
          onClick={handleExport}
          disabled={isProcessing}
          className="min-w-[100px]"
        >
          {isProcessing ? 'Exporting...' : 'Export File'}
        </WinButton>
      ) : (
        <WinButton
          variant="primary"
          onClick={handleImport}
          disabled={isProcessing}
          className="min-w-[110px]"
        >
          {isProcessing ? 'Importing...' : 'Import Downloads'}
        </WinButton>
      )}
      <WinButton variant="secondary" onClick={onClose} className="min-w-[84px]">
        Cancel
      </WinButton>
    </>
  );

  return (
    <>
      <WindowsDialog
        isOpen={isOpen}
        onClose={onClose}
        title={mode === 'export' ? 'Export Download History' : 'Import Download History'}
        width="w-[500px]"
        footer={footer}
      >
        <div className="space-y-3.5">
          <WinGroupBox title="Format Specification" className="space-y-2">
            <div className="flex items-center gap-4 text-[12px]">
              <WinRadio
                checked={format === 'csv'}
                onChange={() => setFormat('csv')}
                label="CSV (.csv)"
              />
              <WinRadio
                checked={format === 'json'}
                onChange={() => setFormat('json')}
                label="JSON (.json)"
              />
              <WinRadio
                checked={format === 'text'}
                onChange={() => setFormat('text')}
                label="Plain Text URLs (.txt)"
              />
            </div>
          </WinGroupBox>

          {mode === 'import' && (
            <WinGroupBox title="Paste Import Data / URLs" className="space-y-2">
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Paste CSV, JSON, or list of URLs (one per line)..."
                className="w-full h-32 p-2 border border-[#94a3b8] rounded-[2px] font-mono text-[11px] focus:border-[#005a9e] outline-none"
              />
            </WinGroupBox>
          )}

          {mode === 'export' && (
            <p className="text-[#64748b] text-[11.5px] leading-relaxed">
              Export will generate a comprehensive record of all downloads, including URLs, file sizes, completed timestamps, and destination folders.
            </p>
          )}
        </div>
      </WindowsDialog>

      {msgBox && <MessageBoxDialog isOpen={Boolean(msgBox)} options={msgBox} onClose={() => setMsgBox(null)} />}
    </>
  );
};
