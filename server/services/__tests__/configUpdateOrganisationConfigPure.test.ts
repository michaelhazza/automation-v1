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
import { expect, test } from 'vitest';
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

// ── Path patching ─────────────────────────────────────────────────────────

test('1. applyPathPatch — top-level leaf update', () => {
  const out = applyPathPatch({ a: 1, b: 2 }, { path: 'a', value: 5 });
  expect((out as { a: number }).a === 5, 'a=5').toBeTruthy();
  expect((out as { b: number }).b === 2, 'b preserved').toBeTruthy();
});

test('2. applyPathPatch — nested path creates intermediate objects', () => {
  const out = applyPathPatch({}, { path: 'a.b.c', value: 42 });
  const nested = out as { a: { b: { c: number } } };
  expect(nested.a.b.c === 42, 'nested c=42').toBeTruthy();
});

test('3. applyPathPatch — preserves siblings when deep-merging', () => {
  const out = applyPathPatch(
    { staffActivity: { churnFlagThresholds: { zeroActivityDays: 7, weekOverWeekDropPct: 50 } } },
    { path: 'staffActivity.churnFlagThresholds.zeroActivityDays', value: 14 },
  );
  const n = out as { staffActivity: { churnFlagThresholds: { zeroActivityDays: number; weekOverWeekDropPct: number } } };
  expect(n.staffActivity.churnFlagThresholds.zeroActivityDays === 14, 'leaf=14').toBeTruthy();
  expect(n.staffActivity.churnFlagThresholds.weekOverWeekDropPct === 50, 'sibling preserved').toBeTruthy();
});

test('4. applyPathPatch — array replacement (wholesale)', () => {
  const out = applyPathPatch(
    { healthScoreFactors: [{ metricSlug: 'a', weight: 1 }] },
    { path: 'healthScoreFactors', value: [{ metricSlug: 'b', weight: 0.5 }, { metricSlug: 'c', weight: 0.5 }] },
  );
  const arr = (out as { healthScoreFactors: Array<{ metricSlug: string }> }).healthScoreFactors;
  expect(arr.length === 2, 'length=2').toBeTruthy();
  expect(arr[0].metricSlug === 'b', 'replaced').toBeTruthy();
});

test('5. applyPathPatch — empty path throws', () => {
  let threw = false;
  try { applyPathPatch({}, { path: '', value: 1 }); } catch { threw = true; }
  expect(threw, 'empty path throws').toBeTruthy();
});

// ── Classification ────────────────────────────────────────────────────────

test('6. classifyWritePath — sensitive exact match', () => {
  expect(classifyWritePath('healthScoreFactors') === 'sensitive', 'sensitive').toBeTruthy();
  expect(classifyWritePath('interventionDefaults.cooldownHours') === 'sensitive', 'sensitive').toBeTruthy();
});

test('7. classifyWritePath — sensitive prefix match', () => {
  expect(classifyWritePath('interventionDefaults.cooldownHours.nested') === 'sensitive', 'prefix match').toBeTruthy();
});

test('8. classifyWritePath — non-sensitive path', () => {
  expect(classifyWritePath('alertLimits.notificationThreshold') === 'non_sensitive', 'threshold not in SENSITIVE list').toBeTruthy();
  expect(classifyWritePath('arbitrary.new.key') === 'non_sensitive', 'unknown path').toBeTruthy();
});

// ── Validation ────────────────────────────────────────────────────────────

test('9. validateProposedConfig — schema-valid passes', () => {
  const r = validateProposedConfig({
    churnBands: { healthy: [75, 100], watch: [51, 74], atRisk: [26, 50], critical: [0, 25] },
  });
  expect(r.ok, `expected ok, got ${r.message}`).toBeTruthy();
});

test('10. validateProposedConfig — sum-constraint violation → SUM_CONSTRAINT_VIOLATED', () => {
  const r = validateProposedConfig({
    healthScoreFactors: [
      { metricSlug: 'a', weight: 0.6, label: 'A', normalisation: { type: 'linear', minValue: 0, maxValue: 100 } },
      { metricSlug: 'b', weight: 0.5, label: 'B', normalisation: { type: 'linear', minValue: 0, maxValue: 100 } },
    ],
  });
  expect(!r.ok, 'expected rejection').toBeTruthy();
  expect(r.errorCode === 'SUM_CONSTRAINT_VIOLATED', `errorCode=${r.errorCode}`).toBeTruthy();
});

test('11. validateProposedConfig — schema-invalid → SCHEMA_INVALID', () => {
  const r = validateProposedConfig({
    churnBands: { healthy: 'not-a-tuple' as unknown as [number, number] },
  });
  expect(!r.ok, 'expected rejection').toBeTruthy();
  expect(r.errorCode === 'SCHEMA_INVALID', `errorCode=${r.errorCode}`).toBeTruthy();
});

// ── Validation digest ────────────────────────────────────────────────────

test('12. validationDigest — same input produces same digest', () => {
  const d1 = validationDigest({ a: 1, b: 2 });
  const d2 = validationDigest({ b: 2, a: 1 });
  expect(d1 === d2, 'key-order independent').toBeTruthy();
});

test('13. validationDigest — different input produces different digest', () => {
  const d1 = validationDigest({ a: 1 });
  const d2 = validationDigest({ a: 2 });
  expect(d1 !== d2, 'different digest').toBeTruthy();
});

// ── Config history snapshot shape ─────────────────────────────────────────

// ── Path validation (typo guard) ─────────────────────────────────────────

test('15. isValidConfigPath — known root allowed', () => {
  expect(isValidConfigPath('alertLimits.notificationThreshold'), 'alertLimits ok').toBeTruthy();
  expect(isValidConfigPath('healthScoreFactors'), 'array root ok').toBeTruthy();
  expect(isValidConfigPath('interventionDefaults.cooldownHours'), 'nested ok').toBeTruthy();
});

test('16. isValidConfigPath — typo in root rejected', () => {
  expect(!isValidConfigPath('alertLimitz.foo'), 'alertLimitz rejected').toBeTruthy();
  expect(!isValidConfigPath('healthscorefactors'), 'case-sensitive').toBeTruthy();
  expect(!isValidConfigPath('arbitrary.new.key'), 'unknown root rejected').toBeTruthy();
});

test('17. isValidConfigPath — empty path rejected', () => {
  expect(!isValidConfigPath(''), 'empty rejected').toBeTruthy();
  expect(!isValidConfigPath('.leading'), 'leading-dot rejected').toBeTruthy();
});

test('18. ALLOWED_CONFIG_ROOT_KEYS includes all documented roots', () => {
  for (const root of ['healthScoreFactors', 'churnBands', 'interventionDefaults', 'staffActivity', 'alertLimits', 'dataRetention']) {
    expect(ALLOWED_CONFIG_ROOT_KEYS.includes(root), `missing root: ${root}`).toBeTruthy();
  }
});

test('14. buildConfigHistorySnapshotShape — snapshot includes proposed config', () => {
  const out = buildConfigHistorySnapshotShape({
    proposedConfig: { alertLimits: { notificationThreshold: 5 } },
    path: 'alertLimits.notificationThreshold',
    reason: 'operator said lower the threshold',
    sourceSession: 'sess-1',
  });
  expect(JSON.stringify(out.snapshot).includes('notificationThreshold'), 'snapshot contains the path').toBeTruthy();
  expect(out.changeSummary.startsWith('config_agent:'), 'changeSummary prefixed').toBeTruthy();
});

// ── Summary ──────────────────────────────────────────────────────────────
