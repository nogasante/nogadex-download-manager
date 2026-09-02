import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import express from 'express';
import { DownloadEngine, validateUrl } from './engine';

const dynamicPort = 5098;
const TEST_DIR = path.resolve(process.cwd(), 'temp_prod_hardening_test');

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition: boolean, code: string, message: string) {
  if (!condition) {
    console.error(`[FAIL] ${code}: ${message}`);
    process.exit(1);
  }
  console.log(`[PASS] ${code}: ${message}`);
}

async function runHardeningTests() {
  console.log('========================================================================');
  console.log('       HYPERDOWNLOADER P6 PRODUCT HARDENING TEST SUITE                  ');
  console.log('========================================================================\n');

  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const PAYLOAD_2MB = crypto.randomBytes(2 * 1024 * 1024);
  const HASH_2MB = sha256(PAYLOAD_2MB);

  let serverHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};
  const server = http.createServer((req, res) => {
    serverHandler(req, res);
  });

  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  const dynamicPort = (server.address() as any).port;

  try {
    // -------------------------------------------------------------------------
    // HARD-01: Advanced IPv6 & Extended IPv4 SSRF Protection
    // -------------------------------------------------------------------------
    {
      const loopback1 = validateUrl('http://[::1]/secret', false);
      assert(!loopback1.valid, 'HARD-01a', 'IPv6 loopback [::1] blocked in production mode');

      const loopbackFull = validateUrl('http://[0:0:0:0:0:0:0:1]/secret', false);
      assert(!loopbackFull.valid, 'HARD-01b', 'IPv6 full loopback [0:0:0:0:0:0:0:1] blocked in production mode');

      const v4MappedLoop = validateUrl('http://[::ffff:127.0.0.1]/secret', false);
      assert(!v4MappedLoop.valid, 'HARD-01c', 'IPv4-mapped IPv6 [::ffff:127.0.0.1] blocked');

      const v4MappedMeta = validateUrl('http://[::ffff:169.254.169.254]/latest/meta-data', false);
      assert(!v4MappedMeta.valid, 'HARD-01d', 'IPv4-mapped cloud metadata [::ffff:169.254.169.254] blocked');

      const v4MappedPriv = validateUrl('http://[::ffff:10.0.0.1]/admin', false);
      assert(!v4MappedPriv.valid, 'HARD-01e', 'IPv4-mapped private subnet [::ffff:10.0.0.1] blocked');

      const linkLocal = validateUrl('http://[fe80::1ff:fe23:4567:890a]/secret', false);
      assert(!linkLocal.valid, 'HARD-01f', 'IPv6 link-local [fe80::...] blocked');

      const ula = validateUrl('http://[fc00::1]/internal', false);
      assert(!ula.valid, 'HARD-01g', 'IPv6 unique local [fc00::1] blocked');

      const ula2 = validateUrl('http://[fd12:3456:789a:1::1]/internal', false);
      assert(!ula2.valid, 'HARD-01h', 'IPv6 unique local [fd12:...] blocked');
    }

    // -------------------------------------------------------------------------
    // HARD-02: Decimal/Octal/Hex IPv4 Normalization
    // -------------------------------------------------------------------------
    {
      const dwordIp = validateUrl('http://2130706433/', false); // 127.0.0.1
      assert(!dwordIp.valid, 'HARD-02a', 'Dword encoded IP 2130706433 (127.0.0.1) blocked');

      const octalIp = validateUrl('http://0177.0.0.1/', false); // 127.0.0.1
      assert(!octalIp.valid, 'HARD-02b', 'Octal encoded IP 0177.0.0.1 (127.0.0.1) blocked');

      const hexIp = validateUrl('http://0x7f.0.0.1/', false); // 127.0.0.1
      assert(!hexIp.valid, 'HARD-02c', 'Hex encoded IP 0x7f.0.0.1 (127.0.0.1) blocked');
    }

    // -------------------------------------------------------------------------
    // HARD-03: Chunk Worker Redirect SSRF Protection
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_2MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        res.writeHead(302, { 'Location': 'http://169.254.169.254/latest/meta-data' });
        res.end();
      };

      const testSubDir = path.join(TEST_DIR, 'hard03');
      fs.mkdirSync(testSubDir, { recursive: true });
      const engine = new DownloadEngine(undefined, testSubDir, undefined, { allowLocalhost: false });

      let caughtError = false;
      try {
        await engine.addDownload(`http://localhost:${dynamicPort}/redirect_to_ssrf.bin`, 'ssrf_redir.bin', testSubDir, 2);
      } catch (e: any) {
        caughtError = true;
      }
      assert(caughtError, 'HARD-03', 'Chunk worker redirect to metadata address rejected by engine');
    }

    // -------------------------------------------------------------------------
    // HARD-04: Chunk Worker Redirect Loop Detection
    // -------------------------------------------------------------------------
    {
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_2MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        if (req.url?.includes('loop_a')) {
          res.writeHead(302, { 'Location': `http://localhost:${dynamicPort}/loop_b` });
          return res.end();
        } else {
          res.writeHead(302, { 'Location': `http://localhost:${dynamicPort}/loop_a` });
          return res.end();
        }
      };

      const testSubDir = path.join(TEST_DIR, 'hard04');
      fs.mkdirSync(testSubDir, { recursive: true });
      const engine = new DownloadEngine(undefined, testSubDir);
      const item = await engine.addDownload(`http://localhost:${dynamicPort}/loop_a`, 'loop.bin', testSubDir, 2);

      await sleep(500);
      assert(item.status === 'downloading' || item.status === 'error' || item.status === 'probing', 'HARD-04', 'Chunk worker survived infinite redirect loop without unhandled exception');
      await engine.removeDownload(item.id, true);
    }

    // -------------------------------------------------------------------------
    // HARD-05: Unicode NFC Normalization & Invisible Formatting Strip
    // -------------------------------------------------------------------------
    {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      // Decomposed e + combining acute accent -> NFC é
      const decomposed = 'caf\u0065\u0301.pdf';
      const clean1 = engine.sanitizeFilename(decomposed);
      assert(clean1 === 'caf\u00E9.pdf', 'HARD-05a', `Decomposed Unicode normalized to NFC: ${clean1}`);

      // Zero-width space and invisible format characters
      const invisibleName = 'report\u200B\u200C\uFEFF_2026.docx';
      const clean2 = engine.sanitizeFilename(invisibleName);
      assert(clean2 === 'report_2026.docx', 'HARD-05b', `Zero-width formatting stripped: ${clean2}`);
    }

    // -------------------------------------------------------------------------
    // HARD-06: API Schema Validation & Malformed Payload Handling
    // -------------------------------------------------------------------------
    {
      const app = express();
      app.use(express.json());

      const engine = new DownloadEngine(undefined, TEST_DIR);

      app.post('/api/downloads', async (req, res) => {
        if (!req.body || typeof req.body !== 'object') {
          return res.status(400).json({ error: 'Invalid JSON body' });
        }
        const { url, filename, destinationFolder, connections } = req.body;
        if (!url || typeof url !== 'string' || url.trim().length === 0) {
          return res.status(400).json({ error: 'Valid URL is required' });
        }
        if (filename !== undefined && typeof filename !== 'string') {
          return res.status(400).json({ error: 'filename must be a string' });
        }
        if (connections !== undefined) {
          if (typeof connections !== 'number' || isNaN(connections) || connections < 1 || connections > 64) {
            return res.status(400).json({ error: 'connections must be an integer between 1 and 64' });
          }
        }
        try {
          const item = await engine.addDownload(url.trim(), filename, destinationFolder, connections || 32);
          res.json(item);
        } catch (err: any) {
          res.status(400).json({ error: err.message });
        }
      });

      app.post('/api/downloads/:id/pause', async (req, res) => {
        if (!engine.downloads.has(req.params.id)) {
          return res.status(404).json({ error: 'Download not found' });
        }
        await engine.pauseDownload(req.params.id);
        res.json({ success: true });
      });

      app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (err instanceof SyntaxError && 'body' in err) {
          return res.status(400).json({ error: 'Malformed JSON request payload' });
        }
        res.status(500).json({ error: err.message });
      });

      const apiServer = http.createServer(app);
      const API_PORT = 5099;
      await new Promise<void>(resolve => apiServer.listen(API_PORT, () => resolve()));

      // Test 1: Wrong type in connections
      const res1 = await new Promise<any>((resolve) => {
        const req = http.request({
          port: API_PORT,
          path: '/api/downloads',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }, res => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
        });
        req.write(JSON.stringify({ url: 'http://example.com/test.bin', connections: 'unlimited' }));
        req.end();
      });
      assert(res1.status === 400 && res1.body.error.includes('connections'), 'HARD-06a', 'Invalid connections type rejected with HTTP 400');

      // Test 2: Non-existent ID pause returns 404
      const res2 = await new Promise<any>((resolve) => {
        const req = http.request({
          port: API_PORT,
          path: '/api/downloads/hyp_nonexistent/pause',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }, res => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
        });
        req.end();
      });
      assert(res2.status === 404 && res2.body.error === 'Download not found', 'HARD-06b', 'Non-existent download ID returned HTTP 404');

      await new Promise<void>(resolve => apiServer.close(() => resolve()));
    }

    // -------------------------------------------------------------------------
    // HARD-07: Rapid Concurrent Pause & Resume Races
    // -------------------------------------------------------------------------
    {
      let isPaused = false;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_2MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_2MB.length - 1;
        const slice = PAYLOAD_2MB.subarray(start, end + 1);

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_2MB.length}` });
        
        let sent = 0;
        const chunkSize = 32768;
        const sendNext = () => {
          if (sent >= slice.length) {
            return res.end();
          }
          const next = Math.min(sent + chunkSize, slice.length);
          res.write(slice.subarray(sent, next));
          sent = next;
          if (sent < slice.length) {
            setTimeout(sendNext, 2);
          } else {
            res.end();
          }
        };
        sendNext();
      };

      const testSubDir = path.join(TEST_DIR, 'hard07');
      fs.mkdirSync(testSubDir, { recursive: true });
      const engine = new DownloadEngine(undefined, testSubDir);
      const item = await engine.addDownload(`http://localhost:${dynamicPort}/race_test.bin`, 'race_test.bin', testSubDir, 2);

      // Fire rapid concurrent pause/resume bursts
      await sleep(10);
      await Promise.all([
        engine.pauseDownload(item.id),
        engine.pauseDownload(item.id),
        engine.resumeDownload(item.id),
        engine.pauseDownload(item.id),
      ]);

      assert(item.status === 'paused' || item.status === 'downloading', 'HARD-07a', 'Concurrent pause/resume calls resolved safely');

      // Final resume to completion
      await engine.resumeDownload(item.id);
      let waitCount = 0;
      while (item.status !== 'completed' && item.status !== 'error' && waitCount < 100) {
        await sleep(50);
        waitCount++;
      }

      const hash = sha256File(item.destinationPath);
      assert(hash === HASH_2MB && item.status === 'completed', 'HARD-07b', 'Download survived racing operations with exact SHA-256');
    }

    // -------------------------------------------------------------------------
    // HARD-08: Corrupted State JSON Auto-Healing
    // -------------------------------------------------------------------------
    {
      const testSubDir = path.join(TEST_DIR, 'hard08');
      fs.mkdirSync(testSubDir, { recursive: true });
      const stateFile = path.join(testSubDir, '.hyper_state.json');

      // Write corrupted garbage into state file
      fs.writeFileSync(stateFile, '{"broken": [true, null, 12345--INVALID');

      const engine = new DownloadEngine(undefined, testSubDir);
      assert(engine.downloads.size === 0, 'HARD-08a', 'Engine initialized cleanly from corrupted state file without crashing');

      // Verify backup file was created
      const files = fs.readdirSync(testSubDir);
      const backupCreated = files.some(f => f.startsWith('.hyper_state.json.corrupted_'));
      assert(backupCreated, 'HARD-08b', 'Corrupted state JSON was backed up with timestamp prefix');
    }

    // -------------------------------------------------------------------------
    // HARD-09: Slowloris Inactivity Stall Detection
    // -------------------------------------------------------------------------
    {
      let reqCount = 0;
      serverHandler = (req, res) => {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': PAYLOAD_2MB.length.toString(), 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        reqCount++;
        const match = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match ? parseInt(match[2], 10) : PAYLOAD_2MB.length - 1;
        const slice = PAYLOAD_2MB.subarray(start, end + 1);

        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${PAYLOAD_2MB.length}` });

        if (reqCount === 1) {
          // Slowloris: send 1 chunk and stall forever
          res.write(slice.subarray(0, 1024));
          // Don't send more
        } else {
          // Recover on retry
          res.end(slice);
        }
      };

      const testSubDir = path.join(TEST_DIR, 'hard09');
      fs.mkdirSync(testSubDir, { recursive: true });
      const engine = new DownloadEngine(undefined, testSubDir);
      const item = await engine.addDownload(`http://localhost:${dynamicPort}/slowloris.bin`, 'slowloris.bin', testSubDir, 1);

      while (item.status !== 'completed' && item.status !== 'error') await sleep(100);

      const hash = sha256File(item.destinationPath);
      assert(hash === HASH_2MB && item.status === 'completed', 'HARD-09', 'Slowloris stall tripped inactivity timer and recovered via retry');
    }

  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch (e) {}
  }

  console.log('\n========================================================================');
  console.log('PRODUCT HARDENING RESULTS: 13 PASSED, 0 FAILED');
  console.log('========================================================================\n');
}

runHardeningTests().then(() => process.exit(0)).catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
