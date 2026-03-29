import { eq, and, isNull } from 'drizzle-orm';
import { env } from '../lib/env.js';
import { db } from '../db/index.js';
import { subaccountAgents, agents, agentRuns, tasks } from '../db/schema/index.js';
import { taskService } from './taskService.js';
import { executeTriggerredProcess } from './llmService.js';
import { agentExecutionService } from './agentExecutionService.js';
import { actionService } from './actionService.js';
import { executionLayerService } from './executionLayerService.js';
import { reviewService } from './reviewService.js';
import { getActionDefinition } from '../config/actionRegistry.js';
import {
  MAX_HANDOFF_DEPTH,
  MAX_TASK_TITLE_LENGTH,
  MAX_TASK_DESCRIPTION_LENGTH,
  VALID_PRIORITIES,
  MAX_SUB_AGENTS,
  MIN_SUB_AGENT_TOKEN_BUDGET,
  SUB_AGENT_TIMEOUT_BUFFER,
  type TaskPriority,
} from '../config/limits.js';

// ---------------------------------------------------------------------------
// Skill Executor — executes tool calls for autonomous agent runs
// ---------------------------------------------------------------------------

interface SkillExecutionContext {
  runId: string;
  organisationId: string;
  subaccountId: string;
  agentId: string;
  orgProcesses: Array<{ id: string; name: string; description: string | null; inputSchema: string | null }>;
  handoffDepth?: number;
  isSubAgent?: boolean;
  tokenBudget?: number;
  startTime?: number;
  timeoutMs?: number;
  /** The task this agent run is working on, if any. Used for gate escalation. */
  taskId?: string;
}

interface SkillExecutionParams {
  skillName: string;
  input: Record<string, unknown>;
  context: SkillExecutionContext;
}

// Handoff job queue name
const AGENT_HANDOFF_QUEUE = 'agent-handoff-run';

// pg-boss reference for enqueueing handoff jobs (set by agentScheduleService)
let pgBossSend: ((name: string, data: object) => Promise<string | null>) | null = null;

export function setHandoffJobSender(sender: (name: string, data: object) => Promise<string | null>) {
  pgBossSend = sender;
}

export const skillExecutor = {
  async execute(params: SkillExecutionParams): Promise<unknown> {
    const { skillName, input, context } = params;

    switch (skillName) {
      // ── Direct skills (no action record) ──────────────────────────────
      case 'web_search':
        return executeWebSearch(input);
      case 'read_workspace':
        return executeReadWorkspace(input, context);
      case 'write_workspace':
        return executeWriteWorkspace(input, context);
      case 'trigger_process':
        return executeTriggerProcess(input, context);
      case 'spawn_sub_agents':
        return executeSpawnSubAgents(input, context);

      // ── Auto-gated skills (action record for audit, executes synchronously) ──
      case 'create_task':
        return executeWithActionAudit('create_task', input, context, () => executeCreateTask(input, context));
      case 'move_task':
        return executeWithActionAudit('move_task', input, context, () => executeMoveTask(input, context));
      case 'add_deliverable':
        return executeWithActionAudit('add_deliverable', input, context, () => executeAddDeliverable(input, context));
      case 'reassign_task':
        return executeWithActionAudit('reassign_task', input, context, () => executeReassignTask(input, context));

      // ── Review-gated skills (proposes action, does NOT execute immediately) ──
      case 'send_email':
        return proposeReviewGatedAction('send_email', input, context);
      case 'update_record':
        return proposeReviewGatedAction('update_record', input, context);

      default:
        return { success: false, error: `Unknown skill: ${skillName}` };
    }
  },
};

// ---------------------------------------------------------------------------
// Action-gated execution helpers
// ---------------------------------------------------------------------------

/**
 * Wraps an auto-gated internal skill: creates an action record for auditability,
 * then executes the original skill logic synchronously and records the result.
 */
async function executeWithActionAudit(
  actionType: string,
  input: Record<string, unknown>,
  context: SkillExecutionContext,
  executor: () => Promise<unknown>
): Promise<unknown> {
  const idempotencyKey = `${actionType}:${context.runId}:${Date.now()}`;

  try {
    const proposed = await actionService.proposeAction({
      organisationId: context.organisationId,
      subaccountId: context.subaccountId,
      agentId: context.agentId,
      agentRunId: context.runId,
      actionType,
      idempotencyKey,
      payload: input,
      taskId: context.taskId,
    });

    // If returned existing (not new), return its status
    if (!proposed.isNew) {
      return { success: true, action_id: proposed.actionId, status: proposed.status, message: 'Duplicate action detected' };
    }

    // Auto-gated: should be approved immediately by proposeAction
    if (proposed.status !== 'approved') {
      return { success: false, action_id: proposed.actionId, status: proposed.status, message: `Action gated: ${proposed.status}` };
    }

    // Lock and execute
    const locked = await actionService.lockForExecution(proposed.actionId, context.organisationId);
    if (!locked) {
      return { success: false, error: 'Failed to acquire execution lock' };
    }

    // Run the original skill logic
    const result = await executor();

    // Record completion
    const resultObj = result as Record<string, unknown>;
    if (resultObj.success) {
      await actionService.markCompleted(proposed.actionId, context.organisationId, result);
    } else {
      await actionService.markFailed(proposed.actionId, context.organisationId, resultObj.error ?? 'Unknown error');
    }

    return result;
  } catch (err) {
    // If action tracking fails, still execute the original skill
    // to avoid breaking existing behaviour during rollout
    console.error(`[ActionAudit] Failed to track ${actionType}, executing directly:`, err);
    return executor();
  }
}

/**
 * Proposes a review-gated action. Does NOT execute — returns the action status
 * to the agent so it knows the action is queued for human review.
 */
async function proposeReviewGatedAction(
  actionType: string,
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const definition = getActionDefinition(actionType);
  if (!definition) {
    return { success: false, error: `Unknown action type: ${actionType}` };
  }

  // Build idempotency key from payload
  const keyParts = [actionType, context.subaccountId];
  if (input.thread_id) keyParts.push(String(input.thread_id));
  if (input.record_id) keyParts.push(String(input.record_id));
  keyParts.push(String(Date.now()));
  const idempotencyKey = keyParts.join(':');

  try {
    const proposed = await actionService.proposeAction({
      organisationId: context.organisationId,
      subaccountId: context.subaccountId,
      agentId: context.agentId,
      agentRunId: context.runId,
      actionType,
      idempotencyKey,
      payload: input,
      metadata: input.metadata as Record<string, unknown> | undefined,
      taskId: context.taskId,
    });

    if (!proposed.isNew) {
      return {
        success: true,
        action_id: proposed.actionId,
        status: proposed.status,
        message: 'Action already exists (duplicate detected)',
      };
    }

    // Create review item if pending approval
    if (proposed.status === 'pending_approval') {
      const action = await actionService.getAction(proposed.actionId, context.organisationId);
      await reviewService.createReviewItem(action, {
        actionType,
        reasoning: input.metadata ? String((input.metadata as Record<string, unknown>).reasoning ?? '') : undefined,
        proposedPayload: input,
      });
    }

    return {
      success: true,
      action_id: proposed.actionId,
      status: proposed.status,
      message: proposed.status === 'pending_approval'
        ? 'Action queued for human review. It will execute after approval.'
        : `Action status: ${proposed.status}`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to propose ${actionType}: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Web Search (Tavily)
// ---------------------------------------------------------------------------

async function executeWebSearch(input: Record<string, unknown>): Promise<unknown> {
  const apiKey = env.TAVILY_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'Web search is not configured (TAVILY_API_KEY not set)' };
  }

  const query = String(input.query ?? '');
  const maxResults = Math.min(Number(input.max_results ?? 5), 10);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_answer: true,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return { success: false, error: `Search API error: ${errorText}` };
    }

    const data = await response.json() as {
      answer?: string;
      results?: Array<{
        title: string;
        url: string;
        content: string;
        score: number;
      }>;
    };

    return {
      success: true,
      answer: data.answer ?? null,
      results: (data.results ?? []).map(r => ({
        title: r.title,
        url: r.url,
        content: r.content,
        relevance_score: r.score,
      })),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Search failed: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Read Workspace
// ---------------------------------------------------------------------------

async function executeReadWorkspace(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const filters: { status?: string; assignedAgentId?: string } = {};

  if (input.status) filters.status = String(input.status);
  if (input.assigned_to_me) filters.assignedAgentId = context.agentId;

  const limit = Math.min(Number(input.limit ?? 20), 50);
  const includeActivities = Boolean(input.include_activities);

  try {
    const items = await taskService.listTasks(
      context.organisationId,
      context.subaccountId,
      filters
    );

    const sliced = items.slice(0, limit);

    if (includeActivities) {
      const enriched = await Promise.all(sliced.map(async (item) => {
        const activities = await taskService.listActivities(item.id);
        return {
          id: item.id,
          title: item.title,
          description: item.description,
          brief: item.brief,
          status: item.status,
          priority: item.priority,
          assignedAgent: item.assignedAgent,
          createdAt: item.createdAt,
          activities: activities.slice(0, 5).map(a => ({
            type: a.activityType,
            message: a.message,
            createdAt: a.createdAt,
          })),
        };
      }));
      return { success: true, items: enriched, total: items.length };
    }

    return {
      success: true,
      items: sliced.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        brief: item.brief,
        status: item.status,
        priority: item.priority,
        assignedAgent: item.assignedAgent,
        createdAt: item.createdAt,
      })),
      total: items.length,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to read board: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Write Workspace (add activity)
// ---------------------------------------------------------------------------

async function executeWriteWorkspace(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  const activityType = String(input.activity_type ?? 'progress') as 'progress' | 'note' | 'completed' | 'blocked';
  const message = String(input.message ?? '');

  if (!taskId) return { success: false, error: 'task_id is required' };
  if (!message) return { success: false, error: 'message is required' };

  try {
    const activity = await taskService.addActivity(taskId, {
      activityType,
      message,
      agentId: context.agentId,
    });

    return { success: true, activity_id: activity.id, _updated_task: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to write to board: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Trigger Task
// ---------------------------------------------------------------------------

async function executeTriggerProcess(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const processId = String(input.process_id ?? '');
  const inputData = String(input.input_data ?? '{}');
  const reason = String(input.reason ?? '');

  if (!processId) return { success: false, error: 'process_id is required' };

  try {
    // Use a system user ID placeholder for autonomous runs
    const result = await executeTriggerredProcess(
      context.organisationId,
      processId,
      context.agentId, // use agentId as the triggerer for autonomous runs
      inputData
    );

    return {
      success: true,
      execution_id: result.executionId,
      process_name: result.processName,
      status: result.status,
      message: `Process "${result.processName}" has been queued. Execution ID: ${result.executionId}`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to trigger process: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Create Task — with handoff support
// ---------------------------------------------------------------------------

async function executeCreateTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const title = String(input.title ?? '').slice(0, MAX_TASK_TITLE_LENGTH);
  if (!title) return { success: false, error: 'title is required' };

  const assignedAgentId = input.assigned_agent_id ? String(input.assigned_agent_id) : undefined;

  // Self-assignment prevention
  if (assignedAgentId === context.agentId) {
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
  if (assignedAgentId && currentDepth + 1 > MAX_HANDOFF_DEPTH) {
    return {
      success: false,
      error: `Handoff depth limit (${MAX_HANDOFF_DEPTH}) reached. Cannot assign task to another agent at this depth. Create the task without assignment instead.`,
    };
  }

  try {
    const item = await taskService.createTask(
      context.organisationId,
      context.subaccountId,
      {
        title,
        description,
        brief: input.brief ? String(input.brief) : undefined,
        priority,
        status: input.status ? String(input.status) : 'inbox',
        assignedAgentId,
        createdByAgentId: context.agentId,
        handoffSourceRunId: context.runId,
        handoffContext: handoffContext ? { message: handoffContext } : undefined,
        handoffDepth: assignedAgentId ? currentDepth + 1 : 0,
      }
    );

    // Trigger handoff if assigned to another agent
    let handoffEnqueued = false;
    if (assignedAgentId) {
      handoffEnqueued = await enqueueHandoff({
        taskId: item.id,
        agentId: assignedAgentId,
        subaccountId: context.subaccountId,
        organisationId: context.organisationId,
        sourceRunId: context.runId,
        handoffDepth: currentDepth + 1,
        handoffContext,
      });
    }

    return {
      success: true,
      task_id: item.id,
      title: item.title,
      status: item.status,
      handoff_enqueued: handoffEnqueued,
      _created_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create task: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Move Task
// ---------------------------------------------------------------------------

async function executeMoveTask(
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
    const position = await taskService._nextPosition(item.subaccountId, status);

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

async function executeAddDeliverable(
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
    const deliverable = await taskService.addDeliverable(taskId, {
      deliverableType,
      title,
      description: description || undefined,
    });

    // Also log an activity
    await taskService.addActivity(taskId, {
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
// Handoff enqueuing
// ---------------------------------------------------------------------------

interface HandoffRequest {
  taskId: string;
  agentId: string;
  subaccountId: string;
  organisationId: string;
  sourceRunId: string;
  handoffDepth: number;
  handoffContext?: string;
}

async function enqueueHandoff(req: HandoffRequest): Promise<boolean> {
  // Depth cap
  if (req.handoffDepth > MAX_HANDOFF_DEPTH) {
    console.warn(`[Handoff] Depth ${req.handoffDepth} exceeds max ${MAX_HANDOFF_DEPTH}, skipping`);
    return false;
  }

  // Look up the subaccount agent link for the target agent
  const [saLink] = await db
    .select({
      sa: subaccountAgents,
    })
    .from(subaccountAgents)
    .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
    .where(
      and(
        eq(subaccountAgents.subaccountId, req.subaccountId),
        eq(subaccountAgents.agentId, req.agentId),
        eq(subaccountAgents.isActive, true),
        eq(agents.status, 'active'),
        isNull(agents.deletedAt)
      )
    );

  if (!saLink) {
    console.warn(`[Handoff] No active subaccount agent link for agent ${req.agentId} in subaccount ${req.subaccountId}`);
    return false;
  }

  // Duplicate prevention: check for running/pending runs for same agent+task
  const [existingRun] = await db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.agentId, req.agentId),
        eq(agentRuns.taskId, req.taskId),
        eq(agentRuns.subaccountId, req.subaccountId)
      )
    )
    .limit(1);

  if (existingRun && (existingRun.status === 'running' || existingRun.status === 'pending')) {
    console.warn(`[Handoff] Agent ${req.agentId} already has a ${existingRun.status} run for task ${req.taskId}, skipping`);
    return false;
  }

  if (!pgBossSend) {
    console.warn('[Handoff] pg-boss sender not configured, cannot enqueue handoff');
    return false;
  }

  try {
    await pgBossSend(AGENT_HANDOFF_QUEUE, {
      taskId: req.taskId,
      agentId: req.agentId,
      subaccountAgentId: saLink.sa.id,
      subaccountId: req.subaccountId,
      organisationId: req.organisationId,
      sourceRunId: req.sourceRunId,
      handoffDepth: req.handoffDepth,
      handoffContext: req.handoffContext,
    });
    return true;
  } catch (err) {
    console.error('[Handoff] Failed to enqueue handoff job:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reassign Task — hand current task to another agent
// ---------------------------------------------------------------------------

async function executeReassignTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  const assignedAgentId = String(input.assigned_agent_id ?? '');
  const handoffContext = input.handoff_context ? String(input.handoff_context) : undefined;

  if (!taskId) return { success: false, error: 'task_id is required' };
  if (!assignedAgentId) return { success: false, error: 'assigned_agent_id is required' };

  // Self-assignment prevention
  if (assignedAgentId === context.agentId) {
    return { success: false, error: 'Cannot reassign a task to yourself. Choose a different agent.' };
  }

  const currentDepth = context.handoffDepth ?? 0;
  if (currentDepth + 1 > MAX_HANDOFF_DEPTH) {
    return { success: false, error: `Handoff depth limit (${MAX_HANDOFF_DEPTH}) reached. Cannot reassign further.` };
  }

  try {
    const task = await taskService.getTask(taskId, context.organisationId);

    // Update the task assignment
    await taskService.updateTask(taskId, context.organisationId, {
      assignedAgentId,
    });

    // Update handoff tracking on the task
    await db.update(tasks).set({
      handoffSourceRunId: context.runId,
      handoffContext: handoffContext ? { message: handoffContext } : null,
      handoffDepth: currentDepth + 1,
      updatedAt: new Date(),
    }).where(eq(tasks.id, taskId));

    // Log activity
    await taskService.addActivity(taskId, {
      activityType: 'assigned',
      message: `Reassigned to another agent${handoffContext ? ` — ${handoffContext}` : ''}`,
      agentId: context.agentId,
    });

    // Trigger handoff
    const handoffEnqueued = await enqueueHandoff({
      taskId,
      agentId: assignedAgentId,
      subaccountId: context.subaccountId,
      organisationId: context.organisationId,
      sourceRunId: context.runId,
      handoffDepth: currentDepth + 1,
      handoffContext,
    });

    return {
      success: true,
      task_id: taskId,
      new_agent_id: assignedAgentId,
      handoff_enqueued: handoffEnqueued,
      _updated_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to reassign task: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Spawn Sub-Agents — parallel execution of 2-3 sub-tasks
// ---------------------------------------------------------------------------

async function executeSpawnSubAgents(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  // Prevent nesting
  if (context.isSubAgent) {
    return { success: false, error: 'Sub-agents cannot spawn their own sub-agents. Only one level of nesting is allowed.' };
  }

  const subTasks = input.sub_tasks as Array<{ title: string; brief: string; assigned_agent_id: string }> | undefined;

  if (!subTasks || !Array.isArray(subTasks)) {
    return { success: false, error: 'sub_tasks array is required' };
  }
  if (subTasks.length < 2 || subTasks.length > MAX_SUB_AGENTS) {
    return { success: false, error: `sub_tasks must contain 2-${MAX_SUB_AGENTS} items` };
  }

  // Validate each sub-task
  for (const st of subTasks) {
    if (!st.title || !st.brief || !st.assigned_agent_id) {
      return { success: false, error: 'Each sub-task requires title, brief, and assigned_agent_id' };
    }
  }

  // Calculate per-child budget
  const totalBudget = context.tokenBudget ?? 30000;
  const elapsed = context.startTime ? Date.now() - context.startTime : 0;
  const totalTimeout = context.timeoutMs ?? 300000;
  const remainingTimeMs = Math.max(totalTimeout - elapsed, 30000);
  const perChildBudget = Math.floor(totalBudget / subTasks.length);
  const perChildTimeout = Math.floor(remainingTimeMs / SUB_AGENT_TIMEOUT_BUFFER);

  if (perChildBudget < MIN_SUB_AGENT_TOKEN_BUDGET) {
    return { success: false, error: `Insufficient token budget remaining for ${subTasks.length} sub-agents. Need at least ${MIN_SUB_AGENT_TOKEN_BUDGET * subTasks.length} tokens.` };
  }

  try {
    // Create task cards and resolve agent links
    const childJobs: Array<{
      task: { id: string; title: string };
      saLink: { id: string; agentId: string };
    }> = [];

    for (const st of subTasks) {
      const task = await taskService.createTask(
        context.organisationId,
        context.subaccountId,
        {
          title: st.title.slice(0, MAX_TASK_TITLE_LENGTH),
          brief: st.brief.slice(0, MAX_TASK_DESCRIPTION_LENGTH),
          status: 'in_progress',
          assignedAgentId: st.assigned_agent_id,
          createdByAgentId: context.agentId,
          isSubTask: 1,
          parentTaskId: context.runId, // Link to parent's task context
        }
      );

      // Find subaccount agent link
      const [saLink] = await db
        .select({ sa: subaccountAgents })
        .from(subaccountAgents)
        .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
        .where(
          and(
            eq(subaccountAgents.subaccountId, context.subaccountId),
            eq(subaccountAgents.agentId, st.assigned_agent_id),
            eq(subaccountAgents.isActive, true),
            eq(agents.status, 'active'),
            isNull(agents.deletedAt)
          )
        );

      if (!saLink) {
        return { success: false, error: `Agent ${st.assigned_agent_id} not found or inactive in this subaccount` };
      }

      childJobs.push({ task, saLink: { id: saLink.sa.id, agentId: st.assigned_agent_id } });
    }

    // Execute all children in parallel
    const childResults = await Promise.all(
      childJobs.map(async (job) => {
        try {
          const result = await agentExecutionService.executeRun({
            agentId: job.saLink.agentId,
            subaccountId: context.subaccountId,
            subaccountAgentId: job.saLink.id,
            organisationId: context.organisationId,
            runType: 'triggered',
            executionMode: 'api',
            taskId: job.task.id,
            triggerContext: {
              type: 'sub_agent',
              parentRunId: context.runId,
            },
            isSubAgent: true,
            parentSpawnRunId: context.runId,
          });

          return {
            title: job.task.title,
            status: result.status,
            summary: result.summary,
            task_id: job.task.id,
            agent_run_id: result.runId,
            tokens_used: result.totalTokens,
          };
        } catch (err) {
          return {
            title: job.task.title,
            status: 'failed' as const,
            summary: null,
            error: err instanceof Error ? err.message : String(err),
            task_id: job.task.id,
            agent_run_id: null,
            tokens_used: 0,
          };
        }
      })
    );

    const totalTokens = childResults.reduce((sum, r) => sum + (r.tokens_used ?? 0), 0);

    return {
      success: true,
      results: childResults,
      total_tokens: totalTokens,
      total_duration_ms: Date.now() - (context.startTime ?? Date.now()),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to spawn sub-agents: ${errMsg}` };
  }
}
