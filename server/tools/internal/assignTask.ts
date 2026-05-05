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
    .innerJoin(agents, and(eq(agents.id, subaccountAgents.agentId), isNull(agents.deletedAt)))
    .where(
      and(
        eq(subaccountAgents.subaccountId, context.subaccountId),
        eq(agents.slug, worker_agent_slug),
        eq(subaccountAgents.isActive, true),
        eq(agents.status, 'active'),
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
    executionScope: 'subaccount' as const,
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

  // Synchronous fallback for non-pg-boss deployments. executionMode above
  // is hardcoded to 'api', so result.status is always a terminal value and
  // never 'delegated' — this path cannot see the IEE Phase 0 delegated
  // response shape. If executionMode ever becomes configurable here, the
  // returned status must be gated: a 'delegated' response would confuse
  // the calling LLM which treats this result as terminal.
  const result = await agentExecutionService.executeRun(jobPayload);
  if (result.status === 'delegated') {
    // Defensive — should never happen with mode='api'. Fail loud so a
    // future refactor that allows IEE modes here gets caught at the
    // first test instead of silently feeding 'delegated' to the LLM.
    throw new Error(
      `assignTask sync fallback received delegated status — IEE execution is not supported on this path (runId=${result.runId})`,
    );
  }
  return {
    success: true,
    dispatched: false,
    status: result.status,
    agentRunId: result.runId,
    workerAgentSlug: worker_agent_slug,
  };
}
