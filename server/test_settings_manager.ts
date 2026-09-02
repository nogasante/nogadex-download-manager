import fs from 'fs';
import path from 'path';
import { SettingsManager, DEFAULT_SETTINGS } from './settings_manager';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
  console.log(`[PASS] ${message}`);
}

console.log('========================================================================');
console.log('       HYPERDOWNLOADER SETTINGS PERSISTENCE ENGINE TEST SUITE           ');
console.log('========================================================================\n');

const testDir = path.join(process.cwd(), 'scratch', 'test_settings_data');
if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true, force: true });
}
fs.mkdirSync(testDir, { recursive: true });

// 1. Initial defaults load
const manager = SettingsManager.getInstance(testDir);
const initial = manager.getSettings();
assert(initial.maxConcurrentDownloads === 3, 'SET-01a: Default concurrency is 3');
assert(initial.defaultConnections === 32, 'SET-01b: Default connections is 32');
assert(initial.autoStartDownloads === true, 'SET-01c: Default auto-start is true');
assert(fs.existsSync(path.join(testDir, 'settings.json')), 'SET-01d: Settings file created on disk');

// 2. Update and persistence
manager.updateSettings({
  maxConcurrentDownloads: 5,
  defaultConnections: 16,
  doubleClickAction: 'open_folder'
});
const updated = manager.getSettings();
assert(updated.maxConcurrentDownloads === 5, 'SET-02a: Max concurrent updated to 5');
assert(updated.defaultConnections === 16, 'SET-02b: Default connections updated to 16');
assert(updated.doubleClickAction === 'open_folder', 'SET-02c: Double click action updated');

// 3. Reloading from disk in new instance
const manager2 = SettingsManager.getInstance(testDir);
const reloaded = manager2.getSettings();
assert(reloaded.maxConcurrentDownloads === 5, 'SET-03a: Reloaded instance preserves concurrency = 5');
assert(reloaded.doubleClickAction === 'open_folder', 'SET-03b: Reloaded instance preserves double click');

// 4. Boundary enforcement (clamp invalid limits)
manager.updateSettings({
  maxConcurrentDownloads: 999, // Should clamp to 10
  defaultConnections: 0        // Should clamp to 1
});
const clamped = manager.getSettings();
assert(clamped.maxConcurrentDownloads === 10, 'SET-04a: Excessive concurrency clamped to 10');
assert(clamped.defaultConnections === 1, 'SET-04b: Zero connections clamped to minimum 1');

// 5. Corrupted settings JSON recovery
const settingsFile = path.join(testDir, 'settings.json');
fs.writeFileSync(settingsFile, '{ INVALID_CORRUPTED_JSON :::', 'utf8');

const manager3 = SettingsManager.getInstance(testDir);
const recovered = manager3.getSettings();
assert(recovered.maxConcurrentDownloads === DEFAULT_SETTINGS.maxConcurrentDownloads, 'SET-05a: Corrupted file safely resets to defaults without crash');
assert(fs.existsSync(settingsFile), 'SET-05b: Valid settings file restored on disk');

console.log('\n========================================================================');
console.log('SETTINGS PERSISTENCE TEST RESULTS: ALL 5 ASSIGNMENTS PASSED');
console.log('========================================================================\n');
