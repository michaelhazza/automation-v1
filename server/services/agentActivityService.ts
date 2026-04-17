import { eq, and, desc, gte, sql, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentRuns, agents, subaccounts, tasks, taskActivities, mcpToolInvocations } from '../db/schema/index.js';

const MAX_CHAIN_NODES = 50;

// ---------------------------------------------------------------------------
// Agent Activity Service — scoped activity queries for dashboard/activity page
// ---------------------------------------------------------------------------

export const agentActivityService = {
  /**
   * Get agent run history scoped by role.
   */
  async listRuns(params: {
    organisationId?: string;
    subaccountId?: string;
    agentId?: string;
    status?: string;
    limit?: number;
    offset?: number;
    /** When false (default), test runs are excluded. Pass true to include them. */
    includeTestRuns?: boolean;
  }) {
    const conditions: ReturnType<typeof eq>[] = [];
    if (params.organisationId) conditions.push(eq(agentRuns.organisationId, params.organisationId));
    if (params.subaccountId) conditions.push(eq(agentRuns.subaccountId, params.subaccountId));
    if (params.agentId) conditions.push(eq(agentRuns.agentId, params.agentId));
    if (params.status) conditions.push(eq(agentRuns.status, params.status as 'completed' | 'failed'));
    // Default: exclude test runs (spec §4.7). Pass includeTestRuns=true to show them.
    if (!params.includeTestRuns) conditions.push(eq(agentRuns.isTestRun, false));

    const limit = Math.min(params.limit ?? 50, 100);
    const offset = params.offset ?? 0;

    const rows = await db
      .select({
        run: agentRuns,
        agentName: agents.name,
        agentSlug: agents.slug,
        subaccountName: subaccounts.name,
      })
      .from(agentRuns)
      .innerJoin(agents, eq(agents.id, agentRuns.agentId))
      .leftJoin(subaccounts, eq(subaccounts.id, agentRuns.subaccountId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(agentRuns.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map(({ run, agentName, agentSlug, subaccountName }) => ({
      id: run.id,
      agentId: run.agentId,
      agentName,
      agentSlug,
      subaccountId: run.subaccountId,
      subaccountName,
      runType: run.runType,
      status: run.status,
      summary: run.summary,
      // Brain Tree OS adoption P1 — surface the structured handoff in the
      // listing payload so the session log card can render the "Next: …"
      // line without a per-run fetch.
      handoffJson: run.handoffJson,
      totalToolCalls: run.totalToolCalls,
      totalTokens: run.totalTokens,
      tasksCreated: run.tasksCreated,
      tasksUpdated: run.tasksUpdated,
      deliverablesCreated: run.deliverablesCreated,
      durationMs: run.durationMs,
      errorMessage: run.errorMessage,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    }));
  },

  /**
   * Get detailed view of a single run, including full tool call log.
   */
  async getRunDetail(runId: string, organisationId?: string) {
    const conditions = [eq(agentRuns.id, runId)];
    if (organisationId) conditions.push(eq(agentRuns.organisationId, organisationId));

    const [row] = await db
      .select({
        run: agentRuns,
        agentName: agents.name,
        agentSlug: agents.slug,
        subaccountName: subaccounts.name,
      })
      .from(agentRuns)
      .innerJoin(agents, eq(agents.id, agentRuns.agentId))
      .leftJoin(subaccounts, eq(subaccounts.id, agentRuns.subaccountId))
      .where(and(...conditions));

    if (!row) throw { statusCode: 404, message: 'Agent run not found' };

    // MCP call summary — grouped by server, covering index on (run_id, server_slug)
    const mcpRows = await db
      .select({
        serverSlug: mcpToolInvocations.serverSlug,
        callCount: sql<number>`count(*)::int`,
        errorCount: sql<number>`count(*) filter (where ${mcpToolInvocations.status} in ('error', 'timeout'))::int`,
        avgDurationMs: sql<number>`round(avg(${mcpToolInvocations.durationMs}))::int`,
      })
      .from(mcpToolInvocations)
      .where(eq(mcpToolInvocations.runId, runId))
      .groupBy(mcpToolInvocations.serverSlug);

    const mcpCallSummary =
      mcpRows.length === 0
        ? null
        : {
            totalCalls: mcpRows.reduce((s, r) => s + r.callCount, 0),
            errorCount: mcpRows.reduce((s, r) => s + r.errorCount, 0),
            byServer: mcpRows.map((r) => ({
              serverSlug: r.serverSlug,
              callCount: r.callCount,
              errorCount: r.errorCount,
              avgDurationMs: r.avgDurationMs,
            })),
          };

    return {
      ...row.run,
      agentName: row.agentName,
      agentSlug: row.agentSlug,
      subaccountName: row.subaccountName,
      mcpCallSummary,
    };
  },

  /**
   * Get aggregate stats for the activity dashboard.
   */
  async getStats(params: {
    organisationId?: string;
    subaccountId?: string;
    sinceDays?: number;
  }) {
    const since = new Date();
    since.setDate(since.getDate() - (params.sinceDays ?? 7));

    const conditions: ReturnType<typeof eq>[] = [gte(agentRuns.createdAt, since)];
    if (params.organisationId) conditions.push(eq(agentRuns.organisationId, params.organisationId));
    if (params.subaccountId) conditions.push(eq(agentRuns.subaccountId, params.subaccountId));

    const [stats] = await db
      .select({
        totalRuns: sql<number>`count(*)::int`,
        completedRuns: sql<number>`count(*) filter (where ${agentRuns.status} = 'completed')::int`,
        failedRuns: sql<number>`count(*) filter (where ${agentRuns.status} = 'failed')::int`,
        totalTokens: sql<number>`coalesce(sum(${agentRuns.totalTokens}), 0)::int`,
        totalToolCalls: sql<number>`coalesce(sum(${agentRuns.totalToolCalls}), 0)::int`,
        totalItemsCreated: sql<number>`coalesce(sum(${agentRuns.tasksCreated}), 0)::int`,
        totalItemsUpdated: sql<number>`coalesce(sum(${agentRuns.tasksUpdated}), 0)::int`,
        totalDeliverables: sql<number>`coalesce(sum(${agentRuns.deliverablesCreated}), 0)::int`,
        avgDurationMs: sql<number>`coalesce(avg(${agentRuns.durationMs}), 0)::int`,
      })
      .from(agentRuns)
      .where(and(...conditions));

    return stats;
  },

  /**
   * Get recent agent-created workspace activities (for the activity feed).
   */
  async getRecentActivities(params: {
    organisationId: string;
    subaccountId?: string;
    limit?: number;
  }) {
    const limit = Math.min(params.limit ?? 30, 100);

    const conditions: ReturnType<typeof eq>[] = [
      eq(taskActivities.organisationId, params.organisationId),
      isNotNull(taskActivities.agentId),
      isNull(tasks.deletedAt),
    ];

    // Scope to subaccount via the tasks table when requested
    const query = db
      .select({
        activity: taskActivities,
        agentName: agents.name,
      })
      .from(taskActivities)
      .leftJoin(agents, eq(agents.id, taskActivities.agentId))
      .innerJoin(tasks, eq(tasks.id, taskActivities.taskId));

    if (params.subaccountId) {
      conditions.push(eq(tasks.subaccountId, params.subaccountId));
    }

    return query
      .where(and(...conditions))
      .orderBy(desc(taskActivities.createdAt))
      .limit(limit);
  },

  /**
   * Reconstruct the full trace chain for a run (A1).
   * Walks parentRunId up to root, then collects all descendants.
   */
  async getRunChain(runId: string, organisationId: string) {
    const visited = new Set<string>();
    let truncated = false;
    let truncationReason: 'cycle' | 'depth_limit' | 'missing_parent' | undefined;

    // Walk UP to find root using a single recursive CTE instead of N+1 queries.
    // The CTE traverses parentRunId up to MAX_CHAIN_NODES levels.
    const ancestorRows = await db.execute<{ id: string; parent_run_id: string | null; depth: number }>(sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_run_id, 0 AS depth
        FROM agent_runs
        WHERE id = ${runId} AND organisation_id = ${organisationId}
        UNION ALL
        SELECT ar.id, ar.parent_run_id, a.depth + 1
        FROM agent_runs ar
        INNER JOIN ancestors a ON ar.id = a.parent_run_id
        WHERE ar.organisation_id = ${organisationId}
          AND a.depth < ${MAX_CHAIN_NODES}
      )
      SELECT id, parent_run_id, depth FROM ancestors ORDER BY depth DESC
    `);

    const chainIds: string[] = [];
    const rows = ancestorRows as unknown as Array<{ id: string; parent_run_id: string | null; depth: number }>;
    for (const row of rows) {
      if (visited.has(row.id)) {
        truncated = true;
        truncationReason = 'cycle';
        break;
      }
      visited.add(row.id);
      chainIds.push(row.id);
    }

    if (rows.length >= MAX_CHAIN_NODES) {
      truncated = true;
      truncationReason = 'depth_limit';
    }

    const rootRunId = chainIds[0] ?? runId;

    // Walk DOWN: get all descendants of runs in the chain
    // Guard: if chainIds is empty, skip the query entirely
    if (chainIds.length === 0) {
      return { runs: [], metadata: { rootRunId: runId, totalNodes: 0, isComplete: !truncated, truncated, truncationReason } };
    }

    const descendantRows = await db
      .select({
        run: agentRuns,
        agentName: agents.name,
        subaccountName: subaccounts.name,
      })
      .from(agentRuns)
      .innerJoin(agents, eq(agents.id, agentRuns.agentId))
      .leftJoin(subaccounts, eq(subaccounts.id, agentRuns.subaccountId))
      .where(and(
        eq(agentRuns.organisationId, organisationId),
        sql`(${agentRuns.id} = ANY(${chainIds}::uuid[]) OR ${agentRuns.parentRunId} = ANY(${chainIds}::uuid[]) OR ${agentRuns.parentSpawnRunId} = ANY(${chainIds}::uuid[]))`,
      ));

    // Deduplicate and build flat list
    const seen = new Set<string>();
    const runs = descendantRows
      .filter(r => {
        if (seen.has(r.run.id)) return false;
        seen.add(r.run.id);
        return true;
      })
      .map(({ run, agentName, subaccountName }) => ({
        id: run.id,
        parentRunId: run.parentRunId,
        parentSpawnRunId: run.parentSpawnRunId,
        isSubAgent: run.isSubAgent,
        handoffDepth: run.handoffDepth,
        runSource: run.runSource,
        runType: run.runType,
        status: run.status,
        agentName,
        subaccountName,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.durationMs,
        totalTokens: run.totalTokens,
        totalToolCalls: run.totalToolCalls,
        errorMessage: run.errorMessage,
        errorDetail: run.errorDetail,
        triggerContext: run.triggerContext,
        costCents: null as number | null,
      }));

    // Batch-fetch cost per run from cost aggregates (single query, not N+1)
    if (runs.length > 0) {
      try {
        const runIds = runs.map(r => r.id);
        const costRows = await db.execute<{ entity_id: string; total_cost_cents: number }>(sql`
          SELECT entity_id, total_cost_cents
          FROM cost_aggregates
          WHERE entity_id = ANY(${runIds}::uuid[])
            AND entity_type = 'run'
            AND period_type = 'run'
        `);
        const costMap = new Map(
          (costRows as unknown as Array<{ entity_id: string; total_cost_cents: number }>)
            .map(r => [r.entity_id, r.total_cost_cents])
        );
        for (const run of runs) {
          run.costCents = costMap.get(run.id) ?? null;
        }
      } catch {
        // Cost data is best-effort; don't fail the chain response
      }
    }

    return {
      runs,
      metadata: {
        rootRunId,
        totalNodes: runs.length,
        isComplete: !truncated,
        truncated,
        truncationReason,
      },
    };
  },

  /**
   * Sprint 5 P4.1 — receive a clarification response for a run that is in
   * 'awaiting_clarification' status. Validates org scoping, transitions
   * status back to 'running', and emits a WS event.
   */
  async receiveClarification(runId: string, orgId: string, message: string): Promise<{ success: true; runId: string }> {
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.id, runId),
          eq(agentRuns.organisationId, orgId),
        ),
      );

    if (!run) {
      throw { statusCode: 404, message: 'Run not found' };
    }

    if (run.status !== 'awaiting_clarification') {
      throw { statusCode: 409, message: `Run is not awaiting clarification (status: ${run.status})` };
    }

    // Store the clarification message in runMetadata so the resume path can
    // inject it into the conversation when the agentic loop restarts.
    const existingMetadata = (run.runMetadata ?? {}) as Record<string, unknown>;
    await db
      .update(agentRuns)
      .set({
        status: 'running',
        runMetadata: { ...existingMetadata, clarificationMessage: message },
        updatedAt: new Date(),
      })
      .where(eq(agentRuns.id, runId));

    const { emitAgentRunUpdate: emitRunUpdate } = await import('../websocket/emitters.js');
    emitRunUpdate(runId, 'agent:run:status', {
      status: 'running',
      clarificationReceived: true,
      message,
    });

    return { success: true, runId };
  },
};
