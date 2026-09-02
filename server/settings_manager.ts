import fs from 'fs';
import path from 'path';

export interface AppSettings {
  defaultDownloadFolder: string;
  tempDownloadFolder: string;
  maxConcurrentDownloads: number;
  defaultConnections: number;
  autoStartDownloads: boolean;
  overwriteExisting: boolean;
  doubleClickAction: 'open_file' | 'open_folder' | 'properties';
  speedLimitBps: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultDownloadFolder: path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads'),
  tempDownloadFolder: path.join(process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Temp') : '.'), 'NogadexDownloads'),
  maxConcurrentDownloads: 3,
  defaultConnections: 32,
  autoStartDownloads: true,
  overwriteExisting: false,
  doubleClickAction: 'open_file',
  speedLimitBps: 0
};

export class SettingsManager {
  private static instance: SettingsManager | null = null;
  private settingsPath: string;
  private currentSettings: AppSettings;

  private constructor(storageDir?: string) {
    const dir = storageDir || path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    }
    this.settingsPath = path.join(dir, 'settings.json');
    this.currentSettings = { ...DEFAULT_SETTINGS };
    this.loadSettings();
  }

  public static getInstance(storageDir?: string): SettingsManager {
    if (!SettingsManager.instance || storageDir) {
      SettingsManager.instance = new SettingsManager(storageDir);
    }
    return SettingsManager.instance;
  }

  public getSettings(): AppSettings {
    return { ...this.currentSettings };
  }

  public updateSettings(partial: Partial<AppSettings>): AppSettings {
    const next = { ...this.currentSettings, ...partial };

    if (typeof next.maxConcurrentDownloads === 'number') {
      next.maxConcurrentDownloads = Math.max(1, Math.min(10, Math.floor(next.maxConcurrentDownloads)));
    }
    if (typeof next.defaultConnections === 'number') {
      next.defaultConnections = Math.max(1, Math.min(64, Math.floor(next.defaultConnections)));
    }
    if (typeof next.speedLimitBps === 'number') {
      next.speedLimitBps = Math.max(0, Math.floor(next.speedLimitBps));
    }
    if (!['open_file', 'open_folder', 'properties'].includes(next.doubleClickAction)) {
      next.doubleClickAction = 'open_file';
    }

    this.currentSettings = next;
    this.persistSettings();
    return this.getSettings();
  }

  private loadSettings(): void {
    if (!fs.existsSync(this.settingsPath)) {
      this.persistSettings();
      return;
    }

    try {
      const raw = fs.readFileSync(this.settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      this.currentSettings = {
        ...DEFAULT_SETTINGS,
        ...parsed
      };
    } catch (err) {
      console.warn('[Settings] Corrupted settings JSON encountered. Resetting to defaults.');
      try {
        const backupPath = `${this.settingsPath}.corrupted.${Date.now()}`;
        fs.renameSync(this.settingsPath, backupPath);
      } catch {}
      this.currentSettings = { ...DEFAULT_SETTINGS };
      this.persistSettings();
    }
  }

  private persistSettings(): void {
    const tempPath = `${this.settingsPath}.tmp`;
    const data = JSON.stringify(this.currentSettings, null, 2);
    try {
      fs.writeFileSync(tempPath, data, 'utf8');
      try {
        fs.renameSync(tempPath, this.settingsPath);
      } catch (renameErr) {
        // Fallback for Windows AV / indexer temporary file locks
        fs.copyFileSync(tempPath, this.settingsPath);
        try { fs.unlinkSync(tempPath); } catch {}
      }
    } catch (err) {
      console.error('[Settings] Failed to persist settings:', err);
    }
  }
}
