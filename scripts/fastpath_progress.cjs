/* Exp 5: commit fast-path progress on failure. When a fast-path range request
 * fails (e.g. a hostile host 429s the burst), whole ranges already written to
 * disk were discarded and the mature path re-downloaded the entire file
 * (PW-04: 1.5x waste on a free-tier-limited host). Each range is one atomic
 * positional writeSync, so completed ranges are fully valid — track them and
 * hand them to the fallback scheduler via restoreChunks. */
const fs = require('fs');
let s = fs.readFileSync('server/engine.ts', 'utf8');
let fail = '';
function apply(from, to, n) {
  const c = s.split(from).length - 1;
  if (c !== n) { fail = 'MATCH FAIL (' + c + ' vs ' + n + '): ' + from.slice(0, 70); return; }
  s = s.replace(from, to);
}

// 1. Return type + not-applicable gate.
apply(
`  private async trySmallFileFastPath(item: DownloadItem, requestUrl: string, fd: number): Promise<boolean> {
    if (typeof fetch !== 'function' || item.totalBytes <= 256 * 1024 || item.totalBytes > 32 * 1024 * 1024) return false;`,
`  private async trySmallFileFastPath(item: DownloadItem, requestUrl: string, fd: number): Promise<{ ok: boolean; partial: ChunkProgress[] }> {
    if (typeof fetch !== 'function' || item.totalBytes <= 256 * 1024 || item.totalBytes > 32 * 1024 * 1024) return { ok: false, partial: [] };`, 1);

// 2. Completed-range tracking, declared outside the try (the catch needs it).
apply(
`    if (credentials?.referrer) headers.referer = credentials.referrer;

    try {`,
`    if (credentials?.referrer) headers.referer = credentials.referrer;

    // Indices of ranges fully written to disk — handed to the mature path on
    // failure so its scheduler can resume from them instead of re-fetching.
    const completedRanges = new Set<number>();

    try {`, 1);

// 3. Mark range as landed after its write.
apply(
`              fs.writeSync(fd, buffer, 0, buffer.length, startByte);
            }`,
`              fs.writeSync(fd, buffer, 0, buffer.length, startByte);
              completedRanges.add(index);
            }`, 1);

// 4. Success/failure returns; build partial progress in the catch.
apply(
`          status: 'done' as const,
        };
      });
      return true;
    } catch {
      return false;
    }
  }`,
`          status: 'done' as const,
        };
      });
      return { ok: true, partial: [] };
    } catch {
      // Whole ranges that already landed on disk stay valid (each was one
      // atomic positional write) — surface them so the mature path resumes
      // from real progress instead of restarting from zero.
      const partial: ChunkProgress[] = Array.from({ length: rangeCount }, (_, index) => {
        const startByte = index * rangeSize;
        const endByte = Math.min(totalBytes - 1, startByte + rangeSize - 1);
        const chunkBytes = endByte - startByte + 1;
        const done = completedRanges.has(index);
        return {
          id: index,
          startByte,
          endByte,
          downloadedBytes: done ? chunkBytes : 0,
          totalBytes: chunkBytes,
          speedBps: 0,
          status: done ? ('done' as const) : ('idle' as const),
        };
      });
      return { ok: false, partial };
    }
  }`, 1);

// 5. Call site + capture partials.
apply(
`      if (item.autoStreams && !fileExists && item.downloadedBytes === 0 && item.resumable && item.totalBytes > 256 * 1024 && item.totalBytes <= 32 * 1024 * 1024) {
        const fastCompleted = await this.trySmallFileFastPath(item, requestUrl, fd);
        if (fastCompleted) {`,
`      let fastPathPartial: ChunkProgress[] = [];
      if (item.autoStreams && !fileExists && item.downloadedBytes === 0 && item.resumable && item.totalBytes > 256 * 1024 && item.totalBytes <= 32 * 1024 * 1024) {
        const fast = await this.trySmallFileFastPath(item, requestUrl, fd);
        if (fast.ok) {`, 1);

apply(
`          this.checkNextQueuedDownload();
          return;
        }
        try { fs.ftruncateSync(fd, item.totalBytes); } catch (e) {}
      }`,
`          this.checkNextQueuedDownload();
          return;
        }
        fastPathPartial = fast.partial;
        try { fs.ftruncateSync(fd, item.totalBytes); } catch (e) {}
      }`, 1);

// 6. Adopt landed ranges in the fallback scheduler.
apply(
`      const scheduler = new DynamicRangeScheduler(item.totalBytes, initialConns);
      this.schedulers.set(id, scheduler);
      item.chunks = scheduler.chunks;`,
`      const scheduler = new DynamicRangeScheduler(item.totalBytes, initialConns);
      this.schedulers.set(id, scheduler);
      if (fastPathPartial.some(c => c.downloadedBytes > 0)) {
        // Ranges the failed fast path already wrote to disk: resume from
        // them (done chunks short-circuit in downloadChunk) instead of
        // re-fetching the whole file.
        scheduler.restoreChunks(fastPathPartial);
      }
      item.chunks = scheduler.chunks;`, 1);

if (fail) { console.error(fail); process.exit(1); }
fs.writeFileSync('server/engine.ts', s);
console.log('EXP5 FASTPATH-PROGRESS APPLIED');
