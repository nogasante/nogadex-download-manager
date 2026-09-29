/* Exp 1: replace global fetch (undici) in the small-file fast path with node
 * http/https on a dedicated per-call keep-alive agent, destroyed after allDone.
 * Hypothesis: undici's global dispatcher holds uv_async handles that trip the
 * libuv uv_async.c:76 exit assertion when 32 concurrent fetches are torn down
 * by process.exit(). No other behavior change (ramp, 32 KB split untouched). */
const fs = require('fs');
let s = fs.readFileSync('server/engine.ts', 'utf8');
let fail = '';
function apply(from, to, n) {
  const c = s.split(from).length - 1;
  if (c !== n) { fail = 'MATCH FAIL (' + c + ' vs ' + n + '): ' + from.slice(0, 70); return; }
  s = s.replace(from, to);
}

// 1. Create the agent + fastRangeGet helper inside the try block.
apply(
`    try {
      let nextIndex = 0;
      let activeWorkers = 0;`,
`    try {
      // node http/https on a dedicated keep-alive agent, NOT global fetch:
      // undici's global dispatcher holds uv_async handles that trip a libuv
      // exit assertion (uv_async.c:76 on Windows) when 32 concurrent fetches
      // are alive at process.exit(). destroy() below closes every pooled
      // socket deterministically once the fast path finishes.
      const parsedUrl = new URL(requestUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const fastAgent: http.Agent = isHttps
        ? new https.Agent({ keepAlive: true })
        : new http.Agent({ keepAlive: true });
      const fastRangeGet = (startByte: number, endByte: number) =>
        new Promise<Buffer>((resolve, reject) => {
          const req = (isHttps ? https : http).request(parsedUrl, {
            method: 'GET',
            headers: { ...headers, range: \`bytes=\${startByte}-\${endByte}\` },
            agent: fastAgent,
            lookup: createSSRFSafeLookup(this.allowLocalhost),
            timeout: 8000,
          }, res => {
            if (res.statusCode !== 206) {
              res.resume();
              reject(new Error(\`Fast range request returned \${res.statusCode}\`));
              return;
            }
            const parts: Buffer[] = [];
            res.on('data', (part: Buffer) => parts.push(part));
            res.on('end', () => resolve(Buffer.concat(parts)));
            res.on('error', reject);
          });
          req.on('timeout', () => req.destroy(new Error('Fast range request timed out')));
          req.on('error', reject);
          req.end();
        });
      let nextIndex = 0;
      let activeWorkers = 0;`, 1);

// 2. Worker body: use fastRangeGet instead of fetch.
apply(
`              const response = await fetch(requestUrl, {
                method: 'GET',
                headers: { ...headers, range: \`bytes=\${startByte}-\${endByte}\` },
              });
              const buffer = Buffer.from(await response.arrayBuffer());
              const expectedLength = endByte - startByte + 1;
              if (response.status !== 206 || buffer.length !== expectedLength) {
                throw new Error(\`Fast range request returned \${response.status} with \${buffer.length}/\${expectedLength} bytes\`);
              }`,
`              const buffer = await fastRangeGet(startByte, endByte);
              const expectedLength = endByte - startByte + 1;
              if (buffer.length !== expectedLength) {
                throw new Error(\`Fast range request returned \${buffer.length}/\${expectedLength} bytes\`);
              }`, 1);

// 3. Deterministic teardown after allDone.
apply(
`      for (let i = 0; i < targetWorkers; i++) spawnWorker();
      await allDone;
      clearInterval(rampTimer);`,
`      for (let i = 0; i < targetWorkers; i++) spawnWorker();
      await allDone;
      clearInterval(rampTimer);
      fastAgent.destroy();`, 1);

if (fail) { console.error(fail); process.exit(1); }
fs.writeFileSync('server/engine.ts', s);
console.log('EXP1 HTTP-AGENT APPLIED');
