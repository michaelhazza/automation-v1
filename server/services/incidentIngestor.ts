// ---------------------------------------------------------------------------
// Incident Ingestor — public surface for recording system incidents.
//
// recordIncident is fire-and-forget: it NEVER throws. A failed ingest write
// logs logger.error('incident_ingest_failed', ...) and returns. The caller
// always completes normally.
//
// Mode toggle: SYSTEM_INCIDENT_INGEST_MODE=sync|async (default: sync).
// NODE_ENV=test forces sync regardless of the env var.
//
// Kill switch: SYSTEM_INCIDENT_INGEST_ENABLED=false disables all ingestion.
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { systemIncidents, systemIncidentSuppressions } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { env } from '../lib/env.js';
import {
  type IncidentInput,
  classify,
  inferDefaultSeverity,
  computeFingerprint,
  maxSeverity,
  validateFingerprintOverride,
  shouldNotify,
} from './incidentIngestorPure.js';
import type { SystemIncidentSeverity } from '../db/schema/systemIncidents.js';

export type { IncidentInput };

// ---------------------------------------------------------------------------
// Process-local failure counter — consumed by the self-check job.
// Entries older than 15 minutes are pruned on each access.
// Known limitation: process-local, so multi-instance deploys undercount.
// ---------------------------------------------------------------------------

const FAILURE_COUNTER_RETENTION_MS = 15 * 60 * 1000;
const processLocalFailureCounter: Array<{ at: Date }> = [];

function recordFailure(): void {
  const now = new Date();
  processLocalFailureCounter.push({ at: now });
  const cutoff = now.getTime() - FAILURE_COUNTER_RETENTION_MS;
  while (processLocalFailureCounter.length > 0 && processLocalFailureCounter[0].at.getTime() < cutoff) {
    processLocalFailureCounter.shift();
  }
}

/** Returns count of ingest failures in the last windowMinutes (process-local; multi-instance deploys undercount). */
export function getIngestFailuresInWindow(windowMinutes: number): number {
  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  return processLocalFailureCounter.filter(f => f.at.getTime() >= cutoff).length;
}

// ---------------------------------------------------------------------------
// Test-only reset hook
// ---------------------------------------------------------------------------

let _testMode = false;

/** Reset internal state between tests. Only callable in test environments. */
export function __resetForTest(): void {
  if (process.env.NODE_ENV !== 'test') return;
  processLocalFailureCounter.length = 0;
  _testMode = false;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

function isIngestEnabled(): boolean {
  const flag = process.env.SYSTEM_INCIDENT_INGEST_ENABLED;
  return flag === undefined || flag === 'true' || flag === '1';
}

function isAsyncMode(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  return process.env.SYSTEM_INCIDENT_INGEST_MODE === 'async';
}

/** The single public API — fire-and-forget, never throws. */
export async function recordIncident(input: IncidentInput): Promise<void> {
  if (!isIngestEnabled()) return;

  try {
    if (isAsyncMode()) {
      await enqueueIngest(input);
    } else {
      await ingestInline(input);
    }
  } catch (err) {
    recordFailure();
    logger.error('incident_ingest_failed', {
      error: err instanceof Error ? err.message : String(err),
      source: input.source,
      summary: input.summary?.slice(0, 100),
    });
  }
}

async function enqueueIngest(input: IncidentInput): Promise<void> {
  const boss = await getPgBoss();
  await boss.send('system-monitor-ingest', {
    input,
    correlationId: input.correlationId ?? null,
  });
}

/** Shared code path for sync mode and the async worker. */
export async function ingestInline(input: IncidentInput): Promise<void> {
  // Validate fingerprintOverride before doing anything else
  if (input.fingerprintOverride && !validateFingerprintOverride(input.fingerprintOverride)) {
    logger.warn('incident_fingerprint_override_rejected', {
      override: input.fingerprintOverride,
      source: input.source,
    });
    // Fall through — ingest with stack-derived fingerprint (drop override)
    input = { ...input, fingerprintOverride: undefined };
  }

  const fingerprint = computeFingerprint(input);
  const classification = classify(input);

  // 1. Suppression check
  const now = new Date();
  const suppression = await db
    .select()
    .from(systemIncidentSuppressions)
    .where(
      sql`${systemIncidentSuppressions.fingerprint} = ${fingerprint}
        AND (${systemIncidentSuppressions.organisationId} = ${input.organisationId ?? null}::uuid
          OR ${systemIncidentSuppressions.organisationId} IS NULL)
        AND (${systemIncidentSuppressions.expiresAt} IS NULL
          OR ${systemIncidentSuppressions.expiresAt} > ${now})`
    )
    .limit(1);

  if (suppression.length > 0) {
    // Increment suppressed_count in the rule row — fire-and-forget (don't fail the whole ingest)
    await db
      .update(systemIncidentSuppressions)
      .set({
        suppressedCount: sql`${systemIncidentSuppressions.suppressedCount} + 1`,
        lastSuppressedAt: now,
      })
      .where(sql`${systemIncidentSuppressions.id} = ${suppression[0].id}`);

    logger.warn('incident_suppressed', {
      fingerprint,
      reason: suppression[0].reason,
      suppressedCount: suppression[0].suppressedCount + 1,
    });
    return;
  }

  // 2. Resolve severity
  const resolvedSeverity: SystemIncidentSeverity = input.severity ??
    inferDefaultSeverity({
      source: input.source,
      statusCode: input.statusCode,
      errorCode: input.errorCode,
    });

  // 3. Upsert incident + append event in one transaction.
  // NOTE: boss.send is intentionally called AFTER the transaction commits —
  // calling it inside db.transaction would not enlist in the Drizzle tx and
  // could leave orphan notify jobs if the tx rolled back.
  const notifyMilestones = process.env.SYSTEM_INCIDENT_NOTIFY_MILESTONES;

  let notifyPayload: { incidentId: string; fingerprint: string; severity: SystemIncidentSeverity; occurrenceCount: number; correlationId: string | null } | null = null;

  await db.transaction(async (tx) => {
    // Raw SQL upsert using partial unique index — Drizzle's onConflictDoUpdate
    // doesn't support partial index targets, so we use db.execute.
    const rows = await tx.execute<{
      id: string;
      occurrence_count: number;
      severity: SystemIncidentSeverity;
      was_inserted: boolean;
    }>(sql`
      INSERT INTO system_incidents (
        fingerprint, source, severity, classification, status,
        organisation_id, subaccount_id,
        affected_resource_kind, affected_resource_id,
        error_code, summary, latest_error_detail, latest_stack, latest_correlation_id,
        is_test_incident, first_seen_at, last_seen_at, occurrence_count,
        created_at, updated_at
      ) VALUES (
        ${fingerprint},
        ${input.source},
        ${resolvedSeverity},
        ${classification},
        'open',
        ${input.organisationId ?? null}::uuid,
        ${input.subaccountId ?? null}::uuid,
        ${input.affectedResourceKind ?? null},
        ${input.affectedResourceId ?? null},
        ${input.errorCode ?? null},
        ${input.summary.slice(0, 240)},
        ${input.errorDetail ? JSON.stringify(input.errorDetail) : null}::jsonb,
        ${input.stack ?? null},
        ${input.correlationId ?? null},
        false,
        now(), now(), 1, now(), now()
      )
      ON CONFLICT (fingerprint) WHERE status IN ('open', 'investigating', 'remediating', 'escalated')
      DO UPDATE SET
        occurrence_count    = system_incidents.occurrence_count + 1,
        last_seen_at        = now(),
        latest_error_detail = EXCLUDED.latest_error_detail,
        latest_stack        = EXCLUDED.latest_stack,
        latest_correlation_id = EXCLUDED.latest_correlation_id,
        severity            = CASE
          WHEN (ARRAY['low','medium','high','critical']::text[] @> ARRAY[system_incidents.severity]
            AND ARRAY_POSITION(ARRAY['low','medium','high','critical']::text[], EXCLUDED.severity::text)
              > ARRAY_POSITION(ARRAY['low','medium','high','critical']::text[], system_incidents.severity::text))
          THEN EXCLUDED.severity
          ELSE system_incidents.severity
          END,
        updated_at          = now()
      RETURNING id, occurrence_count, severity, (xmax = 0) AS was_inserted
    `);

    const row = rows.rows?.[0] ?? (rows as unknown as { rows: typeof rows }[])[0];
    if (!row) throw new Error('incident upsert returned no rows');

    const incidentId: string = row.id;
    const occurrenceCount: number = Number(row.occurrence_count);
    const currentSeverity: SystemIncidentSeverity = row.severity as SystemIncidentSeverity;
    const wasInserted: boolean = Boolean(row.was_inserted);

    // 4. Append occurrence event
    await tx.execute(sql`
      INSERT INTO system_incident_events (incident_id, event_type, actor_kind, payload, correlation_id, occurred_at)
      VALUES (
        ${incidentId}::uuid,
        'occurrence',
        'system',
        ${JSON.stringify({
          source: input.source,
          severity: resolvedSeverity,
          classification,
          errorCode: input.errorCode,
          occurrenceCount,
          affectedResourceKind: input.affectedResourceKind,
          affectedResourceId: input.affectedResourceId,
        })}::jsonb,
        ${input.correlationId ?? null},
        now()
      )
    `);

    // Capture notify payload to send after transaction commits (boss.send must
    // not run inside the Drizzle tx — it uses its own connection pool).
    if (shouldNotify(occurrenceCount, wasInserted, currentSeverity, notifyMilestones)) {
      notifyPayload = {
        incidentId,
        fingerprint,
        severity: currentSeverity,
        occurrenceCount,
        correlationId: input.correlationId ?? null,
      };
    }
  });

  // 5. Enqueue notify job after the transaction has committed.
  // Failures here are logged but NOT rethrown: the incident row + occurrence
  // event are already durable. In async ingest mode (SYSTEM_INCIDENT_INGEST_MODE=async)
  // a rethrow would cause pg-boss to retry the ingest job, which would re-run
  // ingestInline and double-increment occurrence_count / append a duplicate
  // occurrence event on the conflict path. Notification is best-effort — the
  // incident is recorded either way, and the sysadmin UI polls the list every
  // 10s independently of the notify pipeline.
  if (notifyPayload) {
    try {
      const boss = await getPgBoss();
      await boss.send('system-monitor-notify', notifyPayload);
    } catch (err) {
      logger.error('incident_notify_enqueue_failed', {
        error: err instanceof Error ? err.message : String(err),
        incidentId: notifyPayload.incidentId,
        fingerprint: notifyPayload.fingerprint,
        severity: notifyPayload.severity,
      });
    }
  }
}
