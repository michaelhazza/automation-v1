// runStatusDriftPure.test.ts — guards against the client-side copy of the
// agent-run status enum diverging from the server-side (shared) one.
//
// Runnable via:
//   npx tsx server/services/__tests__/runStatusDriftPure.test.ts
//
// The client duplicates `shared/runStatus.ts` because its tsconfig does not
// currently reach outside `client/src`. Both files must stay in lock-step;
// this test fails if they diverge so the mistake is caught before shipping.

import * as serverEnum from '../../../shared/runStatus.js';
import * as clientEnum from '../../../client/src/lib/runStatus.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assertDeepEqual(a: unknown, b: unknown, msg: string): void {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    throw new Error(`${msg}: expected ${sb}, got ${sa}`);
  }
}

test('AGENT_RUN_STATUS dictionaries match', () => {
  assertDeepEqual(
    serverEnum.AGENT_RUN_STATUS,
    clientEnum.AGENT_RUN_STATUS,
    'AGENT_RUN_STATUS',
  );
});

test('TERMINAL_RUN_STATUSES match', () => {
  assertDeepEqual(
    [...serverEnum.TERMINAL_RUN_STATUSES].sort(),
    [...clientEnum.TERMINAL_RUN_STATUSES].sort(),
    'TERMINAL_RUN_STATUSES',
  );
});

test('IN_FLIGHT_RUN_STATUSES match', () => {
  assertDeepEqual(
    [...serverEnum.IN_FLIGHT_RUN_STATUSES].sort(),
    [...clientEnum.IN_FLIGHT_RUN_STATUSES].sort(),
    'IN_FLIGHT_RUN_STATUSES',
  );
});

test('AWAITING_RUN_STATUSES match', () => {
  assertDeepEqual(
    [...serverEnum.AWAITING_RUN_STATUSES].sort(),
    [...clientEnum.AWAITING_RUN_STATUSES].sort(),
    'AWAITING_RUN_STATUSES',
  );
});

test('isTerminalRunStatus agrees for every value', () => {
  for (const v of Object.values(serverEnum.AGENT_RUN_STATUS)) {
    const s = serverEnum.isTerminalRunStatus(v);
    const c = clientEnum.isTerminalRunStatus(v);
    if (s !== c) throw new Error(`disagreement for ${v}: server=${s} client=${c}`);
  }
});

console.log('');
console.log(`runStatusDriftPure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
