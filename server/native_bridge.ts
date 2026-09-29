import express from 'express';
import { DownloadEngine } from './engine';
import { RulesEngine } from './rules_engine';
import { SettingsManager } from './settings_store';

export const NDM_LOCAL_TOKEN = 'ndm_local_secret_token';
export const NDM_BRIDGE_PROTOCOL = 1;

export interface BridgeMessageEnvelope<T = any> {
  protocolVersion: number;
  messageType: 'capture' | 'query' | 'status' | 'ping';
  requestId: string;
  payload: T;
}

export interface BridgeDiagnostics {
  bridgeActive: boolean;
  protocolVersion: number;
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
  /** Live extension presence per browser name → last heartbeat (ms epoch).
   *  Refreshed by policy polls and captures; expired after 5 minutes. */
  private extensionHeartbeats = new Map<string, number>();
  private static HEARTBEAT_TTL_MS = 5 * 60 * 1000;
  /**
   * Optional hook so the bridge can register intercepted downloads with the
   * queue scheduler without a circular dependency on it.
   */
  private onDownloadAdded?: (downloadId: string, ruleQueueId?: string) => void;

  constructor(
    engine: DownloadEngine,
    rulesEngine: RulesEngine,
    settingsManager: SettingsManager,
    onDownloadAdded?: (downloadId: string, ruleQueueId?: string) => void
  ) {
    this.engine = engine;
    this.rulesEngine = rulesEngine;
    this.settingsManager = settingsManager;
    this.onDownloadAdded = onDownloadAdded;
  }

  public validateRequest(req: express.Request): { valid: boolean; error?: string } {
    const token = req.headers['x-ndm-token'];
    const ip = req.ip || req.socket.remoteAddress;

    // Strict Loopback Security: Only 127.0.0.1 and ::1 allowed
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!isLoopback) {
      return { valid: false, error: 'Access forbidden: Native bridge is strictly local loopback only' };
    }

    if (token !== NDM_LOCAL_TOKEN) {
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
    /** Modifier keys held in the browser when the download started
     *  (from the extension's capture-keys feature): 'alt'|'ctrl'|'shift'|'meta'. */
    heldKeys?: string[];
    /** Browser that sent the capture, e.g. 'chrome' | 'firefox' | 'opera'. */
    browserName?: string;
  }): Promise<any> {
    const { url, referrer, filename, cookies, userAgent } = payload;
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      throw new Error('Valid HTTP/HTTPS URL required for takeover');
    }

    const settings = this.settingsManager.getSettings();

    // Record live presence for the Browser-tab status row.
    if (payload.browserName) {
      this.extensionHeartbeats.set(String(payload.browserName).toLowerCase(), Date.now());
    }

    // Capture keys: user-held modifiers override every other capture rule.
    // forceKeys = take it no matter what; preventKeys = leave it alone.
    // (If both match, prevent wins — the conservative choice.)
    const held = Array.isArray(payload.heldKeys)
      ? payload.heldKeys.map((k) => String(k).toLowerCase()).filter(Boolean)
      : [];
    const preventKeys: string[] = settings.browser.preventKeys || [];
    if (preventKeys.length > 0 && held.some((k) => preventKeys.includes(k))) {
      throw new Error(`Capture prevented by capture key (${held.join('+')})`);
    }
    const forceKeys: string[] = settings.browser.forceKeys || [];
    const forced = forceKeys.length > 0 && held.some((k) => forceKeys.includes(k));

    // Per-browser capture toggles: gate by the browser reported by the
    // extension. Unknown/absent names are treated as allowed (forward-compat).
    if (!forced && payload.browserName) {
      const b = settings.browser as any;
      const name = String(payload.browserName).toLowerCase();
      const flagMap: Record<string, boolean | undefined> = {
        chrome: b.chromeEnabled,
        edge: b.edgeEnabled,
        msedge: b.edgeEnabled,
        firefox: b.firefoxEnabled,
        opera: b.operaEnabled,
        brave: b.braveEnabled,
        vivaldi: b.vivaldiEnabled,
      };
      const flag = flagMap[name];
      if (flag === false) {
        throw new Error(`Capture disabled for this browser (${name}) in settings`);
      }
    }

    if (!settings.browser.autoInterceptDownloads && !forced) {
      throw new Error('Browser download interception is disabled in settings');
    }

    // Capture exception lists ("File types"): never take over
    // downloads whose file extension or host domain is explicitly excluded
    // (unless a force capture key is held).
    // Extension entries are normalized ("zip"/".zip", case-insensitive) at
    // settings-update time; match the URL path's final segment.
    const excludedExts: string[] = forced ? [] : ((settings.browser as any).excludedExtensions || []);
    if (excludedExts.length > 0) {
      try {
        const pathName = new URL(url).pathname;
        const ext = (pathName.match(/\.([A-Za-z0-9]+)$/) || [])[1];
        if (ext && excludedExts.includes(ext.toLowerCase())) {
          throw new Error(`Capture excluded by file type: .${ext.toLowerCase()}`);
        }
      } catch (e: any) {
        if (String(e.message).startsWith('Capture excluded')) throw e;
        // URL parse failure: fall through to domain check with hostname=''
      }
    }
    const excludedDomains: string[] = forced ? [] : ((settings.browser as any).excludedDomains || []);
    if (excludedDomains.length > 0) {
      let hostname = '';
      try { hostname = new URL(url).hostname.toLowerCase(); } catch { hostname = ''; }
      const isExcluded = excludedDomains.some((d) =>
        hostname === d || hostname.endsWith('.' + d)
      );
      if (isExcluded) {
        throw new Error(`Capture excluded by site: ${hostname}`);
      }
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

    // Forward browser-captured credentials to the engine so cookie-gated and
    // signed URLs download correctly. Cookies stay host-scoped in the engine.
    const item = await this.engine.addDownload(
      url.trim(),
      filename,
      finalDest,
      finalConn,
      {
        cookies: typeof cookies === 'string' && cookies.trim() ? cookies : undefined,
        userAgent: typeof userAgent === 'string' && userAgent.trim() ? userAgent : undefined,
        referrer: typeof referrer === 'string' && referrer.trim() ? referrer : undefined,
      }
    );
    // Register with the queue scheduler (rule queue wins, else default queue)
    this.onDownloadAdded?.(item.id, ruleAction?.queueId);
    return item;
  }

  public validateEnvelope(envelope: any): { valid: boolean; error?: string } {
    if (!envelope || typeof envelope !== 'object') {
      return { valid: false, error: 'Malformed message envelope' };
    }
    if (envelope.protocolVersion !== undefined && envelope.protocolVersion !== NDM_BRIDGE_PROTOCOL) {
      return {
        valid: false,
        error: `Incompatible native bridge protocol. Required: ${NDM_BRIDGE_PROTOCOL}, received: ${envelope.protocolVersion}. Please update browser extension.`,
      };
    }
    return { valid: true };
  }

  public getDiagnostics(): BridgeDiagnostics {
    return {
      bridgeActive: true,
      protocolVersion: NDM_BRIDGE_PROTOCOL,
      boundLoopback: '127.0.0.1:5005',
      authenticatedClients: 1,
      totalInterceptions: this.totalInterceptions,
      lastInterceptionTimestamp: this.lastInterceptionTime,
    };
  }

  /** Record live presence (called by the policy endpoint on each poll). */
  public recordHeartbeat(browserName: string): void {
    const name = String(browserName || '').toLowerCase();
    if (name) this.extensionHeartbeats.set(name, Date.now());
  }

  /** Browsers with a fresh heartbeat (extension connected & polling). */
  public getConnectedBrowsers(): Record<string, number> {
    const cutoff = Date.now() - NativeBridgeManager.HEARTBEAT_TTL_MS;
    for (const [name, at] of this.extensionHeartbeats) {
      if (at < cutoff) this.extensionHeartbeats.delete(name);
    }
    return Object.fromEntries(this.extensionHeartbeats);
  }
}
