import { decideDedupe } from '../clientErrorsLruPure.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    failed++;
  }
}

// Test 1: fresh entry (not in LRU) → 'fresh'
{
  const lru = new Map<string, number>();
  const result = decideDedupe({ hash: 'abc', lru, now: 1000, windowMs: 60_000 });
  assert(result === 'fresh', 'fresh entry (not in LRU) → fresh');
}

// Test 2: same hash within window → 'duplicate'
{
  const lru = new Map<string, number>();
  const hash = 'abc';
  const now = 100_000;
  lru.set(hash, now - 1000); // seen 1s ago, window = 60s
  const result = decideDedupe({ hash, lru, now, windowMs: 60_000 });
  assert(result === 'duplicate', 'same hash within window → duplicate');
}

// Test 3: same hash after window expires → 'fresh'
{
  const lru = new Map<string, number>();
  const hash = 'abc';
  const now = 100_000;
  lru.set(hash, now - 61_000); // seen 61s ago, window = 60s
  const result = decideDedupe({ hash, lru, now, windowMs: 60_000 });
  assert(result === 'fresh', 'same hash after window expires → fresh');
}

// Test 4: empty LRU → 'fresh'
{
  const lru = new Map<string, number>();
  const result = decideDedupe({ hash: 'xyz', lru, now: 9999, windowMs: 60_000 });
  assert(result === 'fresh', 'empty LRU → fresh');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
