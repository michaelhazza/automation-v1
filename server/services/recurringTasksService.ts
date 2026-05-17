/**
 * server/services/recurringTasksService.ts
 *
 * Impure (Drizzle) aggregator over agent_triggers + scheduled_tasks +
 * manual agent_runs, exposing the spec §4.4 RecurringTask shape.
 */

import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  agentTriggers,
  scheduledTasks,
  agentRuns,
  subaccounts,
  agents,
  subaccountAgents,
  projects,
} from '../db/schema/index.js';
import { and, eq, isNull, gte } from 'drizzle-orm';

import type {
  RecurringTask,
  RecurringTasksQuery,
  RecurringTasksResponse,
  AgentInfo,
  SubaccountInfo,
  ProjectInfo,
} from './recurringTasksServicePure.js';
import {
  unionRecurringTasks,
  applySearch,
  applyFilters,
  applySortWithTiebreaker,
  buildFilterOptions,
  paginate,
} from './recurringTasksServicePure.js';

export const recurringTasksService = {
  async list(orgId: string, query: RecurringTasksQuery): Promise<RecurringTasksResponse> {
    const scopedDb = getOrgScopedDb('recurringTasksService.list');
    // ── 1–3. Load source rows (independent — run in parallel) ───────────────
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [triggers, scheduled, manualRuns] = await Promise.all([
      // 1. Triggers
      scopedDb
        .select({
          id: agentTriggers.id,
          organisationId: agentTriggers.organisationId,
          subaccountId: agentTriggers.subaccountId,
          subaccountAgentId: agentTriggers.subaccountAgentId,
          eventType: agentTriggers.eventType,
          isActive: agentTriggers.isActive,
          lastTriggeredAt: agentTriggers.lastTriggeredAt,
          triggerCount: agentTriggers.triggerCount,
        })
        .from(agentTriggers)
        .where(
          and(
            eq(agentTriggers.organisationId, orgId),
            isNull(agentTriggers.deletedAt),
          ),
        ),
      // 2. Scheduled tasks
      scopedDb
        .select({
          id: scheduledTasks.id,
          organisationId: scheduledTasks.organisationId,
          subaccountId: scheduledTasks.subaccountId,
          assignedAgentId: scheduledTasks.assignedAgentId,
          title: scheduledTasks.title,
          isActive: scheduledTasks.isActive,
          nextRunAt: scheduledTasks.nextRunAt,
          lastRunAt: scheduledTasks.lastRunAt,
          totalRuns: scheduledTasks.totalRuns,
          consecutiveFailures: scheduledTasks.consecutiveFailures,
          rrule: scheduledTasks.rrule,
          timezone: scheduledTasks.timezone,
          scheduleTime: scheduledTasks.scheduleTime,
        })
        .from(scheduledTasks)
        .where(eq(scheduledTasks.organisationId, orgId)),
      // 3. Manual runs (last 30 days)
      scopedDb
        .select({
          id: agentRuns.id,
          organisationId: agentRuns.organisationId,
          subaccountId: agentRuns.subaccountId,
          agentId: agentRuns.agentId,
          subaccountAgentId: agentRuns.subaccountAgentId,
          startedAt: agentRuns.startedAt,
          projectId: agentRuns.projectId,
        })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.organisationId, orgId),
            eq(agentRuns.runType, 'manual'),
            gte(agentRuns.startedAt, thirtyDaysAgo),
          ),
        ),
    ]);

    // ── 4. Load lookup maps ─────────────────────────────────────────────────

    // Agents map (agentId → AgentInfo)
    const agentRows = await scopedDb
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(and(eq(agents.organisationId, orgId), isNull(agents.deletedAt)));

    const agentsMap = new Map<string, AgentInfo>();
    for (const a of agentRows) {
      agentsMap.set(a.id, { id: a.id, name: a.name });
    }

    // SubaccountAgents map: resolve subaccountAgentId → agentId, stored as sa:<subaccountAgentId>
    const subaccountAgentRows = await scopedDb
      .select({ id: subaccountAgents.id, agentId: subaccountAgents.agentId })
      .from(subaccountAgents)
      .where(eq(subaccountAgents.organisationId, orgId));

    for (const sa of subaccountAgentRows) {
      const agentInfo = agentsMap.get(sa.agentId);
      if (agentInfo) {
        agentsMap.set(`sa:${sa.id}`, agentInfo);
      }
    }

    // Subaccounts map
    const subaccountRows = await scopedDb
      .select({ id: subaccounts.id, name: subaccounts.name, isOrgSubaccount: subaccounts.isOrgSubaccount })
      .from(subaccounts)
      .where(and(eq(subaccounts.organisationId, orgId), isNull(subaccounts.deletedAt)));

    const subaccountsMap = new Map<string, SubaccountInfo>();
    for (const s of subaccountRows) {
      subaccountsMap.set(s.id, { id: s.id, name: s.name, isOrgSubaccount: s.isOrgSubaccount });
    }

    // Projects map
    const projectRows = await scopedDb
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.organisationId, orgId), isNull(projects.deletedAt)));

    const projectsMap = new Map<string, ProjectInfo>();
    for (const p of projectRows) {
      projectsMap.set(p.id, { id: p.id, name: p.name });
    }

    // ── 5. Union + project ──────────────────────────────────────────────────
    const allRows: RecurringTask[] = unionRecurringTasks({
      triggers,
      scheduled,
      manualRuns,
      agentsMap,
      subaccountsMap,
      projectsMap,
    });

    // ── 6. Search, filter, sort, facets, paginate ───────────────────────────
    const searched = applySearch(allRows, query.q);
    const filtered = applyFilters(searched, query);
    const sortKey = query.sortKey ?? 'nextFire';
    const sortDir = query.sortDir ?? 'desc';
    const sorted = applySortWithTiebreaker(filtered, sortKey, sortDir);
    const filterOptions = buildFilterOptions(searched, query);

    const limit = query.limit ?? 50;
    const { page, nextCursor } = paginate(sorted, query.cursor, limit, sortKey, sortDir);

    return { rows: page, cursor: nextCursor, filterOptions };
  },
};
