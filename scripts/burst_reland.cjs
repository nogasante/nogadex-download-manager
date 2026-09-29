/* Exp 2: re-land burst — remove the 150 ms ramp in trySmallFileFastPath so all
 * range connections open immediately (aria2/IDM open the full pool up front).
 * Last session this crashed 3/3 bundled with global fetch; now the fast path
 * runs on node http/https with a per-call agent (see fastpath_http_agent.cjs). */
const fs = require('fs');
let s = fs.readFileSync('server/engine.ts', 'utf8');
let fail = '';
function apply(from, to, n) {
  const c = s.split(from).length - 1;
  if (c !== n) { fail = 'MATCH FAIL (' + c + ' vs ' + n + '): ' + from.slice(0, 70); return; }
  s = s.replace(from, to);
}

apply(
`      let nextIndex = 0;
      let activeWorkers = 0;
      let targetWorkers = Math.min(4, rangeCount);
      let failure: unknown = null;
      let resolveAll: () => void = () => {};
      const allDone = new Promise<void>(resolve => { resolveAll = resolve; });
      const rampTimer = setInterval(() => {
        if (!failure && nextIndex < rangeCount) targetWorkers = Math.min(rangeCount, targetWorkers + 4);
        if (!failure && activeWorkers < targetWorkers) spawnWorker();
      }, 150);`,
`      // Burst: open every range connection immediately. A 150 ms ramp used to
      // mean small transfers finished mid-ramp, never reaching full parallelism
      // (aria2/IDM open their whole pool up front).
      let nextIndex = 0;
      let activeWorkers = 0;
      let failure: unknown = null;
      let resolveAll: () => void = () => {};
      const allDone = new Promise<void>(resolve => { resolveAll = resolve; });`, 1);

apply(
`      for (let i = 0; i < targetWorkers; i++) spawnWorker();
      await allDone;
      clearInterval(rampTimer);
      fastAgent.destroy();`,
`      for (let i = 0; i < rangeCount; i++) spawnWorker();
      await allDone;
      fastAgent.destroy();`, 1);

if (fail) { console.error(fail); process.exit(1); }
fs.writeFileSync('server/engine.ts', s);
console.log('EXP2 BURST APPLIED');
