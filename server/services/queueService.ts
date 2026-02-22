import { db } from '../db/index.js';
import { executions, workflowEngines, tasks, users } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { emailService } from './emailService.js';
import { env } from '../lib/env.js';

// Simple in-memory queue for development. In production, pg-boss handles this.
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

async function processExecution(executionId: string): Promise<void> {
  const [execution] = await db.select().from(executions).where(eq(executions.id, executionId));
  if (!execution) return;

  await db.update(executions).set({ status: 'running', startedAt: new Date(), updatedAt: new Date() }).where(eq(executions.id, executionId));

  const task = execution.taskSnapshot as Record<string, unknown> | null;
  if (!task) {
    await db.update(executions).set({ status: 'failed', errorMessage: 'Task configuration not found', updatedAt: new Date() }).where(eq(executions.id, executionId));
    return;
  }

  const [engine] = await db.select().from(workflowEngines).where(eq(workflowEngines.id, task.workflowEngineId as string));
  if (!engine) {
    await db.update(executions).set({ status: 'failed', errorMessage: 'Workflow engine not found', updatedAt: new Date() }).where(eq(executions.id, executionId));
    return;
  }

  const start = Date.now();
  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount <= maxRetries) {
    try {
      const response = await fetch(task.endpointUrl as string, {
        method: task.httpMethod as string,
        headers: {
          'Content-Type': 'application/json',
          ...(engine.apiKey ? { 'X-N8N-API-KEY': engine.apiKey } : {}),
        },
        body: execution.inputData ? JSON.stringify(execution.inputData) : undefined,
        signal: AbortSignal.timeout((task.timeoutSeconds as number) * 1000),
      });

      const durationMs = Date.now() - start;
      let outputData: unknown = null;
      try { outputData = await response.json(); } catch { outputData = null; }

      await db.update(executions).set({
        status: 'completed',
        outputData,
        completedAt: new Date(),
        durationMs,
        retryCount,
        updatedAt: new Date(),
      }).where(eq(executions.id, executionId));

      // Send completion notification
      try {
        const [user] = await db.select().from(users).where(eq(users.id, execution.userId));
        if (user) {
          await emailService.sendExecutionCompletionEmail(user.email, task.name as string, executionId, 'completed');
        }
      } catch { /* Email failures don't affect execution */ }

      return;
    } catch (err: unknown) {
      const isNetworkError = err instanceof TypeError;
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';

      if (isTimeout) {
        await db.update(executions).set({
          status: 'timeout',
          errorMessage: `Execution timed out after ${task.timeoutSeconds} seconds`,
          completedAt: new Date(),
          durationMs: Date.now() - start,
          retryCount,
          updatedAt: new Date(),
        }).where(eq(executions.id, executionId));
        return;
      }

      if (isNetworkError && retryCount < maxRetries) {
        retryCount++;
        await db.update(executions).set({ retryCount, updatedAt: new Date() }).where(eq(executions.id, executionId));
        await new Promise((r) => setTimeout(r, 1000 * retryCount));
        continue;
      }

      const errorMessage = err instanceof Error ? err.message : 'Execution failed';
      await db.update(executions).set({
        status: 'failed',
        errorMessage,
        errorDetail: { error: errorMessage, retryCount } as unknown as Record<string, unknown>,
        completedAt: new Date(),
        durationMs: Date.now() - start,
        retryCount,
        updatedAt: new Date(),
      }).where(eq(executions.id, executionId));
      return;
    }
  }
}

export const queueService = {
  async enqueueExecution(executionId: string): Promise<void> {
    await simpleQueue.add(executionId);
  },
};
