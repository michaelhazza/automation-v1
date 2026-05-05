/**
 * clientPulseInterventionPrimitivesPure.test.ts — pure tests for the 5 Phase 4
 * intervention primitives:
 *   - crm.fire_automation
 *   - crm.send_email
 *   - crm.send_sms
 *   - crm.create_task
 *   - notify_operator (renamed from clientpulse.operator_alert in Session 1)
 *
 * Runnable via:
 *   npx tsx server/skills/__tests__/clientPulseInterventionPrimitivesPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  validateFireAutomationPayload,
  fireAutomationIdempotencyKey,
  buildFireAutomationProviderCall,
} from '../crmFireAutomationServicePure.js';
import {
  validateSendEmailPayload,
  sendEmailIdempotencyKey,
  buildSendEmailProviderCall,
} from '../crmSendEmailServicePure.js';
import {
  validateSendSmsPayload,
  sendSmsIdempotencyKey,
  buildSendSmsProviderCall,
  countSmsSegments,
} from '../crmSendSmsServicePure.js';
import {
  validateCreateTaskPayload,
  createTaskIdempotencyKey,
  buildCreateTaskProviderCall,
} from '../crmCreateTaskServicePure.js';
import {
  validateOperatorAlertPayload,
  operatorAlertIdempotencyKey,
  filterChannelsAgainstAvailability,
} from '../clientPulseOperatorAlertServicePure.js';

const mergeInputs = {
  contact: { firstName: 'Marcia' },
  subaccount: { name: 'Smith Dental' },
  signals: { healthScore: 48 },
  org: { tradingName: 'Synthetos' },
  agency: { tradingName: 'Synthetos' },
};

// ═════════════════════════════════════════════════════════════════════════
// crm.fire_automation
// ═════════════════════════════════════════════════════════════════════════

test('fire_automation: valid payload passes', () => {
  const r = validateFireAutomationPayload({
    automationId: 'aut-1',
    contactId: 'ct-1',
    scheduleHint: 'immediate',
  });
  expect(r.ok, `expected ok, got ${JSON.stringify(r)}`).toBeTruthy();
});

test('fire_automation: missing automationId rejected', () => {
  const r = validateFireAutomationPayload({ contactId: 'ct-1' });
  expect(!r.ok, 'expected rejection').toBeTruthy();
  expect(r.ok || r.errorCode === 'INVALID_PAYLOAD', 'expected INVALID_PAYLOAD').toBeTruthy();
});

test('fire_automation: scheduled without scheduledFor rejected', () => {
  const r = validateFireAutomationPayload({
    automationId: 'aut-1',
    contactId: 'ct-1',
    scheduleHint: 'scheduled',
  });
  expect(!r.ok, 'expected rejection').toBeTruthy();
  expect(r.ok || r.errorCode === 'MISSING_SCHEDULE', 'expected MISSING_SCHEDULE').toBeTruthy();
});

test('fire_automation: idempotency key includes scheduleHint (immediate vs delay_24h distinct)', () => {
  const k1 = fireAutomationIdempotencyKey({
    subaccountId: 'sub-1', automationId: 'aut-1', contactId: 'ct-1', scheduleHint: 'immediate',
  });
  const k2 = fireAutomationIdempotencyKey({
    subaccountId: 'sub-1', automationId: 'aut-1', contactId: 'ct-1', scheduleHint: 'delay_24h',
  });
  expect(k1 !== k2, 'schedule-distinct keys should differ').toBeTruthy();
});

test('fire_automation: provider call shape', () => {
  const call = buildFireAutomationProviderCall({
    automationId: 'aut-1', contactId: 'ct-1', scheduleHint: 'immediate',
  });
  expect(call.method === 'POST', 'method').toBeTruthy();
  expect(call.path === '/v1/automations/aut-1/fire', `path=${call.path}`).toBeTruthy();
  expect((call.body as any).contactId === 'ct-1', 'body.contactId').toBeTruthy();
});

// ═════════════════════════════════════════════════════════════════════════
// crm.send_email
// ═════════════════════════════════════════════════════════════════════════

test('send_email: valid payload passes', () => {
  const r = validateSendEmailPayload({
    from: 'a@b.com', toContactId: 'ct-1', subject: 'Hi', body: 'Hello',
  });
  expect(r.ok, 'expected ok').toBeTruthy();
});

test('send_email: missing subject rejected', () => {
  const r = validateSendEmailPayload({ from: 'a@b.com', toContactId: 'ct-1', body: 'Hi' });
  expect(!r.ok, 'expected rejection').toBeTruthy();
});

test('send_email: merge fields resolved in subject + body before provider call', () => {
  const call = buildSendEmailProviderCall(
    {
      from: 'a@b.com',
      toContactId: 'ct-1',
      subject: 'Hi {{contact.firstName}}',
      body: 'Score {{signals.healthScore}}',
      scheduleHint: 'immediate',
    },
    mergeInputs,
  );
  expect((call.body as any).subject === 'Hi Marcia', `subject=${(call.body as any).subject}`).toBeTruthy();
  expect((call.body as any).body === 'Score 48', `body=${(call.body as any).body}`).toBeTruthy();
  expect(call.unresolvedMergeFields.length === 0, 'no unresolved').toBeTruthy();
});

test('send_email: unresolved merge field reported without crashing', () => {
  const call = buildSendEmailProviderCall(
    { from: 'a@b.com', toContactId: 'ct-1', subject: 'Hi {{contact.bogus}}', body: 'x', scheduleHint: 'immediate' },
    mergeInputs,
  );
  expect(call.unresolvedMergeFields.includes('contact.bogus'), 'unresolved includes contact.bogus').toBeTruthy();
});

test('send_email: idempotency key stable for same (contact, subject, schedule)', () => {
  const k1 = sendEmailIdempotencyKey({
    subaccountId: 'sub-1', toContactId: 'ct-1', subject: 'Hi', scheduleHint: 'immediate',
  });
  const k2 = sendEmailIdempotencyKey({
    subaccountId: 'sub-1', toContactId: 'ct-1', subject: 'Hi', scheduleHint: 'immediate',
  });
  expect(k1 === k2, 'stable key').toBeTruthy();
});

// ═════════════════════════════════════════════════════════════════════════
// crm.send_sms
// ═════════════════════════════════════════════════════════════════════════

test('send_sms: valid payload passes', () => {
  const r = validateSendSmsPayload({
    fromNumber: '+61400000000', toContactId: 'ct-1', body: 'Short msg',
  });
  expect(r.ok, 'expected ok').toBeTruthy();
});

test('send_sms: segment count for single segment', () => {
  expect(countSmsSegments('a'.repeat(160)) === 1, 'exact 160 chars = 1 segment').toBeTruthy();
});

test('send_sms: segment count for multi-segment', () => {
  const count = countSmsSegments('a'.repeat(165));
  expect(count === 2, `165 chars = 2 segments, got ${count}`).toBeTruthy();
});

test('send_sms: merge fields resolved before segment count', () => {
  const call = buildSendSmsProviderCall(
    {
      fromNumber: '+61400000000',
      toContactId: 'ct-1',
      body: 'Hi {{contact.firstName}}',
      scheduleHint: 'immediate',
    },
    mergeInputs,
  );
  expect((call.body as any).body === 'Hi Marcia', `body=${(call.body as any).body}`).toBeTruthy();
  expect(call.segmentCount === 1, `segments=${call.segmentCount}`).toBeTruthy();
});

// ═════════════════════════════════════════════════════════════════════════
// crm.create_task
// ═════════════════════════════════════════════════════════════════════════

test('create_task: valid payload passes', () => {
  const r = validateCreateTaskPayload({
    assigneeUserId: 'u-1',
    title: 'Follow up',
    dueAt: '2026-04-25T10:00:00Z',
    priority: 'med',
  });
  expect(r.ok, 'expected ok').toBeTruthy();
});

test('create_task: missing title rejected', () => {
  const r = validateCreateTaskPayload({
    assigneeUserId: 'u-1', dueAt: '2026-04-25T10:00:00Z',
  });
  expect(!r.ok, 'expected rejection').toBeTruthy();
});

test('create_task: invalid dueAt rejected', () => {
  const r = validateCreateTaskPayload({
    assigneeUserId: 'u-1', title: 'x', dueAt: 'not-a-date',
  });
  expect(!r.ok, 'expected rejection').toBeTruthy();
});

test('create_task: provider call shape includes relatedContactId', () => {
  const call = buildCreateTaskProviderCall({
    assigneeUserId: 'u-1',
    title: 'Follow up',
    dueAt: '2026-04-25T10:00:00Z',
    relatedContactId: 'ct-1',
    priority: 'high',
  });
  expect((call.body as any).contactId === 'ct-1', 'contact').toBeTruthy();
  expect((call.body as any).priority === 'high', 'priority').toBeTruthy();
});

test('create_task: idempotency key differs on title change', () => {
  const k1 = createTaskIdempotencyKey({
    subaccountId: 'sub-1', assigneeUserId: 'u-1', title: 'A', dueAt: '2026-04-25T10:00:00Z',
  });
  const k2 = createTaskIdempotencyKey({
    subaccountId: 'sub-1', assigneeUserId: 'u-1', title: 'B', dueAt: '2026-04-25T10:00:00Z',
  });
  expect(k1 !== k2, 'title-distinct keys').toBeTruthy();
});

// ═════════════════════════════════════════════════════════════════════════
// notify_operator (formerly clientpulse.operator_alert — Session 1 contract (i))
// ═════════════════════════════════════════════════════════════════════════

test('operator_alert: valid payload passes', () => {
  const r = validateOperatorAlertPayload({
    title: 'Churn risk spike',
    message: 'Client health dropped 20pts',
    severity: 'warn',
    recipients: { kind: 'preset', value: 'agency_owners' },
    channels: ['in_app', 'email'],
  });
  expect(r.ok, 'expected ok').toBeTruthy();
});

test('operator_alert: empty channels rejected', () => {
  const r = validateOperatorAlertPayload({
    title: 'x',
    message: 'y',
    recipients: { kind: 'preset', value: 'agency_owners' },
    channels: [],
  });
  expect(!r.ok, 'expected rejection').toBeTruthy();
});

test('operator_alert: channel filter drops unconfigured channels', () => {
  const { fanOut, skipped } = filterChannelsAgainstAvailability(
    ['in_app', 'email', 'slack'],
    { inApp: true, email: true, slack: false },
  );
  expect(fanOut.length === 2, `fanOut=${fanOut.length}`).toBeTruthy();
  expect(skipped.length === 1, `skipped=${skipped.length}`).toBeTruthy();
  expect(skipped[0].channel === 'slack', 'skipped slack').toBeTruthy();
});

test('operator_alert: idempotency key uses title hash + severity', () => {
  const k1 = operatorAlertIdempotencyKey({
    subaccountId: 'sub-1', orgId: 'org-1', title: 'Churn spike', severity: 'warn',
  });
  const k2 = operatorAlertIdempotencyKey({
    subaccountId: 'sub-1', orgId: 'org-1', title: 'Churn spike', severity: 'urgent',
  });
  expect(k1 !== k2, 'severity-distinct keys').toBeTruthy();
});

// ── Summary ───────────────────────────────────────────────────────────────
