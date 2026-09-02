import express from 'express';
import { DownloadEngine } from './engine';
import { RulesEngine } from './rules_engine';
import { SettingsManager } from './settings_store';

export const NOGADEX_LOCAL_TOKEN = 'nogadex_local_secret_token';

export interface BridgeDiagnostics {
  bridgeActive: boolean;
  boundLoopback: string;
  authenticatedClients: number;
  totalInterceptions: number;
  lastInterceptionTimestamp: number | null;
}

export class NativeBridgeManager {
  private engine: DownloadEngine;
  private rulesEngine: RulesEngine;
  private settingsManager: SettingsManager;
  private totalInterceptions = 0;
  private lastInterceptionTime: number | null = null;

  constructor(engine: DownloadEngine, rulesEngine: RulesEngine, settingsManager: SettingsManager) {
    this.engine = engine;
    this.rulesEngine = rulesEngine;
    this.settingsManager = settingsManager;
  }

  public validateRequest(req: express.Request): { valid: boolean; error?: string } {
    const token = req.headers['x-nogadex-token'];
    const ip = req.ip || req.socket.remoteAddress;

    // Strict Loopback Security: Only 127.0.0.1 and ::1 allowed
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!isLoopback) {
      return { valid: false, error: 'Access forbidden: Native bridge is strictly local loopback only' };
    }

    if (token !== NOGADEX_LOCAL_TOKEN) {
      return { valid: false, error: 'Unauthorized: Invalid bridge token' };
    }

    return { valid: true };
  }

  public async handleDownloadCapture(payload: {
    url: string;
    referrer?: string;
    filename?: string;
    cookies?: string;
    userAgent?: string;
  }): Promise<any> {
    const { url, referrer, filename } = payload;
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      throw new Error('Valid HTTP/HTTPS URL required for takeover');
    }

    const settings = this.settingsManager.getSettings();
    if (!settings.browser.autoInterceptDownloads) {
      throw new Error('Browser download interception is disabled in settings');
    }

    // Evaluate Phase 9.2 Rules
    const ruleAction = this.rulesEngine.evaluate(url, filename || '');
    let finalDest = ruleAction?.destinationFolder || settings.downloads.defaultDownloadFolder || this.engine.defaultDownloadDir;
    let finalConn = ruleAction?.maxConnections || settings.downloads.defaultConnections || 32;

    if (!ruleAction) {
      const cat = this.rulesEngine.resolveCategory(filename || url, settings.categories, finalDest);
      finalDest = cat.destinationFolder;
    }

    this.totalInterceptions++;
    this.lastInterceptionTime = Date.now();

    const item = await this.engine.addDownload(url.trim(), filename, finalDest, finalConn);
    return item;
  }

  public getDiagnostics(): BridgeDiagnostics {
    return {
      bridgeActive: true,
      boundLoopback: '127.0.0.1:5005',
      authenticatedClients: 1,
      totalInterceptions: this.totalInterceptions,
      lastInterceptionTimestamp: this.lastInterceptionTime,
    };
  }
}
