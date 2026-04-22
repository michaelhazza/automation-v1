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
import { workspaceMemoryEntries, memoryBlocks } from '../db/schema/index.js';
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

// ---------------------------------------------------------------------------
// Phase 6 / W3.5 — memory_blocks quality decay (exclusive owner of quality_score)
// ---------------------------------------------------------------------------

const BLOCK_DECAY_RATE = 0.02;
const BLOCK_PRUNE_THRESHOLD = 0.10;
const BLOCK_AUTO_DEPRECATE_THRESHOLD = 0.15;
const BLOCK_AUTO_DEPRECATE_DAYS = 14;

export interface BlockDecaySummary {
  organisationId: string;
  decayed: number;
  autoDeprecated: number;
  durationMs: number;
}

/**
 * Applies nightly decay to memory_blocks quality_score.
 * Blocks below BLOCK_AUTO_DEPRECATE_THRESHOLD for BLOCK_AUTO_DEPRECATE_DAYS
 * are transitioned to deprecated_at.
 *
 * This is the ONLY path through which memory_blocks.quality_score is mutated.
 */
export async function applyBlockQualityDecay(organisationId: string): Promise<BlockDecaySummary> {
  const started = Date.now();
  const now = new Date();
  let decayed = 0;
  let autoDeprecated = 0;

  const rows = await db
    .select({
      id: memoryBlocks.id,
      qualityScore: memoryBlocks.qualityScore,
      updatedAt: memoryBlocks.updatedAt,
      deprecatedAt: memoryBlocks.deprecatedAt,
    })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.organisationId, organisationId),
        isNull(memoryBlocks.deletedAt),
        isNull(memoryBlocks.deprecatedAt),
      ),
    );

  for (const row of rows) {
    const currentScore = Number(row.qualityScore ?? 0.5);
    const newScore = Math.max(0, currentScore - BLOCK_DECAY_RATE);

    const daysSinceUpdate =
      (now.getTime() - row.updatedAt.getTime()) / (1000 * 60 * 60 * 24);

    if (newScore < BLOCK_AUTO_DEPRECATE_THRESHOLD && daysSinceUpdate >= BLOCK_AUTO_DEPRECATE_DAYS) {
      await db
        .update(memoryBlocks)
        .set({ deprecatedAt: now, deprecationReason: 'low_quality', updatedAt: now })
        .where(and(
          eq(memoryBlocks.id, row.id),
          eq(memoryBlocks.organisationId, organisationId),
        ));
      autoDeprecated += 1;
    } else if (newScore !== currentScore) {
      // Do NOT bump `updatedAt` on a decay-only write. `daysSinceUpdate` above
      // is measured against `updatedAt`, and if we bumped it here every rule
      // would look freshly updated after the first decay pass — the
      // `>= BLOCK_AUTO_DEPRECATE_DAYS` gate could then never fire for a rule
      // whose score gradually falls below threshold. `updatedAt` tracks
      // user-facing changes; decay is a background scoring adjustment.
      await db
        .update(memoryBlocks)
        .set({ qualityScore: String(newScore.toFixed(2)) })
        .where(and(
          eq(memoryBlocks.id, row.id),
          eq(memoryBlocks.organisationId, organisationId),
        ));
      decayed += 1;
    }
  }

  return {
    organisationId,
    decayed,
    autoDeprecated,
    durationMs: Date.now() - started,
  };
}
