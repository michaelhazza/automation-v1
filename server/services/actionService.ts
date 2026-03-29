import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { actions, actionEvents } from '../db/schema/index.js';
import {
  getActionDefinition,
  LEGAL_TRANSITIONS,
  type ActionStatus,
} from '../config/actionRegistry.js';

// ---------------------------------------------------------------------------
// Action Service — create, validate, and transition actions
// ---------------------------------------------------------------------------

export interface ProposeActionInput {
  organisationId: string;
  subaccountId: string;
  agentId: string;
  agentRunId?: string;
  parentActionId?: string;
  actionType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  gateOverride?: 'auto' | 'review' | 'block';
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
    const [existing] = await db
      .select({ id: actions.id, status: actions.status })
      .from(actions)
      .where(
        and(
          eq(actions.subaccountId, input.subaccountId),
          eq(actions.idempotencyKey, input.idempotencyKey)
        )
      );

    if (existing) {
      return { actionId: existing.id, status: existing.status as ActionStatus, isNew: false };
    }

    const gateLevel = input.gateOverride ?? definition.defaultGateLevel;

    // Create the action record
    const [action] = await db
      .insert(actions)
      .values({
        organisationId: input.organisationId,
        subaccountId: input.subaccountId,
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

    const eventType = eventMap[newStatus] ?? newStatus;
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
      conditions.push(eq(actions.status, statusFilter));
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
    eventType: string,
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
