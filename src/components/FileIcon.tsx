import React, { useState, useEffect } from 'react';
import {
  Semi3DZip,
  Semi3DDocument,
  Semi3DMusic,
  Semi3DProgram,
  Semi3DVideo,
  Semi3DFolder,
} from './CategoryIcons3D';
import { getApiBaseUrl } from '../config/apiConfig';

export interface FileIconProps {
  filename?: string;
  filePath?: string;
  className?: string;
}

// Global in-memory cache of extracted native Windows base64 icons
const memoryIconCache = new Map<string, string>();

export const FileIcon: React.FC<FileIconProps> = ({
  filename = '',
  filePath = '',
  className = 'w-4 h-4',
}) => {
  const parts = (filename || filePath).toLowerCase().split('.');
  const ext = parts.length > 1 ? parts.pop()! : '';
  const cacheKey = filePath || `ext:${ext}`;

  const [iconSrc, setIconSrc] = useState<string | null>(() => {
    return memoryIconCache.get(cacheKey) || null;
  });

  useEffect(() => {
    if (!cacheKey) return;
    if (memoryIconCache.has(cacheKey)) {
      setIconSrc(memoryIconCache.get(cacheKey)!);
      return;
    }

    let isMounted = true;
    const fetchNativeIcon = async () => {
      try {
        if (window.electronAPI?.getFileIcon) {
          const dataUrl = await window.electronAPI.getFileIcon({ filePath, filename });
          if (dataUrl) {
            if (isMounted) {
              memoryIconCache.set(cacheKey, dataUrl);
              setIconSrc(dataUrl);
            }
            return;
          }
        }
        // Unified OS icon API fallback
        const res = await fetch(
          `${getApiBaseUrl()}/api/icon?ext=${encodeURIComponent(ext)}&filename=${encodeURIComponent(filename)}&filePath=${encodeURIComponent(filePath)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (isMounted && data?.icon) {
            memoryIconCache.set(cacheKey, data.icon);
            setIconSrc(data.icon);
          }
        }
      } catch {}
    };

    fetchNativeIcon();

    return () => {
      isMounted = false;
    };
  }, [cacheKey, filePath, filename]);

  // If native Windows application icon or executable icon is available, display it
  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        alt=""
        className={`${className} object-contain shrink-0 select-none pointer-events-none`}
        onError={() => setIconSrc(null)}
      />
    );
  }

  // High-fidelity semi-3D vector fallback matching file extension category
  if (['exe', 'msi', 'bat', 'cmd', 'apk', 'bin'].includes(ext)) {
    return <Semi3DProgram className={className} />;
  }
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso', 'dmg'].includes(ext)) {
    return <Semi3DZip className={className} />;
  }
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'].includes(ext)) {
    return <Semi3DVideo className={className} />;
  }
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) {
    return <Semi3DMusic className={className} />;
  }
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'json', 'xml'].includes(ext)) {
    return <Semi3DDocument className={className} />;
  }

  return <Semi3DFolder className={className} />;
};
