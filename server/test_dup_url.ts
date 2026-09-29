import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DownloadEngine } from './engine';

/**
 * Phase 10.7 — Duplicate URL / File-Preservation Guarantees
 *
 * DUP-01  Re-adding a URL whose row is COMPLETED returns that row (skip):
 *         row count unchanged, file on disk byte-identical, no truncation.
 * DUP-02  Re-adding a URL whose row is DOWNLOADING/PROBING returns that row:
 *         still exactly one active pipeline for it.
 * DUP-03  Re-adding a URL whose row is PAUSED returns that row untouched
 *         (skip semantics; resume stays an explicit user action).
 * DUP-04  Re-adding an ERRORED URL retries the existing row (no new row) and
 *         completes with an exact SHA-256 match.
 * DUP-05  Two different URLs with the same desired filename write to two
 *         distinct paths ("name (1).ext") — no shared-path double-write.
 * DUP-06  A probe (Content-Disposition) rename never lands on a path owned
 *         by another row; both rows complete byte-exact.
 * DUP-07  Case-different re-add of the same URL is still deduped.
 */

const TEST_PORT = 5098;
const TEST_DIR = path.join(os.tmpdir(), 'hyper_dup_url_tests');

// Fresh sandbox per run: stale rows/files from earlier runs would corrupt
// row-count and path assertions.
fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(TEST_DIR, { recursive: true });

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath: string): string {
  return sha256(fs.readFileSync(filePath));
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

let passed = 0;
let failed = 0;

function assert(cond: any, id: string, msg: string) {
  if (cond) {
    console.log(`[PASS] ${id}: ${msg}`);
    passed++;
  } else {
    console.error(`[FAIL] ${id}: ${msg}`);
    failed++;
  }
}

let serverHandler: http.RequestListener = () => {};

const server = http.createServer((req, res) => serverHandler(req, res));

async function waitFor(predicate: () => boolean, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(25);
  }
  return predicate();
}

async function runTests() {
  console.log('========================================================================');
  console.log('      HYPERDOWNLOADER PHASE 10.7 DUPLICATE URL & FILE PRESERVATION      ');
  console.log('========================================================================');

  const PAYLOAD = generateDeterministicBuffer(384 * 1024); // 384 KB
  const PAYLOAD_HASH = sha256(PAYLOAD);

  const goodHandler: http.RequestListener = (req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': PAYLOAD.length.toString(), 'Accept-Ranges': 'bytes' });
      return res.end();
    }
    const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
    const start = range ? parseInt(range[1], 10) : 0;
    const end = range ? parseInt(range[2], 10) : PAYLOAD.length - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD.length}` });
    res.end(PAYLOAD.subarray(start, end + 1));
  };

  // -------------------------------------------------------------------------
  // DUP-01: completed row + re-add → skip, file untouched.
  // -------------------------------------------------------------------------
  {
    serverHandler = goodHandler;
    const engine = new DownloadEngine(undefined, TEST_DIR + '/dup01');
    fs.mkdirSync(TEST_DIR + '/dup01', { recursive: true });
    const item = await engine.addDownload(`http://localhost:${TEST_PORT}/dup01.bin`, 'dup01.bin', TEST_DIR + '/dup01', 2);
    await waitFor(() => item.status === 'completed', 20000);
    const beforeBytes = fs.readFileSync(item.destinationPath);
    const beforeHash = sha256(beforeBytes);
    const rowsBefore = engine.getAllDownloads().length;
    const fileMtimeBefore = fs.statSync(item.destinationPath).mtimeMs;

    const again = await engine.addDownload(`http://localhost:${TEST_PORT}/dup01.bin`, 'dup01.bin', TEST_DIR + '/dup01', 2);
    await sleep(300);

    assert(
      again.id === item.id &&
        engine.getAllDownloads().length === rowsBefore &&
        sha256File(item.destinationPath) === beforeHash &&
        fs.statSync(item.destinationPath).mtimeMs === fileMtimeBefore,
      'DUP-01',
      'Completed row re-add skipped: same row, no growth, file byte-identical and untouched'
    );
    engine.destroy();
  }

  // -------------------------------------------------------------------------
  // DUP-02: active row + re-add → skip; exactly one pipeline.
  // -------------------------------------------------------------------------
  {
    let gate = false;
    serverHandler = (req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': PAYLOAD.length.toString(), 'Accept-Ranges': 'bytes' });
        return res.end();
      }
      if (!gate) {
        // Hold the response open with real data flow to stay 'downloading'.
        // 16KB/20ms finishes in ~0.5s — quick enough to never starve under
        // full-suite load, slow enough for the re-add to observe the row.
        res.writeHead(206, { 'Content-Range': `bytes 0-${PAYLOAD.length - 1}/${PAYLOAD.length}` });
        let offset = 0;
        const timer = setInterval(() => {
          if (offset >= PAYLOAD.length) {
            clearInterval(timer);
            return res.end();
          }
          if (gate) {
            // Release everything quickly once the gate opens.
            while (offset < PAYLOAD.length) {
              const n = Math.min(64 * 1024, PAYLOAD.length - offset);
              res.write(PAYLOAD.subarray(offset, offset + n));
              offset += n;
            }
            clearInterval(timer);
            return res.end();
          }
          res.write(PAYLOAD.subarray(offset, offset + 16 * 1024));
          offset += 16 * 1024;
        }, 20);
        req.on('close', () => clearInterval(timer));
        return;
      }
      // Gate open: serve ANY request (including stall-retries at any offset)
      // with a complete, valid range response. Earlier versions fell through
      // here with no response, hanging post-gate retries and flaking the test.
      const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
      const start = range ? parseInt(range[1], 10) : 0;
      const end = range ? parseInt(range[2], 10) : PAYLOAD.length - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD.length}` });
      res.end(PAYLOAD.subarray(start, end + 1));
    };

    const engine = new DownloadEngine(undefined, TEST_DIR + '/dup02');
    fs.mkdirSync(TEST_DIR + '/dup02', { recursive: true });
    const item = await engine.addDownload(`http://localhost:${TEST_PORT}/dup02.bin`, 'dup02.bin', TEST_DIR + '/dup02', 1);
    // 'completed' accepted too: a very fast trickle may finish before we poll;
    // the skip policy makes the assertions hold either way.
    await waitFor(() => item.status === 'downloading' || item.status === 'completed', 10000);

    const rowsBefore = engine.getAllDownloads().length;
    const again = await engine.addDownload(`http://localhost:${TEST_PORT}/dup02.bin`, 'dup02.bin', TEST_DIR + '/dup02', 1);
    const rowsAfter = engine.getAllDownloads().length;

    gate = true;
    await waitFor(() => item.status === 'completed', 25000);
    if (!(again.id === item.id && rowsAfter === rowsBefore && sha256File(item.destinationPath) === PAYLOAD_HASH)) {
      let diskHash = 'unreadable';
      try { diskHash = sha256File(item.destinationPath); } catch (e: any) { diskHash = 'ERR:' + e.message; }
      console.error(`  [diag DUP-02] sameId=${again.id === item.id} rowsBefore=${rowsBefore} rowsAfter=${rowsAfter} status=${item.status} bytes=${item.downloadedBytes}/${item.totalBytes} hashOk=${diskHash === PAYLOAD_HASH} path=${item.destinationPath}`);
    }
    assert(
      again.id === item.id &&
        rowsAfter === rowsBefore &&
        sha256File(item.destinationPath) === PAYLOAD_HASH,
      'DUP-02',
      'Active row re-add skipped: one pipeline only, completed byte-exact after release'
    );
    engine.destroy();
  }

  // -------------------------------------------------------------------------
  // DUP-03: paused row + re-add → skip (resume stays explicit).
  // -------------------------------------------------------------------------
  {
    serverHandler = goodHandler;
    const engine = new DownloadEngine(undefined, TEST_DIR + '/dup03');
    fs.mkdirSync(TEST_DIR + '/dup03', { recursive: true });
    const item = await engine.addDownload(`http://localhost:${TEST_PORT}/dup03.bin`, 'dup03.bin', TEST_DIR + '/dup03', 2);
    await waitFor(() => item.status === 'downloading', 10000);
    await engine.pauseDownload(item.id);
    await waitFor(() => item.status === 'paused', 5000);

    const rowsBefore = engine.getAllDownloads().length;
    const again = await engine.addDownload(`http://localhost:${TEST_PORT}/dup03.bin`, 'dup03.bin', TEST_DIR + '/dup03', 2);
    await sleep(200);

    assert(
      again.id === item.id &&
        again.status === 'paused' &&
        engine.getAllDownloads().length === rowsBefore,
      'DUP-03',
      'Paused row re-add skipped: same row stays paused, no auto-resume, no new row'
    );
    engine.destroy();
  }

  // -------------------------------------------------------------------------
  // DUP-04: errored row + re-add → retry in place, byte-exact.
  // -------------------------------------------------------------------------
  {
    let dead = true;
    serverHandler = (req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': PAYLOAD.length.toString(), 'Accept-Ranges': 'bytes' });
        return res.end();
      }
      if (dead) {
        res.writeHead(404, { 'Content-Length': '0' });
        return res.end();
      }
      goodHandler(req, res);
    };

    const engine = new DownloadEngine(undefined, TEST_DIR + '/dup04');
    fs.mkdirSync(TEST_DIR + '/dup04', { recursive: true });
    const item = await engine.addDownload(`http://localhost:${TEST_PORT}/dup04.bin`, 'dup04.bin', TEST_DIR + '/dup04', 2);
    await waitFor(() => item.status === 'error', 15000);

    dead = false;
    const retryItem = await engine.addDownload(`http://localhost:${TEST_PORT}/dup04.bin`, 'dup04.bin', TEST_DIR + '/dup04', 2);
    await waitFor(() => retryItem.status === 'completed', 20000);

    assert(
      retryItem.id === item.id && sha256File(retryItem.destinationPath) === PAYLOAD_HASH,
      'DUP-04',
      'Errored row re-add retried in place and completed byte-exact'
    );
    engine.destroy();
  }

  // -------------------------------------------------------------------------
  // DUP-05: two different URLs, same desired filename → distinct paths.
  // -------------------------------------------------------------------------
  {
    serverHandler = goodHandler;
    const engine = new DownloadEngine(undefined, TEST_DIR + '/dup05');
    fs.mkdirSync(TEST_DIR + '/dup05', { recursive: true });
    const a = await engine.addDownload(`http://localhost:${TEST_PORT}/aa/file.bin`, 'file.bin', TEST_DIR + '/dup05', 2);
    const b = await engine.addDownload(`http://localhost:${TEST_PORT}/bb/file.bin`, 'file.bin', TEST_DIR + '/dup05', 2);

    await waitFor(() => a.status === 'completed' && b.status === 'completed', 25000);

    const distinct =
      a.destinationPath.toLowerCase() !== b.destinationPath.toLowerCase() &&
      fs.existsSync(a.destinationPath) &&
      fs.existsSync(b.destinationPath) &&
      sha256File(a.destinationPath) === PAYLOAD_HASH &&
      sha256File(b.destinationPath) === PAYLOAD_HASH;

    if (!distinct) {
      console.error(`  [diag DUP-05] a=${a.destinationPath} b=${b.destinationPath}`);
    }
    assert(distinct, 'DUP-05', 'Same-filename different-URL rows wrote to distinct paths, both byte-exact');
    engine.destroy();
  }

  // -------------------------------------------------------------------------
  // DUP-06: probe Content-Disposition rename cannot collide with another row.
  // -------------------------------------------------------------------------
  {
    // Server announces the SAME filename for two different URLs.
    serverHandler = (req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Length': PAYLOAD.length.toString(),
          'Accept-Ranges': 'bytes',
          'Content-Disposition': 'attachment; filename="cdname.bin"',
        });
        return res.end();
      }
      const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
      const start = range ? parseInt(range[1], 10) : 0;
      const end = range ? parseInt(range[2], 10) : PAYLOAD.length - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${PAYLOAD.length}`,
        'Content-Disposition': 'attachment; filename="cdname.bin"',
      });
      res.end(PAYLOAD.subarray(start, end + 1));
    };

    const engine = new DownloadEngine(undefined, TEST_DIR + '/dup06');
    fs.mkdirSync(TEST_DIR + '/dup06', { recursive: true });
    const a = await engine.addDownload(`http://localhost:${TEST_PORT}/one/cd.bin`, undefined, TEST_DIR + '/dup06', 2);
    const b = await engine.addDownload(`http://localhost:${TEST_PORT}/two/cd.bin`, undefined, TEST_DIR + '/dup06', 2);
    await waitFor(() => a.status === 'completed' && b.status === 'completed', 25000);

    const distinct =
      a.destinationPath.toLowerCase() !== b.destinationPath.toLowerCase() &&
      sha256File(a.destinationPath) === PAYLOAD_HASH &&
      sha256File(b.destinationPath) === PAYLOAD_HASH;
    if (!distinct) {
      console.error(`  [diag DUP-06] a=${a.destinationPath} b=${b.destinationPath}`);
    }
    assert(distinct, 'DUP-06', 'Identical Content-Disposition names resolved to distinct paths, both byte-exact');
    engine.destroy();
  }

  // -------------------------------------------------------------------------
  // DUP-07: case-different re-add of the same URL still dedupes.
  // -------------------------------------------------------------------------
  {
    serverHandler = goodHandler;
    const engine = new DownloadEngine(undefined, TEST_DIR + '/dup07');
    fs.mkdirSync(TEST_DIR + '/dup07', { recursive: true });
    const item = await engine.addDownload(`http://localhost:${TEST_PORT}/dup07.bin`, 'dup07.bin', TEST_DIR + '/dup07', 2);
    await waitFor(() => item.status === 'completed', 20000);
    const rowsBefore = engine.getAllDownloads().length;

    const again = await engine.addDownload(`http://LOCALHOST:${TEST_PORT}/DUP07.BIN`, undefined, TEST_DIR + '/dup07', 2);
    await sleep(200);

    assert(
      again.id === item.id && engine.getAllDownloads().length === rowsBefore,
      'DUP-07',
      'Case-different URL re-add deduped to the existing row'
    );
    engine.destroy();
  }

  console.log('========================================================================');
  console.log(`DUPLICATE URL TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');

  server.close();
  if (failed > 0) process.exit(1);
  process.exit(0);
}

(async () => {
  await new Promise<void>((resolve) => server.listen(TEST_PORT, () => resolve()));
  try {
    await runTests();
  } catch (err) {
    console.error('Fatal duplicate-url test error:', err);
    process.exit(1);
  }
})();
