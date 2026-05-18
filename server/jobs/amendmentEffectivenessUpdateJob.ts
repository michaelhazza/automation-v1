// amendment:effectiveness-update (queue) — daily at 07:00 UTC (after stale-retire)
//
// For each accepted amendment, computes best-effort effectiveness metrics and
// UPSERTs into skill_amendment_effectiveness. This is a Phase 1 approximation:
// the composite sidecar is updated nightly from data already in the DB
// (regression cases, amendment metadata) without a separate event stream.
//
// Metrics computed:
//   regressions_prevented   — fix_proposed regression cases linked to this amendment
//   operator_override_freq  — not tracked yet in Phase 1 (set to null)
//   inactivity_decay_cand   — true if the amendment was accepted >60 days ago and
//                             has zero regressions_prevented (no replay evidence)
//
// Concurrency: teamSize=1; admin-bypass cross-org sweep.

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';

const SOURCE = 'amendment:effectiveness-update' as const;

export async function runAmendmentEffectivenessUpdate(): Promise<void> {
  const jobRunId = crypto.randomUUID();
  logger.info(`${SOURCE}.started`, { jobRunId });

  let totalUpserted = 0;

  await withAdminConnection(
    { source: SOURCE, reason: 'Daily amendment effectiveness sidecar update' },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // Process all accepted amendments with a single bulk UPSERT.
      // regressions_prevented = count of fix_proposed regression cases linked to this amendment.
      // inactivity_decay_candidate = accepted >60 days ago and regressions_prevented=0.
      const result = (await tx.execute(sql`
        INSERT INTO skill_amendment_effectiveness (
          id,
          amendment_id,
          org_id,
          regressions_prevented,
          inactivity_decay_candidate,
          created_at,
          updated_at
        )
        SELECT
          gen_random_uuid(),
          sa.id AS amendment_id,
          sa.org_id,
          COALESCE(rc.fix_proposed_count, 0) AS regressions_prevented,
          (
            sa.activated_at IS NOT NULL
            AND sa.activated_at < now() - interval '60 days'
            AND COALESCE(rc.fix_proposed_count, 0) = 0
          ) AS inactivity_decay_candidate,
          now(),
          now()
        FROM skill_amendments sa
        LEFT JOIN (
          SELECT amendment_id, COUNT(*) AS fix_proposed_count
          FROM skill_regression_cases
          WHERE tag = 'fix_proposed'
            AND amendment_id IS NOT NULL
          GROUP BY amendment_id
        ) rc ON rc.amendment_id = sa.id
        WHERE sa.status = 'accepted'
        ON CONFLICT (amendment_id)
        DO UPDATE SET
          regressions_prevented     = EXCLUDED.regressions_prevented,
          inactivity_decay_candidate = EXCLUDED.inactivity_decay_candidate,
          updated_at                = now()
      `)) as unknown as { rowCount?: number };

      totalUpserted = result.rowCount ?? 0;
    },
  );

  logger.info(`${SOURCE}.completed`, { jobRunId, totalUpserted });
}
