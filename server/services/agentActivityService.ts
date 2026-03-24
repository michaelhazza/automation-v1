import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentRuns, agents, subaccounts, workspaceItemActivities } from '../db/schema/index.js';

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
  }) {
    const conditions: ReturnType<typeof eq>[] = [];
    if (params.organisationId) conditions.push(eq(agentRuns.organisationId, params.organisationId));
    if (params.subaccountId) conditions.push(eq(agentRuns.subaccountId, params.subaccountId));
    if (params.agentId) conditions.push(eq(agentRuns.agentId, params.agentId));
    if (params.status) conditions.push(eq(agentRuns.status, params.status as 'completed' | 'failed'));

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
      .innerJoin(subaccounts, eq(subaccounts.id, agentRuns.subaccountId))
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
      totalToolCalls: run.totalToolCalls,
      totalTokens: run.totalTokens,
      workspaceItemsCreated: run.workspaceItemsCreated,
      workspaceItemsUpdated: run.workspaceItemsUpdated,
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
      .innerJoin(subaccounts, eq(subaccounts.id, agentRuns.subaccountId))
      .where(and(...conditions));

    if (!row) throw { statusCode: 404, message: 'Agent run not found' };

    return {
      ...row.run,
      agentName: row.agentName,
      agentSlug: row.agentSlug,
      subaccountName: row.subaccountName,
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
        totalItemsCreated: sql<number>`coalesce(sum(${agentRuns.workspaceItemsCreated}), 0)::int`,
        totalItemsUpdated: sql<number>`coalesce(sum(${agentRuns.workspaceItemsUpdated}), 0)::int`,
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
    organisationId?: string;
    subaccountId?: string;
    limit?: number;
  }) {
    const limit = Math.min(params.limit ?? 30, 100);

    // Get activities that were created by agents
    let query = db
      .select({
        activity: workspaceItemActivities,
        agentName: agents.name,
      })
      .from(workspaceItemActivities)
      .innerJoin(agents, eq(agents.id, workspaceItemActivities.agentId))
      .orderBy(desc(workspaceItemActivities.createdAt))
      .limit(limit);

    return query;
  },
};
