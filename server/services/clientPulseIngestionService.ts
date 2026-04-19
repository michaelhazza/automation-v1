/**
 * ClientPulse ingestion service — writes one `client_pulse_signal_observations`
 * row per signal per sub-account per poll cycle, plus populates the canonical
 * fingerprint-bearing tables and `subaccount_tier_history`.
 *
 * Spec: tasks/clientpulse-ghl-gap-analysis.md §§2, 4.3, 22.
 * Phase 1 ship gate: for a test agency, after a poll cycle, observation rows
 * exist for all 8 signals across every sub-account.
 *
 * Eight signals (§2):
 *   1. staff_activity_pulse    — computed from canonical_subaccount_mutations
 *   2. funnel_count            — fetchFunnels().length
 *   3. calendar_quality        — ratio of calendars with team members (fetchCalendars+Users)
 *   4. contact_activity        — placeholder from contacts fetcher count
 *   5. integration_fingerprint — placeholder; real value from scan_integration_fingerprints skill
 *   6. subscription_tier       — fetchSubscription().tier
 *   7. ai_feature_usage        — placeholder from conversation providers fingerprints
 *   8. opportunity_pipeline    — placeholder from opportunities count
 *
 * Signals that require additional pipelines (staff_activity_pulse, integration_fingerprint,
 * ai_feature_usage) write observations with `availability='unavailable_other'` in Phase 1.
 * The composite skills that compute their real values land in Phase 2+.
 */

import { sql, eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  clientPulseSignalObservations,
  subaccountTierHistory,
  canonicalConversationProviders,
  canonicalTagDefinitions,
  canonicalContactSources,
  assertCanonicalUniqueness,
  type NewClientPulseSignalObservation,
} from '../db/schema/clientPulseCanonicalTables.js';
import { ghlClientPulseFetchers } from '../adapters/ghlAdapter.js';
import type { IntegrationConnection } from '../db/schema/index.js';
import {
  CLIENT_PULSE_SIGNAL_SLUGS,
  observationFromFunnels,
  observationFromCalendars,
  observationFromSubscription,
} from './clientPulseIngestionServicePure.js';

// Re-export Pure helpers so existing callers continue to import from this module.
export {
  CLIENT_PULSE_SIGNAL_SLUGS,
  observationFromFunnels,
  observationFromCalendars,
  observationFromSubscription,
} from './clientPulseIngestionServicePure.js';
export type { ClientPulseSignalSlug } from './clientPulseIngestionServicePure.js';

// ── Input shape ──────────────────────────────────────────────────────────

export interface ClientPulseIngestionInput {
  organisationId: string;
  subaccountId: string;
  connectorType: 'ghl';
  connection: IntegrationConnection;
  accountExternalId: string; // locationId
  connectorConfigId: string;
  sourceRunId?: string;
  contactCount: number;
  opportunityCount: number;
  conversationCount: number;
}

export interface ClientPulseIngestionResult {
  observationsWritten: number;
  errors: string[];
}

// ── Public entry ─────────────────────────────────────────────────────────

export async function ingestClientPulseSignalsForSubaccount(
  input: ClientPulseIngestionInput,
): Promise<ClientPulseIngestionResult> {
  const errors: string[] = [];
  const observations: NewClientPulseSignalObservation[] = [];
  const now = new Date();

  const base = {
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    connectorConfigId: input.connectorConfigId,
    observedAt: now,
    sourceRunId: input.sourceRunId,
  } satisfies Omit<NewClientPulseSignalObservation, 'signalSlug' | 'numericValue' | 'jsonPayload' | 'availability'>;

  // Signal 2 — funnel_count
  const funnelsResult = await ghlClientPulseFetchers.fetchFunnels(input.connection, input.accountExternalId);
  observations.push(observationFromFunnels(base, funnelsResult));

  // Signal 3 — calendar_quality
  const [calendarsResult, usersResult] = await Promise.all([
    ghlClientPulseFetchers.fetchCalendars(input.connection, input.accountExternalId),
    ghlClientPulseFetchers.fetchUsers(input.connection, input.accountExternalId),
  ]);
  observations.push(observationFromCalendars(base, calendarsResult, usersResult));

  // Signal 4 — contact_activity (lightweight derived from known counts — Phase 2 refines)
  observations.push({
    ...base,
    signalSlug: 'contact_activity',
    numericValue: input.contactCount,
    jsonPayload: { count: input.contactCount, source: 'poll_cycle' },
    availability: 'available',
  });

  // Signal 6 — subscription_tier
  const subResult = await ghlClientPulseFetchers.fetchSubscription(input.connection, input.accountExternalId);
  observations.push(observationFromSubscription(base, subResult));

  // Signal 8 — opportunity_pipeline (derived from opportunity count; Phase 2 refines)
  observations.push({
    ...base,
    signalSlug: 'opportunity_pipeline',
    numericValue: input.opportunityCount,
    jsonPayload: { openOpportunities: input.opportunityCount, source: 'poll_cycle' },
    availability: 'available',
  });

  // Placeholder signals for ship gate — real values computed by Phase 2+ skills.
  // Writing stubs keeps dashboard queries non-empty and satisfies the ship
  // gate ("rows for all eight signals across every sub-account").
  //
  // Every placeholder carries `phase: 'placeholder'` in jsonPayload so
  // dashboards + monitoring can distinguish a deliberately-skipped signal
  // (pending its Phase 2+ compute skill) from a genuine fetch failure. Real
  // `unavailable_other` observations come from CRM API errors and do not
  // carry the `phase` key.
  observations.push({
    ...base,
    signalSlug: 'staff_activity_pulse',
    numericValue: null,
    jsonPayload: { phase: 'placeholder', note: 'pending_compute_staff_activity_pulse_skill' },
    availability: 'unavailable_other',
  });
  observations.push({
    ...base,
    signalSlug: 'integration_fingerprint',
    numericValue: null,
    jsonPayload: { phase: 'placeholder', note: 'pending_scan_integration_fingerprints_skill' },
    availability: 'unavailable_other',
  });
  observations.push({
    ...base,
    signalSlug: 'ai_feature_usage',
    numericValue: null,
    jsonPayload: {
      phase: 'placeholder',
      note: 'pending_conversation_provider_analysis',
      conversationCount: input.conversationCount,
    },
    availability: 'unavailable_other',
  });

  // Persist observations. Migration 0175 adds a partial UNIQUE index on
  // (org, subaccount, signal_slug, source_run_id) WHERE source_run_id IS NOT
  // NULL — onConflictDoNothing makes retries idempotent rather than noisy.
  try {
    await db
      .insert(clientPulseSignalObservations)
      .values(observations)
      .onConflictDoNothing({
        target: [
          clientPulseSignalObservations.organisationId,
          clientPulseSignalObservations.subaccountId,
          clientPulseSignalObservations.signalSlug,
          clientPulseSignalObservations.sourceRunId,
        ],
      });
  } catch (err) {
    errors.push(`observations_insert_failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Persist tier history if subscription fetch was available AND the tier or
  // active flag differs from the most recent observation. Collapsing
  // unchanged observations keeps the timeseries clean for churn analysis.
  if (subResult.availability === 'available' && subResult.data.tier) {
    try {
      // Deterministic "most recent" — observedAt is the primary sort key, with
      // createdAt + id as tiebreakers so two rows written in the same
      // millisecond still have a stable ordering. Prevents the phantom-insert
      // case where Postgres's plan chooses a non-deterministic row.
      const [latest] = await db
        .select({ tier: subaccountTierHistory.tier, active: subaccountTierHistory.active })
        .from(subaccountTierHistory)
        .where(eq(subaccountTierHistory.subaccountId, input.subaccountId))
        .orderBy(desc(subaccountTierHistory.observedAt), desc(subaccountTierHistory.createdAt), desc(subaccountTierHistory.id))
        .limit(1);

      const tierChanged = !latest || latest.tier !== subResult.data.tier;
      const activeChanged = !latest || latest.active !== (subResult.data.active ?? null);

      if (tierChanged || activeChanged) {
        await db.insert(subaccountTierHistory).values({
          organisationId: input.organisationId,
          subaccountId: input.subaccountId,
          observedAt: now,
          tier: subResult.data.tier,
          tierSource: 'api',
          planId: subResult.data.planId,
          active: subResult.data.active,
          nextBillingDate: subResult.data.nextBillingDate ? new Date(subResult.data.nextBillingDate) : undefined,
          sourceRunId: input.sourceRunId,
        });
      }
    } catch (err) {
      errors.push(`tier_history_insert_failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { observationsWritten: observations.length, errors };
}

// ── Canonical fingerprint-bearing table writers (§2.0c) ──────────────────
//
// These are thin upsert helpers called from adapter-aware code that already
// has the raw shapes. They keep the fingerprint scanner (Phase 2+) decoupled
// from the adapter ingestion path.

export async function upsertConversationProvider(
  input: {
    organisationId: string;
    subaccountId: string;
    providerType: string;
    externalProviderId: string;
    displayName?: string;
  },
): Promise<void> {
  assertCanonicalUniqueness('canonical_conversation_providers', { subaccountId: input.subaccountId });
  await db
    .insert(canonicalConversationProviders)
    .values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      providerType: input.providerType,
      externalId: input.externalProviderId,
      displayName: input.displayName,
      observedAt: new Date(),
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [canonicalConversationProviders.organisationId, canonicalConversationProviders.providerType, canonicalConversationProviders.externalId],
      set: { lastSeenAt: new Date() },
    });
}

export async function upsertTagDefinition(
  input: { organisationId: string; subaccountId: string; providerType: string; tagName: string },
): Promise<void> {
  assertCanonicalUniqueness('canonical_tag_definitions', { subaccountId: input.subaccountId });
  const externalId = `${input.subaccountId}:${input.tagName}`;
  await db
    .insert(canonicalTagDefinitions)
    .values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      providerType: input.providerType,
      externalId,
      tagName: input.tagName,
      observedAt: new Date(),
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [canonicalTagDefinitions.organisationId, canonicalTagDefinitions.providerType, canonicalTagDefinitions.externalId],
      set: { lastSeenAt: new Date() },
    });
}

export async function upsertContactSource(
  input: { organisationId: string; subaccountId: string; providerType: string; sourceValue: string },
): Promise<void> {
  assertCanonicalUniqueness('canonical_contact_sources', { subaccountId: input.subaccountId });
  const externalId = `${input.subaccountId}:${input.sourceValue}`;
  await db
    .insert(canonicalContactSources)
    .values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      providerType: input.providerType,
      externalId,
      sourceValue: input.sourceValue,
      observedAt: new Date(),
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [canonicalContactSources.organisationId, canonicalContactSources.providerType, canonicalContactSources.externalId],
      set: {
        lastSeenAt: new Date(),
        occurrenceCount: sql`${canonicalContactSources.occurrenceCount} + 1`,
      },
    });
}
