import { sql, and, eq, lt, isNotNull } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { systemIncidents } from '../../../db/schema/systemIncidents.js';
import { systemIncidentEvents } from '../../../db/schema/systemIncidentEvents.js';
import { logger } from '../../../lib/logger.js';
import { parseStaleAfterMinutesEnv, staleCutoff } from './staleTriageSweepPure.js';

export { parseStaleAfterMinutesEnv } from './staleTriageSweepPure.js';

// IO: executes UPDATE...RETURNING in a transaction with the events INSERT.
// One agent_triage_timed_out event per flipped row, atomically with the status flip.
// Uses the ORM builder for the UPDATE so Date parameters are serialised correctly.
export async function runStaleTriageSweep(now: Date = new Date()): Promise<{ flipped: number }> {
  if (process.env.SYSTEM_MONITOR_TRIAGE_STALE_SWEEP_ENABLED === 'false') {
    return { flipped: 0 };
  }

  const staleAfterMinutes = parseStaleAfterMinutesEnv();
  const cutoff = staleCutoff(now, staleAfterMinutes * 60 * 1000);

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
          staleAfterMinutes,
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

// Pure: kept as a documented SQL fragment for the predicate shape. The runtime
// path uses the ORM builder above for Date parameter serialisation; this remains
// exported because the spec (§7.2) references it as the canonical predicate.
export function findStaleTriageRowsSql(now: Date, staleAfterMs: number) {
  const cutoff = staleCutoff(now, staleAfterMs);
  return sql`UPDATE system_incidents
    SET triage_status = 'failed', updated_at = ${now}
    WHERE triage_status = 'running'
      AND last_triage_attempt_at < ${cutoff}
      AND last_triage_job_id IS NOT NULL
    RETURNING id, last_triage_attempt_at, triage_attempt_count`;
}
