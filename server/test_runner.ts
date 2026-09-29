import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SuiteResult {
  name: string;
  file: string;
  passed: boolean;
  durationMs: number;
  output: string;
  exitCode: number | null;
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
  // NETWORK SUITE — opt-in only: hits real internet (~GitHub raw + httpbin).
  // Run explicitly with: npx tsx server/test_real_internet.ts
  { name: 'P8 Real Internet Acceptance', file: 'test_real_internet.ts', network: true },
  { name: 'P8.7 Batch URL Pattern Engine', file: 'test_batch_engine.ts' },
  { name: 'Phase 9.1 Settings & Preferences Engine', file: 'test_settings_store.ts' },
  { name: 'Phase 9.2 Categories & Rules Engine', file: 'test_rules_engine.ts' },
  { name: 'Phase 9.3 Queues & Scheduler Subsystem', file: 'test_queue_scheduler.ts' },
  { name: 'Phase 9.4 Browser Extension & Native Bridge', file: 'test_native_bridge.ts' },
  { name: 'Phase 9.5 Clipboard & Drag/Drop Subsystem', file: 'test_clipboard_monitor.ts' },
  { name: 'Phase 9.6 History & Import/Export Subsystem', file: 'test_history_export.ts' },
  { name: 'Phase 9.7 Site Grabber Subsystem', file: 'test_site_grabber.ts' },
  { name: 'Phase 9.8 Proxy & Authentication Subsystem', file: 'test_proxy_auth.ts' },
  { name: 'Phase 9.9 Diagnostics & Telemetry Subsystem', file: 'test_diagnostics.ts' },
  { name: 'Phase 9.10 Master Product Integration Gate', file: 'test_full_integration_phase9.ts' },
  { name: 'Phase 10 Production Platform & Distribution', file: 'test_phase10_platform.ts' },
  { name: 'Phase 10.1 Category Folders & FS Permissions', file: 'test_category_folders.ts' },
  { name: 'Phase 10.2 File & App Native Icon Extraction', file: 'test_file_icons.ts' },
  { name: 'Phase 10.3 Add URL Dialog Full Interaction Verification', file: 'test_add_url_dialog_interactions.ts' },
  { name: 'Phase 10.4 Connection-Cap Downgrade & Recovery', file: 'test_cap_recovery.ts' },
  { name: 'Phase 10.5 Browser Capture Credential Passthrough', file: 'test_capture_credentials.ts' },
  { name: 'Queue Auto-Assignment', file: 'test_queue_assignment.ts' },
  { name: 'Phase 10.6 Retry Dedupe & Bulk Retry', file: 'test_retry_dedupe.ts' },
  { name: 'Phase 10.7 Duplicate URL & File Preservation', file: 'test_dup_url.ts' },
  { name: 'Phase 10.8 Integrity Scanner', file: 'test_integrity_scan.ts' },
  { name: 'Phase 10.9 Pay-for-Speed Host Simulation', file: 'test_paywall_host.ts' },
  { name: 'Phase 10.10 HTTP/2 Transport', file: 'test_http2.ts' },
  { name: 'Phase 10.11 Product-Parity Features', file: 'test_product_parity.ts' },
  { name: 'Phase 10.12 Failed-Download Help Guide Mapping', file: 'test_error_help.ts' },
];

function runSuite(suite: { name: string; file: string }): Promise<SuiteResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const filePath = `server/${suite.file}`;

    console.log(`[*] Running ${suite.name} (${filePath})...`);

    const proc = spawn('npx', ['tsx', filePath], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        // Sandbox every suite: engines constructed without an explicit dir
        // must never read/write the user's real .hyper_state.json in Downloads.
        HYPER_TEST_STATE_DIR: path.join(os.tmpdir(), 'hyper_test_state_' + suite.file.replace(/\.ts$/, '')),
        // NET and scheduler suites exercise the engine's 6s stall detector;
        // shrinking it to 600ms makes their timing tests deterministic under
        // full-suite load instead of flaky.
        ...(suite.file === 'test_network.ts' || suite.file === 'test_scheduler.ts'
          ? { HYPER_STALL_MS: '600' }
          : {}),
      },
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
        exitCode: code,
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
        exitCode: null,
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

  // Suites that hit the real internet (burning user data bundles) are skipped
  // unless NDM_NETWORK_TESTS=1 is set. Everything else is fully local.
  const allowNetwork = process.env.NDM_NETWORK_TESTS === '1';
  const suites = SUITES.filter((s) => allowNetwork || !(s as { network?: boolean }).network);
  console.log(`[*] ${suites.length}/${SUITES.length} suites selected (network suites: ${allowNetwork ? 'INCLUDED' : 'skipped — set NDM_NETWORK_TESTS=1 to include'})\n`);

  for (const suite of suites) {
    let res = await runSuite(suite);

    // A native Windows abort (not a real test failure — those exit 1) means
    // the OS failed to start/tear down the child cleanly under batch
    // pressure. Every suite here is deterministic standalone, so retry such
    // deaths once after a longer settle. Exit code 1 is NEVER retried.
    const NATIVE_ABORT_CODES = new Set([
      3221225794, // 0xC0000142 STATUS_DLL_INIT_FAILED
      3221226505, // 0xC0000409 STATUS_STACK_BUFFER_OVERRUN
      3221225477, // 0xC0000005 STATUS_ACCESS_VIOLATION
      134, // node abort
    ]);
    if (!res.passed && res.exitCode !== null && NATIVE_ABORT_CODES.has(res.exitCode)) {
      console.error(`[*] ${suite.name} died with native abort (code ${res.exitCode}) — retrying once after settle...\n`);
      await new Promise((r) => setTimeout(r, 3000));
      res = await runSuite(suite);
    }

    results.push(res);
    // Windows: rapid-fire child spawns (~4 process creations per suite via
    // shell+npx+tsx+node) can exhaust desktop-heap/commit resources partway
    // through a batch, with every later child dying at 0xC0000142
    // (STATUS_DLL_INIT_FAILED) before any test code runs. A short settle
    // between suites lets the OS reclaim those resources.
    await new Promise((r) => setTimeout(r, 500));
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
