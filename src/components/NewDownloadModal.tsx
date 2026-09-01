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
      // Check clipboard for auto-pasting download links
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6 glow-cyan">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
              <DownloadCloud className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Add New Download</h2>
              <p className="text-xs text-slate-400 font-mono">Multi-threaded Turbo Acceleration</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
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
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <LinkIcon className="w-3.5 h-3.5 text-cyan-400" />
              Download URL
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="https://example.com/large_file.zip"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-cyan-500 text-sm font-mono text-slate-100 placeholder-slate-600 outline-none transition-colors"
            />
          </div>

          {/* Custom File Name (Optional) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              Save File As (Optional)
            </label>
            <input
              type="text"
              placeholder="Custom filename.ext"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-cyan-500 text-sm font-mono text-slate-100 placeholder-slate-600 outline-none transition-colors"
            />
          </div>

          {/* Connection Slider (1 to 64 Threads) */}
          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-slate-200">Parallel Threads</span>
              </div>
              <span className="text-xs font-mono font-black px-2.5 py-0.5 rounded-full bg-cyan-950 border border-cyan-500/40 text-cyan-400">
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
              className="w-full accent-cyan-400 cursor-pointer"
            />

            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>1x Standard</span>
              <span>16x Fast</span>
              <span>32x Turbo</span>
              <span className="text-cyan-400 font-bold">64x Max Saturation</span>
            </div>
          </div>

          {/* Save Location Preview */}
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 px-1 truncate">
            <Folder className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            <span className="truncate">Folder: {defaultFolder}</span>
          </div>

          {/* Submit / Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 transition-all shadow-lg shadow-cyan-500/20 active:scale-95 glow-cyan"
            >
              <Zap className="w-4 h-4 fill-slate-950" />
              Start Turbo Download
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
