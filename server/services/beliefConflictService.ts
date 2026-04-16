/**
 * beliefConflictService — single point of truth for belief conflict detection
 * and supersession.
 *
 * This service is the ONLY path through which belief supersession occurs.
 * It is called on the belief write path (agentBeliefService) whenever a new
 * belief carries an explicit `entityKey`.
 *
 * Conflict rule (§4.3 S3):
 *   A conflict exists when two active, non-superseded beliefs for the same
 *   (subaccountId, entityKey) have contradicting values across different agents.
 *   "Contradicting" is structural: any two beliefs from different agents for the
 *   same entityKey on the same subaccount are treated as potentially conflicting
 *   and evaluated by confidence gap.
 *
 * Resolution (§4.3):
 *   - Gap > CONFLICT_CONFIDENCE_GAP: auto-supersede the lower-confidence belief.
 *   - Gap ≤ CONFLICT_CONFIDENCE_GAP: insert `memory_review_queue` row with
 *     `itemType='belief_conflict'` for human review.
 *   - Same agent: skip (an agent cannot conflict with itself on the same entityKey).
 *
 * Phase 1 real-time injection:
 *   The real-time path (pausing an active agent run to surface a conflict) is a
 *   no-op stub in Phase 1. Phase 2 flips it live after `clarificationService`
 *   lands (Phase 2 task 16 in the build plan).
 *
 * Spec: docs/memory-and-briefings-spec.md §4.3 (S3)
 */

import { eq, and, isNull, ne } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentBeliefs, memoryReviewQueue } from '../db/schema/index.js';
import { CONFLICT_CONFIDENCE_GAP } from '../config/limits.js';
import {
  computeConflictResolution,
  type ConflictResolutionDecision,
} from './beliefConflictServicePure.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ConflictCheckParams {
  /** The newly written (or updated) belief that may conflict with existing ones */
  newBelief: {
    id: string;
    organisationId: string;
    subaccountId: string;
    agentId: string;
    entityKey: string;
    value: string;
    confidence: number;
  };
  /**
   * If the agent is currently executing an active run, pass the runId here.
   * Phase 1: the real-time injection path is a stub — this parameter is
   * accepted but not acted on. Phase 2 activates the real-time path.
   */
  activeRunId?: string;
}

export interface ConflictCheckResult {
  conflictsFound: number;
  autoSuperseded: number;
  queuedForReview: number;
}

/**
 * Check whether the newly-written belief creates a cross-agent conflict for
 * the same (subaccountId, entityKey). Resolve according to the confidence-gap
 * rule. Returns a summary for logging.
 *
 * Idempotent: safe to call multiple times for the same belief — the partial
 * index `agent_beliefs_entity_key_idx` filters `superseded_by IS NULL` so
 * already-superseded beliefs never appear in the conflict query.
 */
export async function checkAndResolveConflicts(
  params: ConflictCheckParams,
): Promise<ConflictCheckResult> {
  const { newBelief, activeRunId } = params;

  // Find all active, non-superseded beliefs from OTHER agents for the same
  // (subaccountId, entityKey). The partial index on agent_beliefs makes this fast.
  const conflicting = await db
    .select({
      id: agentBeliefs.id,
      agentId: agentBeliefs.agentId,
      value: agentBeliefs.value,
      confidence: agentBeliefs.confidence,
      beliefKey: agentBeliefs.beliefKey,
    })
    .from(agentBeliefs)
    .where(
      and(
        eq(agentBeliefs.subaccountId, newBelief.subaccountId),
        eq(agentBeliefs.entityKey, newBelief.entityKey),
        ne(agentBeliefs.agentId, newBelief.agentId), // other agents only
        isNull(agentBeliefs.deletedAt),
        isNull(agentBeliefs.supersededBy),
      ),
    );

  if (conflicting.length === 0) {
    return { conflictsFound: 0, autoSuperseded: 0, queuedForReview: 0 };
  }

  let autoSuperseded = 0;
  let queuedForReview = 0;
  const now = new Date();

  for (const existing of conflicting) {
    const decision = computeConflictResolution({
      newConfidence: newBelief.confidence,
      existingConfidence: existing.confidence,
      gapThreshold: CONFLICT_CONFIDENCE_GAP,
    });

    if (decision.action === 'auto_supersede_existing') {
      // Higher-confidence new belief auto-supersedes the existing one
      await db
        .update(agentBeliefs)
        .set({
          supersededBy: newBelief.id,
          supersededAt: now,
          updatedAt: now,
        })
        .where(eq(agentBeliefs.id, existing.id));
      autoSuperseded += 1;
    } else if (decision.action === 'auto_supersede_new') {
      // Existing belief has higher confidence; supersede the new one
      await db
        .update(agentBeliefs)
        .set({
          supersededBy: existing.id,
          supersededAt: now,
          updatedAt: now,
        })
        .where(eq(agentBeliefs.id, newBelief.id));
      autoSuperseded += 1;
    } else {
      // Gap too small to auto-resolve → queue for human review
      await db.insert(memoryReviewQueue).values({
        organisationId: newBelief.organisationId,
        subaccountId: newBelief.subaccountId,
        itemType: 'belief_conflict',
        payload: {
          newBeliefId: newBelief.id,
          existingBeliefId: existing.id,
          entityKey: newBelief.entityKey,
          newValue: newBelief.value,
          existingValue: existing.value,
          newConfidence: newBelief.confidence,
          existingConfidence: existing.confidence,
          newAgentId: newBelief.agentId,
          existingAgentId: existing.agentId,
          confidenceGap: decision.confidenceGap,
        },
        confidence: Math.max(newBelief.confidence, existing.confidence),
        status: 'pending',
        createdByAgentId: newBelief.agentId,
        createdAt: now,
      });
      queuedForReview += 1;

      // Phase 1: real-time injection into active runs is a no-op stub.
      // Phase 2 activates this path after clarificationService lands.
      if (activeRunId) {
        console.info(
          JSON.stringify({
            event: 'belief_conflict_realtime_stub',
            message: 'S8 not yet landed — real-time conflict injection deferred to Phase 2',
            activeRunId,
            entityKey: newBelief.entityKey,
          }),
        );
      }
    }
  }

  return {
    conflictsFound: conflicting.length,
    autoSuperseded,
    queuedForReview,
  };
}
