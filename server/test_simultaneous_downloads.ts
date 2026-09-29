import assert from 'assert';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { DownloadEngine } from './engine';

console.log('========================================================================');
console.log('       SIMULTANEOUS DOWNLOADS & UNLIMITED QUEUEING TEST SUITE           ');
console.log('========================================================================\n');

async function run() {
  const testDir = path.join(os.tmpdir(), `hyper_test_simultaneous_${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });

  // 1. Mock HTTP Server
  const mockServer = http.createServer((_req, res) => {
    res.writeHead(200, {
      'Content-Length': '1024',
      'Content-Type': 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    });
    res.end(Buffer.alloc(1024, 0x41));
  });

  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (mockServer.address() as any).port;
  const testUrl = `http://127.0.0.1:${port}/test.bin`;

  try {
    // 2. Initialize Engine with allowLocalhost
    const engine = new DownloadEngine(() => {}, testDir, 1024 * 1024, { allowLocalhost: true });

    // Test 1: Default concurrency is 0 (Unlimited)
    console.log('[Test 1] Verifying default concurrency is Unlimited (0)...');
    assert.strictEqual(engine.maxConcurrentDownloads, 0, 'SIM-01: Default maxConcurrentDownloads should be 0 (unlimited)');
    console.log('[PASS] SIM-01: Default maxConcurrentDownloads is 0 (unlimited)\n');

    // Test 2: Adding multiple downloads with 0 limit does not queue
    console.log('[Test 2] Adding downloads with unlimited setting...');
    const d1 = await engine.addDownload(`${testUrl}?row=d1`, 'd1.bin', testDir, 1);
    const d2 = await engine.addDownload(`${testUrl}?row=d2`, 'd2.bin', testDir, 1);
    const d3 = await engine.addDownload(`${testUrl}?row=d3`, 'd3.bin', testDir, 1);

    assert.notStrictEqual(d1.status, 'queued', 'SIM-02a: d1 should not be queued');
    assert.notStrictEqual(d2.status, 'queued', 'SIM-02b: d2 should not be queued');
    assert.notStrictEqual(d3.status, 'queued', 'SIM-02c: d3 should not be queued');
    console.log('[PASS] SIM-02: All downloads initiate without artificial queuing under unlimited mode\n');

    // Test 3: Setting a custom limit (e.g. 2)
    console.log('[Test 3] Setting simultaneous limit to 2...');
    engine.setMaxConcurrentDownloads(2);
    assert.strictEqual(engine.maxConcurrentDownloads, 2, 'SIM-03: Concurrency limit set to 2');

    // Pause all current downloads to reset active count
    await engine.pauseDownload(d1.id);
    await engine.pauseDownload(d2.id);
    await engine.pauseDownload(d3.id);

    // Add 3 new downloads with limit = 2
    const q1 = await engine.addDownload(`${testUrl}?row=q1`, 'q1.bin', testDir, 1);
    const q2 = await engine.addDownload(`${testUrl}?row=q2`, 'q2.bin', testDir, 1);
    const q3 = await engine.addDownload(`${testUrl}?row=q3`, 'q3.bin', testDir, 1);

    assert.notStrictEqual(q1.status, 'queued', 'SIM-04a: First download should be active');
    assert.notStrictEqual(q2.status, 'queued', 'SIM-04b: Second download should be active');
    assert.strictEqual(q3.status, 'queued', 'SIM-04c: Third download should be queued');
    console.log('[PASS] SIM-04: Third download placed in queue when limit of 2 is reached\n');

    // Test 4: Freeing an active slot automatically starts the queued item
    console.log('[Test 4] Pausing active download to test auto-start of queued item...');
    await engine.pauseDownload(q1.id);
    await new Promise((r) => setTimeout(r, 100));

    assert.notStrictEqual(q3.status, 'queued', 'SIM-05: Queued download automatically started when slot freed');
    console.log('[PASS] SIM-05: Queued item automatically started when slot opened\n');

    // Test 5: Changing limit to Unlimited (0) releases all queued items
    console.log('[Test 5] Adding more items then switching to Unlimited (0)...');
    engine.setMaxConcurrentDownloads(1);
    const extra1 = await engine.addDownload(`${testUrl}?row=extra1`, 'extra1.bin', testDir, 1);
    const extra2 = await engine.addDownload(`${testUrl}?row=extra2`, 'extra2.bin', testDir, 1);

    // Switch to unlimited
    engine.setMaxConcurrentDownloads(0);
    await new Promise((r) => setTimeout(r, 100));

    assert.notStrictEqual(extra1.status, 'queued', 'SIM-06a: extra1 active after unlimited switch');
    assert.notStrictEqual(extra2.status, 'queued', 'SIM-06b: extra2 active after unlimited switch');
    console.log('[PASS] SIM-06: Switching to unlimited instantly wakes and starts all queued downloads\n');

    console.log('========================================================================');
    console.log('SIMULTANEOUS DOWNLOADS TEST RESULTS: ALL 6 TESTS PASSED');
    console.log('========================================================================');
  } finally {
    mockServer.close();
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  }
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
