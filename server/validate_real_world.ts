/**
 * Real-world validation: tuned NDM engine vs a plain single-stream download,
 * against a live public server (files.pythonhosted.org — PyPI's Fastly CDN).
 *
 * DATA BUDGET GUARANTEE: hard-capped at 20 MB total (script aborts before
 * starting if the target is too large, and counts every byte received).
 * Target: lxml-5.2.1-cp312-cp312-win_amd64.whl (~3.6 MB) downloaded twice
 * — ~7.3 MB total.
 *
 * Integrity: verified against the sha256 digest published by PyPI's own
 * JSON API — an independent source, not our own download.
 *
 * Run: npx tsx server/validate_real_world.ts
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DownloadEngine } from './engine';

const TARGET_URL = 'https://files.pythonhosted.org/packages/37/a5/7b2e6152aefa0632871f77a202bb68eac52037e4498a6901be0f0458ffdc/lxml-5.2.1-cp312-cp312-win_amd64.whl';
// From PyPI's JSON API (https://pypi.org/pypi/lxml/5.2.1/json, digests.sha256)
// for the file above — an independent, publisher-authoritative source.
const EXPECTED_SHA256_HEX = 'f2a9efc53d5b714b8df2b4b3e992accf8ce5bbdfe544d74d5c6766c9e1146a3a';
const BUDGET_BYTES = 20 * 1024 * 1024;

let bundleSpent = 0;

function fail(msg: string): never {
  console.error(`[ABORT] ${msg}`);
  process.exit(1);
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function headContentLength(url: string): Promise<number> {
  // Probe with a 1-byte ranged GET and read the total out of Content-Range:
  // works whether or not the server sends Content-Length on HEAD.
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers: { Range: 'bytes=0-0' } }, (res) => {
      let spent = 0;
      res.on('data', (c: Buffer) => { spent += c.length; bundleSpent += c.length; });
      res.on('end', () => {
        const cr = String(res.headers['content-range'] || '');
        const m = cr.match(/\/(\d+)$/);
        if (res.statusCode === 206 && m) return resolve(parseInt(m[1], 10));
        const cl = parseInt(String(res.headers['content-length'] || '0'), 10);
        if (cl) return resolve(cl);
        reject(new Error(`Probe failed: HTTP ${res.statusCode}, no size headers (spent ${spent}B)`));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/** Plain single-stream browser-style download (the baseline). */
function singleStreamDownload(url: string, destPath: string): Promise<{ bytes: number; durationSec: number }> {
  return new Promise((resolve, reject) => {
    const startTime = process.hrtime.bigint();
    let bytes = 0;
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`GET HTTP ${res.statusCode}`));
      }
      const out = fs.createWriteStream(destPath);
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        bundleSpent += chunk.length;
        if (bundleSpent > BUDGET_BYTES) {
          req.destroy();
          out.destroy();
          reject(new Error('Data budget exceeded'));
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        const durationSec = Number(process.hrtime.bigint() - startTime) / 1e9;
        resolve({ bytes, durationSec });
      });
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function main() {
  const hardTimeout = setTimeout(() => {
    console.error('[ABORT] Hard timeout after 180s');
    process.exit(2);
  }, 180000);
  hardTimeout.unref();

  console.log('================================================================');
  console.log('   REAL-WORLD VALIDATION: NDM vs plain single-stream download');
  console.log('   Target: files.pythonhosted.org (live internet, PyPI Fastly CDN)');
  console.log(`   Data budget: 20 MB hard cap (abort-exceeds)`);
  console.log('================================================================\n');

  const size = await headContentLength(TARGET_URL);
  console.log(`Target size: ${(size / (1024 * 1024)).toFixed(2)} MB`);
  if (size * 2 + 1024 * 1024 > BUDGET_BYTES) {
    fail(`Target too large for the 20 MB budget (needs ~${((size * 2) / 1048576).toFixed(1)} MB).`);
  }

  const tmpDir = path.join(os.tmpdir(), 'ndm_real_validation_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // ---- Baseline: plain single-stream ----
    console.log('\n[1/2] Plain single-stream download (browser-style baseline)...');
    const baseDest = path.join(tmpDir, 'lxml-5.2.1-cp312-cp312-win_amd64.plain.whl');
    const base = await singleStreamDownload(TARGET_URL, baseDest);
    console.log(`  ${(base.bytes / (1024 * 1024)).toFixed(2)} MB in ${base.durationSec.toFixed(2)}s  =>  ${(base.bytes / base.durationSec / (1024 * 1024)).toFixed(2)} MB/s`);
    if (base.bytes !== size) {
      fail(`Baseline received ${base.bytes} bytes, expected ${size} (flaky network or budget abort).`);
    }
    const baseOk = sha256File(baseDest) === EXPECTED_SHA256_HEX;
    console.log(`  Integrity (sha256 vs PyPI JSON API): ${baseOk ? 'OK' : `FAIL (got ${sha256File(baseDest) || 'unreadable-file'})`}`);

    // ---- NDM: real engine, Auto mode, production SSRF posture ----
    console.log('\n[2/2] NDM engine (Auto streams, production mode)...');
    const engine = new DownloadEngine(undefined, tmpDir, undefined, { allowLocalhost: false });
    const startTime = process.hrtime.bigint();
    const item = await engine.addDownload(TARGET_URL, 'lxml-5.2.1-cp312-cp312-win_amd64.ndm.whl', tmpDir, 0);

    let guard = 0;
    while (item.status === 'probing' || item.status === 'downloading' || item.status === 'queued') {
      await sleep(5);
      if (++guard > 60000) break;
    }
    const durationSec = Number(process.hrtime.bigint() - startTime) / 1e9;
    bundleSpent += item.downloadedBytes;

    if (item.status !== 'completed') {
      fail(`NDM download ended with status=${item.status} error=${item.error || 'none'}`);
    }
    // Report which transport the engine used: the ALPN probe caches
    // supportsHttp2 per origin during probing (server/h2_client.ts).
    const caps = engine.hostIntelligence.getCapabilities(TARGET_URL) as unknown as { supportsHttp2?: boolean } | null;
    const transport = caps?.supportsHttp2 ? 'HTTP/2 (multiplexed)' : 'HTTP/1.1';
    console.log(`  ${(item.downloadedBytes / (1024 * 1024)).toFixed(2)} MB in ${durationSec.toFixed(2)}s  =>  ${(item.downloadedBytes / durationSec / (1024 * 1024)).toFixed(2)} MB/s  (${item.connections} streams, ${item.chunks.length} chunks, transport: ${transport})`);
    const ndmHash = sha256File(item.destinationPath);
    const ndmOk = ndmHash === EXPECTED_SHA256_HEX;
    console.log(`  Integrity (sha256 vs PyPI JSON API): ${ndmOk ? 'OK' : `FAIL (got ${ndmHash || 'unreadable-file'})`}`);

    // ---- Verdict ----
    const baseMps = base.bytes / base.durationSec / (1024 * 1024);
    const ndmMps = item.downloadedBytes / durationSec / (1024 * 1024);
    console.log('\n================================================================');
    console.log('                           VERDICT');
    console.log('================================================================');
    console.log(`  Plain single-stream : ${baseMps.toFixed(2)} MB/s  integrity ${baseOk ? 'OK' : 'FAIL'}`);
    console.log(`  NDM (tuned engine)  : ${ndmMps.toFixed(2)} MB/s  integrity ${ndmOk ? 'OK' : 'FAIL'}`);
    if (ndmMps >= baseMps) {
      console.log(`  NDM is ${(ndmMps / baseMps).toFixed(2)}x faster on the live CDN.`);
    } else {
      console.log(`  NDM is ${(baseMps / ndmMps).toFixed(2)}x slower on the live CDN (single-CDN RTT may favor one stream).`);
    }
    console.log(`  Data bundle spent: ${(bundleSpent / (1024 * 1024)).toFixed(2)} MB of the 20 MB budget.`);

    engine.destroy();
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Validation failed:', err);
    console.error(`Data bundle spent before failure: ${(bundleSpent / (1024 * 1024)).toFixed(2)} MB`);
    process.exit(1);
  });
