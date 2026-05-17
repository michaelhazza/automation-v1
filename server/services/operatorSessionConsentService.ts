/**
 * operatorSessionConsentService.ts — Impure (DB-writing) service for
 * operator session consent management.
 *
 * operator-session-identity chunk 3.
 *
 * All write methods require an active withOrgTx context (opened by the
 * calling route). Reads (checkConsentStatus) use getOrgScopedDb() directly
 * and also require an active context.
 *
 * Spec: docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md §7.1, §7.2, §8
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getOrgScopedDb, getOrgScopedOrgId, peekOrgTxContext } from '../lib/orgScopedDb.js';
import { operatorSessionConsents, operatorSessionConsentEvents, integrationConnections } from '../db/schema/index.js';
import type { OperatorSessionConsent, OperatorSessionConsentEvent } from '../db/schema/index.js';
import { auditService } from './auditService.js';
import {
  compareDisclosureVersion,
} from './operatorSessionConsentServicePure.js';
import { OPERATOR_SESSION_DISCLOSURE_VERSION } from '../config/operatorSessionProviders.js';

export const operatorSessionConsentService = {
  /**
   * Insert a new consent row.
   *
   * Requires an active withOrgTx context. Typically called inside the
   * connect() transaction with connectionId = null, then backfilled via
   * backfillConnectionId() once the integration_connections row exists.
   */
  async recordConsent(input: {
    organisationId: string;
    subaccountId: string | null;
    userId: string;
    connectionId: string | null;
    planTier: string;
    disclosureVersion: number;
    disclosureTextSnapshot: string;
    consentTextSnapshot: string;
    actorUserId: string;
  }): Promise<OperatorSessionConsent> {
    const db = getOrgScopedDb('operatorSessionConsentService.recordConsent');

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [consent] = await db
      .insert(operatorSessionConsents)
      .values({
        organisationId: input.organisationId,
        subaccountId: input.subaccountId,
        userId: input.userId,
        connectionId: input.connectionId,
        planTier: input.planTier,
        disclosureVersion: input.disclosureVersion,
        disclosureTextSnapshot: input.disclosureTextSnapshot,
        consentTextSnapshot: input.consentTextSnapshot,
      })
      .returning();

    return consent;
  },

  /**
   * Backfill the connectionId on a consent row that was inserted before the
   * integration_connections row existed (initial connect FK bootstrap order
   * per spec §7.2).
   *
   * The ONLY permitted UPDATE on operator_session_consents.
   * Predicate-guarded: WHERE id = consentId AND connection_id IS NULL.
   * Throws if the row was already filled (0 rows updated).
   *
   * Requires an active withOrgTx context.
   */
  async backfillConnectionId(input: {
    consentId: string;
    connectionId: string;
  }): Promise<void> {
    if (!peekOrgTxContext()) {
      throw {
        statusCode: 500,
        errorCode: 'backfill_requires_org_tx_context',
        message: 'backfillConnectionId requires an active withOrgTx context.',
      };
    }
    const db = getOrgScopedDb('operatorSessionConsentService.backfillConnectionId');

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const result = await db
      .update(operatorSessionConsents)
      .set({ connectionId: input.connectionId })
      .where(
        and(
          eq(operatorSessionConsents.id, input.consentId),
          isNull(operatorSessionConsents.connectionId),
        ),
      )
      .returning({ id: operatorSessionConsents.id });

    if (result.length === 0) {
      throw {
        statusCode: 500,
        errorCode: 'consent_backfill_already_filled',
        message: `Consent ${input.consentId} already has a connectionId set; backfill rejected.`,
      };
    }
  },

  /**
   * Append a consent lifecycle event (granted / revoked / superseded).
   *
   * Requires an active withOrgTx context.
   */
  async recordEvent(input: {
    consentId: string;
    eventType: 'granted' | 'revoked' | 'superseded';
    actorUserId: string | null;
    supersededByConsentId?: string | null;
  }): Promise<OperatorSessionConsentEvent> {
    const db = getOrgScopedDb('operatorSessionConsentService.recordEvent');
    const organisationId = getOrgScopedOrgId('operatorSessionConsentService.recordEvent');

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [event] = await db
      .insert(operatorSessionConsentEvents)
      .values({
        organisationId,
        consentId: input.consentId,
        eventType: input.eventType,
        actorUserId: input.actorUserId,
        supersededByConsentId: input.supersededByConsentId ?? null,
      })
      .returning();

    return event;
  },

  /**
   * Check whether a connection's recorded consent is still valid against the
   * current disclosure version.
   *
   * Standalone read — requires an active withOrgTx context (uses
   * getOrgScopedDb() directly).
   *
   * Returns { needsReaccept: false, currentConsentId: null, currentDisclosureVersion: null }
   * when no consent is found (connection has no consentRecordId).
   */
  async checkConsentStatus(connectionId: string): Promise<{
    needsReaccept: boolean;
    currentConsentId: string | null;
    currentDisclosureVersion: number | null;
  }> {
    const db = getOrgScopedDb('operatorSessionConsentService.checkConsentStatus');

    // Load the connection's consentRecordId
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [connection] = await db
      .select({
        consentRecordId: integrationConnections.consentRecordId,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, connectionId)) // guard-ignore: org-scoped-writes reason="standalone read inside withOrgTx context via getOrgScopedDb — RLS enforces org isolation"
      .limit(1);

    if (!connection || !connection.consentRecordId) {
      return { needsReaccept: false, currentConsentId: null, currentDisclosureVersion: null };
    }

    // Load the consent row
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [consent] = await db
      .select({
        id: operatorSessionConsents.id,
        disclosureVersion: operatorSessionConsents.disclosureVersion,
      })
      .from(operatorSessionConsents)
      .where(eq(operatorSessionConsents.id, connection.consentRecordId))
      .limit(1);

    if (!consent) {
      return { needsReaccept: false, currentConsentId: null, currentDisclosureVersion: null };
    }

    const verdict = compareDisclosureVersion(
      consent.disclosureVersion,
      OPERATOR_SESSION_DISCLOSURE_VERSION,
    );

    return {
      needsReaccept: verdict === 'needs_reaccept',
      currentConsentId: consent.id,
      currentDisclosureVersion: consent.disclosureVersion,
    };
  },

  /**
   * V1 stub — PII minimisation for deleted users.
   *
   * The actual hashing rule (which fields, which algorithm, what is retained
   * for legal evidence) is defined by compliance and ships in a follow-up spec.
   * See spec §7.2 and §13 (Deferred items).
   */
  async minimisePiiForDeletedUser(userId: string): Promise<void> {
    // Fire audit event so the call is traceable even in V1.
    await auditService.log({
      actorType: 'system',
      action: 'feature.consent_pii_minimisation_called',
      metadata: { userId, note: 'V1 stub — not implemented' },
    });

    throw {
      statusCode: 501,
      errorCode: 'not_implemented',
      message: 'PII minimisation for deleted users is not implemented in V1.',
    };
  },
};
