/**
 * WorkflowGateRefreshPoolService — re-resolves the approver pool on an open gate.
 *
 * Called from the refresh-pool API route (POST /api/tasks/:taskId/gates/:gateId/refresh-pool).
 * Loads the gate, resolves the run and step definition, re-computes the pool
 * from the step's approverGroup, and updates the gate in a transaction.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  workflowStepGates,
  workflowRuns,
  workflowTemplateVersions,
  systemWorkflowTemplateVersions,
} from '../db/schema/index.js';
import type { WorkflowRun } from '../db/schema/index.js';
import type { WorkflowDefinition } from '../lib/workflow/types.js';
import { WorkflowApproverPoolService } from './workflowApproverPoolService.js';
import { WorkflowStepGateService } from './workflowStepGateService.js';
import type { ApproverGroup } from '../../shared/types/workflowStepGate.js';
import { logger } from '../lib/logger.js';

// ─── Definition helpers (mirrors workflowEngineService private helpers) ──────

function rehydrateDefinition(stored: Record<string, unknown>): WorkflowDefinition {
  return stored as unknown as WorkflowDefinition;
}

async function loadDefinitionForRun(run: WorkflowRun): Promise<WorkflowDefinition | null> {
  const dbRead = getOrgScopedDb('workflowGateRefreshPoolService.loadDefinitionForRun');
  const [orgVer] = await dbRead
    .select()
    .from(workflowTemplateVersions)
    .where(
      and(
        eq(workflowTemplateVersions.id, run.templateVersionId),
        eq(workflowTemplateVersions.organisationId, run.organisationId)
      )
    );
  if (orgVer) return rehydrateDefinition(orgVer.definitionJson as Record<string, unknown>);

  const [sysVer] = await db
    .select()
    .from(systemWorkflowTemplateVersions)
    .where(eq(systemWorkflowTemplateVersions.id, run.templateVersionId));
  if (sysVer) return rehydrateDefinition(sysVer.definitionJson as Record<string, unknown>);

  return null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const WorkflowGateRefreshPoolService = {
  /**
   * Re-resolve the approver pool for an open gate and write the new snapshot.
   *
   * Returns { refreshed: true, pool_size } on success or
   * { refreshed: false, reason: 'gate_already_resolved' } when the gate is
   * already closed.
   */
  async refreshPool(
    taskId: string,
    gateId: string,
    organisationId: string,
    subaccountId: string | null,
    _callerUserId: string
  ): Promise<{ refreshed: boolean; pool_size?: number; reason?: string }> {
    // 1. Load the gate (tenant-scoped, open only).
    const dbRead = getOrgScopedDb('workflowGateRefreshPoolService.refreshPool');
    const [gate] = await dbRead
      .select()
      .from(workflowStepGates)
      .where(
        and(
          eq(workflowStepGates.id, gateId),
          eq(workflowStepGates.organisationId, organisationId),
          isNull(workflowStepGates.resolvedAt)
        )
      );

    if (!gate) {
      // Gate doesn't exist or is already resolved.
      return { refreshed: false, reason: 'gate_already_resolved' };
    }

    // 2. Load the run (to get runId + startedByUserId context).
    const [run] = await dbRead
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.id, gate.workflowRunId),
          eq(workflowRuns.organisationId, organisationId)
        )
      );

    if (!run) {
      throw {
        statusCode: 404,
        message: 'Workflow run not found for gate',
        errorCode: 'run_not_found',
      };
    }

    // 3. Load the step definition to get approverGroup.
    const def = await loadDefinitionForRun(run);
    if (!def) {
      throw {
        statusCode: 404,
        message: 'Workflow definition not found for run',
        errorCode: 'definition_not_found',
      };
    }

    const step = def.steps.find((s) => s.id === gate.stepId);
    if (!step) {
      throw {
        statusCode: 404,
        message: `Step ${gate.stepId} not found in workflow definition`,
        errorCode: 'step_not_found',
      };
    }

    // Extract approverGroup from step params.
    const approverGroup = (step.params?.approverGroup ?? null) as ApproverGroup | null;
    if (!approverGroup) {
      // Step has no approverGroup — nothing to refresh.
      logger.debug('workflow_gate_refresh_pool_no_approver_group', {
        gateId,
        stepId: gate.stepId,
        runId: run.id,
      });
      return { refreshed: false, reason: 'no_approver_group' };
    }

    // 4. Resolve the new pool.
    const runContext = { taskId, runId: run.id };
    const newSnapshot = await WorkflowApproverPoolService.resolvePool(
      approverGroup,
      runContext,
      organisationId,
      subaccountId
    );

    // 5. Write the updated pool snapshot in a transaction.
    const result = await db.transaction(async (tx) => {
      return WorkflowStepGateService.refreshPool(gateId, organisationId, newSnapshot, tx);
    });

    if (!result.refreshed) {
      return { refreshed: false, reason: result.reason };
    }

    logger.info('workflow_gate_pool_refreshed', {
      event: 'gate.pool_refreshed',
      gateId,
      stepId: gate.stepId,
      runId: run.id,
      poolSize: newSnapshot.length,
    });

    return { refreshed: true, pool_size: newSnapshot.length };
  },
};
