/**
 * operatorSessionService.ts — Top-level service for operator session
 * AI Subscription connections.
 *
 * operator-session-identity chunk 3.
 *
 * Owns the initial connect flow, re-acceptance flow, and the read path
 * for listing allowed subscriptions for an agent.
 *
 * All methods assume they are called within an active withOrgTx context
 * (opened by the `authenticate` middleware). They call getOrgScopedDb() internally.
 *
 * Write-ownership rules (spec §7.5):
 *   - connect() is the SOLE owner of the initial usability_state value on INSERT.
 *   - operatorSessionLifecycleService.transition() is the SOLE owner of every
 *     subsequent usability_state UPDATE. No other code path may write usability_state.
 *
 * Spec: docs/superpowers/specs/2026-05-11-operator-session-identity-spec.md
 *       §7.4, §7.5, §9.2, §11.1, §11.3, §11.4
 */

import { eq, and, asc, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { integrationConnections, operatorRuns } from '../db/schema/index.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';
import type { OperatorSessionConsent } from '../db/schema/index.js';
import type { AiSubscriptionConnection } from '../../shared/types/govern.js';
import { auditService } from './auditService.js';
import { operatorSessionConsentService } from './operatorSessionConsentService.js';
import { operatorSessionLifecycleService } from './operatorSessionLifecycleService.js';
import { operatorSandboxFileEventBridge } from './operatorSandboxFileEventBridge.js';
import { OPERATOR_SESSION_PROVIDERS } from '../config/operatorSessionProviders.js';
import type { UsabilityState } from './operatorSessionLifecycleServicePure.js';

export type { AiSubscriptionConnection };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OperatorSessionConfigJson = {
  operator_session?: {
    availabilityScope?: 'all_agents' | 'specific_agents';
    allowedAgentIds?: string[] | null;
  };
};

function derivePendingReason(
  usabilityState: UsabilityState,
): 'needs_new_consent' | 'needs_reauth' | 'plan_unverified' | null {
  switch (usabilityState) {
    case 'connected_needs_consent': return 'needs_new_consent';
    case 'connected_needs_reauth':  return 'needs_reauth';
    case 'connected_unverified':    return 'plan_unverified';
    default:                        return null;
  }
}

export function mapToAiSubscriptionConnection(row: IntegrationConnection): AiSubscriptionConnection {
  const cfg = (row.configJson as OperatorSessionConfigJson | null)?.operator_session;
  const availabilityScope = cfg?.availabilityScope ?? 'all_agents';
  const allowedAgentIds = cfg?.allowedAgentIds ?? null;

  return {
    id: row.id,
    authMethod: 'ai_subscription',
    provider: row.providerType,
    planTier: (row.planTier as AiSubscriptionConnection['planTier']) ?? 'unknown',
    planVerificationStatus:
      (row.planVerificationStatus as AiSubscriptionConnection['planVerificationStatus']) ?? 'failed',
    planVerifiedAt: row.planVerifiedAt ? row.planVerifiedAt.toISOString() : null,
    usabilityState: (row.usabilityState as UsabilityState) ?? 'connected_unverified',
    // V1: disabledReason is always null — metadata field not populated yet
    disabledReason: null,
    pendingReason: derivePendingReason(
      (row.usabilityState as UsabilityState) ?? 'connected_unverified',
    ),
    isDefault: row.isDefault,
    availabilityScope,
    allowedAgentIds,
    label: row.label ?? null,
    // V1: ownerUserId is the connecting user; userIdNullified = false; displayName = null
    user: {
      userId: row.ownerUserId ?? null,
      userIdNullified: false,
      displayName: null,
    },
    // PA-CLEANUP-DEF-3: last_refresh_attempted_at / last_refresh_succeeded columns not added (logger-only acceptance).
    lastRefreshedAt: null,
    createdAt: row.createdAt.toISOString(),
  };
}

function isPostgresUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string };
  return e.code === '23505';
}

// ---------------------------------------------------------------------------
// V1 disclosure text builder — returns a canonical disclosure string for the
// provider. Content is intentionally minimal in V1; a real disclosure text
// will be substituted before the provider mechanism is verified.
// ---------------------------------------------------------------------------

function buildDisclosureText(provider: string): string {
  const entry = OPERATOR_SESSION_PROVIDERS[provider];
  const displayName = entry?.displayName ?? provider;
  return (
    `By connecting your ${displayName} account, you authorise this platform to use your ` +
    `subscription credentials on your behalf when running AI-powered automations. ` +
    `Your credentials are stored encrypted and are only used to initiate requests to ` +
    `${displayName} that you have approved. You may disconnect at any time.`
  );
}

// ---------------------------------------------------------------------------
// Initial state derivation per spec §7.4
// ---------------------------------------------------------------------------

function deriveInitialState(
  planDetectionMechanism: string,
  planTierInput: string,
  hasDisclosureAccepted: boolean,
): {
  usabilityState: UsabilityState;
  planVerificationStatus: 'verified' | 'self_declared' | 'failed';
} {
  if (planDetectionMechanism === 'self_declaration') {
    if (hasDisclosureAccepted) {
      // Option B: accepted disclosure is sufficient to unblock the broker immediately.
      return { usabilityState: 'connected_usable', planVerificationStatus: 'self_declared' };
    }
    // Disclosure required but not provided — caller should have thrown 422 before here
    return { usabilityState: 'connected_unverified', planVerificationStatus: 'failed' };
  }

  if (planDetectionMechanism === 'introspection_api') {
    // Verified sanctioned tiers land immediately in connected_usable
    return { usabilityState: 'connected_usable', planVerificationStatus: 'verified' };
  }

  // Fallback: probe or unrecognised mechanism
  return { usabilityState: 'connected_unverified', planVerificationStatus: 'failed' };
}

// ---------------------------------------------------------------------------
// operatorSessionService
// ---------------------------------------------------------------------------

export const operatorSessionService = {
  /**
   * Connect a new AI Subscription (operator session) for the given user.
   *
   * Called within an active withOrgTx context (the `authenticate` middleware opens the org-scoped transaction).
   *
   * Steps (Branch B — self_declaration with disclosure):
   *   1. Registry guard: connectionMechanism === 'none_verified' → 501
   *   2. Disclosure-requirement gate: self_declaration without disclosureAcceptance → 422
   *   3. V1 mock provider handshake (placeholder token; never executed due to step 1)
   *   4. Derive initial state (usabilityState + planVerificationStatus)
   *   5. INSERT consent → INSERT connection → backfill consent.connectionId
   *   6. Emit audit event
   *   7. Return AiSubscriptionConnection
   */
  async connect(input: {
    organisationId: string;
    subaccountId: string;
    userId: string;
    provider: string;
    label: string;
    disclosureAcceptance?: {
      disclosureVersion: number;
      consentText: string;
      acceptanceTier: 'pro' | 'team' | 'enterprise' | 'plus' | 'unknown';
    };
  }): Promise<AiSubscriptionConnection> {
    const providerEntry = OPERATOR_SESSION_PROVIDERS[input.provider];

    // Step 1 — Registry guard: provider mechanism not yet verified
    if (!providerEntry || providerEntry.connectionMechanism === 'none_verified') {
      throw {
        statusCode: 501,
        errorCode: 'provider_mechanism_not_verified',
        message: 'Provider mechanism pending verification; schema and UI are ready and will light up when the registry flips.',
        nextSteps: 'Provider mechanism pending verification; schema and UI are ready and will light up when the registry flips.',
      };
    }

    // Step 2 — Disclosure-requirement gate
    if (
      providerEntry.planDetectionMechanism === 'self_declaration' &&
      !input.disclosureAcceptance
    ) {
      throw { statusCode: 422, errorCode: 'disclosure_required' };
    }

    // Step 3 — V1 mock provider handshake
    // NOTE: This code path is unreachable in V1 because step 1 always throws for
    // 'none_verified'. It is written here for completeness so that when the registry
    // flips to a verified mechanism this stub is already in place.
    const mockToken = {
      access: 'placeholder-access',
      refresh: 'placeholder-refresh',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    };

    // Step 4 — Derive initial state
    const planTier =
      (input.disclosureAcceptance?.acceptanceTier as AiSubscriptionConnection['planTier']) ??
      'unknown';

    const initialState = deriveInitialState(
      providerEntry.planDetectionMechanism,
      planTier,
      Boolean(input.disclosureAcceptance),
    );

    // Defence-in-depth: if the registry mechanism is verified in the future,
    // this assertion ensures token encryption is wired before this path activates.
    // Cast to the full union to keep the guard live after TypeScript narrows out
    // 'none_verified' in the step-1 control-flow check above.
    if ((providerEntry.connectionMechanism as string) !== 'none_verified') {
      throw { statusCode: 500, errorCode: 'token_encryption_required', message: 'Token encryption must be wired before activating a verified connection mechanism.' };
    }

    const db = getOrgScopedDb('operatorSessionService.connect');

    try {
      // Step 5 — Transactional writes (all inside the caller's withOrgTx context)

      // Branch B: Insert consent first (connectionId is NULL; back-filled after INSERT)
      let consentId: string | null = null;
      if (input.disclosureAcceptance) {
        const consent = await operatorSessionConsentService.recordConsent({
          organisationId: input.organisationId,
          subaccountId: input.subaccountId,
          userId: input.userId,
          connectionId: null,
          planTier,
          disclosureVersion: input.disclosureAcceptance.disclosureVersion,
          disclosureTextSnapshot: buildDisclosureText(input.provider),
          consentTextSnapshot: input.disclosureAcceptance.consentText,
          actorUserId: input.userId,
        });
        await operatorSessionConsentService.recordEvent({
          consentId: consent.id,
          eventType: 'granted',
          actorUserId: input.userId,
        });
        consentId = consent.id;
      }

      // Insert the connection row
      const [connection] = await db
        .insert(integrationConnections)
        .values({
          organisationId: input.organisationId,
          subaccountId: input.subaccountId,
          ownerUserId: input.userId,
          providerType: input.provider as IntegrationConnection['providerType'],
          authType: 'operator_session',
          label: input.label,
          accessToken: mockToken.access,
          refreshToken: mockToken.refresh,
          tokenExpiresAt: mockToken.expiresAt,
          usabilityState: initialState.usabilityState,
          planTier,
          planVerificationStatus: initialState.planVerificationStatus,
          planVerifiedAt: null,
          consentRecordId: consentId,
          isDefault: false,
          configJson: {
            operator_session: {
              availabilityScope: 'all_agents',
              allowedAgentIds: null,
            },
          },
        })
        .returning();

      // Branch B: back-fill connectionId on consent row
      if (consentId) {
        await operatorSessionConsentService.backfillConnectionId({
          consentId,
          connectionId: connection.id,
        });
      }

      // Step 6 — Audit event
      await auditService.log({
        organisationId: input.organisationId,
        actorType: 'user',
        actorId: input.userId,
        action: 'operator_session.connected',
        entityType: 'integration_connection',
        entityId: connection.id,
        metadata: {
          provider: input.provider,
          planTier,
          usabilityState: initialState.usabilityState,
          planVerificationStatus: initialState.planVerificationStatus,
        },
      });

      return mapToAiSubscriptionConnection(connection);
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        const pgErr = err as { code?: string; constraint?: string };
        const constraintName = pgErr.constraint ?? '';
        if (constraintName.includes('provider_label')) {
          throw { statusCode: 409, errorCode: 'duplicate_subscription_label', message: 'A subscription with this label already exists.' };
        }
        throw { statusCode: 500, errorCode: 'unexpected_unique_violation', message: `Unexpected unique constraint violation: ${constraintName}` };
      }
      throw err;
    }
  },

  /**
   * Re-accept the current disclosure for an existing connection.
   *
   * Called when the connection is in connected_needs_consent (disclosure version bumped)
   * or connected_unverified (post-initial-connect with no prior acceptance).
   *
   * Must be called within an active withOrgTx context (opened by the `authenticate` middleware).
   */
  async reaccept(input: {
    organisationId: string;
    subaccountId: string;
    connectionId: string;
    actorUserId: string;
    disclosureAcceptance: {
      disclosureVersion: number;
      consentText: string;
      acceptanceTier: string;
    };
  }): Promise<{ consent: OperatorSessionConsent; newState: UsabilityState }> {
    const db = getOrgScopedDb('operatorSessionService.reaccept');

    // Load the existing connection — include subaccountId in WHERE to prevent
    // cross-tenant access (B1 tenant-isolation fix).
    const [connection] = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, input.connectionId),
          eq(integrationConnections.subaccountId, input.subaccountId),
          eq(integrationConnections.organisationId, input.organisationId),
          eq(integrationConnections.authType, 'operator_session'),
        ),
      )
      .limit(1);

    if (!connection) {
      throw { statusCode: 404, message: 'Connection not found.' };
    }

    if (!connection.consentRecordId) {
      throw {
        statusCode: 422,
        errorCode: 'no_prior_consent_use_connect',
        message: 'This connection has no prior consent record. Use the connect flow for initial setup.',
      };
    }

    const oldConsentId = connection.consentRecordId;
    const currentUsabilityState = (connection.usabilityState as UsabilityState) ?? 'connected_unverified';
    const planTier = (input.disclosureAcceptance.acceptanceTier as AiSubscriptionConnection['planTier']) ?? 'unknown';

    // Insert new consent (connectionId set at INSERT time — no back-fill needed)
    const newConsent = await operatorSessionConsentService.recordConsent({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      userId: connection.ownerUserId ?? input.actorUserId,
      connectionId: input.connectionId,
      planTier,
      disclosureVersion: input.disclosureAcceptance.disclosureVersion,
      disclosureTextSnapshot: buildDisclosureText(connection.providerType),
      consentTextSnapshot: input.disclosureAcceptance.consentText,
      actorUserId: input.actorUserId,
    });

    // Record granted event on new consent
    await operatorSessionConsentService.recordEvent({
      consentId: newConsent.id,
      eventType: 'granted',
      actorUserId: input.actorUserId,
    });

    // Record superseded event on old consent
    await operatorSessionConsentService.recordEvent({
      consentId: oldConsentId,
      eventType: 'superseded',
      actorUserId: input.actorUserId,
      supersededByConsentId: newConsent.id,
    });

    // Update integration_connections.consentRecordId pointer.
    // Defence-in-depth: explicit organisationId + subaccountId + authType
    // filter mirrors the SELECT above, satisfying DEVELOPMENT_GUIDELINES §1
    // ("filter by organisationId in application code, even with RLS").
    await db
      .update(integrationConnections)
      .set({ consentRecordId: newConsent.id, updatedAt: new Date() })
      .where(
        and(
          eq(integrationConnections.id, input.connectionId),
          eq(integrationConnections.organisationId, input.organisationId),
          eq(integrationConnections.subaccountId, input.subaccountId),
          eq(integrationConnections.authType, 'operator_session'),
        ),
      );

    // Transition state to connected_usable (skip if already in target state to
    // avoid InvalidStateTransitionError on connected_usable → connected_usable)
    if (currentUsabilityState !== 'connected_usable') {
      await operatorSessionLifecycleService.transition({
        connectionId: input.connectionId,
        organisationId: input.organisationId,
        from: currentUsabilityState,
        to: 'connected_usable',
        cause: 'user_reaccepted',
        actorUserId: input.actorUserId,
      });
    }
    const newState: UsabilityState = 'connected_usable';

    return { consent: newConsent, newState };
  },

  /**
   * List operator session connections that the given agent is allowed to use.
   *
   * Performs an on-read disclosure-version-bump check; if any connection's
   * disclosure is stale it is transitioned to connected_needs_consent before
   * being returned.
   *
   * Result is ordered: Default first, then non-default by label ASC NULLS LAST,
   * then by id ASC as a tiebreaker.
   *
   * Must be called within an active withOrgTx context (opened by the `authenticate` middleware).
   */
  async listAllowedSubscriptionsForAgent(input: {
    organisationId: string;
    subaccountId: string;
    agentId: string;
  }): Promise<AiSubscriptionConnection[]> {
    const db = getOrgScopedDb('operatorSessionService.listAllowedSubscriptionsForAgent');

    const rows = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.subaccountId, input.subaccountId),
          eq(integrationConnections.authType, 'operator_session'),
          eq(integrationConnections.connectionStatus, 'active'),
          sql`(
            ${integrationConnections.configJson} -> 'operator_session' ->> 'availabilityScope' = 'all_agents'
            OR ${integrationConnections.configJson} -> 'operator_session' -> 'allowedAgentIds' ? ${input.agentId}::text
          )`,
        ),
      )
      .orderBy(
        // Default first (true sorts before false in DESC; use DESC for isDefault)
        sql`${integrationConnections.isDefault} DESC`,
        asc(integrationConnections.label),
        asc(integrationConnections.id),
      );

    // On-read disclosure-version check — transition stale rows before returning
    for (const row of rows) {
      await operatorSessionService.detectAndTransitionStaleDisclosure({
        organisationId: input.organisationId,
        connectionId: row.id,
      });
    }

    // Re-read rows after any transitions to get current usabilityState values
    const freshRows = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.subaccountId, input.subaccountId),
          eq(integrationConnections.authType, 'operator_session'),
          eq(integrationConnections.connectionStatus, 'active'),
          sql`(
            ${integrationConnections.configJson} -> 'operator_session' ->> 'availabilityScope' = 'all_agents'
            OR ${integrationConnections.configJson} -> 'operator_session' -> 'allowedAgentIds' ? ${input.agentId}::text
          )`,
        ),
      )
      .orderBy(
        sql`${integrationConnections.isDefault} DESC`,
        asc(integrationConnections.label),
        asc(integrationConnections.id),
      );

    return freshRows.map(mapToAiSubscriptionConnection);
  },

  /**
   * List ALL operator session connections for a subaccount (no agent filter).
   *
   * Returns every active operator_session row for the subaccount, regardless of
   * availabilityScope. Runs on-read disclosure check for each row.
   *
   * Result is ordered: Default first, then label ASC NULLS LAST, then id ASC.
   *
   * Must be called within an active withOrgTx context (opened by the `authenticate` middleware).
   */
  async listForSubaccount(input: {
    organisationId: string;
    subaccountId: string;
  }): Promise<AiSubscriptionConnection[]> {
    const db = getOrgScopedDb('operatorSessionService.listForSubaccount');

    const rows = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.subaccountId, input.subaccountId),
          eq(integrationConnections.authType, 'operator_session'),
          eq(integrationConnections.connectionStatus, 'active'),
        ),
      )
      .orderBy(
        sql`${integrationConnections.isDefault} DESC`,
        asc(integrationConnections.label),
        asc(integrationConnections.id),
      );

    // On-read disclosure-version check — transition stale rows before returning
    for (const row of rows) {
      await operatorSessionService.detectAndTransitionStaleDisclosure({
        organisationId: input.organisationId,
        connectionId: row.id,
      });
    }

    // Re-read rows after any transitions to get current usabilityState values
    const freshRows = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.subaccountId, input.subaccountId),
          eq(integrationConnections.authType, 'operator_session'),
          eq(integrationConnections.connectionStatus, 'active'),
        ),
      )
      .orderBy(
        sql`${integrationConnections.isDefault} DESC`,
        asc(integrationConnections.label),
        asc(integrationConnections.id),
      );

    return freshRows.map(mapToAiSubscriptionConnection);
  },

  /**
   * On-read disclosure-version bump detection.
   *
   * If the connection's recorded disclosure version is older than
   * OPERATOR_SESSION_DISCLOSURE_VERSION, transitions the connection to
   * connected_needs_consent (from connected_usable only — other states are
   * already in a pending/terminal condition).
   *
   * Returns { transitioned: false } if the connection is already in a
   * non-usable state or if the disclosure is current.
   *
   * Must be called within an active withOrgTx context (opened by the `authenticate` middleware).
   */
  async detectAndTransitionStaleDisclosure(input: {
    organisationId: string;
    connectionId: string;
  }): Promise<{ transitioned: boolean }> {
    const db = getOrgScopedDb('operatorSessionService.detectAndTransitionStaleDisclosure');

    // Load connection to get consentRecordId and current state.
    // Defence-in-depth: pin organisationId + authType per DEVELOPMENT_GUIDELINES §1.
    const [connection] = await db
      .select({
        consentRecordId: integrationConnections.consentRecordId,
        usabilityState: integrationConnections.usabilityState,
      })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, input.connectionId),
          eq(integrationConnections.organisationId, input.organisationId),
          eq(integrationConnections.authType, 'operator_session'),
        ),
      )
      .limit(1);

    if (!connection || !connection.consentRecordId || connection.usabilityState !== 'connected_usable') {
      // Not in a state where disclosure bump matters
      return { transitioned: false };
    }

    const { needsReaccept } = await operatorSessionConsentService.checkConsentStatus(
      input.connectionId,
    );

    if (!needsReaccept) {
      return { transitioned: false };
    }

    return operatorSessionLifecycleService.transition({
      connectionId: input.connectionId,
      organisationId: input.organisationId,
      from: 'connected_usable',
      to: 'connected_needs_consent',
      cause: 'disclosure_bumped',
      actorUserId: null,
    });
  },

  async handleFileWriteToolCall(input: {
    agentRunId: string;
    organisationId: string;
    subaccountId: string;
    ownerUserId: string | null;
    path: string;
    content: Buffer;
  }): Promise<void> {
    await operatorSandboxFileEventBridge.handleToolCallEvent({
      ...input,
      emittedBy: 'tool_call',
    });
  },

  async getRunProgress(params: { operatorRunId: string; subaccountId: string; orgId: string }) {
    const { operatorRunId, subaccountId } = params;
    const scopedDb = getOrgScopedDb('operatorSessionService.getRunProgress');
    const [found] = await scopedDb
      .select({
        id: operatorRuns.id,
        chainSeq: operatorRuns.chainSeq,
        status: operatorRuns.status,
        lastProgressAt: operatorRuns.lastProgressAt,
        stepCount: operatorRuns.stepCount,
        failureReason: operatorRuns.failureReason,
      })
      .from(operatorRuns)
      .where(and(eq(operatorRuns.id, operatorRunId), eq(operatorRuns.subaccountId, subaccountId)))
      .limit(1);
    return found ?? null;
  },
};
