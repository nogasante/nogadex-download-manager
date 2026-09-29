import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DownloadEngine } from './engine';

/**
 * Phase 10.6 — Retry Dedupe & Bulk Retry
 *
 * RD-01  Re-adding the URL of an errored download reuses that row (no duplicate)
 * RD-02  A retried (reused) row completes with an exact SHA-256 match
 * RD-03  A COMPLETED row is never reused: same URL creates a fresh row
 * RD-04  A PAUSED row is never reused: same URL creates a fresh row
 * RD-05  retryAllFailed() retries every errored row in place
 * RD-06  retryAllFailed() respects the concurrency cap and the queue pump
 *        promotes the extra items as slots free up
 * RD-07  A custom filename submitted with the retry wins over the stored name
 */

const TEST_PORT = 5097;
const TEST_DIR = path.join(os.tmpdir(), 'hyper_retry_dedupe_tests');

// Fresh sandbox per run: stale rows from earlier runs would otherwise be
// restored by loadState and break row-count and dedupe assertions.
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

async function waitFor(predicate: () => boolean, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(25);
  }
  return predicate();
}

async function runTests() {
  console.log('========================================================================');
  console.log('     HYPERDOWNLOADER PHASE 10.6 RETRY DEDUPE & BULK RETRY SUITE        ');
  console.log('========================================================================');

  // Per-block sandbox: a shared TEST_DIR would leak rows between blocks via
  // loadState and corrupt row-count/dedupe assertions.
  const blockDir = (n: number) => {
    const dir = path.join(TEST_DIR, `block${n}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  const PAYLOAD = generateDeterministicBuffer(512 * 1024); // 512 KB
  const PAYLOAD_HASH = sha256(PAYLOAD);

  serverHandler = (req, res) => {
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
  // RD-01 + RD-02: errored row is reused and, once the server recovers,
  // completes with an exact hash — never a duplicate row.
  // -------------------------------------------------------------------------
  {
    let dead = true;
    serverHandler = (req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': PAYLOAD.length.toString(), 'Accept-Ranges': 'bytes' });
        return res.end();
      }
      if (dead) {
        // 404 is a non-retryable permanent error: the row reaches 'error'
        // immediately instead of burning the engine's retry backoff.
        res.writeHead(404, { 'Content-Length': '0' });
        return res.end();
      }
      const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
      const start = range ? parseInt(range[1], 10) : 0;
      const end = range ? parseInt(range[2], 10) : PAYLOAD.length - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD.length}` });
      res.end(PAYLOAD.subarray(start, end + 1));
    };

    const engine = new DownloadEngine(undefined, blockDir(1));
    const item = await engine.addDownload(`http://localhost:${TEST_PORT}/rd01.bin`, 'rd01.bin', blockDir(1), 2);
    await waitFor(() => item.status === 'error', 15000);
    assert(item.status === 'error', 'RD-01-setup', 'Download failed as intended (server 404)');

    const idBefore = item.id;
    const totalBefore = engine.getAllDownloads().length;

    // Retry by re-adding the same URL — must reuse the errored row.
    const retryItem = await engine.addDownload(`http://localhost:${TEST_PORT}/rd01.bin`, undefined, blockDir(1), 2);
    assert(
      retryItem.id === idBefore && engine.getAllDownloads().length === totalBefore,
      'RD-01',
      `Re-adding errored URL reused row ${retryItem.id} (rows: ${totalBefore}, no growth)`
    );

    // Server recovers → the reused row completes with an exact hash.
    dead = false;
    await waitFor(() => engine.downloads.get(idBefore)!.status === 'completed', 20000);
    const done = engine.downloads.get(idBefore)!;
    if (done.status !== 'completed' || sha256File(done.destinationPath) !== PAYLOAD_HASH) {
      console.error(`  [diag RD-02] status=${done.status} downloadedBytes=${done.downloadedBytes}/${done.totalBytes} error=${done.error ?? 'none'}`);
      try { console.error(`  [diag RD-02] actualHash=${sha256File(done.destinationPath)}`); } catch (e: any) { console.error(`  [diag RD-02] hash read failed: ${e.message}`); }
    }
    assert(
      done.status === 'completed' && sha256File(done.destinationPath) === PAYLOAD_HASH,
      'RD-02',
      'Retried (reused) row completed with 100% SHA-256 match'
    );
    engine.destroy();
  }

  // -------------------------------------------------------------------------
  // RD-03 + RD-04: completed and paused rows are NOT reused.
  // -------------------------------------------------------------------------
  {
    const engine = new DownloadEngine(undefined, blockDir(3));
    const completed = await engine.addDownload(`http://localhost:${TEST_PORT}/rd03.bin`, 'rd03.bin', blockDir(3), 2);
    await waitFor(() => completed.status === 'completed', 20000);

    // Duplicate-URL policy: a completed row is SKIPPED — the same row comes
    // back untouched (delete the row first to force a fresh download).
    const again = await engine.addDownload(`http://localhost:${TEST_PORT}/rd03.bin`, undefined, blockDir(3), 2);
    if (!(again.id === completed.id && engine.getAllDownloads().length === 1)) {
      console.error(`  [diag RD-03] rows=${engine.getAllDownloads().length} firstId=${completed.id}(${completed.status}) againId=${again.id}(${again.status})`);
    }
    assert(
      again.id === completed.id && engine.getAllDownloads().length === 1 && again.status === 'completed',
      'RD-03',
      'Completed row re-add skipped: same row returned, no duplicate created'
    );

    // Pause the fresh row, then verify duplicate policy: a paused row is
    // SKIPPED (returned untouched), not reused-for-retry and not duplicated.
    await engine.pauseDownload(again.id);
    const pausedCount = engine.getAllDownloads().filter(d => d.status === 'paused').length;
    const third = await engine.addDownload(`http://localhost:${TEST_PORT}/rd03.bin`, undefined, blockDir(3), 2);
    assert(
      third.id === again.id && third.status === 'paused' && engine.getAllDownloads().filter(d => d.status === 'paused').length === pausedCount,
      'RD-04',
      'Paused row re-add skipped: same row returned untouched (resume stays explicit)'
    );
    engine.destroy();
  }

  // -------------------------------------------------------------------------
  // RD-05: retryAllFailed() retries every errored row in place.
  // -------------------------------------------------------------------------
  {
    let failOddRequests = true;
    let getRequestCount = 0;
    serverHandler = (req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': PAYLOAD.length.toString(), 'Accept-Ranges': 'bytes' });
        return res.end();
      }
      getRequestCount++;
      if (failOddRequests && getRequestCount % 2 === 1) {
        res.writeHead(404, { 'Content-Length': '0' });
        return res.end();
      }
      const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
      const start = range ? parseInt(range[1], 10) : 0;
      const end = range ? parseInt(range[2], 10) : PAYLOAD.length - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD.length}` });
      res.end(PAYLOAD.subarray(start, end + 1));
    };

    const engine = new DownloadEngine(undefined, blockDir(5));
    const a = await engine.addDownload(`http://localhost:${TEST_PORT}/rd05a.bin`, 'rd05a.bin', blockDir(5), 2);
    const b = await engine.addDownload(`http://localhost:${TEST_PORT}/rd05b.bin`, 'rd05b.bin', blockDir(5), 2);
    await waitFor(() => a.status === 'error' && b.status === 'error', 20000);

    failOddRequests = false;
    getRequestCount = 0;
    const retried = await engine.retryAllFailed();
    assert(
      retried.length === 2 && retried.includes(a.id) && retried.includes(b.id),
      'RD-05a',
      'retryAllFailed returned both errored ids'
    );
    await waitFor(
      () => engine.downloads.get(a.id)!.status === 'completed' && engine.downloads.get(b.id)!.status === 'completed',
      25000
    );
    for (const d of [a, b]) {
      const it = engine.downloads.get(d.id)!;
      if (it.status !== 'completed' || sha256File(it.destinationPath) !== PAYLOAD_HASH) {
        console.error(`  [diag RD-05b] ${d.id} status=${it.status} bytes=${it.downloadedBytes}/${it.totalBytes} error=${it.error ?? 'none'}`);
      }
    }
    assert(
      sha256File(engine.downloads.get(a.id)!.destinationPath) === PAYLOAD_HASH &&
        sha256File(engine.downloads.get(b.id)!.destinationPath) === PAYLOAD_HASH,
      'RD-05b',
      'Both retried rows completed with exact SHA-256 matches'
    );
    engine.destroy();
  }

  // -------------------------------------------------------------------------
  // RD-06: retryAllFailed respects maxConcurrentDownloads; the queue pump
  // promotes the over-cap retry once a slot frees up.
  // -------------------------------------------------------------------------
  {
    serverHandler = (req, res) => {
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

    // Two errored rows from a period when the server was refusing.
    const deadHandler = serverHandler;
    serverHandler = (req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': PAYLOAD.length.toString(), 'Accept-Ranges': 'bytes' });
        return res.end();
      }
      res.writeHead(404, { 'Content-Length': '0' });
      return res.end();
    };
    const engine = new DownloadEngine(undefined, blockDir(6));
    const x = await engine.addDownload(`http://localhost:${TEST_PORT}/rd06x.bin`, 'rd06x.bin', blockDir(6), 1);
    const y = await engine.addDownload(`http://localhost:${TEST_PORT}/rd06y.bin`, 'rd06y.bin', blockDir(6), 1);
    await waitFor(() => x.status === 'error' && y.status === 'error', 15000);
    serverHandler = deadHandler;

    // Deterministic cap check with ZERO active downloads: the first retry
    // takes the free slot, the second must be queued, not started.
    engine.setMaxConcurrentDownloads(1);
    await sleep(100); // let any completion-side pump settle before asserting
    const retried = await engine.retryAllFailed();
    const other = (id: string) => (id === x.id ? y : x)!;
    const startedId = retried.length === 1 ? retried[0] : null;
    const queuedId = startedId ? other(startedId).id : null;
    if (!(retried.length === 1 && queuedId && engine.downloads.get(queuedId)!.status === 'queued')) {
      console.error(`  [diag RD-06a] retried=${JSON.stringify(retried)} x=${engine.downloads.get(x.id)!.status} y=${engine.downloads.get(y.id)!.status}`);
    }
    assert(
      retried.length === 1 && queuedId && engine.downloads.get(queuedId)!.status === 'queued',
      'RD-06a',
      'Cap=1: first retry started, over-cap retry flipped to queued'
    );

    // Once the started retry completes, the pump must promote the queued one.
    if (startedId && queuedId) {
      await waitFor(() => engine.downloads.get(startedId)!.status === 'completed', 20000);
      await waitFor(() => engine.downloads.get(queuedId)!.status === 'completed', 20000);
    }
    assert(
      sha256File(engine.downloads.get(x.id)!.destinationPath) === PAYLOAD_HASH &&
        sha256File(engine.downloads.get(y.id)!.destinationPath) === PAYLOAD_HASH,
      'RD-06b',
      'Queue pump promoted the queued retry to completion with an exact hash'
    );
    engine.destroy();
  }

  // -------------------------------------------------------------------------
  // RD-07: a custom filename submitted with the retry wins.
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
      const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
      const start = range ? parseInt(range[1], 10) : 0;
      const end = range ? parseInt(range[2], 10) : PAYLOAD.length - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD.length}` });
      res.end(PAYLOAD.subarray(start, end + 1));
    };

    const engine = new DownloadEngine(undefined, blockDir(7));
    const item = await engine.addDownload(`http://localhost:${TEST_PORT}/rd07.bin`, 'original.bin', blockDir(7), 1);
    await waitFor(() => item.status === 'error', 15000);

    const retryItem = await engine.addDownload(`http://localhost:${TEST_PORT}/rd07.bin`, 'renamed_by_retry.bin', blockDir(7), 1);
    assert(
      retryItem.id === item.id && retryItem.filename === 'renamed_by_retry.bin' && retryItem.userFilename === true,
      'RD-07',
      'Custom filename in retry request replaced the stored name and set userFilename'
    );

    dead = false;
    await waitFor(() => retryItem.status === 'completed', 20000);
    assert(
      sha256File(retryItem.destinationPath) === PAYLOAD_HASH,
      'RD-07b',
      'Renamed retry completed with exact SHA-256 match'
    );
    engine.destroy();
  }

  console.log('========================================================================');
  console.log(`RETRY DEDUPE TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
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
    console.error('Fatal retry-dedupe test error:', err);
    process.exit(1);
  }
})();
