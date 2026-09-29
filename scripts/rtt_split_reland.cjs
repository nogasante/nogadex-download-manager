/* Exp 3: RTT-aware minimum split in trySmallFileFastPath.
 * >= 40 ms measured RTT -> 1 MB ranges; low-RTT/unknown stays 32 KB
 * (OPT-09 asserts 32 chunks for a 1 MB file on localhost). */
const fs = require('fs');
let s = fs.readFileSync('server/engine.ts', 'utf8');
let fail = '';
function apply(from, to, n) {
  const c = s.split(from).length - 1;
  if (c !== n) { fail = 'MATCH FAIL (' + c + ' vs ' + n + '): ' + from.slice(0, 70); return; }
  s = s.replace(from, to);
}

apply(
`    const requestedRanges = item.autoStreams ? 32 : Math.max(1, Math.min(item.connections, 32));
    const rangeCount = Math.min(requestedRanges, Math.max(1, Math.ceil(totalBytes / (32 * 1024))));`,
`    const requestedRanges = item.autoStreams ? 32 : Math.max(1, Math.min(item.connections, 32));
    // RTT-aware minimum split: on high-latency hosts, 32 KB ranges spend more
    // time in request round-trips than transferring data. 1 MB ranges keep the
    // transfer bandwidth-bound there; low-RTT origins keep 32 KB so small
    // files still parallelize fully (and OPT-09's 32-chunk contract holds).
    const minRangeBytes = this.hostIntelligence.getAverageLatencyMs(requestUrl) >= 40
      ? 1024 * 1024
      : 32 * 1024;
    const rangeCount = Math.min(requestedRanges, Math.max(1, Math.ceil(totalBytes / minRangeBytes)));`, 1);

if (fail) { console.error(fail); process.exit(1); }
fs.writeFileSync('server/engine.ts', s);
console.log('EXP3 RTT-SPLIT APPLIED');
