import { QueueManager } from './queue_manager';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
  console.log(`[PASS] ${message}`);
}

console.log('========================================================================');
console.log('       HYPERDOWNLOADER QUEUE & CONCURRENCY ENGINE TEST SUITE            ');
console.log('========================================================================\n');

// 1. Concurrency throttle (max 2 active)
const qm = new QueueManager(2);
assert(qm.getMaxActive() === 2, 'QUEUE-01a: Max active set to 2');

const it1 = qm.addItem('dl_1', 'https://example.com/1.iso');
const it2 = qm.addItem('dl_2', 'https://example.com/2.iso');
const it3 = qm.addItem('dl_3', 'https://example.com/3.iso');
const it4 = qm.addItem('dl_4', 'https://example.com/4.iso');

assert(it1.status === 'downloading', 'QUEUE-01b: Item 1 starts immediately as downloading');
assert(it2.status === 'downloading', 'QUEUE-01c: Item 2 starts immediately as downloading');
assert(it3.status === 'queued', 'QUEUE-01d: Item 3 throttled to queued');
assert(it4.status === 'queued', 'QUEUE-01e: Item 4 throttled to queued');
assert(qm.getActiveCount() === 2, 'QUEUE-01f: Exactly 2 active items');
assert(qm.getQueuedCount() === 2, 'QUEUE-01g: Exactly 2 queued items');

// 2. Automatic promotion upon completion
const promoted1 = qm.markStatus('dl_1', 'completed');
assert(promoted1.length === 1 && promoted1[0] === 'dl_3', 'QUEUE-02a: Completing Item 1 automatically promotes Item 3 to downloading');
assert(qm.getItem('dl_3')?.status === 'downloading', 'QUEUE-02b: Item 3 status transitioned to downloading');
assert(qm.getActiveCount() === 2, 'QUEUE-02c: Active count remains at max limit 2');

// 3. Automatic promotion upon error/failure
const promoted2 = qm.markStatus('dl_2', 'error');
assert(promoted2.length === 1 && promoted2[0] === 'dl_4', 'QUEUE-03a: Failing Item 2 automatically promotes Item 4 to downloading');
assert(qm.getItem('dl_4')?.status === 'downloading', 'QUEUE-03b: Item 4 status transitioned to downloading');
assert(qm.getQueuedCount() === 0, 'QUEUE-03c: Queue count is now 0');

// 4. Priority reordering
const qm2 = new QueueManager(1);
qm2.addItem('q_a', 'http://a.com');
qm2.addItem('q_b', 'http://b.com');
qm2.addItem('q_c', 'http://c.com');
qm2.addItem('q_d', 'http://d.com');

// Move q_d to top
qm2.reorder('q_d', 'top');
const list = qm2.getQueue();
assert(list[0].id === 'q_d', 'QUEUE-04a: Reorder top moved q_d to first index');

// 5. Pause All and Resume All
const paused = qm2.pauseAll();
assert(paused.length === 4, 'QUEUE-05a: Pause all affected all 4 items');
assert(qm2.getActiveCount() === 0, 'QUEUE-05b: 0 active downloads after pause all');

const resumed = qm2.resumeAll();
assert(resumed.length === 1 && resumed[0] === 'q_d', 'QUEUE-05c: Resume all promoted highest priority item (q_d) to downloading');
assert(qm2.getActiveCount() === 1, 'QUEUE-05d: Exactly 1 download active according to limit');

console.log('\n========================================================================');
console.log('QUEUE & CONCURRENCY ENGINE TEST RESULTS: ALL 5 ASSIGNMENTS PASSED');
console.log('========================================================================\n');
