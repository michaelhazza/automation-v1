// ---------------------------------------------------------------------------
// agentSpendAggregateServicePure — pure helpers for direction-aware accounting
//
// No DB, no I/O. All functions are deterministic and side-effect-free.
// Impure orchestration lives in agentSpendAggregateService.ts.
//
// Spec: tasks/builds/agentic-commerce/spec.md §6.1, §7.6
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 13
// Invariants: 27, 28, 41, 42
// ---------------------------------------------------------------------------

import type { AgentChargeStatus } from '../../shared/stateMachineGuards.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AggregateDirection = 'add' | 'subtract';

export interface NegativeClampEvent {
  chargeId: string;
  dimension: string;
  windowKey: string;
  attemptedDelta: number;
  preClampValue: number;
}

export interface DimensionUpsert {
  entityType: string;
  entityId: string;
  periodType: string;
  periodKey: string;
  direction: AggregateDirection;
  amountMinor: number;
}

/** Minimal charge shape the pure layer needs. */
export interface AggregateChargeInput {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  /** The agent_run id that initiated this charge. Used for per-run dimension. */
  skillRunId: string | null;
  amountMinor: number;
  kind: 'outbound_charge' | 'inbound_refund';
  status: AgentChargeStatus;
  /** New terminal state being applied (equal to status for first-time aggregation). */
  newTerminalState: AgentChargeStatus;
  /** For inbound_refund rows: the original outbound charge id. */
  parentChargeId: string | null;
  /** Window key for the parent charge's monthly window (resolved by impure layer). */
  parentMonthlyWindowKey: string | null;
  /** Window key for the parent charge's daily window. */
  parentDailyWindowKey: string | null;
  /** Window key for monthly window of this charge. */
  monthlyWindowKey: string;
  /** Window key for daily window of this charge. */
  dailyWindowKey: string;
}

// ---------------------------------------------------------------------------
// resolveDirection
//
// Returns the direction for accounting based on charge kind and status.
// Invariant 41: inbound_refund rows subtract from parent's window.
// Invariant 28: subtract path can clamp at zero.
// ---------------------------------------------------------------------------

export function resolveDirection(kind: 'outbound_charge' | 'inbound_refund', newTerminalState: AgentChargeStatus): AggregateDirection | null {
  if (kind === 'outbound_charge') {
    if (newTerminalState === 'succeeded') return 'add';
    if (newTerminalState === 'refunded') return 'subtract';
    // failed, blocked, denied, shadow_settled do not update aggregates
    return null;
  }

  if (kind === 'inbound_refund') {
    // Inbound-refund rows that succeed drive the subtract path on the parent's window.
    if (newTerminalState === 'succeeded') return 'subtract';
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// buildDimensionUpserts
//
// Given a charge input, returns the list of dimension upserts to apply.
// For outbound succeeded: add to subaccount monthly/daily, org monthly/daily, run.
// For outbound refunded: subtract from subaccount monthly/daily, org monthly/daily, run.
// For inbound_refund succeeded: subtract from parent's window (subaccount monthly/daily, org monthly/daily).
//
// Per invariant 41: for inbound_refund, the parentMonthlyWindowKey and
// parentDailyWindowKey (from the original outbound row) are used, not the
// refund row's own window keys.
// ---------------------------------------------------------------------------

export function buildDimensionUpserts(charge: AggregateChargeInput): DimensionUpsert[] | null {
  const direction = resolveDirection(charge.kind, charge.newTerminalState);
  if (direction === null) return null;

  const upserts: DimensionUpsert[] = [];

  if (charge.kind === 'inbound_refund') {
    // Subtract from parent's window. Use parent's window keys.
    // If we cannot resolve parent keys, we cannot aggregate safely.
    if (!charge.parentChargeId || !charge.parentMonthlyWindowKey || !charge.parentDailyWindowKey) {
      return null;
    }

    if (charge.subaccountId) {
      upserts.push({
        entityType: 'agent_spend_subaccount',
        entityId: charge.subaccountId,
        periodType: 'monthly',
        periodKey: charge.parentMonthlyWindowKey,
        direction: 'subtract',
        amountMinor: charge.amountMinor,
      });
      upserts.push({
        entityType: 'agent_spend_subaccount',
        entityId: charge.subaccountId,
        periodType: 'daily',
        periodKey: charge.parentDailyWindowKey,
        direction: 'subtract',
        amountMinor: charge.amountMinor,
      });
    }

    upserts.push({
      entityType: 'agent_spend_org',
      entityId: charge.organisationId,
      periodType: 'monthly',
      periodKey: charge.parentMonthlyWindowKey,
      direction: 'subtract',
      amountMinor: charge.amountMinor,
    });
    upserts.push({
      entityType: 'agent_spend_org',
      entityId: charge.organisationId,
      periodType: 'daily',
      periodKey: charge.parentDailyWindowKey,
      direction: 'subtract',
      amountMinor: charge.amountMinor,
    });

    // No per-run dimension for inbound_refund (runs are immutable once settled).
    return upserts;
  }

  // outbound_charge: add or subtract
  if (charge.subaccountId) {
    upserts.push({
      entityType: 'agent_spend_subaccount',
      entityId: charge.subaccountId,
      periodType: 'monthly',
      periodKey: charge.monthlyWindowKey,
      direction,
      amountMinor: charge.amountMinor,
    });
    upserts.push({
      entityType: 'agent_spend_subaccount',
      entityId: charge.subaccountId,
      periodType: 'daily',
      periodKey: charge.dailyWindowKey,
      direction,
      amountMinor: charge.amountMinor,
    });
  }

  upserts.push({
    entityType: 'agent_spend_org',
    entityId: charge.organisationId,
    periodType: 'monthly',
    periodKey: charge.monthlyWindowKey,
    direction,
    amountMinor: charge.amountMinor,
  });
  upserts.push({
    entityType: 'agent_spend_org',
    entityId: charge.organisationId,
    periodType: 'daily',
    periodKey: charge.dailyWindowKey,
    direction,
    amountMinor: charge.amountMinor,
  });

  if (charge.skillRunId) {
    upserts.push({
      entityType: 'agent_spend_run',
      entityId: charge.skillRunId,
      periodType: 'run',
      periodKey: charge.skillRunId,
      direction,
      amountMinor: charge.amountMinor,
    });
  }

  return upserts;
}

// ---------------------------------------------------------------------------
// applyClamp
//
// Clamps a subtraction to zero and returns the clamped value plus whether
// clamping occurred. Per invariant 28.
// ---------------------------------------------------------------------------

export interface ClampResult {
  newValue: number;
  clamped: boolean;
  preClampValue: number;
}

export function applyClamp(currentValue: number, delta: number): ClampResult {
  const unclamped = currentValue - delta;
  if (unclamped < 0) {
    return { newValue: 0, clamped: true, preClampValue: currentValue };
  }
  return { newValue: unclamped, clamped: false, preClampValue: currentValue };
}

// ---------------------------------------------------------------------------
// isTerminalStateForAggregation
//
// Returns true when the given status is a terminal state that drives an
// aggregate update. Settled-vs-in-flight separation per spec §7.6:
//   - 'succeeded' and 'refunded' are the only states that write to aggregates.
//   - In-flight states (pending_approval, approved, executed) must NOT commingle
//     with settled aggregates.
// ---------------------------------------------------------------------------

export function isTerminalStateForAggregation(status: AgentChargeStatus): boolean {
  return status === 'succeeded' || status === 'refunded';
}

// ---------------------------------------------------------------------------
// needsAggregationUpdate
//
// Returns true when a given (chargeId, newState) pair needs aggregation applied.
// The impure layer uses last_aggregated_state to short-circuit; this pure
// helper documents the guard invariant for tests.
// ---------------------------------------------------------------------------

export function needsAggregationUpdate(
  lastAggregatedState: AgentChargeStatus | null,
  newState: AgentChargeStatus,
): boolean {
  if (!isTerminalStateForAggregation(newState)) return false;
  return lastAggregatedState !== newState;
}
