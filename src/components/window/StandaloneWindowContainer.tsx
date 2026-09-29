import React, { useState, useEffect, useCallback } from 'react';
import { DownloadStatusDialog } from '../DownloadStatusDialog';
import { SettingsDialog } from '../SettingsDialog';
import { NewDownloadDialog } from '../NewDownloadDialog';
import { AddressInputDialog } from '../AddressInputDialog';
import { BatchDownloadDialog } from '../BatchDownloadDialog';
import { SiteGrabberDialog } from '../SiteGrabberDialog';
import { SchedulerDialog } from '../SchedulerDialog';
import { HistoryExportImportDialog } from '../HistoryExportImportDialog';
import { DiagnosticsDialog } from '../DiagnosticsDialog';
import { AboutDialog } from '../AboutDialog';
import { HelpCenterDialog } from '../HelpCenterDialog';
import { PropertiesDialog } from '../PropertiesDialog';
import { RefreshUrlDialog } from '../RefreshUrlDialog';
import { AdvancedSettingsDialog } from '../AdvancedSettingsDialog';
import { DownloadItem, AppSettings, NewDownloadPayload } from '../../types/download';
import { api } from '../../api/client';
import { DEFAULT_DOWNLOAD_DIR, DEFAULT_TEMP_DIR } from '../../config/appInfo';
import { getApiBaseUrl, getWsUrl } from '../../config/apiConfig';

export const StandaloneWindowContainer: React.FC = () => {
  const [route, setRoute] = useState<string>('');
  const [params, setParams] = useState<Record<string, string>>({});
  const [download, setDownload] = useState<DownloadItem | null>(null);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    defaultDownloadFolder: DEFAULT_DOWNLOAD_DIR,
    tempDownloadFolder: DEFAULT_TEMP_DIR,
    defaultConnections: 32,
    maxConcurrentDownloads: 0, // 0 = unlimited (default)
    autoStartDownloads: true,
    overwriteExisting: false,
    doubleClickAction: 'open_file',
    speedLimitBps: 0,
  });

  const handleClose = useCallback(() => {
    if ((window as any).electronAPI?.close) {
      (window as any).electronAPI.close();
    } else {
      window.close();
    }
  }, []);

  // Parse Hash Route
  useEffect(() => {
    const parseHash = () => {
      const hash = window.location.hash || '';
      // Pattern: #/window/route_name?param1=val1
      const match = hash.match(/^#\/window\/([^?]+)(?:\?(.*))?$/);
      if (match) {
        setRoute(match[1]);
        const search = match[2] ? new URLSearchParams(match[2]) : new URLSearchParams();
        const p: Record<string, string> = {};
        search.forEach((val, key) => {
          p[key] = val;
        });
        setParams(p);
      }
    };

    parseHash();
    window.addEventListener('hashchange', parseHash);
    return () => window.removeEventListener('hashchange', parseHash);
  }, []);

  // Global Settings & Native Downloads Path Resolution for All Standalone Windows
  useEffect(() => {
    const initGlobalSettings = async () => {
      try {
        if ((window as any).electronAPI?.getDownloadsPath) {
          const nativePath = await (window as any).electronAPI.getDownloadsPath().catch(() => null);
          if (nativePath) {
            setSettings((prev) => ({ ...prev, defaultDownloadFolder: nativePath }));
          }
        }
        const data = await api.settings.get();
        if (data && data.downloads) {
          setSettings((prev) => ({
            ...prev,
            defaultDownloadFolder: data.downloads.defaultDownloadFolder || prev.defaultDownloadFolder,
            defaultConnections: data.downloads.defaultConnections ?? prev.defaultConnections,
            maxConcurrentDownloads: data.downloads.maxConcurrentDownloads || prev.maxConcurrentDownloads,
            doubleClickAction: data.general?.doubleClickAction || prev.doubleClickAction,
          }));
        }
      } catch {}
    };

    initGlobalSettings();
  }, []);

  // Fetch Download data if route is download-status, properties, or refresh-url
  useEffect(() => {
    if ((route === 'download-status' || route === 'properties' || route === 'refresh-url') && params.id) {
      let isMounted = true;
      const downloadId = params.id;

      const fetchItem = async () => {
        try {
          const res = await fetch(`${getApiBaseUrl()}/api/downloads/${downloadId}`, {
            signal: AbortSignal.timeout(1500),
          });
          if (res.ok && isMounted) {
            const item = await res.json();
            setDownload((prev) => (prev ? { ...prev, ...item } : item));
          } else {
            const list = await api.downloads.getAll();
            if (!isMounted) return;
            const match = list.find((d) => d.id === downloadId);
            if (match) setDownload((prev) => (prev ? { ...prev, ...match } : match));
          }
        } catch {}
      };
      fetchItem();

      // Reliable polling fallback every 500ms while window is open
      const pollTimer = setInterval(fetchItem, 500);

      // WebSocket live updates using getWsUrl()
      let ws: WebSocket | null = null;
      try {
        ws = new WebSocket(getWsUrl());
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'DOWNLOAD_PROGRESS' && msg.data?.id === downloadId && isMounted) {
              setDownload((prev) => (prev ? { ...prev, ...msg.data } : prev));
            } else if (
              (msg.type === 'STATE_UPDATE' || msg.type === 'DOWNLOADS_UPDATE' || msg.type === 'INIT_STATE') &&
              isMounted
            ) {
              const list = Array.isArray(msg.data) ? msg.data : (msg.data?.downloads || msg.downloads);
              if (Array.isArray(list)) {
                const match = list.find((d: DownloadItem) => d.id === downloadId);
                if (match) setDownload((prev) => (prev ? { ...prev, ...match } : match));
              }
            }
          } catch {}
        };
      } catch {}

      return () => {
        isMounted = false;
        clearInterval(pollTimer);
        if (ws) ws.close();
      };
    }
  }, [route, params.id]);

  // Fetch Downloads list for scheduler queue view
  useEffect(() => {
    if (route === 'scheduler') {
      api.downloads.getAll().then((list) => {
        if (Array.isArray(list)) setDownloads(list);
      }).catch(() => {});
    }
  }, [route]);

  const handleSaveSettings = async (newSettings: Partial<AppSettings>) => {
    try {
      await api.settings.save(newSettings);
      setSettings((prev) => ({ ...prev, ...newSettings }));
      handleClose();
    } catch {}
  };

  const handlePauseDownload = async (id: string) => {
    try {
      await api.downloads.pause(id);
    } catch {}
  };

  const handleResumeDownload = async (id: string) => {
    try {
      await api.downloads.resume(id);
    } catch {}
  };

  const handleCancelDownload = async (id: string) => {
    try {
      await api.downloads.delete(id);
      handleClose();
    } catch {}
  };

  const handleSetSpeedLimit = async (id: string, speedLimitKB: number) => {
    try {
      await api.downloads.setSpeedLimit(id, speedLimitKB);
    } catch {}
  };

  // Step-1 → step-2 handoff: the tiny address window confirms a URL, stores
  // its optional site credentials right away (the engine's credential store
  // is shared across windows), then opens the full new-download window.
  const handleAddressSubmit = async (url: string, login?: string, password?: string) => {
    if (login) {
      try {
        await api.credentials.add({
          domain: new URL(url).hostname,
          authType: 'basic',
          username: login,
          password: password || '',
        });
      } catch { /* best-effort */ }
    }
    if ((window as any).electronAPI?.openWindow) {
      (window as any).electronAPI.openWindow('new-download', { url });
    }
    handleClose();
  };

  const handleCreateDownload = async (payload: NewDownloadPayload) => {
    try {
      const data: any = await api.downloads.create(payload);
      // Engine returns the item directly (not wrapped in { download }).
      const created = data?.download ?? data;
      if (created?.id && payload.startImmediate !== false) {
        // Open the live progress window for the new download.
        if ((window as any).electronAPI?.openDownloadWindow) {
          (window as any).electronAPI.openDownloadWindow(created.id);
        }
        handleClose();
        return;
      }
    } catch {}
    handleClose();
  };

  const handleBatchSubmit = async (urls: string[], destinationFolder: string) => {
    for (const url of urls) {
      try {
        await api.downloads.create({
          url,
          destinationFolder,
          connections: settings.defaultConnections ?? 32,
        });
      } catch {}
    }
    handleClose();
  };

  const handleOpenFile = useCallback(async (filePath?: string) => {
    const target = filePath || download?.destinationPath;
    if (!target) return;
    if ((window as any).electronAPI?.openFile) {
      await (window as any).electronAPI.openFile(target);
    } else {
      try {
        await fetch(`${getApiBaseUrl()}/api/downloads/open`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: target }),
        });
      } catch {}
    }
  }, [download?.destinationPath]);

  const handleOpenFolder = useCallback(async (filePath?: string) => {
    const target = filePath || download?.destinationPath;
    if (!target) return;
    if ((window as any).electronAPI?.showItemInFolder) {
      await (window as any).electronAPI.showItemInFolder(target);
    } else {
      try {
        await fetch(`${getApiBaseUrl()}/api/downloads/open-folder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: target }),
        });
      } catch {}
    }
  }, [download?.destinationPath]);

  // Dispatch to the matching standalone window view
  switch (route) {
    case 'download-status':
      return (
        <DownloadStatusDialog
          isOpen={true}
          isStandalone={true}
          download={download}
          onClose={handleClose}
          onPause={handlePauseDownload}
          onResume={handleResumeDownload}
          onCancel={handleCancelDownload}
          onOpenFile={handleOpenFile}
          onOpenFolder={handleOpenFolder}
          onSetSpeedLimit={handleSetSpeedLimit}
          // Browser-mode fallback (no Electron): open the Help Center modal in
          // this window, straight to the matching guide.
          onOpenHelpCenter={(tab, guide) => {
            const q = new URLSearchParams({ tab: tab || 'howto', ...(guide ? { guide } : {}) });
            window.location.hash = `#/window/help-center?${q.toString()}`;
          }}
        />
      );

    case 'settings':
      return (
        <SettingsDialog
          isOpen={true}
          isStandalone={true}
          settings={settings}
          onClose={handleClose}
          onSaveSettings={handleSaveSettings}
        />
      );

    case 'address-input':
      return (
        <AddressInputDialog
          isOpen={true}
          isStandalone={true}
          onClose={handleClose}
          onSubmit={handleAddressSubmit}
          initialUrl={params.url}
        />
      );

    case 'new-download':
      return (
        <NewDownloadDialog
          isOpen={true}
          isStandalone={true}
          onClose={handleClose}
          onSubmit={handleCreateDownload}
          defaultFolder={settings.defaultDownloadFolder}
          defaultConnections={settings.defaultConnections}
          initialUrl={params.url}
        />
      );

    case 'batch':
      return (
        <BatchDownloadDialog
          isOpen={true}
          isStandalone={true}
          onClose={handleClose}
          onSubmitBatch={handleBatchSubmit}
          defaultFolder={settings.defaultDownloadFolder}
        />
      );

    case 'site-grabber':
      return (
        <SiteGrabberDialog
          isOpen={true}
          isStandalone={true}
          onClose={handleClose}
          onSubmitBatch={handleBatchSubmit}
          defaultFolder={settings.defaultDownloadFolder}
        />
      );

    case 'scheduler':
      return (
        <SchedulerDialog
          isOpen={true}
          isStandalone={true}
          downloads={downloads}
          onClose={handleClose}
        />
      );

    case 'history':
      return (
        <HistoryExportImportDialog
          isOpen={true}
          isStandalone={true}
          mode={(params.mode as 'export' | 'import') || 'export'}
          onClose={handleClose}
        />
      );

    case 'diagnostics':
      return (
        <DiagnosticsDialog
          isOpen={true}
          isStandalone={true}
          onClose={handleClose}
        />
      );

    case 'about':
      return (
        <AboutDialog
          isOpen={true}
          isStandalone={true}
          autoCheck={Boolean(params?.autoCheck)}
          onClose={handleClose}
        />
      );

    case 'help-center':
      return (
        <HelpCenterDialog
          isOpen={true}
          isStandalone={true}
          initialTab={(params?.tab as any) || 'howto'}
          initialGuide={params?.guide || undefined}
          onClose={handleClose}
        />
      );

    case 'properties':
      return (
        <PropertiesDialog
          isOpen={true}
          isStandalone={true}
          download={download}
          onClose={handleClose}
        />
      );

    case 'refresh-url':
      return (
        <RefreshUrlDialog
          isOpen={true}
          isStandalone={true}
          download={download}
          downloadId={params.id}
          onClose={handleClose}
        />
      );

    case 'advanced-settings':
      return (
        <AdvancedSettingsDialog
          isOpen={true}
          isStandalone={true}
          onClose={handleClose}
        />
      );

    default:
      return (
        <div className="w-full h-full flex items-center justify-center bg-neutral-50 text-neutral-500 text-[13px] font-sans">
          Loading Windows Dialog...
        </div>
      );
  }
};
