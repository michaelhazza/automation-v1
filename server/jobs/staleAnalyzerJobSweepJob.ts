/**
 * staleAnalyzerJobSweepJob — reaps `skill_analyzer_jobs` rows that have sat
 * in a mid-flight status with no `updated_at` progress for the threshold
 * (15 min). Codifies the manual recovery pattern from KNOWLEDGE.md
 * (2026-04-24 entries on `node --watch` restarts).
 *
 * For each stuck row this sweep does the same two UPDATEs that we have been
 * running by hand all day:
 *
 *   1. `skill_analyzer_jobs.status = 'failed'` with a diagnostic
 *      `error_message` — surfaces the Resume button in the UI immediately.
 *   2. `pgboss.job` row for that `jobId`: `state='failed'`, `completedon=NOW()`
 *      — releases the ghost `active` lock so pg-boss `retryLimit: 1` /
 *      `retryDelay: 300` can re-issue the job. Once retried, the v5 resume
 *      seeding hydrates `libraryId` + `proposedMerge` from cached
 *      `skill_analyzer_results` rows and the worker picks up from where it
 *      died (typically Stage 6 / 7 / 7b for the v6-class failures we have
 *      observed).
 *
 * Cadence: every 10 min. Threshold: 15 min `updated_at` silence (see
 * `staleAnalyzerJobSweepJobPure.ts` for the derivation).
 *
 * Registered in `server/services/queueService.ts` as
 * `maintenance:stale-analyzer-job-sweep`. Admin-bypass (RLS-FORCE'd table
 * via withAdminConnection — same pattern as llmStartedRowSweepJob).
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import {
  computeStaleAnalyzerJobCutoff,
  STALE_ANALYZER_JOB_MID_FLIGHT_STATUSES,
} from './staleAnalyzerJobSweepJobPure.js';

interface SweptJob {
  jobId: string;
  status: string;
  updatedAt: string;
}

interface SweepResult {
  totalReaped: number;
  cutoff: string;
  jobs: SweptJob[];
}

export async function sweepStaleAnalyzerJobs(): Promise<SweepResult> {
  const cutoff = computeStaleAnalyzerJobCutoff({ nowMs: Date.now() });
  const cutoffIso = cutoff.toISOString();
  const midFlight = [...STALE_ANALYZER_JOB_MID_FLIGHT_STATUSES];

  return withAdminConnection(
    {
      source: 'staleAnalyzerJobSweepJob',
      reason: `reap mid-flight skill_analyzer_jobs with updated_at < ${cutoffIso}`,
    },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // Mark the stuck rows failed in one round-trip and return the ids so
      // we can expire the matching pg-boss `active` rows in the same txn.
      // FOR UPDATE SKIP LOCKED keeps two concurrent sweeps from racing.
      const reaped = await tx.execute(sql`
        WITH stuck AS (
          SELECT id, status, updated_at
          FROM skill_analyzer_jobs
          WHERE status = ANY(${midFlight}::text[])
            AND updated_at < ${cutoffIso}
          ORDER BY updated_at
          FOR UPDATE SKIP LOCKED
        )
        UPDATE skill_analyzer_jobs j
        SET status = 'failed',
            error_message = COALESCE(
              j.error_message,
              'Worker process appears to have died (no progress for 15+ minutes). Click Resume to re-run from cached results.'
            )
        FROM stuck
        WHERE j.id = stuck.id
        RETURNING j.id, stuck.status AS prior_status, stuck.updated_at AS prior_updated_at;
      `);

      const rows = reaped as unknown as Array<{
        id: string;
        prior_status: string;
        prior_updated_at: Date | string;
      }>;

      if (rows.length === 0) {
        logger.debug('stale_analyzer_job_sweep_clean', { cutoff: cutoffIso });
        return { totalReaped: 0, cutoff: cutoffIso, jobs: [] };
      }

      // Expire the matching pg-boss ghost lock for each reaped jobId.
      // Single UPDATE per sweep — pg-boss stores `data->>'jobId'` as the
      // canonical link to the application job row.
      const jobIds = rows.map(r => r.id);
      await tx.execute(sql`
        UPDATE pgboss.job
        SET state = 'failed', completedon = NOW()
        WHERE name = 'skill-analyzer'
          AND state = 'active'
          AND data->>'jobId' = ANY(${jobIds}::text[]);
      `);

      const sweptJobs: SweptJob[] = rows.map(r => ({
        jobId: r.id,
        status: r.prior_status,
        updatedAt: r.prior_updated_at instanceof Date
          ? r.prior_updated_at.toISOString()
          : String(r.prior_updated_at),
      }));

      logger.warn('stale_analyzer_job_sweep_reaped', {
        totalReaped: rows.length,
        cutoff: cutoffIso,
        jobs: sweptJobs,
      });

      return {
        totalReaped: rows.length,
        cutoff: cutoffIso,
        jobs: sweptJobs,
      };
    },
  );
}
