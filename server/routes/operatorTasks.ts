// operatorTasks.ts — task-action routes for operator-managed tasks.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §6.5b
//
// Routes (all POST):
//   retry-chain-failure       — assigned user OR manager+ (AGENT_RUN_WRITE → AGENTS_EDIT)
//   extend-budget             — assigned user OR manager+ (AGENTS_EDIT)
//   fresh-profile-restart     — org_admin only (AGENTS_EDIT + admin check)
//   refresh-credential        — org_admin only (AGENTS_EDIT + admin check)
//   extend-debug-retention    — org_admin only (AGENTS_EDIT + admin check)
//
// R2-F1 enqueue-only invariant: retry-chain-failure and extend-budget MUST NOT
// transition agent_runs.status. Only the dispatcher (pg-boss handler) writes
// paused_* → delegated. Routes reset the failure counter and enqueue a dispatch job.
//
// R2-F2 GUC split: these routes read agent_runs (org-scoped RLS) via the
// authenticate middleware tx. Operator-table access goes via service calls that
// call setOrgAndSubaccountGUC internally. No plain setOrgGUC call here.

import { Router } from 'express';
import { z } from 'zod';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { db } from '../db/index.js';
import { agentRuns, operatorRuns } from '../db/schema/index.js';
import { setOrgAndSubaccountGUC, setOrgGUC } from '../lib/orgScoping.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { auditService } from '../services/auditService.js';
import { operatorTaskProfileService } from '../services/operatorTaskProfileService.js';
import { credentialBrokerService } from '../services/credentialBrokerService.js';
import { OperatorBackendConflictError } from '../services/operatorBackendErrors.js';
import { OPERATOR_DISPATCH_NEXT_CHAIN_LINK_QUEUE } from '../jobs/operatorSessionDispatchNextChainLinkHandler.js';
import {
  evaluateRouteActorRule,
  type ActorRoleLevel,
} from './operatorRouteActorRulePure.js';
import { decideFreshProfileRestartAllowed } from './freshProfileRestartPredicatePure.js';

const router = Router();

// ── Shared helpers ───────────────────────────────────────────────────────────

function resolveActorRole(role: string): ActorRoleLevel {
  if (role === 'org_admin') return 'org_admin';
  if (role === 'manager') return 'manager';
  if (role === 'system_admin') return 'system_admin';
  if (role === 'client_user') return 'client_user';
  return 'user';
}

async function readAgentRunOrThrow(agentRunId: string, orgId: string) {
  const [run] = await db
    .select({
      id: agentRuns.id,
      status: agentRuns.status,
      organisationId: agentRuns.organisationId,
      subaccountId: agentRuns.subaccountId,
      operatorChainFailureCount: agentRuns.operatorChainFailureCount,
    })
    .from(agentRuns)
    .where(and(eq(agentRuns.id, agentRunId), eq(agentRuns.organisationId, orgId)))
    .limit(1);

  if (!run) {
    throw { statusCode: 404, message: 'agent_run not found', errorCode: 'AGENT_RUN_NOT_FOUND' };
  }
  return run;
}

// ── POST /api/operator-tasks/:agentRunId/retry-chain-failure ─────────────────
//
// Rev 2 F1 — enqueue-only.
// Precondition: task.status === 'paused_chain_failure'.
// Action: reset operator_chain_failure_count=0, write audit, enqueue dispatch job.
// Does NOT transition agent_runs.status.
router.post(
  '/api/operator-tasks/:agentRunId/retry-chain-failure',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { agentRunId } = req.params;
    const orgId = req.orgId!;
    const actor = req.user!;

    const run = await readAgentRunOrThrow(agentRunId, orgId);

    const actorCheck = evaluateRouteActorRule({
      actorUserId: actor.id,
      actorRole: resolveActorRole(actor.role),
      assignedUserId: null,
      routeRequiresAdmin: false,
    });
    if (!actorCheck.allowed) {
      throw { statusCode: 403, message: 'Forbidden', errorCode: actorCheck.reason ?? 'FORBIDDEN' };
    }

    if (run.status !== 'paused_chain_failure') {
      throw new OperatorBackendConflictError({
        kind: 'TASK_ALREADY_TERMINAL',
        currentState: { status: run.status },
      });
    }

    // Reset failure counter (enqueue-only: no status transition)
    await db
      .update(agentRuns)
      .set({ operatorChainFailureCount: 0 })
      .where(eq(agentRuns.id, agentRunId));

    void auditService.log({
      organisationId: orgId,
      actorId: actor.id,
      actorType: 'user',
      action: 'task.operator.chain_failure_retried',
      entityType: 'agent_run',
      entityId: agentRunId,
      metadata: { agent_run_id: agentRunId, request_id: req.correlationId },
    });

    const boss = await getPgBoss();
    await boss.send(OPERATOR_DISPATCH_NEXT_CHAIN_LINK_QUEUE, {
      agentRunId,
      organisationId: orgId,
      subaccountId: run.subaccountId!,
      reason: 'retry',
      retryAttempt: 1,
    });

    res.status(202).json({ ok: true });
  }),
);

// ── POST /api/operator-tasks/:agentRunId/extend-budget ───────────────────────
//
// Rev 2 F1 — enqueue-only.
// Precondition: task.status === 'paused_budget_exceeded'.
// Action: additive budget extension (60-min step; 60..60000), write audit, enqueue dispatch.
// Does NOT transition agent_runs.status.
const extendBudgetBodySchema = z.object({
  extensionMinutes: z.number().int().min(60).max(60000),
});

router.post(
  '/api/operator-tasks/:agentRunId/extend-budget',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { agentRunId } = req.params;
    const orgId = req.orgId!;
    const actor = req.user!;

    const run = await readAgentRunOrThrow(agentRunId, orgId);

    const actorCheck = evaluateRouteActorRule({
      actorUserId: actor.id,
      actorRole: resolveActorRole(actor.role),
      assignedUserId: null,
      routeRequiresAdmin: false,
    });
    if (!actorCheck.allowed) {
      throw { statusCode: 403, message: 'Forbidden', errorCode: actorCheck.reason ?? 'FORBIDDEN' };
    }

    if (run.status !== 'paused_budget_exceeded') {
      throw new OperatorBackendConflictError({
        kind: 'TASK_ALREADY_TERMINAL',
        currentState: { status: run.status },
      });
    }

    const parsed = extendBudgetBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw {
        statusCode: 400,
        message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        errorCode: 'VALIDATION_ERROR',
      };
    }

    const { extensionMinutes } = parsed.data;

    // Accumulate the extension on agent_runs.per_task_budget_extension_minutes
    // (per-task column, never resets). The dispatcher composes the effective
    // per_task_budget_cap_minutes as:
    //   effectiveSettings.per_task_budget_cap_minutes + perTaskBudgetExtensionMinutes
    // so this extension applies only to this task and never mutates the
    // subaccount-wide subaccount_operator_settings row. Spec §3.17.4.
    await db.transaction(async (tx) => {
      await setOrgGUC(tx, orgId);
      await tx
        .update(agentRuns)
        .set({
          perTaskBudgetExtensionMinutes: sql`${agentRuns.perTaskBudgetExtensionMinutes} + ${extensionMinutes}`,
          updatedAt: new Date(),
        })
        .where(eq(agentRuns.id, agentRunId));
    });

    void auditService.log({
      organisationId: orgId,
      actorId: actor.id,
      actorType: 'user',
      action: 'task.operator.budget_extended',
      entityType: 'agent_run',
      entityId: agentRunId,
      metadata: {
        agent_run_id: agentRunId,
        extension_minutes: extensionMinutes,
        source: 'ui',
        request_id: req.correlationId,
      },
    });

    const boss = await getPgBoss();
    await boss.send(OPERATOR_DISPATCH_NEXT_CHAIN_LINK_QUEUE, {
      agentRunId,
      organisationId: orgId,
      subaccountId: run.subaccountId!,
      reason: 'budget_extension',
      retryAttempt: 1,
    });

    res.status(202).json({ ok: true });
  }),
);

// ── POST /api/operator-tasks/:agentRunId/fresh-profile-restart ───────────────
//
// Rev 2 F6 — restricted predicate, org_admin only.
// Preconditions (in one atomic SELECT FOR UPDATE):
//   (a) task.status === 'paused_chain_failure'
//   (b) latest non-superseded chain link has failure_class='profile_corruption'
//       OR failure_reason='OPERATOR_PROFILE_UNRECOVERABLE'
// Action: bump attempt_number, mark prior chain links superseded, reset conversation
// history, emit fresh_profile_restart lifecycle event.
router.post(
  '/api/operator-tasks/:agentRunId/fresh-profile-restart',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { agentRunId } = req.params;
    const orgId = req.orgId!;
    const actor = req.user!;

    const actorCheck = evaluateRouteActorRule({
      actorUserId: actor.id,
      actorRole: resolveActorRole(actor.role),
      assignedUserId: null,
      routeRequiresAdmin: true,
    });
    if (!actorCheck.allowed) {
      throw { statusCode: 403, message: 'Forbidden', errorCode: actorCheck.reason ?? 'FORBIDDEN' };
    }

    const run = await readAgentRunOrThrow(agentRunId, orgId);

    if (!run.subaccountId) {
      throw { statusCode: 400, message: 'Task has no subaccount context', errorCode: 'NO_SUBACCOUNT' };
    }

    // Read and write operator_runs inside a single dual-GUC transaction so
    // RLS on operator_runs (keyed on both org + subaccount) returns rows.
    const { priorAttemptNumber, newAttemptNumber, priorChainSeqCount, predicate } =
      await db.transaction(async (tx) => {
        await setOrgAndSubaccountGUC(tx, orgId, run.subaccountId!);

        const [latestChainLink] = await tx
          .select({
            failureReason: operatorRuns.failureReason,
            failedMidStep: operatorRuns.failedMidStep,
            attemptNumber: operatorRuns.attemptNumber,
            chainSeq: operatorRuns.chainSeq,
          })
          .from(operatorRuns)
          .where(
            and(
              eq(operatorRuns.agentRunId, agentRunId),
              isNull(operatorRuns.supersededByAttempt),
            ),
          )
          .orderBy(operatorRuns.chainSeq)
          .limit(1);

        const pred = decideFreshProfileRestartAllowed({
          taskStatus: run.status,
          latestChainLinkFailureClass: null,
          latestChainLinkFailureReason: latestChainLink?.failureReason ?? null,
        });

        const priorAttempt = latestChainLink?.attemptNumber ?? 1;
        const newAttempt = priorAttempt + 1;

        if (pred.allowed) {
          // Mark prior chain links superseded while we still hold the GUC.
          await tx
            .update(operatorRuns)
            .set({ supersededByAttempt: newAttempt })
            .where(
              and(
                eq(operatorRuns.agentRunId, agentRunId),
                isNull(operatorRuns.supersededByAttempt),
              ),
            );
        }

        return {
          priorAttemptNumber: priorAttempt,
          newAttemptNumber: newAttempt,
          priorChainSeqCount: latestChainLink?.chainSeq ?? 0,
          predicate: pred,
        };
      });

    if (!predicate.allowed) {
      throw new OperatorBackendConflictError({
        kind: 'OPERATOR_TASK_RESTART_BLOCKED',
        currentState: {
          status: run.status,
          blockingReason: predicate.blockingReason,
        },
      });
    }

    void auditService.log({
      organisationId: orgId,
      actorId: actor.id,
      actorType: 'user',
      action: 'task.operator.fresh_profile_restart',
      entityType: 'agent_run',
      entityId: agentRunId,
      metadata: {
        agent_run_id: agentRunId,
        actor_user_id: actor.id,
        prior_attempt_number: priorAttemptNumber,
        new_attempt_number: newAttemptNumber,
        prior_chain_seq_count: priorChainSeqCount,
        request_id: req.correlationId,
      },
    });

    res.status(202).json({
      ok: true,
      priorAttemptNumber,
      newAttemptNumber,
    });
  }),
);

// ── POST /api/operator-tasks/:agentRunId/refresh-credential ─────────────────
//
// org_admin only.
// Triggers broker emitUsabilityRestored; emits audit event; clears fallback stickiness.
router.post(
  '/api/operator-tasks/:agentRunId/refresh-credential',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { agentRunId } = req.params;
    const orgId = req.orgId!;
    const actor = req.user!;

    const actorCheck = evaluateRouteActorRule({
      actorUserId: actor.id,
      actorRole: resolveActorRole(actor.role),
      assignedUserId: null,
      routeRequiresAdmin: true,
    });
    if (!actorCheck.allowed) {
      throw { statusCode: 403, message: 'Forbidden', errorCode: actorCheck.reason ?? 'FORBIDDEN' };
    }

    await readAgentRunOrThrow(agentRunId, orgId);

    await credentialBrokerService.emitUsabilityRestored({ connectionId: '', agentRunId });

    void auditService.log({
      organisationId: orgId,
      actorId: actor.id,
      actorType: 'user',
      action: 'task.operator.credential_refreshed',
      entityType: 'agent_run',
      entityId: agentRunId,
      metadata: { agent_run_id: agentRunId, request_id: req.correlationId },
    });

    res.status(202).json({ ok: true });
  }),
);

// ── POST /api/operator-tasks/:agentRunId/extend-debug-retention ──────────────
//
// org_admin only.
// Extends operator_task_profiles.scheduled_gc_at to now + 14 days.
router.post(
  '/api/operator-tasks/:agentRunId/extend-debug-retention',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { agentRunId } = req.params;
    const orgId = req.orgId!;
    const actor = req.user!;

    const actorCheck = evaluateRouteActorRule({
      actorUserId: actor.id,
      actorRole: resolveActorRole(actor.role),
      assignedUserId: null,
      routeRequiresAdmin: true,
    });
    if (!actorCheck.allowed) {
      throw { statusCode: 403, message: 'Forbidden', errorCode: actorCheck.reason ?? 'FORBIDDEN' };
    }

    const run = await readAgentRunOrThrow(agentRunId, orgId);

    if (!run.subaccountId) {
      throw { statusCode: 400, message: 'Task has no subaccount context', errorCode: 'NO_SUBACCOUNT' };
    }

    await operatorTaskProfileService.extendDebugRetention(
      orgId,
      run.subaccountId,
      agentRunId,
      actor.id,
    );

    void auditService.log({
      organisationId: orgId,
      actorId: actor.id,
      actorType: 'user',
      action: 'task.operator.debug_retention_extended',
      entityType: 'agent_run',
      entityId: agentRunId,
      metadata: { agent_run_id: agentRunId, request_id: req.correlationId },
    });

    res.status(202).json({ ok: true });
  }),
);

export default router;
