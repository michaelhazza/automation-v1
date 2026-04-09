import { eq, and, desc, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '../db/index.js';
import { actions, actionEvents, tasks } from '../db/schema/index.js';
import {
  getActionDefinition,
  LEGAL_TRANSITIONS,
  type ActionStatus,
} from '../config/actionRegistry.js';
import { policyEngineService } from './policyEngineService.js';

// ---------------------------------------------------------------------------
// Deterministic idempotency keys — P1.1 Layer 3 contract
//
// Built from (runId, toolCallId, args_hash) so a replay of the same tool
// call (after pg-boss redelivery, reflection-loop re-emission, or agent
// resume from checkpoint) resolves to the same action row via the
// actions.idempotency_key unique constraint.
//
// Callers that lack a toolCallId (legacy, non-middleware code paths) should
// pass a stable synthetic key — e.g. actionType + a stable business key.
// ---------------------------------------------------------------------------

export function hashActionArgs(args: Record<string, unknown>): string {
  // Canonicalise: sort keys alphabetically to make the hash order-independent.
  const canonical = JSON.stringify(args, Object.keys(args).sort());
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function buildActionIdempotencyKey(params: {
  runId: string;
  toolCallId: string;
  args: Record<string, unknown>;
}): string {
  const argsHash = hashActionArgs(params.args);
  return `${params.runId}:${params.toolCallId}:${argsHash}`;
}

// ---------------------------------------------------------------------------
// Action Service — create, validate, and transition actions
// ---------------------------------------------------------------------------

export interface ProposeActionInput {
  organisationId: string;
  /** Null for org-level agent runs */
  subaccountId: string | null;
  agentId: string;
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
   */
  async proposeAction(input: ProposeActionInput): Promise<ProposeActionResult> {
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

    const [existing] = await db
      .select({ id: actions.id, status: actions.status })
      .from(actions)
      .where(idempotencyCondition);

    if (existing) {
      return { actionId: existing.id, status: existing.status as ActionStatus, isNew: false };
    }

    const gateLevel = await resolveGateLevel(definition.defaultGateLevel, input);

    // Create the action record
    const [action] = await db
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
        gateLevel,
        status: 'proposed',
        idempotencyKey: input.idempotencyKey,
        payloadJson: input.payload,
        metadataJson: input.metadata ?? null,
        maxRetries: definition.retryPolicy.maxRetries,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Emit created event
    await this.emitEvent(action.id, input.organisationId, 'created');

    // Apply gate logic
    if (gateLevel === 'block') {
      await this.transitionState(action.id, input.organisationId, 'blocked');
      return { actionId: action.id, status: 'blocked', isNew: true };
    }

    if (gateLevel === 'review') {
      // Compute suspend_until from policy rule timeout or default 30 min
      const definition = getActionDefinition(input.actionType);
      const timeoutMs = (definition as { timeoutSeconds?: number } | undefined)
        ?.timeoutSeconds
        ? ((definition as unknown as { timeoutSeconds: number }).timeoutSeconds * 1000)
        : 30 * 60 * 1000;
      const suspendUntil = new Date(Date.now() + timeoutMs);

      await db.update(actions).set({
        suspendCount: sql`suspend_count + 1`,
        suspendUntil,
        updatedAt: new Date(),
      }).where(eq(actions.id, action.id));

      await this.transitionState(action.id, input.organisationId, 'pending_approval');
      return { actionId: action.id, status: 'pending_approval', isNew: true };
    }

    // auto gate — move to approved immediately
    await this.transitionState(action.id, input.organisationId, 'approved');
    return { actionId: action.id, status: 'approved', isNew: true };
  },

  /**
   * Transition an action to a new state. Enforces legal transitions.
   */
  async transitionState(
    actionId: string,
    organisationId: string,
    newStatus: ActionStatus,
    actorId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const [action] = await db
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

    await db.update(actions).set(updates).where(eq(actions.id, actionId));

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
    await this.emitEvent(actionId, organisationId, eventType, actorId, metadata);
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
    await db.update(actions).set({
      status: 'completed',
      resultJson: result as Record<string, unknown>,
      resultStatus,
      updatedAt: new Date(),
    }).where(and(eq(actions.id, actionId), eq(actions.organisationId, organisationId)));

    await this.emitEvent(actionId, organisationId, 'execution_completed');
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
    const [action] = await db
      .select({ retryCount: actions.retryCount, maxRetries: actions.maxRetries })
      .from(actions)
      .where(eq(actions.id, actionId));

    const canRetry = action && action.retryCount < action.maxRetries;

    await db.update(actions).set({
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
    const [action] = await db
      .select()
      .from(actions)
      .where(and(eq(actions.id, actionId), eq(actions.organisationId, organisationId)));

    if (!action) {
      throw Object.assign(new Error('Action not found'), { statusCode: 404 });
    }
    return action;
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

    return db
      .select()
      .from(actions)
      .where(and(...conditions))
      .orderBy(desc(actions.createdAt))
      .limit(100);
  },

  /**
   * Get action events for audit trail.
   */
  async getActionEvents(actionId: string, organisationId: string) {
    return db
      .select()
      .from(actionEvents)
      .where(and(eq(actionEvents.actionId, actionId), eq(actionEvents.organisationId, organisationId)))
      .orderBy(actionEvents.createdAt);
  },

  /**
   * Emit an action event (immutable audit log entry).
   */
  async emitEvent(
    actionId: string,
    organisationId: string,
    eventType: typeof actionEvents.eventType._.data,
    actorId?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await db.insert(actionEvents).values({
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
async function resolveGateLevel(
  _registryDefault: 'auto' | 'review' | 'block',
  input: ProposeActionInput
): Promise<'auto' | 'review' | 'block'> {
  // 1. Policy engine — first-match, with registry default as fallback
  const policyDecision = await policyEngineService.evaluatePolicy({
    toolSlug: input.actionType,
    subaccountId: input.subaccountId!,
    organisationId: input.organisationId,
    input: input.payload,
    toolIntentConfidence: input.toolIntentConfidence,
  });
  let gate = policyDecision.decision;

  // 2. Explicit override from caller
  if (input.gateOverride) {
    gate = higherGate(gate, input.gateOverride);
  }

  // 3. Task-level escalation
  if (input.taskId) {
    const [task] = await db
      .select({ reviewRequired: tasks.reviewRequired })
      .from(tasks)
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

  return gate;
}
