// ---------------------------------------------------------------------------
// Query module: optimiser.llm.cache_poor_reuse
//
// Computes cache hit rate per agent from llm_requests within the 7-day window.
// A cache hit is when cached_prompt_tokens > 0.
//
// Authoritative timestamp: llm_requests.created_at
// ---------------------------------------------------------------------------

import { sql } from 'drizzle-orm';
import type { QueryModule, QueryRow } from './types.js';

export interface CacheEfficiencyEvidence {
  agentId: string;
  cacheHits: number;
  totalRequests: number;
  cacheHitRate: number;
  median_version: 0;
}

const CATEGORY = 'optimiser.llm.cache_poor_reuse';

export const module: QueryModule<CacheEfficiencyEvidence> = {
  category: CATEGORY,
  authoritativeTimestampColumn: 'llm_requests.created_at',
  readReplicaSafe: true,

  async run(tx, subaccountId): Promise<QueryRow<CacheEfficiencyEvidence>[]> {
    await tx.execute(sql`SET LOCAL statement_timeout = '10000'`);

    const rows = await tx.execute<{
      agent_id: string;
      cache_hits: string;
      total_requests: string;
      max_created_at: string | null;
    }>(sql`
      SELECT
        ar.agent_id::text                                           AS agent_id,
        COALESCE(
          COUNT(*) FILTER (WHERE lr.cached_prompt_tokens > 0),
          0
        )::text                                                     AS cache_hits,
        COALESCE(COUNT(lr.id), 0)::text                            AS total_requests,
        MAX(lr.created_at)::text                                   AS max_created_at
      FROM llm_requests lr
      JOIN agent_runs ar ON ar.id = lr.run_id
      WHERE lr.subaccount_id = ${subaccountId}::uuid
        AND lr.created_at >= now() - interval '7 days'
        AND lr.source_type = 'agent_run'
        AND ar.is_test_run = false
      GROUP BY ar.agent_id
      HAVING COALESCE(COUNT(lr.id), 0) > 0
    `);

    const now = new Date();

    return rows.map((row): QueryRow<CacheEfficiencyEvidence> => {
      const hits = Number(row.cache_hits);
      const total = Number(row.total_requests);
      const rate = total > 0 ? hits / total : 0;

      return {
        subaccountId,
        metricKey: row.agent_id,
        metricValue: Number(rate.toFixed(4)),
        computedAt: row.max_created_at ? new Date(row.max_created_at) : now,
        evidence: {
          agentId: row.agent_id,
          cacheHits: Math.round(hits),
          totalRequests: Math.round(total),
          cacheHitRate: Number(rate.toFixed(4)),
          median_version: 0,
        },
      };
    });
  },
};
