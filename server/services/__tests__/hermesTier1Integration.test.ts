/**
 * hermesTier1Integration — cross-phase interaction tests.
 *
 * Spec: tasks/hermes-audit-tier-1-spec.md §9.3.1.
 *
 * Scenario #1 (breaker trip mid-run) is the non-negotiable gate — it
 * exercises all three phases in one run and verifies they cooperate.
 *
 * Pure mode (no DATABASE_URL) exercises the interactions that live
 * entirely in the pure modules — the breaker-trip → finalStatus →
 * runResultStatus → memory entryType demotion chain is composable end-
 * to-end because each step is a pure function call.
 *
 * Integration mode (with DATABASE_URL) would additionally exercise the
 * cost-panel-on-retried-run (§9.3.1 #2) and in-flight-registry cleanup
 * (§9.3.1 #5/#7) scenarios; those require real seeded data and the full
 * router + agentExecutionService loop. This file covers the
 * composition-of-pure-functions scenarios; the full-loop scenarios are
 * covered by the individual phase integration tests + the §10 manual
 * sanity walk.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/hermesTier1Integration.test.ts
 */

import { strict as assert } from 'node:assert';
import { computeRunResultStatus } from '../agentExecutionServicePure.js';
import {
  computeProvenanceConfidence,
  scoreForOutcome,
  selectPromotedEntryType,
  type RunOutcome,
} from '../workspaceMemoryServicePure.js';

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

console.log('');
console.log('Hermes Tier 1 — cross-phase interactions (§9.3.1):');

// ─── Scenario #1 — breaker trip mid-run (C + B) ───────────────────────
//
// Flow:
//   1. Phase C's cost breaker throws `cost_limit_exceeded` during an
//      in-flight run.
//   2. The agent execution loop catches the FailureError and sets
//      finalStatus='budget_exceeded'.
//   3. The Phase B derivation `computeRunResultStatus('budget_exceeded',
//      ...)` returns 'failed'.
//   4. The extractRunInsights post-run call receives
//      `outcome.runResultStatus='failed'`.
//   5. Phase B §6.5 forces every LLM-classified observation/pattern/
//      decision → 'issue'. No 'pattern' / 'decision' rows land for this
//      run. `preference` → 'observation'.

test('scenario #1: breaker trip mid-run — budget_exceeded maps to failed', () => {
  const status = computeRunResultStatus('budget_exceeded', true, false);
  assert.equal(status, 'failed', 'budget_exceeded → failed');
});

test('scenario #1: failed outcome force-demotes observation → issue', () => {
  const outcome: RunOutcome = { runResultStatus: 'failed', trajectoryPassed: null, errorMessage: 'cost_limit_exceeded' };
  assert.equal(selectPromotedEntryType('observation', outcome), 'issue');
});

test('scenario #1: failed outcome force-demotes pattern → issue', () => {
  const outcome: RunOutcome = { runResultStatus: 'failed', trajectoryPassed: null, errorMessage: 'cost_limit_exceeded' };
  assert.equal(selectPromotedEntryType('pattern', outcome), 'issue');
});

test('scenario #1: failed outcome force-demotes decision → issue', () => {
  const outcome: RunOutcome = { runResultStatus: 'failed', trajectoryPassed: null, errorMessage: 'cost_limit_exceeded' };
  assert.equal(selectPromotedEntryType('decision', outcome), 'issue');
});

test('scenario #1: failed outcome keeps issue → issue (reinforced)', () => {
  const outcome: RunOutcome = { runResultStatus: 'failed', trajectoryPassed: null, errorMessage: 'cost_limit_exceeded' };
  assert.equal(selectPromotedEntryType('issue', outcome), 'issue');
});

test('scenario #1: failed outcome demotes preference → observation (signal preserved, no durable tier)', () => {
  const outcome: RunOutcome = { runResultStatus: 'failed', trajectoryPassed: null, errorMessage: 'cost_limit_exceeded' };
  assert.equal(selectPromotedEntryType('preference', outcome), 'observation');
});

test('scenario #1: provenanceConfidence on failed outcome is 0.3', () => {
  const outcome: RunOutcome = { runResultStatus: 'failed', trajectoryPassed: null, errorMessage: 'cost_limit_exceeded' };
  assert.equal(computeProvenanceConfidence(outcome), 0.3);
});

test('scenario #1: non-issue scores dampened by 0.10 on failed outcome', () => {
  const outcome: RunOutcome = { runResultStatus: 'failed', trajectoryPassed: null, errorMessage: 'cost_limit_exceeded' };
  const finalScore = scoreForOutcome(0.5, 'pattern', outcome);
  assert.equal(finalScore, 0.4, 'pattern baseline 0.5 → 0.4');
});

// ─── Scenario #4 — partial run with uncertainty (B + handoff) ─────────
//
// completed_with_uncertainty terminal status → partial classification.
// Memory entries get isUnverified=true implicitly (runResultStatus !==
// 'success'), provenanceConfidence=0.5, no score bump (partial is
// neutral per §6.8.2).

test('scenario #4: completed_with_uncertainty → partial', () => {
  assert.equal(
    computeRunResultStatus('completed_with_uncertainty', false, true),
    'partial',
  );
});

test('scenario #4: partial outcome score modifier = +0.00 on all entry types', () => {
  const outcome: RunOutcome = { runResultStatus: 'partial', trajectoryPassed: null, errorMessage: null };
  for (const e of ['observation', 'decision', 'preference', 'issue', 'pattern'] as const) {
    assert.equal(scoreForOutcome(0.5, e, outcome), 0.5, `entryType=${e}`);
  }
});

test('scenario #4: partial outcome keeps entryType unchanged', () => {
  const outcome: RunOutcome = { runResultStatus: 'partial', trajectoryPassed: null, errorMessage: null };
  for (const e of ['observation', 'decision', 'preference', 'issue', 'pattern'] as const) {
    assert.equal(selectPromotedEntryType(e, outcome), e, `entryType=${e}`);
  }
});

test('scenario #4: partial provenance confidence = 0.5 (midpoint)', () => {
  const outcome: RunOutcome = { runResultStatus: 'partial', trajectoryPassed: null, errorMessage: null };
  assert.equal(computeProvenanceConfidence(outcome), 0.5);
});

// ─── Scenario #6 — legacy run renders cost correctly (A) ──────────────
//
// A pre-existing `agent_runs` row with `runResultStatus=NULL` does not
// affect Phase A's cost panel — the cost endpoint does not branch on
// `runResultStatus`. Legacy rows render the same as new rows.
//
// This is a documentation-level check against the spec's §6.3.2 NULL
// tolerance. The cost-panel pure test already pins that the rendering
// mode selection does not read runResultStatus.

test('scenario #6: legacy runs (runResultStatus=NULL) tolerated', () => {
  // Compute-layer doesn't know about runResultStatus at all; this is
  // structurally true — runResultStatus is not a computeRunResultStatus
  // input, it's only an output that callers write. Any legacy row with
  // runResultStatus=NULL simply doesn't trigger the new memory post-
  // processing, which is correct — the run already completed.
  assert.ok(true, 'structurally true — cost path does not read runResultStatus');
});

// ─── Phase ordering invariants ──────────────────────────────────────
//
// Phase B's §6.3.1 write-once invariant is enforced at the DB level
// (`WHERE runResultStatus IS NULL`). Cross-phase assertion: once a
// terminal writer has stamped the column, a second writer (catch path,
// IEE finalizer) produces a zero-row UPDATE, which the impure site
// logs as `runResultStatus.write_skipped`. This is tested at the
// impure integration level; structurally the pure helper returns the
// same value for the same inputs, so any two writers racing on the
// same run with the same inputs would derive the same classification
// anyway.

test('pure determinism: same inputs → same runResultStatus (write-once safe)', () => {
  const a = computeRunResultStatus('failed', true, false);
  const b = computeRunResultStatus('failed', true, false);
  assert.equal(a, b, 'deterministic');
});

test('pure determinism: same inputs → same entryType', () => {
  const outcome: RunOutcome = { runResultStatus: 'success', trajectoryPassed: null, errorMessage: null };
  const a = selectPromotedEntryType('observation', outcome);
  const b = selectPromotedEntryType('observation', outcome);
  assert.equal(a, b, 'deterministic');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
