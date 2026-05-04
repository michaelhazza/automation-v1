// runStatusDriftPure.test.ts — guards against the client-side copy of the
// agent-run status enum diverging from the server-side (shared) one.
//
// Runnable via:
//   npx tsx server/services/__tests__/runStatusDriftPure.test.ts
//
// The client duplicates `shared/runStatus.ts` because its tsconfig does not
// currently reach outside `client/src`. Both files must stay in lock-step;
// this test fails if they diverge so the mistake is caught before shipping.

import { expect, test } from 'vitest';
import * as serverEnum from '../../../shared/runStatus.js';
import * as clientEnum from '../../../client/src/lib/runStatus.js';

test('AGENT_RUN_STATUS dictionaries match', () => {
  expect(serverEnum.AGENT_RUN_STATUS, 'AGENT_RUN_STATUS').toStrictEqual(clientEnum.AGENT_RUN_STATUS);
});

test('TERMINAL_RUN_STATUSES match', () => {
  expect([...serverEnum.TERMINAL_RUN_STATUSES].sort(), 'TERMINAL_RUN_STATUSES').toStrictEqual([...clientEnum.TERMINAL_RUN_STATUSES].sort());
});

test('IN_FLIGHT_RUN_STATUSES match', () => {
  expect([...serverEnum.IN_FLIGHT_RUN_STATUSES].sort(), 'IN_FLIGHT_RUN_STATUSES').toStrictEqual([...clientEnum.IN_FLIGHT_RUN_STATUSES].sort());
});

test('AWAITING_RUN_STATUSES match', () => {
  expect([...serverEnum.AWAITING_RUN_STATUSES].sort(), 'AWAITING_RUN_STATUSES').toStrictEqual([...clientEnum.AWAITING_RUN_STATUSES].sort());
});

test('isTerminalRunStatus agrees for every value', () => {
  for (const v of Object.values(serverEnum.AGENT_RUN_STATUS)) {
    const s = serverEnum.isTerminalRunStatus(v);
    const c = clientEnum.isTerminalRunStatus(v);
    if (s !== c) throw new Error(`disagreement for ${v}: server=${s} client=${c}`);
  }
});

console.log('');
