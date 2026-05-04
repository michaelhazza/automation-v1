/**
 * stateMachineGuardsPure.test.ts
 *
 * Pure-function tests for `assertValidTransition` and
 * `assertValidAgentChargeTransition`. Run via:
 *   npx tsx shared/__tests__/stateMachineGuardsPure.test.ts
 */

import { test } from 'vitest';
import {
  assertValidTransition,
  assertValidAgentChargeTransition,
  AGENT_CHARGE_STATUSES,
  AGENT_CHARGE_TRANSITION_CALLERS,
  type AgentChargeStatus,
  type AgentChargeTransitionCaller,
} from '../stateMachineGuards.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assertThrows(fn: () => unknown, label: string): any {
  try { fn(); } catch (e) { return e as any; } // eslint-disable-line @typescript-eslint/no-explicit-any
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

// ---------------------------------------------------------------------------
// agent_charges state machine (spec §4 — Agentic Commerce)
// ---------------------------------------------------------------------------

// Helper to call assertValidAgentChargeTransition with a specific caller.
function acTransition(
  from: AgentChargeStatus,
  to: AgentChargeStatus,
  caller: AgentChargeTransitionCaller = 'charge_router',
) {
  return () => assertValidAgentChargeTransition(from, to, { callerIdentity: caller });
}

// ── Allowed transitions per spec §4 ─────────────────────────────────────────

test('agent_charges: proposed → blocked is valid', () => {
  assertNoThrow(acTransition('proposed', 'blocked'));
});

test('agent_charges: proposed → pending_approval is valid', () => {
  assertNoThrow(acTransition('proposed', 'pending_approval'));
});

test('agent_charges: proposed → approved is valid', () => {
  assertNoThrow(acTransition('proposed', 'approved'));
});

test('agent_charges: pending_approval → approved is valid', () => {
  assertNoThrow(acTransition('pending_approval', 'approved'));
});

test('agent_charges: pending_approval → denied is valid', () => {
  assertNoThrow(acTransition('pending_approval', 'denied'));
});

test('agent_charges: approved → blocked is valid (kill switch late re-check)', () => {
  assertNoThrow(acTransition('approved', 'blocked'));
});

test('agent_charges: approved → executed is valid', () => {
  assertNoThrow(acTransition('approved', 'executed'));
});

test('agent_charges: approved → shadow_settled is valid', () => {
  assertNoThrow(acTransition('approved', 'shadow_settled'));
});

test('agent_charges: executed → succeeded is valid', () => {
  assertNoThrow(acTransition('executed', 'succeeded'));
});

test('agent_charges: executed → failed is valid', () => {
  assertNoThrow(acTransition('executed', 'failed'));
});

test('agent_charges: succeeded → refunded is valid', () => {
  assertNoThrow(acTransition('succeeded', 'refunded'));
});

test('agent_charges: succeeded → disputed is valid', () => {
  assertNoThrow(acTransition('succeeded', 'disputed'));
});

test('agent_charges: disputed → succeeded is valid (chargeback denied)', () => {
  assertNoThrow(acTransition('disputed', 'succeeded'));
});

test('agent_charges: disputed → refunded is valid (chargeback granted)', () => {
  assertNoThrow(acTransition('disputed', 'refunded'));
});

// ── failed → succeeded carve-out (invariant 33) ──────────────────────────────

test('agent_charges: failed → succeeded is allowed when callerIdentity = stripe_webhook', () => {
  assertNoThrow(acTransition('failed', 'succeeded', 'stripe_webhook'));
});

test('agent_charges: failed → succeeded is rejected when callerIdentity = charge_router', () => {
  assertThrows(
    acTransition('failed', 'succeeded', 'charge_router'),
    'failed → succeeded with charge_router caller',
  );
});

test('agent_charges: failed → succeeded is rejected when callerIdentity = timeout_job', () => {
  assertThrows(
    acTransition('failed', 'succeeded', 'timeout_job'),
    'failed → succeeded with timeout_job caller',
  );
});

test('agent_charges: failed → succeeded is rejected when callerIdentity = worker_completion', () => {
  assertThrows(
    acTransition('failed', 'succeeded', 'worker_completion'),
    'failed → succeeded with worker_completion caller',
  );
});

// ── Truly-terminal states — no outbound transitions ──────────────────────────

test('agent_charges: blocked → any is rejected (truly-terminal)', () => {
  for (const to of AGENT_CHARGE_STATUSES) {
    if (to === 'blocked') continue; // same-state idempotent, allowed
    assertThrows(acTransition('blocked', to), `blocked → ${to}`);
  }
});

test('agent_charges: denied → any is rejected (truly-terminal)', () => {
  for (const to of AGENT_CHARGE_STATUSES) {
    if (to === 'denied') continue;
    assertThrows(acTransition('denied', to), `denied → ${to}`);
  }
});

test('agent_charges: shadow_settled → any is rejected (truly-terminal)', () => {
  for (const to of AGENT_CHARGE_STATUSES) {
    if (to === 'shadow_settled') continue;
    assertThrows(acTransition('shadow_settled', to), `shadow_settled → ${to}`);
  }
});

test('agent_charges: refunded → any is rejected (truly-terminal)', () => {
  for (const to of AGENT_CHARGE_STATUSES) {
    if (to === 'refunded') continue;
    assertThrows(acTransition('refunded', to), `refunded → ${to}`);
  }
});

// ── Provisionally-terminal — failed only has one carve-out ───────────────────

test('agent_charges: failed → blocked is rejected', () => {
  assertThrows(acTransition('failed', 'blocked'), 'failed → blocked');
});

test('agent_charges: failed → denied is rejected', () => {
  assertThrows(acTransition('failed', 'denied'), 'failed → denied');
});

test('agent_charges: failed → proposed is rejected', () => {
  assertThrows(acTransition('failed', 'proposed'), 'failed → proposed');
});

// ── Forbidden non-terminal transitions (not in spec §4) ──────────────────────

test('agent_charges: proposed → executed is rejected', () => {
  assertThrows(acTransition('proposed', 'executed'), 'proposed → executed');
});

test('agent_charges: proposed → succeeded is rejected', () => {
  assertThrows(acTransition('proposed', 'succeeded'), 'proposed → succeeded');
});

test('agent_charges: approved → proposed is rejected (regression)', () => {
  assertThrows(acTransition('approved', 'proposed'), 'approved → proposed');
});

test('agent_charges: executed → approved is rejected (regression)', () => {
  assertThrows(acTransition('executed', 'approved'), 'executed → approved');
});

test('agent_charges: executed → blocked is rejected', () => {
  assertThrows(acTransition('executed', 'blocked'), 'executed → blocked');
});

test('agent_charges: succeeded → approved is rejected', () => {
  assertThrows(acTransition('succeeded', 'approved'), 'succeeded → approved');
});

// ── Same-state writes (idempotent retries) ────────────────────────────────────

test('agent_charges: same-state write is always allowed', () => {
  for (const status of AGENT_CHARGE_STATUSES) {
    assertNoThrow(acTransition(status, status));
  }
});

// ── Unknown target status ─────────────────────────────────────────────────────

test('agent_charges: proposed → bogus_status is rejected (unknown target)', () => {
  assertThrows(
    () => assertValidAgentChargeTransition(
      'proposed',
      'bogus_status' as AgentChargeStatus,
      { callerIdentity: 'charge_router' },
    ),
    'proposed → bogus_status',
  );
});

// ── Error carries from/to/callerIdentity fields ───────────────────────────────

test('agent_charges: error carries from / to / callerIdentity fields', () => {
  const err = assertThrows(
    acTransition('blocked', 'approved'),
    'error field check',
  );
  if (err.from !== 'blocked') throw new Error(`from: ${err.from}`);
  if (err.to !== 'approved') throw new Error(`to: ${err.to}`);
  if (err.callerIdentity !== 'charge_router') throw new Error(`callerIdentity: ${err.callerIdentity}`);
});

// ── Closed enum sanity checks ─────────────────────────────────────────────────

test('AGENT_CHARGE_STATUSES contains all 11 states from spec §4', () => {
  const expected = new Set([
    'proposed', 'pending_approval', 'approved', 'executed', 'succeeded',
    'failed', 'blocked', 'denied', 'disputed', 'shadow_settled', 'refunded',
  ]);
  const actual = new Set(AGENT_CHARGE_STATUSES);
  for (const s of expected) {
    if (!actual.has(s as AgentChargeStatus)) {
      throw new Error(`Missing status: ${s}`);
    }
  }
  if (actual.size !== expected.size) {
    throw new Error(`Expected ${expected.size} statuses, got ${actual.size}`);
  }
});

test('AGENT_CHARGE_TRANSITION_CALLERS contains all 6 caller types', () => {
  const expected = new Set([
    'charge_router', 'stripe_webhook', 'timeout_job',
    'worker_completion', 'approval_expiry_job', 'retention_purge',
  ]);
  const actual = new Set(AGENT_CHARGE_TRANSITION_CALLERS);
  for (const c of expected) {
    if (!actual.has(c as AgentChargeTransitionCaller)) {
      throw new Error(`Missing caller: ${c}`);
    }
  }
  if (actual.size !== expected.size) {
    throw new Error(`Expected ${expected.size} callers, got ${actual.size}`);
  }
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
