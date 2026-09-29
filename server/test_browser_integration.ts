/**
 * Browser/System Integration settings: normalization + persistence check.
 * Run: npx tsx server/test_browser_integration.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SettingsManager } from './settings_store';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`[PASS] ${name}`); passed++; }
  else { console.error(`[FAIL] ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndm_bint_'));
const sm = new SettingsManager(path.join(dir, 'settings.json'));

// 1. Normalization on update
const s1 = sm.updateSettings({
  browser: {
    forceKeys: ['ALT', 'ctrl'],
    preventKeys: ['bogus', 'shift'],
    contextMenu: { downloadLink: false },
    showDownloadPanel: false,
  },
} as any);
check('forceKeys normalized to lowercase valid values', JSON.stringify(s1.browser.forceKeys) === JSON.stringify(['alt', 'ctrl']), JSON.stringify(s1.browser.forceKeys));
check('preventKeys filters invalid entries', JSON.stringify(s1.browser.preventKeys) === JSON.stringify(['shift']), JSON.stringify(s1.browser.preventKeys));
check('contextMenu merge keeps siblings', s1.browser.contextMenu.downloadLink === false && s1.browser.contextMenu.downloadMedia === true);
check('showDownloadPanel persisted', s1.browser.showDownloadPanel === false);

// 2. Per-browser defaults exist and flip correctly
const s2 = sm.updateSettings({ browser: { operaEnabled: false, braveEnabled: false } } as any);
check('opera flag flips', s2.browser.operaEnabled === false);
check('brave flag flips', s2.browser.braveEnabled === false);

// 3. Persistence across a fresh load from disk
const sm2 = new SettingsManager(path.join(dir, 'settings.json'));
const loaded = sm2.getSettings();
check('forceKeys survive reload', JSON.stringify(loaded.browser.forceKeys) === JSON.stringify(['alt', 'ctrl']), JSON.stringify(loaded.browser.forceKeys));
check('contextMenu survives reload', loaded.browser.contextMenu.downloadLink === false);
check('opera survives reload', loaded.browser.operaEnabled === false);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nBROWSER-INTEGRATION SETTINGS: ${passed} PASSED, ${failed} FAILED`);
process.exit(failed > 0 ? 1 : 0);
