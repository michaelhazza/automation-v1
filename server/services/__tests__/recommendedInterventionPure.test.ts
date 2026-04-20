import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pickRecommendedTemplate } from '../recommendedInterventionPure.js';

test('no candidates → no_candidates reason', () => {
  assert.deepEqual(
    pickRecommendedTemplate({
      candidates: [],
      outcomes: [],
      currentBand: 'atRisk',
      minTrialsForOutcomeWeight: 5,
    }),
    { pickedSlug: '', reason: 'no_candidates' },
  );
});

test('sparse data (all trials below threshold) → priority_fallback', () => {
  const pick = pickRecommendedTemplate({
    candidates: [
      { slug: 'tpl_b', priority: 2, actionType: 'crm.send_email' },
      { slug: 'tpl_a', priority: 1, actionType: 'crm.fire_automation' },
    ],
    outcomes: [
      { templateSlug: 'tpl_a', bandBefore: 'atRisk', trials: 2, improvedCount: 1, avgScoreDelta: 3 },
    ],
    currentBand: 'atRisk',
    minTrialsForOutcomeWeight: 5,
  });
  assert.equal(pick.reason, 'priority_fallback');
  assert.equal(pick.pickedSlug, 'tpl_a');
});

test('priority tie-break lexicographic on slug', () => {
  const pick = pickRecommendedTemplate({
    candidates: [
      { slug: 'tpl_z', priority: 1, actionType: 'crm.send_email' },
      { slug: 'tpl_a', priority: 1, actionType: 'crm.fire_automation' },
    ],
    outcomes: [],
    currentBand: 'atRisk',
    minTrialsForOutcomeWeight: 5,
  });
  assert.equal(pick.pickedSlug, 'tpl_a');
  assert.equal(pick.reason, 'priority_fallback');
});

test('outcome-weighted — higher improve rate wins', () => {
  const pick = pickRecommendedTemplate({
    candidates: [
      { slug: 'tpl_a', priority: 1, actionType: 'crm.fire_automation' },
      { slug: 'tpl_b', priority: 2, actionType: 'crm.send_email' },
    ],
    outcomes: [
      { templateSlug: 'tpl_a', bandBefore: 'atRisk', trials: 10, improvedCount: 3, avgScoreDelta: 1 },
      { templateSlug: 'tpl_b', bandBefore: 'atRisk', trials: 10, improvedCount: 7, avgScoreDelta: 2 },
    ],
    currentBand: 'atRisk',
    minTrialsForOutcomeWeight: 5,
  });
  assert.equal(pick.pickedSlug, 'tpl_b');
  assert.equal(pick.reason, 'outcome_weighted');
});

test('outcome-weighted — tie on rate, higher avgScoreDelta wins via score', () => {
  const pick = pickRecommendedTemplate({
    candidates: [
      { slug: 'tpl_a', priority: 1, actionType: 'crm.fire_automation' },
      { slug: 'tpl_b', priority: 2, actionType: 'crm.send_email' },
    ],
    outcomes: [
      { templateSlug: 'tpl_a', bandBefore: 'atRisk', trials: 10, improvedCount: 5, avgScoreDelta: 2 },
      { templateSlug: 'tpl_b', bandBefore: 'atRisk', trials: 10, improvedCount: 5, avgScoreDelta: 5 },
    ],
    currentBand: 'atRisk',
    minTrialsForOutcomeWeight: 5,
  });
  assert.equal(pick.pickedSlug, 'tpl_b');
  assert.equal(pick.reason, 'outcome_weighted');
});

test('outcome-weighted — same score, more trials wins', () => {
  const pick = pickRecommendedTemplate({
    candidates: [
      { slug: 'tpl_a', priority: 1, actionType: 'crm.fire_automation' },
      { slug: 'tpl_b', priority: 2, actionType: 'crm.send_email' },
    ],
    outcomes: [
      { templateSlug: 'tpl_a', bandBefore: 'atRisk', trials: 5, improvedCount: 3, avgScoreDelta: 2 },
      { templateSlug: 'tpl_b', bandBefore: 'atRisk', trials: 20, improvedCount: 12, avgScoreDelta: 2 },
    ],
    currentBand: 'atRisk',
    minTrialsForOutcomeWeight: 5,
  });
  assert.equal(pick.pickedSlug, 'tpl_b');
});

test('mix: one candidate has data, another sparse → data-weighted candidate wins', () => {
  const pick = pickRecommendedTemplate({
    candidates: [
      { slug: 'tpl_sparse', priority: 1, actionType: 'crm.fire_automation' },
      { slug: 'tpl_measured', priority: 3, actionType: 'crm.send_email' },
    ],
    outcomes: [
      { templateSlug: 'tpl_measured', bandBefore: 'atRisk', trials: 10, improvedCount: 7, avgScoreDelta: 3 },
      { templateSlug: 'tpl_sparse', bandBefore: 'atRisk', trials: 2, improvedCount: 2, avgScoreDelta: 10 },
    ],
    currentBand: 'atRisk',
    minTrialsForOutcomeWeight: 5,
  });
  assert.equal(pick.pickedSlug, 'tpl_measured');
  assert.equal(pick.reason, 'outcome_weighted');
});

test('outcomes for different band are ignored', () => {
  const pick = pickRecommendedTemplate({
    candidates: [{ slug: 'tpl_a', priority: 1, actionType: 'crm.send_email' }],
    outcomes: [
      { templateSlug: 'tpl_a', bandBefore: 'healthy', trials: 20, improvedCount: 18, avgScoreDelta: 5 },
    ],
    currentBand: 'atRisk',
    minTrialsForOutcomeWeight: 5,
  });
  assert.equal(pick.reason, 'priority_fallback');
  assert.equal(pick.pickedSlug, 'tpl_a');
});
