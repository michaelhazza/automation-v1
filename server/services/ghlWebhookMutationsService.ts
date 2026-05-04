/**
 * Webhook-to-mutation writer. Thin wrapper around `ghlWebhookMutationsPure`
 * that (a) resolves `external_user_kind` via the outlier-volume heuristic
 * from §2.0b and (b) upserts the row into `canonical_subaccount_mutations`
 * with the onConflictDoNothing pattern (webhook dedupe is already handled
 * upstream by `webhookDedupeStore`).
 *
 * Import target: `server/routes/webhooks/ghlWebhook.ts` — one call per
 * inbound event after canonical upserts have run.
 */

import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import {
  canonicalSubaccountMutations,
  assertCanonicalUniqueness,
  type ExternalUserKind,
  type NewCanonicalSubaccountMutation,
} from '../db/schema/clientPulseCanonicalTables.js';
import { connectorConfigs, connectorLocationTokens, subaccounts } from '../db/schema/index.js';
import { orgConfigService } from './orgConfigService.js';
import { connectorConfigService } from './connectorConfigService.js';
import { connectionTokenService } from './connectionTokenService.js';
import { logger } from '../lib/logger.js';
import {
  normaliseGhlMutation,
  classifyUserKindByVolume,
  classifyWebhookEvent,
  type GhlEventEnvelope,
  type WebhookEnvelopeMinimal,
} from './ghlWebhookMutationsPure.js';

export { classifyWebhookEvent } from './ghlWebhookMutationsPure.js';

export interface RecordGhlMutationInput {
  organisationId: string;
  subaccountId: string | null;
  event: GhlEventEnvelope;
}

export interface RecordGhlMutationResult {
  status: 'written' | 'skipped_no_subaccount' | 'skipped_no_match' | 'error';
  mutationType?: string;
  error?: string;
}

/**
 * Entry point called by the webhook router. Safe to call on every GHL event —
 * events that don't produce a mutation return `skipped_no_match` and no row
 * is written. Events on a canonical_account that isn't yet mapped to a
 * subaccount return `skipped_no_subaccount` (a logged warning; happens when
 * a webhook fires before the account-to-subaccount mapping is materialised).
 */
export async function recordGhlMutation(input: RecordGhlMutationInput): Promise<RecordGhlMutationResult> {
  const normalised = normaliseGhlMutation(input.event);
  if (!normalised) return { status: 'skipped_no_match' };
  if (!input.subaccountId) return { status: 'skipped_no_subaccount', mutationType: normalised.mutationType };

  assertCanonicalUniqueness('canonical_subaccount_mutations', { subaccountId: input.subaccountId });

  const externalUserKind = await resolveExternalUserKind({
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    externalUserId: normalised.externalUserId,
  });

  const row: NewCanonicalSubaccountMutation = {
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    providerType: 'ghl',
    occurredAt: normalised.occurredAt,
    mutationType: normalised.mutationType,
    sourceEntity: normalised.sourceEntity,
    externalUserId: normalised.externalUserId,
    externalUserKind,
    externalId: normalised.externalId,
    evidence: normalised.evidence,
  };

  try {
    // canonical_subaccount_mutations has FORCE ROW LEVEL SECURITY. recordGhlMutation
    // is called from the unauthenticated GHL webhook route which has no
    // app.organisation_id GUC set on the pooled `db` handle, so the WITH CHECK
    // clause would reject every insert. Use withAdminConnection + SET LOCAL ROLE
    // admin_role to bypass RLS — application-layer scoping is preserved by the
    // organisationId/subaccountId columns explicitly written into the row, and
    // the upstream caller (ghlWebhook route) has already validated the org via
    // findAgencyConnectionByCompanyId or the connector-configs service lookup.
    await withAdminConnection(
      { source: 'ghl_webhook_record_mutation', skipAudit: true },
      async (adminDb) => {
        await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
        await adminDb
          .insert(canonicalSubaccountMutations)
          .values(row)
          .onConflictDoNothing({
            target: [
              canonicalSubaccountMutations.organisationId,
              canonicalSubaccountMutations.subaccountId,
              canonicalSubaccountMutations.providerType,
              canonicalSubaccountMutations.externalId,
            ],
          });
      },
    );
    return { status: 'written', mutationType: normalised.mutationType };
  } catch (err) {
    return {
      status: 'error',
      mutationType: normalised.mutationType,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Lifecycle side-effect dispatcher (§5.4) ─────────────────────────────

/**
 * Side-effect handler for lifecycle webhook events.
 * Call this BEFORE writing the dedupe row (per §5.4 hard invariant).
 * If this returns 503 or throws, the route must respond 503 and NOT write the dedupe row.
 * Only on 200: write the dedupe row, then respond 200.
 *
 * On 200, the optional `organisationId` and `subaccountId` fields are populated
 * when the side-effect path could resolve them. The route uses these to write
 * the canonical mutation row (Staff Activity Pulse §2.0b). For agency-level
 * lifecycle events (INSTALL/UNINSTALL), only `organisationId` is returned —
 * `subaccountId` remains undefined and the mutation writer will record a
 * `skipped_no_subaccount` outcome (see follow-up in tasks/todo.md).
 */
export interface DispatchResult {
  statusCode: 200 | 503;
  organisationId?: string;
  subaccountId?: string;
}

export async function dispatchWebhookSideEffects(
  event: WebhookEnvelopeMinimal & { webhookId: string; companyId: string },
): Promise<DispatchResult> {
  const eventClass = classifyWebhookEvent(event);

  if (eventClass === 'install_company') {
    logger.info('ghl.webhook.install_company', {
      event: 'ghl.webhook.install_company',
      provider: 'ghl',
      orgId: null, companyId: event.companyId, locationId: null,
      result: 'success', error: null,
    });
    const connection = await connectorConfigService.findAgencyConnectionByCompanyId(event.companyId);
    if (!connection) return { statusCode: 200 };
    try {
      const { autoEnrolAgencyLocations } = await import('./ghlAgencyOauthService.js');
      await autoEnrolAgencyLocations(connection.organisationId, connection, event.webhookId);
    } catch (err) {
      const e = err as { code?: string; statusCode?: number };
      if (e.code === 'AGENCY_RATE_LIMITED' || (e.statusCode !== undefined && e.statusCode >= 500)) {
        return { statusCode: 503 };
      }
    }
    return { statusCode: 200, organisationId: connection.organisationId };
  }

  if (eventClass === 'install_location_ignored') {
    logger.info('ghl.webhook.install_location_ignored', {
      event: 'ghl.webhook.install_location_ignored',
      provider: 'ghl',
      orgId: null, companyId: event.companyId, locationId: event.locationId ?? null,
      result: 'success', error: null,
    });
    return { statusCode: 200 };
  }

  if (eventClass === 'uninstall') {
    logger.info('ghl.webhook.uninstall', {
      event: 'ghl.webhook.uninstall',
      provider: 'ghl',
      orgId: null, companyId: event.companyId, locationId: null,
      result: 'success', error: null,
    });
    const connection = await connectorConfigService.findAgencyConnectionByCompanyId(event.companyId);
    if (!connection) return { statusCode: 200 };

    // Decrypt the stored agency token before sending it as a Bearer credential —
    // tokens at rest in `connector_configs.access_token` are encrypted via
    // `connectionTokenService.encryptToken` (see upsertAgencyConnection).
    try {
      const agencyToken = connection.accessToken
        ? connectionTokenService.decryptToken(connection.accessToken)
        : '';
      await fetch('https://services.leadconnectorhq.com/oauth/revoke', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agencyToken}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logger.warn('ghl.webhook.uninstall.revoke_failed', {
        event: 'ghl.webhook.uninstall.revoke_failed',
        provider: 'ghl',
        companyId: event.companyId,
        error: String(err),
      });
    }

    // FORCE RLS on connector_configs and connector_location_tokens — the
    // unauthenticated webhook route has no app.organisation_id set on the
    // pooled `db` handle. Open an org-scoped transaction with set_config so
    // both UPDATEs land. connection.organisationId is already validated via
    // the upstream findAgencyConnectionByCompanyId lookup.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.organisation_id', ${connection.organisationId}, true)`);
      await tx
        .update(connectorConfigs)
        .set({ status: 'disconnected', disconnectedAt: new Date(), updatedAt: new Date() })
        .where(eq(connectorConfigs.id, connection.id));

      await tx
        .update(connectorLocationTokens)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(connectorLocationTokens.connectorConfigId, connection.id),
            isNull(connectorLocationTokens.deletedAt),
          ),
        );
    });

    logger.info('ghl.webhook.uninstall.complete', {
      event: 'ghl.webhook.uninstall',
      provider: 'ghl',
      orgId: connection.organisationId, companyId: event.companyId, locationId: null,
      result: 'success', error: null,
    });
    return { statusCode: 200, organisationId: connection.organisationId };
  }

  if (eventClass === 'location_create') {
    logger.info('ghl.webhook.location_create', {
      event: 'ghl.webhook.location_create',
      provider: 'ghl',
      orgId: null, companyId: event.companyId, locationId: event.locationId ?? null,
      result: 'success', error: null,
    });
    const connection = await connectorConfigService.findAgencyConnectionByCompanyId(event.companyId);
    if (!connection || !event.locationId) return { statusCode: 200 };

    const locId = event.locationId;
    const locName = (event as unknown as Record<string, unknown>).name as string | undefined ?? locId;
    const { generateSubaccountSlug } = await import('./ghlAgencyOauthServicePure.js');
    const baseSlug = generateSubaccountSlug(locName, locId);

    // FORCE RLS on subaccounts — wrap each slug attempt in its OWN org-scoped
    // transaction so a 23505 slug-collision on the first attempt aborts only
    // that tx, not the whole enrolment. (A single shared tx would leave Postgres
    // in "current transaction is aborted" state, blocking the fallback retry.)
    // The INSERT uses tx.execute(...) on the same connection where set_config
    // ran, so the GUC applies. Note: any subsequent service call using the
    // module-level `db` handle does NOT inherit this GUC (different pool
    // connections); see the autoStart comment below. Mirrors the per-row tx
    // pattern in ghlAgencyOauthService.autoEnrolAgencyLocations.
    let result: { id: string; inserted: boolean } | undefined;
    for (const slug of [baseSlug, `${baseSlug}-${locId.slice(-4)}`]) {
      try {
        result = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.organisation_id', ${connection.organisationId}, true)`);
          const rows = await tx.execute<{ id: string; inserted: boolean }>(sql`
            INSERT INTO subaccounts (id, organisation_id, name, slug, status, connector_config_id, external_id, created_at, updated_at)
            VALUES (gen_random_uuid(), ${connection.organisationId}, ${locName}, ${slug}, 'active', ${connection.id}, ${locId}, now(), now())
            ON CONFLICT (connector_config_id, external_id)
              WHERE deleted_at IS NULL AND connector_config_id IS NOT NULL AND external_id IS NOT NULL
            DO UPDATE SET name = EXCLUDED.name, updated_at = now()
            RETURNING id, (xmax = 0) AS inserted
          `);
          return rows[0];
        });
        break;
      } catch (err) {
        const pg = err as { code?: string; constraint?: string };
        if (pg.code === '23505' && pg.constraint?.includes('slug')) continue;
        throw err;
      }
    }

    if (result?.inserted) {
      // D-P0-1: enqueue via pg-boss instead of inline sync call. The GUC
      // propagation problem (KNOWN-BROKEN comment removed) is resolved because
      // the worker runs with its own admin-bypass DB access, decoupled from
      // this unauthenticated request path.
      try {
        const { enqueueGhlOnboarding } = await import('../jobs/ghlAutoStartOnboardingJob.js');
        await enqueueGhlOnboarding({
          organisationId: connection.organisationId,
          subaccountId: result.id,
        });
      } catch { /* non-fatal — onboarding enqueue failure logged by enqueueGhlOnboarding */ }
    }

    return {
      statusCode: 200,
      organisationId: connection.organisationId,
      subaccountId: result?.id,
    };
  }

  if (eventClass === 'location_update') {
    // Per spec §5.4 LocationUpdate: existing canonical-mutation row is sufficient;
    // no new side effect required (subaccount metadata refresh happens via the
    // next polling tick). The ONLY work here is to surface enough context to
    // the route's recordGhlMutation call so the `location_updated` row is
    // actually written. Without this case, dispatch falls through to the
    // default { statusCode: 200 } and the mutation row is silently lost.
    logger.info('ghl.webhook.location_update', {
      event: 'ghl.webhook.location_update',
      provider: 'ghl',
      orgId: null, companyId: event.companyId, locationId: event.locationId ?? null,
      result: 'success', error: null,
    });
    const connection = await connectorConfigService.findAgencyConnectionByCompanyId(event.companyId);
    if (!connection || !event.locationId) return { statusCode: 200 };

    // Look up the subaccount mapped to this location. subaccounts has FORCE RLS;
    // unauthenticated webhook context has no app.organisation_id GUC, so use
    // admin bypass — companyId-scoped via the resolved connection above.
    const locId = event.locationId;
    const sub = await withAdminConnection(
      { source: 'ghl_webhook_location_update_lookup', skipAudit: true },
      async (adminDb) => {
        await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
        const [row] = await adminDb
          .select({ id: subaccounts.id })
          .from(subaccounts)
          .where(
            and(
              eq(subaccounts.organisationId, connection.organisationId),
              eq(subaccounts.connectorConfigId, connection.id),
              eq(subaccounts.externalId, locId),
              isNull(subaccounts.deletedAt),
            ),
          )
          .limit(1);
        return row ?? null;
      },
    );

    return {
      statusCode: 200,
      organisationId: connection.organisationId,
      subaccountId: sub?.id,
    };
  }

  return { statusCode: 200 };
}

// ── Internal: outlier-volume classifier (§2.0b) ─────────────────────────

interface ResolveUserKindInput {
  organisationId: string;
  subaccountId: string;
  externalUserId: string | null;
}

async function resolveExternalUserKind(input: ResolveUserKindInput): Promise<ExternalUserKind> {
  if (!input.externalUserId) return 'unknown';

  const config = await orgConfigService.getStaffActivityDefinition(input.organisationId);
  const threshold = config.automationUserResolution?.threshold ?? 0.6;

  // Lookback: use the LONGEST configured window so the heuristic is stable
  // for infrequent contributors. Matches the spec intuition that "automation
  // vs human" is a behavioural fingerprint, not a short-term property.
  const lookbackDays = Math.max(...(config.lookbackWindowsDays ?? [30]));
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // canonical_subaccount_mutations has FORCE RLS. Reading from an unauthenticated
  // webhook context returns zero rows on the pooled `db` handle (no app.organisation_id
  // set), which would silently mis-classify every user as 'unknown'. Bypass via
  // admin_role; the explicit organisationId + subaccountId equality filters preserve
  // application-layer scoping.
  const rows = await withAdminConnection(
    { source: 'ghl_webhook_resolve_user_kind', skipAudit: true },
    async (adminDb) => {
      await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
      return adminDb
        .select({
          userId: canonicalSubaccountMutations.externalUserId,
        })
        .from(canonicalSubaccountMutations)
        .where(
          and(
            eq(canonicalSubaccountMutations.organisationId, input.organisationId),
            eq(canonicalSubaccountMutations.subaccountId, input.subaccountId),
            gte(canonicalSubaccountMutations.occurredAt, since),
          ),
        );
    },
  );

  const userCounts = new Map<string, number>();
  let totalCount = 0;
  for (const row of rows) {
    if (!row.userId) continue;
    userCounts.set(row.userId, (userCounts.get(row.userId) ?? 0) + 1);
    totalCount += 1;
  }

  return classifyUserKindByVolume({
    userId: input.externalUserId,
    userCounts,
    totalCount,
    threshold,
  });
}
