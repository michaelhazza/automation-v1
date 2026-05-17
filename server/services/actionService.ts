import { eq, and, desc, sql, inArray, isNull } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db, type Transaction } from '../db/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { actions, actionEvents, tasks, flowRuns, agentRuns } from '../db/schema/index.js';
import {
  getActionDefinition,
  LEGAL_TRANSITIONS,
  type ActionStatus,
} from '../config/actionRegistry.js';
import { policyEngineService } from './policyEngineService.js';
import {
  canonicaliseJson,
  hashActionArgs,
  computeValidationDigest,
} from '../lib/canonicalJsonPure.js';

// Re-exports preserve existing import surface for callers (proposeAction
// middleware, executionLayerService, regressionCaptureServicePure). The
// canonical-JSON helpers physically live in server/lib/canonicalJsonPure.ts
// to keep them out of the impure DB import chain — see DG#2 in
// tasks/review-logs/spec-conformance-log-agentic-commerce-2026-05-03T14-12-21Z.md.
export { canonicaliseJson, hashActionArgs, computeValidationDigest };

// buildActionIdempotencyKey is a pure computation — no DB dependency.
// Canonical home is actionServicePure.ts; re-exported here for backward compat.
export { buildActionIdempotencyKey } from './actionServicePure.js';

// ---------------------------------------------------------------------------
// Action Service — create, validate, and transition actions
// ---------------------------------------------------------------------------

export interface ProposeActionInput {
  organisationId: string;
  /** Null for org-level agent runs */
  subaccountId: string | null;
  /**
   * Null for system-initiated actions (e.g. shadow-to-live promotion). The
   * `actions.agent_id` column was made nullable in migration 0274 to support
   * these flows. Empty string is NOT accepted — Postgres rejects '' as a uuid
   * value at runtime.
   */
  agentId: string | null;
  agentRunId?: string;
  parentActionId?: string;
  actionType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  gateOverride?: 'auto' | 'review' | 'block';
  /** If the agent is working a specific task, pass its ID for gate escalation */
  taskId?: string;
  /**
   * Sprint 3 P2.3 — agent's self-reported tool_intent confidence (0..1).
   * Threaded through to the policy engine which upgrades an `auto`
   * decision to `review` when confidence is below the effective
   * threshold. Missing / null is treated as "below threshold" (fail
   * closed). See server/config/limits.ts → CONFIDENCE_GATE_THRESHOLD.
   */
  toolIntentConfidence?: number | null;
  estimatedCostMinor?: number | null;
  subaccountScope?: 'single' | 'multiple';
  /**
   * Chunk 4 (synthetos-foundation-refactor) — subaccount-agent link ID.
   * Passed to the policy engine so subaccount-constraint rules
   * (max_risk_tier block, require_approval_at_tier upgrade) can be applied.
   */
  subaccountAgentId?: string | null;
  /** Cross-owner proposals set this to executor_agent.owner_user_id. NULL = V1 initiator-defaulted path. */
  approverUserId?: string;
}

export interface ProposeActionResult {
  actionId: string;
  status: ActionStatus;
  isNew: boolean;
}

export const actionService = {
  /**
   * Propose a new action. Validates against registry, checks idempotency,
   * creates the record, and applies the initial gate transition.
   *
   * **Atomicity contract.** Pass `opts.tx` to enrol all writes (action insert,
   * suspend-update, transition-state, emitted events) in a caller-owned
   * transaction. Callers that also need to insert dependent rows in the same
   * transaction (e.g. `eaDraftService.createDraftWithProposal`) MUST pass tx
   * so the dependent row + the action row commit-or-rollback together; the
   * pre-2026-05-13 non-tx variant left orphaned `pending_approval` actions
   * if the dependent insert failed.
   */
  async proposeAction(
    input: ProposeActionInput,
    opts: { tx?: Transaction } = {},
  ): Promise<ProposeActionResult> {
    const exec = opts.tx ?? db;
    const definition = getActionDefinition(input.actionType);
    if (!definition) {
      throw Object.assign(new Error(`Unknown action type: ${input.actionType}`), { statusCode: 400 });
    }

    // Check idempotency — return existing action if key matches
    const actionScope = input.subaccountId ? 'subaccount' : 'org';
    const idempotencyCondition = actionScope === 'org'
      ? and(
          eq(actions.organisationId, input.organisationId),
          eq(actions.actionScope, 'org'),
          eq(actions.idempotencyKey, input.idempotencyKey)
        )
      : and(
          eq(actions.subaccountId, input.subaccountId!),
          eq(actions.idempotencyKey, input.idempotencyKey)
        );

    const [existing] = await exec
      .select({ id: actions.id, status: actions.status })
      .from(actions)
      .where(idempotencyCondition);

    if (existing) {
      return { actionId: existing.id, status: existing.status as ActionStatus, isNew: false };
    }

    const resolved = await resolveGateLevel(definition.defaultGateLevel, input);

    // Merge riskTier / gateLevelSource into metadata so the tool_security_decision
    // Run Trace event (chunk 7) can read them without a schema migration now.
    const enrichedMetadata: Record<string, unknown> | null = (() => {
      const base = input.metadata ?? {};
      if (resolved.riskTier !== undefined || resolved.gateLevelSource !== undefined) {
        return {
          ...base,
          ...(resolved.riskTier !== undefined ? { riskTier: resolved.riskTier } : {}),
          ...(resolved.gateLevelSource !== undefined ? { gateLevelSource: resolved.gateLevelSource } : {}),
        };
      }
      return Object.keys(base).length > 0 ? base : null;
    })();

    // Create the action record
    const [action] = await exec
      .insert(actions)
      .values({
        organisationId: input.organisationId,
        subaccountId: input.subaccountId,
        actionScope,
        agentId: input.agentId,
        agentRunId: input.agentRunId ?? null,
        parentActionId: input.parentActionId ?? null,
        actionType: input.actionType,
        actionCategory: definition.actionCategory,
        isExternal: definition.isExternal,
        gateLevel: resolved.gate,
        status: 'proposed',
        idempotencyKey: input.idempotencyKey,
        payloadJson: input.payload,
        metadataJson: enrichedMetadata,
        maxRetries: definition.retryPolicy.maxRetries,
        estimatedCostMinor: input.estimatedCostMinor ?? null,
        subaccountScope: input.subaccountScope ?? 'single',
        approverUserId: input.approverUserId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Emit created event
    await this.emitEvent(action.id, input.organisationId, 'created', undefined, undefined, opts);

    // Apply gate logic
    if (resolved.gate === 'block') {
      await this.transitionState(action.id, input.organisationId, 'blocked', undefined, undefined, opts);
      return { actionId: action.id, status: 'blocked', isNew: true };
    }

    if (resolved.gate === 'review') {
      // Compute suspend_until from policy rule timeout or default 30 min
      const definition = getActionDefinition(input.actionType);
      const timeoutMs = (definition as { timeoutSeconds?: number } | undefined)
        ?.timeoutSeconds
        ? ((definition as unknown as { timeoutSeconds: number }).timeoutSeconds * 1000)
        : 30 * 60 * 1000;
      const suspendUntil = new Date(Date.now() + timeoutMs);

      await exec.update(actions).set({
        suspendCount: sql`suspend_count + 1`,
        suspendUntil,
        updatedAt: new Date(),
      }).where(eq(actions.id, action.id));

      await this.transitionState(action.id, input.organisationId, 'pending_approval', undefined, undefined, opts);
      return { actionId: action.id, status: 'pending_approval', isNew: true };
    }

    // auto gate — move to approved immediately. When the caller passed
    // `opts.tx`, also propagate `skipDispatch: true` — the dispatch hook
    // cannot safely run inside an uncommitted tx (see transitionState
    // doc-comment). Today no production caller hits this combination
    // (`createDraftWithProposal` forces `gateOverride: 'review'`), but the
    // propagation here keeps the contract self-consistent if a future
    // caller passes `opts.tx` to a non-review path.
    //
    // **Invariant pin (REVIEW-T1-followup, 2026-05-13).** As of this commit,
    // NO production call site invokes `proposeAction({ tx })` for an
    // EA-draft-like action that resolves to the `auto` gate. The only
    // tx-backed caller is `eaDraftService.createDraftWithProposal`, which
    // hard-codes `gateOverride: 'review'` — so the gate resolution in
    // `resolveGateLevel` cannot land on `auto` for that path. The
    // `transitionState` runtime assertion above (line ~285) catches the
    // failure mode if a future caller passes `opts.tx` to a non-review
    // path without acknowledging `skipDispatch: true`. If you change this
    // invariant — e.g. add a tx-backed auto-approved path for a new draft
    // kind — you MUST also wire a post-commit dispatch callback (the
    // assert covers the missing acknowledgement, but not the missing
    // dispatch itself).
    await this.transitionState(
      action.id,
      input.organisationId,
      'approved',
      undefined,
      undefined,
      opts.tx ? { tx: opts.tx, skipDispatch: true } : opts,
    );
    return { actionId: action.id, status: 'approved', isNew: true };
  },

  /**
   * Transition an action to a new state. Enforces legal transitions.
   *
   * Pass `opts.tx` to enrol the select / update / emit-event writes in a
   * caller-owned transaction (see `proposeAction` doc-comment for context).
   *
   * **Tx + approval-dispatch contract.** When `opts.tx` is passed AND
   * `newStatus === 'approved'`, the caller MUST also pass
   * `opts.skipDispatch = true` to acknowledge that the EA-draft dispatch
   * hook is being skipped (the hook does network I/O against post-commit
   * state and cannot safely run inside the caller's tx). The caller is
   * then responsible for invoking
   * `eaDraftDispatchService.dispatchAfterApproval` AFTER their tx commits.
   * The runtime assertion below enforces this — a future approval path
   * that atomically transitions to approved without providing the
   * acknowledgement will throw rather than silently failing to dispatch.
   */
  async transitionState(
    actionId: string,
    organisationId: string,
    newStatus: ActionStatus,
    actorId?: string,
    metadata?: Record<string, unknown>,
    opts: { tx?: Transaction; skipDispatch?: boolean } = {},
  ): Promise<void> {
    // Tx-contract guard: when a caller passes `opts.tx` and transitions to
    // `approved`, the EA-draft dispatch hook below is skipped (the hook does
    // network I/O against post-commit state and cannot safely run inside the
    // caller's tx — see comment block lower down). The caller MUST
    // acknowledge that contract by passing `skipDispatch: true` and is
    // responsible for invoking
    // `eaDraftDispatchService.dispatchAfterApproval` themselves AFTER their
    // tx commits. Without this assert a future approval path could
    // atomically transition to approved and silently never dispatch.
    if (opts.tx && newStatus === 'approved' && !opts.skipDispatch) {
      throw Object.assign(
        new Error(
          'actionService.transitionState: callers passing opts.tx for an ' +
            "'approved' transition MUST set opts.skipDispatch=true and call " +
            'eaDraftDispatchService.dispatchAfterApproval after their tx ' +
            'commits. See actionService.transitionState doc-comment.',
        ),
        { statusCode: 500 },
      );
    }
    const exec = opts.tx ?? db;
    const [action] = await exec
      .select({ status: actions.status })
      .from(actions)
      .where(and(eq(actions.id, actionId), eq(actions.organisationId, organisationId)));

    if (!action) {
      throw Object.assign(new Error('Action not found'), { statusCode: 404 });
    }

    const currentStatus = action.status;
    const allowed = LEGAL_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) {
      throw Object.assign(
        new Error(`Invalid transition: ${currentStatus} → ${newStatus}`),
        { statusCode: 409 }
      );
    }

    const updates: Record<string, unknown> = {
      status: newStatus,
      updatedAt: new Date(),
    };

    if (newStatus === 'approved' && actorId) {
      updates.approvedBy = actorId;
      updates.approvedAt = new Date();
    }

    if (newStatus === 'executing') {
      updates.executedAt = new Date();
    }

    await exec.update(actions).set(updates).where(eq(actions.id, actionId));

    // Map status to event type
    const eventMap: Record<string, string> = {
      pending_approval: 'queued_for_review',
      approved: 'approved',
      executing: 'execution_started',
      completed: 'execution_completed',
      failed: 'execution_failed',
      rejected: 'rejected',
      blocked: 'blocked',
      skipped: 'skipped_duplicate',
    };

    const eventType = (eventMap[newStatus] ?? newStatus) as typeof actionEvents.eventType._.data;
    await this.emitEvent(actionId, organisationId, eventType, actorId, metadata, opts);

    // Proposal commit hook — invoked exactly once on approved transition.
    // Spec: 2026-05-12-personal-assistant-v1-spec.md §11 + §24.2. When the
    // action backs an EA draft (metadata.kind === 'ea_draft'), routes to
    // the kind-appropriate handler. The handler owns the optimistic claim
    // + mark-sent / mark-failed lifecycle on ea_drafts.sendState; errors
    // are logged but do not undo the approval (stall-reset job recovers
    // any draft stuck in 'sending').
    //
    // Tx contract (2026-05-13 sweep): when the caller passes `opts.tx`, the
    // dispatch hook is SKIPPED — it runs network I/O (Slack/Calendar API
    // calls) and would be either (a) executing against an uncommitted action
    // row (the action transitions to executing inside the tx, but the draft
    // SELECT in dispatchAfterApproval would read pre-commit state if it ran
    // inside the same tx connection) or (b) blocked on the tx releasing its
    // connection. Callers that pass `opts.tx` MUST invoke
    // `eaDraftDispatchService.dispatchAfterApproval` themselves AFTER their
    // own tx commits. `createDraftWithProposal` is exempt — it forces
    // `gateOverride: 'review'`, so the dispatch path never fires from inside
    // its tx.
    if (newStatus === 'approved' && !opts.tx) {
      const { eaDraftDispatchService } = await import('./eaDrafts/eaDraftDispatchService.js');
      if (await eaDraftDispatchService.isEADraftAction(actionId, organisationId)) {
        await eaDraftDispatchService.dispatchAfterApproval(actionId, organisationId);
      }
    }
  },

  /**
   * Atomically lock and transition to executing. Returns true if lock acquired.
   * Uses SELECT FOR UPDATE to prevent duplicate execution.
   */
  async lockForExecution(actionId: string, organisationId: string): Promise<boolean> {
    const result = await db.execute(sql`
      UPDATE actions
      SET status = 'executing', executed_at = NOW(), updated_at = NOW()
      WHERE id = ${actionId}
        AND organisation_id = ${organisationId}
        AND status = 'approved'
        AND executed_at IS NULL
    `);

    const rowCount = (result as { rowCount?: number }).rowCount ?? 0;
    if (rowCount === 0) return false;

    await this.emitEvent(actionId, organisationId, 'execution_started');
    return true;
  },

  /**
   * Mark action as completed with result.
   */
  async markCompleted(
    actionId: string,
    organisationId: string,
    result: unknown,
    resultStatus: 'success' | 'partial' | 'failed' = 'success'
  ): Promise<void> {
    const scopedDb = getOrgScopedDb('actionService.markCompleted');
    await scopedDb.update(actions).set({
      status: 'completed',
      resultJson: result as Record<string, unknown>,
      resultStatus,
      updatedAt: new Date(),
    }).where(and(eq(actions.id, actionId), eq(actions.organisationId, organisationId)));

    await this.emitEvent(actionId, organisationId, 'execution_completed');
  },

  /**
   * Mark action as blocked with a reason stored in metadata_json.blockedReason.
   * Used by the execution engine's precondition gate (ClientPulse Session 2 §2.6).
   * Blocked actions are terminal — no retry — but distinguishable from `failed`
   * in audit because the precondition that failed is machine-readable.
   */
  async markBlocked(
    actionId: string,
    organisationId: string,
    blockedReason:
      | 'drift_detected'
      | 'concurrent_execute'
      | 'timeout_budget_exhausted'
      | 'validation_digest_missing',
    detail?: string,
  ): Promise<void> {
    const scopedDb = getOrgScopedDb('actionService.markBlocked');
    const [action] = await scopedDb
      .select({ metadataJson: actions.metadataJson })
      .from(actions)
      .where(and(eq(actions.id, actionId), eq(actions.organisationId, organisationId)));

    const nextMetadata = {
      ...((action?.metadataJson as Record<string, unknown> | null) ?? {}),
      blockedReason,
      blockedDetail: detail ?? null,
      blockedAt: new Date().toISOString(),
    };

    await scopedDb
      .update(actions)
      .set({
        status: 'blocked',
        metadataJson: nextMetadata,
        updatedAt: new Date(),
      })
      .where(and(eq(actions.id, actionId), eq(actions.organisationId, organisationId)));

    await this.emitEvent(actionId, organisationId, 'execution_failed', undefined, {
      blockedReason,
    });
  },

  /**
   * Mark action as failed with error.
   */
  async markFailed(
    actionId: string,
    organisationId: string,
    error: unknown,
    errorCode?: string
  ): Promise<void> {
    const scopedDb = getOrgScopedDb('actionService.markFailed');
    const [action] = await scopedDb
      .select({ retryCount: actions.retryCount, maxRetries: actions.maxRetries })
      .from(actions)
      .where(and(eq(actions.id, actionId), eq(actions.organisationId, organisationId)));

    const canRetry = action && action.retryCount < action.maxRetries;

    await scopedDb.update(actions).set({
      status: 'failed',
      errorJson: { message: error instanceof Error ? error.message : String(error), code: errorCode },
      retryCount: sql`retry_count + 1`,
      updatedAt: new Date(),
    }).where(and(eq(actions.id, actionId), eq(actions.organisationId, organisationId)));

    await this.emitEvent(actionId, organisationId, canRetry ? 'retry_scheduled' : 'execution_failed', undefined, { errorCode });
  },

  /**
   * Get a single action by ID.
   */
  async getAction(actionId: string, organisationId: string) {
    const scopedDb = getOrgScopedDb('actionService.getAction');
    const [action] = await scopedDb
      .select()
      .from(actions)
      .where(and(eq(actions.id, actionId), eq(actions.organisationId, organisationId)));

    if (!action) {
      throw Object.assign(new Error('Action not found'), { statusCode: 404 });
    }
    return action;
  },

  async getActionsBulk(actionIds: string[], organisationId: string) {
    if (actionIds.length === 0) return [];
    const scopedDb = getOrgScopedDb('actionService.getActionsBulk');
    return scopedDb
      .select()
      .from(actions)
      .where(and(
        inArray(actions.id, actionIds),
        eq(actions.organisationId, organisationId),
      ));
  },

  /**
   * List actions for a subaccount with optional status filter.
   */
  async listActions(organisationId: string, subaccountId: string, statusFilter?: string) {
    const conditions = [
      eq(actions.organisationId, organisationId),
      eq(actions.subaccountId, subaccountId),
    ];

    if (statusFilter) {
      conditions.push(eq(actions.status, statusFilter as typeof actions.status._.data));
    }

    const scopedDb = getOrgScopedDb('actionService.listActions');
    return scopedDb
      .select()
      .from(actions)
      .where(and(...conditions))
      .orderBy(desc(actions.createdAt))
      .limit(100);
  },

  /**
   * List pending_approval actions enriched with workflow run context.
   * Used by the agent inbox route.
   */
  async listPendingWithWorkflowContext(organisationId: string, subaccountId: string) {
    const scopedDb = getOrgScopedDb('actionService.listPendingWithWorkflowContext');
    const pendingActions = await scopedDb
      .select()
      .from(actions)
      .where(
        and(
          eq(actions.subaccountId, subaccountId),
          eq(actions.organisationId, organisationId),
          eq(actions.status, 'pending_approval'),
        ),
      )
      .orderBy(actions.createdAt);

    if (pendingActions.length === 0) return [];

    // Collect unique workflow run IDs referenced by these actions
    const workflowRunIds = [
      ...new Set(
        pendingActions
          .map((a) => {
            const p = a.payloadJson as Record<string, unknown> | null;
            return (p?.workflowRunId as string | undefined) ?? null;
          })
          .filter((id): id is string => id !== null),
      ),
    ];

    // Fetch workflow runs in bulk (if any)
    const flowRunsMap = new Map<string, typeof flowRuns.$inferSelect>();
    if (workflowRunIds.length > 0) {
      const runs = await scopedDb
        .select()
        .from(flowRuns)
        .where(
          and(
            inArray(flowRuns.id, workflowRunIds),
            eq(flowRuns.organisationId, organisationId),
          ),
        );
      for (const run of runs) {
        flowRunsMap.set(run.id, run);
      }
    }

    // Enrich each action with workflow context
    return pendingActions.map((action) => {
      const p = action.payloadJson as Record<string, unknown> | null;
      const workflowRunId = (p?.workflowRunId as string | undefined) ?? null;
      const workflowStepId = (p?.workflowStepId as string | undefined) ?? null;
      const workflowRun = workflowRunId ? flowRunsMap.get(workflowRunId) ?? null : null;

      return {
        ...action,
        workflowContext: workflowRun
          ? {
              workflowRunId,
              workflowStepId,
              workflowType: (workflowRun.workflowDefinition as { workflowType?: string }).workflowType,
              label: (workflowRun.workflowDefinition as { label?: string }).label ?? null,
              currentStepIndex: workflowRun.currentStepIndex,
              totalSteps: (workflowRun.workflowDefinition as { steps?: unknown[] }).steps?.length ?? 0,
              workflowStatus: workflowRun.status,
            }
          : null,
      };
    });
  },

  /**
   * Get action events for audit trail.
   */
  async getActionEvents(actionId: string, organisationId: string) {
    const scopedDb = getOrgScopedDb('actionService.getActionEvents');
    return scopedDb
      .select()
      .from(actionEvents)
      .where(and(eq(actionEvents.actionId, actionId), eq(actionEvents.organisationId, organisationId)))
      .orderBy(actionEvents.createdAt);
  },

  /**
   * Emit an action event (immutable audit log entry).
   *
   * Pass `opts.tx` to enrol the insert in a caller-owned transaction.
   */
  async emitEvent(
    actionId: string,
    organisationId: string,
    eventType: typeof actionEvents.eventType._.data,
    actorId?: string,
    metadata?: Record<string, unknown>,
    opts: { tx?: Transaction } = {},
  ): Promise<void> {
    const exec = opts.tx ?? db;
    await exec.insert(actionEvents).values({
      organisationId,
      actionId,
      eventType,
      actorId: actorId ?? null,
      metadataJson: metadata ?? null,
      createdAt: new Date(),
    });
  },
};

// ---------------------------------------------------------------------------
// listPendingApprovalsForUser — cross-owner approval queue reader
// ---------------------------------------------------------------------------

/**
 * Returns pending-approval actions routed to the given userId across two arms:
 *
 *   Arm 1 — explicit cross-owner approvals (`approver_user_id = $userId`).
 *
 *   Arm 2 — V1 initiator-defaulted approvals (`approver_user_id IS NULL`).
 *   The run's initiator is derived by joining `actions.agent_run_id` →
 *   `agent_runs.acting_as_user_id`. Only rows where the joined initiator
 *   matches `$userId` are returned. This was previously routed to backlog
 *   (PA-V2-LIST-APPROVALS-V1-ARM) because an earlier draft of Arm 2 had no
 *   initiator predicate and would have exposed every default-approver
 *   action to any caller (the F5 finding in
 *   `tasks/review-logs/chatgpt-pr-review-personal-assistant-v2-operator-*.md`);
 *   wiring the correct JOIN closes that gap.
 *
 * MUST filter by organisationId per DEVELOPMENT_GUIDELINES §1. Both arms
 * carry the org predicate; the JOIN itself is an inner join (Arm-2 rows
 * with a missing or cross-tenant agent_run won't appear).
 */
export async function listPendingApprovalsForUser(
  userId: string,
  organisationId: string,
  _subaccountId: string | null,
): Promise<Array<{ actionId: string; actionType: string; status: string; approverUserId: string | null; createdAt: Date }>> {
  const scopedDb = getOrgScopedDb('actionService.listPendingApprovalsForUser');
  // Arm 1 — explicit approver match.
  const arm1Rows = await scopedDb
    .select({
      actionId: actions.id,
      actionType: actions.actionType,
      status: actions.status,
      approverUserId: actions.approverUserId,
      createdAt: actions.createdAt,
    })
    .from(actions)
    .where(
      and(
        eq(actions.organisationId, organisationId),
        eq(actions.status, 'pending_approval'),
        eq(actions.approverUserId, userId),
      ),
    );

  // Arm 2 — V1 initiator-defaulted match. `approver_user_id IS NULL` rows
  // are routed by JOINing the action's run to derive its initiator, then
  // filtering on that initiator equalling $userId. The org predicate is
  // applied on BOTH sides of the join (defence in depth — proposeAction
  // discipline guarantees `actions.organisationId === agent_runs.organisationId`
  // today, but the FK does not enforce same-org. Writing both predicates
  // closes the gap surfaced by pr-reviewer wave-4-session-i-prime).
  const arm2Rows = await scopedDb
    .select({
      actionId: actions.id,
      actionType: actions.actionType,
      status: actions.status,
      approverUserId: actions.approverUserId,
      createdAt: actions.createdAt,
    })
    .from(actions)
    .innerJoin(agentRuns, eq(actions.agentRunId, agentRuns.id))
    .where(
      and(
        eq(actions.organisationId, organisationId),
        eq(agentRuns.organisationId, organisationId),
        eq(actions.status, 'pending_approval'),
        isNull(actions.approverUserId),
        eq(agentRuns.actingAsUserId, userId),
      ),
    );

  // Dedupe defensively — Arm 1 and Arm 2 predicates are disjoint
  // (approver_user_id = $userId vs. approver_user_id IS NULL), so no row
  // can satisfy both. The Set guard exists so that any future predicate
  // overlap fails closed (one row in the output) rather than open
  // (duplicated rows). DEVELOPMENT_GUIDELINES §8.7.
  const seen = new Set<string>();
  const merged: Array<{ actionId: string; actionType: string; status: string; approverUserId: string | null; createdAt: Date }> = [];
  for (const row of [...arm1Rows, ...arm2Rows]) {
    if (seen.has(row.actionId)) continue;
    seen.add(row.actionId);
    merged.push(row);
  }

  // Sort newest-first; stable secondary sort on id prevents non-determinism
  // when multiple actions share the same createdAt (DEVELOPMENT_GUIDELINES §8.34).
  return merged.sort((a, b) => {
    const diff = b.createdAt.getTime() - a.createdAt.getTime();
    return diff !== 0 ? diff : b.actionId.localeCompare(a.actionId);
  });
}

// ---------------------------------------------------------------------------
// Gate Level Resolution — multi-source, highest restriction wins
// ---------------------------------------------------------------------------

const GATE_PRIORITY: Record<string, number> = { auto: 0, review: 1, block: 2 };

function higherGate(a: string, b: string): 'auto' | 'review' | 'block' {
  return (GATE_PRIORITY[a] ?? 0) >= (GATE_PRIORITY[b] ?? 0) ? a as 'auto' | 'review' | 'block' : b as 'auto' | 'review' | 'block';
}

/**
 * Resolves the effective gate level from multiple sources.
 * Highest restriction wins: block > review > auto.
 *
 * Sources checked in order (Phase 1A):
 * 1. Policy engine: first-match rule from policy_rules table (falls back to
 *    registry default if no rules match)
 * 2. Explicit gate override from caller
 * 3. Task-level reviewRequired flag (escalates auto → review)
 * 4. Agent metadata needs_human_review flag (escalates auto → review)
 */
interface ResolvedGate {
  gate: 'auto' | 'review' | 'block';
  riskTier?: number;
  gateLevelSource?: 'subaccount_constraint' | 'policy_override' | 'preserved_existing' | 'tier_default';
}

async function resolveGateLevel(
  _registryDefault: 'auto' | 'review' | 'block',
  input: ProposeActionInput
): Promise<ResolvedGate> {
  // 1. Policy engine — first-match, with registry default as fallback
  const policyDecision = await policyEngineService.evaluatePolicy({
    toolSlug: input.actionType,
    subaccountId: input.subaccountId!,
    organisationId: input.organisationId,
    input: input.payload,
    toolIntentConfidence: input.toolIntentConfidence,
    subaccountAgentId: input.subaccountAgentId,
  });
  let gate = policyDecision.decision;

  // 1b. Chunk 7: merge spendDecision into gate — highest restriction wins
  if (policyDecision.spendDecision?.evaluated === true) {
    gate = higherGate(gate, policyDecision.spendDecision.outcome);
  }

  // 2. Explicit override from caller
  if (input.gateOverride) {
    gate = higherGate(gate, input.gateOverride);
  }

  // 3. Task-level escalation
  if (input.taskId) {
    // guard-ignore: with-org-tx-or-scoped-db reason="called within withOrgTx context from route handler — orgId in ALS"
    const [task] = await db
      .select({ reviewRequired: tasks.reviewRequired })
      .from(tasks)
      // guard-ignore-next-line: org-scoped-writes reason="read-only SELECT to check reviewRequired flag; taskId comes from agent input already scoped to the run's organisation"
      .where(eq(tasks.id, input.taskId));

    if (task?.reviewRequired) {
      gate = higherGate(gate, 'review');
    }
  }

  // 4. Agent metadata escalation
  if (input.metadata) {
    const meta = input.metadata as Record<string, unknown>;
    if (meta.needs_human_review === true || meta.needsHumanReview === true) {
      gate = higherGate(gate, 'review');
    }
  }

  return { gate, riskTier: policyDecision.riskTier, gateLevelSource: policyDecision.gateLevelSource };
}
