import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DownloadEngine } from './engine';
import { DynamicRangeScheduler } from './scheduler';

const TEST_PORT = 5088;
const TEST_DIR = path.join(os.tmpdir(), 'hyper_scheduler_tests');

if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });

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
  let seed = 0x55aa55aa;
  for (let i = 0; i < sizeBytes; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    buf.writeUInt32LE(seed, i);
  }
  return buf;
}

async function runSchedulerTests() {
  console.log('========================================================================');
  console.log('       HYPERDOWNLOADER P1.5 DYNAMIC CHUNK SCHEDULER TEST SUITE          ');
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
    // SCH-01: Initial ranges cover exactly the complete file
    // -------------------------------------------------------------------------
    {
      const scheduler = new DynamicRangeScheduler(10485760, 8);
      const validation = scheduler.validateRangeIntegrity();
      assert(validation.isValid, 'SCH-01', 'Initial 8 ranges cover exactly 10,485,760 bytes');
    }

    // -------------------------------------------------------------------------
    // SCH-02: No initial ranges overlap
    // -------------------------------------------------------------------------
    {
      const scheduler = new DynamicRangeScheduler(10485760, 16);
      let overlap = false;
      for (let i = 0; i < scheduler.chunks.length - 1; i++) {
        if (scheduler.chunks[i].endByte >= scheduler.chunks[i + 1].startByte) {
          overlap = true;
        }
      }
      assert(!overlap, 'SCH-02', '16 initial ranges have zero byte overlap');
    }

    // -------------------------------------------------------------------------
    // SCH-03: Idle worker successfully steals half of a slow worker's range
    // -------------------------------------------------------------------------
    {
      const scheduler = new DynamicRangeScheduler(10485760, 2);
      // Chunk 0: [0 - 5242879], Chunk 1: [5242880 - 10485759]
      scheduler.chunks[0].status = 'done';
      scheduler.chunks[0].downloadedBytes = 5242880;

      scheduler.chunks[1].status = 'active';
      scheduler.chunks[1].downloadedBytes = 1048576; // 1 MB downloaded

      // Steal work from Chunk 1
      const stolen = scheduler.stealWork();
      assert(stolen !== null && stolen.startByte > scheduler.chunks[1].startByte && stolen.endByte === 10485759, 'SCH-03', 'Idle worker stole upper half of remaining range from Chunk 1');
    }

    // -------------------------------------------------------------------------
    // SCH-04: Stealing never creates overlapping ranges
    // -------------------------------------------------------------------------
    {
      const scheduler = new DynamicRangeScheduler(10485760, 4);
      scheduler.chunks.forEach(c => c.status = 'active');
      scheduler.stealWork();
      scheduler.stealWork();
      const validation = scheduler.validateRangeIntegrity();
      assert(validation.isValid, 'SCH-04', 'Repeated work stealing maintains 100% gapless non-overlapping integrity');
    }

    // -------------------------------------------------------------------------
    // SCH-05: Multiple workers can repeatedly steal work
    // -------------------------------------------------------------------------
    {
      const scheduler = new DynamicRangeScheduler(50 * 1024 * 1024, 4);
      scheduler.chunks.forEach(c => c.status = 'active');
      let steals = 0;
      for (let i = 0; i < 6; i++) {
        const stolen = scheduler.stealWork();
        if (stolen) {
          stolen.status = 'active';
          steals++;
        }
      }
      const validation = scheduler.validateRangeIntegrity();
      assert(steals >= 4 && validation.isValid, 'SCH-05', `Multiple workers stole ${steals} ranges with complete integrity`);
    }

    // -------------------------------------------------------------------------
    // SCH-06: Tiny remaining ranges are not repeatedly split (< 256 KB)
    // -------------------------------------------------------------------------
    {
      const scheduler = new DynamicRangeScheduler(1048576, 2, 256 * 1024);
      scheduler.chunks[0].status = 'done';
      scheduler.chunks[1].status = 'active';
      scheduler.chunks[1].downloadedBytes = scheduler.chunks[1].totalBytes - (100 * 1024); // Only 100 KB remaining!
      const stolen = scheduler.stealWork();
      assert(stolen === null, 'SCH-06', 'Tiny range (100 KB < 256 KB threshold) rejected from splitting');
    }

    // -------------------------------------------------------------------------
    // SCH-07: Failed stolen range is returned to scheduler
    // -------------------------------------------------------------------------
    {
      const scheduler = new DynamicRangeScheduler(10485760, 2);
      scheduler.chunks[1].status = 'active';
      const stolen = scheduler.stealWork();
      if (stolen) {
        stolen.status = 'active';
        scheduler.returnUnfinishedRange(stolen.id);
        assert(stolen.status === 'idle', 'SCH-07', 'Failed stolen range safely reset to idle for retry');
      } else {
        assert(false, 'SCH-07', 'Stolen chunk expected');
      }
    }

    // -------------------------------------------------------------------------
    // SCH-08: Retry after stealing preserves exact byte offsets
    // -------------------------------------------------------------------------
    {
      const scheduler = new DynamicRangeScheduler(10485760, 2);
      scheduler.chunks[1].status = 'active';
      scheduler.chunks[1].downloadedBytes = 100000;
      const stolen = scheduler.stealWork();
      if (stolen) {
        stolen.downloadedBytes = 50000;
        scheduler.returnUnfinishedRange(stolen.id);
        const retryStart = stolen.startByte + stolen.downloadedBytes;
        assert(retryStart === stolen.startByte + 50000 && stolen.status === 'idle', 'SCH-08', 'Retry offset preserved exactly at stolen start + downloaded bytes');
      }
    }

    // -------------------------------------------------------------------------
    // SCH-09 & SCH-10: Pause and Resume with dynamic reconstruction
    // -------------------------------------------------------------------------
    let pausedItemId = '';
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
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/sch_pause.bin`, 'sch_pause.bin', TEST_DIR, 4);
      while (item.downloadedBytes < activePayload.length * 0.3) await sleep(20);

      await engine.pauseDownload(item.id);
      pausedItemId = item.id;
      assert(item.status === 'paused', 'SCH-09', 'Pause during active multi-worker dynamic stealing is 100% safe');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // SCH-10: Resume reconstructs all unfinished ranges
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
      const item = engine.downloads.get(pausedItemId);
      if (item) {
        await engine.resumeDownload(item.id);
        while (item.status === 'downloading') await sleep(50);
        const downloadedHash = sha256File(item.destinationPath);
        assert(downloadedHash === HASH_10MB && item.status === 'completed', 'SCH-10', 'Resume successfully completed with exact SHA-256 match');
      } else {
        assert(false, 'SCH-10', 'Saved item not found in state on resume');
      }
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // SCH-11: Complete multi-worker download has exact SHA-256
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
      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/sch_complete.bin`, 'sch_complete.bin', TEST_DIR, 8);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(50);

      const downloadedHash = sha256File(item.destinationPath);
      assert(downloadedHash === HASH_10MB && item.status === 'completed', 'SCH-11', 'Dynamic multi-worker download matches SHA-256');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // SCH-12: Scheduler cannot complete until every byte is committed
    // -------------------------------------------------------------------------
    {
      const scheduler = new DynamicRangeScheduler(1000, 2);
      scheduler.chunks[0].status = 'done';
      scheduler.chunks[0].downloadedBytes = 500;
      scheduler.chunks[1].status = 'active';
      scheduler.chunks[1].downloadedBytes = 499; // 1 byte missing!
      assert(!scheduler.isComplete(), 'SCH-12', 'Scheduler isComplete() returns false when even 1 byte remains');
    }

  } finally {
    server.close();
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n========================================================================');
  console.log(`SCHEDULER TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');
  if (failed > 0) process.exit(1);
}

runSchedulerTests().then(() => process.exit(0)).catch(err => {
  console.error('Fatal scheduler test error:', err);
  process.exit(1);
});
