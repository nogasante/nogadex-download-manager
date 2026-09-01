import React from 'react';
import { 
  Layers, 
  DownloadCloud, 
  CheckCircle2, 
  PauseCircle, 
  FileArchive, 
  FileText, 
  Music, 
  FileCode, 
  Video, 
  HardDrive,
  Cpu
} from 'lucide-react';
import { DownloadItem } from '../types/download';

interface FluentSidebarProps {
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  downloads: DownloadItem[];
  defaultPath: string;
}

export const FluentSidebar: React.FC<FluentSidebarProps> = ({
  selectedCategory,
  onSelectCategory,
  downloads,
  defaultPath,
}) => {
  const counts = {
    all: downloads.length,
    active: downloads.filter(d => d.status === 'downloading' || d.status === 'probing').length,
    completed: downloads.filter(d => d.status === 'completed').length,
    paused: downloads.filter(d => d.status === 'paused').length,
    compressed: downloads.filter(d => d.category === 'compressed').length,
    document: downloads.filter(d => d.category === 'document').length,
    audio: downloads.filter(d => d.category === 'audio').length,
    program: downloads.filter(d => d.category === 'program').length,
    video: downloads.filter(d => d.category === 'video').length,
  };

  const statusFilters = [
    { id: 'all', label: 'All Downloads', icon: Layers, count: counts.all },
    { id: 'active', label: 'Downloading', icon: DownloadCloud, count: counts.active },
    { id: 'finished', label: 'Finished', icon: CheckCircle2, count: counts.completed },
    { id: 'paused', label: 'Paused', icon: PauseCircle, count: counts.paused },
  ];

  const categoryFilters = [
    { id: 'cat_compressed', label: 'Compressed', icon: FileArchive, count: counts.compressed },
    { id: 'cat_document', label: 'Documents', icon: FileText, count: counts.document },
    { id: 'cat_audio', label: 'Music & Audio', icon: Music, count: counts.audio },
    { id: 'cat_program', label: 'Programs (Exe)', icon: FileCode, count: counts.program },
    { id: 'cat_video', label: 'Videos & Movies', icon: Video, count: counts.video },
  ];

  return (
    <aside className="w-60 border-r border-[#222226] bg-[#0c0c0e] p-3.5 select-none flex flex-col justify-between overflow-y-auto">
      <div className="space-y-6">
        {/* Status Views */}
        <div className="space-y-1">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500 px-2.5 mb-2">
            Status
          </div>
          {statusFilters.map(item => {
            const Icon = item.icon;
            const isSelected = selectedCategory === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectCategory(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isSelected
                    ? 'bg-[#d8c8b4] text-black font-bold shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-[#18181c]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isSelected ? 'text-black' : 'text-zinc-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.count > 0 && (
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                    isSelected ? 'bg-black/20 text-black' : 'bg-[#1c1c22] text-zinc-400'
                  }`}>
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Categories */}
        <div className="space-y-1">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500 px-2.5 mb-2">
            Categories
          </div>
          {categoryFilters.map(item => {
            const Icon = item.icon;
            const isSelected = selectedCategory === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectCategory(item.id)}
                className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-all ${
                  isSelected
                    ? 'bg-[#222228] text-[#d8c8b4] font-medium border border-[#33333d]'
                    : 'text-zinc-400 hover:text-white hover:bg-[#18181c]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-3.5 h-3.5 text-zinc-500" />
                  <span>{item.label}</span>
                </div>
                {item.count > 0 && (
                  <span className="text-[10px] font-mono text-zinc-500">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Storage Disk Path Info */}
      <div className="p-3 rounded-xl bg-[#141417] border border-[#222226] space-y-2 text-[11px] font-mono">
        <div className="flex items-center justify-between text-zinc-400">
          <div className="flex items-center gap-1.5 text-[#d8c8b4] font-bold text-[10px] uppercase">
            <Cpu className="w-3.5 h-3.5" />
            <span>Engine</span>
          </div>
          <span className="text-[9px] text-[#d8c8b4] bg-[#24211c] px-1.5 py-0.5 rounded border border-[#d8c8b4]/30 font-bold">
            Zero-Copy
          </span>
        </div>
        <div className="text-[10px] text-zinc-400 truncate" title={defaultPath}>
          <span className="text-zinc-500 block text-[9px] uppercase">Save Location:</span>
          {defaultPath || 'Downloads/HyperDownloader'}
        </div>
      </div>
    </aside>
  );
};
