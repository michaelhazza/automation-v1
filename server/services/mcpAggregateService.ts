import { db } from '../db/index.js';
import { costAggregates } from '../db/schema/index.js';
import { sql } from 'drizzle-orm';
import type { NewMcpToolInvocation } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// MCP aggregate upsert — called fire-and-forget after each mcp_tool_invocations write
//
// Reuses cost_aggregates table with four MCP-specific entityTypes:
//   mcp_org         — org-level monthly + daily call count
//   mcp_subaccount  — subaccount-level monthly + daily call count (if subaccountId present)
//   mcp_run         — per-run lifetime call count (always written, including test runs)
//   mcp_server      — per-server monthly call count, keyed as "orgId:serverSlug"
//
// LLM cost/token columns are set to 0; only requestCount and errorCount carry signal.
// requestCount = total invocation attempts, including retries and budget_blocked policy exits.
// errorCount   = transport failures only (status IN ('error', 'timeout')); budget_blocked excluded.
// Aggregates every invocation row including retries — no deduplication.
// ---------------------------------------------------------------------------

export async function upsertMcpAggregates(row: NewMcpToolInvocation): Promise<void> {
  // budget_blocked is a policy exit, not an infra failure — only error/timeout count as errors
  const isError = row.status === 'error' || row.status === 'timeout';

  type Dimension = { entityType: string; entityId: string; periodType: string; periodKey: string };
  const dimensions: Dimension[] = [];

  if (!row.isTestRun) {
    // Org (monthly + daily) — mirrors LLM aggregate pattern
    dimensions.push({
      entityType: 'mcp_org',
      entityId: row.organisationId,
      periodType: 'monthly',
      periodKey: row.billingMonth,
    });
    dimensions.push({
      entityType: 'mcp_org',
      entityId: row.organisationId,
      periodType: 'daily',
      periodKey: row.billingDay,
    });

    // Subaccount (monthly + daily)
    if (row.subaccountId) {
      dimensions.push({
        entityType: 'mcp_subaccount',
        entityId: row.subaccountId,
        periodType: 'monthly',
        periodKey: row.billingMonth,
      });
      dimensions.push({
        entityType: 'mcp_subaccount',
        entityId: row.subaccountId,
        periodType: 'daily',
        periodKey: row.billingDay,
      });
    }
  }

  // Run lifetime aggregate — always written, even for test runs
  if (row.runId) {
    dimensions.push({
      entityType: 'mcp_run',
      entityId: row.runId,
      periodType: 'run',
      periodKey: row.runId,
    });
  }

  // Per-server monthly (org-scoped) — skip for test runs to keep P&L clean
  if (!row.isTestRun) {
    dimensions.push({
      entityType: 'mcp_server',
      entityId: `${row.organisationId}:${row.serverSlug}`,
      periodType: 'monthly',
      periodKey: row.billingMonth,
    });
  }

  await Promise.all(
    dimensions.map((dim) =>
      db
        .insert(costAggregates)
        .values({
          entityType: dim.entityType,
          entityId: dim.entityId,
          periodType: dim.periodType,
          periodKey: dim.periodKey,
          totalCostRaw: '0',
          totalCostWithMargin: '0',
          totalCostCents: 0,
          totalTokensIn: 0,
          totalTokensOut: 0,
          requestCount: 1,
          errorCount: isError ? 1 : 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            costAggregates.entityType,
            costAggregates.entityId,
            costAggregates.periodType,
            costAggregates.periodKey,
          ],
          set: {
            requestCount: sql`${costAggregates.requestCount} + 1`,
            errorCount: isError
              ? sql`${costAggregates.errorCount} + 1`
              : costAggregates.errorCount,
            updatedAt: new Date(),
          },
        }),
    ),
  );
}

export const mcpAggregateService = {
  upsertMcpAggregates,
};
