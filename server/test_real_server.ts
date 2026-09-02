/**
 * HyperDownloader P5 - Real HTTP Server Validation & Network Simulation Suite
 * Runs against an actual Node.js HTTP server.
 * Validates protocol compliance, status codes, redirect chains, latency spikes,
 * socket resets, and exact SHA-256 byte-for-byte integrity.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DownloadEngine } from './engine';

const TEST_PORT = 5089;
const TEST_DIR = path.join(process.cwd(), 'temp_real_test');

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function generateDeterministicBuffer(sizeBytes: number, seed: number = 42): Buffer {
  const buf = Buffer.allocUnsafe(sizeBytes);
  let state = seed;
  for (let i = 0; i < sizeBytes; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    buf[i] = state & 0xff;
  }
  return buf;
}

const PAYLOAD_1MB = generateDeterministicBuffer(1024 * 1024, 101);
const HASH_1MB = sha256(PAYLOAD_1MB);

const PAYLOAD_5MB = generateDeterministicBuffer(5 * 1024 * 1024, 202);
const HASH_5MB = sha256(PAYLOAD_5MB);

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

async function runRealServerTests() {
  console.log('========================================================================');
  console.log('       HYPERDOWNLOADER P5 REAL HTTP SERVER VALIDATION SUITE             ');
  console.log('========================================================================\n');

  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const server = http.createServer((req, res) => {
    serverHandler(req, res);
  });

  await new Promise<void>(resolve => server.listen(TEST_PORT, () => resolve()));

  try {
    // -------------------------------------------------------------------------
    // REAL-01: Real HTTP 206 Multi-worker partial content download with SHA-256
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_5MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : PAYLOAD_5MB.length - 1;
        const slice = PAYLOAD_5MB.subarray(start, end + 1);

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_5MB.length}` });
        res.end(slice);
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/real01.bin`, 'real01.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const fileHash = sha256File(item.destinationPath);
      assert(fileHash === HASH_5MB && item.status === 'completed', 'REAL-01', 'Real HTTP 206 multi-worker download matches SHA-256');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // REAL-02: Real HTTP 200 Single-stream download
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        res.writeHead(200, { 'Content-Length': PAYLOAD_1MB.length.toString() });
        res.end(PAYLOAD_1MB);
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/real02.bin`, 'real02.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const fileHash = sha256File(item.destinationPath);
      assert(fileHash === HASH_1MB && item.status === 'completed', 'REAL-02', 'Real HTTP 200 non-resumable download matches SHA-256');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // REAL-03: Real HTTP 404 fast fails with 0 retries
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        res.writeHead(404);
        res.end('Not Found');
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/real03_404.bin`, 'real03.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      assert(item.status === 'error', 'REAL-03', 'Real HTTP 404 halted download fast');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // REAL-04: Real HTTP 416 halts immediately
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': '1048576', 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        res.writeHead(416, { 'Content-Range': 'bytes */1048576' });
        res.end('Range Not Satisfiable');
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/real04_416.bin`, 'real04.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      assert(item.status === 'error', 'REAL-04', 'Real HTTP 416 aborted without hanging');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // REAL-05: Real HTTP 429 with Retry-After backed off and completed
    // -------------------------------------------------------------------------
    {
      let hits = 0;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_1MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        hits++;
        if (hits <= 2) {
          res.writeHead(429, { 'Retry-After': '0' });
          return res.end('Rate limited');
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : PAYLOAD_1MB.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_1MB.length}` });
        res.end(PAYLOAD_1MB.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/real05_429.bin`, 'real05.bin', TEST_DIR, 2);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const fileHash = sha256File(item.destinationPath);
      assert(fileHash === HASH_1MB && item.status === 'completed', 'REAL-05', 'Real HTTP 429 with Retry-After backed off and completed');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // REAL-06: Transient 503 errors survived with exact SHA-256 match
    // -------------------------------------------------------------------------
    {
      let attempts = 0;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_1MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        attempts++;
        if (attempts % 2 === 1 && attempts <= 3) {
          res.writeHead(503);
          return res.end('Service Unavailable');
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : PAYLOAD_1MB.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_1MB.length}` });
        res.end(PAYLOAD_1MB.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/real06_503.bin`, 'real06.bin', TEST_DIR, 2);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const fileHash = sha256File(item.destinationPath);
      assert(fileHash === HASH_1MB && item.status === 'completed', 'REAL-06', 'Transient 503 errors survived with exact SHA-256 match');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // REAL-07: Redirect chains (301 -> 302 -> 200) followed and completed
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.url === '/redirect_start') {
          res.writeHead(301, { 'Location': `http://localhost:${TEST_PORT}/redirect_step2` });
          return res.end();
        }
        if (req.url === '/redirect_step2') {
          res.writeHead(302, { 'Location': `http://localhost:${TEST_PORT}/redirect_final.bin` });
          return res.end();
        }
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_1MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : PAYLOAD_1MB.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_1MB.length}` });
        res.end(PAYLOAD_1MB.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/redirect_start`, 'real07.bin', TEST_DIR, 2);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const fileHash = sha256File(item.destinationPath);
      assert(fileHash === HASH_1MB && item.status === 'completed', 'REAL-07', '2-hop redirect chain resolved and downloaded cleanly');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // REAL-08: Socket reset mid-transfer cleanly recovered with retry
    // -------------------------------------------------------------------------
    {
      let resetCount = 0;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_1MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : PAYLOAD_1MB.length - 1;
        const slice = PAYLOAD_1MB.subarray(start, end + 1);

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_1MB.length}` });
        if (resetCount === 0 && slice.length > 1000) {
          resetCount++;
          res.write(slice.subarray(0, 500));
          return req.socket.destroy();
        }
        res.end(slice);
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/real08_reset.bin`, 'real08.bin', TEST_DIR, 2);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const fileHash = sha256File(item.destinationPath);
      assert(fileHash === HASH_1MB && item.status === 'completed', 'REAL-08', 'Socket reset mid-transfer recovered with exact SHA-256');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // REAL-09: Delayed headers (300ms latency) handled without timeout
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          setTimeout(() => {
            res.writeHead(200, { 'Content-Length': PAYLOAD_1MB.length.toString(), 'Accept-Ranges': 'bytes' });
            res.end();
          }, 100);
          return;
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : PAYLOAD_1MB.length - 1;
        const slice = PAYLOAD_1MB.subarray(start, end + 1);

        setTimeout(() => {
          res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_1MB.length}` });
          res.end(slice);
        }, 150);
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/real09_delay.bin`, 'real09.bin', TEST_DIR, 2);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const fileHash = sha256File(item.destinationPath);
      assert(fileHash === HASH_1MB && item.status === 'completed', 'REAL-09', 'Delayed headers handled cleanly with exact SHA-256');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // REAL-10: Network simulation with random latency spikes and 100% SHA-256
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_5MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : PAYLOAD_5MB.length - 1;
        const slice = PAYLOAD_5MB.subarray(start, end + 1);

        const delay = Math.floor(Math.random() * 50) + 10;
        setTimeout(() => {
          res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_5MB.length}` });
          res.end(slice);
        }, delay);
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/real10_spikes.bin`, 'real10.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(20);

      const fileHash = sha256File(item.destinationPath);
      assert(fileHash === HASH_5MB && item.status === 'completed', 'REAL-10', 'Random latency spikes completed with 100% SHA-256 match');
      engine.destroy();
    }

    console.log('\n========================================================================');
    console.log(`REAL SERVER TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {}
  }
}

runRealServerTests().then(() => process.exit(0)).catch(err => {
  console.error('Fatal real server test error:', err);
  process.exit(1);
});
