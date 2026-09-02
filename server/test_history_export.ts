import { HistoryExportEngine } from './history_export_engine';
import { DownloadItem } from './types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runHistoryExportTests() {
  console.log('=== SUITE 24: PHASE 9.6 HISTORY & IMPORT/EXPORT SUBSYSTEM ===');

  const engine = new HistoryExportEngine();

  const mockItems: DownloadItem[] = [
    {
      id: 'dl_1',
      url: 'https://example.com/archive.zip',
      filename: 'archive.zip',
      status: 'completed',
      category: 'compressed',
      totalBytes: 104857600,
      downloadedBytes: 104857600,
      speed: 0,
      progress: 100,
      destinationPath: 'C:\\Downloads\\Compressed\\archive.zip',
      chunks: [],
      createdAt: 100000,
      completedAt: 105000,
    },
    {
      id: 'dl_2',
      url: 'https://example.com/document.pdf',
      filename: 'document.pdf',
      status: 'downloading',
      category: 'documents',
      totalBytes: 5242880,
      downloadedBytes: 2621440,
      speed: 1024000,
      progress: 50,
      destinationPath: 'C:\\Downloads\\Documents\\document.pdf',
      chunks: [],
      createdAt: 110000,
    },
  ];

  // Test 1: Filter History
  console.log('[Test 1] Testing History Filtering...');
  const f1 = engine.filterHistory(mockItems, { status: 'completed' });
  assert(f1.length === 1 && f1[0].id === 'dl_1', 'Filtered by status completed');

  const f2 = engine.filterHistory(mockItems, { query: 'document' });
  assert(f2.length === 1 && f2[0].id === 'dl_2', 'Filtered by search query');

  // Test 2: CSV Export
  console.log('[Test 2] Testing CSV Export...');
  const csv = engine.exportToCsv(mockItems);
  assert(csv.includes('archive.zip') && csv.includes('https://example.com/document.pdf'), 'CSV contains item metadata');

  // Test 3: TXT Export & Import
  console.log('[Test 3] Testing TXT Export & Import Roundtrip...');
  const txt = engine.exportToTxt(mockItems);
  const importedTxt = engine.importFromTxt(txt);
  assert(importedTxt.length === 2, 'TXT import extracted 2 URLs');
  assert(importedTxt[0].url === 'https://example.com/archive.zip', 'First imported URL matches');

  // Test 4: JSON Export & Import
  console.log('[Test 4] Testing JSON Export & Import Roundtrip...');
  const jsonStr = engine.exportToJson(mockItems);
  const importedJson = engine.importFromJson(jsonStr);
  assert(importedJson.length === 2, 'JSON import extracted 2 items');
  assert(importedJson[1].filename === 'document.pdf', 'Imported JSON filename matches');

  // Test 5: IDM .ef2 Export & Import
  console.log('[Test 5] Testing IDM .ef2 Export & Import Roundtrip...');
  const ef2Str = engine.exportToEf2(mockItems);
  assert(ef2Str.includes('<') && ef2Str.includes('file: archive.zip'), 'EF2 export formatted correctly');
  const importedEf2 = engine.importFromEf2(ef2Str);
  assert(importedEf2.length === 2, 'EF2 import parsed 2 items');
  assert(importedEf2[0].filename === 'archive.zip', 'EF2 parsed filename matches');

  console.log('=== SUITE 24 PASSED: ALL HISTORY & IMPORT/EXPORT TESTS SUCCEEDED ===');
}

runHistoryExportTests().catch(err => {
  console.error('History & Export test failed:', err);
  process.exit(1);
});
