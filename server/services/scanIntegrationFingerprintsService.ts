/**
 * Integration Fingerprint Scanner skill handler (§2.0c).
 *
 * For one sub-account: reads canonical fingerprint-bearing artifacts
 * (conversation providers, workflow definitions + outbound webhook domains,
 * tag definitions, custom field definitions, contact sources), matches them
 * against the fingerprint library (system + org scope), and writes:
 *   - integration_detections (one row per matched integration_slug, upserted)
 *   - integration_unclassified_signals (queue of novel observations)
 *   - client_pulse_signal_observations (the signal row that replaces the
 *     Phase 1 placeholder; numericValue = detection count)
 *
 * The scan is idempotent within a pollRunId — repeated runs refresh
 * last_seen_at without creating duplicates. Pure matching logic lives in
 * `scanIntegrationFingerprintsPure.ts`; this wrapper owns only DB I/O.
 *
 * ── Idempotency contract ────────────────────────────────────────────────
 *
 * `integration_detections` + `integration_unclassified_signals` upserts are
 * naturally idempotent via their own unique indexes (re-observation refreshes
 * last_seen_at + increments occurrence_count; it never duplicates rows).
 *
 * The signal observation row is keyed on `(org, subaccount, signal_slug,
 * source_run_id)` per migration 0175's partial unique index. Poll-cycle
 * invocations share a pollRunId and de-dupe cleanly. Agent-skill invocations
 * without a source_run_id bypass the partial index and append a new row —
 * same timeseries semantics as compute_staff_activity_pulse.
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm';
// `isNull` is used in the library loader to exclude soft-deleted fingerprint
// rows. The detections upsert below is non-partial so does not need it.
import { db } from '../db/index.js';
import {
  canonicalConversationProviders,
  canonicalWorkflowDefinitions,
  canonicalTagDefinitions,
  canonicalCustomFieldDefinitions,
  canonicalContactSources,
  clientPulseSignalObservations,
  integrationFingerprints,
  integrationDetections,
  integrationUnclassifiedSignals,
  assertCanonicalUniqueness,
  type IntegrationFingerprintType,
  type NewClientPulseSignalObservation,
  type NewIntegrationDetection,
  type NewIntegrationUnclassifiedSignal,
} from '../db/schema/clientPulseCanonicalTables.js';
import {
  scanFingerprintsPure,
  type FingerprintLibraryEntry,
  type Observation,
} from './scanIntegrationFingerprintsPure.js';

export interface ScanIntegrationFingerprintsInput {
  organisationId: string;
  subaccountId: string;
  connectorConfigId?: string | null;
  sourceRunId?: string;
  /** Test hook — bypass DB. */
  observationsOverride?: Observation[];
  libraryOverride?: FingerprintLibraryEntry[];
  now?: Date;
}

export interface ScanIntegrationFingerprintsResult {
  observationId?: string;
  detectionCount: number;
  unclassifiedCount: number;
  skipped?: 'conflict_exists';
}

export async function executeScanIntegrationFingerprints(
  input: ScanIntegrationFingerprintsInput,
): Promise<ScanIntegrationFingerprintsResult> {
  const now = input.now ?? new Date();

  const library = input.libraryOverride ?? (await loadLibrary(input.organisationId));
  const observations =
    input.observationsOverride ?? (await loadObservations(input.organisationId, input.subaccountId));

  const { detections, unclassified } = scanFingerprintsPure(observations, library);

  assertCanonicalUniqueness('integration_detections', { subaccountId: input.subaccountId });
  assertCanonicalUniqueness('integration_unclassified_signals', { subaccountId: input.subaccountId });

  for (const d of detections) {
    const row: NewIntegrationDetection = {
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      integrationSlug: d.integrationSlug,
      matchedFingerprintId: d.matchedFingerprintId,
      firstSeenAt: now,
      lastSeenAt: now,
      usageIndicatorJson: { match: d.evidence },
    };
    await db
      .insert(integrationDetections)
      .values(row)
      .onConflictDoUpdate({
        target: [
          integrationDetections.organisationId,
          integrationDetections.subaccountId,
          integrationDetections.integrationSlug,
        ],
        // Re-observation refreshes last_seen_at + the match pointer so a
        // library change (e.g. higher-confidence pattern added) is picked up
        // on the next scan. firstSeenAt is left alone — the initial detection
        // timestamp is meaningful for cohort analysis.
        set: {
          lastSeenAt: now,
          matchedFingerprintId: d.matchedFingerprintId,
          usageIndicatorJson: { match: d.evidence },
        },
      });
  }

  for (const u of unclassified) {
    const row: NewIntegrationUnclassifiedSignal = {
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      signalType: u.signalType,
      signalValue: u.signalValue,
      firstSeenAt: now,
      lastSeenAt: now,
      occurrenceCount: 1,
      // V1 heuristic: importance_score tracks occurrence_count so the triage
      // query `ORDER BY importance_score DESC` returns the most-seen signals
      // first. Phase 2+ upgrade path: weight by unique-subaccount reach (e.g.
      // `occurrence_count * ln(unique_subaccounts)`) so a pattern seen once
      // in 50 subs outranks a pattern seen 50 times in one sub.
      importanceScore: '1',
    };
    await db
      .insert(integrationUnclassifiedSignals)
      .values(row)
      .onConflictDoUpdate({
        target: [
          integrationUnclassifiedSignals.organisationId,
          integrationUnclassifiedSignals.subaccountId,
          integrationUnclassifiedSignals.signalType,
          integrationUnclassifiedSignals.signalValue,
        ],
        set: {
          lastSeenAt: now,
          occurrenceCount: sql`${integrationUnclassifiedSignals.occurrenceCount} + 1`,
          importanceScore: sql`${integrationUnclassifiedSignals.occurrenceCount} + 1`,
        },
      });
  }

  const obsRow: NewClientPulseSignalObservation = {
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    connectorConfigId: input.connectorConfigId ?? undefined,
    signalSlug: 'integration_fingerprint',
    observedAt: now,
    numericValue: detections.length,
    jsonPayload: {
      detectionCount: detections.length,
      detections: detections.map((d) => ({ integrationSlug: d.integrationSlug, confidence: d.confidence })),
      unclassifiedCount: unclassified.length,
      algorithm: 'library_match_v1',
    },
    sourceRunId: input.sourceRunId,
    availability: 'available',
  };

  const [inserted] = await db
    .insert(clientPulseSignalObservations)
    .values(obsRow)
    .onConflictDoNothing({
      target: [
        clientPulseSignalObservations.organisationId,
        clientPulseSignalObservations.subaccountId,
        clientPulseSignalObservations.signalSlug,
        clientPulseSignalObservations.sourceRunId,
      ],
    })
    .returning({ id: clientPulseSignalObservations.id });

  return {
    observationId: inserted?.id,
    detectionCount: detections.length,
    unclassifiedCount: unclassified.length,
    skipped: inserted ? undefined : 'conflict_exists',
  };
}

// ── Library + observation loaders (DB-touching) ─────────────────────────

async function loadLibrary(organisationId: string): Promise<FingerprintLibraryEntry[]> {
  const rows = await db
    .select({
      id: integrationFingerprints.id,
      integrationSlug: integrationFingerprints.integrationSlug,
      displayName: integrationFingerprints.displayName,
      fingerprintType: integrationFingerprints.fingerprintType,
      fingerprintValue: integrationFingerprints.fingerprintValue,
      fingerprintPattern: integrationFingerprints.fingerprintPattern,
      confidence: integrationFingerprints.confidence,
    })
    .from(integrationFingerprints)
    .where(
      and(
        isNull(integrationFingerprints.deletedAt),
        or(
          eq(integrationFingerprints.scope, 'system'),
          and(
            eq(integrationFingerprints.scope, 'org'),
            eq(integrationFingerprints.organisationId, organisationId),
          ),
        ),
      ),
    );

  return rows.map((r) => ({
    id: r.id,
    integrationSlug: r.integrationSlug,
    displayName: r.displayName,
    fingerprintType: r.fingerprintType as IntegrationFingerprintType,
    fingerprintValue: r.fingerprintValue,
    fingerprintPattern: r.fingerprintPattern,
    // Drizzle returns numeric() as string — parse to number so the matcher can
    // compare confidences numerically.
    confidence: Number(r.confidence),
  }));
}

async function loadObservations(organisationId: string, subaccountId: string): Promise<Observation[]> {
  const observations: Observation[] = [];

  // All five loaders filter on BOTH organisationId + subaccountId per
  // CLAUDE.md architecture rules ("all queries filter by organisationId").
  // subaccount UUIDs are globally unique by construction, so the org filter
  // is belt-and-braces; the convention makes RLS enforcement deterministic
  // and auditable by inspection.

  const providers = await db
    .select({ externalId: canonicalConversationProviders.externalId })
    .from(canonicalConversationProviders)
    .where(
      and(
        eq(canonicalConversationProviders.organisationId, organisationId),
        eq(canonicalConversationProviders.subaccountId, subaccountId),
      ),
    );
  for (const p of providers) {
    observations.push({ signalType: 'conversation_provider_id', signalValue: p.externalId });
  }

  const workflows = await db
    .select({
      actionTypes: canonicalWorkflowDefinitions.actionTypes,
      webhookTargets: canonicalWorkflowDefinitions.outboundWebhookTargets,
    })
    .from(canonicalWorkflowDefinitions)
    .where(
      and(
        eq(canonicalWorkflowDefinitions.organisationId, organisationId),
        eq(canonicalWorkflowDefinitions.subaccountId, subaccountId),
      ),
    );
  for (const w of workflows) {
    for (const t of (w.actionTypes as string[] | null) ?? []) {
      observations.push({ signalType: 'workflow_action_type', signalValue: t });
    }
    for (const target of (w.webhookTargets as string[] | null) ?? []) {
      observations.push({ signalType: 'outbound_webhook_domain', signalValue: extractDomain(target) });
    }
  }

  const tags = await db
    .select({ tagName: canonicalTagDefinitions.tagName })
    .from(canonicalTagDefinitions)
    .where(
      and(
        eq(canonicalTagDefinitions.organisationId, organisationId),
        eq(canonicalTagDefinitions.subaccountId, subaccountId),
      ),
    );
  for (const t of tags) {
    observations.push({ signalType: 'tag_prefix', signalValue: t.tagName });
  }

  const fields = await db
    .select({ fieldKey: canonicalCustomFieldDefinitions.fieldKey })
    .from(canonicalCustomFieldDefinitions)
    .where(
      and(
        eq(canonicalCustomFieldDefinitions.organisationId, organisationId),
        eq(canonicalCustomFieldDefinitions.subaccountId, subaccountId),
      ),
    );
  for (const f of fields) {
    observations.push({ signalType: 'custom_field_prefix', signalValue: f.fieldKey });
  }

  const sources = await db
    .select({ sourceValue: canonicalContactSources.sourceValue })
    .from(canonicalContactSources)
    .where(
      and(
        eq(canonicalContactSources.organisationId, organisationId),
        eq(canonicalContactSources.subaccountId, subaccountId),
      ),
    );
  for (const s of sources) {
    observations.push({ signalType: 'contact_source', signalValue: s.sourceValue });
  }

  return observations;
}

function extractDomain(urlOrDomain: string): string {
  try {
    return new URL(urlOrDomain).host;
  } catch {
    return urlOrDomain;
  }
}
