// crossOwnerDelegationAuthorisation.ts — two-layer cross-owner delegation authoriser.
// Personal-assistant-v2-operator spec §5.4.

import { and, eq, isNull } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { users } from '../db/schema/users.js';
import { subaccountUserAssignments } from '../db/schema/subaccountUserAssignments.js';
import { logger } from '../lib/logger.js';
import type { RoutingContextV2 } from '../../shared/types/routingContext.js';
import {
  detectNamedOwnerReference,
  extractTrustedToolCallOwner,
  normaliseDisplayName,
  type AuthorisationResult,
} from './crossOwnerDelegationAuthorisationPure.js';

export type { AuthorisationResult };

const FAIL_CLOSED: AuthorisationResult = {
  authorised: false,
  clarifying_question:
    "Whose data does this step need access to? Please specify the person's name.",
};

/**
 * Fetch all non-deleted users in a subaccount.
 */
async function fetchSubaccountMembers(
  subaccountId: string,
): Promise<Array<{ id: string; firstName: string; lastName: string }>> {
  const db = getOrgScopedDb('crossOwnerDelegationAuthorisation.fetchSubaccountMembers');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const rows = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(subaccountUserAssignments)
    .innerJoin(users, eq(users.id, subaccountUserAssignments.userId))
    .where(
      and(
        eq(subaccountUserAssignments.subaccountId, subaccountId),
        isNull(users.deletedAt),
      ),
    );
  return rows;
}

/**
 * Authorise a cross-owner delegation request using a two-layer rule.
 *
 * Layer 1: normalised_intent_text possessive detection + subaccount-member resolution.
 * Layer 2: trusted parent-agent tool-call payload (LLM-generated tool arguments).
 *
 * Returns AuthorisationResult. Never throws — fail-closed on error.
 */
export async function authorise(
  routingContext: RoutingContextV2,
  trustedToolCallPayload: Record<string, unknown> | null,
): Promise<AuthorisationResult> {
  try {
    // Layer 1: possessive name detection
    const nameRef = detectNamedOwnerReference(routingContext.normalised_intent_text);
    if (nameRef) {
      const members = await fetchSubaccountMembers(routingContext.subaccountId);
      const normCandidate = normaliseDisplayName(nameRef.candidateName);
      const matches = members.filter((m) => {
        const fullName = `${m.firstName} ${m.lastName}`;
        return (
          normaliseDisplayName(m.firstName) === normCandidate ||
          normaliseDisplayName(fullName) === normCandidate
        );
      });
      if (matches.length === 1) {
        return {
          authorised: true,
          target_owner_user_id: matches[0].id,
          signal: 'user_named_owner',
        };
      }
      // Multiple or zero matches — fall through to Layer 2
    }

    // Layer 2: trusted tool-call payload
    const fromPayload = extractTrustedToolCallOwner(trustedToolCallPayload ?? {});
    if (fromPayload !== null) {
      const members = await fetchSubaccountMembers(routingContext.subaccountId);
      const valid = members.some((m) => m.id === fromPayload);
      if (valid) {
        return {
          authorised: true,
          target_owner_user_id: fromPayload,
          signal: 'parent_agent_explicit_capability',
        };
      }
    }

    return FAIL_CLOSED;
  } catch (err) {
    logger.warn('crossOwnerDelegationAuthorisation.error', {
      organisationId: routingContext.organisationId,
      subaccountId: routingContext.subaccountId,
      error: err instanceof Error ? err.message : String(err),
    });
    return FAIL_CLOSED;
  }
}
