import React, { useEffect, useRef, useState } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { WinInput, WinButton, WinCheckbox } from './common/WinControls';
import { api } from '../api/client';

export interface EditableCategory {
  id?: string;
  name: string;
  extensions: string[];
  defaultFolder: string;
  sitesOnly?: string[];
  rememberLastFolder?: boolean;
}

interface CategoryPropertiesDialogProps {
  isOpen: boolean;
  /** Undefined = creating a new category. */
  category?: EditableCategory | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Category properties editing:
 *  - Category name
 *  - Automatically put in this category the following file types
 *  - ...files from the following sites only (glob hosts)
 *  - Save future downloads of this category to the following folder
 *  - Remember last save path
 */
export const CategoryPropertiesDialog: React.FC<CategoryPropertiesDialogProps> = ({
  isOpen,
  category,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState('');
  const [extensions, setExtensions] = useState('');
  const [sitesOnly, setSitesOnly] = useState('');
  const [folder, setFolder] = useState('');
  const [rememberLastFolder, setRememberLastFolder] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(category?.name || '');
    setExtensions((category?.extensions || []).join(' '));
    setSitesOnly((category?.sitesOnly || []).join(' '));
    setFolder(category?.defaultFolder || '');
    setRememberLastFolder(Boolean(category?.rememberLastFolder));
    setError('');
    // Select the name so it's ready to type over.
    setTimeout(() => nameRef.current?.select(), 60);
  }, [isOpen, category]);

  const pickFolder = async () => {
    const electron = (window as any).electronAPI;
    if (electron?.selectFolder) {
      const picked = await electron.selectFolder(folder || undefined);
      if (picked) setFolder(picked);
    }
  };

  const handleOk = async () => {
    if (!name.trim()) {
      setError('Please enter a category name.');
      return;
    }
    if (!extensions.trim() && !sitesOnly.trim()) {
      setError('Add at least one file type or one site for this category.');
      return;
    }
    setSaving(true);
    try {
      await api.categories.save({
        id: category?.id,
        name: name.trim(),
        extensions: extensions.trim(),
        sitesOnly: sitesOnly.trim(),
        defaultFolder: folder.trim(),
        rememberLastFolder,
      });
      setSaving(false);
      onSaved();
      onClose();
    } catch (err: any) {
      setSaving(false);
      setError(err?.message || 'Failed to save the category.');
    }
  };

  return (
    <WindowsDialog
      isOpen={isOpen}
      onClose={onClose}
      title={category ? 'Editing category properties' : 'New category properties'}
      width="w-[520px]"
      footer={
        <div className="w-full flex items-center justify-end gap-2">
          <WinButton variant="primary" onClick={handleOk} disabled={saving} className="min-w-[84px]">
            OK
          </WinButton>
          <WinButton variant="secondary" onClick={onClose} className="min-w-[84px]">
            Cancel
          </WinButton>
        </div>
      }
    >
      <div className="space-y-3 font-sans text-[12px]">
        <div className="space-y-1">
          <label className="text-neutral-600">Category name</label>
          <WinInput
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-[28px]"
            autoFocus
          />
        </div>

        <div className="space-y-1">
          <label className="text-neutral-600">Automatically put in this category the following file types:</label>
          <WinInput
            type="text"
            value={extensions}
            onChange={(e) => setExtensions(e.target.value)}
            placeholder="mp3 wav wma mp4 avi mkv zip rar"
            className="w-full h-[28px] font-mono text-[11.5px]"
          />
          <div className="text-[11px] text-neutral-500">
            Note: type file extensions separated by space (e.g. avi mpg mpeg)
          </div>
        </div>

        <div className="h-[1px] bg-neutral-200" />

        <div className="space-y-1">
          <WinCheckbox
            checked={Boolean(sitesOnly.trim())}
            onChange={(v) => { if (!v) setSitesOnly(''); }}
            label="Automatically put in this category the files from the following sites only:"
          />
          <WinInput
            type="text"
            value={sitesOnly}
            onChange={(e) => setSitesOnly(e.target.value)}
            disabled={!sitesOnly.trim() && false}
            placeholder="Separate sites by spaces; You may use asterisk as a wildcard pattern"
            className="w-full h-[28px] font-mono text-[11.5px]"
          />
        </div>

        <div className="h-[1px] bg-neutral-200" />

        <div className="space-y-1">
          <div className="text-[12px] text-brand-glow font-medium">
            Save future downloads of this category to the following folder:
          </div>
          <div className="flex gap-2">
            <WinInput
              type="text"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="C:\Users\...\Downloads\Music"
              className="flex-1 h-[28px] text-[11.5px]"
            />
            <WinButton variant="secondary" onClick={pickFolder} className="min-w-[86px] h-[28px]">
              Browse...
            </WinButton>
          </div>
        </div>

        <WinCheckbox
          checked={rememberLastFolder}
          onChange={setRememberLastFolder}
          label="Remember last save path"
        />

        {error && (
          <div className="text-status-error text-[11.5px] font-medium">{error}</div>
        )}
      </div>
    </WindowsDialog>
  );
};
