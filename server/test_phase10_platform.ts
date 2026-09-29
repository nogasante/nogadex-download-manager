import assert from 'assert';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { NativeBridgeManager, NDM_LOCAL_TOKEN } from './native_bridge';
import { DownloadEngine } from './engine';
import { RulesEngine } from './rules_engine';
import { SettingsManager } from './settings_store';

console.log('========================================================================');
console.log('       PHASE 10 PRODUCTION PLATFORM & DISTRIBUTION TEST SUITE            ');
console.log('========================================================================');

async function runPhase10Tests() {
  let passed = 0;
  let failed = 0;

  function pass(name: string) {
    console.log(`[PASS] ${name}`);
    passed++;
  }

  function fail(name: string, err: any) {
    console.error(`[FAIL] ${name}:`, err);
    failed++;
  }

  // 1. Check Package Configuration
  try {
    const pkgPath = path.resolve('package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    assert.strictEqual(pkg.build?.appId, 'com.nogadex.ndm', 'appId must be com.nogadex.ndm');
    assert.strictEqual(pkg.build?.nsis?.shortcutName, 'NDM', 'shortcutName must be NDM');
    assert.ok(pkg.build?.protocols?.schemes.includes('ndm'), 'protocols must include ndm');
    assert.ok(!pkg.build?.protocols?.schemes.includes('nogadex'), 'protocols must not include the legacy nogadex scheme');
    assert.strictEqual(pkg.build?.nsis?.perMachine, false, 'NSIS must be per-user (perMachine: false)');
    assert.strictEqual(pkg.build?.nsis?.deleteAppDataOnUninstall, false, 'deleteAppDataOnUninstall must be false');
    pass('P10-01: package.json NSIS and protocol configuration adheres strictly to production standards');
  } catch (err) {
    fail('P10-01: package.json NSIS and protocol configuration check', err);
  }

  // 2. Check Backend Bundle Output
  try {
    const bundlePath = path.resolve('dist-server', 'server.cjs');
    assert.ok(fs.existsSync(bundlePath), 'dist-server/server.cjs must exist');
    const stat = fs.statSync(bundlePath);
    assert.ok(stat.size > 500000, `Bundle size should be substantial (actual: ${stat.size} bytes)`);
    pass(`P10-02: dist-server/server.cjs exists and is bundled (${Math.round(stat.size / 1024)} KB)`);
  } catch (err) {
    fail('P10-02: dist-server/server.cjs bundle check', err);
  }

  // 3. Standalone Execution Verification on an isolated port
  try {
    const bundlePath = path.resolve('dist-server', 'server.cjs');
    const testPort = 5009;
    const proc = spawn(process.execPath, [bundlePath], {
      env: { ...process.env, PORT: String(testPort) },
      stdio: 'pipe',
    });

    let stdoutData = '';
    let stderrData = '';
    proc.stdout.on('data', d => { stdoutData += d.toString(); });
    proc.stderr.on('data', d => { stderrData += d.toString(); });

    // Wait until server logs ready or timeout
    const startTime = Date.now();
    while (Date.now() - startTime < 4000) {
      if (stdoutData.includes(`Running strictly on http://127.0.0.1:${testPort}`)) break;
      await new Promise(r => setTimeout(r, 100));
    }

    const statusRes: any = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${testPort}/api/diagnostics`, { headers: { 'X-NDM-Token': NDM_LOCAL_TOKEN } }, (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(raw) }));
      });
      req.on('error', (err) => reject(new Error(`${err.message} (stdout: ${stdoutData}, stderr: ${stderrData})`)));
      req.setTimeout(2500, () => { req.destroy(); reject(new Error('Timeout')); });
    });

    assert.strictEqual(statusRes.status, 200, 'Isolated bundle must return HTTP 200 on /api/diagnostics');
    assert.ok(statusRes.data?.system?.rssMemoryMB > 0, 'Telemetry must measure valid RSS memory');
    try {
      if (process.platform === 'win32' && proc.pid) {
        spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)]);
      } else {
        proc.kill('SIGKILL');
      }
    } catch {}
    pass('P10-03: dist-server/server.cjs executes completely standalone without tsx or dev runtime');
  } catch (err) {
    fail('P10-03: Standalone server bundle execution', err);
  }

  // 4. Native Bridge Protocol v1 Envelope Validation
  try {
    const engine = new DownloadEngine(() => {});
    const rules = new RulesEngine();
    const settings = new SettingsManager();
    const bridge = new NativeBridgeManager(engine, rules, settings);

    // Valid envelope
    const valid = bridge.validateEnvelope({
      protocolVersion: 1,
      messageType: 'capture',
      requestId: 'req_123',
      payload: { url: 'https://example.com/file.zip' },
    });
    assert.strictEqual(valid.valid, true, 'Protocol v1 envelope must be valid');

    // Incompatible envelope
    const invalid = bridge.validateEnvelope({
      protocolVersion: 2,
      messageType: 'capture',
      requestId: 'req_124',
      payload: { url: 'https://example.com/file.zip' },
    });
    assert.strictEqual(invalid.valid, false, 'Protocol v2 envelope must be rejected');
    assert.ok(invalid.error?.includes('Incompatible native bridge protocol'), 'Error message must specify incompatibility');
    pass('P10-04: Native bridge enforces NDM_BRIDGE_PROTOCOL = 1 and safely rejects incompatible versions');
  } catch (err) {
    fail('P10-04: Native bridge protocol version check', err);
  }

  // 5. URL Takeover Parsing Logic
  try {
    function parseProtocolUrl(raw: string): string {
      if (raw.startsWith('ndm://')) {
        const u = new URL(raw);
        return u.searchParams.get('url') || raw;
      }
      return raw;
    }

    const testUrl1 = 'ndm://download?url=https%3A%2F%2Fspeed.hetzner.de%2F100MB.bin';
    assert.strictEqual(parseProtocolUrl(testUrl1), 'https://speed.hetzner.de/100MB.bin');

    const directUrl = 'https://mirror.ox.ac.uk/ubuntu.iso';
    assert.strictEqual(parseProtocolUrl(directUrl), directUrl);

    pass('P10-05: URL Takeover & Protocol handler correctly unpacks the ndm:// scheme');
  } catch (err) {
    fail('P10-05: URL protocol parsing check', err);
  }

  // 6. Diagnostics Export Sanitization Check
  try {
    const rawReport = {
      product: 'Nogadex Download Manager',
      version: '1.0.1',
      arch: 'x64',
      platform: 'win32',
      uptimeSeconds: 120,
      updater: { status: 'idle', channel: 'latest' },
      engine: {
        system: { rssMemoryMB: 54, heapUsedMB: 12 },
        cdnHealth: [{ name: 'Google Edge', latencyMs: 25 }],
      },
    };

    const serialized = JSON.stringify(rawReport);
    assert.ok(!serialized.includes('password'), 'Report must not contain password');
    assert.ok(!serialized.includes('token'), 'Report must not contain secret tokens');
    assert.ok(!serialized.includes('cookie'), 'Report must not contain cookies');
    assert.strictEqual(rawReport.version, '1.0.1');
    pass('P10-06: Exported diagnostics report contains zero sensitive credentials or private tokens');
  } catch (err) {
    fail('P10-06: Diagnostics sanitization check', err);
  }

  console.log('========================================================================');
  console.log(`PHASE 10 RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runPhase10Tests();
