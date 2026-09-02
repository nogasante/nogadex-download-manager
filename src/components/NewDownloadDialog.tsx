import React, { useState, useEffect } from 'react';
import { NewDownloadPayload } from '../types/download';
import { WindowsDialog } from './common/WindowsDialog';
import { MessageBoxDialog, MessageBoxOptions } from './MessageBoxDialog';
import { WinInput, WinSelect, WinButton } from './common/WinControls';

interface NewDownloadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: NewDownloadPayload) => Promise<void>;
  defaultFolder?: string;
  defaultConnections?: number;
}

export const NewDownloadDialog: React.FC<NewDownloadDialogProps> = ({
  isOpen,
  onClose,
  onSubmit,
  defaultFolder = 'C:\\Users\\nanas\\Downloads',
  defaultConnections = 32,
}) => {
  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [destinationFolder, setDestinationFolder] = useState(defaultFolder);
  const [connections, setConnections] = useState(defaultConnections);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msgBox, setMsgBox] = useState<MessageBoxOptions | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (navigator.clipboard?.readText) {
        navigator.clipboard.readText().then((text) => {
          if (text && /^https?:\/\//i.test(text.trim())) {
            setUrl(text.trim());
          }
        }).catch(() => {});
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (url) {
      try {
        const u = new URL(url);
        const name = u.pathname.split('/').pop() || '';
        if (name && !filename) {
          setFilename(decodeURIComponent(name));
        }
      } catch {}
    }
  }, [url]);

  const handleStartDownload = async (startImmediate: boolean) => {
    if (!url.trim() || !url.startsWith('http')) {
      setMsgBox({
        title: 'Nogadex Download Manager',
        type: 'warning',
        message: 'Please enter a valid HTTP or HTTPS URL to download.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        url: url.trim(),
        filename: filename.trim() || undefined,
        destinationFolder: destinationFolder.trim() || defaultFolder,
        connections,
        startImmediate,
      });
      setUrl('');
      setFilename('');
      onClose();
    } catch (err: any) {
      setMsgBox({
        title: 'Nogadex Download Manager',
        type: 'error',
        message: `Failed to initiate download: ${err?.message || 'Unknown error'}`,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const footer = (
    <>
      <WinButton
        variant="primary"
        onClick={() => handleStartDownload(true)}
        disabled={isSubmitting || !url.trim()}
        className="min-w-[100px]"
      >
        {isSubmitting ? 'Starting...' : 'Download Now'}
      </WinButton>
      <WinButton
        variant="secondary"
        onClick={() => handleStartDownload(false)}
        disabled={isSubmitting || !url.trim()}
        className="min-w-[100px]"
      >
        Download Later
      </WinButton>
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
        title="Add New Download"
        width="w-[520px]"
        footer={footer}
      >
        <div className="space-y-3.5">
          <div className="space-y-1">
            <label className="text-[#475569] font-medium">Address (URL):</label>
            <WinInput
              type="text"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/file.zip"
              className="w-full font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[#475569] font-medium">File Name (optional):</label>
            <WinInput
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="Auto-detected from URL or server header"
              className="w-full"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[#475569] font-medium">Save Location:</label>
            <div className="flex gap-2">
              <WinInput
                type="text"
                value={destinationFolder}
                onChange={(e) => setDestinationFolder(e.target.value)}
                className="flex-1 font-mono"
              />
              <WinButton variant="secondary" className="px-3">Browse...</WinButton>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[#475569] font-medium">Parallel Streams / Connections:</label>
            <WinSelect
              value={connections}
              onChange={(e) => setConnections(Number(e.target.value))}
              className="w-full"
            >
              <option value={4}>4 Streams</option>
              <option value={8}>8 Streams</option>
              <option value={16}>16 Streams</option>
              <option value={32}>32 Streams (High Speed Multi-Thread)</option>
            </WinSelect>
          </div>
        </div>
      </WindowsDialog>

      {msgBox && <MessageBoxDialog isOpen={Boolean(msgBox)} options={msgBox} onClose={() => setMsgBox(null)} />}
    </>
  );
};
