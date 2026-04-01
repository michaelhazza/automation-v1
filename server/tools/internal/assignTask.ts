// ---------------------------------------------------------------------------
// assign_task — Phase 2 workflow orchestration tool.
//
// Enqueues a single child agent run via pg-boss (fire-and-forget) rather than
// awaiting inline execution. This allows long-running delegated tasks without
// blocking the orchestrator's main loop.
//
// If the pg-boss sender has not been wired up (e.g. in lightweight deployments),
// falls back to a synchronous executeRun for backwards compatibility.
// ---------------------------------------------------------------------------

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { agents, subaccountAgents } from '../../db/schema/index.js';
import { agentExecutionService } from '../../services/agentExecutionService.js';

// pg-boss job sender — injected at startup by agentScheduleService
let pgBossSend: ((name: string, data: object) => Promise<string | null>) | null = null;

export function setAssignTaskJobSender(
  sender: (name: string, data: object) => Promise<string | null>,
): void {
  pgBossSend = sender;
}

interface AssignTaskInput {
  worker_agent_slug: string;
  task_description: string;
  context?: Record<string, unknown>;
}

interface AssignTaskExecutionContext {
  runId: string;
  organisationId: string;
  subaccountId: string;
  agentId: string;
}

const AGENT_HANDOFF_QUEUE = 'agent-handoff-run';

export async function executeAssignTask(
  input: Record<string, unknown>,
  context: AssignTaskExecutionContext,
): Promise<unknown> {
  const { worker_agent_slug, task_description, context: taskContext } = input as unknown as AssignTaskInput;

  if (!worker_agent_slug || !task_description) {
    return { success: false, error: 'worker_agent_slug and task_description are required' };
  }

  // Resolve the worker agent by slug within this subaccount
  const [saLink] = await db
    .select({ sa: subaccountAgents, agent: agents })
    .from(subaccountAgents)
    .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
    .where(
      and(
        eq(subaccountAgents.subaccountId, context.subaccountId),
        eq(agents.slug, worker_agent_slug),
        eq(subaccountAgents.isActive, true),
        eq(agents.status, 'active'),
        isNull(agents.deletedAt),
      ),
    );

  if (!saLink) {
    return {
      success: false,
      error: `Worker agent '${worker_agent_slug}' not found or inactive in this subaccount`,
    };
  }

  const jobPayload = {
    agentId: saLink.agent.id,
    subaccountId: context.subaccountId,
    subaccountAgentId: saLink.sa.id,
    organisationId: context.organisationId,
    runType: 'triggered' as const,
    executionMode: 'api' as const,
    triggerContext: {
      type: 'assign_task',
      parentRunId: context.runId,
      taskDescription: task_description,
      taskContext: taskContext ?? {},
    },
    isSubAgent: true,
    parentSpawnRunId: context.runId,
  };

  if (pgBossSend) {
    // Async dispatch — returns immediately; child run executes in background
    const jobId = await pgBossSend(AGENT_HANDOFF_QUEUE, jobPayload);
    return {
      success: true,
      dispatched: true,
      jobId,
      workerAgentSlug: worker_agent_slug,
    };
  }

  // Synchronous fallback for non-pg-boss deployments
  const result = await agentExecutionService.executeRun(jobPayload);
  return {
    success: true,
    dispatched: false,
    status: result.status,
    agentRunId: result.runId,
    workerAgentSlug: worker_agent_slug,
  };
}
