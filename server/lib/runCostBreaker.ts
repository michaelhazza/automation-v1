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

import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { costAggregates, subaccountAgents, agentRuns } from '../db/schema/index.js';
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
 * Call at every cost-incurring boundary (LLM call, Whisper call, Slack
 * call) AFTER the cost has been recorded. The check is cheap (one indexed
 * query). Per T23, this is checked at the boundary, not on a timer, so a
 * runaway 100-step loop trips it within one extra step.
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
