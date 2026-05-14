import { and, eq, sql } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { subaccountBaselines } from '../db/schema/index.js';
import { baselineReadinessService } from './baselineReadinessService.js';
import { createEvent } from '../lib/tracing.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { shouldEnqueueCapture } from './baselineSubscriberPure.js';

export { shouldEnqueueCapture } from './baselineSubscriberPure.js';

export const CAPTURE_BASELINE_JOB = 'capture-baseline';

export const baselineSubscriberService = {
  /**
   * F3 §4 — invoked by connectorPollingService after a successful sync.
   * Single-writer rule: this method ONLY enqueues; never writes to subaccount_baselines.
   */
  async onSyncCompleteEvaluateReadiness(
    subaccountId: string,
    organisationId: string,
  ): Promise<void> {
    const result = await baselineReadinessService.evaluate(subaccountId, organisationId);
    if (!result.ready) return;

    // Filter out reset rows so the post-admin-reset state (one reset row + one
    // pending row) deterministically returns the new pending row. The partial
    // UNIQUE index `subaccount_baselines_active_uniq WHERE status <> 'reset'`
    // guarantees at most one non-reset row per subaccount, so no LIMIT or
    // ORDER BY is needed once the reset filter is in place.
    const tx = getOrgScopedDb('baselineSubscriberService.onSyncCompleteEvaluateReadiness');
    const [row] = await tx
      .select({ id: subaccountBaselines.id, status: subaccountBaselines.status })
      .from(subaccountBaselines)
      .where(
        and(
          eq(subaccountBaselines.subaccountId, subaccountId),
          eq(subaccountBaselines.organisationId, organisationId),
          sql`status <> 'reset'`,
        ),
      );

    if (!shouldEnqueueCapture(result.ready, row ?? null)) return;

    await this.enqueueCaptureBaselineJob({
      baselineId: row!.id,
      subaccountId,
      organisationId,
      triggerSource: 'subscriber',
    });
  },

  /**
   * Single enqueue path — all trigger sources call this.
   */
  async enqueueCaptureBaselineJob(params: {
    baselineId: string;
    subaccountId: string;
    organisationId: string;
    triggerSource: 'subscriber' | 'fallback' | 'manual' | 'admin_reset';
  }): Promise<void> {
    const boss = await getPgBoss();
    await boss.send(
      CAPTURE_BASELINE_JOB,
      {
        baselineId: params.baselineId,
        subaccountId: params.subaccountId,
        organisationId: params.organisationId,
      },
      {
        singletonKey: `baseline:${params.baselineId}`,
        singletonHours: 1,
      },
    );
    createEvent('baseline.capture.triggered', {
      subaccount_id: params.subaccountId,
      baseline_id: params.baselineId,
      source: params.triggerSource,
    });
  },
};
