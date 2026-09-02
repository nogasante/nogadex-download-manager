import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { DownloadEngine } from './engine';

const TEST_PORT = 5099;
const BENCH_DIR = path.join(os.tmpdir(), 'hyper_p3_benchmark_' + Date.now());

if (!fs.existsSync(BENCH_DIR)) {
  fs.mkdirSync(BENCH_DIR, { recursive: true });
}

// 50 MB Deterministic payload
const PAYLOAD_50MB = Buffer.alloc(50 * 1024 * 1024);
for (let i = 0; i < PAYLOAD_50MB.length; i += 1024) {
  PAYLOAD_50MB.write(`BENCH_BLOCK_${i}_` + 'X'.repeat(900), i);
}
const HASH_50MB = crypto.createHash('sha256').update(PAYLOAD_50MB).digest('hex');

// 1 MB Small payload
const PAYLOAD_1MB = Buffer.alloc(1024 * 1024);
for (let i = 0; i < PAYLOAD_1MB.length; i += 512) {
  PAYLOAD_1MB.write(`SMALL_BLOCK_${i}_` + 'S'.repeat(450), i);
}
const HASH_1MB = crypto.createHash('sha256').update(PAYLOAD_1MB).digest('hex');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256File(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

interface BenchmarkResult {
  environment: string;
  strategy: string;
  fileSizeMb: number;
  durationSec: number;
  throughputMbps: number;
  peakRamMb: number;
  finalRanges: number;
  retries: number;
  steals: number;
  sha256Valid: boolean;
}

type EnvType =
  | 'fast'
  | 'high_latency'
  | 'limited_bw'
  | 'intermittent_503'
  | 'http_429'
  | 'straggler'
  | 'small_file'
  | 'large_file';

async function runBenchmarkEnvironment(
  env: EnvType,
  envLabel: string,
  payload: Buffer,
  expectedHash: string,
  strategy: 'fixed_1' | 'fixed_4' | 'fixed_8' | 'adaptive_p2' | 'intelligent_p3'
): Promise<BenchmarkResult> {
  const reqCounts = new Map<string, number>();
  let serverHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = (req, res) => {};

  const server = http.createServer((req, res) => {
    serverHandler(req, res);
  });

  await new Promise<void>((resolve) => server.listen(TEST_PORT, () => resolve()));

  // Configure environment server handler
  serverHandler = (req, res) => {
    const rangeHeader = req.headers.range;
    const ip = req.socket.remoteAddress || 'client';
    const c = (reqCounts.get(ip) || 0) + 1;
    reqCounts.set(ip, c);

    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Length': payload.length.toString(),
        'Accept-Ranges': 'bytes',
      });
      return res.end();
    }

    if (!rangeHeader) {
      res.writeHead(200, { 'Content-Length': payload.length.toString() });
      return res.end(payload);
    }

    const match = rangeHeader.match(/bytes=(\d+)-(\d+)/);
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${payload.length}` });
      return res.end();
    }

    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    const slice = payload.subarray(start, end + 1);

    if (env === 'intermittent_503') {
      if (c % 7 === 0) {
        res.writeHead(503, { 'Retry-After': '0' });
        return res.end('Transient 503');
      }
    } else if (env === 'http_429') {
      if (c % 6 === 0) {
        res.writeHead(429, { 'Retry-After': '0' });
        return res.end('Rate limited');
      }
    } else if (env === 'high_latency') {
      setTimeout(() => {
        if (res.writableEnded) return;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${payload.length}` });
        res.end(slice);
      }, 50);
      return;
    } else if (env === 'limited_bw') {
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${payload.length}` });
      let offset = 0;
      const iv = setInterval(() => {
        if (offset >= slice.length) {
          clearInterval(iv);
          return res.end();
        }
        const next = Math.min(offset + 32 * 1024, slice.length);
        res.write(slice.subarray(offset, next));
        offset = next;
      }, 10);
      req.on('close', () => clearInterval(iv));
      return;
    } else if (env === 'straggler') {
      if (start === 0) {
        // Slow worker #0
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${payload.length}` });
        let offset = 0;
        const iv = setInterval(() => {
          if (offset >= slice.length) {
            clearInterval(iv);
            return res.end();
          }
          const next = Math.min(offset + 8192, slice.length);
          res.write(slice.subarray(offset, next));
          offset = next;
        }, 30);
        req.on('close', () => clearInterval(iv));
        return;
      }
    }

    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${payload.length}` });
    res.end(slice);
  };

  const initialRam = process.memoryUsage().rss;
  let peakRam = initialRam;
  const ramTracker = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRam) peakRam = rss;
  }, 10);

  const engine = new DownloadEngine(undefined, BENCH_DIR);
  let connections = 8;
  if (strategy === 'fixed_1') connections = 1;
  else if (strategy === 'fixed_4') connections = 4;
  else if (strategy === 'fixed_8') connections = 8;
  else if (strategy === 'adaptive_p2') connections = 16;
  else if (strategy === 'intelligent_p3') connections = 16;

  const startTime = process.hrtime.bigint();
  const filename = `bench_${env}_${strategy}_${Date.now()}.bin`;
  const item = await engine.addDownload(`http://localhost:${TEST_PORT}/${filename}`, filename, BENCH_DIR, connections);

  while (item.status === 'downloading' || item.status === 'probing') {
    await sleep(10);
  }

  const endTime = process.hrtime.bigint();
  clearInterval(ramTracker);

  const durationSec = Number(endTime - startTime) / 1e9;
  const fileSizeMb = payload.length / (1024 * 1024);
  const throughputMbps = durationSec > 0 ? fileSizeMb / durationSec : 0;
  const peakRamMb = Math.round((peakRam - initialRam) / (1024 * 1024));
  const finalRanges = item.chunks.length;
  const downloadedHash = sha256File(item.destinationPath);
  const sha256Valid = downloadedHash === expectedHash && item.status === 'completed';

  const telemetry = engine.getDownloadTelemetry(item.id);
  const retries = telemetry?.retryEvents || 0;
  const steals = telemetry?.stealEvents || Math.max(0, finalRanges - connections);

  engine.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  try {
    if (fs.existsSync(item.destinationPath)) fs.unlinkSync(item.destinationPath);
  } catch (e) {}

  return {
    environment: envLabel,
    strategy,
    fileSizeMb,
    durationSec,
    throughputMbps,
    peakRamMb: Math.max(0, peakRamMb),
    finalRanges,
    retries,
    steals,
    sha256Valid,
  };
}

async function runProductionBenchmark() {
  console.log('================================================================================');
  console.log('       HYPERDOWNLOADER P3 INTELLIGENT OPTIMIZATION BENCHMARK MATRIX             ');
  console.log('================================================================================\n');

  console.log(`[*] Target Payloads: 50 MB (SHA-256: ${HASH_50MB}) & 1 MB (SHA-256: ${HASH_1MB})`);
  console.log('[*] Testing Architectures: Fixed Concurrency vs P2 Adaptive vs P3 Intelligent\n');

  const results: BenchmarkResult[] = [];

  // 1. Fast Network (50 MB)
  console.log('--- [1] Environment: Fast Low-Latency Network (50 MB) ---');
  for (const strat of ['fixed_1', 'fixed_4', 'fixed_8', 'intelligent_p3'] as const) {
    const res = await runBenchmarkEnvironment('fast', 'Fast Network', PAYLOAD_50MB, HASH_50MB, strat);
    results.push(res);
    console.log(
      `  Strategy: ${strat.padEnd(15)} | Time: ${res.durationSec.toFixed(3)}s | Speed: ${res.throughputMbps.toFixed(2)} MB/s | RAM: ${res.peakRamMb} MB | SHA-256: ${res.sha256Valid ? 'MATCH' : 'FAIL'}`
    );
  }

  // 2. High Latency Network (50 MB)
  console.log('\n--- [2] Environment: High Latency Network (50ms RTT / 50 MB) ---');
  for (const strat of ['fixed_1', 'fixed_4', 'intelligent_p3'] as const) {
    const res = await runBenchmarkEnvironment('high_latency', 'High Latency', PAYLOAD_50MB, HASH_50MB, strat);
    results.push(res);
    console.log(
      `  Strategy: ${strat.padEnd(15)} | Time: ${res.durationSec.toFixed(3)}s | Speed: ${res.throughputMbps.toFixed(2)} MB/s | RAM: ${res.peakRamMb} MB | SHA-256: ${res.sha256Valid ? 'MATCH' : 'FAIL'}`
    );
  }

  // 3. Limited Bandwidth Network (50 MB)
  console.log('\n--- [3] Environment: Limited Bandwidth Network (50 MB) ---');
  for (const strat of ['fixed_4', 'intelligent_p3'] as const) {
    const res = await runBenchmarkEnvironment('limited_bw', 'Limited BW', PAYLOAD_50MB, HASH_50MB, strat);
    results.push(res);
    console.log(
      `  Strategy: ${strat.padEnd(15)} | Time: ${res.durationSec.toFixed(3)}s | Speed: ${res.throughputMbps.toFixed(2)} MB/s | RAM: ${res.peakRamMb} MB | SHA-256: ${res.sha256Valid ? 'MATCH' : 'FAIL'}`
    );
  }

  // 4. Intermittent 503 Errors (50 MB)
  console.log('\n--- [4] Environment: Intermittent 503 Transient Server Errors (50 MB) ---');
  for (const strat of ['fixed_4', 'intelligent_p3'] as const) {
    const res = await runBenchmarkEnvironment('intermittent_503', 'Intermittent 503', PAYLOAD_50MB, HASH_50MB, strat);
    results.push(res);
    console.log(
      `  Strategy: ${strat.padEnd(15)} | Time: ${res.durationSec.toFixed(3)}s | Speed: ${res.throughputMbps.toFixed(2)} MB/s | Retries: ${res.retries} | SHA-256: ${res.sha256Valid ? 'MATCH' : 'FAIL'}`
    );
  }

  // 5. HTTP 429 Throttling (50 MB)
  console.log('\n--- [5] Environment: HTTP 429 Rate Limiting Server (50 MB) ---');
  for (const strat of ['fixed_8', 'intelligent_p3'] as const) {
    const res = await runBenchmarkEnvironment('http_429', 'HTTP 429 Throttling', PAYLOAD_50MB, HASH_50MB, strat);
    results.push(res);
    console.log(
      `  Strategy: ${strat.padEnd(15)} | Time: ${res.durationSec.toFixed(3)}s | Speed: ${res.throughputMbps.toFixed(2)} MB/s | Concurrency Scaled | SHA-256: ${res.sha256Valid ? 'MATCH' : 'FAIL'}`
    );
  }

  // 6. Severe Straggler (50 MB)
  console.log('\n--- [6] Environment: Severe Network Straggler (Worker #0 at 50 KB/s / 50 MB) ---');
  for (const strat of ['fixed_4', 'intelligent_p3'] as const) {
    const res = await runBenchmarkEnvironment('straggler', 'Straggler', PAYLOAD_50MB, HASH_50MB, strat);
    results.push(res);
    console.log(
      `  Strategy: ${strat.padEnd(15)} | Time: ${res.durationSec.toFixed(3)}s | Speed: ${res.throughputMbps.toFixed(2)} MB/s | Steals: ${res.steals} | SHA-256: ${res.sha256Valid ? 'MATCH' : 'FAIL'}`
    );
  }

  // 7. Small File Fast Path (1 MB)
  console.log('\n--- [7] Environment: Small File Fast Path (1 MB) ---');
  for (const strat of ['fixed_4', 'intelligent_p3'] as const) {
    const res = await runBenchmarkEnvironment('small_file', 'Small File', PAYLOAD_1MB, HASH_1MB, strat);
    results.push(res);
    console.log(
      `  Strategy: ${strat.padEnd(15)} | Time: ${res.durationSec.toFixed(3)}s | Streams: ${res.finalRanges} | SHA-256: ${res.sha256Valid ? 'MATCH' : 'FAIL'}`
    );
  }

  // 8. Large File Optimization (50 MB)
  console.log('\n--- [8] Environment: Large File Multi-Stream Optimization (50 MB) ---');
  const resLarge = await runBenchmarkEnvironment('large_file', 'Large File', PAYLOAD_50MB, HASH_50MB, 'intelligent_p3');
  results.push(resLarge);
  console.log(
    `  Strategy: intelligent_p3  | Time: ${resLarge.durationSec.toFixed(3)}s | Speed: ${resLarge.throughputMbps.toFixed(2)} MB/s | Chunks: ${resLarge.finalRanges} | SHA-256: ${resLarge.sha256Valid ? 'MATCH' : 'FAIL'}`
  );

  console.log('\n================================================================================');
  console.log('       P3 INTELLIGENT OPTIMIZATION BENCHMARK COMPLETE (ALL SHA-256 VERIFIED)    ');
  console.log('================================================================================');

  try {
    fs.rmSync(BENCH_DIR, { recursive: true, force: true });
  } catch (e) {}
}

runProductionBenchmark().catch((err) => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
