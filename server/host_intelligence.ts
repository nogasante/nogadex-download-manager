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
  downgradeCount?: number;             // Times this domain's caps were downgraded by 429/503 pressure
  lastDowngradeAt?: number;            // Timestamp of the last downgrade (drives the calm-down window)
  capSuccessesSinceDowngrade?: number; // Clean transfers since last downgrade (drives recovery)
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
  private capRecoveryTracking: Map<string, { lastProbeAt: number }> = new Map();
  private lastRecoveryDomains: Set<string> = new Set();
  // Connection-cap downgrade/recovery tuning (instance fields so tests can adjust timing)
  public CAP_RECOVERY_COOLDOWN_MS: number = 30 * 1000;      // Calm-down window after a downgrade
  public CAP_RECOVERY_PROBE_INTERVAL_MS: number = 5 * 1000; // Min spacing between recovery probes
  public CAP_RECOVERY_SUCCESS_THRESHOLD: number = 3;        // Clean successes needed before a probe
  public CAP_RECOVERY_STEP: number = 1;                     // Connections restored per probe
  public MIN_CONNECTIONS_FLOOR: number = 2;                 // Never downgrade below this

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
      // maxObservedConnections is the historical high-water ceiling; downgrades
      // lower only maxConnections so stepwise recovery has room to walk back up.
      // No fabricated default: if nothing is known about a host's connection
      // ceiling, both stay undefined and the user's requested count flows through.
      maxObservedConnections: Math.max(existing.maxObservedConnections || 0, caps.maxObservedConnections || caps.maxConnections || 0) || undefined,
      maxConnections: caps.maxConnections || caps.maxObservedConnections || existing.maxConnections,
      supportsHttp2: caps.supportsHttp2 !== undefined ? caps.supportsHttp2 : (existing.supportsHttp2 || false),
      lastChecked: Date.now(),
    });
  }

  public recordCapabilities(url: string, acceptRanges: boolean, maxObservedConns: number = 8) {
    this.setCapabilities(url, { acceptRanges, supportsRanges: acceptRanges, maxObservedConnections: maxObservedConns });
  }

  /**
   * Number of clean chunk completions recorded since the last downgrade for
   * this domain (diagnostics + test observability).
   */
  public getCapSuccesses(url: string): number {
    const cap = this.capabilities.get(this.extractDomain(url));
    return cap?.capSuccessesSinceDowngrade || 0;
  }

  /**
   * Returns true once if the most recent getOptimalConnectionsForHost call
   * restored a connection level for this domain (a recovery probe fired).
   * The engine uses this to raise its adaptive concurrency ceiling.
   */
  public consumeCapRecovery(url: string): boolean {
    const domain = this.extractDomain(url);
    if (this.lastRecoveryDomains.has(domain)) {
      this.lastRecoveryDomains.delete(domain);
      return true;
    }
    return false;
  }

  /**
   * Record a successful data transfer for connection-cap recovery. Clean
   * successes against a previously downgraded domain build evidence that the
   * host tolerates more concurrency again.
   */
  public recordCapSuccess(url: string): void {
    const domain = this.extractDomain(url);
    const cap = this.capabilities.get(domain);
    if (!cap) return;
    cap.capSuccessesSinceDowngrade = (cap.capSuccessesSinceDowngrade || 0) + 1;
    // Eligibility for the next recovery probe is evaluated lazily in
    // getOptimalConnectionsForHost from capSuccessesSinceDowngrade itself.
  }

  /**
   * Hard single-stream throttle for hosts that actively rate-limit us mid-transfer
   * (HTTP 429/503 on a chunk). Recorded as a tracked downgrade so the normal
   * recovery path can restore concurrency once clean successes accumulate.
   */
  public throttleHostToSingleStream(url: string, historicalCeiling?: number): void {
    this.setCapabilities(url, { maxConnections: 1, maxObservedConnections: historicalCeiling });
    const domain = this.extractDomain(url);
    const cap = this.capabilities.get(domain);
    if (cap) {
      cap.downgradeCount = (cap.downgradeCount || 0) + 1;
      cap.lastDowngradeAt = Date.now();
      cap.capSuccessesSinceDowngrade = 0;
    }
    const tracking = this.capRecoveryTracking.get(domain);
    if (tracking) {
      tracking.lastProbeAt = 0;
    } else {
      this.capRecoveryTracking.set(domain, { lastProbeAt: 0 });
    }
  }

  public getOptimalConnectionsForHost(url: string, requestedConnections: number): number {
    const domain = this.extractDomain(url);
    if (
      domain.includes('uploadhaven.com') ||
      domain.includes('rapidgator.net') ||
      domain.includes('1fichier.com') ||
      domain.includes('turbobit.net') ||
      domain.includes('nitroflare.com') ||
      domain.includes('ddownload.com') ||
      domain.includes('filefactory.com')
    ) {
      this.capRecoveryTracking.delete(domain);
      return 1; // Strict single-stream file host rate limiting
    }
    const cap = this.getCapabilities(url);
    if (!cap || !cap.maxConnections) {
      this.capRecoveryTracking.delete(domain);
      return requestedConnections;
    }

    // Cap recovery: a previously downgraded domain periodically probes with one
    // extra connection once enough clean successes are observed. Recovery is
    // stepwise, so a host that still rate-limits gets pushed back down quickly
    // while a genuinely recovered host regains its full concurrency.
    if ((cap.maxObservedConnections || 0) > cap.maxConnections) {
      const now = Date.now();
      // Calm-down window runs from the last downgrade; probe spacing runs from
      // the last recovery probe. Both are relative checks so tuning the
      // thresholds takes effect immediately (including in tests).
      const tracking = this.capRecoveryTracking.get(domain) || { lastProbeAt: 0 };
      if (
        (cap.capSuccessesSinceDowngrade || 0) >= this.CAP_RECOVERY_SUCCESS_THRESHOLD &&
        now - (cap.lastDowngradeAt || 0) >= this.CAP_RECOVERY_COOLDOWN_MS &&
        now - tracking.lastProbeAt >= this.CAP_RECOVERY_PROBE_INTERVAL_MS
      ) {
        const restored = Math.min(cap.maxObservedConnections || cap.maxConnections, cap.maxConnections + this.CAP_RECOVERY_STEP);
        if (restored > cap.maxConnections) {
          cap.maxConnections = restored;
          cap.downgradeCount = Math.max(0, (cap.downgradeCount || 0) - 1);
          cap.capSuccessesSinceDowngrade = 0;
          tracking.lastProbeAt = now;
          this.lastRecoveryDomains.add(domain);
        }
      }
      this.capRecoveryTracking.set(domain, tracking);
    }

    return Math.min(requestedConnections, cap.maxConnections);
  }

  public getHostReferer(url: string): string {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.toLowerCase();
      if (domain.endsWith('uploadhaven.com')) {
        return 'https://uploadhaven.com/';
      }
      return `${parsed.protocol}//${parsed.hostname}/`;
    } catch {
      return 'https://uploadhaven.com/';
    }
  }

  /**
   * Evidence-based concurrency ceiling: the engine reports how many streams
   * are ACTUALLY running cleanly each speed interval. This is the honest
   * high-water mark that recovery walks back toward after a downgrade.
   */
  public observeConcurrency(url: string, activeConnections: number): void {
    if (!activeConnections || activeConnections < 1) return;
    const domain = this.extractDomain(url);
    const cap = this.capabilities.get(domain);
    if (!cap) return; // no probe info yet; nothing to observe against
    if ((cap.maxObservedConnections || 0) < activeConnections) {
      cap.maxObservedConnections = activeConnections;
    }
  }

  public getCapabilities(url: string): HostCapability | null {
    const domain = this.extractDomain(url);
    const cap = this.capabilities.get(domain);
    if (!cap) return null;
    if (cap.lastChecked && Date.now() - cap.lastChecked >= this.CAPABILITY_TTL_MS) {
      this.capabilities.delete(domain);
      this.capRecoveryTracking.delete(domain);
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
    if (
      cap &&
      (m.error429Count >= 2 || m.error503Count >= 3) &&
      Date.now() - (cap.lastDowngradeAt || 0) >= this.CAP_RECOVERY_COOLDOWN_MS
    ) {
      const currentCap = cap.maxConnections || 8;
      const downgraded = Math.max(this.MIN_CONNECTIONS_FLOOR, Math.floor(currentCap * 0.7));
      if (downgraded < currentCap) {
        cap.maxConnections = downgraded;
        cap.downgradeCount = (cap.downgradeCount || 0) + 1;
        cap.lastDowngradeAt = Date.now();
        cap.capSuccessesSinceDowngrade = 0;
        this.capRecoveryTracking.set(domain, { lastProbeAt: 0 });
      }
      // Consume the accumulated pressure: the next downgrade needs fresh errors.
      // (Lifetime tallies remain available via m.statusCodes.)
      m.error429Count = 0;
      m.error503Count = 0;
    }
  }

  public recordRequestResult(
    url: string,
    statusCode?: number,
    latencyMs?: number,
    _bytes?: number,
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
    this.capRecoveryTracking.clear();
    this.lastRecoveryDomains.clear();
  }
}
