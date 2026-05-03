import { and, eq, isNull, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks, conversations } from '../db/schema/index.js';
import { agentExecutionService } from '../services/agentExecutionService.js';
import { taskService } from '../services/taskService.js';
import { resolveRootForScope } from '../services/hierarchyRouteResolverService.js';
import { writeConversationMessage } from '../services/briefConversationWriter.js';
import { logger } from '../lib/logger.js';
import { detectCadenceSignals, CADENCE_RECOMMEND_THRESHOLD } from '../services/orchestratorCadenceDetectionPure.js';
import { TaskEventService } from '../services/taskEventService.js';
import { WorkflowDraftService } from '../services/workflowDraftService.js';
import { emitMilestone } from '../services/agentMilestoneEmitter.js';

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
    });

    logger.info('orchestratorFromTask.dispatched', { taskId, organisationId, subaccountAgentId: resolvedRoot.subaccountAgentId, scope, fallback: resolvedRoot.fallback });

    // 6. Post-dispatch: cadence-signal detection and milestone emission.
    //    These run after the primary dispatch completes so they never block
    //    the orchestrator run itself. Failures are caught and logged — the
    //    orchestrator flow must not fail because of these optional features.
    try {
      await postDispatchCadenceAndMilestone({
        task,
        taskId,
        organisationId,
        resolvedRoot,
      });
    } catch (postErr) {
      logger.warn('orchestratorFromTask.post_dispatch_failed', {
        taskId,
        organisationId,
        error: postErr instanceof Error ? postErr.message : String(postErr),
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

// ---------------------------------------------------------------------------
// Post-dispatch: cadence detection, recommendation card, draft creation,
// and work-completion milestone emission.
//
// Spec §13.1 — cadence signals detected after task completion (not mid-flight).
// Spec §13 — milestone emissions per-agent on work-completion path.
// ---------------------------------------------------------------------------

interface PostDispatchInput {
  task: {
    id: string;
    description: string | null;
    title: string | null;
    subaccountId: string | null;
    organisationId: string;
  };
  taskId: string;
  organisationId: string;
  resolvedRoot: {
    agentId: string;
    subaccountId: string | null;
  };
}

async function postDispatchCadenceAndMilestone(input: PostDispatchInput): Promise<void> {
  const { task, taskId, organisationId, resolvedRoot } = input;
  const promptText = [task.title, task.description].filter(Boolean).join(' ');

  // 6a. Count prior runs for this org with a similar prompt heuristic.
  //     V1: count tasks in the same org (not per-user, not semantic) as a
  //     lightweight proxy for prior run frequency. A richer signal can be
  //     wired here in V2 without changing the pure detection function.
  const [{ value: priorRunCount }] = await db
    .select({ value: count() })
    .from(tasks)
    .where(and(
      eq(tasks.organisationId, organisationId),
      isNull(tasks.deletedAt),
    ));

  const cadenceResult = detectCadenceSignals({
    promptText,
    priorRunCount: Number(priorRunCount ?? 0),
  });

  logger.info('orchestratorFromTask.cadence_detection', {
    taskId,
    score: cadenceResult.score,
    signals: cadenceResult.signals.map((s) => s.name),
  });

  // 6b. Emit a recommendation card if score crosses the threshold.
  if (cadenceResult.score >= CADENCE_RECOMMEND_THRESHOLD) {
    try {
      const { emit } = await TaskEventService.appendAndEmit({
        taskId,
        runId: null,
        organisationId,
        eventOrigin: 'orchestrator',
        event: {
          kind: 'chat.message',
          payload: {
            authorKind: 'agent',
            authorId: resolvedRoot.agentId,
            body: 'This looks like something you would want to run on a schedule. Save it as a scheduled Workflow?',
            cardKind: 'workflow_recommendation',
            cardActions: [
              { id: 'accept', label: 'Yes, set up' },
              { id: 'decline', label: 'No thanks' },
            ],
          } as unknown as { authorKind: 'agent'; authorId: string; body: string },
        },
      });
      await emit();
      logger.info('orchestratorFromTask.recommendation_card_emitted', { taskId, score: cadenceResult.score });
    } catch (emitErr) {
      logger.warn('orchestratorFromTask.recommendation_card_emit_failed', {
        taskId,
        error: emitErr instanceof Error ? emitErr.message : String(emitErr),
      });
    }
  }

  // 6c. If an explicit workflow signal is present, create a draft.
  //     Explicit signal means score === 1.0 and the signal name is
  //     'explicit_workflow_intent'. We create a stub draft so Studio can
  //     hydrate it — steps are left empty here (the orchestrator run populates
  //     them via separate step-completion hooks in V2).
  const hasExplicitSignal = cadenceResult.signals.some(
    (s) => s.name === 'explicit_workflow_intent',
  );
  if (hasExplicitSignal && task.subaccountId) {
    try {
      await WorkflowDraftService.create({
        payload: [],  // Empty stub — Studio hydration fills steps (Chunk 14b)
        sessionId: taskId,  // Use taskId as session proxy for (subaccount, session) unique
        subaccountId: task.subaccountId,
        organisationId,
        draftSource: 'orchestrator',
      });
      logger.info('orchestratorFromTask.draft_created', { taskId });
    } catch (draftErr) {
      // Duplicate (subaccount, session) is expected on retries — log at debug.
      logger.info('orchestratorFromTask.draft_create_skipped', {
        taskId,
        reason: draftErr instanceof Error ? draftErr.message : String(draftErr),
      });
    }
  }

  // 6d. Emit a work-completion milestone for the orchestrator agent.
  //     This is the demonstration call site; a sweep TODO covers all call
  //     sites across other agents. See tasks/todo.md.
  try {
    const { emit } = await emitMilestone({
      taskId,
      organisationId,
      agentId: resolvedRoot.agentId,
      summary: 'Orchestrator dispatched task for processing',
    });
    await emit();
  } catch (milestoneErr) {
    logger.warn('orchestratorFromTask.milestone_emit_failed', {
      taskId,
      error: milestoneErr instanceof Error ? milestoneErr.message : String(milestoneErr),
    });
  }
}
