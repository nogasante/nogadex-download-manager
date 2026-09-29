import { NativeBridgeManager, NDM_LOCAL_TOKEN } from './native_bridge';
import { DownloadEngine } from './engine';
import { RulesEngine } from './rules_engine';
import { SettingsManager } from './settings_store';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runNativeBridgeTests() {
  console.log('=== SUITE 22: PHASE 9.4 BROWSER EXTENSION & NATIVE BRIDGE ===');

  const engine = new DownloadEngine(() => {});
  const settingsManager = new SettingsManager();
  const rulesEngine = new RulesEngine();
  const bridge = new NativeBridgeManager(engine, rulesEngine, settingsManager);

  try {
    // Test 1: Loopback and Token Security Validation
    console.log('[Test 1] Testing Strict Loopback & Token Validation...');
    const validReq: any = {
      ip: '127.0.0.1',
      headers: { 'x-ndm-token': NDM_LOCAL_TOKEN },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const check1 = bridge.validateRequest(validReq);
    assert(check1.valid === true, 'Valid local request with token should be allowed');

    const foreignReq: any = {
      ip: '192.168.1.100',
      headers: { 'x-ndm-token': NDM_LOCAL_TOKEN },
      socket: { remoteAddress: '192.168.1.100' },
    };
    const check2 = bridge.validateRequest(foreignReq);
    assert(check2.valid === false, 'Non-loopback LAN request must be rejected');

    const invalidTokenReq: any = {
      ip: '127.0.0.1',
      headers: { 'x-ndm-token': 'wrong_token' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const check3 = bridge.validateRequest(invalidTokenReq);
    assert(check3.valid === false, 'Invalid token must be rejected');

    // Test 2: Download Takeover Injection & Category Routing
    console.log('[Test 2] Testing Browser Download Takeover & Automatic Routing...');
    const item = await bridge.handleDownloadCapture({
      url: 'https://example.com/software_update.zip',
      filename: 'software_update.zip',
      referrer: 'https://example.com/downloads',
    });

    assert(item !== null, 'Download item created via bridge takeover');
    assert(item.url === 'https://example.com/software_update.zip', 'URL preserved');
    assert(item.destinationPath.includes('Compressed'), 'Automatic extension rule routed .zip to Compressed folder');

    // Test 3: Bridge Diagnostics Telemetry
    console.log('[Test 3] Testing Bridge Diagnostics Telemetry...');
    const diag = bridge.getDiagnostics();
    assert(diag.bridgeActive === true, 'Bridge active reported');
    assert(diag.totalInterceptions === 1, 'Total interceptions counted');
    assert(diag.boundLoopback === '127.0.0.1:5005', 'Bound loopback matches');

    console.log('=== SUITE 22 PASSED: ALL BROWSER BRIDGE TESTS SUCCEEDED ===');
  } finally {
    await engine.shutdown();
  }
}

runNativeBridgeTests().catch(err => {
  console.error('Native bridge test failed:', err);
  process.exit(1);
});
