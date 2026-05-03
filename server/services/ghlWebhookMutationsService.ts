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
import {
  canonicalSubaccountMutations,
  assertCanonicalUniqueness,
  type ExternalUserKind,
  type NewCanonicalSubaccountMutation,
} from '../db/schema/clientPulseCanonicalTables.js';
import { connectorConfigs, connectorLocationTokens } from '../db/schema/index.js';
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
    await db
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
 */
export async function dispatchWebhookSideEffects(
  event: WebhookEnvelopeMinimal & { webhookId: string; companyId: string },
): Promise<{ statusCode: 200 | 503 }> {
  const eventClass = classifyWebhookEvent(event);

  if (eventClass === 'install_company') {
    logger.info('ghl.webhook.install_company', {
      event: 'ghl.webhook.install_company',
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
    return { statusCode: 200 };
  }

  if (eventClass === 'install_location_ignored') {
    logger.info('ghl.webhook.install_location_ignored', {
      event: 'ghl.webhook.install_location_ignored',
      orgId: null, companyId: event.companyId, locationId: event.locationId ?? null,
      result: 'success', error: null,
    });
    return { statusCode: 200 };
  }

  if (eventClass === 'uninstall') {
    logger.info('ghl.webhook.uninstall', {
      event: 'ghl.webhook.uninstall',
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
      logger.warn('ghl.webhook.uninstall.revoke_failed', { companyId: event.companyId, error: String(err) });
    }

    await db
      .update(connectorConfigs)
      .set({ status: 'disconnected', disconnectedAt: new Date(), updatedAt: new Date() })
      .where(eq(connectorConfigs.id, connection.id));

    await db
      .update(connectorLocationTokens)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(connectorLocationTokens.connectorConfigId, connection.id),
          isNull(connectorLocationTokens.deletedAt),
        ),
      );

    logger.info('ghl.webhook.uninstall.complete', {
      event: 'ghl.webhook.uninstall',
      orgId: connection.organisationId, companyId: event.companyId, locationId: null,
      result: 'success', error: null,
    });
    return { statusCode: 200 };
  }

  if (eventClass === 'location_create') {
    logger.info('ghl.webhook.location_create', {
      event: 'ghl.webhook.location_create',
      orgId: null, companyId: event.companyId, locationId: event.locationId ?? null,
      result: 'success', error: null,
    });
    const connection = await connectorConfigService.findAgencyConnectionByCompanyId(event.companyId);
    if (!connection || !event.locationId) return { statusCode: 200 };

    const locId = event.locationId;
    const locName = (event as unknown as Record<string, unknown>).name as string | undefined ?? locId;
    const { generateSubaccountSlug } = await import('./ghlAgencyOauthServicePure.js');
    const baseSlug = generateSubaccountSlug(locName, locId);

    let result: { id: string; inserted: boolean } | undefined;
    for (const slug of [baseSlug, `${baseSlug}-${locId.slice(-4)}`]) {
      try {
        const [row] = await db.execute<{ id: string; inserted: boolean }>(sql`
          INSERT INTO subaccounts (id, organisation_id, name, slug, status, connector_config_id, external_id, created_at, updated_at)
          VALUES (gen_random_uuid(), ${connection.organisationId}, ${locName}, ${slug}, 'active', ${connection.id}, ${locId}, now(), now())
          ON CONFLICT (connector_config_id, external_id)
            WHERE deleted_at IS NULL AND connector_config_id IS NOT NULL AND external_id IS NOT NULL
          DO UPDATE SET name = EXCLUDED.name, updated_at = now()
          RETURNING id, (xmax = 0) AS inserted
        `);
        result = row;
        break;
      } catch (err) {
        const pg = err as { code?: string; constraint?: string };
        if (pg.code === '23505' && pg.constraint?.includes('slug')) continue;
        throw err;
      }
    }

    if (result?.inserted) {
      try {
        const { subaccountOnboardingService } = await import('./subaccountOnboardingService.js');
        await subaccountOnboardingService.autoStartOwedOnboardingWorkflows({
          organisationId: connection.organisationId,
          subaccountId: result.id,
          startedByUserId: 'system',
        });
      } catch { /* non-fatal */ }
    }

    return { statusCode: 200 };
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

  const rows = await db
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
