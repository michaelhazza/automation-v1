// ---------------------------------------------------------------------------
// ieeUsageService — cost / usage query layer for the IEE.
//
// Spec: docs/iee-development-spec.md §11.5.3, §11.7, §11.8.6.
//
// Permission gating is enforced by the route layer (existing middleware).
// This service trusts its `scope` argument and assumes the caller has been
// authorised. Tenant filtering is applied unconditionally.
// ---------------------------------------------------------------------------

import { and, desc, eq, gte, lte, sql, isNull, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { ieeRuns } from '../db/schema/ieeRuns.js';
import { llmRequests } from '../db/schema/llmRequests.js';

// ---------------------------------------------------------------------------
// Per-run cost breakdown — backs the §11.7 run-detail Cost panel
// ---------------------------------------------------------------------------

export interface IeeRunCostBreakdown {
  ieeRunId: string;
  total: { cents: number; runCount: 1 };
  llm: {
    app:    { cents: number; callCount: number };
    worker: { cents: number; callCount: number };
  };
  compute: {
    cents: number;
    wallMs: number | null;
    cpuMs: number | null;
    peakRssBytes: number | null;
  };
  steps: number;
  durationMs: number | null;
}

export async function getIeeRunCost(
  ieeRunId: string,
  organisationId: string,
): Promise<IeeRunCostBreakdown> {
  // Tenant-scoped fetch — even if the route layer was bypassed, we never
  // return rows from another organisation.
  const [run] = await db
    .select({
      id:                 ieeRuns.id,
      organisationId:     ieeRuns.organisationId,
      llmCostCents:       ieeRuns.llmCostCents,
      runtimeWallMs:      ieeRuns.runtimeWallMs,
      runtimeCpuMs:       ieeRuns.runtimeCpuMs,
      runtimePeakRssBytes: ieeRuns.runtimePeakRssBytes,
      runtimeCostCents:   ieeRuns.runtimeCostCents,
      totalCostCents:     ieeRuns.totalCostCents,
      stepCount:          ieeRuns.stepCount,
      startedAt:          ieeRuns.startedAt,
      completedAt:        ieeRuns.completedAt,
    })
    .from(ieeRuns)
    .where(and(eq(ieeRuns.id, ieeRunId), eq(ieeRuns.organisationId, organisationId), isNull(ieeRuns.deletedAt)))
    .limit(1);

  if (!run) {
    throw { statusCode: 404, message: 'IEE run not found' };
  }

  // Split LLM cost by call_site. The denormalised totalCostCents on the run
  // row is the source of truth for billing; this query is purely for the UI
  // breakdown so the user can see app vs worker LLM cost on the same run.
  const llmRows = await db
    .select({
      callSite: llmRequests.callSite,
      cents:    sql<number>`COALESCE(SUM(${llmRequests.costWithMarginCents}), 0)`,
      count:    sql<number>`COUNT(*)`,
    })
    .from(llmRequests)
    .where(and(eq(llmRequests.ieeRunId, ieeRunId), eq(llmRequests.organisationId, organisationId)))
    .groupBy(llmRequests.callSite);

  const app    = llmRows.find(r => r.callSite === 'app')    ?? { cents: 0, count: 0 };
  const worker = llmRows.find(r => r.callSite === 'worker') ?? { cents: 0, count: 0 };

  const durationMs = run.startedAt && run.completedAt
    ? Math.max(0, run.completedAt.getTime() - run.startedAt.getTime())
    : run.runtimeWallMs;

  return {
    ieeRunId: run.id,
    total: { cents: run.totalCostCents, runCount: 1 },
    llm: {
      app:    { cents: Number(app.cents),    callCount: Number(app.count) },
      worker: { cents: Number(worker.cents), callCount: Number(worker.count) },
    },
    compute: {
      cents:        run.runtimeCostCents,
      wallMs:       run.runtimeWallMs,
      cpuMs:        run.runtimeCpuMs,
      peakRssBytes: run.runtimePeakRssBytes,
    },
    steps: run.stepCount,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Per-run progress — backs the Phase 0 delegated-status live progress panel
// (client polls every 3s while parent agent_run is 'delegated').
// ---------------------------------------------------------------------------

export interface IeeRunProgress {
  ieeRunId: string;
  type: 'browser' | 'dev';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  stepCount: number;
  lastHeartbeatAt: string | null;   // ISO
  heartbeatAgeSeconds: number | null;
  startedAt: string | null;         // ISO
  completedAt: string | null;       // ISO
  failureReason: string | null;
  resultSummary: unknown;
}

export async function getIeeRunProgress(
  ieeRunId: string,
  organisationId: string,
  options: {
    /**
     * Subaccount-boundary enforcement (external review High-risk #11).
     *
     * When the caller is operating in subaccount scope, pass the
     * subaccount id here. The lookup then refuses to surface an iee_run
     * whose subaccount id does not match. Without this guard a user with
     * only subaccount A access, who has somehow learned a ieeRunId
     * belonging to subaccount B, could fetch progress for that run.
     *
     * When the caller is operating at org scope (no current subaccount
     * context), leave this undefined and the boundary check is skipped.
     */
    subaccountId?: string | null;
  } = {},
): Promise<IeeRunProgress | null> {
  const [row] = await db
    .select({
      id: ieeRuns.id,
      organisationId: ieeRuns.organisationId,
      subaccountId: ieeRuns.subaccountId,
      type: ieeRuns.type,
      status: ieeRuns.status,
      stepCount: ieeRuns.stepCount,
      lastHeartbeatAt: ieeRuns.lastHeartbeatAt,
      startedAt: ieeRuns.startedAt,
      completedAt: ieeRuns.completedAt,
      failureReason: ieeRuns.failureReason,
      resultSummary: ieeRuns.resultSummary,
    })
    .from(ieeRuns)
    .where(and(eq(ieeRuns.id, ieeRunId), isNull(ieeRuns.deletedAt)))
    .limit(1);

  if (!row) return null;
  // Tenant scope enforcement — cross-org callers receive null (route layer
  // maps null → 404 without leaking existence).
  if (row.organisationId !== organisationId) return null;
  // Subaccount-scope enforcement when a subaccount is provided. If the row
  // has no subaccountId (org-level IEE run) the check is skipped.
  if (options.subaccountId !== undefined && options.subaccountId !== null) {
    if (row.subaccountId && row.subaccountId !== options.subaccountId) {
      return null;
    }
  }

  const now = Date.now();
  const heartbeatAgeSeconds = row.lastHeartbeatAt
    ? Math.floor((now - new Date(row.lastHeartbeatAt).getTime()) / 1000)
    : null;

  return {
    ieeRunId: row.id,
    type: row.type as 'browser' | 'dev',
    status: row.status,
    stepCount: row.stepCount,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    heartbeatAgeSeconds,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    failureReason: row.failureReason ?? null,
    resultSummary: row.resultSummary ?? null,
  };
}

// ---------------------------------------------------------------------------
// Aggregated query — backs the §11.8 Usage Explorer page
// ---------------------------------------------------------------------------

export type UsageScope = 'system' | 'organisation' | 'subaccount';

export interface QueryUsageInput {
  scope: UsageScope;
  organisationId?: string;
  subaccountId?: string | null;
  from: Date;
  to: Date;
  // Filters
  agentIds?: string[];
  subaccountIds?: string[];
  statuses?: Array<'pending' | 'running' | 'completed' | 'failed'>;
  types?: Array<'browser' | 'dev'>;
  failureReasons?: string[];
  minCostCents?: number;
  search?: string;
  // Sort + pagination
  sort?: 'startedAt' | 'totalCostCents' | 'llmCostCents' | 'runtimeCostCents' | 'stepCount' | 'createdAt';
  order?: 'asc' | 'desc';
  limit?: number;
  cursor?: string | null;
}

export interface QueryUsageRow {
  id: string;
  agentId: string;
  type: 'browser' | 'dev';
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  stepCount: number;
  llmCostCents: number;
  runtimeCostCents: number;
  totalCostCents: number;
  failureReason: string | null;
}

export interface QueryUsageResult {
  summary: {
    total: { cents: number; runCount: number };
    llm:     { cents: number; callCount: number };
    compute: { cents: number };
  };
  rows: QueryUsageRow[];
  nextCursor: string | null;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_DATE_RANGE_MS = 366 * 24 * 60 * 60 * 1000; // 1 year

export async function queryIeeUsage(input: QueryUsageInput): Promise<QueryUsageResult> {
  // ── Date range guardrail ──────────────────────────────────────────────────
  if (input.to.getTime() - input.from.getTime() > MAX_DATE_RANGE_MS) {
    throw { statusCode: 400, message: 'Date range exceeds 1 year. Narrow your filters.' };
  }

  // ── Tenant filter (always applied — single source of truth) ───────────────
  const conditions = [
    isNull(ieeRuns.deletedAt),
    gte(ieeRuns.createdAt, input.from),
    lte(ieeRuns.createdAt, input.to),
  ];

  if (input.scope === 'organisation' || input.scope === 'subaccount') {
    if (!input.organisationId) {
      throw { statusCode: 400, message: 'organisationId is required for organisation/subaccount scope' };
    }
    conditions.push(eq(ieeRuns.organisationId, input.organisationId));
  }
  if (input.scope === 'subaccount') {
    if (!input.subaccountId) {
      throw { statusCode: 400, message: 'subaccountId is required for subaccount scope' };
    }
    conditions.push(eq(ieeRuns.subaccountId, input.subaccountId));
  }

  // ── Optional filters ──────────────────────────────────────────────────────
  if (input.agentIds && input.agentIds.length > 0) {
    conditions.push(inArray(ieeRuns.agentId, input.agentIds));
  }
  if (input.subaccountIds && input.subaccountIds.length > 0 && input.scope !== 'subaccount') {
    conditions.push(inArray(ieeRuns.subaccountId, input.subaccountIds));
  }
  if (input.statuses && input.statuses.length > 0) {
    conditions.push(inArray(ieeRuns.status, input.statuses));
  }
  if (input.types && input.types.length > 0) {
    conditions.push(inArray(ieeRuns.type, input.types));
  }
  if (input.failureReasons && input.failureReasons.length > 0) {
    conditions.push(inArray(ieeRuns.failureReason, input.failureReasons as never[]));
  }
  if (typeof input.minCostCents === 'number' && input.minCostCents > 0) {
    conditions.push(gte(ieeRuns.totalCostCents, input.minCostCents));
  }
  if (input.search && input.search.trim().length > 0) {
    conditions.push(sql`${ieeRuns.goal} ILIKE ${'%' + input.search.trim() + '%'}`);
  }

  // ── Sort ──────────────────────────────────────────────────────────────────
  const sortColMap = {
    startedAt:        ieeRuns.startedAt,
    totalCostCents:   ieeRuns.totalCostCents,
    llmCostCents:     ieeRuns.llmCostCents,
    runtimeCostCents: ieeRuns.runtimeCostCents,
    stepCount:        ieeRuns.stepCount,
    createdAt:        ieeRuns.createdAt,
  } as const;
  const sortCol = sortColMap[input.sort ?? 'createdAt'];
  const orderFn = (input.order ?? 'desc') === 'desc' ? desc : (col: any) => col;

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  // ── Page query ────────────────────────────────────────────────────────────
  const rows = await db
    .select({
      id:               ieeRuns.id,
      agentId:          ieeRuns.agentId,
      type:             ieeRuns.type,
      status:           ieeRuns.status,
      startedAt:        ieeRuns.startedAt,
      completedAt:      ieeRuns.completedAt,
      stepCount:        ieeRuns.stepCount,
      llmCostCents:     ieeRuns.llmCostCents,
      runtimeCostCents: ieeRuns.runtimeCostCents,
      totalCostCents:   ieeRuns.totalCostCents,
      failureReason:    ieeRuns.failureReason,
    })
    .from(ieeRuns)
    .where(and(...conditions))
    .orderBy(orderFn(sortCol))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? pageRows[pageRows.length - 1].id : null;

  // ── Summary aggregates over the same filter set ───────────────────────────
  const [summary] = await db
    .select({
      runCount:         sql<number>`COUNT(*)`,
      totalCents:       sql<number>`COALESCE(SUM(${ieeRuns.totalCostCents}), 0)`,
      llmCents:         sql<number>`COALESCE(SUM(${ieeRuns.llmCostCents}), 0)`,
      runtimeCents:     sql<number>`COALESCE(SUM(${ieeRuns.runtimeCostCents}), 0)`,
      llmCallCount:     sql<number>`COALESCE(SUM(${ieeRuns.llmCallCount}), 0)`,
    })
    .from(ieeRuns)
    .where(and(...conditions));

  return {
    summary: {
      total:   { cents: Number(summary.totalCents),   runCount: Number(summary.runCount) },
      llm:     { cents: Number(summary.llmCents),     callCount: Number(summary.llmCallCount) },
      compute: { cents: Number(summary.runtimeCents) },
    },
    rows: pageRows.map(r => ({
      id:               r.id,
      agentId:          r.agentId,
      type:             r.type as 'browser' | 'dev',
      status:           r.status,
      startedAt:        r.startedAt,
      completedAt:      r.completedAt,
      stepCount:        r.stepCount,
      llmCostCents:     r.llmCostCents,
      runtimeCostCents: r.runtimeCostCents,
      totalCostCents:   r.totalCostCents,
      failureReason:    r.failureReason,
    })),
    nextCursor,
  };
}
