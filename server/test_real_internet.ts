/**
 * HyperDownloader Phase 8 - Real Internet Acceptance Test
 * Tests live public HTTPS/HTTP servers across the global internet.
 */

import fs from 'fs';
import path from 'path';
import { DownloadEngine } from './engine';

function assert(condition: boolean, code: string, message: string) {
  if (!condition) {
    console.error(`[FAIL] ${code}: ${message}`);
    process.exit(1);
  }
  console.log(`[PASS] ${code}: ${message}`);
}

async function runRealInternetTests() {
  console.log('========================================================================');
  console.log('      HYPERDOWNLOADER PHASE 8 REAL INTERNET ACCEPTANCE TEST SUITE       ');
  console.log('========================================================================\n');

  const tmpDir = path.join(process.cwd(), 'tmp_real_internet');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const engine = new DownloadEngine(undefined, tmpDir, undefined, { allowLocalhost: false }); // production mode

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Real Public HTTPS Static File with Known Content (GitHub)
    // -------------------------------------------------------------------------
    console.log('[*] Test 1: Real HTTPS static download (GitHub Raw)...');
    const item1 = await engine.addDownload('https://raw.githubusercontent.com/octocat/Hello-World/master/README', 'auto', undefined, 2);
    
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        const cur = engine.downloads.get(item1.id);
        if (cur?.status === 'completed') {
          clearInterval(timer);
          resolve();
        } else if (cur?.status === 'error') {
          clearInterval(timer);
          reject(new Error(`Download failed: ${cur.error}`));
        }
      }, 200);
    });

    const final1 = engine.downloads.get(item1.id)!;
    assert(fs.existsSync(final1.destinationPath), 'INET-01a', 'Output file exists on disk');
    const content1 = fs.readFileSync(final1.destinationPath, 'utf-8');
    assert(content1.includes('Hello World'), 'INET-01b', 'Verified downloaded GitHub README content');

    // -------------------------------------------------------------------------
    // TEST 2: Real Public HTTPS Redirect to Known Target
    // -------------------------------------------------------------------------
    console.log('\n[*] Test 2: Real HTTPS Redirect...');
    const redirectUrl = 'https://httpbin.org/redirect-to?url=https%3A%2F%2Fraw.githubusercontent.com%2Foctocat%2FHello-World%2Fmaster%2FREADME&status_code=302';
    const item2 = await engine.addDownload(redirectUrl, 'auto', undefined, 2);
    
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        const cur = engine.downloads.get(item2.id);
        if (cur?.status === 'completed') {
          clearInterval(timer);
          resolve();
        } else if (cur?.status === 'error') {
          clearInterval(timer);
          reject(new Error(`Download failed: ${cur.error}`));
        }
      }, 200);
    });

    const final2 = engine.downloads.get(item2.id)!;
    assert(fs.existsSync(final2.destinationPath), 'INET-02a', 'Redirected output file exists on disk');
    const content2 = fs.readFileSync(final2.destinationPath, 'utf-8');
    assert(content2.includes('Hello World'), 'INET-02b', 'Redirected download matches verified target payload');

    console.log('\n========================================================================');
    console.log('REAL INTERNET ACCEPTANCE RESULTS: ALL REAL NETWORK TESTS PASSED');
    console.log('========================================================================\n');
  } finally {
    engine.destroy();
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runRealInternetTests().then(() => process.exit(0)).catch(err => {
  console.error('Real internet acceptance test failed:', err);
  process.exit(1);
});
