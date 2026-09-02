/**
 * Dynamic Chunk Segmentation Engine (IDM-style connection reuse)
 * 
 * When a connection finishes its chunk early, the dynamic segmenter identifies
 * the active chunk with the largest remaining un-downloaded byte span and
 * splits the remaining range in half, allocating the new sub-range to the idle worker.
 */

export interface ChunkRange {
  id: number;
  start: number;
  end: number;
  downloaded: number;
  status: 'idle' | 'downloading' | 'completed' | 'error';
  workerId?: string;
}

export interface SplitResult {
  originalChunkId: number;
  newChunk: ChunkRange;
  newStart: number;
  newEnd: number;
}

export class DynamicSegmenter {
  private minSplitThresholdBytes: number;

  constructor(minSplitThresholdBytes: number = 256 * 1024) {
    // Only split chunks with at least 256 KB remaining to prevent micro-fragmentation
    this.minSplitThresholdBytes = minSplitThresholdBytes;
  }

  /**
   * Evaluates all chunks and finds the best candidate chunk to split.
   * Returns null if no active chunk has enough remaining bytes.
   */
  public findBestSplitCandidate(chunks: ChunkRange[]): { chunk: ChunkRange; remainingBytes: number } | null {
    let bestChunk: ChunkRange | null = null;
    let maxRemaining = 0;

    for (const chunk of chunks) {
      if (chunk.status === 'downloading') {
        const totalSpan = chunk.end - chunk.start + 1;
        const remaining = totalSpan - chunk.downloaded;

        if (remaining > maxRemaining && remaining >= this.minSplitThresholdBytes) {
          maxRemaining = remaining;
          bestChunk = chunk;
        }
      }
    }

    if (!bestChunk) return null;
    return { chunk: bestChunk, remainingBytes: maxRemaining };
  }

  /**
   * Splits an active chunk's remaining byte range in half.
   * Updates the original chunk's `end` boundary and creates a new chunk starting from the midpoint.
   */
  public splitChunk(
    chunks: ChunkRange[],
    chunkToSplit: ChunkRange,
    nextChunkId: number
  ): SplitResult | null {
    const currentDownloaded = chunkToSplit.downloaded;
    const currentStart = chunkToSplit.start;
    const currentEnd = chunkToSplit.end;

    // Current write cursor for the active chunk
    const activeCursor = currentStart + currentDownloaded;
    const remainingBytes = currentEnd - activeCursor + 1;

    if (remainingBytes < this.minSplitThresholdBytes) {
      return null;
    }

    // Midpoint of the remaining un-downloaded range
    const splitOffset = Math.floor(remainingBytes / 2);
    const newChunkStart = activeCursor + splitOffset;
    const newChunkEnd = currentEnd;

    // Shrink the original chunk's upper boundary to just before the new chunk
    chunkToSplit.end = newChunkStart - 1;

    const newChunk: ChunkRange = {
      id: nextChunkId,
      start: newChunkStart,
      end: newChunkEnd,
      downloaded: 0,
      status: 'idle',
    };

    chunks.push(newChunk);

    return {
      originalChunkId: chunkToSplit.id,
      newChunk,
      newStart: newChunkStart,
      newEnd: newChunkEnd,
    };
  }

  /**
   * Verifies that the set of chunks forms a contiguous, non-overlapping partition
   * of [0, totalBytes - 1].
   */
  public verifyContiguity(chunks: ChunkRange[], totalBytes: number): boolean {
    if (chunks.length === 0) return totalBytes === 0;

    const sorted = [...chunks].sort((a, b) => a.start - b.start);

    if (sorted[0].start !== 0) return false;

    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].end + 1 !== sorted[i + 1].start) {
        return false;
      }
    }

    if (sorted[sorted.length - 1].end !== totalBytes - 1) {
      return false;
    }

    return true;
  }
}
