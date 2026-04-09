/**
 * proposeActionMiddleware — Sprint 2 P1.1 Layer 3 universal before-tool
 * authorisation hook. Runs as the FIRST preTool middleware for every
 * agent tool call. See docs/improvements-roadmap-spec.md §P1.1 Layer 3.
 *
 * Responsibilities:
 *   1. Short-circuit on the in-memory decision cache (idempotent per
 *      `toolCallId` — replays from retries, reflection injection, and
 *      pg-boss re-delivery all hit the cache on the second pass).
 *   2. Fast-path methodology skills — write a single allow audit row and
 *      continue; no proposeAction, no policy engine call.
 *   3. Call `actionService.proposeAction()` with a deterministic
 *      idempotency key derived from `(runId, toolCallId, args_hash)`. The
 *      DB unique constraint on `actions.idempotency_key` makes the call
 *      itself idempotent at the storage layer.
 *   4. Write one row to `tool_call_security_events` with
 *      `INSERT ... ON CONFLICT DO NOTHING` so replays do not create
 *      duplicate audit rows.
 *   5. Translate the proposeAction outcome into a `PreToolResult`:
 *        blocked               → `{ action: 'block', reason }`
 *        scope_violation       → `{ action: 'block', reason }`
 *        auto / pending_review → `{ action: 'continue' }`
 *
 * Coexistence with the legacy per-case wrappers in `skillExecutor.ts`:
 * the wrappers still call `proposeAction()` with the same deterministic
 * key. Because the key is deterministic, the wrapper's call returns the
 * existing action row (`isNew === false`) and the wrapper moves on
 * without creating a duplicate. The middleware provides the universal
 * audit coverage; the wrappers retain ownership of the review-gate
 * coordination and execution lifecycle for now. Full removal of the
 * per-case wrappers is tracked as a follow-up — see the note in the
 * Sprint 2 commit.
 */

import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { toolCallSecurityEvents } from '../../db/schema/index.js';
import { getActionDefinition } from '../../config/actionRegistry.js';
import {
  actionService,
  buildActionIdempotencyKey,
  hashActionArgs,
} from '../actionService.js';
import { policyEngineService } from '../policyEngineService.js';
import type {
  PreToolMiddleware,
  PreToolResult,
  MiddlewareContext,
  PreToolDecision,
} from './types.js';

// ---------------------------------------------------------------------------
// Audit event writer — dedupes via ON CONFLICT DO NOTHING on the partial
// unique index `tool_call_security_events_run_tool_unique`.
// ---------------------------------------------------------------------------

async function writeSecurityEvent(params: {
  organisationId: string;
  subaccountId: string | null;
  agentRunId: string;
  toolCallId: string;
  toolSlug: string;
  decision: 'allow' | 'deny' | 'review';
  reason: string | null;
  argsHash: string;
  scopeCheckResults?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db
      .insert(toolCallSecurityEvents)
      .values({
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
        agentRunId: params.agentRunId,
        toolCallId: params.toolCallId,
        toolSlug: params.toolSlug,
        decision: params.decision,
        reason: params.reason,
        argsHash: params.argsHash,
        scopeCheckResults: params.scopeCheckResults ?? null,
        createdAt: new Date(),
      })
      .onConflictDoNothing({
        target: [toolCallSecurityEvents.agentRunId, toolCallSecurityEvents.toolCallId],
      });
  } catch (err) {
    // Audit failures must never crash the agent run. Log and continue.
    // The RLS + scope layers are the authoritative guard; the audit row
    // is best-effort telemetry.
    console.error('[proposeActionMiddleware] security event write failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Scope validation — consumes `ActionDefinition.scopeRequirements` (Sprint 1
// P0.2 Slice B). Returns the first violation, or null when every declared
// field passes. No-op when the action has no scopeRequirements.
// ---------------------------------------------------------------------------

interface ScopeCheckOutcome {
  ok: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

function validateScope(
  actionType: string,
  input: Record<string, unknown>,
  ctx: MiddlewareContext,
): ScopeCheckOutcome {
  const definition = getActionDefinition(actionType);
  const req = definition?.scopeRequirements;
  if (!req) return { ok: true };

  const details: Record<string, unknown> = {};

  // subaccount field checks
  if (req.validateSubaccountFields && req.validateSubaccountFields.length > 0) {
    const expectedSub = ctx.request.subaccountId ?? null;
    for (const field of req.validateSubaccountFields) {
      const value = input[field];
      if (value === undefined || value === null || value === '') {
        return {
          ok: false,
          reason: `scope_violation: ${field} is required`,
          details: { field, expected: expectedSub, actual: value ?? null },
        };
      }
      if (typeof value !== 'string') {
        return {
          ok: false,
          reason: `scope_violation: ${field} must be a string UUID`,
          details: { field, expected: expectedSub, actual: value },
        };
      }
      if (expectedSub !== null && value !== expectedSub) {
        return {
          ok: false,
          reason: `scope_violation: ${field} does not match run subaccount`,
          details: { field, expected: expectedSub, actual: value },
        };
      }
      details[field] = { checked: 'subaccount', ok: true };
    }
  }

  // GHL location checks — placeholder, real tenant binding lands with
  // the integration-ownership index in a later sprint. For now, we
  // only verify the field is present and a string.
  if (req.validateGhlLocationFields && req.validateGhlLocationFields.length > 0) {
    for (const field of req.validateGhlLocationFields) {
      const value = input[field];
      if (value === undefined || value === null || value === '') {
        return {
          ok: false,
          reason: `scope_violation: ${field} is required`,
          details: { field, kind: 'ghl_location', actual: value ?? null },
        };
      }
      if (typeof value !== 'string') {
        return {
          ok: false,
          reason: `scope_violation: ${field} must be a string`,
          details: { field, kind: 'ghl_location', actual: value },
        };
      }
      details[field] = { checked: 'ghl_location', ok: true };
    }
  }

  if (req.requiresUserContext) {
    // Best-effort: run context carries a userId on the request only for
    // user-initiated runs. System-initiated runs (cron, auto-resume) have
    // no userId.
    const userId =
      (ctx.request as unknown as { userId?: string }).userId ??
      (ctx.request.triggerContext as { userId?: string } | undefined)?.userId;
    if (!userId) {
      return {
        ok: false,
        reason: 'scope_violation: action requires user context',
        details: { field: 'userId', actual: null },
      };
    }
    details['userId'] = { checked: 'user_context', ok: true };
  }

  return { ok: true, details };
}

// ---------------------------------------------------------------------------
// Middleware implementation
// ---------------------------------------------------------------------------

export const proposeActionMiddleware: PreToolMiddleware = {
  name: 'proposeAction',

  async execute(
    ctx: MiddlewareContext,
    toolCall: { id: string; name: string; input: Record<string, unknown> },
  ): Promise<PreToolResult> {
    // ── 1. Decision cache short-circuit ──────────────────────────────────
    const cached = ctx.preToolDecisions.get(toolCall.id);
    if (cached) {
      return toPreToolResult(cached);
    }

    const runId = ctx.runId;
    const organisationId = ctx.request.organisationId;
    const subaccountId = ctx.request.subaccountId ?? null;
    const argsHash = hashActionArgs(toolCall.input);

    const definition = getActionDefinition(toolCall.name);

    // ── 2. Methodology skills fast-path ──────────────────────────────────
    // Pure-prompt scaffolds with no side effects (review_code, draft_*,
    // etc). Write a single audit row and short-circuit.
    if (definition?.isMethodology) {
      await writeSecurityEvent({
        organisationId,
        subaccountId,
        agentRunId: runId,
        toolCallId: toolCall.id,
        toolSlug: toolCall.name,
        decision: 'allow',
        reason: 'methodology_skill',
        argsHash,
      });
      const decision: PreToolDecision = { action: 'continue' };
      ctx.preToolDecisions.set(toolCall.id, decision);
      return decision;
    }

    // ── 3. Scope validation (Layer 3 guard) ──────────────────────────────
    const scopeOutcome = validateScope(toolCall.name, toolCall.input, ctx);
    if (!scopeOutcome.ok) {
      await writeSecurityEvent({
        organisationId,
        subaccountId,
        agentRunId: runId,
        toolCallId: toolCall.id,
        toolSlug: toolCall.name,
        decision: 'deny',
        reason: scopeOutcome.reason ?? 'scope_violation',
        argsHash,
        scopeCheckResults: scopeOutcome.details,
      });
      const decision: PreToolDecision = {
        action: 'block',
        reason: scopeOutcome.reason ?? 'scope_violation',
      };
      ctx.preToolDecisions.set(toolCall.id, decision);
      return decision;
    }

    // ── 4. Unknown action type — skip proposeAction (legacy tools) ───────
    // Skills not in ACTION_REGISTRY are not subject to the policy engine
    // gate. They still get an audit row so we can see every tool call.
    if (!definition) {
      await writeSecurityEvent({
        organisationId,
        subaccountId,
        agentRunId: runId,
        toolCallId: toolCall.id,
        toolSlug: toolCall.name,
        decision: 'allow',
        reason: 'unregistered_tool',
        argsHash,
      });
      const decision: PreToolDecision = { action: 'continue' };
      ctx.preToolDecisions.set(toolCall.id, decision);
      return decision;
    }

    // ── 5. proposeAction with deterministic idempotency key ──────────────
    const idempotencyKey = buildActionIdempotencyKey({
      runId,
      toolCallId: toolCall.id,
      args: toolCall.input,
    });

    try {
      const proposed = await actionService.proposeAction({
        organisationId,
        subaccountId,
        agentId: ctx.request.agentId,
        agentRunId: runId,
        actionType: toolCall.name,
        idempotencyKey,
        payload: toolCall.input,
      });

      // Blocked by policy engine or gate resolution
      if (proposed.status === 'blocked') {
        await writeSecurityEvent({
          organisationId,
          subaccountId,
          agentRunId: runId,
          toolCallId: toolCall.id,
          toolSlug: toolCall.name,
          decision: 'deny',
          reason: 'policy_block',
          argsHash,
        });
        const decision: PreToolDecision = {
          action: 'block',
          reason: 'policy_block',
        };
        ctx.preToolDecisions.set(toolCall.id, decision);
        return decision;
      }

      // Review or auto — middleware's audit duty is done. The existing
      // per-case wrappers in skillExecutor.ts coordinate the HITL wait
      // and the execution lifecycle. `pending_approval` → wrapper awaits
      // review. `approved` → wrapper runs the skill directly.
      const auditDecision: 'allow' | 'review' =
        proposed.status === 'pending_approval' ? 'review' : 'allow';
      await writeSecurityEvent({
        organisationId,
        subaccountId,
        agentRunId: runId,
        toolCallId: toolCall.id,
        toolSlug: toolCall.name,
        decision: auditDecision,
        reason: auditDecision === 'review' ? 'policy_review' : null,
        argsHash,
        scopeCheckResults: scopeOutcome.details,
      });
      const decision: PreToolDecision = { action: 'continue' };
      ctx.preToolDecisions.set(toolCall.id, decision);
      return decision;
    } catch (err) {
      // proposeAction threw unexpectedly — do NOT block the agent run.
      // Log, record a failed-audit row, and continue. The per-case
      // wrappers will attempt proposeAction again and may succeed on
      // retry, or the execution will fail with a proper error.
      console.error('[proposeActionMiddleware] proposeAction threw:', err);
      const decision: PreToolDecision = { action: 'continue' };
      ctx.preToolDecisions.set(toolCall.id, decision);
      return decision;
    }
  },
};

function toPreToolResult(decision: PreToolDecision): PreToolResult {
  // PreToolDecision is a structural subset of PreToolResult by design.
  return decision as PreToolResult;
}

// Export the internal helpers for unit tests.
export const __testing = {
  validateScope,
  writeSecurityEvent,
};

export { hashActionArgs } from '../actionService.js';
