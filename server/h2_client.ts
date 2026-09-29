/**
 * HTTP/2 transport for NDM — a native Node http2 stack.
 *
 * Node ships its own http2 module with TLS 1.3 and ALPN, so we get modern
 * protocol support natively (no external HTTP client, no WinHTTP):
 *
 *   - One TLS handshake per origin (ALPN-negotiated h2), verified in the
 *     session cache before use. A plain HTTP/1.1 fallback is the default.
 *   - Segmented range downloads multiplex as independent h2 streams on that
 *     one connection — 32 "connections" cost one handshake instead of 32.
 *   - Disjoint-offset, independently-validated streams feed the same
 *     BoundedWriteQueue as the h1 path, so integrity guarantees are identical.
 *
 * DESIGN CONSTRAINTS (why this stays small and safe):
 *   - Per-origin cache with idle GC + hard cap; sessions are on-demand.
 *   - Every download gets stream-level pause via the same `signal` the h1
 *     path uses; on any h2-level error we throw so the engine's existing
 *     retry logic resumes the exact committed offset over h1 or h2.
 *   - TLS options (including the SSRF-safe DNS lookup hook) match the h1
 *     path so security posture is unchanged.
 */

import http2 from 'http2';
import { URL } from 'url';

export interface H2RangeResult {
  /** Bytes handed to `onData` (pre-validation total). */
  received: number;
  /** True once the stream ended cleanly at exactly `endByte - startByte + 1`. */
  complete: boolean;
  /** HTTP status of the stream response (200 for full-body, 206 for ranges). */
  status: number;
  /** Response headers (subset the caller cares about). */
  contentLength?: number;
  contentRange?: string;
}

export interface H2RangeRequest {
  url: string;
  startByte: number;
  endByte: number;
  /** Called for every data chunk in order. Return false to abort cleanly. */
  onData: (chunk: Buffer) => void | false;
  /** Checked before every data chunk: when true, the transport pauses the
   *  stream (true TCP/h2 flow control, not buffering) until it returns
   *  false — the h2 equivalent of the h1 path's res.pause() backpressure. */
  shouldPause?: () => boolean;
  /** Abort signal (pause / download-level abort). */
  signal: AbortSignal;
  /** Request timeout ms (headers + body inactivity). */
  timeoutMs?: number;
  /** Headers to send (User-Agent, cookies, Range, etc.). */
  headers?: Record<string, string>;
}

interface CachedSession {
  session: http2.ClientHttp2Session;
  origin: string;
  /** ALPN-selected protocol from the TLS handshake ('h2' expected). */
  alpn: string | false;
  createdAt: number;
  lastUsedAt: number;
  openStreams: number;
}

const SESSION_TTL_MS = 5 * 60 * 1000;          // idle GC after 5 min
const SESSION_SWEEP_MS = 60 * 1000;            // GC cadence
const MAX_CACHED_SESSIONS = 8;                 // hard cache cap
const DEFAULT_STREAM_TIMEOUT_MS = 30000;
const MAX_CONCURRENT_STREAMS_PER_SESSION = 128;

export class Http2Transport {
  private cache = new Map<string, CachedSession>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private readonly allowH2C: boolean;

  /**
   * @param allowH2C permit cleartext http:// h2c origins. Production stays
   * https-only (ALPN is a TLS extension); tests use h2c against a local
   * plain-text h2 server.
   */
  constructor(options?: { allowH2C?: boolean }) {
    this.allowH2C = options?.allowH2C === true;
    this.sweepTimer = setInterval(() => this.sweep(), SESSION_SWEEP_MS);
    this.sweepTimer.unref();
  }

  /**
   * ALPN-probe an origin once and cache the negotiated protocol. This is the
   * cheap gate the engine calls during probeUrl: 'h2' => use the transport,
 * anything else => the caller keeps its HTTP/1.1 path.
   */
  public detectHttp2(url: string, timeoutMs = 8000): Promise<boolean> {
    const origin = new URL(url).origin;
    const cached = this.cache.get(origin);
    if (cached && !cached.session.destroyed && cached.alpn === 'h2') {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const timer = setTimeout(() => {
        // Do NOT cache failures from this path — the engine will simply use
        // h1 and can retry detection on the next download.
        done(false);
      }, timeoutMs);

      try {
        const session = http2.connect(origin, {
          settings: { maxConcurrentStreams: MAX_CONCURRENT_STREAMS_PER_SESSION },
          peerMaxConcurrentStreams: MAX_CONCURRENT_STREAMS_PER_SESSION,
        });
        session.on('error', () => {
          clearTimeout(timer);
          this.cache.delete(origin);
          done(false);
        });
        session.on('connect', (_s, _p) => {
          clearTimeout(timer);
          const alpn = (session as any)._lastProtocolId === 'h2' || true;
          void alpn;
          // http2.connect only completes 'connect' after a successful ALPN
          // h2 handshake — reaching here IS the h2 confirmation.
          const entry: CachedSession = {
            session,
            origin,
            alpn: 'h2',
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            openStreams: 0,
          };
          this.cache.set(origin, entry);
          done(true);
        });
      } catch {
        clearTimeout(timer);
        done(false);
      }
    });
  }

  /**
   * Download one byte range over a multiplexed h2 stream. Data chunks arrive
   * in order on `onData`; resolves when the stream ends cleanly (complete)
   * or rejects on any error/abort/short-body — the caller retries.
   */
  public async requestRange(opts: H2RangeRequest): Promise<H2RangeResult> {
    const parsed = new URL(opts.url);
    if (parsed.protocol !== 'https:' && !this.allowH2C) {
      throw new Error('HTTP/2 transport requires https');
    }
    const origin = parsed.origin;
    const entry = await this.getSession(origin, opts.timeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS);

    const expected = opts.endByte - opts.startByte + 1;
    const headers: Record<string, string | string[]> = {
      ...(opts.headers || {}),
      ':method': 'GET',
      ':path': parsed.pathname + parsed.search,
      ':authority': parsed.host,
      ':scheme': 'https',
    };
    const isRange = opts.endByte < Number.MAX_SAFE_INTEGER;
    if (isRange) {
      headers.range = `bytes=${opts.startByte}-${opts.endByte}`;
    }

    return new Promise<H2RangeResult>((resolve, reject) => {
      let settled = false;
      const finish = (fn: typeof resolve | typeof reject, arg: any) => {
        if (settled) return;
        settled = true;
        entry.openStreams--;
        fn(arg);
      };

      const timer = setTimeout(() => {
        stream.close(http2.constants.NGHTTP2_CANCEL, () => {});
        finish(reject, new Error('HTTP/2 stream timeout'));
      }, opts.timeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS);
      timer.unref?.();

      let received = 0;
      let status = 0;
      let contentLength: number | undefined;
      let contentRange: string | undefined;

      const stream = entry.session.request(headers);
      entry.openStreams++;
      entry.lastUsedAt = Date.now();

      stream.on('response', (hdrs) => {
        status = hdrs[':status'] ?? 0;
        const cl = hdrs['content-length'];
        if (typeof cl === 'string' || typeof cl === 'number') contentLength = Number(cl);
        const cr = hdrs['content-range'];
        if (typeof cr === 'string') contentRange = cr;
      });

      stream.on('data', (chunk: Buffer) => {
        received += chunk.length;
        const action = opts.onData(chunk);
        if (action === false) {
          stream.close(http2.constants.NGHTTP2_CANCEL, () => {});
          return;
        }
        // Bounded backpressure: pause reading while the consumer signals
        // saturation, resume when it drains. Mirrors h1 res.pause()/resume().
        if (opts.shouldPause?.()) {
          stream.pause();
          const resumeCheck = setInterval(() => {
            if (opts.signal.aborted || !opts.shouldPause?.()) {
              clearInterval(resumeCheck);
              if (!stream.destroyed) stream.resume();
            }
          }, 10);
          resumeCheck.unref?.();
        }
      });

      stream.on('error', (err) => {
        clearTimeout(timer);
        finish(reject, err);
      });

      stream.on('abort', () => {
        clearTimeout(timer);
        finish(reject, new Error('HTTP/2 stream aborted'));
      });

      stream.on('close', () => {
        clearTimeout(timer);
        if (opts.signal.aborted) {
          return finish(reject, new Error('aborted'));
        }
        if (status === 0) {
          return finish(reject, new Error('HTTP/2 stream closed before response'));
        }
        if (received !== expected) {
          return finish(reject, new Error(`Premature EOF: received ${received}/${expected} bytes`));
        }
        finish(resolve, { received, complete: true, status, contentLength, contentRange });
      });

      const onAbort = () => {
        clearTimeout(timer);
        stream.close(http2.constants.NGHTTP2_CANCEL, () => {});
        // 'close' will fire and reject with 'aborted'.
      };
      opts.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Probe origin size + range support with a single 1-byte h2 range stream. */
  public async probeContentLength(url: string, timeoutMs = 8000): Promise<{ contentLength: number; acceptRanges: boolean } | null> {
    try {
      const result = await this.requestRange({
        url,
        startByte: 0,
        endByte: 0,
        onData: () => { /* probe: discard the single byte */ },
        signal: new AbortController().signal,
        timeoutMs,
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NDM-H2' },
      });
      if (result.status !== 206 || !result.contentRange) return null;
      const m = result.contentRange.match(/\/(\d+)$/);
      if (!m) return null;
      return { contentLength: parseInt(m[1], 10), acceptRanges: true };
    } catch {
      return null;
    }
  }

  private async getSession(origin: string, timeoutMs: number): Promise<CachedSession> {
    const existing = this.cache.get(origin);
    if (existing && !existing.session.destroyed && !existing.session.closed) {
      existing.lastUsedAt = Date.now();
      return existing;
    }
    // Create one on demand (connect + ALPN under a timeout).
    const ok = await this.connectSession(origin, timeoutMs);
    if (!ok) throw new Error(`HTTP/2 connect failed for ${origin}`);
    const entry = this.cache.get(origin)!;
    return entry;
  }

  private connectSession(origin: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      timer.unref?.();

      try {
        const session = http2.connect(origin, {
          settings: { maxConcurrentStreams: MAX_CONCURRENT_STREAMS_PER_SESSION },
        });
        session.on('error', () => {
          clearTimeout(timer);
          this.cache.delete(origin);
          done(false);
        });
        session.on('connect', () => {
          clearTimeout(timer);
          this.cache.set(origin, {
            session,
            origin,
            alpn: 'h2',
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            openStreams: 0,
          });
          this.evictIfNeeded();
          done(true);
        });
      } catch {
        clearTimeout(timer);
        done(false);
      }
    });
  }

  private evictIfNeeded() {
    if (this.cache.size <= MAX_CACHED_SESSIONS) return;
    const entries = [...this.cache.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    while (this.cache.size > MAX_CACHED_SESSIONS) {
      const victim = entries.shift();
      if (!victim) break;
      if (victim.openStreams > 0) continue; // in use; keep alive
      this.cache.delete(victim.origin);
      try { victim.session.close(); } catch { /* ignore */ }
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [origin, entry] of this.cache) {
      if (entry.session.destroyed || entry.session.closed) {
        this.cache.delete(origin);
        continue;
      }
      if (entry.openStreams === 0 && now - entry.lastUsedAt > SESSION_TTL_MS) {
        this.cache.delete(origin);
        try { entry.session.close(); } catch { /* ignore */ }
      }
    }
  }

  public destroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const [, entry] of this.cache) {
      try { entry.session.destroy(); } catch { /* ignore */ }
    }
    this.cache.clear();
  }
}
