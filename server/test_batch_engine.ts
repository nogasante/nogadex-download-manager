import { BatchEngine } from './batch_engine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
  console.log(`[PASS] ${message}`);
}

console.log('========================================================================');
console.log('       HYPERDOWNLOADER BATCH PATTERN ENGINE TEST SUITE                  ');
console.log('========================================================================\n');

// 1. Numeric expansion without padding
const res1 = BatchEngine.expandPattern('https://mirrors.kernel.org/pub/dist/part_*.iso', {
  type: 'numeric',
  from: 1,
  to: 5,
  step: 1
});
assert(res1.errors.length === 0, 'BATCH-01a: Valid numeric pattern produces zero errors');
assert(res1.total === 5, 'BATCH-01b: Numeric 1 to 5 produces exactly 5 URLs');
assert(res1.urls[0] === 'https://mirrors.kernel.org/pub/dist/part_1.iso', 'BATCH-01c: First URL matches part_1.iso');
assert(res1.urls[4] === 'https://mirrors.kernel.org/pub/dist/part_5.iso', 'BATCH-01d: Last URL matches part_5.iso');

// 2. Numeric expansion with leading zeros
const res2 = BatchEngine.expandPattern('https://example.com/assets/img_*.png', {
  type: 'numeric',
  from: 1,
  to: 10,
  step: 1,
  leadingZeros: 3
});
assert(res2.total === 10, 'BATCH-02a: Numeric 1 to 10 produces 10 items');
assert(res2.urls[0] === 'https://example.com/assets/img_001.png', 'BATCH-02b: Zero-padded first item is img_001.png');
assert(res2.urls[8] === 'https://example.com/assets/img_009.png', 'BATCH-02c: Zero-padded 9th item is img_009.png');
assert(res2.urls[9] === 'https://example.com/assets/img_010.png', 'BATCH-02d: Zero-padded 10th item is img_010.png');

// 3. Numeric expansion with step
const res3 = BatchEngine.expandPattern('https://example.com/chunk_*.bin', {
  type: 'numeric',
  from: 0,
  to: 100,
  step: 25
});
assert(res3.total === 5, 'BATCH-03a: Step 25 from 0 to 100 produces 5 items (0, 25, 50, 75, 100)');
assert(res3.urls[1] === 'https://example.com/chunk_25.bin', 'BATCH-03b: Second chunk is chunk_25.bin');

// 4. Alpha expansion lowercase
const res4 = BatchEngine.expandPattern('https://cdn.test.com/archive_*.tar.gz', {
  type: 'alpha',
  from: 'a',
  to: 'd'
});
assert(res4.total === 4, 'BATCH-04a: Alpha range a to d produces 4 items');
assert(res4.urls[0] === 'https://cdn.test.com/archive_a.tar.gz', 'BATCH-04b: First alpha URL is archive_a.tar.gz');
assert(res4.urls[3] === 'https://cdn.test.com/archive_d.tar.gz', 'BATCH-04c: Last alpha URL is archive_d.tar.gz');

// 5. Alpha expansion uppercase with step
const res5 = BatchEngine.expandPattern('https://cdn.test.com/section_*.pdf', {
  type: 'alpha',
  from: 'A',
  to: 'E',
  step: 2
});
assert(res5.total === 3, 'BATCH-05a: Upper alpha A to E with step 2 produces 3 items (A, C, E)');
assert(res5.urls[1] === 'https://cdn.test.com/section_C.pdf', 'BATCH-05b: Second item is section_C.pdf');

// 6. Error handling for missing asterisk wildcard
const res6 = BatchEngine.expandPattern('https://example.com/no_wildcard.zip', {
  type: 'numeric',
  from: 1,
  to: 5
});
assert(res6.errors.length > 0, 'BATCH-06: Pattern missing asterisk is rejected with descriptive error');

// 7. Error handling for inverted range
const res7 = BatchEngine.expandPattern('https://example.com/item_*.dat', {
  type: 'numeric',
  from: 10,
  to: 2
});
assert(res7.errors.length > 0, 'BATCH-07: Inverted numeric range (10 to 2) is rejected');

// 8. Multi-URL list parsing with comments, empty lines, and deduplication
const rawList = `
# List of mirrors to download
https://mirrors.kernel.org/pub/dist/v1.iso
https://mirrors.kernel.org/pub/dist/v2.iso

# Duplicate entry
https://mirrors.kernel.org/pub/dist/v1.iso
   https://mirrors.kernel.org/pub/dist/v3.iso   
ftp://invalid.com/file.bin
`;

const res8 = BatchEngine.parseMultiUrlList(rawList);
assert(res8.total === 3, 'BATCH-08a: Multi-URL parsing extracts 3 unique valid URLs');
assert(res8.urls[0] === 'https://mirrors.kernel.org/pub/dist/v1.iso', 'BATCH-08b: Normalized first URL');
assert(res8.urls[2] === 'https://mirrors.kernel.org/pub/dist/v3.iso', 'BATCH-08c: Trimmed third URL');
assert(res8.errors.length === 1, 'BATCH-08d: FTP protocol URL recorded in errors list');

console.log('\n========================================================================');
console.log('BATCH PATTERN ENGINE TEST RESULTS: ALL 8 ASSIGNMENTS PASSED');
console.log('========================================================================\n');
