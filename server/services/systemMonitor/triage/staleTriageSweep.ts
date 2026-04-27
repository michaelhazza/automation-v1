import { sql, and, eq, lt, isNotNull } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { systemIncidents } from '../../../db/schema/systemIncidents.js';
import { systemIncidentEvents } from '../../../db/schema/systemIncidentEvents.js';
import { logger } from '../../../lib/logger.js';

// Pure: builds the SQL fragment. Exported as a pure helper for documentation
// and testing the predicate shape — the actual execution uses the ORM builder.
export function findStaleTriageRowsSql(now: Date, staleAfterMs: number) {
  const cutoff = new Date(now.getTime() - staleAfterMs);
  return sql`UPDATE system_incidents
    SET triage_status = 'failed', updated_at = ${now}
    WHERE triage_status = 'running'
      AND last_triage_attempt_at < ${cutoff}
      AND last_triage_job_id IS NOT NULL
    RETURNING id, last_triage_attempt_at, triage_attempt_count`;
}

// Pure helper: parse SYSTEM_MONITOR_TRIAGE_STALE_AFTER_MINUTES with explicit
// NaN / non-positive guards. `parseInt('', 10)` returns NaN, and `??` only
// catches null/undefined — so a malformed env value (e.g. `''`, `'abc'`,
// `'0'`, `'-5'`) would silently produce NaN minutes and disable the sweep.
// Always fall back to the default in that case.
export function parseStaleAfterMinutesEnv(
  raw: string | undefined = process.env.SYSTEM_MONITOR_TRIAGE_STALE_AFTER_MINUTES,
): number {
  const DEFAULT_MINUTES = 10;
  if (raw === undefined || raw === '') return DEFAULT_MINUTES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MINUTES;
  return parsed;
}

// IO: executes UPDATE...RETURNING in a transaction with the events INSERT.
// One agent_triage_timed_out event per flipped row, atomically with the status flip.
// Uses the ORM builder for the UPDATE so Date parameters are serialised correctly.
export async function runStaleTriageSweep(now: Date = new Date()): Promise<{ flipped: number }> {
  if (process.env.SYSTEM_MONITOR_TRIAGE_STALE_SWEEP_ENABLED === 'false') {
    return { flipped: 0 };
  }

  const staleAfterMs = parseStaleAfterMinutesEnv() * 60 * 1000;
  const cutoff = new Date(now.getTime() - staleAfterMs);

  const flippedRows = await db.transaction(async (tx) => {
    const rows = await tx
      .update(systemIncidents)
      .set({ triageStatus: 'failed', updatedAt: now })
      .where(
        and(
          eq(systemIncidents.triageStatus, 'running'),
          lt(systemIncidents.lastTriageAttemptAt, cutoff),
          isNotNull(systemIncidents.lastTriageJobId),
        ),
      )
      .returning({
        id: systemIncidents.id,
        lastTriageAttemptAt: systemIncidents.lastTriageAttemptAt,
        triageAttemptCount: systemIncidents.triageAttemptCount,
      });

    if (rows.length === 0) return rows;

    await tx.insert(systemIncidentEvents).values(
      rows.map((row) => ({
        incidentId: row.id,
        eventType: 'agent_triage_timed_out' as const,
        actorKind: 'agent' as const,
        actorAgentRunId: null,
        payload: {
          reason: 'staleness_sweep',
          staleAfterMinutes: parseStaleAfterMinutesEnv(),
          lastTriageAttemptAt: row.lastTriageAttemptAt?.toISOString() ?? null,
          triageAttemptCount: row.triageAttemptCount,
        },
        occurredAt: now,
      })),
    );

    return rows;
  });

  if (flippedRows.length > 0) {
    logger.info('stale_triage_sweep_flipped', {
      flipped: flippedRows.length,
      incidentIds: flippedRows.map((r) => r.id),
    });
  }

  return { flipped: flippedRows.length };
}
