// ---------------------------------------------------------------------------
// Dead Letter Queue Monitor
//
// Registers workers on all DLQ queues. When a job exhausts retries and lands
// in a DLQ, this service logs a structured error with correlation context
// for debugging.
// ---------------------------------------------------------------------------

import type PgBoss from 'pg-boss';
import { logger } from '../lib/logger.js';
import { safeSerialize } from '../lib/jobErrors.js';

const DLQ_QUEUES = [
  'agent-scheduled-run__dlq',
  'agent-org-scheduled-run__dlq',
  'agent-handoff-run__dlq',
  'agent-triggered-run__dlq',
  'execution-run__dlq',
  'workflow-resume__dlq',
  'llm-aggregate-update__dlq',
  'llm-monthly-invoices__dlq',
];

export async function startDlqMonitor(boss: PgBoss): Promise<void> {
  for (const dlqName of DLQ_QUEUES) {
    const sourceQueue = dlqName.replace('__dlq', '');
    await (boss as any).work(
      dlqName,
      { teamSize: 2, teamConcurrency: 1 },
      async (job: any) => {
        const payload = (job.data ?? {}) as Record<string, unknown>;
        logger.error('job_dlq', {
          queue: sourceQueue,
          jobId: job.id,
          organisationId: payload.organisationId,
          agentId: payload.agentId,
          subaccountId: payload.subaccountId,
          payload: safeSerialize(payload),
        });
      },
    );
  }

  logger.info('dlq_monitor_started', { queues: DLQ_QUEUES.length });
}
