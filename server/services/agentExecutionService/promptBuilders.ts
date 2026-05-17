import { eq, and } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { isActive } from '../../lib/queryHelpers.js';
import { agents, subaccountAgents } from '../../db/schema/index.js';
import { taskService } from '../taskService.js';
import { workspaceMemoryService } from '../workspaceMemoryService.js';
import { MAX_CROSS_AGENT_TASKS } from '../../config/limits.js';
import type { AgentRunRequest } from './types.js';
import type { TaskWithAgent } from './types.js';

// ---------------------------------------------------------------------------
// Team Roster — loaded fresh from DB on every run
// ---------------------------------------------------------------------------

export async function buildTeamRoster(subaccountId: string, currentAgentId: string): Promise<string | null> {
  // guard-ignore: with-org-tx-or-scoped-db reason="called within withOrgTx context from agentExecutionService caller"
  const db = getOrgScopedDb('agentExecutionService.buildTeamRoster');
  const roster = await db
    .select({
      agentId: agents.id,
      agentName: agents.name,
      agentDescription: agents.description,
    })
    .from(subaccountAgents)
    .innerJoin(agents, and(eq(agents.id, subaccountAgents.agentId), isActive(agents)))
    .where(
      and(
        eq(subaccountAgents.subaccountId, subaccountId),
        eq(subaccountAgents.isActive, true),
        eq(agents.status, 'active'),
      )
    );

  if (roster.length === 0) return null;

  const lines = roster.map(r => {
    const marker = r.agentId === currentAgentId ? ' ← (you)' : '';
    return `- ${r.agentName} (${r.agentId}) — ${r.agentDescription ?? 'No description'}${marker}`;
  });

  return lines.join('\n');
}

// buildOrgTeamRoster removed — org agents now run inside the org subaccount
// and use the standard buildTeamRoster() function. See spec §6d.

// ---------------------------------------------------------------------------
// Smart Board Context — DB-level filtering instead of loading all tasks
// ---------------------------------------------------------------------------

export async function buildSmartBoardContext(
  organisationId: string,
  subaccountId: string,
  agentId: string
): Promise<string> {
  const parts: string[] = [];

  // 1. Board summary from workspace memory (compressed)
  const boardSummary = await workspaceMemoryService.getBoardSummaryForPrompt(
    organisationId,
    subaccountId
  );
  if (boardSummary) {
    parts.push('### Board Summary');
    parts.push(boardSummary);
  }

  // 2. Tasks assigned to THIS agent — full detail (DB-filtered)
  const myTasks = await taskService.listTasks(organisationId, subaccountId, {
    assignedAgentId: agentId,
  }) as TaskWithAgent[];

  if (myTasks.length > 0) {
    parts.push('\n### Your Assigned Tasks');
    for (const task of myTasks) {
      parts.push(`- [${task.id}] **${task.title}** (${task.status}, ${task.priority})`);
      if (task.description) parts.push(`  ${String(task.description).slice(0, 200)}`);
    }
  }

  // 3. In-progress tasks from other agents (DB-filtered)
  const inProgressTasks = await taskService.listTasks(organisationId, subaccountId, {
    status: 'in_progress',
  }) as TaskWithAgent[];

  const othersInProgress = inProgressTasks.filter(t => t.assignedAgentId !== agentId);
  if (othersInProgress.length > 0) {
    parts.push('\n### Other In-Progress Work');
    for (const task of othersInProgress.slice(0, MAX_CROSS_AGENT_TASKS)) {
      const agentName = task.assignedAgent?.name ?? 'unassigned';
      parts.push(`- [${task.id}] ${task.title} → ${agentName}`);
    }
  }

  // 4. Status counts (single query for all tasks)
  const allTasks = await taskService.listTasks(organisationId, subaccountId, {});
  const counts: Record<string, number> = {};
  for (const t of allTasks) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  if (Object.keys(counts).length > 0) {
    parts.push('\n### Board Totals: ' + Object.entries(counts).map(([s, c]) => `${s}: ${c}`).join(' | '));
  }

  // Fallback if no board summary and we have tasks
  if (!boardSummary && allTasks.length > 0 && parts.length <= 1) {
    return buildTaskOverviewContext(allTasks.slice(0, 30) as TaskWithAgent[]);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

export function buildTaskContext(item: Record<string, unknown>): string {
  const parts: string[] = [];
  parts.push(`### Target Task`);
  parts.push(`- **Title**: ${item.title ?? '(untitled)'}`);
  parts.push(`- **ID**: ${item.id}`);
  parts.push(`- **Status**: ${item.status ?? 'unknown'}`);
  parts.push(`- **Priority**: ${item.priority ?? 'normal'}`);
  if (item.description) parts.push(`- **Description**: ${item.description}`);
  if (item.brief) parts.push(`- **Brief**: ${item.brief}`);

  if (item.activities && Array.isArray(item.activities)) {
    parts.push('\n#### Recent Activity');
    for (const act of (item.activities as Array<Record<string, unknown>>).slice(0, 10)) {
      parts.push(`- [${act.activityType}] ${act.message} (${act.createdAt})`);
    }
  }

  if (item.deliverables && Array.isArray(item.deliverables)) {
    parts.push('\n#### Existing Deliverables');
    for (const del of item.deliverables as Array<Record<string, unknown>>) {
      parts.push(`- ${del.title} (${del.deliverableType})`);
    }
  }

  return parts.join('\n');
}

export function buildTaskOverviewContext(items: TaskWithAgent[]): string {
  const byStatus: Record<string, TaskWithAgent[]> = {};
  for (const item of items) {
    const status = item.status ?? 'unknown';
    if (!byStatus[status]) byStatus[status] = [];
    byStatus[status].push(item);
  }

  const parts: string[] = ['### Board Overview'];
  for (const [status, statusItems] of Object.entries(byStatus)) {
    parts.push(`\n**${status}** (${statusItems.length} items):`);
    for (const item of statusItems.slice(0, 5)) {
      parts.push(`- [${item.id}] ${item.title}${item.priority !== 'normal' ? ` (${item.priority})` : ''}${item.assignedAgent ? ` → ${item.assignedAgent.name}` : ''}`);
    }
    if (statusItems.length > 5) {
      parts.push(`  ... and ${statusItems.length - 5} more`);
    }
  }

  return parts.join('\n');
}

export function buildAutonomousInstructions(request: AgentRunRequest, targetItem: Record<string, unknown> | null): string {
  const parts: string[] = ['\n\n---\n## Execution Mode: Autonomous Run'];

  parts.push('You are running autonomously (not in a conversation with a user).');
  parts.push(`This is a ${request.runType} run.`);

  if (request.triggerContext?.type === 'handoff') {
    const ctx = request.triggerContext;
    parts.push(`\nYou were handed this task by another agent (run: ${ctx.sourceRunId}).`);
    if (ctx.handoffContext) {
      parts.push(`The previous agent provided this context: ${ctx.handoffContext}`);
    }
    parts.push('Continue the work from where they left off.');
  }

  if (targetItem) {
    parts.push(`\nYou have been assigned to work on the task: "${targetItem.title}" (ID: ${targetItem.id}).`);
    parts.push('Your workflow:');
    parts.push('1. Read the task details and any existing activities/deliverables');
    parts.push('2. Move the task to "in_progress" if it is not already');
    parts.push('3. Do the work described in the brief/description');
    parts.push('4. Log your progress as activities on the task');
    parts.push('5. When done, attach your output as a deliverable');
    parts.push('6. Move the task to "review" for human approval');
    parts.push('7. Provide a summary of what you did');
  } else {
    parts.push('\nYou are running a general check. Review the board, do your job based on your role, and take appropriate actions.');
    parts.push('Check for tasks assigned to you, look for things that need attention, and proactively do useful work.');
  }

  parts.push('\nIMPORTANT:');
  parts.push('- Always provide a clear summary at the end of your run');
  parts.push('- Log all significant actions as task activities');
  parts.push('- Attach deliverables for any content you produce');
  parts.push('- Move tasks to "review" when ready for human approval — never to "done"');

  return parts.join('\n');
}
