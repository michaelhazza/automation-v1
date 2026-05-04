// ---------------------------------------------------------------------------
// Query module: optimiser.memory.low_citation_waste
//
// Computes average citation score per agent across agent runs in the window.
// A low average score indicates memory blocks are injected but rarely cited.
//
// Join: memory_citation_scores → agent_runs (for subaccount_id and started_at)
//
// Authoritative timestamp: agent_runs.started_at
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import type { QueryModule, QueryRow } from './types.js';

export interface MemoryCitationEvidence {
  agentId: string;
  avgCitationScore: number;
  totalCitations: number;
  median_version: 0;
}

const CATEGORY = 'optimiser.memory.low_citation_waste';

export const module: QueryModule<MemoryCitationEvidence> = {
  category: CATEGORY,
  authoritativeTimestampColumn: 'agent_runs.started_at',
  readReplicaSafe: true,

  async run(tx, subaccountId): Promise<QueryRow<MemoryCitationEvidence>[]> {
    await tx.execute(sql`SET LOCAL statement_timeout = '10000'`);

    const rows = await tx.execute<{
      agent_id: string;
      avg_citation_score: string;
      total_citations: string;
      max_started_at: string | null;
    }>(sql`
      SELECT
        ar.agent_id::text                                    AS agent_id,
        COALESCE(AVG(mcs.final_score), 0)::text             AS avg_citation_score,
        COALESCE(COUNT(mcs.entry_id), 0)::text              AS total_citations,
        MAX(ar.started_at)::text                            AS max_started_at
      FROM agent_runs ar
      JOIN memory_citation_scores mcs ON mcs.run_id = ar.id
      WHERE ar.subaccount_id = ${subaccountId}::uuid
        AND ar.started_at >= now() - interval '7 days'
        AND ar.is_test_run = false
      GROUP BY ar.agent_id
      HAVING COALESCE(COUNT(mcs.entry_id), 0) > 0
    `);

    const now = new Date();

    return rows.map((row): QueryRow<MemoryCitationEvidence> => {
      const avgScore = Number(row.avg_citation_score);
      const total = Number(row.total_citations);

      return {
        subaccountId,
        metricKey: row.agent_id,
        metricValue: Number(avgScore.toFixed(4)),
        computedAt: row.max_started_at ? new Date(row.max_started_at) : now,
        evidence: {
          agentId: row.agent_id,
          avgCitationScore: Number(avgScore.toFixed(4)),
          totalCitations: Math.round(total),
          median_version: 0,
        },
      };
    });
  },
};
