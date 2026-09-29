import React, { useState, useMemo } from 'react';
import { BatchEngine } from '../../shared/batch_engine';
import { WindowsDialog } from './common/WindowsDialog';
import { MessageBoxDialog, MessageBoxOptions } from './MessageBoxDialog';
import { WinCheckbox, WinInput, WinSelect, WinButton, WinTabs } from './common/WinControls';
import { DEFAULT_DOWNLOAD_DIR, APP_NAME } from '../config/appInfo';
import { useCategoryFolder } from '../hooks/useCategoryFolder';

interface BatchDownloadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitBatch: (urls: string[], savePath: string) => Promise<void>;
  defaultFolder?: string;
  isStandalone?: boolean;
}

export const BatchDownloadDialog: React.FC<BatchDownloadDialogProps> = ({
  isOpen,
  onClose,
  onSubmitBatch,
  defaultFolder,
  isStandalone = false,
}) => {
  const [activeTab, setActiveTab] = useState<'pattern' | 'list'>('pattern');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msgBox, setMsgBox] = useState<MessageBoxOptions | null>(null);

  const [patternUrl, setPatternUrl] = useState('');
  const [patternType, setPatternType] = useState<'numeric' | 'alpha'>('numeric');
  const [numFrom, setNumFrom] = useState(1);
  const [numTo, setNumTo] = useState(10);
  const [numStep, setNumStep] = useState(1);
  const [useLeadingZeros, setUseLeadingZeros] = useState(false);
  const [leadingZeros, setLeadingZeros] = useState(2);

  const [alphaFrom, setAlphaFrom] = useState('a');
  const [alphaTo, setAlphaTo] = useState('e');

  const [rawUrlList, setRawUrlList] = useState('');

  // Expansion logic lives in the shared BatchEngine (single source of truth
  // with the server-side validation rules: protocol checks, batch caps, etc).
  const generatedUrls = useMemo(() => {
    if (activeTab === 'list') {
      return BatchEngine.parseMultiUrlList(rawUrlList).urls;
    }

    if (!patternUrl.includes('*')) return [];

    const result = BatchEngine.expandPattern(patternUrl, patternType === 'numeric'
      ? { type: 'numeric', from: numFrom, to: numTo, step: Math.max(1, numStep), leadingZeros: useLeadingZeros ? leadingZeros : 0 }
      : { type: 'alpha', from: alphaFrom, to: alphaTo }
    );
    return result.urls;
  }, [
    activeTab,
    rawUrlList,
    patternUrl,
    patternType,
    numFrom,
    numTo,
    numStep,
    useLeadingZeros,
    leadingZeros,
    alphaFrom,
    alphaTo,
  ]);

  const sampleUrl = generatedUrls[0] || (activeTab === 'pattern' ? patternUrl : '');
  const {
    folder: savePath,
    setFolder: setSavePath,
    handleBrowse,
    verifyFolderPermission,
    msgBox: folderMsgBox,
  } = useCategoryFolder({
    baseFolder: defaultFolder || '',
    url: sampleUrl,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (generatedUrls.length === 0) {
      setMsgBox({
        title: APP_NAME,
        type: 'warning',
        message: 'No valid URLs generated. Please check your pattern or direct URL list.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await verifyFolderPermission(savePath, async (confirmedFolder) => {
        await onSubmitBatch(generatedUrls, confirmedFolder || DEFAULT_DOWNLOAD_DIR);
        onClose();
      });
    } catch (err: any) {
      setMsgBox({
        title: APP_NAME,
        type: 'error',
        message: `Failed to add batch download: ${err?.message || 'Unknown error'}`,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const footer = (
    <>
      <WinButton
        variant="primary"
        onClick={handleSubmit}
        disabled={isSubmitting || generatedUrls.length === 0}
        className="min-w-[120px]"
      >
        {isSubmitting ? 'Adding...' : generatedUrls.length > 0 ? `Add ${generatedUrls.length} Downloads` : 'Add Downloads'}
      </WinButton>
      <WinButton variant="secondary" onClick={onClose} className="min-w-[84px]">
        Cancel
      </WinButton>
    </>
  );

  const tabs = [
    { id: 'pattern', label: 'Wildcard Pattern (*)' },
    { id: 'list', label: 'Direct URL List' },
  ];

  return (
    <>
      <WindowsDialog
        isOpen={isOpen}
        onClose={onClose}
        title="Add Batch Download"
        width="w-[660px]"
        footer={footer}
        isStandalone={isStandalone}
        autoFitHeight={isStandalone}
      >
        <WinTabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as any)} />

        {activeTab === 'pattern' ? (
          <div className="space-y-2.5">
            <div className="space-y-1">
              <label className="text-neutral-600 font-medium">Address Pattern with Wildcard (*):</label>
              <WinInput
                type="text"
                value={patternUrl}
                onChange={(e) => setPatternUrl(e.target.value)}
                placeholder="https://example.com/files/file_*.zip"
                className="w-full font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-neutral-600">Sequence Type:</label>
                <WinSelect
                  value={patternType}
                  onChange={(e) => setPatternType(e.target.value as any)}
                  className="w-full"
                >
                  <option value="numeric">Numbers (1, 2, 3...)</option>
                  <option value="alpha">Letters (a, b, c...)</option>
                </WinSelect>
              </div>

              {patternType === 'numeric' && (
                <div className="flex items-center gap-2 pt-5">
                  <WinCheckbox
                    checked={useLeadingZeros}
                    onChange={setUseLeadingZeros}
                    label="Leading zeros:"
                  />
                  <WinInput
                    type="number"
                    min="1"
                    max="6"
                    disabled={!useLeadingZeros}
                    value={leadingZeros}
                    onChange={(e) => setLeadingZeros(Number(e.target.value))}
                    className="w-12 h-[24px] text-center text-[11px]"
                  />
                </div>
              )}
            </div>

            {patternType === 'numeric' ? (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-neutral-500 text-[11px]">From:</label>
                  <WinInput
                    type="number"
                    value={numFrom}
                    onChange={(e) => setNumFrom(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-neutral-500 text-[11px]">To:</label>
                  <WinInput
                    type="number"
                    value={numTo}
                    onChange={(e) => setNumTo(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-neutral-500 text-[11px]">Step:</label>
                  <WinInput
                    type="number"
                    min="1"
                    value={numStep}
                    onChange={(e) => setNumStep(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-neutral-500 text-[11px]">From Letter:</label>
                  <WinInput
                    type="text"
                    maxLength={1}
                    value={alphaFrom}
                    onChange={(e) => setAlphaFrom(e.target.value)}
                    className="w-full text-center"
                  />
                </div>
                <div>
                  <label className="text-neutral-500 text-[11px]">To Letter:</label>
                  <WinInput
                    type="text"
                    maxLength={1}
                    value={alphaTo}
                    onChange={(e) => setAlphaTo(e.target.value)}
                    className="w-full text-center"
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-neutral-600 font-medium">Paste List of URLs (one per line):</label>
            <textarea
              value={rawUrlList}
              onChange={(e) => setRawUrlList(e.target.value)}
              placeholder="https://example.com/file1.zip&#10;https://example.com/file2.zip"
              className="w-full h-36 p-2 border border-neutral-400 rounded-[2px] font-mono text-[11px] focus:border-brand outline-none"
            />
          </div>
        )}

        {/* Preview box */}
        <div className="border border-neutral-300 p-2.5 rounded-[2px] bg-neutral-50 text-[11.5px] space-y-1">
          <div className="font-semibold text-neutral-600">
            {generatedUrls.length > 0 ? `Preview (${generatedUrls.length} files):` : 'Batch Preview:'}
          </div>
          {generatedUrls.length === 0 ? (
            <div className="text-neutral-400 italic text-[11px] py-1">
              {activeTab === 'pattern'
                ? "Enter an address pattern with '*' (e.g. https://site.com/file_*.zip) to preview download list"
                : 'Paste one or more valid URLs above to preview batch items'}
            </div>
          ) : (
            <div className="max-h-16 overflow-y-auto font-mono text-brand space-y-0.5">
              {generatedUrls.slice(0, 5).map((u, idx) => (
                <div key={idx} className="truncate">
                  {idx + 1}. {u}
                </div>
              ))}
              {generatedUrls.length > 5 && (
                <div className="text-neutral-500 italic">... ({generatedUrls.length - 5} more items)</div>
              )}
            </div>
          )}
        </div>

        {/* Save location */}
        <div className="space-y-1">
          <label className="text-neutral-600 font-medium">Save Location:</label>
          <div className="flex gap-2">
            <WinInput
              type="text"
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
              className="flex-1 font-mono"
            />
            <WinButton variant="secondary" onClick={handleBrowse} className="px-3">Browse...</WinButton>
          </div>
        </div>
      </WindowsDialog>

      {(folderMsgBox || msgBox) && (
        <MessageBoxDialog
          isOpen={Boolean(folderMsgBox || msgBox)}
          options={folderMsgBox || msgBox}
          onClose={() => setMsgBox(null)}
        />
      )}
    </>
  );
};
