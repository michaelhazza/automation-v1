import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import { env } from '../../lib/env.js';

// ---------------------------------------------------------------------------
// Simple in-memory queue
// In production this is replaced by pg-boss or bullmq, but the processing
// logic (processExecution) is shared in both cases.
// ---------------------------------------------------------------------------
export class SimpleQueue {
  private processing = false;
  private queue: string[] = [];

  constructor(
    private readonly processExecution: (executionId: string) => Promise<void>,
  ) {}

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
      await this.processExecution(executionId);
    } catch {
      // Execution processing errors are handled inside processExecution
    }

    setImmediate(() => this.processNext());
  }
}

export const EXECUTION_QUEUE_NAME = 'execution-run';
export const WORKFLOW_RESUME_QUEUE = 'workflow-resume';

// ---------------------------------------------------------------------------
// Advisory lock helpers — prevent duplicate maintenance runs across
// horizontally-scaled instances when using the in-memory queue backend.
// pg-boss handles deduplication natively, so locks are only needed for
// the setInterval fallback path.
// ---------------------------------------------------------------------------
export const LOCK_ID_CLEANUP_FILES        = 7001;
export const LOCK_ID_CLEANUP_RESERVATIONS = 7002;

export function serializeError(err: unknown): { message: string; name: string; stack?: string } {
  if (err instanceof Error) {
    return {
      message: err.message,
      name: err.name,
      ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
    };
  }
  return { message: String(err), name: 'UnknownError' };
}

export async function withAdvisoryLock(lockId: number, fn: () => Promise<void>): Promise<void> {
  const result = await db.execute(sql`SELECT pg_try_advisory_lock(${lockId}) AS acquired`);
  const acquired = (Array.from(result)[0] as { acquired?: boolean } | undefined)?.acquired;
  if (!acquired) return; // another instance is running this job
  try {
    await fn();
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockId})`);
  }
}
