/**
 * stateMachineGuardsPure.test.ts
 *
 * Pure-function tests for `assertValidTransition`. Run via:
 *   npx tsx shared/__tests__/stateMachineGuardsPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  assertValidTransition,
  InvalidTransitionError,
  type StateMachineKind,
} from '../stateMachineGuards.js';

function assertThrows(fn: () => unknown, label: string): any {
  let thrown: unknown;
  try { fn(); } catch (e) { thrown = e; return e; }
  throw new Error(`${label} — expected throw, but did not throw`);
}

function assertNoThrow(fn: () => void): void {
  fn();
}

// ---------------------------------------------------------------------------
// agent_run
// ---------------------------------------------------------------------------

test('agent_run: pending → running is valid', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'agent_run', recordId: 'r1', from: 'pending', to: 'running' }),
  );
});

test('agent_run: running → completed is valid', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'agent_run', recordId: 'r1', from: 'running', to: 'completed' }),
  );
});

test('agent_run: same-state write (idempotent retry) is allowed', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'agent_run', recordId: 'r1', from: 'completed', to: 'completed' }),
  );
});

test('agent_run: completed → failed is rejected (post-terminal mutation)', () => {
  const err = assertThrows(
    () => assertValidTransition({ kind: 'agent_run', recordId: 'r1', from: 'completed', to: 'failed' }),
    'agent_run',
  );
  if (err.from !== 'completed' || err.to !== 'failed') {
    throw new Error(`unexpected error fields: from=${err.from} to=${err.to}`);
  }
});

test('agent_run: failed → completed is rejected (post-terminal mutation)', () => {
  assertThrows(
    () => assertValidTransition({ kind: 'agent_run', recordId: 'r1', from: 'failed', to: 'completed' }),
    'agent_run',
  );
});

test('agent_run: completed → cancelled is rejected (terminal-to-terminal)', () => {
  assertThrows(
    () => assertValidTransition({ kind: 'agent_run', recordId: 'r1', from: 'completed', to: 'cancelled' }),
    'agent_run',
  );
});

test('agent_run: pending → bogus_status is rejected (unknown target)', () => {
  assertThrows(
    () => assertValidTransition({ kind: 'agent_run', recordId: 'r1', from: 'pending', to: 'bogus_status' }),
    'agent_run',
  );
});

test('agent_run: delegated → completed is valid', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'agent_run', recordId: 'r1', from: 'delegated', to: 'completed' }),
  );
});

// ---------------------------------------------------------------------------
// workflow_run
// ---------------------------------------------------------------------------

test('workflow_run: running → completed is valid', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'workflow_run', recordId: 'wr1', from: 'running', to: 'completed' }),
  );
});

test('workflow_run: completed → failed is rejected', () => {
  assertThrows(
    () => assertValidTransition({ kind: 'workflow_run', recordId: 'wr1', from: 'completed', to: 'failed' }),
    'workflow_run',
  );
});

test('workflow_run: cancelled → running is rejected (post-terminal restart)', () => {
  assertThrows(
    () => assertValidTransition({ kind: 'workflow_run', recordId: 'wr1', from: 'cancelled', to: 'running' }),
    'workflow_run',
  );
});

test('workflow_run: cancelling → cancelled is valid (cancel-in-flight terminates)', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'workflow_run', recordId: 'wr1', from: 'cancelling', to: 'cancelled' }),
  );
});

// ---------------------------------------------------------------------------
// workflow_step_run
// ---------------------------------------------------------------------------

test('workflow_step_run: running → completed is valid', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'workflow_step_run', recordId: 'sr1', from: 'running', to: 'completed' }),
  );
});

test('workflow_step_run: pending → invalidated is valid (terminal short-circuit)', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'workflow_step_run', recordId: 'sr1', from: 'pending', to: 'invalidated' }),
  );
});

test('workflow_step_run: completed → failed is rejected (post-terminal mutation)', () => {
  assertThrows(
    () => assertValidTransition({ kind: 'workflow_step_run', recordId: 'sr1', from: 'completed', to: 'failed' }),
    'workflow_step_run',
  );
});

test('workflow_step_run: invalidated → completed is rejected (post-terminal mutation)', () => {
  assertThrows(
    () => assertValidTransition({ kind: 'workflow_step_run', recordId: 'sr1', from: 'invalidated', to: 'completed' }),
    'workflow_step_run',
  );
});

test('workflow_step_run: awaiting_approval → running is valid (resume path)', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'workflow_step_run', recordId: 'sr1', from: 'awaiting_approval', to: 'running' }),
  );
});

// ---------------------------------------------------------------------------
// Error metadata
// ---------------------------------------------------------------------------

test('error carries kind / recordId / from / to fields', () => {
  const err = assertThrows(() =>
    assertValidTransition({ kind: 'agent_run', recordId: 'abc-123', from: 'completed', to: 'failed' }),
    'error carries kind / recordId / from / to fields',
  );
  if (err.kind !== 'agent_run') throw new Error(`kind: ${err.kind}`);
  if (err.recordId !== 'abc-123') throw new Error(`recordId: ${err.recordId}`);
  if (err.from !== 'completed') throw new Error(`from: ${err.from}`);
  if (err.to !== 'failed') throw new Error(`to: ${err.to}`);
});

console.log('');

// ---------------------------------------------------------------------------
// workflow_step_gate (added in workflows-v1 Chunk 4)
// ---------------------------------------------------------------------------

test('workflow_step_gate: open → resolved is valid', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'workflow_step_gate', recordId: 'g1', from: 'open', to: 'resolved' }),
  );
});

test('workflow_step_gate: same-state idempotent (resolved → resolved) is allowed', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'workflow_step_gate', recordId: 'g1', from: 'resolved', to: 'resolved' }),
  );
});

test('workflow_step_gate: resolved → open is rejected (post-terminal mutation)', () => {
  const err = assertThrows(
    () => assertValidTransition({ kind: 'workflow_step_gate', recordId: 'g1', from: 'resolved', to: 'open' }),
    'workflow_step_gate',
  );
  if (err.kind !== 'workflow_step_gate' || err.from !== 'resolved' || err.to !== 'open') {
    throw new Error(`unexpected error fields: kind=${err.kind} from=${err.from} to=${err.to}`);
  }
});

// ---------------------------------------------------------------------------
// workflow_run paused (added in workflows-v1 Chunk 7)
// ---------------------------------------------------------------------------

test('workflow_run: running → paused is valid', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'workflow_run', recordId: 'wr1', from: 'running', to: 'paused' }),
  );
});

test('workflow_run: paused → running is valid (resume)', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'workflow_run', recordId: 'wr1', from: 'paused', to: 'running' }),
  );
});

test('workflow_run: paused → cancelling is valid (Stop while paused)', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'workflow_run', recordId: 'wr1', from: 'paused', to: 'cancelling' }),
  );
});

test('workflow_run: paused → failed is valid (terminal stop)', () => {
  assertNoThrow(() =>
    assertValidTransition({ kind: 'workflow_run', recordId: 'wr1', from: 'paused', to: 'failed' }),
  );
});

test('workflow_run: completed → paused is rejected (post-terminal mutation)', () => {
  assertThrows(
    () => assertValidTransition({ kind: 'workflow_run', recordId: 'wr1', from: 'completed', to: 'paused' }),
    'workflow_run paused after completed',
  );
});

test('workflow_run: cancelled → paused is rejected (post-terminal mutation)', () => {
  assertThrows(
    () => assertValidTransition({ kind: 'workflow_run', recordId: 'wr1', from: 'cancelled', to: 'paused' }),
    'workflow_run paused after cancelled',
  );
});
