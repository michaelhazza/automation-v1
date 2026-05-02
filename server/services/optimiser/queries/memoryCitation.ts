/**
 * memoryCitation.ts — Optimiser telemetry query (Chunk 2)
 *
 * Reads memory_citation_scores to compute per-agent low-citation rates and
 * projected token waste over 7 days.
 *
 * A "low-citation" injection is one where cited=false (final_score below the
 * threshold). Low-citation rate = low_count / total_injected.
 * Projected token savings = low_count * avg_tokens_per_injection (estimate
 * based on typical memory entry sizes; we use a conservative 200 tokens).
 *
 * Query cost guardrail: WHERE memory_citation_scores.created_at >= now() - interval '7 days'.
 * Called by the evaluator in Chunk 3; this module returns raw data only.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../../../lib/adminDbConnection.js';
import { logger } from '../../../lib/logger.js';

export interface MemoryCitationRow {
  agent_id: string;
  low_citation_pct: number;     // ratio 0..1, 4 decimal places
  total_injected: number;       // integer
  projected_token_savings: number; // integer tokens
}

const SOURCE = 'optimiser.memoryCitation';

/** Conservative estimate of tokens per injected memory entry. */
const TOKENS_PER_ENTRY_ESTIMATE = 200;

export async function queryMemoryCitation(input: {
  subaccountId: string;
  organisationId: string;
}): Promise<MemoryCitationRow[]> {
  const { subaccountId, organisationId } = input;

  try {
    return await withAdminConnection(
      { source: SOURCE, reason: 'optimiser scan: memory citation', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        const result = await tx.execute(sql`
          SELECT
            ar.agent_id::text                      AS agent_id,
            COUNT(*)::int                          AS total_injected,
            -- cited=false is the schema encoding for final_score < threshold in memory_citation_scores
            SUM(CASE WHEN mcs.cited = false THEN 1 ELSE 0 END)::int AS low_count,
            ROUND(
              SUM(CASE WHEN mcs.cited = false THEN 1 ELSE 0 END)::numeric
              / GREATEST(COUNT(*), 1)::numeric,
              4
            )::float                               AS low_citation_pct
          FROM memory_citation_scores mcs
          JOIN agent_runs ar ON ar.id = mcs.run_id
          WHERE ar.subaccount_id = ${subaccountId}
            AND ar.organisation_id = ${organisationId}
            AND mcs.created_at >= now() - INTERVAL '7 days'
          GROUP BY ar.agent_id
          HAVING COUNT(*) > 0
        `);

        return (result as unknown as Array<Record<string, unknown>>).map((row) => {
          const totalInjected = Number(row.total_injected) || 0;
          const lowCount = Number(row.low_count) || 0;
          const lowCitationPct = Number(Number(row.low_citation_pct).toFixed(4)) || 0;
          return {
            agent_id: String(row.agent_id),
            low_citation_pct: lowCitationPct,
            total_injected: totalInjected,
            projected_token_savings: lowCount * TOKENS_PER_ENTRY_ESTIMATE,
          };
        });
      },
    );
  } catch (err) {
    logger.error(`${SOURCE}.failed`, {
      subaccountId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw Object.assign(new Error('optimiser query failed'), {
      statusCode: 500,
      errorCode: 'memory_citation_failed',
    });
  }
}
