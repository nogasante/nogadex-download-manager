import { MessageBoxDialog } from './components/MessageBoxDialog';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TitleBar } from './components/TitleBar';
import { MenuBar } from './components/MenuBar';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { DownloadTable } from './components/DownloadTable';
import { StatusBar } from './components/StatusBar';
import { NewDownloadDialog } from './components/NewDownloadDialog';
import { BatchDownloadDialog } from './components/BatchDownloadDialog';
import { DownloadStatusDialog } from './components/DownloadStatusDialog';
import { SchedulerDialog } from './components/SchedulerDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { SiteGrabberDialog } from './components/SiteGrabberDialog';
import { DiagnosticsDialog } from './components/DiagnosticsDialog';
import { HistoryExportImportDialog } from './components/HistoryExportImportDialog';
import { AboutDialog } from './components/AboutDialog';
import { PropertiesDialog } from './components/PropertiesDialog';
import { DownloadContextMenu } from './components/DownloadContextMenu';
import { DownloadItem, AppSettings, EngineStats, NewDownloadPayload } from './types/download';

const API_BASE = '/api';

export const App: React.FC = () => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Dialog States
  const [isNewDownloadOpen, setIsNewDownloadOpen] = useState(false);
  const [isBatchDownloadOpen, setIsBatchDownloadOpen] = useState(false);
  const [isSchedulerOpen, setIsSchedulerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSiteGrabberOpen, setIsSiteGrabberOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [historyModalMode, setHistoryModalMode] = useState<'export' | 'import' | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  // View Layout Toggles (Persisted)
  const [showToolbar, setShowToolbar] = useState<boolean>(() => {
    const saved = localStorage.getItem('ndm_show_toolbar');
    return saved !== null ? saved === 'true' : true;
  });
  const [showCategories, setShowCategories] = useState<boolean>(() => {
    const saved = localStorage.getItem('ndm_show_categories');
    return saved !== null ? saved === 'true' : true;
  });
  const [showStatusBar, setShowStatusBar] = useState<boolean>(() => {
    const saved = localStorage.getItem('ndm_show_statusbar');
    return saved !== null ? saved === 'true' : true;
  });

  const toggleToolbar = () => {
    setShowToolbar((prev) => {
      localStorage.setItem('ndm_show_toolbar', String(!prev));
      return !prev;
    });
  };

  const toggleCategories = () => {
    setShowCategories((prev) => {
      localStorage.setItem('ndm_show_categories', String(!prev));
      return !prev;
    });
  };

  const toggleStatusBar = () => {
    setShowStatusBar((prev) => {
      localStorage.setItem('ndm_show_statusbar', String(!prev));
      return !prev;
    });
  };
  const [isPropertiesOpen, setIsPropertiesOpen] = useState(false);
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);

  const [activeDownload, setActiveDownload] = useState<DownloadItem | null>(null);
  const [confirmMsgBox, setConfirmMsgBox] = useState<any>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; download: DownloadItem } | null>(null);

  // Settings State
  const [settings, setSettings] = useState<AppSettings>({
    defaultDownloadFolder: 'C:\\Users\\nanas\\Downloads',
    tempDownloadFolder: 'C:\\Users\\nanas\\AppData\\Local\\Temp\\NogadexDownloads',
    defaultConnections: 32,
    maxConcurrentDownloads: 5,
    autoStartDownloads: true,
    overwriteExisting: false,
    doubleClickAction: 'open_file',
    speedLimitBps: 0,
  });

  const defaultFolder = settings.defaultDownloadFolder || 'C:\\Downloads';

  // Fetch initial downloads and settings
  const fetchDownloads = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/downloads`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setDownloads(data);
        } else if (data && Array.isArray(data.downloads)) {
          setDownloads(data.downloads);
        }
      }
    } catch (err) {
      console.warn('Could not fetch downloads:', err);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.downloads) {
          setSettings(prev => ({
            ...prev,
            defaultDownloadFolder: data.downloads.defaultDownloadFolder || prev.defaultDownloadFolder,
            defaultConnections: data.downloads.defaultConnections || prev.defaultConnections,
            maxConcurrentDownloads: data.downloads.maxConcurrentDownloads || prev.maxConcurrentDownloads,
            doubleClickAction: data.general?.doubleClickAction || prev.doubleClickAction,
          }));
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchDownloads();
    fetchSettings();

    // WebSocket Telemetry Connection
    let ws: WebSocket | null = null;
    let reconnectTimer: any = null;

    const connectWs = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'INIT_STATE' || msg.type === 'DOWNLOADS_UPDATE' || msg.type === 'STATE_UPDATE') {
              const list = Array.isArray(msg.data) ? msg.data : (msg.data?.downloads || msg.downloads);
              if (Array.isArray(list)) {
                setDownloads(list);
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

  // Safe list
  const safeDownloads = useMemo(() => Array.isArray(downloads) ? downloads : [], [downloads]);

  // Filtered Downloads
  const filteredDownloads = useMemo(() => {
    return safeDownloads.filter((d) => {
      // Sidebar category filter
      if (filter === 'unfinished') {
        if (d.status === 'completed') return false;
      } else if (filter === 'finished') {
        if (d.status !== 'completed') return false;
      } else if (filter === 'compressed') {
        const ext = d.filename?.split('.').pop()?.toLowerCase() || '';
        if (!['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso'].includes(ext)) return false;
      } else if (filter === 'documents') {
        const ext = d.filename?.split('.').pop()?.toLowerCase() || '';
        if (!['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'].includes(ext)) return false;
      } else if (filter === 'music') {
        const ext = d.filename?.split('.').pop()?.toLowerCase() || '';
        if (!['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return false;
      } else if (filter === 'programs') {
        const ext = d.filename?.split('.').pop()?.toLowerCase() || '';
        if (!['exe', 'msi', 'apk', 'deb', 'rpm'].includes(ext)) return false;
      } else if (filter === 'video') {
        const ext = d.filename?.split('.').pop()?.toLowerCase() || '';
        if (!['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return false;
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
  }, [safeDownloads, filter, searchQuery]);

  // Sidebar Counts
  const counts = useMemo(() => {
    let active = 0;
    let completed = 0;
    let failed = 0;
    let compressed = 0;
    let documents = 0;
    let music = 0;
    let programs = 0;
    let video = 0;

    safeDownloads.forEach((d) => {
      if (d.status === 'downloading' || d.status === 'probing') active++;
      if (d.status === 'completed') completed++;
      if (d.status === 'error') failed++;

      const ext = d.filename?.split('.').pop()?.toLowerCase() || '';
      if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso'].includes(ext)) compressed++;
      if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'].includes(ext)) documents++;
      if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) music++;
      if (['exe', 'msi', 'apk', 'deb', 'rpm'].includes(ext)) programs++;
      if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) video++;
    });

    return {
      all: safeDownloads.length,
      unfinished: safeDownloads.length - completed,
      finished: completed,
      active,
      completed,
      failed,
      compressed,
      documents,
      music,
      programs,
      video,
      queues: 1,
    };
  }, [safeDownloads]);

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
    return selectedDownloads.some((d) => d.status === 'paused' || d.status === 'queued' || d.status === 'error');
  }, [selectedDownloads]);

  const canPause = useMemo(() => {
    return selectedDownloads.some((d) => d.status === 'downloading' || d.status === 'probing');
  }, [selectedDownloads]);

  const canDelete = selectedIds.size > 0;
  const hasCompleted = useMemo(() => safeDownloads.some((d) => d.status === 'completed'), [safeDownloads]);

  // Actions
  const handleAddDownload = async (payload: NewDownloadPayload) => {
    const res = await fetch(`${API_BASE}/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to start download' }));
      throw new Error(err.error || 'Failed to start download');
    }
    const data = await res.json();
    fetchDownloads();

    if (data.download) {
      setActiveDownload(data.download);
      setIsStatusDialogOpen(true);
    }
  };

  const handleBatchDownload = async (urls: string[], destinationFolder: string) => {
    for (const url of urls) {
      try {
        await fetch(`${API_BASE}/downloads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            destinationFolder,
            connections: settings.defaultConnections || 32,
          }),
        });
      } catch {}
    }
    fetchDownloads();
  };

  const handlePause = async (id: string) => {
    try {
      await fetch(`${API_BASE}/downloads/${id}/pause`, { method: 'POST' });
      fetchDownloads();
    } catch {}
  };

  const handleResume = async (id: string) => {
    try {
      await fetch(`${API_BASE}/downloads/${id}/resume`, { method: 'POST' });
      fetchDownloads();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`${API_BASE}/downloads/${id}`, { method: 'DELETE' });
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
      if (d.status === 'downloading' || d.status === 'probing') handlePause(d.id);
    });
  };

  const handleResumeSelected = () => {
    selectedDownloads.forEach((d) => {
      if (d.status === 'paused' || d.status === 'queued' || d.status === 'error') handleResume(d.id);
    });
  };

  const handlePauseAll = () => {
    safeDownloads.forEach((d) => {
      if (d.status === 'downloading' || d.status === 'probing') handlePause(d.id);
    });
  };

  const handleDeleteSelected = () => {
    selectedDownloads.forEach((d) => handleDelete(d.id));
  };

  const handleDeleteCompleted = () => {
    safeDownloads.forEach((d) => {
      if (d.status === 'completed') handleDelete(d.id);
    });
  };

  const handleOpenFile = async (idOrPath: string) => {
    try {
      await fetch(`${API_BASE}/downloads/${idOrPath}/open-file`, { method: 'POST' });
    } catch {}
    if ((window as any).electronAPI?.openFile) {
      (window as any).electronAPI.openFile(idOrPath);
    }
  };

  const handleOpenFolder = async (idOrPath?: string) => {
    try {
      if (idOrPath) {
        await fetch(`${API_BASE}/downloads/${idOrPath}/open-folder`, { method: 'POST' });
      }
    } catch {}
    if ((window as any).electronAPI?.openFolder) {
      (window as any).electronAPI.openFolder(idOrPath || defaultFolder);
    }
  };

  const handleDoubleClick = (item: DownloadItem) => {
    if (item.status === 'downloading' || item.status === 'probing' || item.status === 'paused') {
      setActiveDownload(item);
      setIsStatusDialogOpen(true);
    } else if (item.status === 'completed') {
      if (settings.doubleClickAction === 'open_file') {
        handleOpenFile(item.destinationPath);
      } else if (settings.doubleClickAction === 'open_folder') {
        handleOpenFolder(item.destinationPath);
      } else {
        setActiveDownload(item);
        setIsPropertiesOpen(true);
      }
    } else {
      setActiveDownload(item);
      setIsPropertiesOpen(true);
    }
  };

  const handleContextMenu = (download: DownloadItem, e: React.MouseEvent) => {
    e.preventDefault();
    if (!selectedIds.has(download.id)) {
      setSelectedIds(new Set([download.id]));
    }
    setContextMenu({ x: e.clientX, y: e.clientY, download });
  };

  
  const confirmDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setConfirmMsgBox({
      title: 'Nogadex Download Manager',
      type: 'question',
      buttons: 'yes_no',
      message: count === 1
        ? 'Are you sure you want to remove the selected download from the list?'
        : `Are you sure you want to remove all ${count} selected downloads from the list?`,
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
        setIsNewDownloadOpen(true);
      } else if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setIsBatchDownloadOpen(true);
      } else if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        setIsSettingsOpen(true);
      } else if (e.ctrlKey && (e.key === 'q' || e.key === 'Q')) {
        e.preventDefault();
        setIsSchedulerOpen(true);
      } else if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setSelectedIds(new Set(filteredDownloads.map(d => d.id)));
      } else if (e.key === 'Delete') {
        e.preventDefault();
        confirmDeleteSelected();
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (canPause) handlePauseSelected();
        else if (canResume) handleResumeSelected();
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
            defaultDownloadFolder: newSettings.defaultDownloadFolder,
            defaultConnections: newSettings.defaultConnections,
            maxConcurrentDownloads: newSettings.maxConcurrentDownloads,
          },
          general: {
            doubleClickAction: newSettings.doubleClickAction,
          },
        }),
      });
    } catch {}
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#ffffff] overflow-hidden select-none font-sans">
      {/* 1. Window Title Bar */}
      <TitleBar />

      {/* 2. Menu Bar (Tasks, File, Downloads, View, Help) */}
      <MenuBar
        onAddUrl={() => setIsNewDownloadOpen(true)}
        onAddBatch={() => setIsBatchDownloadOpen(true)}
        onOpenSiteGrabber={() => setIsSiteGrabberOpen(true)}
        onOpenOptions={() => setIsSettingsOpen(true)}
        onOpenScheduler={() => setIsSchedulerOpen(true)}
        onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
        onExportHistory={() => setHistoryModalMode('export')}
        onImportHistory={() => setHistoryModalMode('import')}
        onRefresh={fetchDownloads}
        onExit={() => window.close()}
        onAbout={() => setIsAboutOpen(true)}
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

      {/* 3. IDM Large-Icon Command Toolbar */}
      <Toolbar
        onAddUrl={() => setIsNewDownloadOpen(true)}
        onAddBatch={() => setIsBatchDownloadOpen(true)}
        onOpenSiteGrabber={() => setIsSiteGrabberOpen(true)}
        onResumeSelected={handleResumeSelected}
        onPauseSelected={handlePauseSelected}
        onPauseAll={handlePauseAll}
        onDeleteSelected={confirmDeleteSelected}
        onDeleteCompleted={handleDeleteCompleted}
        onOpenOptions={() => setIsSettingsOpen(true)}
        onOpenScheduler={() => setIsSchedulerOpen(true)}
        canResume={canResume}
        canPause={canPause}
        canDelete={canDelete}
        hasCompleted={hasCompleted}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* 4. Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          selectedFilter={filter}
          onSelectFilter={setFilter}
          counts={counts}
        />

        <DownloadTable
          downloads={filteredDownloads}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          onAddUrl={() => setIsNewDownloadOpen(true)}
        />
      </div>

      {/* 5. Multi-Pane Status Bar */}
      <StatusBar
        totalCount={safeDownloads.length}
        filteredCount={filteredDownloads.length}
        selectedCount={selectedIds.size}
        selectedBytes={selectedDownloads.reduce((acc, d) => acc + (d.totalBytes || d.downloadedBytes || 0), 0)}
        activeCount={counts.active}
        completedCount={counts.completed}
        failedCount={counts.failed}
        stats={stats}
        currentCategoryName={filter}
      />

      {/* 6. Modals & Dialogs */}
      <NewDownloadDialog
        isOpen={isNewDownloadOpen}
        onClose={() => setIsNewDownloadOpen(false)}
        onSubmit={handleAddDownload}
        defaultFolder={defaultFolder}
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
      />

      <SchedulerDialog
        isOpen={isSchedulerOpen}
        onClose={() => setIsSchedulerOpen(false)}
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

      <HistoryExportImportDialog
        isOpen={historyModalMode !== null}
        mode={historyModalMode || 'export'}
        onClose={() => setHistoryModalMode(null)}
        onRefreshDownloads={fetchDownloads}
      />

      <AboutDialog
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
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
          onOpenProperties={(dl) => {
            setActiveDownload(dl);
            setIsPropertiesOpen(true);
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
