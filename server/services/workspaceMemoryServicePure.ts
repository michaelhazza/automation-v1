// ---------------------------------------------------------------------------
// workspaceMemoryServicePure — pure decision helpers for run-outcome-gated
// memory entry promotion + scoring.
//
// Spec: tasks/hermes-audit-tier-1-spec.md §6.4, §6.5, §6.7, §8.3 (Phase B).
//
// Phase B takes the LLM's raw entryType classification from the insight
// extraction call and post-processes it based on the run's outcome:
//   - Successful runs may have `observation` entries promoted to
//     `pattern` / `decision` (higher-quality, longer-decay types).
//   - Failed runs have `observation` / `pattern` / `decision` demoted to
//     `issue`; `preference` is demoted to `observation` (preserves the
//     signal without elevating to the durable `preference` tier).
//   - Partial runs are neutral — kept as classified.
//
// The full matrix lives in §6.5 of the spec and is pinned by the test
// file. This module owns only the decision logic. Impure DB + LLM calls
// stay in `workspaceMemoryService.ts`; the impure write path reads the
// pure module's output and applies it at insert time.
// ---------------------------------------------------------------------------

import type { EntryType } from '../config/limits.js';

/**
 * Structured outcome signal passed by the caller. Required parameter on
 * the extended `extractRunInsights` signature. See §6.4.
 *
 * `trajectoryPassed` is reserved for a future spec (§11.4 #6) that
 * persists the `trajectoryService.compare()` verdict. Phase B callers
 * pass `null` unconditionally; the pure module is still exercised
 * against `true` / `false` values by the test file so the forward-
 * compatible matrix rows don't rot.
 */
export interface RunOutcome {
  runResultStatus: 'success' | 'partial' | 'failed';
  trajectoryPassed: boolean | null;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Entry-type promotion / demotion (§6.5 matrix)
// ---------------------------------------------------------------------------

/**
 * Apply the §6.5 entry-type transformation to an LLM-classified entry.
 * Returns the final entryType that should be persisted. Never returns
 * `null` in Phase B (no drop logic lives here — drop decisions for low-
 * value failed-run entries live in the short-summary guard in the
 * service file per §6.8). The return type keeps `null` as a reserved
 * value for a future spec.
 */
export function selectPromotedEntryType(
  raw: EntryType,
  outcome: RunOutcome,
): EntryType {
  if (outcome.runResultStatus === 'failed') {
    // Failed runs: observation / pattern / decision / issue → issue.
    // preference → observation (preserves signal, no durable tier).
    if (raw === 'preference') return 'observation';
    return 'issue';
  }

  if (outcome.runResultStatus === 'partial') {
    // Partial runs: neutral — keep what the LLM classified.
    return raw;
  }

  // Success path — branch on trajectoryPassed. In Phase B `trajectoryPassed`
  // is always null (§6.4); the `true` and `false` rows are forward-
  // compatible stubs validated by pure tests.
  if (outcome.trajectoryPassed === false) {
    // Trajectory disagrees with the successful status — demote durable
    // classifications back to observation. `preference` stands (user
    // preference is independent of trajectory); `issue` stands.
    if (raw === 'decision' || raw === 'pattern') return 'observation';
    return raw;
  }

  // Success + trajectoryPassed === true | null: promote observation → pattern;
  // otherwise keep the LLM's classification (it already chose durable
  // types when warranted).
  if (raw === 'observation') return 'pattern';
  return raw;
}

// ---------------------------------------------------------------------------
// Override defaults resolution (§6.7 / §6.7.1)
// ---------------------------------------------------------------------------

/**
 * Resolve the final `isUnverified` and `provenanceConfidence` values for a
 * new memory entry. Applies caller overrides over the §6.7 outcome-derived
 * defaults field-by-field; omitted override fields fall through to defaults.
 *
 * Extracted as a pure helper so the override chain can be tested independently
 * of the DB write path in `extractRunInsights`.
 */
export function applyOutcomeDefaults(
  outcome: RunOutcome,
  overrides?: { isUnverified?: boolean; provenanceConfidence?: number },
): { isUnverified: boolean; provenanceConfidence: number } {
  const defaultProvenance = computeProvenanceConfidence(outcome);
  const defaultIsUnverified = outcome.runResultStatus !== 'success';
  return {
    isUnverified:         overrides?.isUnverified ?? defaultIsUnverified,
    provenanceConfidence: overrides?.provenanceConfidence ?? defaultProvenance,
  };
}

// ---------------------------------------------------------------------------
// Quality-score outcome modifier (§6.5 matrix right-hand column)
// ---------------------------------------------------------------------------

/**
 * Apply the outcome modifier to a baseline quality score. The baseline
 * comes from the existing `scoreMemoryEntry` heuristic (unchanged).
 * Final score is clamped to `[0.0, 1.0]`.
 */
export function scoreForOutcome(
  baseScore: number,
  entryType: EntryType,
  outcome: RunOutcome,
): number {
  const modifier = outcomeScoreModifier(entryType, outcome);
  return clamp01(baseScore + modifier);
}

function outcomeScoreModifier(entryType: EntryType, outcome: RunOutcome): number {
  if (outcome.runResultStatus === 'failed') {
    // `issue` is the reinforced type — keep at +0.00.
    if (entryType === 'issue') return 0;
    // Everything else on a failed run is dampened by 0.10.
    return -0.10;
  }

  if (outcome.runResultStatus === 'partial') {
    // Neutral — no bump either direction.
    return 0;
  }

  // Success path.
  if (outcome.trajectoryPassed === true) {
    // Trajectory-verified success — strongest boost.
    if (entryType === 'issue') return 0;
    if (entryType === 'preference') return 0.15;
    return 0.20;
  }

  if (outcome.trajectoryPassed === false) {
    // Trajectory disagreement — no boost.
    return 0;
  }

  // Success, no verdict — mild boost.
  return 0.10;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ---------------------------------------------------------------------------
// Provenance confidence (§6.7)
// ---------------------------------------------------------------------------

/**
 * Per-outcome provenance confidence value written into
 * `workspace_memory_entries.provenanceConfidence`. Replaces today's null.
 *
 *   success + trajectoryPassed=true → 0.9
 *   success                          → 0.7
 *   partial                          → 0.5
 *   failed                           → 0.3
 *
 * Note: `outcomeLearningService` overrides this via `options.overrides`
 * per §6.7.1 — the override bypasses this value for human-curated rows.
 */
export function computeProvenanceConfidence(outcome: RunOutcome): number {
  if (outcome.runResultStatus === 'failed') return 0.3;
  if (outcome.runResultStatus === 'partial') return 0.5;
  if (outcome.trajectoryPassed === true) return 0.9;
  return 0.7;
}
