import { db } from '../db/index.js';
import { executions, workflowEngines, users } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { emailService } from './emailService.js';
import { webhookService } from './webhookService.js';
import { env } from '../lib/env.js';
import { buildEngineAuthHeaders } from '../lib/engineAuth.js';

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

// ---------------------------------------------------------------------------
// Core execution processor
// ---------------------------------------------------------------------------
async function processExecution(executionId: string): Promise<void> {
  const [execution] = await db
    .select()
    .from(executions)
    .where(eq(executions.id, executionId));

  if (!execution) return;

  // Mark as running and stamp queuedAt (it was queued just before this call)
  await db
    .update(executions)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(executions.id, executionId));

  const task = execution.taskSnapshot as Record<string, unknown> | null;
  if (!task) {
    await db
      .update(executions)
      .set({ status: 'failed', errorMessage: 'Task configuration not found', updatedAt: new Date() })
      .where(eq(executions.id, executionId));
    return;
  }

  const [engine] = await db
    .select()
    .from(workflowEngines)
    .where(eq(workflowEngines.id, task.workflowEngineId as string));

  if (!engine) {
    await db
      .update(executions)
      .set({ status: 'failed', errorMessage: 'Workflow engine not found', updatedAt: new Date() })
      .where(eq(executions.id, executionId));
    return;
  }

  // ------------------------------------------------------------------
  // Build the return webhook URL (automatically derived from env config)
  // and the full outbound payload including pre-signed R2 file URLs
  // ------------------------------------------------------------------
  const returnWebhookUrl = webhookService.buildReturnUrl(executionId);
  const outboundPayload = await webhookService.buildOutboundPayload(
    executionId,
    execution.inputData,
    returnWebhookUrl
  );

  // Persist return URL and outbound payload for audit trail BEFORE calling
  // the external engine, so it's captured even if the engine call fails.
  await db
    .update(executions)
    .set({
      returnWebhookUrl,
      outboundPayload: outboundPayload as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(executions.id, executionId));

  const start = Date.now();
  let retryCount = 0;
  const maxRetries = 3;

  // Build engine-specific auth headers
  const authHeaders = buildEngineAuthHeaders(engine.engineType, engine.apiKey ?? undefined);

  while (retryCount <= maxRetries) {
    try {
      const response = await fetch(task.endpointUrl as string, {
        method: task.httpMethod as string,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(outboundPayload),
        signal: AbortSignal.timeout((task.timeoutSeconds as number) * 1000),
      });

      const durationMs = Date.now() - start;
      let outputData: unknown = null;
      try {
        outputData = await response.json();
      } catch {
        outputData = null;
      }

      await db
        .update(executions)
        .set({
          status: 'completed',
          outputData,
          completedAt: new Date(),
          durationMs,
          retryCount,
          updatedAt: new Date(),
        })
        .where(eq(executions.id, executionId));

      // Send completion notification only if user opted in
      if (execution.notifyOnComplete) {
        try {
          const [user] = await db.select().from(users).where(eq(users.id, execution.userId));
          if (user) {
            await emailService.sendExecutionCompletionEmail(
              user.email,
              task.name as string,
              executionId,
              'completed'
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
            errorMessage: `Execution timed out after ${task.timeoutSeconds} seconds`,
            completedAt: new Date(),
            durationMs: Date.now() - start,
            retryCount,
            updatedAt: new Date(),
          })
          .where(eq(executions.id, executionId));
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

    await simpleQueue.add(executionId);
  },
};
