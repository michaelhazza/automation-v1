// ---------------------------------------------------------------------------
// Query module: optimiser.playbook.escalation_rate
//
// Computes escalation rate per workflow in the subaccount.
// An escalated run is one whose flow_step_outputs contain at least one step
// with status='completed' and an output that triggers a review_item
// (via agentRunId reference).
//
// Simpler approach: count flow_runs that have an associated review_item
// (any escalation action written during the run) vs total flow_runs.
//
// Authoritative timestamp: flow_runs.created_at
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import type { QueryModule, QueryRow } from './types.js';

export interface EscalationRateEvidence {
  workflowId: string;
  escalationCount: number;
  totalCount: number;
  escalationRate: number;
  median_version: 0;
}

const CATEGORY = 'optimiser.playbook.escalation_rate';

export const module: QueryModule<EscalationRateEvidence> = {
  category: CATEGORY,
  authoritativeTimestampColumn: 'flow_runs.created_at',
  readReplicaSafe: true,

  async run(tx, subaccountId): Promise<QueryRow<EscalationRateEvidence>[]> {
    await tx.execute(sql`SET LOCAL statement_timeout = '10000'`);

    const rows = await tx.execute<{
      workflow_name: string;
      total_count: string;
      escalation_count: string;
      max_created_at: string;
    }>(sql`
      SELECT
        fr.workflow_name,
        COUNT(DISTINCT fr.id)::text                                     AS total_count,
        COUNT(DISTINCT ri.agent_run_id)::text                           AS escalation_count,
        MAX(fr.created_at)::text                                        AS max_created_at
      FROM flow_runs fr
      LEFT JOIN flow_step_outputs fso ON fso.flow_run_id = fr.id
      LEFT JOIN review_items ri ON ri.agent_run_id = fso.agent_run_id
      WHERE fr.subaccount_id = ${subaccountId}::uuid
        AND fr.created_at >= now() - interval '7 days'
      GROUP BY fr.workflow_name
      HAVING COUNT(DISTINCT fr.id) > 0
    `);

    const now = new Date();

    return rows.map((row): QueryRow<EscalationRateEvidence> => {
      const total = Number(row.total_count);
      const escalated = Number(row.escalation_count);
      const rate = total > 0 ? escalated / total : 0;

      return {
        subaccountId,
        metricKey: row.workflow_name,
        metricValue: Number(rate.toFixed(4)),
        computedAt: row.max_created_at ? new Date(row.max_created_at) : now,
        evidence: {
          workflowId: row.workflow_name,
          escalationCount: escalated,
          totalCount: total,
          escalationRate: Number(rate.toFixed(4)),
          median_version: 0,
        },
      };
    });
  },
};
