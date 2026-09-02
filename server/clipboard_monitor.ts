import { EventEmitter } from 'events';
import { SettingsManager } from './settings_store';

export interface ClipboardMatch {
  url: string;
  matchedExtension?: string;
  suggestedFilename?: string;
  timestamp: number;
}

export class ClipboardMonitorEngine extends EventEmitter {
  private settingsManager: SettingsManager;
  private recentUrls: Map<string, number> = new Map(); // url -> timestamp
  private cooldownMs: number = 10000; // 10s duplicate cooldown

  constructor(settingsManager: SettingsManager) {
    super();
    this.settingsManager = settingsManager;
  }

  public parseClipboardText(text: string): ClipboardMatch[] {
    if (!text || typeof text !== 'string') return [];

    const settings = this.settingsManager.getSettings();
    if (!settings.clipboard.autoCapture) {
      return [];
    }

    const matches: ClipboardMatch[] = [];
    const urlRegex = /https?:\/\/[^\s"'>]+/gi;
    const rawMatches = text.match(urlRegex) || [];

    for (const rawUrl of rawMatches) {
      const cleanUrl = rawUrl.trim();
      
      // Cooldown check
      const lastSeen = this.recentUrls.get(cleanUrl);
      if (lastSeen && Date.now() - lastSeen < this.cooldownMs) {
        continue;
      }

      // Ignore host check
      if (this.isIgnoredHost(cleanUrl, settings.clipboard.ignoreDomains || [])) {
        continue;
      }

      // Extension filter check
      const ext = this.extractExtension(cleanUrl);
      const isDownloadable = this.matchesMonitoredExtensions(ext, settings.clipboard.monitoredExtensions || []);

      if (isDownloadable) {
        this.recentUrls.set(cleanUrl, Date.now());
        matches.push({
          url: cleanUrl,
          matchedExtension: ext,
          suggestedFilename: this.extractFilename(cleanUrl),
          timestamp: Date.now(),
        });
      }
    }

    return matches;
  }

  public isIgnoredHost(url: string, ignoredHosts: string[]): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return ignoredHosts.some(h => hostname === h.toLowerCase() || hostname.endsWith('.' + h.toLowerCase()));
    } catch {
      return false;
    }
  }

  public matchesMonitoredExtensions(ext: string, monitoredExtensions: string[]): boolean {
    if (!ext) return false;
    if (monitoredExtensions.length === 0) return true; // match all if empty
    const cleanExt = ext.toLowerCase().replace(/^\./, '');
    return monitoredExtensions.map(e => e.toLowerCase().replace(/^\./, '')).includes(cleanExt);
  }

  private extractExtension(url: string): string {
    try {
      const clean = url.split('?')[0].split('#')[0];
      const basename = clean.substring(clean.lastIndexOf('/') + 1);
      const dotIndex = basename.lastIndexOf('.');
      if (dotIndex > 0 && dotIndex < basename.length - 1) {
        return basename.slice(dotIndex + 1);
      }
    } catch {}
    return '';
  }

  private extractFilename(url: string): string {
    try {
      const clean = url.split('?')[0].split('#')[0];
      return clean.substring(clean.lastIndexOf('/') + 1) || 'download';
    } catch {
      return 'download';
    }
  }
}
