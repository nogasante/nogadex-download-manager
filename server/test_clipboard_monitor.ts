import { ClipboardMonitorEngine } from './clipboard_monitor';
import { SettingsManager } from './settings_store';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runClipboardTests() {
  console.log('=== SUITE 23: PHASE 9.5 CLIPBOARD & DRAG/DROP SUBSYSTEM ===');

  const settingsManager = new SettingsManager();
  const clipEngine = new ClipboardMonitorEngine(settingsManager);

  // Configure test extensions and ignore domains
  settingsManager.updateSettings({
    clipboard: {
      autoCapture: true,
      confirmBeforeAdd: true,
      monitoredExtensions: ['zip', 'iso', 'exe', 'tar.gz', 'pdf', 'mp4'],
      ignoreDomains: ['localhost', 'ignoreme.com'],
    },
  });

  // Test 1: Single URL with downloadable extension
  console.log('[Test 1] Testing Downloadable URL Extraction...');
  const text1 = 'Check out this release at https://example.com/downloads/setup_v2.exe for Windows.';
  const m1 = clipEngine.parseClipboardText(text1);
  assert(m1.length === 1, 'Should extract 1 downloadable URL');
  assert(m1[0].url === 'https://example.com/downloads/setup_v2.exe', 'Extracted URL matches');
  assert(m1[0].suggestedFilename === 'setup_v2.exe', 'Suggested filename matches');
  assert(m1[0].matchedExtension === 'exe', 'Matched extension matches');

  // Test 2: Duplicate Cooldown Suppression
  console.log('[Test 2] Testing Duplicate Cooldown Suppression...');
  const m2 = clipEngine.parseClipboardText(text1);
  assert(m2.length === 0, 'Duplicate URL within cooldown must be suppressed');

  // Test 3: Non-downloadable web page URL
  console.log('[Test 3] Testing Non-Monitored Extension Filter...');
  const text3 = 'Read this article: https://news.ycombinator.com/item?id=12345';
  const m3 = clipEngine.parseClipboardText(text3);
  assert(m3.length === 0, 'HTML page without monitored extension must be ignored');

  // Test 4: Ignored Domain Filter
  console.log('[Test 4] Testing Ignored Domain Filter...');
  const text4 = 'https://ignoreme.com/files/archive.zip';
  const m4 = clipEngine.parseClipboardText(text4);
  assert(m4.length === 0, 'Ignored domain URL must be filtered out');

  // Test 5: Multi-line clipboard text with multiple valid links
  console.log('[Test 5] Testing Multi-URL Batch Clipboard Extraction...');
  const text5 = `
    Download resources:
    - https://releases.ubuntu.com/ubuntu-24.04.iso
    - https://cdn.example.org/docs/manual.pdf
    - https://cdn.example.org/media/intro.mp4
  `;
  const m5 = clipEngine.parseClipboardText(text5);
  assert(m5.length === 3, 'Should extract all 3 valid downloadable links');
  assert(m5[0].suggestedFilename === 'ubuntu-24.04.iso', 'First item is iso');
  assert(m5[1].suggestedFilename === 'manual.pdf', 'Second item is pdf');
  assert(m5[2].suggestedFilename === 'intro.mp4', 'Third item is mp4');

  console.log('=== SUITE 23 PASSED: ALL CLIPBOARD SUBSYSTEM TESTS SUCCEEDED ===');
}

runClipboardTests().catch(err => {
  console.error('Clipboard test failed:', err);
  process.exit(1);
});
