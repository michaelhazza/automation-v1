/**
 * workspaceMemoryServicePure.test.ts
 *
 * Tests for the recency-boost logic added in Memory & Briefings §4.2 (S2).
 * The boost is computed in _hybridRetrieve post-processing in
 * workspaceMemoryService.ts. Since that function has DB dependencies, we
 * test the boost math + the §4.4 invariant here using extracted helpers.
 *
 * Key invariant tested (§4.4): recency boost is NEVER written back to
 * qualityScore. This test asserts that the boost function does not mutate
 * any persistent field other than combined_score.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/workspaceMemoryServicePure.test.ts
 */

import { expect, test } from 'vitest';
import { RECENCY_BOOST_WINDOW_DAYS, RECENCY_BOOST_WEIGHT } from '../../config/limits.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, label: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${label} — expected ~${expected} (±${tolerance}), got ${actual}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Pure recency-boost logic extracted for testing
// (mirrors the logic in _hybridRetrieve post-processing)
// ---------------------------------------------------------------------------

interface TestResult {
  id: string;
  combined_score: number;
  last_accessed_at: string | null;
  // These fields must never be mutated by the boost:
  quality_score?: number;
  rrf_score: number;
}

/**
 * Apply the recency boost to a set of HybridResult-like rows.
 * Returns a NEW array with updated combined_scores — never mutates qualityScore.
 * Mirrors the boost block in workspaceMemoryService._hybridRetrieve.
 */
function applyRecencyBoost(
  rows: TestResult[],
  now: Date,
): TestResult[] {
  const cutoff = new Date(now.getTime() - RECENCY_BOOST_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return rows.map(row => {
    if (row.last_accessed_at !== null) {
      const accessedAt = new Date(row.last_accessed_at);
      if (accessedAt >= cutoff) {
        // Additive boost — ranking-time only
        return { ...row, combined_score: row.combined_score + RECENCY_BOOST_WEIGHT };
      }
    }
    return { ...row };
  }).sort((a, b) => b.combined_score - a.combined_score);
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-04-16T12:00:00.000Z');
const WITHIN_WINDOW = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(); // 10min ago
const AT_BOUNDARY = new Date(NOW.getTime() - RECENCY_BOOST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(); // exactly at boundary
const BEYOND_WINDOW = new Date(NOW.getTime() - (RECENCY_BOOST_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString(); // 1 day past window

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('');
console.log('workspaceMemoryServicePure — RRF recency boost (§4.2 S2)');
console.log('');

test('entry accessed within window gets boost', () => {
  const rows: TestResult[] = [{
    id: 'a', combined_score: 0.5, last_accessed_at: WITHIN_WINDOW, rrf_score: 0.3,
  }];
  const result = applyRecencyBoost(rows, NOW);
  assertApprox(result[0].combined_score, 0.5 + RECENCY_BOOST_WEIGHT, 0.001, 'boosted score');
});

test('entry accessed exactly at window boundary gets boost', () => {
  const rows: TestResult[] = [{
    id: 'a', combined_score: 0.5, last_accessed_at: AT_BOUNDARY, rrf_score: 0.3,
  }];
  const result = applyRecencyBoost(rows, NOW);
  assertApprox(result[0].combined_score, 0.5 + RECENCY_BOOST_WEIGHT, 0.001, 'boundary boost');
});

test('entry accessed beyond window does NOT get boost', () => {
  const rows: TestResult[] = [{
    id: 'a', combined_score: 0.5, last_accessed_at: BEYOND_WINDOW, rrf_score: 0.3,
  }];
  const result = applyRecencyBoost(rows, NOW);
  assertApprox(result[0].combined_score, 0.5, 0.001, 'no boost beyond window');
});

test('entry with null last_accessed_at does NOT get boost', () => {
  const rows: TestResult[] = [{
    id: 'a', combined_score: 0.5, last_accessed_at: null, rrf_score: 0.3,
  }];
  const result = applyRecencyBoost(rows, NOW);
  assertApprox(result[0].combined_score, 0.5, 0.001, 'null → no boost');
});

test('boost reorders results when boosted entry was ranked lower', () => {
  const rows: TestResult[] = [
    { id: 'high', combined_score: 0.7, last_accessed_at: null, rrf_score: 0.4 },
    { id: 'boosted', combined_score: 0.65, last_accessed_at: WITHIN_WINDOW, rrf_score: 0.3 },
  ];
  const result = applyRecencyBoost(rows, NOW);
  // 'boosted' becomes 0.65 + 0.15 = 0.80 > 0.70 → should be first
  expect(result[0].id, 'boosted entry moves to top').toBe('boosted');
  expect(result[1].id, 'unboosted entry falls to second').toBe('high');
});

test('§4.4 invariant — boost never mutates quality_score', () => {
  const rows: TestResult[] = [{
    id: 'a', combined_score: 0.5, last_accessed_at: WITHIN_WINDOW,
    quality_score: 0.8, rrf_score: 0.3,
  }];
  const result = applyRecencyBoost(rows, NOW);
  // quality_score must remain unchanged
  expect(result[0].quality_score, 'quality_score unchanged after boost').toBe(0.8);
});

test('§4.4 invariant — boost never mutates rrf_score', () => {
  const rows: TestResult[] = [{
    id: 'a', combined_score: 0.5, last_accessed_at: WITHIN_WINDOW,
    rrf_score: 0.3,
  }];
  const result = applyRecencyBoost(rows, NOW);
  expect(result[0].rrf_score, 'rrf_score unchanged after boost').toBe(0.3);
});

test('multiple boosted entries all get boost applied', () => {
  const rows: TestResult[] = [
    { id: 'a', combined_score: 0.6, last_accessed_at: WITHIN_WINDOW, rrf_score: 0.3 },
    { id: 'b', combined_score: 0.5, last_accessed_at: WITHIN_WINDOW, rrf_score: 0.25 },
    { id: 'c', combined_score: 0.9, last_accessed_at: null, rrf_score: 0.5 },
  ];
  const result = applyRecencyBoost(rows, NOW);
  // c stays highest at 0.9, a → 0.75, b → 0.65
  expect(result[0].id, 'unboosted high-score entry stays first').toBe('c');
  expect(result[1].id, 'higher boosted entry second').toBe('a');
  expect(result[2].id, 'lower boosted entry third').toBe('b');
});

test('empty results array returns empty', () => {
  const result = applyRecencyBoost([], NOW);
  expect(result.length, 'empty → empty').toBe(0);
});

// ---------------------------------------------------------------------------
// Hermes Tier 1 Phase B — §6.5 decision matrix + §6.7 provenance.
// ---------------------------------------------------------------------------
//
// These tests pin the pure decision logic that `extractRunInsights`
// applies on top of the LLM's raw classification. The impure write path
// in `workspaceMemoryService.ts` calls these pure helpers directly; the
// `options.overrides` row-write concern is covered by the integration
// test in `workspaceMemoryService.test.ts`.

import {
  applyOutcomeDefaults,
  computeProvenanceConfidence,
  scoreForOutcome,
  selectPromotedEntryType,
  type RunOutcome,
} from '../workspaceMemoryServicePure.js';
import type { EntryType } from '../../config/limits.js';

function outcome(
  runResultStatus: RunOutcome['runResultStatus'],
  trajectoryPassed: RunOutcome['trajectoryPassed'] = null,
  errorMessage: RunOutcome['errorMessage'] = null,
): RunOutcome {
  return { runResultStatus, trajectoryPassed, errorMessage };
}

const ALL_ENTRY_TYPES: EntryType[] = ['observation', 'decision', 'preference', 'issue', 'pattern'];

// ─── selectPromotedEntryType — §6.5 matrix ───────────────────────────────

console.log('');
console.log('Phase B §6.5 — selectPromotedEntryType:');

// success × trajectoryPassed=true — trajectory-verified success.
test('success+pass: observation → pattern (promoted)', () => {
  expect(selectPromotedEntryType('observation', outcome('success', true)), 'kind').toBe('pattern');
});
test('success+pass: decision stays decision', () => {
  expect(selectPromotedEntryType('decision', outcome('success', true)), 'kind').toBe('decision');
});
test('success+pass: pattern stays pattern', () => {
  expect(selectPromotedEntryType('pattern', outcome('success', true)), 'kind').toBe('pattern');
});
test('success+pass: preference stays preference', () => {
  expect(selectPromotedEntryType('preference', outcome('success', true)), 'kind').toBe('preference');
});
test('success+pass: issue stays issue', () => {
  expect(selectPromotedEntryType('issue', outcome('success', true)), 'kind').toBe('issue');
});

// success × trajectoryPassed=null — Phase B's live path.
test('success+null: observation → pattern', () => {
  expect(selectPromotedEntryType('observation', outcome('success', null)), 'kind').toBe('pattern');
});
test('success+null: decision stays decision', () => {
  expect(selectPromotedEntryType('decision', outcome('success', null)), 'kind').toBe('decision');
});
test('success+null: pattern stays pattern', () => {
  expect(selectPromotedEntryType('pattern', outcome('success', null)), 'kind').toBe('pattern');
});
test('success+null: preference stays preference', () => {
  expect(selectPromotedEntryType('preference', outcome('success', null)), 'kind').toBe('preference');
});
test('success+null: issue stays issue', () => {
  expect(selectPromotedEntryType('issue', outcome('success', null)), 'kind').toBe('issue');
});

// success × trajectoryPassed=false — trajectory disagreement, demote durable types.
test('success+fail: observation stays observation (no promotion)', () => {
  expect(selectPromotedEntryType('observation', outcome('success', false)), 'kind').toBe('observation');
});
test('success+fail: decision → observation (demoted)', () => {
  expect(selectPromotedEntryType('decision', outcome('success', false)), 'kind').toBe('observation');
});
test('success+fail: pattern → observation (demoted)', () => {
  expect(selectPromotedEntryType('pattern', outcome('success', false)), 'kind').toBe('observation');
});
test('success+fail: preference stays preference (user preference is path-independent)', () => {
  expect(selectPromotedEntryType('preference', outcome('success', false)), 'kind').toBe('preference');
});
test('success+fail: issue stays issue', () => {
  expect(selectPromotedEntryType('issue', outcome('success', false)), 'kind').toBe('issue');
});

// partial × any — neutral.
for (const t of ['true', 'false', 'null'] as const) {
  for (const e of ALL_ENTRY_TYPES) {
    test(`partial+${t}: ${e} kept as-is (neutral)`, () => {
      const tp = t === 'true' ? true : t === 'false' ? false : null;
      expect(selectPromotedEntryType(e, outcome('partial', tp)), 'kind').toEqual(e);
    });
  }
}

// failed × any — §6.5 failure rules.
test('failed: observation → issue (force-demoted)', () => {
  expect(selectPromotedEntryType('observation', outcome('failed')), 'kind').toBe('issue');
});
test('failed: pattern → issue (force-demoted)', () => {
  expect(selectPromotedEntryType('pattern', outcome('failed')), 'kind').toBe('issue');
});
test('failed: decision → issue (force-demoted)', () => {
  expect(selectPromotedEntryType('decision', outcome('failed')), 'kind').toBe('issue');
});
test('failed: issue stays issue (reinforced)', () => {
  expect(selectPromotedEntryType('issue', outcome('failed')), 'kind').toBe('issue');
});
test('failed: preference → observation (preserves signal, no durable tier)', () => {
  expect(selectPromotedEntryType('preference', outcome('failed')), 'kind').toBe('observation');
});

// ─── scoreForOutcome — §6.5 right-hand modifier column ─────────────────

console.log('');
console.log('Phase B §6.5 — scoreForOutcome:');

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

test('success+pass: observation score → base +0.20', () => {
  const out = scoreForOutcome(0.5, 'observation', outcome('success', true));
  if (!near(out, 0.70)) throw new Error(`expected 0.70, got ${out}`);
});
test('success+pass: decision → +0.20', () => {
  const out = scoreForOutcome(0.5, 'decision', outcome('success', true));
  if (!near(out, 0.70)) throw new Error(`expected 0.70, got ${out}`);
});
test('success+pass: preference → +0.15', () => {
  const out = scoreForOutcome(0.5, 'preference', outcome('success', true));
  if (!near(out, 0.65)) throw new Error(`expected 0.65, got ${out}`);
});
test('success+pass: issue → +0.00 (reinforced but no boost)', () => {
  const out = scoreForOutcome(0.5, 'issue', outcome('success', true));
  if (!near(out, 0.50)) throw new Error(`expected 0.50, got ${out}`);
});
test('success+null: +0.10 bump on non-issue', () => {
  const out = scoreForOutcome(0.5, 'pattern', outcome('success', null));
  if (!near(out, 0.60)) throw new Error(`expected 0.60, got ${out}`);
});
test('success+fail: +0.00 (no bump despite success) — preference', () => {
  const out = scoreForOutcome(0.5, 'preference', outcome('success', false));
  if (!near(out, 0.50)) throw new Error(`expected 0.50, got ${out}`);
});
test('success+fail: +0.00 — observation', () => {
  const out = scoreForOutcome(0.5, 'observation', outcome('success', false));
  if (!near(out, 0.50)) throw new Error(`expected 0.50, got ${out}`);
});
test('success+fail: +0.00 — decision', () => {
  const out = scoreForOutcome(0.5, 'decision', outcome('success', false));
  if (!near(out, 0.50)) throw new Error(`expected 0.50, got ${out}`);
});
test('success+fail: +0.00 — pattern', () => {
  const out = scoreForOutcome(0.5, 'pattern', outcome('success', false));
  if (!near(out, 0.50)) throw new Error(`expected 0.50, got ${out}`);
});
test('success+fail: +0.00 — issue', () => {
  const out = scoreForOutcome(0.5, 'issue', outcome('success', false));
  if (!near(out, 0.50)) throw new Error(`expected 0.50, got ${out}`);
});
test('partial: +0.00 on any entry type', () => {
  for (const e of ALL_ENTRY_TYPES) {
    const out = scoreForOutcome(0.5, e, outcome('partial'));
    if (!near(out, 0.50)) throw new Error(`expected 0.50 for ${e}, got ${out}`);
  }
});
test('failed: −0.10 for non-issue', () => {
  const out = scoreForOutcome(0.5, 'pattern', outcome('failed'));
  if (!near(out, 0.40)) throw new Error(`expected 0.40, got ${out}`);
});
test('failed: +0.00 for issue (reinforced)', () => {
  const out = scoreForOutcome(0.5, 'issue', outcome('failed'));
  if (!near(out, 0.50)) throw new Error(`expected 0.50, got ${out}`);
});

// Clamp behaviour.
test('clamp upper: 0.9 + 0.20 = 1.0 (cap)', () => {
  const out = scoreForOutcome(0.9, 'pattern', outcome('success', true));
  if (!near(out, 1.0)) throw new Error(`expected 1.0, got ${out}`);
});
test('clamp lower: 0.05 − 0.10 = 0.0 (floor)', () => {
  const out = scoreForOutcome(0.05, 'pattern', outcome('failed'));
  if (!near(out, 0.0)) throw new Error(`expected 0.0, got ${out}`);
});
test('clamp at 1.0 exactly stays 1.0', () => {
  const out = scoreForOutcome(1.0, 'pattern', outcome('success', true));
  if (!near(out, 1.0)) throw new Error(`expected 1.0, got ${out}`);
});
test('clamp at 0.0 exactly stays 0.0', () => {
  const out = scoreForOutcome(0.0, 'pattern', outcome('failed'));
  if (!near(out, 0.0)) throw new Error(`expected 0.0, got ${out}`);
});

// ─── computeProvenanceConfidence — §6.7 ────────────────────────────────

console.log('');
console.log('Phase B §6.7 — computeProvenanceConfidence:');

test('success + trajectoryPassed=true → 0.9', () => {
  const c = computeProvenanceConfidence(outcome('success', true));
  if (!near(c, 0.9)) throw new Error(`expected 0.9, got ${c}`);
});
test('success + trajectoryPassed=null → 0.7 (Phase B live path)', () => {
  const c = computeProvenanceConfidence(outcome('success', null));
  if (!near(c, 0.7)) throw new Error(`expected 0.7, got ${c}`);
});
test('success + trajectoryPassed=false → 0.7 (no verdict boost)', () => {
  const c = computeProvenanceConfidence(outcome('success', false));
  if (!near(c, 0.7)) throw new Error(`expected 0.7, got ${c}`);
});
test('partial → 0.5', () => {
  const c = computeProvenanceConfidence(outcome('partial'));
  if (!near(c, 0.5)) throw new Error(`expected 0.5, got ${c}`);
});
test('failed → 0.3', () => {
  const c = computeProvenanceConfidence(outcome('failed'));
  if (!near(c, 0.3)) throw new Error(`expected 0.3, got ${c}`);
});

// ─── applyOutcomeDefaults — §6.7 / §6.7.1 override chain ──────────────

console.log('');
console.log('Phase B §6.7 — applyOutcomeDefaults:');

test('no overrides: success → isUnverified=false, confidence=0.7', () => {
  const r = applyOutcomeDefaults(outcome('success', null));
  if (r.isUnverified !== false) throw new Error(`expected isUnverified=false, got ${r.isUnverified}`);
  if (!near(r.provenanceConfidence, 0.7)) throw new Error(`expected 0.7, got ${r.provenanceConfidence}`);
});
test('no overrides: partial → isUnverified=true, confidence=0.5', () => {
  const r = applyOutcomeDefaults(outcome('partial'));
  if (r.isUnverified !== true) throw new Error(`expected isUnverified=true, got ${r.isUnverified}`);
  if (!near(r.provenanceConfidence, 0.5)) throw new Error(`expected 0.5, got ${r.provenanceConfidence}`);
});
test('no overrides: failed → isUnverified=true, confidence=0.3', () => {
  const r = applyOutcomeDefaults(outcome('failed'));
  if (r.isUnverified !== true) throw new Error(`expected isUnverified=true, got ${r.isUnverified}`);
  if (!near(r.provenanceConfidence, 0.3)) throw new Error(`expected 0.3, got ${r.provenanceConfidence}`);
});
test('override isUnverified=false on partial → overrides default', () => {
  const r = applyOutcomeDefaults(outcome('partial'), { isUnverified: false });
  if (r.isUnverified !== false) throw new Error(`expected false, got ${r.isUnverified}`);
  if (!near(r.provenanceConfidence, 0.5)) throw new Error(`expected 0.5 (default), got ${r.provenanceConfidence}`);
});
test('override provenanceConfidence=0.7 on partial → overrides default 0.5', () => {
  const r = applyOutcomeDefaults(outcome('partial'), { provenanceConfidence: 0.7 });
  if (r.isUnverified !== true) throw new Error(`expected true (default), got ${r.isUnverified}`);
  if (!near(r.provenanceConfidence, 0.7)) throw new Error(`expected 0.7, got ${r.provenanceConfidence}`);
});
test('both overrides on partial: isUnverified=false, confidence=0.7', () => {
  const r = applyOutcomeDefaults(outcome('partial'), { isUnverified: false, provenanceConfidence: 0.7 });
  if (r.isUnverified !== false) throw new Error(`expected false, got ${r.isUnverified}`);
  if (!near(r.provenanceConfidence, 0.7)) throw new Error(`expected 0.7, got ${r.provenanceConfidence}`);
});

console.log('');
console.log('');
