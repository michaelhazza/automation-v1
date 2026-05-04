/**
 * WorkflowGateRefreshPoolService — refresh the approver pool snapshot on an
 * open gate.
 *
 * Spec: docs/workflows-dev-spec.md §5.1.2 (/refresh-pool admin endpoint).
 *
 * Loads the gate, resolves the pool from the step's approverGroup in the
 * template definition, then calls WorkflowStepGateService.refreshPool to
 * write the new snapshot.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { DB } from '../db/index.js';
import {
  workflowStepGates,
  workflowRuns,
  workflowTemplateVersions,
  systemWorkflowTemplateVersions,
} from '../db/schema/index.js';
import type { WorkflowDefinition } from '../lib/workflow/types.js';
import { WorkflowStepGateService } from './workflowStepGateService.js';
import { WorkflowApproverPoolService } from './workflowApproverPoolService.js';
import type { ApproverGroup } from '../../shared/types/workflowApproverGroup.js';
import { appendAndEmitTaskEvent } from './taskEventService.js';
import { normaliseApproverPoolSnapshot, poolFingerprint } from '../../shared/types/approverPoolSnapshot.js';
import { logger } from '../lib/logger.js';

// Transaction-aware db handle
type TxOrDb = DB | Parameters<Parameters<DB['transaction']>[0]>[0];

function rehydrateDefinition(stored: Record<string, unknown>): WorkflowDefinition {
  return stored as unknown as WorkflowDefinition;
}

export const WorkflowGateRefreshPoolService = {
  async refreshPool(
    gateId: string,
    taskId: string, // surfaced in audit log; V2: join to task for subaccount-scoped permission check
    organisationId: string,
    requestingUserId: string,
    tx?: TxOrDb,
  ): Promise<{ found: boolean; refreshed: boolean; reason?: string; poolSize: number }> {
    const dbHandle = tx ?? db;

    // Step 1: load gate by ID (any resolution state — split not-found from already-resolved)
    const [gate] = await (dbHandle as typeof db)
      .select()
      .from(workflowStepGates)
      .where(
        and(
          eq(workflowStepGates.id, gateId),
          eq(workflowStepGates.organisationId, organisationId),
        ),
      );

    if (!gate) {
      return { found: false, refreshed: false, poolSize: 0 };
    }

    if (gate.resolvedAt !== null) {
      return { found: true, refreshed: false, reason: 'gate_already_resolved', poolSize: 0 };
    }

    // Step 2: load the run for runContext
    const [run] = await (dbHandle as typeof db)
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.id, gate.workflowRunId),
          eq(workflowRuns.organisationId, organisationId),
        ),
      );

    if (!run) {
      logger.warn('workflow_gate_refresh_pool_run_not_found', {
        gateId,
        workflowRunId: gate.workflowRunId,
        organisationId,
        requestingUserId,
      });
      return { found: true, refreshed: false, reason: 'run_not_found', poolSize: 0 };
    }

    const runContext = {
      runId: run.id,
      organisationId: run.organisationId,
      subaccountId: run.subaccountId,
      taskId: run.taskId,
    };

    // Step 3: load the template definition to find the approverGroup for this step
    let def: WorkflowDefinition | null = null;

    const [orgVer] = await (dbHandle as typeof db)
      .select()
      .from(workflowTemplateVersions)
      .where(eq(workflowTemplateVersions.id, run.templateVersionId));

    if (orgVer) {
      def = rehydrateDefinition(orgVer.definitionJson as Record<string, unknown>);
    } else {
      const [sysVer] = await (dbHandle as typeof db)
        .select()
        .from(systemWorkflowTemplateVersions)
        .where(eq(systemWorkflowTemplateVersions.id, run.templateVersionId));
      if (sysVer) {
        def = rehydrateDefinition(sysVer.definitionJson as Record<string, unknown>);
      }
    }

    if (!def) {
      logger.warn('workflow_gate_refresh_pool_definition_not_found', {
        gateId,
        templateVersionId: run.templateVersionId,
        requestingUserId,
      });
      return { found: true, refreshed: false, reason: 'definition_not_found', poolSize: 0 };
    }

    const stepDef = def.steps.find((s) => s.id === gate.stepId);
    if (!stepDef) {
      logger.warn('workflow_gate_refresh_pool_step_not_found', {
        gateId,
        stepId: gate.stepId,
        requestingUserId,
      });
      return { found: true, refreshed: false, reason: 'step_not_found', poolSize: 0 };
    }

    const approverGroup = stepDef.params?.approverGroup as ApproverGroup | undefined;
    if (!approverGroup) {
      logger.warn('workflow_gate_refresh_pool_no_approver_group', {
        gateId,
        stepId: gate.stepId,
        requestingUserId,
      });
      return { found: true, refreshed: false, reason: 'no_approver_group', poolSize: 0 };
    }

    // Step 4: resolve the pool
    const newSnapshot = await WorkflowApproverPoolService.resolvePool(
      approverGroup,
      runContext,
      tx,
    );

    // Step 5: write the new snapshot
    const result = await WorkflowStepGateService.refreshPool(
      gateId,
      organisationId,
      newSnapshot,
      dbHandle,
    );

    if (!result.refreshed) {
      return { found: true, refreshed: false, reason: result.reason ?? 'gate_already_resolved', poolSize: 0 };
    }

    // V2: verify workflow_runs.subaccount_id matches the task's subaccount_id for subaccount-scoped permission check
    logger.info('workflow_gate_pool_refreshed', {
      gateId,
      taskId,
      poolSize: newSnapshot.length,
      organisationId,
      requestingUserId,
    });

    // Spec REQ 9-10 — emit approval.pool_refreshed so all open Approval cards
    // can update their reviewer-count display without a full reconcile.
    if (run.taskId) {
      const normalised = normaliseApproverPoolSnapshot(newSnapshot);
      const fingerprint = poolFingerprint(normalised);
      const stepDefForQuorum = def.steps.find((s) => s.id === gate.stepId);
      const quorum = (stepDefForQuorum?.params?.quorum as number | undefined) ?? 1;
      void appendAndEmitTaskEvent(
        {
          taskId: run.taskId,
          organisationId: run.organisationId,
          subaccountId: run.subaccountId,
        },
        'gate',
        {
          kind: 'approval.pool_refreshed',
          payload: {
            gateId,
            actorId: requestingUserId,
            newPoolSize: newSnapshot.length,
            newPoolFingerprint: fingerprint,
            stillBelowQuorum: newSnapshot.length < quorum,
          },
        },
      );
    }

    return { found: true, refreshed: true, poolSize: newSnapshot.length };
  },
};
