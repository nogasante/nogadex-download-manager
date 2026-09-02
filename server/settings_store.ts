import os from 'os';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

export interface CategoryRule {
  id: string;
  name: string;
  extensions: string[];
  defaultFolder: string;
}

export interface NogadexSettings {
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
  browser: {
    chromeEnabled: boolean;
    edgeEnabled: boolean;
    firefoxEnabled: boolean;
    autoInterceptDownloads: boolean;
    minSizeThresholdBytes: number;
  };
  clipboard: {
    monitoringEnabled: boolean;
    autoPromptOnUrl: boolean;
  };
  categories: CategoryRule[];
}

export const DEFAULT_NOGADEX_SETTINGS: NogadexSettings = {
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
    tempDownloadFolder: path.join(os.tmpdir(), 'NogadexDownloads'),
    maxConcurrentDownloads: 5,
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
  browser: {
    chromeEnabled: true,
    edgeEnabled: true,
    firefoxEnabled: false,
    autoInterceptDownloads: true,
    minSizeThresholdBytes: 0,
  },
  clipboard: {
    monitoringEnabled: false,
    autoPromptOnUrl: true,
  },
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
  private settings: NogadexSettings;

  constructor(customPath?: string) {
    super();
    if (customPath) {
      this.configPath = customPath;
    } else {
      const configDir = path.join(os.homedir(), '.nogadex');
      if (!fs.existsSync(configDir)) {
        try {
          fs.mkdirSync(configDir, { recursive: true });
        } catch {}
      }
      this.configPath = path.join(configDir, 'settings.json');
    }
    this.settings = this.load();
  }

  public getSettings(): NogadexSettings {
    return JSON.parse(JSON.stringify(this.settings));
  }

  public updateSettings(partial: any): NogadexSettings {
    const merged: NogadexSettings = {
      general: { ...this.settings.general, ...(partial.general || {}) },
      downloads: { ...this.settings.downloads, ...(partial.downloads || {}) },
      network: { ...this.settings.network, ...(partial.network || {}) },
      notifications: { ...this.settings.notifications, ...(partial.notifications || {}) },
      browser: { ...this.settings.browser, ...(partial.browser || {}) },
      clipboard: { ...this.settings.clipboard, ...(partial.clipboard || {}) },
      categories: partial.categories || this.settings.categories,
    };

    merged.downloads.maxConcurrentDownloads = Math.max(1, Math.min(20, Number(merged.downloads.maxConcurrentDownloads) || 5));
    merged.downloads.defaultConnections = Math.max(1, Math.min(64, Number(merged.downloads.defaultConnections) || 32));
    merged.network.globalSpeedLimitKB = Math.max(0, Number(merged.network.globalSpeedLimitKB) || 0);

    this.settings = merged;
    this.save();
    this.emit('change', this.getSettings());
    return this.getSettings();
  }

  public resetDefaults(): NogadexSettings {
    this.settings = JSON.parse(JSON.stringify(DEFAULT_NOGADEX_SETTINGS));
    this.save();
    this.emit('change', this.getSettings());
    return this.getSettings();
  }

  private load(): NogadexSettings {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          general: { ...DEFAULT_NOGADEX_SETTINGS.general, ...(parsed.general || {}) },
          downloads: { ...DEFAULT_NOGADEX_SETTINGS.downloads, ...(parsed.downloads || {}) },
          network: { ...DEFAULT_NOGADEX_SETTINGS.network, ...(parsed.network || {}) },
          notifications: { ...DEFAULT_NOGADEX_SETTINGS.notifications, ...(parsed.notifications || {}) },
          browser: { ...DEFAULT_NOGADEX_SETTINGS.browser, ...(parsed.browser || {}) },
          clipboard: { ...DEFAULT_NOGADEX_SETTINGS.clipboard, ...(parsed.clipboard || {}) },
          categories: parsed.categories && Array.isArray(parsed.categories) ? parsed.categories : DEFAULT_NOGADEX_SETTINGS.categories,
        };
      }
    } catch (err) {
      console.warn(`Failed to read settings from ${this.configPath}, falling back to defaults:`, err);
    }
    return JSON.parse(JSON.stringify(DEFAULT_NOGADEX_SETTINGS));
  }

  private save(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.configPath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.settings, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.configPath);
    } catch (err) {
      console.error(`Failed to atomically save settings to ${this.configPath}:`, err);
    }
  }
}
