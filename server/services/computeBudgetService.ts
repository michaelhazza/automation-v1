import { db } from '../db/index.js';
import type { DB } from '../db/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  workspaceLimits,
  orgComputeBudgets,
  computeReservations,
  costAggregates,
  subaccountAgents,
  subaccounts,
} from '../db/schema/index.js';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { env } from '../lib/env.js';
import {
  ComputeBudgetContext,
  ComputeBudgetExceededError,
  projectCostCents,
  compareToLimit,
  projectPaceCents,
  computePeriodResetAt,
  daysRemainingInPeriod,
  classifyPace,
} from './computeBudgetServicePure.js';

export { type ComputeBudgetContext, ComputeBudgetExceededError, isComputeBudgetExceededError } from './computeBudgetServicePure.js';

// Transaction-aware db handle: either the root db or a transaction context
type TxOrDb = DB | Parameters<Parameters<DB['transaction']>[0]>[0];

// ---------------------------------------------------------------------------
// Compute Budget enforcement hierarchy (checked in order, most granular first):
// 1. Agent max LLM calls per run   → subaccountAgents.maxLlmCallsPerRun
// 2. Agent cost cap per run        → subaccountAgents.maxCostPerRunCents
// 3. Run cost cap                  → workspaceLimits.maxCostPerRunCents
// 4. Run LLM call count cap        → workspaceLimits.maxLlmCallsPerRun
// 5. Daily subaccount cost cap     → workspaceLimits.dailyCostLimitCents
// 6. Monthly subaccount cost cap   → workspaceLimits.monthlyCostLimitCents
// 7. Monthly org compute cap       → orgComputeBudgets.monthlyComputeLimitCents
// 8. Global platform safety cap    → env.PLATFORM_MONTHLY_COST_LIMIT_CENTS
// ---------------------------------------------------------------------------

export class RateLimitError extends Error {
  constructor(public readonly limitType: string, public readonly windowKey: string) {
    super(`Rate limit exceeded: ${limitType}`);
    this.name = 'RateLimitError';
  }
}

// ---------------------------------------------------------------------------
// Get active reservation total for an entity (COALESCE actual/estimated)
// ---------------------------------------------------------------------------

async function getActiveReservationTotal(
  entityType: string,
  entityId: string,
  conn: TxOrDb = db,
): Promise<number> {
  const result = await conn
    .select({
      total: sql<number>`COALESCE(SUM(COALESCE(${computeReservations.actualCostCents}, ${computeReservations.estimatedCostCents})), 0)`,
    })
    .from(computeReservations)
    .where(
      and(
        eq(computeReservations.entityType, entityType),
        eq(computeReservations.entityId, entityId),
        eq(computeReservations.status, 'active'),
      ),
    );
  return Number(result[0]?.total ?? 0);
}

// ---------------------------------------------------------------------------
// Get current aggregate spend for an entity + period
// ---------------------------------------------------------------------------

async function getCurrentSpend(
  entityType: string,
  entityId: string,
  periodType: string,
  periodKey: string,
  conn: TxOrDb = db,
): Promise<number> {
  const [row] = await conn
    .select({ totalCostCents: costAggregates.totalCostCents })
    .from(costAggregates)
    .where(
      and(
        eq(costAggregates.entityType, entityType),
        eq(costAggregates.entityId, entityId),
        eq(costAggregates.periodType, periodType),
        eq(costAggregates.periodKey, periodKey),
      ),
    );
  return row?.totalCostCents ?? 0;
}

// ---------------------------------------------------------------------------
// Get run LLM call count
// ---------------------------------------------------------------------------

async function getRunCallCount(runId: string, conn: TxOrDb = db): Promise<number> {
  const [row] = await conn
    .select({ requestCount: costAggregates.requestCount })
    .from(costAggregates)
    .where(
      and(
        eq(costAggregates.entityType, 'run'),
        eq(costAggregates.entityId, runId),
        eq(costAggregates.periodType, 'run'),
        eq(costAggregates.periodKey, runId),
      ),
    );
  return row?.requestCount ?? 0;
}

// ---------------------------------------------------------------------------
// Check rate limits (per-minute, per-hour)
// ---------------------------------------------------------------------------

async function checkRateLimits(
  ctx: ComputeBudgetContext,
  limits: Awaited<ReturnType<typeof getWorkspaceLimits>>,
  conn: TxOrDb = db,
): Promise<void> {
  if (!ctx.subaccountId) return;

  const now = new Date();
  const minuteKey = now.toISOString().slice(0, 16); // 'YYYY-MM-DDTHH:mm'
  const hourKey   = now.toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'

  if (limits?.maxRequestsPerMinute) {
    const [row] = await conn
      .select({ requestCount: costAggregates.requestCount })
      .from(costAggregates)
      .where(
        and(
          eq(costAggregates.entityType, 'subaccount'),
          eq(costAggregates.entityId, ctx.subaccountId),
          eq(costAggregates.periodType, 'minute'),
          eq(costAggregates.periodKey, minuteKey),
        ),
      );
    if ((row?.requestCount ?? 0) >= limits.maxRequestsPerMinute) {
      throw new RateLimitError('requests_per_minute', minuteKey);
    }
  }

  if (limits?.maxRequestsPerHour) {
    const [row] = await conn
      .select({ requestCount: costAggregates.requestCount })
      .from(costAggregates)
      .where(
        and(
          eq(costAggregates.entityType, 'subaccount'),
          eq(costAggregates.entityId, ctx.subaccountId),
          eq(costAggregates.periodType, 'hour'),
          eq(costAggregates.periodKey, hourKey),
        ),
      );
    if ((row?.requestCount ?? 0) >= limits.maxRequestsPerHour) {
      throw new RateLimitError('requests_per_hour', hourKey);
    }
  }
}

// ---------------------------------------------------------------------------
// Load workspace limits for a subaccount
// ---------------------------------------------------------------------------

async function getWorkspaceLimits(subaccountId: string | undefined, conn: TxOrDb = db) {
  if (!subaccountId) return null;
  const [row] = await conn
    .select()
    .from(workspaceLimits)
    .where(eq(workspaceLimits.subaccountId, subaccountId));
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Load subaccount agent limits
// ---------------------------------------------------------------------------

async function getSubaccountAgentLimits(subaccountAgentId: string | undefined, conn: TxOrDb = db) {
  if (!subaccountAgentId) return null;
  const [row] = await conn
    .select()
    .from(subaccountAgents)
    .where(eq(subaccountAgents.id, subaccountAgentId));
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Load org compute budget
// ---------------------------------------------------------------------------

async function getOrgComputeBudget(organisationId: string, conn: TxOrDb = db) {
  const [row] = await conn
    .select()
    .from(orgComputeBudgets)
    .where(eq(orgComputeBudgets.organisationId, organisationId));
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Acquire org-level compute budget lock via SELECT ... FOR UPDATE
// This serializes all budget checks for the same organisation within the tx.
// If no org_compute_budgets row exists, we use a PostgreSQL advisory lock.
//
// KNOWLEDGE.md 2026-04-21: SELECT FOR UPDATE only locks EXISTING rows; when
// no row exists, two concurrent first-calls both pass the check. The advisory
// lock branch covers that case to prevent the double-reservation race window.
// ---------------------------------------------------------------------------

async function acquireOrgComputeBudgetLock(
  tx: TxOrDb,
  organisationId: string,
): Promise<void> {
  const locked = await tx
    .select({ id: orgComputeBudgets.id })
    .from(orgComputeBudgets)
    .where(eq(orgComputeBudgets.organisationId, organisationId))
    .for('update');

  if (locked.length === 0) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${organisationId}))`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main: check all compute budget limits and create reservation
// ---------------------------------------------------------------------------

export async function checkAndReserve(
  ctx:                  ComputeBudgetContext,
  estimatedCostCents:   number,
  idempotencyKey:       string,
): Promise<string | null> {
  // System-level work (sourceType='system' | 'analyzer') has no billing line
  // and no compute budget math to unwind. Skip reservation entirely and return
  // null; the router tolerates null on both the success and error release path.
  if (ctx.sourceType === 'system' || ctx.sourceType === 'analyzer') {
    return null;
  }

  return await db.transaction(async (tx) => {
    // ── 0. Acquire org-level lock to serialize concurrent budget checks ────
    await acquireOrgComputeBudgetLock(tx, ctx.organisationId);

    const [wsLimits, orgComputeBudget] = await Promise.all([
      getWorkspaceLimits(ctx.subaccountId, tx),
      getOrgComputeBudget(ctx.organisationId, tx),
    ]);

    const subaccountAgentLimits = await getSubaccountAgentLimits(ctx.subaccountAgentId, tx);

    // ── Rate limits first (cheap, no spend calculation needed) ──────────────
    await checkRateLimits(ctx, wsLimits, tx);

    // ── Per-run checks ───────────────────────────────────────────────────────
    if (ctx.runId) {
      const [runCallCount, runReservations] = await Promise.all([
        getRunCallCount(ctx.runId, tx),
        getActiveReservationTotal('run', ctx.runId, tx),
      ]);

      // Agent-level call cap
      if (subaccountAgentLimits?.maxLlmCallsPerRun) {
        if (runCallCount >= subaccountAgentLimits.maxLlmCallsPerRun) {
          throw new ComputeBudgetExceededError('agent_llm_calls_per_run', subaccountAgentLimits.maxLlmCallsPerRun, runCallCount + 1, ctx.runId);
        }
      }

      // Workspace-level call cap
      if (wsLimits?.maxLlmCallsPerRun) {
        if (runCallCount >= wsLimits.maxLlmCallsPerRun) {
          throw new ComputeBudgetExceededError('llm_calls_per_run', wsLimits.maxLlmCallsPerRun, runCallCount + 1, ctx.runId);
        }
      }

      // Agent cost cap per run
      if (subaccountAgentLimits?.maxCostPerRunCents) {
        const runSpend = await getCurrentSpend('run', ctx.runId, 'run', ctx.runId, tx);
        const projected = projectCostCents(runSpend + runReservations, estimatedCostCents);
        if (compareToLimit(projected, subaccountAgentLimits.maxCostPerRunCents) === 'exceeded') {
          throw new ComputeBudgetExceededError('agent_cost_per_run', subaccountAgentLimits.maxCostPerRunCents, projected, ctx.runId);
        }
      }

      // Workspace run cost cap
      if (wsLimits?.maxCostPerRunCents) {
        const runSpend = await getCurrentSpend('run', ctx.runId, 'run', ctx.runId, tx);
        const projected = projectCostCents(runSpend + runReservations, estimatedCostCents);
        if (compareToLimit(projected, wsLimits.maxCostPerRunCents) === 'exceeded') {
          throw new ComputeBudgetExceededError('run_cost', wsLimits.maxCostPerRunCents, projected, ctx.runId);
        }
      }
    }

    // ── Subaccount daily + monthly caps ─────────────────────────────────────
    if (ctx.subaccountId) {
      const [dailySpend, monthlySpend, subaccountReservations] = await Promise.all([
        getCurrentSpend('subaccount', ctx.subaccountId, 'daily', ctx.billingDay, tx),
        getCurrentSpend('subaccount', ctx.subaccountId, 'monthly', ctx.billingMonth, tx),
        getActiveReservationTotal('subaccount', ctx.subaccountId, tx),
      ]);

      if (wsLimits?.dailyCostLimitCents) {
        const projected = projectCostCents(dailySpend + subaccountReservations, estimatedCostCents);
        if (compareToLimit(projected, wsLimits.dailyCostLimitCents) === 'exceeded') {
          throw new ComputeBudgetExceededError('daily_subaccount', wsLimits.dailyCostLimitCents, projected, ctx.subaccountId);
        }
      }

      if (wsLimits?.monthlyCostLimitCents) {
        const projected = projectCostCents(monthlySpend + subaccountReservations, estimatedCostCents);
        if (compareToLimit(projected, wsLimits.monthlyCostLimitCents) === 'exceeded') {
          throw new ComputeBudgetExceededError('monthly_subaccount', wsLimits.monthlyCostLimitCents, projected, ctx.subaccountId);
        }
      }
    }

    // ── Org monthly compute cap ──────────────────────────────────────────────
    if (orgComputeBudget?.monthlyComputeLimitCents) {
      const [orgMonthlySpend, orgReservations] = await Promise.all([
        getCurrentSpend('organisation', ctx.organisationId, 'monthly', ctx.billingMonth, tx),
        getActiveReservationTotal('organisation', ctx.organisationId, tx),
      ]);
      const projected = projectCostCents(orgMonthlySpend + orgReservations, estimatedCostCents);
      if (compareToLimit(projected, orgComputeBudget.monthlyComputeLimitCents) === 'exceeded') {
        throw new ComputeBudgetExceededError('monthly_org', orgComputeBudget.monthlyComputeLimitCents, projected, ctx.organisationId);
      }
    }

    // ── Global platform safety cap ───────────────────────────────────────────
    const globalCap = env.PLATFORM_MONTHLY_COST_LIMIT_CENTS;
    if (globalCap) {
      const [platformSpend, platformReservations] = await Promise.all([
        getCurrentSpend('platform', 'global', 'monthly', ctx.billingMonth, tx),
        getActiveReservationTotal('platform', 'global', tx),
      ]);
      const projected = projectCostCents(platformSpend + platformReservations, estimatedCostCents);
      if (compareToLimit(projected, globalCap) === 'exceeded') {
        throw new ComputeBudgetExceededError('global_platform', globalCap, projected, 'global');
      }
    }

    // ── All checks passed — create reservation (inside the same tx) ────────
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const insertedAt = new Date();
    const [reservation] = await tx
      .insert(computeReservations)
      .values({
        idempotencyKey,
        entityType: ctx.subaccountId ? 'subaccount' : 'organisation',
        entityId:   ctx.subaccountId ?? ctx.organisationId,
        estimatedCostCents,
        status: 'active',
        expiresAt,
      })
      // H-1: idempotency_key is UNIQUE. On conflict we perform a no-op UPDATE so
      // that RETURNING always yields the winning row (new or pre-existing).
      .onConflictDoUpdate({
        target: computeReservations.idempotencyKey,
        set: { idempotencyKey: sql`EXCLUDED.idempotency_key` },
      })
      .returning();

    if (reservation.createdAt < insertedAt) {
      console.warn(JSON.stringify({
        event: 'compute_budget:idempotency_conflict',
        idempotencyKey,
        reservationId: reservation.id,
      }));
    }

    return reservation.id;
  });
}

// ---------------------------------------------------------------------------
// Commit reservation with actual cost (releases delta back to compute budget)
// ---------------------------------------------------------------------------

export async function commitReservation(
  reservationId:  string | null,
  actualCostCents: number,
): Promise<void> {
  // Tolerate null — system/analyzer calls never produce a reservation (see
  // checkAndReserve) so there's nothing to commit.
  if (reservationId === null) return;
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system path — commitReservation is called from LLM post-call cleanup, no live org GUC context at that point"
  await db
    .update(computeReservations)
    .set({ status: 'committed', actualCostCents })
    .where(eq(computeReservations.id, reservationId));
}

// ---------------------------------------------------------------------------
// Release reservation on error/timeout (no cost incurred)
// ---------------------------------------------------------------------------

export async function releaseReservation(reservationId: string | null): Promise<void> {
  if (reservationId === null) return;
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system path — releaseReservation is called from LLM error/timeout cleanup, no live org GUC context at that point"
  await db
    .update(computeReservations)
    .set({ status: 'released' })
    .where(eq(computeReservations.id, reservationId));
}

// ---------------------------------------------------------------------------
// CapsResponse — read-only caps + pace (spec §4.3, §4.11)
// ---------------------------------------------------------------------------

export interface CapsResponse {
  scope: 'workspace' | 'org';
  orgCap: {
    monthlyUsd: number;
    usedMtdUsd: number;
    daysRemaining: number;
    pace: 'on_track' | 'warning' | 'over';
  };
  workspaces: Array<{
    id: string;
    name: string;
    dailyCapUsd: number | null;
    monthlyCapUsd: number | null;
    usedMtdUsd: number;
    pacePct: number;
    status: 'on_track' | 'warning' | 'over';
  }>;
  periodResetAt: string;
  paceWindow: '7d' | '14d' | '30d';
  paceProjectedEndOfPeriodUsd: number;
}

export interface GetCapsOptions {
  organisationId: string;
  scope: 'workspace' | 'org';
  subaccountId?: string;
}

export async function getCapsResponse(opts: GetCapsOptions): Promise<CapsResponse> {
  const db = getOrgScopedDb('computeBudgetService.getCapsResponse');
  const now = new Date();
  const billingMonth = now.toISOString().slice(0, 7); // 'YYYY-MM'
  const resetAt = computePeriodResetAt(now);
  const daysRemaining = daysRemainingInPeriod(now);

  // Build the 7 daily period keys covering the window [now-6d, now]
  const windowDays = 7;
  const windowKeys: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    windowKeys.push(d.toISOString().slice(0, 10));
  }

  // Days elapsed in window = min(7, day-of-month) to avoid projecting on
  // partial first day of month when window spans a month boundary.
  const dayOfMonth = now.getUTCDate(); // 1-indexed
  const daysElapsedInWindow = Math.min(windowDays, dayOfMonth);

  const [orgBudget, orgMtdRow, orgWindowRows, allSubaccounts] = await Promise.all([
    getOrgComputeBudget(opts.organisationId),
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    db
      .select({ totalCostCents: costAggregates.totalCostCents })
      .from(costAggregates)
      .where(
        and(
          eq(costAggregates.entityType, 'organisation'),
          eq(costAggregates.entityId, opts.organisationId),
          eq(costAggregates.periodType, 'monthly'),
          eq(costAggregates.periodKey, billingMonth),
        ),
      )
      .then((rows) => rows[0] ?? null),
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    db
      .select({ totalCostCents: costAggregates.totalCostCents })
      .from(costAggregates)
      .where(
        and(
          eq(costAggregates.entityType, 'organisation'),
          eq(costAggregates.entityId, opts.organisationId),
          eq(costAggregates.periodType, 'daily'),
          inArray(costAggregates.periodKey, windowKeys),
        ),
      ),
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
    db
      .select({ id: subaccounts.id, name: subaccounts.name })
      .from(subaccounts)
      .where(
        and(
          eq(subaccounts.organisationId, opts.organisationId),
          sql`${subaccounts.deletedAt} IS NULL`,
        ),
      ),
  ]);

  const orgMtdCents = orgMtdRow?.totalCostCents ?? 0;
  const orgWindowCents = orgWindowRows.reduce((s, r) => s + (r.totalCostCents ?? 0), 0);
  const orgCapCents = orgBudget?.monthlyComputeLimitCents ?? 0;

  const orgProjectedCents = projectPaceCents(orgMtdCents, orgWindowCents, daysElapsedInWindow, daysRemaining);
  const orgPace = classifyPace(orgProjectedCents, orgCapCents);

  // Per-workspace: fetch limits + MTD spend in parallel
  const subaccountIds = allSubaccounts.map((s) => s.id);

  const [wsLimitsRows, wsMtdRows] = subaccountIds.length > 0
    ? await Promise.all([
        // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
        db
          .select({
            subaccountId: workspaceLimits.subaccountId,
            dailyCapCents: workspaceLimits.dailyCostLimitCents,
            monthlyCapCents: workspaceLimits.monthlyCostLimitCents,
          })
          .from(workspaceLimits)
          .where(inArray(workspaceLimits.subaccountId, subaccountIds)),
        // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
        db
          .select({
            entityId: costAggregates.entityId,
            totalCostCents: costAggregates.totalCostCents,
          })
          .from(costAggregates)
          .where(
            and(
              eq(costAggregates.entityType, 'subaccount'),
              inArray(costAggregates.entityId, subaccountIds),
              eq(costAggregates.periodType, 'monthly'),
              eq(costAggregates.periodKey, billingMonth),
            ),
          ),
      ])
    : [[], []];

  const limitsMap = new Map(wsLimitsRows.map((r) => [r.subaccountId, r]));
  const mtdMap = new Map(wsMtdRows.map((r) => [r.entityId, r.totalCostCents ?? 0]));

  const workspaces: CapsResponse['workspaces'] = allSubaccounts.map((ws) => {
    const limits = limitsMap.get(ws.id);
    const usedMtdCents = mtdMap.get(ws.id) ?? 0;
    const monthlyCapCents = limits?.monthlyCapCents ?? 0;
    const pacePct = monthlyCapCents > 0
      ? Math.min(200, Math.round((usedMtdCents / monthlyCapCents) * 100))
      : 0;
    const status = classifyPace(usedMtdCents, monthlyCapCents);
    return {
      id: ws.id,
      name: ws.name,
      dailyCapUsd: limits?.dailyCapCents != null ? limits.dailyCapCents / 100 : null,
      monthlyCapUsd: limits?.monthlyCapCents != null ? limits.monthlyCapCents / 100 : null,
      usedMtdUsd: usedMtdCents / 100,
      pacePct,
      status,
    };
  });

  return {
    scope: opts.scope,
    orgCap: {
      monthlyUsd: orgCapCents / 100,
      usedMtdUsd: orgMtdCents / 100,
      daysRemaining,
      pace: orgPace,
    },
    workspaces,
    periodResetAt: resetAt.toISOString(),
    paceWindow: '7d',
    paceProjectedEndOfPeriodUsd: orgProjectedCents / 100,
  };
}

export const computeBudgetService = {
  checkAndReserve,
  commitReservation,
  releaseReservation,
  getWorkspaceLimits,
};
