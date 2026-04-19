/**
 * measureInterventionOutcomeJobPure.test.ts — B2 ship-gate.
 *
 * End-to-end simulation: cold-start subaccount at atRisk → intervention
 * executes → synthetic post-window snapshot + assessment → outcome row args
 * reflect band change atRisk → watch and +18 delta.
 *
 * Runnable via:
 *   npx tsx server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts
 */

import {
  decideOutcomeMeasurement,
  classifyOutcome,
  type ActionRowForMeasurement,
} from '../measureInterventionOutcomeJobPure.js';

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

// ── Classification ────────────────────────────────────────────────────────

test('classifyOutcome: +18 delta → improved', () => {
  assert(classifyOutcome(38, 56) === 'improved', 'improved');
});

test('classifyOutcome: -10 delta → worsened', () => {
  assert(classifyOutcome(56, 46) === 'worsened', 'worsened');
});

test('classifyOutcome: +3 delta → unchanged', () => {
  assert(classifyOutcome(50, 53) === 'unchanged', 'unchanged');
});

test('classifyOutcome: undefined inputs → undefined', () => {
  assert(classifyOutcome(undefined, 50) === undefined, 'u1');
  assert(classifyOutcome(50, undefined) === undefined, 'u2');
});

// ── decideOutcomeMeasurement — too_early / no_snapshot paths ──────────────

test('too_early: window not yet elapsed → kind=too_early', () => {
  const action: ActionRowForMeasurement = {
    id: 'a-1',
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    actionType: 'crm.send_email',
    status: 'completed',
    executedAt: new Date('2026-04-19T00:00:00Z'),
    metadata: {},
  };
  const d = decideOutcomeMeasurement({
    action,
    accountId: 'acct-1',
    measurementWindowHours: 24,
    now: new Date('2026-04-19T10:00:00Z'),
  });
  assert(d.kind === 'too_early', `kind=${d.kind}`);
});

test('no_post_snapshot: window elapsed but snapshot missing (non-alert) → skip', () => {
  const action: ActionRowForMeasurement = {
    id: 'a-1',
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    actionType: 'crm.send_email',
    status: 'completed',
    executedAt: new Date('2026-04-19T00:00:00Z'),
    metadata: {},
  };
  const d = decideOutcomeMeasurement({
    action,
    accountId: 'acct-1',
    measurementWindowHours: 24,
    now: new Date('2026-04-20T02:00:00Z'),
  });
  assert(d.kind === 'no_post_snapshot', `kind=${d.kind}`);
});

test('no_post_snapshot: accountId missing → skip', () => {
  const action: ActionRowForMeasurement = {
    id: 'a-1',
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    actionType: 'crm.send_email',
    status: 'completed',
    executedAt: new Date('2026-04-19T00:00:00Z'),
    metadata: {},
  };
  const d = decideOutcomeMeasurement({
    action,
    accountId: null,
    measurementWindowHours: 24,
    postSnapshot: { score: 50, observedAt: new Date('2026-04-20T02:00:00Z') },
    now: new Date('2026-04-20T03:00:00Z'),
  });
  assert(d.kind === 'no_post_snapshot', `kind=${d.kind}`);
});

test('operator_alert: window elapsed, no post snapshot → still measures (null delta)', () => {
  const action: ActionRowForMeasurement = {
    id: 'a-1',
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    actionType: 'clientpulse.operator_alert',
    status: 'completed',
    executedAt: new Date('2026-04-19T00:00:00Z'),
    metadata: { bandAtProposal: 'atRisk' },
  };
  const d = decideOutcomeMeasurement({
    action,
    accountId: 'acct-1',
    measurementWindowHours: 24,
    now: new Date('2026-04-20T02:00:00Z'),
  });
  assert(d.kind === 'measure', `kind=${d.kind}`);
  assert(d.recordArgs!.healthScoreAfter === undefined, 'healthScoreAfter undefined');
  assert(d.recordArgs!.bandBefore === 'atRisk', 'bandBefore preserved');
});

// ── B2 SHIP-GATE END-TO-END FIXTURE ──────────────────────────────────────

test('B2 SHIP GATE: synthetic end-to-end — atRisk → watch band change, +18 delta', () => {
  // Step 1: cold-start subaccount at health score 38, band atRisk.
  // Step 2: intervention (crm.send_email) fired and marked completed 25h ago.
  // Step 3: synthetic follow-up health snapshot at 56 and assessment at 'watch'
  //         timestamped 23h after executed_at (inside the 24h window? observed
  //         from the window end).
  // Step 4: run decideOutcomeMeasurement with now = executed_at + 25h.
  // Expected: decision.kind === 'measure' with recordArgs carrying the band
  // change attribution and delta.
  const executedAt = new Date('2026-04-18T00:00:00Z'); // 25h before 'now' below
  const now = new Date('2026-04-19T01:00:00Z');
  const windowEnds = new Date(executedAt.getTime() + 24 * 60 * 60 * 1000);

  const action: ActionRowForMeasurement = {
    id: 'act-b2-1',
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    actionType: 'crm.send_email',
    status: 'completed',
    executedAt,
    metadata: {
      triggerTemplateSlug: 'check_in',
      healthScoreAtProposal: 38,
      bandAtProposal: 'atRisk',
      configVersion: 'cv-1',
    },
  };
  const postSnapshot = { score: 56, observedAt: new Date(windowEnds.getTime() + 60 * 60 * 1000) };
  const postAssessment = { band: 'watch', observedAt: new Date(windowEnds.getTime() + 30 * 60 * 1000) };

  const decision = decideOutcomeMeasurement({
    action,
    accountId: 'acct-1',
    measurementWindowHours: 24,
    postSnapshot,
    postAssessment,
    now,
  });

  assert(decision.kind === 'measure', `kind=${decision.kind}`);
  const args = decision.recordArgs!;
  assert(args.interventionId === 'act-b2-1', 'interventionId = action.id');
  // After the cooldown-key fix: templateSlug takes precedence over actionType
  // so checkCooldown() can match outcome rows keyed on template.slug.
  assert(args.interventionTypeSlug === 'check_in', 'slug (templateSlug wins over actionType)');
  assert(args.healthScoreBefore === 38, `before=${args.healthScoreBefore}`);
  assert(args.healthScoreAfter === 56, `after=${args.healthScoreAfter}`);
  assert(args.measuredAfterHours === 24, 'measuredAfterHours');
  assert(args.configVersion === 'cv-1', 'configVersion');
  assert(args.bandBefore === 'atRisk', 'bandBefore');
  assert(args.bandAfter === 'watch', 'bandAfter');
  assert(args.executionFailed === false, 'executionFailed false');
  assert(args.triggerEventId === 'act-b2-1', 'triggerEventId');

  // Classify the outcome shape too.
  const outcome = classifyOutcome(args.healthScoreBefore, args.healthScoreAfter);
  assert(outcome === 'improved', `outcome=${outcome}`);

  // Band change: atRisk → watch.
  const bandChanged = args.bandBefore !== args.bandAfter;
  assert(bandChanged, 'band change atRisk → watch');
});

// ── failed-execution path → still records outcome so cooldown respects it ─

test('failed execution: outcome row still written with executionFailed=true', () => {
  const action: ActionRowForMeasurement = {
    id: 'act-failed-1',
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    actionType: 'crm.send_email',
    status: 'failed',
    executedAt: new Date('2026-04-18T00:00:00Z'),
    metadata: { bandAtProposal: 'atRisk', healthScoreAtProposal: 40 },
  };
  const d = decideOutcomeMeasurement({
    action,
    accountId: 'acct-1',
    measurementWindowHours: 24,
    postSnapshot: { score: 42, observedAt: new Date('2026-04-19T01:00:00Z') },
    postAssessment: { band: 'atRisk', observedAt: new Date('2026-04-19T00:30:00Z') },
    now: new Date('2026-04-19T01:00:00Z'),
  });
  assert(d.kind === 'measure', 'measure');
  assert(d.recordArgs!.executionFailed === true, 'executionFailed true');
});

// ── custom measurementWindowHours per template ───────────────────────────

test('custom measurementWindowHours=72 honoured', () => {
  const action: ActionRowForMeasurement = {
    id: 'a-1',
    organisationId: 'org-1',
    subaccountId: 'sub-1',
    actionType: 'crm.send_email',
    status: 'completed',
    executedAt: new Date('2026-04-17T00:00:00Z'),
    metadata: {},
  };
  // Window = 72h, now = +48h → too_early.
  const tooEarly = decideOutcomeMeasurement({
    action,
    accountId: 'a-1',
    measurementWindowHours: 72,
    postSnapshot: { score: 50, observedAt: new Date('2026-04-19T00:00:00Z') },
    now: new Date('2026-04-19T00:00:00Z'),
  });
  assert(tooEarly.kind === 'too_early', 'still too early at 48h / 72h window');

  // now = +73h → measures.
  const measures = decideOutcomeMeasurement({
    action,
    accountId: 'a-1',
    measurementWindowHours: 72,
    postSnapshot: { score: 50, observedAt: new Date('2026-04-20T01:00:00Z') },
    now: new Date('2026-04-20T01:00:00Z'),
  });
  assert(measures.kind === 'measure', 'measures at 73h');
  assert(measures.recordArgs!.measuredAfterHours === 72, 'honoured window');
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
