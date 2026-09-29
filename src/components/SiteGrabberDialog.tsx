import React, { useState, useMemo } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { MessageBoxDialog, MessageBoxOptions } from './MessageBoxDialog';
import { WinCheckbox, WinInput, WinSelect, WinButton, WinGroupBox } from './common/WinControls';
import { DEFAULT_DOWNLOAD_DIR, APP_NAME, APP_SHORT_NAME } from '../config/appInfo';
import { getApiBaseUrl } from '../config/apiConfig';

interface SiteGrabberDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitBatch: (urls: string[], folder: string) => Promise<void>;
  defaultFolder?: string;
  isStandalone?: boolean;
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
  isStandalone = false,
}) => {
  const [startUrl, setStartUrl] = useState('');
  const [maxDepth, setMaxDepth] = useState(1);
  const [domainScope, setDomainScope] = useState<'same_host' | 'subdomains' | 'any'>('same_host');
  const [category, setCategory] = useState<string>('all');
  const [customExts, setCustomExts] = useState('');
  const [isExploring, setIsExploring] = useState(false);
  const [results, setResults] = useState<GrabbedItem[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [msgBox, setMsgBox] = useState<MessageBoxOptions | null>(null);

  // Cache per-item category (already filtered server-side at crawl time) so the
  // Category select can also re-filter already-found results retroactively.
  const [crawledCategory, setCrawledCategory] = useState<Record<string, string>>({});

  const visibleResults = useMemo(() => {
    if (category === 'all') return results;
    return results.filter(r => (crawledCategory[r.url] || r.category) === category);
  }, [results, category, crawledCategory]);

  const handleExplore = async () => {
    if (!startUrl.trim() || !startUrl.startsWith('http')) {
      setMsgBox({
        title: APP_NAME,
        type: 'warning',
        message: 'Please enter a valid website URL (starting with http:// or https://).',
      });
      return;
    }

    setIsExploring(true);
    setResults([]);
    setSelectedUrls(new Set());

    try {
      const res = await fetch(`${getApiBaseUrl()}/api/grabber/explore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrl: startUrl.trim(),
          maxDepth,
          domainScope,
          fileCategories: ['all'],
          customExtensions: customExts ? customExts.split(',').map(s => s.trim().replace(/^\./, '')).filter(Boolean) : undefined,
          maxAssets: 100,
        }),
      });

      if (!res.ok) throw new Error(`Server returned error ${res.status}`);

      const data = await res.json();
      // Crawl with 'all' so the full asset set is known, then let visibleResults
      // react to the category filter. This keeps the filter live for already-
      // crawled results without requiring a re-explore.
      const assets: GrabbedItem[] = data.assets || [];
      const catMap: Record<string, string> = {};
      for (const a of assets) catMap[a.url] = a.category;
      setCrawledCategory(catMap);
      setResults(assets);
      setSelectedUrls(new Set(assets.map(a => a.url)));

      if (assets.length === 0) {
        setMsgBox({
          title: APP_NAME,
          type: 'info',
          message: 'Exploration complete. No downloadable files were found on this page.',
        });
      } else if (category !== 'all' && assets.every(a => a.category !== category)) {
        setMsgBox({
          title: APP_NAME,
          type: 'info',
          message: `Exploration complete. Files were found, but none match the "${category}" filter.`,
        });
      }
    } catch (err: any) {
      setMsgBox({
        title: APP_NAME,
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
    if (selectedUrls.size === visibleResults.length && visibleResults.length > 0) {
      setSelectedUrls(new Set());
    } else {
      setSelectedUrls(new Set(visibleResults.map(r => r.url)));
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedUrls.size === 0) {
      setMsgBox({
        title: APP_NAME,
        type: 'warning',
        message: 'Please select at least one file from the list to download.',
      });
      return;
    }

    try {
      await onSubmitBatch(Array.from(selectedUrls), defaultFolder || DEFAULT_DOWNLOAD_DIR);
      onClose();
    } catch (err: any) {
      setMsgBox({
        title: APP_NAME,
        type: 'error',
        message: `Failed to queue downloads: ${err?.message || 'Error'}`,
      });
    }
  };

  const footer = (
    <div className="w-full flex items-center justify-between">
      <div className="text-[11px] text-neutral-500">
        {results.length > 0
          ? `${selectedUrls.size} of ${visibleResults.length} files selected${category !== 'all' ? ` (${results.length} found)` : ''}`
          : 'Enter URL and click Start Exploring to find downloadable media.'}
      </div>
      <div className="flex items-center gap-2">
        <WinButton
          variant="primary"
          onClick={handleDownloadSelected}
          disabled={selectedUrls.size === 0}
          className="min-w-[120px]"
        >
          Download Selected
        </WinButton>
        <WinButton variant="secondary" onClick={onClose} className="min-w-[70px]">
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
        title={`${APP_SHORT_NAME} Site Grabber`}
        width="w-[780px]"
        footer={footer}
        isStandalone={isStandalone}
        autoFitHeight={isStandalone}
      >
        <div className="space-y-3.5">
          {/* Step 1 */}
          <WinGroupBox title="1. Start Web Address & Scope" className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="w-20 text-neutral-600 font-medium">Start URL:</label>
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
                <label className="w-20 text-neutral-600">Depth:</label>
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
                <label className="w-24 text-neutral-600">Domain Scope:</label>
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
                <label className="w-20 text-neutral-600">Category:</label>
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
                <label className="w-24 text-neutral-600">Custom Exts:</label>
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
                className="font-medium text-brand px-4"
              >
                {isExploring ? 'Exploring...' : 'Start Exploring'}
              </WinButton>
            </div>
          </WinGroupBox>

          {/* Step 3 */}
          <WinGroupBox
            title={`3. Found Files (${selectedUrls.size} of ${visibleResults.length} selected)`}
            className="space-y-2"
          >
            <div className="h-36 border border-neutral-300 bg-neutral-50 overflow-y-auto font-sans text-[11.5px]">
              {visibleResults.length === 0 ? (
                <div className="h-full flex items-center justify-center text-neutral-400 italic">
                  {isExploring ? 'Scanning pages and extracting assets...' : 'No files discovered yet. Click "Start Exploring".'}
                </div>
              ) : (
                <table className="w-full border-collapse">
                  <thead className="bg-neutral-100 sticky top-0 border-b border-neutral-300 text-neutral-600 font-medium">
                    <tr>
                      <th className="py-1 px-2 w-8 text-center">
                        <WinCheckbox
                          checked={visibleResults.length > 0 && selectedUrls.size === visibleResults.length}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th className="py-1 px-2 text-left">File Name</th>
                      <th className="py-1 px-2 text-left w-20">Category</th>
                      <th className="py-1 px-2 text-left">Source URL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 bg-white">
                    {visibleResults.map((item, idx) => {
                      const isSel = selectedUrls.has(item.url);
                      return (
                        <tr
                          key={idx}
                          onClick={() => toggleSelect(item.url)}
                          className={`cursor-pointer hover:bg-brand-tint ${isSel ? 'bg-brand-tint text-neutral-900' : ''}`}
                        >
                          <td className="py-1 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <WinCheckbox
                              checked={isSel}
                              onChange={() => toggleSelect(item.url)}
                            />
                          </td>
                          <td className="py-1 px-2 font-medium truncate max-w-[200px]">{item.filename}</td>
                          <td className="py-1 px-2 capitalize text-neutral-500">{item.category}</td>
                          <td className="py-1 px-2 font-mono text-[10.5px] truncate max-w-[260px] text-neutral-600">{item.url}</td>
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
