// ---------------------------------------------------------------------------
// agentChargesRoutePure.ts — Pure helpers for the agent-charges route.
//
// Extracted from `agentCharges.ts` so the unit-tests in
// `__tests__/agentChargesRoutePure.test.ts` can exercise the input-validation
// surface without spinning up an HTTP layer or DB. Imports nothing from the
// route's runtime side (no Express, no DB, no service layer).
//
// Convention: any test file under `__tests__/` MUST import from a sibling
// pure module — enforced by `scripts/verify-pure-helper-convention.sh`.
// ---------------------------------------------------------------------------

import type { AgentChargeStatus } from '../../shared/stateMachineGuards.js';

// ---------------------------------------------------------------------------
// Dimension query-param validation
// ---------------------------------------------------------------------------

export const VALID_AGGREGATE_DIMENSIONS = [
  'agent_spend_subaccount',
  'agent_spend_org',
  'agent_spend_run',
] as const;

export type ValidAggregateDimension = (typeof VALID_AGGREGATE_DIMENSIONS)[number];

export function isValidAggregateDimension(
  value: string,
): value is ValidAggregateDimension {
  return (VALID_AGGREGATE_DIMENSIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Limit query-param parsing
// ---------------------------------------------------------------------------

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

export function resolveListLimit(limitStr: string | undefined): number {
  const parsed = parseInt(limitStr ?? String(DEFAULT_LIST_LIMIT), 10);
  const fallback = parsed && parsed > 0 ? parsed : DEFAULT_LIST_LIMIT;
  return Math.min(fallback, MAX_LIST_LIMIT);
}

// ---------------------------------------------------------------------------
// Status filter — closed enum check
// ---------------------------------------------------------------------------

export const VALID_CHARGE_STATUSES: readonly AgentChargeStatus[] = [
  'proposed',
  'pending_approval',
  'approved',
  'executed',
  'succeeded',
  'failed',
  'blocked',
  'denied',
  'disputed',
  'shadow_settled',
  'refunded',
];

export function isValidChargeStatus(value: string): value is AgentChargeStatus {
  return (VALID_CHARGE_STATUSES as readonly string[]).includes(value);
}
