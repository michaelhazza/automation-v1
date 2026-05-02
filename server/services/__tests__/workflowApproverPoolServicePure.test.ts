/**
 * Tests for workflowApproverPoolServicePure — pure pool helpers.
 * Run: npx tsx server/services/__tests__/workflowApproverPoolServicePure.test.ts
 */

import { userInPool, resolveSpecificUsersPool } from '../workflowApproverPoolServicePure.js';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

// --- userInPool ---

assert('userInPool(null, user1) returns true (open pool)', userInPool(null, 'user1') === true);
assert('userInPool([], user1) returns true (empty = open)', userInPool([], 'user1') === true);
assert(
  'userInPool([user1, user2], user1) returns true',
  userInPool(['user1', 'user2'], 'user1') === true
);
assert(
  'userInPool([user1, user2], user3) returns false',
  userInPool(['user1', 'user2'], 'user3') === false
);

// --- resolveSpecificUsersPool ---

{
  const pool = resolveSpecificUsersPool(['a', 'b']);
  assert(
    "resolveSpecificUsersPool(['a','b']) returns ['a','b']",
    JSON.stringify(pool) === '["a","b"]'
  );
  // Ensure it returns a copy, not the original reference
  const original = ['a', 'b'];
  const copy = resolveSpecificUsersPool(original);
  original.push('c');
  assert(
    'resolveSpecificUsersPool returns a copy (not the same reference)',
    copy.length === 2
  );
}

{
  const pool = resolveSpecificUsersPool([]);
  assert("resolveSpecificUsersPool([]) returns []", pool.length === 0);
}

// --- summary ---

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
