import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks, subaccountAgents, systemAgents, agents } from '../db/schema/index.js';
import { agentExecutionService } from '../services/agentExecutionService.js';
import { taskService } from '../services/taskService.js';
import { tryEmitAgentEvent } from '../services/agentExecutionEventEmitter.js';
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

  // 2. Full eligibility revalidation — the task may have been assigned, moved
  //    out of inbox, or turned into a subtask between enqueue and execution.
  const taskLike: TaskLike = {
    id: task.id,
    organisationId: task.organisationId,
    status: task.status,
    assignedAgentId: task.assignedAgentId,
    isSubTask: task.isSubTask,
    createdByAgentId: task.createdByAgentId,
    description: task.description,
  };
  if (!isEligibleForOrchestratorRouting(taskLike)) {
    logger.info('orchestratorFromTask.skipped_ineligible', {
      taskId,
      status: task.status,
      assignedAgentId: task.assignedAgentId,
      isSubTask: task.isSubTask,
      createdByAgentId: task.createdByAgentId,
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

  // Resolve the Orchestrator's subaccount_agents link for this org.
  //
  // Per the seeded architecture (migration 0157 + spec §6.6), the
  // Orchestrator is linked ONCE per org, attached to that org's sentinel
  // subaccount — not per-client-subaccount. The task's own subaccountId
  // is passed into the run as triggerContext so downstream capability
  // queries still scope correctly, but the Orchestrator itself runs
  // from its org-level link regardless of which subaccount the task
  // belongs to.
  //
  // Resolution strategy (supports both the common case and a future
  // per-subaccount Orchestrator model):
  //   1. If the task has a subaccountId, prefer an Orchestrator link on
  //      that exact subaccount (lets an org opt into per-subaccount
  //      Orchestrators in the future without code changes).
  //   2. Fall back to ANY active Orchestrator link for this org — this
  //      is the sentinel-subaccount case and the normal path today.
  const baseConditions = [
    eq(subaccountAgents.organisationId, organisationId),
    eq(agents.systemAgentId, systemAgent.id),
    eq(subaccountAgents.isActive, true),
  ];

  let orchestratorLink: { subaccountAgentId: string; subaccountId: string; agentId: string } | undefined;

  if (task.subaccountId) {
    const [exact] = await db
      .select({
        subaccountAgentId: subaccountAgents.id,
        subaccountId: subaccountAgents.subaccountId,
        agentId: subaccountAgents.agentId,
      })
      .from(subaccountAgents)
      .innerJoin(agents, eq(subaccountAgents.agentId, agents.id))
      .where(and(...baseConditions, eq(subaccountAgents.subaccountId, task.subaccountId)))
      .limit(1);
    orchestratorLink = exact;
  }

  if (!orchestratorLink) {
    // Deterministic selection: in the intended model there is exactly one
    // active Orchestrator link per org (the sentinel). If somehow multiple
    // are present we pick the oldest so routing is stable across restarts.
    const [any] = await db
      .select({
        subaccountAgentId: subaccountAgents.id,
        subaccountId: subaccountAgents.subaccountId,
        agentId: subaccountAgents.agentId,
      })
      .from(subaccountAgents)
      .innerJoin(agents, eq(subaccountAgents.agentId, agents.id))
      .where(and(...baseConditions))
      .orderBy(subaccountAgents.createdAt, subaccountAgents.id)
      .limit(1);
    orchestratorLink = any;
  }

  if (!orchestratorLink) {
    logger.warn('orchestratorFromTask.no_orchestrator_link', { organisationId });
    // Org has not yet enabled the Orchestrator — silently drop.
    return;
  }

  // 4. Dispatch the Orchestrator run with the task as context.
  // Versioned idempotency key: includes task.updatedAt so retries after a
  // user edits the task description produce a fresh run rather than silently
  // dedup-ing against the stale one. Pure job replays (same taskId + same
  // updatedAt) still dedup.
  const idempotencyKey = `orchestrator-from-task:${taskId}:${task.updatedAt.getTime()}`;
  try {
    const result = await agentExecutionService.executeRun({
      agentId: orchestratorLink.agentId,
      subaccountAgentId: orchestratorLink.subaccountAgentId,
      // The Orchestrator runs from its own link (typically the org sentinel
      // subaccount). The task's subaccount is passed in triggerContext so
      // the Orchestrator can scope downstream capability queries to the
      // target subaccount without needing a per-subaccount link.
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
        taskSubaccountId: task.subaccountId,
      },
      idempotencyKey,
    });

    logger.info('orchestratorFromTask.dispatched', { taskId, organisationId, subaccountAgentId: orchestratorLink.subaccountAgentId });

    // Live Agent Execution Log — emit orchestrator.routing_decided on the
    // newly-dispatched run. `routingSource` is always 'rule' in v1 — the
    // structured-reasoning extraction is deferred per spec §9. Fire-and-
    // forget; log-table writes must never gate dispatch.
    if (result.runId) {
      tryEmitAgentEvent({
        runId: result.runId,
        organisationId,
        subaccountId: orchestratorLink.subaccountId ?? null,
        sourceService: 'orchestratorFromTaskJob',
        payload: {
          eventType: 'orchestrator.routing_decided',
          critical: false,
          taskId,
          chosenAgentId: orchestratorLink.agentId,
          idempotencyKey,
          routingSource: 'rule',
        },
        linkedEntity: { type: 'agent', id: orchestratorLink.agentId },
      });
    }
  } catch (err) {
    logger.error('orchestratorFromTask.dispatch_failed', {
      taskId,
      organisationId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
