/**
 * Centralized, Typed API Client for Nogadex Download Manager (NDM)
 */

import { DownloadItem, AppSettings, NewDownloadPayload } from '../types/download';
import { getApiBaseUrl, NDM_LOCAL_TOKEN } from '../config/apiConfig';

const getBase = () => `${getApiBaseUrl()}/api`;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${getBase()}${url}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-NDM-Token': NDM_LOCAL_TOKEN,
        ...(options?.headers || {}),
      },
      ...options,
    });
  } catch {
    // fetch only rejects on network-level failures: the NDM engine is not
    // reachable (not started yet, still starting up, or stopped).
    throw new Error('Cannot reach the NDM engine. Make sure NDM is running, then try again.');
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: res.statusText }));
    const detail = errorData?.error;
    // Bare status text ("Internal Server Error", "Bad Gateway", …) comes from
    // a proxy or a crashed handler and means nothing to a user — replace it.
    const useless = !detail || detail === res.statusText;
    if (useless && res.status >= 500) {
      throw new Error('The NDM engine could not complete this request. Try again in a moment.');
    }
    throw new Error(detail || `Request failed (HTTP ${res.status})`);
  }

  return res.json();
}

export const api = {
  downloads: {
    getAll: async (): Promise<DownloadItem[]> => {
      const data = await request<any>('/downloads');
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.downloads)) return data.downloads;
      return [];
    },
    create: async (payload: NewDownloadPayload): Promise<{ download: DownloadItem }> => {
      return request('/downloads', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    pause: async (id: string): Promise<void> => {
      await request(`/downloads/${id}/pause`, { method: 'POST' });
    },
    resume: async (id: string): Promise<void> => {
      await request(`/downloads/${id}/resume`, { method: 'POST' });
    },
    retryAllFailed: async (): Promise<{ success: boolean; retried: string[]; queued: number }> => {
      return request('/downloads/retry-failed', { method: 'POST' });
    },
    integrityScan: async (): Promise<import('../types/download').IntegrityScanReport> => {
      return request('/integrity-scan', { method: 'POST' });
    },
    delete: async (id: string, deleteFile?: boolean): Promise<void> => {
      await request(`/downloads/${id}${deleteFile ? '?deleteFile=true' : ''}`, { method: 'DELETE' });
    },
    setSpeedLimit: async (id: string, limitKB: number): Promise<void> => {
      await request(`/downloads/${id}/speed-limit`, {
        method: 'POST',
        body: JSON.stringify({ speedLimitKB: limitKB }),
      });
    },
    setConnections: async (id: string, connections: number): Promise<{ success: boolean; download?: DownloadItem }> => {
      return request(`/downloads/${id}/connections`, {
        method: 'POST',
        body: JSON.stringify({ connections }),
      });
    },
    updateUrl: async (id: string, url: string): Promise<{ success: boolean; download?: DownloadItem }> => {
      return request(`/downloads/${id}/update-url`, {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
    },
  },

  probe: async (url: string): Promise<{ contentLength: number; acceptRanges: boolean; filename?: string; finalUrl?: string }> => {
    return request(`/probe?url=${encodeURIComponent(url)}`);
  },

  /** Category management (sidebar context menu). */
  categories: {
    getAll: async (): Promise<Array<{ id: string; name: string; extensions: string[]; defaultFolder: string; sitesOnly?: string[]; rememberLastFolder?: boolean }>> => {
      return request('/categories');
    },
    save: async (cat: { id?: string; name: string; extensions?: string[] | string; defaultFolder?: string; sitesOnly?: string[] | string; rememberLastFolder?: boolean }): Promise<{ success: boolean; categories: unknown[] }> => {
      return request('/categories', {
        method: 'POST',
        body: JSON.stringify(cat),
      });
    },
    remove: async (id: string): Promise<{ success: boolean }> => {
      return request(`/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  },

  /** Open a folder in the OS file explorer (sidebar "Browse"). */
  openFolder: async (folderPath: string): Promise<{ success: boolean }> => {
    return request('/fs/open-folder', {
      method: 'POST',
      body: JSON.stringify({ folderPath }),
    });
  },

  /** Scheduler: queue start/stop + schedule persistence. */
  queues: {
    getAll: async (): Promise<Array<{ id: string; name: string }>> => {
      const data = await request<any>('/queues');
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.queues)) return data.queues;
      return [];
    },
    start: async (id: string): Promise<{ success: boolean }> => {
      return request(`/queues/${encodeURIComponent(id)}/start`, { method: 'POST' });
    },
    stop: async (id: string): Promise<{ success: boolean }> => {
      return request(`/queues/${encodeURIComponent(id)}/stop`, { method: 'POST' });
    },
    saveSchedule: async (id: string, payload: { schedule?: unknown; name?: string; maxConcurrent?: number }): Promise<unknown> => {
      return request(`/queues/${encodeURIComponent(id)}/schedule`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
  },

  /** "Download limits" (N MB per M hours). */
  volumeLimits: {
    get: async (): Promise<{ enabled: boolean; limitMB: number; periodHours: number; showWarning: boolean; usedMB: number }> => {
      return request('/volume-limits');
    },
    save: async (payload: { enabled?: boolean; limitMB?: number; periodHours?: number; showWarning?: boolean }): Promise<{ success: boolean; usedMB?: number }> => {
      return request('/volume-limits', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
  },

  /** Per-site authorization store (Site Logins). */
  credentials: {
    add: async (cred: { domain: string; authType?: 'basic' | 'bearer' | 'cookie' | 'custom'; username?: string; password?: string; token?: string; cookies?: string }): Promise<{ success: boolean }> => {
      return request('/credentials', {
        method: 'POST',
        body: JSON.stringify(cred),
      });
    },
    remove: async (domain: string): Promise<void> => {
      await request(`/credentials/${encodeURIComponent(domain)}`, { method: 'DELETE' });
    },
  },

  settings: {
    get: async (): Promise<any> => {
      return request('/settings');
    },
    save: async (settings: Partial<AppSettings>): Promise<any> => {
      return request('/settings', {
        method: 'POST',
        body: JSON.stringify(settings),
      });
    },
  },

  /** Remote-managed app particulars (links, contact, site URL). */
  /** Remote-managed app particulars (links, contact, site URL). */
  appConfig: {
    get: async (): Promise<import('../../shared/app_config').NdmAppConfig> => {
      const data = await request<{ config: import('../../shared/app_config').NdmAppConfig }>('/app-config');
      return data.config;
    },
  },

  diagnostics: {
    get: async (): Promise<any> => {
      return request('/diagnostics');
    },
  },

  history: {
    export: async (format: 'csv' | 'json' | 'text'): Promise<Blob> => {
      const res = await fetch(`${getBase()}/history/export?format=${format}`);
      if (!res.ok) throw new Error('Export failed');
      return res.blob();
    },
    import: async (data: string, format: 'csv' | 'json' | 'text'): Promise<{ success: boolean; count: number; importedCount?: number }> => {
      return request('/history/import', {
        method: 'POST',
        body: JSON.stringify({ data, format }),
      });
    },
  },

  fs: {
    checkFolder: async (folderPath: string): Promise<{ exists: boolean; isDirectory: boolean; path: string }> => {
      return request('/fs/check-folder', {
        method: 'POST',
        body: JSON.stringify({ folderPath }),
      });
    },
    createFolder: async (folderPath: string): Promise<{ success: boolean; path: string }> => {
      return request('/fs/create-folder', {
        method: 'POST',
        body: JSON.stringify({ folderPath }),
      });
    },
  },
};
