/**
 * cacheEfficiency.ts — Optimiser telemetry query (Chunk 2)
 *
 * Reads llm_requests cache columns to compute per-agent LLM prompt cache
 * efficiency over 7 days. Returns the dominant skill (feature_tag with highest
 * total token cost) for context in the recommendation.
 *
 * Query cost guardrail: WHERE llm_requests.created_at >= now() - interval '7 days'.
 * Called by the evaluator in Chunk 3; this module returns raw data only.
 */

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../../../lib/adminDbConnection.js';
import { logger } from '../../../lib/logger.js';

export interface CacheEfficiencyRow {
  agent_id: string;
  creation_tokens: number;   // integer — cache_creation_tokens sum
  reused_tokens: number;     // integer — cached_prompt_tokens sum
  dominant_skill: string;    // feature_tag with highest total cost in window
}

const SOURCE = 'optimiser.cacheEfficiency';

export async function queryCacheEfficiency(input: {
  subaccountId: string;
  organisationId: string;
}): Promise<CacheEfficiencyRow[]> {
  const { subaccountId, organisationId } = input;

  try {
    return await withAdminConnection(
      { source: SOURCE, reason: 'optimiser scan: cache efficiency', skipAudit: true },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);

        const result = await tx.execute(sql`
          WITH agent_requests AS (
            SELECT
              ar.agent_id::text        AS agent_id,
              lr.feature_tag,
              lr.cache_creation_tokens,
              lr.cached_prompt_tokens,
              lr.cost_with_margin_cents
            FROM llm_requests lr
            JOIN agent_runs ar ON ar.id = lr.run_id
            WHERE ar.subaccount_id = ${subaccountId}
              AND ar.organisation_id = ${organisationId}
              AND lr.created_at >= now() - INTERVAL '7 days'
              AND lr.source_type = 'agent_run'
          ),
          dominant_skill AS (
            SELECT
              agent_id,
              feature_tag,
              ROW_NUMBER() OVER (
                PARTITION BY agent_id
                ORDER BY SUM(cost_with_margin_cents) DESC, feature_tag ASC
              ) AS rn
            FROM agent_requests
            GROUP BY agent_id, feature_tag
          )
          SELECT
            ar.agent_id,
            SUM(ar.cache_creation_tokens)::int    AS creation_tokens,
            SUM(ar.cached_prompt_tokens)::int     AS reused_tokens,
            COALESCE(ds.feature_tag, 'unknown')   AS dominant_skill
          FROM agent_requests ar
          LEFT JOIN dominant_skill ds
            ON ds.agent_id = ar.agent_id AND ds.rn = 1
          GROUP BY ar.agent_id, ds.feature_tag
          HAVING SUM(ar.cache_creation_tokens) > 0 OR SUM(ar.cached_prompt_tokens) > 0
        `);

        return (result as unknown as Array<Record<string, unknown>>).map((row) => ({
          agent_id: String(row.agent_id),
          creation_tokens: Number(row.creation_tokens) || 0,
          reused_tokens: Number(row.reused_tokens) || 0,
          dominant_skill: String(row.dominant_skill || 'unknown'),
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
      errorCode: 'cache_efficiency_failed',
    });
  }
}
