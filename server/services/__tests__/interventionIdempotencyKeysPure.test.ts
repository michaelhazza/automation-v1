/**
 * interventionIdempotencyKeysPure.test.ts — deterministic idempotency-key
 * contract for the intervention proposal lifecycle.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/interventionIdempotencyKeysPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  buildScenarioDetectorIdempotencyKey,
  buildOperatorIdempotencyKey,
  canonicalStringify,
} from '../clientPulseInterventionIdempotencyPure.js';

// ── Scenario detector key — deterministic ────────────────────────────────

test('scenario_detector key is stable for same inputs', () => {
  const k1 = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'check_in', churnAssessmentId: 'ca-1',
  });
  const k2 = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'check_in', churnAssessmentId: 'ca-1',
  });
  expect(k1 === k2, `expected stable key, got ${k1} vs ${k2}`).toBeTruthy();
});

test('scenario_detector key differs across distinct churn assessments', () => {
  const k1 = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'check_in', churnAssessmentId: 'ca-1',
  });
  const k2 = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'check_in', churnAssessmentId: 'ca-2',
  });
  expect(k1 !== k2, 'churnAssessmentId-distinct keys should differ').toBeTruthy();
});

test('scenario_detector key differs across distinct templates', () => {
  const k1 = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'check_in', churnAssessmentId: 'ca-1',
  });
  const k2 = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'escalation', churnAssessmentId: 'ca-1',
  });
  expect(k1 !== k2, 'template-distinct keys should differ').toBeTruthy();
});

test('scenario_detector key fits in actions.idempotency_key column', () => {
  const k = buildScenarioDetectorIdempotencyKey({
    subaccountId: 'sub-1', templateSlug: 'check_in', churnAssessmentId: 'ca-1',
  });
  expect(k.length === 40, `expected 40-char key, got ${k.length}`).toBeTruthy();
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
  expect(k1 === k2, 'same payload should produce same key').toBeTruthy();
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
  expect(k1 !== k2, 'distinct contact should produce distinct key').toBeTruthy();
});

test('operator key differs when scheduleHint changes', () => {
  const payload = { fromNumber: '+61400', toContactId: 'ct-1', body: 'x' };
  const k1 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1', actionType: 'crm.send_sms', payload, scheduleHint: 'immediate',
  });
  const k2 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1', actionType: 'crm.send_sms', payload, scheduleHint: 'delay_24h',
  });
  expect(k1 !== k2, 'schedule-distinct keys should differ').toBeTruthy();
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
  expect(k1 === k2, 'key-order should not affect derivation').toBeTruthy();
});

test('operator key differs when templateSlug changes', () => {
  const payload = { fromNumber: '+61400', toContactId: 'ct-1', body: 'x' };
  const k1 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1', actionType: 'crm.send_sms', payload, templateSlug: 't1',
  });
  const k2 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1', actionType: 'crm.send_sms', payload, templateSlug: 't2',
  });
  expect(k1 !== k2, 'template-distinct keys should differ').toBeTruthy();
});

// ── Nested-payload regression (operator-alert recipients) ────────────────

test('operator key DOES NOT dedup distinct nested fields (operator_alert recipients)', () => {
  // Regression: a previous version used JSON.stringify(payload, sortedKeys)
  // which drops nested object fields, causing two distinct recipient choices
  // to collide on the same key.
  const payloadA = {
    title: 'spike',
    message: 'm',
    severity: 'warn',
    recipients: { kind: 'preset', value: 'agency_owners' },
    channels: ['in_app'],
  };
  const payloadB = {
    title: 'spike',
    message: 'm',
    severity: 'warn',
    recipients: { kind: 'preset', value: 'on_call' },
    channels: ['in_app'],
  };
  const k1 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1', actionType: 'notify_operator', payload: payloadA,
  });
  const k2 = buildOperatorIdempotencyKey({
    subaccountId: 'sub-1', actionType: 'notify_operator', payload: payloadB,
  });
  expect(k1 !== k2, 'distinct recipient choices must produce distinct keys').toBeTruthy();
});

test('canonicalStringify recurses into nested objects', () => {
  const a = canonicalStringify({ a: 1, b: { c: 2, d: 3 } });
  const b = canonicalStringify({ b: { d: 3, c: 2 }, a: 1 });
  expect(a === b, 'nested key order should not affect output').toBeTruthy();
  expect(a.includes('"c":2'), 'nested c=2 should be in output').toBeTruthy();
  expect(a.includes('"d":3'), 'nested d=3 should be in output').toBeTruthy();
});

test('canonicalStringify handles arrays', () => {
  const out = canonicalStringify({ channels: ['email', 'in_app'] });
  expect(out === '{"channels":["email","in_app"]}', `output=${out}`).toBeTruthy();
});

test('canonicalStringify preserves primitive types', () => {
  expect(canonicalStringify(null) === 'null', 'null').toBeTruthy();
  expect(canonicalStringify(true) === 'true', 'true').toBeTruthy();
  expect(canonicalStringify(42) === '42', '42').toBeTruthy();
  expect(canonicalStringify('hi') === '"hi"', '"hi"').toBeTruthy();
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
  expect(opKey !== detKey, 'operator + scenario keys must not collide').toBeTruthy();
});
