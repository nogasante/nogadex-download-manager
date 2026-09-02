import React from 'react';
import { 
  Icon3DAdd,
  Icon3DResume,
  Icon3DStop,
  Icon3DStopAll,
  Icon3DDelete,
  Icon3DDeleteCompleted,
  Icon3DOptions,
  Icon3DScheduler,
  Icon3DBatch,
  Icon3DGrabber
} from './Icons3D';
import { Search } from 'lucide-react';

interface ToolbarProps {
  onAddUrl: () => void;
  onAddBatch: () => void;
  onOpenSiteGrabber?: () => void;
  onResumeSelected: () => void;
  onPauseSelected: () => void;
  onPauseAll: () => void;
  onDeleteSelected: () => void;
  onDeleteCompleted: () => void;
  onOpenOptions: () => void;
  onOpenScheduler: () => void;
  canResume: boolean;
  canPause: boolean;
  canDelete: boolean;
  hasCompleted: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  onAddUrl,
  onAddBatch,
  onOpenSiteGrabber,
  onResumeSelected,
  onPauseSelected,
  onPauseAll,
  onDeleteSelected,
  onDeleteCompleted,
  onOpenOptions,
  onOpenScheduler,
  canResume,
  canPause,
  canDelete,
  hasCompleted,
  searchQuery,
  onSearchChange,
}) => {
  return (
    <div 
      role="toolbar" 
      aria-label="Commands"
      className="h-[68px] px-3 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between select-none shrink-0"
    >
      {/* Left 3D Buttons: Borderless in idle state, 3D icons with labels below */}
      <div className="flex items-center gap-0.5">
        {/* Add URL */}
        <button
          onClick={onAddUrl}
          title="Add New Download URL (Ctrl+N)"
          className="w-[66px] h-[58px] flex flex-col items-center justify-center gap-1 rounded-md hover:bg-[#e2e8f0]/70 active:bg-[#cbd5e1] text-[#1e293b] transition-all cursor-pointer group"
        >
          <Icon3DAdd className="w-8 h-8 group-hover:scale-105 transition-transform" />
          <span className="text-[11.5px] font-semibold leading-none">Add URL</span>
        </button>

        {/* Resume */}
        <button
          onClick={onResumeSelected}
          disabled={!canResume}
          title="Resume Selected Downloads"
          className="w-[64px] h-[58px] flex flex-col items-center justify-center gap-1 rounded-md hover:bg-[#e2e8f0]/70 active:bg-[#cbd5e1] text-[#1e293b] disabled:opacity-35 disabled:hover:bg-transparent transition-all cursor-pointer group"
        >
          <Icon3DResume className="w-8 h-8 group-hover:scale-105 transition-transform" />
          <span className="text-[11.5px] font-medium leading-none">Resume</span>
        </button>

        {/* Stop (Pause) */}
        <button
          onClick={onPauseSelected}
          disabled={!canPause}
          title="Stop Selected Downloads"
          className="w-[64px] h-[58px] flex flex-col items-center justify-center gap-1 rounded-md hover:bg-[#e2e8f0]/70 active:bg-[#cbd5e1] text-[#1e293b] disabled:opacity-35 disabled:hover:bg-transparent transition-all cursor-pointer group"
        >
          <Icon3DStop className="w-8 h-8 group-hover:scale-105 transition-transform" />
          <span className="text-[11.5px] font-medium leading-none">Stop</span>
        </button>

        {/* Stop All */}
        <button
          onClick={onPauseAll}
          title="Stop All Active Downloads"
          className="w-[64px] h-[58px] flex flex-col items-center justify-center gap-1 rounded-md hover:bg-[#e2e8f0]/70 active:bg-[#cbd5e1] text-[#1e293b] transition-all cursor-pointer group"
        >
          <Icon3DStopAll className="w-8 h-8 group-hover:scale-105 transition-transform" />
          <span className="text-[11.5px] font-medium leading-none">Stop All</span>
        </button>

        <div className="w-[1px] h-9 bg-[#cbd5e1] mx-1" />

        {/* Delete */}
        <button
          onClick={onDeleteSelected}
          disabled={!canDelete}
          title="Delete Selected (Del)"
          className="w-[64px] h-[58px] flex flex-col items-center justify-center gap-1 rounded-md hover:bg-[#fee2e2]/70 hover:text-[#b91c1c] active:bg-[#fecaca] text-[#1e293b] disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[#1e293b] transition-all cursor-pointer group"
        >
          <Icon3DDelete className="w-8 h-8 group-hover:scale-105 transition-transform" />
          <span className="text-[11.5px] font-medium leading-none">Delete</span>
        </button>

        {/* Delete Completed */}
        <button
          onClick={onDeleteCompleted}
          disabled={!hasCompleted}
          title="Delete All Completed Downloads"
          className="w-[64px] h-[58px] flex flex-col items-center justify-center gap-1 rounded-md hover:bg-[#e2e8f0]/70 active:bg-[#cbd5e1] text-[#1e293b] disabled:opacity-35 disabled:hover:bg-transparent transition-all cursor-pointer group"
        >
          <Icon3DDeleteCompleted className="w-8 h-8 group-hover:scale-105 transition-transform" />
          <span className="text-[11.5px] font-medium leading-none">Delete C...</span>
        </button>

        <div className="w-[1px] h-9 bg-[#cbd5e1] mx-1" />

        {/* Options */}
        <button
          onClick={onOpenOptions}
          title="Options & Preferences (Ctrl+,)"
          className="w-[64px] h-[58px] flex flex-col items-center justify-center gap-1 rounded-md hover:bg-[#e2e8f0]/70 active:bg-[#cbd5e1] text-[#1e293b] transition-all cursor-pointer group"
        >
          <Icon3DOptions className="w-8 h-8 group-hover:scale-105 transition-transform" />
          <span className="text-[11.5px] font-medium leading-none">Options</span>
        </button>

        {/* Scheduler */}
        <button
          onClick={onOpenScheduler}
          title="Download Scheduler & Queue"
          className="w-[64px] h-[58px] flex flex-col items-center justify-center gap-1 rounded-md hover:bg-[#e2e8f0]/70 active:bg-[#cbd5e1] text-[#1e293b] transition-all cursor-pointer group"
        >
          <Icon3DScheduler className="w-8 h-8 group-hover:scale-105 transition-transform" />
          <span className="text-[11.5px] font-medium leading-none">Scheduler</span>
        </button>

        {/* Batch */}
        <button
          onClick={onAddBatch}
          title="Batch Pattern Download (Ctrl+B)"
          className="w-[64px] h-[58px] flex flex-col items-center justify-center gap-1 rounded-md hover:bg-[#e2e8f0]/70 active:bg-[#cbd5e1] text-[#1e293b] transition-all cursor-pointer group"
        >
          <Icon3DBatch className="w-8 h-8 group-hover:scale-105 transition-transform" />
          <span className="text-[11.5px] font-medium leading-none">Batch</span>
        </button>

        {/* Site Grabber */}
        <button
          onClick={onOpenSiteGrabber}
          title="Site Grabber Wizard (Ctrl+G)"
          className="w-[64px] h-[58px] flex flex-col items-center justify-center gap-1 rounded-md hover:bg-[#e2e8f0]/70 active:bg-[#cbd5e1] text-[#1e293b] transition-all cursor-pointer group"
        >
          <Icon3DGrabber className="w-8 h-8 group-hover:scale-105 transition-transform" />
          <span className="text-[11.5px] font-medium leading-none">Grabber</span>
        </button>
      </div>

      {/* Right Search Box */}
      <div className="flex items-center gap-2 pr-1">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-[#94a3b8] absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            placeholder="Search (Ctrl+F)..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-48 h-8 pl-8 pr-6 text-[12.5px] bg-[#ffffff] border border-[#cbd5e1] focus:border-[#2563eb] rounded-md outline-none font-sans shadow-sm"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 text-[#94a3b8] hover:text-[#0f172a] text-xs font-bold"
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
