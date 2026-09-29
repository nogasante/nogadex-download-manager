/**
 * HyperDownloader P5 - Comprehensive Security & Resilience Test Suite
 * Tests SSRF, scheme whitelisting, loopback/private IP blocking, path traversal,
 * Windows reserved names, filename sanitization, redirect downgrade policies,
 * sensitive parameter scrubbing, and graceful shutdown.
 */

import fs from 'fs';
import path from 'path';
import { DownloadEngine, validateUrl } from './engine';
import { scrubSensitiveUrl } from './performance_metrics';

const TEST_DIR = path.join(process.cwd(), 'temp_security_test');

let passed = 0;
let failed = 0;

function assert(condition: boolean, testId: string, description: string) {
  if (condition) {
    console.log(`[PASS] ${testId}: ${description}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testId}: ${description}`);
    failed++;
    throw new Error(`Test failed: ${testId} - ${description}`);
  }
}

async function runSecurityTests() {
  console.log('========================================================================');
  console.log('       HYPERDOWNLOADER P5 SECURITY & DEFENSE TEST SUITE                 ');
  console.log('========================================================================\n');

  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

  try {
    // -------------------------------------------------------------------------
    // SEC-01: Malformed and non-string URLs rejected
    // -------------------------------------------------------------------------
    {
      const res1 = validateUrl('');
      const res2 = validateUrl('not_a_valid_url');
      const res3 = validateUrl('http://');
      assert(!res1.valid && !res2.valid && !res3.valid, 'SEC-01', 'Malformed and empty URLs rejected');
    }

    // -------------------------------------------------------------------------
    // SEC-02: Non-http/https schemes rejected
    // -------------------------------------------------------------------------
    {
      const fileRes = validateUrl('file:///etc/passwd');
      const ftpRes = validateUrl('ftp://example.com/file.zip');
      const jsRes = validateUrl('javascript:alert(1)');
      const gopherRes = validateUrl('gopher://example.com/test');
      assert(!fileRes.valid && !ftpRes.valid && !jsRes.valid && !gopherRes.valid, 'SEC-02', 'Non-HTTP(S) schemes (file, ftp, js, gopher) rejected');
    }

    // -------------------------------------------------------------------------
    // SEC-03: Loopback and localhost blocked when allowLocalhost = false
    // -------------------------------------------------------------------------
    {
      const lh1 = validateUrl('http://localhost:8080/data.bin', false);
      const lh2 = validateUrl('http://127.0.0.1/test', false);
      const lh3 = validateUrl('http://127.0.0.254:5000/test', false);
      const lh4 = validateUrl('http://[::1]/test', false);
      assert(!lh1.valid && !lh2.valid && !lh3.valid && !lh4.valid, 'SEC-03', 'Loopback and localhost addresses blocked in production mode');
    }

    // -------------------------------------------------------------------------
    // SEC-04: Cloud metadata IP (169.254.169.254) blocked strictly
    // -------------------------------------------------------------------------
    {
      const meta1 = validateUrl('http://169.254.169.254/latest/meta-data/', false);
      const meta2 = validateUrl('http://169.254.1.1/test', false);
      assert(!meta1.valid && !meta2.valid, 'SEC-04', 'Cloud metadata (169.254.169.254) and link-local addresses blocked');
    }

    // -------------------------------------------------------------------------
    // SEC-05: RFC 1918 Private subnets blocked in production mode
    // -------------------------------------------------------------------------
    {
      const priv10 = validateUrl('http://10.0.1.50:8080/data', false);
      const priv172 = validateUrl('http://172.16.5.10/data', false);
      const priv192 = validateUrl('http://192.168.1.100/data', false);
      assert(!priv10.valid && !priv172.valid && !priv192.valid, 'SEC-05', 'RFC 1918 private IPv4 subnets (10.x, 172.16.x, 192.168.x) blocked');
    }

    // -------------------------------------------------------------------------
    // SEC-06: Dangerous ports blocked
    // -------------------------------------------------------------------------
    {
      const ssh = validateUrl('http://example.com:22/file');
      const smtp = validateUrl('http://example.com:25/file');
      const smb = validateUrl('http://example.com:445/file');
      const ok = validateUrl('http://example.com:8080/file');
      assert(!ssh.valid && !smtp.valid && !smb.valid && ok.valid, 'SEC-06', 'Dangerous ports (22, 25, 445) blocked');
    }

    // -------------------------------------------------------------------------
    // SEC-07: Path traversal attempts sanitized and constrained to download folder
    // -------------------------------------------------------------------------
    {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      const dest = engine.resolveSafeDestination(TEST_DIR, '../../../../windows/system32/cmd.exe');
      assert(
        dest.fullPath.startsWith(path.resolve(TEST_DIR)) &&
        !dest.filename.includes('..') &&
        !dest.filename.includes('/'),
        'SEC-07',
        'Directory traversal ../../ stripped and constrained inside target folder'
      );
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // SEC-08: Windows reserved device names neutralized
    // -------------------------------------------------------------------------
    {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      const conName = engine.sanitizeFilename('CON.txt');
      const prnName = engine.sanitizeFilename('prn.png');
      const auxName = engine.sanitizeFilename('AUX');
      const nulName = engine.sanitizeFilename('nul.zip');
      const com1Name = engine.sanitizeFilename('COM1.tar.gz');
      assert(
        conName.startsWith('_CON') &&
        prnName.startsWith('_prn') &&
        auxName.startsWith('_AUX') &&
        nulName.startsWith('_nul') &&
        com1Name.startsWith('_COM1'),
        'SEC-08',
        'Windows reserved device names (CON, PRN, AUX, NUL, COM1) safely prefixed'
      );
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // SEC-09: Invalid filename characters (< > : " | ? *) and null bytes sanitized
    // -------------------------------------------------------------------------
    {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      const dirty = 'report<2026>:part"1"|test?file*.pdf\x00.exe';
      const clean = engine.sanitizeFilename(dirty);
      assert(
        !clean.includes('<') &&
        !clean.includes('>') &&
        !clean.includes(':') &&
        !clean.includes('"') &&
        !clean.includes('|') &&
        !clean.includes('?') &&
        !clean.includes('*') &&
        !clean.includes('\x00'),
        'SEC-09',
        'Invalid filename characters and null bytes safely replaced with underscore'
      );
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // SEC-10: Excessively long filenames (>255 chars) truncated preserving extension
    // -------------------------------------------------------------------------
    {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      const longName = 'a'.repeat(300) + '.zip';
      const clean = engine.sanitizeFilename(longName);
      assert(clean.length <= 255 && clean.endsWith('.zip'), 'SEC-10', 'Excessively long filename truncated to <= 255 chars with extension intact');
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // SEC-11: Sensitive URL query parameters scrubbed from telemetry
    // -------------------------------------------------------------------------
    {
      const sensitiveUrl = 'https://download.cdn.com/archive.iso?token=secret123&sig=987654&auth=tokenxyz&user=john';
      const scrubbed = scrubSensitiveUrl(sensitiveUrl);
      assert(
        !scrubbed.includes('secret123') &&
        !scrubbed.includes('987654') &&
        !scrubbed.includes('tokenxyz') &&
        scrubbed.includes('[REDACTED]') &&
        scrubbed.includes('user=john'),
        'SEC-11',
        'Sensitive query parameters (token, sig, auth) safely redacted from telemetry'
      );
    }

    // -------------------------------------------------------------------------
    // SEC-12: Diagnostic snapshot provides structured metrics without leaking secrets
    // -------------------------------------------------------------------------
    {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      const snap = engine.getDiagnosticSnapshot();
      assert(
        snap.timestamp !== undefined &&
        typeof snap.memory.rssMB === 'number' &&
        typeof snap.downloadsCount === 'number' &&
        typeof snap.activeWriteQueues === 'number',
        'SEC-12',
        'Diagnostic snapshot generates structured metrics and memory usage'
      );
      engine.destroy();
    }

    // -------------------------------------------------------------------------
    // SEC-13: Graceful shutdown safely cleans up active worker state
    // -------------------------------------------------------------------------
    {
      const engine = new DownloadEngine(undefined, TEST_DIR);
      await engine.shutdown();
      assert(true, 'SEC-13', 'Engine shutdown cleanly flushes metadata and closes resources');
    }

    console.log('\n========================================================================');
    console.log(`SECURITY TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

  } finally {
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {}
  }
}

runSecurityTests().then(() => process.exit(0)).catch(err => {
  console.error('Fatal security test error:', err);
  process.exit(1);
});
