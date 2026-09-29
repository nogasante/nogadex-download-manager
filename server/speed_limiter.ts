/**
 * Bandwidth Speed Limiter Engine (Token Bucket Algorithm)
 * 
 * Allows users to set maximum global or per-download transfer rates (in KB/sec).
 */

export class SpeedLimiter {
  /** Upper bound on a single consume() wait. Keeps socket pauses short so
   *  inactivity detectors and server-side timeouts are never tripped. */
  private static readonly MAX_WAIT_MS = 1500;

  private maxBytesPerSecond: number;
  private tokens: number;
  private lastRefillTime: number;

  constructor(maxKBps: number = 0) {
    this.maxBytesPerSecond = maxKBps > 0 ? maxKBps * 1024 : 0;
    this.tokens = this.maxBytesPerSecond;
    this.lastRefillTime = Date.now();
  }

  public setLimit(maxKBps: number): void {
    this.maxBytesPerSecond = maxKBps > 0 ? maxKBps * 1024 : 0;
    this.tokens = this.maxBytesPerSecond;
  }

  public getLimitKBps(): number {
    return this.maxBytesPerSecond > 0 ? Math.round(this.maxBytesPerSecond / 1024) : 0;
  }

  public isEnabled(): boolean {
    return this.maxBytesPerSecond > 0;
  }

  /**
   * Refills tokens based on elapsed time. The balance may be negative (debt
   * from bytes consumed ahead of schedule); refill always pays debt first.
   */
  private refill(): void {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - this.lastRefillTime);
    this.lastRefillTime = now;

    if (this.maxBytesPerSecond > 0) {
      const addedTokens = (elapsedMs / 1000) * this.maxBytesPerSecond;
      this.tokens = Math.min(this.maxBytesPerSecond, this.tokens + addedTokens);
    }
  }

  /**
   * Consumes bandwidth tokens. Returns how many milliseconds the caller must
   * delay before writing the bytes (0 = write immediately). The caller is
   * responsible for applying the delay — consume() never sleeps.
   *
   * The balance may go negative (debt) so concurrent streams are charged
   * exactly — every byte is accounted and the long-run aggregate rate equals
   * the limit. The returned wait is capped at MAX_WAIT_MS so no single caller
   * ever stalls a socket for long enough to trip inactivity/timeouts upstream;
   * unrepaid debt is carried over and throttles subsequent consumes instead.
   */
  public async consume(bytes: number): Promise<number> {
    if (this.maxBytesPerSecond <= 0) return 0;

    this.refill();
    this.tokens -= bytes;

    if (this.tokens >= 0) return 0;

    const exactWaitMs = Math.ceil((-this.tokens / this.maxBytesPerSecond) * 1000);
    return Math.min(exactWaitMs, SpeedLimiter.MAX_WAIT_MS);
  }
}
