import React, { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { FluentToolbar } from './components/FluentToolbar';
import { FluentSidebar } from './components/FluentSidebar';
import { FluentDataTable } from './components/FluentDataTable';
import { NewDownloadModal } from './components/NewDownloadModal';
import { DownloadItem, NewDownloadPayload } from './types/download';

export const App: React.FC = () => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [defaultPath, setDefaultPath] = useState('');

  // WebSocket Live Synchronization
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
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleToggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.length === filteredDownloads.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredDownloads.map(d => d.id));
    }
  };

  const handleResumeSelected = async () => {
    for (const id of selectedIds) {
      await fetch(`http://localhost:5005/api/downloads/${id}/resume`, { method: 'POST' });
    }
  };

  const handleStopSelected = async () => {
    for (const id of selectedIds) {
      await fetch(`http://localhost:5005/api/downloads/${id}/pause`, { method: 'POST' });
    }
  };

  const handleDeleteSelected = async () => {
    for (const id of selectedIds) {
      await fetch(`http://localhost:5005/api/downloads/${id}`, { method: 'DELETE' });
    }
    setSelectedIds([]);
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
    await fetch('http://localhost:5005/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  // Filter downloads
  const filteredDownloads = downloads.filter(item => {
    if (searchQuery && !item.filename.toLowerCase().includes(searchQuery.toLowerCase()) && !item.url.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    if (selectedCategory === 'all') return true;
    if (selectedCategory === 'unfinished') return item.status !== 'completed';
    if (selectedCategory === 'finished') return item.status === 'completed';
    if (selectedCategory.startsWith('cat_')) {
      const cat = selectedCategory.replace('cat_', '');
      return item.category === cat;
    }
    return true;
  });

  return (
    <div className="w-screen h-screen flex items-center justify-center p-3 sm:p-6 bg-[#0f121a] overflow-hidden">
      {/* Centered Solid Fluent Window matching screenshot */}
      <div className="w-full max-w-6xl h-[90vh] fluent-window rounded-xl flex flex-col overflow-hidden">
        {/* Title Bar */}
        <TitleBar />

        {/* Toolbar */}
        <FluentToolbar
          onAddUrl={() => setIsAddModalOpen(true)}
          onResumeSelected={handleResumeSelected}
          onStopSelected={handleStopSelected}
          onDeleteSelected={handleDeleteSelected}
          onSearchChange={setSearchQuery}
          selectedCount={selectedIds.length}
        />

        {/* Main Body */}
        <div className="flex flex-1 overflow-hidden">
          <FluentSidebar
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            downloads={downloads}
          />

          <FluentDataTable
            downloads={filteredDownloads}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onPause={(id) => fetch(`http://localhost:5005/api/downloads/${id}/pause`, { method: 'POST' })}
            onResume={(id) => fetch(`http://localhost:5005/api/downloads/${id}/resume`, { method: 'POST' })}
            onDelete={(id) => fetch(`http://localhost:5005/api/downloads/${id}`, { method: 'DELETE' })}
            onOpenFile={handleOpenFile}
            onOpenFolder={handleOpenFolder}
          />
        </div>
      </div>

      {/* New Download Modal */}
      <NewDownloadModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleStartNew}
        defaultFolder={defaultPath}
      />
    </div>
  );
};
