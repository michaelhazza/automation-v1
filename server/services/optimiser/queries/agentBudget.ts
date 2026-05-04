// ---------------------------------------------------------------------------
// Query module: agent.over_budget
//
// Aggregates monthly spend per agent within a subaccount, joining cost_aggregates
// (entity_type='agent', period_type='monthly') to subaccount_agents to
// resolve agent names and the current month's budget cap.
//
// Authoritative timestamp: cost_aggregates.updated_at
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import type { QueryModule, QueryRow } from './types.js';

export interface AgentBudgetEvidence {
  agentId: string;
  agentName: string;
  thisMonthSpendUsd: number;
  budgetLimitUsd: number;
  percentUsed: number;
  median_version: 0;
}

const CATEGORY = 'optimiser.agent.over_budget';

export const module: QueryModule<AgentBudgetEvidence> = {
  category: CATEGORY,
  authoritativeTimestampColumn: 'cost_aggregates.updated_at',
  readReplicaSafe: true,

  async run(tx, subaccountId): Promise<QueryRow<AgentBudgetEvidence>[]> {
    await tx.execute(sql`SET LOCAL statement_timeout = '10000'`);

    const rows = await tx.execute<{
      agent_id: string;
      agent_name: string;
      total_cost_cents: string;
      max_cost_per_run_cents: string | null;
      updated_at: string;
    }>(sql`
      SELECT
        a.id                                              AS agent_id,
        a.name                                            AS agent_name,
        COALESCE(SUM(ca.total_cost_cents), 0)::text       AS total_cost_cents,
        MAX(sa.max_cost_per_run_cents)::text              AS max_cost_per_run_cents,
        MAX(ca.updated_at)::text                          AS updated_at
      FROM subaccount_agents sa
      JOIN agents a ON a.id = sa.agent_id
      LEFT JOIN cost_aggregates ca
        ON ca.entity_type = 'agent'
        AND ca.entity_id = a.id::text
        AND ca.period_type = 'monthly'
        AND ca.updated_at >= now() - interval '7 days'
      WHERE sa.subaccount_id = ${subaccountId}::uuid
        AND sa.is_active = true
      GROUP BY a.id, a.name
      HAVING COALESCE(SUM(ca.total_cost_cents), 0) > 0
    `);

    const now = new Date();

    return rows
      .filter((row) => {
        const limit = Number(row.max_cost_per_run_cents ?? 0);
        // Only emit rows where there is a budget limit set
        return limit > 0;
      })
      .map((row): QueryRow<AgentBudgetEvidence> => {
        const spendCents = Number(row.total_cost_cents);
        const limitCents = Number(row.max_cost_per_run_cents ?? 0);
        const spendUsd = spendCents / 100;
        const limitUsd = limitCents / 100;
        const percentUsed = limitCents > 0 ? spendCents / limitCents : 0;

        return {
          subaccountId,
          metricKey: row.agent_id,
          metricValue: spendCents,
          computedAt: row.updated_at ? new Date(row.updated_at) : now,
          evidence: {
            agentId: row.agent_id,
            agentName: row.agent_name,
            thisMonthSpendUsd: spendUsd,
            budgetLimitUsd: limitUsd,
            percentUsed: Number(percentUsed.toFixed(4)),
            median_version: 0,
          },
        };
      });
  },
};
