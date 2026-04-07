// ---------------------------------------------------------------------------
// pg-boss subscription for iee-browser-task. Spec §6.
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { env } from '../config/env.js';
import { handleIEEJob } from './runHandler.js';
import { buildBrowserExecutor } from '../browser/executor.js';
import { IEEJobPayload } from '../../../shared/iee/jobPayload.js';
import { loadRun, markRunning, finalizeRun } from '../persistence/runs.js';
import { logger } from '../logger.js';

const QUEUE = 'iee-browser-task';

export async function registerBrowserHandler(boss: PgBoss, workerInstanceId: string): Promise<void> {
  await boss.work(
    QUEUE,
    { teamSize: env.IEE_BROWSER_CONCURRENCY, teamConcurrency: 1 },
    async (job) => {
      // Spec v3.4 §6.3.1 / T2 — login_test mode short-circuits the LLM loop.
      // We perform the login (via buildBrowserExecutor) and finalize the run
      // as completed. No LLM cost is incurred.
      const parsed = IEEJobPayload.safeParse(job.data);
      if (
        parsed.success &&
        parsed.data.task.type === 'browser' &&
        parsed.data.task.mode === 'login_test'
      ) {
        const payload = parsed.data;
        const task = payload.task as Extract<typeof payload.task, { type: 'browser' }>;
        const run = await loadRun(payload.executionRunId);
        if (!run || run.status !== 'pending') return;
        const claimed = await markRunning(run.id, workerInstanceId);
        if (!claimed) return;
        const startMs = Date.now();
        try {
          const executor = await buildBrowserExecutor({
            ieeRunId: run.id,
            organisationId: run.organisationId,
            subaccountId: run.subaccountId,
            sessionKey: task.sessionKey,
            startUrl: task.startUrl,
            webLoginConnectionId: task.webLoginConnectionId,
            browserTaskContract: task.browserTaskContract,
            mode: 'login_test',
            correlationId: payload.correlationId,
          });
          await executor.dispose();
          await finalizeRun({
            ieeRunId: run.id,
            status: 'completed',
            failureReason: null,
            resultSummary: {
              success: true,
              output: { mode: 'login_test' },
              stepCount: 0,
              durationMs: Date.now() - startMs,
            },
            stepCount: 0,
            llmCostCents: 0,
            llmCallCount: 0,
            runtimeWallMs: Date.now() - startMs,
            runtimeCpuMs: 0,
            runtimePeakRssBytes: 0,
            runtimeCostCents: 0,
          });
          logger.info('iee.login_test.complete', { ieeRunId: run.id });
        } catch (err) {
          await finalizeRun({
            ieeRunId: run.id,
            status: 'failed',
            failureReason: 'auth_failure',
            resultSummary: {
              success: false,
              output: err instanceof Error ? err.message.slice(0, 500) : 'login_test failed',
              stepCount: 0,
              durationMs: Date.now() - startMs,
            },
            stepCount: 0,
            llmCostCents: 0,
            llmCallCount: 0,
            runtimeWallMs: Date.now() - startMs,
            runtimeCpuMs: 0,
            runtimePeakRssBytes: 0,
            runtimeCostCents: 0,
          });
          logger.warn('iee.login_test.failed', {
            ieeRunId: run.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      await handleIEEJob({
        job,
        workerInstanceId,
        buildExecutor: async (run, payload) => {
          if (payload.task.type !== 'browser') {
            throw new Error(`browser handler received non-browser task: ${payload.task.type}`);
          }
          return buildBrowserExecutor({
            ieeRunId: run.id,
            organisationId: run.organisationId,
            subaccountId: run.subaccountId,
            sessionKey: payload.task.sessionKey,
            startUrl: payload.task.startUrl,
            // Spec v3.4 §6 / Code Change D7 — paywall workflow wiring
            webLoginConnectionId: payload.task.webLoginConnectionId,
            browserTaskContract: payload.task.browserTaskContract,
            mode: payload.task.mode,
            correlationId: payload.correlationId,
          });
        },
      });
    },
  );
}
