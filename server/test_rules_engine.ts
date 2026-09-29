import { RulesEngine, DownloadRule } from './rules_engine';
import { CategoryRule } from './settings_store';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runRulesTests() {
  console.log('=== SUITE 20: PHASE 9.2 CATEGORIES & RULES ENGINE ===');

  const defaultCategories: CategoryRule[] = [
    { id: 'compressed', name: 'Compressed', extensions: ['zip', 'rar', '7z', 'iso'], defaultFolder: 'C:\\Downloads\\Compressed' },
    { id: 'documents', name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'txt'], defaultFolder: 'C:\\Downloads\\Documents' },
    { id: 'programs', name: 'Programs', extensions: ['exe', 'msi', 'bin'], defaultFolder: 'C:\\Downloads\\Programs' },
  ];

  const rulesEngine = new RulesEngine();

  // Test 1: Category Resolution from File Extension
  console.log('[Test 1] Testing Category & Folder Auto-Resolution...');
  const cat1 = rulesEngine.resolveCategory('archive_backup.zip', defaultCategories, 'C:\\Downloads');
  assert(cat1.categoryId === 'compressed', 'Should resolve archive_backup.zip to compressed');
  assert(cat1.destinationFolder === 'C:\\Downloads\\Compressed', 'Folder should match category defaultFolder');

  const cat2 = rulesEngine.resolveCategory('whitepaper.PDF', defaultCategories, 'C:\\Downloads');
  assert(cat2.categoryId === 'documents', 'Should resolve case-insensitive PDF to documents');

  const cat3 = rulesEngine.resolveCategory('unknown_payload.xyz', defaultCategories, 'C:\\Downloads');
  assert(cat3.categoryId === 'other', 'Should fallback to other for unrecognized extension');
  assert(cat3.destinationFolder === 'C:\\Downloads', 'Fallback folder should be root defaultDir');

  // Test 2: Custom Rules Evaluation (Extension, Hostname, Regex)
  console.log('[Test 2] Testing Priority Rule Evaluation...');
  const customRules: DownloadRule[] = [
    {
      id: 'rule_1',
      name: 'ISO Direct to Fast Storage',
      enabled: true,
      order: 1,
      condition: { type: 'extension', value: 'iso' },
      action: { categoryId: 'programs', destinationFolder: 'D:\\ISOs', priority: 'high', maxConnections: 64 },
    },
    {
      id: 'rule_2',
      name: 'Public Speed Test Hosts',
      enabled: true,
      order: 2,
      condition: { type: 'hostname', value: '*.speedtest.example' },
      action: { queueId: 'speed_queue', priority: 'normal' },
    },
    {
      id: 'rule_3',
      name: 'Large Files Over 1GB',
      enabled: true,
      order: 3,
      condition: { type: 'min_size', value: 1073741824 },
      action: { priority: 'low', queueId: 'night_queue' },
    },
    {
      id: 'rule_disabled',
      name: 'Disabled Rule',
      enabled: false,
      order: 0,
      condition: { type: 'extension', value: 'iso' },
      action: { destinationFolder: 'Z:\\Invalid' },
    },
  ];

  rulesEngine.setRules(customRules);

  const eval1 = rulesEngine.evaluate('https://releases.ubuntu.com/noble.iso', 'noble.iso');
  assert(eval1 !== null, 'Rule 1 should match .iso extension');
  assert(eval1?.destinationFolder === 'D:\\ISOs', 'Destination folder should be D:\\ISOs');
  assert(eval1?.maxConnections === 64, 'Max connections should be 64');
  assert(eval1?.priority === 'high', 'Priority should be high');

  const eval2 = rulesEngine.evaluate('https://files.pythonhosted.org/__down?bytes=50000000', 'benchmark.bin');
  assert(eval2 === null, 'Rule 2 must NOT match non-wildcarded pythonhosted.org host');
  const eval2b = rulesEngine.evaluate('https://lon.speedtest.example/__down?bytes=50000000', 'benchmark.bin');
  assert(eval2b !== null, 'Rule 2 should match *.speedtest.example wildcard host');
  assert(eval2b?.queueId === 'speed_queue', 'Queue should be speed_queue');

  const eval3 = rulesEngine.evaluate('https://example.com/huge.bin', 'huge.bin', 2000000000);
  assert(eval3 !== null, 'Rule 3 should match size >= 1GB');
  assert(eval3?.priority === 'low', 'Priority should be low');
  assert(eval3?.queueId === 'night_queue', 'Queue should be night_queue');

  console.log('=== SUITE 20 PASSED: ALL CATEGORY & RULES ENGINE TESTS SUCCEEDED ===');
}

runRulesTests().catch(err => {
  console.error('Rules test failed:', err);
  process.exit(1);
});
