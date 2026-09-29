/**
 * Capture keys + per-browser enforcement against the REAL native bridge.
 * Run: npx tsx server/test_capture_keys.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NativeBridgeManager } from './native_bridge';
import { SettingsManager } from './settings_store';
import { RulesEngine } from './rules_engine';
import { DownloadEngine } from './engine';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { console.log(`[PASS] ${name}`); passed++; }
  else { console.error(`[FAIL] ${name}${detail ? ' — ' + detail : ''}`); failed++; }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndm_ck_'));
const sm = new SettingsManager(path.join(dir, 's.json'));
const engine = new DownloadEngine(undefined, path.join(dir, 'dl'));
const rules = new RulesEngine();
const bridge = new NativeBridgeManager(engine, rules, sm);

async function expectThrow(name: string, p: Promise<any>, needle?: string) {
  try { await p; check(name, false, 'no error thrown'); }
  catch (e: any) {
    check(name, needle ? String(e.message).includes(needle) : true, e.message);
  }
}

// force-key bypasses the master switch
sm.updateSettings({ browser: { autoInterceptDownloads: false, forceKeys: ['alt'], preventKeys: ['shift'] } } as any);
try {
  const item = await bridge.handleDownloadCapture({ url: 'https://example.com/a.zip', heldKeys: ['alt'] });
  check('force key bypasses master switch', !!item?.id);
} catch (e: any) { check('force key bypasses master switch', false, e.message); }

await expectThrow('master switch blocks without force key',
  bridge.handleDownloadCapture({ url: 'https://example.com/b.zip', heldKeys: [] }),
  'disabled');

// prevent-key wins over force
await expectThrow('prevent key wins over force key',
  bridge.handleDownloadCapture({ url: 'https://example.com/c.zip', heldKeys: ['alt', 'shift'] }),
  'capture key');

// per-browser kill switch (engine still running from force test above)
sm.updateSettings({ browser: { autoInterceptDownloads: true, operaEnabled: false } } as any);
await expectThrow('per-browser block rejects opera',
  bridge.handleDownloadCapture({ url: 'https://example.com/d.zip', browserName: 'opera' }),
  'browser');

// extension exclusion honored, and bypassed by force key
sm.updateSettings({ browser: { excludedExtensions: ['zip'], forceKeys: ['ctrl'], preventKeys: [] } } as any);
await expectThrow('excluded extension blocks capture',
  bridge.handleDownloadCapture({ url: 'https://example.com/e.zip' }),
  'file type');
try {
  const item = await bridge.handleDownloadCapture({ url: 'https://example.com/f.zip', heldKeys: ['ctrl'] });
  check('force key bypasses extension exclusion', !!item?.id);
} catch (e: any) { check('force key bypasses extension exclusion', false, e.message); }

engine.destroy();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
console.log(`\nCAPTURE-KEYS ENFORCEMENT: ${passed} PASSED, ${failed} FAILED`);
process.exit(failed > 0 ? 1 : 0);
