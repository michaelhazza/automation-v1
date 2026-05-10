// Support Agent Run Job — pg-boss worker for the support agent execution loop.
// Spec: tasks/builds/phase-1-showcase-mvps/spec.md §5.3.3, §5.3.7
//
// Triggered on schedule or Teamwork webhook (ticket.created).
// Singleton per (subaccountId, inboxId) via singletonKey to prevent
// concurrent inbox-level runs for the same agent installation.
//
// INV-8: agent_runs.controller_style = 'native' must be set at run create.

import type PgBoss from 'pg-boss';
import { createWorker } from '../lib/createWorker.js';
import { logger } from '../lib/logger.js';
import { processInbox } from '../services/supportAgentExecutionService.js';

export const QUEUE = 'support-agent-run';

export interface SupportAgentRunPayload {
  organisationId: string;
  subaccountId: string;
  inboxId: string;
  subaccountAgentRunId: string;
  triggeredBy: 'schedule' | 'webhook';
}

/**
 * Register the support-agent-run pg-boss worker.
 *
 * singleton: true per (subaccountId, inboxId) is enforced at enqueue time
 * by passing singletonKey = `${subaccountId}:${inboxId}` when calling
 * boss.send(). The pg-boss singletonKey deduplicates concurrent enqueues
 * so at most one job processes a given inbox at a time.
 */
export function registerSupportAgentRunJob(boss: PgBoss): void {
  createWorker<SupportAgentRunPayload>({
    queue: QUEUE,
    boss,
    concurrency: 4,

    handler: async (job) => {
      const { organisationId, subaccountId, inboxId, subaccountAgentRunId, triggeredBy } = job.data;

      logger.info('support.agent_run.started', {
        organisationId,
        subaccountId,
        inboxId,
        subaccountAgentRunId,
        triggeredBy,
      });

      await processInbox({
        subaccountAgentRunId,
        inboxId,
        organisationId,
        subaccountId,
      });

      logger.info('support.agent_run.completed', {
        organisationId,
        subaccountId,
        inboxId,
        subaccountAgentRunId,
      });
    },
  });

  logger.info('support.agent_run.handler_registered');
}

/**
 * Enqueue a support agent run for a specific inbox.
 * Uses singletonKey so concurrent enqueues collapse into one.
 */
export async function enqueueSupportAgentRun(
  boss: PgBoss,
  payload: SupportAgentRunPayload,
): Promise<string | null> {
  const singletonKey = `${payload.subaccountId}:${payload.inboxId}`;
  return boss.send(QUEUE, payload, { singletonKey });
}
