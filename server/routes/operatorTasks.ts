// operatorTasks.ts — task-action routes for operator-managed tasks.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §6.5b
//
// Routes (all POST):
//   retry-chain-failure       — assigned user OR manager+ (handler-only — no broad
//                                permission middleware; evaluateRouteActorRule enforces
//                                the rule against agent_runs.assigned_user_id and role)
//   extend-budget             — assigned user OR manager+ (same handler-only gate)
//   fresh-profile-restart     — org_admin only (AGENTS_EDIT + admin check)
//   refresh-credential        — org_admin only (AGENTS_EDIT + admin check)
//   extend-debug-retention    — org_admin only (AGENTS_EDIT + admin check)
//
// The user-or-manager routes intentionally skip requireOrgPermission(AGENTS_EDIT)
// because AGENTS_EDIT does not generally include rank-and-file users. The
// actor-rule check inside the handler is the security gate: a non-assigned
// non-manager is rejected with 403 REQUIRES_MANAGER_OR_ASSIGNED_USER before any
// state mutation. (Spec §6.5b; the spec table's AGENT_RUN_WRITE column refers
// to a permission key that does not exist in V1 — the handler check stands in.)
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
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { auditService } from '../services/auditService.js';
import { operatorTaskProfileService } from '../services/operatorTaskProfileService.js';
import { credentialBrokerService } from '../services/credentialBrokerService.js';
import { operatorChainResumeService } from '../services/operatorChainResumeService.js';
import { integrationConnectionService } from '../services/integrationConnectionService.js';
import { OperatorBackendConflictError } from '../services/operatorBackendErrors.js';
import { OPERATOR_DISPATCH_NEXT_CHAIN_LINK_QUEUE } from '../jobs/operatorSessionDispatchNextChainLinkHandler.js';
import {
  evaluateRouteActorRule,
  type ActorRoleLevel,
} from './operatorRouteActorRulePure.js';

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
  const run = await operatorChainResumeService.readAgentRunForTask(agentRunId, orgId);
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
  // No requireOrgPermission middleware — the actor-rule handler check below
  // is the gate. AGENTS_EDIT would block rank-and-file assigned users before
  // the handler runs; the V1 permission registry has no AGENT_RUN_WRITE
  // alternative.
  asyncHandler(async (req, res) => {
    const { agentRunId } = req.params;
    const orgId = req.orgId!;
    const actor = req.user!;

    const run = await readAgentRunOrThrow(agentRunId, orgId);

    const actorCheck = evaluateRouteActorRule({
      actorUserId: actor.id,
      actorRole: resolveActorRole(actor.role),
      assignedUserId: run.assignedUserId,
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

    // Reset failure counter (enqueue-only: no status transition).
    const { updated: resetOk } = await operatorChainResumeService.resetChainFailureCount(agentRunId, orgId);

    if (!resetOk) {
      throw new OperatorBackendConflictError({
        kind: 'TASK_ALREADY_TERMINAL',
        currentState: { status: run.status },
      });
    }

    // Await the audit row so it is durable before the dispatch job is enqueued.
    // The audit record explains why the task resumed; the dispatcher must not
    // fire ahead of it.
    await auditService.log({
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
  // No requireOrgPermission middleware — see retry-chain-failure for the
  // rationale. The handler-level actor-rule is the security gate.
  asyncHandler(async (req, res) => {
    const { agentRunId } = req.params;
    const orgId = req.orgId!;
    const actor = req.user!;

    const run = await readAgentRunOrThrow(agentRunId, orgId);

    const actorCheck = evaluateRouteActorRule({
      actorUserId: actor.id,
      actorRole: resolveActorRole(actor.role),
      assignedUserId: run.assignedUserId,
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

    // Accumulate the extension on agent_runs.per_task_budget_extension_minutes.
    // Spec §3.17.4: per-task additive, never touches subaccount-wide settings row.
    const { updated: extendOk } = await operatorChainResumeService.accumulateBudgetExtension(
      agentRunId,
      orgId,
      extensionMinutes,
    );

    if (!extendOk) {
      throw new OperatorBackendConflictError({
        kind: 'TASK_ALREADY_TERMINAL',
        currentState: { status: run.status },
      });
    }

    // Await the audit row so it is durable before the dispatch job is enqueued.
    // The audit record is the operator-visible explanation for why the task
    // resumed; if the dispatcher fires before the audit lands, an observer
    // would see "task back to delegated" with no recorded cause.
    await auditService.log({
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
//   (b) latest non-superseded chain link has failure_reason='OPERATOR_PROFILE_UNRECOVERABLE'
//       (V1 only inspects failure_reason — operator_runs has no failure_class column
//        in V1; spec §3.15 item 7's failure_class='profile_corruption' branch is
//        reserved for a future column add and is wired through the pure predicate
//        for forward compatibility but always passes null today.)
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

    const { priorAttemptNumber, newAttemptNumber, priorChainSeqCount, predicate } =
      await operatorChainResumeService.executeFreshProfileRestart(
        agentRunId,
        orgId,
        run.subaccountId!,
        run.status,
      );

    if (!predicate.allowed) {
      throw new OperatorBackendConflictError({
        kind: 'OPERATOR_TASK_RESTART_BLOCKED',
        currentState: {
          status: run.status,
          blockingReason: predicate.blockingReason,
        },
      });
    }

    // Await: this audit row records the attempt-number bump and the
    // operator-visible "fresh profile" event; it must be durable before the
    // 202 lands so the operator UI's polling immediately reflects the new
    // attempt.
    await auditService.log({
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

    const run = await readAgentRunOrThrow(agentRunId, orgId);

    if (!run.subaccountId) {
      throw { statusCode: 400, message: 'Task has no subaccount context', errorCode: 'NO_SUBACCOUNT' };
    }

    // Resolve the active operator_session connection for this run's subaccount.
    const conn = await integrationConnectionService.findActiveOperatorSessionConnection(
      orgId,
      run.subaccountId!,
    );

    if (!conn) {
      throw {
        statusCode: 404,
        message: 'No active operator-session credential for this subaccount',
        errorCode: 'NO_OPERATOR_SESSION_CREDENTIAL',
      };
    }

    // Persist the audit row first so the stickiness-clearing signal is durable
    // before the lifecycle event reaches downstream consumers and before the
    // route returns. The audit event is itself a stickiness-clearing source per
    // spec §3.7 item 5.
    await auditService.log({
      organisationId: orgId,
      actorId: actor.id,
      actorType: 'user',
      action: 'task.operator.credential_refreshed',
      entityType: 'agent_run',
      entityId: agentRunId,
      metadata: { agent_run_id: agentRunId, connection_id: conn.id, request_id: req.correlationId },
    });

    await credentialBrokerService.emitUsabilityRestored({ connectionId: conn.id, agentRunId });

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

    // Await: the debug-retention extension is durable on operator_task_profiles
    // already; the audit row is the human-readable trail of which operator
    // granted the extension. Surface it before the 202.
    await auditService.log({
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
