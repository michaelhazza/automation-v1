import { eq, and } from 'drizzle-orm';
import { env } from '../lib/env.js';
import { db } from '../db/index.js';
import { subaccountAgents, agents, agentRuns } from '../db/schema/index.js';
import { taskService } from './taskService.js';
import { executeTriggerredProcess } from './llmService.js';
import { isNull } from 'drizzle-orm';

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
}

interface SkillExecutionParams {
  skillName: string;
  input: Record<string, unknown>;
  context: SkillExecutionContext;
}

// Handoff job queue name
const AGENT_HANDOFF_QUEUE = 'agent-handoff-run';
const MAX_HANDOFF_DEPTH = 5;

// pg-boss reference for enqueueing handoff jobs (set by agentScheduleService)
let pgBossSend: ((name: string, data: object) => Promise<string | null>) | null = null;

export function setHandoffJobSender(sender: (name: string, data: object) => Promise<string | null>) {
  pgBossSend = sender;
}

export const skillExecutor = {
  async execute(params: SkillExecutionParams): Promise<unknown> {
    const { skillName, input, context } = params;

    switch (skillName) {
      case 'web_search':
        return executeWebSearch(input);
      case 'read_workspace':
        return executeReadWorkspace(input, context);
      case 'write_workspace':
        return executeWriteWorkspace(input, context);
      case 'trigger_process':
        return executeTriggerProcess(input, context);
      case 'create_task':
        return executeCreateTask(input, context);
      case 'move_task':
        return executeMoveTask(input, context);
      case 'add_deliverable':
        return executeAddDeliverable(input, context);
      default:
        return { success: false, error: `Unknown skill: ${skillName}` };
    }
  },
};

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
  const title = String(input.title ?? '');
  if (!title) return { success: false, error: 'title is required' };

  const assignedAgentId = input.assigned_agent_id ? String(input.assigned_agent_id) : undefined;

  // Self-assignment prevention
  if (assignedAgentId === context.agentId) {
    return { success: false, error: 'Cannot assign a task to yourself — this would create an infinite loop. Assign to a different agent or leave unassigned.' };
  }

  const handoffContext = input.handoff_context ? String(input.handoff_context) : undefined;
  const currentDepth = context.handoffDepth ?? 0;

  try {
    const item = await taskService.createTask(
      context.organisationId,
      context.subaccountId,
      {
        title,
        description: input.description ? String(input.description) : undefined,
        brief: input.brief ? String(input.brief) : undefined,
        priority: (input.priority as 'low' | 'normal' | 'high' | 'urgent') ?? 'normal',
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
    .select()
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
      subaccountAgentId: saLink.subaccount_agents.id,
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
