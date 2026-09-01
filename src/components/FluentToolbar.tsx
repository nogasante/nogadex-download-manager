import React from 'react';
import { 
  Plus, 
  Play, 
  Pause, 
  Trash2, 
  PlaySquare, 
  StopCircle, 
  Clock, 
  Download, 
  Search, 
  Settings,
  ChevronDown 
} from 'lucide-react';

interface FluentToolbarProps {
  onAddUrl: () => void;
  onResumeSelected: () => void;
  onStopSelected: () => void;
  onDeleteSelected: () => void;
  onSearchChange: (q: string) => void;
  selectedCount: number;
}

export const FluentToolbar: React.FC<FluentToolbarProps> = ({
  onAddUrl,
  onResumeSelected,
  onStopSelected,
  onDeleteSelected,
  onSearchChange,
  selectedCount,
}) => {
  return (
    <div className="px-4 py-2 bg-[#1b1f2e] border-b border-[#282e42] flex items-center justify-between gap-2 overflow-x-auto select-none">
      {/* Action Buttons matching screenshot */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* + Add URL */}
        <button
          onClick={onAddUrl}
          className="fluent-toolbar-btn px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold text-white shadow-sm"
        >
          <Plus className="w-3.5 h-3.5 text-cyan-400 stroke-[2.5]" />
          <span>Add URL</span>
        </button>

        {/* Resume */}
        <button
          onClick={onResumeSelected}
          disabled={selectedCount === 0}
          className="fluent-toolbar-btn px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white disabled:opacity-40 disabled:pointer-events-none"
        >
          <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400/30" />
          <span>Resume</span>
        </button>

        {/* Stop ˇ */}
        <button
          onClick={onStopSelected}
          disabled={selectedCount === 0}
          className="fluent-toolbar-btn px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white disabled:opacity-40 disabled:pointer-events-none"
        >
          <Pause className="w-3.5 h-3.5 text-amber-400" />
          <span>Stop</span>
          <ChevronDown className="w-3 h-3 text-slate-500 ml-0.5" />
        </button>

        {/* Delete ˇ */}
        <button
          onClick={onDeleteSelected}
          disabled={selectedCount === 0}
          className="fluent-toolbar-btn px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-rose-400 disabled:opacity-40 disabled:pointer-events-none"
        >
          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
          <span>Delete</span>
          <ChevronDown className="w-3 h-3 text-slate-500 ml-0.5" />
        </button>

        <div className="w-[1px] h-5 bg-[#2d3448] mx-1" />

        {/* Start Queue ˇ */}
        <button className="fluent-toolbar-btn px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white">
          <PlaySquare className="w-3.5 h-3.5 text-cyan-400" />
          <span>Start Queue</span>
          <ChevronDown className="w-3 h-3 text-slate-500 ml-0.5" />
        </button>

        {/* Stop Queue ˇ */}
        <button className="fluent-toolbar-btn px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white">
          <StopCircle className="w-3.5 h-3.5 text-slate-400" />
          <span>Stop Queue</span>
          <ChevronDown className="w-3 h-3 text-slate-500 ml-0.5" />
        </button>

        {/* Scheduler */}
        <button className="fluent-toolbar-btn px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white">
          <Clock className="w-3.5 h-3.5 text-purple-400" />
          <span>Scheduler</span>
        </button>

        {/* Grabber */}
        <button className="fluent-toolbar-btn px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white">
          <Download className="w-3.5 h-3.5 text-teal-400" />
          <span>Grabber</span>
        </button>
      </div>

      {/* Right Search & Settings */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="relative w-44">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search downloads..."
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1 rounded-lg bg-[#141722] border border-[#2b3145] focus:border-cyan-500 text-xs text-slate-200 placeholder-slate-500 outline-none transition-colors"
          />
        </div>

        <button className="p-1.5 rounded-lg bg-[#222738] border border-[#2e354c] hover:bg-[#2b3249] text-slate-400 hover:text-white transition-colors">
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
