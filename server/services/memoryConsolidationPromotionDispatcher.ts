/**
 * memoryConsolidationPromotionDispatcher — per-tenant promotion scan and dispatch.
 *
 * Called by memoryConsolidationPromotionJob for each active (orgId, subaccountId)
 * pair. Must be invoked from within a withOrgTx context (db.transaction + withOrgTx
 * set up by the job). For each candidate workspace_memory_entry it computes promotion
 * signals, checks cooldown, evaluates via evaluatePromotion, and either:
 *   - auto: runs the canonical guarded-UPDATE + tier_transitions INSERT sequence
 *   - operator-approved: inserts into memory_review_queue with ON CONFLICT DO NOTHING
 *
 * The durable audit trail for every promotion is workspace_memory_entry_tier_transitions,
 * written inside the transaction before commit. The memory.block.promoted event is
 * supplementary best-effort observability.
 *
 * Spec: docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md §6 Phase 4,
 * §9.3, §14.1–14.7
 */

import { sql, and, eq, isNull, ne, desc } from 'drizzle-orm';
import {
  workspaceMemoryEntries,
  memoryReviewQueue,
  workspaceMemoryEntryTierTransitions,
} from '../db/schema/index.js';
import { type OrgScopedTx } from '../db/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { getActiveMemoryConsolidationConfig } from '../config/memoryConsolidationConfig.js';
import { evaluatePromotion } from './memoryBlockSynthesisService.js';
import { computeDecayWeight } from './workspaceMemoryService/decayPure.js';
import { isValidPromotionTransition } from '../../shared/types/memoryConsolidation.js';
import type { ConsolidationTier } from '../../shared/types/memoryConsolidation.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchSummary {
  auto_promotions_applied: number;
  auto_promotions_attempted_but_lost_race: number;
  procedural_promotions_queued: number;
  procedural_promotions_skipped_in_cooldown: number;
  invalid_transition_skipped: number;
  evaluation_errors: number;
}

// ---------------------------------------------------------------------------
// Main per-tenant dispatch function
// ---------------------------------------------------------------------------

/**
 * Dispatch promotions for one (orgId, subaccountId) pair.
 * Must be called from within a withOrgTx context.
 */
export async function dispatchPromotionsForTenant(
  orgId: string,
  subaccountId: string,
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    auto_promotions_applied: 0,
    auto_promotions_attempted_but_lost_race: 0,
    procedural_promotions_queued: 0,
    procedural_promotions_skipped_in_cooldown: 0,
    invalid_transition_skipped: 0,
    evaluation_errors: 0,
  };

  const config = getActiveMemoryConsolidationConfig();
  const scopedDb = getOrgScopedDb('memoryConsolidationPromotionDispatcher.dispatchPromotionsForTenant');

  // Load non-deleted, non-procedural candidates with their tier and signal
  // columns. Procedural entries are at the top tier and have no further
  // promotion path; filtering them in SQL avoids loading rows the loop will
  // immediately discard. Ordering by last_accessed_at DESC NULLS LAST
  // prioritises recently-accessed entries (the ones most likely to clear
  // promotion thresholds this cycle); pagination across the full set is
  // tracked in tasks/todo.md.
  const candidates = await scopedDb
    .select({
      id: workspaceMemoryEntries.id,
      consolidationTier: workspaceMemoryEntries.consolidationTier,
      lastAccessedAt: workspaceMemoryEntries.lastAccessedAt,
      accessCount: workspaceMemoryEntries.accessCount,
      citedCount: workspaceMemoryEntries.citedCount,
    })
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.organisationId, orgId),
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNull(workspaceMemoryEntries.deletedAt),
        ne(workspaceMemoryEntries.consolidationTier, 'procedural'),
      ),
    )
    .orderBy(sql`${workspaceMemoryEntries.lastAccessedAt} DESC NULLS LAST`)
    .limit(1000);

  const now = new Date();

  for (const candidate of candidates) {
    try {
      const currentTier = candidate.consolidationTier as ConsolidationTier;

      // Procedural entries are already at the top tier.
      if (currentTier === 'procedural') continue;

      // Compute PromotionSignals.
      // reinforcementCount: access_count tracks times this entry was retrieved.
      // crossSessionRecurrence: cited_count tracks distinct agent-run citation events.
      // recency: exponential decay weight from last_accessed_at.
      const signals = {
        reinforcementCount: candidate.accessCount ?? 0,
        crossSessionRecurrence: candidate.citedCount ?? 0,
        recency: computeDecayWeight(
          currentTier,
          candidate.lastAccessedAt ?? null,
          now,
          config.decayConfig,
        ),
      };

      // Check procedural cooldown for tiers that can reach procedural.
      if (currentTier === 'episodic' || currentTier === 'semantic') {
        const [mostRecent] = await scopedDb
          .select({ cooldownUntil: memoryReviewQueue.cooldownUntil })
          .from(memoryReviewQueue)
          .where(
            and(
              eq(memoryReviewQueue.blockId, candidate.id),
              eq(memoryReviewQueue.itemType, 'promote_to_procedural'),
            ),
          )
          .orderBy(sql`${memoryReviewQueue.createdAt} DESC`)
          .limit(1);

        if (mostRecent?.cooldownUntil && mostRecent.cooldownUntil > now) {
          summary.procedural_promotions_skipped_in_cooldown += 1;
          continue;
        }
      }

      const verdict = evaluatePromotion(currentTier, signals, config);

      if (!verdict.shouldPromote) {
        continue;
      }

      if (verdict.mode === 'operator-approved') {
        const inserted = await scopedDb
          .insert(memoryReviewQueue)
          .values({
            organisationId: orgId,
            subaccountId,
            itemType: 'promote_to_procedural',
            confidence: 0,
            status: 'pending',
            blockId: candidate.id,
            payload: {
              currentTier,
              nextTier: verdict.nextTier,
              totalScore: verdict.totalScore,
              threshold: verdict.threshold,
              configVersion: verdict.configVersion,
              signalContributions: verdict.signalContributions,
            },
          })
          .onConflictDoNothing()
          .returning({ id: memoryReviewQueue.id });

        if (inserted.length > 0) {
          summary.procedural_promotions_queued += 1;
        }
        continue;
      }

      // mode === 'auto': canonical five-step sequence inside a savepoint.
      const oldTier = currentTier;
      const newTier = verdict.nextTier;

      if (!isValidPromotionTransition(oldTier, newTier)) {
        logger.warn('memoryConsolidationPromotionDispatcher.invalid_transition', {
          entryId: candidate.id,
          oldTier,
          newTier,
        });
        summary.invalid_transition_skipped += 1;
        continue;
      }

      try {
        let promotionApplied = false;

        await scopedDb.transaction(async (tx) => {
          const updated = await tx
            .update(workspaceMemoryEntries)
            .set({
              consolidationTier: newTier,
              lastAccessedAt: sql`GREATEST(last_accessed_at, now())`,
            })
            .where(
              and(
                eq(workspaceMemoryEntries.id, candidate.id),
                eq(workspaceMemoryEntries.consolidationTier, oldTier),
                eq(workspaceMemoryEntries.organisationId, orgId),
                eq(workspaceMemoryEntries.subaccountId, subaccountId),
              ),
            )
            .returning({ id: workspaceMemoryEntries.id });

          if (updated.length === 0) {
            return;
          }

          await tx.insert(workspaceMemoryEntryTierTransitions).values({
            entryId: candidate.id,
            organisationId: orgId,
            subaccountId,
            oldTier,
            newTier,
            configVersion: verdict.configVersion,
            signalContributions: verdict.signalContributions as unknown as Record<string, unknown>,
            promotionMode: 'auto',
          });

          promotionApplied = true;
        });

        if (promotionApplied) {
          summary.auto_promotions_applied += 1;
          logger.info('memoryConsolidationPromotionDispatcher.auto_promoted', {
            entryId: candidate.id,
            orgId,
            subaccountId,
            oldTier,
            newTier,
            totalScore: verdict.totalScore,
          });
        } else {
          summary.auto_promotions_attempted_but_lost_race += 1;
          logger.info('memoryConsolidationPromotionDispatcher.race_lost', {
            entryId: candidate.id,
            oldTier,
            newTier,
          });
        }
      } catch (txErr) {
        summary.evaluation_errors += 1;
        logger.error('memoryConsolidationPromotionDispatcher.auto_promotion_failed', {
          entryId: candidate.id,
          error: txErr instanceof Error ? txErr.message : String(txErr),
        });
      }
    } catch (candidateErr) {
      summary.evaluation_errors += 1;
      logger.error('memoryConsolidationPromotionDispatcher.candidate_failed', {
        entryId: candidate.id,
        error: candidateErr instanceof Error ? candidateErr.message : String(candidateErr),
      });
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Canonical promotion sequence — shared by memoryReviewQueueService (operator-approved)
// ---------------------------------------------------------------------------

/**
 * Run the canonical promotion inside the caller-supplied Drizzle transaction.
 * Returns true if promoted; false if the race was lost (0 rows updated for the tier guard).
 * Throws on unexpected DB errors — caller is responsible for error handling.
 */
export async function runCanonicalPromotion(params: {
  entryId: string;
  orgId: string;
  subaccountId: string;
  oldTier: ConsolidationTier;
  newTier: ConsolidationTier;
  configVersion: number;
  signalContributions: Record<string, unknown>;
  promotionMode: 'auto' | 'operator-approved';
  approvedByUserId?: string;
  jobId?: string;
  tx: OrgScopedTx;
}): Promise<boolean> {
  const {
    entryId,
    orgId,
    subaccountId,
    oldTier,
    newTier,
    configVersion,
    signalContributions,
    promotionMode,
    approvedByUserId,
    jobId,
    tx,
  } = params;

  if (!isValidPromotionTransition(oldTier, newTier)) {
    logger.warn('memoryConsolidationPromotionDispatcher.runCanonicalPromotion.invalid_transition', {
      entryId,
      oldTier,
      newTier,
    });
    return false;
  }

  const updated = await tx
    .update(workspaceMemoryEntries)
    .set({
      consolidationTier: newTier,
      lastAccessedAt: sql`GREATEST(last_accessed_at, now())`,
    })
    .where(
      and(
        eq(workspaceMemoryEntries.id, entryId),
        eq(workspaceMemoryEntries.consolidationTier, oldTier),
        eq(workspaceMemoryEntries.organisationId, orgId),
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
      ),
    )
    .returning({ id: workspaceMemoryEntries.id });

  if (updated.length === 0) {
    return false;
  }

  await tx.insert(workspaceMemoryEntryTierTransitions).values({
    entryId,
    organisationId: orgId,
    subaccountId,
    oldTier,
    newTier,
    configVersion,
    signalContributions,
    promotionMode,
    ...(approvedByUserId ? { approvedByUserId } : {}),
    ...(jobId ? { jobId } : {}),
  });

  return true;
}
