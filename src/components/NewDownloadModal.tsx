import React, { useState, useEffect } from 'react';
import { X, Zap, DownloadCloud, Sliders, Folder, Link as LinkIcon } from 'lucide-react';
import { NewDownloadPayload } from '../types/download';

interface NewDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: NewDownloadPayload) => void;
  defaultFolder: string;
}

export const NewDownloadModal: React.FC<NewDownloadModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  defaultFolder,
}) => {
  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [connections, setConnections] = useState(32);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setError('');
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(text => {
          if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
            setUrl(text.trim());
            try {
              const parsed = new URL(text);
              const pathPart = parsed.pathname.split('/').pop();
              if (pathPart && pathPart.includes('.')) {
                setFilename(decodeURIComponent(pathPart));
              }
            } catch (e) {}
          }
        }).catch(() => {});
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleUrlChange = (val: string) => {
    setUrl(val);
    try {
      const parsed = new URL(val);
      const pathPart = parsed.pathname.split('/').pop();
      if (pathPart && pathPart.includes('.')) {
        setFilename(decodeURIComponent(pathPart));
      }
    } catch (e) {}
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('Please provide a valid download URL');
      return;
    }

    try {
      new URL(url.trim());
    } catch (e) {
      setError('Invalid URL format. Please start with http:// or https://');
      return;
    }

    onSubmit({
      url: url.trim(),
      filename: filename.trim() || undefined,
      connections,
    });
    setUrl('');
    setFilename('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-[#121215] border border-[#2e2e34] rounded-2xl p-6 shadow-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#d8c8b4] flex items-center justify-center shadow-md">
              <Zap className="w-5 h-5 text-black fill-black" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Add New Download</h2>
              <p className="text-xs text-[#d8c8b4] font-mono">64-Thread Turbo Stream Acceleration</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-[#1f1f25] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500/30 text-xs font-mono text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleFormSubmit} className="space-y-4">
          {/* Download URL Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <LinkIcon className="w-3.5 h-3.5 text-[#d8c8b4]" />
              Download URL
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="https://example.com/large_file.zip"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-[#0a0a0d] border border-[#27272a] focus:border-[#d8c8b4] text-sm font-mono text-white placeholder-zinc-600 outline-none transition-colors"
            />
          </div>

          {/* Custom File Name (Optional) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300">
              Save File As (Optional)
            </label>
            <input
              type="text"
              placeholder="Custom filename.ext"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-[#0a0a0d] border border-[#27272a] focus:border-[#d8c8b4] text-sm font-mono text-white placeholder-zinc-600 outline-none transition-colors"
            />
          </div>

          {/* Connection Slider */}
          <div className="p-4 rounded-xl bg-[#0a0a0d] border border-[#27272a] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#d8c8b4]" />
                <span className="text-xs font-bold text-white">Parallel Streams</span>
              </div>
              <span className="text-xs font-mono font-black px-2.5 py-0.5 rounded-full bg-[#24211c] border border-[#d8c8b4]/40 text-[#d8c8b4]">
                {connections} Streams
              </span>
            </div>

            <input
              type="range"
              min="1"
              max="64"
              step="1"
              value={connections}
              onChange={(e) => setConnections(parseInt(e.target.value, 10))}
              className="w-full accent-[#d8c8b4] cursor-pointer"
            />

            <div className="flex justify-between text-[10px] font-mono text-zinc-500">
              <span>1x Standard</span>
              <span>16x Fast</span>
              <span>32x Turbo</span>
              <span className="text-[#d8c8b4] font-bold">64x Max Saturation</span>
            </div>
          </div>

          {/* Save Location Preview */}
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 px-1 truncate">
            <Folder className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
            <span className="truncate">Folder: {defaultFolder}</span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-[#1a1a20] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold text-black bg-[#d8c8b4] hover:bg-[#e8ded0] transition-all shadow-md active:scale-95"
            >
              <Zap className="w-4 h-4 fill-black" />
              Start Turbo Download
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
