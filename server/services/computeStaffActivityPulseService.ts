/**
 * Staff Activity Pulse skill handler (§2.0b).
 *
 * Reads canonical_subaccount_mutations for one sub-account, applies the org's
 * staff-activity config (mutation-type weights, excluded user kinds, lookback
 * windows), and writes a real observation row — replacing the
 * `availability='unavailable_other'` placeholder previously written by
 * `clientPulseIngestionService.ingestClientPulseSignalsForSubaccount`.
 *
 * Exposed as the `compute_staff_activity_pulse` skill. Also importable
 * directly from the polling-cycle code so fresh observations land in the
 * same transaction window as the other signal writes.
 *
 * ── Idempotency contract ────────────────────────────────────────────────
 *
 * The conflict target is `(org, subaccount, signal_slug, source_run_id)`
 * — migration 0175's partial unique index. When called from the polling
 * cycle with a shared `sourceRunId`, duplicate observations are de-duped
 * by `onConflictDoNothing`. When called as an agent skill **without** a
 * `sourceRunId`, the partial index does not fire (it is WHERE source_run_id
 * IS NOT NULL), so repeated agent invocations append additional observation
 * rows. This is intentional: the signal is a timeseries; agent-driven
 * recomputes produce new data points rather than overwriting the last one.
 * Callers needing "one observation per day" semantics should either pass a
 * stable run id or query the latest row by observedAt at read time.
 */

import { and, eq, gte } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  canonicalSubaccountMutations,
  clientPulseSignalObservations,
  type NewClientPulseSignalObservation,
} from '../db/schema/clientPulseCanonicalTables.js';
import { orgConfigService } from './orgConfigService.js';
import {
  computeStaffActivityPulse,
  type MutationRow,
} from './computeStaffActivityPulsePure.js';

export interface ComputeStaffActivityPulseInput {
  organisationId: string;
  subaccountId: string;
  connectorConfigId?: string | null;
  sourceRunId?: string;
  /** When present, skips the DB read and uses these rows directly (test hook). */
  mutationRowsOverride?: MutationRow[];
  /** Override now() for deterministic tests. */
  now?: Date;
}

export interface ComputeStaffActivityPulseResult {
  observationId?: string;
  numericValue: number;
  skipped?: 'no_config' | 'conflict_exists';
}

export async function executeComputeStaffActivityPulse(
  input: ComputeStaffActivityPulseInput,
): Promise<ComputeStaffActivityPulseResult> {
  const config = await orgConfigService.getStaffActivityDefinition(input.organisationId);
  if (!config) {
    return { numericValue: 0, skipped: 'no_config' };
  }

  const now = input.now ?? new Date();
  const longestWindow = Math.max(...(config.lookbackWindowsDays ?? [30]));
  const since = new Date(now.getTime() - longestWindow * 24 * 60 * 60 * 1000);

  const rows =
    input.mutationRowsOverride ??
    (await db
      .select({
        occurredAt: canonicalSubaccountMutations.occurredAt,
        mutationType: canonicalSubaccountMutations.mutationType,
        externalUserKind: canonicalSubaccountMutations.externalUserKind,
        externalUserId: canonicalSubaccountMutations.externalUserId,
      })
      .from(canonicalSubaccountMutations)
      .where(
        and(
          eq(canonicalSubaccountMutations.organisationId, input.organisationId),
          eq(canonicalSubaccountMutations.subaccountId, input.subaccountId),
          gte(canonicalSubaccountMutations.occurredAt, since),
        ),
      ));

  const result = computeStaffActivityPulse(rows as MutationRow[], config, now);

  const row: NewClientPulseSignalObservation = {
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    connectorConfigId: input.connectorConfigId ?? undefined,
    signalSlug: 'staff_activity_pulse',
    observedAt: now,
    numericValue: result.numericValue,
    jsonPayload: result.jsonPayload,
    sourceRunId: input.sourceRunId,
    availability: 'available',
  };

  const [inserted] = await db
    .insert(clientPulseSignalObservations)
    .values(row)
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
    numericValue: result.numericValue,
    skipped: inserted ? undefined : 'conflict_exists',
  };
}
