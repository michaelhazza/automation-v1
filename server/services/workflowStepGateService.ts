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
import { workflowStepGates, workflowStepRuns } from '../db/schema/index.js';
import type {
  WorkflowStepGate,
  WorkflowStepGateKind,
  WorkflowStepGateResolutionReason,
  NewWorkflowStepGate,
} from '../db/schema/index.js';
import type { SeenPayload, SeenConfidence } from '../../shared/types/workflowStepGate.js';
import { logger } from '../lib/logger.js';

export interface OpenGateInput {
  workflowRunId: string;
  stepId: string;
  gateKind: WorkflowStepGateKind;
  seenPayload?: SeenPayload | null;
  seenConfidence?: SeenConfidence | null;
  approverPoolSnapshot?: string[] | null;
  isCriticalSynthesised?: boolean;
  organisationId: string;
}

export const WorkflowStepGateService = {
  /**
   * Open a gate for the given (workflowRunId, stepId) pair.
   *
   * Idempotent: if an open gate already exists, returns it without inserting.
   * Handles concurrent INSERT races via 23505 unique-constraint catch + re-read.
   */
  async openGate(input: OpenGateInput, tx: OrgScopedTx): Promise<WorkflowStepGate> {
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
      return existing[0];
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
      return gate;
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
        return winner;
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
  ): Promise<void> {
    // Enforce gate state machine: open → resolved. 'resolved' is terminal so
    // resolved→resolved (idempotent) is handled by the 0-rows-updated path below.
    assertValidGateTransition(gateId, 'open', 'resolved');

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

      if (!existing) return; // Gate doesn't exist — no-op

      if (existing.resolutionReason === resolutionReason) {
        // Same reason — idempotent
        return;
      }

      // Different reason — first committer won; log warning but don't throw
      logger.warn('workflow_step_gate_resolve_conflict', {
        gateId,
        existingReason: existing.resolutionReason,
        attemptedReason: resolutionReason,
        message: 'Gate already resolved with a different reason — first committer wins',
      });
    }
  },

  /**
   * Bulk-resolve all open gates for a run (orphaned-gate cascade).
   * Called from failRun / cancelRun / succeedRun.
   */
  async resolveOpenGatesForRun(
    workflowRunId: string,
    resolutionReason: 'run_terminated',
    organisationId: string,
    tx: OrgScopedTx
  ): Promise<{ resolved: number }> {
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
