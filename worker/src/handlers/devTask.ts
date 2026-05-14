// ---------------------------------------------------------------------------
// pg-boss subscription for iee-dev-task. Spec §7.
// IEE dev task handler. IEE (Integrated Execution Environment) scope expands per v1.2. See docs/synthetos-nomenclature.md
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { env } from '../config/env.js';
import { IEEJobPayload } from '../../../shared/iee/jobPayload.js';
import { logger } from '../logger.js';
import { runExecutionLoop } from '../loop/executionLoop.js';
import { loadRun, markRunning, finalizeRun, sumLlmCostForRun } from '../persistence/runs.js';
import { buildDevExecutor } from '../dev/executor.js';

const QUEUE = 'iee-dev-task';

export async function registerDevHandler(boss: PgBoss, workerInstanceId: string): Promise<void> {
  await boss.work(
    QUEUE,
    { teamSize: env.IEE_DEV_CONCURRENCY, teamConcurrency: 1 },
    async (job) => {
      const payload = IEEJobPayload.parse(job.data);

      logger.info('iee.job.received', {
        jobId: job.id,
        type: payload.task.type,
        organisationId: payload.organisationId,
        ieeRunId: payload.executionRunId,
        correlationId: payload.correlationId,
      });

      const run = await loadRun(payload.executionRunId);
      if (!run) {
        logger.warn('iee.job.row_missing', { ieeRunId: payload.executionRunId, jobId: job.id });
        return;
      }

      if (run.status !== 'pending') {
        logger.warn('iee.job.row_not_pending', {
          ieeRunId: run.id,
          status: run.status,
          jobId: job.id,
        });
        return;
      }

      const claimed = await markRunning(run.id, workerInstanceId);
      if (!claimed) {
        logger.warn('iee.job.claim_lost', { ieeRunId: run.id, jobId: job.id });
        return;
      }

      try {
        if (payload.task.type !== 'dev') {
          throw new Error(`dev handler received non-dev task: ${payload.task.type}`);
        }

        const executor = await buildDevExecutor({
          ieeRunId: run.id,
          organisationId: run.organisationId,
          initialCommands: payload.task.commands,
          checks: payload.task.checks,
        });

        const loopResult = await runExecutionLoop({
          ieeRunId: run.id,
          organisationId: run.organisationId,
          subaccountId: run.subaccountId,
          agentId: run.agentId,
          agentRunId: run.agentRunId,
          correlationId: run.correlationId,
          goal: run.goal,
          executor,
          workerInstanceId,
        });

        const llmTotals = await sumLlmCostForRun(run.id);

        await finalizeRun({
          ieeRunId:            run.id,
          status:              loopResult.status,
          failureReason:       loopResult.failureReason,
          resultSummary: {
            ...loopResult.resultSummary,
            llmCostUsd: llmTotals.cents / 100,
            runtimeCostUsd: 0,
          },
          stepCount:           loopResult.stepCount,
          llmCostCents:        llmTotals.cents,
          llmCallCount:        llmTotals.callCount,
          runtimeWallMs:       loopResult.runtime.wallMs,
          runtimeCpuMs:        loopResult.runtime.cpuMs,
          runtimePeakRssBytes: loopResult.runtime.peakRssBytes,
          runtimeCostCents:    0,
        });

        logger.info('iee.execution.complete', {
          ieeRunId: run.id,
          stepCount: loopResult.stepCount,
          totalDurationMs: loopResult.runtime.wallMs,
          success: loopResult.status === 'completed',
          llmCostCents: llmTotals.cents,
        });
      } catch (err) {
        logger.error('iee.job.handler_failed', {
          ieeRunId: run.id,
          jobId: job.id,
          error: err instanceof Error ? err.message : String(err),
        });
        try {
          await finalizeRun({
            ieeRunId:            run.id,
            status:              'failed',
            failureReason:       'unknown',
            resultSummary: {
              success: false,
              output: err instanceof Error ? err.message.slice(0, 500) : 'handler failure',
              stepCount: 0,
              durationMs: 0,
            },
            stepCount:           0,
            llmCostCents:        0,
            llmCallCount:        0,
            runtimeWallMs:       0,
            runtimeCpuMs:        0,
            runtimePeakRssBytes: 0,
            runtimeCostCents:    0,
          });
        } catch {
          // already logged
        }
        throw err;
      }
    },
  );
}
