import { DiagnosticsEngine } from './diagnostics_engine';
import { DownloadEngine } from './engine';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runDiagnosticsTests() {
  console.log('=== SUITE 27: PHASE 9.9 DIAGNOSTICS & TELEMETRY SUBSYSTEM ===');

  const engine = new DownloadEngine(() => {});
  const diag = new DiagnosticsEngine(engine);

  try {
    // Test 1: System Telemetry Aggregation
    console.log('[Test 1] Testing Process Telemetry Aggregation...');
    const tele = diag.getSystemTelemetry();
    assert(tele.rssMemoryMB > 0, 'RSS memory reported');
    assert(tele.heapUsedMB > 0, 'Heap used reported');
    assert(typeof tele.uptimeSec === 'number', 'Uptime reported');
    assert(tele.platform === process.platform, 'Platform reported');

    // Test 2: Full Diagnostic Bundle Generation
    console.log('[Test 2] Testing Diagnostic Bundle Structure...');
    const bundle = await diag.generateDiagnosticBundle(true);
    assert(bundle.timestamp > 0, 'Bundle timestamp recorded');
    assert(bundle.cdnHealth.length >= 2, 'CDN probe health array populated');
    assert(bundle.cdnHealth[0].status === 'online', 'Cloudflare status reported online');
    assert(bundle.cdnHealth[0].latencyMs === 25, 'Latency recorded');
    assert(typeof bundle.activeStreamsSummary.totalChunks === 'number', 'Stream summary reported');

    console.log('=== SUITE 27 PASSED: ALL DIAGNOSTICS TESTS SUCCEEDED ===');
  } finally {
    await engine.shutdown();
  }
}

runDiagnosticsTests().catch(err => {
  console.error('Diagnostics test failed:', err);
  process.exit(1);
});
