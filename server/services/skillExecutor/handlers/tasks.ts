import type { SkillExecutionContext } from '../context.js';
import { enqueueHandoff } from '../pipeline.js';
import { taskService } from '../../taskService.js';
import { db } from '../../../db/index.js';
import { tasks, subaccountAgents, agents } from '../../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { isActive } from '../../../lib/queryHelpers.js';
import {
  MAX_HANDOFF_DEPTH,
  MAX_TASK_TITLE_LENGTH,
  MAX_TASK_DESCRIPTION_LENGTH,
  VALID_PRIORITIES,
  type TaskPriority,
} from '../../../config/limits.js';
import {
  resolveWriteSkillScope,
  computeReassignDirection,
  validateReassignScope,
  evaluateReassignPreconditions,
} from '../../skillExecutorDelegationPure.js';
import { computeDescendantIds } from '../../../tools/config/configSkillHandlersPure.js';
import { insertOutcomeSafe } from '../../delegationOutcomeService.js';
import { insertExecutionEventSafe } from '../../agentExecutionEventService.js';
import { HIERARCHY_CONTEXT_MISSING } from '../../../../shared/types/delegation.js';
import { getOrgScopedDb } from '../../../lib/orgScopedDb.js';

// ---------------------------------------------------------------------------
// Create Task — with handoff support
// ---------------------------------------------------------------------------

export async function executeCreateTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const title = String(input.title ?? '').slice(0, MAX_TASK_TITLE_LENGTH);
  if (!title) return { success: false, error: 'title is required' };

  // Support both singular assigned_agent_id and plural assigned_agent_ids array
  const rawSingular = input.assigned_agent_id ? String(input.assigned_agent_id) : undefined;
  const rawPlural = Array.isArray(input.assigned_agent_ids)
    ? (input.assigned_agent_ids as unknown[]).map(String)
    : rawSingular ? [rawSingular] : [];
  const assignedAgentIds = [...new Set(rawPlural.filter(Boolean))];

  // Self-assignment prevention
  if (assignedAgentIds.includes(context.agentId)) {
    return { success: false, error: 'Cannot assign a task to yourself — this would create an infinite loop. Assign to a different agent or leave unassigned.' };
  }

  // Validate priority
  const rawPriority = String(input.priority ?? 'normal');
  const priority: TaskPriority = (VALID_PRIORITIES as readonly string[]).includes(rawPriority)
    ? rawPriority as TaskPriority
    : 'normal';

  const description = input.description ? String(input.description).slice(0, MAX_TASK_DESCRIPTION_LENGTH) : undefined;
  const handoffContext = input.handoff_context ? String(input.handoff_context) : undefined;
  const currentDepth = context.handoffDepth ?? 0;

  // Check handoff depth BEFORE creating the task to avoid orphans
  if (assignedAgentIds.length > 0 && currentDepth + 1 > MAX_HANDOFF_DEPTH) {
    return {
      success: false,
      error: `Handoff depth limit (${MAX_HANDOFF_DEPTH}) reached. Cannot assign task to another agent at this depth. Create the task without assignment instead.`,
    };
  }

  try {
    const tx = getOrgScopedDb('service:skillExecutor.executeCreateTask');
    const item = await taskService.createTask(
      {
        organisationId: context.organisationId,
        subaccountId: context.subaccountId!,
        data: {
          title,
          description,
          priority,
          status: input.status ? String(input.status) : 'inbox',
          assignedAgentIds: assignedAgentIds.length ? assignedAgentIds : undefined,
          createdByAgentId: context.agentId,
          handoffSourceRunId: context.runId,
          handoffContext: handoffContext ? { message: handoffContext } : undefined,
          handoffDepth: assignedAgentIds.length ? currentDepth + 1 : 0,
        },
      },
      tx,
    );

    // Trigger a handoff for every assigned agent
    const handoffResults = await Promise.all(
      assignedAgentIds.map(agentId =>
        enqueueHandoff({
          taskId: item.id,
          agentId,
          subaccountId: context.subaccountId!,
          organisationId: context.organisationId,
          sourceRunId: context.runId,
          handoffDepth: currentDepth + 1,
          handoffContext,
        })
      )
    );
    const handoffsEnqueued = handoffResults.filter(r => r.enqueued).length;

    return {
      success: true,
      task_id: item.id,
      title: item.title,
      status: item.status,
      assigned_agent_ids: assignedAgentIds,
      handoffs_enqueued: handoffsEnqueued,
      _created_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create task: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Triage Intake — capture and route ideas/bugs into the inbox
//
// Two modes:
//   - capture: fast, judgement-free intake of one item. Builds a structured
//              description and creates a task in the 'inbox' status column.
//              Bugs that mention data corruption/data loss are auto-escalated
//              to priority='urgent'.
//   - triage:  scans the inbox for tasks lacking a triage disposition and
//              returns a structured proposal list (type_inferred, suggested
//              disposition, rationale). The skill is a *proposer*, not an
//              applier — the caller (orchestrator or human) decides which
//              dispositions to apply via move_task / update_task.
//
// Spec: server/skills/triage_intake.md
// ---------------------------------------------------------------------------

const DATA_LOSS_PATTERN =
  /\b(data\s*loss|data\s*corruption|corrupted|lost\s+data|wrong\s+data\s+written|cannot\s+recover|deleted\s+(?:rows?|records?)|overwritten|stale\s+writes?)\b/i;

const TRIAGE_DECISION_MARKER = 'Triage decision:';

function buildIdeaDescription(args: {
  source: string;
  rawInput: string;
  relatedTaskId?: string;
}): string {
  return [
    `Task type: idea`,
    `Origin: ${args.source}`,
    `Related task: ${args.relatedTaskId ?? 'None'}`,
    ``,
    `Problem / Opportunity:`,
    args.rawInput.trim(),
    ``,
    `Notes:`,
    `Captured via triage_intake (capture mode). Awaiting triage disposition — the orchestrator or a human will assess scope, value, and routing in the next triage pass.`,
  ].join('\n');
}

function buildBugDescription(args: {
  source: string;
  rawInput: string;
  relatedTaskId?: string;
  dataLossEscalated: boolean;
}): string {
  return [
    `Task type: bug`,
    `Origin: ${args.source}`,
    `Related task: ${args.relatedTaskId ?? 'None'}`,
    ``,
    `Reported behaviour:`,
    args.rawInput.trim(),
    ``,
    `Expected behaviour:`,
    `(to be filled in during triage)`,
    ``,
    `Reproduction steps:`,
    `(to be filled in during triage)`,
    ``,
    `Impact estimate:`,
    `- Users affected: Unknown`,
    `- Data impact: ${args.dataLossEscalated ? 'POSSIBLE DATA LOSS — escalated to urgent priority' : 'Unknown'}`,
    `- Workaround exists: Unknown`,
    args.dataLossEscalated
      ? `\n⚠ AUTO-ESCALATED: data-loss/corruption keywords detected in raw input. Priority set to urgent. Human review required before fix work begins.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildChoreDescription(args: {
  source: string;
  rawInput: string;
  relatedTaskId?: string;
}): string {
  return [
    `Task type: chore`,
    `Origin: ${args.source}`,
    `Related task: ${args.relatedTaskId ?? 'None'}`,
    ``,
    `Description:`,
    args.rawInput.trim(),
    ``,
    `Notes:`,
    `Captured via triage_intake (capture mode). Awaiting scheduling decision.`,
  ].join('\n');
}

function inferTypeFromDescription(description: string | null): 'idea' | 'bug' | 'chore' | 'unknown' {
  if (!description) return 'unknown';
  const match = description.match(/^Task type:\s*(idea|bug|chore)/im);
  return (match?.[1]?.toLowerCase() as 'idea' | 'bug' | 'chore' | undefined) ?? 'unknown';
}

function suggestDisposition(args: {
  type: ReturnType<typeof inferTypeFromDescription>;
  priority: string;
  description: string | null;
  title: string;
}): { disposition: 'Defer' | 'Assess' | 'Schedule' | 'Close'; rationale: string } {
  // Urgent items always get Schedule (they need to be acted on, not deferred)
  if (args.priority === 'urgent') {
    return {
      disposition: 'Schedule',
      rationale: 'Urgent priority — requires immediate scheduling, not deferral.',
    };
  }

  // Bugs with data-loss markers — already escalated above. Ordinary bugs → Schedule.
  if (args.type === 'bug') {
    return {
      disposition: 'Schedule',
      rationale: 'Bug reports default to schedule for fix work — defer only after explicit assessment.',
    };
  }

  // Chores → Schedule (small, predictable work)
  if (args.type === 'chore') {
    return {
      disposition: 'Schedule',
      rationale: 'Chore tasks are small and predictable — schedule directly without spec work.',
    };
  }

  // Ideas → Assess (need BA evaluation before sizing)
  if (args.type === 'idea') {
    return {
      disposition: 'Assess',
      rationale: 'Idea/feature request — route to Business Analyst for scope and value assessment before scheduling.',
    };
  }

  // Unknown type — default to Defer (safer than guessing)
  return {
    disposition: 'Defer',
    rationale: 'Unknown task type — defer until reclassified or human reviews.',
  };
}

export async function executeTriageIntake(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const mode = String(input.mode ?? '');
  if (mode !== 'capture' && mode !== 'triage') {
    return { success: false, error: "mode must be 'capture' or 'triage'" };
  }

  // ── CAPTURE MODE ──────────────────────────────────────────────────────
  if (mode === 'capture') {
    const rawInput = String(input.raw_input ?? '').trim();
    const inputType = String(input.input_type ?? '').toLowerCase();
    const source = String(input.source ?? '').trim();
    const relatedTaskId = input.related_task_id ? String(input.related_task_id) : undefined;

    if (!rawInput) {
      return { success: false, error: "'raw_input' is required in capture mode" };
    }
    if (inputType !== 'idea' && inputType !== 'bug' && inputType !== 'chore') {
      return {
        success: false,
        error: "'input_type' must be one of: idea, bug, chore",
      };
    }
    if (!source) {
      return { success: false, error: "'source' is required in capture mode" };
    }

    // Detect data-loss escalation for bugs (per spec escalation rule)
    const dataLossEscalated = inputType === 'bug' && DATA_LOSS_PATTERN.test(rawInput);

    // Map intake type → runtime priority. Bugs with data-loss markers escalate
    // to 'urgent'; everything else defaults to 'normal'. Triage mode is the
    // place where priorities get adjusted further if needed.
    const priority: TaskPriority = dataLossEscalated ? 'urgent' : 'normal';

    // Build the structured description per the spec template
    let description: string;
    if (inputType === 'idea') {
      description = buildIdeaDescription({ source, rawInput, relatedTaskId });
    } else if (inputType === 'bug') {
      description = buildBugDescription({ source, rawInput, relatedTaskId, dataLossEscalated });
    } else {
      description = buildChoreDescription({ source, rawInput, relatedTaskId });
    }

    // Title: first line of raw input, truncated. Capture mode is allowed to
    // be lossy here — the structured description carries the full content.
    const title = rawInput.split(/\n/, 1)[0]!.slice(0, MAX_TASK_TITLE_LENGTH).trim() || `${inputType} from ${source}`;

    try {
      const tx = getOrgScopedDb('service:skillExecutor.executeTriageIntake');
      const item = await taskService.createTask(
        {
          organisationId: context.organisationId,
          subaccountId: context.subaccountId!,
          data: {
            title,
            description: description.slice(0, MAX_TASK_DESCRIPTION_LENGTH),
            priority,
            status: 'inbox',
            createdByAgentId: context.agentId,
          },
        },
        tx,
      );

      return {
        success: true,
        mode: 'capture' as const,
        task_id: item.id,
        title: item.title,
        captured_type: inputType,
        priority,
        escalated: dataLossEscalated,
        _created_task: true,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to capture task: ${errMsg}` };
    }
  }

  // ── TRIAGE MODE ───────────────────────────────────────────────────────
  // Scan the inbox for items lacking a triage disposition and return a
  // structured proposal list. This skill does NOT apply dispositions —
  // the caller (orchestrator or human) does that via move_task/update_task.
  const scope = String(input.scope ?? 'all');
  const relatedTaskId = input.related_task_id ? String(input.related_task_id) : undefined;

  if (scope === 'single' && !relatedTaskId) {
    return { success: false, error: "'related_task_id' is required when scope='single'" };
  }

  try {
    // C1 (adversarial 2026-05-16) — triage-mode read must carry the Layer A
    // organisationId predicate AND go through getOrgScopedDb to engage Layer B
    // RLS. The capture-mode branch above already uses getOrgScopedDb; this
    // branch was the missing read site flagged in the wave-3 review.
    const conditions = [
      eq(tasks.organisationId, context.organisationId),
      eq(tasks.subaccountId, context.subaccountId!),
      eq(tasks.status, 'inbox'),
      isActive(tasks),
    ];
    if (scope === 'single' && relatedTaskId) {
      conditions.push(eq(tasks.id, relatedTaskId));
    }

    const triageTx = getOrgScopedDb('service:skillExecutor.executeTriageIntake.triage');
    const inboxRows = await triageTx
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        priority: tasks.priority,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .where(and(...conditions));

    // Filter out items that already carry a triage decision marker — those
    // have been triaged in a previous pass and are awaiting application.
    const untriaged = inboxRows.filter(
      (row) => !row.description?.includes(TRIAGE_DECISION_MARKER)
    );

    const proposals = untriaged.map((row) => {
      const type = inferTypeFromDescription(row.description);
      const { disposition, rationale } = suggestDisposition({
        type,
        priority: row.priority,
        description: row.description,
        title: row.title,
      });
      return {
        task_id: row.id,
        title: row.title,
        type_inferred: type,
        priority: row.priority,
        suggested_disposition: disposition,
        rationale,
      };
    });

    // Group counts for the summary block
    const byDisposition = proposals.reduce<Record<string, number>>((acc, p) => {
      acc[p.suggested_disposition] = (acc[p.suggested_disposition] ?? 0) + 1;
      return acc;
    }, {});

    return {
      success: true,
      mode: 'triage' as const,
      scope,
      scanned: inboxRows.length,
      already_triaged: inboxRows.length - untriaged.length,
      proposals_returned: proposals.length,
      summary: byDisposition,
      proposals,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to scan inbox for triage: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Move Task
// ---------------------------------------------------------------------------

export async function executeMoveTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  const status = String(input.status ?? '');

  if (!taskId) return { success: false, error: 'task_id is required' };
  if (!status) return { success: false, error: 'status is required' };

  try {
    // Get current item to find subaccount
    const item = await taskService.getTask(taskId, context.organisationId);
    const position = await taskService._nextPosition(item.subaccountId!, status as Parameters<typeof taskService._nextPosition>[1]);

    const updated = await taskService.moveTask(
      taskId,
      context.organisationId,
      { status, position }
    );

    return {
      success: true,
      task_id: updated.id,
      new_status: updated.status,
      _updated_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to move task: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Add Deliverable
// ---------------------------------------------------------------------------

export async function executeAddDeliverable(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  const title = String(input.title ?? '');
  const deliverableType = String(input.deliverable_type ?? 'artifact') as 'file' | 'url' | 'artifact';
  const description = String(input.description ?? '');

  if (!taskId) return { success: false, error: 'task_id is required' };
  if (!title) return { success: false, error: 'title is required' };

  try {
    const deliverable = await taskService.addDeliverable(taskId, context.organisationId, {
      deliverableType,
      title,
      description: description || undefined,
    });

    // Also log an activity
    await taskService.addActivity(taskId, context.organisationId, {
      activityType: 'deliverable_added',
      message: `Deliverable added: "${title}"`,
      agentId: context.agentId,
    });

    return {
      success: true,
      deliverable_id: deliverable.id,
      _created_deliverable: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to add deliverable: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Update Task — update content fields (title, description, priority)
// ---------------------------------------------------------------------------

export async function executeUpdateTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  if (!taskId) return { success: false, error: 'task_id is required' };

  const reasoning = String(input.reasoning ?? '').trim();
  if (!reasoning) return { success: false, error: 'reasoning is required' };

  const update: {
    title?: string;
    description?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
  } = {};

  if (input.title !== undefined) update.title = String(input.title).slice(0, 255);
  if (input.description !== undefined) update.description = String(input.description);
  if (input.priority !== undefined) {
    const p = String(input.priority);
    if (!['low', 'normal', 'high', 'urgent'].includes(p)) {
      return { success: false, error: `Invalid priority: ${p}` };
    }
    update.priority = p as 'low' | 'normal' | 'high' | 'urgent';
  }

  if (!Object.keys(update).length) {
    return { success: false, error: 'At least one field (title, description, priority) must be provided' };
  }

  try {
    const updated = await taskService.updateTask(taskId, context.organisationId, update);

    await taskService.addActivity(taskId, context.organisationId, {
      activityType: 'note',
      message: `Updated by agent: ${reasoning}`,
      agentId: context.agentId,
    });

    return {
      success: true,
      task_id: updated.id,
      updated_fields: Object.keys(update),
      _updated_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to update task: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Reassign Task — hand current task to another agent
// ---------------------------------------------------------------------------

export async function executeReassignTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  // --- STEP 1: Evaluate preconditions (hierarchy context) ---
  const reassignPre = evaluateReassignPreconditions({ hierarchy: context.hierarchy });
  if (!reassignPre.ok) {
    const errorCtx = {
      runId: context.runId,
      callerAgentId: context.agentId,
      skillSlug: 'reassign_task',
    };
    await insertExecutionEventSafe({
      runId: context.runId,
      organisationId: context.organisationId,
      subaccountId: context.subaccountId ?? null,
      payload: { eventType: 'tool.error', critical: false, error: { code: HIERARCHY_CONTEXT_MISSING, message: 'Hierarchy context is missing', context: errorCtx } },
      sourceService: 'skillExecutor',
    });
    return { success: false, error: HIERARCHY_CONTEXT_MISSING, context: errorCtx };
  }

  const hierarchy = context.hierarchy!;

  // --- STEP 2: Input parsing ---
  const taskId = String(input.task_id ?? '');
  const handoffContext = input.handoff_context ? String(input.handoff_context) : undefined;

  if (!taskId) return { success: false, error: 'task_id is required' };

  const rawSingular = input.assigned_agent_id ? String(input.assigned_agent_id) : undefined;
  const rawPlural = Array.isArray(input.assigned_agent_ids)
    ? (input.assigned_agent_ids as unknown[]).map(String)
    : rawSingular ? [rawSingular] : [];
  const assignedAgentIds = [...new Set(rawPlural.filter(Boolean))];

  if (!assignedAgentIds.length) return { success: false, error: 'assigned_agent_id or assigned_agent_ids is required' };

  // Self-assignment prevention
  if (assignedAgentIds.includes(context.agentId)) {
    return { success: false, error: 'Cannot reassign a task to yourself. Choose a different agent.' };
  }

  // --- STEP 3: Depth check ---
  const currentDepth = context.handoffDepth ?? 0;
  if (currentDepth + 1 > MAX_HANDOFF_DEPTH) {
    return { success: false, error: `Handoff depth limit (${MAX_HANDOFF_DEPTH}) reached. Cannot reassign further.` };
  }

  // --- STEP 4: Compute effective scope ---
  const effectiveScope = resolveWriteSkillScope({ rawScope: input.delegationScope, hierarchy });

  // --- STEP 5: Resolve saLinks and validate scope for each target ---
  // Load descendant ids once if needed (single round trip for all targets)
  let descendantIds: string[] = [];
  if (effectiveScope === 'descendants') {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const rosterRows = await db
      .select({
        subaccountAgentId: subaccountAgents.id,
        agentId: subaccountAgents.agentId,
        parentSubaccountAgentId: subaccountAgents.parentSubaccountAgentId,
      })
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.subaccountId, context.subaccountId!),
          eq(subaccountAgents.organisationId, context.organisationId),
          eq(subaccountAgents.isActive, true)
        )
      );
    descendantIds = computeDescendantIds({
      callerSubaccountAgentId: hierarchy.agentId,
      roster: rosterRows.map(r => ({
        subaccountAgentId: r.subaccountAgentId,
        agentId: r.agentId,
        parentSubaccountAgentId: r.parentSubaccountAgentId ?? null,
      })),
    });
  }

  const isCallerRoot = hierarchy.rootId === hierarchy.agentId;

  // Validate all targets; collect resolved saLinks + directions
  const resolvedAssignees: Array<{ agentId: string; saLinkId: string; direction: 'up' | 'down' | 'lateral' }> = [];

  for (const agentId of assignedAgentIds) {
    // Look up the subaccount agent link for this target
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    const [saLinkRow] = await db
      .select({ sa: subaccountAgents })
      .from(subaccountAgents)
      .innerJoin(agents, and(eq(agents.id, subaccountAgents.agentId), isActive(agents)))
      .where(
        and(
          eq(subaccountAgents.subaccountId, context.subaccountId!),
          eq(subaccountAgents.agentId, agentId),
          eq(subaccountAgents.isActive, true),
          eq(agents.status, 'active'),
        )
      );

    if (!saLinkRow) {
      return { success: false, error: `Agent ${agentId} not found or inactive in this subaccount` };
    }

    const targetSaId = saLinkRow.sa.id;

    // Compute direction — upward escalation check BEFORE scope validation (INV-2 ordering)
    const direction = computeReassignDirection({
      targetSubaccountAgentId: targetSaId,
      parentId: hierarchy.parentId,
      childIds: hierarchy.childIds,
      descendantIds,
    });

    // Upward escalation always permitted — skip scope check
    if (direction === 'up') {
      resolvedAssignees.push({ agentId, saLinkId: targetSaId, direction });
      continue;
    }

    // Validate scope for non-upward targets
    const scopeResult = validateReassignScope({
      targetSubaccountAgentId: targetSaId,
      effectiveScope,
      childIds: hierarchy.childIds,
      descendantIds,
      isCallerRoot,
    });

    if (!scopeResult.valid) {
      await insertOutcomeSafe({
        organisationId: context.organisationId,
        subaccountId: context.subaccountId!,
        runId: context.runId,
        callerAgentId: hierarchy.agentId,
        targetAgentId: targetSaId,
        delegationScope: effectiveScope,
        outcome: 'rejected',
        reason: scopeResult.errorCode,
        delegationDirection: direction,
      });
      const callerChildIds = hierarchy.childIds.slice(0, 50);
      const errorCtx: Record<string, unknown> = scopeResult.errorCode === 'cross_subtree_not_permitted'
        ? { runId: context.runId, callerAgentId: context.agentId, callerParentId: hierarchy.parentId, suggestedScope: hierarchy.childIds.length > 0 ? 'children' : 'descendants' }
        : { runId: context.runId, callerAgentId: context.agentId, targetAgentId: agentId, delegationScope: effectiveScope, callerChildIds };
      if (scopeResult.errorCode === 'delegation_out_of_scope' && hierarchy.childIds.length > 50) {
        errorCtx.truncated = true;
      }
      await insertExecutionEventSafe({
        runId: context.runId,
        organisationId: context.organisationId,
        subaccountId: context.subaccountId ?? null,
        payload: { eventType: 'tool.error', critical: false, error: { code: scopeResult.errorCode, message: scopeResult.errorCode === 'cross_subtree_not_permitted' ? 'Cross-subtree reassignment requires the caller to be the subaccount root.' : 'Reassign target is outside delegation scope.', context: errorCtx } },
        sourceService: 'skillExecutor',
      });
      return { success: false, error: scopeResult.errorCode, context: errorCtx };
    }

    resolvedAssignees.push({ agentId, saLinkId: targetSaId, direction });
  }

  // Determine the canonical direction to store on the task.
  // For single-target (typical case), use the computed direction.
  // For multi-target, use 'down' if any target is down, else use the first target's direction.
  const taskDelegationDirection: 'up' | 'down' | 'lateral' =
    resolvedAssignees.some(a => a.direction === 'down') ? 'down' :
    resolvedAssignees.some(a => a.direction === 'up') ? 'up' :
    'lateral';

  // --- STEP 6: Execute handoff (critical path) ---
  try {
    await taskService.updateTask(taskId, context.organisationId, {
      assignedAgentIds,
    });

    // Write delegation_direction on the task (critical path).
    // F7 (audit 2026-05-14) — migrated from raw db to getOrgScopedDb. The
    // handler runs inside an active withOrgTx block, so the org-scoped tx
    // engages RLS (Layer B) via app.organisation_id; the explicit
    // organisationId predicate is Layer A defence-in-depth. The prior
    // raw-db call opened a fresh unscoped pool connection where the GUC
    // was unset — neither layer was wired.
    await getOrgScopedDb('skillExecutor.handoff.taskMetadata')
      .update(tasks)
      .set({
        handoffSourceRunId: context.runId,
        handoffContext: handoffContext ? { message: handoffContext } : null,
        handoffDepth: currentDepth + 1,
        delegationDirection: taskDelegationDirection,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, context.organisationId)));

    await taskService.addActivity(taskId, context.organisationId, {
      activityType: 'assigned',
      message: `Reassigned to ${assignedAgentIds.length} agent${assignedAgentIds.length > 1 ? 's' : ''}${handoffContext ? ` — ${handoffContext}` : ''}`,
      agentId: context.agentId,
    });

    // Trigger a handoff for every assigned agent
    const handoffResults = await Promise.all(
      resolvedAssignees.map(a =>
        enqueueHandoff({
          taskId,
          agentId: a.agentId,
          subaccountId: context.subaccountId!,
          organisationId: context.organisationId,
          sourceRunId: context.runId,
          handoffDepth: currentDepth + 1,
          handoffContext,
        })
      )
    );
    const handoffsEnqueued = handoffResults.filter(r => r.enqueued).length;

    // Write accepted outcome rows (fire-and-forget per INV-3)
    for (const a of resolvedAssignees) {
      void insertOutcomeSafe({
        organisationId: context.organisationId,
        subaccountId: context.subaccountId!,
        runId: context.runId,
        callerAgentId: hierarchy.agentId,
        targetAgentId: a.saLinkId,
        delegationScope: effectiveScope,
        outcome: 'accepted',
        reason: null,
        delegationDirection: a.direction,
      });
    }

    return {
      success: true,
      task_id: taskId,
      assigned_agent_ids: assignedAgentIds,
      handoffs_enqueued: handoffsEnqueued,
      _updated_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to reassign task: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Read Inbox — stub (provider integration pending)
// ---------------------------------------------------------------------------

export async function executeReadInbox(
  _input: Record<string, unknown>,
  _context: SkillExecutionContext
): Promise<unknown> {
  return {
    success: true,
    result: {
      messages: [],
      note: 'read_inbox: provider integration pending',
    },
  };
}

// ---------------------------------------------------------------------------
// Report Bug — create a bug task in the inbox from QA agent
// ---------------------------------------------------------------------------

export async function executeReportBug(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const title = String(input.title ?? '').slice(0, MAX_TASK_TITLE_LENGTH);
  if (!title) return { success: false, error: 'title is required' };

  const description = input.description ? String(input.description).slice(0, MAX_TASK_DESCRIPTION_LENGTH) : undefined;
  const severity = String(input.severity ?? 'medium'); // low | medium | high | critical
  const confidence = Number(input.confidence ?? 0.8);
  const stepsToReproduce = input.steps_to_reproduce ? String(input.steps_to_reproduce) : undefined;
  const expectedBehavior = input.expected_behavior ? String(input.expected_behavior) : undefined;
  const actualBehavior = input.actual_behavior ? String(input.actual_behavior) : undefined;

  const bugDescription = [
    description,
    stepsToReproduce ? `**Steps to reproduce:**\n${stepsToReproduce}` : null,
    expectedBehavior ? `**Expected:** ${expectedBehavior}` : null,
    actualBehavior ? `**Actual:** ${actualBehavior}` : null,
    `**Severity:** ${severity}`,
    `**Confidence:** ${(confidence * 100).toFixed(0)}%`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_TASK_DESCRIPTION_LENGTH);

  // Map severity to task priority
  const priorityMap: Record<string, string> = {
    critical: 'urgent',
    high: 'high',
    medium: 'normal',
    low: 'low',
  };
  const priority = (priorityMap[severity] ?? 'normal') as 'urgent' | 'high' | 'normal' | 'low';

  try {
    const tx = getOrgScopedDb('service:skillExecutor.executeReportBug');
    const task = await taskService.createTask(
      {
        organisationId: context.organisationId,
        subaccountId: context.subaccountId!,
        data: {
          title: `[BUG] ${title}`,
          description: bugDescription,
          status: 'inbox',
          priority,
          createdByAgentId: context.agentId,
        },
      },
      tx,
    );

    await taskService.addActivity(task.id, context.organisationId, {
      activityType: 'note',
      message: `Bug reported by QA agent — severity: ${severity}, confidence: ${(confidence * 100).toFixed(0)}%`,
      agentId: context.agentId,
    });

    return {
      success: true,
      task_id: task.id,
      title: task.title,
      severity,
      confidence,
      _created_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to report bug: ${errMsg}` };
  }
}
