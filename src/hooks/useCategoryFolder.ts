import { useState, useEffect, useCallback } from 'react';
import { DownloadCategory, getFileCategory, buildCategoryFolderPath } from '../utils/fileUtils';
import { api } from '../api/client';
import { MessageBoxOptions } from '../components/MessageBoxDialog';
import { DEFAULT_DOWNLOAD_DIR } from '../config/appInfo';

interface UseCategoryFolderOptions {
  baseFolder: string;
  initialFolder?: string;
  url?: string;
  filename?: string;
}

export function useCategoryFolder({
  baseFolder,
  initialFolder,
  url,
  filename,
}: UseCategoryFolderOptions) {
  const [resolvedBase, setResolvedBase] = useState(baseFolder || DEFAULT_DOWNLOAD_DIR);
  const [folder, setFolder] = useState(initialFolder || baseFolder || DEFAULT_DOWNLOAD_DIR);
  const [hasUserManuallyEdited, setHasUserManuallyEdited] = useState(false);
  const [detectedCategory, setDetectedCategory] = useState<DownloadCategory>('all');
  const [msgBox, setMsgBox] = useState<MessageBoxOptions | null>(null);

  // Proactively resolve native user downloads path or server settings if baseFolder is empty
  useEffect(() => {
    if (baseFolder) {
      setResolvedBase(baseFolder);
    } else {
      if ((window as any).electronAPI?.getDownloadsPath) {
        (window as any).electronAPI.getDownloadsPath().then((p: string) => {
          if (p) setResolvedBase(p);
        }).catch(() => {});
      } else {
        api.settings.get().then((data) => {
          if (data?.downloads?.defaultDownloadFolder) {
            setResolvedBase(data.downloads.defaultDownloadFolder);
          }
        }).catch(() => {});
      }
    }
  }, [baseFolder]);

  // Update folder when category changes or baseFolder becomes available
  useEffect(() => {
    const category = getFileCategory(filename || url);
    setDetectedCategory(category);

    if (hasUserManuallyEdited) return;
    const targetBase = resolvedBase || baseFolder || DEFAULT_DOWNLOAD_DIR;
    if (!targetBase) return;
    const suggested = buildCategoryFolderPath(targetBase, category);
    if (suggested) {
      setFolder(suggested);
    }
  }, [resolvedBase, baseFolder, filename, url, hasUserManuallyEdited]);

  // Open Windows native folder browser dialog or fallback
  const handleBrowse = useCallback(async () => {
    try {
      if (window.electronAPI?.selectFolder) {
        const res = await window.electronAPI.selectFolder(folder || baseFolder);
        if (!res.canceled && res.folderPath) {
          setFolder(res.folderPath);
          setHasUserManuallyEdited(true);
          return res.folderPath;
        }
      }
    } catch (err) {
      console.warn('Native folder selection failed:', err);
    }
    return null;
  }, [folder, baseFolder]);

  // Verify folder existence; if non-existent, prompt user for permission to create or browse
  const verifyFolderPermission = useCallback(
    async (
      targetFolder: string,
      onProceed: (confirmedFolder: string) => Promise<void> | void
    ): Promise<boolean> => {
      const finalFolder = (targetFolder || folder || baseFolder || DEFAULT_DOWNLOAD_DIR).trim();
      if (!finalFolder) return false;

      let exists = false;
      try {
        if (window.electronAPI?.checkFolderExists) {
          const res = await window.electronAPI.checkFolderExists(finalFolder);
          exists = res.exists && res.isDirectory;
        } else {
          const res = await api.fs.checkFolder(finalFolder);
          exists = res.exists && res.isDirectory;
        }
      } catch {
        exists = false;
      }

      if (exists) {
        await onProceed(finalFolder);
        return true;
      }

      // Prompt user with native/Windows question dialog for missing folders
      return new Promise<boolean>((resolve) => {
        setMsgBox({
          title: 'Nogadex Download Manager',
          type: 'question',
          message: `The folder for this download does not exist:\n\n"${finalFolder}"\n\nWould you like to create this folder, or choose a different location?`,
          buttons: [
            {
              label: 'Create Folder',
              variant: 'primary',
              action: async () => {
                setMsgBox(null);
                try {
                  if (window.electronAPI?.createFolder) {
                    await window.electronAPI.createFolder(finalFolder);
                  } else {
                    await api.fs.createFolder(finalFolder);
                  }
                } catch (err) {
                  console.error('Failed to create directory:', err);
                }
                await onProceed(finalFolder);
                resolve(true);
              },
            },
            {
              label: 'Choose Location...',
              variant: 'secondary',
              action: async () => {
                setMsgBox(null);
                if (window.electronAPI?.selectFolder) {
                  const res = await window.electronAPI.selectFolder(baseFolder || DEFAULT_DOWNLOAD_DIR);
                  if (!res.canceled && res.folderPath) {
                    setFolder(res.folderPath);
                    setHasUserManuallyEdited(true);
                    await onProceed(res.folderPath);
                    resolve(true);
                    return;
                  }
                }
                resolve(false);
              },
            },
            {
              label: 'Cancel',
              variant: 'secondary',
              action: () => {
                setMsgBox(null);
                resolve(false);
              },
            },
          ],
        });
      });
    },
    [folder, baseFolder, handleBrowse]
  );

  return {
    folder,
    setFolder: (f: string) => {
      setFolder(f);
      setHasUserManuallyEdited(true);
    },
    detectedCategory,
    handleBrowse,
    verifyFolderPermission,
    msgBox,
    closeMsgBox: () => setMsgBox(null),
  };
}
