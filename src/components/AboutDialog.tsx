import React, { useState, useEffect } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { WinButton } from './common/WinControls';
import { 
  APP_NAME, 
  APP_SHORT_NAME,
  APP_VERSION, 
  APP_ARCH, 
  APP_DESCRIPTION, 
  APP_COPYRIGHT 
} from '../config/appInfo';
import ndmLogo from '../assets/logo.png';
import { openExternal } from '../utils/openExternal';
import { useAppConfig } from '../hooks/useAppConfig';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isStandalone?: boolean;
  /** When true, the update check starts automatically when the dialog opens (Help > Check for Updates...). */
  autoCheck?: boolean;
}

export const AboutDialog: React.FC<AboutDialogProps> = ({
  isOpen,
  onClose,
  isStandalone = false,
  autoCheck = false,
}) => {
  const appConfig = useAppConfig();
  const [updateStatus, setUpdateStatus] = useState<string>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [safetyPrompt, setSafetyPrompt] = useState<{ activeCount: number } | null>(null);

  const autoCheckFired = React.useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    // Fetch initial updater state
    if ((window as any).electronAPI?.getUpdateState) {
      (window as any).electronAPI.getUpdateState().then((state: any) => {
        if (state) applyState(state);
      });
    }

    // Help > Check for Updates... opens this dialog with the check pre-triggered
    if (autoCheck && !autoCheckFired.current) {
      autoCheckFired.current = true;
      handleCheckForUpdates();
    }

    // Subscribe to real-time updater state changes
    if ((window as any).electronAPI?.onUpdaterStateChanged) {
      const unsub = (window as any).electronAPI.onUpdaterStateChanged((state: any) => {
        applyState(state);
      });
      return () => unsub();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) autoCheckFired.current = false;
  }, [isOpen]);

  const applyState = (state: any) => {
    setUpdateStatus(state.status);
    if (state.status === 'checking') {
      setStatusMessage('Checking for updates...');
    } else if (state.status === 'not-available') {
      setStatusMessage(`You're up to date. (${APP_SHORT_NAME} v${APP_VERSION})`);
    } else if (state.status === 'available') {
      const ver = state.updateInfo?.version || 'new version';
      setAvailableVersion(ver);
      setStatusMessage(`Update available: ${APP_SHORT_NAME} v${ver}`);
    } else if (state.status === 'downloading') {
      const pct = Math.round(state.progress?.percent || 0);
      setDownloadProgress(pct);
      setStatusMessage(`Downloading update... ${pct}%`);
    } else if (state.status === 'downloaded') {
      setStatusMessage(`Update ready. Restart ${APP_NAME} to install version ${state.updateInfo?.version || ''}.`);
    } else if (state.status === 'error') {
      setStatusMessage(state.error ? `Update check failed: ${state.error}` : 'Could not check for updates.');
    }
  };

  const handleCheckForUpdates = async () => {
    setUpdateStatus('checking');
    setStatusMessage('Checking for updates...');
    if ((window as any).electronAPI?.checkForUpdates) {
      const res = await (window as any).electronAPI.checkForUpdates();
      if (res?.error) {
        setUpdateStatus('error');
        setStatusMessage(`Could not check for updates: ${res.error}`);
      }
    } else {
      setTimeout(() => {
        setUpdateStatus('not-available');
        setStatusMessage(`You're up to date. (${APP_SHORT_NAME} v${APP_VERSION})`);
      }, 700);
    }
  };

  const handleDownloadUpdate = async () => {
    setUpdateStatus('downloading');
    setStatusMessage('Starting update download...');
    if ((window as any).electronAPI?.downloadUpdate) {
      await (window as any).electronAPI.downloadUpdate();
    }
  };

  const handleInstallClick = async () => {
    if ((window as any).electronAPI?.installUpdate) {
      const { activeDownloadsCount } = await (window as any).electronAPI.installUpdate();
      if (activeDownloadsCount > 0) {
        setSafetyPrompt({ activeCount: activeDownloadsCount });
        return;
      }
    }
    proceedWithRestart();
  };

  const proceedWithRestart = () => {
    if ((window as any).electronAPI?.quitAndInstall) {
      (window as any).electronAPI.quitAndInstall();
    }
  };

  const footer = (
    <div className="flex items-center justify-between w-full">
      <WinButton
        variant="secondary"
        onClick={handleCheckForUpdates}
        disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
        className="min-w-[130px]"
      >
        {updateStatus === 'checking' ? 'Checking...' : 'Check for Updates'}
      </WinButton>
      <WinButton
        variant="primary"
        onClick={onClose}
        className="min-w-[84px]"
      >
        OK
      </WinButton>
    </div>
  );

  return (
    <WindowsDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`About ${APP_NAME}`}
      width="w-[500px]"
      footer={footer}
      isStandalone={isStandalone}
      autoFitHeight={isStandalone}
    >
      <div className="flex gap-4 py-1">
        <img
          src={ndmLogo}
          alt={APP_NAME}
          className="w-11 h-11 object-contain shrink-0"
          style={{ imageRendering: '-webkit-optimize-contrast' }}
        />
        <div className="space-y-2 flex-1 min-w-0">
          <div>
            <h2 className="text-[14px] font-bold text-neutral-900">{APP_NAME}</h2>
            <div className="text-[11.5px] text-neutral-500">
              Version {APP_VERSION} ({APP_ARCH} Native Platform)
            </div>
          </div>
          <p className="text-[11.5px] text-neutral-600 leading-relaxed">
            {APP_DESCRIPTION}
          </p>

          {/* Update Subsystem State Panel */}
          {statusMessage && (
            <div className="mt-2.5 p-2 bg-neutral-100 border border-neutral-300 rounded-[2px] text-[11px] text-neutral-800">
              <div className="font-semibold">{statusMessage}</div>

              {updateStatus === 'available' && (
                <div className="mt-2 space-y-1.5">
                  {availableVersion && (
                    <div className="text-[10.5px] text-brand-glow">
                      Ready to upgrade from {APP_VERSION} to {availableVersion}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <WinButton variant="primary" onClick={handleDownloadUpdate} className="text-[10.5px] py-0.5 px-2">
                      Download Update
                    </WinButton>
                    <WinButton variant="secondary" onClick={() => setStatusMessage('')} className="text-[10.5px] py-0.5 px-2">
                      Later
                    </WinButton>
                  </div>
                </div>
              )}

              {updateStatus === 'downloading' && downloadProgress !== null && (
                <div className="mt-1.5 w-full bg-neutral-300 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-brand-glow h-full transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              )}

              {updateStatus === 'downloaded' && (
                <div className="mt-2 flex gap-2">
                  <WinButton variant="primary" onClick={handleInstallClick} className="text-[10.5px] py-0.5 px-2">
                    Restart & Install
                  </WinButton>
                  <WinButton variant="secondary" onClick={() => setStatusMessage('')} className="text-[10.5px] py-0.5 px-2">
                    Later
                  </WinButton>
                </div>
              )}
            </div>
          )}

          {/* Download Safety Warning (Section 12) */}
          {safetyPrompt && (
            <div className="mt-2 p-2.5 bg-status-errorBg border border-status-error rounded-[2px] text-[11px] text-status-error space-y-2">
              <div className="font-bold">Active Downloads in Progress</div>
              <div>
                You have {safetyPrompt.activeCount} active download{safetyPrompt.activeCount > 1 ? 's' : ''}. Installing the update will restart {APP_NAME}.
              </div>
              <div className="flex gap-2 pt-1">
                <WinButton variant="secondary" onClick={() => setSafetyPrompt(null)} className="text-[10.5px] py-0.5 px-2">
                  Keep Downloading
                </WinButton>
                <WinButton variant="primary" onClick={proceedWithRestart} className="text-[10.5px] py-0.5 px-2 !bg-status-error !text-white">
                  Install Now
                </WinButton>
              </div>
            </div>
          )}

          <div className="text-[10.5px] text-neutral-400 pt-2 border-t border-neutral-200 flex justify-between items-center">
            <span>{APP_COPYRIGHT}</span>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); void openExternal(appConfig.github.licenseUrl); }}
              className="text-brand hover:underline cursor-pointer"
            >
              Open Source Notices
            </a>
          </div>
        </div>
      </div>
    </WindowsDialog>
  );
};
