import { DownloadEngine } from './engine';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

async function runTest() {
  console.log('=== Starting HyperDownloader Engine Benchmark ===');
  
  // Test File: 25MB high-speed test binary from Speedtest CDN
  const testUrl = 'https://speed.cloudflare.com/__down?bytes=25000000';
  
  const engine = new DownloadEngine(() => {
    // Engine update listener
  });

  console.log(`[Test] Probing and initiating 32-thread download from: ${testUrl}`);
  const startTime = Date.now();
  
  const item = await engine.addDownload(testUrl, 'cloudflare_25mb_test.bin', undefined, 32);
  
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
  
  // Verify file on disk
  const filePath = item.destinationPath;
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    console.log(`[Disk Verification] File exists at: ${filePath}`);
    console.log(`[Disk Verification] Exact Size: ${stats.size} bytes (${(stats.size / (1024*1024)).toFixed(2)} MB)`);
    
    // Clean test file
    fs.unlinkSync(filePath);
    console.log('[Cleanup] Test file removed.');
  }

  process.exit(0);
}

runTest().catch(err => {
  console.error('[Benchmark Error]:', err);
  process.exit(1);
});
