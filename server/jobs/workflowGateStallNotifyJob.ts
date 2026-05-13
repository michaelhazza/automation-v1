import type PgBoss from 'pg-boss';
import { eq, and, lt, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowStepGates, delegationOutcomes, subaccountAgents, agents, actions } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { isStallFireStale } from '../services/workflowGateStallNotifyServicePure.js';
import { eaDraftService } from '../services/eaDrafts/eaDraftService.js';
import { decideTimeoutPolicyAction } from '../services/actionServicePure.js';
import { actionService } from '../services/actionService.js';
import { appendEvent } from '../services/agentExecutionEventService.js';
import type { CrossOwnerSubstepCompletedPayload, CrossOwnerSubstepAwaitingPayload } from '../../shared/types/operatorEvents.js';

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

// ---------------------------------------------------------------------------
// EA draft stall-reset pass
//
// Resets ea_drafts rows stuck in send_state='sending' for more than 30 minutes
// back to 'idle'. This is a recoverable stall — NOT a terminal failure.
// Called by the same job worker that handles workflow-gate stall notifications.
// ---------------------------------------------------------------------------

export async function eaDraftStallResetHandler(): Promise<void> {
  const resetIds = await eaDraftService.resetStalledSendingDrafts();
  for (const id of resetIds) {
    logger.info('ea_draft_stall_reset', { draftId: id });
  }

  // 7-day proposal sweep for EA-linked drafts (spec §5.1 + REQ-M9). Sweeping
  // here piggybacks on the existing cron — this job already runs frequently
  // enough that sweeps land within minutes of crossing the 7-day threshold.
  // Naming note: the `actions` primitive has no `expired` status, so the
  // sweep transitions to `rejected` with `metadata.systemExpired = true`.
  // See `eaDraftService.expireOldEADraftProposals` for the full naming note.
  const expiredIds = await eaDraftService.expireOldEADraftProposals();
  for (const actionId of expiredIds) {
    logger.info('ea_draft_proposal_system_rejected_due_to_expiry', {
      actionId,
      reason: 'expired_after_7d',
      systemExpired: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Cross-owner approval timeout sweep
//
// Detects delegation_outcomes rows in 'awaiting_cross_owner_approval' status
// for more than 24 hours and applies the configured timeout policy.
// Called by the same cron worker as eaDraftStallResetHandler.
// ---------------------------------------------------------------------------

export async function crossOwnerApprovalTimeoutSweep(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Fetch open sub-steps past the 24h window, joining to derive initiatorUserId
  // from the caller agent's ownerUserId (callerAgentId → subaccountAgents → agents).
  const stalledRows = await db
    .select({
      id: delegationOutcomes.id,
      runId: delegationOutcomes.runId,
      organisationId: delegationOutcomes.organisationId,
      subaccountId: delegationOutcomes.subaccountId,
      crossOwnerApprovalTimeoutPolicy: delegationOutcomes.crossOwnerApprovalTimeoutPolicy,
      substepStatus: delegationOutcomes.substepStatus,
      initiatorUserId: agents.ownerUserId,
    })
    .from(delegationOutcomes)
    .leftJoin(subaccountAgents, eq(subaccountAgents.id, delegationOutcomes.callerAgentId))
    .leftJoin(agents, eq(agents.id, subaccountAgents.agentId))
    .where(
      and(
        eq(delegationOutcomes.substepStatus, 'awaiting_cross_owner_approval'),
        lt(delegationOutcomes.createdAt, cutoff),
        isNull(delegationOutcomes.terminalAt),
      ),
    );

  for (const row of stalledRows) {
    const policy = row.crossOwnerApprovalTimeoutPolicy;
    if (!policy) continue;

    const decision = decideTimeoutPolicyAction(policy);

    if (decision.action === 'fail_parent') {
      const updated = await db
        .update(delegationOutcomes)
        .set({ substepStatus: 'failed', terminalAt: new Date() })
        .where(
          and(
            eq(delegationOutcomes.id, row.id),
            eq(delegationOutcomes.organisationId, row.organisationId),
            isNull(delegationOutcomes.terminalAt),
          ),
        )
        .returning({ id: delegationOutcomes.id });

      if (updated.length === 0) {
        logger.info('workflow_gate_stall.cross_owner_timeout.already_terminal', { runId: row.runId, policy });
        continue;
      }

      const completedPayload: CrossOwnerSubstepCompletedPayload & { critical: true } = {
        eventType: 'cross_owner_substep.completed',
        parent_run_id: row.runId,
        substep_id: row.id,
        status: decision.eventStatus,
        reason: decision.eventReason,
        critical: true,
      };
      await appendEvent({
        runId: row.runId,
        organisationId: row.organisationId,
        subaccountId: row.subaccountId,
        payload: completedPayload,
        sourceService: 'workflowGateStallNotifyJob',
      });
      logger.info('workflow_gate_stall.cross_owner_timeout.fail_parent', { runId: row.runId });

    } else if (decision.action === 'continue_without_substep') {
      const updated = await db
        .update(delegationOutcomes)
        .set({ substepStatus: 'partial', terminalAt: new Date() })
        .where(
          and(
            eq(delegationOutcomes.id, row.id),
            eq(delegationOutcomes.organisationId, row.organisationId),
            isNull(delegationOutcomes.terminalAt),
          ),
        )
        .returning({ id: delegationOutcomes.id });

      if (updated.length === 0) {
        logger.info('workflow_gate_stall.cross_owner_timeout.already_terminal', { runId: row.runId, policy });
        continue;
      }

      const completedPayload: CrossOwnerSubstepCompletedPayload & { critical: true } = {
        eventType: 'cross_owner_substep.completed',
        parent_run_id: row.runId,
        substep_id: row.id,
        status: decision.eventStatus,
        reason: decision.eventReason,
        critical: true,
      };
      await appendEvent({
        runId: row.runId,
        organisationId: row.organisationId,
        subaccountId: row.subaccountId,
        payload: completedPayload,
        sourceService: 'workflowGateStallNotifyJob',
      });
      logger.info('workflow_gate_stall.cross_owner_timeout.continue', { runId: row.runId });

    } else {
      // ask_initiator — sub-step is NOT terminal; keep terminalAt = NULL.
      // No-op SET used as a race-claim guard: atomically confirms the row is
      // still open before emitting the event. terminalAt stays NULL by design.
      const updated = await db
        .update(delegationOutcomes)
        .set({ substepStatus: 'awaiting_cross_owner_approval' })
        .where(
          and(
            eq(delegationOutcomes.id, row.id),
            eq(delegationOutcomes.organisationId, row.organisationId),
            isNull(delegationOutcomes.terminalAt),
          ),
        )
        .returning({ id: delegationOutcomes.id });

      if (updated.length === 0) {
        logger.info('workflow_gate_stall.cross_owner_timeout.already_terminal', { runId: row.runId, policy });
        continue;
      }

      const initiatorUserId = row.initiatorUserId ?? null;

      if (initiatorUserId) {
        // Re-sweep dedupe: ask_initiator keeps substep_status non-terminal by
        // design (terminalAt stays NULL), so the outer WHERE clause matches
        // this row again on every sweep until the initiator decides. The
        // approval-row write is already deduped via the DB unique constraint
        // on the idempotency key, but appendEvent is not — without this gate
        // each sweep would append a fresh awaiting_initiator_decision event
        // to the run trace. Check whether the approval row already exists
        // and short-circuit the whole branch (suppression-is-success per
        // DEVELOPMENT_GUIDELINES §8.33) when it does.
        const idempotencyKey = `cross_owner_ask_initiator:${row.id}`;
        const existingAsk = await db
          .select({ id: actions.id })
          .from(actions)
          .where(
            and(
              eq(actions.organisationId, row.organisationId),
              eq(actions.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);

        if (existingAsk.length > 0) {
          logger.info('workflow_gate_stall.cross_owner_timeout.ask_initiator_already_emitted', {
            runId: row.runId,
            substepId: row.id,
          });
          continue;
        }

        const awaitingPayload: CrossOwnerSubstepAwaitingPayload & { critical: true } = {
          eventType: 'cross_owner_substep.awaiting_initiator_decision',
          parent_run_id: row.runId,
          substep_id: row.id,
          initiatorUserId,
          reason: 'cross_owner_approval_timeout',
          critical: true,
        };
        await appendEvent({
          runId: row.runId,
          organisationId: row.organisationId,
          subaccountId: row.subaccountId,
          payload: awaitingPayload,
          sourceService: 'workflowGateStallNotifyJob',
        });

        try {
          // Keyed on the delegation_outcomes row only — no sweep-varying timestamp
          // so re-sweeps while the substep is still open produce the same key
          // and the DB unique constraint deduplicates the approval row.
          await actionService.proposeAction({
            organisationId: row.organisationId,
            subaccountId: row.subaccountId,
            agentId: null,
            agentRunId: row.runId,
            actionType: 'cross_owner.ask_initiator_decision',
            idempotencyKey,
            payload: { substepId: row.id, parentRunId: row.runId },
            approverUserId: initiatorUserId,
          });
        } catch (err) {
          logger.warn('workflow_gate_stall.cross_owner_timeout.propose_action_failed', {
            runId: row.runId,
            substepId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info('workflow_gate_stall.cross_owner_timeout.ask_initiator', { runId: row.runId });
    }
  }
}
