import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks, conversations } from '../db/schema/index.js';
import { agentExecutionService } from '../services/agentExecutionService.js';
import { taskService } from '../services/taskService.js';
import { resolveRootForScope } from '../services/hierarchyRouteResolverService.js';
import { writeConversationMessage } from '../services/briefConversationWriter.js';
import { logger } from '../lib/logger.js';
import { detectCadenceSignals } from '../services/orchestratorCadenceDetectionPure.js';
import { classifyAsMilestone } from '../services/orchestratorMilestoneEmitterPure.js';
import { detectWorkflowDraftIntent } from '../services/chatTriageClassifierPure.js';
import { appendAndEmitTaskEvent } from '../services/taskEventService.js';
import { workflowDraftService } from '../services/workflowDraftService.js';

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
const MIN_DESCRIPTION_CHARS = 10;

export interface OrchestratorFromTaskPayload {
  taskId: string;
  organisationId: string;
  triggerId?: string;
  scope?: 'subaccount' | 'org' | 'system';
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
export async function enqueueOrchestratorRoutingIfEligible(
  task: TaskLike,
  opts?: { scope?: 'subaccount' | 'org' | 'system' },
): Promise<void> {
  if (!isEligibleForOrchestratorRouting(task)) return;
  if (!orchestratorJobSender) {
    logger.warn('orchestratorFromTask.no_sender', { taskId: task.id });
    return;
  }
  try {
    const payload: OrchestratorFromTaskPayload = {
      taskId: task.id,
      organisationId: task.organisationId,
    };
    if (opts?.scope !== undefined) {
      payload.scope = opts.scope;
    }
    await orchestratorJobSender(ORCHESTRATOR_FROM_TASK_QUEUE, payload);
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

  const description = task.description ?? '';

  // 2c. Workflow draft request detection — if the operator explicitly asks to
  //     save this task as a workflow, create a draft immediately.
  const workflowDraftIntent = detectWorkflowDraftIntent(description);
  if (workflowDraftIntent === 'workflow_draft_request' && task.subaccountId) {
    workflowDraftService.create({
      sessionId: taskId,
      organisationId,
      subaccountId: task.subaccountId,
      payload: { steps: [], promptSummary: description },
      draftSource: 'orchestrator',
    }).catch((err: unknown) => {
      logger.warn('orchestratorFromTask.workflow_draft_create_failed', {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // 3. Determine scope from payload — default to 'subaccount' for all
  //    enqueue paths that do not supply an explicit scope (e.g. taskService).
  //    This is a compatibility shim, not a policy. New enqueue paths must
  //    explicitly choose a scope. See plan R9 (tasks/builds/paperclip-hierarchy/plan.md).
  const scope = payload.scope ?? 'subaccount';

  // 4. Resolve the root subaccount-agent link for this scope.
  //
  //    The resolver queries systemAgents for 'orchestrator' as the org-level
  //    fallback. See spec §6.6 and hierarchyRouteResolverService for the full
  //    decision tree.
  const resolvedRoot = await resolveRootForScope({
    organisationId,
    subaccountId: task.subaccountId ?? null,
    scope,
  });

  if (resolvedRoot === null) {
    if (scope === 'system') {
      // System-scope briefs are not routable — write an error artefact
      // to the brief's conversation so the user gets feedback.
      try {
        const [conv] = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.scopeType, 'brief'),
              eq(conversations.scopeId, taskId),
            ),
          )
          .limit(1);
        if (conv) {
          await writeConversationMessage({
            conversationId: conv.id,
            briefId: taskId,
            organisationId,
            role: 'assistant',
            content: '',
            artefacts: [
              {
                artefactId: `system-scope-error:${taskId}`,
                kind: 'error',
                errorCode: 'unsupported_query',
                message:
                  'System-scope Briefs are not yet routable. Please re-submit directed at a subaccount or your organisation.',
              },
            ],
          });
        }
      } catch (writeErr) {
        logger.warn('orchestratorFromTask.system_scope_error_write_failed', {
          taskId,
          organisationId,
          error: writeErr instanceof Error ? writeErr.message : String(writeErr),
        });
      }
      return;
    }
    logger.warn('orchestratorFromTask.no_root_found', { taskId, organisationId, scope });
    return;
  }

  // Log only the misconfigured case at WARN — the `'expected'` branch is the
  // routine scope:subaccount-with-null-subaccountId flow and should not flood
  // the log. `'degraded'` means the subaccount exists but has zero root agents
  // (the `subaccountNoRoot` detector will surface it in workspace-health).
  if (resolvedRoot.fallback === 'degraded') {
    logger.warn('orchestratorFromTask.fallback_degraded', {
      tag: 'orchestratorFromTask.fallback_degraded',
      taskId,
      organisationId,
      subaccountId: task.subaccountId,
      scope,
      reason: 'subaccount has no active root agent — routed to org-level link',
    });
  } else if (resolvedRoot.fallback === 'expected') {
    logger.info('orchestratorFromTask.fallback_expected', {
      taskId,
      organisationId,
      subaccountId: task.subaccountId,
      scope,
    });
  }

  // 5. Dispatch the Orchestrator run with the task as context.
  // Versioned idempotency key: includes task.updatedAt so retries after a
  // user edits the task description produce a fresh run rather than silently
  // dedup-ing against the stale one. Pure job replays (same taskId + same
  // updatedAt) still dedup.
  const idempotencyKey = `orchestrator-from-task:${taskId}:${task.updatedAt.getTime()}`;
  try {
    // `orchestratorDispatch` is consumed inside executeRun: the event fires
    // immediately after `run.started` (sequence 2) so the dispatch decision
    // lands inside the run's own timeline rather than after run.completed.
    // Spec: tasks/live-agent-execution-log-spec.md §5.3.
    await agentExecutionService.executeRun({
      agentId: resolvedRoot.agentId,
      subaccountAgentId: resolvedRoot.subaccountAgentId,
      // The Orchestrator runs from its resolved link (typically the org sentinel
      // subaccount, or the subaccount root for scope:'subaccount'). The task's
      // own subaccountId is passed into triggerContext so the Orchestrator can
      // scope downstream capability queries to the target subaccount without
      // needing a per-subaccount link.
      subaccountId: resolvedRoot.subaccountId,
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
      orchestratorDispatch: {
        taskId,
        chosenAgentId: resolvedRoot.agentId,
        idempotencyKey,
        routingSource: 'rule',
      },
      workflowRunDepth: 1,
    });

    logger.info('orchestratorFromTask.dispatched', { taskId, organisationId, subaccountAgentId: resolvedRoot.subaccountAgentId, scope, fallback: resolvedRoot.fallback });

    // 2b. Cadence detection — emit recommendation card after task completion.
    const cadenceResult = detectCadenceSignals(description);
    if (cadenceResult.score >= 0.5) {
      appendAndEmitTaskEvent(taskId, 0, 0, 'orchestrator', {
        kind: 'chat.message',
        payload: {
          authorKind: 'agent',
          authorId: organisationId,
          body: "This looks like something you'd want to do regularly. Save it as a scheduled Workflow?",
          attachments: [
            {
              cardKind: 'workflow_recommendation',
              cardActions: [
                { id: 'accept', label: 'Yes, set up' },
                { id: 'decline', label: 'No thanks' },
              ],
            },
          ],
        },
      }).catch((err: unknown) => {
        logger.warn('orchestratorFromTask.cadence_card_emit_failed', {
          taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Milestone classification — emit agent.milestone if this task produced a milestone-class outcome.
    const milestoneResult = classifyAsMilestone(description);
    if (milestoneResult.isMilestone) {
      appendAndEmitTaskEvent(taskId, 0, 0, 'orchestrator', {
        kind: 'agent.milestone',
        payload: {
          summary: milestoneResult.summary ?? description.slice(0, 120),
          agentId: resolvedRoot.agentId,
        },
      }).catch((err: unknown) => {
        logger.warn('orchestratorFromTask.milestone_emit_failed', {
          taskId,
          error: err instanceof Error ? err.message : String(err),
        });
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
