/**
 * memoryEntryQualityService — sole owner of qualityScore mutations
 *
 * This service is the ONLY path through which `workspace_memory_entries.quality_score`
 * is mutated post-write (spec §4.4 invariant). The nightly decay job and the
 * weekly quality-adjustment job (Phase 2 S4) both call into this service.
 * No other service may import a qualityScore-writing method.
 *
 * Exports:
 *   applyDecay(subaccountId)  — apply nightly decay to all entries
 *   pruneLowQuality(subaccountId) — soft-delete entries below PRUNE_THRESHOLD
 *
 * Both are called by `memoryEntryDecayJob` in sequence: decay first, then
 * prune (so a freshly-decayed entry can fall below threshold in the same tick).
 *
 * Spec: docs/memory-and-briefings-spec.md §4.1 (S1)
 */

import { eq, and, isNull, isNotNull, lt, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workspaceMemoryEntries } from '../db/schema/index.js';
import {
  computeDecayFactor,
  isPruneEligible,
  decideUtilityAdjustment,
} from './memoryEntryQualityServicePure.js';
import { REINDEX_THRESHOLD, PRUNE_THRESHOLD } from '../config/limits.js';

// ---------------------------------------------------------------------------
// applyDecay
// ---------------------------------------------------------------------------

export interface DecaySummary {
  subaccountId: string;
  processed: number;
  decayed: number;
  durationMs: number;
}

/**
 * Iterate all non-deleted entries for the subaccount, compute the decay
 * factor for each, and write the new qualityScore back.
 *
 * Processes entries in batches of 100 to bound memory usage. Returns a
 * summary for observability.
 *
 * Throws `{ statusCode: 500, message, errorCode: 'DECAY_FAILED' }` if the
 * batch fails (callers can catch and log, then continue to the next subaccount).
 */
export async function applyDecay(subaccountId: string): Promise<DecaySummary> {
  const started = Date.now();
  const now = new Date();
  let processed = 0;
  let decayed = 0;

  try {
    // Fetch all active entries with quality scoring data. Phase B §6.6 —
    // `entryType` is now passed into `computeDecayFactor` so per-type
    // half-life rates apply.
    const entries = await db
      .select({
        id: workspaceMemoryEntries.id,
        qualityScore: workspaceMemoryEntries.qualityScore,
        lastAccessedAt: workspaceMemoryEntries.lastAccessedAt,
        entryType: workspaceMemoryEntries.entryType,
      })
      .from(workspaceMemoryEntries)
      .where(
        and(
          eq(workspaceMemoryEntries.subaccountId, subaccountId),
          isNull(workspaceMemoryEntries.deletedAt),
        ),
      );

    // Process in batches of 100
    const BATCH_SIZE = 100;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);

      for (const entry of batch) {
        const currentScore = entry.qualityScore ?? 0.5;
        const factor = computeDecayFactor({
          qualityScore: currentScore,
          lastAccessedAt: entry.lastAccessedAt,
          now,
          entryType: entry.entryType,
        });

        if (factor < 1.0) {
          const newScore = Math.max(0.1, currentScore * factor);
          await db
            .update(workspaceMemoryEntries)
            .set({
              qualityScore: newScore,
              qualityScoreUpdater: 'system_decay_job',
              qualityComputedAt: now,
              decayComputedAt: now,
            })
            .where(eq(workspaceMemoryEntries.id, entry.id));
          decayed += 1;
        } else {
          // Score unchanged — still stamp decayComputedAt so the utility-adjust
          // job knows decay has run on this entry (ordering guard).
          await db
            .update(workspaceMemoryEntries)
            .set({ decayComputedAt: now })
            .where(eq(workspaceMemoryEntries.id, entry.id));
        }
        processed += 1;
      }
    }
  } catch (err) {
    throw {
      statusCode: 500,
      message: `Decay failed for subaccount ${subaccountId}: ${err instanceof Error ? err.message : String(err)}`,
      errorCode: 'DECAY_FAILED',
    };
  }

  return {
    subaccountId,
    processed,
    decayed,
    durationMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// pruneLowQuality
// ---------------------------------------------------------------------------

export interface PruneSummary {
  subaccountId: string;
  pruned: number;
  reindexTriggered: boolean;
  durationMs: number;
}

/**
 * Soft-delete entries that meet ALL pruning conditions (score below threshold
 * AND older than PRUNE_AGE_DAYS). Returns a summary indicating whether the
 * HNSW reindex job should be enqueued.
 *
 * Throws `{ statusCode: 500, message, errorCode: 'DECAY_FAILED' }` on failure.
 */
export async function pruneLowQuality(subaccountId: string): Promise<PruneSummary> {
  const started = Date.now();
  const now = new Date();

  try {
    // Fetch candidates: score below threshold, not yet deleted
    const candidates = await db
      .select({
        id: workspaceMemoryEntries.id,
        qualityScore: workspaceMemoryEntries.qualityScore,
        createdAt: workspaceMemoryEntries.createdAt,
        lastAccessedAt: workspaceMemoryEntries.lastAccessedAt,
      })
      .from(workspaceMemoryEntries)
      .where(
        and(
          eq(workspaceMemoryEntries.subaccountId, subaccountId),
          isNull(workspaceMemoryEntries.deletedAt),
          // Pre-filter: only rows with low score (index assist)
          lt(workspaceMemoryEntries.qualityScore, PRUNE_THRESHOLD),
        ),
      );

    const toDelete: string[] = [];
    for (const entry of candidates) {
      if (
        isPruneEligible({
          qualityScore: entry.qualityScore ?? 0,
          createdAt: entry.createdAt,
          lastAccessedAt: entry.lastAccessedAt,
          now,
        })
      ) {
        toDelete.push(entry.id);
      }
    }

    if (toDelete.length > 0) {
      await db
        .update(workspaceMemoryEntries)
        .set({ deletedAt: now })
        .where(inArray(workspaceMemoryEntries.id, toDelete));
    }

    return {
      subaccountId,
      pruned: toDelete.length,
      reindexTriggered: toDelete.length >= REINDEX_THRESHOLD,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    throw {
      statusCode: 500,
      message: `Prune failed for subaccount ${subaccountId}: ${err instanceof Error ? err.message : String(err)}`,
      errorCode: 'DECAY_FAILED',
    };
  }
}

// ---------------------------------------------------------------------------
// adjustFromUtility — S4 weekly quality adjustment (§4.4)
// ---------------------------------------------------------------------------

export interface UtilityAdjustmentSummary {
  subaccountId: string;
  scanned: number;
  boosted: number;
  reduced: number;
  skipped: number;
  durationMs: number;
}

/**
 * Weekly utility-based quality adjustment pass (§4.4 S4).
 *
 * For every non-deleted entry in the subaccount, read `injectedCount` and
 * `citedCount` from the workspace_memory_entries row, compute utilityRate,
 * and apply the pure decision function. Persists the new qualityScore.
 *
 * **Invariant:** This is the second and only other allowed qualityScore
 * mutator alongside `applyDecay`. No other service may touch qualityScore.
 *
 * **Feature-flagged:** The caller (weekly job) should check
 * `S4_QUALITY_ADJUST_LIVE` before invoking — this function does NOT honour
 * the flag itself, allowing scripted verification / one-shot runs to bypass it.
 */
export async function adjustFromUtility(subaccountId: string): Promise<UtilityAdjustmentSummary> {
  const started = Date.now();
  const now = new Date();
  let scanned = 0;
  let boosted = 0;
  let reduced = 0;
  let skipped = 0;

  const entries = await db
    .select({
      id: workspaceMemoryEntries.id,
      qualityScore: workspaceMemoryEntries.qualityScore,
      injectedCount: workspaceMemoryEntries.injectedCount,
      citedCount: workspaceMemoryEntries.citedCount,
    })
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNull(workspaceMemoryEntries.deletedAt),
        // Ordering guard: only adjust entries that have had at least one
        // decay pass. Ensures decay always precedes utility adjustment.
        isNotNull(workspaceMemoryEntries.decayComputedAt),
        // Skip unverified entries — no provenance = no reliable utility signal.
        eq(workspaceMemoryEntries.isUnverified, false),
      ),
    );

  scanned = entries.length;

  for (const entry of entries) {
    const currentScore = entry.qualityScore ?? 0.5;
    const decision = decideUtilityAdjustment({
      qualityScore: currentScore,
      injectedCount: entry.injectedCount ?? 0,
      citedCount: entry.citedCount ?? 0,
    });

    if (decision.action === 'boost' || decision.action === 'reduce') {
      await db
        .update(workspaceMemoryEntries)
        .set({
          qualityScore: decision.newScore,
          qualityScoreUpdater: 'system_utility_job',
          qualityComputedAt: now,
        })
        .where(eq(workspaceMemoryEntries.id, entry.id));
      if (decision.action === 'boost') boosted += 1;
      else reduced += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    subaccountId,
    scanned,
    boosted,
    reduced,
    skipped,
    durationMs: Date.now() - started,
  };
}
