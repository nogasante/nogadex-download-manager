import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { CategorySidebar } from './components/CategorySidebar';
import { DownloadCard } from './components/DownloadCard';
import { SpeedGraph } from './components/SpeedGraph';
import { NewDownloadModal } from './components/NewDownloadModal';
import { DownloadItem, EngineStats, NewDownloadPayload } from './types/download';
import { DownloadCloud, ArrowUpDown, Search, Zap } from 'lucide-react';

export const App: React.FC = () => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [stats, setStats] = useState<EngineStats>({
    totalSpeedBps: 0,
    activeDownloadsCount: 0,
    completedCount: 0,
    queuedCount: 0,
    speedHistory: new Array(30).fill(0),
  });
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [defaultPath, setDefaultPath] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  // WebSocket Live Real-Time Connection
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: NodeJS.Timeout;

    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname === 'localhost' ? 'localhost:5005' : window.location.host;
      const wsUrl = `${protocol}//${host}/ws`;

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setIsConnected(true);
      };

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
        setIsConnected(false);
        reconnectTimer = setTimeout(connectWebSocket, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectWebSocket();

    // Initial REST fetch
    fetch('http://localhost:5005/api/downloads')
      .then(res => res.json())
      .then(data => {
        if (data.downloads) setDownloads(data.downloads);
        if (data.defaultPath) setDefaultPath(data.defaultPath);
      })
      .catch(() => {});

    // Keyboard shortcut: Ctrl+N for new download
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setIsNewModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleStartNewDownload = async (payload: NewDownloadPayload) => {
    try {
      await fetch('http://localhost:5005/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error('Failed to start download:', e);
    }
  };

  const handlePause = async (id: string) => {
    await fetch(`http://localhost:5005/api/downloads/${id}/pause`, { method: 'POST' });
  };

  const handleResume = async (id: string) => {
    await fetch(`http://localhost:5005/api/downloads/${id}/resume`, { method: 'POST' });
  };

  const handleRemove = async (id: string, deleteFile: boolean) => {
    await fetch(`http://localhost:5005/api/downloads/${id}?deleteFile=${deleteFile}`, { method: 'DELETE' });
  };

  const handleOpenFolder = async (filePath?: string) => {
    await fetch('http://localhost:5005/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
  };

  const handleOpenFile = async (filePath: string) => {
    await fetch('http://localhost:5005/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
  };

  // Filter downloads by category / status and search query
  const filteredDownloads = downloads.filter(item => {
    // Search match
    if (searchQuery && !item.filename.toLowerCase().includes(searchQuery.toLowerCase()) && !item.url.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    // Status / Category match
    if (selectedFilter === 'all') return true;
    if (selectedFilter === 'active') return item.status === 'downloading' || item.status === 'probing';
    if (selectedFilter === 'completed') return item.status === 'completed';
    if (selectedFilter === 'paused') return item.status === 'paused';
    if (selectedFilter.startsWith('cat_')) {
      const cat = selectedFilter.replace('cat_', '');
      return item.category === cat;
    }
    return true;
  });

  return (
    <div className="h-screen flex flex-col bg-[#080c14] text-slate-100 font-sans overflow-hidden">
      {/* Top Navbar */}
      <Navbar
        stats={stats}
        onOpenNewModal={() => setIsNewModalOpen(true)}
        onOpenFolder={() => handleOpenFolder()}
      />

      {/* Main App Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Category Sidebar */}
        <CategorySidebar
          selectedFilter={selectedFilter}
          onSelectFilter={setSelectedFilter}
          downloads={downloads}
          defaultPath={defaultPath}
        />

        {/* Center Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden bg-slate-950/40 p-6 space-y-5">
          {/* Top Bar: Live Throughput Graph & Search Filter */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <SpeedGraph history={stats.speedHistory} currentBps={stats.totalSpeedBps} />

            {/* Search Input */}
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search active & finished tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 focus:border-cyan-500 text-xs font-mono text-slate-200 placeholder-slate-500 outline-none transition-colors"
              />
            </div>
          </div>

          {/* Downloads List */}
          <div className="flex-1 overflow-y-auto pr-2 space-y-3">
            {filteredDownloads.length === 0 ? (
              <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-800/80 rounded-3xl bg-slate-900/20">
                <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4">
                  <DownloadCloud className="w-8 h-8 text-cyan-400" />
                </div>
                <h3 className="text-base font-bold text-slate-200">No Downloads in this category</h3>
                <p className="text-xs text-slate-400 font-mono mt-1 max-w-sm">
                  Paste any direct URL or click New Download to experience 64-thread accelerated downloading.
                </p>
                <button
                  onClick={() => setIsNewModalOpen(true)}
                  className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 transition-all active:scale-95 glow-cyan"
                >
                  <Zap className="w-4 h-4 fill-slate-950" />
                  Add Download Now
                </button>
              </div>
            ) : (
              filteredDownloads.map(item => (
                <DownloadCard
                  key={item.id}
                  item={item}
                  onPause={handlePause}
                  onResume={handleResume}
                  onRemove={handleRemove}
                  onOpenFolder={handleOpenFolder}
                  onOpenFile={handleOpenFile}
                />
              ))
            )}
          </div>
        </main>
      </div>

      {/* New Download Modal */}
      <NewDownloadModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onSubmit={handleStartNewDownload}
        defaultFolder={defaultPath}
      />
    </div>
  );
};
