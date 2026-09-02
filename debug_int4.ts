
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DownloadEngine } from './server/engine';

const DIR = path.join(os.tmpdir(), 'debug_int4');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const buf = Buffer.alloc(10 * 1024 * 1024);
let seed = 0x12345678;
for (let i = 0; i < buf.length; i += 4) {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  buf.writeUInt32LE(seed, i);
}
const hash = crypto.createHash('sha256').update(buf).digest('hex');

const server = http.createServer((req, res) => {
  if (req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Length': buf.length.toString(), 'Accept-Ranges': 'bytes' });
    return res.end();
  }
  const range = req.headers.range?.match(/bytes=(\\d+)-(\\d+)/);
  const start = range ? parseInt(range[1], 10) : 0;
  const end = range ? parseInt(range[2], 10) : buf.length - 1;
  res.writeHead(206, { 'Content-Range': ytes -/ });
  res.end(buf.subarray(start, end + 1));
});

server.listen(5094, async () => {
  const engine = new DownloadEngine(undefined, DIR);
  const item = await engine.addDownload('http://localhost:5094/test.bin', 'test.bin', DIR, 4);
  while (item.downloadedBytes < buf.length * 0.4) await new Promise(r => setTimeout(r, 10));
  await engine.pauseDownload(item.id);
  console.log('Paused at:', item.downloadedBytes, 'chunks:', JSON.stringify(item.chunks.map(c => ({ id: c.id, start: c.startByte, end: c.endByte, dl: c.downloadedBytes }))));
  
  await engine.resumeDownload(item.id);
  while (item.status === 'downloading') await new Promise(r => setTimeout(r, 50));
  console.log('Resumed done. status:', item.status, 'chunks:', JSON.stringify(item.chunks.map(c => ({ id: c.id, start: c.startByte, end: c.endByte, dl: c.downloadedBytes }))));

  const written = fs.readFileSync(item.destinationPath);
  const writtenHash = crypto.createHash('sha256').update(written).digest('hex');
  console.log('Source hash :', hash);
  console.log('Written hash:', writtenHash);
  
  if (hash !== writtenHash) {
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== written[i]) {
        console.log(First mismatch at byte  (0x): expected , got );
        break;
      }
    }
  }

  engine.destroy();
  server.close();
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {}
});
