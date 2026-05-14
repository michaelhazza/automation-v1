// operatorCostWriterPure.ts — idempotency key derivation and row shape builders.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.12, §4.10
//
// Pure module — no DB, no IO.

import type { OperatorSessionFallbackEngagedEvent } from '../../shared/types/operatorBackendEvents.js';

/** Source types for operator cost rows. */
export type CostSourceType = 'subscription_mediated' | 'sandbox_compute';

/** The fixed boundary value for chain-link summary cost rows. */
export const COST_ROW_BOUNDARY_CHAIN_LINK = 'chain_link';

/**
 * Derives the idempotency key for the (operator_run_id, source_type, boundary) UNIQUE index.
 *
 * Per spec §3.12: one summary row per (operator_run_id, source_type).
 * Boundary for chain-link summary rows is always 'chain_link'.
 */
export function costRowKey(
  operatorRunId: string,
  sourceType: CostSourceType,
  boundary: string,
): string {
  return `${operatorRunId}:${sourceType}:${boundary}`;
}

// ---------------------------------------------------------------------------
// subscription_mediated row builder
// ---------------------------------------------------------------------------

export interface SubscriptionMediatedCostRowInput {
  agentRunId: string;
  operatorRunId: string;
  organisationId: string;
  subaccountId: string;
  chainSeq: number;
  vendorSessionId: string | null;
  /** step_count = total turns up to swap (or full link if no swap). */
  stepCount: number;
  planTier: string | null;
}

export interface SubscriptionMediatedCostRow {
  source_type: 'subscription_mediated';
  agent_run_id: string;
  operator_run_id: string;
  organisation_id: string;
  subaccount_id: string;
  chain_seq: number;
  vendor_session_id: string | null;
  credential_mode: 'operator_session';
  step_count: number;
  plan_tier: string | null;
  input_tokens: 0;
  output_tokens: 0;
  cost_cents: 0;
  boundary: 'chain_link';
}

/**
 * Builds the subscription_mediated cost row shape.
 *
 * Per spec §3.12.B:
 * - One row per chain link where credential_start_mode = 'operator_session'.
 * - cost_cents = 0 (zero-cost accounting row).
 * - step_count is the pre-swap step count if fallback engaged; otherwise total steps.
 */
export function buildSubscriptionMediatedCostRow(
  input: SubscriptionMediatedCostRowInput,
): SubscriptionMediatedCostRow {
  return {
    source_type: 'subscription_mediated',
    agent_run_id: input.agentRunId,
    operator_run_id: input.operatorRunId,
    organisation_id: input.organisationId,
    subaccount_id: input.subaccountId,
    chain_seq: input.chainSeq,
    vendor_session_id: input.vendorSessionId,
    credential_mode: 'operator_session',
    step_count: input.stepCount,
    plan_tier: input.planTier,
    input_tokens: 0,
    output_tokens: 0,
    cost_cents: 0,
    boundary: 'chain_link',
  };
}

// ---------------------------------------------------------------------------
// sandbox_compute row builder
// ---------------------------------------------------------------------------

export interface SandboxComputeCostRowInput {
  agentRunId: string;
  operatorRunId: string;
  organisationId: string;
  subaccountId: string;
  chainSeq: number;
  vcpuSeconds: number;
  wallClockMs: number;
  peakMemoryBytes: number;
  costCents: number;
}

export interface SandboxComputeCostRow {
  source_type: 'sandbox_compute';
  agent_run_id: string;
  operator_run_id: string;
  organisation_id: string;
  subaccount_id: string;
  chain_seq: number;
  vcpu_seconds: number;
  wall_clock_ms: number;
  peak_memory_bytes: number;
  cost_cents: number;
  boundary: 'chain_link';
}

/**
 * Builds the sandbox_compute cost row shape.
 *
 * Per spec §3.12.A:
 * - One row per chain link / sandbox session.
 * - cost_cents computed by the caller using the existing sandbox-compute pricing function.
 */
export function buildSandboxComputeCostRow(
  input: SandboxComputeCostRowInput,
): SandboxComputeCostRow {
  return {
    source_type: 'sandbox_compute',
    agent_run_id: input.agentRunId,
    operator_run_id: input.operatorRunId,
    organisation_id: input.organisationId,
    subaccount_id: input.subaccountId,
    chain_seq: input.chainSeq,
    vcpu_seconds: input.vcpuSeconds,
    wall_clock_ms: input.wallClockMs,
    peak_memory_bytes: input.peakMemoryBytes,
    cost_cents: input.costCents,
    boundary: 'chain_link',
  };
}

// ---------------------------------------------------------------------------
// Pre-swap step count derivation
// ---------------------------------------------------------------------------

/**
 * Derives the pre-swap step count from a fallback_engaged event payload.
 *
 * Per spec §3.12.B:
 * When fallback engaged mid-chain-link, the subscription_mediated row's
 * step_count = turns up to the swap. The fallback_engaged event carries
 * step_index which is the last step under the operator_session mode.
 */
export function derivePreSwapStepCount(
  fallbackEngagedEvent: OperatorSessionFallbackEngagedEvent,
): number {
  return fallbackEngagedEvent.step_index;
}
