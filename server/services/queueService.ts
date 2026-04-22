import { db } from '../db/index.js';
import { executions, executionPayloads, executionFiles, budgetReservations, workflowEngines, users } from '../db/schema/index.js';
import { eq, and, lt, sql } from 'drizzle-orm';
import { emailService } from './emailService.js';
import { webhookService } from './webhookService.js';
import { processResolutionService } from './processResolutionService.js';
import { env } from '../lib/env.js';
import { buildEngineAuthHeaders } from '../lib/engineAuth.js';
import { emitExecutionUpdate, emitSubaccountUpdate } from '../websocket/emitters.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';
import { isNonRetryable, isTimeoutError, getRetryCount, withTimeout } from '../lib/jobErrors.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Simple in-memory queue
// In production this is replaced by pg-boss or bullmq, but the processing
// logic (processExecution) is shared in both cases.
// ---------------------------------------------------------------------------
class SimpleQueue {
  private processing = false;
  private queue: string[] = [];

  async add(executionId: string): Promise<void> {
    this.queue.push(executionId);
    if (!this.processing) {
      this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const executionId = this.queue.shift()!;

    try {
      await processExecution(executionId);
    } catch {
      // Execution processing errors are handled inside processExecution
    }

    setImmediate(() => this.processNext());
  }
}

const simpleQueue = new SimpleQueue();
let queueWorkerReady = false;
const EXECUTION_QUEUE_NAME = 'execution-run';
const WORKFLOW_RESUME_QUEUE = 'workflow-resume';

// ---------------------------------------------------------------------------
// Advisory lock helpers — prevent duplicate maintenance runs across
// horizontally-scaled instances when using the in-memory queue backend.
// pg-boss handles deduplication natively, so locks are only needed for
// the setInterval fallback path.
// ---------------------------------------------------------------------------
const LOCK_ID_CLEANUP_FILES        = 7001;
const LOCK_ID_CLEANUP_RESERVATIONS = 7002;

function serializeError(err: unknown): { message: string; name: string; stack?: string } {
  if (err instanceof Error) {
    return {
      message: err.message,
      name: err.name,
      ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
    };
  }
  return { message: String(err), name: 'UnknownError' };
}

async function withAdvisoryLock(lockId: number, fn: () => Promise<void>): Promise<void> {
  const result = await db.execute(sql`SELECT pg_try_advisory_lock(${lockId}) AS acquired`);
  const acquired = (Array.from(result)[0] as { acquired?: boolean } | undefined)?.acquired;
  if (!acquired) return; // another instance is running this job
  try {
    await fn();
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockId})`);
  }
}

async function getQueueBackend() {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    return {
      enqueue: async (executionId: string) => simpleQueue.add(executionId),
      kind: 'in-memory' as const,
    };
  }

  const boss = await getPgBoss();

  if (!queueWorkerReady) {
    await (boss as any).work(EXECUTION_QUEUE_NAME, { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
      const retryCount = getRetryCount(job);
      if (retryCount > 0) {
        logger.warn('job_retry', { queue: EXECUTION_QUEUE_NAME, jobId: job.id, retryCount });
      }
      try {
        const executionId = String(job.data.executionId ?? '');
        if (!executionId) return;
        await withTimeout(processExecution(executionId), 570_000); // 600 - 30
      } catch (err) {
        if (isNonRetryable(err)) {
          logger.error('job_non_retryable_failure', { queue: EXECUTION_QUEUE_NAME, jobId: job.id, error: String(err) });
          await (boss as any).fail(job.id);
          return;
        }
        if (isTimeoutError(err)) {
          logger.error('job_timeout', { queue: EXECUTION_QUEUE_NAME, jobId: job.id, retryCount });
        }
        throw err;
      }
    });
    queueWorkerReady = true;
  }

  return {
    enqueue: async (executionId: string) => {
      await boss.send(EXECUTION_QUEUE_NAME, { executionId }, getJobConfig('execution-run'));
    },
    send: async (queue: string, data: object) => {
      return boss.send(queue, data);
    },
    kind: 'pg-boss' as const,
  };
}

// ---------------------------------------------------------------------------
// Core execution processor
// ---------------------------------------------------------------------------
async function processExecution(executionId: string): Promise<void> {
  const [execution] = await db
    .select()
    .from(executions)
    .where(eq(executions.id, executionId));

  if (!execution) return;

  // Mark as running
  await db
    .update(executions)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(executions.id, executionId));

  emitExecutionUpdate(executionId, 'execution:status', { status: 'running' });
  if (execution.subaccountId) {
    emitSubaccountUpdate(execution.subaccountId, 'execution:status_changed', {
      executionId, status: 'running',
    });
  }

  // H-5: process snapshot lives in execution_payloads
  const [payloadRow] = await db
    .select({ processSnapshot: executionPayloads.processSnapshot })
    .from(executionPayloads)
    .where(eq(executionPayloads.executionId, executionId));
  const processSnapshot = payloadRow?.processSnapshot as Record<string, unknown> | null ?? null;
  if (!processSnapshot) {
    await db
      .update(executions)
      .set({ status: 'failed', errorMessage: 'Process configuration not found', updatedAt: new Date() })
      .where(eq(executions.id, executionId));
    return;
  }

  // ------------------------------------------------------------------
  // Resolve execution context via the three-level framework.
  // If subaccountId is set, use processResolutionService for full
  // connection/engine/config resolution. Otherwise fall back to legacy.
  // ------------------------------------------------------------------
  let engine: { id: string; baseUrl: string; engineType: string; apiKey: string | null; hmacSecret: string } | null = null;
  let authPayload: Record<string, { access_token: string }> | undefined;
  let resolvedConfig: Record<string, unknown> | undefined;
  let resolvedConnections: Record<string, unknown> | undefined;

  if (execution.subaccountId && execution.organisationId) {
    try {
      const context = await processResolutionService.resolveForExecution(
        execution.processId,
        execution.subaccountId,
        execution.organisationId,
        (execution.resolvedConfig as Record<string, unknown>) ?? undefined
      );
      engine = context.engine;
      resolvedConfig = context.config;
      resolvedConnections = context.connectionSnapshot;

      // Build auth payload from resolved connections
      if (Object.keys(context.connections).length > 0) {
        authPayload = {};
        for (const [key, conn] of Object.entries(context.connections)) {
          authPayload[key] = { access_token: conn.token };
        }
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      await db.update(executions)
        .set({ status: 'failed', errorMessage: e.message ?? 'Process resolution failed', updatedAt: new Date() })
        .where(eq(executions.id, executionId));
      return;
    }
  } else {
    // Legacy path: look up engine from process snapshot
    const [legacyEngine] = await db.select()
      .from(workflowEngines)
      .where(and(
        eq(workflowEngines.id, processSnapshot.workflowEngineId as string),
        eq(workflowEngines.organisationId, execution.organisationId),
      ));

    if (!legacyEngine) {
      await db.update(executions)
        .set({ status: 'failed', errorMessage: 'Workflow engine not found', updatedAt: new Date() })
        .where(eq(executions.id, executionId));
      return;
    }
    engine = legacyEngine;
  }

  // Build return URL with per-engine HMAC
  const returnWebhookUrl = webhookService.buildReturnUrl(executionId, engine.hmacSecret);
  const outboundPayload = await webhookService.buildOutboundPayload(
    executionId,
    execution.inputData,
    returnWebhookUrl,
    { auth: authPayload, config: resolvedConfig, processId: execution.processId }
  );

  // Persist audit trail (with auth redacted) BEFORE calling the engine
  const auditPayload = webhookService.redactPayloadForAudit(outboundPayload);
  await db
    .update(executions)
    .set({
      returnWebhookUrl,
      engineId: engine.id,
      resolvedConnections: resolvedConnections as unknown as Record<string, unknown> ?? null,
      resolvedConfig: resolvedConfig as unknown as Record<string, unknown> ?? null,
      updatedAt: new Date(),
    })
    .where(eq(executions.id, executionId));

  // H-5: persist outbound audit payload into execution_payloads
  await db
    .insert(executionPayloads)
    .values({ executionId, outboundPayload: auditPayload as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: executionPayloads.executionId,
      set: { outboundPayload: auditPayload as unknown as Record<string, unknown> },
    });

  const start = Date.now();
  let retryCount = 0;
  const maxRetries = 3;

  // Build engine-specific auth headers + HMAC signature
  const authHeaders = buildEngineAuthHeaders(engine.engineType, engine.apiKey ?? undefined);
  const hmacSignature = webhookService.signOutboundRequest(executionId, engine.hmacSecret);

  while (retryCount <= maxRetries) {
    try {
      const baseUrl = (engine.baseUrl ?? '').replace(/\/$/, '');
      const webhookPath = (processSnapshot.webhookPath as string) ?? '';
      const fullEndpointUrl = `${baseUrl}${webhookPath}`;

      const response = await fetch(fullEndpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': hmacSignature,
          ...authHeaders,
        },
        body: JSON.stringify(outboundPayload),
        signal: AbortSignal.timeout(30_000),
      });

      const durationMs = Date.now() - start;
      let outputData: unknown = null;
      try {
        outputData = await response.json();
      } catch {
        outputData = null;
      }

      const successful = response.ok;
      await db
        .update(executions)
        .set({
          status: successful ? 'completed' : 'failed',
          outputData: successful ? outputData : null,
          errorMessage: successful ? null : `Engine response status ${response.status}`,
          errorDetail: successful ? null : ({ responseStatus: response.status, responseBody: outputData } as Record<string, unknown>),
          completedAt: new Date(),
          durationMs,
          retryCount,
          updatedAt: new Date(),
        })
        .where(eq(executions.id, executionId));

      // Emit real-time status update
      emitExecutionUpdate(executionId, 'execution:status', {
        status: successful ? 'completed' : 'failed',
        outputData: successful ? outputData : null,
        errorMessage: successful ? null : `Engine response status ${response.status}`,
        durationMs,
      });
      if (execution.subaccountId) {
        emitSubaccountUpdate(execution.subaccountId, 'execution:status_changed', {
          executionId, status: successful ? 'completed' : 'failed',
        });
      }

      // Send completion notification only if user opted in
      if (execution.notifyOnComplete && execution.triggeredByUserId) {
        try {
          const [user] = await db.select().from(users).where(eq(users.id, execution.triggeredByUserId));
          if (user) {
            await emailService.sendExecutionCompletionEmail(
              user.email,
              processSnapshot.name as string,
              executionId,
              successful ? 'completed' : 'failed'
            );
          }
        } catch {
          /* Email failures don't affect execution */
        }
      }

      return;
    } catch (err: unknown) {
      const isNetworkError = err instanceof TypeError;
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';

      if (isTimeout) {
        await db
          .update(executions)
          .set({
            status: 'timeout',
            errorMessage: `Execution timed out after 30 seconds`,
            completedAt: new Date(),
            durationMs: Date.now() - start,
            retryCount,
            updatedAt: new Date(),
          })
          .where(eq(executions.id, executionId));

        emitExecutionUpdate(executionId, 'execution:status', {
          status: 'timeout', errorMessage: 'Execution timed out after 30 seconds',
          durationMs: Date.now() - start,
        });
        if (execution.subaccountId) {
          emitSubaccountUpdate(execution.subaccountId, 'execution:status_changed', {
            executionId, status: 'timeout',
          });
        }
        return;
      }

      if (isNetworkError && retryCount < maxRetries) {
        retryCount++;
        await db
          .update(executions)
          .set({ retryCount, updatedAt: new Date() })
          .where(eq(executions.id, executionId));
        await new Promise((r) => setTimeout(r, 1000 * retryCount));
        continue;
      }

      const errorMessage = err instanceof Error ? err.message : 'Execution failed';
      await db
        .update(executions)
        .set({
          status: 'failed',
          errorMessage,
          errorDetail: { error: errorMessage, retryCount } as unknown as Record<string, unknown>,
          completedAt: new Date(),
          durationMs: Date.now() - start,
          retryCount,
          updatedAt: new Date(),
        })
        .where(eq(executions.id, executionId));

      emitExecutionUpdate(executionId, 'execution:status', {
        status: 'failed', errorMessage, durationMs: Date.now() - start,
      });
      if (execution.subaccountId) {
        emitSubaccountUpdate(execution.subaccountId, 'execution:status_changed', {
          executionId, status: 'failed',
        });
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Exported queue service
// ---------------------------------------------------------------------------
export const queueService = {
  async enqueueExecution(executionId: string): Promise<void> {
    // Stamp the queuedAt time when the job enters the queue
    await db
      .update(executions)
      .set({ queuedAt: new Date(), updatedAt: new Date() })
      .where(eq(executions.id, executionId));

    const backend = await getQueueBackend();
    await backend.enqueue(executionId);
  },

  /**
   * Generic job enqueue — used by event-driven follow-on jobs (e.g. the
   * ClientPulse intervention proposer that fires after compute_churn_risk).
   * Thin wrapper over the backend's send method so callers don't need to
   * reach into getQueueBackend() directly.
   */
  async sendJob(queueName: string, data: object): Promise<void> {
    if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
      // In-memory backend used in tests / dev has no named-queue routing;
      // silently no-op so calling code stays the same.
      return;
    }
    const boss = await getPgBoss();
    await boss.send(queueName, data);
  },

  /**
   * M-17: Delete expired execution_files rows.
   */
  async cleanupExpiredExecutionFiles(): Promise<number> {
    const result = await db
      .delete(executionFiles)
      .where(lt(executionFiles.expiresAt, new Date()));
    const count = (result as unknown as { rowCount?: number })?.rowCount ?? 0;
    if (count > 0) console.log(JSON.stringify({ event: 'maintenance:cleanup_execution_files', rows_deleted: count }));
    return count;
  },

  /**
   * M-18: Release stale budget_reservations left in 'active' status.
   * Reservations expire after 5 minutes if the billing flow crashes.
   * Mark them as 'released' so they no longer inflate projected spend.
   */
  async cleanupExpiredBudgetReservations(): Promise<number> {
    const result = await db
      .update(budgetReservations)
      .set({ status: 'released' })
      .where(
        sql`${budgetReservations.status} = 'active' AND ${budgetReservations.expiresAt} < NOW()`
      );
    const count = (result as unknown as { rowCount?: number })?.rowCount ?? 0;
    if (count > 0) console.log(JSON.stringify({ event: 'maintenance:release_budget_reservations', rows_released: count }));
    return count;
  },

  /**
   * Enqueue a workflow resume job. Called from the approval handler when an
   * action that was created by a workflow step (identified by workflowRunId
   * in the action's metadataJson) is approved.
   *
   * Falls back to direct synchronous resume if pg-boss is not available.
   */
  async enqueueWorkflowResume(params: {
    workflowRunId: string;
    approvedActionId?: string;
    organisationId: string;
    subaccountId: string;
    agentId: string;
    agentRunId?: string;
  }): Promise<void> {
    if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
      const boss = await getPgBoss();
      await boss.send(WORKFLOW_RESUME_QUEUE, params, getJobConfig('workflow-resume'));
      return;
    }

    // Synchronous fallback — resume inline (no restart resilience, but functional)
    const { resumeWorkflow } = await import('./workflowExecutorService.js');
    resumeWorkflow(params.workflowRunId, {
      organisationId: params.organisationId,
      subaccountId: params.subaccountId,
      agentId: params.agentId,
      agentRunId: params.agentRunId,
    }, params.approvedActionId).catch((err) => {
      console.error('[WorkflowResume] Inline resume failed', err);
    });
  },

  /**
   * Sprint 2 P1.2 — enqueue a regression-capture job for a rejected
   * review item. Best-effort: uses pg-boss when available, falls back
   * to an in-process call when the backend is in-memory. Failures are
   * logged, not rethrown — the caller (reviewService.rejectItem) must
   * not fail the user's rejection on a capture error.
   */
  async enqueueRegressionCapture(params: {
    reviewItemId: string;
    organisationId: string;
  }): Promise<void> {
    try {
      if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
        const boss = await getPgBoss();
        await boss.send('regression-capture', params, getJobConfig('regression-capture'));
        return;
      }

      // In-memory fallback — run the capture inline so in-memory
      // deployments still accumulate cases. Fire-and-forget with a
      // catch so the rejection flow never sees a capture failure.
      const { captureRegressionFromRejection } = await import(
        './regressionCaptureService.js'
      );
      captureRegressionFromRejection(params).catch((err) => {
        console.error(
          JSON.stringify({
            event: 'regression_capture_inline_failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'regression_capture_enqueue_failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  },

  /**
   * Start periodic maintenance jobs.
   * Uses pg-boss scheduled workers when available, otherwise falls back to
   * in-process setInterval guarded by pg advisory locks to prevent duplicate
   * runs across horizontally-scaled instances. Call once at application startup.
   */
  async startMaintenanceJobs(): Promise<void> {
    const backend = await getQueueBackend();

    if (backend.kind === 'pg-boss') {
      const boss = await getPgBoss();

      // pg-boss deduplicates across instances natively — no advisory lock needed
      await (boss as any).work('maintenance:cleanup-execution-files', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          await withTimeout(
            queueService.cleanupExpiredExecutionFiles().then(() => undefined),
            270_000,
          );
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:cleanup-execution-files', jobId: job.id });
          }
          throw err;
        }
      });
      await (boss as any).work('maintenance:cleanup-budget-reservations', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          await withTimeout(
            queueService.cleanupExpiredBudgetReservations().then(() => undefined),
            90_000,
          );
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:cleanup-budget-reservations', jobId: job.id });
          }
          throw err;
        }
      });
      await (boss as any).work('maintenance:memory-decay', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryDecay } = await import('../jobs/memoryDecayJob.js');
          await withTimeout(runMemoryDecay(), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:memory-decay', jobId: job.id });
          }
          throw err;
        }
      });
      // Sprint 2 P1.1 Layer 3 — tool_call_security_events retention pruner.
      // Admin-bypass sweep that opens its own tx via withAdminConnection.
      await (boss as any).work('maintenance:security-events-cleanup', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runSecurityEventsCleanup } = await import('../jobs/securityEventsCleanupJob.js');
          await withTimeout(runSecurityEventsCleanup().then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:security-events-cleanup', jobId: job.id });
          }
          throw err;
        }
      });
      // Universal Brief Phase 3 — fast_path_decisions 90-day retention pruner.
      await (boss as any).work('maintenance:fast-path-decisions-prune', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { pruneFastPathDecisions } = await import('../jobs/fastPathDecisionsPruneJob.js');
          await withTimeout(pruneFastPathDecisions().then(() => undefined), 120_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:fast-path-decisions-prune', jobId: job.id });
          }
          throw err;
        }
      });
      // Universal Brief Phase 6 — nightly rule quality decay + auto-deprecation.
      await (boss as any).work('maintenance:rule-auto-deprecate', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runRuleAutoDeprecate } = await import('../jobs/ruleAutoDeprecateJob.js');
          await withTimeout(runRuleAutoDeprecate().then(() => undefined), 300_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:rule-auto-deprecate', jobId: job.id });
          }
          throw err;
        }
      });
      // Universal Brief Phase 3 — nightly recalibration log for classifier drift detection.
      await (boss as any).work('maintenance:fast-path-recalibrate', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runFastPathRecalibrate } = await import('../jobs/fastPathRecalibrateJob.js');
          await withTimeout(runFastPathRecalibrate().then(() => undefined), 60_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:fast-path-recalibrate', jobId: job.id });
          }
          throw err;
        }
      });
      // LLM observability spec §12 — nightly llm_requests retention sweep.
      // Moves rows older than env.LLM_LEDGER_RETENTION_MONTHS (default 12)
      // to llm_requests_archive in 10k-row chunks. Bounded transaction size;
      // FOR UPDATE SKIP LOCKED makes concurrent runs safe.
      await (boss as any).work('maintenance:llm-ledger-archive', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { archiveOldLedgerRows } = await import('../jobs/llmLedgerArchiveJob.js');
          await withTimeout(archiveOldLedgerRows().then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:llm-ledger-archive', jobId: job.id });
          }
          throw err;
        }
      });

      // Deferred-items brief §1 — reap aged-out provisional `'started'` rows
      // so a crashed mid-write doesn't permanently block retries under the
      // same idempotencyKey. Cadence: every 2 minutes. Telescopes with the
      // in-memory registry sweep (30s past timeoutMs) — this is the
      // durable-layer backstop (providerTimeoutMs + 60s).
      await (boss as any).work('maintenance:llm-started-row-sweep', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { sweepExpiredStartedRows } = await import('../jobs/llmStartedRowSweepJob.js');
          await withTimeout(sweepExpiredStartedRows().then(() => undefined), 110_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:llm-started-row-sweep', jobId: job.id });
          }
          throw err;
        }
      });

      // Deferred-items brief §6 — purge llm_inflight_history rows older
      // than env.LLM_INFLIGHT_HISTORY_RETENTION_DAYS (default 7).
      await (boss as any).work('maintenance:llm-inflight-history-cleanup', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { cleanOldInflightHistoryRows } = await import('../jobs/llmInflightHistoryCleanupJob.js');
          await withTimeout(cleanOldInflightHistoryRows().then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:llm-inflight-history-cleanup', jobId: job.id });
          }
          throw err;
        }
      });

      // Sprint 3 P2.1 Sprint 3A — agent_runs retention pruner. Admin-bypass
      // sweep that opens its own tx via withAdminConnection. Cascade on
      // agent_run_snapshots + agent_run_messages removes child rows.
      await (boss as any).work('agent-run-cleanup', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runAgentRunCleanupTick } = await import('../jobs/agentRunCleanupJob.js');
          await withTimeout(runAgentRunCleanupTick().then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'agent-run-cleanup', jobId: job.id });
          }
          throw err;
        }
      });

      await (boss as any).work('priority-feed-cleanup', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runPriorityFeedCleanup } = await import('../jobs/priorityFeedCleanupJob.js');
          await withTimeout(runPriorityFeedCleanup().then(() => undefined), 300_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'priority-feed-cleanup', jobId: job.id });
          }
          throw err;
        }
      });

      // Agent Intelligence Phase 2B — memory dedup daily sweep
      await (boss as any).work('maintenance:memory-dedup', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryDedup } = await import('../jobs/memoryDedupJob.js');
          await withTimeout(runMemoryDedup(), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:memory-dedup', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 1 — nightly memory entry quality decay + prune (S1)
      await (boss as any).work('maintenance:memory-entry-decay', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryEntryDecay } = await import('../jobs/memoryEntryDecayJob.js');
          const queueSend = (queue: string, data: object) => boss.send(queue, data);
          await withTimeout(runMemoryEntryDecay(queueSend).then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:memory-entry-decay', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 1 — one-shot HNSW reindex after large prune (S1)
      await (boss as any).work('memory-hnsw-reindex', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryHnswReindex } = await import('../jobs/memoryHnswReindexJob.js');
          await withTimeout(runMemoryHnswReindex(job.data), 300_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'memory-hnsw-reindex', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 2 — one-shot memory-blocks embedding backfill (S6)
      await (boss as any).work('memory-blocks-embedding-backfill', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryBlocksEmbeddingBackfill } = await import('../jobs/memoryBlocksEmbeddingBackfillJob.js');
          await withTimeout(runMemoryBlocksEmbeddingBackfill(), 600_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'memory-blocks-embedding-backfill', jobId: job.id });
          }
          throw err;
        }
      });
      // Enqueue the backfill exactly once. singletonKey prevents re-enqueue on
      // server restart if the job is still pending or already completed.
      await (boss as any).send('memory-blocks-embedding-backfill', {}, {
        singletonKey: 'memory-blocks-embedding-backfill-v1',
        retryLimit: 2,
        retryDelay: 60,
      });

      // Memory & Briefings Phase 2 — clarification timeout sweep (S8)
      await (boss as any).work('maintenance:clarification-timeout-sweep', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runClarificationTimeoutSweep } = await import('../jobs/clarificationTimeoutJob.js');
          await withTimeout(runClarificationTimeoutSweep(), 60_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:clarification-timeout-sweep', jobId: job.id });
          }
          throw err;
        }
      });

      // IEE Phase 0 — main-app reconciliation for "Class 2" stuck runs.
      // See docs/iee-delegation-lifecycle-spec.md Step 4. The worker-side
      // cleanup-orphans sweep already handles Class 1 (unemitted events) and
      // Class 3 (worker death). This sweep catches the remaining case: a
      // parent agent_run stuck in 'delegated' while its iee_runs row is
      // already terminal (event handler crashed post-DB-write, or DLQ
      // exhaustion).
      await (boss as any).work('maintenance:iee-main-app-reconciliation', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { reconcileStuckDelegatedRuns } = await import('./agentRunFinalizationService.js');
          await withTimeout(reconcileStuckDelegatedRuns().then(() => undefined), 60_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:iee-main-app-reconciliation', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 2 — weekly quality-adjust job (S4, feature-flagged)
      await (boss as any).work('maintenance:memory-entry-quality-adjust', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryEntryQualityAdjust } = await import('../jobs/memoryEntryQualityAdjustJob.js');
          await withTimeout(runMemoryEntryQualityAdjust().then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:memory-entry-quality-adjust', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 4 — weekly memory-block synthesis (S11)
      await (boss as any).work('maintenance:memory-block-synthesis', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryBlockSynthesisSweep } = await import('../jobs/memoryBlockSynthesisJob.js');
          await withTimeout(runMemoryBlockSynthesisSweep().then(() => undefined), 900_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:memory-block-synthesis', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 4 — portfolio briefing + digest rollups (S23)
      await (boss as any).work('maintenance:portfolio-briefing', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runPortfolioRollupSweep } = await import('../jobs/portfolioRollupJob.js');
          await withTimeout(runPortfolioRollupSweep({ kind: 'briefing' }).then(() => undefined), 900_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:portfolio-briefing', jobId: job.id });
          }
          throw err;
        }
      });

      await (boss as any).work('maintenance:portfolio-digest', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runPortfolioRollupSweep } = await import('../jobs/portfolioRollupJob.js');
          await withTimeout(runPortfolioRollupSweep({ kind: 'digest' }).then(() => undefined), 900_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:portfolio-digest', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 5 — daily protected-block divergence sweep (S24)
      await (boss as any).work('maintenance:protected-block-divergence', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runDivergenceSweep } = await import('../services/protectedBlockDivergenceService.js');
          await withTimeout(runDivergenceSweep().then(() => undefined), 120_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:protected-block-divergence', jobId: job.id });
          }
          throw err;
        }
      });

      // Agent Intelligence Phase 2D — agent briefing update (event-driven)
      await (boss as any).work('agent-briefing-update', { teamSize: 2, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runAgentBriefingUpdate } = await import('../jobs/agentBriefingJob.js');
          await withTimeout(runAgentBriefingUpdate(job.data), 110_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'agent-briefing-update', jobId: job.id });
          }
          throw err;
        }
      });

      // ClientPulse Phase 4 — scenario-detector proposer (event-driven, fires
      // at the tail of compute_churn_risk per sub-account).
      await (boss as any).work('clientpulse:propose-interventions', { teamSize: 2, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runProposeClientPulseInterventions } = await import('../jobs/proposeClientPulseInterventionsJob.js');
          await withTimeout(
            runProposeClientPulseInterventions(job.data).then(() => undefined),
            60_000,
          );
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'clientpulse:propose-interventions', jobId: job.id });
          }
          throw err;
        }
      });

      // ClientPulse Phase 4 — hourly outcome-measurement sweep (B2 ship gate).
      await (boss as any).work('clientpulse:measure-outcomes', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMeasureInterventionOutcomes } = await import('../jobs/measureInterventionOutcomeJob.js');
          await withTimeout(
            runMeasureInterventionOutcomes().then(() => undefined),
            300_000,
          );
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'clientpulse:measure-outcomes', jobId: job.id });
          }
          throw err;
        }
      });


      // Sprint 2 P1.2 — HITL rejection → regression capture. Uses
      // createWorker so the handler runs inside the org-scoped tx +
      // ALS context pulled from job.data.organisationId.
      const { createWorker } = await import('../lib/createWorker.js');
      await createWorker<{
        reviewItemId: string;
        organisationId: string;
      }>({
        queue: 'regression-capture',
        boss: boss as any,
        handler: async (job) => {
          const { captureRegressionFromRejection } = await import(
            './regressionCaptureService.js'
          );
          const result = await captureRegressionFromRejection({
            reviewItemId: job.data.reviewItemId,
            organisationId: job.data.organisationId,
          });
          console.info(
            JSON.stringify({
              event: 'regression_capture_done',
              jobId: job.id,
              status: result.status,
              regressionCaseId: result.regressionCaseId ?? null,
              reason: result.reason ?? null,
            }),
          );
        },
      });

      // Sprint 2 P1.2 — nightly regression replay tick. Admin-bypass
      // (cross-org sweep), so resolveOrgContext returns null and the
      // handler uses withAdminConnection internally.
      await createWorker<Record<string, never>>({
        queue: 'regression-replay-tick',
        boss: boss as any,
        resolveOrgContext: () => null,
        handler: async () => {
          const { runRegressionReplayTick } = await import(
            '../jobs/regressionReplayJob.js'
          );
          await runRegressionReplayTick();
        },
      });

      // Workflow resume worker — DB-backed, survives process restarts
      await (boss as any).work(WORKFLOW_RESUME_QUEUE, { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        const retryCount = getRetryCount(job);
        if (retryCount > 0) {
          logger.warn('job_retry', { queue: WORKFLOW_RESUME_QUEUE, jobId: job.id, retryCount });
        }
        try {
          const { workflowRunId, approvedActionId, organisationId, subaccountId, agentId, agentRunId } =
            job.data as {
              workflowRunId: string;
              approvedActionId?: string;
              organisationId: string;
              subaccountId: string;
              agentId: string;
              agentRunId?: string;
            };

          const { resumeWorkflow } = await import('./workflowExecutorService.js');
          await withTimeout(
            resumeWorkflow(workflowRunId, { organisationId, subaccountId, agentId, agentRunId }, approvedActionId),
            270_000, // 300 - 30
          );
        } catch (err) {
          if (isNonRetryable(err)) {
            logger.error('job_non_retryable_failure', { queue: WORKFLOW_RESUME_QUEUE, jobId: job.id, error: String(err) });
            await (boss as any).fail(job.id);
            return;
          }
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: WORKFLOW_RESUME_QUEUE, jobId: job.id, retryCount });
          }
          throw err;
        }
      });

      // Context enrichment worker (Phase B1) — async embedding context generation
      await (boss as any).work('memory-context-enrichment', { teamSize: 3, teamConcurrency: 1 }, async (job: any) => {
        const retryCount = getRetryCount(job);
        if (retryCount > 0) {
          logger.warn('job_retry', { queue: 'memory-context-enrichment', jobId: job.id, retryCount });
        }
        try {
          const { processContextEnrichment } = await import('./workspaceMemoryService.js');
          await withTimeout(
            processContextEnrichment(job.data),
            90_000,
          );
        } catch (err) {
          if (isNonRetryable(err)) {
            logger.error('job_non_retryable_failure', { queue: 'memory-context-enrichment', jobId: job.id, error: String(err) });
            await (boss as any).fail(job.id);
            return;
          }
          throw err;
        }
      });

      await boss.schedule('maintenance:cleanup-execution-files',  '0 * * * *',   {});
      await boss.schedule('maintenance:cleanup-budget-reservations', '*/5 * * * *', {});
      await boss.schedule('maintenance:memory-decay', '0 3 * * *', {}); // 3am daily
      await boss.schedule('maintenance:security-events-cleanup', '30 3 * * *', {}); // 3:30am daily
      // Universal Brief Phase 3 — fast_path_decisions 90-day retention pruner + recalibrator
      await boss.schedule('maintenance:fast-path-decisions-prune', '30 3 * * *', {}); // 3:30am UTC daily
      await boss.schedule('maintenance:fast-path-recalibrate', '0 4 * * *', {}); // 4am UTC daily
      await boss.schedule('maintenance:rule-auto-deprecate', '0 3 * * *', {}); // 3am UTC daily
      // LLM observability spec §12 — retention archival at 03:45 UTC so it
      // runs after the 03:00 memory-decay and 03:30 security-events sweeps
      // without contending on the same connection pool.
      await boss.schedule('maintenance:llm-ledger-archive', '45 3 * * *', {});
      // Deferred-items brief §1 — reap aged-out provisional 'started' rows
      // every 2 minutes. Cadence matches the in-flight clarification sweep.
      await boss.schedule('maintenance:llm-started-row-sweep', '*/2 * * * *', {});
      // Deferred-items brief §6 — daily 04:15 UTC cleanup of
      // llm_inflight_history rows older than the retention window.
      await boss.schedule('maintenance:llm-inflight-history-cleanup', '15 4 * * *', {});
      // Sprint 3 P2.1 Sprint 3A — daily agent_runs retention prune at
      // 04:00 UTC. Staggered out of the 03:00 slot so memory-decay has
      // a clean shot at the same per-org row set without contending on
      // the same connection pool — the cleanup sweep is admin-bypass +
      // cross-org and can briefly hold longer locks.
      await boss.schedule('agent-run-cleanup', '0 4 * * *', {});
      await boss.schedule('regression-replay-tick', '0 4 * * 0', {}); // 4am every Sunday
      await boss.schedule('priority-feed-cleanup', '0 5 * * *', {}); // 5am daily
      await boss.schedule('maintenance:memory-dedup', '30 4 * * *', {}); // 4:30am daily
      // Memory & Briefings Phase 1 — nightly quality decay + prune (5:30am daily)
      await boss.schedule('maintenance:memory-entry-decay', '30 5 * * *', {});
      // Memory & Briefings Phase 2 — clarification timeout sweep (every 2 minutes)
      await boss.schedule('maintenance:clarification-timeout-sweep', '*/2 * * * *', {});
      // IEE Phase 0 — main-app reconciliation for stuck 'delegated' runs (every 2 minutes)
      await boss.schedule('maintenance:iee-main-app-reconciliation', '*/2 * * * *', {});
      // Memory & Briefings Phase 2 — weekly quality adjust (S4, Sun 05:45)
      await boss.schedule('maintenance:memory-entry-quality-adjust', '45 5 * * 0', {});
      // Memory & Briefings Phase 4 — weekly memory-block synthesis (Sun 06:00)
      await boss.schedule('maintenance:memory-block-synthesis', '0 6 * * 0', {});
      // Memory & Briefings Phase 4 — portfolio briefing (Mon 08:00) + digest (Fri 18:00)
      await boss.schedule('maintenance:portfolio-briefing', '0 8 * * 1', {});
      await boss.schedule('maintenance:portfolio-digest', '0 18 * * 5', {});
      // Memory & Briefings Phase 5 — daily protected-block divergence sweep (4am)
      await boss.schedule('maintenance:protected-block-divergence', '0 4 * * *', {});
      // ClientPulse Phase 4 — hourly outcome-measurement cron (B2 ship gate).
      await boss.schedule('clientpulse:measure-outcomes', '7 * * * *', {});

      // ClientPulse — trial expiry check (6am daily)
      await boss.schedule('subscription-trial-check', '0 6 * * *', {});
      await (boss as any).work('subscription-trial-check', { teamSize: 1, teamConcurrency: 1 }, async () => {
        try {
          const { subscriptionService } = await import('./subscriptionService.js');
          const expired = await subscriptionService.getExpiredTrials();
          for (const sub of expired) {
            await subscriptionService.expireTrial(sub.id);
            console.log(JSON.stringify({ event: 'trial_expired', orgSubscriptionId: sub.id, organisationId: sub.organisationId }));
          }
        } catch (err) {
          console.error(JSON.stringify({ event: 'subscription-trial-check:error', error: String(err) }));
          throw err;
        }
      });

      // Feature 4 — Slack inbound message processing (event-driven, no schedule)
      await (boss as any).work('slack-inbound', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 2 }, async (job: any) => {
        try {
          const { processSlackInbound } = await import('../jobs/slackInboundJob.js');
          await withTimeout(processSlackInbound(job.data).then(() => undefined), 120_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'slack-inbound', jobId: job.id });
          }
          throw err;
        }
      });

      // Orchestrator capability-aware routing (docs/orchestrator-capability-routing-spec.md §7)
      // — processes task-created events that pass the eligibility predicate.
      {
        const { ORCHESTRATOR_FROM_TASK_QUEUE, setOrchestratorJobSender } = await import('../jobs/orchestratorFromTaskJob.js');
        setOrchestratorJobSender((name, data) => boss.send(name, data));
        await (boss as any).work(ORCHESTRATOR_FROM_TASK_QUEUE, { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 4 }, async (job: any) => {
          try {
            const { processOrchestratorFromTask } = await import('../jobs/orchestratorFromTaskJob.js');
            await withTimeout(processOrchestratorFromTask(job.data).then(() => undefined), 180_000);
          } catch (err) {
            if (isTimeoutError(err)) {
              logger.error('job_timeout', { queue: ORCHESTRATOR_FROM_TASK_QUEUE, jobId: job.id });
            }
            throw err;
          }
        });
      }

      // Canonical Data Platform P1 — connector polling tick (every-minute cron).
      // Cross-org sweep: selects connections due for sync across all orgs and
      // fan-outs one connector-polling-sync job per connection via boss.send().
      // Admin-bypass: resolveOrgContext → null (no org-scoped tx).
      await createWorker<Record<string, never>>({
        queue: 'connector-polling-tick',
        boss: boss as any,
        resolveOrgContext: () => null,
        handler: async () => {
          const { runConnectorPollingTick } = await import('../jobs/connectorPollingTick.js');
          await runConnectorPollingTick(boss as any);
        },
      });
      await boss.schedule('connector-polling-tick', '* * * * *', {});

      // Canonical Data Platform P1 — per-connection sync job (on-demand)
      // Acquires a lease, runs the adapter, records ingestion stats.
      await createWorker<{
        organisationId: string;
        connectionId: string;
      }>({
        queue: 'connector-polling-sync',
        boss: boss as any,
        handler: async (job) => {
          const { runConnectorPollingSync } = await import('../jobs/connectorPollingSync.js');
          await runConnectorPollingSync(job.data);
        },
      });

      console.log(JSON.stringify({ event: 'maintenance:started', mode: 'pg-boss' }));
    } else {
      // In-memory queue: setInterval + advisory locks prevent duplicate runs
      setInterval(async () => {
        await withAdvisoryLock(LOCK_ID_CLEANUP_FILES, () =>
          queueService.cleanupExpiredExecutionFiles().then(() => undefined)
        ).catch((err: unknown) => {
          console.error(JSON.stringify({ event: 'maintenance:cleanup_execution_files_error', ...serializeError(err) }));
        });
      }, 60 * 60 * 1000); // every hour

      setInterval(async () => {
        await withAdvisoryLock(LOCK_ID_CLEANUP_RESERVATIONS, () =>
          queueService.cleanupExpiredBudgetReservations().then(() => undefined)
        ).catch((err: unknown) => {
          console.error(JSON.stringify({ event: 'maintenance:cleanup_reservations_error', ...serializeError(err) }));
        });
      }, 5 * 60 * 1000); // every 5 minutes

      setInterval(async () => {
        const { runMemoryDecay } = await import('../jobs/memoryDecayJob.js');
        runMemoryDecay().catch((err: unknown) => {
          console.error(JSON.stringify({ event: 'maintenance:memory_decay_error', ...serializeError(err) }));
        });
      }, 24 * 60 * 60 * 1000); // daily

      // Sprint 2 P1.1 Layer 3 — security event retention sweep in the
      // in-memory fallback. Admin-bypass job, no advisory lock needed
      // because there's only one instance in in-memory mode by definition.
      setInterval(async () => {
        const { runSecurityEventsCleanup } = await import('../jobs/securityEventsCleanupJob.js');
        runSecurityEventsCleanup().catch((err: unknown) => {
          console.error(JSON.stringify({ event: 'maintenance:security_events_cleanup_error', ...serializeError(err) }));
        });
      }, 24 * 60 * 60 * 1000); // daily

      // Sprint 3 P2.1 Sprint 3A — agent_runs retention prune in the
      // in-memory fallback. Admin-bypass cross-org sweep.
      setInterval(async () => {
        const { runAgentRunCleanupTick } = await import('../jobs/agentRunCleanupJob.js');
        runAgentRunCleanupTick().catch((err: unknown) => {
          console.error(JSON.stringify({ event: 'maintenance:agent_run_cleanup_error', ...serializeError(err) }));
        });
      }, 24 * 60 * 60 * 1000); // daily

      // Agent Intelligence Phase 2B — memory dedup daily sweep (in-memory fallback)
      setInterval(async () => {
        const { runMemoryDedup } = await import('../jobs/memoryDedupJob.js');
        runMemoryDedup().catch((err: unknown) => {
          console.error(JSON.stringify({ event: 'maintenance:memory_dedup_error', ...serializeError(err) }));
        });
      }, 24 * 60 * 60 * 1000); // daily

      console.log(JSON.stringify({ event: 'maintenance:started', mode: 'interval' }));
    }
  },
};
