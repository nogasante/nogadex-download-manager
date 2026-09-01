import React, { useState } from 'react';
import { 
  DownloadCloud, 
  FileArchive, 
  FileText, 
  Music, 
  FileCode, 
  Video, 
  ChevronDown, 
  ChevronRight,
  PauseCircle,
  CheckCircle2,
  HardDrive
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
  const [allExpanded, setAllExpanded] = useState(true);

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

  const subCategories = [
    { id: 'cat_compressed', label: 'Compressed', icon: FileArchive, count: counts.compressed },
    { id: 'cat_document', label: 'Documents', icon: FileText, count: counts.document },
    { id: 'cat_audio', label: 'Music & Audio', icon: Music, count: counts.audio },
    { id: 'cat_program', label: 'Programs (Exe)', icon: FileCode, count: counts.program },
    { id: 'cat_video', label: 'Videos & Movies', icon: Video, count: counts.video },
  ];

  return (
    <aside className="w-56 border-r border-[#282e42] bg-[#161926] p-3 select-none flex flex-col justify-between overflow-y-auto">
      <div className="space-y-4">
        <div className="text-[11px] text-slate-500 font-semibold px-2">
          Categories
        </div>

        {/* All Downloads Group */}
        <div className="space-y-0.5">
          <div
            onClick={() => onSelectCategory('all')}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
              selectedCategory === 'all'
                ? 'bg-cyan-600/25 text-cyan-300 font-semibold'
                : 'text-slate-300 hover:bg-[#202538]'
            }`}
          >
            <div className="flex items-center gap-2">
              <DownloadCloud className="w-3.5 h-3.5 text-cyan-400" />
              <span>All Downloads</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono text-slate-500">{counts.all}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setAllExpanded(!allExpanded);
                }}
                className="p-0.5 text-slate-500 hover:text-slate-300"
              >
                {allExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {/* Sub Categories indented */}
          {allExpanded && (
            <div className="pl-5 space-y-0.5 mt-0.5">
              {subCategories.map((sub) => {
                const Icon = sub.icon;
                const isSelected = selectedCategory === sub.id;
                return (
                  <div
                    key={sub.id}
                    onClick={() => onSelectCategory(sub.id)}
                    className={`w-full flex items-center justify-between px-2 py-1 rounded-md text-xs cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-cyan-600/20 text-cyan-300 font-medium'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-[#202538]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5 text-slate-400" />
                      <span>{sub.label}</span>
                    </div>
                    {sub.count > 0 && (
                      <span className="text-[10px] font-mono text-slate-500">{sub.count}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Downloading / Active */}
        <div
          onClick={() => onSelectCategory('active')}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
            selectedCategory === 'active'
              ? 'bg-cyan-600/25 text-cyan-300 font-semibold'
              : 'text-slate-300 hover:bg-[#202538]'
          }`}
        >
          <div className="flex items-center gap-2">
            <DownloadCloud className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span>Downloading</span>
          </div>
          <span className="text-[10px] font-mono text-cyan-400 font-bold">{counts.active}</span>
        </div>

        {/* Finished / Complete */}
        <div
          onClick={() => onSelectCategory('finished')}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
            selectedCategory === 'finished'
              ? 'bg-emerald-600/25 text-emerald-300 font-semibold'
              : 'text-slate-300 hover:bg-[#202538]'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Finished</span>
          </div>
          <span className="text-[10px] font-mono text-slate-500">{counts.completed}</span>
        </div>

        {/* Paused */}
        <div
          onClick={() => onSelectCategory('paused')}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
            selectedCategory === 'paused'
              ? 'bg-amber-600/25 text-amber-300 font-semibold'
              : 'text-slate-300 hover:bg-[#202538]'
          }`}
        >
          <div className="flex items-center gap-2">
            <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>Paused</span>
          </div>
          <span className="text-[10px] font-mono text-slate-500">{counts.paused}</span>
        </div>
      </div>

      {/* Save Folder Footprint */}
      <div className="p-2.5 rounded-lg bg-[#11141e] border border-[#252b3d] text-[10px] space-y-1 font-mono text-slate-400">
        <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
          <HardDrive className="w-3 h-3" />
          <span>SAVE LOCATION</span>
        </div>
        <p className="truncate text-slate-400 text-[10px]" title={defaultPath}>
          {defaultPath || 'Downloads/HyperDownloader'}
        </p>
      </div>
    </aside>
  );
};
