import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Semi3DFolder,
  Semi3DZip,
  Semi3DDocument,
  Semi3DMusic,
  Semi3DProgram,
  Semi3DVideo,
  Semi3DUnfinished,
  Semi3DFinished,
  Semi3DQueues,
} from './CategoryIcons3D';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { api } from '../api/client';
import {
  CategoryPropertiesDialog,
  EditableCategory,
} from './CategoryPropertiesDialog';
import { ClearListConfirmDialog } from './ClearListConfirmDialog';

/** Server-side category shape (settings.categories). */
interface ServerCategory {
  id: string;
  name: string;
  extensions: string[];
  defaultFolder: string;
  sitesOnly?: string[];
  rememberLastFolder?: boolean;
}

const STATIC_ICON: Record<string, React.FC<{ className?: string }>> = {
  compressed: Semi3DZip,
  documents: Semi3DDocument,
  music: Semi3DMusic,
  programs: Semi3DProgram,
  video: Semi3DVideo,
};

/** Pick a sensible 3D icon from the category's extensions. */
function iconForCategory(cat: ServerCategory): React.FC<{ className?: string }> {
  if (STATIC_ICON[cat.id]) return STATIC_ICON[cat.id];
  const exts = cat.extensions.map((e) => e.toLowerCase());
  if (exts.some((e) => ['zip', 'rar', '7z', 'tar', 'gz', 'iso'].includes(e))) return Semi3DZip;
  if (exts.some((e) => ['pdf', 'doc', 'docx', 'txt', 'epub'].includes(e))) return Semi3DDocument;
  if (exts.some((e) => ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'].includes(e))) return Semi3DMusic;
  if (exts.some((e) => ['exe', 'msi', 'apk', 'deb', 'bin'].includes(e))) return Semi3DProgram;
  if (exts.some((e) => ['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(e))) return Semi3DVideo;
  return Semi3DFolder;
}

interface SidebarProps {
  selectedFilter: string;
  onSelectFilter: (filter: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  selectedFilter,
  onSelectFilter,
}) => {
  const { t } = useTranslation();
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(true);
  const [serverCategories, setServerCategories] = useState<ServerCategory[]>([]);
  type MenuKind = 'root' | 'category' | 'unfinished' | 'finished' | 'queues';
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; kind: MenuKind; categoryId?: string } | null>(null);
  const [editingCategory, setEditingCategory] = useState<EditableCategory | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState<{ count: number; listName: 'Unfinished' | 'Finished'; statuses: Array<'paused' | 'error' | 'completed'> } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadCategories = React.useCallback(async () => {
    try {
      const list = await api.categories.getAll();
      if (Array.isArray(list)) setServerCategories(list);
    } catch {
      /* offline: keep whatever we had */
    }
  }, []);

  useEffect(() => {
    loadCategories();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ndm_categories_changed') loadCategories();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [loadCategories]);

  // Close the context menu on outside click / Escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const refreshAfterChange = () => {
    loadCategories();
    try { localStorage.setItem('ndm_categories_changed', String(Date.now())); } catch {}
  };

  const openProperties = async (categoryId: string) => {
    let cat = serverCategories.find((c) => c.id === categoryId);
    if (!cat) {
      // State may be stale (initial load failed, or another window changed the
      // list) — re-fetch once before giving up, so Properties never silently
      // does nothing on a right-click.
      try {
        const list = await api.categories.getAll();
        if (Array.isArray(list)) {
          setServerCategories(list);
          cat = list.find((c) => c.id === categoryId);
        }
      } catch {
        /* fall through to the guard below */
      }
    }
    if (!cat) return;
    setEditingCategory({ ...cat });
    setIsEditorOpen(true);
  };

  const browseCategory = async (categoryId: string) => {
    const cat = serverCategories.find((c) => c.id === categoryId);
    if (!cat?.defaultFolder) return;
    try { await api.openFolder(cat.defaultFolder); } catch {}
  };

  const deleteCategory = async (categoryId: string) => {
    try {
      await api.categories.remove(categoryId);
      refreshAfterChange();
      if (selectedFilter === categoryId) onSelectFilter('all');
    } catch {}
  };

  const addCategory = () => {
    setEditingCategory(null);
    setIsEditorOpen(true);
  };

  /* ---------------------- Status-row bulk actions ----------------------- */

  const openContext = (e: React.MouseEvent, kind: MenuKind, categoryId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const PAD = 4;
    setContextMenu({ x: e.clientX + PAD, y: e.clientY + PAD, kind, categoryId });
  };

  const resumeAllUnfinished = async () => {
    try {
      const list = await api.downloads.getAll();
      const targets = list.filter((d) => d.status === 'paused' || d.status === 'error');
      await Promise.all(targets.map((d) => api.downloads.resume(d.id)));
    } catch {}
  };

  const retryFailedDownloads = async () => {
    try { await api.downloads.retryAllFailed(); } catch {}
  };

  const pauseAllActive = async () => {
    try {
      const list = await api.downloads.getAll();
      const targets = list.filter((d) => d.status === 'downloading' || d.status === 'probing' || d.status === 'queued');
      await Promise.all(targets.map((d) => api.downloads.pause(d.id)));
    } catch {}
  };

  /** Clear a status list: removes rows; optionally deletes files from disk. */
  const clearList = async (statuses: Array<'paused' | 'error' | 'completed'>, deleteFiles: boolean) => {
    try {
      const list = await api.downloads.getAll();
      const targets = list.filter((d) => statuses.includes(d.status as 'paused' | 'error' | 'completed'));
      await Promise.all(targets.map((d) => api.downloads.delete(d.id, deleteFiles)));
    } catch {}
  };

  /** Ask before clearing: count what would be removed, then confirm. */
  const requestClearList = async (statuses: Array<'paused' | 'error' | 'completed'>) => {
    try {
      const list = await api.downloads.getAll();
      const count = list.filter((d) => statuses.includes(d.status as 'paused' | 'error' | 'completed')).length;
      if (count === 0) return; // nothing to clear — skip the dialog
      const listName = statuses.includes('completed') ? 'Finished' : 'Unfinished';
      setClearConfirm({ count, listName, statuses });
    } catch {}
  };

  const startAllQueues = async () => {
    try {
      const queues = await api.queues.getAll();
      await Promise.all(queues.map((q) => api.queues.start(q.id)));
    } catch {}
  };

  const stopAllQueues = async () => {
    try {
      const queues = await api.queues.getAll();
      await Promise.all(queues.map((q) => api.queues.stop(q.id)));
    } catch {}
  };

  // Rendered category rows: the five classic ones keep their fixed position
  // and icon; any extra user-created categories render underneath.
  const classicIds = ['compressed', 'documents', 'music', 'programs', 'video'];
  const extraCategories = serverCategories.filter((c) => !classicIds.includes(c.id));

  return (
    <div
      role="navigation"
      aria-label="Category Tree"
      onContextMenu={(e) => {
        // Pane background (anywhere that isn't a row): IDM-style Add menu.
        // Rows stopPropagation, so this only fires for empty space.
        openContext(e, 'root');
      }}
      className="w-52 ndm-sidebar flex flex-col justify-between select-none text-[12.5px] font-sans h-full shrink-0"
    >
      <div className="p-2 space-y-1 overflow-y-auto">
        {/* Top Categories Parent Item */}
        <div>
          <button
            type="button"
            onClick={() => onSelectFilter('all')}
            onContextMenu={(e) => openContext(e, 'root')}
            className={`w-full flex items-center px-2 py-1.5 rounded-md transition-all ${
              selectedFilter === 'all'
                ? 'bg-brand-tint text-brand font-semibold'
                : 'text-neutral-800 hover:bg-neutral-200'
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
              <span className="truncate">{t('sidebar.allDownloads')}</span>
            </div>
          </button>

          {/* Sub-categories */}
          {isCategoriesOpen && (
            <div className="pl-6 pt-1 space-y-0.5">
              {serverCategories.length === 0
                ? // Fallback while loading/offline: static five (same as before).
                  classicIds.map((id) => (
                    <CategoryRow
                      key={id}
                      id={id}
                      name={id.charAt(0).toUpperCase() + id.slice(1)}
                      Icon={STATIC_ICON[id]}
                      selected={selectedFilter === id}
                      onSelect={() => onSelectFilter(id)}
                      onContext={(x, y) => setContextMenu({ x, y, kind: 'category', categoryId: id })}
                    />
                  ))
                : serverCategories.map((cat) => (
                    <CategoryRow
                      key={cat.id}
                      id={cat.id}
                      name={cat.name}
                      Icon={iconForCategory(cat)}
                      selected={selectedFilter === cat.id}
                      onSelect={() => onSelectFilter(cat.id)}
                      onContext={(x, y) => setContextMenu({ x, y, kind: 'category', categoryId: cat.id })}
                    />
                  ))}
              {extraCategories.length > 0 && serverCategories.length === 0 && null}
              {/* User-created categories (when server list loaded, they're
                  already included above; this is only for the static fallback). */}
            </div>
          )}
        </div>

        {/* Unfinished */}
        <div className="pt-2 border-t border-neutral-200">
          <button
            type="button"
            onClick={() => onSelectFilter('unfinished')}
            onContextMenu={(e) => openContext(e, 'unfinished')}
            className={`w-full flex items-center px-2 py-1.5 rounded-md transition-colors ${
              selectedFilter === 'unfinished'
                ? 'bg-brand-tint text-brand font-semibold'
                : 'text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <Semi3DUnfinished className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('sidebar.unfinished')}</span>
            </div>
          </button>
        </div>

        {/* Finished */}
        <div>
          <button
            type="button"
            onClick={() => onSelectFilter('finished')}
            onContextMenu={(e) => openContext(e, 'finished')}
            className={`w-full flex items-center px-2 py-1.5 rounded-md transition-colors ${
              selectedFilter === 'finished'
                ? 'bg-brand-tint text-brand font-semibold'
                : 'text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <Semi3DFinished className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('sidebar.finished')}</span>
            </div>
          </button>
        </div>

        {/* Queues */}
        <div className="pt-2 border-t border-neutral-200">
          <button
            type="button"
            onClick={() => onSelectFilter('queues')}
            onContextMenu={(e) => openContext(e, 'queues')}
            className={`w-full flex items-center px-2 py-1.5 rounded-md transition-colors ${
              selectedFilter === 'queues'
                ? 'bg-brand-tint text-brand font-semibold'
                : 'text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <Semi3DQueues className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('sidebar.queues')}</span>
            </div>
          </button>
        </div>
      </div>

      {/* Sidebar context menus (one per row kind) */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[100] min-w-[150px] bg-white border border-neutral-400 rounded-[2px] shadow-[0_4px_16px_rgba(0,0,0,0.18)] py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {(contextMenu.kind === 'root' || contextMenu.kind === 'unfinished' || contextMenu.kind === 'finished' || contextMenu.kind === 'queues') && (
            <>
              {contextMenu.kind === 'unfinished' && (
                <>
                  <MenuItem label={t('sidebar.resumeAll')} onClick={() => { resumeAllUnfinished(); setContextMenu(null); }} />
                  <MenuItem label={t('sidebar.retryFailed')} onClick={() => { retryFailedDownloads(); setContextMenu(null); }} />
                  <MenuItem label={t('sidebar.pauseAllActive')} onClick={() => { pauseAllActive(); setContextMenu(null); }} />
                  <div className="h-[1px] bg-neutral-200 my-1 mx-2" />
                  <MenuItem label={t('sidebar.clearList')} danger onClick={() => { setContextMenu(null); requestClearList(['paused', 'error']); }} />
                </>
              )}
              {contextMenu.kind === 'finished' && (
                <MenuItem label={t('sidebar.clearList')} danger onClick={() => { setContextMenu(null); requestClearList(['completed']); }} />
              )}
              {contextMenu.kind === 'queues' && (
                <>
                  <MenuItem label={t('sidebar.startAllQueues')} onClick={() => { startAllQueues(); setContextMenu(null); }} />
                  <MenuItem label={t('sidebar.stopAllQueues')} onClick={() => { stopAllQueues(); setContextMenu(null); }} />
                </>
              )}
              {(contextMenu.kind === 'unfinished' || contextMenu.kind === 'finished') && (
                <>
                  <div className="h-[1px] bg-neutral-200 my-1 mx-2" />
                  <MenuItem label={t('sidebar.addCategory')} onClick={() => { addCategory(); setContextMenu(null); }} />
                </>
              )}
              {contextMenu.kind === 'root' && (
                <MenuItem label={t('sidebar.addCategory')} onClick={() => { addCategory(); setContextMenu(null); }} />
              )}
            </>
          )}
          {contextMenu.kind === 'category' && contextMenu.categoryId && (
            <>
              <MenuItem label={t('sidebar.browse')} onClick={() => { browseCategory(contextMenu.categoryId!); setContextMenu(null); }} />
              <MenuItem label={t('sidebar.properties')} onClick={() => { openProperties(contextMenu.categoryId!); setContextMenu(null); }} />
              <div className="h-[1px] bg-neutral-200 my-1 mx-2" />
              <MenuItem label={t('sidebar.addCategory')} onClick={() => { addCategory(); setContextMenu(null); }} />
              <MenuItem
                label={t('sidebar.deleteCategory')}
                danger
                disabled={classicIds.includes(contextMenu.categoryId)}
                title={classicIds.includes(contextMenu.categoryId) ? t('sidebar.deleteCategoryDisabled') : undefined}
                onClick={() => { deleteCategory(contextMenu.categoryId!); setContextMenu(null); }}
              />
            </>
          )}
        </div>
      )}

      <CategoryPropertiesDialog
        isOpen={isEditorOpen}
        category={editingCategory}
        onClose={() => setIsEditorOpen(false)}
        onSaved={refreshAfterChange}
      />

      {/* Confirmation before any Clear-list action (stray click protection),
          with an opt-in tick-box for deleting the files from disk too. */}
      <ClearListConfirmDialog
        isOpen={!!clearConfirm}
        count={clearConfirm?.count ?? 0}
        listName={clearConfirm?.listName ?? 'Unfinished'}
        onConfirm={(deleteFiles) => {
          if (clearConfirm) clearList(clearConfirm.statuses, deleteFiles);
          setClearConfirm(null);
        }}
        onCancel={() => setClearConfirm(null)}
      />
    </div>
  );
};

/* -------------------------------------------------------------------------- */

const CategoryRow: React.FC<{
  id: string;
  name: string;
  Icon: React.FC<{ className?: string }>;
  selected: boolean;
  onSelect: () => void;
  onContext: (x: number, y: number) => void;
}> = ({ name, Icon, selected, onSelect, onContext }) => (
  <button
    type="button"
    onClick={onSelect}
    onContextMenu={(e) => {
      e.preventDefault();
      e.stopPropagation();
      const PAD = 4;
      onContext(e.clientX + PAD, e.clientY + PAD);
    }}
    className={`w-full flex items-center px-2 py-1 rounded-md transition-colors ${
      selected
        ? 'bg-brand-tint text-brand font-semibold'
        : 'text-neutral-700 hover:bg-neutral-200'
    }`}
  >
    <div className="flex items-center gap-2 truncate">
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate">{name}</span>
    </div>
  </button>
);

const MenuItem: React.FC<{
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}> = ({ label, onClick, danger, disabled, title }) => (
  <button
    type="button"
    disabled={disabled}
    title={title}
    onClick={onClick}
    className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center justify-between cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
      danger
        ? 'text-status-error hover:bg-status-error hover:text-white disabled:hover:bg-transparent'
        : 'text-neutral-800 hover:bg-brand-glow hover:text-white disabled:hover:bg-transparent disabled:hover:text-neutral-800'
    }`}
  >
    <span>{label}</span>
  </button>
);
