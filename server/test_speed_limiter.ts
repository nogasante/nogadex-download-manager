import { SpeedLimiter } from './speed_limiter';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runTests() {
  console.log('========================================================================');
  console.log('       HYPERDOWNLOADER SPEED LIMITER ENGINE TEST SUITE                  ');
  console.log('========================================================================\n');

  const limiter = new SpeedLimiter(500); // 500 KB/s
  assert(limiter.isEnabled(), 'LIM-01: Limiter is enabled at 500 KB/s');
  assert(limiter.getLimitKBps() === 500, 'LIM-02: Limit reports 500 KB/s');

  const delay0 = await limiter.consume(10 * 1024);
  assert(delay0 === 0, 'LIM-03: Initial burst within token capacity consumes with 0ms wait');

  limiter.setLimit(0);
  assert(!limiter.isEnabled(), 'LIM-04: Limit set to 0 disables throttling');

  console.log('\n========================================================================');
  console.log('SPEED LIMITER TEST RESULTS: ALL ASSIGNMENTS PASSED');
  console.log('========================================================================\n');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
