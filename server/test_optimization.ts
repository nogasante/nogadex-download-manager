import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DownloadEngine } from './engine';
import { DynamicRangeScheduler } from './scheduler';
import { HostIntelligence } from './host_intelligence';
import { AdaptiveConcurrencyController } from './adaptive_concurrency';
import { ChunkOptimizer } from './chunk_optimizer';
import { PerformanceTelemetryTracker } from './performance_metrics';

const TEST_PORT = 5087;
const TEST_DIR = path.join(os.tmpdir(), 'hyper_p3_opt_test');

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sha256Buffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return sha256Buffer(data);
}

function generateDeterministicBuffer(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) {
    buf[i] = (i * 31 + 17) & 0xff;
  }
  return buf;
}

async function runOptimizationTests() {
  console.log('========================================================================');
  console.log('       HYPERDOWNLOADER P3 INTELLIGENT OPTIMIZATION TEST SUITE           ');
  console.log('========================================================================\n');

  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

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

  const PAYLOAD_10MB = generateDeterministicBuffer(10 * 1024 * 1024);
  const HASH_10MB = sha256Buffer(PAYLOAD_10MB);
  let activePayload = PAYLOAD_10MB;

  let serverHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = (req, res) => {
    res.writeHead(200);
    res.end('OK');
  };

  const server = http.createServer((req, res) => serverHandler(req, res));
  await new Promise<void>(resolve => server.listen(TEST_PORT, resolve));

  try {
    // -------------------------------------------------------------------------
    // OPT-01: Adaptive chunk size increases on stable high throughput
    // -------------------------------------------------------------------------
    {
      const optimizer = new ChunkOptimizer({ defaultChunkSize: 2 * 1024 * 1024, maxChunkSize: 16 * 1024 * 1024 });
      const initial = optimizer.getCurrentChunkSize();
      // Record 6 successful chunks
      for (let i = 0; i < 6; i++) {
        optimizer.recordChunkOutcome(true, 100, 2 * 1024 * 1024);
      }
      const scaled = optimizer.getCurrentChunkSize();
      assert(scaled > initial, 'OPT-01', `Adaptive chunk size scaled up from ${initial} to ${scaled} on sustained success`);
    }

    // -------------------------------------------------------------------------
    // OPT-02: Adaptive chunk size decreases under repeated failures
    // -------------------------------------------------------------------------
    {
      const optimizer = new ChunkOptimizer({ defaultChunkSize: 4 * 1024 * 1024, minChunkSize: 256 * 1024 });
      const initial = optimizer.getCurrentChunkSize();
      optimizer.recordChunkOutcome(false);
      optimizer.recordChunkOutcome(false);
      const reduced = optimizer.getCurrentChunkSize();
      assert(reduced < initial, 'OPT-02', `Adaptive chunk size reduced from ${initial} to ${reduced} under failure pressure`);
    }

    // -------------------------------------------------------------------------
    // OPT-03: Chunk size strictly clamped within configured bounds
    // -------------------------------------------------------------------------
    {
      const optimizer = new ChunkOptimizer({ minChunkSize: 512 * 1024, maxChunkSize: 8 * 1024 * 1024 });
      const hugeCalc = optimizer.calculateOptimalChunkSize({
        throughputBps: 100 * 1024 * 1024, // 100 MB/s
        rttMs: 10,
        retryCount: 0,
        remainingBytes: 500 * 1024 * 1024,
        activeWorkers: 4,
      });
      const tinyCalc = optimizer.calculateOptimalChunkSize({
        throughputBps: 10 * 1024, // 10 KB/s
        rttMs: 800,
        retryCount: 5,
        remainingBytes: 10 * 1024 * 1024,
        activeWorkers: 4,
      });
      assert(hugeCalc <= 8 * 1024 * 1024 && tinyCalc >= 512 * 1024, 'OPT-03', 'Chunk size strictly clamped within [512 KB, 8 MB]');
    }

    // -------------------------------------------------------------------------
    // OPT-04: Host performance profile persists and expires correctly
    // -------------------------------------------------------------------------
    {
      const hostIntel = new HostIntelligence(50); // 50ms TTL
      hostIntel.recordRequestResult('http://opt-host.com/test', 206, 45, 1048576, false);
      hostIntel.recordThroughput('http://opt-host.com/test', 25 * 1024 * 1024);
      
      const prof = hostIntel.getPerformanceProfile('http://opt-host.com/test');
      assert(prof !== null && prof.averageRttMs === 45 && prof.smoothedThroughputBps > 0, 'OPT-04a', 'Host performance profile captured latency and throughput');
      
      await sleep(60);
      const expired = hostIntel.getPerformanceProfile('http://opt-host.com/test');
      assert(expired === null, 'OPT-04b', 'Host performance profile safely invalidated upon TTL expiration');
    }

    // -------------------------------------------------------------------------
    // OPT-05: Concurrency controller evaluates RTT and error rate
    // -------------------------------------------------------------------------
    {
      const controller = new AdaptiveConcurrencyController({ minWorkers: 2, maxWorkers: 8, initialWorkers: 4 });
      controller.recordThroughputSample(10 * 1024 * 1024, 1000);
      const action = controller.evaluate({
        activeWorkersCount: 4,
        latencyMs: 800, // Very high latency
        errorRate: 0.25, // 25% error rate
      });
      assert(action === 'scale_down' && controller.getTargetWorkers() < 4, 'OPT-05', 'High RTT + error pressure triggered conservative scale down');
    }

    // -------------------------------------------------------------------------
    // OPT-06: Concurrency does not oscillate rapidly due to cooldown
    // -------------------------------------------------------------------------
    {
      const controller = new AdaptiveConcurrencyController({ minWorkers: 2, maxWorkers: 8, initialWorkers: 4, cooldownMs: 1000 });
      controller.recordThroughputSample(20 * 1024 * 1024, 1000);
      const first = controller.evaluate({ activeWorkersCount: 4 }); // May scale
      const second = controller.evaluate({ activeWorkersCount: 4 }); // Within cooldown
      assert(second === 'maintain', 'OPT-06', 'Consecutive evaluation within cooldown returned maintain (anti-oscillation)');
    }

    // -------------------------------------------------------------------------
    // OPT-07: Intelligent stealing avoids useless tiny steals (< 256 KB)
    // -------------------------------------------------------------------------
    {
      const scheduler = new DynamicRangeScheduler(1024 * 1024, 2, 256 * 1024);
      scheduler.chunks[0].status = 'downloading';
      scheduler.chunks[0].downloadedBytes = 500 * 1024; // 12 KB remaining
      scheduler.chunks[1].status = 'done';
      scheduler.chunks[1].downloadedBytes = 512 * 1024;

      const stolen = scheduler.stealWork(1024 * 1024, 256 * 1024);
      assert(stolen === null, 'OPT-07', 'Tiny remaining range (12 KB < 256 KB) rejected from work stealing');
    }

    // -------------------------------------------------------------------------
    // OPT-08: Intelligent stealing splits straggler proportionally to speed
    // -------------------------------------------------------------------------
    {
      const scheduler = new DynamicRangeScheduler(10 * 1024 * 1024, 2, 256 * 1024);
      scheduler.chunks[0].status = 'downloading';
      scheduler.chunks[0].speedBps = 100 * 1024; // Slow: 100 KB/s
      scheduler.chunks[0].downloadedBytes = 500 * 1024;
      scheduler.chunks[1].status = 'done';
      scheduler.chunks[1].downloadedBytes = 5 * 1024 * 1024;

      const thiefSpeed = 900 * 1024; // Fast: 900 KB/s
      const stolen = scheduler.stealWork(thiefSpeed);
      
      // Thief is 9x faster, so thief should receive ~90% of remaining 4.5 MB (~4 MB)
      assert(stolen !== null && stolen.totalBytes > 3 * 1024 * 1024, 'OPT-08', `Proportional split gave faster thief ${stolen?.totalBytes} bytes`);
    }

    // -------------------------------------------------------------------------
    // OPT-09: Small file (<= 2 MB) uses optimized single-stream fast path
    // -------------------------------------------------------------------------
    {
      const smallBuf = generateDeterministicBuffer(1024 * 1024); // 1 MB
      const smallHash = sha256Buffer(smallBuf);

      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': smallBuf.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : smallBuf.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${smallBuf.length}` });
        res.end(smallBuf.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/small.bin`, 'small.bin', TEST_DIR, 8);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      assert(item.chunks.length === 1 && downloadedHash === smallHash, 'OPT-09', 'Small file (1 MB) initialized with 1 stream and matched SHA-256');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // OPT-10: Near-completion retires unnecessary workers without spawning extra steals
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_10MB.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_10MB.length}` });
        res.end(PAYLOAD_10MB.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/near_complete.bin`, 'near_complete.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      assert(item.status === 'completed' && item.downloadedBytes === PAYLOAD_10MB.length, 'OPT-10', 'Near-completion finished cleanly with exact committed bytes');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // OPT-11: Connection reuse / keep-alive succeeds without range corruption
    // -------------------------------------------------------------------------
    {
      let requestCount = 0;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        requestCount++;
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_10MB.length - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${PAYLOAD_10MB.length}`,
          'Connection': 'keep-alive',
          'Keep-Alive': 'timeout=5, max=100'
        });
        res.end(PAYLOAD_10MB.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/keepalive.bin`, 'keepalive.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      assert(requestCount >= 4 && downloadedHash === HASH_10MB, 'OPT-11', 'Keep-alive connections executed multiple ranges with 100% SHA-256 match');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // OPT-12: Failed reused connection retries from exact committed offset
    // -------------------------------------------------------------------------
    {
      let failedOnce = false;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_10MB.length - 1;

        if (!failedOnce && start > 0) {
          failedOnce = true;
          req.destroy(); // Sudden drop of reused connection
          return;
        }

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_10MB.length}` });
        res.end(PAYLOAD_10MB.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/reused_retry.bin`, 'reused_retry.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(50);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'OPT-12', 'Reused connection drop recovered via retry with exact SHA-256');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // OPT-13: Performance telemetry reports accurate byte counts and metrics
    // -------------------------------------------------------------------------
    {
      const tracker = new PerformanceTelemetryTracker('test_dl_1');
      tracker.recordThroughputSample(5 * 1024 * 1024, 2);
      tracker.recordThroughputSample(15 * 1024 * 1024, 4);
      tracker.recordRtt(40);
      tracker.recordWorkerBytes(0, 1024 * 1024);
      tracker.recordWorkerBytes(1, 2 * 1024 * 1024);
      tracker.recordSteal(0, 2, 500000, 1000000);
      tracker.recordRetry('HTTP 503', 1, 200000);
      tracker.recordVerification(15, true);

      const tele = tracker.finalize();
      assert(
        tele.peakThroughputBps === 15 * 1024 * 1024 &&
        tele.totalBytesCommitted === 3 * 1024 * 1024 &&
        tele.totalSteals === 1 &&
        tele.totalRetries === 1 &&
        tele.sha256Valid === true,
        'OPT-13',
        'Performance telemetry captured peak throughput, bytes committed, and steal/retry events'
      );
    }

    // -------------------------------------------------------------------------
    // OPT-14: Complete optimized multi-worker download produces exact SHA-256
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_10MB.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_10MB.length}` });
        res.end(PAYLOAD_10MB.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/opt_14.bin`, 'opt_14.bin', TEST_DIR, 8);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB, 'OPT-14', 'Optimized multi-worker download matches SHA-256');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // OPT-15: Pause and resume remains 100% safe
    // -------------------------------------------------------------------------
    {
      let isPausedPhase = true;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_10MB.length - 1;
        const slice = PAYLOAD_10MB.subarray(start, end + 1);

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_10MB.length}` });
        if (isPausedPhase) {
          let offset = 0;
          const iv = setInterval(() => {
            if (offset >= slice.length) {
              clearInterval(iv);
              return res.end();
            }
            const next = Math.min(offset + 32 * 1024, slice.length);
            res.write(slice.subarray(offset, next));
            offset = next;
          }, 20);
          req.on('close', () => clearInterval(iv));
        } else {
          res.end(slice);
        }
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/opt_pause.bin`, 'opt_pause.bin', TEST_DIR, 4);
      while (item.status === 'probing' || (item.status === 'downloading' && item.downloadedBytes < 200 * 1024)) {
        await sleep(10);
      }

      await engine.pauseDownload(item.id);
      assert(item.status === 'paused', 'OPT-15a', 'Download safely paused mid-stream');

      isPausedPhase = false;
      await engine.resumeDownload(item.id);
      while (item.status === 'downloading') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'OPT-15b', 'Resumed download finished with 100% SHA-256 match');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // OPT-16: Crash / recovery under optimized scheduler restores exact state
    // -------------------------------------------------------------------------
    {
      let isCrashPhase = true;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_10MB.length - 1;
        const slice = PAYLOAD_10MB.subarray(start, end + 1);

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_10MB.length}` });
        if (isCrashPhase) {
          let offset = 0;
          const iv = setInterval(() => {
            if (offset >= slice.length) {
              clearInterval(iv);
              return res.end();
            }
            const next = Math.min(offset + 16384, slice.length);
            res.write(slice.subarray(offset, next));
            offset = next;
          }, 15);
          req.on('close', () => clearInterval(iv));
        } else {
          res.end(slice);
        }
      };

      const engine1 = new DownloadEngine(undefined, TEST_DIR);
      const item1 = await engine1.addDownload(`http://localhost:${TEST_PORT}/opt_crash.bin`, 'opt_crash.bin', TEST_DIR, 4);
      while (item1.downloadedBytes < PAYLOAD_10MB.length * 0.25) {
        await sleep(50);
      }
      const checkpoint = item1.downloadedBytes;
      engine1.destroy(); // Hard teardown

      isCrashPhase = false;
      const engine2 = new DownloadEngine(undefined, TEST_DIR);
      const item2 = engine2.downloads.get(item1.id);
      assert(item2 !== undefined && item2.status === 'paused', 'OPT-16a', `Crash recovery successfully restored checkpoint at ${(item2?.downloadedBytes || 0) / 1024} KB`);

      await engine2.resumeDownload(item1.id);
      while (item2!.status === 'downloading') await sleep(50);

      const downloadedHash = sha256File(item2!.destinationPath);
      assert(downloadedHash === HASH_10MB && item2!.status === 'completed', 'OPT-16b', 'Crash recovery download completed with exact SHA-256 match');
      engine2.destroy();
    }

    // -------------------------------------------------------------------------
    // OPT-17: Optimized dynamic scheduling produces zero range overlaps
    // -------------------------------------------------------------------------
    {
      const scheduler = new DynamicRangeScheduler(50 * 1024 * 1024, 4);
      // Simulate 10 successive steals
      for (let i = 0; i < 10; i++) {
        scheduler.stealWork(2 * 1024 * 1024);
      }
      const integrity = scheduler.validateRangeIntegrity();
      assert(integrity.isValid, 'OPT-17', 'Repeated intelligent steals maintain 100% gapless non-overlapping integrity');
    }

    // -------------------------------------------------------------------------
    // OPT-18: HTTP 429 pressure causes conservative concurrency scale-down
    // -------------------------------------------------------------------------
    {
      const controller = new AdaptiveConcurrencyController({ minWorkers: 2, maxWorkers: 16, initialWorkers: 8 });
      const action = controller.evaluate({
        activeWorkersCount: 8,
        hasServerThrottling: true,
        status429Count: 2,
      });
      assert(action === 'scale_down' && controller.getTargetWorkers() <= 6, 'OPT-18', 'HTTP 429 pressure scaled down concurrency to <= 6 workers');
    }

    // -------------------------------------------------------------------------
    // OPT-19: HTTP 503 pressure causes conservative concurrency
    // -------------------------------------------------------------------------
    {
      const controller = new AdaptiveConcurrencyController({ minWorkers: 2, maxWorkers: 16, initialWorkers: 6 });
      const action = controller.evaluate({
        activeWorkersCount: 6,
        status503Count: 3,
        hasRecentErrors: true,
      });
      assert(action === 'scale_down' && controller.getTargetWorkers() < 6, 'OPT-19', 'HTTP 503 pressure scaled down concurrency');
    }

    // -------------------------------------------------------------------------
    // OPT-20: Full optimization stack end-to-end download completes with SHA-256
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_10MB.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_10MB.length}` });
        res.end(PAYLOAD_10MB.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/full_opt_stack.bin`, 'full_opt_stack.bin', TEST_DIR, 8);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      const tele = engine.getDownloadTelemetry(item.id);
      assert(
        downloadedHash === HASH_10MB && item.status === 'completed' && tele !== null,
        'OPT-20',
        'Full optimization stack completed with exact SHA-256 and telemetry record'
      );
      engine.destroy();
    }

  } finally {
    server.close();
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n========================================================================');
  console.log(`OPTIMIZATION TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');
  if (failed > 0) process.exit(1);
}

runOptimizationTests().then(() => process.exit(0)).catch(err => {
  console.error('Fatal optimization test error:', err);
  process.exit(1);
});
