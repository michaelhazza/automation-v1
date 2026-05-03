import { db } from '../db/index.js';
import { costAggregates, workspaceLimits, orgComputeBudgets, agentRuns } from '../db/schema/index.js';
import { sql, and, eq } from 'drizzle-orm';
import type { LlmRequest } from '../db/schema/index.js';

// ---------------------------------------------------------------------------
// Cost aggregate upsert — called from the pg-boss job after each llm_request
//
// Updates aggregates for all relevant dimensions:
//   - organisation (monthly, daily)
//   - subaccount (monthly, daily)
//   - run (lifetime)
//   - agent (monthly)
//   - task_type (monthly)
//   - provider (monthly)
//   - rate-limit windows (minute, hour)
//
// NEW entityType values added in migration 0272 (agentic-commerce):
//   - agent_spend_subaccount  (monthly + daily)
//   - agent_spend_org         (monthly + daily)
//   - agent_spend_run         (per-run)
//
// These new entityType values are owned exclusively by
// server/services/agentSpendAggregateService.ts and MUST NOT be written here.
// Per spec §6.1, LLM cost rollups and agent-spend rollups are kept in separate
// parallel writers to prevent commingling.
// ---------------------------------------------------------------------------

export async function upsertAggregates(request: LlmRequest): Promise<void> {
  const isError = request.status !== 'success' && request.status !== 'partial';
  const costCents = request.costWithMarginCents;
  const costRaw   = parseFloat(String(request.costRaw));
  const costMargin = parseFloat(String(request.costWithMargin));

  const PLATFORM_SENTINEL = '00000000-0000-0000-0000-000000000001';

  const dimensions: Array<{
    entityType:     string;
    entityId:       string;
    periodType:     string;
    periodKey:      string;
    organisationId: string;
  }> = [];

  // Feature 2 §4.7 — test runs must not inflate P&L aggregates.
  // Check is_test_run on the associated agent_run (one lookup; test runs are rare).
  let isTestRun = false;
  if (request.runId) {
    const [runRow] = await db
      .select({ isTestRun: agentRuns.isTestRun })
      .from(agentRuns)
      .where(eq(agentRuns.id, request.runId))
      .limit(1);
    isTestRun = runRow?.isTestRun ?? false;
  }

  if (!isTestRun) {
    // Organisation
    dimensions.push({ entityType: 'organisation', entityId: request.organisationId, periodType: 'monthly', periodKey: request.billingMonth, organisationId: request.organisationId });
    dimensions.push({ entityType: 'organisation', entityId: request.organisationId, periodType: 'daily',   periodKey: request.billingDay,   organisationId: request.organisationId });

    // Subaccount
    if (request.subaccountId) {
      dimensions.push({ entityType: 'subaccount', entityId: request.subaccountId, periodType: 'monthly', periodKey: request.billingMonth, organisationId: request.organisationId });
      dimensions.push({ entityType: 'subaccount', entityId: request.subaccountId, periodType: 'daily',   periodKey: request.billingDay,   organisationId: request.organisationId });
    }
  } else {
    // Test run: skip org/subaccount aggregates but still write the per-run dimension
    // so the individual run trace viewer can show token/cost data.
  }

  // Run (lifetime aggregate)
  if (request.runId) {
    dimensions.push({ entityType: 'run', entityId: request.runId, periodType: 'run', periodKey: request.runId, organisationId: request.organisationId });
  }

  // Agent (monthly)
  if (request.agentName) {
    const agentKey = request.subaccountId
      ? `${request.subaccountId}:${request.agentName}`
      : request.agentName;
    dimensions.push({ entityType: 'agent', entityId: agentKey, periodType: 'monthly', periodKey: request.billingMonth, organisationId: request.organisationId });
  }

  // Task type (monthly, org-scoped) — platform-sentinel: entityId contains org prefix but the
  // dim is shared infrastructure; use sentinel to avoid per-org RLS on a platform view.
  dimensions.push({
    entityType:     'task_type',
    entityId:       `${request.organisationId}:${request.taskType}`,
    periodType:     'monthly',
    periodKey:      request.billingMonth,
    organisationId: PLATFORM_SENTINEL,
  });

  // Provider (monthly — enables per-provider spend dashboard)
  dimensions.push({ entityType: 'provider', entityId: request.provider, periodType: 'monthly', periodKey: request.billingMonth, organisationId: PLATFORM_SENTINEL });

  // Platform-level (monthly)
  dimensions.push({ entityType: 'platform', entityId: 'global', periodType: 'monthly', periodKey: request.billingMonth, organisationId: PLATFORM_SENTINEL });

  // Execution phase (monthly — enables cost-per-phase analytics)
  if (request.executionPhase) {
    dimensions.push({
      entityType:     'execution_phase',
      entityId:       `${request.organisationId}:${request.executionPhase}`,
      periodType:     'monthly',
      periodKey:      request.billingMonth,
      organisationId: PLATFORM_SENTINEL,
    });
  }

  // Rev §6 — new dimensions for the System P&L page.
  //
  // Source type (monthly — enables 'overhead vs billable' splits).
  // Entity ID is the raw sourceType value so 'system' and 'analyzer' each
  // get their own row on the `By Source Type` tab per spec §11.5.
  dimensions.push({
    entityType:     'source_type',
    entityId:       request.sourceType,
    periodType:     'monthly',
    periodKey:      request.billingMonth,
    organisationId: PLATFORM_SENTINEL,
  });
  dimensions.push({
    entityType:     'source_type',
    entityId:       request.sourceType,
    periodType:     'daily',
    periodKey:      request.billingDay,
    organisationId: PLATFORM_SENTINEL,
  });

  // Feature tag (monthly — enables per-feature cost attribution).
  if (request.featureTag && request.featureTag !== 'unknown') {
    dimensions.push({
      entityType:     'feature_tag',
      entityId:       request.featureTag,
      periodType:     'monthly',
      periodKey:      request.billingMonth,
      organisationId: PLATFORM_SENTINEL,
    });
  }

  // Rate-limit windows (minute + hour) — only for subaccount
  if (request.subaccountId) {
    // minute key: 'YYYY-MM-DDTHH:mm'
    const minuteKey = request.createdAt.toISOString().slice(0, 16);
    // hour key: 'YYYY-MM-DDTHH'
    const hourKey = request.createdAt.toISOString().slice(0, 13);
    dimensions.push({ entityType: 'subaccount', entityId: request.subaccountId, periodType: 'minute', periodKey: minuteKey, organisationId: request.organisationId });
    dimensions.push({ entityType: 'subaccount', entityId: request.subaccountId, periodType: 'hour',   periodKey: hourKey,   organisationId: request.organisationId });
  }

  // Upsert all dimensions in a single batch
  await Promise.all(
    dimensions.map(async (dim) => {
      await db
        .insert(costAggregates)
        .values({
          entityType:          dim.entityType,
          entityId:            dim.entityId,
          periodType:          dim.periodType,
          periodKey:           dim.periodKey,
          organisationId:      dim.organisationId,
          totalCostRaw:        String(costRaw),
          totalCostWithMargin: String(costMargin),
          totalCostCents:      costCents,
          totalTokensIn:       request.tokensIn,
          totalTokensOut:      request.tokensOut,
          requestCount:        1,
          errorCount:          isError ? 1 : 0,
          updatedAt:           new Date(),
        })
        .onConflictDoUpdate({
          target: [costAggregates.entityType, costAggregates.entityId, costAggregates.periodType, costAggregates.periodKey],
          set: {
            totalCostRaw:        sql`${costAggregates.totalCostRaw} + ${String(costRaw)}`,
            totalCostWithMargin: sql`${costAggregates.totalCostWithMargin} + ${String(costMargin)}`,
            totalCostCents:      sql`${costAggregates.totalCostCents} + ${costCents}`,
            totalTokensIn:       sql`${costAggregates.totalTokensIn} + ${request.tokensIn}`,
            totalTokensOut:      sql`${costAggregates.totalTokensOut} + ${request.tokensOut}`,
            requestCount:        sql`${costAggregates.requestCount} + 1`,
            errorCount:          isError
              ? sql`${costAggregates.errorCount} + 1`
              : costAggregates.errorCount,
            updatedAt: new Date(),
          },
        });
    }),
  );
}

// ---------------------------------------------------------------------------
// Check alert thresholds — called after aggregate upsert
// Returns list of alerts that were triggered
// ---------------------------------------------------------------------------

export async function checkAlertThresholds(
  organisationId: string,
  subaccountId:   string | null | undefined,
  billingMonth:   string,
): Promise<Array<{ type: string; entityId: string; pct: number; limitCents: number; spendCents: number }>> {
  const alerts: Array<{ type: string; entityId: string; pct: number; limitCents: number; spendCents: number }> = [];

  if (subaccountId) {
    const [wsLimits] = await db
      .select()
      .from(workspaceLimits)
      .where(eq(workspaceLimits.subaccountId, subaccountId));

    if (wsLimits?.monthlyCostLimitCents && wsLimits.monthlyCostLimitCents > 0) {
      const [agg] = await db
        .select()
        .from(costAggregates)
        .where(
          and(
            eq(costAggregates.entityType, 'subaccount'),
            eq(costAggregates.entityId, subaccountId),
            eq(costAggregates.periodType, 'monthly'),
            eq(costAggregates.periodKey, billingMonth),
          ),
        );

      const spendCents = agg?.totalCostCents ?? 0;
      const pct = Math.floor((spendCents / wsLimits.monthlyCostLimitCents) * 100);
      const threshold = wsLimits.alertThresholdPct ?? 80;

      if (pct >= threshold) {
        alerts.push({ type: 'subaccount_monthly', entityId: subaccountId, pct, limitCents: wsLimits.monthlyCostLimitCents, spendCents });
      }
    }
  }

  const [orgBudget] = await db
    .select()
    .from(orgComputeBudgets)
    .where(eq(orgComputeBudgets.organisationId, organisationId));

  if (orgBudget?.monthlyComputeLimitCents && orgBudget.monthlyComputeLimitCents > 0) {
    const [agg] = await db
      .select()
      .from(costAggregates)
      .where(
        and(
          eq(costAggregates.entityType, 'organisation'),
          eq(costAggregates.entityId, organisationId),
          eq(costAggregates.periodType, 'monthly'),
          eq(costAggregates.periodKey, billingMonth),
        ),
      );

    const spendCents = agg?.totalCostCents ?? 0;
    const pct = Math.floor((spendCents / orgBudget.monthlyComputeLimitCents) * 100);
    const threshold = orgBudget.alertThresholdPct ?? 80;

    if (pct >= threshold) {
      alerts.push({ type: 'org_monthly', entityId: organisationId, pct, limitCents: orgBudget.monthlyComputeLimitCents, spendCents });
    }
  }

  if (alerts.length > 0) {
    // Log alerts — wire up to email/webhook notifications when ready
    for (const alert of alerts) {
      console.warn(`[costAggregates] BUDGET ALERT: ${alert.type} entity=${alert.entityId} ${alert.pct}% of ${alert.limitCents}¢ limit (${alert.spendCents}¢ spent)`);
    }
  }

  return alerts;
}

export const costAggregateService = {
  upsertAggregates,
  checkAlertThresholds,
};
