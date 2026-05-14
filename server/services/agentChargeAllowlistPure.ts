// ---------------------------------------------------------------------------
// agentChargeAllowlistPure — mutable-on-transition column allowlist
//
// Canonical list of agent_charges columns that the BEFORE UPDATE trigger
// permits to change on a status transition (spec §5.1 mutable-on-transition
// allowlist). The trigger SQL in 0271_agentic_commerce_schema.sql is the
// authoritative enforcement; this module provides an in-code reference for
// service-layer callers to verify they are not writing immutable columns.
//
// Pure (no I/O) — importable in tests without any DB or network dependencies.
// ---------------------------------------------------------------------------

/**
 * Columns that MAY change on a status-transition UPDATE to agent_charges.
 * Any column not in this list is immutable post-insert.
 * Source of truth: spec §5.1 mutable-on-transition allowlist.
 * Mirror: trigger agent_charges_validate_update in 0271_agentic_commerce_schema.sql.
 */
export const AGENT_CHARGE_MUTABLE_ON_TRANSITION_COLUMNS = [
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

export type AgentChargeMutableColumn =
  (typeof AGENT_CHARGE_MUTABLE_ON_TRANSITION_COLUMNS)[number];

/**
 * Columns that are IMMUTABLE after initial INSERT to agent_charges.
 * Source of truth: spec §5.1 (every column NOT in the mutable allowlist).
 */
export const AGENT_CHARGE_IMMUTABLE_COLUMNS = [
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

export type AgentChargeImmutableColumn =
  (typeof AGENT_CHARGE_IMMUTABLE_COLUMNS)[number];

/**
 * Returns true if the given column name is in the mutable-on-transition allowlist.
 */
export function isMutableOnTransition(column: string): column is AgentChargeMutableColumn {
  return (AGENT_CHARGE_MUTABLE_ON_TRANSITION_COLUMNS as readonly string[]).includes(column);
}

/**
 * Returns true if the given column name is in the immutable set.
 */
export function isImmutableColumn(column: string): column is AgentChargeImmutableColumn {
  return (AGENT_CHARGE_IMMUTABLE_COLUMNS as readonly string[]).includes(column);
}
