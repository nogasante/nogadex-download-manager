import { ChunkProgress } from '../src/types/download';

export interface DynamicSchedulerOptions {
  minSplitSizeBytes?: number; // Minimum remaining bytes to split (default: 256 KB)
  initialConnections?: number; // Default: 8-16
}

export class DynamicRangeScheduler {
  public totalBytes: number;
  public chunks: ChunkProgress[] = [];
  public minSplitSizeBytes: number;
  private nextChunkId: number = 0;
  private isPaused: boolean = false;
  private lastSplitTimes: Map<number, number> = new Map();

  constructor(totalBytes: number, initialConnections: number = 8, minSplitSizeBytes: number = 256 * 1024) {
    this.totalBytes = totalBytes;
    this.minSplitSizeBytes = minSplitSizeBytes;
    this.initializeRanges(initialConnections);
  }

  public initializeRanges(connections: number) {
    this.chunks = [];
    this.nextChunkId = 0;
    this.lastSplitTimes.clear();

    if (this.totalBytes <= 0) {
      this.chunks.push({
        id: 0,
        startByte: 0,
        endByte: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speedBps: 0,
        status: 'idle',
      });
      this.nextChunkId = 1;
      return;
    }

    const count = Math.max(1, Math.min(connections, 64));
    const chunkSize = Math.floor(this.totalBytes / count);

    for (let i = 0; i < count; i++) {
      const start = i * chunkSize;
      const end = i === count - 1 ? this.totalBytes - 1 : (i + 1) * chunkSize - 1;
      this.chunks.push({
        id: this.nextChunkId++,
        startByte: start,
        endByte: end,
        downloadedBytes: 0,
        totalBytes: end - start + 1,
        speedBps: 0,
        status: 'idle',
      });
    }
  }

  // Restore chunks from persisted state (crash recovery)
  public restoreChunks(savedChunks: ChunkProgress[]) {
    this.chunks = savedChunks.map(c => ({ ...c }));
    this.nextChunkId = Math.max(...this.chunks.map(c => c.id), 0) + 1;
  }

  public pause() {
    this.isPaused = true;
  }

  public resume() {
    this.isPaused = false;
  }

  // Intelligent Work Stealing Algorithm
  // Evaluates donor progress, estimated completion time, and bandwidth balance
  public stealWork(thiefSpeedBps?: number, minUsefulStealBytes?: number): ChunkProgress | null {
    if (this.isPaused || this.totalBytes <= 0) return null;

    const minSplit = minUsefulStealBytes ?? this.minSplitSizeBytes;
    const now = Date.now();

    let candidateChunk: ChunkProgress | null = null;
    let maxRemaining = 0;

    for (const chunk of this.chunks) {
      if (chunk.status === 'active' || chunk.status === 'downloading') {
        const currentOffset = chunk.startByte + chunk.downloadedBytes;
        const remaining = chunk.endByte - currentOffset + 1;

        // Anti-thrashing guard: do not split same chunk more than once every 500ms
        const lastSplit = this.lastSplitTimes.get(chunk.id) || 0;
        if (now - lastSplit < 500 && remaining < minSplit * 4) {
          continue;
        }

        if (remaining > maxRemaining && remaining >= minSplit * 2) {
          // If speed information is available, check if stealing is meaningful
          if (thiefSpeedBps && thiefSpeedBps > 0 && chunk.speedBps > 0) {
            const donorEstSec = remaining / chunk.speedBps;
            // If donor is about to complete in under 1 second, do not split
            if (donorEstSec < 1.0) continue;
          }

          maxRemaining = remaining;
          candidateChunk = chunk;
        }
      }
    }

    if (!candidateChunk) return null;

    const currentOffset = candidateChunk.startByte + candidateChunk.downloadedBytes;
    const remaining = candidateChunk.endByte - currentOffset + 1;

    // Calculate split point (proportional if speeds are known, otherwise 50/50)
    let donorBytes: number;
    if (thiefSpeedBps && thiefSpeedBps > 0 && candidateChunk.speedBps > 0) {
      const totalSpeed = candidateChunk.speedBps + thiefSpeedBps;
      const donorRatio = candidateChunk.speedBps / totalSpeed;
      donorBytes = Math.max(minSplit, Math.min(remaining - minSplit, Math.floor(remaining * donorRatio)));
    } else {
      donorBytes = Math.floor(remaining / 2);
    }

    const splitPoint = currentOffset + donorBytes;

    // Strict boundary checks
    if (splitPoint <= currentOffset || splitPoint > candidateChunk.endByte || (candidateChunk.endByte - splitPoint + 1) < minSplit) {
      return null;
    }

    const originalEnd = candidateChunk.endByte;

    // Atomically clamp donor chunk's boundary to lower half
    candidateChunk.endByte = splitPoint - 1;
    (candidateChunk as any).isDynamicallySplit = true;
    candidateChunk.totalBytes = candidateChunk.endByte - candidateChunk.startByte + 1;
    this.lastSplitTimes.set(candidateChunk.id, now);

    // Create new stolen chunk for upper half
    const stolenChunk: ChunkProgress = {
      id: this.nextChunkId++,
      startByte: splitPoint,
      endByte: originalEnd,
      downloadedBytes: 0,
      totalBytes: originalEnd - splitPoint + 1,
      speedBps: 0,
      status: 'idle',
    };

    this.chunks.push(stolenChunk);
    return stolenChunk;
  }

  // Return an unfinished range back to the scheduler on network error
  public returnUnfinishedRange(chunkId: number) {
    const chunk = this.chunks.find(c => c.id === chunkId);
    if (chunk && chunk.status !== 'done') {
      chunk.status = 'idle';
    }
  }

  public isComplete(): boolean {
    if (this.chunks.length === 0) return false;
    return this.chunks.every(c => c.status === 'done' || (c.totalBytes > 0 && c.downloadedBytes >= c.totalBytes));
  }

  public getTotalCommittedBytes(): number {
    return this.chunks.reduce((acc, c) => acc + c.downloadedBytes, 0);
  }

  // Validation helper: verifies no overlaps and complete coverage
  public validateRangeIntegrity(): { isValid: boolean; error?: string } {
    if (this.totalBytes <= 0) return { isValid: true };

    const sorted = [...this.chunks].sort((a, b) => a.startByte - b.startByte);

    let expectedStart = 0;
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      if (c.startByte !== expectedStart) {
        return { isValid: false, error: `Gap or Overlap at index ${i}: expected start ${expectedStart}, got ${c.startByte}` };
      }
      if (c.endByte < c.startByte) {
        return { isValid: false, error: `Invalid chunk range: start ${c.startByte} > end ${c.endByte}` };
      }
      expectedStart = c.endByte + 1;
    }

    if (expectedStart !== this.totalBytes) {
      return { isValid: false, error: `Incomplete coverage: total covered ${expectedStart}, expected ${this.totalBytes}` };
    }

    return { isValid: true };
  }
}
