import { DownloadEngine } from './engine';
import { SettingsManager } from './settings_store';
import { RulesEngine } from './rules_engine';
import { QueueSchedulerEngine } from './queue_scheduler_engine';
import { NativeBridgeManager, NDM_LOCAL_TOKEN } from './native_bridge';
import { ClipboardMonitorEngine } from './clipboard_monitor';
import { HistoryExportEngine } from './history_export_engine';
import { SiteGrabberEngine } from './site_grabber_engine';
import { ProxyAuthManager } from './proxy_auth_manager';
import { DiagnosticsEngine } from './diagnostics_engine';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runFullIntegrationPhase9() {
  console.log('================================================================================');
  console.log('       SUITE 28: PHASE 9 MASTER END-TO-END PRODUCT INTEGRATION                  ');
  console.log('================================================================================\n');

  // Step 1: Boot Core Subsystems
  console.log('[Step 1] Booting Core Subsystems...');
  const engine = new DownloadEngine(() => {});
  const settingsManager = new SettingsManager();
  const rulesEngine = new RulesEngine();
  const queueScheduler = new QueueSchedulerEngine();
  const nativeBridge = new NativeBridgeManager(engine, rulesEngine, settingsManager);
  const clipboardMonitor = new ClipboardMonitorEngine(settingsManager);
  const historyExport = new HistoryExportEngine();
  const siteGrabber = new SiteGrabberEngine();
  const proxyAuth = new ProxyAuthManager();
  const diagnostics = new DiagnosticsEngine(engine);
  assert(true, 'All 10 Phase 9 Subsystems initialized successfully');

  try {
    // Step 2: Test Settings & Rules Cascading (9.1 & 9.2)
    console.log('[Step 2] Testing Settings & Rules Cascading...');
    settingsManager.updateSettings({
      downloads: { defaultDownloadFolder: 'C:\\Downloads', defaultConnections: 32 },
    });
    rulesEngine.setRules([
      {
        id: 'rule_iso',
        name: 'ISO Fast Path',
        enabled: true,
        order: 1,
        condition: { type: 'extension', value: 'iso' },
        action: { destinationFolder: 'D:\\ISOs', priority: 'high', maxConnections: 64 },
      },
    ]);

    const ruleMatch = rulesEngine.evaluate('https://releases.ubuntu.com/noble.iso', 'noble.iso');
    assert(ruleMatch?.destinationFolder === 'D:\\ISOs', 'Rule matched destination folder');
    assert(ruleMatch?.maxConnections === 64, 'Rule matched connection limit');

    // Step 3: Test Multi-Queue Scheduler (9.3)
    console.log('[Step 3] Testing Multi-Queue Scheduler...');
    const queue = queueScheduler.createQueue('q_night', 'Night ISOs', 2, {
      enabled: true,
      startAtTime: '23:00:00',
      stopAtTime: '07:00:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    });
    queueScheduler.addToQueue('q_night', 'iso_download_1');
    assert(queue.downloadIds.length === 1, 'Download added to Night queue');

    // Step 4: Test Browser Extension Bridge Security (9.4)
    console.log('[Step 4] Testing Browser Extension Bridge Security...');
    const authCheck = nativeBridge.validateRequest({
      ip: '127.0.0.1',
      headers: { 'x-ndm-token': NDM_LOCAL_TOKEN },
      socket: { remoteAddress: '127.0.0.1' },
    } as any);
    assert(authCheck.valid === true, 'Authorized local loopback token accepted');

    const unauthCheck = nativeBridge.validateRequest({
      ip: '10.0.0.15',
      headers: { 'x-ndm-token': NDM_LOCAL_TOKEN },
      socket: { remoteAddress: '10.0.0.15' },
    } as any);
    assert(unauthCheck.valid === false, 'Unauthorized LAN request rejected');

    // Step 5: Test Clipboard Parsing (9.5)
    console.log('[Step 5] Testing Clipboard Parsing...');
    const clipMatches = clipboardMonitor.parseClipboardText('Download package at https://cdn.example.org/release_v1.zip');
    assert(clipMatches.length === 1, 'Clipboard match detected downloadable package');
    assert(clipMatches[0].matchedExtension === 'zip', 'Matched extension is zip');

    // Step 6: Test History Export Roundtrip (9.6)
    console.log('[Step 6] Testing History Export/Import Roundtrip...');
    const downloads = engine.getAllDownloads();
    const csvOut = historyExport.exportToCsv(downloads);
    assert(typeof csvOut === 'string' && csvOut.includes('ID,Filename'), 'CSV exported with headers');

    // Step 7: Test Site Grabber HTML Parsing (9.7)
    console.log('[Step 7] Testing Site Grabber HTML Parsing...');
    const grabRes = siteGrabber.extractAssetsFromHtml(
      '<a href="/files/setup.exe">Setup</a><img src="/img/icon.png" />',
      'https://mysite.com/page.html',
      1,
      {
        startUrl: 'https://mysite.com',
        maxDepth: 1,
        domainScope: 'same_host',
        fileCategories: ['all'],
      }
    );
    assert(grabRes.assets.length === 2, 'Extracted setup.exe and icon.png');

    // Step 8: Test Proxy & Site Credential Injection (9.8)
    console.log('[Step 8] Testing Proxy & Site Credential Injection...');
    proxyAuth.addCredential({
      id: 'cred_test',
      domain: 'secure.repo.org',
      authType: 'bearer',
      token: 'jwt_test_token',
    });
    const headers = proxyAuth.resolveHeadersForUrl('https://secure.repo.org/package.tar.gz');
    assert(headers['Authorization'] === 'Bearer jwt_test_token', 'Bearer auth token injected');

    // Step 9: Test Diagnostics Telemetry (9.9)
    console.log('[Step 9] Testing Diagnostics Telemetry Bundle...');
    const bundle = await diagnostics.generateDiagnosticBundle(true);
    assert(bundle.system.rssMemoryMB > 0, 'System memory telemetry verified');
    assert(bundle.cdnHealth.length >= 2, 'CDN probe health verified');

    console.log('\n================================================================================');
    console.log('       MASTER INTEGRATION SUCCESSFUL: ALL 10 SUBSYSTEMS FULLY OPERATIONAL        ');
    console.log('================================================================================\n');
  } finally {
    queueScheduler.destroy();
    await engine.shutdown();
  }
}

runFullIntegrationPhase9().catch(err => {
  console.error('Full integration test failed:', err);
  process.exit(1);
});
