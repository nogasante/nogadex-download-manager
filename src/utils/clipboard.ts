/**
 * Shared URL extraction for clipboard text — single source of truth used by
 * NewDownloadDialog and BatchDownloadDialog. Server-side equivalents
 * (ClipboardMonitorEngine.parseClipboardText) apply the same rules.
 */

const URL_REGEX = /https?:\/\/[^\s"'<>()]+/g;

/**
 * Extract all unique http(s) URLs from arbitrary clipboard text.
 * Trims trailing punctuation that is rarely part of a URL.
 */
export function extractUrlsFromClipboard(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(URL_REGEX) || [];
  const cleaned = matches
    .map((url) => url.replace(/[.,;:!?]+$/, ''))
    .filter((url) => /^https?:\/\//i.test(url));
  return Array.from(new Set(cleaned));
}
