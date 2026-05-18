// amendment:proposer-entropy (queue) — monthly at 03:00 on the 1st
//
// For each org + skill combination that had amendment proposals in the current
// month window, computes diversity metrics and UPSERTs into
// amendment_proposer_entropy:
//
//   template_repetition_rate — duplicate-normalised bodies / total proposals
//   lexical_diversity         — unique tokens / total tokens (Type-Token Ratio)
//   remedy_category_distribution — JSONB histogram of amendment kinds
//
// skill_id is text in the schema to accommodate both system and org skill slugs.
// We derive it as COALESCE(system_skill_id::text, org_skill_id::text).
//
// Phase 1 simplification: the "duplicate normalised body" detection uses
// lower(trim(body)) equality — not semantic similarity. Sufficient for
// detecting verbatim LLM template repetition.
//
// Concurrency: teamSize=1; admin-bypass cross-org sweep.

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';

const SOURCE = 'amendment:proposer-entropy' as const;

export async function runAmendmentProposerEntropy(): Promise<void> {
  const jobRunId = crypto.randomUUID();
  logger.info(`${SOURCE}.started`, { jobRunId });

  let totalUpserted = 0;

  await withAdminConnection(
    { source: SOURCE, reason: 'Monthly per-org-skill proposer entropy computation' },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // Compute and upsert entropy metrics for the current month.
      // period_month = first day of the current month (date_trunc truncates to month start).
      //
      // Derivation:
      //   template_repetition_rate: rows with a body identical to another row in the period
      //   lexical_diversity: unique_words / total_words (approx TTR via regexp_split_to_table)
      //   remedy_category_distribution: jsonb_object_agg of kind → count
      const result = (await tx.execute(sql`
        INSERT INTO amendment_proposer_entropy (
          id,
          org_id,
          skill_id,
          period_month,
          template_repetition_rate,
          lexical_diversity,
          remedy_category_distribution,
          created_at,
          updated_at
        )
        SELECT
          gen_random_uuid(),
          agg.org_id,
          agg.skill_id,
          agg.period_month,
          agg.template_repetition_rate,
          agg.lexical_diversity,
          agg.remedy_category_distribution,
          now(),
          now()
        FROM (
          WITH period_proposals AS (
            SELECT
              org_id,
              COALESCE(system_skill_id::text, org_skill_id::text) AS skill_id,
              date_trunc('month', now())::date AS period_month,
              lower(trim(body)) AS normalised_body,
              kind
            FROM skill_amendments
            WHERE created_at >= date_trunc('month', now())
              AND created_at <  date_trunc('month', now()) + interval '1 month'
          ),
          dup_counts AS (
            SELECT org_id, skill_id, period_month, normalised_body,
                   COUNT(*) AS body_count
            FROM period_proposals
            GROUP BY org_id, skill_id, period_month, normalised_body
          ),
          word_stats AS (
            SELECT
              p.org_id,
              p.skill_id,
              COUNT(w.word) AS total_words,
              COUNT(DISTINCT w.word) AS unique_words
            FROM period_proposals p,
                 regexp_split_to_table(p.normalised_body, E'\\s+') AS w(word)
            WHERE w.word <> ''
            GROUP BY p.org_id, p.skill_id
          )
          SELECT
            p.org_id,
            p.skill_id,
            p.period_month,
            -- template_repetition_rate: fraction of proposals that are duplicates
            ROUND(
              CAST(
                SUM(CASE WHEN dc.body_count > 1 THEN 1 ELSE 0 END)::numeric
                / NULLIF(COUNT(*), 0)
              AS numeric), 4
            )::double precision AS template_repetition_rate,
            -- lexical_diversity: unique_words / total_words
            ROUND(
              CAST(
                COALESCE(ws.unique_words::numeric, 0)
                / NULLIF(ws.total_words, 0)
              AS numeric), 4
            )::double precision AS lexical_diversity,
            -- remedy_category_distribution: kind → count histogram
            jsonb_object_agg(p.kind, kind_counts.cnt) AS remedy_category_distribution
          FROM period_proposals p
          LEFT JOIN dup_counts dc
            ON dc.org_id = p.org_id
            AND dc.skill_id = p.skill_id
            AND dc.normalised_body = p.normalised_body
          LEFT JOIN word_stats ws
            ON ws.org_id = p.org_id
            AND ws.skill_id = p.skill_id
          CROSS JOIN LATERAL (
            SELECT COUNT(*) AS cnt
            FROM period_proposals p2
            WHERE p2.org_id = p.org_id
              AND p2.skill_id = p.skill_id
              AND p2.kind = p.kind
          ) kind_counts
          GROUP BY p.org_id, p.skill_id, p.period_month, ws.unique_words, ws.total_words
        ) agg
        ON CONFLICT (org_id, skill_id, period_month)
        DO UPDATE SET
          template_repetition_rate     = EXCLUDED.template_repetition_rate,
          lexical_diversity             = EXCLUDED.lexical_diversity,
          remedy_category_distribution = EXCLUDED.remedy_category_distribution,
          updated_at                   = now()
      `)) as unknown as { rowCount?: number };

      totalUpserted = result.rowCount ?? 0;
    },
  );

  logger.info(`${SOURCE}.completed`, { jobRunId, totalUpserted });
}
