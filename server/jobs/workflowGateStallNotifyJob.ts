import type PgBoss from 'pg-boss';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowStepGates } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { isStallFireStale } from '../services/workflowGateStallNotifyServicePure.js';

// ---------------------------------------------------------------------------
// Queue name — exported so both the registrar (index.ts) and the service
// that enqueues jobs share a single constant.
// ---------------------------------------------------------------------------

export const WORKFLOW_GATE_STALL_NOTIFY_QUEUE = 'workflow-gate-stall-notify' as const;

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface WorkflowGateStallNotifyPayload {
  gateId: string;
  organisationId: string;
  workflowRunId: string;
  requesterUserId: string;
  cadence: '24h' | '72h' | '7d';
  gateKind: 'approval' | 'ask';
  /** ISO8601 — stale-fire guard against re-opened gates on the same gateId */
  expectedCreatedAt: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function workflowGateStallNotifyHandler(
  job: PgBoss.Job<WorkflowGateStallNotifyPayload>,
): Promise<void> {
  const payload = job.data;

  const [gate] = await db
    .select({
      id: workflowStepGates.id,
      resolvedAt: workflowStepGates.resolvedAt,
      createdAt: workflowStepGates.createdAt,
    })
    .from(workflowStepGates)
    .where(
      and(
        eq(workflowStepGates.id, payload.gateId),
        eq(workflowStepGates.organisationId, payload.organisationId),
      ),
    )
    .limit(1);

  if (!gate) {
    logger.info('workflow_gate_stall_notify_skipped', {
      gateId: payload.gateId,
      cadence: payload.cadence,
      reason: 'gate_not_found',
    });
    return;
  }

  // Stale-fire guard: skip if gate is resolved or belongs to a previous epoch.
  if (isStallFireStale(gate.resolvedAt, gate.createdAt, payload.expectedCreatedAt)) {
    logger.info('workflow_gate_stall_notify_skipped', {
      gateId: payload.gateId,
      cadence: payload.cadence,
      reason: gate.resolvedAt !== null ? 'gate_already_resolved' : 'created_at_mismatch',
      expected: payload.expectedCreatedAt,
      actual: gate.createdAt.toISOString(),
    });
    return;
  }

  const { WorkflowGateStallNotifyService } = await import('../services/workflowGateStallNotifyService.js');
  await WorkflowGateStallNotifyService.sendGateStallNotification({
    workflowRunId: payload.workflowRunId,
    requesterUserId: payload.requesterUserId,
    organisationId: payload.organisationId,
    cadence: payload.cadence,
    gateKind: payload.gateKind,
  });
}
