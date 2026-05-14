// ---------------------------------------------------------------------------
// Query module: optimiser.inactive.workflow
//
// Detects subaccount agents that haven't run within their expected cadence.
// Row-fetch pattern — limited to 100 rows (bounded by plan).
//
// Authoritative timestamp: agent_runs.started_at (most recent run)
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import type { QueryModule, QueryRow } from './types.js';

export interface InactiveWorkflowEvidence {
  subaccountAgentId: string;
  agentId: string;
  agentName: string;
  lastRunAt: string | null;
  daysSinceLastRun: number;
  median_version: 0;
}

const CATEGORY = 'optimiser.inactive.workflow';

export const module: QueryModule<InactiveWorkflowEvidence> = {
  category: CATEGORY,
  authoritativeTimestampColumn: 'agent_runs.started_at',
  readReplicaSafe: true,

  async run(tx, subaccountId): Promise<QueryRow<InactiveWorkflowEvidence>[]> {
    await tx.execute(sql`SET LOCAL statement_timeout = '10000'`);

    const rows = await tx.execute<{
      subaccount_agent_id: string;
      agent_id: string;
      agent_name: string;
      last_run_at: string | null;
      days_since_last_run: string;
    }>(sql`
      SELECT
        sa.id                                                           AS subaccount_agent_id,
        a.id                                                            AS agent_id,
        a.name                                                          AS agent_name,
        MAX(ar.started_at)::text                                        AS last_run_at,
        COALESCE(
          EXTRACT(epoch FROM (now() - MAX(ar.started_at))) / 86400,
          999
        )::text                                                         AS days_since_last_run
      FROM subaccount_agents sa
      JOIN agents a ON a.id = sa.agent_id
      LEFT JOIN agent_runs ar
        ON ar.subaccount_agent_id = sa.id
        AND ar.started_at >= now() - interval '7 days'
        AND ar.is_test_run = false
      WHERE sa.subaccount_id = ${subaccountId}::uuid
        AND sa.is_active = true
        AND sa.schedule_enabled = true
      GROUP BY sa.id, a.id, a.name
      ORDER BY days_since_last_run DESC
      LIMIT 100
    `);

    const now = new Date();

    return rows.map((row): QueryRow<InactiveWorkflowEvidence> => {
      const days = Number(row.days_since_last_run);

      return {
        subaccountId,
        metricKey: row.subaccount_agent_id,
        metricValue: days,
        computedAt: now,
        evidence: {
          subaccountAgentId: row.subaccount_agent_id,
          agentId: row.agent_id,
          agentName: row.agent_name,
          lastRunAt: row.last_run_at ?? null,
          daysSinceLastRun: Math.round(days),
          median_version: 0,
        },
      };
    });
  },
};
