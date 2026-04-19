/**
 * interventionIdempotencyKeysPure.test.ts — deterministic idempotency-key
 * contract for the intervention proposal lifecycle.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/interventionIdempotencyKeysPure.test.ts
 */

import {
  buildScenarioDetectorIdempotencyKey,
  buildOperatorIdempotencyKey,
} from '../clientPulseInterventionIdempotencyPure.js';

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

// ── Scenario detector key — deterministic ────────────────────────────────

test('scenario_detector key is stable for same inputs', () => {
  const k1 = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'check_in', churnAssessmentId: 'ca-1',
  });
  const k2 = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'check_in', churnAssessmentId: 'ca-1',
  });
  assert(k1 === k2, `expected stable key, got ${k1} vs ${k2}`);
});

test('scenario_detector key differs across distinct churn assessments', () => {
  const k1 = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'check_in', churnAssessmentId: 'ca-1',
  });
  const k2 = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'check_in', churnAssessmentId: 'ca-2',
  });
  assert(k1 !== k2, 'churnAssessmentId-distinct keys should differ');
});

test('scenario_detector key differs across distinct templates', () => {
  const k1 = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'check_in', churnAssessmentId: 'ca-1',
  });
  const k2 = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'escalation', churnAssessmentId: 'ca-1',
  });
  assert(k1 !== k2, 'template-distinct keys should differ');
});

test('scenario_detector key fits in actions.idempotency_key column', () => {
  const k = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'check_in', churnAssessmentId: 'ca-1',
  });
  assert(k.length === 40, `expected 40-char key, got ${k.length}`);
});

// ── Operator key — deterministic + payload-keyed ─────────────────────────

test('operator key is stable for same payload (UI double-click dedups)', () => {
  const payload = { from: 'a@b.com', toContactId: 'ct-1', subject: 'Hi', body: 'Hello' };
  const k1 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1',
    actionType: 'crm.send_email',
    payload,
    scheduleHint: 'immediate',
  });
  const k2 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1',
    actionType: 'crm.send_email',
    payload: { ...payload },
    scheduleHint: 'immediate',
  });
  assert(k1 === k2, 'same payload should produce same key');
});

test('operator key differs when contact changes', () => {
  const k1 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1',
    actionType: 'crm.send_email',
    payload: { from: 'a@b.com', toContactId: 'ct-1', subject: 'Hi', body: 'x' },
    scheduleHint: 'immediate',
  });
  const k2 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1',
    actionType: 'crm.send_email',
    payload: { from: 'a@b.com', toContactId: 'ct-2', subject: 'Hi', body: 'x' },
    scheduleHint: 'immediate',
  });
  assert(k1 !== k2, 'distinct contact should produce distinct key');
});

test('operator key differs when scheduleHint changes', () => {
  const payload = { fromNumber: '+61400', toContactId: 'ct-1', body: 'x' };
  const k1 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1', actionType: 'crm.send_sms', payload, scheduleHint: 'immediate',
  });
  const k2 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1', actionType: 'crm.send_sms', payload, scheduleHint: 'delay_24h',
  });
  assert(k1 !== k2, 'schedule-distinct keys should differ');
});

test('operator key is order-independent across payload keys', () => {
  const k1 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1',
    actionType: 'crm.send_email',
    payload: { from: 'a@b.com', toContactId: 'ct-1', subject: 'Hi', body: 'x' },
  });
  const k2 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1',
    actionType: 'crm.send_email',
    payload: { body: 'x', toContactId: 'ct-1', subject: 'Hi', from: 'a@b.com' },
  });
  assert(k1 === k2, 'key-order should not affect derivation');
});

test('operator key differs when templateSlug changes', () => {
  const payload = { fromNumber: '+61400', toContactId: 'ct-1', body: 'x' };
  const k1 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1', actionType: 'crm.send_sms', payload, templateSlug: 't1',
  });
  const k2 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1', actionType: 'crm.send_sms', payload, templateSlug: 't2',
  });
  assert(k1 !== k2, 'template-distinct keys should differ');
});

test('operator key namespaced distinct from scenario_detector key', () => {
  // Even with same subaccount + slug, the two paths produce different keys
  // so they cannot collide on the actions UNIQUE constraint.
  const opKey = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1',
    actionType: 'crm.send_email',
    payload: { foo: 'bar' },
    templateSlug: 'check_in',
  });
  const detKey = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'check_in', churnAssessmentId: 'ca-1',
  });
  assert(opKey !== detKey, 'operator + scenario keys must not collide');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
