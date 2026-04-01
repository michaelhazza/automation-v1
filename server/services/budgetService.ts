import { db } from '../db/index.js';
import type { DB } from '../db/index.js';
import {
  workspaceLimits,
  orgBudgets,
  budgetReservations,
  costAggregates,
  subaccountAgents,
} from '../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { env } from '../lib/env.js';

// Transaction-aware db handle: either the root db or a transaction context
type TxOrDb = DB | Parameters<Parameters<DB['transaction']>[0]>[0];

// ---------------------------------------------------------------------------
// Budget enforcement hierarchy (checked in order, most granular first):
// 1. Agent max LLM calls per run   → subaccountAgents.maxLlmCallsPerRun
// 2. Agent cost cap per run        → subaccountAgents.maxCostPerRunCents
// 3. Run cost cap                  → workspaceLimits.maxCostPerRunCents
// 4. Run LLM call count cap        → workspaceLimits.maxLlmCallsPerRun
// 5. Daily subaccount cost cap     → workspaceLimits.dailyCostLimitCents
// 6. Monthly subaccount cost cap   → workspaceLimits.monthlyCostLimitCents
// 7. Monthly org cost cap          → orgBudgets.monthlyCostLimitCents
// 8. Global platform safety cap    → env.PLATFORM_MONTHLY_COST_LIMIT_CENTS
// ---------------------------------------------------------------------------

export interface BudgetContext {
  organisationId:   string;
  subaccountId?:    string;
  runId?:           string;
  subaccountAgentId?: string;
  billingDay:       string;   // 'YYYY-MM-DD'
  billingMonth:     string;   // 'YYYY-MM'
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly limitType: string,
    public readonly limitCents: number,
    public readonly projectedCents: number,
    public readonly entityId: string,
  ) {
    super(`Budget exceeded: ${limitType} limit ${limitCents}¢ < projected ${projectedCents}¢`);
    this.name = 'BudgetExceededError';
  }
}

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
      total: sql<number>`COALESCE(SUM(COALESCE(${budgetReservations.actualCostCents}, ${budgetReservations.estimatedCostCents})), 0)`,
    })
    .from(budgetReservations)
    .where(
      and(
        eq(budgetReservations.entityType, entityType),
        eq(budgetReservations.entityId, entityId),
        eq(budgetReservations.status, 'active'),
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
  ctx: BudgetContext,
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
// Load org budget
// ---------------------------------------------------------------------------

async function getOrgBudget(organisationId: string, conn: TxOrDb = db) {
  const [row] = await conn
    .select()
    .from(orgBudgets)
    .where(eq(orgBudgets.organisationId, organisationId));
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Acquire org-level budget lock via SELECT ... FOR UPDATE
// This serializes all budget checks for the same organisation within the tx.
// If no org_budgets row exists, we use a PostgreSQL advisory lock instead.
// ---------------------------------------------------------------------------

async function acquireOrgBudgetLock(
  tx: TxOrDb,
  organisationId: string,
): Promise<void> {
  // Try to lock the org_budgets row. This serializes concurrent budget checks.
  const locked = await tx
    .select({ id: orgBudgets.id })
    .from(orgBudgets)
    .where(eq(orgBudgets.organisationId, organisationId))
    .for('update');

  // If no org_budgets row exists, fall back to an advisory lock keyed on the
  // organisation UUID. This ensures serialization even for orgs without an
  // explicit budget row.
  if (locked.length === 0) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${organisationId}))`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main: check all budget limits and create reservation
// ---------------------------------------------------------------------------

export async function checkAndReserve(
  ctx:                  BudgetContext,
  estimatedCostCents:   number,
  idempotencyKey:       string,
): Promise<string> {
  // Wrap the entire check-and-reserve flow in a serializable transaction.
  // acquireOrgBudgetLock() uses SELECT ... FOR UPDATE on the org_budgets row
  // (or pg_advisory_xact_lock for orgs without one) to serialize concurrent
  // budget checks for the same organisation, eliminating the race condition
  // where two requests both pass budget checks before either reserves.
  return await db.transaction(async (tx) => {
    // ── 0. Acquire org-level lock to serialize concurrent budget checks ────
    await acquireOrgBudgetLock(tx, ctx.organisationId);

    const [wsLimits, orgBudget] = await Promise.all([
      getWorkspaceLimits(ctx.subaccountId, tx),
      getOrgBudget(ctx.organisationId, tx),
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
          throw new BudgetExceededError('agent_llm_calls_per_run', subaccountAgentLimits.maxLlmCallsPerRun, runCallCount + 1, ctx.runId);
        }
      }

      // Workspace-level call cap
      if (wsLimits?.maxLlmCallsPerRun) {
        if (runCallCount >= wsLimits.maxLlmCallsPerRun) {
          throw new BudgetExceededError('llm_calls_per_run', wsLimits.maxLlmCallsPerRun, runCallCount + 1, ctx.runId);
        }
      }

      // Agent cost cap per run
      if (subaccountAgentLimits?.maxCostPerRunCents) {
        const runSpend = await getCurrentSpend('run', ctx.runId, 'run', ctx.runId, tx);
        const projected = runSpend + runReservations + estimatedCostCents;
        if (projected > subaccountAgentLimits.maxCostPerRunCents) {
          throw new BudgetExceededError('agent_cost_per_run', subaccountAgentLimits.maxCostPerRunCents, projected, ctx.runId);
        }
      }

      // Workspace run cost cap
      if (wsLimits?.maxCostPerRunCents) {
        const runSpend = await getCurrentSpend('run', ctx.runId, 'run', ctx.runId, tx);
        const projected = runSpend + runReservations + estimatedCostCents;
        if (projected > wsLimits.maxCostPerRunCents) {
          throw new BudgetExceededError('run_cost', wsLimits.maxCostPerRunCents, projected, ctx.runId);
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
        const projected = dailySpend + subaccountReservations + estimatedCostCents;
        if (projected > wsLimits.dailyCostLimitCents) {
          throw new BudgetExceededError('daily_subaccount', wsLimits.dailyCostLimitCents, projected, ctx.subaccountId);
        }
      }

      if (wsLimits?.monthlyCostLimitCents) {
        const projected = monthlySpend + subaccountReservations + estimatedCostCents;
        if (projected > wsLimits.monthlyCostLimitCents) {
          throw new BudgetExceededError('monthly_subaccount', wsLimits.monthlyCostLimitCents, projected, ctx.subaccountId);
        }
      }
    }

    // ── Org monthly cap ──────────────────────────────────────────────────────
    if (orgBudget?.monthlyCostLimitCents) {
      const [orgMonthlySpend, orgReservations] = await Promise.all([
        getCurrentSpend('organisation', ctx.organisationId, 'monthly', ctx.billingMonth, tx),
        getActiveReservationTotal('organisation', ctx.organisationId, tx),
      ]);
      const projected = orgMonthlySpend + orgReservations + estimatedCostCents;
      if (projected > orgBudget.monthlyCostLimitCents) {
        throw new BudgetExceededError('monthly_org', orgBudget.monthlyCostLimitCents, projected, ctx.organisationId);
      }
    }

    // ── Global platform safety cap ───────────────────────────────────────────
    const globalCap = env.PLATFORM_MONTHLY_COST_LIMIT_CENTS;
    if (globalCap) {
      const [platformSpend, platformReservations] = await Promise.all([
        getCurrentSpend('platform', 'global', 'monthly', ctx.billingMonth, tx),
        getActiveReservationTotal('platform', 'global', tx),
      ]);
      const projected = platformSpend + platformReservations + estimatedCostCents;
      if (projected > globalCap) {
        throw new BudgetExceededError('global_platform', globalCap, projected, 'global');
      }
    }

    // ── All checks passed — create reservation (inside the same tx) ────────
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const insertedAt = new Date();
    const [reservation] = await tx
      .insert(budgetReservations)
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
      // This guarantees true exactly-once semantics: the caller always gets a
      // valid reservation ID regardless of concurrent duplicate submissions.
      .onConflictDoUpdate({
        target: budgetReservations.idempotencyKey,
        set: { idempotencyKey: sql`EXCLUDED.idempotency_key` },
      })
      .returning();

    if (reservation.createdAt < insertedAt) {
      console.warn(JSON.stringify({
        event: 'budget:idempotency_conflict',
        idempotencyKey,
        reservationId: reservation.id,
      }));
    }

    return reservation.id;
  });
}

// ---------------------------------------------------------------------------
// Commit reservation with actual cost (releases delta back to budget)
// ---------------------------------------------------------------------------

export async function commitReservation(
  reservationId:  string,
  actualCostCents: number,
): Promise<void> {
  await db
    .update(budgetReservations)
    .set({ status: 'committed', actualCostCents })
    .where(eq(budgetReservations.id, reservationId));
}

// ---------------------------------------------------------------------------
// Release reservation on error/timeout (no cost incurred)
// ---------------------------------------------------------------------------

export async function releaseReservation(reservationId: string): Promise<void> {
  await db
    .update(budgetReservations)
    .set({ status: 'released' })
    .where(eq(budgetReservations.id, reservationId));
}

export const budgetService = {
  checkAndReserve,
  commitReservation,
  releaseReservation,
  getWorkspaceLimits,
};
