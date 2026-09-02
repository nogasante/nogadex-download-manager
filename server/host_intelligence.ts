/**
 * HyperDownloader P4 - Production Hardened Host Intelligence & Network Resilience Engine
 * Provides domain capability caching, error categorization, adaptive backoff,
 * Retry-After (seconds + HTTP-Date) parsing, and bounded cache maps to prevent leaks.
 */

export interface HostCapability {
  domain?: string;
  supportsRanges?: boolean;
  supportsHEAD?: boolean;
  acceptRanges?: boolean;
  maxObservedConnections?: number;
  maxConnections?: number;
  supportsHttp2?: boolean;
  lastChecked?: number;
}

export interface NetworkHealthMetrics {
  domain: string;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  totalLatencyMs: number;
  latencySamples: number;
  error429Count: number;
  error503Count: number;
  statusCodes: Record<number, number>;
  lastFailureTime: number;
  consecutiveSuccesses: number;
}

export interface HostPerformanceProfile {
  domain: string;
  avgThroughputBps: number;
  smoothedThroughputBps: number;
  avgLatencyMs: number;
  averageRttMs: number;
  errorRate: number;
  recommendedChunkSize: number;
  bestConcurrency: number;
  lastUpdated: number;
}

export class HostIntelligence {
  private static instance: HostIntelligence | null = null;

  public static getInstance(): HostIntelligence {
    if (!HostIntelligence.instance) {
      HostIntelligence.instance = new HostIntelligence();
    }
    return HostIntelligence.instance;
  }

  private capabilities: Map<string, HostCapability> = new Map();
  private metrics: Map<string, NetworkHealthMetrics> = new Map();
  private profiles: Map<string, HostPerformanceProfile> = new Map();
  private CAPABILITY_TTL_MS: number = 60 * 60 * 1000; // 1 hour TTL default
  private PROFILE_TTL_MS: number = 30 * 60 * 1000;   // 30 minutes TTL default
  private readonly MAX_CACHED_DOMAINS = 500;           // Bounded cache map

  constructor(capabilityTtlMs?: number, profileTtlMs?: number) {
    if (capabilityTtlMs !== undefined) {
      this.CAPABILITY_TTL_MS = capabilityTtlMs;
      this.PROFILE_TTL_MS = profileTtlMs !== undefined ? profileTtlMs : capabilityTtlMs;
    }
  }

  private extractDomain(urlOrDomain: string): string {
    try {
      if (urlOrDomain.startsWith('http://') || urlOrDomain.startsWith('https://')) {
        return new URL(urlOrDomain).hostname.toLowerCase();
      }
      return urlOrDomain.toLowerCase();
    } catch (e) {
      return urlOrDomain.toLowerCase();
    }
  }

  private pruneIfNeeded() {
    if (this.capabilities.size > this.MAX_CACHED_DOMAINS) {
      const oldestKey = this.capabilities.keys().next().value;
      if (oldestKey) this.capabilities.delete(oldestKey);
    }
    if (this.metrics.size > this.MAX_CACHED_DOMAINS) {
      const oldestKey = this.metrics.keys().next().value;
      if (oldestKey) this.metrics.delete(oldestKey);
    }
    if (this.profiles.size > this.MAX_CACHED_DOMAINS) {
      const oldestKey = this.profiles.keys().next().value;
      if (oldestKey) this.profiles.delete(oldestKey);
    }
  }

  public setCapabilities(url: string, caps: Partial<HostCapability>) {
    this.pruneIfNeeded();
    const domain = this.extractDomain(url);
    const existing = this.capabilities.get(domain) || {};
    this.capabilities.set(domain, {
      ...existing,
      domain,
      supportsRanges: caps.supportsRanges !== undefined ? caps.supportsRanges : (caps.acceptRanges !== undefined ? caps.acceptRanges : existing.supportsRanges),
      acceptRanges: caps.acceptRanges !== undefined ? caps.acceptRanges : (caps.supportsRanges !== undefined ? caps.supportsRanges : existing.acceptRanges),
      supportsHEAD: caps.supportsHEAD !== undefined ? caps.supportsHEAD : (existing.supportsHEAD ?? true),
      maxObservedConnections: caps.maxObservedConnections || caps.maxConnections || existing.maxObservedConnections || 8,
      maxConnections: caps.maxConnections || caps.maxObservedConnections || existing.maxConnections || 8,
      supportsHttp2: caps.supportsHttp2 !== undefined ? caps.supportsHttp2 : (existing.supportsHttp2 || false),
      lastChecked: Date.now(),
    });
  }

  public recordCapabilities(url: string, acceptRanges: boolean, maxObservedConns: number = 8) {
    this.setCapabilities(url, { acceptRanges, supportsRanges: acceptRanges, maxObservedConnections: maxObservedConns });
  }

  public getCapabilities(url: string): HostCapability | null {
    const domain = this.extractDomain(url);
    const cap = this.capabilities.get(domain);
    if (!cap) return null;
    if (cap.lastChecked && Date.now() - cap.lastChecked > this.CAPABILITY_TTL_MS) {
      this.capabilities.delete(domain);
      return null;
    }
    return cap;
  }

  public recordSuccess(url: string, latencyMs: number = 0) {
    this.pruneIfNeeded();
    const domain = this.extractDomain(url);
    const m = this.metrics.get(domain) || {
      domain,
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      totalLatencyMs: 0,
      latencySamples: 0,
      error429Count: 0,
      error503Count: 0,
      statusCodes: {},
      lastFailureTime: 0,
      consecutiveSuccesses: 0,
    };

    m.successCount++;
    m.consecutiveSuccesses++;
    if (latencyMs > 0 && !isNaN(latencyMs) && isFinite(latencyMs)) {
      m.totalLatencyMs += latencyMs;
      m.latencySamples++;
    }
    this.metrics.set(domain, m);
  }

  public recordFailure(url: string, statusCode?: number) {
    this.pruneIfNeeded();
    const domain = this.extractDomain(url);
    const m = this.metrics.get(domain) || {
      domain,
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      totalLatencyMs: 0,
      latencySamples: 0,
      error429Count: 0,
      error503Count: 0,
      statusCodes: {},
      lastFailureTime: 0,
      consecutiveSuccesses: 0,
    };

    m.failureCount++;
    m.consecutiveSuccesses = 0;
    m.lastFailureTime = Date.now();

    if (statusCode) {
      m.statusCodes[statusCode] = (m.statusCodes[statusCode] || 0) + 1;
    }
    if (statusCode === 429) {
      m.error429Count++;
    } else if (statusCode === 503) {
      m.error503Count++;
    }

    this.metrics.set(domain, m);

    const cap = this.capabilities.get(domain);
    if (cap && (m.error429Count >= 2 || m.error503Count >= 3)) {
      const maxC = cap.maxObservedConnections || cap.maxConnections || 8;
      const downgraded = Math.max(2, Math.floor(maxC * 0.7));
      cap.maxObservedConnections = downgraded;
      cap.maxConnections = downgraded;
    }
  }

  public recordRequestResult(
    url: string,
    statusCode?: number,
    latencyMs?: number,
    bytes?: number,
    isError?: boolean,
    isTimeout?: boolean
  ) {
    this.pruneIfNeeded();
    const domain = this.extractDomain(url);
    const m = this.metrics.get(domain) || {
      domain,
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      totalLatencyMs: 0,
      latencySamples: 0,
      error429Count: 0,
      error503Count: 0,
      statusCodes: {},
      lastFailureTime: 0,
      consecutiveSuccesses: 0,
    };

    if (isTimeout) {
      m.timeoutCount++;
    }
    if (statusCode) {
      m.statusCodes[statusCode] = (m.statusCodes[statusCode] || 0) + 1;
      if (statusCode === 429) m.error429Count++;
      if (statusCode === 503) m.error503Count++;
    }
    if (isError || (statusCode && statusCode >= 400)) {
      m.failureCount++;
      m.consecutiveSuccesses = 0;
      m.lastFailureTime = Date.now();
    } else {
      m.successCount++;
      m.consecutiveSuccesses++;
      if (latencyMs && latencyMs > 0) {
        m.totalLatencyMs += latencyMs;
        m.latencySamples++;
      }
    }
    this.metrics.set(domain, m);

    // Also update performance profile
    const existing = this.profiles.get(domain);
    const latency = latencyMs || 0;
    this.profiles.set(domain, {
      domain,
      avgThroughputBps: existing?.avgThroughputBps || 0,
      smoothedThroughputBps: existing?.smoothedThroughputBps || 0,
      avgLatencyMs: latency,
      averageRttMs: latency,
      errorRate: m.successCount + m.failureCount > 0 ? m.failureCount / (m.successCount + m.failureCount) : 0,
      recommendedChunkSize: existing?.recommendedChunkSize || 2 * 1024 * 1024,
      bestConcurrency: existing?.bestConcurrency || 8,
      lastUpdated: Date.now(),
    });
  }

  public recordThroughput(url: string, bytesTransferred: number) {
    this.pruneIfNeeded();
    const domain = this.extractDomain(url);
    const existing = this.profiles.get(domain);
    const throughput = Math.max(0, bytesTransferred);
    const smoothed = existing && existing.smoothedThroughputBps > 0
      ? Math.round(existing.smoothedThroughputBps * 0.7 + throughput * 0.3)
      : throughput;

    this.profiles.set(domain, {
      domain,
      avgThroughputBps: smoothed,
      smoothedThroughputBps: smoothed,
      avgLatencyMs: existing?.avgLatencyMs || 0,
      averageRttMs: existing?.averageRttMs || 0,
      errorRate: existing?.errorRate || 0,
      recommendedChunkSize: existing?.recommendedChunkSize || 2 * 1024 * 1024,
      bestConcurrency: existing?.bestConcurrency || 8,
      lastUpdated: Date.now(),
    });
  }

  public recordRetry(url: string) {
    this.recordFailure(url);
  }

  public getPerformanceProfile(url: string): HostPerformanceProfile | null {
    const domain = this.extractDomain(url);
    const prof = this.profiles.get(domain);
    if (!prof) return null;
    if (Date.now() - prof.lastUpdated > this.PROFILE_TTL_MS) {
      this.profiles.delete(domain);
      return null;
    }
    return prof;
  }

  public updatePerformanceProfile(
    url: string,
    throughputBps: number,
    latencyMs: number,
    errorRate: number,
    recommendedChunkSize: number,
    bestConcurrency: number
  ): void {
    this.pruneIfNeeded();
    const domain = this.extractDomain(url);
    const existing = this.profiles.get(domain);

    const validThroughput = isNaN(throughputBps) || !isFinite(throughputBps) || throughputBps < 0 ? 0 : throughputBps;
    const validLatency = isNaN(latencyMs) || !isFinite(latencyMs) || latencyMs < 0 ? 0 : latencyMs;
    const validError = isNaN(errorRate) || !isFinite(errorRate) ? 0 : Math.max(0, Math.min(1, errorRate));

    const smoothedThroughput = existing && existing.avgThroughputBps > 0
      ? Math.round(existing.avgThroughputBps * 0.7 + validThroughput * 0.3)
      : validThroughput;

    const smoothedLatency = existing && existing.avgLatencyMs > 0
      ? Math.round(existing.avgLatencyMs * 0.7 + validLatency * 0.3)
      : validLatency;

    this.profiles.set(domain, {
      domain,
      avgThroughputBps: smoothedThroughput,
      smoothedThroughputBps: smoothedThroughput,
      avgLatencyMs: smoothedLatency,
      averageRttMs: smoothedLatency,
      errorRate: validError,
      recommendedChunkSize: Math.max(256 * 1024, Math.min(32 * 1024 * 1024, recommendedChunkSize || 2 * 1024 * 1024)),
      bestConcurrency: Math.max(2, Math.min(32, bestConcurrency || 8)),
      lastUpdated: Date.now(),
    });
  }

  public getHostErrorRate(url: string): number {
    const domain = this.extractDomain(url);
    const m = this.metrics.get(domain);
    if (!m) return 0;
    const total = m.successCount + m.failureCount;
    return total > 0 ? (m.failureCount / total) : 0;
  }

  public getAverageLatencyMs(url: string): number {
    const domain = this.extractDomain(url);
    const m = this.metrics.get(domain);
    if (!m || m.latencySamples === 0) return 0;
    return Math.round(m.totalLatencyMs / m.latencySamples);
  }

  public getMetrics(urlOrDomain: string): NetworkHealthMetrics | null {
    const domain = this.extractDomain(urlOrDomain);
    return this.metrics.get(domain) || null;
  }

  public calculateBackoffDelay(attempt: number, retryAfterHeader?: string): number {
    return this.getRetryDelay(attempt, retryAfterHeader);
  }

  public getRetryDelay(
    attempt: number,
    retryAfterHeader?: string,
    baseDelayMs: number = 200,
    maxDelayMs: number = 10000
  ): number {
    if (retryAfterHeader !== undefined && retryAfterHeader.trim().length > 0) {
      const trimmed = retryAfterHeader.trim();
      const parsedSeconds = parseInt(trimmed, 10);
      if (!isNaN(parsedSeconds) && String(parsedSeconds) === trimmed) {
        if (parsedSeconds <= 0) return 0;
        return Math.min(parsedSeconds * 1000, 30000);
      }
      const parsedDate = Date.parse(trimmed);
      if (!isNaN(parsedDate)) {
        const delta = parsedDate - Date.now();
        if (delta <= 0) return 0;
        return Math.min(delta, 30000);
      }
    }

    const safeAttempt = Math.max(0, Math.min(10, attempt));
    const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, safeAttempt));
    const jitter = Math.floor(Math.random() * (exp - baseDelayMs + 1)) + baseDelayMs;
    return Math.min(jitter, maxDelayMs);
  }

  public isTransientStatus(statusCode: number): boolean {
    return [408, 429, 500, 502, 503, 504].includes(statusCode);
  }

  public isPermanentFailure(statusCode: number): boolean {
    return [400, 401, 403, 404, 405, 410, 416].includes(statusCode);
  }

  public clear() {
    this.capabilities.clear();
    this.metrics.clear();
    this.profiles.clear();
  }
}
