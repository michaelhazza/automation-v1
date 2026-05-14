// crossOwnerDelegationRequestAssembler.ts — assembles + persists cross-owner delegation requests.
// Personal-assistant-v2-operator spec §5.4.

import { and, eq, isNull } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { delegationOutcomes } from '../db/schema/delegationOutcomes.js';
import type { RoutingContextV2 } from '../../shared/types/routingContext.js';
import {
  deriveTimeoutPolicy,
  deriveDelegationScope,
} from './crossOwnerDelegationRequestAssemblerPure.js';

export interface CrossOwnerDelegationRequest {
  parent_run_id: string;
  parent_owner_principal: 'subaccount' | 'user' | 'org' | 'system';
  parent_owner_id: string;
  initiator_user_id: string;
  required_capabilities: string[];
  authorisation_signal: 'user_named_owner' | 'parent_agent_explicit_capability';
  target_owner_user_id: string;
  delegation_scope: string;
  cross_owner_approval_timeout_policy: 'fail_parent' | 'continue_without_substep' | 'ask_initiator';
}

interface ParentRunContext {
  id: string;
  organisationId: string;
  subaccountId: string;
  initiatorUserId: string;
  ownerPrincipal: 'subaccount' | 'user' | 'org' | 'system';
  ownerId: string;
  scope?: string | null;
}

/**
 * Assemble a CrossOwnerDelegationRequest and persist
 * `cross_owner_approval_timeout_policy` to a specific `delegation_outcomes` row.
 *
 * `delegationOutcomeId` MUST be the id of the open delegation_outcomes row this
 * cross-owner request belongs to (chatgpt-pr-review Round 6 F15). The UPDATE
 * scopes by that id so a parent run with multiple open delegations does NOT
 * receive the same timeout policy applied across unrelated substeps.
 *
 * Throws with errorCode 'cross_owner_assembler_precondition' when
 * routingContext.target_owner_user_id is missing.
 */
export async function build(
  parentRun: ParentRunContext,
  delegationOutcomeId: string,
  routingContext: RoutingContextV2,
  authorisationSignal: 'user_named_owner' | 'parent_agent_explicit_capability',
  requiredCapabilities: string[],
  delegationPayload: Record<string, unknown>,
): Promise<CrossOwnerDelegationRequest> {
  if (!routingContext.target_owner_user_id) {
    throw Object.assign(
      new Error('target_owner_user_id missing — call authorise() before build()'),
      { errorCode: 'cross_owner_assembler_precondition' },
    );
  }

  const timeoutPolicy = deriveTimeoutPolicy(delegationPayload);
  const delegationScope = deriveDelegationScope(parentRun.scope ?? null, delegationPayload);

  const db = getOrgScopedDb('crossOwnerDelegationRequestAssembler.build');
  const updated = await db
    .update(delegationOutcomes)
    .set({ crossOwnerApprovalTimeoutPolicy: timeoutPolicy })
    .where(
      and(
        eq(delegationOutcomes.id, delegationOutcomeId),
        eq(delegationOutcomes.organisationId, parentRun.organisationId),
        isNull(delegationOutcomes.terminalAt),
      ),
    )
    .returning({ id: delegationOutcomes.id });

  if (updated.length === 0) {
    logger.warn('crossOwnerDelegationRequestAssembler.no_outcome_row', {
      runId: parentRun.id,
      delegationOutcomeId,
      timeoutPolicy,
    });
  }

  return {
    parent_run_id: parentRun.id,
    parent_owner_principal: parentRun.ownerPrincipal,
    parent_owner_id: parentRun.ownerId,
    initiator_user_id: parentRun.initiatorUserId,
    required_capabilities: requiredCapabilities,
    authorisation_signal: authorisationSignal,
    target_owner_user_id: routingContext.target_owner_user_id,
    delegation_scope: delegationScope,
    cross_owner_approval_timeout_policy: timeoutPolicy,
  };
}
