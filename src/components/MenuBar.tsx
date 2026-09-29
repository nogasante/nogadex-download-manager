import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_NAME } from '../config/appInfo';
import {
  AppearanceSettings,
  IconStyle,
  loadAppearance,
  changeAppearance,
  isDarkMode,
  UI_SCALE_OPTIONS,
  ICON_STYLE_OPTIONS,
} from '../config/appearance';

interface MenuBarProps {
  // Actions
  onAddUrl: () => void;
  onAddBatch: () => void;
  onOpenSiteGrabber: () => void;
  onOpenOptions: () => void;
  onOpenScheduler: () => void;
  onOpenDiagnostics: () => void;
  onOpenIntegrityScan?: () => void;
  onOpenHelpCenter?: (tab?: 'howto' | 'faq' | 'bug' | 'feedback' | 'legal') => void;
  onExportHistory: () => void;
  onImportHistory: () => void;
  onRefresh?: () => void;
  onExit?: () => void;
  onAbout?: () => void;
  onCheckForUpdates?: () => void;
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
  onOpenIntegrityScan,
  onOpenHelpCenter,
  onExportHistory,
  onImportHistory,
  onRefresh,
  onExit,
  onAbout,
  onCheckForUpdates,
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
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const { t } = useTranslation();

  // Appearance (View menu quick controls): live-applied via
  // changeAppearance, no Settings trip needed.
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadAppearance());
  const patchAppearance = (patch: Partial<AppearanceSettings>) => {
    setAppearance(changeAppearance(patch));
  };

  const handleMouseEnter = (menuName: string) => {
    if (openMenu !== null && openMenu !== menuName) {
      setOpenMenu(menuName);
      setOpenSubmenu(null);
    }
  };

  const handleMenuClick = (menuName: string) => {
    setOpenMenu(openMenu === menuName ? null : menuName);
    setOpenSubmenu(null);
  };

  const closeMenu = () => {
    setOpenMenu(null);
    setOpenSubmenu(null);
  };

  const renderCheckItem = (label: string, checked: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={() => {
        onClick();
        closeMenu();
      }}
      className="w-full text-left flex items-center hover:bg-brand-tintHover/40 hover:text-brand py-1 select-none text-[12px] group"
    >
      <span className="w-6 text-center text-[12px] text-brand font-bold">
        {checked ? '✓' : ''}
      </span>
      <span className="flex-1 pr-3">{label}</span>
    </button>
  );

  /** Flyout submenu (View menu: Text Size / Icon Style). */
  const renderSubmenu = (
    label: string,
    id: string,
    items: Array<{ label: string; checked: boolean; onClick: () => void }>
  ) => (
    <div className="relative" onMouseEnter={() => setOpenSubmenu(id)}>
      <button
        type="button"
        className="w-full text-left flex items-center py-1 select-none text-[12px] text-neutral-800 hover:bg-brand-tintHover/40 hover:text-brand"
      >
        <span className="w-6" />
        <span className="flex-1">{label}</span>
        <span className="pr-3 text-[9px] text-neutral-500">▶</span>
      </button>
      {openSubmenu === id && (
        <div className="absolute left-full top-0 w-52 bg-white border border-neutral-400 shadow-menu py-1 z-50 text-[12px] rounded-[2px]">
          {items.map((it) => renderCheckItem(it.label, it.checked, it.onClick))}
        </div>
      )}
    </div>
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
          ? 'text-neutral-400 cursor-not-allowed'
          : 'hover:bg-brand-tintHover/40 hover:text-brand text-neutral-800'
      }`}
    >
      <span className="w-6" />
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[11px] text-neutral-500 pr-4">{shortcut}</span>}
    </button>
  );

  return (
    <div className="h-6 ndm-titlebar border-b border-neutral-200 flex items-center px-1 text-[12px] text-neutral-800 select-none font-sans z-50 relative">
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
            openMenu === 'tasks' ? 'bg-brand-tint border border-brand-tintEdge text-brand' : 'hover:bg-neutral-200 border border-transparent'
          }`}
        >
          <span className="underline decoration-neutral-800/50 underline-offset-2">{t('menu.tasks').charAt(0)}</span>{t('menu.tasks').slice(1)}
        </button>
        {openMenu === 'tasks' && (
          <div className="absolute top-6 left-0 w-60 bg-white border border-neutral-400 shadow-menu py-1 z-50 text-[12px] rounded-[2px]">
            {renderActionItem(t('menu.addNewDownload'), 'Ctrl+N', onAddUrl)}
            {renderActionItem(t('menu.addBatchDownload'), 'Ctrl+B', onAddBatch)}
            {renderActionItem(t('menu.siteGrabberWizard'), 'Ctrl+G', onOpenSiteGrabber)}
            <div className="h-[1px] bg-neutral-200 my-1 mx-2" />
            {renderActionItem(t('menu.exportHistory'), null, onExportHistory)}
            {renderActionItem(t('menu.importList'), null, onImportHistory)}
            <div className="h-[1px] bg-neutral-200 my-1 mx-2" />
            {renderActionItem(t('menu.exit'), 'Alt+F4', () => (onExit ? onExit() : window.close()))}
          </div>
        )}
      </div>

      {/* File Menu */}
      <div className="relative z-50">
        <button
          onClick={() => handleMenuClick('file')}
          onMouseEnter={() => handleMouseEnter('file')}
          className={`px-2 py-0.5 rounded-[2px] cursor-default transition-colors ${
            openMenu === 'file' ? 'bg-brand-tint border border-brand-tintEdge text-brand' : 'hover:bg-neutral-200 border border-transparent'
          }`}
        >
          <span className="underline decoration-neutral-800/50 underline-offset-2">{t('menu.file').charAt(0)}</span>{t('menu.file').slice(1)}
        </button>
        {openMenu === 'file' && (
          <div className="absolute top-6 left-0 w-56 bg-white border border-neutral-400 shadow-menu py-1 z-50 text-[12px] rounded-[2px]">
            {renderActionItem(t('menu.resumeSelected'), null, () => onResumeSelected && onResumeSelected())}
            {renderActionItem(t('menu.stopAllDownloads'), null, () => onStopAll && onStopAll())}
            {renderActionItem(t('menu.deleteSelected'), 'Del', () => onDeleteSelected && onDeleteSelected())}
            <div className="h-[1px] bg-neutral-200 my-1 mx-2" />
            {renderActionItem(t('menu.exit'), null, () => (onExit ? onExit() : window.close()))}
          </div>
        )}
      </div>

      {/* Downloads Menu */}
      <div className="relative z-50">
        <button
          onClick={() => handleMenuClick('downloads')}
          onMouseEnter={() => handleMouseEnter('downloads')}
          className={`px-2 py-0.5 rounded-[2px] cursor-default transition-colors ${
            openMenu === 'downloads' ? 'bg-brand-tint border border-brand-tintEdge text-brand' : 'hover:bg-neutral-200 border border-transparent'
          }`}
        >
          <span className="underline decoration-neutral-800/50 underline-offset-2">{t('menu.downloads').charAt(0)}</span>{t('menu.downloads').slice(1)}
        </button>
        {openMenu === 'downloads' && (
          <div className="absolute top-6 left-0 w-56 bg-white border border-neutral-400 shadow-menu py-1 z-50 text-[12px] rounded-[2px]">
            {renderActionItem(t('menu.schedulerQueue'), null, onOpenScheduler)}
            {renderActionItem(t('menu.optionsDots'), null, onOpenOptions)}
            {renderActionItem(t('menu.engineDiagnostics'), null, onOpenDiagnostics)}
            {onOpenIntegrityScan && renderActionItem(t('menu.integrityScan'), null, onOpenIntegrityScan)}
          </div>
        )}
      </div>

      {/* View Menu with REAL Functional Toggles and Left Win32 Checkmarks */}
      <div className="relative z-50">
        <button
          onClick={() => handleMenuClick('view')}
          onMouseEnter={() => handleMouseEnter('view')}
          className={`px-2 py-0.5 rounded-[2px] cursor-default transition-colors ${
            openMenu === 'view' ? 'bg-brand-tint border border-brand-tintEdge text-brand' : 'hover:bg-neutral-200 border border-transparent'
          }`}
        >
          <span className="underline decoration-neutral-800/50 underline-offset-2">{t('menu.view').charAt(0)}</span>{t('menu.view').slice(1)}
        </button>
        {openMenu === 'view' && (
          <div className="absolute top-6 left-0 w-56 bg-white border border-neutral-400 shadow-menu py-1 z-50 text-[12px] rounded-[2px]">
            {renderCheckItem(t('menu.toolbarToggle'), showToolbar, onToggleToolbar)}
            {renderCheckItem(t('menu.categoriesTree'), showCategories, onToggleCategories)}
            {renderCheckItem(t('menu.statusBarToggle'), showStatusBar, onToggleStatusBar)}
            <div className="h-[1px] bg-neutral-200 my-1 mx-2" />
            {renderCheckItem(
              t('menu.darkMode'),
              isDarkMode(appearance.theme),
              () => patchAppearance({ theme: isDarkMode(appearance.theme) ? 'light' : 'dark' })
            )}
            {renderSubmenu(
              t('menu.textSize'),
              'textsize',
              UI_SCALE_OPTIONS.map((o) => ({
                label: `${o.label} (${o.value}px)`,
                checked: appearance.uiScale === o.value,
                onClick: () => patchAppearance({ uiScale: o.value }),
              }))
            )}
            {renderSubmenu(
              t('menu.iconStyle'),
              'iconstyle',
              ICON_STYLE_OPTIONS.map((o) => ({
                label: o.label,
                checked: appearance.iconStyle === (o.value as IconStyle),
                onClick: () => patchAppearance({ iconStyle: o.value }),
              }))
            )}
            <div className="h-[1px] bg-neutral-200 my-1 mx-2" />
            {renderActionItem(t('menu.refreshList'), 'F5', () => (onRefresh ? onRefresh() : window.location.reload()))}
          </div>
        )}
      </div>

      {/* Help Menu */}
      <div className="relative z-50">
        <button
          onClick={() => handleMenuClick('help')}
          onMouseEnter={() => handleMouseEnter('help')}
          className={`px-2 py-0.5 rounded-[2px] cursor-default transition-colors ${
            openMenu === 'help' ? 'bg-brand-tint border border-brand-tintEdge text-brand' : 'hover:bg-neutral-200 border border-transparent'
          }`}
        >
          <span className="underline decoration-neutral-800/50 underline-offset-2">{t('menu.help').charAt(0)}</span>{t('menu.help').slice(1)}
        </button>
        {openMenu === 'help' && (
          <div className="absolute top-6 left-0 w-56 bg-white border border-neutral-400 shadow-menu py-1 z-50 text-[12px] rounded-[2px]">
            {renderActionItem(t('menu.helpCenter'), 'F1', () => onOpenHelpCenter && onOpenHelpCenter('howto'))}
            {renderActionItem(t('menu.reportBug'), null, () => onOpenHelpCenter && onOpenHelpCenter('bug'))}
            {renderActionItem(t('menu.sendFeedback'), null, () => onOpenHelpCenter && onOpenHelpCenter('feedback'))}
            <div className="h-[1px] bg-neutral-200 my-1 mx-2" />
            {renderActionItem(t('menu.engineDiagnostics'), null, onOpenDiagnostics)}
            {renderActionItem(t('menu.integrityScan'), null, () => onOpenIntegrityScan && onOpenIntegrityScan())}
            <div className="h-[1px] bg-neutral-200 my-1 mx-2" />
            {renderActionItem(t('menu.checkUpdates'), null, () => onCheckForUpdates && onCheckForUpdates())}
            {renderActionItem(t('menu.about', { app: APP_NAME }), null, () => onAbout && onAbout())}
          </div>
        )}
      </div>
    </div>
  );
};
