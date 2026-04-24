/**
 * configUpdateOrganisationConfigPure.test.ts — pure helpers for the config
 * writer (Session 1 renamed from configUpdateHierarchyTemplatePure.test.ts).
 *
 * Covers contracts (n), (s), (t), (u) — sensitive-path classification +
 * drift-digest + validation purity.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/configUpdateOrganisationConfigPure.test.ts
 */

// Populate the sensitive-paths registry before importing the pure module —
// classifyWritePath reads the registry at call time. Mirrors what
// server/index.ts does at boot via registerSensitivePaths.
import '../../modules/clientpulse/registerSensitivePaths.js';

import {
  applyPathPatch,
  classifyWritePath,
  validateProposedConfig,
  validationDigest,
  buildConfigHistorySnapshotShape,
  isValidConfigPath,
  ALLOWED_CONFIG_ROOT_KEYS,
} from '../configUpdateOrganisationConfigPure.js';

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

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

// ── Path patching ─────────────────────────────────────────────────────────

test('1. applyPathPatch — top-level leaf update', () => {
  const out = applyPathPatch({ a: 1, b: 2 }, { path: 'a', value: 5 });
  assert((out as { a: number }).a === 5, 'a=5');
  assert((out as { b: number }).b === 2, 'b preserved');
});

test('2. applyPathPatch — nested path creates intermediate objects', () => {
  const out = applyPathPatch({}, { path: 'a.b.c', value: 42 });
  const nested = out as { a: { b: { c: number } } };
  assert(nested.a.b.c === 42, 'nested c=42');
});

test('3. applyPathPatch — preserves siblings when deep-merging', () => {
  const out = applyPathPatch(
    { staffActivity: { churnFlagThresholds: { zeroActivityDays: 7, weekOverWeekDropPct: 50 } } },
    { path: 'staffActivity.churnFlagThresholds.zeroActivityDays', value: 14 },
  );
  const n = out as { staffActivity: { churnFlagThresholds: { zeroActivityDays: number; weekOverWeekDropPct: number } } };
  assert(n.staffActivity.churnFlagThresholds.zeroActivityDays === 14, 'leaf=14');
  assert(n.staffActivity.churnFlagThresholds.weekOverWeekDropPct === 50, 'sibling preserved');
});

test('4. applyPathPatch — array replacement (wholesale)', () => {
  const out = applyPathPatch(
    { healthScoreFactors: [{ metricSlug: 'a', weight: 1 }] },
    { path: 'healthScoreFactors', value: [{ metricSlug: 'b', weight: 0.5 }, { metricSlug: 'c', weight: 0.5 }] },
  );
  const arr = (out as { healthScoreFactors: Array<{ metricSlug: string }> }).healthScoreFactors;
  assert(arr.length === 2, 'length=2');
  assert(arr[0].metricSlug === 'b', 'replaced');
});

test('5. applyPathPatch — empty path throws', () => {
  let threw = false;
  try { applyPathPatch({}, { path: '', value: 1 }); } catch { threw = true; }
  assert(threw, 'empty path throws');
});

// ── Classification ────────────────────────────────────────────────────────

test('6. classifyWritePath — sensitive exact match', () => {
  assert(classifyWritePath('healthScoreFactors') === 'sensitive', 'sensitive');
  assert(classifyWritePath('interventionDefaults.cooldownHours') === 'sensitive', 'sensitive');
});

test('7. classifyWritePath — sensitive prefix match', () => {
  assert(classifyWritePath('interventionDefaults.cooldownHours.nested') === 'sensitive', 'prefix match');
});

test('8. classifyWritePath — non-sensitive path', () => {
  assert(classifyWritePath('alertLimits.notificationThreshold') === 'non_sensitive', 'threshold not in SENSITIVE list');
  assert(classifyWritePath('arbitrary.new.key') === 'non_sensitive', 'unknown path');
});

// ── Validation ────────────────────────────────────────────────────────────

test('9. validateProposedConfig — schema-valid passes', () => {
  const r = validateProposedConfig({
    churnBands: { healthy: [75, 100], watch: [51, 74], atRisk: [26, 50], critical: [0, 25] },
  });
  assert(r.ok, `expected ok, got ${r.message}`);
});

test('10. validateProposedConfig — sum-constraint violation → SUM_CONSTRAINT_VIOLATED', () => {
  const r = validateProposedConfig({
    healthScoreFactors: [
      { metricSlug: 'a', weight: 0.6, label: 'A', normalisation: { type: 'linear', minValue: 0, maxValue: 100 } },
      { metricSlug: 'b', weight: 0.5, label: 'B', normalisation: { type: 'linear', minValue: 0, maxValue: 100 } },
    ],
  });
  assert(!r.ok, 'expected rejection');
  assert(r.errorCode === 'SUM_CONSTRAINT_VIOLATED', `errorCode=${r.errorCode}`);
});

test('11. validateProposedConfig — schema-invalid → SCHEMA_INVALID', () => {
  const r = validateProposedConfig({
    churnBands: { healthy: 'not-a-tuple' as unknown as [number, number] },
  });
  assert(!r.ok, 'expected rejection');
  assert(r.errorCode === 'SCHEMA_INVALID', `errorCode=${r.errorCode}`);
});

// ── Validation digest ────────────────────────────────────────────────────

test('12. validationDigest — same input produces same digest', () => {
  const d1 = validationDigest({ a: 1, b: 2 });
  const d2 = validationDigest({ b: 2, a: 1 });
  assert(d1 === d2, 'key-order independent');
});

test('13. validationDigest — different input produces different digest', () => {
  const d1 = validationDigest({ a: 1 });
  const d2 = validationDigest({ a: 2 });
  assert(d1 !== d2, 'different digest');
});

// ── Config history snapshot shape ─────────────────────────────────────────

// ── Path validation (typo guard) ─────────────────────────────────────────

test('15. isValidConfigPath — known root allowed', () => {
  assert(isValidConfigPath('alertLimits.notificationThreshold'), 'alertLimits ok');
  assert(isValidConfigPath('healthScoreFactors'), 'array root ok');
  assert(isValidConfigPath('interventionDefaults.cooldownHours'), 'nested ok');
});

test('16. isValidConfigPath — typo in root rejected', () => {
  assert(!isValidConfigPath('alertLimitz.foo'), 'alertLimitz rejected');
  assert(!isValidConfigPath('healthscorefactors'), 'case-sensitive');
  assert(!isValidConfigPath('arbitrary.new.key'), 'unknown root rejected');
});

test('17. isValidConfigPath — empty path rejected', () => {
  assert(!isValidConfigPath(''), 'empty rejected');
  assert(!isValidConfigPath('.leading'), 'leading-dot rejected');
});

test('18. ALLOWED_CONFIG_ROOT_KEYS includes all documented roots', () => {
  for (const root of ['healthScoreFactors', 'churnBands', 'interventionDefaults', 'staffActivity', 'alertLimits', 'dataRetention']) {
    assert(ALLOWED_CONFIG_ROOT_KEYS.includes(root), `missing root: ${root}`);
  }
});

test('14. buildConfigHistorySnapshotShape — snapshot includes proposed config', () => {
  const out = buildConfigHistorySnapshotShape({
    proposedConfig: { alertLimits: { notificationThreshold: 5 } },
    path: 'alertLimits.notificationThreshold',
    reason: 'operator said lower the threshold',
    sourceSession: 'sess-1',
  });
  assert(JSON.stringify(out.snapshot).includes('notificationThreshold'), 'snapshot contains the path');
  assert(out.changeSummary.startsWith('config_agent:'), 'changeSummary prefixed');
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
