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

import { and, eq, gte } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  canonicalSubaccountMutations,
  assertCanonicalUniqueness,
  type ExternalUserKind,
  type NewCanonicalSubaccountMutation,
} from '../db/schema/clientPulseCanonicalTables.js';
import { orgConfigService } from './orgConfigService.js';
import {
  normaliseGhlMutation,
  classifyUserKindByVolume,
  type GhlEventEnvelope,
} from './ghlWebhookMutationsPure.js';

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
