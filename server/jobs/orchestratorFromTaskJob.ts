import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks, subaccountAgents, systemAgents, agents } from '../db/schema/index.js';
import { agentExecutionService } from '../services/agentExecutionService.js';
import { taskService } from '../services/taskService.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// orchestratorFromTaskJob
//
// Handler for the org-level task-created event targeting the Orchestrator
// agent. Consumes a pg-boss job payload containing the task id + org id,
// performs handler-side guards that a simple eventFilter cannot express,
// resolves the Orchestrator's subaccount-agent link for the org, and
// dispatches an agent run with the task as context.
//
// See docs/orchestrator-capability-routing-spec.md §7.
// ---------------------------------------------------------------------------

export const ORCHESTRATOR_FROM_TASK_QUEUE = 'orchestrator-from-task';
const ORCHESTRATOR_AGENT_SLUG = 'orchestrator';
const MIN_DESCRIPTION_CHARS = 10;

export interface OrchestratorFromTaskPayload {
  taskId: string;
  organisationId: string;
  triggerId?: string;
}

// ---------------------------------------------------------------------------
// Enqueue: called by taskService.createTask after the row is written. Job
// handler runs the real work asynchronously. Non-blocking from the caller's
// perspective. See spec §7.3 for the eligibility predicate.
// ---------------------------------------------------------------------------

type JobSender = (name: string, data: object) => Promise<string | null>;

let orchestratorJobSender: JobSender | null = null;

export function setOrchestratorJobSender(sender: JobSender): void {
  orchestratorJobSender = sender;
}

export interface TaskLike {
  id: string;
  organisationId: string;
  status: string;
  assignedAgentId: string | null;
  isSubTask: boolean;
  createdByAgentId: string | null;
  description: string | null;
}

/**
 * Eligibility predicate — mirrors the eventFilter from spec §7.3 plus the
 * handler-side guards for non-equality-checkable fields (createdByAgentId,
 * description length).
 */
export function isEligibleForOrchestratorRouting(task: TaskLike): boolean {
  if (task.status !== 'inbox') return false;
  if (task.assignedAgentId !== null) return false;
  if (task.isSubTask) return false;
  if (task.createdByAgentId !== null) return false;
  if (!task.description || task.description.trim().length < MIN_DESCRIPTION_CHARS) return false;
  return true;
}

/**
 * Enqueue the Orchestrator routing job for a newly-created task, if the
 * task meets the eligibility criteria. Non-throwing — caller fires and
 * forgets. Safe to call on every task creation.
 */
export async function enqueueOrchestratorRoutingIfEligible(task: TaskLike): Promise<void> {
  if (!isEligibleForOrchestratorRouting(task)) return;
  if (!orchestratorJobSender) {
    logger.warn('orchestratorFromTask.no_sender', { taskId: task.id });
    return;
  }
  try {
    await orchestratorJobSender(ORCHESTRATOR_FROM_TASK_QUEUE, {
      taskId: task.id,
      organisationId: task.organisationId,
    } satisfies OrchestratorFromTaskPayload);
  } catch (err) {
    logger.error('orchestratorFromTask.enqueue_failed', {
      taskId: task.id,
      organisationId: task.organisationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function processOrchestratorFromTask(payload: OrchestratorFromTaskPayload): Promise<void> {
  const { taskId, organisationId } = payload;

  // 1. Load the task.
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

  if (!task) {
    logger.warn('orchestratorFromTask.task_not_found', { taskId, organisationId });
    return;
  }

  // 2. Handler-side guards (spec §7.3 — beyond what eventFilter can express).
  if (task.createdByAgentId) {
    // Agent-created tasks must not recurse back to the Orchestrator.
    logger.info('orchestratorFromTask.skipped_agent_created', { taskId, createdByAgentId: task.createdByAgentId });
    return;
  }
  if (!task.description || task.description.trim().length < MIN_DESCRIPTION_CHARS) {
    logger.info('orchestratorFromTask.skipped_short_description', { taskId });
    await taskService.updateTask(taskId, organisationId, {
      status: 'routing_failed',
    }).catch((err: unknown) => {
      logger.error('orchestratorFromTask.update_status_failed', { taskId, error: String(err) });
    });
    return;
  }

  // 3. Resolve the Orchestrator's subaccount-agent link for this org.
  const [systemAgent] = await db
    .select({ id: systemAgents.id })
    .from(systemAgents)
    .where(eq(systemAgents.slug, ORCHESTRATOR_AGENT_SLUG))
    .limit(1);

  if (!systemAgent) {
    logger.error('orchestratorFromTask.system_agent_missing', { slug: ORCHESTRATOR_AGENT_SLUG });
    return;
  }

  const [orchestratorLink] = await db
    .select({
      subaccountAgentId: subaccountAgents.id,
      subaccountId: subaccountAgents.subaccountId,
      agentId: subaccountAgents.agentId,
    })
    .from(subaccountAgents)
    .innerJoin(agents, eq(subaccountAgents.agentId, agents.id))
    .where(and(
      eq(subaccountAgents.organisationId, organisationId),
      eq(agents.systemAgentId, systemAgent.id),
      eq(subaccountAgents.isActive, true),
    ))
    .limit(1);

  if (!orchestratorLink) {
    logger.warn('orchestratorFromTask.no_orchestrator_link', { organisationId });
    // Org has not yet enabled the Orchestrator — silently drop.
    return;
  }

  // 4. Dispatch the Orchestrator run with the task as context.
  try {
    await agentExecutionService.executeRun({
      agentId: orchestratorLink.agentId,
      subaccountAgentId: orchestratorLink.subaccountAgentId,
      subaccountId: orchestratorLink.subaccountId,
      organisationId,
      runType: 'triggered',
      runSource: 'trigger',
      taskId,
      triggerContext: {
        source: 'org_task_created',
        triggerId: payload.triggerId,
        taskTitle: task.title,
        taskDescription: task.description,
      },
      // Idempotency key so replaying the job does not double-spawn a run.
      idempotencyKey: `orchestrator-from-task:${taskId}`,
    });

    logger.info('orchestratorFromTask.dispatched', { taskId, organisationId, subaccountAgentId: orchestratorLink.subaccountAgentId });
  } catch (err) {
    logger.error('orchestratorFromTask.dispatch_failed', {
      taskId,
      organisationId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
