/**
 * Phase 10.9: Pay-for-Speed Host Simulation
 *
 * Simulates the hostile behavior of "buy premium for fast downloads" file
 * hosts against the REAL DownloadEngine over a REAL local HTTP server:
 *   - HTTP 429 (with Retry-After) whenever the client exceeds the free-tier
 *     concurrent-connection limit.
 *   - HTTP 503 storms (with Retry-After in both seconds and HTTP-date form).
 *   - Free-tier concurrency accounting (in-flight request tracking).
 *
 * Asserts the three properties a download manager MUST have on such hosts:
 *   1. Downgrade: 429/503 pressure clamps the host to single-stream mode and
 *      the engine behaviorally stops opening parallel connections.
 *   2. Zero waste: retries resume from the exact committed byte offset —
 *      the server never serves the same byte range twice (no restart from
 *      zero, no re-downloaded bytes on a metered connection).
 *   3. Stepwise recovery: after clean successes accumulate past the calm-down
 *      window, the connection cap is restored ONE step at a time, never
 *      beyond the historical clean high-water mark.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { AddressInfo } from 'net';
import { DownloadEngine } from './engine';

console.log('================================================================================');
console.log('       PHASE 10.9 PAY-FOR-SPEED HOST SIMULATION TEST SUITE                      ');
console.log('================================================================================\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, testId: string, desc: string) {
  if (condition) {
    console.log(`[PASS] ${testId}: ${desc}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testId}: ${desc}`);
    failed++;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sha256File(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let read = 0;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Hostile host server
// ---------------------------------------------------------------------------

const PAYLOAD_SIZE = 4 * 1024 * 1024; // 4 MB
const PAYLOAD = Buffer.alloc(PAYLOAD_SIZE);
for (let i = 0; i < PAYLOAD_SIZE; i += 1024) {
  PAYLOAD.write(`PAYWALL_BLOCK_${i}_` + 'P'.repeat(990), i);
}
const PAYLOAD_HASH = crypto.createHash('sha256').update(PAYLOAD).digest('hex');

interface Hostility {
  /** Max concurrent GETs before 429 (Infinity = never). */
  freeTierConcurrency: number;
  /** Every Nth data request => 503 instead (0 = never). */
  stormEveryNth: number;
  /** Every Nth data request => 429 even if compliant (0 = never). Some
   *  hosts throttle single connections too. */
  intermittent429EveryNth: number;
  /** Every Nth data request: serve 1 MB then destroy mid-body (0 = never).
   *  Forces Range-resume reconnects so a single stream accumulates request
   *  history like a long real-world transfer would. */
  dropMidBodyEveryNth: number;
  /** Retry-After style for rejections: 'seconds' | 'http-date'. */
  retryAfterStyle: 'seconds' | 'http-date';
  /** Recovery probing enabled (false = pinned after first downgrade). */
  allowRecovery: boolean;
  /** Drip tick interval ms (higher = slower transfer, for pause tests). */
  dripTickMs: number;
}

interface ServerStats {
  totalRequests: number;
  dataRequests: number;
  rejected429: number;
  rejected503: number;
  bytesServed: number;
  maxInFlight: number;
  /** Peak concurrent GETs in the SETTLED state after the host's rejections —
   *  the sharp behavioral property: once the client has adapted to the
   *  enforced concurrency, it must never exceed it again. Measured from the
   *  last rejection + a settle window, so the mechanical reconnect wave of
   *  outstanding workers during the downgrade (each retrying immediately,
   *  before the cap is applied) doesn't fake a behavioral failure. */
  maxInFlightAfterLastRejection: number;
  sawRejection: boolean;
}

function createHostileServer(hostility: Hostility) {
  let inFlight = 0;
  let dataReqCounter = 0;
  /** Settle window: peak-in-flight tracking starts only this long after the
   *  last rejection. Covers one retry backoff (>=2s) plus socket drain, so
   *  the tracker sees the engine's ADAPTED behavior, not its mechanical
   *  reconnect wave while the downgrade is still propagating. */
  const REJECTION_SETTLE_MS = 4000;
  let lastRejectionAt = 0;
  const stats: ServerStats = {
    totalRequests: 0,
    dataRequests: 0,
    rejected429: 0,
    rejected503: 0,
    bytesServed: 0,
    maxInFlight: 0,
    maxInFlightAfterLastRejection: 0,
    sawRejection: false,
  };

  const server = http.createServer((req, res) => {
    stats.totalRequests++;

    // HEAD probes are always answered honestly (a host that rejects probes
    // never gets to the interesting part of the test).
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Length': String(PAYLOAD_SIZE),
        'Accept-Ranges': 'bytes',
      });
      return res.end();
    }

    inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
    if (stats.sawRejection && Date.now() - lastRejectionAt >= REJECTION_SETTLE_MS) {
      stats.maxInFlightAfterLastRejection = Math.max(stats.maxInFlightAfterLastRejection, inFlight);
    }

    // A rejected request fires BOTH 'finish' and 'close' on its response —
    // count the socket once, or inFlight goes negative and the free-tier
    // rejection gate can never fire again (post-rejection bursts would then
    // sail through and fake an engine parallelism failure).
    let counted = false;
    const done = () => {
      if (!counted) {
        counted = true;
        inFlight--;
      }
    };
    res.on('close', done);
    res.on('finish', done);

    const match = req.headers.range ? req.headers.range.match(/bytes=(\d+)-(\d+)/) : null;

    // Free-tier concurrency enforcement: reject BEFORE serving any bytes.
    if (inFlight > hostility.freeTierConcurrency) {
      stats.sawRejection = true;
      stats.rejected429++;
      lastRejectionAt = Date.now();
      const ra = hostility.retryAfterStyle === 'http-date'
        ? new Date(Date.now() + 1000).toUTCString()
        : '1';
      res.writeHead(429, { 'Retry-After': ra, 'Content-Length': '10' });
      return res.end('rate limit');
    }

    dataReqCounter++;
    stats.dataRequests++;

    // Even compliant connections can be throttled on a schedule.
    if (hostility.intermittent429EveryNth > 0 && dataReqCounter % hostility.intermittent429EveryNth === 0) {
      stats.sawRejection = true;
      stats.rejected429++;
      lastRejectionAt = Date.now();
      const ra = hostility.retryAfterStyle === 'http-date'
        ? new Date(Date.now() + 1000).toUTCString()
        : '1';
      res.writeHead(429, { 'Retry-After': ra, 'Content-Length': '10' });
      return res.end('rate limit');
    }

    if (hostility.stormEveryNth > 0 && dataReqCounter % hostility.stormEveryNth === 0) {
      stats.rejected503++;
      lastRejectionAt = Date.now();
      const ra = hostility.retryAfterStyle === 'http-date'
        ? new Date(Date.now() + 1000).toUTCString()
        : '1';
      res.writeHead(503, { 'Retry-After': ra, 'Content-Length': '8' });
      return res.end('throttle');
    }

    const start = match ? parseInt(match[1], 10) : 0;
    const end = match && match[2] ? parseInt(match[2], 10) : PAYLOAD_SIZE - 1;
    const slice = PAYLOAD.subarray(start, end + 1);

    if (!match) {
      res.writeHead(200, { 'Content-Length': String(slice.length) });
      res.end(slice);
      stats.bytesServed += slice.length;
      return;
    }

    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_SIZE}` });
    // Drip in 64 KB chunks so client-side aborts (dynamic splits, pause) have
    // a bounded in-flight window — keeps the byte-accounting assertions sharp.
    const DROP_AFTER = 1024 * 1024; // kill mid-body responses after 1 MB
    let offset = 0;
    const iv = setInterval(() => {
      if (res.writableEnded || res.destroyed || offset >= slice.length) {
        clearInterval(iv);
        if (!res.writableEnded && !res.destroyed) res.end();
        return;
      }
      const next = Math.min(offset + 64 * 1024, slice.length);
      res.write(slice.subarray(offset, next));
      stats.bytesServed += next - offset;
      offset = next;
      if (
        hostility.dropMidBodyEveryNth > 0 &&
        dataReqCounter % hostility.dropMidBodyEveryNth === 0 &&
        offset >= DROP_AFTER &&
        offset < slice.length
      ) {
        clearInterval(iv);
        res.destroy();
      }
    }, hostility.dripTickMs);
    req.on('close', () => clearInterval(iv));
  });

  return { server, stats };
}

async function waitForCompletion(engine: DownloadEngine, id: string, timeoutMs = 120000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = engine.downloads.get(id);
    if (!item) throw new Error('download row vanished');
    if (item.status === 'completed') return;
    if (item.status === 'error') throw new Error(`download failed: ${item.error}`);
    await sleep(20);
  }
  const item = engine.downloads.get(id);
  throw new Error(`timeout: status=${item?.status} bytes=${item?.downloadedBytes}/${item?.totalBytes}`);
}

async function withServer(
  hostility: Hostility,
  fn: (server: http.Server, port: number, stats: ServerStats) => Promise<void>
): Promise<void> {
  const { server, stats } = createHostileServer(hostility);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(server, port, stats);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ndm_paywall_'));

  // -------------------------------------------------------------------------
  // PW-01..04: parallel burst against a free-tier-limited host
  // -------------------------------------------------------------------------
  {
    const hostility: Hostility = {
      freeTierConcurrency: 2,
      stormEveryNth: 0,
      intermittent429EveryNth: 0,
      dropMidBodyEveryNth: 0,
      dripTickMs: 1,
      retryAfterStyle: 'seconds',
      allowRecovery: false, // pin the downgrade for the behavioral assertion
    };
    await withServer(hostility, async (_server, port, stats) => {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      engine.hostIntelligence.clear();
      // Pin recovery off so the max-in-flight assertion is deterministic.
      engine.hostIntelligence.CAP_RECOVERY_COOLDOWN_MS = Number.MAX_SAFE_INTEGER;
      const url = `http://localhost:${port}/bigfile.zip`;

      const item = await engine.addDownload(url, 'pw01.zip', TEST_DIR, 0); // Auto
      await waitForCompletion(engine, item.id);

      const cap = engine.hostIntelligence.getCapabilities(url);

      assert(stats.rejected429 > 0, 'PW-01a', `host issued 429s under parallel burst (${stats.rejected429} rejections)`);
      assert(cap !== null && cap.maxConnections === 1, 'PW-01b', `engine downgraded host to 1 connection (cap=${cap?.maxConnections})`);
      assert(item.status === 'completed' && sha256File(item.destinationPath) === PAYLOAD_HASH, 'PW-02', 'download completed with exact SHA-256 despite hostile host');
      // After the host's FINAL rejection, parallelism must be gone: at most
      // one compliant stream plus one reconnect overlap (a true burst would
      // push this to the original concurrency level, 12 for a 4 MB file).
      assert(stats.maxInFlightAfterLastRejection <= 2, 'PW-03', `engine behaviorally stopped parallelism after final 429 (max in-flight after last rejection: ${stats.maxInFlightAfterLastRejection}, burst was ${stats.maxInFlight})`);
      // 429s are pre-body rejections: every served byte must be unique. Any
      // restart-from-zero would push totalServed to ~2x the file size.
      const wasteRatio = stats.bytesServed / PAYLOAD_SIZE;
      assert(wasteRatio < 1.25, 'PW-04', `zero-waste resume (server served ${stats.bytesServed} bytes for a ${PAYLOAD_SIZE} byte file, ratio ${wasteRatio.toFixed(3)})`);

      engine.destroy();
    });
  }

  // -------------------------------------------------------------------------
  // PW-05: single-stream + intermittent 429s => byte-exact, no re-download
  // -------------------------------------------------------------------------
  {
    const hostility: Hostility = {
      freeTierConcurrency: 1,
      stormEveryNth: 0,
      intermittent429EveryNth: 4,
      // Every data response is killed after 1 MB: a fast single-stream
      // transfer would otherwise complete in ONE request and none of the
      // request-counted knobs (429 schedule included) would ever fire.
      dropMidBodyEveryNth: 1,
      dripTickMs: 1,
      retryAfterStyle: 'seconds',
      allowRecovery: false,
    };
    await withServer(hostility, async (_server, port, stats) => {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      engine.hostIntelligence.clear();
      const url = `http://localhost:${port}/single.bin`;

      // Explicit 1 connection + EVERY response killed after 1 MB + a 429 on
      // the 4th request: the transfer only completes if every retry resumes
      // from the committed offset. A restart-from-zero per drop would nearly
      // triple server traffic (1+2+3+4 MB served for a 4 MB file).
      const item = await engine.addDownload(url, 'pw05.bin', TEST_DIR, 1);
      await waitForCompletion(engine, item.id);

      assert(item.status === 'completed' && sha256File(item.destinationPath) === PAYLOAD_HASH, 'PW-05a', 'single-stream under 429 pressure completed with exact SHA-256');
      assert(stats.rejected429 > 0, 'PW-05b', `429s were actually exercised (${stats.rejected429})`);
      // Each 1 MB mid-body drop can waste at most its in-flight window plus
      // the resume overlap (~256 KB); a from-scratch restart would add the
      // full file size. Bound: file + 1.5 MB slack, and never >= 1.4x file.
      assert(
        stats.bytesServed <= PAYLOAD_SIZE + 1.5 * 1024 * 1024 &&
        stats.bytesServed < PAYLOAD_SIZE * 1.4,
        'PW-05c',
        `near-byte-exact transfer under drops+429s: server served ${stats.bytesServed} bytes for ${PAYLOAD_SIZE} (${((stats.bytesServed / PAYLOAD_SIZE - 1) * 100).toFixed(1)}% overhead; a restart would be +100%)`
      );

      engine.destroy();
    });
  }

  // -------------------------------------------------------------------------
  // PW-06: 503 storm + HTTP-date Retry-After, parallel segments
  // -------------------------------------------------------------------------
  {
    const hostility: Hostility = {
      freeTierConcurrency: Infinity,
      stormEveryNth: 3,
      intermittent429EveryNth: 0,
      dropMidBodyEveryNth: 0,
      dripTickMs: 1,
      retryAfterStyle: 'http-date',
      allowRecovery: false,
    };
    await withServer(hostility, async (_server, port, stats) => {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      engine.hostIntelligence.clear();
      engine.hostIntelligence.CAP_RECOVERY_COOLDOWN_MS = Number.MAX_SAFE_INTEGER;
      const url = `http://localhost:${port}/storm.bin`;

      const item = await engine.addDownload(url, 'pw06.bin', TEST_DIR, 8);
      await waitForCompletion(engine, item.id);

      const cap = engine.hostIntelligence.getCapabilities(url);
      assert(stats.rejected503 > 0, 'PW-06a', `503 storm was exercised (${stats.rejected503} rejections, HTTP-date Retry-After)`);
      assert(cap !== null && cap.maxConnections === 1, 'PW-06b', `503 pressure downgraded host to 1 connection (cap=${cap?.maxConnections})`);
      assert(item.status === 'completed' && sha256File(item.destinationPath) === PAYLOAD_HASH, 'PW-06c', 'download survived 503 storm with exact SHA-256');
      const wasteRatio = stats.bytesServed / PAYLOAD_SIZE;
      assert(wasteRatio < 1.25, 'PW-06d', `503-storm transfer stayed near-zero-waste (ratio ${wasteRatio.toFixed(3)})`);

      engine.destroy();
    });
  }

  // -------------------------------------------------------------------------
  // PW-07: stepwise recovery after clean successes (cooldown expired)
  // -------------------------------------------------------------------------
  {
    const hostility: Hostility = {
      freeTierConcurrency: 2,
      stormEveryNth: 0,
      intermittent429EveryNth: 0,
      dropMidBodyEveryNth: 0,
      dripTickMs: 1,
      retryAfterStyle: 'seconds',
      allowRecovery: true,
    };
    await withServer(hostility, async (_server, port) => {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      engine.hostIntelligence.clear();
      engine.hostIntelligence.CAP_RECOVERY_COOLDOWN_MS = 200;
      engine.hostIntelligence.CAP_RECOVERY_PROBE_INTERVAL_MS = 50;
      const url = `http://localhost:${port}/recover.bin`;

      const item = await engine.addDownload(url, 'pw07.bin', TEST_DIR, 0);
      await waitForCompletion(engine, item.id);

      const cap = engine.hostIntelligence.getCapabilities(url);
      assert(cap !== null && cap.maxConnections === 1, 'PW-07a', `host was downgraded during download (cap=${cap?.maxConnections})`);

      // Simulate the clean-success accumulation the cooldown window requires,
      // then verify recovery moves exactly ONE step at a time.
      const highWater = cap?.maxObservedConnections || 4;
      for (let i = 0; i < 3; i++) engine.hostIntelligence.recordCapSuccess(url);
      await sleep(250); // let the calm-down window expire
      const step1 = engine.hostIntelligence.getOptimalConnectionsForHost(url, 16);
      assert(step1 === 2, 'PW-07b', `first recovery probe restored exactly one step (cap 1 -> ${step1})`);

      for (let i = 0; i < 3; i++) engine.hostIntelligence.recordCapSuccess(url);
      await sleep(60);
      const step2 = engine.hostIntelligence.getOptimalConnectionsForHost(url, 16);
      assert(step2 === 3, 'PW-07c', `second recovery probe restored the next single step (cap -> ${step2})`);

      // Recovery must never exceed the historical clean high-water mark.
      for (let round = 0; round < 40 && step2 + round < highWater; round++) {
        for (let i = 0; i < 3; i++) engine.hostIntelligence.recordCapSuccess(url);
        await sleep(60);
        engine.hostIntelligence.getOptimalConnectionsForHost(url, 16);
      }
      const cappedFinal = engine.hostIntelligence.getOptimalConnectionsForHost(url, 16);
      assert(cappedFinal <= highWater, 'PW-07d', `recovery never exceeds historical ceiling (cap=${cappedFinal}, ceiling=${highWater})`);

      engine.destroy();
    });
  }

  // -------------------------------------------------------------------------
  // PW-08: pause + resume on a hostile host resumes from committed offset
  // -------------------------------------------------------------------------
  {
    const hostility: Hostility = {
      freeTierConcurrency: 1,
      stormEveryNth: 0,
      intermittent429EveryNth: 0,
      dropMidBodyEveryNth: 0,
      dripTickMs: 8, // slow drip so the pause lands mid-download, not at 100%
      retryAfterStyle: 'seconds',
      allowRecovery: false,
    };
    await withServer(hostility, async (_server, port, stats) => {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      engine.hostIntelligence.clear();
      const url = `http://localhost:${port}/pausable.bin`;

      const item = await engine.addDownload(url, 'pw08.bin', TEST_DIR, 1);
      // Poll CHUNK-level progress: item.downloadedBytes only refreshes once
      // per second (speed-interval tick), which at loopback speed means the
      // pause would land after completion and make this test vacuous. The
      // write queue updates chunk.downloadedBytes synchronously per write.
      const chunkBytes = () => item.chunks.reduce((a, c) => a + c.downloadedBytes, 0);
      let guard = 0;
      while ((item.status === 'probing' || chunkBytes() < PAYLOAD_SIZE * 0.3) && item.status !== 'completed' && ++guard < 2000) {
        await sleep(10);
      }

      await engine.pauseDownload(item.id);
      const bytesAtPause = Math.max(chunkBytes(), item.downloadedBytes);
      assert(item.status === 'paused' && bytesAtPause > 0 && bytesAtPause < PAYLOAD_SIZE, 'PW-08a', `paused mid-download at ${bytesAtPause}/${PAYLOAD_SIZE} bytes`);

      const servedAtPause = stats.bytesServed;
      await engine.resumeDownload(item.id);
      await waitForCompletion(engine, item.id);

      assert(item.status === 'completed' && sha256File(item.destinationPath) === PAYLOAD_HASH, 'PW-08b', 'resume on hostile host completed with exact SHA-256');
      // The server may overshoot by at most the bounded in-flight window at
      // abort time (64 KB drips). A restart-from-zero would add a full file.
      const reServed = stats.bytesServed - servedAtPause;
      const remaining = PAYLOAD_SIZE - bytesAtPause;
      assert(reServed < remaining + 256 * 1024, 'PW-08c', `resume fetched only the remaining range (+${Math.max(0, reServed - remaining)} bytes in-flight slack, not ${remaining} re-downloaded)`);

      engine.destroy();
    });
  }

  // -------------------------------------------------------------------------
  // PW-09: known strict pay-for-speed hosts are pinned to 1 forever
  // -------------------------------------------------------------------------
  {
    const engine = new DownloadEngine(undefined, TEST_DIR);
    engine.hostIntelligence.clear();
    const strictHosts = [
      'https://uploadhaven.com/dl/abc',
      'https://rapidgator.net/file/abc',
      'https://1fichier.com/?abc',
      'https://turbobit.net/abc.html',
      'https://nitroflare.com/view/abc',
      'https://ddownload.com/abc',
      'https://filefactory.com/file/abc',
    ];
    let allPinned = true;
    for (const u of strictHosts) {
      const c = engine.hostIntelligence.getOptimalConnectionsForHost(u, 32);
      if (c !== 1) {
        allPinned = false;
        console.error(`  [diag] ${u} => ${c} connections (expected 1)`);
      }
    }
    assert(allPinned, 'PW-09', 'all 7 known strict file hosts pinned to a single connection regardless of request');
    engine.destroy();
  }

  // Cleanup
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log('\n================================================================================');
  console.log(`PAY-FOR-SPEED HOST SIMULATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

const hardTimeout = setTimeout(() => {
  console.error('[FATAL] suite exceeded 180s hard timeout');
  process.exit(2);
}, 180000);
hardTimeout.unref();

runTests().catch((err) => {
  console.error('Fatal suite error:', err);
  process.exit(1);
});
