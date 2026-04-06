import { db } from '../db/index.js';
import { costAggregates, workspaceLimits, orgBudgets } from '../db/schema/index.js';
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
// ---------------------------------------------------------------------------

export async function upsertAggregates(request: LlmRequest): Promise<void> {
  const isError = request.status !== 'success' && request.status !== 'partial';
  const costCents = request.costWithMarginCents;
  const costRaw   = parseFloat(String(request.costRaw));
  const costMargin = parseFloat(String(request.costWithMargin));

  const dimensions: Array<{
    entityType: string;
    entityId:   string;
    periodType: string;
    periodKey:  string;
  }> = [];

  // Organisation
  dimensions.push({ entityType: 'organisation', entityId: request.organisationId, periodType: 'monthly', periodKey: request.billingMonth });
  dimensions.push({ entityType: 'organisation', entityId: request.organisationId, periodType: 'daily',   periodKey: request.billingDay });

  // Subaccount
  if (request.subaccountId) {
    dimensions.push({ entityType: 'subaccount', entityId: request.subaccountId, periodType: 'monthly', periodKey: request.billingMonth });
    dimensions.push({ entityType: 'subaccount', entityId: request.subaccountId, periodType: 'daily',   periodKey: request.billingDay });
  }

  // Run (lifetime aggregate)
  if (request.runId) {
    dimensions.push({ entityType: 'run', entityId: request.runId, periodType: 'run', periodKey: request.runId });
  }

  // Agent (monthly)
  if (request.agentName) {
    const agentKey = request.subaccountId
      ? `${request.subaccountId}:${request.agentName}`
      : request.agentName;
    dimensions.push({ entityType: 'agent', entityId: agentKey, periodType: 'monthly', periodKey: request.billingMonth });
  }

  // Task type (monthly, org-scoped)
  dimensions.push({
    entityType: 'task_type',
    entityId:   `${request.organisationId}:${request.taskType}`,
    periodType: 'monthly',
    periodKey:  request.billingMonth,
  });

  // Provider (monthly — enables per-provider spend dashboard)
  dimensions.push({ entityType: 'provider', entityId: request.provider, periodType: 'monthly', periodKey: request.billingMonth });

  // Platform-level (monthly)
  dimensions.push({ entityType: 'platform', entityId: 'global', periodType: 'monthly', periodKey: request.billingMonth });

  // Execution phase (monthly — enables cost-per-phase analytics)
  if (request.executionPhase) {
    dimensions.push({
      entityType: 'execution_phase',
      entityId:   `${request.organisationId}:${request.executionPhase}`,
      periodType: 'monthly',
      periodKey:  request.billingMonth,
    });
  }

  // Rate-limit windows (minute + hour) — only for subaccount
  if (request.subaccountId) {
    // minute key: 'YYYY-MM-DDTHH:mm'
    const minuteKey = request.createdAt.toISOString().slice(0, 16);
    // hour key: 'YYYY-MM-DDTHH'
    const hourKey = request.createdAt.toISOString().slice(0, 13);
    dimensions.push({ entityType: 'subaccount', entityId: request.subaccountId, periodType: 'minute', periodKey: minuteKey });
    dimensions.push({ entityType: 'subaccount', entityId: request.subaccountId, periodType: 'hour',   periodKey: hourKey });
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
    .from(orgBudgets)
    .where(eq(orgBudgets.organisationId, organisationId));

  if (orgBudget?.monthlyCostLimitCents && orgBudget.monthlyCostLimitCents > 0) {
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
    const pct = Math.floor((spendCents / orgBudget.monthlyCostLimitCents) * 100);
    const threshold = orgBudget.alertThresholdPct ?? 80;

    if (pct >= threshold) {
      alerts.push({ type: 'org_monthly', entityId: organisationId, pct, limitCents: orgBudget.monthlyCostLimitCents, spendCents });
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
