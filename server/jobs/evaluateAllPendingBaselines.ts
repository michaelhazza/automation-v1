import type PgBoss from 'pg-boss';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { withOrgTx } from '../instrumentation.js';
import { logger } from '../lib/logger.js';
import { baselineReadinessService } from '../services/baselineReadinessService.js';
import { baselineSubscriberService } from '../services/baselineSubscriberService.js';

export const EVALUATE_ALL_PENDING_BASELINES_JOB = 'evaluate-all-pending-baselines';

/**
 * F3 §4 — daily fallback. Finds pending/retry-eligible baselines and enqueues
 * capture jobs. Single-writer rule: this job only ENQUEUES.
 */
export async function evaluateAllPendingBaselinesHandler(_job: PgBoss.Job<unknown>): Promise<void> {
  const candidates = await withAdminConnection(
    { source: 'baseline_evaluate_all_pending', skipAudit: true },
    async (adminDb) => {
      await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
      // Retry pickup matches the §5.4 backoff schedule. capture_attempt_count >= 3
      // is intentionally excluded — by that point captureBaselineService.run has
      // already transitioned the row to status='failed' (isRetryBudgetExhausted),
      // so it is no longer 'ready' and never matched here.
      const result = await adminDb.execute(sql`
        SELECT id, organisation_id, subaccount_id, status, capture_attempt_count
        FROM subaccount_baselines
        WHERE status = 'pending'
           OR (
             status = 'ready'
             AND (
               (capture_attempt_count = 1 AND last_attempt_at <= now() - interval '1 hour')
               OR (capture_attempt_count = 2 AND last_attempt_at <= now() - interval '4 hours')
             )
           )
      `);
      return (result as unknown as { rows: Array<{ id: string; organisation_id: string; subaccount_id: string; status: string; capture_attempt_count: number }> }).rows;
    },
  );

  for (const c of candidates) {
    try {
      // baselineReadinessService.evaluate uses getOrgScopedDb which requires an
      // org-scoped transaction context. Open one per candidate — same pattern
      // as createWorker does for pg-boss job handlers.
      let shouldEnqueue = false;
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.organisation_id', ${c.organisation_id}, true)`,
        );
        await withOrgTx(
          {
            tx,
            organisationId: c.organisation_id,
            subaccountId: c.subaccount_id,
            source: 'evaluateAllPendingBaselines',
          },
          async () => {
            const result = await baselineReadinessService.evaluate(c.subaccount_id, c.organisation_id);
            if (!result.ready && c.status === 'pending') return;
            shouldEnqueue = true;
          },
        );
      });

      if (!shouldEnqueue) continue;

      await baselineSubscriberService.enqueueCaptureBaselineJob({
        baselineId: c.id,
        subaccountId: c.subaccount_id,
        organisationId: c.organisation_id,
        triggerSource: 'fallback',
      });
    } catch (err) {
      logger.error('baseline.evaluate_pending.candidate_failed', {
        baseline_id: c.id,
        organisation_id: c.organisation_id,
        subaccount_id: c.subaccount_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
