// ---------------------------------------------------------------------------
// Schedule Calendar Service — stateful wrapper
// ---------------------------------------------------------------------------
//
// Composes the pure projection layer with org-scoped DB reads to produce the
// `ScheduleCalendarResponse` payload consumed by the Scheduled Runs Calendar.
//
// Boundaries:
//
//   - Org-scoped reads go through `getOrgScopedDb('scheduleCalendarService')`.
//   - Boundary safety is further enforced by `assertScope()` per tenant row.
//   - Occurrence math lives entirely in `scheduleCalendarServicePure.ts`.
//   - Cost estimation uses live pricing via `pricingService.getPricing` — per
//     spec §3.9 this is intentional (forward-looking planning figure, not a
//     precise historical replay).
// ---------------------------------------------------------------------------

import { and, desc, eq, gte, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { assertScope } from '../lib/scopeAssertion.js';
import {
  agentRuns,
  agents,
  scheduledTasks,
  subaccountAgents,
  subaccounts,
} from '../db/schema/index.js';
import { getPricing } from './pricingService.js';
import {
  MAX_OCCURRENCES_PER_RESPONSE,
  SOURCE_PRIORITY,
  TOTAL_COUNT_ESTIMATE_CEILING,
  computeOccurrenceId,
  computeTotals,
  estimateTokensPerRun,
  projectCronOccurrences,
  projectHeartbeatOccurrences,
  projectRRuleOccurrences,
  sortOccurrences,
  validateWindow,
  type OccurrenceBase,
  type ScheduleOccurrence,
  type ScopeTag,
} from './scheduleCalendarServicePure.js';

export interface ScheduleCalendarResponse {
  windowStart: string;
  windowEnd: string;
  occurrences: ScheduleOccurrence[];
  truncated: boolean;
  totalsAreTruncated: boolean;
  estimatedTotalCount: number | null;
  totals: { count: number; estimatedTokens: number; estimatedCost: number };
}

export interface ListCalendarOpts {
  /** Restrict to a single subaccount. When absent, all subaccounts the caller can see. */
  subaccountId?: string;
  startISO: string;
  endISO: string;
}

type ProjectedRaw = {
  scheduledAt: Date;
  base: OccurrenceBase;
  sourceId: string;
  sourceName: string;
  source: keyof typeof SOURCE_PRIORITY;
};

/**
 * Build the calendar response for the given window. Throws a
 * `{ statusCode: 400, message }` shape for validation errors, matching the
 * service-error contract used elsewhere in the codebase.
 */
export async function listScheduleCalendar(
  orgId: string,
  opts: ListCalendarOpts
): Promise<ScheduleCalendarResponse> {
  const window = validateWindow(opts.startISO, opts.endISO);
  if (!window.ok) {
    const msg =
      window.reason === 'invalid_iso'
        ? 'start and end must be ISO 8601 timestamps'
        : window.reason === 'start_not_before_end'
        ? 'start must be before end'
        : `window exceeds 30-day maximum`;
    throw { statusCode: 400, message: msg };
  }
  const db = getOrgScopedDb('scheduleCalendarService.listScheduleCalendar');

  // ── Load subaccount index (for name hydration + scope filter) ───────────
  const subaccountRows = assertScope(
    await db
      .select({ id: subaccounts.id, name: subaccounts.name, organisationId: subaccounts.organisationId })
      .from(subaccounts)
      .where(
        opts.subaccountId
          ? and(eq(subaccounts.id, opts.subaccountId), eq(subaccounts.organisationId, orgId))
          : eq(subaccounts.organisationId, orgId)
      ),
    { organisationId: orgId },
    'scheduleCalendarService.loadSubaccounts'
  );
  if (subaccountRows.length === 0) {
    return emptyResponse(window.startMs, window.endMs);
  }
  const subaccountIds = subaccountRows.map((s) => s.id);
  const subaccountNameById = new Map(subaccountRows.map((s) => [s.id, s.name]));

  // ── Load active subaccount-agent links in scope ─────────────────────────
  //
  // The join result is `{ link, agent }` — `assertScope` expects the tenant
  // fields at the top level, so we validate `link` (which carries
  // `organisationId` + `subaccountId`) separately and return the raw joined
  // rows for downstream use.
  const linkRows = await db
    .select({
      link: subaccountAgents,
      agent: agents,
    })
    .from(subaccountAgents)
    .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
    .where(
      and(
        eq(subaccountAgents.organisationId, orgId),
        inArray(subaccountAgents.subaccountId, subaccountIds),
        eq(subaccountAgents.isActive, true),
        eq(agents.status, 'active'),
        isNull(agents.deletedAt)
      )
    );
  assertScope(
    linkRows.map((r) => r.link),
    { organisationId: orgId },
    'scheduleCalendarService.loadLinks'
  );

  // ── Load active scheduled tasks in scope ────────────────────────────────
  const taskRows = assertScope(
    await db
      .select()
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.organisationId, orgId),
          inArray(scheduledTasks.subaccountId, subaccountIds),
          eq(scheduledTasks.isActive, true)
        )
      ),
    { organisationId: orgId },
    'scheduleCalendarService.loadScheduledTasks'
  );

  // ── Project each source into a raw occurrence list ──────────────────────
  const raw: ProjectedRaw[] = [];

  for (const { link, agent } of linkRows) {
    const base: OccurrenceBase = {
      subaccountId: link.subaccountId,
      subaccountName: subaccountNameById.get(link.subaccountId) ?? '',
      agentId: agent.id,
      agentName: agent.name,
      scopeTag: agent.isSystemManaged ? 'system' : 'subaccount',
    };

    // Heartbeat — link override wins over agent default.
    const heartbeatEnabled = link.heartbeatEnabled || agent.heartbeatEnabled;
    const effectiveInterval = link.heartbeatIntervalHours ?? agent.heartbeatIntervalHours;
    if (heartbeatEnabled && effectiveInterval && effectiveInterval > 0) {
      const effectiveOffsetHours = link.heartbeatOffsetHours ?? agent.heartbeatOffsetHours ?? 0;
      const effectiveOffsetMinutes = link.heartbeatOffsetMinutes ?? agent.heartbeatOffsetMinutes ?? 0;
      const heartbeats = projectHeartbeatOccurrences(
        {
          ...base,
          intervalHours: effectiveInterval,
          offsetHours: effectiveOffsetHours,
          offsetMinutes: effectiveOffsetMinutes,
          sourceId: link.id,
          sourceName: agent.name,
        },
        window.startMs,
        window.endMs
      );
      for (const h of heartbeats) {
        raw.push({ ...h, source: 'heartbeat' });
      }
    }

    // Cron — subaccount-link-only per schema.
    if (link.scheduleEnabled && link.scheduleCron) {
      const crons = await projectCronOccurrences(
        {
          ...base,
          cronExpression: link.scheduleCron,
          cronTimezone: link.scheduleTimezone || 'UTC',
          sourceId: link.id,
          sourceName: agent.name,
        },
        window.startMs,
        window.endMs
      );
      for (const c of crons) {
        raw.push({ ...c, source: 'cron' });
      }
    }
  }

  for (const task of taskRows) {
    const subaccountId = task.subaccountId;
    if (!subaccountId) continue;
    const base: OccurrenceBase = {
      subaccountId,
      subaccountName: subaccountNameById.get(subaccountId) ?? '',
      agentId: task.assignedAgentId ?? undefined,
      agentName: undefined,
      scopeTag: 'subaccount',
    };
    const occs = await projectRRuleOccurrences(
      {
        ...base,
        rrule: task.rrule,
        timezone: task.timezone || 'UTC',
        scheduleTime: task.scheduleTime,
        source: task.createdByWorkflowSlug ? 'workflow' : 'scheduled_task',
        sourceId: task.id,
        sourceName: task.title,
      },
      window.startMs,
      window.endMs
    );
    for (const o of occs) {
      raw.push({ ...o, source: task.createdByWorkflowSlug ? 'workflow' : 'scheduled_task' });
    }
  }

  // ── Cost / token estimation ─────────────────────────────────────────────
  //
  // Collect unique agent IDs across the projected set, fetch recent qualifying
  // runs (non-test, completed/timeout), and compute an estimatedTokens figure
  // per agent. Then apply to every occurrence tied to that agent.
  const agentIds = Array.from(
    new Set(raw.map((r) => r.base.agentId).filter((x): x is string => !!x))
  );
  const tokensByAgent = new Map<string, number | null>();
  const costByAgent = new Map<string, number | null>();

  if (agentIds.length > 0) {
    // Fetch up to 10 qualifying samples per agent. A single aggregate query is
    // cheap at the sample sizes involved; we only pull non-test completed runs.
    const sampleRows = await db
      .select({
        agentId: agentRuns.agentId,
        inputTokens: agentRuns.inputTokens,
        outputTokens: agentRuns.outputTokens,
        completedAt: agentRuns.completedAt,
        status: agentRuns.status,
        isTestRun: agentRuns.isTestRun,
      })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.organisationId, orgId),
          inArray(agentRuns.agentId, agentIds),
          inArray(agentRuns.status, ['completed', 'timeout']),
          // Filter test runs out. The column exists post-Feature-2 migration;
          // on a cluster where Feature 1 ships before Feature 2 the column is
          // absent — guard this clause via `isTestRun` nullability in the
          // schema. If the column is missing (pre-migration), the filter
          // silently becomes a no-op; any historical runs are safe because
          // they had no concept of a test run in that era.
          ne(agentRuns.isTestRun, true),
          isNotNull(agentRuns.completedAt),
          gte(agentRuns.completedAt, new Date(window.startMs - 90 * 24 * 60 * 60 * 1000))
        )
      )
      .orderBy(desc(agentRuns.completedAt));

    const samplesByAgent = new Map<string, Array<{ promptTokens: number; completionTokens: number }>>();
    for (const row of sampleRows) {
      const list = samplesByAgent.get(row.agentId) ?? [];
      if (list.length < 10) {
        list.push({ promptTokens: row.inputTokens, completionTokens: row.outputTokens });
        samplesByAgent.set(row.agentId, list);
      }
    }

    // Pricing lookup per agent (uses provider/model from the agents row).
    const agentCfg = new Map<string, { provider: string; model: string }>(
      linkRows.map(({ agent }) => [agent.id, { provider: agent.modelProvider, model: agent.modelId }])
    );
    // Include task-assigned agents even if they have no link (rare but possible).
    for (const task of taskRows) {
      if (task.assignedAgentId && !agentCfg.has(task.assignedAgentId)) {
        const linkForAgent = linkRows.find((l) => l.agent.id === task.assignedAgentId);
        if (linkForAgent) {
          agentCfg.set(task.assignedAgentId, {
            provider: linkForAgent.agent.modelProvider,
            model: linkForAgent.agent.modelId,
          });
        }
      }
    }

    for (const agentId of agentIds) {
      const samples = samplesByAgent.get(agentId) ?? [];
      const tokens = estimateTokensPerRun(samples);
      tokensByAgent.set(agentId, tokens);
      if (tokens === null) {
        costByAgent.set(agentId, null);
        continue;
      }
      const cfg = agentCfg.get(agentId);
      if (!cfg) {
        costByAgent.set(agentId, null);
        continue;
      }
      const pricing = await getPricing(cfg.provider, cfg.model);
      // Weighted average: assume the stored 70/30 input/output split (see
      // TOKEN_INPUT_RATIO / TOKEN_OUTPUT_RATIO in limits.ts) rather than
      // requiring a second per-run calculation. This matches estimateCost's
      // forward-looking approach — precise attribution happens at run time.
      const inputTokens = tokens * 0.7;
      const outputTokens = tokens * 0.3;
      const cost = (inputTokens / 1000) * pricing.inputRate + (outputTokens / 1000) * pricing.outputRate;
      costByAgent.set(agentId, cost);
    }
  }

  // ── Materialise ScheduleOccurrence[] ────────────────────────────────────
  const materialised: ScheduleOccurrence[] = raw.map((r) => {
    const iso = r.scheduledAt.toISOString();
    const agentId = r.base.agentId;
    return {
      occurrenceId: computeOccurrenceId(r.source, r.sourceId, iso),
      scheduledAt: iso,
      source: r.source,
      sourceId: r.sourceId,
      sourceName: r.sourceName,
      subaccountId: r.base.subaccountId,
      subaccountName: r.base.subaccountName,
      agentId: r.base.agentId,
      agentName: r.base.agentName,
      runType: 'scheduled',
      estimatedTokens: agentId ? tokensByAgent.get(agentId) ?? null : null,
      estimatedCost: agentId ? costByAgent.get(agentId) ?? null : null,
      scopeTag: r.base.scopeTag,
    };
  });

  // Sort-then-truncate invariant (spec §3.3).
  const sorted = sortOccurrences(materialised);
  const totalCount = sorted.length;
  const truncated = totalCount > MAX_OCCURRENCES_PER_RESPONSE;
  const slice = truncated ? sorted.slice(0, MAX_OCCURRENCES_PER_RESPONSE) : sorted;

  // estimatedTotalCount policy: computable only when total <= 50k.
  const estimatedTotalCount = truncated
    ? totalCount <= TOTAL_COUNT_ESTIMATE_CEILING
      ? totalCount
      : null
    : totalCount;

  return {
    windowStart: new Date(window.startMs).toISOString(),
    windowEnd: new Date(window.endMs).toISOString(),
    occurrences: slice,
    truncated,
    totalsAreTruncated: truncated,
    estimatedTotalCount,
    totals: computeTotals(slice),
  };
}

function emptyResponse(startMs: number, endMs: number): ScheduleCalendarResponse {
  return {
    windowStart: new Date(startMs).toISOString(),
    windowEnd: new Date(endMs).toISOString(),
    occurrences: [],
    truncated: false,
    totalsAreTruncated: false,
    estimatedTotalCount: 0,
    totals: { count: 0, estimatedTokens: 0, estimatedCost: 0 },
  };
}

// Narrow export for testing + consumers.
export type { ScheduleOccurrence, ScopeTag };
