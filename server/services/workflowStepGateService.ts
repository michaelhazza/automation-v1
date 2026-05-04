/**
 * WorkflowStepGateService — write path for workflow_step_gates rows.
 *
 * Spec: docs/workflows-dev-spec.md §3.
 *
 * This service NEVER opens its own transactions. Methods that mutate rows
 * accept a `tx` parameter and participate in the caller's transaction. The
 * `getOpenGate` read helper uses `db` directly (no transaction needed).
 *
 * Key invariants:
 *   - Single-gate invariant: openGate pre-checks before INSERT; on 23505 race,
 *     re-reads and returns the existing row.
 *   - resolveGate is idempotent: 0 rows affected = already resolved, log warn
 *     if reason differs but return silently.
 *   - Orphaned-gate cascade: callers (cancelRun, failRun) call
 *     resolveOpenGatesForRun BEFORE their own status update.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { DB } from '../db/index.js';
import { workflowStepGates, workflowRuns } from '../db/schema/index.js';
import type { WorkflowStepGateRow, NewWorkflowStepGateRow } from '../db/schema/workflowStepGates.js';
import type { WorkflowRun } from '../db/schema/workflowRuns.js';
import type { GateResolutionReason, ApproverPoolSnapshot } from '../../shared/types/workflowStepGate.js';
import { normaliseApproverPoolSnapshot, poolFingerprint } from '../../shared/types/approverPoolSnapshot.js';
import { logger } from '../lib/logger.js';
import { assertValidTransition } from '../../shared/stateMachineGuards.js';
import { buildGateSnapshot } from './workflowStepGateServicePure.js';
import { WorkflowConfidenceService } from './workflowConfidenceService.js';
import { WorkflowGateStallNotifyService } from './workflowGateStallNotifyService.js';
import { appendAndEmitTaskEvent } from './taskEventService.js';

// Transaction-aware db handle: either the root db or a drizzle transaction context
type TxOrDb = DB | Parameters<Parameters<DB['transaction']>[0]>[0];

export const WorkflowStepGateService = {
  /**
   * Loads the run row once per gate operation.
   * Returns the full WorkflowRun row, or null if the run is not found or belongs
   * to a different org. Callers that need taskId read run.taskId directly.
   */
  async loadWorkflowRunContext(
    runId: string,
    organisationId: string,
    dbHandle: TxOrDb,
  ): Promise<WorkflowRun | null> {
    const [run] = await (dbHandle as typeof db)
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.id, runId),
          eq(workflowRuns.organisationId, organisationId),
        ),
      );
    return run ?? null;
  },

  /**
   * Return the open gate for a (run, step) pair, or null if none exists.
   * Uses db directly — no transaction needed for reads.
   */
  async getOpenGate(
    workflowRunId: string,
    stepId: string,
    organisationId: string,
  ): Promise<WorkflowStepGateRow | null> {
    const [row] = await db
      .select()
      .from(workflowStepGates)
      .where(
        and(
          eq(workflowStepGates.workflowRunId, workflowRunId),
          eq(workflowStepGates.stepId, stepId),
          eq(workflowStepGates.organisationId, organisationId),
          isNull(workflowStepGates.resolvedAt),
        ),
      );
    return row ?? null;
  },

  /**
   * Read a single gate by (gateId, organisationId). Returns null when the gate
   * does not exist OR is in a different org. Used by the GET gate-detail route
   * the Approval card hits to load the snapshot list when the run-context lacks
   * the resolved pool member IDs.
   */
  async getGateById(
    gateId: string,
    organisationId: string,
  ): Promise<WorkflowStepGateRow | null> {
    const [row] = await db
      .select()
      .from(workflowStepGates)
      .where(
        and(
          eq(workflowStepGates.id, gateId),
          eq(workflowStepGates.organisationId, organisationId),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  /**
   * Open a gate for a (run, step) pair. Pre-checks for an existing open gate
   * (single-gate invariant). If a 23505 unique-constraint violation occurs from
   * a race, re-reads and returns the existing row.
   *
   * The `tx` parameter is required — the caller holds the transaction and this
   * service participates in it.
   */
  async openGate(
    input: {
      workflowRunId: string;
      stepId: string;
      gateKind: NewWorkflowStepGateRow['gateKind'];
      seenPayload?: NewWorkflowStepGateRow['seenPayload'];
      seenConfidence?: NewWorkflowStepGateRow['seenConfidence'];
      approverPoolSnapshot?: NewWorkflowStepGateRow['approverPoolSnapshot'];
      isCriticalSynthesised: boolean;
      organisationId: string;
      // Optional rich context — when provided, seenPayload and seenConfidence
      // are computed from these inputs and override any explicit values.
      stepDefinition?: {
        id: string;
        type: string;
        name?: string;
        params?: Record<string, unknown>;
        isCritical?: boolean;
        sideEffectClass?: string;
      };
      subaccountId?: string | null;
      templateVersionId?: string;
      agentReasoning?: string | null;
      branchDecision?: { field: string; resolvedValue: unknown; targetStep: string } | null;
      upstreamConfidence?: 'high' | 'medium' | 'low' | null;
      /** User ID of the person who requested the workflow run — used for stall notifications. */
      requesterUserId?: string | null;
    },
    tx: TxOrDb,
  ): Promise<WorkflowStepGateRow> {
    // Pre-check (optimisation): returns existing gate in the common retry path,
    // avoiding a doomed INSERT round-trip. The 23505 handler is the actual
    // correctness guarantee for concurrent callers.
    const existing = await this.getOpenGate(input.workflowRunId, input.stepId, input.organisationId);
    if (existing) {
      logger.debug('workflow_step_gate_open_idempotent', {
        workflowRunId: input.workflowRunId,
        stepId: input.stepId,
        gateId: existing.id,
      });
      return existing;
    }

    // Load run context once — runCtx.taskId is available for Chunk 9 event emission.
    const runCtx = await this.loadWorkflowRunContext(input.workflowRunId, input.organisationId, tx);
    if (!runCtx) {
      logger.warn('workflow_gate_open_run_not_found', {
        workflowRunId: input.workflowRunId,
        organisationId: input.organisationId,
      });
      throw { statusCode: 404, message: 'Workflow run not found', errorCode: 'run_not_found' };
    }
    // runCtx.taskId is now available for Chunk 9 event emission.
    void runCtx;

    // Compute seenPayload from stepDefinition if provided (overrides explicit value).
    let resolvedSeenPayload: import('../../shared/types/workflowStepGate.js').SeenPayload | null =
      (input.seenPayload as import('../../shared/types/workflowStepGate.js').SeenPayload | null | undefined) ?? null;
    if (input.stepDefinition) {
      try {
        const { seenPayload } = buildGateSnapshot(
          input.stepDefinition,
          { agentReasoning: input.agentReasoning, branchDecision: input.branchDecision },
        );
        resolvedSeenPayload = seenPayload;
      } catch (err) {
        logger.warn('workflow_gate_seen_payload_build_failed', {
          stepId: input.stepId,
          organisationId: input.organisationId,
          error: err instanceof Error ? err.message : String(err),
        });
        resolvedSeenPayload = null;
      }
    }

    // Compute seenConfidence from stepDefinition if provided (overrides explicit value).
    let resolvedSeenConfidence: import('../../shared/types/workflowStepGate.js').SeenConfidence | null =
      (input.seenConfidence as import('../../shared/types/workflowStepGate.js').SeenConfidence | null | undefined) ?? null;
    if (input.stepDefinition) {
      if (!input.templateVersionId) {
        logger.warn('workflow_confidence_skipped_no_template_version', {
          stepId: input.stepId,
          organisationId: input.organisationId,
        });
        resolvedSeenConfidence = null;
      } else {
        try {
          const confidence = await WorkflowConfidenceService.computeForGate({
            templateVersionId: input.templateVersionId,
            stepId: input.stepId,
            stepDefinition: {
              isCritical: input.stepDefinition.isCritical,
              sideEffectClass: input.stepDefinition.sideEffectClass as
                | 'none'
                | 'idempotent'
                | 'reversible'
                | 'irreversible'
                | undefined,
            },
            subaccountId: input.subaccountId ?? null,
            organisationId: input.organisationId,
            upstreamConfidence: input.upstreamConfidence ?? null,
          });
          resolvedSeenConfidence = confidence;
        } catch (err) {
          logger.warn('workflow_gate_seen_confidence_build_failed', {
            stepId: input.stepId,
            organisationId: input.organisationId,
            error: err instanceof Error ? err.message : String(err),
          });
          resolvedSeenConfidence = null;
        }
      }
    }

    // Spec REQ 9-9 — every snapshot write goes through `normaliseApproverPoolSnapshot`
    // so `userInPool(snapshot, callerUuid)` checks cannot false-negative on
    // uppercase/duplicate inputs.
    const normalisedSnapshot = input.approverPoolSnapshot
      ? (normaliseApproverPoolSnapshot(input.approverPoolSnapshot) as unknown as ApproverPoolSnapshot)
      : null;

    try {
      const [row] = await tx
        .insert(workflowStepGates)
        .values({
          workflowRunId: input.workflowRunId,
          stepId: input.stepId,
          gateKind: input.gateKind,
          seenPayload: resolvedSeenPayload,
          seenConfidence: resolvedSeenConfidence,
          approverPoolSnapshot: normalisedSnapshot,
          isCriticalSynthesised: input.isCriticalSynthesised,
          organisationId: input.organisationId,
        })
        .returning();
      logger.info('workflow_step_gate_opened', {
        gateId: row.id,
        workflowRunId: input.workflowRunId,
        stepId: input.stepId,
        gateKind: input.gateKind,
      });

      // Spec REQ 9-11 — emit approval.queued or ask.queued so Chunk 11's
      // Approval / Ask card surfaces in real time. Pool size + fingerprint
      // are broadcast (not the full ID list) per the reduced-broadcast
      // contract that prevents pool-ID enumeration over WebSocket.
      const runForEmit = await this.loadWorkflowRunContext(
        input.workflowRunId,
        input.organisationId,
        tx,
      );
      if (runForEmit?.taskId) {
        const fingerprint = normalisedSnapshot
          ? poolFingerprint(normaliseApproverPoolSnapshot(normalisedSnapshot))
          : '';
        const poolSize = normalisedSnapshot?.length ?? 0;
        if (input.gateKind === 'ask') {
          const params = (input.stepDefinition?.params ?? {}) as Record<string, unknown>;
          void appendAndEmitTaskEvent(
            {
              taskId: runForEmit.taskId,
              organisationId: input.organisationId,
              subaccountId: input.subaccountId ?? null,
            },
            'gate',
            {
              kind: 'ask.queued',
              payload: {
                gateId: row.id,
                stepId: input.stepId,
                poolSize,
                poolFingerprint: fingerprint,
                schema: params.fields ?? null,
                prompt: typeof params.prompt === 'string' ? params.prompt : '',
              },
            },
          );
        } else {
          void appendAndEmitTaskEvent(
            {
              taskId: runForEmit.taskId,
              organisationId: input.organisationId,
              subaccountId: input.subaccountId ?? null,
            },
            'gate',
            {
              kind: 'approval.queued',
              payload: {
                gateId: row.id,
                stepId: input.stepId,
                poolSize,
                poolFingerprint: fingerprint,
                seenPayload: resolvedSeenPayload,
                seenConfidence: resolvedSeenConfidence,
              },
            },
          );
        }
      }

      // Schedule stall notifications (best-effort — gate is already open).
      // boss.send() uses its own connection outside the caller's drizzle tx.
      if (input.requesterUserId && input.workflowRunId) {
        WorkflowGateStallNotifyService.scheduleStallNotifications({
          gateId: row.id,
          gateCreatedAt: row.createdAt,
          workflowRunId: input.workflowRunId,
          requesterUserId: input.requesterUserId,
          organisationId: input.organisationId,
          gateKind: input.gateKind,
        }).catch(err2 => logger.warn('workflow_gate_stall_notify_schedule_failed_at_gate', {
          gateId: row.id,
          error: err2 instanceof Error ? err2.message : String(err2),
        }));
      }

      return row;
    } catch (err: unknown) {
      // 23505 = unique_violation — race condition; re-read and return existing row.
      if ((err as { code?: string })?.code === '23505') {
        logger.debug('workflow_step_gate_open_race_reread', {
          workflowRunId: input.workflowRunId,
          stepId: input.stepId,
        });
        const raceRow = await this.getOpenGate(input.workflowRunId, input.stepId, input.organisationId);
        if (raceRow) return raceRow;
        // Extremely unlikely: the concurrent insert was immediately resolved —
        // re-throw so the caller can decide.
        throw err;
      }
      throw err;
    }
  },

  /**
   * Resolve a single gate by id. Idempotent: if already resolved, logs a
   * warning when the reason differs but returns silently either way.
   *
   * The `tx` parameter is required.
   */
  async resolveGate(
    gateId: string,
    resolutionReason: GateResolutionReason,
    organisationId: string,
    tx: TxOrDb,
  ): Promise<void> {
    // §8.18: terminal-status write must call assertValidTransition. The CAS
    // predicate (isNull(resolvedAt)) is the correctness mechanism; this guard
    // is the observability requirement so the transition is recorded by the
    // workflow_step_gate state machine.
    assertValidTransition({
      kind: 'workflow_step_gate',
      recordId: gateId,
      from: 'open',
      to: 'resolved',
    });

    // Load run context — runCtx?.taskId is available for Chunk 9 event emission.
    // Best-effort: gate may already be resolved (idempotent path), so run may be
    // terminal. We load the gate first to get workflowRunId for the run lookup.
    const [gateRow] = await (tx as typeof db)
      .select({ workflowRunId: workflowStepGates.workflowRunId })
      .from(workflowStepGates)
      .where(eq(workflowStepGates.id, gateId));
    const runCtx = gateRow
      ? await this.loadWorkflowRunContext(gateRow.workflowRunId, organisationId, tx)
      : null;
    // runCtx?.taskId is now available for Chunk 9 event emission.
    void runCtx;

    const result = await tx
      .update(workflowStepGates)
      .set({
        resolvedAt: new Date(),
        resolutionReason,
      })
      .where(
        and(
          eq(workflowStepGates.id, gateId),
          eq(workflowStepGates.organisationId, organisationId),
          isNull(workflowStepGates.resolvedAt),
        ),
      )
      .returning({ id: workflowStepGates.id });

    if (result.length === 0) {
      // Already resolved — idempotent hit. Log a warning if the reason differs.
      const [existing] = await (tx as typeof db)
        .select({ resolutionReason: workflowStepGates.resolutionReason })
        .from(workflowStepGates)
        .where(eq(workflowStepGates.id, gateId));

      if (existing && existing.resolutionReason !== resolutionReason) {
        logger.warn('workflow_step_gate_resolve_reason_mismatch', {
          gateId,
          existingReason: existing.resolutionReason,
          requestedReason: resolutionReason,
        });
      } else {
        logger.debug('workflow_step_gate_resolve_idempotent', { gateId, resolutionReason });
      }
    } else {
      logger.info('workflow_step_gate_resolved', { gateId, resolutionReason, organisationId });
    }

    // Best-effort: cancelStallNotifications swallows errors internally, no catch needed.
    void WorkflowGateStallNotifyService.cancelStallNotifications(gateId);
  },

  /**
   * Bulk-resolve all open gates for a run (orphaned-gate cascade). Called by
   * cancelRun and failRun BEFORE their status update.
   *
   * The `tx` parameter is required.
   */
  async resolveOpenGatesForRun(
    workflowRunId: string,
    organisationId: string,
    tx: TxOrDb,
  ): Promise<{ resolved: number }> {
    // Pre-fetch open gate IDs so each transition is logged via
    // assertValidTransition (§8.18 observability requirement). Bulk UPDATE with
    // the same WHERE predicate then executes; the CAS guarantees no double-write.
    const openGates = await (tx as typeof db)
      .select({ id: workflowStepGates.id })
      .from(workflowStepGates)
      .where(
        and(
          eq(workflowStepGates.workflowRunId, workflowRunId),
          eq(workflowStepGates.organisationId, organisationId),
          isNull(workflowStepGates.resolvedAt),
        ),
      );
    for (const g of openGates) {
      assertValidTransition({
        kind: 'workflow_step_gate',
        recordId: g.id,
        from: 'open',
        to: 'resolved',
      });
    }

    const result = await tx
      .update(workflowStepGates)
      .set({
        resolvedAt: new Date(),
        resolutionReason: 'run_terminated' as GateResolutionReason,
      })
      .where(
        and(
          eq(workflowStepGates.workflowRunId, workflowRunId),
          eq(workflowStepGates.organisationId, organisationId),
          isNull(workflowStepGates.resolvedAt),
        ),
      )
      .returning({ id: workflowStepGates.id });

    // Cancel stall notifications for each resolved gate (best-effort — stale-fire
    // guard is the durable safety net). cancelStallNotifications swallows errors
    // internally so no catch needed per gate.
    for (const resolvedGate of result) {
      WorkflowGateStallNotifyService.cancelStallNotifications(resolvedGate.id)
        .catch(err => logger.warn('workflow_gate_stall_notify_cancel_failed', {
          gateId: resolvedGate.id,
          error: err instanceof Error ? err.message : String(err),
        }));
    }

    return { resolved: result.length };
  },

  /**
   * Refresh the approver pool snapshot on an open gate.
   * Returns `{ refreshed: false }` if the gate is already resolved.
   *
   * The `tx` parameter is required.
   */
  async refreshPool(
    gateId: string,
    organisationId: string,
    newSnapshot: ApproverPoolSnapshot,
    tx: TxOrDb,
  ): Promise<{ refreshed: boolean; poolSize?: number; reason?: string }> {
    // Spec REQ 9-9 — normalise on every write site.
    const normalisedSnapshot = normaliseApproverPoolSnapshot(newSnapshot) as unknown as ApproverPoolSnapshot;
    const result = await tx
      .update(workflowStepGates)
      .set({ approverPoolSnapshot: normalisedSnapshot })
      .where(
        and(
          eq(workflowStepGates.id, gateId),
          eq(workflowStepGates.organisationId, organisationId),
          isNull(workflowStepGates.resolvedAt),
        ),
      )
      .returning({ id: workflowStepGates.id });

    if (result.length === 0) {
      return { refreshed: false, reason: 'gate_already_resolved' };
    }
    return { refreshed: true, poolSize: newSnapshot.length };
  },
};
