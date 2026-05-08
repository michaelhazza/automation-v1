// server/services/scorecardJudgeRunner.ts
// Scorecard judge runner — enqueues per-quality-check judge jobs after run completion.
// Trust & Verification Layer spec §12.3.

import { logger } from '../lib/logger.js';
import { scorecardService } from './scorecardService.js';
import { buildFanoutJobs } from './scorecardJudgeRunnerPure.js';
import { selectForcedGradeTargets } from '../jobs/scorecardJudgeForcedJob.js';
import type { QualityCheck } from '../db/schema/scorecards.js';

const JUDGE_MAX_JOBS_PER_RUN = Number(process.env['JUDGE_MAX_JOBS_PER_RUN'] ?? '20');

// ── scheduleForRun ────────────────────────────────────────────────────────────

/**
 * Called after `agent:run:completed` to determine which quality checks to grade
 * and enqueue `scorecard:judge` jobs via pg-boss (or no-op in dev/in-memory).
 *
 * Precondition: caller MUST be inside an active withOrgTx block (HTTP handler or
 * pg-boss createWorker job) — scorecardService.listForAgent uses getOrgScopedDb
 * which throws 'missing_org_context' outside any org transaction.
 *
 * Non-blocking: caller should fire-and-forget with `.catch(logger.error)`.
 */
export async function scheduleForRun(
  runId: string,
  agentId: string,
  organisationId: string,
): Promise<void> {
  let attachments: Awaited<ReturnType<typeof scorecardService.listForAgent>>;
  try {
    attachments = await scorecardService.listForAgent(agentId);
  } catch (err) {
    logger.warn('scorecard_judge_runner.list_failed', {
      runId, agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (attachments.length === 0) return;

  const attachmentSummaries = attachments.map(a => ({
    scorecardId: a.scorecardId,
    gradingFrequency: a.gradingFrequency,
    attachedAt: a.attachedAt,
    qualityChecks: (a.scorecard.qualityChecks as QualityCheck[]) ?? [],
  }));

  const { jobs, capped } = buildFanoutJobs(runId, attachmentSummaries, JUDGE_MAX_JOBS_PER_RUN);

  if (capped) {
    logger.info('scorecard_judge.fanout_capped', {
      runId, agentId, totalSampled: attachmentSummaries.length,
      truncatedTo: JUDGE_MAX_JOBS_PER_RUN,
    });
  }

  if (jobs.length === 0) return;

  // Enqueue via queueService.sendJob (no-op in in-memory mode)
  const { queueService } = await import('./queueService.js');
  await Promise.all(
    jobs.map(job =>
      queueService.sendJob('scorecard:judge', {
        runId,
        scorecardId: job.scorecardId,
        qualityCheckSlug: job.qualityCheckSlug,
        triggerSource: 'sampled',
        organisationId,
      }).catch((err: unknown) => {
        logger.warn('scorecard_judge_runner.enqueue_failed', {
          runId, scorecardId: job.scorecardId, qualityCheckSlug: job.qualityCheckSlug,
          error: err instanceof Error ? err.message : String(err),
        });
      })
    ),
  );

  logger.info('scorecard_judge_runner.enqueued', { runId, agentId, jobCount: jobs.length });
}

// ── scheduleForcedGrade ───────────────────────────────────────────────────────

/**
 * Enqueues forced judge jobs (e.g. triggered by runtime check fail or correction).
 * No-op when agent has zero attached scorecards.
 *
 * blastRadius / runtimeCheckState: when provided, selectForcedGradeTargets filters
 * out 'self' blast-radius and non-fail states before enqueueing. Omit (or pass
 * defaults 'external'/'fail') for the forced_correction path where all checks fire
 * unconditionally.
 *
 * Precondition: caller MUST be inside an active withOrgTx block — see scheduleForRun.
 */
export async function scheduleForcedGrade(args: {
  runId: string;
  agentId: string;
  organisationId: string;
  triggerSource: 'forced_runtime_check_fail' | 'forced_correction';
  blastRadius?: 'self' | 'tenant' | 'external';
  runtimeCheckState?: string;
}): Promise<void> {
  const {
    runId, agentId, organisationId, triggerSource,
    blastRadius = 'external',
    runtimeCheckState = 'fail',
  } = args;

  let attachments: Awaited<ReturnType<typeof scorecardService.listForAgent>>;
  try {
    attachments = await scorecardService.listForAgent(agentId);
  } catch (err) {
    logger.warn('scorecard_judge_runner.forced_list_failed', {
      runId, agentId, triggerSource,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (attachments.length === 0) {
    logger.info('scorecard_judge_runner.forced_grade_noop', { runId, agentId, triggerSource });
    return;
  }

  const summaries = attachments.map(a => ({
    scorecardId: a.scorecardId,
    qualityChecks: (a.scorecard.qualityChecks as QualityCheck[]) ?? [],
  }));

  const targets = selectForcedGradeTargets(blastRadius, runtimeCheckState, summaries);
  if (targets.length === 0) {
    logger.info('scorecard_judge_runner.forced_grade_noop', { runId, agentId, triggerSource, blastRadius, runtimeCheckState });
    return;
  }

  const { queueService } = await import('./queueService.js');
  const queue = 'scorecard:judge:forced';

  for (const target of targets) {
    await queueService.sendJob(queue, {
      runId,
      scorecardId: target.scorecardId,
      qualityCheckSlug: target.qualityCheckSlug,
      triggerSource,
      organisationId,
    }).catch((err: unknown) => {
      logger.warn('scorecard_judge_runner.forced_enqueue_failed', {
        runId, scorecardId: target.scorecardId, qualityCheckSlug: target.qualityCheckSlug,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  logger.info('scorecard_judge_runner.forced_grade_enqueued', {
    runId, agentId, triggerSource, jobCount: targets.length,
  });
}
