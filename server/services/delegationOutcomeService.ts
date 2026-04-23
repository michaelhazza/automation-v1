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
  assertDelegationOutcomeShape,
  buildListQueryFilters,
  type DelegationOutcomeInput,
  type RawListFilters,
} from './delegationOutcomeServicePure.js';

// ---------------------------------------------------------------------------
// insertOutcomeSafe — skill-handler entry point (INV-3)
// ---------------------------------------------------------------------------

/**
 * Record a delegation outcome. Swallows all errors — skill handlers MUST use
 * this function; failures must never surface to callers.
 *
 * Steps:
 *   1. Pure shape validation (`assertDelegationOutcomeShape`)
 *   2. DB integrity check: both actor `subaccount_agents` rows must exist and
 *      match `input.subaccountId`
 *   3. Insert into `delegation_outcomes`
 *
 * Any failure logs a WARN with tag `delegation_outcome_write_failed` and returns.
 */
export async function insertOutcomeSafe(input: DelegationOutcomeInput): Promise<void> {
  try {
    // Step 1 — pure shape validation
    assertDelegationOutcomeShape(input);

    const db = getOrgScopedDb('delegationOutcomeService.insertOutcomeSafe');

    // Step 2 — service-layer integrity check (single round trip — spec §4.4)
    // never-throws contract: any failure logs WARN and returns; the surrounding
    // try/catch is the structural guarantee that errors cannot escape this function.
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
      return;
    }

    const mismatched = actors.filter((a) => a.subaccountId !== input.subaccountId);
    if (mismatched.length > 0) {
      logger.warn('delegation_outcome_write_failed', {
        tag: 'delegation_outcome_write_failed',
        mismatchedIds: mismatched.map((a) => a.id),
        reason: 'actor subaccount_id mismatch — construction bug',
      });
      return;
    }

    // Step 3 — insert
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
  } catch (err) {
    logger.warn('delegation_outcome_write_failed', {
      tag: 'delegation_outcome_write_failed',
      err: err instanceof Error ? err.message : String(err),
    });
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
