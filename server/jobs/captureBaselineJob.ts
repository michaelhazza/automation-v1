import type PgBoss from 'pg-boss';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withOrgTx } from '../instrumentation.js';
import { captureBaselineService } from '../services/captureBaselineService.js';

export interface CaptureBaselineJobData {
  baselineId: string;
  subaccountId: string;
  organisationId: string;
}

export async function captureBaselineJobHandler(
  job: PgBoss.Job<CaptureBaselineJobData>,
): Promise<void> {
  const { baselineId, organisationId, subaccountId } = job.data;
  // Open an org-scoped transaction (same pattern as createWorker + evaluateAllPendingBaselines)
  // so that all getOrgScopedDb() calls inside captureBaselineService.run() and the metric
  // readers resolve against the correct ALS context and the RLS set_config is in effect.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);
    await withOrgTx(
      { tx, organisationId, subaccountId, source: `pgboss:capture-baseline:${job.id}` },
      () => captureBaselineService.run({ baselineId, organisationId, subaccountId }),
    );
  });
}
