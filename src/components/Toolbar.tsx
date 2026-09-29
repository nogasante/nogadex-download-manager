import React, { useState, useRef } from 'react';
import { 
  Icon3DAdd,
  Icon3DResume,
  Icon3DPause,
  Icon3DStop,
  Icon3DStopAll,
  Icon3DDelete,
  Icon3DOptions,
  Icon3DScheduler,
  Icon3DBatch,
  Icon3DGrabber
} from './Icons3D';
import { Search, ChevronDown } from 'lucide-react';
import { useOutsideClick } from '../hooks/useOutsideClick';

interface ToolbarProps {
  onAddUrl: () => void;
  onAddBatch: () => void;
  onOpenSiteGrabber?: () => void;
  onResumeSelected: () => void;
  onResumeAll?: () => void;
  onRetryAllFailed?: () => void;
  hasFailed?: boolean;
  onPauseSelected: () => void;
  onPauseAll: () => void;
  onStopSelected?: () => void;
  onStopAll?: () => void;
  onDeleteSelected: () => void;
  onDeleteCompleted: () => void;
  onDeleteIncomplete?: () => void;
  onDeleteAll?: () => void;
  onOpenOptions: () => void;
  onOpenScheduler: () => void;
  /** Pick which queue Start/Stop acts on. Receives the queue id. */
  onStartQueue?: (queueId?: string) => void;
  onStopQueue?: (queueId?: string) => void;
  /** All queues with their running state (drives the chevron menus). */
  queues?: Array<{ id: string; name: string; state?: string }>
  canResume: boolean;
  canPause: boolean;
  canDelete: boolean;
  hasCompleted: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
}

interface ToolbarButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  label: string;
  icon: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ onClick, disabled, title, label, icon }) => (
  <div className="w-[76px] flex flex-col items-center justify-center group cursor-pointer min-w-0">
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-full flex flex-col items-center justify-center gap-1.5 bg-transparent border-0 outline-none text-neutral-800 disabled:opacity-35 cursor-pointer"
    >
      <div className="group-hover:scale-110 group-hover:-translate-y-1 transition-transform duration-150">
        {icon}
      </div>
      <span className="text-[11.5px] font-medium leading-none text-center whitespace-nowrap truncate min-w-0 w-full">{label}</span>
    </button>
  </div>
);

interface ToolbarDropdownButtonProps {
  onClick: () => void;
  onToggleDropdown: () => void;
  isOpen: boolean;
  disabled?: boolean;
  title: string;
  label: string;
  icon: React.ReactNode;
  dropdownMenu: React.ReactNode;
  hoverDanger?: boolean;
}

const ToolbarDropdownButton: React.FC<ToolbarDropdownButtonProps> = ({
  onClick,
  onToggleDropdown,
  isOpen,
  disabled,
  title,
  label,
  icon,
  dropdownMenu,
  hoverDanger = false,
}) => (
  <div className="relative w-[76px] flex flex-col items-center justify-center group cursor-pointer min-w-0">
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-full flex flex-col items-center justify-center gap-1.5 bg-transparent border-0 outline-none text-neutral-800 disabled:opacity-35 cursor-pointer ${
        hoverDanger ? 'hover:text-status-error' : ''
      }`}
    >
      <div className="group-hover:scale-110 group-hover:-translate-y-1 transition-transform duration-150">
        {icon}
      </div>
      <div className="flex items-center justify-center gap-1.5 w-full min-w-0">
        <span className="text-[11.5px] font-medium leading-none whitespace-nowrap truncate min-w-0">{label}</span>
        <span
          onClick={(e) => {
            e.stopPropagation();
            onToggleDropdown();
          }}
          title={`${label} Options`}
          className={`text-neutral-500 shrink-0 ${hoverDanger ? 'hover:text-status-error' : 'hover:text-neutral-900'} p-0.5 cursor-pointer transition-colors`}
        >
          <ChevronDown className="w-3 h-3" />
        </span>
      </div>
    </button>
    {isOpen && dropdownMenu}
  </div>
);

export const Toolbar: React.FC<ToolbarProps> = ({
  onAddUrl,
  onAddBatch,
  onOpenSiteGrabber,
  onResumeSelected,
  onResumeAll,
  onRetryAllFailed,
  hasFailed,
  onPauseSelected,
  onPauseAll,
  onStopSelected,
  onStopAll,
  onDeleteSelected,
  onDeleteCompleted,
  onDeleteIncomplete,
  onDeleteAll,
  onOpenOptions,
  onOpenScheduler,
  onStartQueue,
  onStopQueue,
  queues = [],
  canResume,
  canPause,
  canDelete,
  hasCompleted,
  searchQuery,
  onSearchChange,
  searchInputRef,
}) => {
  const [openDropdown, setOpenDropdown] = useState<'resume' | 'pause' | 'stop' | 'delete' | 'startQueue' | 'stopQueue' | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useOutsideClick(toolbarRef, () => setOpenDropdown(null));

  const toggleDropdown = (name: 'resume' | 'pause' | 'stop' | 'delete' | 'startQueue' | 'stopQueue') => {
    setOpenDropdown((prev) => (prev === name ? null : name));
  };

  const defaultQueue = queues.find((q) => q.id === 'default');
  const isMainQueueRunning = defaultQueue?.state === 'running';
  /** Per-queue menu rows shared by the Start and Stop chevrons. */
  const queueMenuItems = (action: 'start' | 'stop') => (
    <div className="absolute top-[66px] left-0 z-50 min-w-[210px] bg-white border border-neutral-400 rounded-[2px] shadow-[0_4px_16px_rgba(0,0,0,0.18)] py-1">
      {queues.length === 0 && (
        <div className="px-3 py-1.5 text-[12px] text-neutral-400 italic">No queues available</div>
      )}
      {queues.map((q) => {
        const running = q.state === 'running';
        const disabled = action === 'start' ? running : !running;
        return (
          <button
            key={q.id}
            disabled={disabled}
            onClick={() => {
              setOpenDropdown(null);
              (action === 'start' ? onStartQueue : onStopQueue)?.(q.id);
            }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-800 hover:bg-brand-glow hover:text-white flex items-center justify-between cursor-pointer disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-800"
          >
            <span className="truncate pr-3">{q.name}</span>
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${running ? 'text-status-completed' : 'text-neutral-400'}`}>
              {running ? 'running' : 'stopped'}
            </span>
          </button>
        );
      })}
      {queues.length > 1 && (
        <>
          <div className="h-[1px] bg-neutral-200 my-1 mx-2" />
          <button
            onClick={() => {
              setOpenDropdown(null);
              for (const q of queues) {
                const running = q.state === 'running';
                if (action === 'start' ? !running : running) {
                  (action === 'start' ? onStartQueue : onStopQueue)?.(q.id);
                }
              }
            }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-800 hover:bg-brand-glow hover:text-white cursor-pointer"
          >
            {action === 'start' ? 'Start all queues' : 'Stop all queues'}
          </button>
        </>
      )}
    </div>
  );

  return (
    <div 
      ref={toolbarRef}
      role="toolbar" 
      aria-label="Commands"
      className="h-[74px] px-4 ndm-titlebar border-b border-neutral-200 flex items-center justify-between select-none shrink-0"
    >
      {/* 3D Command Buttons — gap widened so labels never crowd each other */}
      <div className="flex items-center gap-4">
        {/* Add URL */}
        <ToolbarButton
          onClick={onAddUrl}
          title="Add New Download URL (Ctrl+N)"
          label="Add URL"
          icon={<Icon3DAdd className="w-9 h-9 drop-shadow-xs" />}
        />

        {/* Resume */}
        <ToolbarDropdownButton
          onClick={() => { setOpenDropdown(null); onResumeSelected(); }}
          onToggleDropdown={() => toggleDropdown('resume')}
          isOpen={openDropdown === 'resume'}
          disabled={!canResume}
          title="Resume Selected Downloads"
          label="Resume"
          icon={<Icon3DResume className="w-9 h-9 drop-shadow-xs" />}
          dropdownMenu={
            <div className="absolute top-[66px] left-0 z-50 min-w-[190px] bg-white border border-neutral-400 rounded-[2px] shadow-[0_4px_16px_rgba(0,0,0,0.18)] py-1">
              <button
                disabled={!canResume}
                onClick={() => { setOpenDropdown(null); onResumeSelected(); }}
                className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-800 hover:bg-brand-glow hover:text-white flex items-center justify-between cursor-pointer disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-800"
              >
                <span>Resume Selected</span>
                <span className="text-[10px] opacity-60">Ctrl+R</span>
              </button>
              <button
                onClick={() => { setOpenDropdown(null); onResumeAll?.(); }}
                className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-800 hover:bg-brand-glow hover:text-white flex items-center justify-between cursor-pointer"
              >
                <span>Resume All</span>
                <span className="text-[10px] opacity-60">Ctrl+Shift+R</span>
              </button>
              <div className="h-[1px] bg-neutral-200 my-1 mx-2" />
              <button
                disabled={!hasFailed}
                onClick={() => { setOpenDropdown(null); onRetryAllFailed?.(); }}
                title="Retry every errored download at once"
                className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-800 hover:bg-brand-glow hover:text-white flex items-center justify-between cursor-pointer disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-800"
              >
                <span>Retry All Failed</span>
                <span className="text-[10px] opacity-60">Ctrl+Alt+R</span>
              </button>
            </div>
          }
        />

        {/* Pause */}
        <ToolbarDropdownButton
          onClick={() => { setOpenDropdown(null); onPauseSelected(); }}
          onToggleDropdown={() => toggleDropdown('pause')}
          isOpen={openDropdown === 'pause'}
          disabled={!canPause}
          title="Pause Selected Downloads"
          label="Pause"
          icon={<Icon3DPause className="w-9 h-9 drop-shadow-xs" />}
          dropdownMenu={
            <div className="absolute top-[66px] left-0 z-50 min-w-[190px] bg-white border border-neutral-400 rounded-[2px] shadow-[0_4px_16px_rgba(0,0,0,0.18)] py-1">
              <button
                disabled={!canPause}
                onClick={() => { setOpenDropdown(null); onPauseSelected(); }}
                className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-800 hover:bg-brand-glow hover:text-white flex items-center justify-between cursor-pointer disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-800"
              >
                <span>Pause Selected</span>
                <span className="text-[10px] opacity-60">Ctrl+P</span>
              </button>
              <button
                onClick={() => { setOpenDropdown(null); onPauseAll(); }}
                className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-800 hover:bg-brand-glow hover:text-white flex items-center justify-between cursor-pointer"
              >
                <span>Pause All</span>
                <span className="text-[10px] opacity-60">Ctrl+Shift+P</span>
              </button>
            </div>
          }
        />

        {/* Stop */}
        <ToolbarDropdownButton
          onClick={() => { setOpenDropdown(null); (onStopSelected || onPauseSelected)(); }}
          onToggleDropdown={() => toggleDropdown('stop')}
          isOpen={openDropdown === 'stop'}
          disabled={!canPause}
          title="Stop Selected Downloads"
          label="Stop"
          icon={<Icon3DStop className="w-9 h-9 drop-shadow-xs" />}
          dropdownMenu={
            <div className="absolute top-[66px] left-0 z-50 min-w-[190px] bg-white border border-neutral-400 rounded-[2px] shadow-[0_4px_16px_rgba(0,0,0,0.18)] py-1">
              <button
                disabled={!canPause}
                onClick={() => { setOpenDropdown(null); (onStopSelected || onPauseSelected)(); }}
                className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-800 hover:bg-brand-glow hover:text-white flex items-center justify-between cursor-pointer disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-800"
              >
                <span>Stop Selected</span>
              </button>
              <button
                onClick={() => { setOpenDropdown(null); (onStopAll || onPauseAll)(); }}
                className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-800 hover:bg-brand-glow hover:text-white flex items-center justify-between cursor-pointer"
              >
                <span>Stop All</span>
              </button>
            </div>
          }
        />

        {/* Delete */}
        <ToolbarDropdownButton
          onClick={() => { setOpenDropdown(null); onDeleteSelected(); }}
          onToggleDropdown={() => toggleDropdown('delete')}
          isOpen={openDropdown === 'delete'}
          disabled={!canDelete}
          hoverDanger={true}
          title="Delete Selected (Del)"
          label="Delete"
          icon={<Icon3DDelete className="w-9 h-9 drop-shadow-xs" />}
          dropdownMenu={
            <div className="absolute top-[66px] left-0 z-50 min-w-[210px] bg-white border border-neutral-400 rounded-[2px] shadow-[0_4px_16px_rgba(0,0,0,0.18)] py-1">
              <button
                disabled={!canDelete}
                onClick={() => { setOpenDropdown(null); onDeleteSelected(); }}
                className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-800 hover:bg-brand-glow hover:text-white flex items-center justify-between cursor-pointer disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-800"
              >
                <span>Delete Selected</span>
                <span className="text-[10px] opacity-60">Del</span>
              </button>
              <button
                disabled={!hasCompleted}
                onClick={() => { setOpenDropdown(null); onDeleteCompleted(); }}
                className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-800 hover:bg-brand-glow hover:text-white flex items-center justify-between cursor-pointer disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-800"
              >
                <span>Delete Completed</span>
              </button>
              <button
                onClick={() => { setOpenDropdown(null); onDeleteIncomplete?.(); }}
                className="w-full text-left px-3 py-1.5 text-[12px] text-neutral-800 hover:bg-brand-glow hover:text-white flex items-center justify-between cursor-pointer"
              >
                <span>Delete Incomplete / Paused</span>
              </button>
              <div className="my-1 border-t border-neutral-200" />
              <button
                onClick={() => { setOpenDropdown(null); onDeleteAll?.(); }}
                className="w-full text-left px-3 py-1.5 text-[12px] text-status-error hover:bg-status-error hover:text-white flex items-center justify-between cursor-pointer font-medium"
              >
                <span>Delete All Downloads</span>
              </button>
            </div>
          }
        />

        {/* Options */}
        <ToolbarButton
          onClick={onOpenOptions}
          title="Options & Preferences (Ctrl+,)"
          label="Options"
          icon={<Icon3DOptions className="w-9 h-9 drop-shadow-xs" />}
        />

        {/* Scheduler */}
        <ToolbarButton
          onClick={onOpenScheduler}
          title="Download Scheduler & Queue"
          label="Scheduler"
          icon={<Icon3DScheduler className="w-9 h-9 drop-shadow-xs" />}
        />

        {/* Start Queue: main button = default queue;
            chevron = pick a specific queue (or start all). */}
        <ToolbarDropdownButton
          onClick={() => { setOpenDropdown(null); onStartQueue?.('default'); }}
          onToggleDropdown={() => toggleDropdown('startQueue')}
          isOpen={openDropdown === 'startQueue'}
          disabled={!onStartQueue || isMainQueueRunning}
          title="Start the main download queue (chevron: pick a queue)"
          label="Start Qu..."
          icon={<Icon3DResume className="w-9 h-9 drop-shadow-xs" />}
          dropdownMenu={queueMenuItems('start')}
        />

        {/* Stop Queue: main button = default queue;
            chevron = pick a specific queue (or stop all). */}
        <ToolbarDropdownButton
          onClick={() => { setOpenDropdown(null); onStopQueue?.('default'); }}
          onToggleDropdown={() => toggleDropdown('stopQueue')}
          isOpen={openDropdown === 'stopQueue'}
          disabled={!onStopQueue || !isMainQueueRunning}
          title="Stop the main download queue (chevron: pick a queue)"
          label="Stop Qu..."
          icon={<Icon3DStopAll className="w-9 h-9 drop-shadow-xs" />}
          dropdownMenu={queueMenuItems('stop')}
        />

        {/* Batch */}
        <ToolbarButton
          onClick={onAddBatch}
          title="Batch Pattern Download (Ctrl+B)"
          label="Batch"
          icon={<Icon3DBatch className="w-9 h-9 drop-shadow-xs" />}
        />

        {/* Site Grabber */}
        <ToolbarButton
          onClick={onOpenSiteGrabber}
          title="Site Grabber Wizard (Ctrl+G)"
          label="Grabber"
          icon={<Icon3DGrabber className="w-9 h-9 drop-shadow-xs" />}
        />
      </div>

      {/* Right Search Box: Authentic Windows File Explorer Search Bar.
          Shrinkable under zoom/pressure: min-w-0 lets the flex item compress
          instead of being pushed off-window at Large/Extra Large UI scale. */}
      <div className="flex items-center gap-2 pr-2 min-w-0 shrink">
        <div className="relative flex items-center flex-1 min-w-0 max-w-[210px] h-[26px] bg-white border border-neutral-400 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand/30 rounded-[2px] transition-all">
          <input
            type="text"
            ref={searchInputRef}
            placeholder="Search (Ctrl+F)"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full h-full pl-2.5 pr-7 text-[12px] bg-transparent border-0 outline-none text-neutral-800 placeholder:text-neutral-500 placeholder:italic font-sans"
          />
          {searchQuery ? (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 text-neutral-400 hover:text-neutral-900 text-xs font-bold cursor-pointer"
              title="Clear search"
            >
              ×
            </button>
          ) : (
            <Search className="w-3.5 h-3.5 text-brand absolute right-2 pointer-events-none opacity-80" />
          )}
        </div>
      </div>
    </div>
  );
};
