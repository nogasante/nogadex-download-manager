import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DownloadEngine } from './engine';
import { verifyFile, expectedHashFor, generateDeterministicBuffer } from './integrity_scanner';

/**
 * Phase 10.8 — Integrity Scanner
 *
 * IS-01  Known registry file (LCG seed 101) verifies byte-exact with the
 *        independently computed expected hash.
 * IS-02  A flipped byte in a known file is detected as mismatch with
 *        differing expected/actual hashes.
 * IS-03  Unknown content is "unverified" on first scan, stays unverified
 *        while unchanged, and becomes "mismatch" (baseline drift) when the
 *        content changes.
 * IS-04  A file missing on disk reports "missing".
 * IS-05  Engine scanIntegrity() walks only completed rows and records
 *        verdicts on item.integrity.
 * IS-06  The baseline ledger survives an engine restart: drift across
 *        restarts is still detected.
 */

const TEST_DIR = path.join(os.tmpdir(), 'hyper_integrity_scan_tests');
fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(TEST_DIR, { recursive: true });

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
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

async function runTests() {
  console.log('========================================================================');
  console.log('        HYPERDOWNLOADER PHASE 10.8 INTEGRITY SCANNER SUITE             ');
  console.log('========================================================================');

  // Independent reference hash: same LCG as scripts/test_file_server.mjs.
  const REF_SMALL = (() => {
    const buf = Buffer.alloc(128 * 1024);
    let state = 101;
    for (let i = 0; i < buf.length; i++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      buf[i] = state & 0xff;
    }
    return sha256(buf);
  })();

  // Scanner-internal consistency: generator + expectedHashFor agree with ref.
  assert(
    sha256(generateDeterministicBuffer(128 * 1024, 101)) === REF_SMALL &&
      expectedHashFor(128 * 1024, 101) === REF_SMALL,
    'IS-00',
    'Generator registry reproduces the reference LCG hash for seed 101'
  );

  // -------------------------------------------------------------------------
  // IS-01: known file verifies byte-exact.
  // -------------------------------------------------------------------------
  {
    const dir = path.join(TEST_DIR, 'is01');
    fs.mkdirSync(dir, { recursive: true });
    const good = generateDeterministicBuffer(128 * 1024, 101);
    fs.writeFileSync(path.join(dir, 'small.zip'), good);
    const v = verifyFile(path.join(dir, 'small.zip'), 'x1', 'small.zip');
    assert(
      v.status === 'verified' && v.actualSha256 === REF_SMALL && v.expectedSha256 === REF_SMALL,
      'IS-01',
      'Registry file verified byte-exact against the reference hash'
    );
  }

  // -------------------------------------------------------------------------
  // IS-02: one flipped byte → mismatch with differing hashes.
  // -------------------------------------------------------------------------
  {
    const dir = path.join(TEST_DIR, 'is02');
    fs.mkdirSync(dir, { recursive: true });
    const bad = generateDeterministicBuffer(128 * 1024, 101);
    bad[7777] ^= 0xff;
    fs.writeFileSync(path.join(dir, 'small.zip'), bad);
    const v = verifyFile(path.join(dir, 'small.zip'), 'x2', 'small.zip');
    assert(
      v.status === 'mismatch' && v.expectedSha256 === REF_SMALL && v.actualSha256 !== REF_SMALL,
      'IS-02',
      'Single flipped byte detected as mismatch with expected/actual hashes'
    );
  }

  // -------------------------------------------------------------------------
  // IS-03 + IS-05: unknown content lifecycle via the engine.
  // -------------------------------------------------------------------------
  {
    const dir = path.join(TEST_DIR, 'is03');
    fs.mkdirSync(dir, { recursive: true });
    const engine = new DownloadEngine(undefined, dir);
    const target = path.join(dir, 'unknown.bin');

    // Create a COMPLETED row manually (no server needed): write the file and
    // register the row as completed.
    fs.writeFileSync(target, Buffer.from('v1-content', 'utf8'));
    const item: any = {
      id: 'hyp_is03',
      url: 'http://localhost:1/unknown.bin',
      filename: 'unknown.bin',
      destinationPath: target,
      totalBytes: fs.statSync(target).size,
      downloadedBytes: fs.statSync(target).size,
      status: 'completed',
      speedBps: 0,
      connections: 1,
      chunks: [],
      resumable: true,
      etaSeconds: 0,
      createdAt: Date.now(),
    };
    (engine as any).downloads.set(item.id, item);
    engine.saveState();

    const r1 = await engine.scanIntegrity();
    assert(
      r1.scanned === 1 && r1.unverified === 1 && r1.results[0].status === 'unverified' && !!r1.results[0].actualSha256,
      'IS-03a',
      'Unknown content scanned as unverified with a recorded actual hash'
    );
    assert(
      item.integrity?.status === 'unverified',
      'IS-05a',
      'Verdict recorded on item.integrity after scan'
    );

    // Unchanged second scan: still unverified (no drift).
    const r2 = await engine.scanIntegrity();
    assert(r2.unverified === 1 && r2.mismatch === 0, 'IS-03b', 'Unchanged content re-scans clean (no false drift)');

    // Modify content: baseline drift must upgrade to mismatch.
    fs.writeFileSync(target, Buffer.from('v2-CHANGED', 'utf8'));
    const r3 = await engine.scanIntegrity();
    assert(
      r3.mismatch === 1 && r3.results[0].status === 'mismatch' && r3.results[0].error?.includes('baseline drift'),
      'IS-03c',
      'Changed unknown content detected via baseline drift (mismatch)'
    );
    engine.destroy();
  }

  // -------------------------------------------------------------------------
  // IS-04: missing file.
  // -------------------------------------------------------------------------
  {
    const dir = path.join(TEST_DIR, 'is04');
    fs.mkdirSync(dir, { recursive: true });
    const v = verifyFile(path.join(dir, 'gone.zip'), 'x4', 'small.zip');
    assert(v.status === 'missing', 'IS-04', 'File absent on disk reported as missing');
  }

  // -------------------------------------------------------------------------
  // IS-06: ledger survives engine restart.
  // -------------------------------------------------------------------------
  {
    const dir = path.join(TEST_DIR, 'is06');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'drift.bin');
    fs.writeFileSync(target, Buffer.from('original', 'utf8'));

    const engine1 = new DownloadEngine(undefined, dir);
    const item: any = {
      id: 'hyp_is06',
      url: 'http://localhost:1/drift.bin',
      filename: 'drift.bin',
      destinationPath: target,
      totalBytes: 8,
      downloadedBytes: 8,
      status: 'completed',
      speedBps: 0,
      connections: 1,
      chunks: [],
      resumable: true,
      etaSeconds: 0,
      createdAt: Date.now(),
    };
    (engine1 as any).downloads.set(item.id, item);
    engine1.saveState();
    await engine1.scanIntegrity();
    engine1.destroy();

    // Restart on the same dir (loads state + ledger), then change content.
    const engine2 = new DownloadEngine(undefined, dir);
    const restored = (engine2 as any).downloads.get('hyp_is06');
    assert(!!restored, 'IS-06a', 'Row restored after restart');
    fs.writeFileSync(target, Buffer.from('mutated!', 'utf8'));
    const r = await engine2.scanIntegrity();
    assert(
      r.mismatch === 1 && r.results[0].status === 'mismatch' && r.results[0].error?.includes('baseline drift'),
      'IS-06b',
      'Drift detected across engine restart via persisted ledger'
    );
    engine2.destroy();
  }

  console.log('========================================================================');
  console.log(`INTEGRITY SCAN TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

(async () => {
  try {
    await runTests();
  } catch (err) {
    console.error('Fatal integrity-scan test error:', err);
    process.exit(1);
  }
})();
