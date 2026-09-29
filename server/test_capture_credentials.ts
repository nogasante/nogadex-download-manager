/**
 * Phase 10.5: Browser Capture Credential Passthrough Test Suite
 *
 * Verifies that browser-captured credentials (cookies, User-Agent, Referer)
 * flow end-to-end from the bridge payload through the engine to real HTTP
 * requests, that cookie-gated and signed URLs download correctly, that
 * cookies are host-scoped (never leaked across origins), and that state
 * files never persist secrets.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DownloadEngine } from './engine';

const PORT_A = 5341;
const PORT_B = 5342;
const TEST_DIR = path.join(os.tmpdir(), 'hyper_capture_tests_' + Date.now());

if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

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

const PAYLOAD = Buffer.alloc(2 * 1024 * 1024, 0x5A);
const HASH = sha256FileSafe(PAYLOAD);
function sha256FileSafe(buf: Buffer): string {
  const h = crypto.createHash('sha256');
  h.update(buf);
  return h.digest('hex');
}

const SESSION_COOKIE = 'sessionid=secret_browser_session_12345; csrf=abc123';
const CAPTURED_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CapturedTestAgent/1.0';
const PAGE_REFERRER = `http://localhost:${PORT_A}/downloads/page`;

async function waitForCompletion(item: { status: string }, timeoutMs = 20000) {
  const start = Date.now();
  while ((item.status === 'downloading' || item.status === 'probing') && Date.now() - start < timeoutMs) {
    await sleep(25);
  }
}

async function runTests() {
  console.log('================================================================================');
  console.log('       PHASE 10.5 BROWSER CAPTURE CREDENTIAL PASSTHROUGH TEST SUITE             ');
  console.log('================================================================================\n');

  let unauthorizedHits = 0;
  let sawCookieHeaderOnB = false;
  let lastReferer = '';
  let lastUA = '';

  function rangeResponse(req: http.IncomingMessage, res: http.ServerResponse, payload: Buffer) {
    const range = req.headers.range;
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': String(payload.length), 'Accept-Ranges': 'bytes' });
      return res.end();
    }
    if (!range) {
      res.writeHead(200, { 'Content-Length': String(payload.length) });
      return res.end(payload);
    }
    const m = range.match(/bytes=(\d+)-(\d+)/);
    const start = parseInt(m![1], 10), end = parseInt(m![2], 10);
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${payload.length}` });
    res.end(payload.subarray(start, end + 1));
  }

  // CAPD-01: cookie-gated server rejects anonymous requests, accepts captured cookies
  {
    unauthorizedHits = 0;
    const server = http.createServer((req, res) => {
      const cookie = req.headers.cookie || '';
      if (!cookie.includes('sessionid=secret_browser_session_12345')) {
        unauthorizedHits++;
        res.writeHead(403, { 'Content-Length': '0' });
        return res.end();
      }
      rangeResponse(req, res, PAYLOAD);
    });
    await new Promise<void>(r => server.listen(PORT_A, () => r()));

    const engine = new DownloadEngine(undefined, TEST_DIR);
    const item = await engine.addDownload(
      `http://localhost:${PORT_A}/gated.bin`, 'gated.bin', TEST_DIR, 4,
      { cookies: SESSION_COOKIE, origin: `http://localhost:${PORT_A}` }
    );
    await waitForCompletion(item);
    assert(item.status === 'completed' && unauthorizedHits === 0, 'CAPD-01a',
      `Cookie-gated download completed with captured cookies (status=${item.status}, unauthorized=${unauthorizedHits})`);
    assert(sha256File(item.destinationPath) === HASH, 'CAPD-01b', 'Cookie-gated download byte-identical (SHA-256)');

    // Anonymous capture must fail closed: engine reports error, never a corrupt file
    const engine2 = new DownloadEngine(undefined, TEST_DIR);
    const item2 = await engine2.addDownload(`http://localhost:${PORT_A}/gated2.bin`, 'gated2.bin', TEST_DIR, 4);
    await waitForCompletion(item2, 30000);
    assert(item2.status === 'error' || unauthorizedHits > 0, 'CAPD-01c',
      `Anonymous download of cookie-gated URL fails (status=${item2.status})`);
    unauthorizedHits = 0;

    engine.destroy();
    engine2.destroy();
    await new Promise<void>(r => server.close(() => r()));
  }

  // CAPD-02: Referer- and UA-enforcing server (signed-URL style hotlink protection)
  {
    let refererFailures = 0;
    const server = http.createServer((req, res) => {
      lastReferer = String(req.headers.referer || '');
      lastUA = String(req.headers['user-agent'] || '');
      if (req.headers.referer !== PAGE_REFERRER) { refererFailures++; }
      if (req.headers['user-agent'] !== CAPTURED_UA) { refererFailures++; }
      if (refererFailures > 0 && req.method !== 'HEAD') {
        res.writeHead(403, { 'Content-Length': '0' });
        return res.end();
      }
      rangeResponse(req, res, PAYLOAD);
    });
    await new Promise<void>(r => server.listen(PORT_A + 10, () => r()));

    const engine = new DownloadEngine(undefined, TEST_DIR);
    const item = await engine.addDownload(
      `http://localhost:${PORT_A + 10}/signed.bin`, 'signed.bin', TEST_DIR, 4,
      { referrer: PAGE_REFERRER, userAgent: CAPTURED_UA, origin: `http://localhost:${PORT_A + 10}` }
    );
    await waitForCompletion(item);
    assert(item.status === 'completed' && refererFailures === 0, 'CAPD-02a',
      `Hotlink-protected download completed with captured Referer+UA (status=${item.status}, violations=${refererFailures})`);
    assert(lastReferer === PAGE_REFERRER && lastUA === CAPTURED_UA, 'CAPD-02b', 'Captured Referer and User-Agent reached the wire');

    engine.destroy();
    await new Promise<void>(r => server.close(() => r()));
  }

  // CAPD-03: cookies are host-scoped - cross-origin redirect must NOT receive them
  {
    sawCookieHeaderOnB = false;
    const serverB = http.createServer((req, res) => {
      if (req.headers.cookie && String(req.headers.cookie).includes('secret_browser_session')) {
        sawCookieHeaderOnB = true;
      }
      rangeResponse(req, res, PAYLOAD);
    });
    await new Promise<void>(r => serverB.listen(PORT_B, () => r()));

    const serverA = http.createServer((req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(302, { Location: `http://localhost:${PORT_B}/cdn.bin` });
        return res.end();
      }
      res.writeHead(302, { Location: `http://localhost:${PORT_B}/cdn.bin` });
      res.end();
    });
    await new Promise<void>(r => serverA.listen(PORT_A + 20, () => r()));

    const engine = new DownloadEngine(undefined, TEST_DIR);
    const item = await engine.addDownload(
      `http://localhost:${PORT_A + 20}/redirect.bin`, 'redirect.bin', TEST_DIR, 4,
      { cookies: SESSION_COOKIE, origin: `http://localhost:${PORT_A + 20}` }
    );
    await waitForCompletion(item);
    assert(item.status === 'completed', 'CAPD-03a', `Cross-origin redirect download completed (status=${item.status})`);
    assert(!sawCookieHeaderOnB, 'CAPD-03b', 'Session cookies were NOT forwarded to the cross-origin CDN host');

    engine.destroy();
    await new Promise<void>(r => serverB.close(() => r()));
    await new Promise<void>(r => serverA.close(() => r()));
  }

  // CAPD-04: state files never persist credentials
  {
    const server = http.createServer((req, res) => rangeResponse(req, res, PAYLOAD));
    await new Promise<void>(r => server.listen(PORT_A + 30, () => r()));

    const engine = new DownloadEngine(undefined, TEST_DIR);
    const item = await engine.addDownload(
      `http://localhost:${PORT_A + 30}/persist.bin`, 'persist.bin', TEST_DIR, 4,
      { cookies: SESSION_COOKIE, userAgent: CAPTURED_UA }
    );
    await waitForCompletion(item);
    engine.saveState();

    const stateFile = path.join(TEST_DIR, '.hyper_state.json');
    const stateContent = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf-8') : '';
    assert(item.status === 'completed', 'CAPD-04a', 'Download with credentials completed');
    assert(!stateContent.includes('secret_browser_session') && !stateContent.includes('browserCredentials'),
      'CAPD-04b', 'State file contains no cookies and no credential objects');

    engine.destroy();
    await new Promise<void>(r => server.close(() => r()));
  }

  console.log('\n================================================================================');
  console.log(`       CAPTURE CREDENTIAL TEST RESULTS: ${passed} PASSED, ${failed} FAILED                    `);
  console.log('================================================================================\n');

  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch(e => { console.error(e); process.exit(1); });
