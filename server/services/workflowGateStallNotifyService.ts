/**
 * workflowGateStallNotifyService.ts — schedule and cancel stall-and-notify jobs.
 *
 * Spec §5.3: three pg-boss delayed jobs (24h, 72h, 7d) are scheduled at
 * gate-open. Each carries `expectedCreatedAt` for the in-handler stale-fire
 * guard. All three are cancelled (best-effort) at gate-resolve.
 *
 * Error handling:
 *   - pg-boss enqueue failure: logged, does NOT block gate-open.
 *   - Cancel failure: logged, gate stays closed. The stale-fire guard in the
 *     handler is the durable safety net.
 */

import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';
import { logger } from '../lib/logger.js';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import {
  buildStallJobName,
  computeStallSchedule,
  type StallCadence,
} from './workflowGateStallNotifyServicePure.js';

export const WORKFLOW_GATE_STALL_NOTIFY_QUEUE = 'workflow-gate-stall-notify';

export interface StallNotifyPayload {
  gateId: string;
  organisationId: string;
  taskId: string;
  requesterUserId: string;
  cadence: StallCadence;
  expectedCreatedAt: string; // ISO8601 — stale-fire guard
}

export const WorkflowGateStallNotifyService = {
  /**
   * Schedule three stall-notify pg-boss jobs (24h / 72h / 7d) after gate-open
   * is committed. Best-effort — enqueue failures are logged but do NOT throw,
   * so a pg-boss hiccup cannot block gate-open.
   *
   * Each job's name is `stall-notify-${gateId}-${cadence}`, which provides
   * pg-boss-level dedup: a duplicate enqueue with the same name is a no-op.
   */
  async scheduleStallNotifications(
    gateId: string,
    gateCreatedAt: Date,
    taskId: string,
    requesterUserId: string,
    organisationId: string,
  ): Promise<void> {
    const entries = computeStallSchedule();
    const expectedCreatedAt = gateCreatedAt.toISOString();

    for (const entry of entries) {
      const jobName = buildStallJobName(gateId, entry.cadence);
      const payload: StallNotifyPayload = {
        gateId,
        organisationId,
        taskId,
        requesterUserId,
        cadence: entry.cadence,
        expectedCreatedAt,
      };

      try {
        const boss = await getPgBoss();
        await boss.sendAfter(
          WORKFLOW_GATE_STALL_NOTIFY_QUEUE,
          payload,
          {
            ...getJobConfig(WORKFLOW_GATE_STALL_NOTIFY_QUEUE),
            // Job name is used as a pg-boss singletonKey so duplicate enqueues
            // for the same (gateId, cadence) are collapsed.
            singletonKey: jobName,
          },
          entry.startAfterSeconds,
        );
        logger.info('workflow_gate_stall_notify_scheduled', {
          event: 'stall_notify.scheduled',
          gateId,
          cadence: entry.cadence,
          startAfterSeconds: entry.startAfterSeconds,
          jobName,
        });
      } catch (err) {
        // Best-effort: log but do NOT rethrow so gate-open is unaffected.
        logger.error('workflow_gate_stall_notify_enqueue_failed', {
          event: 'stall_notify.enqueue_failed',
          gateId,
          cadence: entry.cadence,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },

  /**
   * Cancel the three stall-notify jobs for a gate (best-effort).
   *
   * pg-boss has no cancel-by-name-pattern API. We UPDATE the pgboss.job table
   * directly, matching on the queue name + singletonkey prefix pattern.
   * Only `created` and `retry` rows are cancelled; `active` rows are left
   * running because the stale-fire guard in the handler will no-op them
   * (resolved_at is already set when this method is called).
   *
   * Uses the main db connection (pgboss schema is outside the tenant RLS
   * boundary; no org context required for this maintenance UPDATE).
   */
  async cancelStallNotifications(gateId: string): Promise<void> {
    // singletonkey for each job is buildStallJobName(gateId, cadence),
    // so they all share the prefix `stall-notify-${gateId}-`.
    const singletonKeyPrefix = `stall-notify-${gateId}-%`;

    try {
      await db.execute(sql`
        UPDATE pgboss.job
        SET state = 'cancelled', completedon = NOW()
        WHERE name = ${WORKFLOW_GATE_STALL_NOTIFY_QUEUE}
          AND state IN ('created', 'retry')
          AND singletonkey LIKE ${singletonKeyPrefix}
      `);
      logger.info('workflow_gate_stall_notify_cancelled', {
        event: 'stall_notify.cancelled',
        gateId,
      });
    } catch (err) {
      // Best-effort: log but do NOT rethrow — gate resolution is already committed.
      logger.error('workflow_gate_stall_notify_cancel_failed', {
        event: 'stall_notify.cancel_failed',
        gateId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};
