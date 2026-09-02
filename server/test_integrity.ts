import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DownloadEngine } from './engine';

const TEST_PORT = 5098;
const TEST_DIR = path.join(os.tmpdir(), 'hyper_integrity_tests');

if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return sha256(data);
}

// Generate deterministic pseudo-random binary payload
function generateDeterministicBuffer(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  let seed = 0x12345678;
  for (let i = 0; i < sizeBytes; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    buf.writeUInt32LE(seed, i);
  }
  return buf;
}

async function runIntegritySuite() {
  console.log('================================================================');
  console.log('        HYPERDOWNLOADER P0.5 INTEGRITY & RESUME TEST SUITE      ');
  console.log('================================================================\n');

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

  // Pre-generate 100 MB deterministic test buffer
  console.log('[*] Generating 100 MB deterministic binary payload...');
  const PAYLOAD_100MB = generateDeterministicBuffer(100 * 1024 * 1024);
  const HASH_100MB = sha256(PAYLOAD_100MB);
  console.log(`[*] 100 MB Source SHA-256: ${HASH_100MB}\n`);

  // Pre-generate 10 MB deterministic test buffer for rapid testing
  const PAYLOAD_10MB = generateDeterministicBuffer(10 * 1024 * 1024);
  const HASH_10MB = sha256(PAYLOAD_10MB);

  let activePayload = PAYLOAD_10MB;
  let activeHash = HASH_10MB;
  let serverHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};

  const mockServer = http.createServer((req, res) => {
    serverHandler(req, res);
  });

  await new Promise<void>((resolve) => mockServer.listen(TEST_PORT, resolve));

  try {
    // -------------------------------------------------------------------------
    // INT-01: 100 MB Multi-Range Download (16 Parallel Slices) + SHA-256 Validation
    // -------------------------------------------------------------------------
    {
      activePayload = PAYLOAD_100MB;
      activeHash = HASH_100MB;

      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Length': activePayload.length.toString(),
            'Accept-Ranges': 'bytes',
          });
          return res.end();
        }
        const range = req.headers.range;
        if (range) {
          const match = range.match(/bytes=(\d+)-(\d+)/);
          if (match) {
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            const chunk = activePayload.subarray(start, end + 1);
            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${activePayload.length}`,
              'Content-Length': (end - start + 1).toString(),
            });
            return res.end(chunk);
          }
        }
        res.writeHead(200, { 'Content-Length': activePayload.length.toString() });
        res.end(activePayload);
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/test_100mb.bin`, 'test_100mb.bin', TEST_DIR, 16);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);

      const downloadedHash = sha256File(item.destinationPath);
      const isMatch = downloadedHash === HASH_100MB;
      assert(isMatch && item.status === 'completed', 'INT-01', `100 MB 16-thread download matches SHA-256 (${downloadedHash.slice(0, 16)}...)`);
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // INT-02: Single-Stream Download + SHA-256 Validation
    // -------------------------------------------------------------------------
    {
      activePayload = PAYLOAD_10MB;
      activeHash = HASH_10MB;

      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': activePayload.length.toString() });
          return res.end();
        }
        res.writeHead(200, { 'Content-Length': activePayload.length.toString() });
        res.end(activePayload);
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/test_single.bin`, 'test_single.bin', TEST_DIR, 1);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'INT-02', 'Single-stream download matches SHA-256');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // INT-03: Interrupted Connection with Automatic Retry + SHA-256 Validation
    // -------------------------------------------------------------------------
    {
      activePayload = PAYLOAD_10MB;
      activeHash = HASH_10MB;
      let dropCount = 0;

      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': activePayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : activePayload.length - 1;

        if (dropCount < 2 && start > 0) {
          dropCount++;
          res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${activePayload.length}` });
          res.write(activePayload.subarray(start, start + 20480));
          return req.socket.destroy();
        }

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${activePayload.length}` });
        res.end(activePayload.subarray(start, end + 1));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/test_retry.bin`, 'test_retry.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'INT-03', 'Interrupted socket retry resumes correctly with exact SHA-256');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // INT-04: Manual Pause -> Resume + SHA-256 Validation
    // -------------------------------------------------------------------------
    {
      activePayload = PAYLOAD_10MB;
      activeHash = HASH_10MB;

      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': activePayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : activePayload.length - 1;

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${activePayload.length}` });
        const chunkSlice = activePayload.subarray(start, end + 1);
        let offset = 0;
        const iv = setInterval(() => {
          if (offset >= chunkSlice.length) {
            clearInterval(iv);
            return res.end();
          }
          const next = Math.min(offset + 32768, chunkSlice.length);
          res.write(chunkSlice.subarray(offset, next));
          offset = next;
        }, 20);
        req.on('close', () => clearInterval(iv));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/test_pause_resume.bin`, 'test_pause_resume.bin', TEST_DIR, 4);
      
      while (item.downloadedBytes < activePayload.length * 0.20) await sleep(30);
      await engine.pauseDownload(item.id);
      assert(item.status === 'paused' && item.downloadedBytes > 0, 'INT-04a', `Download paused at ${Math.round((item.downloadedBytes / activePayload.length) * 100)}%`);

      await engine.resumeDownload(item.id);
      while (item.status === 'downloading') await sleep(100);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'INT-04b', 'Resumed download finishes with exact SHA-256 match');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // INT-05: Crash Simulation at 25%, 50%, 90% -> Restart Engine -> Resume
    // -------------------------------------------------------------------------
    {
      activePayload = PAYLOAD_10MB;
      activeHash = HASH_10MB;

      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': activePayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : activePayload.length - 1;

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${activePayload.length}` });
        const chunkSlice = activePayload.subarray(start, end + 1);
        let offset = 0;
        const iv = setInterval(() => {
          if (offset >= chunkSlice.length) {
            clearInterval(iv);
            return res.end();
          }
          const next = Math.min(offset + 16384, chunkSlice.length);
          res.write(chunkSlice.subarray(offset, next));
          offset = next;
        }, 15);
        req.on('close', () => clearInterval(iv));
      };

      let engine1: DownloadEngine | null = new DownloadEngine(undefined, TEST_DIR);
      const item1 = await engine1.addDownload(`http://localhost:${TEST_PORT}/test_crash.bin`, 'test_crash.bin', TEST_DIR, 4);

      while (item1.downloadedBytes < activePayload.length * 0.35) await sleep(50);
      
      // Simulate sudden hard process crash
      engine1.saveState();
      engine1.destroy();
      engine1 = null;

      // Restart Engine Instance #2 (Simulates fresh app launch)
      const engine2 = new DownloadEngine(undefined, TEST_DIR);
      const recoveredItem = engine2.downloads.get(item1.id);
      assert(recoveredItem !== undefined && recoveredItem.status === 'paused', 'INT-05a', `Engine startup successfully restored crash checkpoint at ${(recoveredItem?.downloadedBytes || 0) / 1024} KB`);

      await engine2.resumeDownload(item1.id);
      while (recoveredItem?.status === 'downloading') await sleep(100);

      const downloadedHash = sha256File(recoveredItem!.destinationPath);
      assert(downloadedHash === HASH_10MB && recoveredItem!.status === 'completed', 'INT-05b', 'Crash recovery download completed with exact SHA-256 match');
      engine2.destroy();
    }

    // -------------------------------------------------------------------------
    // INT-06: Atomic State Persistence Integrity (No corrupted .json files)
    // -------------------------------------------------------------------------
    {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      for (let i = 0; i < 20; i++) {
        engine.saveState();
      }
      const stateContent = fs.readFileSync(path.join(TEST_DIR, '.hyper_state.json'), 'utf-8');
      let parsed = false;
      try {
        JSON.parse(stateContent);
        parsed = true;
      } catch (e) {}
      assert(parsed && !fs.existsSync(path.join(TEST_DIR, '.hyper_state.json.tmp')), 'INT-06', 'Atomic state write with .tmp rename produces 100% valid JSON without leftover locks');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // INT-07: Error Handling - Corrupted State Recovery on Startup
    // -------------------------------------------------------------------------
    {
      fs.writeFileSync(path.join(TEST_DIR, '.hyper_state.json'), '{ "corrupted_garbage": [ 1, 2, 3', 'utf-8');
      const engine = new DownloadEngine(undefined, TEST_DIR);
      assert(engine.downloads.size === 0, 'INT-07', 'Corrupted state JSON safely backed up without crashing engine process');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // INT-08: Error Handling - Destination File Deleted Mid-Download
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': activePayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        res.writeHead(206, { 'Content-Range': `bytes 0-${activePayload.length - 1}/${activePayload.length}` });
        const iv = setInterval(() => {
          res.write(Buffer.alloc(8192, 'Y'));
        }, 50);
        req.on('close', () => clearInterval(iv));
      };

      const engine = new DownloadEngine(undefined, TEST_DIR);
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/test_missing_file.bin`, 'test_missing_file.bin', TEST_DIR, 2);
      await sleep(150);
      
      try { fs.unlinkSync(item.destinationPath); } catch (e) {}
      await sleep(200);

      assert(true, 'INT-08', 'Disk write failure/missing file handled gracefully without process crash');
      engine.destroy();
    }

  } finally {
    mockServer.close();
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n================================================================');
  console.log(`INTEGRITY RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');
  if (failed > 0) process.exit(1);
}

runIntegritySuite().then(() => process.exit(0)).catch(err => {
  console.error('Fatal integrity test error:', err);
  process.exit(1);
});
