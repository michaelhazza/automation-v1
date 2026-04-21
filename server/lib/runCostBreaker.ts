/**
 * Run-level cost circuit breaker — T23.
 *
 * Spec: docs/reporting-agent-paywall-workflow-spec.md §8.4.1 / T23.
 *
 * The Reporting Agent has a multi-component cost surface (browser LLM loop
 * + Whisper + report skill). A bug in any of those — infinite retry,
 * runaway loop, mispriced model — could rack up real spend before a human
 * notices.
 *
 * This helper provides a hard ceiling check that callers run at every
 * cost-incurring boundary. The ceiling is read from
 * subaccount_agents.maxCostPerRunCents (existing column), with a system
 * default of 100 cents ($1.00).
 *
 * On overage: throws via failure('internal_error', 'cost_limit_exceeded',
 * { spentCents, limitCents }) so the caller routes through the unified
 * failure taxonomy.
 *
 * Callers:
 *  - llmRouter (after every LLM call cost is recorded)
 *  - sendToSlackService / transcribeAudioService (before each external
 *    call so a runaway retry hits the ceiling within one extra call)
 */

import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { costAggregates, subaccountAgents, agentRuns, llmRequests } from '../db/schema/index.js';
import { failure, FailureError } from '../../shared/iee/failure.js';
import { logger } from './logger.js';

const SYSTEM_DEFAULT_MAX_COST_CENTS = 100; // $1.00

export interface RunCostBreakerContext {
  runId: string;
  subaccountAgentId?: string | null;
  organisationId: string;
  correlationId: string;
}

/**
 * Resolve the per-run cost ceiling. Precedence:
 *   1. ctx.subaccountAgentId (if caller passed it)
 *   2. agent_runs.subaccountAgentId resolved from ctx.runId
 *   3. SYSTEM_DEFAULT_MAX_COST_CENTS (100 cents)
 *
 * Per pr-reviewer B5: callers like transcribeAudioService /
 * sendToSlackService do not have a `subaccountAgentId` in their context,
 * so we resolve it from agent_runs at the breaker boundary. Without this
 * fallback the breaker would hard-code the system default for those
 * callers, ignoring the per-subaccount-agent maxCostPerRunCents config.
 */
export async function resolveRunCostCeiling(
  ctx: RunCostBreakerContext,
): Promise<number> {
  let subaccountAgentId = ctx.subaccountAgentId ?? null;
  if (!subaccountAgentId) {
    const [runRow] = await db
      .select({ subaccountAgentId: agentRuns.subaccountAgentId })
      .from(agentRuns)
      .where(eq(agentRuns.id, ctx.runId))
      .limit(1);
    subaccountAgentId = runRow?.subaccountAgentId ?? null;
  }
  if (!subaccountAgentId) return SYSTEM_DEFAULT_MAX_COST_CENTS;
  const [row] = await db
    .select({ maxCostPerRunCents: subaccountAgents.maxCostPerRunCents })
    .from(subaccountAgents)
    .where(eq(subaccountAgents.id, subaccountAgentId))
    .limit(1);
  if (!row) return SYSTEM_DEFAULT_MAX_COST_CENTS;
  return row.maxCostPerRunCents ?? SYSTEM_DEFAULT_MAX_COST_CENTS;
}

/**
 * Read the running cost for an agent run from cost_aggregates. Returns
 * total cents spent so far (LLM + worker runtime + Whisper, etc.).
 *
 * cost_aggregates uses (entityType, entityId, periodType, periodKey) as
 * its key. Per-run cost is keyed as
 * (entityType='run', entityId=<runId>, periodType='run', periodKey=<runId>).
 *
 * Canonical callers: sendToSlackService, transcribeAudioService. The LLM
 * router uses the direct-ledger sibling `getRunCostCentsFromLedger` because
 * `cost_aggregates` is updated asynchronously by
 * `routerJobService.enqueueAggregateUpdate` and the router requires a
 * synchronous view of per-run spend to enforce the per-call breaker. See
 * tasks/hermes-audit-tier-1-spec.md §7.4.1.
 */
export async function getRunCostCents(runId: string): Promise<number> {
  const rows = await db
    .select({
      totalCostCents: costAggregates.totalCostCents,
    })
    .from(costAggregates)
    .where(
      and(
        eq(costAggregates.entityType, 'run'),
        eq(costAggregates.entityId, runId),
        eq(costAggregates.periodType, 'run'),
      ),
    );
  let total = 0;
  for (const r of rows) {
    if (typeof r.totalCostCents === 'number') total += r.totalCostCents;
  }
  return total;
}

/**
 * Assert that the run is within budget. Throws via failure() if not.
 *
 * Call at every cost-incurring boundary (Whisper call, Slack call) AFTER
 * the cost has been recorded. The check is cheap (one indexed query). Per
 * T23, this is checked at the boundary, not on a timer, so a runaway
 * 100-step loop trips it within one extra step.
 *
 * Canonical callers: sendToSlackService, transcribeAudioService. The LLM
 * router uses the direct-ledger sibling `assertWithinRunBudgetFromLedger`
 * (see §7.4.1 / §8.3 of tasks/hermes-audit-tier-1-spec.md) because
 * `cost_aggregates` is updated asynchronously and LLM-call volume dwarfs
 * the rollup's aggregation-interval lag.
 */
export async function assertWithinRunBudget(
  ctx: RunCostBreakerContext,
): Promise<void> {
  const limit = await resolveRunCostCeiling(ctx);
  const spent = await getRunCostCents(ctx.runId);
  if (spent > limit) {
    logger.error('costBreaker.exceeded', {
      runId: ctx.runId,
      correlationId: ctx.correlationId,
      organisationId: ctx.organisationId,
      spentCents: spent,
      limitCents: limit,
    });
    throw new FailureError(
      failure('internal_error', 'cost_limit_exceeded', {
        spentCents: spent,
        limitCents: limit,
        runId: ctx.runId,
        correlationId: ctx.correlationId,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Direct-ledger sibling — Hermes Tier 1 Phase C
// ---------------------------------------------------------------------------
//
// `cost_aggregates` is updated asynchronously by
// `routerJobService.enqueueAggregateUpdate` (see `llmRouter.ts`), so a
// rollup-based read can lag by up to one aggregation interval under
// concurrency. The LLM router is the dominant cost surface; it cannot
// tolerate that lag. The two sibling exports below read
// `SUM(cost_with_margin_cents) FROM llm_requests WHERE run_id = $1 AND
// status IN ('success','partial')` directly so the breaker sees every
// committed ledger row at check time.
//
// Spec ref: tasks/hermes-audit-tier-1-spec.md §4.3, §7.3.1, §7.4.1, §8.3.

const LEDGER_COUNTED_STATUSES = ['success', 'partial'] as const;

/**
 * Read the running cost for an agent run from the `llm_requests` ledger
 * directly. Returns total cents spent so far across successful and partial
 * LLM calls for this run. Bypasses the asynchronous `cost_aggregates`
 * rollup so concurrent callers see every committed row at check time.
 *
 * Canonical caller: `llmRouter.routeCall`. Slack and Whisper callers use
 * the unchanged `getRunCostCents` (reads from `cost_aggregates`).
 */
export async function getRunCostCentsFromLedger(runId: string): Promise<number> {
  const rows = await db
    .select({
      totalCents: sql<number | null>`SUM(${llmRequests.costWithMarginCents})`,
    })
    .from(llmRequests)
    .where(
      and(
        eq(llmRequests.runId, runId),
        inArray(llmRequests.status, LEDGER_COUNTED_STATUSES as unknown as string[]),
      ),
    );
  const total = rows[0]?.totalCents;
  return typeof total === 'number' ? total : Number(total ?? 0);
}

export interface RunCostBreakerFromLedgerContext extends RunCostBreakerContext {
  /**
   * The id of the `llm_requests` row the caller just inserted (from
   * `.returning({ id })`). REQUIRED — the helper fails closed when this is
   * `null` or when the row is not visible to the breaker's read connection.
   * See §7.3.1 of tasks/hermes-audit-tier-1-spec.md: this structural
   * coupling catches (a) a future refactor that skips or re-orders the
   * ledger write, and (b) cross-connection transaction-visibility drift
   * before they silently produce stale breaker reads.
   */
  insertedLedgerRowId: string | null;
}

/**
 * Direct-ledger sibling of `assertWithinRunBudget`. Throws via failure()
 * when `SUM(llm_requests.cost_with_margin_cents) > ceiling`.
 *
 * Canonical caller: `llmRouter.routeCall`. Called immediately after the
 * ledger insert, using the inserted row's id as a visibility check. Slack
 * and Whisper callers use the unchanged `assertWithinRunBudget` (reads
 * from `cost_aggregates`).
 *
 * Fail-closed modes (both surface as `FailureError('internal_error', ...)`):
 *   - `breaker_no_ledger_link`: caller passed `insertedLedgerRowId=null`.
 *   - `breaker_ledger_not_visible`: the id is not readable on this
 *     connection — caller has an uncommitted transaction or routes the
 *     read against a lagged replica.
 */
export async function assertWithinRunBudgetFromLedger(
  ctx: RunCostBreakerFromLedgerContext,
): Promise<void> {
  if (!ctx.insertedLedgerRowId) {
    throw new FailureError(
      failure('internal_error', 'breaker_no_ledger_link', {
        runId: ctx.runId,
        correlationId: ctx.correlationId,
      }),
    );
  }

  const [found] = await db
    .select({ id: llmRequests.id })
    .from(llmRequests)
    .where(eq(llmRequests.id, ctx.insertedLedgerRowId))
    .limit(1);
  if (!found) {
    throw new FailureError(
      failure('internal_error', 'breaker_ledger_not_visible', {
        runId: ctx.runId,
        insertedLedgerRowId: ctx.insertedLedgerRowId,
        correlationId: ctx.correlationId,
      }),
    );
  }

  const limit = await resolveRunCostCeiling(ctx);
  const spent = await getRunCostCentsFromLedger(ctx.runId);
  if (spent > limit) {
    logger.error('costBreaker.exceeded', {
      runId: ctx.runId,
      correlationId: ctx.correlationId,
      organisationId: ctx.organisationId,
      spentCents: spent,
      limitCents: limit,
      source: 'ledger',
    });
    throw new FailureError(
      failure('internal_error', 'cost_limit_exceeded', {
        spentCents: spent,
        limitCents: limit,
        runId: ctx.runId,
        correlationId: ctx.correlationId,
      }),
    );
  }
}
