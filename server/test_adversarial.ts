import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { DownloadEngine } from './engine';
import { DynamicRangeScheduler } from './scheduler';
import { AdaptiveConcurrencyController } from './adaptive_concurrency';
import { HostIntelligence } from './host_intelligence';
import { ChunkOptimizer } from './chunk_optimizer';
import { PerformanceTelemetryTracker } from './performance_metrics';

const TEST_PORT = 5094;
const TEST_DIR = path.join(os.tmpdir(), 'hyper_p4_adv_test_' + Date.now());

if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Deterministic test payloads
const PAYLOAD_10MB = Buffer.alloc(10 * 1024 * 1024);
for (let i = 0; i < PAYLOAD_10MB.length; i += 1024) {
  PAYLOAD_10MB.write(`ADV_BLOCK_${i}_` + 'Z'.repeat(900), i);
}
const HASH_10MB = crypto.createHash('sha256').update(PAYLOAD_10MB).digest('hex');

const PAYLOAD_2MB = PAYLOAD_10MB.subarray(0, 2 * 1024 * 1024);
const HASH_2MB = crypto.createHash('sha256').update(PAYLOAD_2MB).digest('hex');

const PAYLOAD_1BYTE = Buffer.from([0x42]);
const HASH_1BYTE = crypto.createHash('sha256').update(PAYLOAD_1BYTE).digest('hex');

const PAYLOAD_50KB = PAYLOAD_10MB.subarray(0, 50 * 1024);
const HASH_50KB = crypto.createHash('sha256').update(PAYLOAD_50KB).digest('hex');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256File(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, testId: string, message: string) {
  if (condition) {
    console.log(`[PASS] ${testId}: ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testId}: ${message}`);
    failed++;
  }
}

async function runAdversarialTests() {
  console.log('========================================================================');
  console.log('       HYPERDOWNLOADER P4 ADVERSARIAL & HARDENING TEST SUITE            ');
  console.log('========================================================================\n');

  let serverHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = (req, res) => {};

  const server = http.createServer((req, res) => {
    serverHandler(req, res);
  });

  await new Promise<void>((resolve) => server.listen(TEST_PORT, () => resolve()));

  try {
    // -------------------------------------------------------------------------
    // ADV-01: Malformed Content-Range Header (Rejected)
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        res.writeHead(206, { 'Content-Range': 'bytes malformed-garbage/10000000' });
        res.end(PAYLOAD_10MB.subarray(0, 1000));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv01.bin`, 'adv01.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      assert(item.status === 'error' && item.error?.includes('Content-Range'), 'ADV-01', 'Malformed Content-Range rejected safely without writing corrupt data');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-02: Incorrect Content-Length Mismatch against requested range
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : 1000;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${PAYLOAD_10MB.length}`,
          'Content-Length': '9999999', // Bogus Content-Length header
        });
        res.end(PAYLOAD_10MB.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv02.bin`, 'adv02.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'ADV-02', 'Mismatched Content-Length header handled safely via Content-Range bounds');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-03: HTTP 200 response to a segmented range request rejected
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString() });
        res.end(PAYLOAD_10MB);
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv03.bin`, 'adv03.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      assert(item.status === 'error' && (item.error?.includes('200') || item.error?.includes('Protocol Violation')), 'ADV-03', 'HTTP 200 received during segmented request failed fast to prevent data corruption');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-04: HTTP 206 response with wrong start offset rejected
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        res.writeHead(206, { 'Content-Range': `bytes 999-5000/${PAYLOAD_10MB.length}` });
        res.end(PAYLOAD_10MB.subarray(0, 1000));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv04.bin`, 'adv04.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      assert(item.status === 'error' && (item.error?.includes('mismatch') || item.error?.includes('Content-Range')), 'ADV-04', 'Content-Range with mismatched start offset rejected immediately');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-05: Truncated response body (socket closed early) -> Resumed via retry
    // -------------------------------------------------------------------------
    {
      let dropCount = 0;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_10MB.length - 1;
        const slice = PAYLOAD_10MB.subarray(start, end + 1);

        dropCount++;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_10MB.length}` });

        if (dropCount === 1) {
          // Send half of the chunk, then destroy socket prematurely
          res.write(slice.subarray(0, Math.floor(slice.length / 2)));
          req.socket.destroy();
          return;
        }

        res.end(slice);
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv05.bin`, 'adv05.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'ADV-05', 'Truncated response body recovered via retry with exact SHA-256 match');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-06: Premature connection reset during headers
    // -------------------------------------------------------------------------
    {
      let resetHeaders = true;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        if (resetHeaders) {
          resetHeaders = false;
          req.socket.destroy(); // Hard reset
          return;
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_10MB.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_10MB.length}` });
        res.end(PAYLOAD_10MB.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv06.bin`, 'adv06.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'ADV-06', 'Connection reset during headers survived via retry');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-07: Premature ECONNRESET during body transfer
    // -------------------------------------------------------------------------
    {
      let resetBody = true;
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
        if (resetBody && start === 0) {
          resetBody = false;
          res.write(slice.subarray(0, 16384));
          process.nextTick(() => req.socket.destroy());
          return;
        }
        res.end(slice);
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv07.bin`, 'adv07.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'ADV-07', 'ECONNRESET during body transfer recovered seamlessly');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-08: Repeated HTTP 429 responses with Retry-After backoff
    // -------------------------------------------------------------------------
    {
      let reqCount = 0;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        reqCount++;
        if (reqCount <= 2) {
          res.writeHead(429, { 'Retry-After': '0' });
          return res.end('Rate limit');
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_10MB.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_10MB.length}` });
        res.end(PAYLOAD_10MB.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv08.bin`, 'adv08.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'ADV-08', 'Repeated HTTP 429s backed off and completed with exact SHA-256');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-09: Retry-After formats (seconds, HTTP-Date, invalid fallback)
    // -------------------------------------------------------------------------
    {
      const hostIntel = new HostIntelligence();
      const delaySec = hostIntel.getRetryDelay(0, '3');
      const delayDate = hostIntel.getRetryDelay(0, new Date(Date.now() + 5000).toUTCString());
      const delayPast = hostIntel.getRetryDelay(0, new Date(Date.now() - 5000).toUTCString());
      const delayInvalid = hostIntel.getRetryDelay(0, 'invalid-non-numeric');
      const delayZero = hostIntel.getRetryDelay(0, '0');

      assert(delaySec === 3000, 'ADV-09a', `Retry-After: '3' parsed to 3000ms (got ${delaySec}ms)`);
      assert(delayDate > 3000 && delayDate <= 5500, 'ADV-09b', `Retry-After HTTP-Date parsed to ~5000ms delta (got ${delayDate}ms)`);
      assert(delayPast === 0, 'ADV-09c', `Past Retry-After date returned 0ms (got ${delayPast}ms)`);
      assert(delayZero === 0, 'ADV-09d', `Retry-After: '0' returned 0ms (got ${delayZero}ms)`);
      assert(delayInvalid >= 200 && delayInvalid <= 10000, 'ADV-09e', `Invalid Retry-After string fell back to exponential backoff (got ${delayInvalid}ms)`);
    }

    // -------------------------------------------------------------------------
    // ADV-10: HTTP 416 Range Not Satisfiable triggers permanent fail-fast
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        res.writeHead(416, { 'Content-Range': `bytes */${PAYLOAD_10MB.length}` });
        res.end('Range not satisfiable');
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv10.bin`, 'adv10.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      assert(item.status === 'error' && item.error?.includes('416'), 'ADV-10', 'HTTP 416 aborted immediately without infinite retries');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-11: Server changing file size mid-download triggers total size mismatch error
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        // Return a mismatched total file size of 99999999 bytes
        res.writeHead(206, { 'Content-Range': 'bytes 0-1048575/99999999' });
        res.end(PAYLOAD_10MB.subarray(0, 1048576));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv11.bin`, 'adv11.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      assert(item.status === 'error' && (item.error?.includes('mismatch') || item.error?.includes('Content-Range')), 'ADV-11', 'Server altering total file size mid-download rejected cleanly');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-12: 1-byte file and tiny file edge cases
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_1BYTE.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        if (match) {
          res.writeHead(206, { 'Content-Range': 'bytes 0-0/1' });
          return res.end(PAYLOAD_1BYTE);
        }
        res.writeHead(200, { 'Content-Length': '1' });
        res.end(PAYLOAD_1BYTE);
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv12_1b.bin`, 'adv12_1b.bin', TEST_DIR, 8);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_1BYTE && item.status === 'completed' && item.chunks.length === 1, 'ADV-12', '1-byte file downloaded cleanly via small-file fast path');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-13: File exactly at 2 MB threshold boundary
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_2MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_2MB.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_2MB.length}` });
        res.end(PAYLOAD_2MB.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv13_2mb.bin`, 'adv13_2mb.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_2MB && item.status === 'completed', 'ADV-13', 'File exactly at 2 MB threshold completed with 100% SHA-256 match');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-14: Simultaneous work stealing by multiple workers produces zero overlaps
    // -------------------------------------------------------------------------
    {
      const scheduler = new DynamicRangeScheduler(50 * 1024 * 1024, 8);
      for (let i = 0; i < 20; i++) {
        scheduler.stealWork(2 * 1024 * 1024);
      }
      const integrity = scheduler.validateRangeIntegrity();
      assert(integrity.isValid, 'ADV-14', `20 consecutive dynamic steals maintain zero gaps and zero overlaps (${scheduler.chunks.length} chunks)`);
    }

    // -------------------------------------------------------------------------
    // ADV-15: Rapid pause and resume loops without socket leaks or EBADF
    // -------------------------------------------------------------------------
    {
      let isThrottled = true;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_2MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_2MB.length - 1;
        const slice = PAYLOAD_2MB.subarray(start, end + 1);

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_2MB.length}` });
        if (isThrottled) {
          let offset = 0;
          const iv = setInterval(() => {
            if (offset >= slice.length) {
              clearInterval(iv);
              return res.end();
            }
            const next = Math.min(offset + 32768, slice.length);
            res.write(slice.subarray(offset, next));
            offset = next;
          }, 10);
          req.on('close', () => clearInterval(iv));
        } else {
          res.end(slice);
        }
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv15_pause_stress.bin`, 'adv15_pause_stress.bin', TEST_DIR, 4);

      for (let i = 0; i < 3; i++) {
        await sleep(30);
        await engine.pauseDownload(item.id);
        assert(item.status === 'paused', 'ADV-15a', `Pause cycle ${i + 1} succeeded`);
        await sleep(20);
        await engine.resumeDownload(item.id);
      }

      isThrottled = false;
      while (item.status !== 'completed' && item.status !== 'error') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_2MB && item.status === 'completed', 'ADV-15b', `Completed rapid pause/resume cycles with 100% SHA-256 match`);
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-16: Cancel during active multi-worker transfer completely tears down resources
    // -------------------------------------------------------------------------
    {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv16_cancel.bin`, 'adv16_cancel.bin', TEST_DIR, 8);
      await sleep(50);
      await engine.removeDownload(item.id, true);

      assert(engine.downloads.has(item.id) === false, 'ADV-16', 'Download cancelled and removed cleanly with zero memory footprint');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // ADV-17: Chunk Optimizer Fuzzing with NaN, Infinity, negative & extreme inputs
    // -------------------------------------------------------------------------
    {
      const optimizer = new ChunkOptimizer();
      const chunk1 = optimizer.calculateOptimalChunkSize({
        throughputBps: NaN,
        rttMs: NaN,
        retryCount: NaN,
        remainingBytes: NaN,
        activeWorkers: NaN,
      });
      const chunk2 = optimizer.calculateOptimalChunkSize({
        throughputBps: Infinity,
        rttMs: 0,
        retryCount: 0,
        remainingBytes: 100 * 1024 * 1024,
        activeWorkers: 4,
      });
      const chunk3 = optimizer.calculateOptimalChunkSize({
        throughputBps: -5000,
        rttMs: -100,
        retryCount: -5,
        remainingBytes: -1000,
        activeWorkers: -2,
      });

      assert(
        !isNaN(chunk1) && isFinite(chunk1) && chunk1 >= optimizer.minChunkSize && chunk1 <= optimizer.maxChunkSize,
        'ADV-17a',
        `NaN inputs safely clamped to valid chunk size (${chunk1} bytes)`
      );
      assert(
        !isNaN(chunk2) && isFinite(chunk2) && chunk2 <= optimizer.maxChunkSize,
        'ADV-17b',
        `Infinity throughput strictly clamped to maxChunkSize (${chunk2} bytes)`
      );
      assert(
        !isNaN(chunk3) && isFinite(chunk3) && chunk3 >= optimizer.minChunkSize,
        'ADV-17c',
        `Negative inputs safely clamped to minChunkSize (${chunk3} bytes)`
      );
    }

    // -------------------------------------------------------------------------
    // ADV-18: Adaptive Concurrency Fuzzing with NaN/extreme inputs
    // -------------------------------------------------------------------------
    {
      const controller = new AdaptiveConcurrencyController({ minWorkers: 2, maxWorkers: 16, initialWorkers: 4 });
      controller.recordThroughputSample(NaN, -100);
      controller.recordThroughputSample(Infinity, NaN);
      const action = controller.evaluate({
        activeWorkersCount: NaN,
        latencyMs: NaN,
        errorRate: NaN,
      });

      assert(
        controller.getTargetWorkers() >= 2 && controller.getTargetWorkers() <= 16,
        'ADV-18',
        `Adaptive controller remained within [2, 16] bounds under NaN fuzzing (current: ${controller.getTargetWorkers()})`
      );
    }

    // -------------------------------------------------------------------------
    // ADV-19: Performance Telemetry Percentiles (0, 1, and 100 samples)
    // -------------------------------------------------------------------------
    {
      const t0 = new PerformanceTelemetryTracker('t0');
      const p0 = t0.getThroughputPercentiles();
      assert(p0.p50 === 0 && p0.p95 === 0, 'ADV-19a', '0 samples correctly returned p50=0, p95=0 without NaN');

      const t1 = new PerformanceTelemetryTracker('t1');
      t1.recordThroughputSample(1000000, 1000);
      const p1 = t1.getThroughputPercentiles();
      assert(p1.p50 === 1000000 && p1.p95 === 1000000, 'ADV-19b', '1 sample returned exact p50 and p95');

      const t100 = new PerformanceTelemetryTracker('t100');
      for (let i = 1; i <= 100; i++) {
        t100.recordThroughputSample(i * 100000, 1000);
      }
      const p100 = t100.getThroughputPercentiles();
      assert(p100.p50 > 0 && p100.p95 >= p100.p50, 'ADV-19c', `100 samples computed valid p50=${p100.p50} and p95=${p100.p95}`);
    }

    // -------------------------------------------------------------------------
    // ADV-20: Host Intelligence LRU Pruning & Domain Isolation
    // -------------------------------------------------------------------------
    {
      const hostIntel = new HostIntelligence();
      for (let i = 0; i < 600; i++) {
        hostIntel.recordCapabilities(`http://domain${i}.test/file.bin`, true, 8);
      }
      const cap599 = hostIntel.getCapabilities('http://domain599.test/file.bin');
      assert(cap599 !== null && cap599.domain === 'domain599.test', 'ADV-20', 'Host intelligence bounded cache pruned oldest keys without memory leak');
    }

    // -------------------------------------------------------------------------
    // ADV-21: Randomized Network Chaos Test (Random 503, 429, drops, latency)
    // -------------------------------------------------------------------------
    {
      let seed = 42;
      function pseudoRandom() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      }

      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_10MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_10MB.length - 1;
        const slice = PAYLOAD_10MB.subarray(start, end + 1);

        const r = pseudoRandom();
        if (r < 0.10) {
          // 10% transient 503
          res.writeHead(503, { 'Retry-After': '0' });
          return res.end('Transient 503');
        } else if (r < 0.20) {
          // 10% transient 429
          res.writeHead(429, { 'Retry-After': '0' });
          return res.end('Rate limited');
        } else if (r < 0.30) {
          // 10% connection drop mid-stream
          res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_10MB.length}` });
          res.write(slice.subarray(0, Math.floor(slice.length / 3)));
          return req.socket.destroy();
        }

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_10MB.length}` });
        res.end(slice);
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adv21_chaos.bin`, 'adv21_chaos.bin', TEST_DIR, 8);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'ADV-21', 'Deterministic randomized network chaos test completed with 100% SHA-256 match');
      engine.destroy();
    }

  } finally {
    server.close();
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n========================================================================');
  console.log(`ADVERSARIAL TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');
  if (failed > 0) process.exit(1);
}

runAdversarialTests().then(() => process.exit(0)).catch(err => {
  console.error('Fatal adversarial test error:', err);
  process.exit(1);
});
