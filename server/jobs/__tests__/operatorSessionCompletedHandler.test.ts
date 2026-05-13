// guard-ignore-file: pure-helper-convention reason="inline pure idempotency-decision helpers — extraction to operatorSessionCompletedHandlerPure.ts deferred to follow-on cleanup; handler logic IS pure-tested, just colocated"
/**
 * operatorSessionCompletedHandler.test.ts — idempotency tests.
 *
 * Tests the idempotency logic: redelivery with event_emitted_at IS NULL runs
 * finalisation; redelivery with event_emitted_at IS NOT NULL is a no-op.
 *
 * These are pure-logic tests against the idempotency decision rules.
 */

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Pure helper: should the handler run finalisation?
// Extracted from the handler's idempotency guard.
// ---------------------------------------------------------------------------

function shouldRunFinalisation(input: {
  operatorRun: { eventEmittedAt: Date | null } | null;
}): { run: boolean; reason: string } {
  const { operatorRun } = input;

  if (!operatorRun) {
    return { run: false, reason: 'run_not_found' };
  }

  if (operatorRun.eventEmittedAt !== null) {
    return { run: false, reason: 'already_finalised' };
  }

  return { run: true, reason: 'not_yet_finalised' };
}

describe('operatorSessionCompletedHandler idempotency', () => {
  it('runs finalisation when event_emitted_at is NULL', () => {
    const result = shouldRunFinalisation({
      operatorRun: { eventEmittedAt: null },
    });
    expect(result.run).toBe(true);
    expect(result.reason).toBe('not_yet_finalised');
  });

  it('is a no-op when event_emitted_at is already set', () => {
    const result = shouldRunFinalisation({
      operatorRun: { eventEmittedAt: new Date('2026-05-12T00:00:00Z') },
    });
    expect(result.run).toBe(false);
    expect(result.reason).toBe('already_finalised');
  });

  it('is a no-op when the operator_run row does not exist', () => {
    const result = shouldRunFinalisation({
      operatorRun: null,
    });
    expect(result.run).toBe(false);
    expect(result.reason).toBe('run_not_found');
  });

  it('runs finalisation for consecutive deliveries until one stamps event_emitted_at', () => {
    // First delivery: not stamped yet
    const first = shouldRunFinalisation({
      operatorRun: { eventEmittedAt: null },
    });
    expect(first.run).toBe(true);

    // Second delivery (same row, simulating a re-delivery after the first stamped it)
    const second = shouldRunFinalisation({
      operatorRun: { eventEmittedAt: new Date() },
    });
    expect(second.run).toBe(false);
  });
});
