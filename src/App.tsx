import React, { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Header } from './components/Header';
import { DownloadRow } from './components/DownloadRow';
import { NewDownloadModal } from './components/NewDownloadModal';
import { ActiveDownloadModal } from './components/ActiveDownloadModal';
import { DownloadItem, EngineStats, NewDownloadPayload } from './types/download';
import { DownloadCloud } from 'lucide-react';

export const App: React.FC = () => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeModalId, setActiveModalId] = useState<string | null>(null);
  const [defaultPath, setDefaultPath] = useState('');
  const [stats, setStats] = useState<EngineStats>({
    totalSpeedBps: 0,
    activeDownloadsCount: 0,
    completedCount: 0,
    queuedCount: 0,
    speedHistory: new Array(30).fill(0),
  });

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: NodeJS.Timeout;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname === 'localhost' ? 'localhost:5005' : window.location.host;
      ws = new WebSocket(`${protocol}//${host}/ws`);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'STATE_UPDATE') {
            setDownloads(data.downloads || []);
            if (data.stats) setStats(data.stats);
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 2000);
      };
    };

    connect();

    fetch('http://localhost:5005/api/downloads')
      .then(res => res.json())
      .then(data => {
        if (data.downloads) setDownloads(data.downloads);
        if (data.defaultPath) setDefaultPath(data.defaultPath);
      })
      .catch(() => {});

    // Drag and drop support
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      const text = e.dataTransfer?.getData('text');
      if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
        handleStartNew({ url: text.trim() });
      }
    };
    const handleDragOver = (e: DragEvent) => e.preventDefault();

    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragover', handleDragOver);

    // Ctrl+N shortcut
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setIsAddModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimer);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleResumeAll = async () => {
    const targets = downloads.filter(d => d.status === 'paused' || d.status === 'error').map(d => d.id);
    for (const id of targets) {
      await fetch(`http://localhost:5005/api/downloads/${id}/resume`, { method: 'POST' });
    }
  };

  const handlePauseAll = async () => {
    const targets = downloads.filter(d => d.status === 'downloading').map(d => d.id);
    for (const id of targets) {
      await fetch(`http://localhost:5005/api/downloads/${id}/pause`, { method: 'POST' });
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`http://localhost:5005/api/downloads/${id}`, { method: 'DELETE' });
    if (activeModalId === id) setActiveModalId(null);
  };

  const handleOpenFile = async (filePath: string) => {
    await fetch('http://localhost:5005/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
  };

  const handleOpenFolder = async (filePath?: string) => {
    await fetch('http://localhost:5005/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
  };

  const handleStartNew = async (payload: NewDownloadPayload) => {
    const res = await fetch('http://localhost:5005/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const item = await res.json();
    if (item && item.id) {
      setActiveModalId(item.id); // Automatically pop open the iconic IDM Download Progress Window!
    }
  };

  const activeModalItem = downloads.find(d => d.id === activeModalId) || null;

  const counts = {
    all: downloads.length,
    active: downloads.filter(d => d.status === 'downloading' || d.status === 'probing').length,
    completed: downloads.filter(d => d.status === 'completed').length,
    paused: downloads.filter(d => d.status === 'paused').length,
  };

  // Filter downloads
  const filteredDownloads = downloads.filter(item => {
    if (searchQuery && !item.filename.toLowerCase().includes(searchQuery.toLowerCase()) && !item.url.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    if (selectedFilter === 'all') return true;
    if (selectedFilter === 'active') return item.status === 'downloading' || item.status === 'probing';
    if (selectedFilter === 'completed') return item.status === 'completed';
    if (selectedFilter === 'paused') return item.status === 'paused';
    return true;
  });

  return (
    <div className="w-screen h-screen flex flex-col bg-[#09090b] text-white font-sans overflow-hidden">
      {/* Native Desktop Window TitleBar */}
      <TitleBar />
      {/* Clean Linear Header */}
      <Header
        onAddUrl={() => setIsAddModalOpen(true)}
        onResumeAll={handleResumeAll}
        onPauseAll={handlePauseAll}
        onOpenFolder={() => handleOpenFolder()}
        onSearchChange={setSearchQuery}
        selectedFilter={selectedFilter}
        onSelectFilter={setSelectedFilter}
        stats={stats}
        counts={counts}
      />

      {/* Main Content List */}
      <main className="flex-1 overflow-y-auto p-6 max-w-5xl w-full mx-auto space-y-3">
        {filteredDownloads.length === 0 ? (
          <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center p-8 border border-dashed border-[#27272a] rounded-2xl bg-[#0e0e11]/40 space-y-4">
            <div className="w-12 h-12 rounded-xl bg-[#18181c] border border-[#27272a] flex items-center justify-center text-[#d8c8b4]">
              <DownloadCloud className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">No downloads found</h3>
              <p className="text-xs text-zinc-500 mt-1 max-w-sm font-mono">
                Paste any link, drag a URL into this window, or press Ctrl+N to begin.
              </p>
            </div>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-[#d8c8b4] hover:bg-[#e8ded0] text-black font-semibold text-xs shadow-sm active:scale-95 transition-all"
            >
              Add Download
            </button>
          </div>
        ) : (
          filteredDownloads.map(item => (
            <div 
              key={item.id} 
              onDoubleClick={() => setActiveModalId(item.id)}
              className="cursor-pointer"
            >
              <DownloadRow
                item={item}
                onPause={(id) => fetch(`http://localhost:5005/api/downloads/${id}/pause`, { method: 'POST' })}
                onResume={(id) => fetch(`http://localhost:5005/api/downloads/${id}/resume`, { method: 'POST' })}
                onDelete={handleDelete}
                onOpenFile={handleOpenFile}
                onOpenFolder={handleOpenFolder}
              />
            </div>
          ))
        )}
      </main>

      {/* Add New Download Dialog */}
      <NewDownloadModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleStartNew}
        defaultFolder={defaultPath}
      />

      {/* Iconic IDM Single Download Progress Window */}
      <ActiveDownloadModal
        item={activeModalItem}
        onClose={() => setActiveModalId(null)}
        onPause={(id) => fetch(`http://localhost:5005/api/downloads/${id}/pause`, { method: 'POST' })}
        onResume={(id) => fetch(`http://localhost:5005/api/downloads/${id}/resume`, { method: 'POST' })}
        onCancel={handleDelete}
        onOpenFile={handleOpenFile}
        onOpenFolder={handleOpenFolder}
      />
    </div>
  );
};
