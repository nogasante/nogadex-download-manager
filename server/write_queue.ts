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
    // Concurrent writer pool: fs.write round-trips run on the libuv
    // threadpool, and awaiting them one at a time serializes ~1 ms of
    // latency per write — a hard ceiling of roughly one write per
    // millisecond no matter how many workers produce data. Writes target
    // disjoint absolute offsets, so running several in flight is safe:
    // file content depends only on (offset, bytes) pairs, never completion
    // order, and progress accounting is a per-item sum (order-free).
    const MAX_INFLIGHT_WRITES = 8;
    const inflight = new Set<Promise<void>>();

    // SYNC FAST PATH: while the queue is shallow (under high-water), commits
    // happen synchronously with fs.writeSync on the calling thread. This
    // removes the per-batch libuv round-trip (~1 ms each) that otherwise
    // dominates on very fast pipes; once backpressure builds, the async pool
    // takes over again.
    while (
      !this.error &&
      this.queue.length > 0 &&
      this.queuedBytes < this.highWaterMarkBytes
    ) {
      this.commitBatchSync();
    }
    if (this.error) return; // failQueue already ran

    const runWriter = async (): Promise<void> => {
      while (this.queue.length > 0) {
        // Grab a small contiguous window: merge adjacent same-chunk items
        // into one syscall when possible.
        const BATCH_WINDOW = 16;
        const batch = this.queue.splice(0, BATCH_WINDOW);
        if (batch.length > 1) batch.sort((a, b) => a.offset - b.offset);

        let i = 0;
        while (i < batch.length) {
          const first = batch[i];
          let end = first.offset + first.length; // exclusive
          let j = i + 1;
          while (j < batch.length) {
            const next = batch[j];
            if (next.offset === end && next.chunk === first.chunk) {
              end += next.length;
              j++;
            } else {
              break;
            }
          }

          if (j === i + 1) {
            const item = first;
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
            } catch (err: any) {
              this.failQueue(err);
              return;
            }
          } else {
            const run = batch.slice(i, j);
            const totalLen = run.reduce((a, m) => a + m.length, 0);
            const merged = Buffer.concat(run.map(m => m.buffer));
            try {
              await new Promise<number>((resolve, reject) => {
                fs.write(this.fd, merged, 0, totalLen, first.offset, (err, bytesWritten) => {
                  if (err) return reject(err);
                  resolve(bytesWritten);
                });
              });
              for (const m of run) {
                this.queuedBytes -= m.length;
                this.totalBytesCommitted += m.length;
                if (m.chunk) {
                  m.chunk.downloadedBytes += m.length;
                }
              }
            } catch (err: any) {
              this.failQueue(err);
              return;
            }
          }
          i = j;

          if (this.queuedBytes <= this.lowWaterMarkBytes && this.lowWaterListeners.length > 0) {
            const listeners = this.lowWaterListeners.splice(0, this.lowWaterListeners.length);
            listeners.forEach(cb => {
              try { cb(); } catch (e) {}
            });
          }
        }
      }
    };

    const desired = Math.min(MAX_INFLIGHT_WRITES, Math.max(1, this.queue.length));
    for (let k = 0; k < desired; k++) {
      const p = runWriter().catch(() => {}); // failQueue already recorded the error
      inflight.add(p);
      p.finally(() => inflight.delete(p));
      if (this.error) break; // a writer hit a disk error; stop spawning
    }

    await Promise.all(inflight);
    if (this.error) return; // failQueue already ran

    this.isProcessing = false;

    if (this.queue.length === 0) {
      while (this.drainWaiters.length > 0) {
        const waiter = this.drainWaiters.shift()!;
        waiter.resolve();
      }
    }
  }

  /**
   * Commit one batch of queued items synchronously (fs.writeSync). Extracted
   * from processQueue's writer loop so the shallow-queue fast path and the
   * async pool share identical merge/accounting semantics.
   */
  private commitBatchSync(): void {
    const BATCH_WINDOW = 64;
    const batch = this.queue.splice(0, BATCH_WINDOW);
    if (batch.length > 1) batch.sort((a, b) => a.offset - b.offset);

    let i = 0;
    while (i < batch.length) {
      const first = batch[i];
      let end = first.offset + first.length; // exclusive
      let j = i + 1;
      while (j < batch.length) {
        const next = batch[j];
        if (next.offset === end && next.chunk === first.chunk) {
          end += next.length;
          j++;
        } else {
          break;
        }
      }

      try {
        if (j === i + 1) {
          const item = first;
          fs.writeSync(this.fd, item.buffer, 0, item.length, item.offset);
          this.queuedBytes -= item.length;
          this.totalBytesCommitted += item.length;
          if (item.chunk) item.chunk.downloadedBytes += item.length;
        } else {
          const run = batch.slice(i, j);
          const totalLen = run.reduce((a, m) => a + m.length, 0);
          const merged = Buffer.concat(run.map(m => m.buffer));
          fs.writeSync(this.fd, merged, 0, totalLen, first.offset);
          for (const m of run) {
            this.queuedBytes -= m.length;
            this.totalBytesCommitted += m.length;
            if (m.chunk) m.chunk.downloadedBytes += m.length;
          }
        }
      } catch (err: any) {
        this.failQueue(err);
        return;
      }
      i = j;
    }

    if (this.queuedBytes <= this.lowWaterMarkBytes && this.lowWaterListeners.length > 0) {
      const listeners = this.lowWaterListeners.splice(0, this.lowWaterListeners.length);
      listeners.forEach(cb => {
        try { cb(); } catch (e) {}
      });
    }
  }

  private failQueue(err: any) {
    this.error = new Error(`Disk Write Error: ${err.message}`);
    this.isProcessing = false;
    while (this.drainWaiters.length > 0) {
      const waiter = this.drainWaiters.shift()!;
      waiter.reject(this.error);
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

  /**
   * Stop accepting/processing writes and fail all waiters. Called on
   * engine teardown so pending writes cannot fire after shutdown.
   */
  public destroy(): void {
    this.error = this.error || new Error('Write queue destroyed');
    this.queue = [];
    this.queuedBytes = 0;
    this.isProcessing = false;
    while (this.drainWaiters.length > 0) {
      const waiter = this.drainWaiters.shift()!;
      waiter.reject(this.error);
    }
    this.lowWaterListeners = [];
  }
}
