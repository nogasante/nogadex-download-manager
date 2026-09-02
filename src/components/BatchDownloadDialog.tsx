import React, { useState, useMemo } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { MessageBoxDialog, MessageBoxOptions } from './MessageBoxDialog';
import { WinCheckbox, WinInput, WinSelect, WinButton, WinTabs } from './common/WinControls';

interface BatchDownloadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitBatch: (urls: string[], savePath: string) => Promise<void>;
  defaultFolder?: string;
}

export const BatchDownloadDialog: React.FC<BatchDownloadDialogProps> = ({
  isOpen,
  onClose,
  onSubmitBatch,
  defaultFolder,
}) => {
  const [activeTab, setActiveTab] = useState<'pattern' | 'list'>('pattern');
  const userDownloads = 'C:\\Users\\nanas\\Downloads';
  const [savePath, setSavePath] = useState(defaultFolder || userDownloads);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msgBox, setMsgBox] = useState<MessageBoxOptions | null>(null);

  const [patternUrl, setPatternUrl] = useState('https://example.com/assets/file_*.zip');
  const [patternType, setPatternType] = useState<'numeric' | 'alpha'>('numeric');
  const [numFrom, setNumFrom] = useState(1);
  const [numTo, setNumTo] = useState(5);
  const [numStep, setNumStep] = useState(1);
  const [useLeadingZeros, setUseLeadingZeros] = useState(false);
  const [leadingZeros, setLeadingZeros] = useState(2);

  const [alphaFrom, setAlphaFrom] = useState('a');
  const [alphaTo, setAlphaTo] = useState('e');

  const [rawUrlList, setRawUrlList] = useState('');

  const generatedUrls = useMemo(() => {
    if (activeTab === 'list') {
      return rawUrlList
        .split('\n')
        .map((u) => u.trim())
        .filter((u) => u.length > 0 && /^https?:\/\//i.test(u));
    }

    if (!patternUrl.includes('*')) return [];
    const urls: string[] = [];

    if (patternType === 'numeric') {
      const start = Math.min(numFrom, numTo);
      const end = Math.max(numFrom, numTo);
      const step = Math.max(1, numStep);

      for (let i = start; i <= end; i += step) {
        let rep = i.toString();
        if (useLeadingZeros) {
          rep = rep.padStart(leadingZeros, '0');
        }
        urls.push(patternUrl.replace('*', rep));
      }
    } else {
      const startCode = alphaFrom.charCodeAt(0);
      const endCode = alphaTo.charCodeAt(0);
      const minCode = Math.min(startCode, endCode);
      const maxCode = Math.max(startCode, endCode);

      for (let i = minCode; i <= maxCode; i++) {
        const char = String.fromCharCode(i);
        urls.push(patternUrl.replace('*', char));
      }
    }
    return urls;
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (generatedUrls.length === 0) {
      setMsgBox({
        title: 'Nogadex Download Manager',
        type: 'warning',
        message: 'No valid URLs generated. Please check your pattern or direct URL list.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmitBatch(generatedUrls, savePath || userDownloads);
      onClose();
    } catch (err: any) {
      setMsgBox({
        title: 'Nogadex Download Manager',
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
        {isSubmitting ? 'Adding...' : `Add ${generatedUrls.length} Downloads`}
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
        width="w-[560px]"
        footer={footer}
      >
        <WinTabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as any)} />

        {activeTab === 'pattern' ? (
          <div className="space-y-3.5">
            <div className="space-y-1">
              <label className="text-[#475569] font-medium">Address Pattern with Wildcard (*):</label>
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
                <label className="text-[#475569]">Sequence Type:</label>
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
                  <label className="text-[#64748b] text-[11px]">From:</label>
                  <WinInput
                    type="number"
                    value={numFrom}
                    onChange={(e) => setNumFrom(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-[#64748b] text-[11px]">To:</label>
                  <WinInput
                    type="number"
                    value={numTo}
                    onChange={(e) => setNumTo(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-[#64748b] text-[11px]">Step:</label>
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
                  <label className="text-[#64748b] text-[11px]">From Letter:</label>
                  <WinInput
                    type="text"
                    maxLength={1}
                    value={alphaFrom}
                    onChange={(e) => setAlphaFrom(e.target.value)}
                    className="w-full text-center"
                  />
                </div>
                <div>
                  <label className="text-[#64748b] text-[11px]">To Letter:</label>
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
            <label className="text-[#475569] font-medium">Paste List of URLs (one per line):</label>
            <textarea
              value={rawUrlList}
              onChange={(e) => setRawUrlList(e.target.value)}
              placeholder="https://example.com/file1.zip&#10;https://example.com/file2.zip"
              className="w-full h-36 p-2 border border-[#94a3b8] rounded-[2px] font-mono text-[11px] focus:border-[#005a9e] outline-none"
            />
          </div>
        )}

        {/* Preview box */}
        <div className="border border-[#cbd5e1] p-2 rounded-[2px] bg-[#f8fafc] text-[11px] space-y-1">
          <div className="font-semibold text-[#475569]">
            Preview ({generatedUrls.length} files):
          </div>
          <div className="max-h-20 overflow-y-auto font-mono text-[#005a9e] space-y-0.5">
            {generatedUrls.slice(0, 5).map((u, idx) => (
              <div key={idx} className="truncate">
                {idx + 1}. {u}
              </div>
            ))}
            {generatedUrls.length > 5 && (
              <div className="text-[#64748b] italic">... ({generatedUrls.length - 5} more items)</div>
            )}
          </div>
        </div>

        {/* Save location */}
        <div className="space-y-1">
          <label className="text-[#475569] font-medium">Save Location:</label>
          <div className="flex gap-2">
            <WinInput
              type="text"
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
              className="flex-1 font-mono"
            />
            <WinButton variant="secondary" className="px-3">Browse...</WinButton>
          </div>
        </div>
      </WindowsDialog>

      {msgBox && <MessageBoxDialog isOpen={Boolean(msgBox)} options={msgBox} onClose={() => setMsgBox(null)} />}
    </>
  );
};
