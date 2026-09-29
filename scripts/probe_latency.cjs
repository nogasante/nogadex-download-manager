/* Exp 4: probe latency feedback. The probe is the only request that always
 * completes before the small-file fast path picks its minimum range size, but
 * it never recorded latency — so getAverageLatencyMs() was 0 for every fresh
 * host and the fast path burst 32 fresh TLS connections even at ~160 ms RTT
 * (proof.ovh.net: 27.4 s vs curl 4.8 s on 10 MB). Record the probe's round
 * trip in both probe paths. */
const fs = require('fs');
let s = fs.readFileSync('server/engine.ts', 'utf8');
let fail = '';
function apply(from, to, n) {
  const c = s.split(from).length - 1;
  if (c !== n) { fail = 'MATCH FAIL (' + c + ' vs ' + n + '): ' + from.slice(0, 70); return; }
  s = s.replace(from, to);
}

// 1. HEAD probe: capture start time.
apply(
`        const req = lib.request(parsedUrl, {
          method: 'HEAD',
          headers: probeHeaders,
          lookup: createSSRFSafeLookup(this.allowLocalhost),
          timeout: 8000,
        }, res => {`,
`        const probeStart = Date.now();
        const req = lib.request(parsedUrl, {
          method: 'HEAD',
          headers: probeHeaders,
          lookup: createSSRFSafeLookup(this.allowLocalhost),
          timeout: 8000,
        }, res => {`, 1);

// 2. HEAD probe: record latency on the terminal (non-redirect, <400) response.
apply(
`          if (!res.statusCode || res.statusCode >= 400 || !res.headers['content-length']) {
            return this.probeWithGetRange(url, maxRedirects, new Set(), false, credentials).then(resolve);
          }

          const contentLength = parseInt(res.headers['content-length'] || '0', 10);`,
`          if (!res.statusCode || res.statusCode >= 400 || !res.headers['content-length']) {
            return this.probeWithGetRange(url, maxRedirects, new Set(), false, credentials).then(resolve);
          }

          // Feed the probe's own round trip into host intelligence: the
          // small-file fast path consults getAverageLatencyMs to pick its
          // minimum range size, and the probe is the only request that has
          // always completed before that decision.
          this.hostIntelligence.recordRequestResult(url, res.statusCode, Date.now() - probeStart, 0, false, false);
          const contentLength = parseInt(res.headers['content-length'] || '0', 10);`, 1);

// 3. GET-range probe: capture start time.
apply(
`        const req = lib.request(parsedUrl, {
          method: 'GET',
          headers: getRangeHeaders,
          lookup: createSSRFSafeLookup(this.allowLocalhost),
          timeout: 8000,
        }, res => {`,
`        const probeStart = Date.now();
        const req = lib.request(parsedUrl, {
          method: 'GET',
          headers: getRangeHeaders,
          lookup: createSSRFSafeLookup(this.allowLocalhost),
          timeout: 8000,
        }, res => {`, 1);

// 4. GET-range probe: record latency on terminal responses (<400 only, so a
// 404 HTML page never counts as a clean low-latency sample).
apply(
`          if (disposition && disposition.includes('filename=')) {
            const match = disposition.match(/filename=["']?([^"';]+)["']?/);
            if (match && match[1]) filename = match[1].trim();
          }

          if (res.statusCode === 206 && res.headers['content-range']) {`,
`          if (disposition && disposition.includes('filename=')) {
            const match = disposition.match(/filename=["']?([^"';]+)["']?/);
            if (match && match[1]) filename = match[1].trim();
          }

          if (res.statusCode && res.statusCode < 400) {
            this.hostIntelligence.recordRequestResult(url, res.statusCode, Date.now() - probeStart, 0, false, false);
          }

          if (res.statusCode === 206 && res.headers['content-range']) {`, 1);

if (fail) { console.error(fail); process.exit(1); }
fs.writeFileSync('server/engine.ts', s);
console.log('EXP4 PROBE-LATENCY APPLIED');
