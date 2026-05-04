/**
 * agentSpendAggregateServicePure.test.ts — Pure function tests for agent-spend aggregation.
 *
 * Covers:
 *   - Direction-aware accounting: outbound succeeded adds; inbound-refund subtracts from parent;
 *     outbound refunded subtracts from window.
 *   - Settled vs in-flight not commingled (isTerminalStateForAggregation).
 *   - Idempotency per (chargeId, terminal_state): needsAggregationUpdate returns false for duplicate.
 *   - Non-negative clamp: subtraction taking aggregate below zero clamps at zero.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/agentSpendAggregateServicePure.test.ts
 */

import { expect, test, describe } from 'vitest';
import {
  resolveDirection,
  buildDimensionUpserts,
  applyClamp,
  isTerminalStateForAggregation,
  needsAggregationUpdate,
  type AggregateChargeInput,
} from '../agentSpendAggregateServicePure.js';

// ---------------------------------------------------------------------------
// resolveDirection
// ---------------------------------------------------------------------------

describe('resolveDirection', () => {
  test('outbound_charge succeeded → add', () => {
    expect(resolveDirection('outbound_charge', 'succeeded')).toBe('add');
  });

  test('outbound_charge refunded → subtract (dispute-loss path)', () => {
    expect(resolveDirection('outbound_charge', 'refunded')).toBe('subtract');
  });

  test('outbound_charge failed → null (no aggregate update)', () => {
    expect(resolveDirection('outbound_charge', 'failed')).toBeNull();
  });

  test('outbound_charge blocked → null', () => {
    expect(resolveDirection('outbound_charge', 'blocked')).toBeNull();
  });

  test('inbound_refund succeeded → subtract from parent', () => {
    expect(resolveDirection('inbound_refund', 'succeeded')).toBe('subtract');
  });

  test('inbound_refund failed → null', () => {
    expect(resolveDirection('inbound_refund', 'failed')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isTerminalStateForAggregation — settled vs in-flight separation
// ---------------------------------------------------------------------------

describe('isTerminalStateForAggregation', () => {
  test('succeeded is terminal for aggregation', () => {
    expect(isTerminalStateForAggregation('succeeded')).toBe(true);
  });

  test('refunded is terminal for aggregation', () => {
    expect(isTerminalStateForAggregation('refunded')).toBe(true);
  });

  test('in-flight states are NOT terminal for aggregation', () => {
    const inFlight = ['proposed', 'pending_approval', 'approved', 'executed', 'disputed'] as const;
    for (const status of inFlight) {
      expect(isTerminalStateForAggregation(status)).toBe(false);
    }
  });

  test('failed / blocked / denied / shadow_settled are NOT aggregated', () => {
    for (const s of ['failed', 'blocked', 'denied', 'shadow_settled'] as const) {
      expect(isTerminalStateForAggregation(s)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// needsAggregationUpdate — idempotency per (chargeId, terminal_state)
// ---------------------------------------------------------------------------

describe('needsAggregationUpdate', () => {
  test('new terminal state with null last_aggregated_state → needs update', () => {
    expect(needsAggregationUpdate(null, 'succeeded')).toBe(true);
  });

  test('same terminal state as last_aggregated_state → no-op (idempotent)', () => {
    expect(needsAggregationUpdate('succeeded', 'succeeded')).toBe(false);
  });

  test('different terminal state → needs update (refunded after succeeded)', () => {
    expect(needsAggregationUpdate('succeeded', 'refunded')).toBe(true);
  });

  test('non-terminal new state → never needs update', () => {
    expect(needsAggregationUpdate(null, 'approved')).toBe(false);
    expect(needsAggregationUpdate('succeeded', 'executed')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyClamp — non-negative clamp invariant 28
// ---------------------------------------------------------------------------

describe('applyClamp', () => {
  test('subtraction that stays positive → no clamp', () => {
    const result = applyClamp(1000, 300);
    expect(result).toEqual({ newValue: 700, clamped: false, preClampValue: 1000 });
  });

  test('subtraction that results in exactly zero → no clamp', () => {
    const result = applyClamp(500, 500);
    expect(result).toEqual({ newValue: 0, clamped: false, preClampValue: 500 });
  });

  test('subtraction that goes below zero → clamped at zero', () => {
    const result = applyClamp(200, 300);
    expect(result.newValue).toBe(0);
    expect(result.clamped).toBe(true);
    expect(result.preClampValue).toBe(200);
  });

  test('zero current value and positive delta → clamped at zero', () => {
    const result = applyClamp(0, 100);
    expect(result.newValue).toBe(0);
    expect(result.clamped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildDimensionUpserts — outbound_charge paths
// ---------------------------------------------------------------------------

const baseOutbound: AggregateChargeInput = {
  id: 'charge-001',
  organisationId: 'org-001',
  subaccountId: 'sub-001',
  skillRunId: 'run-001',
  amountMinor: 500,
  kind: 'outbound_charge',
  status: 'succeeded',
  newTerminalState: 'succeeded',
  parentChargeId: null,
  parentMonthlyWindowKey: null,
  parentDailyWindowKey: null,
  monthlyWindowKey: '2026-05',
  dailyWindowKey: '2026-05-04',
};

describe('buildDimensionUpserts — outbound_charge succeeded', () => {
  test('produces subaccount monthly + daily + org monthly + daily + run upserts', () => {
    const upserts = buildDimensionUpserts(baseOutbound);
    expect(upserts).not.toBeNull();
    expect(upserts!.length).toBe(5);

    const entityTypes = upserts!.map((u) => `${u.entityType}:${u.periodType}`);
    expect(entityTypes).toContain('agent_spend_subaccount:monthly');
    expect(entityTypes).toContain('agent_spend_subaccount:daily');
    expect(entityTypes).toContain('agent_spend_org:monthly');
    expect(entityTypes).toContain('agent_spend_org:daily');
    expect(entityTypes).toContain('agent_spend_run:run');
  });

  test('all upserts have direction add', () => {
    const upserts = buildDimensionUpserts(baseOutbound)!;
    for (const u of upserts) {
      expect(u.direction).toBe('add');
    }
  });

  test('no subaccount upserts when subaccountId is null', () => {
    const input = { ...baseOutbound, subaccountId: null };
    const upserts = buildDimensionUpserts(input)!;
    const subaccountUpserts = upserts.filter((u) => u.entityType === 'agent_spend_subaccount');
    expect(subaccountUpserts.length).toBe(0);
  });

  test('no run upsert when skillRunId is null', () => {
    const input = { ...baseOutbound, skillRunId: null };
    const upserts = buildDimensionUpserts(input)!;
    const runUpserts = upserts.filter((u) => u.entityType === 'agent_spend_run');
    expect(runUpserts.length).toBe(0);
  });
});

describe('buildDimensionUpserts — outbound_charge refunded (dispute-loss)', () => {
  test('produces subtract upserts using the charge own window keys', () => {
    const input = { ...baseOutbound, newTerminalState: 'refunded' as const };
    const upserts = buildDimensionUpserts(input)!;
    expect(upserts).not.toBeNull();
    for (const u of upserts) {
      expect(u.direction).toBe('subtract');
    }
  });
});

describe('buildDimensionUpserts — outbound_charge non-terminal state', () => {
  test('returns null for in-flight states', () => {
    const input = { ...baseOutbound, newTerminalState: 'approved' as const };
    expect(buildDimensionUpserts(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildDimensionUpserts — inbound_refund paths (invariant 41)
// ---------------------------------------------------------------------------

const baseInboundRefund: AggregateChargeInput = {
  id: 'refund-001',
  organisationId: 'org-001',
  subaccountId: 'sub-001',
  skillRunId: null,
  amountMinor: 200,
  kind: 'inbound_refund',
  status: 'succeeded',
  newTerminalState: 'succeeded',
  parentChargeId: 'charge-001',
  parentMonthlyWindowKey: '2026-05',
  parentDailyWindowKey: '2026-05-04',
  monthlyWindowKey: '2026-05',
  dailyWindowKey: '2026-05-05',
};

describe('buildDimensionUpserts — inbound_refund succeeded (invariant 41)', () => {
  test('produces subtract upserts using the PARENT window keys, not own keys', () => {
    const upserts = buildDimensionUpserts(baseInboundRefund)!;
    expect(upserts).not.toBeNull();

    const orgMonthly = upserts.find((u) => u.entityType === 'agent_spend_org' && u.periodType === 'monthly');
    expect(orgMonthly?.periodKey).toBe('2026-05'); // parent's monthly window
    expect(orgMonthly?.direction).toBe('subtract');
  });

  test('no per-run upsert for inbound_refund', () => {
    const upserts = buildDimensionUpserts(baseInboundRefund)!;
    const runUpserts = upserts.filter((u) => u.entityType === 'agent_spend_run');
    expect(runUpserts.length).toBe(0);
  });

  test('returns null when parent keys are missing (cannot aggregate safely)', () => {
    const input = { ...baseInboundRefund, parentMonthlyWindowKey: null, parentDailyWindowKey: null };
    expect(buildDimensionUpserts(input)).toBeNull();
  });

  test('settled vs in-flight: inbound_refund failed does not produce upserts', () => {
    const input = { ...baseInboundRefund, newTerminalState: 'failed' as const };
    expect(buildDimensionUpserts(input)).toBeNull();
  });
});
