/**
 * agentChargeAllowlistPure.test.ts
 *
 * Pure-function tests confirming the mutable-on-transition allowlist matches
 * spec §5.1. Run via:
 *   npx tsx server/services/__tests__/agentChargeAllowlistPure.test.ts
 */

import { test } from 'vitest';
import {
  AGENT_CHARGE_MUTABLE_ON_TRANSITION_COLUMNS,
  AGENT_CHARGE_IMMUTABLE_COLUMNS,
  isMutableOnTransition,
  isImmutableColumn,
} from '../agentChargeAllowlistPure.js';

function assertSetEqual(actual: readonly string[], expected: readonly string[], label: string): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  for (const item of expectedSet) {
    if (!actualSet.has(item)) {
      throw new Error(`${label}: expected '${item}' to be present`);
    }
  }
  for (const item of actualSet) {
    if (!expectedSet.has(item)) {
      throw new Error(`${label}: unexpected extra entry '${item}'`);
    }
  }
}

// ── Mutable-on-transition allowlist matches spec §5.1 ────────────────────────

test('mutable-on-transition columns match spec §5.1 allowlist exactly', () => {
  // Source of truth: spec §5.1 "Mutable-on-transition allowlist"
  const specAllowlist = [
    'status',
    'action_id',
    'provider_charge_id',
    'spt_connection_id',
    'decision_path',
    'failure_reason',
    'approved_at',
    'executed_at',
    'settled_at',
    'expires_at',
    'approval_expires_at',
    'last_transition_by',
    'last_transition_event_id',
    'last_aggregated_state',
    'updated_at',
  ] as const;

  assertSetEqual(AGENT_CHARGE_MUTABLE_ON_TRANSITION_COLUMNS, specAllowlist, 'mutable columns');
});

// ── Immutable columns match spec §5.1 (every column NOT in the allowlist) ────

test('immutable columns match spec §5.1 non-allowlist columns exactly', () => {
  // Source of truth: spec §5.1 — every column listed in the table that is NOT
  // in the mutable-on-transition allowlist above.
  const specImmutable = [
    'id',
    'organisation_id',
    'subaccount_id',
    'spending_budget_id',
    'spending_policy_id',
    'policy_version',
    'agent_id',
    'skill_run_id',
    'idempotency_key',
    'intent_id',
    'intent',
    'charge_type',
    'direction',
    'amount_minor',
    'currency',
    'merchant_id',
    'merchant_descriptor',
    'mode',
    'kind',
    'parent_charge_id',
    'replay_of_charge_id',
    'provenance',
    'created_at',
  ] as const;

  assertSetEqual(AGENT_CHARGE_IMMUTABLE_COLUMNS, specImmutable, 'immutable columns');
});

// ── Mutable and immutable sets are disjoint ───────────────────────────────────

test('mutable and immutable sets are disjoint', () => {
  const mutableSet: ReadonlySet<string> = new Set(AGENT_CHARGE_MUTABLE_ON_TRANSITION_COLUMNS);
  for (const col of AGENT_CHARGE_IMMUTABLE_COLUMNS) {
    if (mutableSet.has(col)) {
      throw new Error(`Column '${col}' appears in both mutable and immutable sets`);
    }
  }
});

// ── Helper functions ─────────────────────────────────────────────────────────

test('isMutableOnTransition returns true for status', () => {
  if (!isMutableOnTransition('status')) {
    throw new Error("expected isMutableOnTransition('status') = true");
  }
});

test('isMutableOnTransition returns false for organisation_id', () => {
  if (isMutableOnTransition('organisation_id')) {
    throw new Error("expected isMutableOnTransition('organisation_id') = false");
  }
});

test('isImmutableColumn returns true for amount_minor', () => {
  if (!isImmutableColumn('amount_minor')) {
    throw new Error("expected isImmutableColumn('amount_minor') = true");
  }
});

test('isImmutableColumn returns false for expires_at', () => {
  if (isImmutableColumn('expires_at')) {
    throw new Error("expected isImmutableColumn('expires_at') = false");
  }
});

test('isMutableOnTransition returns false for unknown column', () => {
  if (isMutableOnTransition('bogus_column')) {
    throw new Error("expected isMutableOnTransition('bogus_column') = false");
  }
});

console.log('');
