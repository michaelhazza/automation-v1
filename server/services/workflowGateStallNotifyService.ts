import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { logger } from '../lib/logger.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { WORKFLOW_GATE_STALL_NOTIFY_QUEUE } from '../jobs/workflowGateStallNotifyJob.js';
import type { WorkflowGateStallNotifyPayload } from '../jobs/workflowGateStallNotifyJob.js';
import { emailService } from './emailService.js';
import { buildStallJobName, CADENCE_SECONDS, STALL_CADENCES } from './workflowGateStallNotifyServicePure.js';

// ---------------------------------------------------------------------------
// Subject lines per spec §5.3 — cadence + gateKind aware
// ---------------------------------------------------------------------------

function buildStallSubject(
  cadence: WorkflowGateStallNotifyPayload['cadence'],
  gateKind: 'approval' | 'ask',
): string {
  const typeLabel = gateKind === 'ask' ? 'input' : 'approval';
  switch (cadence) {
    case '24h': return `A workflow gate has been waiting on ${typeLabel} for 24 hours`;
    case '72h': return `A workflow gate has been waiting on ${typeLabel} for 72 hours`;
    case '7d':  return `A workflow gate has been waiting on ${typeLabel} for 7 days`;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const WorkflowGateStallNotifyService = {
  /**
   * Schedule three delayed pg-boss jobs (24h, 72h, 7d) immediately after a
   * gate opens. Best-effort: schedule failures log but do not throw so the
   * gate open path is never blocked.
   */
  async scheduleStallNotifications(params: {
    gateId: string;
    gateCreatedAt: Date;
    workflowRunId: string;
    requesterUserId: string;
    organisationId: string;
    gateKind: 'approval' | 'ask';
  }): Promise<void> {
    try {
      const boss = await getPgBoss();
      const expectedCreatedAt = params.gateCreatedAt.toISOString();

      for (const cadence of STALL_CADENCES) {
        const payload: WorkflowGateStallNotifyPayload = {
          gateId: params.gateId,
          organisationId: params.organisationId,
          workflowRunId: params.workflowRunId,
          requesterUserId: params.requesterUserId,
          cadence,
          gateKind: params.gateKind,
          expectedCreatedAt,
        };

        await boss.send(
          WORKFLOW_GATE_STALL_NOTIFY_QUEUE,
          payload,
          {
            startAfter: CADENCE_SECONDS[cadence],
            singletonKey: buildStallJobName(params.gateId, cadence),
          },
        );
      }

      logger.info('workflow_gate_stall_notify_scheduled', {
        gateId: params.gateId,
        workflowRunId: params.workflowRunId,
        cadences: STALL_CADENCES,
      });
    } catch (err) {
      logger.warn('workflow_gate_stall_notify_schedule_failed', {
        gateId: params.gateId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  /**
   * Cancel all three pending stall-notification jobs for a gate. Best-effort:
   * failures log but do not throw — the stale-fire guard in the handler is the
   * durable safety net.
   */
  async cancelStallNotifications(gateId: string): Promise<void> {
    try {
      const boss = await getPgBoss();

      // pg-boss does not expose a cancel-by-singletonKey API, so we query the
      // pgboss.job table directly for pending jobs matching each singletonKey
      // and cancel them by ID.
      const results = await Promise.allSettled(
        STALL_CADENCES.map(async (cadence) => {
          const key = buildStallJobName(gateId, cadence);
          const rows = await db.execute(sql`
            SELECT id FROM pgboss.job
            WHERE name = ${WORKFLOW_GATE_STALL_NOTIFY_QUEUE}
              AND "singletonKey" = ${key}
              AND state < 'completed'
          `);
          const ids = (rows as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
          if (ids.length > 0) {
            await boss.cancel(ids);
          }
        }),
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          logger.warn('workflow_gate_stall_notify_cancel_partial_failed', {
            gateId,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      }
    } catch (err) {
      logger.warn('workflow_gate_stall_notify_cancel_failed', {
        gateId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  /**
   * Send a single stall notification to the requester. Called by the job handler
   * after the stale-fire guard has passed.
   */
  async sendGateStallNotification(params: {
    workflowRunId: string;
    requesterUserId: string;
    organisationId: string;
    cadence: WorkflowGateStallNotifyPayload['cadence'];
    gateKind: 'approval' | 'ask';
  }): Promise<void> {
    // Explicit organisationId filter alongside RLS — DEVELOPMENT_GUIDELINES §1.
    // Defends against a future deployment moving this code outside the worker's
    // withOrgTx context (e.g. a maintenance script using withAdminConnection).
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(
        and(
          eq(users.id, params.requesterUserId),
          eq(users.organisationId, params.organisationId),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);

    if (!user?.email) {
      logger.warn('workflow_gate_stall_notify_no_email', {
        requesterUserId: params.requesterUserId,
        workflowRunId: params.workflowRunId,
        cadence: params.cadence,
      });
      return;
    }

    const subject = buildStallSubject(params.cadence, params.gateKind);
    let text = `${subject}.\n\nWorkflow run: ${params.workflowRunId}`;
    if (params.cadence === '7d') {
      text += '\n\nConsider cancelling this task if it is no longer needed.';
    }

    await emailService.sendGenericEmail(user.email, subject, text);

    logger.info('workflow_gate_stall_notification_sent', {
      workflowRunId: params.workflowRunId,
      requesterUserId: params.requesterUserId,
      cadence: params.cadence,
    });
  },
};
