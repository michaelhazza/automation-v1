// amendment:stale-retire (queue) — daily at 06:00 UTC
//
// Per-org sweep: retires skill_amendments that have been in `pending_review`
// for more than 14 days. After retiring, it marks linked skill_regression_cases
// as `fix_wrong` and increments amendment_proposer_metrics.reject_count for the
// proposer model version that authored the now-stale amendment.
//
// Concurrency: teamSize=1; pg-boss deduplicates across instances natively.
// Admin-bypass is required for the cross-org org enumeration; per-org writes
// use the same admin tx with explicit org-scoped predicates.

import { sql } from 'drizzle-orm';
import type { OrgScopedTx } from '../db/index.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';

const SOURCE = 'amendment:stale-retire' as const;

async function retireStaleForOrg(
  tx: OrgScopedTx,
  orgId: string,
): Promise<{ retired: number }> {
  // Step 1: retire amendments that have been pending for >14 days
  const retiredRows = (await tx.execute(sql`
    UPDATE skill_amendments
    SET
      status = 'retired',
      retired_at = now(),
      retirement_reason = 'stale',
      updated_at = now()
    WHERE
      org_id = ${orgId}::uuid
      AND status = 'pending_review'
      AND created_at < now() - interval '14 days'
    RETURNING id, proposer_model_version
  `)) as unknown as Array<{ id: string; proposer_model_version: string | null }>;

  if (retiredRows.length === 0) return { retired: 0 };

  const retiredIds = retiredRows.map((r) => r.id);

  // Step 2: mark linked regression cases as fix_wrong
  await tx.execute(sql`
    UPDATE skill_regression_cases
    SET tag = 'fix_wrong', updated_at = now()
    WHERE
      org_id = ${orgId}::uuid
      AND amendment_id = ANY(${retiredIds}::uuid[])
      AND tag = 'unresolved'
  `);

  // Step 3: increment reject_count per proposer_model_version
  const modelVersions = retiredRows
    .map((r) => r.proposer_model_version)
    .filter((v): v is string => v !== null);

  for (const modelVersion of new Set(modelVersions)) {
    const countForModel = retiredRows.filter((r) => r.proposer_model_version === modelVersion).length;
    const today = new Date();
    const periodStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    await tx.execute(sql`
      INSERT INTO amendment_proposer_metrics (
        id, proposer_model_version, period_start, reject_count,
        created_at, updated_at
      )
      VALUES (
        gen_random_uuid(), ${modelVersion}, ${periodStart}::date, ${countForModel},
        now(), now()
      )
      ON CONFLICT (proposer_model_version, period_start)
      DO UPDATE SET
        reject_count = amendment_proposer_metrics.reject_count + ${countForModel},
        updated_at = now()
    `);
  }

  return { retired: retiredRows.length };
}

export async function runAmendmentStaleRetire(): Promise<void> {
  const jobRunId = crypto.randomUUID();
  logger.info(`${SOURCE}.started`, { jobRunId });

  let orgsProcessed = 0;
  let totalRetired = 0;

  await withAdminConnection(
    { source: SOURCE, reason: 'Daily stale amendment retirement sweep' },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      const orgs = (await tx.execute(
        sql`SELECT id FROM organisations LIMIT 500`,
      )) as unknown as Array<{ id: string }>;

      for (let i = 0; i < orgs.length; i++) {
        const org = orgs[i];
        const savepoint = `org_${i}`;
        try {
          await tx.execute(sql.raw(`SAVEPOINT ${savepoint}`));
          const { retired } = await retireStaleForOrg(tx, org.id);
          await tx.execute(sql.raw(`RELEASE SAVEPOINT ${savepoint}`));
          totalRetired += retired;
          orgsProcessed++;
        } catch (err) {
          try {
            await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${savepoint}`));
            await tx.execute(sql.raw(`RELEASE SAVEPOINT ${savepoint}`));
          } catch {
            // savepoint cleanup failure — outer tx will still commit siblings
          }
          logger.error(`${SOURCE}.org_failed`, {
            jobRunId,
            orgId: org.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
  );

  logger.info(`${SOURCE}.completed`, { jobRunId, orgsProcessed, totalRetired });
}
