// crossOwnerDelegationRequestAssemblerPure.ts — pure helpers for delegation request assembly.
// No DB, no IO. Personal-assistant-v2-operator spec §5.4.

import type { CrossOwnerApprovalTimeoutPolicy } from '../../shared/types/crossOwnerApproval.js';

export type { CrossOwnerApprovalTimeoutPolicy };

/**
 * Derive timeout policy from the delegation tool-call payload flags.
 * Default: 'fail_parent'
 * If payload.optional === true: 'continue_without_substep'
 * If payload.explicit_fallback_to_initiator === true: 'ask_initiator' (takes precedence)
 */
export function deriveTimeoutPolicy(
  delegationPayload: Record<string, unknown>,
): CrossOwnerApprovalTimeoutPolicy {
  if (delegationPayload['explicit_fallback_to_initiator'] === true) return 'ask_initiator';
  if (delegationPayload['optional'] === true) return 'continue_without_substep';
  return 'fail_parent';
}

const VALID_SCOPES = new Set(['children', 'descendants', 'subaccount']);

/**
 * Derive delegation scope from the parent run's scope plus optional payload override.
 * If payload specifies a valid scope: use it. Else inherit parent scope.
 * Default when no parent scope and no payload: 'subaccount'.
 */
export function deriveDelegationScope(
  parentScope: string | null,
  delegationPayload: Record<string, unknown>,
): string {
  const payloadScope = delegationPayload['delegation_scope'];
  if (typeof payloadScope === 'string' && VALID_SCOPES.has(payloadScope)) return payloadScope;
  if (parentScope !== null && VALID_SCOPES.has(parentScope)) return parentScope;
  return 'subaccount';
}
