import React, { useState } from 'react';
import { 
  Semi3DFolder, 
  Semi3DZip, 
  Semi3DDocument, 
  Semi3DMusic, 
  Semi3DProgram, 
  Semi3DVideo,
  Semi3DUnfinished,
  Semi3DFinished,
  Semi3DQueues
} from './CategoryIcons3D';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface SidebarProps {
  selectedFilter: string;
  onSelectFilter: (filter: string) => void;
  counts?: {
    all: number;
    active?: number;
    paused?: number;
    completed: number;
    failed?: number;
    compressed?: number;
    documents?: number;
    music?: number;
    programs?: number;
    video?: number;
    unfinished?: number;
    [key: string]: any;
  };
}

export const Sidebar: React.FC<SidebarProps> = ({
  selectedFilter,
  onSelectFilter,
}) => {
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(true);

  return (
    <div 
      role="navigation" 
      aria-label="Category Tree"
      className="w-52 bg-[#f8fafc] border-r border-[#e2e8f0] flex flex-col justify-between select-none text-[12.5px] font-sans h-full shrink-0"
    >
      <div className="p-2 space-y-1 overflow-y-auto">
        {/* Top Categories Parent Item */}
        <div>
          <button
            type="button"
            onClick={() => onSelectFilter('all')}
            className={`w-full flex items-center px-2 py-1.5 rounded-md transition-all ${
              selectedFilter === 'all'
                ? 'bg-[#cde8ff] text-[#005a9e] font-semibold border border-[#70baff] shadow-xs'
                : 'text-[#1e293b] hover:bg-[#e2e8f0]/60 border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCategoriesOpen(!isCategoriesOpen);
                }}
                className="cursor-pointer p-0.5"
              >
                {isCategoriesOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 opacity-80" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 opacity-80" />
                )}
              </span>
              <Semi3DFolder className="w-4 h-4 shrink-0" isOpen={isCategoriesOpen} />
              <span className="truncate">All Downloads</span>
            </div>
          </button>

          {/* Sub-categories */}
          {isCategoriesOpen && (
            <div className="pl-6 pt-1 space-y-0.5">
              {/* Compressed */}
              <button
                type="button"
                onClick={() => onSelectFilter('compressed')}
                className={`w-full flex items-center px-2 py-1 rounded-md transition-colors ${
                  selectedFilter === 'compressed'
                    ? 'bg-[#cde8ff] text-[#005a9e] font-semibold border border-[#70baff] shadow-xs'
                    : 'text-[#334155] hover:bg-[#e2e8f0]/60'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Semi3DZip className="w-4 h-4 shrink-0" />
                  <span className="truncate">Compressed</span>
                </div>
              </button>

              {/* Documents */}
              <button
                type="button"
                onClick={() => onSelectFilter('documents')}
                className={`w-full flex items-center px-2 py-1 rounded-md transition-colors ${
                  selectedFilter === 'documents'
                    ? 'bg-[#cde8ff] text-[#005a9e] font-semibold border border-[#70baff] shadow-xs'
                    : 'text-[#334155] hover:bg-[#e2e8f0]/60'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Semi3DDocument className="w-4 h-4 shrink-0" />
                  <span className="truncate">Documents</span>
                </div>
              </button>

              {/* Music */}
              <button
                type="button"
                onClick={() => onSelectFilter('music')}
                className={`w-full flex items-center px-2 py-1 rounded-md transition-colors ${
                  selectedFilter === 'music'
                    ? 'bg-[#cde8ff] text-[#005a9e] font-semibold border border-[#70baff] shadow-xs'
                    : 'text-[#334155] hover:bg-[#e2e8f0]/60'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Semi3DMusic className="w-4 h-4 shrink-0" />
                  <span className="truncate">Music</span>
                </div>
              </button>

              {/* Programs */}
              <button
                type="button"
                onClick={() => onSelectFilter('programs')}
                className={`w-full flex items-center px-2 py-1 rounded-md transition-colors ${
                  selectedFilter === 'programs'
                    ? 'bg-[#cde8ff] text-[#005a9e] font-semibold border border-[#70baff] shadow-xs'
                    : 'text-[#334155] hover:bg-[#e2e8f0]/60'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Semi3DProgram className="w-4 h-4 shrink-0" />
                  <span className="truncate">Programs</span>
                </div>
              </button>

              {/* Video */}
              <button
                type="button"
                onClick={() => onSelectFilter('video')}
                className={`w-full flex items-center px-2 py-1 rounded-md transition-colors ${
                  selectedFilter === 'video'
                    ? 'bg-[#cde8ff] text-[#005a9e] font-semibold border border-[#70baff] shadow-xs'
                    : 'text-[#334155] hover:bg-[#e2e8f0]/60'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Semi3DVideo className="w-4 h-4 shrink-0" />
                  <span className="truncate">Video</span>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Unfinished */}
        <div className="pt-2 border-t border-[#e2e8f0]/70">
          <button
            type="button"
            onClick={() => onSelectFilter('unfinished')}
            className={`w-full flex items-center px-2 py-1.5 rounded-md transition-colors ${
              selectedFilter === 'unfinished'
                ? 'bg-[#cde8ff] text-[#005a9e] font-semibold border border-[#70baff] shadow-xs'
                : 'text-[#334155] hover:bg-[#e2e8f0]/60'
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <Semi3DUnfinished className="w-4 h-4 shrink-0" />
              <span className="truncate">Unfinished</span>
            </div>
          </button>
        </div>

        {/* Finished */}
        <div>
          <button
            type="button"
            onClick={() => onSelectFilter('finished')}
            className={`w-full flex items-center px-2 py-1.5 rounded-md transition-colors ${
              selectedFilter === 'finished'
                ? 'bg-[#cde8ff] text-[#005a9e] font-semibold border border-[#70baff] shadow-xs'
                : 'text-[#334155] hover:bg-[#e2e8f0]/60'
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <Semi3DFinished className="w-4 h-4 shrink-0" />
              <span className="truncate">Finished</span>
            </div>
          </button>
        </div>

        {/* Queues */}
        <div className="pt-2 border-t border-[#e2e8f0]/70">
          <button
            type="button"
            onClick={() => onSelectFilter('queues')}
            className={`w-full flex items-center px-2 py-1.5 rounded-md transition-colors ${
              selectedFilter === 'queues'
                ? 'bg-[#cde8ff] text-[#005a9e] font-semibold border border-[#70baff] shadow-xs'
                : 'text-[#334155] hover:bg-[#e2e8f0]/60'
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <Semi3DQueues className="w-4 h-4 shrink-0" />
              <span className="truncate">Queues</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
