import { eq, and } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { workflowStepRuns, subaccountAgents } from '../../../db/schema/index.js';
import { logger } from '../../../lib/logger.js';
import { getPgBoss } from '../../../lib/pgBossInstance.js';
import { getJobConfig } from '../../../config/jobConfig.js';
import { createWorker } from '../../../lib/createWorker.js';
import { TICK_QUEUE, WATCHDOG_QUEUE, AGENT_STEP_QUEUE } from '../constants.js';
import { failStepRun } from '../stepLifecycle.js';
import { tick } from './tick.js';
import { watchdogSweep } from './watchdog.js';
import type { HandlerContext } from '../../handlerContextTypes.js';

export async function registerWorkers(handlerContext: HandlerContext): Promise<void> {
  const pgboss = await getPgBoss();

  await createWorker<{ runId: string }>({
    queue: TICK_QUEUE,
    boss: pgboss,
    concurrency: 4,
    resolveOrgContext: () => null,
    handler: async (job) => {
      const data = job.data as { runId: string };
      await tick(data.runId, handlerContext);
    },
  });

  await createWorker<Record<string, never>>({
    queue: WATCHDOG_QUEUE,
    boss: pgboss,
    concurrency: 1,
    resolveOrgContext: () => null,
    handler: async () => {
      await watchdogSweep();
    },
  });

  // Workflow-agent-step worker — runs the actual agent for prompt /
  // agent_call step types. Dynamic-imported to avoid pulling
  // agentExecutionService into the engine module's eager graph.
  await createWorker<{
    WorkflowStepRunId: string;
    WorkflowRunId: string;
    organisationId: string;
    subaccountId: string;
    agentId: string;
    stepId: string;
    attempt: number;
    renderedPrompt: string | null;
    resolvedAgentInputs: Record<string, unknown>;
    sideEffectType: 'none' | 'idempotent' | 'reversible' | 'irreversible';
    systemPromptAddendum?: string;
    allowedToolSlugs?: string[];
    timeoutSeconds?: number;
    isDecisionRun?: boolean;
    triggerContext?: Record<string, unknown>;
  }>({
    queue: AGENT_STEP_QUEUE,
    boss: pgboss,
    concurrency: 4,
    handler: async (job) => {
      const data = job.data;

      const [sr] = await db
        .select()
        .from(workflowStepRuns)
        .where(eq(workflowStepRuns.id, data.WorkflowStepRunId));
      if (!sr || sr.status === 'invalidated' || sr.status === 'completed') {
        logger.info('workflow_agent_step_skipped_stale', {
          stepRunId: data.WorkflowStepRunId,
          currentStatus: sr?.status,
        });
        return;
      }

      try {
        const [saLink] = await db
          .select()
          .from(subaccountAgents)
          .where(
            and(
              eq(subaccountAgents.agentId, data.agentId),
              eq(subaccountAgents.subaccountId, data.subaccountId)
            )
          );

        if (!saLink) {
          logger.error('workflow_agent_step_agent_not_linked', {
            stepRunId: data.WorkflowStepRunId,
            stepId: data.stepId,
            agentId: data.agentId,
            subaccountId: data.subaccountId,
          });
          await failStepRun(
            data.WorkflowStepRunId,
            `agent_not_linked_to_subaccount: agentId=${data.agentId} subaccountId=${data.subaccountId}`,
          );
          return;
        }

        const retryCountForKey = (data.triggerContext?.retryCount as number) ?? 0;
        const idempotencyKey =
          retryCountForKey > 0
            ? `Workflow:${data.WorkflowRunId}:${data.stepId}:${data.attempt}:retry${retryCountForKey}`
            : `Workflow:${data.WorkflowRunId}:${data.stepId}:${data.attempt}`;
        const triggerContext: Record<string, unknown> = data.triggerContext ?? {
          source: 'Workflow',
          WorkflowRunId: data.WorkflowRunId,
          WorkflowStepRunId: data.WorkflowStepRunId,
          stepId: data.stepId,
          attempt: data.attempt,
          agentInputs: data.resolvedAgentInputs,
        };
        if (data.renderedPrompt && !triggerContext.prompt) {
          triggerContext.prompt = data.renderedPrompt;
        }

        // out-of-scope-CD: this dynamic import is a separate cycle, not CD1.
        const { agentExecutionService } = await import('../../agentExecutionService.js');

        await agentExecutionService.executeRun({
          agentId: data.agentId,
          subaccountId: data.subaccountId,
          subaccountAgentId: saLink.id,
          organisationId: data.organisationId,
          executionScope: 'subaccount',
          runType: 'triggered',
          runSource: 'system',
          executionMode: 'api',
          idempotencyKey,
          triggerContext,
          workflowStepRunId: data.WorkflowStepRunId,
          ...(data.systemPromptAddendum !== undefined && {
            systemPromptAddendum: data.systemPromptAddendum,
          }),
          ...(data.allowedToolSlugs !== undefined && {
            allowedToolSlugs: data.allowedToolSlugs,
          }),
        });
      } catch (err) {
        logger.error('workflow_agent_step_dispatch_failed', {
          stepRunId: data.WorkflowStepRunId,
          stepId: data.stepId,
          error: err instanceof Error ? err.message : String(err),
        });
        if (data.sideEffectType === 'irreversible') {
          await failStepRun(
            data.WorkflowStepRunId,
            'transient_error_no_retry: ' +
              (err instanceof Error ? err.message : String(err))
          );
          return;
        }
        throw err;
      }
    },
  });

  // Cron schedule the watchdog every minute.
  try {
    await (pgboss as unknown as {
      schedule: (queue: string, cron: string, data: object, options: object) => Promise<void>
    }).schedule(WATCHDOG_QUEUE, '* * * * *', {}, getJobConfig('workflow-watchdog'));
  } catch (err) {
    logger.warn('workflow_watchdog_schedule_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('workflow_engine_workers_registered');
}
