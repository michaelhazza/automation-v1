import { db } from '../db/index.js';
import { executions, executionPayloads, executionFiles, budgetReservations, workflowEngines, users } from '../db/schema/index.js';
import { eq, lt, sql } from 'drizzle-orm';
import { emailService } from './emailService.js';
import { webhookService } from './webhookService.js';
import { processResolutionService } from './processResolutionService.js';
import { env } from '../lib/env.js';
import { buildEngineAuthHeaders } from '../lib/engineAuth.js';
import { emitExecutionUpdate, emitSubaccountUpdate } from '../websocket/emitters.js';

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
let pgBossQueue: {
  send(name: string, data?: object): Promise<string | null>;
  work(name: string, handler: (job: { data: Record<string, unknown> }) => Promise<void>): Promise<string>;
  start(): Promise<void>;
} | null = null;
const EXECUTION_QUEUE_NAME = 'execution-run';

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
  const acquired = (result.rows?.[0] as { acquired?: boolean } | undefined)?.acquired;
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

  if (!pgBossQueue) {
    const PgBossModule = await import('pg-boss');
    const PgBossClass = (PgBossModule.default ?? PgBossModule) as unknown as new (connectionString: string) => {
      send(name: string, data?: object): Promise<string | null>;
      work(name: string, handler: (job: { data: Record<string, unknown> }) => Promise<void>): Promise<string>;
      start(): Promise<void>;
    };
    pgBossQueue = new PgBossClass(env.DATABASE_URL);
    await pgBossQueue.start();
  }

  if (!queueWorkerReady) {
    await pgBossQueue.work(EXECUTION_QUEUE_NAME, async (job) => {
      const executionId = String(job.data.executionId ?? '');
      if (!executionId) return;
      await processExecution(executionId);
    });
    queueWorkerReady = true;
  }

  return {
    enqueue: async (executionId: string) => {
      await pgBossQueue!.send(EXECUTION_QUEUE_NAME, { executionId });
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
      .where(eq(workflowEngines.id, processSnapshot.workflowEngineId as string));

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
   * Start periodic maintenance jobs.
   * Uses pg-boss scheduled workers when available, otherwise falls back to
   * in-process setInterval guarded by pg advisory locks to prevent duplicate
   * runs across horizontally-scaled instances. Call once at application startup.
   */
  async startMaintenanceJobs(): Promise<void> {
    const backend = await getQueueBackend();

    if (backend.kind === 'pg-boss' && pgBossQueue) {
      // pg-boss deduplicates across instances natively — no advisory lock needed
      const boss = pgBossQueue as unknown as {
        schedule(name: string, cron: string, data: object, opts?: object): Promise<void>;
        work(name: string, handler: (job: { data: Record<string, unknown> }) => Promise<void>): Promise<string>;
      };
      await boss.work('maintenance:cleanup-execution-files', async () => {
        await queueService.cleanupExpiredExecutionFiles();
      });
      await boss.work('maintenance:cleanup-budget-reservations', async () => {
        await queueService.cleanupExpiredBudgetReservations();
      });
      await boss.schedule('maintenance:cleanup-execution-files',  '0 * * * *',   {});
      await boss.schedule('maintenance:cleanup-budget-reservations', '*/5 * * * *', {});
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

      console.log(JSON.stringify({ event: 'maintenance:started', mode: 'interval' }));
    }
  },
};
