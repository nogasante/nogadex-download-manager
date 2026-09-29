import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { NewDownloadPayload } from '../types/download';
import { WindowsDialog } from './common/WindowsDialog';
import { MessageBoxDialog, MessageBoxOptions } from './MessageBoxDialog';
import { WinInput, WinButton, WinSelect, WinCheckbox, WinGroupBox } from './common/WinControls';
import { formatSize } from '../utils/formatters';
import { extractFilenameFromUrl, buildCategoryFolderPath } from '../utils/fileUtils';
import { useCategoryFolder } from '../hooks/useCategoryFolder';
import { APP_NAME } from '../config/appInfo';
import { api } from '../api/client';
import { extractUrlsFromClipboard } from '../utils/clipboard';
import { AdvancedSettingsDialog } from './AdvancedSettingsDialog';
import { FileIcon } from './FileIcon';

interface NewDownloadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: NewDownloadPayload) => Promise<void>;
  defaultFolder?: string;
  defaultConnections?: number;
  isStandalone?: boolean;
  initialUrl?: string;
}

export const NewDownloadDialog: React.FC<NewDownloadDialogProps> = ({
  isOpen,
  onClose,
  onSubmit,
  defaultFolder = '',
  defaultConnections = 32,
  isStandalone = false,
  initialUrl,
}) => {
  const { t } = useTranslation();
  const [url, setUrl] = useState(initialUrl || '');
  const [filename, setFilename] = useState('');
  // Inline per-site authorization (saved to the engine's site
  // credential store when the dialog submits, then reused for this domain).
  const [useAuth, setUseAuth] = useState<boolean>(false);
  const [authLogin, setAuthLogin] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [connections, setConnections] = useState<number>(defaultConnections || 0);
  // Auto mode: defaultConnections of 0 means "app decides". Users can still
  // flip to Manual and pick an explicit count for a specific download.
  const [isAutoStreams, setIsAutoStreams] = useState<boolean>(defaultConnections === 0);

  useEffect(() => {
    if (isOpen) {
      setConnections(defaultConnections === 0 ? 8 : defaultConnections);
      setIsAutoStreams(defaultConnections === 0);
    }
  }, [isOpen, defaultConnections]);
  const [localMsgBox, setLocalMsgBox] = useState<MessageBoxOptions | null>(null);
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const [probedInfo, setProbedInfo] = useState<{ size?: number; resumable?: boolean } | null>(null);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);
  const [saveCategoryMode, setSaveCategoryMode] = useState<string>('auto');
  // Options: custom per-download User-Agent + duplicate policy.
  const [customUserAgent, setCustomUserAgent] = useState('');
  const [duplicatePolicy, setDuplicatePolicy] = useState<'ask' | 'overwrite' | 'skip' | 'rename'>('ask');
  const userEditedFilenameRef = useRef<boolean>(false);

  const {
    folder: destinationFolder,
    setFolder: setDestinationFolder,
    detectedCategory,
    handleBrowse,
    verifyFolderPermission,
    msgBox: folderMsgBox,
  } = useCategoryFolder({
    baseFolder: defaultFolder,
    url,
    filename,
  });
  const activeMsgBox = localMsgBox || folderMsgBox;

  // Auto-fill from clipboard on open if empty
  useEffect(() => {
    if (isOpen) {
      if (initialUrl) {
        setUrl(initialUrl);
      } else if (navigator.clipboard?.readText) {
        navigator.clipboard.readText().then((text) => {
          const urls = extractUrlsFromClipboard(text);
          if (urls.length > 0) {
            setUrl(urls[0]);
          }
        }).catch(() => {});
      }
    }
  }, [isOpen, initialUrl]);

  // Live Server Probing for Authoritative Filename and Size
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
      setProbedInfo(null);
      return;
    }

    // Immediate URL-based filename heuristic
    if (!userEditedFilenameRef.current) {
      // Check query parameter filename (e.g. &filename=FIFA19.zip)
      try {
        const parsed = new URL(trimmed);
        const qpName = parsed.searchParams.get('filename') || parsed.searchParams.get('file') || parsed.searchParams.get('name');
        if (qpName && qpName.includes('.')) {
          setFilename(decodeURIComponent(qpName));
        } else {
          const uName = extractFilenameFromUrl(trimmed);
          if (uName) setFilename(uName);
        }
      } catch {
        const uName = extractFilenameFromUrl(trimmed);
        if (uName) setFilename(uName);
      }
    }

    // Debounced Live Server Probe to get Content-Disposition header
    setIsProbing(true);
    const probeTimer = setTimeout(async () => {
      try {
        const probeRes = await api.probe(trimmed);
        if (probeRes) {
          if (probeRes.filename && !userEditedFilenameRef.current) {
            setFilename(probeRes.filename);
          }
          setProbedInfo({
            size: probeRes.contentLength > 0 ? probeRes.contentLength : undefined,
            resumable: probeRes.acceptRanges,
          });
        }
      } catch {
        // Fallback gracefully to URL heuristics
      } finally {
        setIsProbing(false);
      }
    }, 350);

    return () => clearTimeout(probeTimer);
  }, [url]);

  const handleStartDownload = async (startImmediate: boolean) => {
    let cleanUrl = url.trim();
    if (!cleanUrl) {
      setLocalMsgBox({
        title: APP_NAME,
        type: 'warning',
        message: 'Please enter a valid URL to download.',
      });
      return;
    }

    if (!/^https?:\/\//i.test(cleanUrl) && !/^ftp:\/\//i.test(cleanUrl)) {
      cleanUrl = `https://${cleanUrl}`;
    }

    // Reject URLs that still do not parse as http(s)/ftp after normalization
    // (e.g. 'not a valid url' with spaces) instead of silently submitting them.
    try {
      const parsed = new URL(cleanUrl);
      if (!/^https?:$/.test(parsed.protocol) && parsed.protocol !== 'ftp:') {
        throw new Error('bad protocol');
      }
      const host = parsed.hostname;
      if (!host || (!host.includes('.') && host !== 'localhost' && !host.startsWith('['))) {
        throw new Error('bad hostname');
      }
    } catch {
      setLocalMsgBox({
        title: APP_NAME,
        type: 'warning',
        message: `"${url.trim()}" is not a valid URL. Please enter a full URL such as https://example.com/file.zip`,
      });
      return;
    }

    try {
      await verifyFolderPermission(destinationFolder || defaultFolder, async (confirmedFolder) => {
        // Remember per-site authorization before the download
        // starts. The engine resolves these credentials by domain and injects
        // the Basic auth header automatically (and on every future download
        // from the same host). Best-effort: a failure must not block the
        // download itself.
        if (useAuth && authLogin.trim()) {
          try {
            const host = new URL(cleanUrl).hostname;
            await api.credentials.add({
              domain: host,
              authType: 'basic',
              username: authLogin.trim(),
              password: authPassword,
            });
          } catch { /* credential save is best-effort */ }
        }
        onClose();
        const pendingPayload = {
          url: cleanUrl,
          filename: filename.trim() || undefined,
          destinationFolder: confirmedFolder,
          // Auto mode: connections=0 is the engine's "app decides" sentinel.
          connections: isAutoStreams ? 0 : connections,
          autoStreams: isAutoStreams,
          startImmediate,
          userAgent: customUserAgent.trim() || undefined,
          duplicatePolicy: duplicatePolicy !== 'ask' ? duplicatePolicy : undefined,
        };
        setUrl('');
        setFilename('');
        setCustomUserAgent('');
        setDuplicatePolicy('ask');
        setUseAuth(false);
        setAuthLogin('');
        setAuthPassword('');
        userEditedFilenameRef.current = false;
        await onSubmit(pendingPayload);
      });
    } catch (err: any) {
      setLocalMsgBox({
        title: APP_NAME,
        type: 'error',
        message: `Failed to initiate download: ${err?.message || 'Unknown error'}`,
      });
    }
  };

  const handleOpenAdvanced = () => {
    if ((window as any).electronAPI?.openWindow) {
      (window as any).electronAPI.openWindow('advanced-settings');
    } else {
      setIsAdvancedOpen(true);
    }
  };

  const footer = (
    <div className="w-full flex items-center justify-between">
      <WinButton
        variant="secondary"
        onClick={handleOpenAdvanced}
        className="min-w-[80px]"
      >
        {t('newDownload.more')}
      </WinButton>

      <div className="flex items-center gap-2">
        <WinButton
          variant="secondary"
          onClick={() => handleStartDownload(false)}
          disabled={!url.trim()}
          className="min-w-[105px]"
        >
          {t('newDownload.downloadLater')}
        </WinButton>
        <WinButton
          variant="primary"
          onClick={() => handleStartDownload(true)}
          disabled={!url.trim()}
          className="min-w-[105px]"
        >
          {t('newDownload.downloadNow')}
        </WinButton>
      </div>
    </div>
  );

  return (
    <>
      <WindowsDialog
        isOpen={isOpen}
        onClose={onClose}
        title={t('newDownload.title')}
        width="w-[520px]"
        footer={footer}
        isStandalone={isStandalone}
        autoFitHeight={isStandalone}
      >
        <div className="space-y-3.5 font-sans text-[12px] p-0.5">
          {/* Address Row */}
          <div className="grid grid-cols-[65px_1fr] items-center gap-2">
            <label className="text-neutral-400 text-[12px] font-normal">{t('newDownload.address')}</label>
            <WinInput
              type="text"
              autoFocus
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                userEditedFilenameRef.current = false;
              }}
              placeholder="https://..."
              className="w-full font-mono text-[11.5px] h-[28px]"
            />
          </div>

          {/* File Row */}
          <div className="grid grid-cols-[65px_1fr] items-center gap-2">
            <label className="text-neutral-400 text-[12px] font-normal">{t('newDownload.file')}</label>
            <div className="flex items-center gap-1.5 w-full">
              <WinInput
                type="text"
                value={filename}
                onChange={(e) => {
                  setFilename(e.target.value);
                  userEditedFilenameRef.current = true;
                }}
                placeholder={isProbing ? t('newDownload.querying') : t('newDownload.filenamePlaceholder')}
                className="flex-1 text-[12px] h-[28px]"
              />
              <div 
                className="w-7 h-7 flex items-center justify-center bg-neutral-800 border border-neutral-700 rounded-[3px] text-neutral-400 shrink-0"
                title={filename ? t('newDownload.targetFile', { name: filename }) : t('newDownload.fileTarget')}
              >
                <FileIcon filename={filename || 'file.bin'} className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* Streams Row */}
          <div className="grid grid-cols-[65px_1fr] items-center gap-2">
            <label className="text-neutral-400 text-[12px] font-normal" title={t('newDownload.streamsHint')}>{t('newDownload.streams')}</label>
            <div className="flex items-center gap-2 w-full">
              {isAutoStreams ? (
                <>
                  <div className="flex-1 text-[11.5px] text-neutral-500 italic px-2 h-[28px] flex items-center bg-neutral-50 border border-neutral-200 rounded-[2px]">
                    Auto — app picks optimal count {probedInfo?.size ? (probedInfo.size <= 1024 * 1024 ? '(small file: 1 stream)' : probedInfo.size <= 8 * 1024 * 1024 ? '(2 streams)' : '(4+ streams)') : ''}
                  </div>
                  <WinButton variant="secondary" onClick={() => setIsAutoStreams(false)} className="min-w-[64px] text-[11px]">
                    Manual
                  </WinButton>
                </>
              ) : (
                <>
                  <input
                    type="range"
                    min={1}
                    max={32}
                    step={1}
                    value={connections}
                    onChange={(e) => setConnections(Number(e.target.value))}
                    className="flex-1 accent-[var(--brand)] h-1"
                  />
                  <WinInput
                    type="number"
                    min={1}
                    max={64}
                    value={connections}
                    onChange={(e) => {
                      const n = Math.max(1, Math.min(64, Number(e.target.value) || 1));
                      setConnections(n);
                    }}
                    className="w-14 text-[12px] h-[28px] text-center"
                  />
                  <WinButton variant="secondary" onClick={() => setIsAutoStreams(true)} className="min-w-[56px] text-[11px]">
                    Auto
                  </WinButton>
                </>
              )}
            </div>
          </div>

          {/* Duplicate link policy: what to do if this URL/file
              already exists. 'ask' = engine default (safe single-row policy). */}
          <div className="grid grid-cols-[65px_1fr] items-center gap-2">
            <label className="text-neutral-400 text-[12px] font-normal">{t('newDownload.ifExists')}</label>
            <WinSelect
              value={duplicatePolicy}
              onChange={(e) => setDuplicatePolicy(e.target.value as 'ask' | 'overwrite' | 'skip' | 'rename')}
              className="w-full text-[12px] h-[28px]"
            >
              <option value="ask">Ask the engine's safe default (one row per URL)</option>
              <option value="overwrite">Overwrite the existing file</option>
              <option value="rename">Save under a new name</option>
              <option value="skip">Skip this download</option>
            </WinSelect>
          </div>

          {/* Custom User-Agent: empty = engine default UA. */}
          <div className="grid grid-cols-[65px_1fr] items-center gap-2">
            <label className="text-neutral-400 text-[12px] font-normal">{t('newDownload.userAgent')}</label>
            <WinInput
              type="text"
              value={customUserAgent}
              onChange={(e) => setCustomUserAgent(e.target.value)}
              placeholder={t('newDownload.uaPlaceholder')}
              className="w-full font-mono text-[11px] h-[28px]"
            />
          </div>

          {/* Use authorization: per-domain Basic auth, stored in
              the engine's site credential store and auto-injected on every
              future download from the same host. */}
          <WinGroupBox
            title={
              <WinCheckbox
                checked={useAuth}
                onChange={(v) => {
                  setUseAuth(v);
                  if (!v) { setAuthLogin(''); setAuthPassword(''); }
                }}
                label={t('newDownload.useAuth')}
                className="text-[12px]"
              />}
            className={useAuth ? '' : 'opacity-70'}
          >
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <div className="grid grid-cols-[42px_1fr] items-center gap-1.5">
                <label className="text-neutral-500 text-[11.5px] text-right">{t('newDownload.login')}</label>
                <WinInput
                  type="text"
                  value={authLogin}
                  onChange={(e) => setAuthLogin(e.target.value)}
                  disabled={!useAuth}
                  autoComplete="off"
                  className="w-full text-[12px] h-[26px]"
                />
              </div>
              <div className="grid grid-cols-[58px_1fr] items-center gap-1.5">
                <label className="text-neutral-500 text-[11.5px] text-right">{t('newDownload.password')}</label>
                <WinInput
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  disabled={!useAuth}
                  autoComplete="new-password"
                  className="w-full text-[12px] h-[26px]"
                />
              </div>
            </div>
          </WinGroupBox>

          {/* Save In Row */}
          <div className="grid grid-cols-[65px_1fr] items-center gap-2">
            <label className="text-neutral-400 text-[12px] font-normal">{t('newDownload.saveIn')}</label>
            <div className="flex items-center gap-1.5 w-full">
              <WinSelect
                value={saveCategoryMode}
                onChange={(e) => {
                  const val = e.target.value;
                  setSaveCategoryMode(val);
                  if (val !== 'auto') {
                    const mappedPath = buildCategoryFolderPath(defaultFolder, val as any);
                    if (mappedPath) setDestinationFolder(mappedPath);
                  }
                }}
                className="flex-1 text-[12px] h-[28px]"
              >
                <option value="auto">
                  {t('newDownload.autoCategory', { cat: detectedCategory ? `(${detectedCategory})` : '' })}
                </option>
                <option value="compressed">{t('newDownload.folderCompressed')}</option>
                <option value="programs">{t('newDownload.folderPrograms')}</option>
                <option value="video">{t('newDownload.folderVideo')}</option>
                <option value="music">{t('newDownload.folderMusic')}</option>
                <option value="documents">{t('newDownload.folderDocuments')}</option>
              </WinSelect>
              <WinButton
                variant="secondary"
                onClick={handleBrowse}
                className="w-7 h-[28px] px-0 flex items-center justify-center font-bold text-[13px] shrink-0"
                title={t('newDownload.browseFolder')}
              >
                ...
              </WinButton>
            </div>
          </div>

          {/* Server Info / Ignore Link */}
          <div className="pl-[73px] flex items-center justify-between text-[11px]">
            <span
              onClick={() => {
                if (url) {
                  try {
                    const host = new URL(url).hostname;
                    setLocalMsgBox({
                      title: APP_NAME,
                      type: 'info',
                      message: t('newDownload.siteLoginHint', { host }),
                    });
                  } catch {}
                }
              }}
              className="text-brand-bright hover:underline cursor-pointer"
            >
              {t('newDownload.dontCapture')}
            </span>

            {probedInfo && (
              <span className="text-neutral-400 font-mono text-[10.5px]">
                {probedInfo.size ? formatSize(probedInfo.size) : ''}
                {probedInfo.resumable !== undefined ? ` • ${t('newDownload.resume')}: ${probedInfo.resumable ? t('common.yes') : t('common.no')}` : ''}
              </span>
            )}
          </div>
        </div>
      </WindowsDialog>

      {/* Advanced Settings Modal fallback when not in standalone window */}
      {isAdvancedOpen && (
        <AdvancedSettingsDialog
          isOpen={isAdvancedOpen}
          onClose={() => setIsAdvancedOpen(false)}
        />
      )}

      {activeMsgBox && (
        <MessageBoxDialog
          isOpen={Boolean(activeMsgBox)}
          options={activeMsgBox}
          onClose={() => setLocalMsgBox(null)}
        />
      )}
    </>
  );
};
