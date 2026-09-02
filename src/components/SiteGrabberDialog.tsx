import React, { useState } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { MessageBoxDialog, MessageBoxOptions } from './MessageBoxDialog';
import { WinCheckbox, WinInput, WinSelect, WinButton, WinGroupBox } from './common/WinControls';

interface SiteGrabberDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitBatch: (urls: string[], folder: string) => Promise<void>;
  defaultFolder?: string;
}

interface GrabbedItem {
  url: string;
  filename: string;
  category: string;
  foundOnPage: string;
  depth: number;
}

export const SiteGrabberDialog: React.FC<SiteGrabberDialogProps> = ({
  isOpen,
  onClose,
  onSubmitBatch,
  defaultFolder,
}) => {
  const [startUrl, setStartUrl] = useState('https://');
  const [maxDepth, setMaxDepth] = useState(1);
  const [domainScope, setDomainScope] = useState<'same_host' | 'subdomains' | 'any'>('same_host');
  const [category, setCategory] = useState<string>('all');
  const [customExts, setCustomExts] = useState('');
  const [isExploring, setIsExploring] = useState(false);
  const [results, setResults] = useState<GrabbedItem[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [msgBox, setMsgBox] = useState<MessageBoxOptions | null>(null);

  const handleExplore = async () => {
    if (!startUrl.trim() || !startUrl.startsWith('http')) {
      setMsgBox({
        title: 'Nogadex Download Manager',
        type: 'warning',
        message: 'Please enter a valid website URL (starting with http:// or https://).',
      });
      return;
    }

    setIsExploring(true);
    setResults([]);
    setSelectedUrls(new Set());

    try {
      const res = await fetch('/api/grabber/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrl: startUrl.trim(),
          maxDepth,
          domainScope,
          fileCategories: category === 'all' ? ['all'] : [category],
          customExtensions: customExts ? customExts.split(',').map(s => s.trim().replace(/^\./, '')).filter(Boolean) : undefined,
          maxAssets: 100,
        }),
      });

      if (!res.ok) throw new Error(`Server returned error ${res.status}`);

      const data = await res.json();
      const assets: GrabbedItem[] = data.assets || [];
      setResults(assets);
      setSelectedUrls(new Set(assets.map(a => a.url)));

      if (assets.length === 0) {
        setMsgBox({
          title: 'Nogadex Download Manager',
          type: 'info',
          message: 'Exploration complete. No files matching the specified filter were found on this page.',
        });
      }
    } catch (err: any) {
      setMsgBox({
        title: 'Nogadex Download Manager',
        type: 'error',
        message: `Failed to explore website: ${err?.message || 'Network error'}`,
      });
    } finally {
      setIsExploring(false);
    }
  };

  const toggleSelect = (url: string) => {
    const next = new Set(selectedUrls);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    setSelectedUrls(next);
  };

  const toggleSelectAll = () => {
    if (selectedUrls.size === results.length) {
      setSelectedUrls(new Set());
    } else {
      setSelectedUrls(new Set(results.map(r => r.url)));
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedUrls.size === 0) {
      setMsgBox({
        title: 'Nogadex Download Manager',
        type: 'warning',
        message: 'Please select at least one file from the list to download.',
      });
      return;
    }

    try {
      await onSubmitBatch(Array.from(selectedUrls), defaultFolder || 'C:\\Users\\nanas\\Downloads');
      onClose();
    } catch (err: any) {
      setMsgBox({
        title: 'Nogadex Download Manager',
        type: 'error',
        message: `Failed to queue downloads: ${err?.message || 'Error'}`,
      });
    }
  };

  const footer = (
    <div className="w-full flex items-center justify-between">
      <div className="text-[11px] text-[#64748b]">
        {results.length > 0 && `${selectedUrls.size} files queued for download`}
      </div>
      <div className="flex items-center gap-2">
        <WinButton
          variant="primary"
          onClick={handleDownloadSelected}
          disabled={selectedUrls.size === 0 || isExploring}
          className="min-w-[120px]"
        >
          Download Selected ({selectedUrls.size})
        </WinButton>
        <WinButton variant="secondary" onClick={onClose} className="min-w-[84px]">
          Close
        </WinButton>
      </div>
    </div>
  );

  return (
    <>
      <WindowsDialog
        isOpen={isOpen}
        onClose={onClose}
        title="Nogadex Site Grabber"
        width="w-[660px]"
        footer={footer}
      >
        <div className="space-y-3.5">
          {/* Step 1 */}
          <WinGroupBox title="1. Start Web Address & Scope" className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="w-20 text-[#475569] font-medium">Start URL:</label>
              <WinInput
                type="text"
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                placeholder="https://example.com/gallery"
                className="flex-1 font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="flex items-center gap-2">
                <label className="w-20 text-[#475569]">Depth:</label>
                <WinSelect
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(Number(e.target.value))}
                  className="flex-1"
                >
                  <option value={1}>1 - Start page only</option>
                  <option value={2}>2 - Follow links 1 level deep</option>
                  <option value={3}>3 - Follow links 2 levels deep</option>
                </WinSelect>
              </div>

              <div className="flex items-center gap-2">
                <label className="w-24 text-[#475569]">Domain Scope:</label>
                <WinSelect
                  value={domainScope}
                  onChange={(e) => setDomainScope(e.target.value as any)}
                  className="flex-1"
                >
                  <option value="same_host">Same Host only</option>
                  <option value="subdomains">Include Subdomains</option>
                  <option value="any">Any Domain</option>
                </WinSelect>
              </div>
            </div>
          </WinGroupBox>

          {/* Step 2 */}
          <WinGroupBox title="2. File Filters to Grab" className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <label className="w-20 text-[#475569]">Category:</label>
                <WinSelect
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="flex-1"
                >
                  <option value="all">All File Types</option>
                  <option value="pictures">Pictures (jpg, png, webp, gif...)</option>
                  <option value="video">Video (mp4, mkv, avi, webm...)</option>
                  <option value="audio">Audio (mp3, wav, flac, aac...)</option>
                  <option value="documents">Documents (pdf, docx, xlsx...)</option>
                  <option value="archives">Archives (zip, rar, 7z, tar.gz...)</option>
                </WinSelect>
              </div>

              <div className="flex items-center gap-2">
                <label className="w-24 text-[#475569]">Custom Exts:</label>
                <WinInput
                  type="text"
                  value={customExts}
                  onChange={(e) => setCustomExts(e.target.value)}
                  placeholder="e.g. pdf, epub, zip"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <WinButton
                variant="secondary"
                onClick={handleExplore}
                disabled={isExploring}
                className="font-medium text-[#005a9e] px-4"
              >
                {isExploring ? 'Exploring...' : 'Start Exploring'}
              </WinButton>
            </div>
          </WinGroupBox>

          {/* Step 3 */}
          <WinGroupBox
            title={`3. Found Files (${selectedUrls.size} of ${results.length} selected)`}
            className="space-y-2"
          >
            <div className="h-44 border border-[#cbd5e1] bg-[#fafafa] overflow-y-auto font-sans text-[11.5px]">
              {results.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[#94a3b8] italic">
                  {isExploring ? 'Scanning pages and extracting assets...' : 'No files discovered yet. Click "Start Exploring".'}
                </div>
              ) : (
                <table className="w-full border-collapse">
                  <thead className="bg-[#f1f5f9] sticky top-0 border-b border-[#cbd5e1] text-[#475569] font-medium">
                    <tr>
                      <th className="py-1 px-2 w-8 text-center">
                        <WinCheckbox
                          checked={results.length > 0 && selectedUrls.size === results.length}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th className="py-1 px-2 text-left">File Name</th>
                      <th className="py-1 px-2 text-left w-20">Category</th>
                      <th className="py-1 px-2 text-left">Source URL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e2e8f0] bg-white">
                    {results.map((item, idx) => {
                      const isSel = selectedUrls.has(item.url);
                      return (
                        <tr
                          key={idx}
                          onClick={() => toggleSelect(item.url)}
                          className={`cursor-pointer hover:bg-[#eef6ff] ${isSel ? 'bg-[#cde8ff] text-[#0f172a]' : ''}`}
                        >
                          <td className="py-1 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <WinCheckbox
                              checked={isSel}
                              onChange={() => toggleSelect(item.url)}
                            />
                          </td>
                          <td className="py-1 px-2 font-medium truncate max-w-[200px]">{item.filename}</td>
                          <td className="py-1 px-2 capitalize text-[#64748b]">{item.category}</td>
                          <td className="py-1 px-2 font-mono text-[10.5px] truncate max-w-[260px] text-[#475569]">{item.url}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </WinGroupBox>
        </div>
      </WindowsDialog>

      {msgBox && <MessageBoxDialog isOpen={Boolean(msgBox)} options={msgBox} onClose={() => setMsgBox(null)} />}
    </>
  );
};
