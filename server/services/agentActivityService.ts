import { eq, and, desc, gte, sql, inArray, isNotNull, isNull, count, asc, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { agentRuns, agents, subaccounts, tasks, taskActivities, mcpToolInvocations, agentExecutionEvents, agentRunSnapshots } from '../db/schema/index.js';
import { coerceEventCount } from './agentActivityServicePure.js';
import { IN_FLIGHT_RUN_STATUSES } from '../../shared/runStatus.js';
import type { AgentRun } from '../db/schema/agentRuns.js';

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
    if (params.status) {
      // Codex dual-review finding #2: accept a comma-separated status list so
      // "live agent count" queries can include in-flight states beyond
      // 'running' (notably 'delegated' for IEE-backed runs).
      const statuses = params.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        conditions.push(eq(agentRuns.status, statuses[0] as 'completed' | 'failed'));
      } else if (statuses.length > 1) {
        conditions.push(inArray(agentRuns.status, statuses as ('completed' | 'failed')[]) as ReturnType<typeof eq>);
      }
    }
    // Default: exclude test runs (spec §4.7). Pass includeTestRuns=true to show them.
    if (!params.includeTestRuns) conditions.push(eq(agentRuns.isTestRun, false));

    const limit = Math.min(params.limit ?? 50, 100);
    const offset = params.offset ?? 0;

    const scopedDb = getOrgScopedDb('agentActivityService.listRuns');
    const rows = await scopedDb
      .select({
        run: agentRuns,
        agentName: agents.name,
        agentSlug: agents.slug,
        subaccountName: subaccounts.name,
      })
      .from(agentRuns)
      .leftJoin(agents, and(eq(agents.id, agentRuns.agentId), isNull(agents.deletedAt)))
      .leftJoin(subaccounts, and(eq(subaccounts.id, agentRuns.subaccountId), isNull(subaccounts.deletedAt)))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(agentRuns.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map(({ run, agentName, agentSlug, subaccountName }) => ({
      id: run.id,
      agentId: run.agentId,
      // leftJoin + isNull(deletedAt) → agentName is null when the agent was
      // soft-deleted. Mirror delegationGraphService's stable placeholder so
      // UI consumers (e.g. TraceChainSidebar/Timeline) never render literal
      // null. agentRuns.agentId is notNull per schema, so .slice is safe.
      agentName: agentName ?? `(deleted agent ${run.agentId.slice(0, 8)})`,
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

    const scopedDb = getOrgScopedDb('agentActivityService.getRunDetail');
    const [row] = await scopedDb
      .select({
        run: agentRuns,
        agentName: agents.name,
        agentSlug: agents.slug,
        subaccountName: subaccounts.name,
      })
      .from(agentRuns)
      .leftJoin(agents, and(eq(agents.id, agentRuns.agentId), isNull(agents.deletedAt)))
      .leftJoin(subaccounts, and(eq(subaccounts.id, agentRuns.subaccountId), isNull(subaccounts.deletedAt)))
      .where(and(...conditions));

    if (!row) throw { statusCode: 404, message: 'Agent run not found' };

    // MCP call summary — grouped by server, covering index on (run_id, server_slug)
    const mcpRows = await scopedDb
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

    // Event count — single aggregate query (not per-row) scoped by run_id.
    const [eventCountRow] = await scopedDb
      .select({ count: sql<number>`count(*)::int` })
      .from(agentExecutionEvents)
      .where(eq(agentExecutionEvents.runId, runId));

    const eventCount = coerceEventCount(eventCountRow?.count);

    // ieeRunId is now a denormalised column on agent_runs (migration
    // 0176) written by agentExecutionService at delegation time. No
    // JOIN or subquery needed at read time — the value is already on
    // row.run. Spread carries it through.
    return {
      ...row.run,
      // Same soft-delete placeholder rationale as listRuns above.
      agentName: row.agentName ?? `(deleted agent ${row.run.agentId.slice(0, 8)})`,
      agentSlug: row.agentSlug,
      subaccountName: row.subaccountName,
      mcpCallSummary,
      eventCount,
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

    const scopedDb = getOrgScopedDb('agentActivityService.getStats');
    const [stats] = await scopedDb
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
    const scopedDb = getOrgScopedDb('agentActivityService.getRecentActivities');
    const query = scopedDb
      .select({
        activity: taskActivities,
        agentName: agents.name,
      })
      .from(taskActivities)
      .leftJoin(agents, and(eq(agents.id, taskActivities.agentId), isNull(agents.deletedAt)))
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
    const scopedDb = getOrgScopedDb('agentActivityService.getRunChain');
    const ancestorRows = await scopedDb.execute<{ id: string; parent_run_id: string | null; depth: number }>(sql`
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

    const descendantRows = await scopedDb
      .select({
        run: agentRuns,
        agentName: agents.name,
        subaccountName: subaccounts.name,
      })
      .from(agentRuns)
      .leftJoin(agents, and(eq(agents.id, agentRuns.agentId), isNull(agents.deletedAt)))
      .leftJoin(subaccounts, and(eq(subaccounts.id, agentRuns.subaccountId), isNull(subaccounts.deletedAt)))
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
        // Same soft-delete placeholder rationale as listRuns above —
        // TraceChainSidebar / TraceChainTimeline interpolate this directly.
        agentName: agentName ?? `(deleted agent ${run.agentId.slice(0, 8)})`,
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
        const costRows = await scopedDb.execute<{ entity_id: string; total_cost_cents: number }>(sql`
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
    const scopedDb = getOrgScopedDb('agentActivityService.receiveClarification');
    const [run] = await scopedDb
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
    await scopedDb
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

  /**
   * Fetch a run's test-result fields (id, status, timestamps, summary)
   * scoped to the given org. Returns null if not found.
   */
  async getRunForTestShape(
    runId: string,
    orgId: string,
  ): Promise<Pick<AgentRun, 'id' | 'status' | 'startedAt' | 'completedAt' | 'summary'> | null> {
    const scopedDb = getOrgScopedDb('agentActivityService.getRunForTestShape');
    const [run] = await scopedDb
      .select({
        id: agentRuns.id,
        status: agentRuns.status,
        startedAt: agentRuns.startedAt,
        completedAt: agentRuns.completedAt,
        summary: agentRuns.summary,
      })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.organisationId, orgId)))
      .limit(1);
    return run ?? null;
  },

  /**
   * Count in-flight (non-sub-agent, non-test) runs for an org.
   */
  async getLiveRunCount(orgId: string): Promise<number> {
    const scopedDb = getOrgScopedDb('agentActivityService.getLiveRunCount');
    const [result] = await scopedDb
      .select({ count: count() })
      .from(agentRuns)
      .where(and(
        eq(agentRuns.organisationId, orgId),
        inArray(agentRuns.status, [...IN_FLIGHT_RUN_STATUSES]),
        eq(agentRuns.isSubAgent, false),
        eq(agentRuns.isTestRun, false),
      ));
    return Number(result?.count ?? 0);
  },

  /**
   * Daily run activity breakdown with zero-filled gaps for the last `days` days.
   */
  async getDailyActivity(
    orgId: string,
    days: number,
    subaccountId?: string,
  ): Promise<Array<{ date: string; completed: number; failed: number; timeout: number; other: number; total: number }>> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const conditions = [
      gte(agentRuns.createdAt, since),
      eq(agentRuns.organisationId, orgId),
    ] as ReturnType<typeof eq>[];
    if (subaccountId) conditions.push(eq(agentRuns.subaccountId, subaccountId));

    const scopedDb = getOrgScopedDb('agentActivityService.getDailyActivity');
    const rows = await scopedDb
      .select({
        date: sql<string>`to_char(${agentRuns.createdAt}, 'YYYY-MM-DD')`,
        completed: sql<number>`count(*) filter (where ${agentRuns.status} = 'completed')::int`,
        failed: sql<number>`count(*) filter (where ${agentRuns.status} = 'failed')::int`,
        timeout: sql<number>`count(*) filter (where ${agentRuns.status} = 'timeout' or ${agentRuns.status} = 'budget_exceeded')::int`,
        other: sql<number>`count(*) filter (where ${agentRuns.status} not in ('completed','failed','timeout','budget_exceeded'))::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(agentRuns)
      .where(and(...conditions))
      .groupBy(sql`to_char(${agentRuns.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${agentRuns.createdAt}, 'YYYY-MM-DD')`);

    const result: Array<{ date: string; completed: number; failed: number; timeout: number; other: number; total: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const found = rows.find(r => r.date === dateStr);
      result.push(found ?? { date: dateStr, completed: 0, failed: 0, timeout: 0, other: 0, total: 0 });
    }
    return result;
  },

  /**
   * Fetch run visibility fields plus the agent's systemAgentId for artifact
   * permission checks.
   */
  async getRunWithAgentInfo(runId: string): Promise<(Pick<AgentRun, 'id' | 'organisationId' | 'subaccountId' | 'agentId' | 'executionScope'> & { systemAgentId: string | null }) | null> {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="called within org-scoped context from route layer; runId is unique and org is validated upstream"
    const [runRow] = await db
      .select({
        id: agentRuns.id,
        organisationId: agentRuns.organisationId,
        subaccountId: agentRuns.subaccountId,
        agentId: agentRuns.agentId,
        executionScope: agentRuns.executionScope,
      })
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
      .limit(1);

    if (!runRow) return null;

    const scopedDb = getOrgScopedDb('agentActivityService.getRunWithAgentInfo');
    const [agentRow] = await scopedDb
      .select({ systemAgentId: agents.systemAgentId })
      .from(agents)
      .where(and(eq(agents.id, runRow.agentId), eq(agents.organisationId, runRow.organisationId)))
      .limit(1);

    return {
      ...runRow,
      systemAgentId: agentRow?.systemAgentId ?? null,
    };
  },

  /**
   * Fetch all data needed to render the run trace-events endpoint:
   * - Run existence check (org-scoped)
   * - Snapshot toolCallsLog
   * - Skill invoked/completed events ordered by sequence number
   *
   * Returns null for `run` when the run does not exist in the org.
   */
  async getTraceEventsData(
    runId: string,
    orgId: string,
  ): Promise<{
    run: { id: string; organisationId: string } | null;
    toolCallsLog: unknown;
    skillEvents: Array<{ id: string; eventType: string; payload: unknown }>;
  }> {
    const scopedDb = getOrgScopedDb('agentActivityService.getTraceEventsData');
    const [runRow] = await scopedDb
      .select({ id: agentRuns.id, organisationId: agentRuns.organisationId })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.organisationId, orgId)))
      .limit(1);

    if (!runRow) {
      return { run: null, toolCallsLog: [], skillEvents: [] };
    }

    const [snap] = await scopedDb
      .select({ toolCallsLog: agentRunSnapshots.toolCallsLog })
      .from(agentRunSnapshots)
      .where(eq(agentRunSnapshots.runId, runId))
      .limit(1);

    const skillEvents = await scopedDb
      .select({
        id: agentExecutionEvents.id,
        eventType: agentExecutionEvents.eventType,
        payload: agentExecutionEvents.payload,
      })
      .from(agentExecutionEvents)
      .where(
        and(
          eq(agentExecutionEvents.runId, runId),
          or(
            eq(agentExecutionEvents.eventType, 'skill.invoked'),
            eq(agentExecutionEvents.eventType, 'skill.completed'),
          ),
        ),
      )
      .orderBy(asc(agentExecutionEvents.sequenceNumber));

    return { run: runRow, toolCallsLog: snap?.toolCallsLog ?? [], skillEvents };
  },

  async listRunsByAgentId(params: { agentId: string; orgId: string; limit: number }) {
    const scopedDb = getOrgScopedDb('agentActivityService.listRunsByAgentId');
    return scopedDb
      .select({
        id: agentRuns.id,
        agentId: agentRuns.agentId,
        status: agentRuns.status,
        startedAt: agentRuns.startedAt,
        completedAt: agentRuns.completedAt,
        ownerUserId: agentRuns.ownerUserId,
      })
      .from(agentRuns)
      .where(and(eq(agentRuns.agentId, params.agentId), eq(agentRuns.organisationId, params.orgId)))
      .orderBy(sql`${agentRuns.startedAt} DESC`)
      .limit(params.limit);
  },

  /**
   * Fetch the ownerUserId for a single run, scoped to the given org.
   * Returns null when the run has no designated owner (subaccount-owned legacy run).
   * Returns undefined when the run does not exist or belongs to a different org.
   */
  async getRunOwnerUserId(runId: string, orgId: string): Promise<string | null | undefined> {
    const scopedDb = getOrgScopedDb('agentActivityService.getRunOwnerUserId');
    const [row] = await scopedDb
      .select({ ownerUserId: agentRuns.ownerUserId })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.organisationId, orgId)))
      .limit(1);
    return row?.ownerUserId;
  },
};
