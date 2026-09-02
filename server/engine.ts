import http from 'http';
import https from 'https';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { URL } from 'url';

export function createSSRFSafeLookup(allowLocalhost: boolean = true) {
  return (hostname: string, options: any, callback: (err: Error | null, address: string, family: number) => void) => {
    dns.lookup(hostname, options, (err, address, family) => {
      if (err) return callback(err, address, family);
      if (!allowLocalhost) {
        const ipValidation = validateUrl(`http://${address}`, false);
        if (!ipValidation.valid) {
          return callback(new Error(`DNS Rebinding / SSRF blocked: ${hostname} resolved to forbidden IP ${address}`), '', 4);
        }
      }
      callback(null, address, family);
    });
  };
}
import { DownloadItem, ChunkProgress } from '../src/types/download';
import { BoundedWriteQueue } from './write_queue';
import { DynamicRangeScheduler } from './scheduler';
import { HostIntelligence } from './host_intelligence';
import { AdaptiveConcurrencyController } from './adaptive_concurrency';
import { ChunkOptimizer } from './chunk_optimizer';

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

export class DownloadEngine {
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
  private stateTmpFilePath: string;
  public defaultDownloadDir: string;
  public maxQueueBytes: number = 32 * 1024 * 1024; // 32 MB
  public hostIntelligence: HostIntelligence = HostIntelligence.getInstance();
  private onUpdateCallback: () => void = () => {};

  constructor(onUpdate?: () => void, customDownloadDir?: string, maxQueueBytes?: number, options?: { allowLocalhost?: boolean }) {
    if (onUpdate) this.onUpdateCallback = onUpdate;
    if (maxQueueBytes) this.maxQueueBytes = maxQueueBytes;
    if (options && options.allowLocalhost !== undefined) this.allowLocalhost = options.allowLocalhost;
    this.defaultDownloadDir = customDownloadDir || path.join(os.homedir(), 'Downloads', 'HyperDownloader');
    if (!fs.existsSync(this.defaultDownloadDir)) {
      fs.mkdirSync(this.defaultDownloadDir, { recursive: true });
    }

    this.stateFilePath = path.join(this.defaultDownloadDir, '.hyper_state.json');
    this.stateTmpFilePath = path.join(this.defaultDownloadDir, '.hyper_state.json.tmp');
    this.loadState();
    this.startPeriodicCheckpoint();
  }

  public setUpdateListener(callback: () => void) {
    this.onUpdateCallback = callback;
  }

  private notify() {
    if (typeof this.onUpdateCallback === 'function') {
      this.onUpdateCallback();
    }
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
      const items = Array.from(this.downloads.values()).map(d => ({
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
    for (const [id, interval] of this.speedIntervals.entries()) {
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

  private detectCategory(filename: string): DownloadItem['category'] {
    const ext = path.extname(filename).toLowerCase();
    if (['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv'].includes(ext)) return 'video';
    if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'].includes(ext)) return 'audio';
    if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.iso'].includes(ext)) return 'compressed';
    if (['.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm', '.apk'].includes(ext)) return 'program';
    if (['.pdf', '.docx', '.doc', '.xlsx', '.pptx', '.txt', '.epub'].includes(ext)) return 'document';
    return 'other';
  }

  public async addDownload(url: string, customFilename?: string, customFolder?: string, connections: number = 32): Promise<DownloadItem> {
    const id = 'hyp_' + Math.random().toString(36).substring(2, 9);
    const urlValidation = validateUrl(url, this.allowLocalhost);
    if (!urlValidation.valid) {
      throw new Error(`Invalid download URL: ${urlValidation.error}`);
    }

    const destFolder = customFolder || this.defaultDownloadDir;
    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true });
    }

    let rawName = customFilename || path.basename(new URL(url).pathname) || 'download_file';
    const safeDest = this.resolveSafeDestination(destFolder, rawName);
    const cleanName = safeDest.filename;

    const item: DownloadItem = {
      id,
      url,
      filename: cleanName,
      destinationPath: safeDest.fullPath,
      totalBytes: 0,
      downloadedBytes: 0,
      status: 'probing',
      speedBps: 0,
      connections: Math.max(1, Math.min(connections, 64)),
      chunks: [],
      category: this.detectCategory(cleanName),
      resumable: false,
      etaSeconds: 0,
      createdAt: new Date().toISOString(),
    };

    this.downloads.set(id, item);
    this.saveState();
    this.notify();

    this.startDownload(id);
    return item;
  }

  public async startDownload(id: string) {
    const item = this.downloads.get(id);
    if (!item) return;

    item.status = 'probing';
    item.error = undefined;
    this.notify();

    try {
      const probe = await this.probeUrl(item.url);
      if (item.status === 'paused' || item.status === 'cancelled') return;

      item.totalBytes = probe.contentLength;
      item.resumable = probe.acceptRanges;
      const requestUrl = probe.finalUrl || item.url;
      if (probe.finalUrl) item.url = probe.finalUrl;
      
      if (probe.filename) {
        const cleanName = this.sanitizeFilename(probe.filename);
        item.filename = cleanName;
        const targetDir = path.dirname(item.destinationPath);
        item.destinationPath = path.join(targetDir, cleanName);
        item.category = this.detectCategory(cleanName);
      }

      const dir = path.dirname(item.destinationPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const fd = fs.openSync(item.destinationPath, 'w+');
      this.fileDescriptors.set(id, fd);

      const writeQueue = new BoundedWriteQueue(fd, { maxQueuedBytes: this.maxQueueBytes });
      this.writeQueues.set(id, writeQueue);

      if (item.totalBytes > 0) {
        try {
          fs.ftruncateSync(fd, item.totalBytes);
        } catch (e) {}
      }

      // P3 Small-File Fast Path & Dynamic Optimization
      const isSmallFile = item.totalBytes > 0 && item.totalBytes <= 2 * 1024 * 1024;
      const initialConns = (item.resumable && item.totalBytes > 0 && !isSmallFile) 
        ? Math.min(item.connections, 4) 
        : 1;

      const adaptiveController = new AdaptiveConcurrencyController({
        minWorkers: isSmallFile ? 1 : 2,
        maxWorkers: item.connections,
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

      const runWorker = async (initialChunk: ChunkProgress) => {
        activeWorkerCount++;
        let currentChunk: ChunkProgress | null = initialChunk;
        while (currentChunk && item.status === 'downloading') {
          const controller = new AbortController();
          controllers.push(controller);
          try {
            await this.downloadChunkWithRetry(item, currentChunk, writeQueue, controller.signal, requestUrl);
          } catch (chunkErr: any) {
            scheduler.returnUnfinishedRange(currentChunk.id);
            if (item.status !== 'paused') {
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
              currentChunk = scheduler.stealWork(currentChunk.speedBps);
              if (currentChunk) {
                telemetry.recordSteal(initialChunk.id, currentChunk.id, currentChunk.startByte, currentChunk.endByte);
                item.chunks = scheduler.chunks;
                this.notify();
              }
            } else {
              currentChunk = null; // Cleanly scale down excess worker
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

        const remainingTotal = item.totalBytes > 0 ? (item.totalBytes - currentTotal) : 0;
        const isNearCompletion = item.totalBytes > 0 && remainingTotal < 256 * 1024;

        const scaleAction = isNearCompletion ? 'maintain' : adaptiveController.evaluate({
          activeWorkersCount: activeWorkerCount,
          remainingBytes: remainingTotal,
        });

        if (scaleAction === 'scale_up' && item.resumable && item.totalBytes > 0 && !isNearCompletion) {
          const stolen = scheduler.stealWork();
          if (stolen) {
            telemetry.recordSteal(0, stolen.id, stolen.startByte, stolen.endByte);
            item.chunks = scheduler.chunks;
            runWorker(stolen);
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
        item.completedAt = new Date().toISOString();
        this.saveState();
        this.notify();
      }

    } catch (err: any) {
      if (item.status === 'paused' || item.status === 'cancelled') return;
      item.status = 'error';
      item.error = this.humanizeError(err.message);
      item.speedBps = 0;
      const interval = this.speedIntervals.get(id);
      if (interval) clearInterval(interval);
      this.saveState();
      this.notify();
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
    while (attempts < maxRetries) {
      if (signal.aborted || item.status === 'paused') return;
      try {
        await this.downloadChunk(item, chunk, writeQueue, signal, requestUrl);
        return;
      } catch (err: any) {
        if (signal.aborted || item.status === 'paused') return;

        // Drain pending writes so committed byte progress is accurate before retrying
        try {
          await writeQueue.drain();
        } catch (e) {}

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

        const delay = this.hostIntelligence.calculateBackoffDelay(attempts, err.retryAfterHeader);
        await new Promise(r => setTimeout(r, delay));
      }
    }
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
      const agent = isHttps ? httpsAgent : httpAgent;

      const isSegmented = item.resumable && item.totalBytes > 0;
      const currentStart = chunk.startByte + chunk.downloadedBytes;
      const expectedEnd = chunk.endByte;

      if (isSegmented && currentStart > expectedEnd) {
        chunk.status = 'done';
        resolve();
        return;
      }

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 HyperDownloader/Adaptive',
        'Accept': '*/*',
        'Connection': 'keep-alive',
      };

      if (isSegmented) {
        headers['Range'] = `bytes=${currentStart}-${expectedEnd}`;
      }

      const reqStartTime = Date.now();
      let hasReceivedHeaders = false;
      let lastDataTime = Date.now();
      let stallCheckTimer: NodeJS.Timeout | null = null;

      // Inactivity / Stall Detector
      const startStallTimer = () => {
        stallCheckTimer = setInterval(() => {
          if (signal.aborted || isRejected) {
            if (stallCheckTimer) clearInterval(stallCheckTimer);
            return;
          }
          if (Date.now() - lastDataTime > 6000) { // 6s inactivity timeout
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
        hasReceivedHeaders = true;
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

        res.on('data', (buffer: Buffer) => {
          if (signal.aborted || isRejected) return;
          lastDataTime = Date.now();
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
                res.pause();
                writeQueue.onLowWater(() => {
                  if (!signal.aborted && !isRejected) {
                    res.resume();
                  }
                });
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
                res.pause();
                writeQueue.onLowWater(() => {
                  if (!signal.aborted && !isRejected) {
                    res.resume();
                  }
                });
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
        });

        res.on('end', () => {
          if (stallCheckTimer) clearInterval(stallCheckTimer);
          if (signal.aborted || isRejected) {
            resolve();
            return;
          }

          if (isSegmented) {
            const targetLength = chunk.endByte - chunk.startByte + 1;
            if (chunk.downloadedBytes === targetLength) {
              chunk.status = 'done';
              chunk.speedBps = 0;
              resolve();
            } else {
              chunk.status = 'idle';
              safeReject(new Error(`Premature EOF: Received ${chunk.downloadedBytes}/${targetLength} bytes`));
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
    if (raw.includes('403') || raw.includes('401')) {
      return 'Access denied or download link expired by server.';
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
  }

  public async resumeDownload(id: string): Promise<void> {
    const item = this.downloads.get(id);
    if (!item || (item.status !== 'paused' && item.status !== 'error')) return;

    const dir = path.dirname(item.destinationPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(item.destinationPath)) {
      const fd = fs.openSync(item.destinationPath, 'w+');
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

    const scheduler = new DynamicRangeScheduler(item.totalBytes, item.connections);
    scheduler.restoreChunks(item.chunks);
    this.schedulers.set(id, scheduler);
    item.chunks = scheduler.chunks;

    const adaptiveController = new AdaptiveConcurrencyController({
      minWorkers: 2,
      maxWorkers: item.connections,
      initialWorkers: Math.min(item.connections, 4),
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
          if (item.status !== 'paused') {
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
    }

    const speedInterval = setInterval(() => {
      if (item.status !== 'downloading') return;
      const currentTotal = item.chunks.reduce((acc, c) => acc + c.downloadedBytes, 0);
      const bytesInInterval = currentTotal - prevTotalDownloaded;
      prevTotalDownloaded = currentTotal;
      item.downloadedBytes = currentTotal;
      item.speedBps = Math.max(0, bytesInInterval);

      adaptiveController.recordThroughputSample(bytesInInterval, 1000);
      const scaleAction = adaptiveController.evaluate(activeWorkerCount);

      if (scaleAction === 'scale_up' && item.resumable && item.totalBytes > 0) {
        const stolen = scheduler.stealWork();
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
        item.completedAt = new Date().toISOString();
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
    allowDowngrade: boolean = false
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

        const req = lib.request(parsedUrl, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HyperDownloader/Adaptive',
          },
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
            return this.probeUrl(redirectUrl, maxRedirects - 1, visitedUrls, allowDowngrade).then(resolve);
          }

          if (!res.statusCode || res.statusCode >= 400 || !res.headers['content-length']) {
            return this.probeWithGetRange(url, maxRedirects).then(resolve);
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
            return this.probeWithGetRange(url, maxRedirects).then(resProbe => {
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

          resolve({ contentLength, acceptRanges: true, filename, finalUrl: url });
        });

        req.on('error', () => {
          this.probeWithGetRange(url, maxRedirects).then(resolve);
        });

        req.on('timeout', () => {
          req.destroy();
          this.probeWithGetRange(url, maxRedirects).then(resolve);
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
    allowDowngrade: boolean = false
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

        const req = lib.request(parsedUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HyperDownloader/Adaptive',
            'Range': 'bytes=0-0',
          },
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
            return this.probeWithGetRange(redirectUrl, maxRedirects - 1, visitedUrls, allowDowngrade).then(resolve);
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
