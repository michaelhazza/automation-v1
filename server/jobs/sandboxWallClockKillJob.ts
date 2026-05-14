/**
 * sandboxWallClockKillJob.ts — One-shot wall-clock belt-and-braces (spec B §10.2).
 *
 * Scheduled at sandbox start with startAfter = wallClockMs + buffer. If the
 * sandbox is still non-terminal when this fires, the job transitions the row to
 * 'harvesting' with errorReason='timed_out' so the harvest pipeline (C7) handles
 * the post-terminal steps. It is a no-op if the ceiling monitor already terminated.
 *
 * Idempotent on sandbox_execution_id: the WHERE predicate on status ensures only
 * one termination succeeds even if the job fires more than once.
 *
 * Spec B §10.2, §22.1.
 */

import type PgBoss from 'pg-boss';
import { and, eq, inArray } from 'drizzle-orm';
import { sandboxExecutions } from '../db/schema/sandboxExecutions.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { SANDBOX_WALL_CLOCK_KILL_JOB } from '../lib/sandboxJobNames.js';

export interface SandboxWallClockKillPayload {
  sandboxExecutionId: string;
  organisationId: string;
  subaccountId: string;
  wallClockMs: number;
}

export async function sandboxWallClockKillHandler(
  job: PgBoss.Job<SandboxWallClockKillPayload>,
): Promise<void> {
  const { sandboxExecutionId, organisationId, wallClockMs } = job.data;

  const db = getOrgScopedDb('jobs.sandboxWallClockKill');

  // Transition to harvesting only if still in a pre-terminal state.
  // If the ceiling monitor already terminated (status is terminal or 'harvesting'),
  // the WHERE predicate matches 0 rows and this is a safe no-op.
  const result = await db
    .update(sandboxExecutions)
    .set({
      status: 'harvesting',
      terminatedAt: new Date(),
      errorReason: 'timed_out',
    })
    .where(
      and(
        eq(sandboxExecutions.id, sandboxExecutionId),
        eq(sandboxExecutions.organisationId, organisationId),
        inArray(sandboxExecutions.status, ['pending', 'running']),
      ),
    );

  const rowsUpdated = (result as unknown as { rowCount?: number })?.rowCount ?? 0;

  if (rowsUpdated > 0) {
    logger.warn('sandbox.timeout', {
      sandboxExecutionId,
      wallClockMs,
      enforcedBy: 'worker_kill_job',
      source: SANDBOX_WALL_CLOCK_KILL_JOB,
    });
  } else {
    logger.info('sandbox.wall_clock_kill.no_op', {
      sandboxExecutionId,
      reason: 'already_terminal_or_harvesting',
    });
  }
}

/**
 * Register the wall-clock kill worker with pg-boss.
 * Called from queueService.ts.
 */
export async function registerSandboxWallClockKillJob(boss: PgBoss): Promise<void> {
  const { createWorker } = await import('../lib/createWorker.js');

  await createWorker<SandboxWallClockKillPayload>({
    queue: SANDBOX_WALL_CLOCK_KILL_JOB,
    boss,
    resolveOrgContext: (job) => ({
      organisationId: job.data.organisationId,
      subaccountId: job.data.subaccountId,
    }),
    handler: sandboxWallClockKillHandler,
  });

  logger.info('sandbox.wall_clock_kill.handler_registered');
}
