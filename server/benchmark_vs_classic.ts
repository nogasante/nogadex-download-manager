/**
 * Head-to-head throughput benchmark: NDM vs classic static-segment downloaders.
 *
 * Classic managers (popular download-manager tools) accelerate
 * downloads by splitting a file into a FIXED number of byte-range segments
 * (typically 8/16/32) and downloading them in parallel. The static approach is
 * vulnerable to:
 *   1. Per-connection ISP/CDN throttling caps (e.g. ~1.5 MB/s per stream).
 *      With static segments, throughput saturates at segments x cap.
 *   2. A straggler segment (slow server partition) blocking completion while
 *      other connections sit idle at 100%.
 *   3. Dropped connections mid-transfer (needs correct resume logic).
 *
 * NDM uses adaptive concurrency + dynamic range work-stealing, which is
 * designed to overcome exactly these conditions.
 *
 * DATA BUDGET: ZERO. Every byte transferred here stays on loopback
 * (127.0.0.1). No internet data bundle is consumed — same approach as
 * server/benchmark_engine.ts (the repo's existing benchmark).
 *
 * Strategies compared (same 80 MB file, same simulated network each):
 *   single_stream  : 1 connection, browser-style (with resume-on-drop)
 *   static_8       : classic fixed 8 static segments, no work-stealing
 *   static_16      : classic fixed 16 static segments, no work-stealing
 *   static_32      : classic fixed 32 static segments, no work-stealing
 *   ndm_fixed_32   : NDM engine pinned to 32 connections (apples-to-apples)
 *   ndm_auto       : NDM's real engine, Auto stream mode (the product default)
 *
 * Environments simulated:
 *   fast          : no artificial throttling (best case for everyone)
 *   per_conn_cap  : each connection capped at 1.5 MB/s (classic ISP shaping)
 *   high_latency  : 60 ms delay before every response
 *   straggler     : byte range [48 MB, 56 MB) served at 256 KB/s
 *   drop_midway   : every response killed after exactly 4 MB served
 *   small_file    : 10 MB file, fast network — the "short download" case
 *                   where startup overhead dominates and NDM's Auto tier
 *                   caps streams at 4 (static segmentation uses 32)
 *
 * Run: npm run bench:vs-classic
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { DownloadEngine } from './engine';

const TEST_PORT = 5098; // distinct from benchmark_engine.ts's 5099
const BENCH_DIR = path.join(os.tmpdir(), 'ndm_vs_classic_' + Date.now());
if (!fs.existsSync(BENCH_DIR)) fs.mkdirSync(BENCH_DIR, { recursive: true });

// 80 MB payload: crosses NDM's auto-tier (> 64 MB => full parallelism).
const PAYLOAD_SIZE = 80 * 1024 * 1024;
const PAYLOAD = Buffer.alloc(PAYLOAD_SIZE);
for (let i = 0; i < PAYLOAD_SIZE; i += 1024) {
  PAYLOAD.write(`NDMVSC_BLOCK_${i}_` + 'Y'.repeat(990), i);
}
const PAYLOAD_HASH = crypto.createHash('sha256').update(PAYLOAD).digest('hex');

// Small-file case: 10 MB is squarely inside NDM's auto-tier downgrade zone
// (<= 64 MB => 4 streams) while classic static runners happily open 32 segments.
// The active payload is the first 10 MB of the same deterministic buffer.
const SMALL_PAYLOAD_SIZE = 10 * 1024 * 1024;
const SMALL_PAYLOAD_HASH = crypto.createHash('sha256').update(PAYLOAD.subarray(0, SMALL_PAYLOAD_SIZE)).digest('hex');

// Per-environment active payload (set in the main loop).
let activePayloadSize = PAYLOAD_SIZE;
let activePayloadHash = PAYLOAD_HASH;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function sha256File(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024); // stream-hash: never hold the whole file
    let read = 0;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeContentLength(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'HEAD' }, (res) => {
      res.resume();
      const len = parseInt(String(res.headers['content-length'] || '0'), 10);
      if (len > 0) resolve(len);
      else reject(new Error('Probe: no content-length'));
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Classic competitor: fixed static segmentation, no adaptive scaling, no
// work-stealing. Segment boundaries are computed once from Content-Length and
// never re-balanced; each segment resumes via Range if its connection drops.
// ---------------------------------------------------------------------------

interface SimpleResult {
  bytes: number;
  durationSec: number;
  sha256Valid: boolean;
  serverRequests: number;
  retries: number;
}

let serverRequestsInWindow = 0;

function fetchRangeOnce(
  url: string,
  startByte: number,
  endByte: number,
  fileHandle: number,
  offsetRef: { offset: number }
): Promise<void> {
  return new Promise((resolve, reject) => {
    let completed = false;
    const req = http.request(url, {
      method: 'GET',
      headers: { Range: `bytes=${offsetRef.offset}-${endByte}` },
    }, (res) => {
      serverRequestsInWindow++;
      if (res.statusCode !== 206) {
        res.resume();
        return reject(new Error(`Expected 206, got ${res.statusCode}`));
      }
      res.on('data', (chunk: Buffer) => {
        fs.writeSync(fileHandle, chunk, 0, chunk.length, offsetRef.offset);
        offsetRef.offset += chunk.length;
      });
      res.on('end', () => {
        completed = true;
        if (offsetRef.offset === endByte + 1) resolve();
        else reject(new Error(`Short read: ${offsetRef.offset - startByte}/${endByte - startByte + 1}`));
      });
      res.on('error', reject);
      res.on('close', () => {
        if (!completed && offsetRef.offset !== endByte + 1) {
          reject(new Error('Connection dropped mid-transfer'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchRangeWithRetry(
  url: string,
  startByte: number,
  endByte: number,
  fileHandle: number,
  maxZeroProgressRetries: number
): Promise<number> {
  const offsetRef = { offset: startByte };
  let retries = 0;
  let zeroProgress = 0;
  // Progress-aware: an attempt that advanced the byte offset is not a real
  // failure and must not consume the retry budget — otherwise a hostile
  // server that drops every 4 MB exhausts 5 attempts long before the file
  // completes. Only stall-out (no bytes gained) burns attempts.
  while (zeroProgress <= maxZeroProgressRetries) {
    const before = offsetRef.offset;
    try {
      await fetchRangeOnce(url, startByte, endByte, fileHandle, offsetRef);
      return retries;
    } catch (e) {
      if (offsetRef.offset > before) {
        zeroProgress = 0;
      } else {
        zeroProgress++;
        retries++;
        if (zeroProgress > maxZeroProgressRetries) throw e;
      }
      await sleep(20);
    }
  }
  return retries;
}

async function runStaticSegmentDownload(
  url: string,
  segments: number,
  destPath: string
): Promise<SimpleResult> {
  const contentLength = await probeContentLength(url);
  const segmentSize = Math.floor(contentLength / segments);
  const fileHandle = fs.openSync(destPath, 'w');
  const startRequests = serverRequestsInWindow;
  let retries = 0;
  const startTime = process.hrtime.bigint();

  try {
    const retryCounts = await Promise.all(
      Array.from({ length: segments }, (_, i) => {
        const startByte = i * segmentSize;
        const endByte = i === segments - 1 ? contentLength - 1 : (i + 1) * segmentSize - 1;
        return fetchRangeWithRetry(url, startByte, endByte, fileHandle, 5);
      })
    );
    retries = retryCounts.reduce((a, b) => a + b, 0);
  } finally {
    fs.closeSync(fileHandle);
  }

  const durationSec = Number(process.hrtime.bigint() - startTime) / 1e9;
  return {
    bytes: contentLength,
    durationSec,
    sha256Valid: sha256File(destPath) === activePayloadHash,
    serverRequests: serverRequestsInWindow - startRequests,
    retries,
  };
}

// Single connection, browser-style, but with Range resume on drop (the best a
// single stream can fairly do).
async function runSingleStreamDownload(url: string, destPath: string): Promise<SimpleResult> {
  const startRequests = serverRequestsInWindow;
  const fileHandle = fs.openSync(destPath, 'w');
  const offsetRef = { offset: 0 };
  let retries = 0;
  const startTime = process.hrtime.bigint();
  let bytes = 0;

  try {
    await fetchRangeWithRetrySingle(url, fileHandle, offsetRef, (n) => { retries = n; });
    bytes = offsetRef.offset;
  } finally {
    fs.closeSync(fileHandle);
  }

  const durationSec = Number(process.hrtime.bigint() - startTime) / 1e9;
  return {
    bytes,
    durationSec,
    sha256Valid: sha256File(destPath) === activePayloadHash,
    serverRequests: serverRequestsInWindow - startRequests,
    retries,
  };
}

async function fetchRangeWithRetrySingle(
  url: string,
  fileHandle: number,
  offsetRef: { offset: number },
  reportRetries: (n: number) => void
): Promise<void> {
  let retries = 0;
  let zeroProgress = 0;
  const MAX_ZERO_PROGRESS = 5;
  // Progress-aware, same policy as the segmented path above.
  while (zeroProgress <= MAX_ZERO_PROGRESS) {
    const before = offsetRef.offset;
    try {
      await new Promise<void>((resolve, reject) => {
        let completed = false;
        const headers: Record<string, string> = {};
        if (offsetRef.offset > 0) headers.Range = `bytes=${offsetRef.offset}-`;
        const req = http.request(url, { method: 'GET', headers }, (res) => {
          serverRequestsInWindow++;
          if (res.statusCode !== 200 && res.statusCode !== 206) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          res.on('data', (chunk: Buffer) => {
            fs.writeSync(fileHandle, chunk, 0, chunk.length, offsetRef.offset);
            offsetRef.offset += chunk.length;
          });
          res.on('end', () => {
            completed = true;
            resolve();
          });
          res.on('error', reject);
          res.on('close', () => {
            if (!completed) reject(new Error('Connection dropped mid-transfer'));
          });
        });
        req.on('error', reject);
        req.end();
      });
      reportRetries(retries);
      return;
    } catch (e) {
      if (offsetRef.offset > before) {
        zeroProgress = 0;
      } else {
        zeroProgress++;
        retries++;
        if (zeroProgress > MAX_ZERO_PROGRESS) { reportRetries(retries); throw e; }
      }
      await sleep(20);
    }
  }
  reportRetries(retries);
}

// ---------------------------------------------------------------------------
// Simulated network environments (all loopback; zero bundle usage)
// ---------------------------------------------------------------------------

type EnvType = 'fast' | 'per_conn_cap' | 'high_latency' | 'straggler' | 'drop_midway' | 'small_file';

const ENV_LABELS: Record<EnvType, string> = {
  fast: 'Fast network (no throttle)',
  per_conn_cap: 'Per-connection cap 1.5 MB/s (ISP shaping)',
  high_latency: 'High latency (60 ms per request)',
  straggler: 'Straggler (bytes 48-56 MB served at 256 KB/s)',
  drop_midway: 'Drops (every response killed after 4 MB served)',
  small_file: 'Small file 10 MB, fast network (startup-dominated)',
};

const PER_CONN_CAP_BPS = 1.5 * 1024 * 1024; // 1.5 MB/s per TCP connection
const STRAGGLER_BPS = 256 * 1024;           // 256 KB/s in the slow zone
const FAST_BPS = 1024 * 1024 * 1024;        // effectively unthrottled
const DRIP_CHUNK = 64 * 1024;               // bytes per write before re-evaluating pace

let stragglerStart = 0;
let stragglerEnd = 0;
let serverHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};

const server = http.createServer((rq, rs) => serverHandler(rq, rs));

interface ServeOpts {
  /** Pace function over ABSOLUTE payload byte position (bytes/sec). */
  speedAt: (absByte: number) => number;
  /** Artificial delay before the response starts (e.g. RTT). */
  delayMs?: number;
  /** Destroy the socket after serving this many bytes of this response. */
  dropAfterBytes?: number;
}

/**
 * Unified response streamer. EVERY GET — range or full-body — is paced by the
 * same speedAt() function evaluated at the current absolute byte position, so
 * all strategies face byte-identical network conditions.
 */
function serveStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  start: number,
  end: number,
  isFullBody: boolean,
  opts: ServeOpts
) {
  const slice = PAYLOAD.subarray(start, end + 1);
  const emit = () => {
    if (res.writableEnded || res.destroyed) return;
    if (isFullBody) {
      res.writeHead(200, { 'Content-Length': String(slice.length) });
    } else {
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${activePayloadSize}` });
    }
    let offset = 0;
    const writeNext = () => {
      if (res.writableEnded || res.destroyed) return;
      if (offset >= slice.length) return res.end();
      if (opts.dropAfterBytes !== undefined && offset >= opts.dropAfterBytes) {
        return res.destroy();
      }
      const remainingBeforeDrop = opts.dropAfterBytes !== undefined
        ? opts.dropAfterBytes - offset
        : Infinity;
      const size = Math.min(DRIP_CHUNK, slice.length - offset, remainingBeforeDrop);
      res.write(slice.subarray(offset, offset + size));
      offset += size;
      // Pace the NEXT chunk by the speed at the new position. Delay below
      // Node's ~1 ms timer floor means "effectively unthrottled": use
      // setImmediate so fast networks are not silently capped at ~64 MB/s.
      const nextBps = opts.speedAt(start + offset);
      const delayMs = (size / nextBps) * 1000;
      if (delayMs < 1) setImmediate(writeNext);
      else setTimeout(writeNext, delayMs);
    };
    writeNext();
    req.on('close', () => { res.destroy(); });
  };
  if (opts.delayMs && opts.delayMs > 0) setTimeout(emit, opts.delayMs);
  else emit();
}

function makeHandlerFor(env: EnvType) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Length': activePayloadSize.toString(),
        'Accept-Ranges': 'bytes',
      });
      return res.end();
    }

    serverRequestsInWindow++;
    const match = req.headers.range ? req.headers.range.match(/bytes=(\d+)-(\d*)/) : null;
    const isRange = !!match;
    const start = match ? parseInt(match[1], 10) : 0;
    const end = match && match[2] ? parseInt(match[2], 10) : activePayloadSize - 1;

    const serve = (opts: Partial<ServeOpts>) =>
      serveStream(req, res, start, end, !isRange, { speedAt: () => FAST_BPS, ...opts });

    switch (env) {
      case 'fast':
      case 'small_file': // same fast network, just a smaller active payload
        return serve({});
      case 'per_conn_cap':
        return serve({ speedAt: () => PER_CONN_CAP_BPS });
      case 'high_latency':
        return serve({ delayMs: 60 });
      case 'straggler':
        return serve({
          speedAt: (abs) => (abs >= stragglerStart && abs < stragglerEnd ? STRAGGLER_BPS : FAST_BPS),
        });
      case 'drop_midway': {
        // Byte-deterministic instability: EVERY response (range or full-body)
        // is killed after exactly 4 MB served. All strategies face identical
        // conditions — no per-request luck, no free passes.
        return serve({ dropAfterBytes: 4 * 1024 * 1024 });
      }
    }
  };
}

// ---------------------------------------------------------------------------
// NDM engine helper
// ---------------------------------------------------------------------------

async function runNdmDownload(
  engine: DownloadEngine,
  url: string,
  connections: number,
  label: string
): Promise<{ durationSec: number; sha256Valid: boolean; status: string; error?: string; destinationPath: string; requests: number; probeMs: number; setupMs: number }> {
  const startRequests = serverRequestsInWindow;
  const startTime = process.hrtime.bigint();
  const item = await engine.addDownload(url, label, BENCH_DIR, connections);

  // Startup phase instrumentation: 'probing' ends when startDownload's probe
  // resolves; 'downloading' begins when the scheduler is created and workers
  // launch. The gap between those transitions is pure setup cost.
  let probeMs = 0;
  let sawDownloading = false;
  let guard = 0;
  // 2 ms poll: NDM's duration is measured through this polling loop while
  // competitors use exact hrtime around their own awaits — a coarse poll
  // would inflate NDM's number by up to one poll interval.
  while (
    item.status === 'probing' ||
    item.status === 'downloading' ||
    item.status === 'queued'
  ) {
    if (item.status === 'probing') probeMs += 2;
    if (item.status === 'downloading') sawDownloading = true;
    await sleep(2);
    if (++guard > 75000) break; // hard cap ~150 s per download
  }
  void sawDownloading;

  const durationSec = Number(process.hrtime.bigint() - startTime) / 1e9;
  const destinationPath = item.destinationPath;
  if (item.status !== 'completed') {
    console.log(`    !! runNdmDownload guard hit: status=${item.status} bytes=${item.downloadedBytes}/${item.totalBytes} chunks=${item.chunks.length} error=${item.error || 'none'}`);
  }
  return {
    durationSec,
    sha256Valid: sha256File(destinationPath) === activePayloadHash && item.status === 'completed',
    status: item.status,
    error: item.error || undefined,
    destinationPath,
    requests: serverRequestsInWindow - startRequests,
    probeMs,
    setupMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Benchmark driver
// ---------------------------------------------------------------------------

interface Row {
  env: EnvType;
  strategy: string;
  mbPerSec: number;
  durationSec: number;
  sha256Valid: boolean;
  requests: number;
  retries: number;
}

function fmtRow(r: Row): string {
  return `${r.strategy.padEnd(30)} ${r.mbPerSec.toFixed(2).padStart(8)} MB/s  (${r.durationSec.toFixed(2)}s, ${r.requests} reqs, ${r.retries} retries)  integrity: ${r.sha256Valid ? 'OK' : 'FAIL'}`;
}

async function main() {
  // Failsafe: never let the benchmark hang a session. Exits (logging the
  // progress reached so far) after 4 minutes regardless of state.
  const hardTimeout = setTimeout(() => {
    console.error('BENCH HARD TIMEOUT — aborting after 240s');
    process.exit(2);
  }, 240000);
  hardTimeout.unref();

  console.log('===================================================================================================');
  console.log('             NDM vs CLASSIC STATIC SEGMENTATION — HEAD-TO-HEAD BENCHMARK');
  console.log('     100% loopback traffic (127.0.0.1) — uses 0 MB of your data bundle. Payload: 80 MB/run');
  console.log('===================================================================================================\n');
  console.log(`Payload SHA-256: ${PAYLOAD_HASH}\n`);

  const results: Row[] = [];
  // Port 0 = OS-assigned ephemeral port: immune to EADDRINUSE from stale
  // processes of a previous run.
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : TEST_PORT;
  const baseUrl = `http://localhost:${port}/bench.bin`;
  const uniqueUrl = (tag: string) => `${baseUrl}?run=${tag}_${Date.now()}`;

  let runIndex = 0;

  // CLI: `tsx benchmark_vs_classic.ts small_file` runs a single environment
  // (useful for isolating hangs); no arg = run all.
  const onlyEnv = process.argv[2] as EnvType | undefined;
  const envList = (['fast', 'per_conn_cap', 'high_latency', 'straggler', 'drop_midway', 'small_file'] as const)
    .filter((e) => !onlyEnv || e === onlyEnv);

  for (const env of envList) {
    serverHandler = makeHandlerFor(env);
    serverRequestsInWindow = 0;
    stragglerStart = env === 'straggler' ? 48 * 1024 * 1024 : 0;
    stragglerEnd = env === 'straggler' ? 56 * 1024 * 1024 : 0;
    activePayloadSize = env === 'small_file' ? SMALL_PAYLOAD_SIZE : PAYLOAD_SIZE;
    activePayloadHash = env === 'small_file' ? SMALL_PAYLOAD_HASH : PAYLOAD_HASH;

    console.log(`\n--- Environment: ${ENV_LABELS[env]} ---`);

    const runCompetitor = async (name: string, fn: () => Promise<SimpleResult>) => {
      const dest = path.join(BENCH_DIR, `${name}_${env}.bin`);
      const res = await fn();
      const mbPerSec = res.durationSec > 0 ? res.bytes / res.durationSec / (1024 * 1024) : 0;
      const row: Row = {
        env, strategy: name, mbPerSec, durationSec: res.durationSec,
        sha256Valid: res.sha256Valid, requests: res.serverRequests, retries: res.retries,
      };
      results.push(row);
      console.log('  ' + fmtRow(row));
      try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch { /* best effort */ }
    };

    await runCompetitor('single_stream', () => runSingleStreamDownload(uniqueUrl(`s${runIndex}`), path.join(BENCH_DIR, `single_stream_${env}.bin`)));
    runIndex++;
    await runCompetitor('static_8', () => runStaticSegmentDownload(uniqueUrl(`i8_${runIndex}`), 8, path.join(BENCH_DIR, `static8_${env}.bin`)));
    runIndex++;
    await runCompetitor('static_16', () => runStaticSegmentDownload(uniqueUrl(`i16_${runIndex}`), 16, path.join(BENCH_DIR, `static16_${env}.bin`)));
    runIndex++;
    await runCompetitor('static_32', () => runStaticSegmentDownload(uniqueUrl(`i32_${runIndex}`), 32, path.join(BENCH_DIR, `static32_${env}.bin`)));
    runIndex++;

    // NDM runs (real engine). fixed_32 = apples-to-apples vs static_32.
    const engine = new DownloadEngine(undefined, BENCH_DIR);
    const runNdm = async (name: string, connections: number) => {
      const res = await runNdmDownload(engine, uniqueUrl(`n_${name}_${runIndex}`), connections, `${name}_${env}.bin`);
      runIndex++;
      const mbPerSec = res.durationSec > 0 ? activePayloadSize / res.durationSec / (1024 * 1024) : 0;
      const row: Row = {
        env, strategy: name, mbPerSec, durationSec: res.durationSec,
        sha256Valid: res.sha256Valid, requests: res.requests,
        retries: 0,
      };
      results.push(row);
      const errNote = res.status === 'completed' ? '' : ` [status=${res.status}${res.error ? ': ' + res.error : ''}]`;
      console.log('  ' + fmtRow(row) + errNote + `  [probe~${res.probeMs}ms]`);
      try { if (fs.existsSync(res.destinationPath)) fs.unlinkSync(res.destinationPath); } catch { /* best effort */ }
    };

    await runNdm('ndm_fixed_32', 32);
    await runNdm('ndm_auto', 0);

    // Reset shared host-intelligence singleton so one env cannot poison the
    // next (same trick as benchmark_engine.ts).
    engine.hostIntelligence.clear();
    engine.destroy();
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));

  // ---- Summary ----
  console.log('\n===================================================================================================');
  console.log('                                        SUMMARY');
  console.log('===================================================================================================');
  const byEnv = new Map<EnvType, Row[]>();
  for (const r of results) {
    if (!byEnv.has(r.env)) byEnv.set(r.env, []);
    byEnv.get(r.env)!.push(r);
  }
  for (const [env, rows] of byEnv) {
    const best = Math.max(...rows.map((r) => r.mbPerSec));
    console.log(`\n${ENV_LABELS[env]}:`);
    for (const r of rows) {
      const marker = r.mbPerSec >= best - 1e-9 ? '  <== FASTEST' : '';
      console.log('  ' + fmtRow(r) + marker);
    }
    const classic = rows.filter((r) => r.strategy.startsWith('static_'));
    const ndmAuto = rows.find((r) => r.strategy === 'ndm_auto');
    const bestClassic = Math.max(...classic.map((r) => r.mbPerSec));
    if (ndmAuto && bestClassic > 0) {
      console.log(`  => NDM Auto vs best classic static: ${ndmAuto.mbPerSec >= bestClassic ? (ndmAuto.mbPerSec / bestClassic).toFixed(2) + 'x faster' : (bestClassic / ndmAuto.mbPerSec).toFixed(2) + 'x SLOWER'}`);
    }
  }

  const allValid = results.every((r) => r.sha256Valid);
  console.log(`\nIntegrity: ${allValid ? 'ALL downloads byte-identical (SHA-256 match)' : 'SOME DOWNLOADS FAILED INTEGRITY — see rows above'}`);
  console.log('Data used from your bundle: 0 MB (all traffic on 127.0.0.1).');
  try { fs.rmSync(BENCH_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Benchmark failed:', err);
  try { fs.rmSync(BENCH_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(1);
});
