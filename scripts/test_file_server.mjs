// Tiny local file server for testing NDM downloads.
// Serves deterministic binary files (all well under 50MB) with Range support.
// Throttles to ~96 KB/s per connection so mid-flight pause/resume is observable.
import http from 'http';

const PORT = 5077;

function generateDeterministicBuffer(sizeBytes, seed = 42) {
  const buf = Buffer.allocUnsafe(sizeBytes);
  let state = seed;
  for (let i = 0; i < sizeBytes; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    buf[i] = state & 0xff;
  }
  return buf;
}

const FILES = {
  '/small.zip': { size: 128 * 1024, seed: 101, type: 'application/zip', name: 'small.zip' },
  '/medium.zip': { size: 1024 * 1024, seed: 202, type: 'application/zip', name: 'medium.zip' },
  '/big.mp4': { size: 4 * 1024 * 1024, seed: 303, type: 'video/mp4', name: 'big.mp4' },
  '/doc.pdf': { size: 300 * 1024, seed: 404, type: 'application/pdf', name: 'doc.pdf' },
  // Large enough that a 16-stream capture run cannot finish it mid-shoot
  // (~1.5 MB/s aggregate => ~21 s to complete; screenshots happen at ~9 s).
  '/huge.iso': { size: 32 * 1024 * 1024, seed: 303, type: 'application/octet-stream', name: 'huge.iso' },
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;
  // Allow per-request naming: ?as= or ?filename= overrides Content-Disposition
  const asName = url.searchParams.get('as') || url.searchParams.get('filename');

  if (pathname === '/page.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html><body>
<h1>Test Index</h1>
<a href="/small.zip">small archive</a>
<a href="/doc.pdf">a document</a>
<a href="/big.mp4">a video file</a>
</body></html>`);
    return;
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === '/redirect.zip') {
    res.writeHead(302, { Location: '/medium.zip' });
    res.end();
    return;
  }

  if (pathname === '/notfound.zip') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }

  const file = FILES[pathname];
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }

  const buf = generateDeterministicBuffer(file.size, file.seed);
  const headers = {
    'Content-Type': file.type,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `attachment; filename="${asName || file.name}"`,
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, { ...headers, 'Content-Length': file.size });
    return res.end();
  }

  // ~96 KB/s per connection: 12KB every 125ms
  const chunk = 12 * 1024;
  const sendSlow = (statusCode, extraHeaders, start, end) => {
    res.writeHead(statusCode, extraHeaders);
    let pos = start;
    let paused = false;
    // Backpressure-aware sender: respects socket buffer limits. When a write
    // returns false we stop the timer until 'drain' fires — blindly queueing
    // on a timer ends with res.end() racing the client's resume and can
    // truncate the tail of the response.
    const tick = () => {
      if (res.destroyed) { clearInterval(timer); return; }
      const next = Math.min(pos + chunk, end + 1);
      const ok = res.write(buf.subarray(pos, next));
      pos = next;
      if (pos >= end + 1) { clearInterval(timer); res.end(); return; }
      if (!ok && !paused) {
        paused = true;
        clearInterval(timer);
        res.once('drain', () => {
          paused = false;
          if (res.destroyed || pos >= end + 1) return;
          timer = setInterval(tick, 125);
        });
      }
    };
    let timer = setInterval(tick, 125);
  };

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : file.size - 1;
    if (isNaN(start) || start >= file.size) start = 0;
    if (isNaN(end) || end >= file.size) end = file.size - 1;
    sendSlow(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${file.size}`,
      'Content-Length': end - start + 1,
    }, start, end);
    return;
  }

  sendSlow(200, { ...headers, 'Content-Length': file.size }, 0, file.size - 1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[TestFileServer] http://127.0.0.1:${PORT} (throttled ~96KB/s per stream)`);
  Object.entries(FILES).forEach(([p, f]) => console.log(`  ${p} -> ${(f.size / 1024).toFixed(0)}KB`));
});
