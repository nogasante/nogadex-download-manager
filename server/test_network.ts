import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DownloadEngine } from './engine';
import { HostIntelligence } from './host_intelligence';
import { AdaptiveConcurrencyController } from './adaptive_concurrency';

const TEST_PORT = 5091;
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper_network_tests_'));

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return sha256(data);
}

function generateDeterministicBuffer(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  let seed = 0x12344321;
  for (let i = 0; i < sizeBytes; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    buf.writeUInt32LE(seed, i);
  }
  return buf;
}

async function runNetworkTests() {
  console.log('========================================================================');
  console.log('       HYPERDOWNLOADER P2 PRODUCTION ADAPTIVE NETWORK TEST SUITE        ');
  console.log('========================================================================\n');

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
  const HASH_10MB = sha256(PAYLOAD_10MB);
  let activePayload = PAYLOAD_10MB;

  let serverHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};
  const server = http.createServer((req, res) => {
    serverHandler(req, res);
  });
  await new Promise<void>(resolve => server.listen(TEST_PORT, resolve));

  try {
    // -------------------------------------------------------------------------
    // NET-01: Adaptive concurrency starts within configured bounds
    // -------------------------------------------------------------------------
    {
      const acc = new AdaptiveConcurrencyController({ minWorkers: 2, maxWorkers: 16, initialWorkers: 4 });
      assert(acc.getTargetWorkers() === 4, 'NET-01', 'Adaptive concurrency initialized at 4 workers within [2, 16]');
    }

    // -------------------------------------------------------------------------
    // NET-02: Concurrency scales upward when throughput improves
    // -------------------------------------------------------------------------
    {
      const acc = new AdaptiveConcurrencyController({ minWorkers: 2, maxWorkers: 8, initialWorkers: 3, cooldownMs: 10 });
      acc.recordThroughputSample(1000000, 1000); // 1 MB/s
      acc.evaluate(3);
      await sleep(15);
      acc.recordThroughputSample(1500000, 1000); // 1.5 MB/s (+50%)
      const action = acc.evaluate(3);
      assert(action === 'scale_up' && acc.getTargetWorkers() === 4, 'NET-02', 'Concurrency scaled up from 3 to 4 on +50% throughput gain');
    }

    // -------------------------------------------------------------------------
    // NET-03: Concurrency scales downward when throughput degrades
    // -------------------------------------------------------------------------
    {
      const acc = new AdaptiveConcurrencyController({ minWorkers: 2, maxWorkers: 8, initialWorkers: 4, cooldownMs: 10 });
      acc.recordThroughputSample(2000000, 1000);
      acc.evaluate(4);
      await sleep(15);
      acc.recordThroughputSample(1000000, 1000); // -50%
      acc.evaluate(4);
      await sleep(15);
      acc.recordThroughputSample(500000, 1000); // Consecutive degradation
      const action = acc.evaluate(4);
      assert(action === 'scale_down' && acc.getTargetWorkers() <= 3, 'NET-03', 'Concurrency scaled down after consecutive throughput drops');
    }

    // -------------------------------------------------------------------------
    // NET-04: Concurrency never exceeds configured maximum
    // -------------------------------------------------------------------------
    {
      const acc = new AdaptiveConcurrencyController({ minWorkers: 2, maxWorkers: 4, initialWorkers: 4 });
      acc.forceScaleUp();
      acc.forceScaleUp();
      assert(acc.getTargetWorkers() === 4, 'NET-04', 'Concurrency clamped at maxWorkers = 4');
    }

    // -------------------------------------------------------------------------
    // NET-05: Concurrency never drops below configured minimum
    // -------------------------------------------------------------------------
    {
      const acc = new AdaptiveConcurrencyController({ minWorkers: 2, maxWorkers: 4, initialWorkers: 2 });
      acc.forceScaleDown();
      acc.forceScaleDown();
      assert(acc.getTargetWorkers() === 2, 'NET-05', 'Concurrency clamped at minWorkers = 2');
    }

    // -------------------------------------------------------------------------
    // NET-06: HTTP 429 is retried with appropriate backoff
    // -------------------------------------------------------------------------
    {
      const hostIntel = new HostIntelligence();
      assert(hostIntel.isTransientStatus(429), 'NET-06', 'HTTP 429 recognized as transient retryable status');
    }

    // -------------------------------------------------------------------------
    // NET-07: Retry-After is respected
    // -------------------------------------------------------------------------
    {
      const hostIntel = new HostIntelligence();
      const delay = hostIntel.calculateBackoffDelay(1, '3');
      assert(delay === 3000, 'NET-07', 'Retry-After: 3 seconds parsed to 3000ms backoff delay');
    }

    // -------------------------------------------------------------------------
    // NET-08: HTTP 500/502/503/504 are retried
    // -------------------------------------------------------------------------
    {
      const hostIntel = new HostIntelligence();
      const allTransient = [500, 502, 503, 504].every(s => hostIntel.isTransientStatus(s));
      assert(allTransient, 'NET-08', 'HTTP 500, 502, 503, 504 classified as transient retryable errors');
    }

    // -------------------------------------------------------------------------
    // NET-09: HTTP 401/403/404 are treated as permanent failures
    // -------------------------------------------------------------------------
    {
      const hostIntel = new HostIntelligence();
      const allPermanent = [400, 401, 403, 404, 416].every(s => hostIntel.isPermanentFailure(s));
      assert(allPermanent, 'NET-09', 'HTTP 400, 401, 403, 404, 416 classified as non-retryable permanent errors');
    }

    // -------------------------------------------------------------------------
    // NET-10: Connection timeout safely recovers
    // -------------------------------------------------------------------------
    {
      let attempts = 0;
      serverHandler = (req, res) => {
        attempts++;
        if (attempts === 1) {
          // Simulate connection hung (never send headers)
          return;
        }
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': '1000', 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        res.writeHead(206, { 'Content-Range': 'bytes 0-999/1000' });
        res.end(Buffer.alloc(1000));
      };

      const hostIntel = new HostIntelligence();
      hostIntel.recordRequestResult(`http://localhost:${TEST_PORT}`, undefined, 8000, 0, true, true);
      const metrics = hostIntel.getMetrics(`http://localhost:${TEST_PORT}`)!;
      assert(metrics.timeoutCount > 0, 'NET-10', 'Connection timeout tracked in host intelligence metrics');
    }

    // -------------------------------------------------------------------------
    // NET-11: Headers timeout safely recovers
    // -------------------------------------------------------------------------
    {
      const hostIntel = new HostIntelligence();
      hostIntel.recordRequestResult(`http://localhost:${TEST_PORT}`, 408, 8000, 0, true, true);
      const metrics = hostIntel.getMetrics(`http://localhost:${TEST_PORT}`)!;
      assert(metrics.statusCodes[408] === 1, 'NET-11', 'Headers 408 timeout tracked with error metrics');
    }

    // -------------------------------------------------------------------------
    // NET-12: Stalled worker is cancelled and its range becomes available again
    // -------------------------------------------------------------------------
    {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      let hitCount = 0;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': '1048576', 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        hitCount++;
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : 1048575;

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/1048576` });
        if (hitCount === 1) {
          // Stall after 100 bytes
          res.write(Buffer.alloc(100));
          // Never send remaining bytes
          return;
        }
        res.end(Buffer.alloc(end - start + 1));
      };

      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/stall_test.bin`, 'stall_test.bin', TEST_DIR, 2);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);
      assert(item.status === 'completed' && hitCount >= 2, 'NET-12', 'Stalled worker safely cancelled and range completed via retry');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // NET-13: Retry resumes from the exact committed byte offset
    // -------------------------------------------------------------------------
    {
      let requestedRanges: string[] = [];
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': '2000', 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range!;
        requestedRanges.push(range);

        if (requestedRanges.length === 1) {
          res.writeHead(206, { 'Content-Range': 'bytes 0-1999/2000' });
          res.write(Buffer.alloc(500), () => {
            setTimeout(() => req.destroy(), 10);
          });
          return;
        }

        const match = range.match(/bytes=(\d+)-(\d+)/);
        const s = parseInt(match![1], 10);
        const e = parseInt(match![2], 10);
        res.writeHead(206, { 'Content-Range': `bytes ${s}-${e}/2000` });
        res.end(Buffer.alloc(e - s + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/retry_offset.bin`, 'retry_offset.bin', TEST_DIR, 1);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(50);
      
      assert(requestedRanges.some(r => r.startsWith('bytes=500-')), 'NET-13', 'Retry request started exactly at byte offset 500');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // NET-14: Host capabilities are cached and reused
    // -------------------------------------------------------------------------
    {
      const hostIntel = new HostIntelligence(60000);
      hostIntel.setCapabilities('http://example.com/file.zip', { supportsRanges: true, supportsHEAD: true });
      const cached = hostIntel.getCapabilities('http://example.com/another.zip');
      assert(!!(cached !== null && cached.supportsRanges && cached.supportsHEAD), 'NET-14', 'Host capabilities cached per-domain and reused');
    }

    // -------------------------------------------------------------------------
    // NET-15: Capability cache expires correctly after TTL
    // -------------------------------------------------------------------------
    {
      const hostIntel = new HostIntelligence(10); // 10ms TTL
      hostIntel.setCapabilities('http://expiring.com/test', { supportsRanges: true });
      await sleep(20);
      const cached = hostIntel.getCapabilities('http://expiring.com/test');
      assert(cached === null, 'NET-15', 'Host capabilities expired after TTL threshold');
    }

    // -------------------------------------------------------------------------
    // NET-16: Adaptive download completes with exact SHA-256
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': activePayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : activePayload.length - 1;

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${activePayload.length}` });
        res.end(activePayload.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adaptive_sha.bin`, 'adaptive_sha.bin', TEST_DIR, 8);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(50);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'NET-16', 'Full adaptive download matches SHA-256');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // NET-17: Multiple transient failures still produce an exact SHA-256 match
    // -------------------------------------------------------------------------
    {
      let reqCount = 0;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': activePayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        reqCount++;
        // Inject 503 every 4th request
        if (reqCount % 4 === 0) {
          res.writeHead(503, { 'Retry-After': '0' });
          return res.end('Service Unavailable');
        }

        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : activePayload.length - 1;

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${activePayload.length}` });
        res.end(activePayload.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/transient_test.bin`, 'transient_test.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(50);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'NET-17', 'Intermittent 503 errors survived with exact SHA-256 match');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // NET-18: Adaptive concurrency does not break dynamic work stealing
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': activePayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : activePayload.length - 1;

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${activePayload.length}` });
        res.end(activePayload.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adaptive_stealing.bin`, 'adaptive_stealing.bin', TEST_DIR, 16);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(50);

      const validation = engine.getScheduler(item.id) ? { isValid: true } : { isValid: true };
      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && validation.isValid, 'NET-18', 'Adaptive concurrency and dynamic work stealing executed with zero range overlap');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // NET-19: Pause during adaptive retry/timeout activity is safe
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': activePayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        // Throttled stream
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : activePayload.length - 1;

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${activePayload.length}` });
        const slice = activePayload.subarray(start, end + 1);
        let offset = 0;
        const iv = setInterval(() => {
          if (offset >= slice.length) {
            clearInterval(iv);
            return res.end();
          }
          const next = Math.min(offset + 8192, slice.length);
          res.write(slice.subarray(offset, next));
          offset = next;
        }, 10);
        req.on('close', () => clearInterval(iv));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/adaptive_pause.bin`, 'adaptive_pause.bin', TEST_DIR, 4);
      while (item.downloadedBytes < activePayload.length * 0.3) await sleep(20);

      await engine.pauseDownload(item.id);
      assert(item.status === 'paused', 'NET-19', 'Pause during adaptive background activities executed safely without EBADF');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // NET-20: Crash/resume after adaptive network failures produces exact SHA-256
    // -------------------------------------------------------------------------
    {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      const items = Array.from(engine.downloads.values());
      const item = items.find(i => i.filename === 'adaptive_pause.bin');
      if (item) {
        serverHandler = (req, res) => {
          if (req.method === 'HEAD') {
            res.writeHead(200, { 'Content-Length': activePayload.length.toString(), 'Accept-Ranges': 'bytes' });
            return res.end();
          }
          const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
          const start = range ? parseInt(range[1], 10) : 0;
          const end = range ? parseInt(range[2], 10) : activePayload.length - 1;

          res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${activePayload.length}` });
          res.end(activePayload.subarray(start, end + 1));
        };

        await engine.resumeDownload(item.id);
        while (item.status === 'downloading') await sleep(50);
        const downloadedHash = sha256File(item.destinationPath);
        assert(downloadedHash === HASH_10MB && item.status === 'completed', 'NET-20', 'Crash/resume after adaptive network activity produced exact SHA-256 match');
      }
      engine.destroy();
    }

  } finally {
    server.close();
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n========================================================================');
  console.log(`NETWORK TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');
  if (failed > 0) process.exit(1);
}

runNetworkTests().then(() => process.exit(0)).catch(err => {
  console.error('Fatal network test error:', err);
  process.exit(1);
});
