/**
 * Bandwidth Speed Limiter Engine (Token Bucket Algorithm)
 * 
 * Allows users to set maximum global or per-download transfer rates (in KB/sec).
 */

export class SpeedLimiter {
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
   * Refills tokens based on elapsed time.
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
   * Consumes bandwidth tokens. Returns how many milliseconds caller should sleep if throttled.
   */
  public async consume(bytes: number): Promise<number> {
    if (this.maxBytesPerSecond <= 0) return 0;

    this.refill();

    if (this.tokens >= bytes) {
      this.tokens -= bytes;
      return 0;
    }

    // Need to wait for tokens to refill
    const needed = bytes - this.tokens;
    const waitMs = Math.ceil((needed / this.maxBytesPerSecond) * 1000);

    // Consume what we can
    this.tokens = 0;

    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 1000)));
    }

    return waitMs;
  }
}
