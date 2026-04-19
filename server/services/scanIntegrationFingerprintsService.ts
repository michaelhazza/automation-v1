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
  const observations = input.observationsOverride ?? (await loadObservations(input.subaccountId));

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
        // Re-observation refreshes the pointer + clears any prior soft-delete.
        // If an operator dismissed the detection and the scanner sees the
        // integration again, the semantically correct state is "present".
        set: {
          lastSeenAt: now,
          matchedFingerprintId: d.matchedFingerprintId,
          usageIndicatorJson: { match: d.evidence },
          deletedAt: null,
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
    confidence: r.confidence,
  }));
}

async function loadObservations(subaccountId: string): Promise<Observation[]> {
  const observations: Observation[] = [];

  const providers = await db
    .select({ externalId: canonicalConversationProviders.externalId })
    .from(canonicalConversationProviders)
    .where(eq(canonicalConversationProviders.subaccountId, subaccountId));
  for (const p of providers) {
    observations.push({ signalType: 'conversation_provider_id', signalValue: p.externalId });
  }

  const workflows = await db
    .select({
      actionTypes: canonicalWorkflowDefinitions.actionTypes,
      webhookTargets: canonicalWorkflowDefinitions.outboundWebhookTargets,
    })
    .from(canonicalWorkflowDefinitions)
    .where(eq(canonicalWorkflowDefinitions.subaccountId, subaccountId));
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
    .where(eq(canonicalTagDefinitions.subaccountId, subaccountId));
  for (const t of tags) {
    observations.push({ signalType: 'tag_prefix', signalValue: t.tagName });
  }

  const fields = await db
    .select({ fieldKey: canonicalCustomFieldDefinitions.fieldKey })
    .from(canonicalCustomFieldDefinitions)
    .where(eq(canonicalCustomFieldDefinitions.subaccountId, subaccountId));
  for (const f of fields) {
    observations.push({ signalType: 'custom_field_prefix', signalValue: f.fieldKey });
  }

  const sources = await db
    .select({ sourceValue: canonicalContactSources.sourceValue })
    .from(canonicalContactSources)
    .where(eq(canonicalContactSources.subaccountId, subaccountId));
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
