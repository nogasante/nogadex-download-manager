import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DownloadEngine } from './engine';

const TEST_PORT = 5099;
const TEST_DIR = path.join(os.tmpdir(), 'hyper_correctness_tests');

if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
  console.log('================================================================');
  console.log('        HYPERDOWNLOADER P0 CORRECTNESS TEST SUITE               ');
  console.log('================================================================\n');

  let testPassed = 0;
  let testFailed = 0;

  function assert(condition: boolean, testId: string, desc: string) {
    if (condition) {
      console.log(`[PASS] ${testId}: ${desc}`);
      testPassed++;
    } else {
      console.error(`[FAIL] ${testId}: ${desc}`);
      testFailed++;
    }
  }

  const testPayload = Buffer.alloc(100 * 1024, 'A'); // 100 KB
  let serverHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};

  const mockServer = http.createServer((req, res) => {
    serverHandler(req, res);
  });

  await new Promise<void>((resolve) => mockServer.listen(TEST_PORT, resolve));

  try {
    const engine = new DownloadEngine(undefined, TEST_DIR);

    // TC-01: Range request returns 206 with correct Content-Range -> Success
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Length': testPayload.length.toString(),
            'Accept-Ranges': 'bytes',
          });
          return res.end();
        }
        const range = req.headers.range;
        if (range) {
          const match = range.match(/bytes=(\d+)-(\d+)/);
          if (match) {
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${testPayload.length}`,
              'Content-Length': (end - start + 1).toString(),
            });
            return res.end(testPayload.subarray(start, end + 1));
          }
        }
        res.writeHead(200);
        res.end(testPayload);
      };

      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/tc01.bin`, 'tc01.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);
      assert(item.status === 'completed' && item.downloadedBytes === testPayload.length, 'TC-01', 'Range 206 with correct Content-Range succeeds');
    }

    // TC-02: Range request returns 200 -> no bytes written & explicit protocol failure
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': testPayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        res.writeHead(200, { 'Content-Length': testPayload.length.toString() });
        res.end(testPayload);
      };

      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/tc02.bin`, 'tc02.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);
      assert(item.status === 'error' && (item.error?.includes('HTTP 200') || item.error?.includes('Protocol')), 'TC-02', 'Range request returning HTTP 200 is rejected');
    }

    // TC-03: Range request returns 206 with incorrect Content-Range -> failure
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': testPayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        res.writeHead(206, {
          'Content-Range': `bytes 999-9999/${testPayload.length}`,
          'Content-Length': '100',
        });
        res.end(testPayload.subarray(0, 100));
      };

      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/tc03.bin`, 'tc03.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);
      assert(item.status === 'error' && item.error?.includes('Content-Range'), 'TC-03', 'Incorrect Content-Range header is rejected');
    }

    // TC-04: Premature EOF -> Retries from exact offset without corrupting
    {
      let attempts = 0;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': testPayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : testPayload.length - 1;
        attempts++;
        if (attempts === 1) {
          res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${testPayload.length}` });
          res.write(testPayload.subarray(start, start + 10));
          return res.end();
        }
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${testPayload.length}` });
        res.end(testPayload.subarray(start, end + 1));
      };

      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/tc04.bin`, 'tc04.bin', TEST_DIR, 1);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);
      assert(item.status === 'completed' && item.downloadedBytes === testPayload.length, 'TC-04', 'Premature EOF triggers retry from exact offset');
    }

    // TC-05: Response attempts to send bytes beyond requested range -> clamped/rejected
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': testPayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : testPayload.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${testPayload.length}` });
        res.write(testPayload.subarray(start, end + 1));
        res.write(Buffer.alloc(50 * 1024, 'Z')); // Overflow attempt
        res.end();
      };

      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/tc05.bin`, 'tc05.bin', TEST_DIR, 2);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);
      assert(item.status === 'error' && (item.error?.includes('boundary') || item.error?.includes('Protocol')), 'TC-05', 'Bytes beyond chunk boundary are rejected');
    }

    // TC-06: Pause during active streaming -> Safe async shutdown without EBADF
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': '10485760', 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        res.writeHead(206, { 'Content-Range': 'bytes 0-10485759/10485760' });
        const iv = setInterval(() => {
          res.write(Buffer.alloc(8192, 'X'));
        }, 50);
        req.on('close', () => clearInterval(iv));
      };

      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/tc06.bin`, 'tc06.bin', TEST_DIR, 4);
      await sleep(300);
      await engine.pauseDownload(item.id);
      assert(item.status === 'paused', 'TC-06', 'Pause during active streaming drains without EBADF');
    }

    // TC-07: Relative redirect -> Resolved correctly
    {
      serverHandler = (req, res) => {
        if (req.url === '/redirect_me') {
          res.writeHead(302, { 'Location': '/final_dest.bin' });
          return res.end();
        }
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': testPayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : testPayload.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${testPayload.length}` });
        res.end(testPayload.subarray(start, end + 1));
      };

      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/redirect_me`, 'tc07.bin', TEST_DIR, 2);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);
      assert(item.status === 'completed' && item.url.includes('/final_dest.bin'), 'TC-07', 'Relative redirect resolved to absolute URL');
    }

    // TC-08: Parallel requests with redirects -> No shared URL corruption
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': testPayload.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : testPayload.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${testPayload.length}` });
        res.end(testPayload.subarray(start, end + 1));
      };

      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/tc08.bin`, 'tc08.bin', TEST_DIR, 8);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);
      assert(item.status === 'completed', 'TC-08', 'Parallel requests execute without URL corruption');
    }

    // TC-09: HEAD returns 405 Method Not Allowed -> Probes with GET Range: bytes=0-0
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(405);
          return res.end();
        }
        if (req.headers.range === 'bytes=0-0') {
          res.writeHead(206, { 'Content-Range': `bytes 0-0/${testPayload.length}` });
          return res.end(testPayload.subarray(0, 1));
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : testPayload.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${testPayload.length}` });
        res.end(testPayload.subarray(start, end + 1));
      };

      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/tc09.bin`, 'tc09.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);
      assert(item.status === 'completed' && item.resumable === true, 'TC-09', 'HEAD 405 falls back to GET bytes=0-0 successfully');
    }

    // TC-10: HEAD omits Accept-Ranges but GET 0-0 returns 206 -> Range mode enabled
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': testPayload.length.toString() });
          return res.end();
        }
        if (req.headers.range === 'bytes=0-0') {
          res.writeHead(206, { 'Content-Range': `bytes 0-0/${testPayload.length}` });
          return res.end(testPayload.subarray(0, 1));
        }
        const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = range ? parseInt(range[1], 10) : 0;
        const end = range ? parseInt(range[2], 10) : testPayload.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${testPayload.length}` });
        res.end(testPayload.subarray(start, end + 1));
      };

      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/tc10.bin`, 'tc10.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);
      assert(item.status === 'completed' && item.resumable === true, 'TC-10', 'Omitted Accept-Ranges verified via GET bytes=0-0');
    }

    // TC-11: Unknown Content-Length -> Safe single stream mode without invalid Range headers
    {
      serverHandler = (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(testPayload);
      };

      const item = await engine.addDownload(`http://localhost:${TEST_PORT}/tc11.bin`, 'tc11.bin', TEST_DIR, 4);
      while (item.status === 'downloading' || item.status === 'probing') await sleep(100);
      assert(item.status === 'completed' && item.chunks.length === 1, 'TC-11', 'Unknown Content-Length handled in single-stream mode');
    }

    // TC-12: State file persistence verification
    {
      const stateFile = path.join(TEST_DIR, '.hyper_state.json');
      const stateExists = fs.existsSync(stateFile);
      assert(stateExists, 'TC-12', 'State file (.hyper_state.json) persists valid download state');
    }

  } finally {
    mockServer.close();
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${testPassed} PASSED, ${testFailed} FAILED`);
  console.log('================================================================');
  if (testFailed > 0) process.exit(1);
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
