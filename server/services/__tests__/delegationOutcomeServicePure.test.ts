/**
 * delegationOutcomeServicePure.test.ts — Pure unit tests for delegation outcome helpers.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/delegationOutcomeServicePure.test.ts
 *
 * Tests cover:
 *   - assertDelegationOutcomeShape: accepted-without-reason, rejected-with-reason,
 *     rejected-without-reason throws, accepted-with-reason throws,
 *     invalid scope throws, invalid direction throws
 *   - buildListQueryFilters: limit clamping to 500, default since (seven days ago)
 */

import {
  assertDelegationOutcomeShape,
  buildListQueryFilters,
  type DelegationOutcomeInput,
} from '../delegationOutcomeServicePure.js';

// ---------------------------------------------------------------------------
// Minimal test harness (tsx-compatible, no external deps)
// ---------------------------------------------------------------------------

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
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assertEqual<T>(a: T, b: T, label: string) {
  if (a !== b) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function assertThrows(fn: () => void, containsText: string, label: string) {
  try {
    fn();
    throw new Error(`${label} — expected to throw but did not`);
  } catch (err) {
    if (err instanceof Error && err.message === `${label} — expected to throw but did not`) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes(containsText)) {
      throw new Error(`${label} — expected error to contain "${containsText}", got: ${msg}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Base valid input
// ---------------------------------------------------------------------------

function makeValidAccepted(overrides: Partial<DelegationOutcomeInput> = {}): DelegationOutcomeInput {
  return {
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    runId: 'run-1',
    callerAgentId: 'agent-1',
    targetAgentId: 'agent-2',
    delegationScope: 'children',
    outcome: 'accepted',
    reason: null,
    delegationDirection: 'down',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// assertDelegationOutcomeShape
// ---------------------------------------------------------------------------

test('accepted outcome without reason — passes', () => {
  assertDelegationOutcomeShape(makeValidAccepted());
  // No throw = pass
});

test('rejected outcome with reason — passes', () => {
  assertDelegationOutcomeShape(
    makeValidAccepted({ outcome: 'rejected', reason: 'out of scope' }),
  );
});

test('rejected outcome without reason — throws', () => {
  assertThrows(
    () => assertDelegationOutcomeShape(makeValidAccepted({ outcome: 'rejected', reason: null })),
    'delegation_outcome_reason_required',
    'rejected-without-reason',
  );
});

test('rejected outcome with empty reason string — throws', () => {
  assertThrows(
    () => assertDelegationOutcomeShape(makeValidAccepted({ outcome: 'rejected', reason: '' })),
    'delegation_outcome_reason_required',
    'rejected-empty-reason',
  );
});

test('accepted outcome with a non-null reason — throws', () => {
  assertThrows(
    () =>
      assertDelegationOutcomeShape(
        makeValidAccepted({ outcome: 'accepted', reason: 'should not be here' }),
      ),
    'delegation_outcome_reason_not_allowed',
    'accepted-with-reason',
  );
});

test('invalid delegation_scope — throws', () => {
  assertThrows(
    () => assertDelegationOutcomeShape(makeValidAccepted({ delegationScope: 'global' })),
    'delegation_outcome_invalid_scope',
    'invalid-scope',
  );
});

test('invalid delegation_direction — throws', () => {
  assertThrows(
    () => assertDelegationOutcomeShape(makeValidAccepted({ delegationDirection: 'sideways' })),
    'delegation_outcome_invalid_direction',
    'invalid-direction',
  );
});

test('all valid scope values — pass', () => {
  for (const scope of ['children', 'descendants', 'subaccount'] as const) {
    assertDelegationOutcomeShape(makeValidAccepted({ delegationScope: scope }));
  }
});

test('all valid direction values — pass', () => {
  for (const dir of ['down', 'up', 'lateral'] as const) {
    assertDelegationOutcomeShape(makeValidAccepted({ delegationDirection: dir }));
  }
});

// ---------------------------------------------------------------------------
// buildListQueryFilters
// ---------------------------------------------------------------------------

test('limit defaults to 100 when not provided', () => {
  const result = buildListQueryFilters({});
  assertEqual(result.limit, 100, 'default limit');
});

test('limit clamped to 500 when above cap', () => {
  const result = buildListQueryFilters({ limit: 9999 });
  assertEqual(result.limit, 500, 'limit cap');
});

test('limit clamped to 500 when exactly 500', () => {
  const result = buildListQueryFilters({ limit: 500 });
  assertEqual(result.limit, 500, 'limit at cap');
});

test('limit below 500 is preserved', () => {
  const result = buildListQueryFilters({ limit: 42 });
  assertEqual(result.limit, 42, 'limit below cap');
});

test('limit set to default when 0 or negative', () => {
  assertEqual(buildListQueryFilters({ limit: 0 }).limit, 100, 'limit zero → default');
  assertEqual(buildListQueryFilters({ limit: -5 }).limit, 100, 'limit negative → default');
});

test('since defaults to approximately seven days ago', () => {
  const before = Date.now();
  const result = buildListQueryFilters({});
  const after = Date.now();

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const expectedMin = before - sevenDaysMs - 1000; // 1s tolerance
  const expectedMax = after - sevenDaysMs + 1000;

  const sinceMs = result.since.getTime();
  if (sinceMs < expectedMin || sinceMs > expectedMax) {
    throw new Error(
      `since default out of expected range: got ${result.since.toISOString()}, ` +
        `expected ~${new Date(before - sevenDaysMs).toISOString()}`,
    );
  }
});

test('since is preserved when a valid Date is passed', () => {
  const d = new Date('2024-01-15T00:00:00Z');
  const result = buildListQueryFilters({ since: d });
  assertEqual(result.since.getTime(), d.getTime(), 'since preserved');
});

test('since parsed from ISO string', () => {
  const iso = '2024-03-10T08:00:00Z';
  const result = buildListQueryFilters({ since: iso });
  assertEqual(result.since.toISOString(), new Date(iso).toISOString(), 'since from string');
});

test('outcome unknown value drops to undefined', () => {
  const result = buildListQueryFilters({ outcome: 'maybe' });
  assertEqual(result.outcome, undefined, 'unknown outcome → undefined');
});

test('delegationDirection unknown value drops to undefined', () => {
  const result = buildListQueryFilters({ delegationDirection: 'sideways' });
  assertEqual(result.delegationDirection, undefined, 'unknown direction → undefined');
});

test('valid outcome values are preserved', () => {
  assertEqual(buildListQueryFilters({ outcome: 'accepted' }).outcome, 'accepted', 'accepted preserved');
  assertEqual(buildListQueryFilters({ outcome: 'rejected' }).outcome, 'rejected', 'rejected preserved');
});

test('valid direction values are preserved', () => {
  assertEqual(buildListQueryFilters({ delegationDirection: 'down' }).delegationDirection, 'down', 'down preserved');
  assertEqual(buildListQueryFilters({ delegationDirection: 'up' }).delegationDirection, 'up', 'up preserved');
  assertEqual(buildListQueryFilters({ delegationDirection: 'lateral' }).delegationDirection, 'lateral', 'lateral preserved');
});

test('string limit "200" is parsed and returned as 200', () => {
  const result = buildListQueryFilters({ limit: '200' });
  assertEqual(result.limit, 200, 'string limit parsed');
});

test('string limit "600" is capped at MAX_LIMIT (500)', () => {
  const result = buildListQueryFilters({ limit: '600' });
  assertEqual(result.limit, 500, 'string limit capped at 500');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`delegationOutcomeServicePure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
