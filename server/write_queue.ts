import fs from 'fs';
import { ChunkProgress } from '../src/types/download';

export interface QueuedWrite {
  chunk?: ChunkProgress;
  chunkId: number;
  offset: number;
  length: number;
  buffer: Buffer;
  startByte: number;
  endByte: number;
}

export interface WriteQueueOptions {
  maxQueuedBytes?: number;      // Default: 32 MB
  highWaterMarkBytes?: number;  // Default: 24 MB
  lowWaterMarkBytes?: number;   // Default: 8 MB
}

export class BoundedWriteQueue {
  private fd: number;
  private queue: QueuedWrite[] = [];
  private queuedBytes: number = 0;
  private peakQueuedBytes: number = 0;
  private totalBytesCommitted: number = 0;
  private maxQueuedBytes: number;
  private highWaterMarkBytes: number;
  private lowWaterMarkBytes: number;
  private isProcessing: boolean = false;
  private error: Error | null = null;
  private drainWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private lowWaterListeners: Array<() => void> = [];

  constructor(fd: number, options?: WriteQueueOptions) {
    this.fd = fd;
    this.maxQueuedBytes = options?.maxQueuedBytes || 32 * 1024 * 1024;
    this.highWaterMarkBytes = options?.highWaterMarkBytes || Math.round(this.maxQueuedBytes * 0.75);
    this.lowWaterMarkBytes = options?.lowWaterMarkBytes || Math.round(this.maxQueuedBytes * 0.25);
  }

  public getStats() {
    return {
      queuedItems: this.queue.length,
      queuedBytes: this.queuedBytes,
      peakQueuedBytes: this.peakQueuedBytes,
      totalBytesCommitted: this.totalBytesCommitted,
      isFull: this.queuedBytes >= this.highWaterMarkBytes,
    };
  }

  public isOverHighWaterMark(): boolean {
    return this.queuedBytes >= this.highWaterMarkBytes;
  }

  public onLowWater(callback: () => void) {
    this.lowWaterListeners.push(callback);
  }

  public enqueue(
    chunkId: number, 
    offset: number, 
    buffer: Buffer, 
    startByte: number, 
    endByte: number,
    chunk?: ChunkProgress
  ): boolean {
    if (this.error) throw this.error;

    const length = buffer.length;
    if (length === 0) return true;

    if (endByte > 0) {
      if (offset < startByte) {
        const err = new Error(`Boundary Violation: Write offset ${offset} is below chunk start ${startByte}`);
        this.error = err;
        throw err;
      }
      if (offset + length - 1 > endByte) {
        const err = new Error(`Boundary Violation: Write end ${offset + length - 1} exceeds chunk end ${endByte}`);
        this.error = err;
        throw err;
      }
    }

    this.queue.push({
      chunk,
      chunkId,
      offset,
      length,
      buffer,
      startByte,
      endByte,
    });

    this.queuedBytes += length;
    if (this.queuedBytes > this.peakQueuedBytes) {
      this.peakQueuedBytes = this.queuedBytes;
    }

    this.scheduleProcessing();
    return !this.isOverHighWaterMark();
  }

  private scheduleProcessing() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;
    setImmediate(() => this.processQueue());
  }

  private async processQueue() {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        await new Promise<number>((resolve, reject) => {
          fs.write(this.fd, item.buffer, 0, item.length, item.offset, (err, bytesWritten) => {
            if (err) return reject(err);
            resolve(bytesWritten);
          });
        });

        this.queuedBytes -= item.length;
        this.totalBytesCommitted += item.length;
        if (item.chunk) {
          item.chunk.downloadedBytes += item.length;
        }

        if (this.queuedBytes <= this.lowWaterMarkBytes && this.lowWaterListeners.length > 0) {
          const listeners = this.lowWaterListeners.splice(0, this.lowWaterListeners.length);
          listeners.forEach(cb => {
            try { cb(); } catch (e) {}
          });
        }
      } catch (err: any) {
        this.error = new Error(`Disk Write Error: ${err.message}`);
        this.isProcessing = false;
        while (this.drainWaiters.length > 0) {
          const waiter = this.drainWaiters.shift()!;
          waiter.reject(this.error);
        }
        return;
      }
    }

    this.isProcessing = false;

    if (this.queue.length === 0) {
      while (this.drainWaiters.length > 0) {
        const waiter = this.drainWaiters.shift()!;
        waiter.resolve();
      }
    }
  }

  public async drain(): Promise<void> {
    if (this.error) throw this.error;
    if (this.queue.length === 0 && !this.isProcessing) return;

    return new Promise((resolve, reject) => {
      this.drainWaiters.push({ resolve, reject });
      this.scheduleProcessing();
    });
  }
}
