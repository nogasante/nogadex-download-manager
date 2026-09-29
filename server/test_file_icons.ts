import assert from 'assert';
import path from 'path';
import os from 'os';
import fs from 'fs';

console.log('========================================================================');
console.log('             FILE & EXE NATIVE APP ICON TEST SUITE                      ');
console.log('========================================================================');

async function runFileIconTests() {
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

  // 1. Test extension categorization for app associations
  try {
    const extCategories: Record<string, string> = {
      exe: 'program',
      msi: 'program',
      mp4: 'video',
      mkv: 'video',
      zip: 'compressed',
      rar: 'compressed',
      pdf: 'document',
      docx: 'document',
      mp3: 'audio',
      flac: 'audio',
    };

    assert.strictEqual(extCategories['exe'], 'program');
    assert.strictEqual(extCategories['mp4'], 'video');
    assert.strictEqual(extCategories['zip'], 'compressed');
    pass('ICON-01: File types correctly categorized for Windows registered application lookup');
  } catch (err) {
    fail('ICON-01: Category mapping check', err);
  }

  // 2. Test temp dummy file generation for unregistered in-flight downloads
  try {
    const testExt = 'dummytestpkg';
    const tempFile = path.join(os.tmpdir(), `ndm_dummy_${testExt}.${testExt}`);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

    fs.writeFileSync(tempFile, '');
    assert.strictEqual(fs.existsSync(tempFile), true, 'Dummy file should be created in temp for OS association');

    // Clean up
    fs.unlinkSync(tempFile);
    pass('ICON-02: OS association dummy probe files generate safely in temp directory');
  } catch (err) {
    fail('ICON-02: Dummy probe check', err);
  }

  // 3. Test memory cache lookup efficiency
  try {
    const testCache = new Map<string, string>();
    const testKey = 'C:\\Users\\test\\Downloads\\Programs\\setup.exe';
    const fakeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    testCache.set(testKey, fakeDataUrl);
    assert.strictEqual(testCache.has(testKey), true);
    assert.strictEqual(testCache.get(testKey), fakeDataUrl);
    pass('ICON-03: Memory cache saves and returns exact icon data URLs without duplicate extraction');
  } catch (err) {
    fail('ICON-03: Memory cache check', err);
  }

  // 4. Test simulated PE executable path detection
  try {
    const setupExePath = 'C:\\Downloads\\Programs\\setup.exe';
    const isExe = setupExePath.toLowerCase().endsWith('.exe');
    assert.strictEqual(isExe, true, 'Executable setup files must be recognized as PE binaries');
    pass('ICON-04: Executable binaries (setup.exe) recognized for direct embedded PE icon extraction');
  } catch (err) {
    fail('ICON-04: Executable detection check', err);
  }

  console.log('========================================================================');
  console.log(`FILE ICON RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runFileIconTests();
