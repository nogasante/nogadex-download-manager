/**
 * Phase 10.4: Connection-Cap Downgrade & Recovery Test Suite
 *
 * Verifies that HTTP 429/503 pressure downgrades per-host connection caps in a
 * windowed fashion (no permanent stickiness), that clean transfers gradually
 * restore concurrency (stepwise recovery probes), that recovery never exceeds
 * the historical ceiling, and that strict single-stream file hosts keep their
 * special treatment.
 */
import { HostIntelligence } from './host_intelligence';

console.log('================================================================================');
console.log('       PHASE 10.4 CONNECTION-CAP DOWNGRADE & RECOVERY TEST SUITE                ');
console.log('================================================================================\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, testId: string, desc: string) {
  if (condition) {
    console.log(`[PASS] ${testId}: ${desc}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testId}: ${desc}`);
    failed++;
  }
}

function runTests() {

  // CAP-01: 429 pressure downgrades the connection cap (0.7x, floor 2)
  {
    const host = new HostIntelligence();
    const url = 'http://cap-01.test/file.bin';
    host.setCapabilities(url, { maxConnections: 16 });
    host.recordFailure(url, 429);
    host.recordFailure(url, 429);
    const capped = host.getOptimalConnectionsForHost(url, 16);
    assert(capped === 11, 'CAP-01', `429 pressure downgraded cap 16 -> ${capped} (expected 11)`);
  }

  // CAP-02: downgrades are windowed - a fresh downgrade needs fresh error pressure
  {
    const host = new HostIntelligence();
    const url = 'http://cap-02.test/file.bin';
    host.setCapabilities(url, { maxConnections: 16 });
    host.recordFailure(url, 429);
    host.recordFailure(url, 429);
    host.recordFailure(url, 429);
    host.recordFailure(url, 429);
    const capped = host.getOptimalConnectionsForHost(url, 16);
    assert(capped === 11, 'CAP-02a', `Consecutive failures cause only one downgrade (got cap ${capped})`);

    // After the cooldown window (disabled here), new pressure downgrades again
    host.CAP_RECOVERY_COOLDOWN_MS = 0;
    host.recordFailure(url, 429);
    host.recordFailure(url, 429);
    const capped2 = host.getOptimalConnectionsForHost(url, 16);
    assert(capped2 < 11, 'CAP-02b', `Pressure after cooldown window downgrades again (got cap ${capped2})`);
  }

  // CAP-03: stepwise recovery restores caps toward the historical ceiling
  {
    const host = new HostIntelligence();
    const url = 'http://cap-03.test/file.bin';
    host.setCapabilities(url, { maxConnections: 8 });
    host.recordFailure(url, 429);
    host.recordFailure(url, 429);
    let cap = host.getOptimalConnectionsForHost(url, 8);
    assert(cap === 5, 'CAP-03a', `Downgraded cap 8 -> ${cap} (expected 5)`);

    // Clean successes build evidence, then a probe restores one level
    // (calm-down window disabled so the test can probe immediately)
    for (let i = 0; i < 3; i++) host.recordCapSuccess(url);
    host.CAP_RECOVERY_PROBE_INTERVAL_MS = 0;
    host.CAP_RECOVERY_COOLDOWN_MS = 0;
    cap = host.getOptimalConnectionsForHost(url, 8);
    assert(cap === 6, 'CAP-03b', `Recovery probe restored cap to ${cap} (expected 6)`);
    assert(host.consumeCapRecovery(url) === true, 'CAP-03c', 'Recovery probe signaled via consumeCapRecovery');
    assert(host.consumeCapRecovery(url) === false, 'CAP-03d', 'Recovery signal consumed exactly once');

    // Repeated probes walk back to the historical ceiling but never beyond
    host.CAP_RECOVERY_COOLDOWN_MS = 0;
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 3; i++) host.recordCapSuccess(url);
      cap = host.getOptimalConnectionsForHost(url, 8);
    }
    assert(cap === 8, 'CAP-03e', `Repeated probes restored cap to historical ceiling (got ${cap})`);
  }

  // CAP-04: recovery requires the success threshold, not just one clean transfer
  {
    const host = new HostIntelligence();
    const url = 'http://cap-04.test/file.bin';
    host.setCapabilities(url, { maxConnections: 8 });
    host.recordFailure(url, 429);
    host.recordFailure(url, 429);
    host.getOptimalConnectionsForHost(url, 8);
    host.recordCapSuccess(url);
    host.recordCapSuccess(url);
    host.CAP_RECOVERY_PROBE_INTERVAL_MS = 0;
    const cap = host.getOptimalConnectionsForHost(url, 8);
    assert(cap === 5, 'CAP-04', `Two successes below threshold: cap stays downgraded (got ${cap}, expected 5)`);
  }

  // CAP-05: hard throttle to single stream is tracked and recoverable
  {
    const host = new HostIntelligence();
    const url = 'http://cap-05.test/file.bin';
    host.setCapabilities(url, { maxConnections: 8, maxObservedConnections: 8 });
    host.throttleHostToSingleStream(url, 8);
    let cap = host.getOptimalConnectionsForHost(url, 8);
    assert(cap === 1, 'CAP-05a', `Hard throttle clamps host to 1 connection (got ${cap})`);

    host.CAP_RECOVERY_PROBE_INTERVAL_MS = 0;
    host.CAP_RECOVERY_COOLDOWN_MS = 0;
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 3; i++) host.recordCapSuccess(url);
      cap = host.getOptimalConnectionsForHost(url, 8);
    }
    assert(cap === 8, 'CAP-05b', `Hard throttle recovers stepwise to ceiling (got ${cap})`);
  }

  // CAP-06: hard throttle without a known ceiling clamps to 1
  {
    const host = new HostIntelligence();
    const url = 'http://cap-06.test/file.bin';
    host.throttleHostToSingleStream(url);
    host.setCapabilities(url, { maxConnections: 1, maxObservedConnections: 1 });
    const cap = host.getOptimalConnectionsForHost(url, 16);
    assert(cap === 1, 'CAP-06', `Unknown-ceiling host stays clamped to 1 (got ${cap})`);
  }

  // CAP-07: strict file-host list always returns 1 and clears recovery state
  {
    const host = new HostIntelligence();
    const url = 'http://rapidgator.net/file.bin';
    host.setCapabilities(url, { maxConnections: 8 });
    host.recordCapSuccess(url);
    host.recordCapSuccess(url);
    host.recordCapSuccess(url);
    const cap = host.getOptimalConnectionsForHost(url, 8);
    assert(cap === 1, 'CAP-07', `Strict file host stays single-stream (got ${cap})`);
  }

  // CAP-08: recovery never exceeds the requested ceiling even if history is higher
  {
    const host = new HostIntelligence();
    const url = 'http://cap-08.test/file.bin';
    host.setCapabilities(url, { maxConnections: 8, maxObservedConnections: 8 });
    host.recordFailure(url, 503);
    host.recordFailure(url, 503);
    host.recordFailure(url, 503);
    let cap = host.getOptimalConnectionsForHost(url, 8);
    assert(cap === 5, 'CAP-08a', `503 pressure downgraded cap to ${cap} (expected 5)`);

    host.CAP_RECOVERY_PROBE_INTERVAL_MS = 0;
    host.CAP_RECOVERY_COOLDOWN_MS = 0;
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 3; i++) host.recordCapSuccess(url);
      cap = host.getOptimalConnectionsForHost(url, 8);
    }
    assert(cap === 8, 'CAP-08b', `Cap recovers stepwise to historical ceiling of 8 (got ${cap})`);
  }

  // CAP-09: TTL expiry clears recovery tracking for the domain
  {
    const host = new HostIntelligence(0); // TTL = 0 -> immediate expiry
    const url = 'http://cap-09.test/file.bin';
    host.setCapabilities(url, { maxConnections: 8 });
    host.recordFailure(url, 429);
    host.recordFailure(url, 429);
    host.recordCapSuccess(url);
    const retrieved = host.getCapabilities(url);
    assert(retrieved === null, 'CAP-09', 'Expired capability returns null and clears recovery tracking');
  }

  // CAP-10: clear() resets all recovery state
  {
    const host = new HostIntelligence();
    const url = 'http://cap-10.test/file.bin';
    host.setCapabilities(url, { maxConnections: 8 });
    host.recordFailure(url, 429);
    host.recordFailure(url, 429);
    host.recordCapSuccess(url);
    host.clear();
    const cap = host.getOptimalConnectionsForHost(url, 8);
    assert(cap === 8, 'CAP-10', `clear() removes caps and recovery state (got ${cap})`);
  }

  console.log('\n================================================================================');
  console.log(`       CONNECTION-CAP TEST RESULTS: ${passed} PASSED, ${failed} FAILED                                `);
  console.log('================================================================================\n');

  if (failed > 0) process.exit(1);
}

runTests();
