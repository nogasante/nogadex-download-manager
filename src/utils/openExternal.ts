/**
 * Opens a URL in the system browser.
 * In Electron this routes through a hardened IPC handler (https/http/mailto only);
 * in browser mode it falls back to window.open.
 */
export async function openExternal(url: string): Promise<void> {
  const api = (window as any).electronAPI;
  if (api?.openExternal) {
    try {
      await api.openExternal(url);
      return;
    } catch {
      // fall through to window.open
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
