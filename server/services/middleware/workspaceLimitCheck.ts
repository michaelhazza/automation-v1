import { eq, and, gte, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { agentRuns, workspaceLimits } from '../../db/schema/index.js';

// ---------------------------------------------------------------------------
// Workspace Limit Check — pre-run guard that enforces daily token/cost caps
// ---------------------------------------------------------------------------

export interface WorkspaceLimitResult {
  allowed: boolean;
  reason?: string;
  dailyUsed: number;
  dailyLimit: number | null;
}

const COST_PER_1K_TOKENS = 0.3; // rough estimate in cents

/**
 * Check whether a new agent run is allowed under the workspace limits.
 * Called BEFORE a run starts (not inside the agentic loop).
 */
export async function checkWorkspaceLimits(
  subaccountId: string,
  requestedBudget: number
): Promise<WorkspaceLimitResult> {
  // ── 1. Load workspace limits for this subaccount ──────────────────────
  const [limits] = await db
    .select()
    .from(workspaceLimits)
    .where(eq(workspaceLimits.subaccountId, subaccountId));

  if (!limits) {
    // No limits configured — allow everything
    return { allowed: true, dailyUsed: 0, dailyLimit: null };
  }

  // ── 2. Query daily token usage (today UTC) ────────────────────────────
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [usage] = await db
    .select({
      dailyTokens: sql<number>`coalesce(sum(${agentRuns.totalTokens}), 0)::int`,
    })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.subaccountId, subaccountId),
        gte(agentRuns.createdAt, todayStart)
      )
    );

  const dailyUsed = usage?.dailyTokens ?? 0;

  // ── 3. Check daily token limit ────────────────────────────────────────
  if (limits.dailyTokenLimit != null) {
    const projected = dailyUsed + requestedBudget;

    if (projected > limits.dailyTokenLimit) {
      return {
        allowed: false,
        reason: `Daily token limit would be exceeded. Used today: ${dailyUsed}, requested budget: ${requestedBudget}, limit: ${limits.dailyTokenLimit}`,
        dailyUsed,
        dailyLimit: limits.dailyTokenLimit,
      };
    }

    // Alert threshold check
    if (limits.alertThresholdPct != null) {
      const thresholdTokens = (limits.dailyTokenLimit * limits.alertThresholdPct) / 100;
      if (dailyUsed >= thresholdTokens) {
        console.warn(
          `[WorkspaceLimits] Alert: subaccount ${subaccountId} has used ${dailyUsed}/${limits.dailyTokenLimit} tokens today (${Math.round((dailyUsed / limits.dailyTokenLimit) * 100)}%, threshold: ${limits.alertThresholdPct}%)`
        );
      }
    }
  }

  // ── 4. Check daily cost limit ─────────────────────────────────────────
  if (limits.dailyCostLimitCents != null) {
    const dailyCostCents = (dailyUsed / 1000) * COST_PER_1K_TOKENS;
    const projectedCostCents = ((dailyUsed + requestedBudget) / 1000) * COST_PER_1K_TOKENS;

    if (projectedCostCents > limits.dailyCostLimitCents) {
      return {
        allowed: false,
        reason: `Daily cost limit would be exceeded. Estimated cost today: ${dailyCostCents.toFixed(2)}c, projected: ${projectedCostCents.toFixed(2)}c, limit: ${limits.dailyCostLimitCents}c`,
        dailyUsed,
        dailyLimit: limits.dailyTokenLimit,
      };
    }

    // Alert threshold for cost
    if (limits.alertThresholdPct != null) {
      const costThreshold = (limits.dailyCostLimitCents * limits.alertThresholdPct) / 100;
      if (dailyCostCents >= costThreshold) {
        console.warn(
          `[WorkspaceLimits] Cost alert: subaccount ${subaccountId} estimated cost ${dailyCostCents.toFixed(2)}c/${limits.dailyCostLimitCents}c today (threshold: ${limits.alertThresholdPct}%)`
        );
      }
    }
  }

  return {
    allowed: true,
    dailyUsed,
    dailyLimit: limits.dailyTokenLimit,
  };
}
