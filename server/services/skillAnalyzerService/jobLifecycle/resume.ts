import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../../../lib/logger.js';
import { db } from '../../../db/index.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';
import { skillAnalyzerJobs } from '../../../db/schema/index.js';
import { getPgBoss } from '../../../lib/pgBossInstance.js';
import { getJobConfig } from '../../../config/jobConfig.js';
import { isSkillAnalyzerMidFlightStatus } from '../../skillAnalyzerServicePure.js';

/** How long a mid-flight row must be silent before resume will force-expire
 *  a lingering pg-boss `active` entry. 2× the stale-sweep threshold so
 *  this path only trips on jobs that are clearly dead but haven't yet been
 *  reaped by the periodic sweep. See Round 1 Finding 7. */
export const RESUME_MID_FLIGHT_GHOST_THRESHOLD_MS = 30 * 60_000;

/** Re-enqueue a previously-started analysis job that failed or stalled.
 *  The handler is crash-resumable: Stage 1 reuses stored parsedCandidates,
 *  Stage 5 skips already-classified candidateIndices, and Stage 6 hits
 *  the agent-embedding cache when content hashes match. So resuming is
 *  effectively free on LLM spend.
 *
 *  Safety guards:
 *    - Refuses if job.status === 'completed' (work already done)
 *    - Refuses if an alive pg-boss queue entry for this jobId still
 *      exists (would cause double-processing and Stage 8 race conditions)
 *
 *  Intermediate status (e.g. 'classifying') is accepted and reset — this
 *  is the common case where a worker was SIGKILL'd mid-pipeline and left
 *  the row in an in-flight state. */
export async function resumeJob(params: {
  jobId: string;
  organisationId: string;
  userId: string;
}): Promise<{ ok: true }> {
  const { jobId, organisationId } = params;

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system service — cross-tenant admin access intentional; no HTTP/ALS context"
  const [job] = await db
    .select()
    .from(skillAnalyzerJobs)
    .where(and(
      eq(skillAnalyzerJobs.id, jobId),
      eq(skillAnalyzerJobs.organisationId, organisationId),
    ));

  if (!job) throw { statusCode: 404, message: 'Analysis job not found.' };
  if (job.status === 'completed') {
    throw { statusCode: 409, message: 'Analysis already completed — nothing to resume.' };
  }

  // Guard against double-enqueue: if pg-boss already has a live row for
  // this jobId, resuming would run the handler twice in parallel and both
  // copies would fight over the Stage-8 insert set.
  //
  // Exception: a lingering 'active' pg-boss entry combined with EITHER
  //   (a) our DB row is 'failed', or
  //   (b) our DB row is mid-flight but has been silent past the stale
  //       resume threshold (2× the sweep threshold = 30 min by default),
  // means the worker process died without pg-boss detecting it (pg-boss's
  // own lock only expires after expireInSeconds, which is 4 hours). Force-
  // expire the ghost so resume can proceed rather than blocking the user
  // for hours on a dead worker.
  //
  // Case (b) matters because the sweep runs periodically; between worker
  // death and the next sweep tick a user clicking Resume would otherwise
  // get "already queued or running" for up to 15 min despite nothing
  // actually running. See ChatGPT PR review Round 1 Finding 7.
  //
  // drizzle-orm/postgres-js returns db.execute() as the row array directly
  // (NOT { rows }) — see server/services/jobQueueHealthService.ts for the
  // established cast pattern.
  const aliveRows = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM pgboss.job
    WHERE name = 'skill-analyzer'
      AND data->>'jobId' = ${jobId}
      AND state IN ('created', 'retry', 'active')
  `);
  const aliveCount = (aliveRows as unknown as Array<{ n: number }>)[0]?.n ?? 0;
  if (aliveCount > 0) {
    const jobUpdatedMs = job.updatedAt instanceof Date
      ? job.updatedAt.getTime()
      : new Date(job.updatedAt as unknown as string).getTime();
    const silenceMs = Date.now() - jobUpdatedMs;
    const midFlightStale = isSkillAnalyzerMidFlightStatus(job.status)
      && silenceMs > RESUME_MID_FLIGHT_GHOST_THRESHOLD_MS;
    if (job.status === 'failed' || midFlightStale) {
      // Dead worker left a ghost active entry — expire it so we can re-enqueue.
      await db.execute(sql`
        UPDATE pgboss.job
        SET state = 'failed',
            completedon = NOW(),
            output = '{"error":"Expired by resume — worker process died"}'::jsonb
        WHERE name = 'skill-analyzer'
          AND data->>'jobId' = ${jobId}
          AND state = 'active'
      `);
      logger.info('skill_analyzer.resume_force_expired_ghost', {
        jobId,
        dbStatus: job.status,
        silenceMs,
        reason: job.status === 'failed' ? 'db_failed' : 'mid_flight_stale',
      });
    } else {
      throw { statusCode: 409, message: 'Analysis is already queued or running.' };
    }
  }

  // Reset the intermediate row state so the progress UI reflects the
  // resume and the handler's stage-entry updates don't look like regressions.
  // Everything the handler needs to resume (parsedCandidates, configSnapshot,
  // classifyState, existing skill_analyzer_results rows) is preserved —
  // those are the inputs to Stage 5's skip-already-classified logic.
  await getOrgScopedDb('skillAnalyzerService.resumeJob')
    .update(skillAnalyzerJobs)
    .set({
      status: 'pending',
      errorMessage: null,
      progressMessage: 'Resuming analysis...',
      updatedAt: new Date(),
    })
    .where(eq(skillAnalyzerJobs.id, jobId));

  const boss = await getPgBoss();
  await boss.send('skill-analyzer', { jobId, organisationId }, {
    ...getJobConfig('skill-analyzer'),
    singletonKey: undefined,
  });

  logger.info('skill_analyzer.resume_enqueued', { jobId, organisationId });
  return { ok: true };
}
