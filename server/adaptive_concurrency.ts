export interface AdaptiveConcurrencyOptions {
  minWorkers?: number;          // Default: 2
  maxWorkers?: number;          // Default: 32
  initialWorkers?: number;      // Default: 4
  cooldownMs?: number;          // Cooldown between concurrency changes (default: 2000ms)
  throughputImprovementMin?: number; // Minimum 8% gain to continue scaling up
}

export interface ConcurrencyEvaluationParams {
  activeWorkersCount: number;
  latencyMs?: number;
  hasRecentErrors?: boolean;
  hasServerThrottling?: boolean;
  status429Count?: number;
  status503Count?: number;
  stallCount?: number;
  remainingBytes?: number;
  errorRate?: number;
}

export class AdaptiveConcurrencyController {
  private minWorkers: number;
  private maxWorkers: number;
  private currentWorkers: number;
  private cooldownMs: number;
  private lastAdjustmentTime: number = 0;
  private throughputSamples: number[] = [];
  private prevThroughputBps: number = 0;
  private consecutiveDegradations: number = 0;
  private consecutiveImprovements: number = 0;

  constructor(options?: AdaptiveConcurrencyOptions) {
    const min = isNaN(options?.minWorkers ?? 2) ? 2 : (options?.minWorkers ?? 2);
    const max = isNaN(options?.maxWorkers ?? 32) ? 32 : (options?.maxWorkers ?? 32);
    const init = isNaN(options?.initialWorkers ?? 4) ? 4 : (options?.initialWorkers ?? 4);

    this.minWorkers = Math.max(1, Math.floor(min));
    this.maxWorkers = Math.max(this.minWorkers, Math.floor(max));
    this.currentWorkers = Math.max(this.minWorkers, Math.min(Math.floor(init), this.maxWorkers));
    this.cooldownMs = Math.max(100, isNaN(options?.cooldownMs ?? 2000) ? 2000 : (options?.cooldownMs ?? 2000));
  }

  public getTargetWorkers(): number {
    return this.currentWorkers;
  }

  public setWorkerLimits(min: number, max: number) {
    if (isNaN(min) || isNaN(max)) return;
    this.minWorkers = Math.max(1, Math.floor(min));
    this.maxWorkers = Math.max(this.minWorkers, Math.floor(max));
    this.currentWorkers = Math.max(this.minWorkers, Math.min(this.currentWorkers, this.maxWorkers));
  }

  public recordThroughputSample(bytesTransferredInInterval: number, intervalMs: number) {
    if (intervalMs <= 0 || isNaN(intervalMs) || isNaN(bytesTransferredInInterval) || bytesTransferredInInterval < 0) return;
    const sampleBps = Math.round((bytesTransferredInInterval / intervalMs) * 1000);
    if (isNaN(sampleBps) || !isFinite(sampleBps)) return;

    this.throughputSamples.push(sampleBps);
    if (this.throughputSamples.length > 5) {
      this.throughputSamples.shift();
    }
  }

  public getRollingThroughputBps(): number {
    if (this.throughputSamples.length === 0) return 0;
    const sum = this.throughputSamples.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / this.throughputSamples.length);
    return isNaN(avg) || !isFinite(avg) ? 0 : Math.max(0, avg);
  }

  // Evaluates network signals and decides whether to adjust concurrency
  public evaluate(
    activeWorkersCountOrParams: number | ConcurrencyEvaluationParams,
    latencyMs: number = 0,
    hasRecentErrors: boolean = false,
    hasServerThrottling: boolean = false
  ): 'scale_up' | 'scale_down' | 'maintain' {
    let p: ConcurrencyEvaluationParams;
    if (typeof activeWorkersCountOrParams === 'object') {
      p = activeWorkersCountOrParams;
    } else {
      p = {
        activeWorkersCount: isNaN(activeWorkersCountOrParams) ? this.currentWorkers : activeWorkersCountOrParams,
        latencyMs: isNaN(latencyMs) ? 0 : latencyMs,
        hasRecentErrors,
        hasServerThrottling,
      };
    }

    const now = Date.now();
    if (now - this.lastAdjustmentTime < this.cooldownMs) {
      return 'maintain';
    }

    const currentThroughput = this.getRollingThroughputBps();

    // 1. Severe 429 Rate Limiting or Server Throttling -> Scale Down Immediately
    if (p.hasServerThrottling || (p.status429Count && p.status429Count > 0)) {
      this.lastAdjustmentTime = now;
      this.currentWorkers = Math.max(this.minWorkers, Math.floor(this.currentWorkers * 0.75));
      this.consecutiveImprovements = 0;
      return 'scale_down';
    }

    // 2. High Error Rate / Consecutive 503 Failures / Frequent Stalls -> Scale Down
    if (
      p.hasRecentErrors || 
      (p.status503Count && p.status503Count >= 2) || 
      (p.stallCount && p.stallCount >= 2) || 
      (p.errorRate && !isNaN(p.errorRate) && p.errorRate > 0.15)
    ) {
      this.lastAdjustmentTime = now;
      this.currentWorkers = Math.max(this.minWorkers, this.currentWorkers - 1);
      this.consecutiveImprovements = 0;
      return 'scale_down';
    }

    // 3. Near-Completion Hold: If remaining bytes are small, hold or scale down to prevent thrashing
    if (p.remainingBytes !== undefined && !isNaN(p.remainingBytes) && p.remainingBytes > 0 && p.remainingBytes < 1024 * 1024) {
      return 'maintain';
    }

    // 4. Initial baseline establishment
    if (this.prevThroughputBps === 0) {
      this.prevThroughputBps = currentThroughput;
      return 'maintain';
    }

    // 5. High RTT Latency Spike: Latency degraded significantly -> avoid scale up
    if (p.latencyMs && !isNaN(p.latencyMs) && p.latencyMs > 600) {
      return 'maintain';
    }

    // 6. Throughput differential calculation
    const diff = currentThroughput - this.prevThroughputBps;
    const pctChange = this.prevThroughputBps > 0 ? (diff / this.prevThroughputBps) : 0;

    if (!isNaN(pctChange) && pctChange > 0.08) { // > 8% throughput improvement
      this.consecutiveImprovements++;
      this.consecutiveDegradations = 0;

      if (this.currentWorkers < this.maxWorkers) {
        this.lastAdjustmentTime = now;
        this.currentWorkers = Math.min(this.maxWorkers, this.currentWorkers + 1);
        this.prevThroughputBps = currentThroughput;
        return 'scale_up';
      }
    } else if (!isNaN(pctChange) && pctChange < -0.10) { // > 10% throughput degradation
      this.consecutiveDegradations++;
      this.consecutiveImprovements = 0;

      if (this.consecutiveDegradations >= 2 && this.currentWorkers > this.minWorkers) {
        this.lastAdjustmentTime = now;
        this.currentWorkers = Math.max(this.minWorkers, this.currentWorkers - 1);
        this.prevThroughputBps = currentThroughput;
        this.consecutiveDegradations = 0;
        return 'scale_down';
      }
    } else {
      this.prevThroughputBps = currentThroughput;
    }

    return 'maintain';
  }

  public throttleDown(targetWorkers: number = 1) {
    // A server-mandated single-stream downgrade (429/503 burst rejection)
    // must also lower the FLOOR: with minWorkers=2 a throttle to 1 silently
    // re-arms a second worker on the next evaluate(), immediately re-bursting
    // a host that just told us "one connection only".
    if (targetWorkers < this.minWorkers) {
      this.minWorkers = Math.max(1, targetWorkers);
    }
    this.currentWorkers = Math.max(this.minWorkers, Math.min(this.currentWorkers, targetWorkers));
    this.lastAdjustmentTime = Date.now();
  }

  public forceScaleUp(): boolean {
    if (this.currentWorkers < this.maxWorkers) {
      this.currentWorkers++;
      this.lastAdjustmentTime = Date.now();
      return true;
    }
    return false;
  }

  public forceScaleDown(): boolean {
    if (this.currentWorkers > this.minWorkers) {
      this.currentWorkers--;
      this.lastAdjustmentTime = Date.now();
      return true;
    }
    return false;
  }
}
