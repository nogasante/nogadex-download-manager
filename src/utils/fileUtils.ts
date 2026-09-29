/**
 * File & URL Utility Functions
 */

export type DownloadCategory = 'all' | 'compressed' | 'documents' | 'music' | 'programs' | 'video' | 'unfinished' | 'finished' | 'queues';

const EXTENSION_CATEGORIES: Record<string, DownloadCategory> = {
  // Compressed
  zip: 'compressed', rar: 'compressed', '7z': 'compressed', tar: 'compressed',
  gz: 'compressed', bz2: 'compressed', iso: 'compressed', dmg: 'compressed',
  // Documents
  pdf: 'documents', doc: 'documents', docx: 'documents', xls: 'documents',
  xlsx: 'documents', ppt: 'documents', pptx: 'documents', txt: 'documents',
  csv: 'documents', json: 'documents', xml: 'documents',
  // Music
  mp3: 'music', wav: 'music', flac: 'music', aac: 'music', ogg: 'music', m4a: 'music',
  // Programs
  exe: 'programs', msi: 'programs', bat: 'programs', cmd: 'programs',
  apk: 'programs', bin: 'programs', deb: 'programs', rpm: 'programs',
  // Video
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', wmv: 'video',
  flv: 'video', webm: 'video',
};

export const CATEGORY_SUBFOLDERS: Record<DownloadCategory, string> = {
  compressed: 'Compressed',
  documents: 'Documents',
  music: 'Music',
  programs: 'Programs',
  video: 'Video',
  all: '',
  unfinished: '',
  finished: '',
  queues: '',
};

export function getCategorySubfolder(category: DownloadCategory): string {
  return CATEGORY_SUBFOLDERS[category] || '';
}

export function buildCategoryFolderPath(baseFolder: string, category: DownloadCategory): string {
  if (!baseFolder) return '';
  const cleanBase = baseFolder.replace(/[/\\]+$/, '');
  const sub = getCategorySubfolder(category);
  if (!sub) return cleanBase;
  const sep = cleanBase.includes('/') && !cleanBase.includes('\\') ? '/' : '\\';
  return `${cleanBase}${sep}${sub}`;
}

/**
 * Extracts lowercase file extension from filename or path without dot
 */
export function getFileExtension(filename?: string): string {
  if (!filename) return '';
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts.pop()! : '';
}

/**
 * Returns the download category for a given filename
 */
export function getFileCategory(filename?: string): DownloadCategory {
  const ext = getFileExtension(filename);
  return EXTENSION_CATEGORIES[ext] || 'all';
}

/**
 * Extracts a clean filename from a URL
 */
export function extractFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const lastPart = u.pathname.split('/').pop() || '';
    return lastPart ? decodeURIComponent(lastPart) : '';
  } catch {
    const clean = url.split('?')[0].split('#')[0];
    const lastPart = clean.split('/').pop() || '';
    return lastPart ? decodeURIComponent(lastPart) : '';
  }
}

/**
 * Triggers a browser download of a Blob file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
