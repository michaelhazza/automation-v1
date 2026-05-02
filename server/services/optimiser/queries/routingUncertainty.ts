/**
 * routingUncertainty.ts — Optimiser telemetry query (Chunk 2)
 *
 * Reads fast_path_decisions to compute per-agent low-confidence routing
 * decisions and second-look trigger rates. total_decisions is the raw row
 * count (required by materialDelta volume floor in spec §2).
 *
 * Query cost guardrail: WHERE fast_path_decisions.decided_at >= now() - interval '7 days'.
 * Called by the evaluator in Chunk 3; this module returns raw data only.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../../../lib/adminDbConnection.js';
import { logger } from '../../../lib/logger.js';

export interface RoutingUncertaintyRow {
  agent_id: string;
  low_confidence_pct: number;   // ratio 0..1, 4 decimal places
  second_look_pct: number;      // ratio 0..1, 4 decimal places
  total_decisions: number;      // integer — raw row count
}

const SOURCE = 'optimiser.routingUncertainty';

/** Confidence threshold below which a decision is considered "low confidence". */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

export async function queryRoutingUncertainty(input: {
  subaccountId: string;
  organisationId: string;
}): Promise<RoutingUncertaintyRow[]> {
  const { subaccountId, organisationId } = input;

  try {
    return await withAdminConnection(
      { source: SOURCE, reason: 'optimiser scan: routing uncertainty', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        // fast_path_decisions carries subaccount_id and organisation_id but
        // not agent_id directly. We join via subaccount_agents to attribute
        // decisions to the active agents in this sub-account.
        const result2 = await tx.execute(sql`
          SELECT
            sa.agent_id::text                                        AS agent_id,
            COUNT(fpd.id)::int                                        AS total_decisions,
            ROUND(
              SUM(CASE WHEN fpd.decided_confidence < ${LOW_CONFIDENCE_THRESHOLD}
                       THEN 1 ELSE 0 END)::numeric
              / GREATEST(COUNT(fpd.id), 1)::numeric,
              4
            )::float                                                  AS low_confidence_pct,
            ROUND(
              SUM(CASE WHEN fpd.second_look_triggered = true
                       THEN 1 ELSE 0 END)::numeric
              / GREATEST(COUNT(fpd.id), 1)::numeric,
              4
            )::float                                                  AS second_look_pct
          FROM fast_path_decisions fpd
          JOIN subaccount_agents sa
            ON sa.subaccount_id = fpd.subaccount_id
            AND sa.is_active = true
          WHERE fpd.subaccount_id = ${subaccountId}
            AND fpd.organisation_id = ${organisationId}
            AND fpd.decided_at >= now() - INTERVAL '7 days'
          GROUP BY sa.agent_id
          HAVING COUNT(fpd.id) > 0
        `);

        return (result2 as unknown as Array<Record<string, unknown>>).map((row) => ({
          agent_id: String(row.agent_id),
          low_confidence_pct: Number(Number(row.low_confidence_pct).toFixed(4)) || 0,
          second_look_pct: Number(Number(row.second_look_pct).toFixed(4)) || 0,
          total_decisions: Number(row.total_decisions) || 0,
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
      errorCode: 'routing_uncertainty_failed',
    });
  }
}
