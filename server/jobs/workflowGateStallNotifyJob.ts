/**
 * workflowGateStallNotifyJob.ts — stall-and-notify handler.
 *
 * Spec §5.3: fires 24h / 72h / 7d after gate-open when the gate is still
 * unresolved. Sends an in-app / email notification to the task requester.
 *
 * Stale-fire guard (round-1 hardening invariant):
 *   Notification is sent ONLY if BOTH:
 *     1. gate.resolved_at IS NULL  (gate still open), AND
 *     2. gate.created_at = expectedCreatedAt (string-equal ISO timestamp —
 *        DB-row vs DB-supplied string, no app Date.now()).
 *
 *   On either check failing: no-op log, return cleanly. This guard means
 *   cancelStallNotifications() is best-effort — even a late-firing job after
 *   resolution is harmless.
 *
 * Connection model:
 *   - Phase 1 (read gate): withAdminConnection + SET LOCAL ROLE admin_role
 *     for the cross-org row read.
 *   - Phase 2 (send notification): direct EmailService call with user lookup
 *     via getOrgScopedDb, which returns the org-scoped tx opened by createWorker.
 *
 * Registered via WorkflowEngineService.registerWorkers().
 */

import { eq, and, isNull, sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { isStallFireStale } from '../services/workflowGateStallNotifyServicePure.js';
import type { StallCadence } from '../services/workflowGateStallNotifyServicePure.js';
import {
  WORKFLOW_GATE_STALL_NOTIFY_QUEUE,
  type StallNotifyPayload,
} from '../services/workflowGateStallNotifyService.js';

export { WORKFLOW_GATE_STALL_NOTIFY_QUEUE };
import { users } from '../db/schema/index.js';
import { EmailService } from '../services/emailService.js';

const emailService = new EmailService();

/** Cadence-specific notification copy per spec §5.3. */
function buildNotificationCopy(
  cadence: StallCadence,
  gateKind: 'approval' | 'ask',
  // TODO: wire taskTitle when workflowRuns.taskId column lands
): { subject: string; body: string } {
  const typeLabel = gateKind === 'approval' ? 'approval' : 'input';

  switch (cadence) {
    case '24h':
      return {
        subject: `Task has been waiting on ${typeLabel} for 24 hours`,
        body: `A workflow step is waiting for ${typeLabel}. It has been waiting for 24 hours. Please review and respond.`,
      };
    case '72h':
      return {
        subject: `Task has been waiting on ${typeLabel} for 72 hours`,
        body: `A workflow step is waiting for ${typeLabel}. It has been waiting for 72 hours. Please review and respond.`,
      };
    case '7d':
      return {
        subject: `Task has been waiting on ${typeLabel} for 7 days`,
        body: [
          `A workflow step is waiting for ${typeLabel}. It has been waiting for 7 days.`,
          '',
          'If you no longer intend to respond, you can cancel this task from the workflow runs page.',
        ].join('\n'),
      };
    default: {
      // Exhaustiveness check — TypeScript will error if a new StallCadence is added without updating this switch.
      const _exhaustive: never = cadence;
      return _exhaustive;
    }
  }
}

interface GateRow {
  id: string;
  resolved_at: Date | null;
  created_at: Date;
  gate_kind: string;
  workflow_run_id: string;
  organisation_id: string;
}

/**
 * Main handler — called by the pg-boss worker registered in
 * WorkflowEngineService.registerWorkers().
 */
export async function runWorkflowGateStallNotify(payload: StallNotifyPayload): Promise<void> {
  // organisationId and taskId are carried in the payload for future enrichment
  // (taskTitle join, audit logging); unused by the current handler body.
  const { gateId, requesterUserId, cadence, expectedCreatedAt } = payload;

  // Phase 1: read the gate row via admin connection (cross-org bypass).
  let gate: GateRow | null;
  try {
    gate = await withAdminConnection(
      {
        source: 'jobs.workflowGateStallNotify',
        reason: 'Read gate row for stall-fire guard check',
        skipAudit: true,
      },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        const rows = (await tx.execute(sql`
          SELECT id, resolved_at, created_at, gate_kind, workflow_run_id, organisation_id
          FROM workflow_step_gates
          WHERE id = ${gateId}::uuid
        `)) as unknown as { rows?: GateRow[] } | GateRow[];

        const arr = Array.isArray(rows) ? rows : (rows?.rows ?? []);
        return arr[0] ?? null;
      },
    );
  } catch (err) {
    logger.error('workflow_gate_stall_notify_read_failed', {
      event: 'stall_notify.read_failed',
      gateId,
      cadence,
      error: err instanceof Error ? err.message : String(err),
    });
    return; // best-effort: no-op on read failure
  }

  if (!gate) {
    logger.info('workflow_gate_stall_notify_gate_missing', {
      event: 'stall_notify.gate_missing',
      gateId,
      cadence,
    });
    return;
  }

  // Phase 2: stale-fire guard (both conditions must hold).
  const resolvedAt = gate.resolved_at ? new Date(gate.resolved_at) : null;
  const createdAt = new Date(gate.created_at);

  if (isStallFireStale(resolvedAt, createdAt, expectedCreatedAt)) {
    logger.info('workflow_gate_stall_notify_stale_fire', {
      event: 'stall_notify.stale_fire',
      gateId,
      cadence,
      resolvedAt: resolvedAt?.toISOString() ?? null,
      createdAt: createdAt.toISOString(),
      expectedCreatedAt,
    });
    return;
  }

  // Phase 3: send notification to the requester via EmailService.
  // Use getOrgScopedDb — createWorker opens an org-scoped tx (via withOrgTx)
  // before the handler runs, so the ALS context is active here. Using the
  // global `db` handle instead would bypass RLS (no set_config on that
  // connection) and return zero rows.
  try {
    // Look up the requester's email address.
    const orgTx = getOrgScopedDb('jobs.workflowGateStallNotify');
    const [user] = await orgTx
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.id, requesterUserId), isNull(users.deletedAt)));

    if (!user?.email) {
      logger.warn('workflow_gate_stall_notify_user_not_found', {
        event: 'stall_notify.user_not_found',
        gateId,
        cadence,
        requesterUserId,
      });
      return;
    }

    const resolvedGateKind: 'approval' | 'ask' = gate!.gate_kind === 'ask' ? 'ask' : 'approval';
    const { subject, body } = buildNotificationCopy(cadence, resolvedGateKind);

    await emailService.sendGenericEmail(user.email, subject, body);

    logger.info('workflow_gate_stall_notify_sent', {
      event: 'stall_notify.sent',
      gateId,
      cadence,
      requesterUserId,
    });
  } catch (err) {
    // Notification failure is logged but does not fail the job permanently.
    // The next cadence (if any) will still fire. Gate stays open.
    logger.error('workflow_gate_stall_notify_send_failed', {
      event: 'stall_notify.send_failed',
      gateId,
      cadence,
      requesterUserId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
