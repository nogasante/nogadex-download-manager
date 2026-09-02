/**
 * HyperDownloader P5 - Production Telemetry & Observability Engine
 * Bounded ring-buffer storage to eliminate memory leaks during long downloads.
 * Strict statistical percentile calculations, sensitive query parameter scrubbing,
 * and structured diagnostic snapshot generation.
 */

export interface DownloadTelemetry {
  downloadId: string;
  sanitizedUrl: string;
  totalDurationMs: number;
  averageThroughputBps: number;
  peakThroughputBps: number;
  averageRttMs: number;
  p50ThroughputBps: number;
  p95ThroughputBps: number;
  workerCountHistory: number[];
  totalSteals: number;
  totalRetries: number;
  retryCauses: Record<string, number>;
  bytesPerWorker: Record<number, number>;
  totalBytesCommitted: number;
  schedulerDecisions: string[];
  verificationDurationMs: number;
  sha256Valid: boolean;
  networkHealth: 'excellent' | 'good' | 'degraded' | 'poor';
}

export function scrubSensitiveUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const u = new URL(rawUrl);
    const SENSITIVE_KEYS = new Set([
      'token', 'sig', 'signature', 'key', 'auth', 'password', 'pass',
      'secret', 'access_token', 'api_key', 'apikey', 'credential', 'x-amz-signature'
    ]);
    const keysToScrub: string[] = [];
    u.searchParams.forEach((val, key) => {
      if (SENSITIVE_KEYS.has(key.toLowerCase()) || key.toLowerCase().includes('token') || key.toLowerCase().includes('signature')) {
        keysToScrub.push(key);
      }
    });
    for (const k of keysToScrub) {
      u.searchParams.set(k, '[REDACTED]');
    }
    return u.toString().replace(/%5BREDACTED%5D/gi, '[REDACTED]');
  } catch (e) {
    // Regex fallback
    return rawUrl.replace(/([?&](?:token|sig|signature|key|auth|password|secret|access_token|api_key)=)[^&#]*/gi, '$1[REDACTED]');
  }
}

export class PerformanceTelemetryTracker {
  private downloadId: string;
  private rawUrl: string = '';
  private startTime: number;
  private endTime: number = 0;
  private throughputSamples: number[] = [];
  private peakThroughputBps: number = 0;
  private rttSamples: number[] = [];
  private workerHistory: number[] = [];
  private totalSteals: number = 0;
  private totalRetries: number = 0;
  private retryCauses: Record<string, number> = {};
  private bytesPerWorker: Record<number, number> = {};
  private totalBytesCommitted: number = 0;
  private schedulerDecisions: string[] = [];
  private verificationDurationMs: number = 0;
  private sha256Valid: boolean = false;

  private readonly MAX_SAMPLES = 200; // Bounded ring-buffer

  constructor(downloadId: string, url: string = '') {
    this.downloadId = downloadId;
    this.rawUrl = url;
    this.startTime = Date.now();
  }

  public setUrl(url: string) {
    this.rawUrl = url;
  }

  public recordThroughputSample(bytesInInterval: number, intervalMs: number): void {
    if (intervalMs <= 0 || isNaN(bytesInInterval) || !isFinite(bytesInInterval) || bytesInInterval < 0) return;
    const bps = intervalMs <= 10 ? bytesInInterval : Math.round((bytesInInterval / intervalMs) * 1000);
    if (isNaN(bps) || !isFinite(bps) || bps < 0) return;

    this.throughputSamples.push(bps);
    if (this.throughputSamples.length > this.MAX_SAMPLES) {
      this.throughputSamples.shift();
    }
    if (bps > this.peakThroughputBps) {
      this.peakThroughputBps = bps;
    }
  }

  public recordRtt(rttMs: number): void {
    if (isNaN(rttMs) || !isFinite(rttMs) || rttMs < 0) return;
    this.rttSamples.push(Math.round(rttMs));
    if (this.rttSamples.length > this.MAX_SAMPLES) {
      this.rttSamples.shift();
    }
  }

  public recordWorkerCount(workers: number): void {
    if (isNaN(workers) || !isFinite(workers) || workers < 0) return;
    this.workerHistory.push(Math.floor(workers));
    if (this.workerHistory.length > this.MAX_SAMPLES) {
      this.workerHistory.shift();
    }
  }

  public recordSteal(donorId: number, thiefId: number, startByte?: number, endByte?: number, stolenBytes?: number): void {
    this.totalSteals++;
    const bytes = stolenBytes !== undefined ? stolenBytes : (startByte !== undefined && endByte !== undefined ? endByte - startByte + 1 : 0);
    const desc = `Steal: worker ${thiefId} stole ${bytes} B from donor ${donorId}`;
    this.schedulerDecisions.push(desc);
    if (this.schedulerDecisions.length > 50) {
      this.schedulerDecisions.shift();
    }
  }

  public recordStealEvent(donorId: number, thiefId: number, stolenBytes: number): void {
    this.recordSteal(donorId, thiefId, undefined, undefined, stolenBytes);
  }

  public recordRetry(reasonOrUrl: string, reasonOrAttempt?: string | number, attemptOrBytes?: number): void {
    this.totalRetries++;
    let r = 'Network Error';
    if (typeof reasonOrUrl === 'string') {
      if (reasonOrUrl.startsWith('http')) {
        r = typeof reasonOrAttempt === 'string' ? reasonOrAttempt : 'Network Error';
      } else {
        r = reasonOrUrl;
      }
    }
    this.retryCauses[r] = (this.retryCauses[r] || 0) + 1;
  }

  public recordRetryEvent(reason: string, attempt: number): void {
    this.recordRetry(reason, attempt);
  }

  public recordWorkerBytes(workerId: number, bytes: number): void {
    if (isNaN(bytes) || !isFinite(bytes) || bytes <= 0) return;
    this.bytesPerWorker[workerId] = (this.bytesPerWorker[workerId] || 0) + bytes;
    this.totalBytesCommitted += bytes;
  }

  public recordVerification(durationMs: number, valid: boolean): void {
    this.verificationDurationMs = Math.max(0, isNaN(durationMs) ? 0 : durationMs);
    this.sha256Valid = Boolean(valid);
    this.endTime = Date.now();
  }

  public getThroughputPercentiles(): { p50: number; p95: number } {
    if (this.throughputSamples.length === 0) {
      return { p50: 0, p95: 0 };
    }
    const sorted = [...this.throughputSamples].sort((a, b) => a - b);
    const p50Idx = Math.floor(sorted.length * 0.50);
    const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return {
      p50: sorted[p50Idx] || 0,
      p95: sorted[p95Idx] || 0,
    };
  }

  public finalize(): DownloadTelemetry {
    if (!this.endTime) this.endTime = Date.now();
    const duration = Math.max(1, this.endTime - this.startTime);

    const avgThroughput = this.throughputSamples.length > 0
      ? Math.round(this.throughputSamples.reduce((a, b) => a + b, 0) / this.throughputSamples.length)
      : Math.round((Math.max(0, this.totalBytesCommitted) / duration) * 1000);

    const avgRtt = this.rttSamples.length > 0
      ? Math.round(this.rttSamples.reduce((a, b) => a + b, 0) / this.rttSamples.length)
      : 0;

    const { p50, p95 } = this.getThroughputPercentiles();

    let health: 'excellent' | 'good' | 'degraded' | 'poor' = 'excellent';
    if (this.totalRetries > 10 || (this.retryCauses['HTTP 429'] || 0) > 3) {
      health = 'poor';
    } else if (this.totalRetries > 3 || avgRtt > 500) {
      health = 'degraded';
    } else if (this.totalRetries > 0 || avgRtt > 200) {
      health = 'good';
    }

    return {
      downloadId: this.downloadId,
      sanitizedUrl: scrubSensitiveUrl(this.rawUrl),
      totalDurationMs: duration,
      averageThroughputBps: Math.max(0, avgThroughput),
      peakThroughputBps: Math.max(0, this.peakThroughputBps),
      averageRttMs: Math.max(0, avgRtt),
      p50ThroughputBps: Math.max(0, p50),
      p95ThroughputBps: Math.max(0, p95),
      workerCountHistory: [...this.workerHistory],
      totalSteals: Math.max(0, this.totalSteals),
      totalRetries: Math.max(0, this.totalRetries),
      retryCauses: { ...this.retryCauses },
      bytesPerWorker: { ...this.bytesPerWorker },
      totalBytesCommitted: Math.max(0, this.totalBytesCommitted),
      schedulerDecisions: [...this.schedulerDecisions],
      verificationDurationMs: this.verificationDurationMs,
      sha256Valid: this.sha256Valid,
      networkHealth: health,
    };
  }
}
