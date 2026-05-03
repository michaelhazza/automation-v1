/**
 * WorkflowStepGateService — create, resolve, and query workflow step gates.
 *
 * All write methods accept an `OrgScopedTx` and never open their own
 * transactions. Read-only lookups use `getOrgScopedDb` where applicable.
 *
 * Gate-resolution precedence: the first committer wins. On 0-rows-updated,
 * check the existing gate rather than throwing — the caller may be a cascade.
 */

import { eq, and, isNull, sql } from 'drizzle-orm';
import { assertValidGateTransition } from '../../shared/stateMachineGuards.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import type { OrgScopedTx } from '../db/index.js';
import { workflowStepGates, workflowStepRuns, workflowRuns } from '../db/schema/index.js';
import type {
  WorkflowStepGate,
  WorkflowStepGateKind,
  WorkflowStepGateResolutionReason,
  NewWorkflowStepGate,
} from '../db/schema/index.js';
import type { SeenPayload, SeenConfidence } from '../../shared/types/workflowStepGate.js';
import { logger } from '../lib/logger.js';
import { WorkflowGateStallNotifyService } from './workflowGateStallNotifyService.js';
import { TaskEventService } from './taskEventService.js';

export interface OpenGateInput {
  workflowRunId: string;
  stepId: string;
  gateKind: WorkflowStepGateKind;
  seenPayload?: SeenPayload | null;
  seenConfidence?: SeenConfidence | null;
  approverPoolSnapshot?: string[] | null;
  isCriticalSynthesised?: boolean;
  organisationId: string;
  /**
   * Stable ID for the stall-notify payload. Pass `run.taskId ?? run.id`
   * (migration 0269 adds taskId; run.id is the fallback for runs without
   * task context). The gate's own run ID is always a valid navigation target.
   */
  taskId: string;
  /**
   * The user who started the run — used as the notification recipient for
   * stall-and-notify cadences (spec §5.3). Sourced from
   * workflowRuns.startedByUserId at the call site. Null for system-initiated
   * runs (no user to notify); stall jobs are skipped when null.
   */
  requesterUserId: string | null;
}

export const WorkflowStepGateService = {
  /**
   * Open a gate for the given (workflowRunId, stepId) pair.
   *
   * Idempotent: if an open gate already exists, returns it without inserting.
   * Handles concurrent INSERT races via 23505 unique-constraint catch + re-read.
   */
  async openGate(input: OpenGateInput, tx: OrgScopedTx): Promise<WorkflowStepGate & { emitAfterCommit: () => Promise<void> }> {
    // A no-op emit closure for the idempotent-hit and race paths (gate already exists).
    const noopEmit = async (): Promise<void> => { /* gate already existed — no new emit */ };

    // Pre-check: is there already an open gate for this (run, step)?
    const existing = await tx
      .select()
      .from(workflowStepGates)
      .where(
        and(
          eq(workflowStepGates.workflowRunId, input.workflowRunId),
          eq(workflowStepGates.stepId, input.stepId),
          eq(workflowStepGates.organisationId, input.organisationId),
          isNull(workflowStepGates.resolvedAt)
        )
      );
    if (existing.length > 0) {
      return { ...existing[0], emitAfterCommit: noopEmit };
    }

    const values: NewWorkflowStepGate = {
      workflowRunId: input.workflowRunId,
      stepId: input.stepId,
      gateKind: input.gateKind,
      seenPayload: input.seenPayload ?? null,
      seenConfidence: input.seenConfidence ?? null,
      approverPoolSnapshot: input.approverPoolSnapshot ?? null,
      isCriticalSynthesised: input.isCriticalSynthesised ?? false,
      organisationId: input.organisationId,
    };

    try {
      const [gate] = await tx.insert(workflowStepGates).values(values).returning();

      // Task-scoped approval.queued event (B3 fix).
      // openGate runs inside the caller's tx; emit is deferred until after commit
      // via the B1 deferred-emit pattern. We capture the necessary data from
      // `input` and `gate` here (inside the tx) and close over them in the emit fn.
      // ask.queued: Ask gate path lands in Chunk 12 — event emission ready then.
      const emitApprovalQueued = async (): Promise<void> => {
        if (!input.taskId) return;
        await TaskEventService.appendAndEmit({
          taskId: input.taskId,
          runId: null, // no agent_run context at gate-open time (orchestrator path)
          organisationId: input.organisationId,
          eventOrigin: 'gate',
          event: {
            kind: 'approval.queued',
            payload: {
              gateId: gate.id,
              stepId: input.stepId,
              approverPool: input.approverPoolSnapshot ?? [],
              seenPayload: input.seenPayload ?? {} as SeenPayload,
              seenConfidence: input.seenConfidence ?? {} as SeenConfidence,
            },
          },
        // appendAndEmit without tx — will commit its own tx and emit immediately.
        }).catch((err) => {
          logger.warn('task_event_approval_queued_emit_failed', {
            event: 'task_event.approval_queued_emit_failed',
            gateId: gate.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      };
      // Spec §5.3: schedule stall-and-notify jobs after gate insert.
      // Done outside the caller's transaction context (pg-boss is independent
      // of the Postgres tx). Best-effort — errors are caught inside the
      // service so a pg-boss hiccup never blocks gate-open.
      // The in-handler stale-fire guard handles the case where the tx later
      // rolls back (gate missing -> no-op) or the gate resolves before fire.
      // requesterUserId is null for system-initiated runs; skip scheduling
      // stall jobs when there is no user to notify.
      if (input.requesterUserId !== null) {
        WorkflowGateStallNotifyService.scheduleStallNotifications(
          gate.id,
          gate.createdAt,
          input.taskId,
          input.requesterUserId,
          input.organisationId,
        ).catch((err) => {
          logger.error('workflow_step_gate_stall_schedule_failed', {
            event: 'gate.stall_schedule_failed',
            gateId: gate.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      return { ...gate, emitAfterCommit: emitApprovalQueued };
    } catch (err: unknown) {
      // 23505 = unique_violation — concurrent INSERT race on (workflowRunId, stepId)
      const pgCode = (err as { code?: string }).code;
      if (pgCode === '23505') {
        logger.debug('workflow_step_gate_concurrent_insert_race', {
          workflowRunId: input.workflowRunId,
          stepId: input.stepId,
        });
        // Re-read the winner row (may now be resolved if something raced us)
        const [winner] = await tx
          .select()
          .from(workflowStepGates)
          .where(
            and(
              eq(workflowStepGates.workflowRunId, input.workflowRunId),
              eq(workflowStepGates.stepId, input.stepId),
              eq(workflowStepGates.organisationId, input.organisationId)
            )
          );
        if (!winner) {
          throw err; // Something very wrong — rethrow original
        }
        // Race: another inserter won; no new emit from us (they handle it).
        return { ...winner, emitAfterCommit: noopEmit };
      }
      throw err;
    }
  },

  /**
   * Resolve a gate. First-committer-wins: on 0 rows updated, checks the
   * existing gate — same reason is idempotent, different reason logs a warning.
   * Never throws on 0 rows (caller may be a cascade).
   */
  async resolveGate(
    gateId: string,
    resolutionReason: WorkflowStepGateResolutionReason,
    organisationId: string,
    tx: OrgScopedTx
  ): Promise<{ emitAfterCommit: () => Promise<void> }> {
    // Enforce gate state machine: open → resolved. 'resolved' is terminal so
    // resolved→resolved (idempotent) is handled by the 0-rows-updated path below.
    assertValidGateTransition(gateId, 'open', 'resolved');

    // Spec §5.3: cancel stall-notify jobs BEFORE setting resolved_at so that
    // the cancel attempt runs against the still-open row state. Best-effort:
    // the stale-fire guard in the handler is the durable safety net.
    await WorkflowGateStallNotifyService.cancelStallNotifications(gateId).catch((err) => {
      logger.error('workflow_step_gate_stall_cancel_failed', {
        event: 'gate.stall_cancel_failed',
        gateId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    const updated = await tx
      .update(workflowStepGates)
      .set({ resolvedAt: new Date(), resolutionReason })
      .where(
        and(
          eq(workflowStepGates.id, gateId),
          eq(workflowStepGates.organisationId, organisationId),
          isNull(workflowStepGates.resolvedAt)
        )
      )
      .returning({ id: workflowStepGates.id });

    const noopEmit = async (): Promise<void> => { /* no new emit needed */ };

    if (updated.length === 0) {
      // Gate was already resolved — look up and compare
      const [existing] = await tx
        .select({
          id: workflowStepGates.id,
          resolutionReason: workflowStepGates.resolutionReason,
        })
        .from(workflowStepGates)
        .where(
          and(
            eq(workflowStepGates.id, gateId),
            eq(workflowStepGates.organisationId, organisationId)
          )
        );

      if (!existing) return { emitAfterCommit: noopEmit }; // Gate doesn't exist — no-op

      if (existing.resolutionReason === resolutionReason) {
        // Same reason — idempotent
        return { emitAfterCommit: noopEmit };
      }

      // Different reason — first committer won; log warning but don't throw
      logger.warn('workflow_step_gate_resolve_conflict', {
        gateId,
        existingReason: existing.resolutionReason,
        attemptedReason: resolutionReason,
        message: 'Gate already resolved with a different reason — first committer wins',
      });
      return { emitAfterCommit: noopEmit };
    }

    // Task-scoped approval.decided event (B3 fix).
    // Look up the gate row (inside tx) to get workflowRunId, then look up the run
    // to get taskId. Emit is deferred until after the caller's tx commits.
    const [gateRow] = await tx
      .select({ workflowRunId: workflowStepGates.workflowRunId })
      .from(workflowStepGates)
      .where(eq(workflowStepGates.id, gateId));

    const taskIdForEmit = gateRow
      ? await (async () => {
          const [runRow] = await tx
            .select({ taskId: workflowRuns.taskId })
            .from(workflowRuns)
            .where(eq(workflowRuns.id, gateRow.workflowRunId));
          return (runRow as { taskId?: string | null } | undefined)?.taskId ?? null;
        })()
      : null;

    const emitApprovalDecided = async (): Promise<void> => {
      if (!taskIdForEmit) return;
      // Only emit for approval gates (resolutionReason is 'approved' or 'rejected').
      // 'submitted' is an ask-gate path; 'run_terminated' is a cascade.
      if (resolutionReason !== 'approved' && resolutionReason !== 'rejected') return;
      await TaskEventService.appendAndEmit({
        taskId: taskIdForEmit,
        runId: null, // no agent_run context at gate-resolve time
        organisationId,
        eventOrigin: 'gate',
        event: {
          kind: 'approval.decided',
          payload: {
            gateId,
            decidedBy: 'system', // actual decidedBy is not threaded to resolveGate; Chunk 10 can refine
            decision: resolutionReason as 'approved' | 'rejected',
          },
        },
      }).catch((err) => {
        logger.warn('task_event_approval_decided_emit_failed', {
          event: 'task_event.approval_decided_emit_failed',
          gateId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    };

    return { emitAfterCommit: emitApprovalDecided };
  },

  /**
   * Bulk-resolve all open gates for a run (orphaned-gate cascade).
   * Called from failRun / cancelRun / succeedRun.
   *
   * Order: cancel stall jobs FIRST, then UPDATE resolved_at. This minimises
   * the window in which stale stall jobs fire. Cancel errors are caught per
   * gate (best-effort); the stale-fire guard in the handler is the safety net
   * for any cancel that fails.
   */
  async resolveOpenGatesForRun(
    workflowRunId: string,
    resolutionReason: 'run_terminated',
    organisationId: string,
    tx: OrgScopedTx
  ): Promise<{ resolved: number }> {
    // Collect open gate IDs before the bulk UPDATE so we can cancel their
    // stall-notify jobs. The SELECT and the UPDATE both target the same
    // predicate, so IDs are consistent within this tx.
    const openGates = await tx
      .select({ id: workflowStepGates.id })
      .from(workflowStepGates)
      .where(
        and(
          eq(workflowStepGates.workflowRunId, workflowRunId),
          eq(workflowStepGates.organisationId, organisationId),
          isNull(workflowStepGates.resolvedAt)
        )
      );

    // Cancel stall jobs before setting resolved_at so cancellation runs against
    // still-open state. Best-effort per gate; bulk cascade must not block on cancel.
    await Promise.all(
      openGates.map(({ id }) =>
        WorkflowGateStallNotifyService.cancelStallNotifications(id).catch((err) => {
          logger.error('workflow_step_gate_stall_cancel_failed', {
            event: 'gate.stall_cancel_failed',
            gateId: id,
            workflowRunId,
            error: err instanceof Error ? err.message : String(err),
          });
        })
      )
    );

    const result = await tx.execute(
      sql`
        UPDATE workflow_step_gates
        SET resolved_at = NOW(), resolution_reason = ${resolutionReason}
        WHERE workflow_run_id = ${workflowRunId}
          AND organisation_id = ${organisationId}
          AND resolved_at IS NULL
      `
    );
    const rowCount = (result as { rowCount?: number }).rowCount ?? 0;
    return { resolved: rowCount };
  },

  /**
   * Read-only lookup for an open gate by (workflowRunId, stepId).
   * Does NOT accept a tx — callers use this before opening their transaction.
   * Uses getOrgScopedDb.
   */
  async getOpenGate(
    workflowRunId: string,
    stepId: string,
    organisationId: string
  ): Promise<WorkflowStepGate | null> {
    const db = getOrgScopedDb('workflowStepGateService.getOpenGate');
    const [gate] = await db
      .select()
      .from(workflowStepGates)
      .where(
        and(
          eq(workflowStepGates.workflowRunId, workflowRunId),
          eq(workflowStepGates.stepId, stepId),
          eq(workflowStepGates.organisationId, organisationId),
          isNull(workflowStepGates.resolvedAt)
        )
      );
    return gate ?? null;
  },

  /**
   * Look up an open gate by step run id (used by routes).
   * Resolves the step run to get stepId, then delegates to getOpenGate.
   */
  async getOpenGateByRunAndStepRun(
    runId: string,
    stepRunId: string,
    orgId: string
  ): Promise<WorkflowStepGate | null> {
    const db = getOrgScopedDb('workflowStepGateService.getOpenGateByRunAndStepRun');
    const [stepRun] = await db
      .select()
      .from(workflowStepRuns)
      .where(and(eq(workflowStepRuns.id, stepRunId), eq(workflowStepRuns.runId, runId)));
    if (!stepRun) return null;

    const [gate] = await db
      .select()
      .from(workflowStepGates)
      .where(
        and(
          eq(workflowStepGates.workflowRunId, runId),
          eq(workflowStepGates.stepId, stepRun.stepId),
          eq(workflowStepGates.organisationId, orgId),
          isNull(workflowStepGates.resolvedAt)
        )
      );
    return gate ?? null;
  },

  /**
   * Refresh the approver pool snapshot on an open gate.
   * Called from a transaction — accepts tx.
   */
  async refreshPool(
    gateId: string,
    organisationId: string,
    newSnapshot: string[],
    tx: OrgScopedTx
  ): Promise<{ refreshed: boolean; poolSize?: number; reason?: string }> {
    const updated = await tx
      .update(workflowStepGates)
      .set({ approverPoolSnapshot: newSnapshot })
      .where(
        and(
          eq(workflowStepGates.id, gateId),
          eq(workflowStepGates.organisationId, organisationId),
          isNull(workflowStepGates.resolvedAt)
        )
      )
      .returning({ id: workflowStepGates.id });

    if (updated.length === 0) {
      return { refreshed: false, reason: 'gate_already_resolved' };
    }
    return { refreshed: true, poolSize: newSnapshot.length };
  },
};
