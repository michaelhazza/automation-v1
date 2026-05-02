/**
 * escalationRate.ts — Optimiser telemetry query (Chunk 2)
 *
 * Joins flow_runs + flow_step_outputs + review_items to compute per-workflow
 * escalation rates over 7 days. Returns the modal (most-common) step_id that
 * escalated across runs.
 *
 * Query cost guardrail: WHERE flow_runs.started_at >= now() - interval '7 days'.
 * Called by the evaluator in Chunk 3; this module returns raw data only.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../../../lib/adminDbConnection.js';
import { logger } from '../../../lib/logger.js';

export interface EscalationRateRow {
  workflow_id: string;       // workflowDefinition->>'id' from flow_runs
  run_count: number;         // integer: total runs in window
  escalation_count: number;  // integer: runs with >= 1 escalated review item
  common_step_id: string;    // modal step_id of escalating runs
}

const SOURCE = 'optimiser.escalationRate';

export async function queryEscalationRate(input: {
  subaccountId: string;
  organisationId: string;
}): Promise<EscalationRateRow[]> {
  const { subaccountId, organisationId } = input;

  try {
    return await withAdminConnection(
      { source: SOURCE, reason: 'optimiser scan: escalation rate', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        const result = await tx.execute(sql`
          WITH recent_runs AS (
            SELECT
              fr.id            AS run_id,
              fr.workflow_name AS workflow_name,
              fr.workflow_definition->>'id' AS workflow_id
            FROM flow_runs fr
            WHERE fr.subaccount_id = ${subaccountId}
              AND fr.organisation_id = ${organisationId}
              AND fr.started_at >= now() - INTERVAL '7 days'
          ),
          escalation_flags AS (
            -- a run is "escalated" if any of its step outputs have a
            -- review_item that is still pending review
            SELECT DISTINCT
              fso.flow_run_id AS run_id,
              fso.step_id
            FROM flow_step_outputs fso
            JOIN review_items ri ON ri.agent_run_id = fso.agent_run_id
            JOIN recent_runs rr ON rr.run_id = fso.flow_run_id
            WHERE ri.review_status = 'pending'
              AND ri.created_at >= now() - INTERVAL '7 days'
          ),
          run_escalation AS (
            SELECT
              rr.run_id,
              rr.workflow_id,
              CASE WHEN ef.run_id IS NOT NULL THEN 1 ELSE 0 END AS is_escalated
            FROM recent_runs rr
            LEFT JOIN (
              SELECT DISTINCT run_id FROM escalation_flags
            ) ef ON ef.run_id = rr.run_id
          ),
          step_mode AS (
            SELECT
              rr.workflow_id,
              ef.step_id,
              COUNT(*) AS step_count,
              ROW_NUMBER() OVER (
                PARTITION BY rr.workflow_id ORDER BY COUNT(*) DESC, ef.step_id ASC
              ) AS rn
            FROM escalation_flags ef
            JOIN recent_runs rr ON rr.run_id = ef.run_id
            GROUP BY rr.workflow_id, ef.step_id
          )
          SELECT
            re.workflow_id,
            COUNT(*)::int                                AS run_count,
            SUM(re.is_escalated)::int                   AS escalation_count,
            COALESCE(sm.step_id, 'unknown')             AS common_step_id
          FROM run_escalation re
          LEFT JOIN step_mode sm
            ON sm.workflow_id = re.workflow_id AND sm.rn = 1
          GROUP BY re.workflow_id, sm.step_id
          HAVING COUNT(*) > 0
        `);

        return (result as unknown as Array<Record<string, unknown>>).map((row) => ({
          workflow_id: String(row.workflow_id || ''),
          run_count: Number(row.run_count) || 0,
          escalation_count: Number(row.escalation_count) || 0,
          common_step_id: String(row.common_step_id || 'unknown'),
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
      errorCode: 'escalation_rate_failed',
    });
  }
}
