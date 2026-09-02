import React, { useState } from 'react';

interface MenuBarProps {
  // Actions
  onAddUrl: () => void;
  onAddBatch: () => void;
  onOpenSiteGrabber: () => void;
  onOpenOptions: () => void;
  onOpenScheduler: () => void;
  onOpenDiagnostics: () => void;
  onExportHistory: () => void;
  onImportHistory: () => void;
  onRefresh?: () => void;
  onExit?: () => void;
  onAbout?: () => void;
  onStopAll?: () => void;
  onResumeSelected?: () => void;
  onDeleteSelected?: () => void;

  // View Toggles
  showToolbar: boolean;
  onToggleToolbar: () => void;
  showCategories: boolean;
  onToggleCategories: () => void;
  showStatusBar: boolean;
  onToggleStatusBar: () => void;
}

export const MenuBar: React.FC<MenuBarProps> = ({
  onAddUrl,
  onAddBatch,
  onOpenSiteGrabber,
  onOpenOptions,
  onOpenScheduler,
  onOpenDiagnostics,
  onExportHistory,
  onImportHistory,
  onRefresh,
  onExit,
  onAbout,
  onStopAll,
  onResumeSelected,
  onDeleteSelected,
  showToolbar,
  onToggleToolbar,
  showCategories,
  onToggleCategories,
  showStatusBar,
  onToggleStatusBar,
}) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const handleMouseEnter = (menuName: string) => {
    if (openMenu !== null && openMenu !== menuName) {
      setOpenMenu(menuName);
    }
  };

  const handleMenuClick = (menuName: string) => {
    setOpenMenu(openMenu === menuName ? null : menuName);
  };

  const closeMenu = () => setOpenMenu(null);

  const renderCheckItem = (label: string, checked: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={() => {
        onClick();
        closeMenu();
      }}
      className="w-full text-left flex items-center hover:bg-[#90c8f6]/40 hover:text-[#005a9e] py-1 select-none text-[12px] group"
    >
      <span className="w-6 text-center text-[12px] text-[#005a9e] font-bold">
        {checked ? '✓' : ''}
      </span>
      <span className="flex-1 pr-3">{label}</span>
    </button>
  );

  const renderActionItem = (label: string, shortcut: string | null, onClick: () => void, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onClick();
          closeMenu();
        }
      }}
      className={`w-full text-left flex items-center py-1 select-none text-[12px] ${
        disabled
          ? 'text-[#94a3b8] cursor-not-allowed'
          : 'hover:bg-[#90c8f6]/40 hover:text-[#005a9e] text-[#1e293b]'
      }`}
    >
      <span className="w-6" />
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[11px] text-[#64748b] pr-4">{shortcut}</span>}
    </button>
  );

  return (
    <div className="h-6 bg-[#f8f9fa] border-b border-[#e2e8f0] flex items-center px-1 text-[12px] text-[#1e293b] select-none font-sans z-50 relative">
      {openMenu && (
        <div
          className="fixed inset-0 z-40 bg-transparent"
          onClick={closeMenu}
        />
      )}

      {/* Tasks Menu */}
      <div className="relative z-50">
        <button
          onClick={() => handleMenuClick('tasks')}
          onMouseEnter={() => handleMouseEnter('tasks')}
          className={`px-2 py-0.5 rounded-[2px] cursor-default transition-colors ${
            openMenu === 'tasks' ? 'bg-[#cde8ff] border border-[#70baff] text-[#005a9e]' : 'hover:bg-[#e2e8f0] border border-transparent'
          }`}
        >
          <span className="underline decoration-[#1e293b]/50 underline-offset-2">T</span>asks
        </button>
        {openMenu === 'tasks' && (
          <div className="absolute top-6 left-0 w-60 bg-[#ffffff] border border-[#a0a0a0] shadow-[0_4px_12px_rgba(0,0,0,0.15)] py-1 z-50 text-[12px] rounded-[2px]">
            {renderActionItem('Add New Download...', 'Ctrl+N', onAddUrl)}
            {renderActionItem('Add Batch Download...', 'Ctrl+B', onAddBatch)}
            {renderActionItem('Site Grabber Wizard...', 'Ctrl+G', onOpenSiteGrabber)}
            <div className="h-[1px] bg-[#e2e8f0] my-1 mx-2" />
            {renderActionItem('Export Download History...', null, onExportHistory)}
            {renderActionItem('Import Download List...', null, onImportHistory)}
            <div className="h-[1px] bg-[#e2e8f0] my-1 mx-2" />
            {renderActionItem('Exit', 'Alt+F4', () => (onExit ? onExit() : window.close()))}
          </div>
        )}
      </div>

      {/* File Menu */}
      <div className="relative z-50">
        <button
          onClick={() => handleMenuClick('file')}
          onMouseEnter={() => handleMouseEnter('file')}
          className={`px-2 py-0.5 rounded-[2px] cursor-default transition-colors ${
            openMenu === 'file' ? 'bg-[#cde8ff] border border-[#70baff] text-[#005a9e]' : 'hover:bg-[#e2e8f0] border border-transparent'
          }`}
        >
          <span className="underline decoration-[#1e293b]/50 underline-offset-2">F</span>ile
        </button>
        {openMenu === 'file' && (
          <div className="absolute top-6 left-0 w-56 bg-[#ffffff] border border-[#a0a0a0] shadow-[0_4px_12px_rgba(0,0,0,0.15)] py-1 z-50 text-[12px] rounded-[2px]">
            {renderActionItem('Resume Selected', null, () => onResumeSelected && onResumeSelected())}
            {renderActionItem('Stop All Downloads', null, () => onStopAll && onStopAll())}
            {renderActionItem('Delete Selected', 'Del', () => onDeleteSelected && onDeleteSelected())}
            <div className="h-[1px] bg-[#e2e8f0] my-1 mx-2" />
            {renderActionItem('Exit', null, () => (onExit ? onExit() : window.close()))}
          </div>
        )}
      </div>

      {/* Downloads Menu */}
      <div className="relative z-50">
        <button
          onClick={() => handleMenuClick('downloads')}
          onMouseEnter={() => handleMouseEnter('downloads')}
          className={`px-2 py-0.5 rounded-[2px] cursor-default transition-colors ${
            openMenu === 'downloads' ? 'bg-[#cde8ff] border border-[#70baff] text-[#005a9e]' : 'hover:bg-[#e2e8f0] border border-transparent'
          }`}
        >
          <span className="underline decoration-[#1e293b]/50 underline-offset-2">D</span>ownloads
        </button>
        {openMenu === 'downloads' && (
          <div className="absolute top-6 left-0 w-56 bg-[#ffffff] border border-[#a0a0a0] shadow-[0_4px_12px_rgba(0,0,0,0.15)] py-1 z-50 text-[12px] rounded-[2px]">
            {renderActionItem('Scheduler / Queue...', null, onOpenScheduler)}
            {renderActionItem('Options...', null, onOpenOptions)}
            {renderActionItem('Engine Diagnostics...', null, onOpenDiagnostics)}
          </div>
        )}
      </div>

      {/* View Menu with REAL Functional Toggles and Left Win32 Checkmarks */}
      <div className="relative z-50">
        <button
          onClick={() => handleMenuClick('view')}
          onMouseEnter={() => handleMouseEnter('view')}
          className={`px-2 py-0.5 rounded-[2px] cursor-default transition-colors ${
            openMenu === 'view' ? 'bg-[#cde8ff] border border-[#70baff] text-[#005a9e]' : 'hover:bg-[#e2e8f0] border border-transparent'
          }`}
        >
          <span className="underline decoration-[#1e293b]/50 underline-offset-2">V</span>iew
        </button>
        {openMenu === 'view' && (
          <div className="absolute top-6 left-0 w-56 bg-[#ffffff] border border-[#a0a0a0] shadow-[0_4px_12px_rgba(0,0,0,0.15)] py-1 z-50 text-[12px] rounded-[2px]">
            {renderCheckItem('Toolbar', showToolbar, onToggleToolbar)}
            {renderCheckItem('Categories Tree', showCategories, onToggleCategories)}
            {renderCheckItem('Status Bar', showStatusBar, onToggleStatusBar)}
            <div className="h-[1px] bg-[#e2e8f0] my-1 mx-2" />
            {renderActionItem('Refresh List', 'F5', () => (onRefresh ? onRefresh() : window.location.reload()))}
          </div>
        )}
      </div>

      {/* Help Menu */}
      <div className="relative z-50">
        <button
          onClick={() => handleMenuClick('help')}
          onMouseEnter={() => handleMouseEnter('help')}
          className={`px-2 py-0.5 rounded-[2px] cursor-default transition-colors ${
            openMenu === 'help' ? 'bg-[#cde8ff] border border-[#70baff] text-[#005a9e]' : 'hover:bg-[#e2e8f0] border border-transparent'
          }`}
        >
          <span className="underline decoration-[#1e293b]/50 underline-offset-2">H</span>elp
        </button>
        {openMenu === 'help' && (
          <div className="absolute top-6 left-0 w-56 bg-[#ffffff] border border-[#a0a0a0] shadow-[0_4px_12px_rgba(0,0,0,0.15)] py-1 z-50 text-[12px] rounded-[2px]">
            {renderActionItem('Engine Diagnostics...', null, onOpenDiagnostics)}
            <div className="h-[1px] bg-[#e2e8f0] my-1 mx-2" />
            {renderActionItem('About Nogadex DM...', null, () => onAbout && onAbout())}
          </div>
        )}
      </div>
    </div>
  );
};
