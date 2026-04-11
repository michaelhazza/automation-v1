/**
 * agentRunHandoffService.ts — Brain Tree OS adoption P1 impure wrapper.
 *
 * Reads everything the pure builder needs from Drizzle and assembles a
 * `BuildHandoffInput`. Persists nothing — the caller (agentExecutionService)
 * writes the resulting payload into `agent_runs.handoff_json` as part of the
 * same UPDATE that flips the run to a terminal status.
 *
 * Read sources:
 *   - agent_runs: the run row (status, summary, counters, error, timing)
 *   - agent_run_messages: assistant turns for decision extraction
 *   - task_activities + tasks: tasks touched by this run
 *   - task_deliverables: deliverables produced by this run
 *   - memory_blocks: blocks updated during this run (best-effort, see notes)
 *   - review_items: open HITL items linked to this run
 *   - tasks: highest-priority open task assigned to the same agent (for "next action")
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P1
 */

import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  agentRuns,
  agentRunMessages,
  tasks,
  taskActivities,
  taskDeliverables,
  reviewItems,
} from '../db/schema/index.js';
import {
  buildHandoff,
  isValidHandoffV1,
  type AgentRunHandoffV1,
  type BuildHandoffInput,
} from './agentRunHandoffServicePure.js';

/**
 * Build (and validate) a handoff for the given run. Pure builder is called
 * with rows fetched from Drizzle. Returns the handoff if it validates;
 * returns null on any failure (the caller persists null in that case so the
 * column is consistent — never half-built).
 *
 * IMPORTANT: this function is best-effort. It is called from the run
 * completion path and must NEVER throw — failures are logged and surfaced as
 * a null return.
 */
export async function buildHandoffForRun(
  runId: string,
  organisationId: string,
): Promise<AgentRunHandoffV1 | null> {
  try {
    // ── Run row ──────────────────────────────────────────────────────────
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.organisationId, organisationId)));
    if (!run) return null;

    // ── Assistant text from agent_run_messages (decision extraction) ─────
    // We only need the textual content, not full block-level structure.
    // Cap at 200 messages to keep the read bounded for very long runs.
    // Org-scoped per the standard convention even though runId is unique;
    // this protects against any future RLS / drift surprise.
    const messageRows = await db
      .select({
        role: agentRunMessages.role,
        content: agentRunMessages.content,
      })
      .from(agentRunMessages)
      .where(
        and(
          eq(agentRunMessages.runId, runId),
          eq(agentRunMessages.organisationId, organisationId),
        ),
      )
      .orderBy(asc(agentRunMessages.sequenceNumber))
      .limit(200);

    const assistantTexts = messageRows
      .filter((m) => m.role === 'assistant')
      .map((m) => extractTextFromContent(m.content))
      .filter((t): t is string => !!t);

    // ── Tasks touched (via task_activities scoped to this run) ───────────
    const touchedActivityRows = await db
      .select({
        taskId: taskActivities.taskId,
      })
      .from(taskActivities)
      .where(
        and(
          eq(taskActivities.agentRunId, runId),
          eq(taskActivities.organisationId, organisationId),
        ),
      )
      .limit(100);

    const touchedTaskIds = Array.from(new Set(touchedActivityRows.map((r) => r.taskId)));
    const touchedTaskRows: Array<{ id: string; title: string }> = [];
    if (touchedTaskIds.length > 0) {
      const rows = await db
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(
          and(
            eq(tasks.organisationId, organisationId),
            inArray(tasks.id, touchedTaskIds),
            isNull(tasks.deletedAt),
          ),
        );
      touchedTaskRows.push(...rows);
    }

    // ── Deliverables produced this run ───────────────────────────────────
    // task_deliverables doesn't link directly to runs, so we infer from the
    // touched-task set: any deliverable on a touched task that was created
    // after the run startedAt is plausibly produced this run. Conservative —
    // a future deliverables.agentRunId column would tighten this.
    const deliverableRows: Array<{ id: string; title: string | null }> = [];
    if (touchedTaskIds.length > 0 && run.startedAt) {
      const rows = await db
        .select({ id: taskDeliverables.id, title: taskDeliverables.title, createdAt: taskDeliverables.createdAt })
        .from(taskDeliverables)
        .where(
          and(
            eq(taskDeliverables.organisationId, organisationId),
            inArray(taskDeliverables.taskId, touchedTaskIds),
            isNull(taskDeliverables.deletedAt),
          ),
        )
        .limit(50);
      // Filter to deliverables created during the run window.
      const startedAt = run.startedAt;
      for (const r of rows) {
        if (r.createdAt && r.createdAt >= startedAt) {
          deliverableRows.push({ id: r.id, title: r.title });
        }
      }
    }

    // ── Open HITL review items ───────────────────────────────────────────
    const hitlRows = await db
      .select({
        id: reviewItems.id,
        status: reviewItems.reviewStatus,
        actionId: reviewItems.actionId,
      })
      .from(reviewItems)
      .where(
        and(
          eq(reviewItems.agentRunId, runId),
          eq(reviewItems.organisationId, organisationId),
        ),
      )
      .limit(20);

    const hitlItems = hitlRows.map((r) => ({
      id: r.id,
      title: null as string | null, // review items don't have a title field; the action carries it
      status: r.status,
    }));

    // ── Next open task for this agent (used for nextRecommendedAction) ───
    const nextOpenTask = await pickNextOpenTask(run.agentId, organisationId, run.subaccountId);

    // ── Build the input + call the pure builder ──────────────────────────
    const input: BuildHandoffInput = {
      run: {
        status: run.status,
        summary: run.summary,
        errorMessage: run.errorMessage,
        runResultStatus: run.runResultStatus,
        durationMs: run.durationMs,
        tasksCreated: run.tasksCreated,
        tasksUpdated: run.tasksUpdated,
        deliverablesCreated: run.deliverablesCreated,
      },
      assistantTexts,
      tasksTouched: touchedTaskRows,
      deliverables: deliverableRows,
      memoryBlocks: [], // memory_blocks doesn't link to runs in v1; expand later if needed
      hitlItems,
      nextOpenTask,
    };

    const handoff = buildHandoff(input);
    if (!isValidHandoffV1(handoff)) {
      console.warn('[agentRunHandoffService] built handoff failed validation', { runId });
      return null;
    }
    return handoff;
  } catch (err) {
    console.warn('[agentRunHandoffService] buildHandoffForRun failed', {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Look up the most recent terminal run with a non-null handoff for the same
 * agent and execution scope. Returns null if no such run exists.
 *
 * Subaccount-level runs match `(agentId, subaccountId, executionScope='subaccount')`.
 * Org-level runs match `(agentId, executionScope='org')`.
 *
 * Used by the seedFromPreviousRun read path in agentExecutionService.
 */
export async function getLatestHandoffForAgent(params: {
  agentId: string;
  organisationId: string;
  subaccountId: string | null;
  excludeRunId?: string;
}): Promise<{ runId: string; handoff: AgentRunHandoffV1; createdAt: Date } | null> {
  try {
    const conditions = [
      eq(agentRuns.organisationId, params.organisationId),
      eq(agentRuns.agentId, params.agentId),
      sql`${agentRuns.handoffJson} IS NOT NULL`,
      // Defensive: only seed from runs that reached a terminal state.
      // The completion path is currently the only writer of handoffJson, so
      // every row with a non-null handoff is already terminal — but enforcing
      // it at the query level prevents a future mid-run write from poisoning
      // the seed-from-previous context.
      inArray(agentRuns.status, ['completed', 'failed', 'timeout', 'cancelled', 'loop_detected', 'budget_exceeded']),
    ];

    if (params.subaccountId) {
      conditions.push(eq(agentRuns.subaccountId, params.subaccountId));
      conditions.push(eq(agentRuns.executionScope, 'subaccount'));
    } else {
      conditions.push(eq(agentRuns.executionScope, 'org'));
    }

    if (params.excludeRunId) {
      conditions.push(ne(agentRuns.id, params.excludeRunId));
    }

    const [row] = await db
      .select({
        id: agentRuns.id,
        handoffJson: agentRuns.handoffJson,
        createdAt: agentRuns.createdAt,
      })
      .from(agentRuns)
      .where(and(...conditions))
      .orderBy(desc(agentRuns.createdAt))
      .limit(1);

    if (!row || !row.handoffJson) return null;
    if (!isValidHandoffV1(row.handoffJson)) return null;
    return { runId: row.id, handoff: row.handoffJson, createdAt: row.createdAt };
  } catch (err) {
    console.warn('[agentRunHandoffService] getLatestHandoffForAgent failed', {
      agentId: params.agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a text string from agent_run_messages.content. Content is
 * provider-neutral and may be a string, an object, or an array of blocks.
 * We collapse it down to a single text string for decision extraction.
 */
function extractTextFromContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (block && typeof block === 'object' && 'text' in block && typeof (block as { text: unknown }).text === 'string') {
        texts.push((block as { text: string }).text);
      }
    }
    return texts.length > 0 ? texts.join('\n') : null;
  }
  if (content && typeof content === 'object' && 'text' in content && typeof (content as { text: unknown }).text === 'string') {
    return (content as { text: string }).text;
  }
  return null;
}

/**
 * Find the highest-priority open task assigned to this agent in the same
 * scope as the run. Used for nextRecommendedAction.
 */
async function pickNextOpenTask(
  agentId: string,
  organisationId: string,
  subaccountId: string | null,
): Promise<{ id: string; title: string } | null> {
  const conditions = [
    eq(tasks.organisationId, organisationId),
    eq(tasks.assignedAgentId, agentId),
    isNull(tasks.deletedAt),
    // Open = not in done/cancelled
    sql`${tasks.status} NOT IN ('done', 'cancelled', 'archived')`,
  ];
  if (subaccountId) {
    conditions.push(eq(tasks.subaccountId, subaccountId));
  }

  // Priority order: urgent > high > normal > low
  const priorityRank = sql<number>`CASE ${tasks.priority}
    WHEN 'urgent' THEN 0
    WHEN 'high' THEN 1
    WHEN 'normal' THEN 2
    WHEN 'low' THEN 3
    ELSE 4
  END`;

  const [row] = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(and(...conditions))
    .orderBy(asc(priorityRank), asc(tasks.dueDate))
    .limit(1);

  return row ?? null;
}
