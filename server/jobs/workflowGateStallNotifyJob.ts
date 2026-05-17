import type PgBoss from 'pg-boss';
import { eq, and, lt, isNull, isNotNull, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workflowStepGates, delegationOutcomes, subaccountAgents, agents } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { isStallFireStale } from '../services/workflowGateStallNotifyServicePure.js';
import { eaDraftService } from '../services/eaDrafts/eaDraftService.js';
import { decideTimeoutPolicyAction } from '../services/actionServicePure.js';
import { actionService } from '../services/actionService.js';
import { appendEvent } from '../services/agentExecutionEventService.js';
import type { CrossOwnerSubstepCompletedPayload, CrossOwnerSubstepAwaitingPayload } from '../../shared/types/operatorEvents.js';

// ---------------------------------------------------------------------------
// Atomic claim+emit pattern (Round 3 chatgpt-pr-review F10/F11)
//
// Cross-owner timeout events go through three steps:
//   1. Atomic claim — UPDATE <type>_event_claim_at = NOW() WHERE id = $1 AND
//      <type>_event_emitted_at IS NULL AND (<type>_event_claim_at IS NULL OR
//      <type>_event_claim_at < $cutoff) RETURNING id.
//      If 0 rows, another sweep claimed (or already emitted) — skip.
//   2. appendEvent.
//   3. UPDATE <type>_event_emitted_at = NOW() — confirms the event landed.
//
// If step 2 fails, claim_at stays set, emitted_at stays NULL. The stale-claim
// threshold (5 min) releases the slot for a future sweep to retry. Residual
// edge case: a crash between step 2 success and step 3 then waiting past the
// stale-claim threshold can re-emit the same event. Documented in migration
// 0356 header. The out-of-scope full fix called for in that note —
// idempotency at the appendEvent layer — landed in migration 0365 (PA-V2-
// EVENT-IDEMPOTENCY). The stale-claim TTL workaround has since been removed
// from this file; appendEvent's idempotency_key parameter is now the
// authoritative dedup mechanism.
// ---------------------------------------------------------------------------

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

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
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

// PA-V2-EVENT-IDEMPOTENCY: the previous claimTerminalEventEmit /
// claimAwaitingInitiatorEventEmit helpers (Round 3 F10/F11) used a
// stale-claim TTL on delegation_outcomes columns to dedup concurrent
// terminal-event emits across the sweep loop. They are removed in favour
// of appendEvent's content-keyed idempotency_key (migration 0365): the
// partial UNIQUE index on (run_id, event_type, idempotency_key) suppresses
// duplicates at the DB layer, so the application-layer claim becomes
// redundant. The terminalEventClaimAt / awaitingInitiatorEventClaimAt
// columns remain on the table for now (forward-deployment safety) but are
// no longer written by this file.

interface TerminalRetryRow {
  id: string;
  runId: string;
  organisationId: string;
  subaccountId: string;
  crossOwnerApprovalTimeoutPolicy: 'fail_parent' | 'continue_without_substep' | 'ask_initiator' | null;
  substepStatus: string;
}

/**
 * Retry pass for terminal events whose emit crashed (F10).
 *
 * Picks up rows that the timeout sweep transitioned to a terminal state
 * (substep_status IN ('failed','partial')) for a sweep-owned timeout policy
 * (cross_owner_approval_timeout_policy IN ('fail_parent','continue_without_substep'))
 * but where the cross_owner_substep.completed event never recorded its
 * emitted_at timestamp. Re-derives the event payload from substep_status
 * and re-emits via the same claim+emit helper.
 *
 * Scope is intentionally tight (Round 4 T6): only timeout-sweep-owned
 * terminal rows. Rows that became terminal via other paths (initiator
 * decision, child run completed, manual rejection) emit their terminal
 * events through different code paths and own their own emit-audit columns
 * if needed.
 */
async function retryStrandedTerminalEmits(): Promise<void> {
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
  const strandedRows: TerminalRetryRow[] = await db
    .select({
      id: delegationOutcomes.id,
      runId: delegationOutcomes.runId,
      organisationId: delegationOutcomes.organisationId,
      subaccountId: delegationOutcomes.subaccountId,
      crossOwnerApprovalTimeoutPolicy: delegationOutcomes.crossOwnerApprovalTimeoutPolicy,
      substepStatus: delegationOutcomes.substepStatus,
    })
    .from(delegationOutcomes)
    .where(
      and(
        isNotNull(delegationOutcomes.terminalAt),
        isNull(delegationOutcomes.terminalEventEmittedAt),
        // Only retry timeout-sweep-owned terminal rows. Both axes are tight:
        // substep_status must be one of the two states the sweep itself
        // writes, AND the policy must be one of the two terminal-emitting
        // policies. ask_initiator policy rows that somehow reached terminal
        // (a state-machine bug) are excluded — the sweep's terminal-event
        // emit only fires for fail_parent / continue_without_substep.
        inArray(delegationOutcomes.substepStatus, ['failed', 'partial']),
        inArray(delegationOutcomes.crossOwnerApprovalTimeoutPolicy, [
          'fail_parent',
          'continue_without_substep',
        ]),
      ),
    );

  for (const row of strandedRows) {
    // PA-V2-EVENT-IDEMPOTENCY: the stale-claim TTL workaround
    // (claimTerminalEventEmit) is gone — appendEvent's content-keyed
    // idempotency now suppresses duplicate emits at the DB via the
    // partial UNIQUE index on (run_id, event_type, idempotency_key).
    // The retry loop still picks up stranded rows; appendEvent below
    // is responsible for at-most-once delivery on each retry.

    // Map substep_status → event payload. With the tightened WHERE clause
    // above, only 'failed' and 'partial' are reachable here; the switch
    // surfaces a hard skip on anything unexpected so a future state-machine
    // change doesn't silently emit a synthetic event.
    let status: 'failed' | 'partial';
    let reason: string;
    if (row.substepStatus === 'failed') {
      status = 'failed';
      reason = 'cross_owner_approval_timeout';
    } else if (row.substepStatus === 'partial') {
      status = 'partial';
      reason = 'cross_owner_approval_timed_out_optional';
    } else {
      // Defensive — should be unreachable given the WHERE clause. Log + skip
      // rather than emit a synthetic event with an unsupported status value.
      logger.warn('workflow_gate_stall.cross_owner_timeout.terminal_retry_unexpected_status', {
        runId: row.runId,
        substepId: row.id,
        substepStatus: row.substepStatus,
      });
      continue;
    }

    const completedPayload: CrossOwnerSubstepCompletedPayload & { critical: true } = {
      eventType: 'cross_owner_substep.completed',
      parent_run_id: row.runId,
      substep_id: row.id,
      status,
      reason,
      critical: true,
    };

    try {
      await appendEvent({
        runId: row.runId,
        organisationId: row.organisationId,
        subaccountId: row.subaccountId,
        payload: completedPayload,
        sourceService: 'workflowGateStallNotifyJob',
        // Dedup key: substep id + status uniquely identifies this terminal
        // emission. Any retry from this loop or a parallel sweep on the
        // same row dedupes at the DB via the partial UNIQUE index.
        idempotencyKey: `cross_owner_substep_completed:${row.id}:${status}`,
      });
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
      await db
        .update(delegationOutcomes)
        .set({ terminalEventEmittedAt: new Date() })
        .where(eq(delegationOutcomes.id, row.id));
      logger.info('workflow_gate_stall.cross_owner_timeout.terminal_emit_retry_success', {
        runId: row.runId,
        substepId: row.id,
        status,
      });
    } catch (err) {
      logger.warn('workflow_gate_stall.cross_owner_timeout.terminal_emit_retry_failed', {
        runId: row.runId,
        substepId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Next sweep retries; the idempotency_key ensures at-most-once
      // delivery across retries.
    }
  }
}

export async function crossOwnerApprovalTimeoutSweep(): Promise<void> {
  // Pass 1 — retry stranded terminal-event emissions (F10).
  // Runs first so any in-flight cleanup completes before new transitions land.
  await retryStrandedTerminalEmits();

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Pass 2 — fresh transitions for rows past the timeout window.
  // Fetch open sub-steps past the 24h window, joining to derive initiatorUserId
  // from the caller agent's ownerUserId (callerAgentId → subaccountAgents → agents).
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
  const stalledRows = await db
    .select({
      id: delegationOutcomes.id,
      runId: delegationOutcomes.runId,
      organisationId: delegationOutcomes.organisationId,
      subaccountId: delegationOutcomes.subaccountId,
      crossOwnerApprovalTimeoutPolicy: delegationOutcomes.crossOwnerApprovalTimeoutPolicy,
      substepStatus: delegationOutcomes.substepStatus,
      awaitingInitiatorEventEmittedAt: delegationOutcomes.awaitingInitiatorEventEmittedAt,
      initiatorUserId: agents.ownerUserId,
    })
    .from(delegationOutcomes)
    .leftJoin(subaccountAgents, eq(subaccountAgents.id, delegationOutcomes.callerAgentId))
    .leftJoin(agents, eq(agents.id, subaccountAgents.agentId))
    .where(
      and(
        eq(delegationOutcomes.substepStatus, 'awaiting_cross_owner_approval'),
        // Filter on when the row ENTERED awaiting_cross_owner_approval, not on
        // createdAt. A long-lived row that transitioned into awaiting state
        // recently would otherwise be timed out immediately on the next sweep.
        lt(delegationOutcomes.substepStatusUpdatedAt, cutoff),
        isNull(delegationOutcomes.terminalAt),
      ),
    );

  for (const row of stalledRows) {
    const policy = row.crossOwnerApprovalTimeoutPolicy;
    if (!policy) continue;

    const decision = decideTimeoutPolicyAction(policy);

    if (decision.action === 'fail_parent' || decision.action === 'continue_without_substep') {
      const newStatus = decision.action === 'fail_parent' ? 'failed' : 'partial';

      // Atomic transition — substep_status_updated_at is bumped automatically
      // by the trigger from migration 0355 (no manual write needed; T5).
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
      const updated = await db
        .update(delegationOutcomes)
        .set({ substepStatus: newStatus, terminalAt: new Date() })
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

      // PA-V2-EVENT-IDEMPOTENCY: the stale-claim TTL workaround is gone —
      // appendEvent's content-keyed idempotency dedupes at the DB.

      const completedPayload: CrossOwnerSubstepCompletedPayload & { critical: true } = {
        eventType: 'cross_owner_substep.completed',
        parent_run_id: row.runId,
        substep_id: row.id,
        status: decision.eventStatus,
        reason: decision.eventReason,
        critical: true,
      };

      try {
        await appendEvent({
          runId: row.runId,
          organisationId: row.organisationId,
          subaccountId: row.subaccountId,
          payload: completedPayload,
          sourceService: 'workflowGateStallNotifyJob',
          idempotencyKey: `cross_owner_substep_completed:${row.id}:${decision.eventStatus}`,
        });
        // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
        await db
          .update(delegationOutcomes)
          .set({ terminalEventEmittedAt: new Date() })
          .where(eq(delegationOutcomes.id, row.id));
        logger.info(
          decision.action === 'fail_parent'
            ? 'workflow_gate_stall.cross_owner_timeout.fail_parent'
            : 'workflow_gate_stall.cross_owner_timeout.continue',
          { runId: row.runId },
        );
      } catch (err) {
        logger.warn('workflow_gate_stall.cross_owner_timeout.terminal_emit_failed', {
          runId: row.runId,
          substepId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
        // Row is terminal; emit failed. Next sweep's retryStrandedTerminalEmits
        // will pick it up via the (terminalAt IS NOT NULL AND
        // terminalEventEmittedAt IS NULL) predicate after the claim staleness
        // threshold passes.
      }

    } else {
      // ask_initiator — sub-step is NOT terminal; keep terminalAt = NULL.
      // No-op SET used as a race-claim guard: atomically confirms the row is
      // still open. substep_status_updated_at is NOT bumped by the trigger
      // (status is unchanged), so the row stays in the sweep window until the
      // initiator decides.
      // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
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
        // Two independent invariants applied in order:
        //  (1) Action durability — proposeAction is DB-unique-constraint deduped.
        //  (2) Event durability — atomic claim+emit pattern (F11).
        const idempotencyKey = `cross_owner_ask_initiator:${row.id}`;

        try {
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
          // proposeAction failed; do NOT attempt the event append. Next sweep retries.
          continue;
        }

        if (row.awaitingInitiatorEventEmittedAt !== null) {
          logger.info('workflow_gate_stall.cross_owner_timeout.ask_initiator_already_emitted', {
            runId: row.runId,
            substepId: row.id,
          });
        } else {
          // PA-V2-EVENT-IDEMPOTENCY: stale-claim TTL workaround removed —
          // appendEvent's idempotency_key dedupes at the DB. The
          // awaitingInitiatorEventEmittedAt flag above is still consulted
          // as a fast-path skip so we don't even bother contacting the DB
          // for rows we already know we emitted.
          const awaitingPayload: CrossOwnerSubstepAwaitingPayload & { critical: true } = {
            eventType: 'cross_owner_substep.awaiting_initiator_decision',
            parent_run_id: row.runId,
            substep_id: row.id,
            initiatorUserId,
            reason: 'cross_owner_approval_timeout',
            critical: true,
          };
          try {
            await appendEvent({
              runId: row.runId,
              organisationId: row.organisationId,
              subaccountId: row.subaccountId,
              payload: awaitingPayload,
              sourceService: 'workflowGateStallNotifyJob',
              idempotencyKey: `cross_owner_substep_awaiting_initiator:${row.id}`,
            });
            // guard-ignore-next-line: with-org-tx-or-scoped-db reason="system pg-boss job — no HTTP/ALS context; cross-tenant or admin access intentional"
            await db
              .update(delegationOutcomes)
              .set({ awaitingInitiatorEventEmittedAt: new Date() })
              .where(eq(delegationOutcomes.id, row.id));
          } catch (err) {
            logger.warn('workflow_gate_stall.cross_owner_timeout.ask_initiator_emit_failed', {
              runId: row.runId,
              substepId: row.id,
              error: err instanceof Error ? err.message : String(err),
            });
            // Next sweep retries; the idempotency_key ensures at-most-once
            // delivery across retries.
          }
        }
      }

      logger.info('workflow_gate_stall.cross_owner_timeout.ask_initiator', { runId: row.runId });
    }
  }
}

