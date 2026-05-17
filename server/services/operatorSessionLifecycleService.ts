/**
 * operatorSessionLifecycleService.ts — Impure (DB-writing) service for
 * operator session usability state transitions.
 *
 * operator-session-identity chunk 3.
 *
 * Sole owner of every usability_state UPDATE after a row is created.
 * All transitions go through transition() — direct UPDATEs from other
 * code paths are prohibited per spec §7.5 write-ownership rule.
 *
 * Spec: docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md §7.5
 */

import { eq, and } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { integrationConnections } from '../db/schema/index.js';
import { auditService } from './auditService.js';
import {
  isValidTransition,
  InvalidStateTransitionError,
} from './operatorSessionLifecycleServicePure.js';
import type { UsabilityState } from './operatorSessionLifecycleServicePure.js';
import { operatorSessionInitialContextBundler } from './operatorSessionInitialContextBundler.js';
import type { OperatorSessionInitialContextBundle } from './operatorSessionInitialContextBundlerPure.js';

// ---------------------------------------------------------------------------
// Audit action mapping — spec §7.5 / chunk 3 task description
// ---------------------------------------------------------------------------

function auditActionForTransition(to: UsabilityState): string {
  switch (to) {
    case 'revoked':                return 'operator_session.revoked';
    case 'disabled':               return 'operator_session.disabled';
    case 'connected_needs_reauth': return 'operator_session.needs_reauth';
    case 'connected_needs_consent':return 'operator_session.needs_consent';
    case 'connected_usable':       return 'operator_session.restored';
    default:                       return 'operator_session.state_changed';
  }
}

export const operatorSessionLifecycleService = {
  /**
   * Attempt a usability_state transition on the given connection.
   *
   * Steps:
   *   1. isValidTransition(from, to) — throws InvalidStateTransitionError if
   *      the transition is not in the allowed set.
   *   2. UPDATE integration_connections SET usability_state = to, updated_at = now()
   *      WHERE id = connectionId AND organisation_id = organisationId
   *            AND usability_state = from.
   *   3. rowCount === 0 → idempotent — return { transitioned: false }.
   *   4. Emit audit event.
   *
   * Requires an active withOrgTx context.
   */
  async transition(input: {
    connectionId: string;
    organisationId: string;
    from: UsabilityState;
    to: UsabilityState;
    cause?: 'token_refresh_failed' | 'admin_disabled' | 'disclosure_bumped' | 'user_reaccepted' | 'user_reauthed' | 'owner_inactive' | 'permission_revoked';
    actorUserId: string | null;
  }): Promise<{ transitioned: boolean }> {
    if (!isValidTransition(input.from, input.to)) {
      throw new InvalidStateTransitionError(input.from, input.to);
    }

    const db = getOrgScopedDb('operatorSessionLifecycleService.transition');

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const result = await db
      .update(integrationConnections)
      .set({
        usabilityState: input.to,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationConnections.id, input.connectionId),
          eq(integrationConnections.organisationId, input.organisationId),
          eq(integrationConnections.usabilityState, input.from),
        ),
      )
      .returning({ id: integrationConnections.id });

    if (result.length === 0) {
      // Idempotent — connection was already in the target state (or was
      // concurrently transitioned by another actor).
      return { transitioned: false };
    }

    // Emit audit event — fire-and-forget; failure does not roll back the state update
    await auditService.log({
      organisationId: input.organisationId,
      actorType: input.actorUserId ? 'user' : 'system',
      actorId: input.actorUserId ?? undefined,
      action: auditActionForTransition(input.to),
      entityType: 'integration_connection',
      entityId: input.connectionId,
      metadata: {
        from: input.from,
        to: input.to,
        ...(input.cause ? { cause: input.cause } : {}),
      },
    });

    return { transitioned: true };
  },

  /**
   * Build the initial-context bundle for an operator session start.
   *
   * Callers (e.g. operatorManagedBackend) include the returned bundle in the
   * runtime boot payload. Full wiring is deferred to runtime integration work.
   *
   * Requires an active withOrgTx context.
   */
  async startSession(input: {
    agentId: string;
    ownerUserId: string;
    subaccountAgentId: string;
    organisationId: string;
    subaccountId: string;
  }): Promise<OperatorSessionInitialContextBundle> {
    return operatorSessionInitialContextBundler.build(input);
  },
};
