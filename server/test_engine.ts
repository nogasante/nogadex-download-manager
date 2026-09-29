/**
 * P0 Engine & Core Protocol Benchmark
 *
 * Default: fully LOCAL — serves a deterministic 8MB payload from a loopback
 * HTTP server supporting Range requests, downloads it with 32 streams through
 * the real engine, verifies byte-exact SHA-256, and reports throughput.
 * Zero internet / zero data bundles used.
 *
 * Optional: set NDM_ENGINE_BENCH_URL=<url> to benchmark a real internet URL
 * instead (explicitly opt-in because it consumes bandwidth).
 */
import { DownloadEngine } from './engine';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const BENCH_BYTES = 8 * 1024 * 1024; // 8MB deterministic payload
const STREAMS = 32;

/** Deterministic pseudo-random payload (seeded LCG) — reproducible hash. */
function buildPayload(size: number): Buffer {
  const buf = Buffer.alloc(size);
  let seed = 0x12345678;
  for (let i = 0; i < size; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    buf[i] = seed & 0xff;
  }
  return buf;
}

function rangeResponse(req: http.IncomingMessage, res: http.ServerResponse, payload: Buffer): void {
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { 'Content-Length': String(payload.length) });
    res.end(payload);
    return;
  }
  const m = /bytes=(\d+)-(\d*)/.exec(range);
  if (!m) {
    res.writeHead(416, { 'Content-Range': `bytes */${payload.length}` });
    res.end();
    return;
  }
  const start = parseInt(m[1], 10);
  const end = m[2] ? Math.min(parseInt(m[2], 10), payload.length - 1) : payload.length - 1;
  if (start > end || start >= payload.length) {
    res.writeHead(416, { 'Content-Range': `bytes */${payload.length}` });
    res.end();
    return;
  }
  res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${payload.length}` });
  res.end(payload.subarray(start, end + 1));
}

async function runTest() {
  const realUrl = process.env.NDM_ENGINE_BENCH_URL;
  let testUrl: string;
  let expectedSha: string | null = null;
  let cleanupServer: (() => Promise<void>) | null = null;
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndm-bench-'));

  if (realUrl) {
    console.log(`[Mode] REAL-INTERNET benchmark (opt-in via NDM_ENGINE_BENCH_URL): ${realUrl}`);
    testUrl = realUrl;
  } else {
    const payload = buildPayload(BENCH_BYTES);
    expectedSha = crypto.createHash('sha256').update(payload).digest('hex');

    const server = http.createServer((req, res) => rangeResponse(req, res, payload));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    testUrl = `http://127.0.0.1:${port}/bench.bin`;
    cleanupServer = () => new Promise<void>((r) => server.close(() => r()));

    console.log('=== Starting HyperDownloader Engine Benchmark (LOCAL loopback, zero internet) ===');
    console.log(`[Test] Payload: ${(BENCH_BYTES / (1024 * 1024)).toFixed(0)}MB deterministic, SHA-256 verified`);
  }

  const engine = new DownloadEngine(() => {
    // Engine update listener
  }, testDir);

  console.log(`[Test] Probing and initiating ${STREAMS}-thread download from: ${testUrl}`);
  const startTime = Date.now();

  const item = await engine.addDownload(testUrl, 'bench_test.bin', testDir, STREAMS);

  console.log(`[Test] Download ID: ${item.id}`);

  // Monitor progress until completed or failed
  await new Promise<void>((resolve, reject) => {
    const interval = setInterval(() => {
      const current = engine.downloads.get(item.id);
      if (!current) {
        clearInterval(interval);
        reject(new Error('Download disappeared'));
        return;
      }

      const percent = current.totalBytes > 0
        ? Math.round((current.downloadedBytes / current.totalBytes) * 100)
        : 0;
      const mbps = (current.speedBps / (1024 * 1024)).toFixed(2);
      const activeStreams = current.chunks.filter(c => c.status === 'active').length;
      const doneStreams = current.chunks.filter(c => c.status === 'done').length;

      console.log(`[Progress] ${percent}% | Speed: ${mbps} MB/s | Streams: [${doneStreams} done / ${activeStreams} active / ${current.chunks.length} total]`);

      if (current.status === 'completed') {
        clearInterval(interval);
        resolve();
      } else if (current.status === 'error') {
        clearInterval(interval);
        reject(new Error(current.error || 'Download failed'));
      }
    }, 1000);
  });

  const durationSec = (Date.now() - startTime) / 1000;
  console.log(`\n🎉 [SUCCESS] Download completed in ${durationSec.toFixed(2)} seconds!`);

  // Verify file on disk: exact size and, for the local payload, exact bytes
  const filePath = item.destinationPath;
  if (!fs.existsSync(filePath)) {
    throw new Error('Downloaded file missing on disk');
  }
  const stats = fs.statSync(filePath);
  console.log(`[Disk Verification] File exists at: ${filePath}`);
  console.log(`[Disk Verification] Exact Size: ${stats.size} bytes (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);

  if (expectedSha) {
    const actualSha = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    if (actualSha !== expectedSha) {
      throw new Error(`SHA-256 mismatch after ${STREAMS}-stream download!\n  expected: ${expectedSha}\n  actual:   ${actualSha}`);
    }
    console.log(`[Integrity] SHA-256 byte-exact across ${STREAMS} reassembled streams ✓`);
  }

  // Cleanup
  engine.destroy();
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('[Cleanup] Test file and temp dir removed.');
  if (cleanupServer) await cleanupServer();

  process.exit(0);
}

runTest().catch(err => {
  console.error('[Benchmark Error]:', err);
  process.exit(1);
});
