// ---------------------------------------------------------------------------
// Shared run handler — wires the pg-boss job to the execution loop.
// Used by both browserTask and devTask.
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { IEEJobPayload } from '../../../shared/iee/jobPayload.js';
import { logger } from '../logger.js';
import { runExecutionLoop, type StepExecutor } from '../loop/executionLoop.js';
import { loadRun, markRunning, finalizeRun, sumLlmCostForRun } from '../persistence/runs.js';
import { computeRuntimeCostCents } from '../runtime/cost.js';

export interface HandleJobInput<T> {
  job: PgBoss.Job<T>;
  workerInstanceId: string;
  buildExecutor: (run: { id: string; organisationId: string; subaccountId: string | null }, payload: IEEJobPayload) => Promise<StepExecutor>;
}

export async function handleIEEJob<T>(input: HandleJobInput<T>): Promise<void> {
  const payload = IEEJobPayload.parse(input.job.data);

  logger.info('iee.job.received', {
    jobId: input.job.id,
    type: payload.task.type,
    organisationId: payload.organisationId,
    ieeRunId: payload.executionRunId,
    correlationId: payload.correlationId,
  });

  const run = await loadRun(payload.executionRunId);
  if (!run) {
    logger.warn('iee.job.row_missing', { ieeRunId: payload.executionRunId, jobId: input.job.id });
    return; // ack — nothing to do
  }

  // Defensive guard against pg-boss double-delivery (§2.2 step 4)
  if (run.status !== 'pending') {
    logger.warn('iee.job.row_not_pending', {
      ieeRunId: run.id,
      status: run.status,
      jobId: input.job.id,
    });
    return;
  }

  const claimed = await markRunning(run.id, input.workerInstanceId);
  if (!claimed) {
    logger.warn('iee.job.claim_lost', { ieeRunId: run.id, jobId: input.job.id });
    return;
  }

  let executor: StepExecutor | null = null;
  try {
    executor = await input.buildExecutor(
      { id: run.id, organisationId: run.organisationId, subaccountId: run.subaccountId },
      payload,
    );

    const loopResult = await runExecutionLoop({
      ieeRunId: run.id,
      organisationId: run.organisationId,
      subaccountId: run.subaccountId,
      agentId: run.agentId,
      agentRunId: run.agentRunId,
      correlationId: run.correlationId,
      goal: run.goal,
      executor,
      workerInstanceId: input.workerInstanceId,
    });

    // Aggregate LLM cost from llm_requests rows that landed during the loop
    const llmTotals = await sumLlmCostForRun(run.id);
    const runtimeCostCents = computeRuntimeCostCents(loopResult.runtime);

    await finalizeRun({
      ieeRunId:           run.id,
      status:             loopResult.status,
      failureReason:      loopResult.failureReason,
      resultSummary: {
        ...loopResult.resultSummary,
        llmCostUsd: llmTotals.cents / 100,
        runtimeCostUsd: runtimeCostCents / 100,
      },
      stepCount:          loopResult.stepCount,
      llmCostCents:       llmTotals.cents,
      llmCallCount:       llmTotals.callCount,
      runtimeWallMs:      loopResult.runtime.wallMs,
      runtimeCpuMs:       loopResult.runtime.cpuMs,
      runtimePeakRssBytes: loopResult.runtime.peakRssBytes,
      runtimeCostCents,
    });

    logger.info('iee.execution.complete', {
      ieeRunId: run.id,
      stepCount: loopResult.stepCount,
      totalDurationMs: loopResult.runtime.wallMs,
      success: loopResult.status === 'completed',
      llmCostCents: llmTotals.cents,
      runtimeCostCents,
    });
  } catch (err) {
    // The loop owns its own try/finally and writes terminal status; if we
    // land here it's an unexpected pre-loop or post-loop error. Best-effort
    // mark the run as failed so it doesn't sit in 'running' indefinitely.
    logger.error('iee.job.handler_failed', {
      ieeRunId: run.id,
      jobId: input.job.id,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      await finalizeRun({
        ieeRunId:           run.id,
        status:             'failed',
        failureReason:      'unknown',
        resultSummary: {
          success: false,
          output: err instanceof Error ? err.message.slice(0, 500) : 'handler failure',
          stepCount: 0,
          durationMs: 0,
        },
        stepCount:          0,
        llmCostCents:       0,
        llmCallCount:       0,
        runtimeWallMs:      0,
        runtimeCpuMs:       0,
        runtimePeakRssBytes: 0,
        runtimeCostCents:   0,
      });
    } catch {
      // already logged
    }
    throw err;
  }
}
