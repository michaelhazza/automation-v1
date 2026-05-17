import { env } from '../../lib/env.js';
import { getPgBoss } from '../../lib/pgBossInstance.js';
import { getJobConfig } from '../../config/jobConfig.js';
import { isNonRetryable, isTimeoutError, getRetryCount, withTimeout } from '../../lib/jobErrors.js';
import { logger } from '../../lib/logger.js';
import { SimpleQueue, EXECUTION_QUEUE_NAME } from './types.js';
import { processExecution } from './executionProcessor.js';

const simpleQueue = new SimpleQueue(processExecution);
let queueWorkerReady = false;

export async function getQueueBackend() {
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
