/**
 * HyperDownloader P4 - Hardened Intelligent Chunk Sizing Engine
 * Adaptively determines optimal range chunk sizes based on network telemetry,
 * host capability history, throughput, RTT, and error pressure.
 * Fuzz-tested against NaN, Infinity, zero, and extreme values.
 */

export interface ChunkOptimizerConfig {
  minChunkSize?: number;      // Default: 256 KB (262,144 bytes)
  defaultChunkSize?: number;  // Default: 2 MB (2,097,152 bytes)
  maxChunkSize?: number;      // Default: 32 MB (33,554,432 bytes)
  rttLowMs?: number;          // Default: 50 ms
  rttHighMs?: number;         // Default: 300 ms
}

export interface ChunkCalculationParams {
  throughputBps: number;
  rttMs: number;
  retryCount: number;
  remainingBytes: number;
  activeWorkers: number;
  hostEffectiveChunkSize?: number;
}

export class ChunkOptimizer {
  public readonly minChunkSize: number;
  public readonly defaultChunkSize: number;
  public readonly maxChunkSize: number;
  public readonly rttLowMs: number;
  public readonly rttHighMs: number;

  private currentChunkSize: number;
  private consecutiveSuccesses: number = 0;
  private consecutiveFailures: number = 0;

  constructor(config?: ChunkOptimizerConfig) {
    const min = config?.minChunkSize ?? 256 * 1024;         // 256 KB
    const max = config?.maxChunkSize ?? 32 * 1024 * 1024;   // 32 MB
    const def = config?.defaultChunkSize ?? 2 * 1024 * 1024; // 2 MB

    this.minChunkSize = Math.max(16 * 1024, isNaN(min) ? 256 * 1024 : min);
    this.maxChunkSize = Math.max(this.minChunkSize, isNaN(max) ? 32 * 1024 * 1024 : max);
    this.defaultChunkSize = Math.max(this.minChunkSize, Math.min(this.maxChunkSize, isNaN(def) ? 2 * 1024 * 1024 : def));
    this.rttLowMs = Math.max(1, isNaN(config?.rttLowMs ?? 50) ? 50 : (config?.rttLowMs ?? 50));
    this.rttHighMs = Math.max(this.rttLowMs, isNaN(config?.rttHighMs ?? 300) ? 300 : (config?.rttHighMs ?? 300));

    this.currentChunkSize = this.defaultChunkSize;
  }

  /**
   * Calculates the optimal chunk size with strict input sanitization.
   * Guarantees: minChunkSize <= return_value <= maxChunkSize and is a valid finite integer.
   */
  public calculateOptimalChunkSize(params: ChunkCalculationParams): number {
    // 0. Sanitize inputs
    const throughput = (isNaN(params.throughputBps) || !isFinite(params.throughputBps) || params.throughputBps < 0)
      ? 0
      : params.throughputBps;
    const rtt = (isNaN(params.rttMs) || !isFinite(params.rttMs) || params.rttMs < 0)
      ? 0
      : params.rttMs;
    const retries = (isNaN(params.retryCount) || !isFinite(params.retryCount) || params.retryCount < 0)
      ? 0
      : Math.floor(params.retryCount);
    const remaining = (isNaN(params.remainingBytes) || !isFinite(params.remainingBytes) || params.remainingBytes < 0)
      ? 0
      : params.remainingBytes;

    let target = this.currentChunkSize;

    // 1. High throughput scaling: if network delivers high bandwidth, scale up chunk size
    if (throughput > 10 * 1024 * 1024) {
      // > 10 MB/s: scale up towards 8 MB - 32 MB
      const bdpChunk = Math.floor(throughput * 2); // 2 seconds worth of data
      target = Math.max(target, bdpChunk);
    } else if (throughput > 2 * 1024 * 1024) {
      // 2 MB/s - 10 MB/s: scale towards 4 MB
      target = Math.max(target, 4 * 1024 * 1024);
    }

    // 2. High latency damping: high RTT with errors reduces chunk size
    if (rtt > this.rttHighMs && retries > 0) {
      target = Math.floor(target / 2);
    }

    // 3. Retry / Failure pressure reduction
    if (retries > 2) {
      target = Math.floor(target / 2);
    }

    // 4. Host historical guidance if available
    if (params.hostEffectiveChunkSize && !isNaN(params.hostEffectiveChunkSize) && isFinite(params.hostEffectiveChunkSize) && params.hostEffectiveChunkSize > 0) {
      target = Math.floor((target + params.hostEffectiveChunkSize) / 2);
    }

    // 5. Remaining file size constraint: avoid creating a chunk larger than remaining bytes
    if (remaining > 0 && remaining < target) {
      target = remaining;
    }

    // 6. Strict bounds clamping and NaN/Infinity safeguard
    if (isNaN(target) || !isFinite(target) || target <= 0) {
      target = this.defaultChunkSize;
    }
    target = Math.max(this.minChunkSize, Math.min(this.maxChunkSize, Math.floor(target)));

    return target;
  }

  /**
   * Feedback loop from completed or failed chunks
   */
  public recordChunkOutcome(success: boolean, _durationMs?: number, _bytes?: number): void {
    if (success) {
      this.consecutiveSuccesses++;
      this.consecutiveFailures = 0;

      // After 3 consecutive successful chunks without error, gradually grow chunk size (up to 1.5x)
      if (this.consecutiveSuccesses >= 3) {
        this.currentChunkSize = Math.min(this.maxChunkSize, Math.floor(this.currentChunkSize * 1.5));
        this.consecutiveSuccesses = 0;
      }
    } else {
      this.consecutiveFailures++;
      this.consecutiveSuccesses = 0;

      // On failure, shrink chunk size to reduce retry overhead
      this.currentChunkSize = Math.max(this.minChunkSize, Math.floor(this.currentChunkSize / 2));
    }
  }

  public getCurrentChunkSize(): number {
    return this.currentChunkSize;
  }

  public reset(): void {
    this.currentChunkSize = this.defaultChunkSize;
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures = 0;
  }
}
