import { QueueSchedulerEngine } from './queue_scheduler_engine';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runQueueSchedulerTests() {
  console.log('=== SUITE 21: PHASE 9.3 QUEUES & SCHEDULER SUBSYSTEM ===');

  const engine = new QueueSchedulerEngine();

  try {
    // Test 1: Queue Creation & Concurrency Configuration
    console.log('[Test 1] Testing Multi-Queue Creation & Concurrency Boundaries...');
    const defaultQ = engine.getQueue('default');
    assert(defaultQ !== undefined, 'Default queue must exist on startup');
    assert(defaultQ?.maxConcurrent === 3, 'Default queue concurrency is 3');

    const nightQ = engine.createQueue('night_downloads', 'Night Downloads', 5, {
      enabled: true,
      startAtTime: '23:00:00',
      stopAtTime: '07:00:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      actionOnComplete: 'stop_queue',
    });
    assert(nightQ.id === 'night_downloads', 'Created Night Downloads queue');
    assert(nightQ.schedule.startAtTime === '23:00:00', 'Night schedule start time matches');
    assert(nightQ.schedule.enabled === true, 'Night schedule enabled is true');

    // Test 2: Item Addition & Reordering
    console.log('[Test 2] Testing Queue Membership & Item Reordering...');
    engine.addToQueue('night_downloads', 'dl_1');
    engine.addToQueue('night_downloads', 'dl_2');
    engine.addToQueue('night_downloads', 'dl_3');
    assert(nightQ.downloadIds.length === 3, 'Queue should hold 3 downloads');

    engine.reorderItem('night_downloads', 'dl_3', 'top');
    assert(nightQ.downloadIds[0] === 'dl_3', 'dl_3 should move to top');

    engine.reorderItem('night_downloads', 'dl_3', 'down');
    assert(nightQ.downloadIds[1] === 'dl_3', 'dl_3 should move down to index 1');

    engine.removeFromQueue('night_downloads', 'dl_2');
    assert(nightQ.downloadIds.length === 2, 'Queue should hold 2 downloads after deletion');

    // Test 3: Schedule Trigger Validation with Overnight Window Support
    console.log('[Test 3] Testing Overnight Schedule Triggers (23:00 -> 07:00)...');
    let startTriggered = false;
    let stopTriggered = false;

    engine.on('queueStarted', (q) => {
      if (q.id === 'night_downloads') startTriggered = true;
    });

    engine.on('queueStopped', (q) => {
      if (q.id === 'night_downloads') stopTriggered = true;
    });

    // 23:00:05 is inside overnight window
    const mockNight = new Date();
    mockNight.setHours(23, 0, 5, 0);
    engine.checkSchedules(mockNight);
    assert(startTriggered, 'Night queue should start automatically at 23:00:05');
    assert(nightQ.state === 'running', 'Queue state should be running');

    // 12:00:00 is outside overnight window (should stop)
    const mockAfternoon = new Date();
    mockAfternoon.setHours(12, 0, 0, 0);
    engine.checkSchedules(mockAfternoon);
    assert(stopTriggered, 'Night queue should stop automatically at 12:00:00');
    assert(nightQ.state === 'stopped', 'Queue state should be stopped');

    // Test 4: Default Queue Immutability
    console.log('[Test 4] Testing Default Queue Immutability...');
    const deletedDefault = engine.deleteQueue('default');
    assert(deletedDefault === false, 'Default queue must not be deleted');

    console.log('=== SUITE 21 PASSED: ALL QUEUE & SCHEDULER TESTS SUCCEEDED ===');
  } finally {
    engine.destroy();
  }
}

runQueueSchedulerTests().catch(err => {
  console.error('Queue & Scheduler test failed:', err);
  process.exit(1);
});
