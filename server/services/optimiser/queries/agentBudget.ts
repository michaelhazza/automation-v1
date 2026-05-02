/**
 * agentBudget.ts — Optimiser telemetry query (Chunk 2)
 *
 * Reads cost_aggregates for a sub-account's agents and returns per-agent
 * this-month / last-month / budget rows. The budget field is the agent's
 * configured monthly budget from org_agent_configs; top_cost_driver is the
 * skill slug that generated the most cost in the current month (or 'unknown').
 *
 * Query cost guardrail: filters to current + prior month only (no full-table scan).
 * Called by the evaluator in Chunk 3; this module returns raw data only.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../../../lib/adminDbConnection.js';
import { logger } from '../../../lib/logger.js';

export interface AgentBudgetRow {
  agent_id: string;
  this_month: number;       // integer cents
  last_month: number;       // integer cents
  budget: number;           // integer cents — from org_agent_configs.monthly_budget_cents, 0 if unset
  top_cost_driver: string;  // skill_slug or 'unknown'
}

const SOURCE = 'optimiser.agentBudget';

export async function queryAgentBudget(input: {
  subaccountId: string;
  organisationId: string;
}): Promise<AgentBudgetRow[]> {
  const { subaccountId, organisationId } = input;

  try {
    return await withAdminConnection(
      { source: SOURCE, reason: 'optimiser scan: agent budget', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        // Current and prior month keys for the guardrail filter
        const result = await tx.execute(sql`
          WITH month_keys AS (
            SELECT
              to_char(now(), 'YYYY-MM')                           AS this_month_key,
              to_char(now() - INTERVAL '1 month', 'YYYY-MM')     AS last_month_key
          ),
          agent_ids AS (
            SELECT DISTINCT a.id AS agent_id
            FROM agents a
            JOIN subaccount_agents sa ON sa.agent_id = a.id
            WHERE sa.subaccount_id = ${subaccountId}
              AND sa.is_active = true
          ),
          budget_rows AS (
            SELECT
              ca.entity_id                                              AS agent_id,
              SUM(CASE WHEN ca.period_key = mk.this_month_key
                       THEN ca.total_cost_cents ELSE 0 END)            AS this_month,
              SUM(CASE WHEN ca.period_key = mk.last_month_key
                       THEN ca.total_cost_cents ELSE 0 END)            AS last_month
            FROM cost_aggregates ca
            CROSS JOIN month_keys mk
            JOIN agent_ids ai ON ca.entity_id = ai.agent_id::text
            WHERE ca.entity_type = 'agent'
              AND ca.period_type = 'monthly'
              AND ca.period_key >= mk.last_month_key
            GROUP BY ca.entity_id
          ),
          -- top cost-driver per agent per current month: skill feature_tag with max cost
          skill_cost AS (
            SELECT
              lr.run_id,
              lr.feature_tag,
              SUM(lr.cost_with_margin_cents) AS cost_cents
            FROM llm_requests lr
            JOIN agent_runs ar ON ar.id = lr.run_id
            JOIN agent_ids ai ON ar.agent_id = ai.agent_id
            WHERE lr.organisation_id = ${organisationId}
              AND lr.created_at >= date_trunc('month', now())
            GROUP BY lr.run_id, lr.feature_tag
          ),
          top_driver AS (
            SELECT
              ar.agent_id::text AS agent_id,
              sc.feature_tag,
              ROW_NUMBER() OVER (PARTITION BY ar.agent_id ORDER BY SUM(sc.cost_cents) DESC) AS rn
            FROM skill_cost sc
            JOIN agent_runs ar ON ar.id = sc.run_id
            GROUP BY ar.agent_id, sc.feature_tag
          ),
          agent_budget AS (
            SELECT
              oac.agent_id::text,
              COALESCE(oac.monthly_budget_cents, 0) AS budget_cents
            FROM org_agent_configs oac
            WHERE oac.organisation_id = ${organisationId}
          )
          SELECT
            br.agent_id,
            br.this_month::int     AS this_month,
            br.last_month::int     AS last_month,
            COALESCE(ab.budget_cents, 0)::int AS budget,
            COALESCE(td.feature_tag, 'unknown') AS top_cost_driver
          FROM budget_rows br
          LEFT JOIN agent_budget ab ON ab.agent_id = br.agent_id
          LEFT JOIN top_driver td ON td.agent_id = br.agent_id AND td.rn = 1
          WHERE br.this_month > 0 OR br.last_month > 0
        `);

        return (result as unknown as AgentBudgetRow[]).map((row) => ({
          agent_id: String(row.agent_id),
          this_month: Number(row.this_month) || 0,
          last_month: Number(row.last_month) || 0,
          budget: Number(row.budget) || 0,
          top_cost_driver: String(row.top_cost_driver || 'unknown'),
        }));
      },
    );
  } catch (err) {
    logger.error(`${SOURCE}.failed`, {
      subaccountId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw Object.assign(new Error('optimiser query failed'), {
      statusCode: 500,
      errorCode: 'agent_budget_failed',
    });
  }
}
