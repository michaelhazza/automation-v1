// Delegation Outcome service — impure wrapper.
// Pure validation lives in delegationOutcomeServicePure.ts.
// Spec: tasks/builds/paperclip-hierarchy/plan.md §5.4.
//
// INV-3: insertOutcomeSafe is the SINGLE skill-handler entry point.
//        recordOutcomeStrict is test/backfill-only — never call it from skill handlers.

import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { delegationOutcomes } from '../db/schema/delegationOutcomes.js';
import { subaccountAgents } from '../db/schema/subaccountAgents.js';
import type { DelegationOutcome } from '../../shared/types/delegation.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import {
  DEFAULT_SOFT_BREAKER_CONFIG,
  createBreakerState,
  isOpen as isBreakerOpen,
  recordOutcome as recordBreakerOutcome,
  shouldAttempt as shouldBreakerAttempt,
} from '../lib/softBreakerPure.js';
import {
  assertDelegationOutcomeShape,
  buildListQueryFilters,
  type DelegationOutcomeInput,
  type RawListFilters,
} from './delegationOutcomeServicePure.js';

// ---------------------------------------------------------------------------
// Dual-write soft breaker
// ---------------------------------------------------------------------------
// Under DB pressure, every delegation attempt tries to write an outcome row.
// Without a breaker, failures produce one warn log per call + CPU burn on
// retries. Adopt the same pattern as `llmInflightRegistry.persistHistoryEvent`
// (architecture.md § fire-and-forget persistence paths).
//
// Observability signal:
//   - Structured WARN `delegation_outcome_write_failed` per failed DB op
//     below threshold → log pipeline counts occurrences.
//   - Exactly one `delegation_outcome_breaker_opened` per trip.
//   - Construction bugs (shape validation, actor mismatch) do NOT feed the
//     breaker — those are deterministic errors, not pressure signals.

const outcomeBreakerState = createBreakerState();

/** Test-only helper. Mirrors the llmInflightRegistry test hook. */
export function _isOutcomeBreakerOpenForTests(nowMs: number): boolean {
  return isBreakerOpen(outcomeBreakerState, nowMs);
}

// ---------------------------------------------------------------------------
// insertOutcomeSafe — skill-handler entry point (INV-3)
// ---------------------------------------------------------------------------

/**
 * Record a delegation outcome. Swallows all errors — skill handlers MUST use
 * this function; failures must never surface to callers.
 *
 * Steps:
 *   1. Breaker gate (`shouldBreakerAttempt`) — drop silently if open
 *   2. Pure shape validation (`assertDelegationOutcomeShape`)
 *   3. DB integrity check: both actor `subaccount_agents` rows must exist and
 *      match `input.subaccountId`
 *   4. Insert into `delegation_outcomes`
 *
 * DB failures feed the breaker; construction bugs (shape, actor mismatch) do
 * not. Any failure logs a WARN with tag `delegation_outcome_write_failed`.
 */
export async function insertOutcomeSafe(input: DelegationOutcomeInput): Promise<void> {
  // Step 1 — breaker gate
  if (!shouldBreakerAttempt(outcomeBreakerState, Date.now())) return;

  // Step 2 — pure shape validation (construction bug — do not feed breaker)
  try {
    assertDelegationOutcomeShape(input);
  } catch (err) {
    logger.warn('delegation_outcome_write_failed', {
      tag: 'delegation_outcome_write_failed',
      reason: 'shape_invalid',
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    const db = getOrgScopedDb('delegationOutcomeService.insertOutcomeSafe');

    // Step 3 — service-layer integrity check (single round trip — spec §4.4).
    // Construction bugs (not DB pressure) — logged and returned without feeding
    // the breaker.
    const actors = await db
      .select({ id: subaccountAgents.id, subaccountId: subaccountAgents.subaccountId })
      .from(subaccountAgents)
      .where(
        inArray(subaccountAgents.id, [input.callerAgentId, input.targetAgentId]),
      );

    if (actors.length !== 2) {
      logger.warn('delegation_outcome_write_failed', {
        tag: 'delegation_outcome_write_failed',
        callerAgentId: input.callerAgentId,
        targetAgentId: input.targetAgentId,
        reason: 'one or both agent rows not found in org scope',
      });
      recordBreakerOutcome(outcomeBreakerState, true, Date.now());
      return;
    }

    const mismatched = actors.filter((a) => a.subaccountId !== input.subaccountId);
    if (mismatched.length > 0) {
      logger.warn('delegation_outcome_write_failed', {
        tag: 'delegation_outcome_write_failed',
        mismatchedIds: mismatched.map((a) => a.id),
        reason: 'actor subaccount_id mismatch — construction bug',
      });
      recordBreakerOutcome(outcomeBreakerState, true, Date.now());
      return;
    }

    // Step 4 — insert with idempotency guard (migration 0218). Retries, async
    // writes, and soft-breaker half-open probes that replay the same logical
    // delegation event get silently collapsed rather than creating duplicate
    // rows. ON CONFLICT DO NOTHING matches the mcp_tool_invocations pattern
    // (architecture.md §mcp_tool_invocations).
    await db.insert(delegationOutcomes).values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      runId: input.runId,
      callerAgentId: input.callerAgentId,
      targetAgentId: input.targetAgentId,
      delegationScope: input.delegationScope as 'children' | 'descendants' | 'subaccount',
      outcome: input.outcome as 'accepted' | 'rejected',
      reason: input.reason ?? null,
      delegationDirection: input.delegationDirection as 'down' | 'up' | 'lateral',
    }).onConflictDoNothing();

    recordBreakerOutcome(outcomeBreakerState, true, Date.now());
  } catch (err) {
    const { trippedNow } = recordBreakerOutcome(outcomeBreakerState, false, Date.now());
    if (trippedNow) {
      logger.warn('delegation_outcome_breaker_opened', {
        tag: 'delegation_outcome_breaker_opened',
        openDurationMs: DEFAULT_SOFT_BREAKER_CONFIG.openDurationMs,
        failThreshold: DEFAULT_SOFT_BREAKER_CONFIG.failThreshold,
        lastError: err instanceof Error ? err.message : String(err),
      });
    } else if (isBreakerOpen(outcomeBreakerState, Date.now())) {
      // Prior trip — stay silent so we don't flood during the open window.
    } else {
      logger.warn('delegation_outcome_write_failed', {
        tag: 'delegation_outcome_write_failed',
        reason: 'db_error',
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// recordOutcomeStrict — test / backfill only (INV-3)
// ---------------------------------------------------------------------------

/**
 * @internal TEST AND BACKFILL USE ONLY.
 *
 * Like `insertOutcomeSafe` but throws on failure. Skill handlers MUST NOT call
 * this function — use `insertOutcomeSafe` instead.
 *
 * @throws on any validation or DB error.
 */
export async function recordOutcomeStrict(input: DelegationOutcomeInput): Promise<void> {
  assertDelegationOutcomeShape(input);

  const db = getOrgScopedDb('delegationOutcomeService.recordOutcomeStrict');

  await db.insert(delegationOutcomes).values({
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    runId: input.runId,
    callerAgentId: input.callerAgentId,
    targetAgentId: input.targetAgentId,
    delegationScope: input.delegationScope as 'children' | 'descendants' | 'subaccount',
    outcome: input.outcome as 'accepted' | 'rejected',
    reason: input.reason ?? null,
    delegationDirection: input.delegationDirection as 'down' | 'up' | 'lateral',
  });
}

// ---------------------------------------------------------------------------
// list — read path
// ---------------------------------------------------------------------------

/**
 * Read delegation outcomes for an organisation.
 *
 * Filters:
 *   - `callerAgentId` — optional, filters by caller
 *   - `targetAgentId` — optional, filters by target
 *   - `outcome` — optional, 'accepted' | 'rejected'
 *   - `delegationDirection` — optional, 'down' | 'up' | 'lateral'
 *   - `since` — default now - 7d
 *   - `limit` — default 100, capped at 500
 *
 * Results ordered by `created_at DESC`.
 */
export async function list(
  orgId: string,
  filters: RawListFilters = {},
): Promise<DelegationOutcome[]> {
  const coerced = buildListQueryFilters(filters);

  const db = getOrgScopedDb('delegationOutcomeService.list');

  const conditions = [
    eq(delegationOutcomes.organisationId, orgId),
    gte(delegationOutcomes.createdAt, coerced.since),
  ];

  if (coerced.callerAgentId) {
    conditions.push(eq(delegationOutcomes.callerAgentId, coerced.callerAgentId));
  }
  if (coerced.targetAgentId) {
    conditions.push(eq(delegationOutcomes.targetAgentId, coerced.targetAgentId));
  }
  if (coerced.outcome) {
    conditions.push(eq(delegationOutcomes.outcome, coerced.outcome));
  }
  if (coerced.delegationDirection) {
    conditions.push(eq(delegationOutcomes.delegationDirection, coerced.delegationDirection));
  }

  const rows = await db
    .select()
    .from(delegationOutcomes)
    .where(and(...conditions))
    .orderBy(desc(delegationOutcomes.createdAt))
    .limit(coerced.limit);

  return rows.map((row) => ({
    id: row.id,
    organisationId: row.organisationId,
    subaccountId: row.subaccountId,
    runId: row.runId,
    callerAgentId: row.callerAgentId,
    targetAgentId: row.targetAgentId,
    delegationScope: row.delegationScope,
    outcome: row.outcome,
    reason: row.reason,
    delegationDirection: row.delegationDirection,
    createdAt: row.createdAt.toISOString(),
  }));
}
