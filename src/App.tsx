import { MessageBoxDialog } from './components/MessageBoxDialog';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { TitleBar } from './components/TitleBar';
import { MenuBar } from './components/MenuBar';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { DownloadTable } from './components/DownloadTable';
import { StatusBar } from './components/StatusBar';
import { NewDownloadDialog } from './components/NewDownloadDialog';
import { AddressInputDialog } from './components/AddressInputDialog';
import { BatchDownloadDialog } from './components/BatchDownloadDialog';
import { DownloadStatusDialog } from './components/DownloadStatusDialog';
import { SchedulerDialog } from './components/SchedulerDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { SiteGrabberDialog } from './components/SiteGrabberDialog';
import { DiagnosticsDialog } from './components/DiagnosticsDialog';
import { IntegrityScanDialog } from './components/IntegrityScanDialog';
import { HistoryExportImportDialog } from './components/HistoryExportImportDialog';
import { AboutDialog } from './components/AboutDialog';
import { HelpCenterDialog } from './components/HelpCenterDialog';
import { PropertiesDialog } from './components/PropertiesDialog';
import { DownloadContextMenu } from './components/DownloadContextMenu';
import { DownloadItem, AppSettings, EngineStats, NewDownloadPayload } from './types/download';
import { APP_NAME, APP_FULL_TITLE, DEFAULT_DOWNLOAD_DIR, DEFAULT_TEMP_DIR } from './config/appInfo';
import { useLocalStorageBoolean } from './hooks/useLocalStorage';
import { isDownloadActive, isDownloadResumable, isDownloadCompleted } from './utils/downloadHelpers';
import { getFileCategory } from './utils/fileUtils';
import { api } from './api/client';
import { getApiBaseUrl, getWsUrl } from './config/apiConfig';

const API_BASE = `${getApiBaseUrl()}/api`;

export const App: React.FC = () => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>('all');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Dialog States
  const [isNewDownloadOpen, setIsNewDownloadOpen] = useState(false);
  const [newDownloadUrl, setNewDownloadUrl] = useState<string>('');
  // Two-step add-download flow: AddressInputDialog (step 1: URL + optional login)
  // hands off to NewDownloadDialog (step 2: file info, category, folder).
  const [isAddressOpen, setIsAddressOpen] = useState(false);
  const [isBatchDownloadOpen, setIsBatchDownloadOpen] = useState(false);
  const [isSchedulerOpen, setIsSchedulerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSiteGrabberOpen, setIsSiteGrabberOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [historyModalMode, setHistoryModalMode] = useState<'export' | 'import' | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [aboutAutoCheck, setAboutAutoCheck] = useState(false);
  const [isHelpCenterOpen, setIsHelpCenterOpen] = useState(false);
  const [helpCenterTab, setHelpCenterTab] = useState<'howto' | 'faq' | 'bug' | 'feedback' | 'legal'>('howto');
  const [helpCenterGuide, setHelpCenterGuide] = useState<string | undefined>(undefined);
  // View Layout Toggles (Persisted via unified hook)
  const [showToolbar, , toggleToolbar] = useLocalStorageBoolean('ndm_show_toolbar', true);
  const [showCategories, , toggleCategories] = useLocalStorageBoolean('ndm_show_categories', true);
  const [showStatusBar, , toggleStatusBar] = useLocalStorageBoolean('ndm_show_statusbar', true);
  const [isPropertiesOpen, setIsPropertiesOpen] = useState(false);
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);

  const [activeDownload, setActiveDownload] = useState<DownloadItem | null>(null);
  const [confirmMsgBox, setConfirmMsgBox] = useState<any>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; download: DownloadItem } | null>(null);
  // Queue state for the table's Q column + move-to-queue context menu.
  const [queueAssignments, setQueueAssignments] = useState<Record<string, string>>({});
  const [queueList, setQueueList] = useState<Array<{ id: string; name: string }>>([]);

  // Settings State
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

  const defaultFolder = settings.defaultDownloadFolder || DEFAULT_DOWNLOAD_DIR;

  // Fetch initial downloads and settings
  const fetchQueueState = useCallback(async () => {
    try {
      const [assignRes, queuesRes] = await Promise.all([
        fetch(`${API_BASE}/queue-assignments`),
        fetch(`${API_BASE}/queues`),
      ]);
      if (assignRes.ok) setQueueAssignments(await assignRes.json());
      if (queuesRes.ok) {
        const qs = await queuesRes.json();
        setQueueList(Array.isArray(qs)
          ? qs.map((q: any) => ({ id: q.id, name: q.name, state: q.state, maxConcurrent: q.maxConcurrent, downloadIds: q.downloadIds }))
          : []);
      }
    } catch {}
  }, []);

  // Toolbar Start/Stop Queue: acts on the given queue (default
  // queue when no id is passed — the main buttons) and refreshes state.
  const startOrStopQueue = useCallback(async (queueId?: string, action?: 'start' | 'stop') => {
    const id = queueId || 'default';
    try {
      if (action === 'stop') await api.queues.stop(id);
      else await api.queues.start(id);
      await fetchQueueState();
    } catch {}
  }, [fetchQueueState]);

  const handleMoveToQueue = useCallback(async (downloadId: string, queueId: string) => {
    try {
      await fetch(`${API_BASE}/downloads/${downloadId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId }),
      });
      setQueueAssignments((prev) => ({ ...prev, [downloadId]: queueId }));
    } catch {}
  }, []);

  const fetchDownloads = useCallback(async () => {
    try {
      const list = await api.downloads.getAll();
      setDownloads(list);
    } catch (err) {
      console.warn('Could not fetch downloads:', err);
    }
    // Queue membership changes alongside downloads (auto-assign on add).
    fetchQueueState();
  }, [fetchQueueState]);

  const fetchSettings = useCallback(async () => {
    try {
      // First try Electron native downloads path for immediate responsiveness
      if (window.electronAPI?.getDownloadsPath) {
        const nativePath = await window.electronAPI.getDownloadsPath().catch(() => null);
        if (nativePath) {
          setSettings((prev) => ({
            ...prev,
            defaultDownloadFolder: nativePath,
          }));
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
          speedLimitBps: data.speedLimitBps ?? prev.speedLimitBps,
          overwriteExisting: data.overwriteExisting ?? prev.overwriteExisting,
          autoStartDownloads: data.autoStartDownloads ?? prev.autoStartDownloads,
          autoCategorize: data.autoCategorize ?? prev.autoCategorize,
          rememberLastFolder: data.rememberLastFolder ?? prev.rememberLastFolder,
          monitorClipboard: data.monitorClipboard ?? prev.monitorClipboard,
        } as any));
      }
    } catch {}
  }, []);

  useEffect(() => {
    document.title = APP_FULL_TITLE;
    fetchDownloads();
    fetchSettings();

    // WebSocket Telemetry Connection
    let ws: WebSocket | null = null;
    let reconnectTimer: any = null;

    const connectWs = () => {
      const wsUrl = getWsUrl();

      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'INIT_STATE' || msg.type === 'DOWNLOADS_UPDATE' || msg.type === 'STATE_UPDATE') {
              const list = Array.isArray(msg.data) ? msg.data : (msg.data?.downloads || msg.downloads);
              if (Array.isArray(list)) {
                setDownloads(list);
                setActiveDownload((prev) => {
                  if (!prev) return prev;
                  const updated = list.find((d: DownloadItem) => d.id === prev.id);
                  return updated ? { ...prev, ...updated } : prev;
                });
              }
            } else if (msg.type === 'DOWNLOAD_PROGRESS' && msg.data) {
              setDownloads((prev) =>
                Array.isArray(prev) ? prev.map((d) => (d.id === msg.data.id ? { ...d, ...msg.data } : d)) : []
              );
              setActiveDownload((prev) => (prev && prev.id === msg.data.id ? { ...prev, ...msg.data } : prev));
            }
          } catch {}
        };

        ws.onclose = () => {
          reconnectTimer = setTimeout(connectWs, 2000);
        };
      } catch {
        reconnectTimer = setTimeout(connectWs, 2000);
      }
    };

    connectWs();

    // Fallback polling loop
    const pollInterval = setInterval(fetchDownloads, 1000);

    return () => {
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(pollInterval);
    };
  }, [fetchDownloads, fetchSettings]);

  // Single-Instance URL Forwarding Listener (Section 5 & 35)
  useEffect(() => {
    if ((window as any).electronAPI?.onOpenNewDownload) {
      const unsub = (window as any).electronAPI.onOpenNewDownload((data: { url: string }) => {
        if (data?.url) {
          if ((window as any).electronAPI?.openWindow) {
            (window as any).electronAPI.openWindow('new-download', { url: data.url });
          } else {
            setNewDownloadUrl(data.url);
            setIsNewDownloadOpen(true);
          }
        }
      });
      return () => unsub();
    }
  }, []);

  // Toolbar/Menu "Add URL" from the main window opens the tiny step-1
  // address window (child windows can't spawn each other, so the main
  // window forwards the request). Falls back to the embedded modal.
  useEffect(() => {
    if ((window as any).electronAPI?.onShowAddressDialog) {
      const unsub = (window as any).electronAPI.onShowAddressDialog(() => setIsAddressOpen(true));
      return () => unsub();
    }
  }, []);

  // Safe list
  const safeDownloads = useMemo(() => Array.isArray(downloads) ? downloads : [], [downloads]);

  // Server-defined categories: custom rows in the sidebar filter
  // by their own extension list and optional sites-only rules.
  const [serverCategories, setServerCategories] = useState<Array<{ id: string; name: string; extensions: string[]; defaultFolder: string; sitesOnly?: string[] }>>([]);
  useEffect(() => {
    let alive = true;
    api.categories.getAll().then((list) => { if (alive && Array.isArray(list)) setServerCategories(list); }).catch(() => {});
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ndm_categories_changed') {
        api.categories.getAll().then((list) => { if (alive && Array.isArray(list)) setServerCategories(list); }).catch(() => {});
      }
    };
    window.addEventListener('storage', onStorage);
    return () => { alive = false; window.removeEventListener('storage', onStorage); };
  }, []);

  // Filtered Downloads
  const filteredDownloads = useMemo(() => {
    const custom = serverCategories.find((c) => c.id === filter);
    return safeDownloads.filter((d) => {
      // Sidebar category filter
      if (filter === 'unfinished') {
        if (isDownloadCompleted(d.status)) return false;
      } else if (filter === 'finished') {
        if (!isDownloadCompleted(d.status)) return false;
      } else if (custom) {
        // Custom category: match by its extension list; when sites-only rules
        // exist, at least one glob host must match the download URL.
        const ext = (d.filename || '').toLowerCase().split('.').pop() || '';
        const extOk = custom.extensions.includes(ext);
        const host = (() => { try { return new URL(d.url || '').hostname.toLowerCase(); } catch { return ''; } })();
        const siteOk = !custom.sitesOnly?.length
          || custom.sitesOnly.some((pattern) => {
            const p = pattern.replace(/^\*\./, '*');
            if (p === '*') return true;
            if (p.startsWith('*')) return host.endsWith(p.slice(1));
            return host === p || host.endsWith(`.${p}`);
          });
        if (!extOk || !siteOk) return false;
      } else if (filter !== 'all' && filter !== 'queues') {
        if (getFileCategory(d.filename) !== filter) return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = d.filename?.toLowerCase().includes(q);
        const matchesUrl = d.url?.toLowerCase().includes(q);
        if (!matchesName && !matchesUrl) return false;
      }

      return true;
    });
  }, [safeDownloads, filter, searchQuery, serverCategories]);

  // Status Bar Metrics
  const stats: EngineStats = useMemo(() => {
    let totalSpeedBps = 0;
    let activeDownloadsCount = 0;
    let completedCount = 0;
    let queuedCount = 0;

    safeDownloads.forEach((d) => {
      if (d.status === 'downloading') {
        totalSpeedBps += d.speedBps || 0;
        activeDownloadsCount++;
      } else if (d.status === 'completed') {
        completedCount++;
      } else if (d.status === 'queued') {
        queuedCount++;
      }
    });

    return {
      totalSpeedBps,
      activeDownloadsCount,
      completedCount,
      queuedCount,
      speedHistory: [],
    };
  }, [safeDownloads]);

  // Selection states
  const selectedDownloads = useMemo(() => {
    return safeDownloads.filter((d) => selectedIds.has(d.id));
  }, [safeDownloads, selectedIds]);

  const canResume = useMemo(() => {
    return selectedDownloads.some((d) => isDownloadResumable(d.status));
  }, [selectedDownloads]);

  const canPause = useMemo(() => {
    return selectedDownloads.some((d) => isDownloadActive(d.status));
  }, [selectedDownloads]);

  const canDelete = selectedIds.size > 0;
  const hasCompleted = useMemo(() => safeDownloads.some((d) => isDownloadCompleted(d.status)), [safeDownloads]);
  const hasFailed = useMemo(() => safeDownloads.some((d) => d.status === 'error'), [safeDownloads]);

  const openWindowOrModal = (type: string, fallbackSetter: () => void, params?: Record<string, any>) => {
    if ((window as any).electronAPI?.openWindow) {
      (window as any).electronAPI.openWindow(type, params);
    } else {
      fallbackSetter();
    }
  };

  const openAddUrl = () => openWindowOrModal('address-input', () => setIsAddressOpen(true));
  const openBatch = () => openWindowOrModal('batch', () => setIsBatchDownloadOpen(true));
  const openSiteGrabber = () => openWindowOrModal('site-grabber', () => setIsSiteGrabberOpen(true));
  const openOptions = () => openWindowOrModal('settings', () => setIsSettingsOpen(true));
  const openScheduler = () => openWindowOrModal('scheduler', () => setIsSchedulerOpen(true));
  const openDiagnostics = () => openWindowOrModal('diagnostics', () => setIsDiagnosticsOpen(true));
  const [isIntegrityScanOpen, setIsIntegrityScanOpen] = useState(false);
  const openIntegrityScan = () => openWindowOrModal('integrity-scan', () => setIsIntegrityScanOpen(true));
  const openExportHistory = () => openWindowOrModal('history', () => setHistoryModalMode('export'), { mode: 'export' });
  const openImportHistory = () => openWindowOrModal('history', () => setHistoryModalMode('import'), { mode: 'import' });
  const openHelpCenter = (
    tab: 'howto' | 'faq' | 'bug' | 'feedback' | 'legal' = 'howto',
    guide?: string
  ) =>
    openWindowOrModal('help-center', () => { setHelpCenterTab(tab); setHelpCenterGuide(guide); setIsHelpCenterOpen(true); }, { tab, ...(guide ? { guide } : {}) });
  const openAbout = () => openWindowOrModal('about', () => setIsAboutOpen(true));
  const openCheckForUpdates = () => openWindowOrModal('about', () => { setIsAboutOpen(true); setAboutAutoCheck(true); }, { autoCheck: true });

  // Two-step add-download flow, step 1 → step 2 handoff. The address dialog is tiny
  // and always-on-top; when it confirms, we persist any site credentials
  // immediately (they live in the engine's store, which both OS windows and
  // the engine can see) and open the full details dialog prefilled.
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
    setNewDownloadUrl(url);
    openWindowOrModal('new-download', () => setIsNewDownloadOpen(true));
  };

  // Actions
  const handleAddDownload = async (payload: NewDownloadPayload) => {
    try {
      const data = await api.downloads.create(payload);
      fetchDownloads();
      // The engine returns the item directly (not wrapped in { download }).
      const created: any = (data as any)?.download ?? data;
      const createdId: string | undefined = created?.id;
      if (!createdId) return;
      // "Download Later" queues the item paused — no progress dialog for it.
      if (payload.startImmediate === false) return;
      if ((window as any).electronAPI?.openDownloadWindow) {
        (window as any).electronAPI.openDownloadWindow(createdId);
      } else {
        setActiveDownload(created);
        setIsStatusDialogOpen(true);
      }
    } catch (err: any) {
      throw new Error(err.message || 'Failed to start download');
    }
  };

  const handleBatchDownload = async (urls: string[], destinationFolder: string) => {
    for (const url of urls) {
      try {
        await api.downloads.create({
          url,
          destinationFolder,
          connections: settings.defaultConnections ?? 32,
        });
      } catch {}
    }
    fetchDownloads();
  };

  const handlePause = async (id: string) => {
    try {
      await api.downloads.pause(id);
      fetchDownloads();
    } catch {}
  };

  const handleResume = async (id: string) => {
    try {
      await api.downloads.resume(id);
      fetchDownloads();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      await api.downloads.delete(id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      fetchDownloads();
    } catch {}
  };

  const handlePauseSelected = () => {
    selectedDownloads.forEach((d) => {
      if (isDownloadActive(d.status)) handlePause(d.id);
    });
  };

  const handleResumeSelected = () => {
    selectedDownloads.forEach((d) => {
      if (isDownloadResumable(d.status)) handleResume(d.id);
    });
  };

  const handleResumeAll = () => {
    safeDownloads.forEach((d) => {
      if (isDownloadResumable(d.status)) handleResume(d.id);
    });
  };

  const handleRetryAllFailed = async () => {
    try {
      await api.downloads.retryAllFailed();
      fetchDownloads();
    } catch {}
  };

  const handlePauseAll = () => {
    safeDownloads.forEach((d) => {
      if (isDownloadActive(d.status)) handlePause(d.id);
    });
  };

  const handleStopSelected = handlePauseSelected;
  const handleStopAll = handlePauseAll;

  const handleDeleteSelected = () => {
    selectedDownloads.forEach((d) => handleDelete(d.id));
  };

  const handleDeleteCompleted = () => {
    safeDownloads.forEach((d) => {
      if (isDownloadCompleted(d.status)) handleDelete(d.id);
    });
  };

  const handleDeleteIncomplete = () => {
    safeDownloads.forEach((d) => {
      if (!isDownloadCompleted(d.status)) handleDelete(d.id);
    });
  };

  const handleDeleteAll = async () => {
    if (safeDownloads.length === 0) return;
    const message = 'Are you sure you want to remove ALL downloads from the list?';

    if ((window as any).electronAPI?.showNativeMessageBox) {
      const resp = await (window as any).electronAPI.showNativeMessageBox({
        type: 'question',
        buttons: ['Yes', 'No'],
        defaultId: 0,
        cancelId: 1,
        title: APP_NAME,
        message,
      });
      if (resp === 0) {
        safeDownloads.forEach((d) => handleDelete(d.id));
      }
      return;
    }

    setConfirmMsgBox({
      title: APP_NAME,
      type: 'question',
      buttons: 'yes_no',
      message,
      onConfirm: () => {
        safeDownloads.forEach((d) => handleDelete(d.id));
        setConfirmMsgBox(null);
      },
      onCancel: () => setConfirmMsgBox(null),
    });
  };

  const handleOpenFile = async (idOrPath: string) => {
    try {
      await fetch(`${API_BASE}/open-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: idOrPath }),
      });
    } catch {}
    if ((window as any).electronAPI?.openFile) {
      (window as any).electronAPI.openFile(idOrPath);
    }
  };

  const handleOpenFolder = async (idOrPath?: string) => {
    try {
      await fetch(`${API_BASE}/open-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: idOrPath || defaultFolder }),
      });
    } catch {}
    if ((window as any).electronAPI?.openFolder) {
      (window as any).electronAPI.openFolder(idOrPath || defaultFolder);
    }
  };

  const handleDoubleClick = (item: DownloadItem) => {
    if (item.status === 'downloading' || item.status === 'probing' || item.status === 'paused') {
      if ((window as any).electronAPI?.openDownloadWindow) {
        (window as any).electronAPI.openDownloadWindow(item.id);
      } else {
        setActiveDownload(item);
        setIsStatusDialogOpen(true);
      }
    } else if (item.status === 'completed') {
      if (settings.doubleClickAction === 'open_file') {
        handleOpenFile(item.destinationPath);
      } else if (settings.doubleClickAction === 'open_folder') {
        handleOpenFolder(item.destinationPath);
      } else {
        openWindowOrModal('properties', () => {
          setActiveDownload(item);
          setIsPropertiesOpen(true);
        }, { id: item.id });
      }
    } else {
      openWindowOrModal('properties', () => {
        setActiveDownload(item);
        setIsPropertiesOpen(true);
      }, { id: item.id });
    }
  };

  const handleContextMenu = (download: DownloadItem, e: React.MouseEvent) => {
    e.preventDefault();
    if (!selectedIds.has(download.id)) {
      setSelectedIds(new Set([download.id]));
    }
    setContextMenu({ x: e.clientX, y: e.clientY, download });
  };

  const confirmDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const message = count === 1
      ? 'Are you sure you want to remove the selected download from the list?'
      : `Are you sure you want to remove all ${count} selected downloads from the list?`;

    if ((window as any).electronAPI?.showNativeMessageBox) {
      const resp = await (window as any).electronAPI.showNativeMessageBox({
        type: 'question',
        buttons: ['Yes', 'No'],
        defaultId: 0,
        cancelId: 1,
        title: APP_NAME,
        message,
      });
      if (resp === 0) {
        handleDeleteSelected();
      }
      return;
    }

    setConfirmMsgBox({
      title: APP_NAME,
      type: 'question',
      buttons: 'yes_no',
      message,
      onConfirm: () => {
        handleDeleteSelected();
        setConfirmMsgBox(null);
      },
      onCancel: () => setConfirmMsgBox(null),
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        openAddUrl();
      } else if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        openBatch();
      } else if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        openOptions();
      } else if (e.ctrlKey && (e.key === 'q' || e.key === 'Q')) {
        e.preventDefault();
        openScheduler();
      } else if (e.ctrlKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        openSiteGrabber();
      } else if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setSelectedIds(new Set(filteredDownloads.map(d => d.id)));
      } else if (e.ctrlKey && e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        void handleRetryAllFailed();
      } else if (e.key === 'Delete') {
        e.preventDefault();
        confirmDeleteSelected();
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (canPause) handlePauseSelected();
        else if (canResume) handleResumeSelected();
      } else if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'F1') {
      e.preventDefault();
      openHelpCenter();
    } else if (e.key === 'F5') {
        e.preventDefault();
        fetchDownloads();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredDownloads, selectedIds, canPause, canResume]);

  const handleSaveSettings = async (newSettings: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
    try {
      await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          downloads: {
            defaultDownloadFolder: newSettings.defaultDownloadFolder || newSettings.defaultFolder,
            tempDownloadFolder: newSettings.tempDownloadFolder || newSettings.tempDir,
            defaultConnections: newSettings.defaultConnections,
            maxConcurrentDownloads: newSettings.maxConcurrentDownloads,
            autoStartDownloads: newSettings.autoStartDownloads,
            duplicateHandling: newSettings.overwriteExisting ? 'overwrite' : 'ask',
          },
          network: {
            globalSpeedLimitEnabled: (newSettings.speedLimitBps || 0) > 0,
            globalSpeedLimitKB: Math.round((newSettings.speedLimitBps || 0) / 1024),
          },
          general: {
            doubleClickAction: newSettings.doubleClickAction,
          },
          browser: newSettings.browser,
        }),
      });
    } catch {}
  };

  const handleSetDownloadSpeedLimit = async (id: string, speedLimitKB: number) => {
    try {
      await fetch(`${API_BASE}/downloads/${id}/speed-limit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speedLimitKB }),
      });
      fetchDownloads();
    } catch {}
  };

  return (
    <div className="h-full w-full flex flex-col ndm-window overflow-hidden select-none font-sans">
      {/* 1. Window Title Bar */}
      <TitleBar />

      {/* 2. Menu Bar (Tasks, File, Downloads, View, Help) */}
      <MenuBar
        onAddUrl={openAddUrl}
        onAddBatch={openBatch}
        onOpenSiteGrabber={openSiteGrabber}
        onOpenOptions={openOptions}
        onOpenScheduler={openScheduler}
        onOpenDiagnostics={openDiagnostics}
        onOpenIntegrityScan={openIntegrityScan}
        onOpenHelpCenter={openHelpCenter}
        onExportHistory={openExportHistory}
        onImportHistory={openImportHistory}
        onRefresh={fetchDownloads}
        onExit={() => window.close()}
        onAbout={openAbout}
        onCheckForUpdates={openCheckForUpdates}
        onStopAll={handlePauseAll}
        onResumeSelected={handleResumeSelected}
        onDeleteSelected={confirmDeleteSelected}
        showToolbar={showToolbar}
        onToggleToolbar={toggleToolbar}
        showCategories={showCategories}
        onToggleCategories={toggleCategories}
        showStatusBar={showStatusBar}
        onToggleStatusBar={toggleStatusBar}
      />

      {/* 3. Large-Icon Command Toolbar */}
      {showToolbar && (
        <Toolbar
          onAddUrl={openAddUrl}
          onAddBatch={openBatch}
          onOpenSiteGrabber={openSiteGrabber}
          onResumeSelected={handleResumeSelected}
          onResumeAll={handleResumeAll}
          onRetryAllFailed={handleRetryAllFailed}
          hasFailed={hasFailed}
          onPauseSelected={handlePauseSelected}
          onPauseAll={handlePauseAll}
          onStopSelected={handleStopSelected}
          onStopAll={handleStopAll}
          onDeleteSelected={confirmDeleteSelected}
          onDeleteCompleted={handleDeleteCompleted}
          onDeleteIncomplete={handleDeleteIncomplete}
          onDeleteAll={handleDeleteAll}
          onOpenOptions={openOptions}
          onOpenScheduler={openScheduler}
          onStartQueue={(queueId) => startOrStopQueue(queueId, 'start')}
          onStopQueue={(queueId) => startOrStopQueue(queueId, 'stop')}
          queues={queueList}
          canResume={canResume}
          canPause={canPause}
          canDelete={canDelete}
          hasCompleted={hasCompleted}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchInputRef={searchInputRef}
        />
      )}

      {/* 4. Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {showCategories && (
          <Sidebar
            selectedFilter={filter}
            onSelectFilter={setFilter}
          />
        )}

        <DownloadTable
          downloads={filteredDownloads}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          onAddUrl={openAddUrl}
          queueAssignments={queueAssignments}
          queueNames={Object.fromEntries(queueList.map((q) => [q.id, q.name]))}
        />
      </div>

      {/* 5. Multi-Pane Status Bar */}
      {showStatusBar && (
        <StatusBar
          totalCount={safeDownloads.length}
          filteredCount={filteredDownloads.length}
          selectedCount={selectedIds.size}
          selectedBytes={selectedDownloads.reduce((acc, d) => acc + (d.totalBytes || d.downloadedBytes || 0), 0)}
          activeCount={stats.activeDownloadsCount}
          completedCount={stats.completedCount}
          stats={stats}
        />
      )}

      {/* 6. Modals & Dialogs */}
      <AddressInputDialog
        isOpen={isAddressOpen}
        onClose={() => setIsAddressOpen(false)}
        onSubmit={handleAddressSubmit}
      />

      <NewDownloadDialog
        isOpen={isNewDownloadOpen}
        onClose={() => {
          setIsNewDownloadOpen(false);
          setNewDownloadUrl('');
        }}
        onSubmit={handleAddDownload}
        defaultFolder={defaultFolder}
        defaultConnections={settings.defaultConnections}
        initialUrl={newDownloadUrl}
      />

      <BatchDownloadDialog
        isOpen={isBatchDownloadOpen}
        onClose={() => setIsBatchDownloadOpen(false)}
        onSubmitBatch={handleBatchDownload}
        defaultFolder={defaultFolder}
      />

      <DownloadStatusDialog
        isOpen={isStatusDialogOpen}
        download={activeDownload}
        onClose={() => {
          setIsStatusDialogOpen(false);
          setActiveDownload(null);
        }}
        onPause={handlePause}
        onResume={handleResume}
        onCancel={handleDelete}
        onOpenFile={handleOpenFile}
        onOpenFolder={handleOpenFolder}
        onSetSpeedLimit={handleSetDownloadSpeedLimit}
        onOpenHelpCenter={openHelpCenter}
      />

      <SchedulerDialog
        isOpen={isSchedulerOpen}
        onClose={() => setIsSchedulerOpen(false)}
        downloads={safeDownloads}
        onStartQueue={() => handleResumeSelected()}
        onStopQueue={() => handlePauseAll()}
      />

      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
      />

      <SiteGrabberDialog
        isOpen={isSiteGrabberOpen}
        onClose={() => setIsSiteGrabberOpen(false)}
        onSubmitBatch={handleBatchDownload}
        defaultFolder={settings.defaultFolder || settings.defaultDownloadFolder}
      />

      <DiagnosticsDialog
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
      />

      <IntegrityScanDialog
        isOpen={isIntegrityScanOpen}
        onClose={() => setIsIntegrityScanOpen(false)}
        onScanned={fetchDownloads}
      />

      <HistoryExportImportDialog
        isOpen={historyModalMode !== null}
        mode={historyModalMode || 'export'}
        onClose={() => setHistoryModalMode(null)}
        onRefreshDownloads={fetchDownloads}
      />

      <AboutDialog
        isOpen={isAboutOpen}
        autoCheck={aboutAutoCheck}
        onClose={() => { setIsAboutOpen(false); setAboutAutoCheck(false); }}
      />

      <HelpCenterDialog
        isOpen={isHelpCenterOpen}
        initialTab={helpCenterTab}
        initialGuide={helpCenterGuide}
        onClose={() => setIsHelpCenterOpen(false)}
      />

      <PropertiesDialog
        isOpen={isPropertiesOpen}
        download={activeDownload}
        onClose={() => {
          setIsPropertiesOpen(false);
          setActiveDownload(null);
        }}
      />

      {contextMenu && (
        <DownloadContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          download={contextMenu.download}
          onClose={() => setContextMenu(null)}
          onPause={handlePause}
          onResume={handleResume}
          onDelete={handleDelete}
          onOpenFile={handleOpenFile}
          onOpenFolder={handleOpenFolder}
          queues={queueList}
          currentQueueId={queueAssignments[contextMenu.download.id]}
          onMoveToQueue={handleMoveToQueue}
          onOpenProperties={(dl) => {
            openWindowOrModal('properties', () => {
              setActiveDownload(dl);
              setIsPropertiesOpen(true);
            }, { id: dl.id });
          }}
        />
      )}
    
      <MessageBoxDialog
        isOpen={!!confirmMsgBox}
        options={confirmMsgBox}
        onClose={() => setConfirmMsgBox(null)}
      />
</div>
  );
};
