// Pure helpers for the Delegation Outcome service.
// No DB / IO access — every function takes inputs and returns outputs.
// Tested in server/services/__tests__/delegationOutcomeServicePure.test.ts.
//
// Spec: tasks/builds/paperclip-hierarchy/plan.md §4, §5.4.

import {
  DELEGATION_SCOPE_VALUES,
  DELEGATION_DIRECTION_VALUES,
} from '../../shared/types/delegation.js';

// ---------------------------------------------------------------------------
// assertDelegationOutcomeShape
// ---------------------------------------------------------------------------

export interface DelegationOutcomeInput {
  organisationId: string;
  subaccountId: string;
  runId: string;
  callerAgentId: string;
  targetAgentId: string;
  delegationScope: string;
  outcome: string;
  reason: string | null | undefined;
  delegationDirection: string;
}

/**
 * Pure validator replicating the four DB CHECK constraints:
 *   1. delegation_scope IN ('children','descendants','subaccount')
 *   2. outcome IN ('accepted','rejected')
 *   3. reason IS NULL iff outcome = 'accepted'
 *   4. delegation_direction IN ('down','up','lateral')
 *
 * Throws a descriptive Error on any violation.
 */
export function assertDelegationOutcomeShape(input: DelegationOutcomeInput): void {
  if (!(DELEGATION_SCOPE_VALUES as ReadonlyArray<string>).includes(input.delegationScope)) {
    throw new Error(
      `delegation_outcome_invalid_scope: got "${input.delegationScope}", expected one of ${DELEGATION_SCOPE_VALUES.join(', ')}`,
    );
  }

  if (input.outcome !== 'accepted' && input.outcome !== 'rejected') {
    throw new Error(
      `delegation_outcome_invalid_outcome: got "${input.outcome}", expected "accepted" or "rejected"`,
    );
  }

  if (input.outcome === 'accepted' && input.reason != null) {
    throw new Error(
      'delegation_outcome_reason_not_allowed: reason must be null when outcome is "accepted"',
    );
  }

  if (input.outcome === 'rejected' && (input.reason == null || input.reason === '')) {
    throw new Error(
      'delegation_outcome_reason_required: reason must be a non-empty string when outcome is "rejected"',
    );
  }

  if (!(DELEGATION_DIRECTION_VALUES as ReadonlyArray<string>).includes(input.delegationDirection)) {
    throw new Error(
      `delegation_outcome_invalid_direction: got "${input.delegationDirection}", expected one of ${DELEGATION_DIRECTION_VALUES.join(', ')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// buildListQueryFilters
// ---------------------------------------------------------------------------

const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export interface RawListFilters {
  callerAgentId?: string;
  targetAgentId?: string;
  outcome?: string;
  delegationDirection?: string;
  /** ISO 8601 string or Date. Defaults to now - 7d. */
  since?: string | Date;
  /** Default 100, capped at 500. Accepts a numeric string from req.query. */
  limit?: number | string;
}

export interface CoercedListFilters {
  callerAgentId: string | undefined;
  targetAgentId: string | undefined;
  outcome: 'accepted' | 'rejected' | undefined;
  delegationDirection: 'down' | 'up' | 'lateral' | undefined;
  since: Date;
  limit: number;
}

/**
 * Coerces and clamps raw query parameters for the `list` read path.
 * - `limit` defaults to 100, is clamped to the range [1, 500].
 * - `since` defaults to seven days ago.
 * - Unknown enum values for `outcome` and `delegationDirection` are dropped
 *   (undefined) so the query returns all rows rather than an empty set for a
 *   typo.
 */
export function buildListQueryFilters(raw: RawListFilters): CoercedListFilters {
  // Clamp limit — parse string values that come from req.query
  let limit: number = DEFAULT_LIMIT;
  if (raw.limit !== undefined && raw.limit !== null) {
    const parsed = typeof raw.limit === 'string' ? parseInt(raw.limit, 10) : raw.limit;
    if (Number.isFinite(parsed) && parsed >= 1) {
      limit = parsed;
    }
  }
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  // Coerce since
  let since: Date;
  if (raw.since instanceof Date) {
    since = raw.since;
  } else if (typeof raw.since === 'string' && raw.since.length > 0) {
    const parsed = new Date(raw.since);
    since = Number.isNaN(parsed.getTime())
      ? defaultSince()
      : parsed;
  } else {
    since = defaultSince();
  }

  // Coerce outcome enum
  const outcome =
    raw.outcome === 'accepted' || raw.outcome === 'rejected'
      ? (raw.outcome as 'accepted' | 'rejected')
      : undefined;

  // Coerce direction enum
  const delegationDirection =
    raw.delegationDirection === 'down' ||
    raw.delegationDirection === 'up' ||
    raw.delegationDirection === 'lateral'
      ? (raw.delegationDirection as 'down' | 'up' | 'lateral')
      : undefined;

  return {
    callerAgentId: raw.callerAgentId,
    targetAgentId: raw.targetAgentId,
    outcome,
    delegationDirection,
    since,
    limit,
  };
}

function defaultSince(): Date {
  return new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
}
