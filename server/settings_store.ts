import os from 'os';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { SoundSettings } from './event_sounds';
import { encryptSecret, decryptSecret } from './secret_cipher';

export interface CategoryRule {
  id: string;
  name: string;
  extensions: string[];
  defaultFolder: string;
}

export interface NDMSettings {
  general: {
    startupWithWindows: boolean;
    minimizeToTray: boolean;
    closeBehavior: 'tray' | 'exit';
    confirmationPrompts: boolean;
    doubleClickAction: 'open_file' | 'open_folder' | 'properties';
    language: string;
  };
  downloads: {
    defaultDownloadFolder: string;
    tempDownloadFolder: string;
    maxConcurrentDownloads: number;
    defaultConnections: number;
    autoStartDownloads: boolean;
    duplicateHandling: 'ask' | 'overwrite' | 'rename' | 'skip';
    downloadPriority: 'high' | 'normal' | 'low';
    cleanCompletedFiles: boolean;
  };
  network: {
    globalSpeedLimitEnabled: boolean;
    globalSpeedLimitKB: number;
    speedMode: 'unlimited' | 'balanced' | 'limited';
    connectionTimeoutMs: number;
    readTimeoutMs: number;
    maxRetries: number;
    retryDelayMs: number;
    smartMode: boolean;
  };
  notifications: {
    enabled: boolean;
    notifyOnComplete: boolean;
    notifyOnFail: boolean;
    notifyOnQueueFinish: boolean;
    soundEnabled: boolean;
  };
  /** Sounds tab: per-event sound configuration (server/tests). */
  sounds: SoundSettings;
  browser: {
    chromeEnabled: boolean;
    edgeEnabled: boolean;
    firefoxEnabled: boolean;
    operaEnabled: boolean;
    braveEnabled: boolean;
    vivaldiEnabled: boolean;
    /** Chromium-family browsers share one extension id; these flags gate
     *  capture per reported browser name. Firefox runs its own extension. */
    autoInterceptDownloads: boolean;
    minSizeThresholdBytes: number;
    /** Modifier keys held in the browser when a download starts:
     *  - forceKeys: capture into NDM even if the browser/exception list says no
     *  - preventKeys: leave the download to the browser even if NDM would take it
     *  Values: 'alt' | 'ctrl' | 'shift' | 'meta' (empty = no override). */
    forceKeys: string[];
    preventKeys: string[];
    /** Show the in-page floating download panel on media/file pages. */
    showDownloadPanel: boolean;
    /** Context-menu items the extension shows (extension polls these). */
    contextMenu: {
      downloadLink: boolean;
      downloadMedia: boolean;
      downloadAllLinks: boolean;
    };
    /** File extensions the bridge never captures (empty = capture all).
     *  Entries may be "zip" or ".zip"; case-insensitive. */
    excludedExtensions: string[];
    /** Domains the bridge never captures (matches subdomains), e.g.
     *  "update.microsoft.com". */
    excludedDomains: string[];
  };
  clipboard: {
    monitoringEnabled: boolean;
    autoPromptOnUrl: boolean;
    /** Master switch evaluated by ClipboardMonitorEngine.parseClipboardText */
    autoCapture: boolean;
    /** Hosts whose URLs are never suggested from the clipboard */
    ignoreDomains: string[];
    /** File extensions the clipboard monitor treats as downloadable (empty = all) */
    monitoredExtensions: string[];
  };
  /** Downloads → Save To tab: auto-route files into category subfolders */
  autoCategorize: boolean;
  /** Downloads → Save To tab: remember the last folder used per category */
  rememberLastFolder: boolean;
  /** Proxy & site-logins subsystem (ProxyAuthManager state), persisted */
  proxy: {
    enabled: boolean;
    type: 'http' | 'https' | 'socks4' | 'socks5';
    host: string;
    port: number;
    username?: string;
    password?: string;
  };
  siteCredentials: Array<{
    id: string;
    domain: string;
    authType: 'basic' | 'bearer' | 'cookie' | 'custom';
    username?: string;
    password?: string;
    token?: string;
    cookies?: string;
    customHeaders?: Record<string, string>;
  }>;
  categories: CategoryRule[];
  /** Scheduler: persisted queue definitions incl. schedules. */
  queues: Array<{
    id: string;
    name: string;
    maxConcurrent: number;
    schedule: {
      enabled: boolean;
      startAtTime?: string;
      stopAtTime?: string;
      daysOfWeek: number[];
      actionOnComplete: 'none' | 'stop_queue' | 'pause_queue' | 'notification' | 'shutdown';
      maxRetries: number;
    };
  }>;
  /** "Download limits": stop downloads after N MB per period. */
  volumeLimits: {
    enabled: boolean;
    /** Quota in megabytes per period. */
    limitMB: number;
    /** Period length in hours. */
    periodHours: number;
    /** Warn (toast/balloon) before stopping downloads. */
    showWarning: boolean;
  };
  /** Sliding-window byte ledger used to enforce volumeLimits across restarts. */
  volumeLedger: Array<{ at: number; bytes: number }>;
}

export const DEFAULT_NDM_SETTINGS: NDMSettings = {
  general: {
    startupWithWindows: false,
    minimizeToTray: true,
    closeBehavior: 'tray',
    confirmationPrompts: true,
    doubleClickAction: 'open_folder',
    language: 'en-US',
  },
  downloads: {
    defaultDownloadFolder: path.join(os.homedir(), 'Downloads'),
    tempDownloadFolder: path.join(os.tmpdir(), 'NDMDownloads'),
    maxConcurrentDownloads: 0, // 0 = unlimited (default)
    defaultConnections: 32,
    autoStartDownloads: true,
    duplicateHandling: 'overwrite',
    downloadPriority: 'normal',
    cleanCompletedFiles: false,
  },
  network: {
    globalSpeedLimitEnabled: false,
    globalSpeedLimitKB: 0,
    speedMode: 'unlimited',
    connectionTimeoutMs: 15000,
    readTimeoutMs: 30000,
    maxRetries: 5,
    retryDelayMs: 2000,
    smartMode: true,
  },
  notifications: {
    enabled: true,
    notifyOnComplete: true,
    notifyOnFail: true,
    notifyOnQueueFinish: true,
    soundEnabled: false,
  },
  sounds: {
    downloadComplete: { enabled: true, file: '' },
    downloadFailed: { enabled: true, file: '' },
    queueStarted: { enabled: false, file: '' },
    queueStopped: { enabled: false, file: '' },
  },
  browser: {
    chromeEnabled: true,
    edgeEnabled: true,
    firefoxEnabled: false,
    operaEnabled: true,
    braveEnabled: true,
    vivaldiEnabled: true,
    autoInterceptDownloads: true,
    minSizeThresholdBytes: 0,
    forceKeys: [],
    preventKeys: [],
    showDownloadPanel: true,
    contextMenu: {
      downloadLink: true,
      downloadMedia: true,
      downloadAllLinks: true,
    },
    excludedExtensions: [],
    excludedDomains: [],
  },
  clipboard: {
    monitoringEnabled: false,
    autoPromptOnUrl: true,
    autoCapture: true,
    ignoreDomains: [],
    monitoredExtensions: [],
  },
  autoCategorize: true,
  rememberLastFolder: true,
  proxy: {
    enabled: false,
    type: 'http',
    host: '127.0.0.1',
    port: 8080,
  },
  siteCredentials: [],
  queues: [],
  volumeLimits: {
    enabled: false,
    limitMB: 200,
    periodHours: 5,
    showWarning: true,
  },
  volumeLedger: [],
  categories: [
    { id: 'compressed', name: 'Compressed', extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso'], defaultFolder: path.join(os.homedir(), 'Downloads', 'Compressed') },
    { id: 'documents', name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'epub', 'xlsx', 'pptx'], defaultFolder: path.join(os.homedir(), 'Downloads', 'Documents') },
    { id: 'music', name: 'Music', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'], defaultFolder: path.join(os.homedir(), 'Downloads', 'Music') },
    { id: 'programs', name: 'Programs', extensions: ['exe', 'msi', 'dmg', 'apk', 'deb', 'rpm', 'bin'], defaultFolder: path.join(os.homedir(), 'Downloads', 'Programs') },
    { id: 'video', name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv'], defaultFolder: path.join(os.homedir(), 'Downloads', 'Video') },
  ],
};

export class SettingsManager extends EventEmitter {
  private configPath: string;
  private settings: NDMSettings;

  constructor(customPath?: string) {
    super();
    if (customPath) {
      this.configPath = customPath;
    } else {
      const configDir = path.join(os.homedir(), '.ndm');
      const legacyDir = path.join(os.homedir(), '.nogadex');
      if (!fs.existsSync(configDir)) {
        try {
          fs.mkdirSync(configDir, { recursive: true });
          // One-time migration: adopt settings from the legacy ~/.nogadex dir
          // so existing users keep their configuration. The old dir is left
          // untouched on disk.
          const legacySettings = path.join(legacyDir, 'settings.json');
          if (fs.existsSync(legacySettings)) {
            fs.copyFileSync(legacySettings, path.join(configDir, 'settings.json'));
          }
        } catch {}
      }
      this.configPath = path.join(configDir, 'settings.json');
    }
    this.settings = this.load();
  }

  public getSettings(): NDMSettings {
    return JSON.parse(JSON.stringify(this.settings));
  }

  public updateSettings(partial: any): NDMSettings {
    const flatGeneral: any = {};
    if (partial.doubleClickAction !== undefined) flatGeneral.doubleClickAction = partial.doubleClickAction;

    const flatDownloads: any = {};
    if (partial.defaultDownloadFolder !== undefined) flatDownloads.defaultDownloadFolder = partial.defaultDownloadFolder;
    if (partial.defaultFolder !== undefined) flatDownloads.defaultDownloadFolder = partial.defaultFolder;
    if (partial.tempDownloadFolder !== undefined) flatDownloads.tempDownloadFolder = partial.tempDownloadFolder;
    if (partial.tempDir !== undefined) flatDownloads.tempDownloadFolder = partial.tempDir;
    if (partial.maxConcurrentDownloads !== undefined) flatDownloads.maxConcurrentDownloads = partial.maxConcurrentDownloads;
    if (partial.defaultConnections !== undefined) flatDownloads.defaultConnections = partial.defaultConnections;
    if (partial.autoStartDownloads !== undefined) flatDownloads.autoStartDownloads = partial.autoStartDownloads;
    if (partial.overwriteExisting !== undefined) flatDownloads.duplicateHandling = partial.overwriteExisting ? 'overwrite' : 'ask';

    const flatNetwork: any = {};
    if (partial.speedLimitBps !== undefined) {
      flatNetwork.globalSpeedLimitEnabled = partial.speedLimitBps > 0;
      flatNetwork.globalSpeedLimitKB = Math.round(partial.speedLimitBps / 1024);
    }

    const merged: NDMSettings = {
      general: { ...this.settings.general, ...(partial.general || {}), ...flatGeneral },
      downloads: { ...this.settings.downloads, ...(partial.downloads || {}), ...flatDownloads },
      network: { ...this.settings.network, ...(partial.network || {}), ...flatNetwork },
      notifications: { ...this.settings.notifications, ...(partial.notifications || {}) },
      sounds: partial.sounds
        ? { ...this.settings.sounds, ...partial.sounds }
        : this.settings.sounds,
      browser: {
        ...this.settings.browser,
        ...(partial.browser || {}),
        contextMenu: partial.browser?.contextMenu
          ? { ...this.settings.browser.contextMenu, ...partial.browser.contextMenu }
          : this.settings.browser.contextMenu,
        forceKeys: Array.isArray(partial.browser?.forceKeys)
          ? partial.browser.forceKeys.map((k: unknown) => String(k).toLowerCase()).filter((k: string) => ['alt', 'ctrl', 'shift', 'meta'].includes(k))
          : this.settings.browser.forceKeys,
        preventKeys: Array.isArray(partial.browser?.preventKeys)
          ? partial.browser.preventKeys.map((k: unknown) => String(k).toLowerCase()).filter((k: string) => ['alt', 'ctrl', 'shift', 'meta'].includes(k))
          : this.settings.browser.preventKeys,
        excludedExtensions: Array.isArray(partial.browser?.excludedExtensions)
          ? partial.browser.excludedExtensions.map((e: unknown) => String(e).replace(/^\.+/, '').toLowerCase()).filter(Boolean)
          : (partial.browser ? this.settings.browser.excludedExtensions : this.settings.browser.excludedExtensions),
        excludedDomains: Array.isArray(partial.browser?.excludedDomains)
          ? partial.browser.excludedDomains.map((d: unknown) => String(d).trim().toLowerCase()).filter(Boolean)
          : (partial.browser ? this.settings.browser.excludedDomains : this.settings.browser.excludedDomains),
      },
      clipboard: { ...this.settings.clipboard, ...(partial.clipboard || {}) },
      autoCategorize: partial.autoCategorize !== undefined ? Boolean(partial.autoCategorize) : this.settings.autoCategorize,
      rememberLastFolder: partial.rememberLastFolder !== undefined ? Boolean(partial.rememberLastFolder) : this.settings.rememberLastFolder,
      proxy: partial.proxy ? { ...this.settings.proxy, ...partial.proxy } : this.settings.proxy,
      siteCredentials: Array.isArray(partial.siteCredentials) ? partial.siteCredentials : this.settings.siteCredentials,
      categories: partial.categories || this.settings.categories,
      queues: Array.isArray(partial.queues) ? partial.queues : this.settings.queues,
      volumeLimits: partial.volumeLimits
        ? { ...this.settings.volumeLimits, ...partial.volumeLimits }
        : this.settings.volumeLimits,
      volumeLedger: Array.isArray(partial.volumeLedger) ? partial.volumeLedger : this.settings.volumeLedger,
    };

    const rawMaxConcurrent = Number(merged.downloads.maxConcurrentDownloads);
    merged.downloads.maxConcurrentDownloads = isNaN(rawMaxConcurrent) ? 0 : Math.max(0, Math.floor(rawMaxConcurrent));
    const rawDefaultConns = Number(merged.downloads.defaultConnections);
    // 0 is a valid value meaning "Auto" — the engine picks the stream count.
    merged.downloads.defaultConnections = isNaN(rawDefaultConns) || rawDefaultConns < 0
      ? 32
      : Math.min(64, Math.floor(rawDefaultConns));
    merged.network.globalSpeedLimitKB = Math.max(0, Number(merged.network.globalSpeedLimitKB) || 0);

    this.settings = merged;
    this.save();
    this.emit('change', this.getSettings());
    return this.getSettings();
  }

  public resetDefaults(): NDMSettings {
    this.settings = JSON.parse(JSON.stringify(DEFAULT_NDM_SETTINGS));
    this.save();
    this.emit('change', this.getSettings());
    return this.getSettings();
  }

  private load(): NDMSettings {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        const loaded: NDMSettings = {
          general: { ...DEFAULT_NDM_SETTINGS.general, ...(parsed.general || {}) },
          downloads: { ...DEFAULT_NDM_SETTINGS.downloads, ...(parsed.downloads || {}) },
          network: { ...DEFAULT_NDM_SETTINGS.network, ...(parsed.network || {}) },
          notifications: { ...DEFAULT_NDM_SETTINGS.notifications, ...(parsed.notifications || {}) },
          sounds: { ...DEFAULT_NDM_SETTINGS.sounds, ...(parsed.sounds || {}) },
          browser: {
            ...DEFAULT_NDM_SETTINGS.browser,
            ...(parsed.browser || {}),
            contextMenu: {
              ...DEFAULT_NDM_SETTINGS.browser.contextMenu,
              ...(parsed.browser?.contextMenu || {}),
            },
            forceKeys: Array.isArray(parsed.browser?.forceKeys) ? parsed.browser.forceKeys : [],
            preventKeys: Array.isArray(parsed.browser?.preventKeys) ? parsed.browser.preventKeys : [],
            excludedExtensions: Array.isArray(parsed.browser?.excludedExtensions) ? parsed.browser.excludedExtensions : [],
            excludedDomains: Array.isArray(parsed.browser?.excludedDomains) ? parsed.browser.excludedDomains : [],
          },
          clipboard: { ...DEFAULT_NDM_SETTINGS.clipboard, ...(parsed.clipboard || {}) },
          autoCategorize: parsed.autoCategorize !== undefined ? Boolean(parsed.autoCategorize) : true,
          rememberLastFolder: parsed.rememberLastFolder !== undefined ? Boolean(parsed.rememberLastFolder) : true,
          proxy: { ...DEFAULT_NDM_SETTINGS.proxy, ...(parsed.proxy || {}) },
          siteCredentials: Array.isArray(parsed.siteCredentials) ? parsed.siteCredentials : [],
          categories: parsed.categories && Array.isArray(parsed.categories) ? parsed.categories : DEFAULT_NDM_SETTINGS.categories,
          queues: Array.isArray(parsed.queues) ? parsed.queues : [],
          volumeLimits: { ...DEFAULT_NDM_SETTINGS.volumeLimits, ...(parsed.volumeLimits || {}) },
          volumeLedger: Array.isArray(parsed.volumeLedger) ? parsed.volumeLedger : [],
        };
        // Sanitize stale mock path 'C:\Downloads' to actual Windows user Downloads folder
        if (loaded.downloads.defaultDownloadFolder === 'C:\\Downloads' || !loaded.downloads.defaultDownloadFolder) {
          loaded.downloads.defaultDownloadFolder = path.join(os.homedir(), 'Downloads');
        }
        loaded.sounds = { ...DEFAULT_NDM_SETTINGS.sounds, ...(parsed.sounds || {}) };
        // Secret material is ciphertext-at-rest when a master key is provided
        // (NDM_SECRET_KEY from the Electron host). Legacy plaintext values load
        // unchanged and get re-encrypted on the next save.
        if (loaded.proxy?.password) loaded.proxy.password = decryptSecret(loaded.proxy.password);
        loaded.siteCredentials = (loaded.siteCredentials || []).map((c) => ({
          ...c,
          password: c.password ? decryptSecret(c.password) : c.password,
          token: c.token ? decryptSecret(c.token) : c.token,
          cookies: c.cookies ? decryptSecret(c.cookies) : c.cookies,
        }));
        return loaded;
      }
    } catch (err) {
      console.warn(`Failed to read settings from ${this.configPath}, falling back to defaults:`, err);
    }
    return JSON.parse(JSON.stringify(DEFAULT_NDM_SETTINGS));
  }

  private save(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.configPath}.tmp.${Date.now()}`;
      // Encrypt secret fields on the way out; the in-memory copy stays plaintext.
      const serializable = JSON.parse(JSON.stringify(this.settings));
      if (serializable.proxy?.password) serializable.proxy.password = encryptSecret(serializable.proxy.password);
      serializable.siteCredentials = (serializable.siteCredentials || []).map((c: any) => ({
        ...c,
        password: c.password ? encryptSecret(c.password) : c.password,
        token: c.token ? encryptSecret(c.token) : c.token,
        cookies: c.cookies ? encryptSecret(c.cookies) : c.cookies,
      }));
      fs.writeFileSync(tmpPath, JSON.stringify(serializable, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.configPath);
    } catch (err) {
      console.error(`Failed to atomically save settings to ${this.configPath}:`, err);
    }
  }
}
