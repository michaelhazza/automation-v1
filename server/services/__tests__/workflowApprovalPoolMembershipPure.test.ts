import { userInApproverPool } from '../workflowApprovalPoolPure.js';

const cases: Array<[string, string[] | null | undefined, string, boolean]> = [
  ['user in pool', ['user1', 'user2'], 'user1', true],
  ['user not in pool', ['user1', 'user2'], 'user3', false],
  ['null snapshot', null, 'user1', true],
  ['empty array snapshot', [], 'user1', true],
  ['undefined snapshot', undefined, 'user1', true],
];

let passed = 0;
let failed = 0;
for (const [label, snapshot, userId, expected] of cases) {
  const result = userInApproverPool(snapshot, userId);
  if (result === expected) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}: expected ${expected}, got ${result}`);
    failed++;
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
