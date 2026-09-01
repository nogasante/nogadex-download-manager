import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { URL } from 'url';
import { DownloadItem, ChunkProgress } from '../src/types/download';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 256 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 256 });

export class DownloadEngine {
  public downloads: Map<string, DownloadItem> = new Map();
  private abortControllers: Map<string, AbortController[]> = new Map();
  private fileDescriptors: Map<string, number> = new Map();
  private speedIntervals: Map<string, NodeJS.Timeout> = new Map();
  private stateFilePath: string;
  public defaultDownloadDir: string;
  private onUpdateCallback: () => void = () => {};

  constructor(onUpdate?: () => void) {
    if (onUpdate) this.onUpdateCallback = onUpdate;
    this.defaultDownloadDir = path.join(os.homedir(), 'Downloads', 'HyperDownloader');
    if (!fs.existsSync(this.defaultDownloadDir)) {
      fs.mkdirSync(this.defaultDownloadDir, { recursive: true });
    }

    this.stateFilePath = path.join(this.defaultDownloadDir, '.hyper_state.json');
    this.loadState();
  }

  public setUpdateListener(callback: () => void) {
    this.onUpdateCallback = callback;
  }

  private notify() {
    this.onUpdateCallback();
  }

  private sanitizeFilename(name: string): string {
    // Strip illegal Windows filesystem characters: / \ : * ? " < > |
    let sanitized = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
    // Remove query params or hash remnants if present
    if (sanitized.includes('?')) sanitized = sanitized.split('?')[0];
    if (sanitized.includes('#')) sanitized = sanitized.split('#')[0];
    return sanitized || `download_${Date.now()}.bin`;
  }

  private loadState() {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        const items: DownloadItem[] = JSON.parse(raw);
        for (const item of items) {
          if (item.status === 'downloading' || item.status === 'probing') {
            item.status = 'paused';
          }
          item.speedBps = 0;
          this.downloads.set(item.id, item);
        }
      }
    } catch (e) {
      console.error('Failed to load state file:', e);
    }
  }

  public saveState() {
    try {
      const items = Array.from(this.downloads.values()).map(d => ({
        ...d,
        speedBps: 0,
      }));
      fs.writeFileSync(this.stateFilePath, JSON.stringify(items, null, 2));
    } catch (e) {
      console.error('Failed to save state file:', e);
    }
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
    const destFolder = customFolder || this.defaultDownloadDir;
    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true });
    }

    let rawName = customFilename || path.basename(new URL(url).pathname) || 'download_file';
    let cleanName = this.sanitizeFilename(rawName);

    const item: DownloadItem = {
      id,
      url,
      filename: cleanName,
      destinationPath: path.join(destFolder, cleanName),
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
      item.totalBytes = probe.contentLength;
      item.resumable = probe.acceptRanges;
      if (probe.finalUrl) item.url = probe.finalUrl;
      if (probe.filename) {
        const cleanName = this.sanitizeFilename(probe.filename);
        item.filename = cleanName;
        const targetDir = path.dirname(item.destinationPath);
        item.destinationPath = path.join(targetDir, cleanName);
        item.category = this.detectCategory(cleanName);
      }

      // Ensure directory exists recursively before opening file
      const dir = path.dirname(item.destinationPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Open file for random access writes
      const fd = fs.openSync(item.destinationPath, 'w+');
      this.fileDescriptors.set(id, fd);

      if (item.totalBytes > 0) {
        try {
          fs.ftruncateSync(fd, item.totalBytes);
        } catch (e) {}
      }

      const connectionCount = item.resumable && item.totalBytes > 0 ? item.connections : 1;
      const chunks: ChunkProgress[] = [];
      const chunkSize = Math.floor(item.totalBytes / connectionCount);

      for (let i = 0; i < connectionCount; i++) {
        const start = i * chunkSize;
        const end = i === connectionCount - 1 ? item.totalBytes - 1 : (i + 1) * chunkSize - 1;
        chunks.push({
          id: i,
          startByte: start,
          endByte: end,
          downloadedBytes: 0,
          totalBytes: end - start + 1,
          speedBps: 0,
          status: 'idle',
        });
      }

      item.chunks = chunks;
      item.status = 'downloading';
      this.saveState();
      this.notify();

      const controllers: AbortController[] = [];
      this.abortControllers.set(id, controllers);

      let prevTotalDownloaded = 0;
      const speedInterval = setInterval(() => {
        const currentTotal = item.chunks.reduce((acc, c) => acc + c.downloadedBytes, 0);
        const bytesInInterval = currentTotal - prevTotalDownloaded;
        prevTotalDownloaded = currentTotal;
        item.downloadedBytes = currentTotal;
        item.speedBps = Math.max(0, bytesInInterval);

        if (item.speedBps > 0 && item.totalBytes > currentTotal) {
          item.etaSeconds = Math.round((item.totalBytes - currentTotal) / item.speedBps);
        } else {
          item.etaSeconds = 0;
        }

        this.notify();
      }, 1000);

      this.speedIntervals.set(id, speedInterval);

      // Launch all parallel stream workers
      const workerPromises = chunks.map(chunk => {
        const controller = new AbortController();
        controllers.push(controller);
        return this.downloadChunk(item, chunk, fd, controller.signal);
      });

      await Promise.all(workerPromises);

      clearInterval(speedInterval);
      this.speedIntervals.delete(id);
      fs.closeSync(fd);
      this.fileDescriptors.delete(id);

      item.status = 'completed';
      item.speedBps = 0;
      item.etaSeconds = 0;
      item.completedAt = new Date().toISOString();
      this.saveState();
      this.notify();

    } catch (err: any) {
      if (item.status === 'paused' || item.status === 'cancelled') return;
      console.error(`Download error [${id}]:`, err);
      item.status = 'error';
      item.error = err.message || 'Download stream error';
      item.speedBps = 0;
      const interval = this.speedIntervals.get(id);
      if (interval) clearInterval(interval);
      this.saveState();
      this.notify();
    }
  }

  private downloadChunk(item: DownloadItem, chunk: ChunkProgress, fd: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      chunk.status = 'active';
      const parsedUrl = new URL(item.url);
      const isHttps = parsedUrl.protocol === 'https:';
      const lib = isHttps ? https : http;
      const agent = isHttps ? httpsAgent : httpAgent;

      const currentStart = chunk.startByte + chunk.downloadedBytes;
      if (currentStart > chunk.endByte) {
        chunk.status = 'done';
        resolve();
        return;
      }

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 HyperDownloader/64T',
        'Accept': '*/*',
        'Connection': 'keep-alive',
      };

      if (item.resumable && item.totalBytes > 0) {
        headers['Range'] = `bytes=${currentStart}-${chunk.endByte}`;
      }

      const req = lib.request(parsedUrl, {
        method: 'GET',
        headers,
        agent,
        signal,
      }, res => {
        // Follow redirects
        if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          item.url = res.headers.location;
          this.downloadChunk(item, chunk, fd, signal).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          chunk.status = 'error';
          reject(new Error(`Server returned HTTP ${res.statusCode}`));
          return;
        }

        let chunkPrevBytes = chunk.downloadedBytes;
        let lastTime = Date.now();

        res.on('data', (buffer: Buffer) => {
          if (signal.aborted) return;
          try {
            const writeOffset = chunk.startByte + chunk.downloadedBytes;
            fs.writeSync(fd, buffer, 0, buffer.length, writeOffset);
            chunk.downloadedBytes += buffer.length;

            const now = Date.now();
            if (now - lastTime >= 500) {
              const diff = chunk.downloadedBytes - chunkPrevBytes;
              chunk.speedBps = Math.round((diff / (now - lastTime)) * 1000);
              chunkPrevBytes = chunk.downloadedBytes;
              lastTime = now;
            }
          } catch (writeErr) {
            reject(writeErr);
          }
        });

        res.on('end', () => {
          chunk.status = 'done';
          chunk.speedBps = 0;
          resolve();
        });

        res.on('error', err => {
          chunk.status = 'error';
          reject(err);
        });
      });

      req.on('error', err => {
        if (signal.aborted) {
          resolve();
          return;
        }
        chunk.status = 'error';
        reject(err);
      });

      req.end();
    });
  }

  public pauseDownload(id: string) {
    const item = this.downloads.get(id);
    if (!item || item.status !== 'downloading') return;

    item.status = 'paused';
    item.speedBps = 0;
    const controllers = this.abortControllers.get(id);
    if (controllers) {
      controllers.forEach(c => c.abort());
      this.abortControllers.delete(id);
    }

    const interval = this.speedIntervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.speedIntervals.delete(id);
    }

    const fd = this.fileDescriptors.get(id);
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (e) {}
      this.fileDescriptors.delete(id);
    }

    this.saveState();
    this.notify();
  }

  public resumeDownload(id: string) {
    const item = this.downloads.get(id);
    if (!item) return;

    // Clean destination directory if needed
    const dir = path.dirname(item.destinationPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(item.destinationPath)) {
      // Recreate file
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

    const controllers: AbortController[] = [];
    this.abortControllers.set(id, controllers);

    let prevTotalDownloaded = item.downloadedBytes;
    const speedInterval = setInterval(() => {
      const currentTotal = item.chunks.reduce((acc, c) => acc + c.downloadedBytes, 0);
      const bytesInInterval = currentTotal - prevTotalDownloaded;
      prevTotalDownloaded = currentTotal;
      item.downloadedBytes = currentTotal;
      item.speedBps = Math.max(0, bytesInInterval);

      if (item.speedBps > 0 && item.totalBytes > currentTotal) {
        item.etaSeconds = Math.round((item.totalBytes - currentTotal) / item.speedBps);
      }
      this.notify();
    }, 1000);

    this.speedIntervals.set(id, speedInterval);

    const incompleteChunks = item.chunks.filter(c => c.status !== 'done');
    const workerPromises = incompleteChunks.map(chunk => {
      const controller = new AbortController();
      controllers.push(controller);
      return this.downloadChunk(item, chunk, fd, controller.signal);
    });

    Promise.all(workerPromises).then(() => {
      clearInterval(speedInterval);
      this.speedIntervals.delete(id);
      try { fs.closeSync(fd); } catch (e) {}
      this.fileDescriptors.delete(id);

      item.status = 'completed';
      item.speedBps = 0;
      item.etaSeconds = 0;
      item.completedAt = new Date().toISOString();
      this.saveState();
      this.notify();
    }).catch(err => {
      if (item.status === 'paused') return;
      item.status = 'error';
      item.error = err.message;
      this.saveState();
      this.notify();
    });
  }

  public removeDownload(id: string, deleteFile: boolean = false) {
    this.pauseDownload(id);
    const item = this.downloads.get(id);
    if (item && deleteFile && fs.existsSync(item.destinationPath)) {
      try { fs.unlinkSync(item.destinationPath); } catch (e) {}
    }
    this.downloads.delete(id);
    this.saveState();
    this.notify();
  }

  private probeUrl(url: string, maxRedirects: number = 5): Promise<{ contentLength: number; acceptRanges: boolean; filename?: string; finalUrl?: string }> {
    return new Promise((resolve) => {
      try {
        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const lib = isHttps ? https : http;

        const req = lib.request(parsedUrl, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HyperDownloader/64T',
          },
          timeout: 8000,
        }, res => {
          if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
            const redirectUrl = new URL(res.headers.location, url).toString();
            this.probeUrl(redirectUrl, maxRedirects - 1).then(resolve);
            return;
          }

          const contentLength = parseInt(res.headers['content-length'] || '0', 10);
          const acceptRanges = (res.headers['accept-ranges'] || '').toLowerCase() === 'bytes' || !!res.headers['content-range'];
          
          let filename: string | undefined;
          const disposition = res.headers['content-disposition'];
          if (disposition && disposition.includes('filename=')) {
            const match = disposition.match(/filename=["']?([^"';]+)["']?/);
            if (match && match[1]) filename = match[1].trim();
          }

          resolve({ contentLength, acceptRanges, filename, finalUrl: url });
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
