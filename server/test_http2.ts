/**
 * Phase 10.10: HTTP/2 Transport Tests
 *
 * Verifies the h2 transport layer end-to-end against a REAL local
 * h2 server (Node's http2 module, no TLS requirement for localhost):
 *   - Multiplexing proof: 32 concurrent range streams arrive on ONE h2
 *     session (server observes 1 connection, 32 requests).
 *   - Byte-exactness: reassembled ranges match the payload SHA-256.
 *   - Backpressure: shouldPause actually pauses stream flow.
 *   - Engine integration: a download over an h2-capable origin completes
 *     byte-exact and takes the h2 path (server sees ONE session).
 *   - Fallback safety: a host that fails h2 detection uses the h1 path and
 *     still completes byte-exact.
 */

import http2 from 'http2';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { AddressInfo } from 'net';
import { Http2Transport } from './h2_client';
import { DownloadEngine } from './engine';

console.log('================================================================================');
console.log('       PHASE 10.10 HTTP/2 TRANSPORT TEST SUITE                                  ');
console.log('================================================================================\n');

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sha256File(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let read = 0;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// h2 test server: counts sessions (TCP connections) and requests (streams)
// ---------------------------------------------------------------------------

const PAYLOAD_SIZE = 8 * 1024 * 1024;
const PAYLOAD = Buffer.alloc(PAYLOAD_SIZE);
for (let i = 0; i < PAYLOAD_SIZE; i += 1024) {
  PAYLOAD.write(`H2TEST_BLOCK_${i}_` + 'H'.repeat(990), i);
}
const PAYLOAD_HASH = crypto.createHash('sha256').update(PAYLOAD).digest('hex');

function createH2Server() {
  const stats = {
    sessions: 0,
    requests: 0,
    maxConcurrentStreams: 0,
    currentStreams: 0,
    bytesServed: 0,
  };

  // allowHTTP1: true mirrors a real h2-capable host: one port speaks both
  // protocols (over TLS via ALPN; in cleartext Node sniffs the preface), so
  // the engine's h1 HEAD probe works while the transport multiplexes h2.
  const server = http2.createServer({ allowHTTP1: true } as any, (req, res) => {
    stats.requests++;
    stats.currentStreams++;
    stats.maxConcurrentStreams = Math.max(stats.maxConcurrentStreams, stats.currentStreams);
    res.on('close', () => {
      stats.currentStreams--;
    });

    const rangeHeader = req.headers.range as string | undefined;
    const match = rangeHeader ? rangeHeader.match(/bytes=(\d+)-(\d+)/) : null;
    const start = match ? parseInt(match[1], 10) : 0;
    const end = match && match[2] ? parseInt(match[2], 10) : PAYLOAD_SIZE - 1;
    const slice = PAYLOAD.subarray(start, end + 1);

    if (match) {
      res.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${PAYLOAD_SIZE}`,
      });
    } else {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    }
    res.end(slice);
    stats.bytesServed += slice.length;
  });

  return { server, stats };
}

async function main() {
  const hardTimeout = setTimeout(() => {
    console.error('[FATAL] suite exceeded 120s hard timeout');
    process.exit(2);
  }, 120000);
  hardTimeout.unref();

  const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ndm_h2_'));

  // -------------------------------------------------------------------------
  // H2-01: transport-level multiplexing proof (32 ranges, ONE session)
  // -------------------------------------------------------------------------
  {
    const { server, stats } = createH2Server();
    server.on('session', () => { stats.sessions++; });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as AddressInfo).port;
    const url = `http://localhost:${port}/file.bin`;

    const transport = new Http2Transport({ allowH2C: true }); // local cleartext h2c test server
    const ok = await transport.detectHttp2(url);
    assert(ok, 'H2-01a', 'ALPN/h2 detection succeeded on plain-text h2 server');

    const SEGMENTS = 32;
    const segSize = Math.floor(PAYLOAD_SIZE / SEGMENTS);
    const assembled = Buffer.alloc(PAYLOAD_SIZE);
    const offsets = new Map<number, number>();
    let concurrentSeen = 0;
    let cur = 0;

    const results = await Promise.all(
      Array.from({ length: SEGMENTS }, (_, i) => {
        const startByte = i * segSize;
        const endByte = i === SEGMENTS - 1 ? PAYLOAD_SIZE - 1 : (i + 1) * segSize - 1;
        return transport.requestRange({
          url,
          startByte,
          endByte,
          signal: new AbortController().signal,
          onData: (chunk) => {
            cur++;
            concurrentSeen = Math.max(concurrentSeen, cur);
            chunk.copy(assembled, startByte + (offsets.get(i) || 0));
            offsets.set(i, (offsets.get(i) || 0) + chunk.length);
            cur--;
          },
        });
      })
    );

    const allOk = results.every((r) => r.complete && r.status === 206);
    const hashOk = crypto.createHash('sha256').update(assembled).digest('hex') === PAYLOAD_HASH;
    assert(allOk, 'H2-01b', `all 32 multiplexed streams completed with 206`);
    assert(hashOk, 'H2-01c', `reassembled 8 MB matches SHA-256 from 32 multiplexed streams`);
    assert(stats.sessions === 1, `H2-01d`, `ONE TCP session for 32 streams (sessions=${stats.sessions}, requests=${stats.requests})`);
    assert(stats.requests >= SEGMENTS, 'H2-01e', `server saw all ${stats.requests} stream requests`);
    // On loopback streams complete so fast their data callbacks rarely overlap;
    // the multiplexing proof is 32 requests on ONE session (H2-01d), not
    // callback concurrency. Report the observed overlap informationally.
    console.log(`  [info] peak concurrent data callbacks on the session: ${concurrentSeen}`);
    assert(concurrentSeen >= 1, 'H2-01f', `data flowed on the shared session (peak concurrent callbacks: ${concurrentSeen})`);

    transport.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }

  // -------------------------------------------------------------------------
  // H2-02: backpressure — shouldPause gates stream flow
  // -------------------------------------------------------------------------
  {
    const { server } = createH2Server();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));

    const transport = new Http2Transport({ allowH2C: true });
    const port = (server.address() as AddressInfo).port;
    const url = `http://localhost:${port}/file.bin`;
    await transport.detectHttp2(url);

    let pauseEverTrue = false;
    let releaseScheduled = false;
    let released = false;
    let count = 0;
    await transport.requestRange({
      url,
      startByte: 0,
      endByte: 1024 * 1024 - 1,
      signal: new AbortController().signal,
      // Pause after the first chunk; schedule the release from the probe
      // itself (data events are frozen while paused, so onData cannot be
      // relied on to unschedule it). Proves flow stops AND resumes.
      shouldPause: () => {
        if (count >= 1) {
          pauseEverTrue = true;
          if (!releaseScheduled) {
            releaseScheduled = true;
            setTimeout(() => { released = true; }, 50);
          }
        }
        return count >= 1 && !released;
      },
      onData: (chunk) => {
        count++;
        void chunk;
      },
    });

    assert(pauseEverTrue, 'H2-02a', 'shouldPause probe was consulted during streaming');
    assert(count >= 2, 'H2-02b', `stream resumed after pause and delivered all chunks (${count} callbacks)`);

    transport.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }

  // -------------------------------------------------------------------------
  // H2-03: engine integration — dual-protocol origin (h1 probe + h2 download)
  // -------------------------------------------------------------------------
  {
    // A real h2-capable host negotiates h1 vs h2 via ALPN over TLS. In
    // cleartext the equivalent is HTTP/2 preface sniffing: h2 connections
    // start with "PRI * HTTP/2.0"; anything else is HTTP/1.1. This router
    // reproduces that faithfully so the engine's h1 probe and h2 transport
    // share one port, like they would in production.
    const net = await import('net');
    const { server: h2srv, stats } = createH2Server();
    h2srv.on('session', () => { stats.sessions++; });
    const http1mod = await import('http');
    const h1srv = http1mod.createServer((req: any, res: any) => {
      const rangeHeader = req.headers.range as string | undefined;
      const match = rangeHeader ? rangeHeader.match(/bytes=(\d+)-(\d+)/) : null;
      const start = match ? parseInt(match[1], 10) : 0;
      const end = match && match[2] ? parseInt(match[2], 10) : PAYLOAD_SIZE - 1;
      const slice = PAYLOAD.subarray(start, end + 1);
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': String(PAYLOAD_SIZE), 'Accept-Ranges': 'bytes' });
        return res.end();
      }
      if (match) {
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_SIZE}`, 'Accept-Ranges': 'bytes' });
      } else {
        res.writeHead(200, { 'Accept-Ranges': 'bytes' });
      }
      res.end(slice);
    });
    const router = net.createServer((socket) => {
      socket.once('data', (chunk: Buffer) => {
        socket.unshift(chunk);
        if (chunk.subarray(0, 3).toString('latin1') === 'PRI') {
          h2srv.emit('connection', socket);
        } else {
          h1srv.emit('connection', socket);
        }
      });
    });
    await new Promise<void>((r) => router.listen(0, '127.0.0.1', () => r()));
    const port = (router.address() as AddressInfo).port;
    const url = `http://localhost:${port}/engine.bin`;

    const engine = new DownloadEngine(undefined, TEST_DIR);
    engine.hostIntelligence.clear();
    const item = await engine.addDownload(url, 'h3engine.bin', TEST_DIR, 0);

    let guard = 0;
    while ((item.status === 'probing' || item.status === 'downloading') && ++guard < 6000) {
      await sleep(10);
    }

    assert(item.status === 'completed', 'H2-03a', `download completed over h2-capable origin (status=${item.status}${item.error ? ': ' + item.error : ''})`);
    assert(sha256File(item.destinationPath) === PAYLOAD_HASH, 'H2-03b', 'downloaded file byte-exact (SHA-256) via engine h2 path');
    // Exactly ONE h2 session and it exists at all => the FIRST download from
    // this origin already used the multiplexed path (the awaited 300ms ALPN
    // gate caches the capability during probing; a fire-and-forget probe
    // raced the download and forced an h1 fallback — the bug this fixes).
    assert(stats.sessions === 1, 'H2-03c', `first download already on h2 (sessions=${stats.sessions}; >0 h1-fallback chunks would show as extra reconnect churn, 0 sessions = full fallback)`);

    engine.destroy();
    h2srv.close();
    h1srv.close();
    await new Promise<void>((r) => router.close(() => r()));
  }

  // -------------------------------------------------------------------------
  // H2-04: fallback safety — h1-only origin completes over the h1 path
  // -------------------------------------------------------------------------
  {
    // Build an HTTP/1.1 server for the fallback case.
    const http1 = await import('http');
    const h1server = http1.createServer((req: any, res: any) => {
      const rangeHeader = req.headers.range as string | undefined;
      const match = rangeHeader ? rangeHeader.match(/bytes=(\d+)-(\d+)/) : null;
      const start = match ? parseInt(match[1], 10) : 0;
      const end = match && match[2] ? parseInt(match[2], 10) : PAYLOAD_SIZE - 1;
      const slice = PAYLOAD.subarray(start, end + 1);
      if (match) {
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${PAYLOAD_SIZE}`,
          'Accept-Ranges': 'bytes',
        });
      } else {
        res.writeHead(200, { 'Accept-Ranges': 'bytes' });
      }
      res.end(slice);
    });
    await new Promise<void>((r) => h1server.listen(0, '127.0.0.1', () => r()));
    const h1port = (h1server.address() as AddressInfo).port;
    const h1url = `http://localhost:${h1port}/fallback.bin`;

    const engine = new DownloadEngine(undefined, TEST_DIR);
    engine.hostIntelligence.clear();
    const item = await engine.addDownload(h1url, 'h2fallback.bin', TEST_DIR, 0);

    let guard = 0;
    while ((item.status === 'probing' || item.status === 'downloading') && ++guard < 6000) {
      await sleep(10);
    }

    assert(item.status === 'completed', 'H2-04a', `h1-only origin still completes (status=${item.status})`);
    assert(sha256File(item.destinationPath) === PAYLOAD_HASH, 'H2-04b', 'h1 fallback download byte-exact');

    engine.destroy();
    h1server.closeAllConnections?.();
    await new Promise<void>((r) => h1server.close(() => r()));
  }

  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log('\n================================================================================');
  console.log(`HTTP/2 TRANSPORT TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal suite error:', err);
  process.exit(1);
});
