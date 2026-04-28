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
import { recordIncident } from './incidentIngestor.js';
import { JOB_CONFIG } from '../config/jobConfig.js';
import { deriveDlqQueueNames } from './dlqMonitorServicePure.js';

const DLQ_QUEUES = deriveDlqQueueNames(JOB_CONFIG);

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
        recordIncident({
          source: 'job',
          summary: `Job reached DLQ: ${sourceQueue}`,
          errorCode: 'job_dlq',
          organisationId: typeof payload.organisationId === 'string' ? payload.organisationId : null,
          subaccountId: typeof payload.subaccountId === 'string' ? payload.subaccountId : null,
          fingerprintOverride: `job:${sourceQueue}:dlq`,
          errorDetail: { jobId: job.id },
        }, { forceSync: true });
      },
    );
  }

  logger.info('dlq_monitor_started', { queues: DLQ_QUEUES.length });
}
