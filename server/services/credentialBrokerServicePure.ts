/**
 * credentialBrokerServicePure.ts — Pure (no DB / no env) helpers for
 * credential broker resolution.
 *
 * operator-session-identity chunk 2.
 *
 * Exports:
 *   - CredentialNotUsableError — thrown when a credential is not in 'connected_usable' state
 *   - assertCredentialUsableOrThrow — guard + decrypt in one step
 *   - OrderableRow — minimal row shape required for ordering
 *   - orderResolvedCredentials — filter + sort credentials for an agent
 */

import type { UsabilityState } from './operatorSessionLifecycleServicePure.js';

// ---------------------------------------------------------------------------
// CredentialNotUsableError
// ---------------------------------------------------------------------------

export class CredentialNotUsableError extends Error {
  constructor(public readonly state: UsabilityState) {
    super(`Credential is not usable: state is '${state}'`);
    this.name = 'CredentialNotUsableError';
  }
}

// ---------------------------------------------------------------------------
// assertCredentialUsableOrThrow
//
// Throws CredentialNotUsableError when state !== 'connected_usable'.
// Invokes decryptHook exactly once when state === 'connected_usable'.
// ---------------------------------------------------------------------------

export function assertCredentialUsableOrThrow<T>(
  state: UsabilityState,
  decryptHook: () => T,
): T {
  if (state !== 'connected_usable') {
    throw new CredentialNotUsableError(state);
  }
  return decryptHook();
}

// ---------------------------------------------------------------------------
// OrderableRow — minimal shape for ordering / filtering
// ---------------------------------------------------------------------------

export interface OrderableRow {
  id: string;
  label: string | null;
  isDefault: boolean;
  usabilityState: UsabilityState;
  allowedAgentIds: string[] | null;
  availabilityScope: 'all_agents' | 'specific_agents';
  authType: string;
}

// ---------------------------------------------------------------------------
// orderResolvedCredentials — spec ordering rules:
//
// 1. Filter: only rows where:
//      usabilityState === 'connected_usable'
//      AND (availabilityScope === 'all_agents'
//           OR allowedAgentIds.includes(agentId))
//
// 2. Partition filtered rows:
//      a. default operator_session: authType === 'operator_session' && isDefault === true
//         → position 0 (at most one such row expected)
//      b. non-default operator_session: authType === 'operator_session' && !isDefault
//         → sorted by label ASC NULLS LAST, then id ASC
//      c. all other authTypes → appended in their original input order
//
// ---------------------------------------------------------------------------

function labelCompare(a: OrderableRow, b: OrderableRow): number {
  // NULLS LAST: null labels sort after non-null labels
  if (a.label === null && b.label === null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (a.label === null) return 1;
  if (b.label === null) return -1;
  // Uses code-point comparison (same as PostgreSQL's default ORDER BY without COLLATE)
  // so the pure-helper and SQL advisory order remain aligned. Plan §488 "lowercase comparison"
  // refers to the NULL-last handling, not case folding.
  if (a.label < b.label) return -1;
  if (a.label > b.label) return 1;
  // Identical labels: tiebreak by id ASC
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function orderResolvedCredentials<R extends OrderableRow>(rows: R[], agentId: string): R[] {
  // Step 1: filter
  const usable = rows.filter((row) => {
    if (row.usabilityState !== 'connected_usable') return false;
    if (row.availabilityScope === 'all_agents') return true;
    return row.allowedAgentIds?.includes(agentId) ?? false;
  });

  // Step 2: partition
  const defaultOperatorSession: R[] = [];
  const nonDefaultOperatorSession: R[] = [];
  const others: R[] = [];

  for (const row of usable) {
    if (row.authType === 'operator_session') {
      if (row.isDefault) {
        defaultOperatorSession.push(row);
      } else {
        nonDefaultOperatorSession.push(row);
      }
    } else {
      others.push(row);
    }
  }

  // Sort non-default operator_session rows
  const sortedNonDefault = [...nonDefaultOperatorSession].sort(labelCompare);

  // Assemble: default first, then sorted non-default, then others in input order
  return [...defaultOperatorSession, ...sortedNonDefault, ...others];
}
