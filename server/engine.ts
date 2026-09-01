import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { URL } from 'url';
import { DownloadItem, ChunkProgress, DownloadStatus } from '../src/types/download';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 128 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 128 });

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

    let initialName = customFilename || path.basename(new URL(url).pathname) || 'download_file';
    if (!path.extname(initialName) && initialName === 'download_file') {
      initialName = `download_${Date.now()}.bin`;
    }

    const item: DownloadItem = {
      id,
      url,
      filename: initialName,
      destinationPath: path.join(destFolder, initialName),
      totalBytes: 0,
      downloadedBytes: 0,
      status: 'probing',
      speedBps: 0,
      connections: Math.max(1, Math.min(connections, 64)),
      chunks: [],
      category: this.detectCategory(initialName),
      resumable: false,
      etaSeconds: 0,
      createdAt: new Date().toISOString(),
    };

    this.downloads.set(id, item);
    this.saveState();
    this.notify();

    // Start probe & download
    this.startDownload(id);
    return item;
  }

  public async startDownload(id: string) {
    const item = this.downloads.get(id);
    if (!item) return;

    item.status = 'probing';
    this.notify();

    try {
      const probe = await this.probeUrl(item.url);
      item.totalBytes = probe.contentLength;
      item.resumable = probe.acceptRanges;
      if (probe.filename && !item.filename) {
        item.filename = probe.filename;
        item.destinationPath = path.join(path.dirname(item.destinationPath), probe.filename);
        item.category = this.detectCategory(probe.filename);
      }

      // Initialize destination file
      const fd = fs.openSync(item.destinationPath, 'w+');
      this.fileDescriptors.set(id, fd);

      if (item.totalBytes > 0) {
        // Preallocate disk file footprint for zero-copy random writes
        try {
          fs.ftruncateSync(fd, item.totalBytes);
        } catch (e) {
          console.warn('ftruncate not fully supported, continuing...');
        }
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

      // Launch parallel stream workers
      const controllers: AbortController[] = [];
      this.abortControllers.set(id, controllers);

      let prevTotalDownloaded = 0;
      const speedInterval = setInterval(() => {
        const currentTotal = item.chunks.reduce((acc, c) => acc + c.downloadedBytes, 0);
        const bytesInInterval = currentTotal - prevTotalDownloaded;
        prevTotalDownloaded = currentTotal;
        item.downloadedBytes = currentTotal;
        item.speedBps = Math.max(0, bytesInInterval); // measured per second

        if (item.speedBps > 0 && item.totalBytes > currentTotal) {
          item.etaSeconds = Math.round((item.totalBytes - currentTotal) / item.speedBps);
        } else {
          item.etaSeconds = 0;
        }

        this.notify();
      }, 1000);

      this.speedIntervals.set(id, speedInterval);

      // Spawn all chunk workers in parallel
      const workerPromises = chunks.map(chunk => {
        const controller = new AbortController();
        controllers.push(controller);
        return this.downloadChunk(item, chunk, fd, controller.signal);
      });

      await Promise.all(workerPromises);

      // Download complete
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
        'User-Agent': 'HyperDownloader/1.0 (Windows NT 10.0; Win64; x64) HighSpeed/64T',
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
    if (!item || (item.status !== 'paused' && item.status !== 'error')) return;

    item.status = 'downloading';
    this.notify();

    // Open file in append/random access mode
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

    // Resume incomplete chunks
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

  private probeUrl(url: string): Promise<{ contentLength: number; acceptRanges: boolean; filename?: string }> {
    return new Promise((resolve) => {
      try {
        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const lib = isHttps ? https : http;

        const req = lib.request(parsedUrl, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'HyperDownloader/1.0',
          },
          timeout: 7000,
        }, res => {
          const contentLength = parseInt(res.headers['content-length'] || '0', 10);
          const acceptRanges = (res.headers['accept-ranges'] || '').toLowerCase() === 'bytes' || !!res.headers['content-range'];
          
          let filename: string | undefined;
          const disposition = res.headers['content-disposition'];
          if (disposition && disposition.includes('filename=')) {
            const match = disposition.match(/filename=["']?([^"';]+)["']?/);
            if (match && match[1]) filename = match[1].trim();
          }

          resolve({ contentLength, acceptRanges, filename });
        });

        req.on('error', () => {
          // Fallback probe using GET 0-0
          resolve({ contentLength: 0, acceptRanges: false });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ contentLength: 0, acceptRanges: false });
        });

        req.end();
      } catch (e) {
        resolve({ contentLength: 0, acceptRanges: false });
      }
    });
  }
}
