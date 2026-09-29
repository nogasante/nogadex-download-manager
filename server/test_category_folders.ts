import assert from 'assert';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getFileCategory, buildCategoryFolderPath } from '../src/utils/fileUtils';
import { SettingsManager } from './settings_store';
import { DownloadEngine } from './engine';

console.log('========================================================================');
console.log('         CATEGORY FOLDERS, ROUTING & FS PERMISSIONS TEST SUITE          ');
console.log('========================================================================');

async function runCategoryFolderTests() {
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

  const baseDir = path.join(os.homedir(), 'Downloads');

  // 1. File type to category mapping test
  try {
    assert.strictEqual(getFileCategory('movie.mp4'), 'video');
    assert.strictEqual(getFileCategory('archive.tar.gz'), 'compressed');
    assert.strictEqual(getFileCategory('document.pdf'), 'documents');
    assert.strictEqual(getFileCategory('installer.exe'), 'programs');
    assert.strictEqual(getFileCategory('song.flac'), 'music');
    pass('CAT-01: File extensions accurately map to standard download categories');
  } catch (err) {
    fail('CAT-01: File extension mapping check', err);
  }

  // 2. Category subfolder path builder test
  try {
    const videoFolder = buildCategoryFolderPath(baseDir, 'video');
    const compFolder = buildCategoryFolderPath(baseDir, 'compressed');
    const progFolder = buildCategoryFolderPath(baseDir, 'programs');
    const generalFolder = buildCategoryFolderPath(baseDir, 'all');

    assert.strictEqual(videoFolder, path.join(baseDir, 'Video'));
    assert.strictEqual(compFolder, path.join(baseDir, 'Compressed'));
    assert.strictEqual(progFolder, path.join(baseDir, 'Programs'));
    assert.strictEqual(generalFolder, baseDir);
    pass('CAT-02: buildCategoryFolderPath accurately constructs clean subfolder paths');
  } catch (err) {
    fail('CAT-02: Path builder check', err);
  }

  // 3. Settings Default Folder is Real User Downloads (Not root C:\Downloads)
  try {
    const settings = new SettingsManager();
    const current = settings.getSettings();
    assert.ok(
      current.downloads.defaultDownloadFolder.includes(os.homedir()) ||
      current.downloads.defaultDownloadFolder.toLowerCase().includes('downloads'),
      `Default download directory must be real user downloads (got: ${current.downloads.defaultDownloadFolder})`
    );
    assert.notStrictEqual(current.downloads.defaultDownloadFolder, 'C:\\Downloads', 'Root C:\\Downloads must never be default');
    pass(`CAT-03: SettingsManager defaults strictly to actual user directory: ${current.downloads.defaultDownloadFolder}`);
  } catch (err) {
    fail('CAT-03: Settings default directory check', err);
  }

  // 4. Folder creation & recursive safety
  try {
    const testCategoryPath = path.join(os.tmpdir(), `ndm_test_category_${Date.now()}`, 'Video');
    assert.strictEqual(fs.existsSync(testCategoryPath), false, 'Test directory should not exist initially');

    fs.mkdirSync(testCategoryPath, { recursive: true });
    assert.strictEqual(fs.existsSync(testCategoryPath), true, 'Directory must be created recursively');
    assert.strictEqual(fs.statSync(testCategoryPath).isDirectory(), true, 'Path must be a valid directory');

    // Clean up
    fs.rmdirSync(testCategoryPath);
    pass('CAT-04: Recursive folder creation works safely without permission exceptions');
  } catch (err) {
    fail('CAT-04: Folder creation test', err);
  }

  // 5. Engine destination safety check
  try {
    const engine = new DownloadEngine(() => {});
    assert.ok(
      engine.defaultDownloadDir.includes(os.homedir()) || engine.defaultDownloadDir.toLowerCase().includes('downloads'),
      `Engine default download dir must be real user directory (got: ${engine.defaultDownloadDir})`
    );
    pass(`CAT-05: DownloadEngine initial directory defaults to real user folder: ${engine.defaultDownloadDir}`);
  } catch (err) {
    fail('CAT-05: Engine default directory check', err);
  }

  console.log('========================================================================');
  console.log(`CATEGORY FOLDER RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runCategoryFolderTests();
