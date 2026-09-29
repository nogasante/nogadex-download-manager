/**
 * Queue Auto-Assignment Test Suite
 *
 * Verifies that every download entering the system lands in a queue so that
 * queue start/stop semantics govern ALL downloads (not just rule-matched
 * ones): rules-engine routing wins, unmatched downloads join the default
 * queue, reassignment enforces single-membership, and deletion removes
 * membership from every queue.
 */
import { QueueSchedulerEngine } from './queue_scheduler_engine';

console.log('================================================================================');
console.log('       QUEUE AUTO-ASSIGNMENT TEST SUITE                                         ');
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
  // --------------------------------------------------------------------------
  // QA-01: Unassigned downloads auto-join the default queue
  // --------------------------------------------------------------------------
  {
    const qs = new QueueSchedulerEngine();
    const q = qs.autoAssignDownload('dl_a');
    assert(q.id === 'default', 'QA-01a', 'Download without rule routing joins the default queue');
    assert(qs.getQueue('default')?.downloadIds.includes('dl_a') === true, 'QA-01b', 'Default queue membership recorded');
    assert(qs.findQueueOf('dl_a')?.id === 'default', 'QA-01c', 'findQueueOf resolves default membership');
    qs.destroy();
  }

  // --------------------------------------------------------------------------
  // QA-02: Rule-specified queue wins over default
  // --------------------------------------------------------------------------
  {
    const qs = new QueueSchedulerEngine();
    qs.createQueue('night', 'Nightly', 2);
    const q = qs.autoAssignDownload('dl_b', 'night');
    assert(q.id === 'night', 'QA-02a', 'Rule-specified queue receives the download');
    assert(qs.getQueue('default')?.downloadIds.includes('dl_b') === false, 'QA-02b', 'Default queue does NOT also capture it');
    qs.destroy();
  }

  // --------------------------------------------------------------------------
  // QA-03: Unknown rule queue falls back to default (no silent drop)
  // --------------------------------------------------------------------------
  {
    const qs = new QueueSchedulerEngine();
    const q = qs.autoAssignDownload('dl_c', 'ghost_queue');
    assert(q.id === 'default', 'QA-03', 'Unknown rule queue falls back to default instead of dropping the download');
    qs.destroy();
  }

  // --------------------------------------------------------------------------
  // QA-04: Reassignment enforces single membership
  // --------------------------------------------------------------------------
  {
    const qs = new QueueSchedulerEngine();
    qs.createQueue('work', 'Work', 2);
    qs.autoAssignDownload('dl_d', 'work');
    qs.autoAssignDownload('dl_d'); // reassign to default
    assert(qs.findQueueOf('dl_d')?.id === 'default', 'QA-04a', 'Reassignment moves the download to the new queue');
    assert(qs.getQueue('work')?.downloadIds.includes('dl_d') === false, 'QA-04b', 'Old queue membership removed (no duplicates across queues)');
    qs.destroy();
  }

  // --------------------------------------------------------------------------
  // QA-05: Double assignment is idempotent (no duplicate IDs in one queue)
  // --------------------------------------------------------------------------
  {
    const qs = new QueueSchedulerEngine();
    qs.autoAssignDownload('dl_e');
    qs.autoAssignDownload('dl_e');
    const ids = qs.getQueue('default')!.downloadIds.filter(id => id === 'dl_e');
    assert(ids.length === 1, 'QA-05', 'Assigning twice does not duplicate membership');
    qs.destroy();
  }

  // --------------------------------------------------------------------------
  // QA-06: removeFromAllQueues cleans membership (delete path)
  // --------------------------------------------------------------------------
  {
    const qs = new QueueSchedulerEngine();
    qs.createQueue('q2', 'Q2', 2);
    qs.autoAssignDownload('dl_f', 'q2');
    qs.autoAssignDownload('dl_g', 'q2');
    qs.autoAssignDownload('dl_g'); // stale duplicate in default too
    qs.removeFromAllQueues('dl_g');
    assert(qs.findQueueOf('dl_g') === undefined, 'QA-06a', 'removeFromAllQueues removes membership from every queue');
    assert(qs.getQueue('q2')?.downloadIds.includes('dl_f') === true, 'QA-06b', 'Other downloads unaffected');
    qs.destroy();
  }

  // --------------------------------------------------------------------------
  // QA-07: addToQueue still works for explicit management (reorder etc.)
  // --------------------------------------------------------------------------
  {
    const qs = new QueueSchedulerEngine();
    const ok = qs.addToQueue('default', 'dl_h');
    assert(ok === true && qs.findQueueOf('dl_h')?.id === 'default', 'QA-07a', 'Explicit addToQueue remains functional');
    const bad = qs.addToQueue('nonexistent', 'dl_h');
    assert(bad === false, 'QA-07b', 'addToQueue to unknown queue returns false');
    qs.destroy();
  }

  // --------------------------------------------------------------------------
  // QA-08: Default queue cannot be deleted (assignment target must exist)
  // --------------------------------------------------------------------------
  {
    const qs = new QueueSchedulerEngine();
    assert(qs.deleteQueue('default') === false, 'QA-08', 'Default queue deletion blocked (auto-assignment target preserved)');
    qs.destroy();
  }

  // --------------------------------------------------------------------------
  // QA-09: Assignment is deterministic order (append preserves queue order)
  // --------------------------------------------------------------------------
  {
    const qs = new QueueSchedulerEngine();
    qs.autoAssignDownload('dl_1');
    qs.autoAssignDownload('dl_2');
    qs.autoAssignDownload('dl_3');
    const ids = qs.getQueue('default')!.downloadIds;
    const i1 = ids.indexOf('dl_1'), i2 = ids.indexOf('dl_2'), i3 = ids.indexOf('dl_3');
    assert(i1 < i2 && i2 < i3, 'QA-09', 'Auto-assignment appends in arrival order (FIFO queue position)');
    qs.destroy();
  }

  console.log('\n================================================================================');
  console.log(`       QUEUE ASSIGNMENT TEST RESULTS: ${passed} PASSED, ${failed} FAILED                                         `);
  console.log('================================================================================\n');

  if (failed > 0) process.exit(1);
}

runTests();
