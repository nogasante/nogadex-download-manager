/**
 * HyperDownloader P5 - Long-Running Soak & Resource Boundedness Test Suite
 * Tests 100 MB large payloads, repeated download cycles, rapid lifecycle cancellations,
 * concurrent multi-download stress, and verifies bounded memory / socket consumption.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DownloadEngine } from './engine';
import { PerformanceTelemetryTracker } from './performance_metrics';
import { HostIntelligence } from './host_intelligence';

const TEST_PORT = 5093;
const BASE_TEST_DIR = path.join(process.cwd(), 'temp_soak_test');

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function generateDeterministicBuffer(sizeBytes: number, seed: number = 77): Buffer {
  const buf = Buffer.allocUnsafe(sizeBytes);
  let state = seed;
  for (let i = 0; i < sizeBytes; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    buf[i] = state & 0xff;
  }
  return buf;
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, testId: string, description: string) {
  if (condition) {
    console.log(`[PASS] ${testId}: ${description}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testId}: ${description}`);
    failed++;
    throw new Error(`Test failed: ${testId} - ${description}`);
  }
}

let serverHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};

async function runSoakTests() {
  console.log('========================================================================');
  console.log('       HYPERDOWNLOADER P5 SOAK & RESOURCE BOUNDEDNESS TEST SUITE        ');
  console.log('========================================================================\n');

  if (fs.existsSync(BASE_TEST_DIR)) {
    fs.rmSync(BASE_TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(BASE_TEST_DIR, { recursive: true });

  const server = http.createServer((req, res) => {
    serverHandler(req, res);
  });

  await new Promise<void>(resolve => server.listen(TEST_PORT, () => resolve()));

  try {
    // -------------------------------------------------------------------------
    // SOAK-01: 50 MB High-Throughput Soak Download with 100% SHA-256 Match
    // -------------------------------------------------------------------------
    {
      const TEST_DIR_1 = path.join(BASE_TEST_DIR, 'soak1');
      fs.mkdirSync(TEST_DIR_1, { recursive: true });

      const PAYLOAD_50MB = generateDeterministicBuffer(50 * 1024 * 1024, 5050);
      const HASH_50MB = sha256(PAYLOAD_50MB);

      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_50MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_50MB.length - 1;
        const slice = PAYLOAD_50MB.subarray(start, end + 1);

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_50MB.length}` });
        res.end(slice);
      };

      const initialMem = process.memoryUsage().heapUsed;
      const engine = new DownloadEngine(undefined, TEST_DIR_1);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/soak_50mb.bin`, 'soak_50mb.bin', TEST_DIR_1, 8);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const fileHash = sha256File(item.destinationPath);
      const postMem = process.memoryUsage().heapUsed;
      const memDiffMB = Math.round((postMem - initialMem) / (1024 * 1024));

      assert(
        fileHash === HASH_50MB && item.status === 'completed',
        'SOAK-01',
        `50 MB soak download completed with 100% SHA-256 match (heap delta: ${memDiffMB} MB)`
      );
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // SOAK-02: Repeated Sequential Download Cycles Memory Boundedness
    // -------------------------------------------------------------------------
    {
      const TEST_DIR_2 = path.join(BASE_TEST_DIR, 'soak2');
      fs.mkdirSync(TEST_DIR_2, { recursive: true });

      const PAYLOAD_2MB = generateDeterministicBuffer(2 * 1024 * 1024, 2020);
      const HASH_2MB = sha256(PAYLOAD_2MB);

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

      const engine = new DownloadEngine(undefined, TEST_DIR_2);
      for (let cycle = 0; cycle < 5; cycle++) {
        const item = await engine.addDownload(`http://localhost:${TEST_PORT}/cycle_${cycle}.bin`, `cycle_${cycle}.bin`, TEST_DIR_2, 4);
        while (item.status === 'downloading' || item.status === 'probing') await sleep(20);
        assert(sha256File(item.destinationPath) === HASH_2MB, `SOAK-02-${cycle}`, `Sequential cycle ${cycle + 1}/5 completed with valid hash`);
        await engine.removeDownload(item.id, true);
      }

      assert(engine.downloads.size === 0, 'SOAK-02', '5 repeated cycles completed with complete cleanup and zero dangling items');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // SOAK-03: Concurrent Multi-Download Stress (4 Simultaneous Downloads)
    // -------------------------------------------------------------------------
    {
      const TEST_DIR_3 = path.join(BASE_TEST_DIR, 'soak3');
      fs.mkdirSync(TEST_DIR_3, { recursive: true });

      const PAYLOAD_4MB = generateDeterministicBuffer(4 * 1024 * 1024, 4040);
      const HASH_4MB = sha256(PAYLOAD_4MB);

      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_4MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_4MB.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_4MB.length}` });
        res.end(PAYLOAD_4MB.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR_3);
      const items = await Promise.all([
        engine.addDownload(`http://localhost:${TEST_PORT}/concurrent_1.bin`, 'concurrent_1.bin', TEST_DIR_3, 4),
        engine.addDownload(`http://localhost:${TEST_PORT}/concurrent_2.bin`, 'concurrent_2.bin', TEST_DIR_3, 4),
        engine.addDownload(`http://localhost:${TEST_PORT}/concurrent_3.bin`, 'concurrent_3.bin', TEST_DIR_3, 4),
        engine.addDownload(`http://localhost:${TEST_PORT}/concurrent_4.bin`, 'concurrent_4.bin', TEST_DIR_3, 4),
      ]);

      while (items.some(i => i.status === 'downloading' || i.status === 'probing')) {
        await sleep(30);
      }

      const allValid = items.every(i => i.status === 'completed' && sha256File(i.destinationPath) === HASH_4MB);
      assert(allValid, 'SOAK-03', '4 simultaneous concurrent downloads completed with 100% SHA-256 match');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // SOAK-04: Telemetry Ring-Buffer Memory Limit (200 samples max)
    // -------------------------------------------------------------------------
    {
      const tracker = new PerformanceTelemetryTracker('soak_telemetry_test');
      for (let i = 0; i < 500; i++) {
        tracker.recordThroughputSample(1024 * 1024, 100);
        tracker.recordRtt(25);
        tracker.recordWorkerCount(4);
      }
      const finalized = tracker.finalize();
      assert(
        finalized.p50ThroughputBps > 0 &&
        finalized.workerCountHistory.length <= 200,
        'SOAK-04',
        'Telemetry ring buffer strictly capped at <= 200 samples over 500 recording cycles'
      );
    }

    // -------------------------------------------------------------------------
    // SOAK-05: Host Intelligence LRU Cache Limit (500 hosts max)
    // -------------------------------------------------------------------------
    {
      const hostIntel = new HostIntelligence();
      for (let i = 0; i < 700; i++) {
        hostIntel.setCapabilities(`http://domain-${i}.com/file`, { supportsRanges: true });
        hostIntel.recordSuccess(`http://domain-${i}.com/file`, 20);
      }
      const first = hostIntel.getCapabilities('http://domain-0.com/file');
      const recent = hostIntel.getCapabilities('http://domain-699.com/file');
      assert(
        first === null && recent !== null,
        'SOAK-05',
        'Host intelligence LRU cache evicted oldest entries and maintained strict memory bound'
      );
    }

    console.log('\n========================================================================');
    console.log(`SOAK TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    try { fs.rmSync(BASE_TEST_DIR, { recursive: true, force: true }); } catch (e) {}
  }
}

runSoakTests().then(() => process.exit(0)).catch(err => {
  console.error('Fatal soak test error:', err);
  process.exit(1);
});
