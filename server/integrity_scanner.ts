import fs from 'fs';
import crypto from 'crypto';

/**
 * Integrity scanner: re-verifies completed downloads against the app's
 * deterministic content generator.
 *
 * Known test content is produced by the LCG generator shared with
 * scripts/test_file_server.mjs (state = state * 1664525 + 1013904223 per
 * byte, buf[i] = state & 0xff, seeded per file). A completed file whose
 * (filename, size, seed) is in the registry can be verified byte-exactly
 * by hashing the actual bytes and comparing against the regenerated
 * expectation.
 *
 * Files not in the registry are reported "unverified" — the scanner never
 * guesses — but their actual SHA-256 is still recorded as a baseline for
 * future re-scans.
 */

export interface IntegrityVerdict {
  id: string;
  filename: string;
  path: string;
  status: 'verified' | 'mismatch' | 'unverified' | 'missing' | 'unreadable';
  size: number;
  expectedSha256?: string;
  actualSha256?: string;
  error?: string;
}

/** Known deterministic test content: filename (lowercase) → { size, seed }. */
const KNOWN_FILES: Record<string, { size: number; seed: number }> = {
  'small.zip': { size: 128 * 1024, seed: 101 },
  'medium.zip': { size: 1024 * 1024, seed: 202 },
  'big.mp4': { size: 4 * 1024 * 1024, seed: 303 },
  'doc.pdf': { size: 300 * 1024, seed: 404 },
  // Served from /small.zip via ?as=/filename= override — same 101-seed content.
  'nameparam_test.zip': { size: 128 * 1024, seed: 101 },
};

export const KNOWN_FILE_NAMES = Object.keys(KNOWN_FILES);

export function generateDeterministicBuffer(sizeBytes: number, seed: number): Buffer {
  const buf = Buffer.alloc(sizeBytes, 0);
  let state = seed >>> 0;
  for (let i = 0; i < sizeBytes; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    buf[i] = state & 0xff;
  }
  return buf;
}

/** SHA-256 of the deterministic content for a known (size, seed) pair. */
export function expectedHashFor(size: number, seed: number): string {
  return crypto
    .createHash('sha256')
    .update(generateDeterministicBuffer(size, seed))
    .digest('hex');
}

/** Streaming SHA-256: constant memory regardless of file size. */
export function sha256Stream(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Verify one file. Lookup key is the lowercased basename; a registry entry
 * whose size differs from the file on disk is an immediate mismatch.
 */
export function verifyFile(
  filePath: string,
  id: string,
  filename: string
): IntegrityVerdict {
  const base = { id, filename, path: filePath, size: 0 };
  if (!fs.existsSync(filePath)) {
    return { ...base, status: 'missing' };
  }
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch (e: any) {
    return { ...base, status: 'unreadable', error: e?.message || String(e) };
  }
  base.size = size;

  const entry = KNOWN_FILES[filename.toLowerCase()];
  let expectedSha256: string | undefined;
  if (entry) {
    if (entry.size !== size) {
      return {
        ...base,
        status: 'mismatch',
        error: `size ${size} differs from expected ${entry.size}`,
      };
    }
    expectedSha256 = expectedHashFor(entry.size, entry.seed);
  }

  let actualSha256: string;
  try {
    actualSha256 = sha256Stream(filePath);
  } catch (e: any) {
    return { ...base, status: 'unreadable', error: e?.message || String(e) };
  }

  if (expectedSha256) {
    return actualSha256 === expectedSha256
      ? { ...base, status: 'verified', expectedSha256, actualSha256 }
      : { ...base, status: 'mismatch', expectedSha256, actualSha256 };
  }
  // Unknown content: record the baseline, do not guess.
  return { ...base, status: 'unverified', actualSha256 };
}
