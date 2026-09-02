import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SuiteResult {
  name: string;
  file: string;
  passed: boolean;
  durationMs: number;
  output: string;
}

const SUITES = [
  { name: 'P0 Engine & Core Protocol', file: 'test_engine.ts' },
  { name: 'P0 Protocol Correctness', file: 'test_correctness.ts' },
  { name: 'P0.5 Integrity & Crash Resume', file: 'test_integrity.ts' },
  { name: 'P1.5 Dynamic Range Scheduler', file: 'test_scheduler.ts' },
  { name: 'P2 Adaptive Network Intelligence', file: 'test_network.ts' },
  { name: 'P3 Intelligent Download Optimizer', file: 'test_optimization.ts' },
  { name: 'P4 Adversarial Hardening', file: 'test_adversarial.ts' },
  { name: 'P5 Real HTTP Server Validation', file: 'test_real_server.ts' },
  { name: 'P5 Security & SSRF Defense', file: 'test_security.ts' },
  { name: 'P5 Soak & Resource Boundedness', file: 'test_soak.ts' },
  { name: 'P6 Product Hardening & Resilience', file: 'test_product_hardening.ts' },
  { name: 'P7 Final Pre-Release Gate', file: 'test_release_gate.ts' },
  { name: 'P8 Real Internet Acceptance', file: 'test_real_internet.ts' },
  { name: 'P8.7 Batch URL Pattern Engine', file: 'test_batch_engine.ts' },
  { name: 'P8.7 Settings Persistence Engine', file: 'test_settings_manager.ts' },
  { name: 'P8.7 Queue & Concurrency Engine', file: 'test_queue_manager.ts' },
  { name: 'P8.8 Dynamic Segmentation Engine', file: 'test_dynamic_segmenter.ts' },
  { name: 'P8.8 Bandwidth Speed Limiter Engine', file: 'test_speed_limiter.ts' },
  { name: 'Phase 9.1 Settings & Preferences Engine', file: 'test_settings_store.ts' },\n  { name: 'Phase 9.2 Categories & Rules Engine', file: 'test_rules_engine.ts' },\n  { name: 'Phase 9.3 Queues & Scheduler Subsystem', file: 'test_queue_scheduler.ts' },\n  { name: 'Phase 9.4 Browser Extension & Native Bridge', file: 'test_native_bridge.ts' },\n  { name: 'Phase 9.5 Clipboard & Drag/Drop Subsystem', file: 'test_clipboard_monitor.ts' },\n  { name: 'Phase 9.6 History & Import/Export Subsystem', file: 'test_history_export.ts' },\n  { name: 'Phase 9.7 Site Grabber Subsystem', file: 'test_site_grabber.ts' },\n  { name: 'Phase 9.8 Proxy & Authentication Subsystem', file: 'test_proxy_auth.ts' },\n  { name: 'Phase 9.9 Diagnostics & Telemetry Subsystem', file: 'test_diagnostics.ts' },\n  { name: 'Phase 9.10 Master Product Integration Gate', file: 'test_full_integration_phase9.ts' },
];

function runSuite(suite: { name: string; file: string }): Promise<SuiteResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const filePath = `server/${suite.file}`;

    console.log(`[*] Running ${suite.name} (${filePath})...`);

    const proc = spawn('npx', ['tsx', filePath], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let output = '';

    proc.stdout.on('data', (data) => {
      const s = data.toString();
      output += s;
      process.stdout.write(s);
    });

    proc.stderr.on('data', (data) => {
      const s = data.toString();
      output += s;
      process.stderr.write(s);
    });

    proc.on('close', (code) => {
      const durationMs = Date.now() - start;
      const passed = code === 0;

      if (passed) {
        console.log(`[PASS] ${suite.name} (${(durationMs / 1000).toFixed(2)}s)\n`);
      } else {
        console.error(`[FAIL] ${suite.name} exited with code ${code} (${(durationMs / 1000).toFixed(2)}s)\n`);
      }

      resolve({
        name: suite.name,
        file: suite.file,
        passed,
        durationMs,
        output,
      });
    });

    proc.on('error', (err) => {
      const durationMs = Date.now() - start;
      console.error(`[ERROR] Failed to start ${suite.name}:`, err);
      resolve({
        name: suite.name,
        file: suite.file,
        passed: false,
        durationMs,
        output: err.message,
      });
    });
  });
}

async function main() {
  console.log('================================================================================');
  console.log('       NOGADEX DOWNLOAD MANAGER 28-SUITE AUTOMATED CI TEST RUNNER               ');
  console.log('================================================================================\n');

  const results: SuiteResult[] = [];
  const overallStart = Date.now();

  for (const suite of SUITES) {
    const res = await runSuite(suite);
    results.push(res);
  }

  const overallDuration = ((Date.now() - overallStart) / 1000).toFixed(2);
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  console.log('\n================================================================================');
  console.log('       CI PIPELINE AGGREGATED REPORT                                            ');
  console.log('================================================================================');

  for (const res of results) {
    const mark = res.passed ? '[PASS]' : '[FAIL]';
    const dur = (res.durationMs / 1000).toFixed(2) + 's';
    console.log(`  ${mark} ${res.name.padEnd(44)} | ${dur}`);
  }

  console.log('--------------------------------------------------------------------------------');
  console.log(`Total Suites: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount} | Total Duration: ${overallDuration}s`);
  console.log('================================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
