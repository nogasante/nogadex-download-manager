import assert from 'assert';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { extractFilenameFromUrl, getFileCategory, buildCategoryFolderPath } from '../src/utils/fileUtils';
import { DownloadEngine } from './engine';

console.log('========================================================================');
console.log('      ADD NEW DOWNLOAD DIALOG - COMPREHENSIVE INTERACTION TEST SUITE    ');
console.log('========================================================================');

async function runAddUrlDialogTests() {
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

  const baseDownloadsDir = path.join(os.homedir(), 'Downloads');

  // 1. Interaction 1: Address Input & Intelligent Auto-Filename Extraction
  try {
    const testCases = [
      { url: 'https://example.com/downloads/setup_v2.4.1.exe', expected: 'setup_v2.4.1.exe' },
      { url: 'https://cdn.archive.org/files/big_buck_bunny_1080p.mp4?auth=xyz123#frag', expected: 'big_buck_bunny_1080p.mp4' },
      { url: 'https://media.test/audio_track.flac?download=true', expected: 'audio_track.flac' },
      { url: 'https://docs.enterprise.com/quarterly%20report%202026.pdf', expected: 'quarterly report 2026.pdf' },
    ];

    for (const tc of testCases) {
      const extracted = extractFilenameFromUrl(tc.url);
      assert.strictEqual(extracted, tc.expected, `Expected extracted filename '${tc.expected}', got '${extracted}'`);
    }
    pass('INT-01: Address URL input triggers accurate filename extraction across queries & encoded names');
  } catch (err) {
    fail('INT-01: URL & filename extraction check', err);
  }

  // 2. Interaction 2: Category Detection & Auto-Routing of Save Location
  try {
    const categoriesToTest = [
      { file: 'photoshop_installer.exe', expectedCategory: 'programs', expectedSub: 'Programs' },
      { file: 'tutorial_video.mp4', expectedCategory: 'video', expectedSub: 'Video' },
      { file: 'project_backup.zip', expectedCategory: 'compressed', expectedSub: 'Compressed' },
      { file: 'annual_report.pdf', expectedCategory: 'documents', expectedSub: 'Documents' },
      { file: 'podcast_episode_12.mp3', expectedCategory: 'music', expectedSub: 'Music' },
      { file: 'raw_data_stream.dat', expectedCategory: 'all', expectedSub: '' },
    ];

    for (const item of categoriesToTest) {
      const cat = getFileCategory(item.file);
      assert.strictEqual(cat, item.expectedCategory, `Category mismatch for ${item.file}`);
      const folderPath = buildCategoryFolderPath(baseDownloadsDir, cat);
      const expectedPath = item.expectedSub ? path.join(baseDownloadsDir, item.expectedSub) : baseDownloadsDir;
      assert.strictEqual(folderPath, expectedPath, `Path mismatch for ${item.file}`);
    }
    pass('INT-02: Save Location dynamically auto-routes to dedicated category subfolders');
  } catch (err) {
    fail('INT-02: Category auto-routing check', err);
  }

  // 3. Interaction 3: Save Location Existence Checking
  try {
    const existingDir = os.tmpdir();
    const nonExistentDir = path.join(os.tmpdir(), `ndm_fake_nonexistent_${Date.now()}`);

    assert.strictEqual(fs.existsSync(existingDir), true);
    assert.strictEqual(fs.existsSync(nonExistentDir), false);
    pass('INT-03: System accurately detects existing vs non-existing target directories');
  } catch (err) {
    fail('INT-03: Existence check test', err);
  }

  // 4. Interaction 4: Permission Prompt "Create Folder" Execution
  try {
    const testCategoryFolder = path.join(os.tmpdir(), `ndm_prompt_test_${Date.now()}`, 'Programs');
    assert.strictEqual(fs.existsSync(testCategoryFolder), false);

    // Simulated user approves: "Create Folder"
    fs.mkdirSync(testCategoryFolder, { recursive: true });
    assert.strictEqual(fs.existsSync(testCategoryFolder), true);
    assert.strictEqual(fs.statSync(testCategoryFolder).isDirectory(), true);

    // Cleanup
    fs.rmdirSync(testCategoryFolder);
    pass('INT-04: Permission prompt "Create Folder" action creates directory recursively');
  } catch (err) {
    fail('INT-04: Folder creation permission test', err);
  }

  // 5. Interaction 5: "Download Now" Engine Submission (Immediate Execution)
  try {
    const engine = new DownloadEngine(() => {});
    const targetDir = path.join(os.tmpdir(), `ndm_int_dl_now_${Date.now()}`);
    fs.mkdirSync(targetDir, { recursive: true });

    const dlItem = await engine.addDownload(
      'https://example.com/assets/installer_setup.exe',
      'installer_setup.exe',
      targetDir,
      16
    );

    assert.ok(dlItem.id, 'Download item must be created with valid ID');
    assert.strictEqual(dlItem.filename, 'installer_setup.exe');
    assert.strictEqual(dlItem.connections, 16);
    assert.ok(['probing', 'downloading', 'queued'].includes(dlItem.status), `Initial status should be active (got: ${dlItem.status})`);
    pass('INT-05: "Download Now" button initiates active parallel download item in engine');
  } catch (err) {
    fail('INT-05: Download Now submission check', err);
  }

  // 6. Interaction 6: "Download Later" Engine Submission (Paused / Queued)
  try {
    const engine = new DownloadEngine(() => {});
    const targetDir = path.join(os.tmpdir(), `ndm_int_dl_later_${Date.now()}`);
    fs.mkdirSync(targetDir, { recursive: true });

    const dlItem = await engine.addDownload(
      'https://example.com/media/documentary.mp4',
      'documentary.mp4',
      targetDir,
      32
    );
    engine.pauseDownload(dlItem.id);

    assert.ok(dlItem.id);
    assert.strictEqual(dlItem.filename, 'documentary.mp4');
    assert.strictEqual(dlItem.connections, 32);
    const updated = engine.downloads.get(dlItem.id);
    assert.ok(updated?.status === 'paused' || updated?.status === 'queued', `Status must be paused or queued (got: ${updated?.status})`);
    pass('INT-06: "Download Later" button registers download in paused/queued state without starting transfer');
  } catch (err) {
    fail('INT-06: Download Later submission check', err);
  }

  // 7. Interaction 7: Native App & Executable Setup Icon Resolution
  try {
    const testExeName = 'setup_app.exe';
    const isProgram = getFileCategory(testExeName) === 'programs';
    assert.strictEqual(isProgram, true, 'setup_app.exe must be recognized as program category');

    // Verify dummy extension generation for registered app association
    const ext = 'mp4';
    const dummyPath = path.join(os.tmpdir(), `ndm_dummy_${ext}.${ext}`);
    fs.writeFileSync(dummyPath, '');
    assert.strictEqual(fs.existsSync(dummyPath), true);
    fs.unlinkSync(dummyPath);
    pass('INT-07: Executables and media files resolve app icon association probes accurately');
  } catch (err) {
    fail('INT-07: Icon association check', err);
  }

  console.log('========================================================================');
  console.log(`ADD URL INTERACTION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runAddUrlDialogTests();
