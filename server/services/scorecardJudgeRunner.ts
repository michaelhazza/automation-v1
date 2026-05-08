// server/services/scorecardJudgeRunner.ts
// Scorecard judge runner — enqueues per-quality-check judge jobs after run completion.
// Trust & Verification Layer spec §12.3.

import { logger } from '../lib/logger.js';
import { scorecardService } from './scorecardService.js';
import { buildFanoutJobs } from './scorecardJudgeRunnerPure.js';
import type { QualityCheck } from '../db/schema/scorecards.js';

const JUDGE_MAX_JOBS_PER_RUN = Number(process.env['JUDGE_MAX_JOBS_PER_RUN'] ?? '20');

// ── scheduleForRun ────────────────────────────────────────────────────────────

/**
 * Called after `agent:run:completed` to determine which quality checks to grade
 * and enqueue `scorecard:judge` jobs via pg-boss (or no-op in dev/in-memory).
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
 */
export async function scheduleForcedGrade(args: {
  runId: string;
  agentId: string;
  organisationId: string;
  triggerSource: 'forced_runtime_check_fail' | 'forced_correction';
}): Promise<void> {
  const { runId, agentId, organisationId, triggerSource } = args;
  let attachments: Awaited<ReturnType<typeof scorecardService.listForAgent>>;
  try {
    attachments = await scorecardService.listForAgent(agentId);
  } catch {
    return;
  }

  if (attachments.length === 0) {
    logger.info('scorecard_judge_runner.forced_grade_noop', { runId, agentId, triggerSource });
    return;
  }

  const { queueService } = await import('./queueService.js');
  const queue = 'scorecard:judge:forced';

  for (const attachment of attachments) {
    for (const qc of (attachment.scorecard.qualityChecks as QualityCheck[])) {
      await queueService.sendJob(queue, {
        runId,
        scorecardId: attachment.scorecardId,
        qualityCheckSlug: qc.slug,
        triggerSource,
        organisationId,
      }).catch((err: unknown) => {
        logger.warn('scorecard_judge_runner.forced_enqueue_failed', {
          runId, scorecardId: attachment.scorecardId, qualityCheckSlug: qc.slug,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  logger.info('scorecard_judge_runner.forced_grade_enqueued', {
    runId, agentId, triggerSource, attachmentCount: attachments.length,
  });
}
