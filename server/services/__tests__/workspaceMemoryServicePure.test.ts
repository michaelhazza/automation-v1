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

import { RECENCY_BOOST_WINDOW, RECENCY_BOOST_WEIGHT } from '../../config/limits.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

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

function assertTrue(condition: boolean, label: string) {
  if (!condition) throw new Error(`${label} — expected true, got false`);
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
  const cutoff = new Date(now.getTime() - RECENCY_BOOST_WINDOW * 60 * 1000);
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
const AT_BOUNDARY = new Date(NOW.getTime() - RECENCY_BOOST_WINDOW * 60 * 1000).toISOString(); // exactly at boundary
const BEYOND_WINDOW = new Date(NOW.getTime() - (RECENCY_BOOST_WINDOW + 1) * 60 * 1000).toISOString(); // 1min past window

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
  assertEqual(result[0].id, 'boosted', 'boosted entry moves to top');
  assertEqual(result[1].id, 'high', 'unboosted entry falls to second');
});

test('§4.4 invariant — boost never mutates quality_score', () => {
  const rows: TestResult[] = [{
    id: 'a', combined_score: 0.5, last_accessed_at: WITHIN_WINDOW,
    quality_score: 0.8, rrf_score: 0.3,
  }];
  const result = applyRecencyBoost(rows, NOW);
  // quality_score must remain unchanged
  assertEqual(result[0].quality_score, 0.8, 'quality_score unchanged after boost');
});

test('§4.4 invariant — boost never mutates rrf_score', () => {
  const rows: TestResult[] = [{
    id: 'a', combined_score: 0.5, last_accessed_at: WITHIN_WINDOW,
    rrf_score: 0.3,
  }];
  const result = applyRecencyBoost(rows, NOW);
  assertEqual(result[0].rrf_score, 0.3, 'rrf_score unchanged after boost');
});

test('multiple boosted entries all get boost applied', () => {
  const rows: TestResult[] = [
    { id: 'a', combined_score: 0.6, last_accessed_at: WITHIN_WINDOW, rrf_score: 0.3 },
    { id: 'b', combined_score: 0.5, last_accessed_at: WITHIN_WINDOW, rrf_score: 0.25 },
    { id: 'c', combined_score: 0.9, last_accessed_at: null, rrf_score: 0.5 },
  ];
  const result = applyRecencyBoost(rows, NOW);
  // c stays highest at 0.9, a → 0.75, b → 0.65
  assertEqual(result[0].id, 'c', 'unboosted high-score entry stays first');
  assertEqual(result[1].id, 'a', 'higher boosted entry second');
  assertEqual(result[2].id, 'b', 'lower boosted entry third');
});

test('empty results array returns empty', () => {
  const result = applyRecencyBoost([], NOW);
  assertEqual(result.length, 0, 'empty → empty');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
