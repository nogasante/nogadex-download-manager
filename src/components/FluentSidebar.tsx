import React, { useState } from 'react';
import { 
  Download, 
  FileArchive, 
  FileText, 
  Music, 
  FileCode, 
  Video, 
  ChevronDown, 
  ChevronRight,
  StopCircle,
  CheckSquare,
  ListOrdered,
  FolderGit2
} from 'lucide-react';
import { DownloadItem } from '../types/download';

interface FluentSidebarProps {
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  downloads: DownloadItem[];
}

export const FluentSidebar: React.FC<FluentSidebarProps> = ({
  selectedCategory,
  onSelectCategory,
  downloads,
}) => {
  const [allExpanded, setAllExpanded] = useState(true);

  const subCategories = [
    { id: 'cat_compressed', label: 'Compressed', icon: FileArchive },
    { id: 'cat_document', label: 'Documents', icon: FileText },
    { id: 'cat_audio', label: 'Music', icon: Music },
    { id: 'cat_program', label: 'Programs', icon: FileCode },
    { id: 'cat_video', label: 'Videos', icon: Video },
  ];

  return (
    <aside className="w-52 border-r border-[#282e42] bg-[#161926] p-3 select-none flex flex-col justify-between overflow-y-auto">
      <div className="space-y-4">
        {/* Categories Header */}
        <div className="text-[11px] text-slate-500 font-semibold px-2">
          Categories
        </div>

        {/* All Downloads Group */}
        <div className="space-y-0.5">
          <div
            onClick={() => onSelectCategory('all')}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
              selectedCategory === 'all'
                ? 'bg-blue-600/25 text-blue-300 font-medium'
                : 'text-slate-300 hover:bg-[#202538]'
            }`}
          >
            <div className="flex items-center gap-2">
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>All Downloads</span>
            </div>
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

          {/* Sub Categories indented */}
          {allExpanded && (
            <div className="pl-6 space-y-0.5 mt-0.5">
              {subCategories.map((sub) => {
                const Icon = sub.icon;
                const isSelected = selectedCategory === sub.id;
                return (
                  <div
                    key={sub.id}
                    onClick={() => onSelectCategory(sub.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-600/25 text-blue-300 font-medium'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-[#202538]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 text-slate-400" />
                    <span>{sub.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Unfinished */}
        <div className="space-y-0.5">
          <div
            onClick={() => onSelectCategory('unfinished')}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
              selectedCategory === 'unfinished'
                ? 'bg-blue-600/25 text-blue-300 font-medium'
                : 'text-slate-300 hover:bg-[#202538]'
            }`}
          >
            <div className="flex items-center gap-2">
              <StopCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>Unfinished</span>
            </div>
            <ChevronDown className="w-3 h-3 text-slate-500" />
          </div>
        </div>

        {/* Finished */}
        <div className="space-y-0.5">
          <div
            onClick={() => onSelectCategory('finished')}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
              selectedCategory === 'finished'
                ? 'bg-blue-600/25 text-blue-300 font-medium'
                : 'text-slate-300 hover:bg-[#202538]'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
              <span>Finished</span>
            </div>
            <ChevronDown className="w-3 h-3 text-slate-500" />
          </div>
        </div>

        {/* Queues */}
        <div className="space-y-0.5">
          <div
            onClick={() => onSelectCategory('queues')}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
              selectedCategory === 'queues'
                ? 'bg-blue-600/25 text-blue-300 font-medium'
                : 'text-slate-300 hover:bg-[#202538]'
            }`}
          >
            <div className="flex items-center gap-2">
              <ListOrdered className="w-3.5 h-3.5 text-purple-400" />
              <span>Queues</span>
            </div>
            <ChevronDown className="w-3 h-3 text-slate-500" />
          </div>
        </div>

        {/* Grabber Projects */}
        <div
          onClick={() => onSelectCategory('grabber')}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
            selectedCategory === 'grabber'
              ? 'bg-blue-600/25 text-blue-300 font-medium'
              : 'text-slate-300 hover:bg-[#202538]'
          }`}
        >
          <FolderGit2 className="w-3.5 h-3.5 text-teal-400" />
          <span>Grabber Projects</span>
        </div>
      </div>
    </aside>
  );
};
