/**
 * interventionActionMetadataPure.test.ts — typed metadata contract (§ locked
 * contract (b)).
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/interventionActionMetadataPure.test.ts
 */

import {
  interventionActionMetadataSchema,
  validateInterventionActionMetadata,
} from '../interventionActionMetadata.js';

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

const validScenarioMeta = {
  triggerTemplateSlug: 'check_in',
  triggerReason: 'scenario_detector:at_risk',
  bandAtProposal: 'atRisk' as const,
  healthScoreAtProposal: 38,
  configVersion: 'cv-1',
  recommendedBy: 'scenario_detector' as const,
  churnAssessmentId: '550e8400-e29b-41d4-a716-446655440000',
};

const validOperatorMeta = {
  triggerTemplateSlug: null,
  triggerReason: 'operator noticed drop in engagement',
  bandAtProposal: 'watch' as const,
  healthScoreAtProposal: 55,
  configVersion: null,
  recommendedBy: 'operator_manual' as const,
  operatorRationale: 'operator noticed drop in engagement',
  scheduleHint: 'immediate' as const,
};

// ── Happy paths ───────────────────────────────────────────────────────────

test('scenario_detector meta validates', () => {
  const out = validateInterventionActionMetadata(validScenarioMeta);
  assert(out.recommendedBy === 'scenario_detector', 'recommendedBy preserved');
});

test('operator_manual meta validates', () => {
  const out = validateInterventionActionMetadata(validOperatorMeta);
  assert(out.recommendedBy === 'operator_manual', 'recommendedBy preserved');
});

// ── superRefine: scenario_detector requires churnAssessmentId ─────────────

test('scenario_detector without churnAssessmentId rejected', () => {
  let threw = false;
  try {
    validateInterventionActionMetadata({
      ...validScenarioMeta,
      churnAssessmentId: undefined,
    });
  } catch (err) {
    threw = true;
    const e = err as { errorCode?: string };
    assert(e.errorCode === 'INVALID_METADATA', 'errorCode');
  }
  assert(threw, 'expected throw');
});

// ── superRefine: operator_manual requires operatorRationale ──────────────

test('operator_manual without operatorRationale rejected', () => {
  let threw = false;
  try {
    validateInterventionActionMetadata({
      ...validOperatorMeta,
      operatorRationale: undefined,
    });
  } catch {
    threw = true;
  }
  assert(threw, 'expected throw');
});

// ── Band enum ─────────────────────────────────────────────────────────────

test('invalid band rejected', () => {
  let threw = false;
  try {
    validateInterventionActionMetadata({
      ...validScenarioMeta,
      bandAtProposal: 'red' as unknown as 'atRisk',
    });
  } catch {
    threw = true;
  }
  assert(threw, 'invalid band should throw');
});

test('all four valid bands accepted', () => {
  for (const band of ['healthy', 'watch', 'atRisk', 'critical'] as const) {
    const out = validateInterventionActionMetadata({
      ...validScenarioMeta,
      bandAtProposal: band,
    });
    assert(out.bandAtProposal === band, `band=${band}`);
  }
});

// ── Health score bounds ───────────────────────────────────────────────────

test('healthScoreAtProposal out of range rejected', () => {
  let threw = false;
  try {
    validateInterventionActionMetadata({
      ...validScenarioMeta,
      healthScoreAtProposal: 120,
    });
  } catch {
    threw = true;
  }
  assert(threw, 'score > 100 should throw');
});

test('healthScoreAtProposal null accepted', () => {
  const out = validateInterventionActionMetadata({
    ...validScenarioMeta,
    healthScoreAtProposal: null,
  });
  assert(out.healthScoreAtProposal === null, 'null preserved');
});

// ── Unknown recommendedBy ────────────────────────────────────────────────

test('unknown recommendedBy rejected', () => {
  let threw = false;
  try {
    validateInterventionActionMetadata({
      ...validScenarioMeta,
      recommendedBy: 'agent' as unknown as 'scenario_detector',
    });
  } catch {
    threw = true;
  }
  assert(threw, 'unknown recommendedBy should throw');
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// Keep the schema export in use — prevents unused-import warnings if the
// caller-side tests are ever removed.
void interventionActionMetadataSchema;
