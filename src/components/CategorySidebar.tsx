import React from 'react';
import { 
  DownloadCloud, 
  CheckCircle2, 
  PauseCircle, 
  Video, 
  Music, 
  FileArchive, 
  FileCode, 
  FileText, 
  Layers,
  HardDrive
} from 'lucide-react';
import { DownloadItem } from '../types/download';

interface CategorySidebarProps {
  selectedFilter: string;
  onSelectFilter: (filter: string) => void;
  downloads: DownloadItem[];
  defaultPath: string;
}

export const CategorySidebar: React.FC<CategorySidebarProps> = ({
  selectedFilter,
  onSelectFilter,
  downloads,
  defaultPath,
}) => {
  const counts = {
    all: downloads.length,
    active: downloads.filter(d => d.status === 'downloading' || d.status === 'probing').length,
    completed: downloads.filter(d => d.status === 'completed').length,
    paused: downloads.filter(d => d.status === 'paused').length,
    video: downloads.filter(d => d.category === 'video').length,
    audio: downloads.filter(d => d.category === 'audio').length,
    compressed: downloads.filter(d => d.category === 'compressed').length,
    program: downloads.filter(d => d.category === 'program').length,
    document: downloads.filter(d => d.category === 'document').length,
  };

  const menuItems = [
    { id: 'all', label: 'All Tasks', icon: Layers, count: counts.all },
    { id: 'active', label: 'Downloading', icon: DownloadCloud, count: counts.active, activeColor: 'text-cyan-400' },
    { id: 'completed', label: 'Completed', icon: CheckCircle2, count: counts.completed, activeColor: 'text-emerald-400' },
    { id: 'paused', label: 'Paused', icon: PauseCircle, count: counts.paused },
  ];

  const categoryItems = [
    { id: 'cat_video', label: 'Videos', icon: Video, count: counts.video, cat: 'video' },
    { id: 'cat_audio', label: 'Audio / Music', icon: Music, count: counts.audio, cat: 'audio' },
    { id: 'cat_compressed', label: 'Archives (Zip/ISO)', icon: FileArchive, count: counts.compressed, cat: 'compressed' },
    { id: 'cat_program', label: 'Programs (Exe)', icon: FileCode, count: counts.program, cat: 'program' },
    { id: 'cat_document', label: 'Documents', icon: FileText, count: counts.document, cat: 'document' },
  ];

  return (
    <aside className="w-64 border-r border-slate-800/80 bg-slate-950/60 p-4 flex flex-col justify-between select-none">
      <div className="space-y-6">
        {/* Status Filters */}
        <div className="space-y-1">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 px-3 mb-2">
            Status
          </div>
          {menuItems.map(item => {
            const Icon = item.icon;
            const isSelected = selectedFilter === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectFilter(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
                  isSelected
                    ? 'bg-gradient-to-r from-cyan-500/15 to-emerald-500/15 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isSelected ? 'text-cyan-400' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </div>
                {item.count > 0 && (
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                    isSelected ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-900 text-slate-500'
                  }`}>
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Category Filters */}
        <div className="space-y-1">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 px-3 mb-2">
            Categories
          </div>
          {categoryItems.map(item => {
            const Icon = item.icon;
            const isSelected = selectedFilter === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectFilter(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 ${
                  isSelected
                    ? 'bg-slate-900 text-cyan-300 border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isSelected ? 'text-cyan-400' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </div>
                {item.count > 0 && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 text-slate-500">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Storage Disk Path Info */}
      <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] space-y-1.5 font-mono">
        <div className="flex items-center gap-2 text-slate-400">
          <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[10px] uppercase font-bold tracking-wider">Save Path</span>
        </div>
        <p className="text-[10px] text-slate-400 truncate" title={defaultPath}>
          {defaultPath || 'Downloads/HyperDownloader'}
        </p>
      </div>
    </aside>
  );
};
