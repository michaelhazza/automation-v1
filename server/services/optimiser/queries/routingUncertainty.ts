// ---------------------------------------------------------------------------
// Query module: optimiser.agent.routing_uncertainty
//
// Computes the routing uncertainty rate per agent in the subaccount.
// Uncertainty = decidedConfidence < 0.5 OR secondLookTriggered = true.
//
// fast_path_decisions does not store agent_id directly. We resolve it via
// fast_path_decisions.briefId → tasks.assignedAgentId (the assigned agent
// for the brief/task).
//
// Authoritative timestamp: fast_path_decisions.decided_at
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import type { QueryModule, QueryRow } from './types.js';

export interface RoutingUncertaintyEvidence {
  agentId: string;
  uncertainDecisions: number;
  totalDecisions: number;
  uncertaintyRate: number;
  median_version: 0;
}

const CATEGORY = 'optimiser.agent.routing_uncertainty';

// Confidence threshold below which a decision is considered uncertain
const UNCERTAINTY_CONFIDENCE_THRESHOLD = '0.5';

export const module: QueryModule<RoutingUncertaintyEvidence> = {
  category: CATEGORY,
  authoritativeTimestampColumn: 'fast_path_decisions.decided_at',
  readReplicaSafe: true,

  async run(tx, subaccountId): Promise<QueryRow<RoutingUncertaintyEvidence>[]> {
    await tx.execute(sql`SET LOCAL statement_timeout = '10000'`);

    const rows = await tx.execute<{
      agent_id: string;
      uncertain_decisions: string;
      total_decisions: string;
      max_decided_at: string | null;
    }>(sql`
      SELECT
        t.assigned_agent_id::text                                           AS agent_id,
        COALESCE(
          COUNT(*) FILTER (
            WHERE fpd.decided_confidence < ${UNCERTAINTY_CONFIDENCE_THRESHOLD}::numeric
              OR fpd.second_look_triggered = true
          ), 0
        )::text                                                             AS uncertain_decisions,
        COALESCE(COUNT(*), 0)::text                                         AS total_decisions,
        MAX(fpd.decided_at)::text                                           AS max_decided_at
      FROM fast_path_decisions fpd
      JOIN tasks t ON t.id = fpd.brief_id
      WHERE fpd.subaccount_id = ${subaccountId}::uuid
        AND fpd.decided_at >= now() - interval '7 days'
        AND t.assigned_agent_id IS NOT NULL
      GROUP BY t.assigned_agent_id
      HAVING COALESCE(COUNT(*), 0) > 0
    `);

    const now = new Date();

    return rows.map((row): QueryRow<RoutingUncertaintyEvidence> => {
      const uncertain = Number(row.uncertain_decisions);
      const total = Number(row.total_decisions);
      const rate = total > 0 ? uncertain / total : 0;

      return {
        subaccountId,
        metricKey: row.agent_id,
        metricValue: Number(rate.toFixed(4)),
        computedAt: row.max_decided_at ? new Date(row.max_decided_at) : now,
        evidence: {
          agentId: row.agent_id,
          uncertainDecisions: Math.round(uncertain),
          totalDecisions: Math.round(total),
          uncertaintyRate: Number(rate.toFixed(4)),
          median_version: 0,
        },
      };
    });
  },
};
