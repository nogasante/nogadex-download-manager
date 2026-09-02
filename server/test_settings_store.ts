import os from 'os';
import path from 'path';
import fs from 'fs';
import { SettingsManager, DEFAULT_NOGADEX_SETTINGS } from './settings_store';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runSettingsTests() {
  console.log('=== SUITE 18: PHASE 9.1 SETTINGS & PREFERENCES ENGINE ===');

  const testConfigPath = path.join(os.tmpdir(), `nogadex_test_settings_${Date.now()}.json`);

  try {
    // 1. Initial Load & Default Generation
    console.log('[Test 1] Testing Default Settings Initialization...');
    const sm = new SettingsManager(testConfigPath);
    const initial = sm.getSettings();
    assert(initial.downloads.defaultConnections === 32, 'Default connections should be 32');
    assert(initial.general.doubleClickAction === 'open_folder', 'Default doubleClickAction should be open_folder');
    assert(initial.categories.length === 5, 'Default categories count should be 5');

    // 2. Persistence & Atomic Write
    console.log('[Test 2] Testing Atomic Mutation & File Persistence...');
    let eventReceived = false;
    sm.on('change', (s) => {
      if (s.downloads.defaultConnections === 64) eventReceived = true;
    });

    sm.updateSettings({
      downloads: {
        defaultConnections: 64,
        maxConcurrentDownloads: 10,
        defaultDownloadFolder: 'C:\\CustomDownloads',
      },
      network: {
        globalSpeedLimitEnabled: true,
        globalSpeedLimitKB: 2048,
      },
    });

    assert(eventReceived, 'Settings change event was not emitted');
    assert(fs.existsSync(testConfigPath), 'Settings file was not written to disk');

    // 3. Reload from Disk Verification
    console.log('[Test 3] Testing Reload and State Preservation from Disk...');
    const sm2 = new SettingsManager(testConfigPath);
    const reloaded = sm2.getSettings();
    assert(reloaded.downloads.defaultConnections === 64, 'Persisted defaultConnections should be 64');
    assert(reloaded.downloads.maxConcurrentDownloads === 10, 'Persisted maxConcurrentDownloads should be 10');
    assert(reloaded.downloads.defaultDownloadFolder === 'C:\\CustomDownloads', 'Persisted folder should match');
    assert(reloaded.network.globalSpeedLimitKB === 2048, 'Persisted speed limit should match');

    // 4. Sanitation and Boundary Checks
    console.log('[Test 4] Testing Numeric Boundary Sanitation...');
    sm2.updateSettings({
      downloads: {
        maxConcurrentDownloads: 999,
        defaultConnections: 1000,
      },
    });
    const clamped = sm2.getSettings();
    assert(clamped.downloads.maxConcurrentDownloads === 20, `Clamp failed for concurrency: got ${clamped.downloads.maxConcurrentDownloads}`);
    assert(clamped.downloads.defaultConnections === 64, `Clamp failed for connections: got ${clamped.downloads.defaultConnections}`);

    // 5. Reset Defaults
    console.log('[Test 5] Testing Factory Reset...');
    sm2.resetDefaults();
    const reset = sm2.getSettings();
    assert(reset.downloads.defaultConnections === 32, 'Factory reset failed to restore defaultConnections');

    console.log('=== SUITE 18 PASSED: ALL 5 SETTINGS ENGINE TESTS SUCCEEDED ===');
  } finally {
    if (fs.existsSync(testConfigPath)) {
      try { fs.unlinkSync(testConfigPath); } catch {}
    }
  }
}

runSettingsTests().catch(err => {
  console.error('Settings test failed:', err);
  process.exit(1);
});
