import { createHash } from 'crypto';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { SkillExecutionContext } from '../../services/skillExecutor.js';
import { db } from '../../db/index.js';
import {
  featureRequests,
  organisations,
  subaccounts,
  users,
  type FeatureRequestCategory,
} from '../../db/schema/index.js';
import {
  loadIntegrationReference,
  normalizeCapabilitySlugs,
  type CapabilityKind,
} from '../../services/integrationReferenceService.js';
import {
  dispatchFeatureRequestNotifications,
  type NotificationResult,
} from '../../services/featureRequestNotificationService.js';

// ---------------------------------------------------------------------------
// request_feature
//
// Write a feature_requests row and fire best-effort outbound notifications
// (Slack / email / Synthetos-internal task). Enforces lightweight per-org
// dedupe over a 30-day window keyed on canonical capability slugs.
//
// See docs/orchestrator-capability-routing-spec.md §5.3, §5.3.1, §5.4.
// ---------------------------------------------------------------------------

const DEDUPE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface RawCapability {
  kind: CapabilityKind;
  slug: string;
}

export interface RequestFeatureInput {
  category: FeatureRequestCategory;
  summary: string;
  user_intent: string;
  required_capabilities: RawCapability[];
  missing_capabilities: RawCapability[];
  orchestrator_reasoning?: string;
  source_task_id?: string;
  orgId: string;
  subaccountId?: string;
  requested_by_user_id: string;
}

export interface RequestFeatureOutput {
  success: true;
  feature_request_id: string;
  deduped: boolean;
  notification_result: NotificationResult;
}

function computeDedupeHash(category: string, canonicalCapabilities: RawCapability[]): string {
  const slugs = canonicalCapabilities
    .map((c) => `${c.kind}:${c.slug}`)
    .sort();
  const payload = `${category}|${slugs.join(',')}`;
  return createHash('sha256').update(payload).digest('hex');
}

export async function executeRequestFeature(
  input: Record<string, unknown>,
  context: SkillExecutionContext,
): Promise<RequestFeatureOutput | { success: false; error: string }> {
  const typed = input as RequestFeatureInput;

  if (!typed.category || !typed.summary || !typed.user_intent || !typed.requested_by_user_id) {
    return { success: false, error: 'category, summary, user_intent, and requested_by_user_id are required' };
  }
  const orgId = typed.orgId ?? context.organisationId;
  if (orgId !== context.organisationId) {
    return { success: false, error: 'Cannot file feature requests for an org other than the caller' };
  }

  // 1. Normalise capability slugs against the taxonomy before hashing, so
  //    aliases collapse to the same canonical form (spec §5.4).
  const snapshot = await loadIntegrationReference();
  const required = Array.isArray(typed.required_capabilities) ? typed.required_capabilities : [];
  const missing = Array.isArray(typed.missing_capabilities) ? typed.missing_capabilities : [];

  const normRequired = normalizeCapabilitySlugs(required, snapshot).map((n) => ({ kind: n.kind, slug: n.canonical_slug }));
  const normMissing = normalizeCapabilitySlugs(missing, snapshot).map((n) => ({ kind: n.kind, slug: n.canonical_slug }));

  // Dedupe key uses missing capabilities (the thing the user is actually
  // asking for that the platform does not have) — not the full required
  // list. Two users asking for the same missing capability should collapse.
  const dedupeHash = computeDedupeHash(typed.category, normMissing.length > 0 ? normMissing : normRequired);

  // 2. Dedupe lookup + insert — wrapped in a transaction to prevent concurrent
  //    orchestrator runs from inserting duplicate rows for the same request.
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);

  const dedupeResult = await db.transaction(async (tx) => {
    // Acquire a transaction-scoped advisory lock keyed on the dedupe hash to
    // serialise concurrent orchestrator runs filing the same request. The lock
    // is released automatically when the transaction commits/rolls back.
    const lockId = parseInt(createHash('md5').update(orgId + dedupeHash).digest('hex').slice(0, 15), 16);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockId})`);

    const [existing] = await tx
      .select()
      .from(featureRequests)
      .where(and(
        eq(featureRequests.organisationId, orgId),
        eq(featureRequests.dedupeHash, dedupeHash),
        eq(featureRequests.category, typed.category),
        gte(featureRequests.createdAt, since),
        isNull(featureRequests.deletedAt),
      ))
      .orderBy(desc(featureRequests.createdAt))
      .limit(1);

    if (existing) {
      // Increment the dedupe group count and bump updatedAt. No new row, no
      // outbound notifications fire.
      await tx
        .update(featureRequests)
        .set({
          dedupeGroupCount: existing.dedupeGroupCount + 1,
          updatedAt: new Date(),
        })
        .where(eq(featureRequests.id, existing.id));

      return { deduped: true as const, feature_request_id: existing.id };
    }

    // 3. Insert the new feature_requests row.
    const [inserted] = await tx
      .insert(featureRequests)
      .values({
        organisationId: orgId,
        subaccountId: typed.subaccountId ?? null,
        requestedByUserId: typed.requested_by_user_id,
        requestedByAgentId: context.agentId ?? null,
        sourceTaskId: typed.source_task_id ?? null,
        category: typed.category,
        status: 'open',
        dedupeHash,
        dedupeGroupCount: 1,
        summary: typed.summary.slice(0, 200),
        userIntent: typed.user_intent,
        requiredCapabilities: normRequired,
        missingCapabilities: normMissing,
        orchestratorReasoning: typed.orchestrator_reasoning ?? null,
      })
      .returning();

    if (!inserted) {
      return { deduped: false as const, inserted: null };
    }
    return { deduped: false as const, inserted };
  });

  if (dedupeResult.deduped) {
    return {
      success: true,
      feature_request_id: dedupeResult.feature_request_id,
      deduped: true,
      notification_result: {
        slack: { status: 'skipped', detail: 'dedupe hit — no re-notification' },
        email: { status: 'skipped', detail: 'dedupe hit — no re-notification' },
        synthetos_task: { status: 'skipped', detail: 'dedupe hit — existing Synthetos task already exists' },
      },
    };
  }

  const inserted = dedupeResult.inserted;
  if (!inserted) {
    return { success: false, error: 'Failed to insert feature request row' };
  }

  // 4. Resolve attribution for notification body.
  let orgName = '<unknown>';
  try {
    const [orgRow] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, orgId));
    if (orgRow) orgName = orgRow.name;
  } catch { /* fall through with unknown */ }

  let subaccountName: string | null = null;
  if (typed.subaccountId) {
    try {
      const [saRow] = await db.select({ name: subaccounts.name }).from(subaccounts).where(eq(subaccounts.id, typed.subaccountId));
      if (saRow) subaccountName = saRow.name;
    } catch { /* leave null */ }
  }

  let userEmail = '<unknown>';
  let userDisplayName: string | null = null;
  try {
    const [uRow] = await db.select({ email: users.email, firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, typed.requested_by_user_id));
    if (uRow) {
      userEmail = uRow.email ?? '<unknown>';
      const displayParts = [uRow.firstName, uRow.lastName].filter(Boolean);
      userDisplayName = displayParts.length > 0 ? displayParts.join(' ') : null;
    }
  } catch { /* leave defaults */ }

  // 5. Fire notifications — best effort, do not roll back the row on failure.
  const notificationResult = await dispatchFeatureRequestNotifications(
    inserted,
    { orgName, subaccountName, userEmail, userDisplayName },
    context.agentId ?? null,
  );

  // 6. Record notification channels used (for audit).
  const channelsFired = Object.entries(notificationResult)
    .filter(([, r]) => r.status === 'sent' || r.status === 'created')
    .map(([k]) => k);
  await db
    .update(featureRequests)
    .set({
      notifiedAt: new Date(),
      notificationChannels: { channels: channelsFired, detail: notificationResult } as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(featureRequests.id, inserted.id));

  return {
    success: true,
    feature_request_id: inserted.id,
    deduped: false,
    notification_result: notificationResult,
  };
}
