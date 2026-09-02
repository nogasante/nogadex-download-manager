import { DynamicSegmenter, ChunkRange } from './dynamic_segmenter';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runTests() {
  console.log('========================================================================');
  console.log('       HYPERDOWNLOADER DYNAMIC SEGMENTATION ENGINE TEST SUITE           ');
  console.log('========================================================================\n');

  const segmenter = new DynamicSegmenter(100 * 1024); // 100 KB threshold
  const totalBytes = 10 * 1024 * 1024; // 10 MB

  // Test 1: Initial Contiguity
  const chunks: ChunkRange[] = [
    { id: 0, start: 0, end: 5 * 1024 * 1024 - 1, downloaded: 2 * 1024 * 1024, status: 'downloading' },
    { id: 1, start: 5 * 1024 * 1024, end: 10 * 1024 * 1024 - 1, downloaded: 5 * 1024 * 1024, status: 'completed' },
  ];

  assert(segmenter.verifyContiguity(chunks, totalBytes), 'DYN-01: Initial chunks form 100% contiguous partition of 10 MB');

  // Test 2: Find best split candidate
  const candidate = segmenter.findBestSplitCandidate(chunks);
  assert(candidate !== null, 'DYN-02a: Found active split candidate');
  assert(candidate!.chunk.id === 0, 'DYN-02b: Correctly selected chunk 0 (has 3 MB remaining)');
  assert(candidate!.remainingBytes === 3 * 1024 * 1024, 'DYN-02c: Correctly calculated 3 MB remaining');

  // Test 3: Split chunk 0
  const split = segmenter.splitChunk(chunks, chunks[0], 2);
  assert(split !== null, 'DYN-03a: Split succeeded');
  assert(chunks.length === 3, 'DYN-03b: Chunk count increased to 3');
  assert(segmenter.verifyContiguity(chunks, totalBytes), 'DYN-03c: Chunks remain 100% contiguous with zero byte overlaps or gaps after split');

  // Test 4: Threshold protection
  const smallChunks: ChunkRange[] = [
    { id: 0, start: 0, end: 50 * 1024 - 1, downloaded: 0, status: 'downloading' }
  ];
  const noCandidate = segmenter.findBestSplitCandidate(smallChunks);
  assert(noCandidate === null, 'DYN-04: Sub-threshold chunks (<100KB) are safely ignored to prevent micro-fragmentation');

  console.log('\n========================================================================');
  console.log('DYNAMIC SEGMENTATION TEST RESULTS: ALL ASSIGNMENTS PASSED');
  console.log('========================================================================\n');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
