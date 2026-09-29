import http from 'http';
import https from 'https';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { URL } from 'url';

export function createSSRFSafeLookup(allowLocalhost: boolean = true) {
  return (hostname: string, options: any, callback: (err: Error | null, address: any, family: number) => void) => {
    dns.lookup(hostname, options, (err: any, address: any, family: any) => {
      if (err) return callback(err, address, family);
      if (!allowLocalhost) {
        // Node >= 20 (Happy Eyeballs / autoSelectFamily) may request all
        // addresses, in which case the callback receives an array of
        // { address, family } records. Validate EVERY resolved address —
        // a mixed clean/forbidden resolution must still be blocked.
        const resolved: string[] = Array.isArray(address)
          ? address.map((a: any) => (typeof a === 'string' ? a : a?.address)).filter(Boolean)
          : [String(address)];
        // validateUrl parses `http://<ip>`: bare IPv6 needs brackets or URL
        // parsing throws and would wrongly classify public IPv6 as forbidden.
        const toIpUrl = (ip: string) => `http://${ip.includes(':') && !ip.startsWith('[') ? `[${ip}]` : ip}`;
        for (const ip of resolved) {
          const ipValidation = validateUrl(toIpUrl(ip), false);
          if (!ipValidation.valid) {
            return callback(new Error(`DNS Rebinding / SSRF blocked: ${hostname} resolved to forbidden IP ${ip}`), '', 4);
          }
        }
      }
      callback(null, address, family);
    });
  };
}
import { DownloadItem, ChunkProgress } from '../src/types/download';
import { verifyFile, IntegrityVerdict } from './integrity_scanner';
import { BoundedWriteQueue } from './write_queue';
import { DynamicRangeScheduler } from './scheduler';
import { HostIntelligence } from './host_intelligence';
import { AdaptiveConcurrencyController } from './adaptive_concurrency';
import { ChunkOptimizer } from './chunk_optimizer';
import { SpeedLimiter } from './speed_limiter';
import { ProxyAuthManager } from './proxy_auth_manager';
import { Http2Transport } from './h2_client';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export function validateUrl(rawUrl: string, allowLocalhost: boolean = true): { valid: boolean; error?: string; url?: URL } {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string' };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    return { valid: false, error: 'Malformed URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Unsupported protocol: ${parsed.protocol}. Only http: and https: are allowed.` };
  }

  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.substring(1, hostname.length - 1);
  }

  // Port checks
  if (parsed.port) {
    const p = parseInt(parsed.port, 10);
    if (isNaN(p) || p < 1 || p > 65535) {
      return { valid: false, error: `Invalid port: ${parsed.port}` };
    }
    const BLOCKED_PORTS = new Set([22, 25, 135, 137, 138, 139, 445]);
    if (BLOCKED_PORTS.has(p)) {
      return { valid: false, error: `Port ${p} is blocked for security.` };
    }
  }

  if (!allowLocalhost) {
    // 1. Loopback & unspecified
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '::' ||
      hostname === '0:0:0:0:0:0:0:1' ||
      hostname === '0000:0000:0000:0000:0000:0000:0000:0001'
    ) {
      return { valid: false, error: 'Access to loopback/localhost is forbidden.' };
    }

    // 2. Cloud metadata IP (AWS/GCP/Azure)
    if (hostname === '169.254.169.254' || hostname.startsWith('169.254.') || hostname.includes('169.254.169.254')) {
      return { valid: false, error: 'Access to cloud metadata address is forbidden.' };
    }

    // 3. IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or WHATWG hex normalized ::ffff:a9fe:a9fe)
    if (hostname.startsWith('::ffff:') || hostname.startsWith('0:0:0:0:0:ffff:')) {
      const cleanMapped = hostname.startsWith('::ffff:') ? hostname.substring(7) : hostname.substring(15);
      let v4Ip: string | null = null;
      if (cleanMapped.includes('.')) {
        v4Ip = cleanMapped;
      } else {
        const hexParts = cleanMapped.split(':');
        if (hexParts.length === 2) {
          const p0 = parseInt(hexParts[0], 16);
          const p1 = parseInt(hexParts[1], 16);
          const b0 = (p0 >> 8) & 0xff;
          const b1 = p0 & 0xff;
          const b2 = (p1 >> 8) & 0xff;
          const b3 = p1 & 0xff;
          v4Ip = `${b0}.${b1}.${b2}.${b3}`;
        }
      }
      if (v4Ip) {
        const v4Validation = validateUrl(`http://${v4Ip}`, false);
        if (!v4Validation.valid) {
          return { valid: false, error: `Access to private IPv4-mapped IPv6 address is forbidden (${v4Ip}).` };
        }
      }
    }

    // 4. Standard IPv4 CIDR checks
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const b0 = parseInt(ipMatch[1], 10);
      const b1 = parseInt(ipMatch[2], 10);
      if (b0 === 10) return { valid: false, error: 'Access to private network (10.0.0.0/8) is forbidden.' };
      if (b0 === 172 && b1 >= 16 && b1 <= 31) return { valid: false, error: 'Access to private network (172.16.0.0/12) is forbidden.' };
      if (b0 === 192 && b1 === 168) return { valid: false, error: 'Access to private network (192.168.0.0/16) is forbidden.' };
      if (b0 === 127) return { valid: false, error: 'Access to loopback network (127.0.0.0/8) is forbidden.' };
      if (b0 === 0) return { valid: false, error: 'Access to 0.0.0.0 is forbidden.' };
    }

    // 5. IPv6 Link-Local (fe80::/10) and Unique Local Addresses (fc00::/7 -> fc00..fdff)
    if (
      hostname.startsWith('fe8') ||
      hostname.startsWith('fe9') ||
      hostname.startsWith('fea') ||
      hostname.startsWith('feb') ||
      hostname.startsWith('fc') ||
      hostname.startsWith('fd')
    ) {
      return { valid: false, error: 'Access to private/link-local IPv6 address is forbidden.' };
    }
  }

  return { valid: true, url: parsed };
}

import { PerformanceTelemetryTracker, DownloadTelemetry } from './performance_metrics';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 256 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 256 });

/** Socket tuning for the h1 path. Called on the response socket of
 *  every download/probe request (idempotent, so keep-alive reuse is fine):
 *  - setNoDelay: Nagle off, so Range requests and ACK-coupled writes are not
 *    delayed by coalescing — shaves latency on the request/first-byte path.
 *  - setKeepAlive: compatible with the agent's keepAlive pooling.
 *  Buffer-size APIs are intentionally NOT touched: Node's defaults track the
 *  OS autotuning window, and forcing 4 MB regresses on constrained links. */
function tuneH1Socket(sock: import('net').Socket | undefined | null) {
  if (!sock) return;
  // A/B kill-switch (NDM_SOCKET_TUNING=0) for benchmark isolation.
  if (process.env.NDM_SOCKET_TUNING === '0') return;
  try { sock.setNoDelay(true); } catch { /* socket may be closing */ }
  try { sock.setKeepAlive(true, 30000); } catch { /* ignore */ }
}

/** Transient transport faults where the connection is already dead: an
 * immediate Range-resume reconnect is byte-safe, so a courtesy delay only
 * idles the worker. (429/503 are deliberately NOT matched: those carry
 * server-mandated backoff and keep the exponential path.) */
const TRANSIENT_DROP_PATTERN = /Premature EOF|ECONNRESET|socket hang up|EPIPE|ECONNABORTED|Inactivity Timeout|Connection Timeout|Headers Timeout|ETIMEDOUT|EAI_AGAIN/i;

/**
 * Per-config proxy agents (http/https/socks). Rebuilt only when the proxy
 * configuration changes, so chunk requests reuse pooled sockets.
 */
let cachedProxyKey = '';
let cachedProxyAgents: { http: http.Agent; https: http.Agent } | null = null;

function getProxyAgents(proxy: { enabled: boolean; type: string; host: string; port: number; username?: string; password?: string }): { http: http.Agent; https: http.Agent } | null {
  if (!proxy.enabled || !proxy.host) return null;
  const key = `${proxy.type}://${proxy.host}:${proxy.port}?u=${proxy.username || ''}&p=${proxy.password || ''}`;
  if (key === cachedProxyKey && cachedProxyAgents) return cachedProxyAgents;
  const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@` : '';
  const uri =
    proxy.type === 'socks5' || proxy.type === 'socks4'
      ? `socks://${auth}${proxy.host}:${proxy.port}`
      : `${proxy.type === 'https' ? 'https' : 'http'}://${auth}${proxy.host}:${proxy.port}`;
  if (proxy.type === 'socks5' || proxy.type === 'socks4') {
    const socksAgent = new SocksProxyAgent(uri) as unknown as http.Agent;
    cachedProxyAgents = { http: socksAgent, https: socksAgent };
  } else if (proxy.type === 'https') {
    const httpsProxy = new HttpsProxyAgent(uri) as unknown as http.Agent;
    cachedProxyAgents = { http: new HttpProxyAgent(uri.replace('https://', 'http://')) as unknown as http.Agent, https: httpsProxy };
  } else {
    const httpProxy = new HttpProxyAgent(uri) as unknown as http.Agent;
    const httpsProxy = new HttpsProxyAgent(uri.replace('http://', 'https://')) as unknown as http.Agent;
    cachedProxyAgents = { http: httpProxy, https: httpsProxy };
  }
  cachedProxyKey = key;
  return cachedProxyAgents;
}

/** Host capability extension: does this origin negotiate HTTP/2 (ALPN h2)? */
export interface H2Support {
  supportsHttp2?: boolean;
}

export class DownloadEngine {
  /**
   * Optional proxy/auth layer (wired by server.ts). When set, every transfer
   * request goes through the configured proxy agent and inherits site-login
   * Authorization/Cookie headers for matching domains.
   */
  public proxyAuth: ProxyAuthManager | null = null;
  public downloads: Map<string, DownloadItem> = new Map();

  public getAllDownloads(): DownloadItem[] {
    return Array.from(this.downloads.values());
  }
  private abortControllers: Map<string, AbortController[]> = new Map();
  private fileDescriptors: Map<string, number> = new Map();
  private writeQueues: Map<string, BoundedWriteQueue> = new Map();
  private schedulers: Map<string, DynamicRangeScheduler> = new Map();
  private adaptiveControllers: Map<string, AdaptiveConcurrencyController> = new Map();
  private activeWorkersPromise: Map<string, Promise<any>> = new Map();
  private speedIntervals: Map<string, NodeJS.Timeout> = new Map();
  private chunkOptimizers: Map<string, ChunkOptimizer> = new Map();
  private telemetryTrackers: Map<string, PerformanceTelemetryTracker> = new Map();
  private checkpointTimer: NodeJS.Timeout | null = null;
  private stateFilePath: string;
  // Test hook (HYPER_STALL_MS): override the 6s inactivity timeout so stall
  // recovery tests can run deterministically in milliseconds.
  private stallTimeoutMs = Number(process.env.HYPER_STALL_MS) > 0
    ? Number(process.env.HYPER_STALL_MS)
    : 6000;
  // Integrity scan baselines: row id → last observed SHA-256 for content the
  // generator registry does not cover. Lets later scans detect drift.
  private integrityBaseline: Map<string, string>;
  private stateTmpFilePath: string;
  public allowLocalhost: boolean = true;
  public defaultDownloadDir: string;
  public maxQueueBytes: number = 32 * 1024 * 1024; // 32 MB
  public hostIntelligence: HostIntelligence = HostIntelligence.getInstance();
  public globalSpeedLimiter: SpeedLimiter = new SpeedLimiter(0);
  public maxConcurrentDownloads: number = 0; // 0 = unlimited / limitless (default)
  /** HTTP/2 multiplexed range transport (shared across all downloads).
   *  Gated per-origin by an ALPN probe cached in HostIntelligence. */
  public http2Transport: Http2Transport = new Http2Transport();
  private itemSpeedLimiters: Map<string, SpeedLimiter> = new Map();
  private onUpdateCallback: () => void = () => {};

  public getActiveCount(): number {
    let active = 0;
    for (const d of this.downloads.values()) {
      if (d.status === 'downloading' || d.status === 'probing') {
        active++;
      }
    }
    return active;
  }

  public checkNextQueuedDownload(): void {
    if (this.maxConcurrentDownloads > 0 && this.getActiveCount() >= this.maxConcurrentDownloads) {
      return;
    }
    for (const d of this.downloads.values()) {
      if (d.status === 'queued') {
        this.startDownload(d.id);
        if (this.maxConcurrentDownloads > 0 && this.getActiveCount() >= this.maxConcurrentDownloads) {
          break;
        }
      }
    }
  }

  public setMaxConcurrentDownloads(limit: number): void {
    this.maxConcurrentDownloads = Math.max(0, Math.floor(limit));
    this.checkNextQueuedDownload();
    this.notify();
  }

  public setGlobalSpeedLimit(maxKBps: number): void {
    this.globalSpeedLimiter.setLimit(maxKBps);
  }

  public setDownloadSpeedLimit(id: string, maxKBps: number): void {
    const item = this.downloads.get(id);
    if (!item) return;
    item.speedLimitKB = maxKBps;
    let limiter = this.itemSpeedLimiters.get(id);
    if (!limiter) {
      limiter = new SpeedLimiter(maxKBps);
      this.itemSpeedLimiters.set(id, limiter);
    } else {
      limiter.setLimit(maxKBps);
    }
    this.notify();
  }

  constructor(onUpdate?: () => void, customDownloadDir?: string, maxQueueBytes?: number, options?: { allowLocalhost?: boolean }) {
    if (onUpdate) this.onUpdateCallback = onUpdate;
    if (maxQueueBytes) this.maxQueueBytes = maxQueueBytes;
    if (options && options.allowLocalhost !== undefined) this.allowLocalhost = options.allowLocalhost;
    // Test isolation (HYPER_TEST_STATE_DIR): when set, engines constructed
    // WITHOUT an explicit download dir are sandboxed away from the user's
    // real Downloads folder — otherwise such suites load/save the user's real
    // .hyper_state.json (the source of phantom test rows in production lists).
    // An explicit customDownloadDir always wins: tests that pass tmp dirs
    // deliberately assert state in those dirs.
    const testStateDir = process.env.HYPER_TEST_STATE_DIR;
    this.defaultDownloadDir = customDownloadDir
      || testStateDir
      || path.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(this.defaultDownloadDir)) {
      try {
        fs.mkdirSync(this.defaultDownloadDir, { recursive: true });
      } catch {}
    }

    this.stateFilePath = path.join(this.defaultDownloadDir, '.hyper_state.json');
    this.stateTmpFilePath = path.join(this.defaultDownloadDir, '.hyper_state.json.tmp');
    this.integrityBaseline = new Map();
    this.loadState();
    this.loadIntegrityLedger();
    this.startPeriodicCheckpoint();
  }

  public setUpdateListener(callback: () => void) {
    this.onUpdateCallback = callback;
  }

  /**
   * Read an item's status without TypeScript's literal narrowing. Status
   * changes asynchronously (workers, abort handlers, user actions), so
   * checks against 'paused'/'error' must always see the full union.
   */
  private statusOf(item: DownloadItem): DownloadItem['status'] {
    return item.status;
  }

  private notify() {
    if (typeof this.onUpdateCallback === 'function') {
      this.onUpdateCallback();
    }
  }

  public parseContentDisposition(disposition?: string): string | null {
    if (!disposition || typeof disposition !== 'string') return null;

    // 1. Check RFC 5987 / RFC 6266 extended format: filename*=charset'lang'encoded-value
    const extMatch = disposition.match(/filename\*\s*=\s*(?:UTF-8|ISO-8859-1)?''([^;]+)/i);
    if (extMatch && extMatch[1]) {
      try {
        const decoded = decodeURIComponent(extMatch[1].trim().replace(/^["']|["']$/g, ''));
        if (decoded) return decoded;
      } catch {}
    }

    // 2. Check standard format with quoted string: filename="..."
    const quotedMatch = disposition.match(/filename\s*=\s*"([^"]+)"/i);
    if (quotedMatch && quotedMatch[1]) {
      try {
        return decodeURIComponent(quotedMatch[1].trim());
      } catch {
        return quotedMatch[1].trim();
      }
    }

    // 3. Check unquoted format: filename=somefile.ext
    const unquotedMatch = disposition.match(/filename\s*=\s*([^;\s]+)/i);
    if (unquotedMatch && unquotedMatch[1]) {
      const raw = unquotedMatch[1].trim().replace(/^["']|["']$/g, '');
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }

    return null;
  }

  public extractFilenameFromUrlPath(url: string, contentType?: string): string {
    try {
      const parsed = new URL(url);
      // Check URL query parameters: ?filename=, ?file=, ?name=, ?response-content-disposition=
      const qParams = ['filename', 'file', 'name', 'as', 'response-content-disposition'];
      for (const p of qParams) {
        const val = parsed.searchParams.get(p);
        if (val) {
          if (p === 'response-content-disposition') {
            const fromDisp = this.parseContentDisposition(val);
            if (fromDisp) return fromDisp;
          } else if (val.includes('.')) {
            return decodeURIComponent(val);
          }
        }
      }

      const pathname = parsed.pathname;
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        const last = decodeURIComponent(segments[segments.length - 1]);
        if (last.includes('.') && !last.endsWith('.')) {
          return last;
        }
        // If last segment has no extension, check if any earlier segment does
        for (let i = segments.length - 2; i >= 0; i--) {
          const seg = decodeURIComponent(segments[i]);
          if (seg.includes('.') && !seg.endsWith('.')) {
            return seg;
          }
        }
      }
    } catch {}

    // Fallback with extension based on Content-Type if known
    let ext = '';
    if (contentType) {
      const mime = contentType.split(';')[0].trim().toLowerCase();
      const mimeMap: Record<string, string> = {
        'application/zip': '.zip',
        'application/x-zip-compressed': '.zip',
        'application/x-rar-compressed': '.rar',
        'application/x-7z-compressed': '.7z',
        'application/x-tar': '.tar',
        'application/gzip': '.gz',
        'application/x-iso9660-image': '.iso',
        'application/pdf': '.pdf',
        'video/mp4': '.mp4',
        'video/x-matroska': '.mkv',
        'audio/mpeg': '.mp3',
        'application/x-msdownload': '.exe',
      };
      if (mimeMap[mime]) ext = mimeMap[mime];
    }

    return `download_${Date.now()}${ext || '.bin'}`;
  }

  public sanitizeFilename(filename: string): string {
    if (!filename || typeof filename !== 'string') return `download_${Date.now()}.bin`;
    // Normalize Unicode to canonical composition (NFC)
    let clean = filename.normalize('NFC');
    // Strip null bytes, control chars, and invisible Unicode formatting
    clean = clean.replace(/[\x00-\x1F\x7F\u200B-\u200D\uFEFF]/g, '').trim();
    if (clean.includes('?')) clean = clean.split('?')[0];
    if (clean.includes('#')) clean = clean.split('#')[0];
    // Strip path traversal and path separators
    clean = clean.replace(/\.{2,}/g, '_');
    clean = clean.replace(/[\\/]/g, '_');
    // Strip invalid Windows/POSIX filename characters: < > : " | ? *
    clean = clean.replace(/[<>:"|?*]/g, '_');
    // Strip leading/trailing dots or spaces
    clean = clean.replace(/^[. ]+|[. ]+$/g, '');

    // Check for Windows reserved names: CON, PRN, AUX, NUL, COM1..COM9, LPT1..LPT9
    const reservedMatch = clean.match(/^([a-zA-Z0-9]{3,4})(\..*)?$/);
    if (reservedMatch) {
      const baseUpper = reservedMatch[1].toUpperCase();
      const RESERVED = new Set(['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9']);
      if (RESERVED.has(baseUpper)) {
        clean = '_' + clean;
      }
    }

    if (!clean || clean.length === 0) {
      clean = `download_${Date.now()}.bin`;
    }

    // Limit length to 255 chars
    if (clean.length > 255) {
      const ext = path.extname(clean);
      const base = path.basename(clean, ext);
      clean = base.substring(0, Math.max(1, 255 - ext.length)) + ext;
    }

    return clean;
  }

  public resolveSafeDestination(folder: string, filename: string): { folder: string; filename: string; fullPath: string } {
    const cleanName = this.sanitizeFilename(filename);
    const targetFolder = path.resolve(folder || this.defaultDownloadDir);
    const resolvedPath = path.resolve(targetFolder, cleanName);

    // Verify it does not escape targetFolder
    if (!resolvedPath.startsWith(targetFolder + path.sep) && resolvedPath !== targetFolder) {
      throw new Error(`Path traversal attempt detected: ${filename}`);
    }

    return { folder: targetFolder, filename: cleanName, fullPath: resolvedPath };
  }

  /**
   * Case-insensitive row lookup by exact URL (Windows paths/URLs are
   * case-insensitive in practice; comparing case-insensitively avoids two
   * rows for the same URL differing only by letter case).
   */
  private findRowByUrl(url: string): DownloadItem | undefined {
    const needle = url.trim().toLowerCase();
    return Array.from(this.downloads.values()).find((d) => d.url.toLowerCase() === needle);
  }

  /**
   * Like resolveSafeDestination, but never returns a path that is already
   * claimed by an existing download row or present on disk: it appends
   * " (1)", " (2)", ... before the extension until the path is free.
   * This closes the other half of the duplicate-URL truncation bug: two
   * different URLs pointing at the same filename can no longer write to the
   * same path concurrently.
   */
  private findFreeDestination(folder: string, filename: string): { folder: string; filename: string; fullPath: string } {
    const base = this.resolveSafeDestination(folder, filename);
    const isTaken = (p: string) =>
      fs.existsSync(p) ||
      Array.from(this.downloads.values()).some(
        (d) => d.destinationPath.toLowerCase() === p.toLowerCase()
      );
    let fullPath = base.fullPath;
    let n = 1;
    while (isTaken(fullPath)) {
      const ext = path.extname(base.filename);
      const stem = base.filename.slice(0, base.filename.length - ext.length);
      fullPath = path.join(base.folder, `${stem} (${n})${ext}`);
      n++;
    }
    return { folder: base.folder, filename: path.basename(fullPath), fullPath };
  }

  /**
   * Pick a filename in `dir` that neither another download row claims nor an
   * existing disk file occupies (the row's own current path is always
   * allowed). Used by the probe-time rename: without it, two rows whose
   * server hints resolve to the same Content-Disposition name — or a rename
   * onto an unrelated file on disk — would clobber one path with 'r+' +
   * ftruncate writes.
   */
  private pickNonCollidingName(dir: string, desiredName: string, selfId: string, selfCurrentPath?: string): string {
    const selfPath = selfCurrentPath?.toLowerCase();
    const taken = (p: string) => {
      if (selfPath && p.toLowerCase() === selfPath) return false;
      if (fs.existsSync(p)) return true;
      return Array.from(this.downloads.values()).some(
        (d) => d.id !== selfId && d.destinationPath.toLowerCase() === p.toLowerCase()
      );
    };
    if (!taken(path.join(dir, desiredName))) return desiredName;
    const ext = path.extname(desiredName);
    const stem = desiredName.slice(0, desiredName.length - ext.length);
    let n = 1;
    let candidate = '';
    do {
      candidate = `${stem} (${n})${ext}`;
      n++;
    } while (taken(path.join(dir, candidate)));
    return candidate;
  }

  public loadState() {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        let items: DownloadItem[] = [];
        try {
          items = JSON.parse(raw);
        } catch (parseErr) {
          console.error('[Engine] Corrupted state JSON encountered. Backing up and resetting.');
          try {
            fs.renameSync(this.stateFilePath, `${this.stateFilePath}.corrupted_${Date.now()}`);
          } catch (e) {}
          return;
        }

        for (const item of items) {
          if (!item.id || !item.destinationPath) continue;

          if (fs.existsSync(item.destinationPath)) {
            const stat = fs.statSync(item.destinationPath);
            if (item.status === 'completed' && item.totalBytes > 0 && stat.size < item.totalBytes) {
              item.status = 'paused';
            }
          } else {
            if (item.status === 'completed' || item.status === 'downloading' || item.status === 'paused') {
              item.status = 'error';
              item.error = 'Destination file missing from disk';
              item.downloadedBytes = 0;
              if (item.chunks) {
                item.chunks.forEach(c => {
                  c.downloadedBytes = 0;
                  c.status = 'idle';
                });
              }
            }
          }

          if (item.status === 'downloading' || item.status === 'probing') {
            item.status = 'paused';
          }
          item.speedBps = 0;
          this.downloads.set(item.id, item);
        }
      }
    } catch (e) {
      console.error('[Engine] Failed to load state file:', e);
    }
  }

  public saveState() {
    try {
      // Credentials are deliberately excluded: state files must never contain
      // session cookies or other browser-captured secrets.
      const items = Array.from(this.downloads.values()).map(({ browserCredentials, ...d }) => ({
        ...d,
        speedBps: 0,
      }));
      const serialized = JSON.stringify(items, null, 2);
      fs.writeFileSync(this.stateTmpFilePath, serialized, 'utf-8');
      fs.renameSync(this.stateTmpFilePath, this.stateFilePath);
    } catch (e) {
      console.error('[Engine] Failed atomic state persistence:', e);
    }
  }

  private startPeriodicCheckpoint() {
    if (this.checkpointTimer) clearInterval(this.checkpointTimer);
    this.checkpointTimer = setInterval(() => {
      const hasActive = Array.from(this.downloads.values()).some(d => d.status === 'downloading');
      if (hasActive) {
        this.saveState();
      }
    }, 2000);
  }

  public async shutdown(): Promise<void> {
    const activeDownloads = Array.from(this.downloads.values()).filter(i => i.status === 'downloading' || i.status === 'probing');
    for (const item of activeDownloads) {
      try {
        await this.pauseDownload(item.id);
      } catch (e) {}
    }
    this.saveState();
    this.destroy();
  }

  public getDiagnosticSnapshot() {
    const mem = process.memoryUsage();
    const items = Array.from(this.downloads.values());
    const telemetries: Record<string, any> = {};
    this.telemetryTrackers.forEach((tracker, id) => {
      telemetries[id] = tracker.finalize();
    });

    return {
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rssMB: Math.round(mem.rss / (1024 * 1024)),
        heapUsedMB: Math.round(mem.heapUsed / (1024 * 1024)),
        heapTotalMB: Math.round(mem.heapTotal / (1024 * 1024)),
        externalMB: Math.round(mem.external / (1024 * 1024)),
      },
      downloadsCount: items.length,
      activeDownloadsCount: items.filter(i => i.status === 'downloading').length,
      pausedCount: items.filter(i => i.status === 'paused').length,
      completedCount: items.filter(i => i.status === 'completed').length,
      errorCount: items.filter(i => i.status === 'error').length,
      activeWriteQueues: this.writeQueues.size,
      activeWorkersCount: this.activeWorkersPromise.size,
      telemetry: telemetries,
    };
  }

  public destroy() {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }
    // Clean all active speed intervals
    for (const [, interval] of this.speedIntervals.entries()) {
      clearInterval(interval);
    }
    this.speedIntervals.clear();

    this.abortControllers.forEach(controllers => {
      controllers.forEach(c => {
        try { c.abort(); } catch (e) {}
      });
    });
    this.abortControllers.clear();
    this.writeQueues.forEach(wq => {
      try { wq.destroy(); } catch (e) {}
    });
    this.writeQueues.clear();
    this.http2Transport.destroy();
  }

  public getWriteQueueStats(id: string) {
    const queue = this.writeQueues.get(id);
    return queue ? queue.getStats() : null;
  }

  public getScheduler(id: string) {
    return this.schedulers.get(id) || null;
  }

  public getAdaptiveController(id: string) {
    return this.adaptiveControllers.get(id) || null;
  }

  public getDownloadTelemetry(id: string): DownloadTelemetry | null {
    const tracker = this.telemetryTrackers.get(id);
    if (!tracker) return null;
    return tracker.finalize();
  }

  public getHostIntelligence(): HostIntelligence {
    return this.hostIntelligence;
  }

  private detectCategory(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    if (['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv'].includes(ext)) return 'video';
    if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'].includes(ext)) return 'audio';
    if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.iso'].includes(ext)) return 'compressed';
    if (['.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm', '.apk'].includes(ext)) return 'program';
    if (['.pdf', '.docx', '.doc', '.xlsx', '.pptx', '.txt', '.epub'].includes(ext)) return 'document';
    return 'other';
  }

  public async addDownload(
    url: string,
    customFilename?: string,
    customFolder?: string,
    connections: number = 32,
    credentials?: { cookies?: string; userAgent?: string; referrer?: string; origin?: string }
  ): Promise<DownloadItem> {
    // connections === 0 is the "Auto" sentinel: the engine decides the optimal
    // stream count per download (see startDownload). Store as 32 here so the
    // item record carries a sane display value; actual usage adapts below.
    const isAutoStreams = connections === 0;
    const id = 'hyp_' + Math.random().toString(36).substring(2, 9);
    const urlValidation = validateUrl(url, this.allowLocalhost);
    if (!urlValidation.valid) {
      throw new Error(`Invalid download URL: ${urlValidation.error}`);
    }

    // Duplicate-URL policy: the same URL always maps to ONE row.
    //  - error/queued  → retry that row in place (see below)
    //  - anything else (downloading/probing/paused/completed) → skip: return
    //    the existing row untouched. This is what prevents the classic bug of
    //    a second pipeline truncating or double-writing an existing file.
    const trimmedUrl = url.trim();
    const existingSameUrl = this.findRowByUrl(trimmedUrl);
    if (existingSameUrl && existingSameUrl.status !== 'error' && existingSameUrl.status !== 'queued') {
      return existingSameUrl;
    }
    const existingRetry = existingSameUrl;
    if (existingRetry) {
      // A user-typed filename in the new request wins over the stored one —
      // but never onto a path another row or disk file already owns.
      if (customFilename && customFilename.trim() && customFilename.trim() !== existingRetry.filename) {
        const retryDir = path.dirname(existingRetry.destinationPath);
        const cleanRetryName = this.pickNonCollidingName(
          retryDir,
          this.sanitizeFilename(customFilename.trim()),
          existingRetry.id,
          existingRetry.destinationPath
        );
        existingRetry.filename = cleanRetryName;
        existingRetry.destinationPath = path.join(retryDir, cleanRetryName);
        existingRetry.userFilename = true;
        existingRetry.category = this.detectCategory(cleanRetryName);
      }
      existingRetry.error = undefined;
      const overCap = this.maxConcurrentDownloads > 0 && this.getActiveCount() >= this.maxConcurrentDownloads;
      if (overCap) {
        existingRetry.status = 'queued';
        this.saveState();
        this.notify();
      } else {
        existingRetry.status = 'probing';
        this.saveState();
        this.notify();
        this.startDownload(existingRetry.id);
      }
      return existingRetry;
    }

    const destFolder = customFolder || this.defaultDownloadDir;
    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true });
    }

    // Prefer filename hints from URL query params (?filename=, ?as=, ...) before
    // falling back to the path basename, mirroring the probe-time logic.
    let rawName = customFilename || this.extractFilenameFromUrlPath(url) || 'download_file';
    // Destination anti-collision: never let two rows share one path (the other
    // half of the duplicate-truncation bug). If the desired path is claimed by
    // any existing row or already exists on disk, pick "name (1).ext" etc.
    const safeDest = this.findFreeDestination(destFolder, rawName);
    const cleanName = safeDest.filename;
    // Remember whether the user explicitly typed this name: if so, probe-time
    // Content-Disposition hints must never override it.
    const userFilename = !!customFilename;

    const activeCount = this.getActiveCount();
    const shouldQueue = this.maxConcurrentDownloads > 0 && activeCount >= this.maxConcurrentDownloads;
    const optimalConns = isAutoStreams
      ? 64 // Auto: upper bound; startDownload narrows by size/range/host caps
      : this.hostIntelligence.getOptimalConnectionsForHost(url, connections);

    const item: DownloadItem = {
      id,
      url,
      filename: cleanName,
      destinationPath: safeDest.fullPath,
      totalBytes: 0,
      downloadedBytes: 0,
      status: shouldQueue ? 'queued' : 'probing',
      speedBps: 0,
      connections: Math.max(1, Math.min(optimalConns, 64)),
      chunks: [],
      category: this.detectCategory(cleanName),
      resumable: false,
      autoStreams: isAutoStreams,
      userFilename,
      etaSeconds: 0,
      createdAt: Date.now(),
      ...(credentials && (credentials.cookies || credentials.userAgent || credentials.referrer) ? {
        browserCredentials: {
          ...(credentials.cookies ? { cookies: credentials.cookies } : {}),
          ...(credentials.userAgent ? { userAgent: credentials.userAgent } : {}),
          ...(credentials.referrer ? { referrer: credentials.referrer } : {}),
          origin: new URL(url).origin,
        },
      } : {}),
    };

    this.downloads.set(id, item);
    this.saveState();
    this.notify();

    if (!shouldQueue) {
      this.startDownload(id);
    }
    return item;
  }

  /**
   * Prime the per-origin HTTP/2 capability during probing, bounded so a
   * slow-TLS origin can never stall download start. Resolves true only when
   * ALPN confirmed h2 within the budget; a later-arriving success still
   * caches (session + capability) so in-flight downloads upgrade themselves
   * on their next chunk/retry. https origins in production; http only under
   * the dev/test posture (allowLocalhost) — production never probes cleartext.
   */
  private async primeHttp2Gate(url: string, budgetMs: number = 300): Promise<boolean> {
    // Production: https only (ALPN is a TLS extension). Under the dev/test
    // posture (allowLocalhost), http:// origins may be probed too so the h2c
    // integration tests exercise the same gate the real path uses.
    if (!url.startsWith('https://') && !this.allowLocalhost) return false;
    try {
      const existing = this.hostIntelligence.getCapabilities(url) as unknown as { supportsHttp2?: boolean } | null;
      if (existing?.supportsHttp2) return true;
      const detection = this.http2Transport.detectHttp2(url, 3000);
      const answered = await Promise.race([
        detection.then((v) => !!v),
        new Promise<null>((r) => setTimeout(() => r(null), budgetMs)),
      ]);
      if (answered === true) {
        this.hostIntelligence.setCapabilities(url, { supportsHttp2: true } as any);
        return true;
      }
      if (answered === null) {
        detection.then((v) => { if (v) this.hostIntelligence.setCapabilities(url, { supportsHttp2: true } as any); }).catch(() => {});
      }
      return false;
    } catch {
      return false;
    }
  }

  public async startDownload(id: string) {
    const item = this.downloads.get(id);
    if (!item) return;

    item.status = 'probing';
    item.error = undefined;
    this.notify();

    try {
      // Prime h2 capability in the BACKGROUND: awaiting it held the start
      // hostage for up to the 300ms detection budget on every fresh host —
      // deadly for small files and pointless for correctness. The first
      // worker requests go out over h1 immediately; downloadChunkWithRetry
      // re-checks supportsHttp2 per request, so steals/retries/extra workers
      // adopt h2 the moment detection lands.
      void this.primeHttp2Gate(item.url).catch(() => {});
      const probe = await this.probeUrl(item.url, 5, new Set(), false, item.browserCredentials);
      if (this.statusOf(item) === 'paused' || this.statusOf(item) === 'error') return;

      item.totalBytes = probe.contentLength;
      item.resumable = probe.acceptRanges;
      const requestUrl = probe.finalUrl || item.url;
      if (probe.finalUrl) item.url = probe.finalUrl;
      
      // A user-typed filename always wins over server hints (Content-
      // Disposition etc.). Only auto-derived names may be refined by the probe.
      if (probe.filename && !item.userFilename) {
        const targetDir = path.dirname(item.destinationPath);
        // Never rename onto a path another row or disk file already owns.
        const cleanName = this.pickNonCollidingName(targetDir, this.sanitizeFilename(probe.filename), item.id, item.destinationPath);
        item.filename = cleanName;
        item.destinationPath = path.join(targetDir, cleanName);
        item.category = this.detectCategory(cleanName);
      }

      const dir = path.dirname(item.destinationPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // If the destination already holds a complete file of the expected size,
      // preserve it. Re-adding the same URL must never truncate an existing
      // completed download (previous behavior opened 'w+' before any check).
      // downloadedBytes must also match: a file of the right size can be a
      // zero-filled pre-allocation from an earlier failed attempt — treating
      // that as complete would fake a finished download full of zeros.
      if (item.totalBytes > 0 && fs.existsSync(item.destinationPath)) {
        try {
          const existingSize = fs.statSync(item.destinationPath).size;
          if (existingSize === item.totalBytes && item.downloadedBytes === item.totalBytes) {
            item.downloadedBytes = item.totalBytes;
            item.status = 'completed';
            item.completedAt = Date.now();
            item.chunks = [];
            this.saveState();
            this.notify();
            this.checkNextQueuedDownload();
            return;
          }
        } catch (e) {}
      }

      // Open without truncating: 'r+' for an existing (partial) file so a restart
      // can overwrite in place, 'w' only for a genuinely new file.
      const fileExists = fs.existsSync(item.destinationPath);
      const fd = fs.openSync(item.destinationPath, fileExists ? 'r+' : 'w');
      this.fileDescriptors.set(id, fd);

      // For unknown-size (totalBytes === 0) downloads over an old file,
      // clear stale content. Safe now: findFreeDestination guarantees a row
      // never claims a path it did not create, and downloadedBytes === 0 means
      // this row never wrote data worth preserving.
      if (fileExists && item.totalBytes === 0 && item.downloadedBytes === 0) {
        try { fs.ftruncateSync(fd, 0); } catch (e) {}
      }

      const writeQueue = new BoundedWriteQueue(fd, { maxQueuedBytes: this.maxQueueBytes });
      this.writeQueues.set(id, writeQueue);

      if (item.totalBytes > 0) {
        try {
          fs.ftruncateSync(fd, item.totalBytes);
        } catch (e) {}
      }

      // Small files benefit more from eliminating scheduler/write-queue
      // overhead than from dynamic work stealing. Fall back to the mature
      // path if any fast-path range request fails.
      if (item.autoStreams && !fileExists && item.downloadedBytes === 0 && item.resumable && item.totalBytes > 256 * 1024 && item.totalBytes <= 32 * 1024 * 1024) {
        const fastCompleted = await this.trySmallFileFastPath(item, requestUrl, fd);
        if (fastCompleted) {
          this.writeQueues.delete(id);
          try { fs.closeSync(fd); } catch (e) {}
          this.fileDescriptors.delete(id);
          item.status = 'completed';
          item.downloadedBytes = item.totalBytes;
          item.speedBps = 0;
          item.etaSeconds = 0;
          item.completedAt = Date.now();
          this.saveState();
          this.notify();
          this.checkNextQueuedDownload();
          return;
        }
        try { fs.ftruncateSync(fd, item.totalBytes); } catch (e) {}
      }

      // P3 Stream Selection & Dynamic Optimization.
      // Size-aware tiers: a small file split N ways spends more time on
      // connection setup/slow-start than it saves, so fewer streams win. The
      // tiers reflect the point where parallelism starts paying off.
      //   ≤ 256 KB → 1 stream   (setup overhead dominates genuinely tiny files)
      //   ≤ 1 MB   → 32 streams (some servers cap each connection even for
      //                         small files)
      //   ≤ 8 MB   → full 32-stream pool (short files still benefit when the
      //                         server caps each connection independently)
      //   ≤ 64 MB  → 16 streams (enough parallelism for short shaped
      //                         downloads without opening the full large-file
      //                         pool)
      //   > 64 MB  → full requested count (maximum acceleration)
      // Non-range servers and unknown sizes must stay single-stream (can't
      // range-request what we can't split), except dynamic splitting can
      // still grow the stream count mid-flight when the server cooperates.
      const size = item.totalBytes;
      const MB = 1024 * 1024;
      // In Auto mode the engine decides the stream count from the size tiers.
      // In Manual mode the user's explicit pick is honored (host caps still
      // apply) — no size-based downgrade, that's what Auto is for.
      const autoTierCap =
        size <= 0 ? 1 :
        size <= 256 * 1024 ? 1 :
        size <= 1 * MB ? 32 :
        size <= 8 * MB ? 32 :
        size <= 64 * MB ? 16 :
        item.connections;
      const effectiveRequested = item.autoStreams
        ? Math.min(item.connections, autoTierCap)
        : item.connections;
      const optimalHostConns = this.hostIntelligence.getOptimalConnectionsForHost(requestUrl, item.connections);
      const initialConns = (item.resumable && size > 0)
        ? Math.max(1, Math.min(effectiveRequested, optimalHostConns))
        : 1;

      const adaptiveController = new AdaptiveConcurrencyController({
        minWorkers: 1,
        maxWorkers: Math.max(1, Math.min(effectiveRequested, optimalHostConns)),
        initialWorkers: initialConns,
      });
      this.adaptiveControllers.set(id, adaptiveController);

      const chunkOptimizer = new ChunkOptimizer();
      this.chunkOptimizers.set(id, chunkOptimizer);

      const telemetry = new PerformanceTelemetryTracker(id);
      this.telemetryTrackers.set(id, telemetry);

      // Initialize Dynamic Work-Stealing Scheduler
      const scheduler = new DynamicRangeScheduler(item.totalBytes, initialConns);
      this.schedulers.set(id, scheduler);
      item.chunks = scheduler.chunks;

      item.status = 'downloading';
      this.saveState();
      this.notify();

      const controllers: AbortController[] = [];
      this.abortControllers.set(id, controllers);

      let prevTotalDownloaded = 0;
      let activeWorkerCount = 0;

      let completionResolve: () => void = () => {};
      const workersCoordinator = new Promise<void>(resolve => {
        completionResolve = resolve;
      });
      this.activeWorkersPromise.set(id, workersCoordinator);

      const checkCompletion = () => {
        if (activeWorkerCount === 0) {
          completionResolve();
        }
      };

      const runWorker = async (initialChunk: ChunkProgress, isSpawnedBySteal: boolean = false) => {
        activeWorkerCount++;
        let currentChunk: ChunkProgress | null = initialChunk;
        while (currentChunk && item.status === 'downloading') {
          const controller = new AbortController();
          controllers.push(controller);
          try {
            await this.downloadChunkWithRetry(item, currentChunk, writeQueue, controller.signal, requestUrl);
          } catch (chunkErr: any) {
            scheduler.returnUnfinishedRange(currentChunk.id);
            if (this.statusOf(item) !== 'paused') {
              item.status = 'error';
              item.error = chunkErr.message || String(chunkErr);
              controllers.forEach(c => c.abort());
            }
            break;
          }

          // When chunk finishes, check if allowed to steal work (with near-completion guard)
          const remainingTotal = item.totalBytes > 0 ? (item.totalBytes - item.downloadedBytes) : 0;
          const isNearCompletion = item.totalBytes > 0 && remainingTotal < 256 * 1024;

          if (item.resumable && item.totalBytes > 0 && item.status === 'downloading' && !isNearCompletion) {
            if (activeWorkerCount - 1 < adaptiveController.getTargetWorkers() || activeWorkerCount <= 1) {
              const finishedSpeedBps = currentChunk.speedBps;
              currentChunk = scheduler.stealWork(finishedSpeedBps);
              if (currentChunk) {
                telemetry.recordSteal(initialChunk.id, currentChunk.id, currentChunk.startByte, currentChunk.endByte);
                item.chunks = scheduler.chunks;
                this.notify();
              } else {
                // Donor had nothing left to split: pick up any orphaned idle chunk
                // instead of letting the worker exit and stranding the range.
                const orphan = this.claimIdleChunk(scheduler);
                currentChunk = orphan;
                if (orphan) {
                  item.chunks = scheduler.chunks;
                  this.notify();
                } else if (isSpawnedBySteal) {
                  // A split may be blocked by the 500ms anti-thrash window when the
                  // stolen chunk finished almost instantly. Retry once, then exit.
                  // ONLY workers that obtained their chunk via a steal pay this:
                  // their donor is the one possibly inside the anti-thrash window.
                  // Initial workers own constructor-created chunks (never freshly
                  // split), so a null steal means there is genuinely nothing to
                  // split — waiting 550ms here idled every worker at the end of
                  // every download and stalled completion by a fixed ~0.55s.
                  await new Promise(r => setTimeout(r, 550));
                  if (item.status === 'downloading') {
                    currentChunk = scheduler.stealWork(finishedSpeedBps);
                    if (currentChunk) {
                      telemetry.recordSteal(initialChunk.id, currentChunk.id, currentChunk.startByte, currentChunk.endByte);
                      item.chunks = scheduler.chunks;
                      this.notify();
                    }
                  }
                }
              }
            } else {
              currentChunk = null; // Cleanly scale down excess worker
            }
          } else if (item.status === 'downloading' && item.resumable && item.totalBytes > 0) {
            // Near completion: no new splits, but still finish orphaned ranges.
            const orphan = this.claimIdleChunk(scheduler);
            currentChunk = orphan;
            if (orphan) {
              item.chunks = scheduler.chunks;
              this.notify();
            }
          } else {
            currentChunk = null;
          }
        }
        activeWorkerCount--;
        checkCompletion();
      };

      [...scheduler.chunks].forEach(chunk => runWorker(chunk));

      const speedInterval = setInterval(() => {
        if (item.status !== 'downloading') return;
        const currentTotal = item.chunks.reduce((acc, c) => acc + c.downloadedBytes, 0);
        const bytesInInterval = currentTotal - prevTotalDownloaded;
        prevTotalDownloaded = currentTotal;
        item.downloadedBytes = currentTotal;
        item.speedBps = Math.max(0, bytesInInterval);

        adaptiveController.recordThroughputSample(bytesInInterval, 1000);
        telemetry.recordThroughputSample(bytesInInterval, activeWorkerCount);
        this.hostIntelligence.recordThroughput(requestUrl, bytesInInterval);

        // Feed evidence to host intel: how many streams are running cleanly
        // right now. This is the honest ceiling recovery walks back toward.
        if (activeWorkerCount > 0) {
          this.hostIntelligence.observeConcurrency(requestUrl, activeWorkerCount);
        }

        // Connection-cap recovery for previously throttled hosts: if the host
        // intel layer restored a level, raise our adaptive ceiling to match.
        if (this.hostIntelligence.consumeCapRecovery(requestUrl)) {
          const restored = this.hostIntelligence.getOptimalConnectionsForHost(requestUrl, item.connections);
          adaptiveController.setWorkerLimits(1, restored);
        }

        const remainingTotal = item.totalBytes > 0 ? (item.totalBytes - currentTotal) : 0;
        const isNearCompletion = item.totalBytes > 0 && remainingTotal < 256 * 1024;

        const scaleAction = isNearCompletion ? 'maintain' : adaptiveController.evaluate({
          activeWorkersCount: activeWorkerCount,
          remainingBytes: remainingTotal,
        });

        if (scaleAction === 'scale_up' && item.resumable && item.totalBytes > 0 && !isNearCompletion) {
          // Prefer reclaiming an orphaned idle chunk before splitting a healthy donor.
          const stolen = this.claimIdleChunk(scheduler) || scheduler.stealWork();
          if (stolen) {
            if (stolen.status !== 'active') telemetry.recordSteal(0, stolen.id, stolen.startByte, stolen.endByte);
            item.chunks = scheduler.chunks;
            runWorker(stolen, true);
          }
        }

        if (item.speedBps > 0 && item.totalBytes > currentTotal) {
          item.etaSeconds = Math.round((item.totalBytes - currentTotal) / item.speedBps);
        } else {
          item.etaSeconds = 0;
        }

        this.notify();
      }, 1000);

      this.speedIntervals.set(id, speedInterval);

      await workersCoordinator;

      // Drain write queue to disk before marking completed
      await writeQueue.drain();

      clearInterval(speedInterval);
      this.speedIntervals.delete(id);
      this.activeWorkersPromise.delete(id);
      this.writeQueues.delete(id);
      this.schedulers.delete(id);
      this.adaptiveControllers.delete(id);
      
      try { fs.closeSync(fd); } catch (e) {}
      this.fileDescriptors.delete(id);

      if (item.status === 'downloading') {
        item.chunks = scheduler ? scheduler.chunks : item.chunks;
        const totalDownloaded = item.chunks.reduce((acc, c) => acc + c.downloadedBytes, 0);
        if (item.totalBytes > 0 && totalDownloaded >= item.totalBytes) {
          item.status = 'completed';
          item.downloadedBytes = item.totalBytes;
        } else if (item.totalBytes === 0 && totalDownloaded > 0) {
          item.status = 'completed';
          item.totalBytes = totalDownloaded;
          item.downloadedBytes = totalDownloaded;
        } else {
          item.status = 'paused';
        }
        item.speedBps = 0;
        item.etaSeconds = 0;
        item.completedAt = Date.now();
        this.saveState();
        this.notify();
        this.checkNextQueuedDownload();
      }

    } catch (err: any) {
      if (this.statusOf(item) === 'paused' || this.statusOf(item) === 'error') return;
      item.status = 'error';
      item.error = this.humanizeError(err.message);
      item.speedBps = 0;
      const interval = this.speedIntervals.get(id);
      if (interval) clearInterval(interval);
      this.saveState();
      this.notify();
      this.checkNextQueuedDownload();
    }
  }

  private async trySmallFileFastPath(item: DownloadItem, requestUrl: string, fd: number): Promise<boolean> {
    if (typeof fetch !== 'function' || item.totalBytes <= 256 * 1024 || item.totalBytes > 32 * 1024 * 1024) return false;

    const totalBytes = item.totalBytes;
    const requestedRanges = item.autoStreams ? 32 : Math.max(1, Math.min(item.connections, 32));
    const rangeCount = Math.min(requestedRanges, Math.max(1, Math.ceil(totalBytes / (32 * 1024))));
    const rangeSize = Math.ceil(totalBytes / rangeCount);
    const headers: Record<string, string> = {
      'accept': '*/*',
      'accept-encoding': 'identity',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
    };
    const fastReferer = this.hostIntelligence.getHostReferer(requestUrl);
    if (fastReferer) headers.referer = fastReferer;
    const credentials = item.browserCredentials;
    if (credentials?.cookies && (!credentials.origin || new URL(requestUrl).origin === credentials.origin)) {
      headers.cookie = credentials.cookies;
    }
    if (credentials?.userAgent) headers['user-agent'] = credentials.userAgent;
    if (credentials?.referrer) headers.referer = credentials.referrer;

    try {
      let nextIndex = 0;
      let activeWorkers = 0;
      let targetWorkers = Math.min(4, rangeCount);
      let failure: unknown = null;
      let resolveAll: () => void = () => {};
      const allDone = new Promise<void>(resolve => { resolveAll = resolve; });
      const rampTimer = setInterval(() => {
        if (!failure && nextIndex < rangeCount) targetWorkers = Math.min(rangeCount, targetWorkers + 4);
        if (!failure && activeWorkers < targetWorkers) spawnWorker();
      }, 150);
      const spawnWorker = () => {
        activeWorkers++;
        void (async () => {
          try {
            while (!failure) {
              const index = nextIndex++;
              if (index >= rangeCount) break;
              const startByte = index * rangeSize;
              const endByte = Math.min(totalBytes - 1, startByte + rangeSize - 1);
              const response = await fetch(requestUrl, {
                method: 'GET',
                headers: { ...headers, range: `bytes=${startByte}-${endByte}` },
              });
              const buffer = Buffer.from(await response.arrayBuffer());
              const expectedLength = endByte - startByte + 1;
              if (response.status !== 206 || buffer.length !== expectedLength) {
                throw new Error(`Fast range request returned ${response.status} with ${buffer.length}/${expectedLength} bytes`);
              }
              fs.writeSync(fd, buffer, 0, buffer.length, startByte);
            }
          } catch (error) {
            failure = error;
          } finally {
            activeWorkers--;
            if (activeWorkers === 0 && (failure || nextIndex >= rangeCount)) resolveAll();
          }
        })();
      };
      for (let i = 0; i < targetWorkers; i++) spawnWorker();
      await allDone;
      clearInterval(rampTimer);
      if (failure) throw failure;
      item.chunks = Array.from({ length: rangeCount }, (_, index) => {
        const startByte = index * rangeSize;
        const endByte = Math.min(totalBytes - 1, startByte + rangeSize - 1);
        const chunkBytes = endByte - startByte + 1;
        return {
          id: index,
          startByte,
          endByte,
          downloadedBytes: chunkBytes,
          totalBytes: chunkBytes,
          speedBps: 0,
          status: 'done' as const,
        };
      });
      return true;
    } catch {
      return false;
    }
  }

  private async downloadChunkWithRetry(
    item: DownloadItem, 
    chunk: ChunkProgress, 
    writeQueue: BoundedWriteQueue, 
    signal: AbortSignal, 
    requestUrl: string, 
    maxRetries: number = 8
  ): Promise<void> {
    let attempts = 0;
    let fastRetries = 0;
    while (attempts < maxRetries) {
      if (signal.aborted || this.statusOf(item) === 'paused') return;
      try {
        // HTTP/2 fast path: multiplexed streams when the origin negotiated h2
        // during probe. Same retry/backoff/integrity semantics as h1 — only
        // the transport differs. Falls back silently to h1 otherwise.
        const h2Eligible =
          requestUrl.startsWith('https://') &&
          item.resumable && item.totalBytes > 0 &&
          !(this.proxyAuth && (this.proxyAuth.getGlobalProxy() as any)?.host) &&
          (this.hostIntelligence.getCapabilities(requestUrl) as any)?.supportsHttp2 === true;
        if (h2Eligible) {
          await this.downloadChunkH2(item, chunk, writeQueue, signal, requestUrl);
        } else {
          await this.downloadChunk(item, chunk, writeQueue, signal, requestUrl);
        }
        return;
      } catch (err: any) {
        if (signal.aborted || this.statusOf(item) === 'paused') return;

        // Drain pending writes so committed byte progress is accurate before retrying
        try {
          await writeQueue.drain();
        } catch (e) {}

        if (err.statusCode === 429 || err.statusCode === 503) {
          // Severely throttled by host (e.g. UploadHaven free tier / connection limiter).
          // Recorded as a tracked downgrade so concurrency can recover later once
          // clean successes accumulate (no longer a permanent clamp).
          this.hostIntelligence.throttleHostToSingleStream(requestUrl, item.connections);
          const adaptiveCtrl = this.adaptiveControllers.get(item.id);
          if (adaptiveCtrl) {
            adaptiveCtrl.throttleDown(1);
          }
        }

        // Permanent non-retryable errors
        if (err.statusCode && this.hostIntelligence.isPermanentFailure(err.statusCode)) {
          throw err;
        }
        if (err.message && (err.message.includes('Protocol Violation') || err.message.includes('Content-Range') || err.message.includes('Boundary Violation') || err.message.includes('Disk Write Error'))) {
          throw err;
        }

        attempts++;
        this.hostIntelligence.recordRetry(requestUrl);

        if (attempts >= maxRetries) {
          throw err;
        }

        // Rate-limit responses must respect server-mandated backoff.
        if (err.statusCode === 429 || err.statusCode === 503) {
          const delay = Math.max(2000, this.hostIntelligence.calculateBackoffDelay(attempts, err.retryAfterHeader));
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // Transient transport faults (dropped sockets, premature EOF, stalls):
        // reconnect immediately. The old exponential backoff (200ms→10s) let
        // single-connection competitors that retry in ~20ms finish far sooner
        // and idled workers for seconds per drop. After 3 rapid attempts the
        // host is probably genuinely struggling — taper into exponential
        // backoff so we never hammer it.
        const isTransientFault =
          (!!err.statusCode && this.hostIntelligence.isTransientStatus(err.statusCode)) ||
          (typeof err.message === 'string' && TRANSIENT_DROP_PATTERN.test(err.message));
        if (isTransientFault && fastRetries < 3) {
          fastRetries++;
          const delay = Math.min(120, 10 + fastRetries * 25);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        fastRetries = 0;

        const delay = this.hostIntelligence.calculateBackoffDelay(attempts, err.retryAfterHeader);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  /**
   * HTTP/2 range download: multiplexed streams over one ALPN-negotiated
   * session. Mirrors the h1 downloadChunk contract exactly — same boundary
   * validation, same write queue, same error vocabulary — so the retry
   * logic, pause, and integrity guarantees are transport-agnostic.
   */
  private async downloadChunkH2(
    item: DownloadItem,
    chunk: ChunkProgress,
    writeQueue: BoundedWriteQueue,
    signal: AbortSignal,
    requestUrl: string
  ): Promise<void> {
    const isSegmented = item.resumable && item.totalBytes > 0;
    const currentStart = chunk.startByte + chunk.downloadedBytes;
    const expectedEnd = chunk.endByte;

    if (isSegmented && currentStart > expectedEnd) {
      chunk.status = 'done';
      return;
    }

    const referer = this.hostIntelligence.getHostReferer(requestUrl);
    const headers: Record<string, string> = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'accept': '*/*',
      'accept-encoding': 'identity', // ranges must arrive uncompressed
    };
    if (referer) headers.referer = referer;
    const creds = item.browserCredentials;
    if (creds?.cookies && (!creds.origin || new URL(requestUrl).origin === creds.origin)) {
      headers['cookie'] = creds.cookies;
    }
    if (creds?.userAgent) headers['user-agent'] = creds.userAgent;
    if (creds?.referrer) headers['referer'] = creds.referrer;

    let chunkPrevBytes = chunk.downloadedBytes;
    let lastTime = Date.now();
    // CRITICAL: track the write position LOCALLY, exactly like the h1 path's
    // currentWriteOffset. chunk.downloadedBytes is incremented asynchronously
    // by the write queue on fs.write COMMIT — reading it per data event let
    // two rapid chunks compute the same stale offset and overwrite each
    // other's destination (real-world corruption observed vs package-lock
    // sha512 over h2; loopback hid it because local writes commit instantly).
    let currentWriteOffset = currentStart;

    const result = await this.http2Transport.requestRange({
      url: requestUrl,
      startByte: currentStart,
      endByte: expectedEnd,
      signal,
      headers,
      // Bounded backpressure: transport pauses the h2 stream (real flow
      // control) while the disk queue is at/above its high-water mark —
      // the h2 equivalent of the h1 path's res.pause().
      shouldPause: () => writeQueue.isOverHighWaterMark(),
      onData: (buffer: Buffer) => {
        let writeBuffer = buffer;
        if (isSegmented) {
          const remainInChunk = expectedEnd - currentWriteOffset + 1;
          if (remainInChunk <= 0) {
            return false; // server overran the range — cancel the stream
          }
          writeBuffer = buffer.length > remainInChunk ? buffer.subarray(0, remainInChunk) : buffer;
        }

        try {
          writeQueue.enqueue(
            chunk.id,
            currentWriteOffset,
            writeBuffer,
            chunk.startByte,
            chunk.endByte,
            chunk
          );
          currentWriteOffset += writeBuffer.length;
        } catch (writeErr: any) {
          throw writeErr;
        }

        const now = Date.now();
        if (now - lastTime >= 500) {
          const diff = chunk.downloadedBytes - chunkPrevBytes;
          chunk.speedBps = Math.round((diff / (now - lastTime)) * 1000);
          chunkPrevBytes = chunk.downloadedBytes;
          lastTime = now;
        }
      },
    });

    void result;

    // requestRange only resolves when the stream ended cleanly at exactly the
    // expected byte count, so reaching here means the chunk is complete.
    chunk.status = 'done';
    chunk.speedBps = 0;
  }

  /**
   * Claim an orphaned idle chunk (e.g. the upper half of a split whose donor socket
   * was destroyed after a dynamic split). Marks it active synchronously so only one
   * worker can ever claim it. Returns null when no reclaimable chunk exists.
   */
  private claimIdleChunk(scheduler: DynamicRangeScheduler): ChunkProgress | null {
    const candidate = scheduler.chunks.find(
      c => c.status === 'idle' && (c.totalBytes === 0 || c.downloadedBytes < c.totalBytes)
    );
    if (!candidate) return null;
    candidate.status = 'active';
    return candidate;
  }

  private downloadChunk(
    item: DownloadItem, 
    chunk: ChunkProgress, 
    writeQueue: BoundedWriteQueue, 
    signal: AbortSignal, 
    requestUrl: string,
    maxRedirects: number = 5,
    visitedUrls: Set<string> = new Set()
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let isRejected = false;
      const safeReject = (err: Error) => {
        if (isRejected) return;
        isRejected = true;
        chunk.status = 'error';
        reject(err);
      };

      chunk.status = 'active';
      const parsedUrl = new URL(requestUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const lib = isHttps ? https : http;
      const proxyAgents = this.proxyAuth ? getProxyAgents(this.proxyAuth.getGlobalProxy()) : null;
      const bypass = this.proxyAuth ? this.proxyAuth.shouldBypassProxy(requestUrl) : true;
      const agent = !bypass && proxyAgents ? (isHttps ? proxyAgents.https : proxyAgents.http) : (isHttps ? httpsAgent : httpAgent);

      const isSegmented = item.resumable && item.totalBytes > 0;
      const currentStart = chunk.startByte + chunk.downloadedBytes;
      const expectedEnd = chunk.endByte;

      if (isSegmented && currentStart > expectedEnd) {
        chunk.status = 'done';
        resolve();
        return;
      }

      const referer = this.hostIntelligence.getHostReferer(requestUrl);
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Connection': 'keep-alive',
      };
      if (referer) headers['Referer'] = referer;

      // Browser-captured credentials: cookies are host-scoped (only sent to
      // the captured origin, matching browser semantics) while the captured
      // User-Agent and Referer accompany every hop, like a browser would.
      const creds = item.browserCredentials;
      if (creds) {
        if (creds.cookies) {
          const credsOrigin = creds.origin;
          if (!credsOrigin || new URL(requestUrl).origin === credsOrigin) {
            headers['Cookie'] = creds.cookies;
          }
        }
        if (creds.userAgent) headers['User-Agent'] = creds.userAgent;
        if (creds.referrer) headers['Referer'] = creds.referrer;
      }

      // Site-login credentials from the Proxy & Logins subsystem (Settings →
      // Site Logins): inject Authorization/Cookie headers for matching domains.
      if (this.proxyAuth) {
        const siteHeaders = this.proxyAuth.resolveHeadersForUrl(requestUrl);
        for (const [k, v] of Object.entries(siteHeaders)) {
          if (k.toLowerCase() === 'user-agent') continue; // captured UA wins
          headers[k] = v;
        }
      }

      if (isSegmented) {
        headers['Range'] = `bytes=${currentStart}-${expectedEnd}`;
      }

      const reqStartTime = Date.now();
      let hasReceivedHeaders = false;
      let lastDataTime = Date.now();
      let stallCheckTimer: NodeJS.Timeout | null = null;
      // The response object, once headers arrive. Used by the stall detector:
      // a socket we paused ourselves (limiter / write-queue backpressure) is
      // not stalled — isPaused() is the authoritative source of truth.
      let activeRes: any = null;

      // Inactivity / Stall Detector
      const startStallTimer = () => {
        stallCheckTimer = setInterval(() => {
          if (signal.aborted || isRejected) {
            if (stallCheckTimer) clearInterval(stallCheckTimer);
            return;
          }
          if (activeRes && activeRes.isPaused()) { 
            // We paused the socket ourselves (speed limiter or write-queue
            // backpressure). The server may have already buffered the entire
            // response, so a quiet socket is expected — do not treat as stall.
          } else if (Date.now() - lastDataTime > this.stallTimeoutMs) { // 6s inactivity timeout (HYPER_STALL_MS overrides for tests)
            if (stallCheckTimer) clearInterval(stallCheckTimer);
            req.destroy();
            this.hostIntelligence.recordRequestResult(requestUrl, 408, Date.now() - reqStartTime, 0, true, true);
            safeReject(new Error('Inactivity Timeout: Connection stalled with 0 bytes transferred'));
          }
        }, 1000);
      };

      const req = lib.request(parsedUrl, {
        method: 'GET',
        headers,
        agent,
        signal,
        lookup: createSSRFSafeLookup(this.allowLocalhost),
        timeout: 8000, // Connection & initial socket timeout
      }, res => {
        activeRes = res;
        hasReceivedHeaders = true;
        // Socket tuning (Nagle off) on the pooled connection we are about to
        // stream the chunk through. Idempotent per socket; see tuneH1Socket.
        tuneH1Socket(res.socket as import('net').Socket | undefined);
        const latency = Date.now() - reqStartTime;

        if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (stallCheckTimer) clearInterval(stallCheckTimer);
          req.destroy();
          if (maxRedirects <= 0) {
            return safeReject(new Error('Too many redirects encountered during chunk download.'));
          }
          const redirectUrl = new URL(res.headers.location, requestUrl).toString();
          const urlValidation = validateUrl(redirectUrl, this.allowLocalhost);
          if (!urlValidation.valid) {
            return safeReject(new Error(`Insecure redirect URL blocked: ${urlValidation.error}`));
          }
          if (visitedUrls.has(redirectUrl)) {
            return safeReject(new Error('Redirect loop detected during chunk download.'));
          }
          visitedUrls.add(redirectUrl);
          const redirParsed = new URL(redirectUrl);
          if (isHttps && redirParsed.protocol === 'http:') {
            return safeReject(new Error('HTTPS to HTTP downgrade redirect rejected during chunk download.'));
          }
          this.downloadChunk(item, chunk, writeQueue, signal, redirectUrl, maxRedirects - 1, visitedUrls)
            .then(resolve)
            .catch(safeReject);
          return;
        }

        const statusCode = res.statusCode || 200;
        this.hostIntelligence.recordRequestResult(requestUrl, statusCode, latency, 0, statusCode >= 400);

        // Node emits 'timeout' when the (socket-level) timeout fires; while we
        // hold the socket paused the inactivity is ours, not the server's.
        req.on('timeout', () => {
          if (activeRes && activeRes.isPaused()) return;
        });

        if (statusCode === 429 || statusCode === 503) {
          if (stallCheckTimer) clearInterval(stallCheckTimer);
          req.destroy();
          const err: any = new Error(`Server returned HTTP ${statusCode}`);
          err.statusCode = statusCode;
          err.retryAfterHeader = res.headers['retry-after'];
          return safeReject(err);
        }

        if (this.hostIntelligence.isPermanentFailure(statusCode)) {
          if (stallCheckTimer) clearInterval(stallCheckTimer);
          req.destroy();
          const err: any = new Error(`Permanent HTTP Error: ${statusCode}`);
          err.statusCode = statusCode;
          return safeReject(err);
        }

        if (isSegmented) {
          if (res.statusCode === 200) {
            if (stallCheckTimer) clearInterval(stallCheckTimer);
            req.destroy();
            return safeReject(new Error('Protocol Violation: Server returned HTTP 200 instead of HTTP 206 Partial Content'));
          }

          if (res.statusCode !== 206) {
            if (stallCheckTimer) clearInterval(stallCheckTimer);
            req.destroy();
            const err: any = new Error(`Server returned HTTP ${res.statusCode} instead of HTTP 206 Partial Content`);
            err.statusCode = res.statusCode;
            return safeReject(err);
          }

          const contentRange = res.headers['content-range'];
          if (!contentRange) {
            if (stallCheckTimer) clearInterval(stallCheckTimer);
            req.destroy();
            return safeReject(new Error('Protocol Violation: Missing Content-Range header in HTTP 206 response'));
          }

          const rangeMatch = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/);
          if (!rangeMatch) {
            if (stallCheckTimer) clearInterval(stallCheckTimer);
            req.destroy();
            return safeReject(new Error(`Protocol Violation: Malformed Content-Range header: "${contentRange}"`));
          }

          const startRange = parseInt(rangeMatch[1], 10);
          const endRange = parseInt(rangeMatch[2], 10);
          const totalLength = rangeMatch[3] !== '*' ? parseInt(rangeMatch[3], 10) : undefined;

          if (startRange !== currentStart) {
            if (stallCheckTimer) clearInterval(stallCheckTimer);
            req.destroy();
            return safeReject(new Error(`Content-Range start mismatch: expected ${currentStart}, received ${startRange}`));
          }

          if (endRange !== expectedEnd) {
            if (stallCheckTimer) clearInterval(stallCheckTimer);
            req.destroy();
            return safeReject(new Error(`Content-Range end mismatch: expected ${expectedEnd}, received ${endRange}`));
          }

          if (totalLength !== undefined && item.totalBytes > 0 && totalLength !== item.totalBytes) {
            if (stallCheckTimer) clearInterval(stallCheckTimer);
            req.destroy();
            return safeReject(new Error(`Content-Range total size mismatch: expected ${item.totalBytes}, received ${totalLength}`));
          }
        } else {
          if (res.statusCode && res.statusCode >= 400) {
            if (stallCheckTimer) clearInterval(stallCheckTimer);
            req.destroy();
            const err: any = new Error(`Server returned HTTP ${res.statusCode}`);
            err.statusCode = res.statusCode;
            return safeReject(err);
          }
        }

        let chunkPrevBytes = chunk.downloadedBytes;
        let lastTime = Date.now();
        let currentWriteOffset = isSegmented ? currentStart : (chunk.startByte + chunk.downloadedBytes);

        startStallTimer();

        res.on('data', async (buffer: Buffer) => {
          if (signal.aborted || isRejected) return;
          lastDataTime = Date.now();

          // Always serialize handler invocations: an async data handler
          // interleaves with the next 'data' event (Node does not await it),
          // so a limiter await OR a write-queue pause mid-handler lets the
          // next invocation run concurrently and write to the same offset —
          // observed as "Premature EOF" at the tail of streams. processData is
          // synchronous when no limiter fires, so the lock adds no overhead to
          // the unthrottled fast path.
          if (dataHandlerBusy) {
            pendingBuffers.push(buffer);
            return;
          }
          dataHandlerBusy = true;

          try {
            await processData(buffer);
          } finally {
            dataHandlerBusy = false;
          }

          // Drain buffered chunks (arrived while throttled/paused) in order.
          while (pendingBuffers.length > 0 && !signal.aborted && !isRejected) {
            const next = pendingBuffers.shift()!;
            dataHandlerBusy = true;
            try {
              await processData(next);
            } finally {
              dataHandlerBusy = false;
            }
          }
        });

        const pendingBuffers: Buffer[] = [];
        let dataHandlerBusy = false;

        const processData = async (buffer: Buffer) => {
          // Apply global & per-download speed limiter backpressure.
          // IMPORTANT: the limiter is awaited BEFORE the buffer is written and
          // the returned delay is applied in full (bounded to keep sockets
          // healthy). Writing first made the limit purely cosmetic.
          if (this.globalSpeedLimiter.isEnabled()) {
            const waitMs = await this.globalSpeedLimiter.consume(buffer.length);
            if (waitMs > 0) {
              res.pause();
              await new Promise<void>((r) => setTimeout(r, waitMs));
              if (signal.aborted || isRejected) return;
              res.resume();
            }
          }
          const itemLimiter = this.itemSpeedLimiters.get(item.id);
          if (itemLimiter && itemLimiter.isEnabled()) {
            const waitMs = await itemLimiter.consume(buffer.length);
            if (waitMs > 0) {
              res.pause();
              await new Promise<void>((r) => setTimeout(r, waitMs));
              if (signal.aborted || isRejected) return;
              res.resume();
            }
          }

          try {
            const writeOffset = currentWriteOffset;

            if (isSegmented) {
              const remaining = chunk.endByte - writeOffset + 1;
              const isDynamicallySplit = !!(chunk as any).isDynamicallySplit;

              if (remaining <= 0) {
                if (isDynamicallySplit) {
                  if (stallCheckTimer) clearInterval(stallCheckTimer);
                  req.destroy();
                  chunk.status = 'done';
                  chunk.speedBps = 0;
                  resolve();
                  return;
                } else {
                  if (stallCheckTimer) clearInterval(stallCheckTimer);
                  req.destroy();
                  return safeReject(new Error('Protocol Violation: Server sent bytes beyond requested chunk boundary'));
                }
              }

              const writeBuffer = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
              currentWriteOffset += writeBuffer.length;

              const hasCapacity = writeQueue.enqueue(
                chunk.id,
                writeOffset,
                writeBuffer,
                chunk.startByte,
                chunk.endByte,
                chunk
              );

              if (!hasCapacity) {
                // Wait for the queue to drain below the low-water mark before
                // accepting the next buffer: fire-and-forget resume let the
                // next 'data' event run mid-handler, corrupting the tail of
                // the stream (Premature EOF).
                res.pause();
                await new Promise<void>((resolveLowWater) => {
                  let settled = false;
                  const finish = () => {
                    if (settled) return;
                    settled = true;
                    resolveLowWater();
                  };
                  const safety = setTimeout(finish, 30000);
                  writeQueue.onLowWater(() => {
                    clearTimeout(safety);
                    finish();
                  });
                });
                res.resume();
              }

              if (buffer.length > remaining) {
                if (isDynamicallySplit) {
                  if (stallCheckTimer) clearInterval(stallCheckTimer);
                  req.destroy();
                  chunk.status = 'done';
                  chunk.speedBps = 0;
                  resolve();
                  return;
                } else {
                  if (stallCheckTimer) clearInterval(stallCheckTimer);
                  req.destroy();
                  return safeReject(new Error('Protocol Violation: Server sent bytes beyond requested chunk boundary'));
                }
              } else if (buffer.length === remaining) {
                if (isDynamicallySplit) {
                  if (stallCheckTimer) clearInterval(stallCheckTimer);
                  req.destroy();
                  chunk.status = 'done';
                  chunk.speedBps = 0;
                  resolve();
                  return;
                }
              }
            } else {
              currentWriteOffset += buffer.length;
              const hasCapacity = writeQueue.enqueue(
                chunk.id,
                writeOffset,
                buffer,
                0,
                0,
                chunk
              );

              if (!hasCapacity) {
                // Same ordered backpressure as the segmented path above.
                res.pause();
                await new Promise<void>((resolveLowWater) => {
                  let settled = false;
                  const finish = () => {
                    if (settled) return;
                    settled = true;
                    resolveLowWater();
                  };
                  const safety = setTimeout(finish, 30000);
                  writeQueue.onLowWater(() => {
                    clearTimeout(safety);
                    finish();
                  });
                });
                res.resume();
              }
            }

            const now = Date.now();
            if (now - lastTime >= 500) {
              const diff = chunk.downloadedBytes - chunkPrevBytes;
              chunk.speedBps = Math.round((diff / (now - lastTime)) * 1000);
              chunkPrevBytes = chunk.downloadedBytes;
              lastTime = now;
            }
          } catch (writeErr: any) {
            if (stallCheckTimer) clearInterval(stallCheckTimer);
            req.destroy();
            safeReject(writeErr);
          }
        };

        res.on('end', () => {
          if (stallCheckTimer) clearInterval(stallCheckTimer);
          if (signal.aborted || isRejected) {
            resolve();
            return;
          }

          // Clean chunk completion: evidence for connection-cap recovery.
          this.hostIntelligence.recordCapSuccess(requestUrl);

          if (isSegmented) {
            const targetLength = chunk.endByte - chunk.startByte + 1;
            const finishCheck = async () => {
              // The server may close its side while our serialized data
              // pipeline still holds received-but-unwritten bytes (pending
              // buffers + write queue). Flush the pipeline completely before
              // judging completeness, otherwise a healthy download is falsely
              // rejected as Premature EOF (and the retry path corrupts state).
              const deadline = Date.now() + 60000;
              while ((dataHandlerBusy || pendingBuffers.length > 0) && !signal.aborted && !isRejected) {
                if (Date.now() > deadline) break;
                await new Promise(r => setTimeout(r, 25));
              }
              try { await writeQueue.drain(); } catch (e) {}
              if (signal.aborted || isRejected) {
                resolve();
                return;
              }
              if (chunk.downloadedBytes === targetLength) {
                chunk.status = 'done';
                chunk.speedBps = 0;
                resolve();
              } else {
                chunk.status = 'idle';
                safeReject(new Error(`Premature EOF: Received ${chunk.downloadedBytes}/${targetLength} bytes`));
              }
            };
            if (chunk.downloadedBytes === targetLength) {
              chunk.status = 'done';
              chunk.speedBps = 0;
              resolve();
            } else {
              finishCheck();
            }
          } else {
            chunk.status = 'done';
            chunk.speedBps = 0;
            resolve();
          }
        });

        res.on('error', err => {
          if (stallCheckTimer) clearInterval(stallCheckTimer);
          if (signal.aborted || isRejected) return resolve();
          chunk.status = 'idle';
          safeReject(err);
        });
      });

      req.on('timeout', () => {
        if (stallCheckTimer) clearInterval(stallCheckTimer);
        req.destroy();
        this.hostIntelligence.recordRequestResult(requestUrl, undefined, Date.now() - reqStartTime, 0, true, true);
        safeReject(new Error(hasReceivedHeaders ? 'Headers Timeout' : 'Connection Timeout'));
      });

      req.on('error', err => {
        if (stallCheckTimer) clearInterval(stallCheckTimer);
        if (signal.aborted || isRejected) return resolve();
        chunk.status = 'idle';
        safeReject(err);
      });

      req.end();
    });
  }

  private humanizeError(raw: string): string {
    if (!raw) return 'Download interrupted. Click Retry.';
    if (raw.includes('Protocol Violation') || raw.includes('Content-Range') || raw.includes('Boundary Violation') || raw.includes('Disk Write Error')) {
      return `Error: ${raw}`;
    }
    if (raw.includes('ECONNRESET') || raw.includes('socket hang up') || raw.includes('EPIPE')) {
      return 'Network connection dropped by server. Auto-reconnecting...';
    }
    if (raw.includes('ETIMEDOUT') || raw.includes('timed out') || raw.includes('Timeout')) {
      return 'Server response timed out. Click Retry to reconnect.';
    }
    if (raw.includes('ENOTFOUND')) {
      return 'Server address not found. Please check internet connection.';
    }
    if (raw.includes('403')) {
      return 'Server refused this automated download. Refresh the link in your browser or use a server that permits download managers.';
    }
    if (raw.includes('401')) {
      return 'Download authorization expired. Refresh the link or recapture it from your signed-in browser.';
    }
    if (raw.includes('404')) {
      return 'File not found on remote server.';
    }
    return raw;
  }

  public async pauseDownload(id: string): Promise<void> {
    const item = this.downloads.get(id);
    if (!item) return;

    item.status = 'paused';
    item.speedBps = 0;
    item.etaSeconds = 0;

    const scheduler = this.schedulers.get(id);
    if (scheduler) scheduler.pause();

    const controllers = this.abortControllers.get(id);
    if (controllers) {
      controllers.forEach(c => {
        try { c.abort(); } catch (e) {}
      });
      this.abortControllers.delete(id);
    }

    const interval = this.speedIntervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.speedIntervals.delete(id);
    }

    const activePromise = this.activeWorkersPromise.get(id);
    if (activePromise) {
      try {
        await Promise.race([
          activePromise,
          new Promise(r => setTimeout(r, 2000)),
        ]);
      } catch (e) {}
      this.activeWorkersPromise.delete(id);
    }

    const writeQueue = this.writeQueues.get(id);
    if (writeQueue) {
      try {
        await writeQueue.drain();
      } catch (e) {}
      this.writeQueues.delete(id);
    }

    const fd = this.fileDescriptors.get(id);
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (e) {}
      this.fileDescriptors.delete(id);
    }

    this.saveState();
    this.notify();
    this.checkNextQueuedDownload();
  }

  public async resumeDownload(id: string): Promise<void> {
    const item = this.downloads.get(id);
    if (!item || (item.status !== 'paused' && item.status !== 'error')) return;

    // If the probe never completed (e.g. paused/cancelled during 'probing'), there is
    // no range map to resume from. Restart the pipeline fresh instead of silently
    // spawning zero workers and dead-ending in 'paused'.
    if (!item.totalBytes || !item.chunks || item.chunks.length === 0) {
      await this.startDownload(id);
      return;
    }

    const dir = path.dirname(item.destinationPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(item.destinationPath)) {
      const fd = fs.openSync(item.destinationPath, 'w');
      if (item.totalBytes > 0) {
        try { fs.ftruncateSync(fd, item.totalBytes); } catch (e) {}
      }
      fs.closeSync(fd);
    }

    item.status = 'downloading';
    item.error = undefined;
    this.notify();

    const fd = fs.openSync(item.destinationPath, 'r+');
    this.fileDescriptors.set(id, fd);

    const writeQueue = new BoundedWriteQueue(fd, { maxQueuedBytes: this.maxQueueBytes });
    this.writeQueues.set(id, writeQueue);

    const optimalHostConns = this.hostIntelligence.getOptimalConnectionsForHost(item.url, item.connections);
    const scheduler = new DynamicRangeScheduler(item.totalBytes, optimalHostConns);
    if (optimalHostConns === 1 && item.chunks && item.chunks.length > 1) {
      scheduler.consolidateToOneStream(item.downloadedBytes);
    } else {
      scheduler.restoreChunks(item.chunks);
    }
    this.schedulers.set(id, scheduler);
    item.chunks = scheduler.chunks;

    const adaptiveController = new AdaptiveConcurrencyController({
      minWorkers: 1,
      maxWorkers: optimalHostConns,
      initialWorkers: optimalHostConns,
    });
    this.adaptiveControllers.set(id, adaptiveController);

    const controllers: AbortController[] = [];
    this.abortControllers.set(id, controllers);

    let prevTotalDownloaded = item.downloadedBytes;
    let activeWorkerCount = 0;

    const incompleteChunks = scheduler.chunks.filter(c => c.status !== 'done' && (c.totalBytes === 0 || c.downloadedBytes < c.totalBytes));
    
    let completionResolve: () => void = () => {};
    const workersCoordinator = new Promise<void>(resolve => {
      completionResolve = resolve;
    });
    this.activeWorkersPromise.set(id, workersCoordinator);

    const checkCompletion = () => {
      if (activeWorkerCount === 0) {
        completionResolve();
      }
    };

    const runWorker = async (initialChunk: ChunkProgress) => {
      activeWorkerCount++;
      let currentChunk: ChunkProgress | null = initialChunk;
      while (currentChunk && item.status === 'downloading') {
        const controller = new AbortController();
        controllers.push(controller);
        try {
          await this.downloadChunkWithRetry(item, currentChunk, writeQueue, controller.signal, item.url);
        } catch (chunkErr: any) {
          scheduler.returnUnfinishedRange(currentChunk.id);
          if (this.statusOf(item) !== 'paused') {
            item.status = 'error';
            item.error = chunkErr.message || String(chunkErr);
            controllers.forEach(c => c.abort());
          }
          break;
        }

        if (item.resumable && item.totalBytes > 0 && item.status === 'downloading') {
          if (activeWorkerCount <= adaptiveController.getTargetWorkers()) {
            currentChunk = scheduler.stealWork();
            if (currentChunk) {
              item.chunks = scheduler.chunks;
              this.notify();
            } else {
              // No donor to split: reclaim orphaned idle chunks instead of exiting.
              const orphan = this.claimIdleChunk(scheduler);
              currentChunk = orphan;
              if (orphan) {
                item.chunks = scheduler.chunks;
                this.notify();
              }
            }
          } else {
            currentChunk = null;
          }
        } else {
          currentChunk = null;
        }
      }
      activeWorkerCount--;
      checkCompletion();
    };

    if (incompleteChunks.length === 0) {
      completionResolve();
    } else {
      incompleteChunks.forEach(chunk => runWorker(chunk));
    }    const speedInterval = setInterval(() => {
      if (item.status !== 'downloading') return;
      const currentTotal = item.chunks.reduce((acc, c) => acc + c.downloadedBytes, 0);
      const bytesInInterval = currentTotal - prevTotalDownloaded;
      prevTotalDownloaded = currentTotal;
      item.downloadedBytes = currentTotal;
      item.speedBps = Math.max(0, bytesInInterval);

      adaptiveController.recordThroughputSample(bytesInInterval, 1000);

      // Connection-cap recovery for previously throttled hosts.
      if (this.hostIntelligence.consumeCapRecovery(item.url)) {
        const restored = this.hostIntelligence.getOptimalConnectionsForHost(item.url, item.connections);
        adaptiveController.setWorkerLimits(1, restored);
      }

      const scaleAction = adaptiveController.evaluate(activeWorkerCount);

      if (scaleAction === 'scale_up' && item.resumable && item.totalBytes > 0) {
        const stolen = this.claimIdleChunk(scheduler) || scheduler.stealWork();
        if (stolen) {
          item.chunks = scheduler.chunks;
          runWorker(stolen);
        }
      }

      if (item.speedBps > 0 && item.totalBytes > currentTotal) {
        item.etaSeconds = Math.round((item.totalBytes - currentTotal) / item.speedBps);
      }
      this.notify();
    }, 1000);

    this.speedIntervals.set(id, speedInterval);

    try {
      await workersCoordinator;
      await writeQueue.drain();

      clearInterval(speedInterval);
      this.speedIntervals.delete(id);
      this.activeWorkersPromise.delete(id);
      this.writeQueues.delete(id);
      this.schedulers.delete(id);
      this.adaptiveControllers.delete(id);

      try { fs.closeSync(fd); } catch (e) {}
      this.fileDescriptors.delete(id);

      if (item.status === 'downloading') {
        item.chunks = scheduler ? scheduler.chunks : item.chunks;
        const totalDownloaded = item.chunks.reduce((acc, c) => acc + c.downloadedBytes, 0);
        if (item.totalBytes > 0 && totalDownloaded >= item.totalBytes) {
          item.status = 'completed';
          item.downloadedBytes = item.totalBytes;
        } else if (item.totalBytes === 0 && totalDownloaded > 0) {
          item.status = 'completed';
          item.totalBytes = totalDownloaded;
          item.downloadedBytes = totalDownloaded;
        } else {
          item.status = 'paused';
        }
        item.speedBps = 0;
        item.etaSeconds = 0;
        item.completedAt = Date.now();
        this.saveState();
        this.notify();
      }
    } catch (err: any) {
      if (item.status === 'paused') return;
      item.status = 'error';
      item.error = this.humanizeError(err.message);
      this.saveState();
      this.notify();
    }
  }

  /**
   * Change the requested parallel-stream count for a download at any stage.
   * Active downloads get the new ceiling applied live via their adaptive
   * controller; paused/queued downloads use it on next start/resume.
   */
  public setDownloadConnections(id: string, connections: number): DownloadItem {
    const item = this.downloads.get(id);
    if (!item) throw new Error('Download not found');
    if (connections <= 0) {
      // Sentinel 0 re-engages Auto mode: the engine re-picks the stream count
      // on the next start from size tiers, range support and host caps.
      item.connections = 64;
      item.autoStreams = true;
    } else {
      // An explicit positive count switches the item to Manual mode.
      const clamped = Math.max(1, Math.min(64, Math.floor(connections)));
      item.connections = clamped;
      item.autoStreams = false;
    }

    const controller = this.adaptiveControllers.get(id);
    if (controller && (item.status === 'downloading' || item.status === 'probing')) {
      // Auto mode: give the controller full headroom so it can grow streams;
      // Manual mode: the user's explicit count.
      const requested = item.autoStreams ? 64 : item.connections;
      const target = this.hostIntelligence.getOptimalConnectionsForHost(item.url, requested);
      controller.setWorkerLimits(1, target);
    }

    this.saveState();
    this.notify();
    return item;
  }

  /**
   * Retry every errored download at once (Respect maxConcurrentDownloads:
   * items beyond the cap are flipped to 'queued' and the queue pump starts
   * them as slots free up). Returns the ids that were retried/queued.
   */
  public async retryAllFailed(): Promise<string[]> {
    const failed = Array.from(this.downloads.values()).filter((d) => d.status === 'error');
    const retried: string[] = [];
    for (const item of failed) {
      item.error = undefined;
      if (this.maxConcurrentDownloads > 0 && this.getActiveCount() >= this.maxConcurrentDownloads) {
        item.status = 'queued';
      } else {
        item.status = 'probing';
        retried.push(item.id);
        // fire-and-forget: each retry is an independent async pipeline
        void this.startDownload(item.id);
      }
    }
    if (failed.length > 0) {
      this.saveState();
      this.notify();
    }
    return retried;
  }

  /**
   * Integrity scan: walk every completed row, re-verify its file on disk
   * (SHA-256; byte-exact when the file matches the deterministic generator
   * registry), record the verdict on the row, and persist a baseline ledger
   * so subsequent scans can detect drift even for unregistered content.
   */
  public async scanIntegrity(): Promise<{
    scanned: number;
    verified: number;
    mismatch: number;
    unverified: number;
    missing: number;
    unreadable: number;
    results: IntegrityVerdict[];
  }> {
    const results: IntegrityVerdict[] = [];
    for (const item of this.downloads.values()) {
      if (item.status !== 'completed') continue;
      const verdict = verifyFile(item.destinationPath, item.id, item.filename);
      results.push(verdict);

      // Record the verdict on the row itself.
      item.integrity = {
        status: verdict.status,
        checkedAt: Date.now(),
        expectedSha256: verdict.expectedSha256,
        actualSha256: verdict.actualSha256,
      };

      // Baseline ledger: remember the actual hash of unregistered content so
      // a LATER scan can flag drift for files the registry does not know.
      // Compare BEFORE updating: the stored baseline is the hash from the
      // previous scan, not the one just computed.
      if (verdict.status === 'unverified' && verdict.actualSha256) {
        const previous = this.integrityBaseline.get(item.id);
        if (previous && previous !== verdict.actualSha256) {
          verdict.status = 'mismatch';
          verdict.expectedSha256 = previous;
          verdict.error = 'content changed since a previous scan (baseline drift)';
          if (item.integrity) item.integrity.status = 'mismatch';
        }
        // Adopt the new hash either way so drift is reported once per change,
        // not re-flagged on every subsequent scan.
        this.integrityBaseline.set(item.id, verdict.actualSha256);
      } else if (verdict.status !== 'unverified') {
        this.integrityBaseline.delete(item.id);
      }
    }

    this.saveState();
    this.persistIntegrityLedger();
    this.notify();

    const by = (s: string) => results.filter((r) => r.status === s).length;
    return {
      scanned: results.length,
      verified: by('verified'),
      mismatch: by('mismatch'),
      unverified: by('unverified'),
      missing: by('missing'),
      unreadable: by('unreadable'),
      results,
    };
  }

  private integrityLedgerPath(): string {
    return path.join(this.defaultDownloadDir, '.hyper_integrity.json');
  }

  private persistIntegrityLedger(): void {
    try {
      const obj: Record<string, string> = {};
      this.integrityBaseline.forEach((hash, id) => { obj[id] = hash; });
      fs.writeFileSync(this.integrityLedgerPath(), JSON.stringify(obj, null, 2), 'utf-8');
    } catch (e) {
      console.error('[Engine] Failed to persist integrity ledger:', e);
    }
  }

  private loadIntegrityLedger(): void {
    try {
      const p = this.integrityLedgerPath();
      if (fs.existsSync(p)) {
        const obj = JSON.parse(fs.readFileSync(p, 'utf-8'));
        for (const [id, hash] of Object.entries(obj)) {
          this.integrityBaseline.set(id, String(hash));
        }
      }
    } catch (e) {
      console.error('[Engine] Failed to load integrity ledger:', e);
    }
  }

  public async updateDownloadUrl(id: string, newUrl: string): Promise<DownloadItem> {
    const item = this.downloads.get(id);
    if (!item) throw new Error('Download not found');
    const trimmed = newUrl.trim();
    item.url = trimmed;
    const optimalConns = this.hostIntelligence.getOptimalConnectionsForHost(trimmed, item.connections || 32);
    item.connections = optimalConns;
    if (item.status === 'error' || item.status === 'paused') {
      item.status = 'paused';
      item.error = undefined;
    }
    // Only auto-derived names may be refined by the new URL's probe hints;
    // a user-typed filename is never silently replaced (Refresh-URL flow).
    const probe2 = await this.probeUrl(trimmed, 5, new Set(), false, item.browserCredentials).catch(() => null);
    if (probe2?.filename && !item.userFilename) {
      const targetDir = path.dirname(item.destinationPath);
      const cleanName = this.pickNonCollidingName(targetDir, this.sanitizeFilename(probe2.filename), item.id, item.destinationPath);
      item.filename = cleanName;
      item.destinationPath = path.join(targetDir, cleanName);
      item.category = this.detectCategory(cleanName);
    }
    if (optimalConns === 1 && item.chunks && item.chunks.length > 1) {
      const scheduler = new DynamicRangeScheduler(item.totalBytes, 1);
      scheduler.consolidateToOneStream(item.downloadedBytes);
      item.chunks = scheduler.chunks;
    }
    this.saveState();
    this.notify();
    return item;
  }

  public async removeDownload(id: string, deleteFile: boolean = false): Promise<void> {
    await this.pauseDownload(id);
    const item = this.downloads.get(id);
    if (item && deleteFile && fs.existsSync(item.destinationPath)) {
      try { fs.unlinkSync(item.destinationPath); } catch (e) {}
    }
    this.downloads.delete(id);
    this.saveState();
    this.notify();
  }

  private probeUrl(
    url: string,
    maxRedirects: number = 5,
    visitedUrls: Set<string> = new Set(),
    allowDowngrade: boolean = false,
    credentials?: { cookies?: string; userAgent?: string; referrer?: string; origin?: string }
  ): Promise<{ contentLength: number; acceptRanges: boolean; filename?: string; finalUrl?: string }> {
    return new Promise((resolve) => {
      try {
        const urlValidation = validateUrl(url, this.allowLocalhost);
        if (!urlValidation.valid) {
          return resolve({ contentLength: 0, acceptRanges: false, finalUrl: url });
        }

        if (visitedUrls.has(url)) {
          // Redirect loop detected
          return resolve({ contentLength: 0, acceptRanges: false, finalUrl: url });
        }
        visitedUrls.add(url);

        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const lib = isHttps ? https : http;

        // Host-scoped credentials for the probe: cookie-gated URLs must
        // authenticate before the download can even be planned.
        const probeHeaders: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
        };
        const probeReferer = this.hostIntelligence.getHostReferer(url);
        if (probeReferer) probeHeaders['Referer'] = probeReferer;
        if (credentials) {
          if (credentials.cookies && (!credentials.origin || parsedUrl.origin === credentials.origin)) {
            probeHeaders['Cookie'] = credentials.cookies;
          }
          if (credentials.userAgent) probeHeaders['User-Agent'] = credentials.userAgent;
          if (credentials.referrer) probeHeaders['Referer'] = credentials.referrer;
        }

        const req = lib.request(parsedUrl, {
          method: 'HEAD',
          headers: probeHeaders,
          lookup: createSSRFSafeLookup(this.allowLocalhost),
          timeout: 8000,
        }, res => {
          if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
            const redirectUrl = new URL(res.headers.location, url).toString();
            const redirParsed = new URL(redirectUrl);
            if (isHttps && redirParsed.protocol === 'http:' && !allowDowngrade) {
              // Block unprompted HTTPS -> HTTP downgrade
              return resolve({ contentLength: 0, acceptRanges: false, finalUrl: url });
            }
            return this.probeUrl(redirectUrl, maxRedirects - 1, visitedUrls, allowDowngrade, credentials).then(resolve);
          }

          if (!res.statusCode || res.statusCode >= 400 || !res.headers['content-length']) {
            return this.probeWithGetRange(url, maxRedirects, new Set(), false, credentials).then(resolve);
          }

          const contentLength = parseInt(res.headers['content-length'] || '0', 10);
          const hasAcceptRangesHeader = (res.headers['accept-ranges'] || '').toLowerCase() === 'bytes';

          let filename: string | undefined;
          const disposition = res.headers['content-disposition'];
          if (disposition && disposition.includes('filename=')) {
            const match = disposition.match(/filename=["']?([^"';]+)["']?/);
            if (match && match[1]) filename = match[1].trim();
          }

          if (!hasAcceptRangesHeader) {
            return this.probeWithGetRange(url, maxRedirects, new Set(), false, credentials).then(resProbe => {
              this.hostIntelligence.setCapabilities(url, {
                supportsRanges: resProbe.acceptRanges,
                supportsHEAD: true,
              });
              resolve({
                contentLength: resProbe.contentLength || contentLength,
                acceptRanges: resProbe.acceptRanges,
                filename: filename || resProbe.filename,
                finalUrl: url,
              });
            });
          }

          this.hostIntelligence.setCapabilities(url, {
            supportsRanges: true,
            supportsHEAD: true,
          });

          // HTTP/2 capability is primed centrally in startDownload via
          // primeHttp2Gate() — covers ALL probe paths (HEAD-with-size,
          // ranged-GET fallback, redirects), so no per-path gating here.
          resolve({ contentLength, acceptRanges: true, filename, finalUrl: url });
        });

        req.on('error', () => {
          this.probeWithGetRange(url, maxRedirects, new Set(), false, credentials).then(resolve);
        });

        req.on('timeout', () => {
          req.destroy();
          this.probeWithGetRange(url, maxRedirects, new Set(), false, credentials).then(resolve);
        });

        req.end();
      } catch (e) {
        resolve({ contentLength: 0, acceptRanges: false, finalUrl: url });
      }
    });
  }

  private probeWithGetRange(
    url: string,
    maxRedirects: number = 5,
    visitedUrls: Set<string> = new Set(),
    allowDowngrade: boolean = false,
    credentials?: { cookies?: string; userAgent?: string; referrer?: string; origin?: string }
  ): Promise<{ contentLength: number; acceptRanges: boolean; filename?: string; finalUrl?: string }> {
    return new Promise((resolve) => {
      try {
        const urlValidation = validateUrl(url, this.allowLocalhost);
        if (!urlValidation.valid) {
          return resolve({ contentLength: 0, acceptRanges: false, finalUrl: url });
        }

        if (visitedUrls.has(url)) {
          return resolve({ contentLength: 0, acceptRanges: false, finalUrl: url });
        }
        visitedUrls.add(url);

        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const lib = isHttps ? https : http;

        // Host-scoped credentials for the GET-range fallback probe.
        const getRangeHeaders: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Range': 'bytes=0-0',
        };
        const getRangeReferer = this.hostIntelligence.getHostReferer(url);
        if (getRangeReferer) getRangeHeaders['Referer'] = getRangeReferer;
        if (credentials) {
          if (credentials.cookies && (!credentials.origin || parsedUrl.origin === credentials.origin)) {
            getRangeHeaders['Cookie'] = credentials.cookies;
          }
          if (credentials.userAgent) getRangeHeaders['User-Agent'] = credentials.userAgent;
          if (credentials.referrer) getRangeHeaders['Referer'] = credentials.referrer;
        }

        const req = lib.request(parsedUrl, {
          method: 'GET',
          headers: getRangeHeaders,
          lookup: createSSRFSafeLookup(this.allowLocalhost),
          timeout: 8000,
        }, res => {
          if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
            const redirectUrl = new URL(res.headers.location, url).toString();
            const redirParsed = new URL(redirectUrl);
            if (isHttps && redirParsed.protocol === 'http:' && !allowDowngrade) {
              req.destroy();
              return resolve({ contentLength: 0, acceptRanges: false, finalUrl: url });
            }
            req.destroy();
            return this.probeWithGetRange(redirectUrl, maxRedirects - 1, visitedUrls, allowDowngrade, credentials).then(resolve);
          }

          let filename: string | undefined;
          const disposition = res.headers['content-disposition'];
          if (disposition && disposition.includes('filename=')) {
            const match = disposition.match(/filename=["']?([^"';]+)["']?/);
            if (match && match[1]) filename = match[1].trim();
          }

          if (res.statusCode === 206 && res.headers['content-range']) {
            const rangeMatch = res.headers['content-range'].match(/^bytes\s+0-0\/(\d+|\*)$/);
            const total = (rangeMatch && rangeMatch[1] !== '*') ? parseInt(rangeMatch[1], 10) : 0;
            req.destroy();
            this.hostIntelligence.setCapabilities(url, { supportsRanges: true, supportsHEAD: false });
            return resolve({ contentLength: total, acceptRanges: true, filename, finalUrl: url });
          }

          const fallbackLength = parseInt(res.headers['content-length'] || '0', 10);
          req.destroy();
          this.hostIntelligence.setCapabilities(url, { supportsRanges: false, supportsHEAD: false });
          resolve({ contentLength: fallbackLength, acceptRanges: false, filename, finalUrl: url });
        });

        req.on('error', () => {
          resolve({ contentLength: 0, acceptRanges: false, finalUrl: url });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ contentLength: 0, acceptRanges: false, finalUrl: url });
        });

        req.end();
      } catch (e) {
        resolve({ contentLength: 0, acceptRanges: false, finalUrl: url });
      }
    });
  }
}
