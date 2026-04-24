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
  assert(r.ok, `expected ok, got ${JSON.stringify(r)}`);
});

test('fire_automation: missing automationId rejected', () => {
  const r = validateFireAutomationPayload({ contactId: 'ct-1' });
  assert(!r.ok, 'expected rejection');
  assert(r.ok || r.errorCode === 'INVALID_PAYLOAD', 'expected INVALID_PAYLOAD');
});

test('fire_automation: scheduled without scheduledFor rejected', () => {
  const r = validateFireAutomationPayload({
    automationId: 'aut-1',
    contactId: 'ct-1',
    scheduleHint: 'scheduled',
  });
  assert(!r.ok, 'expected rejection');
  assert(r.ok || r.errorCode === 'MISSING_SCHEDULE', 'expected MISSING_SCHEDULE');
});

test('fire_automation: idempotency key includes scheduleHint (immediate vs delay_24h distinct)', () => {
  const k1 = fireAutomationIdempotencyKey({
    subaccountId: 'sub-1', automationId: 'aut-1', contactId: 'ct-1', scheduleHint: 'immediate',
  });
  const k2 = fireAutomationIdempotencyKey({
    subaccountId: 'sub-1', automationId: 'aut-1', contactId: 'ct-1', scheduleHint: 'delay_24h',
  });
  assert(k1 !== k2, 'schedule-distinct keys should differ');
});

test('fire_automation: provider call shape', () => {
  const call = buildFireAutomationProviderCall({
    automationId: 'aut-1', contactId: 'ct-1', scheduleHint: 'immediate',
  });
  assert(call.method === 'POST', 'method');
  assert(call.path === '/v1/automations/aut-1/fire', `path=${call.path}`);
  assert((call.body as any).contactId === 'ct-1', 'body.contactId');
});

// ═════════════════════════════════════════════════════════════════════════
// crm.send_email
// ═════════════════════════════════════════════════════════════════════════

test('send_email: valid payload passes', () => {
  const r = validateSendEmailPayload({
    from: 'a@b.com', toContactId: 'ct-1', subject: 'Hi', body: 'Hello',
  });
  assert(r.ok, 'expected ok');
});

test('send_email: missing subject rejected', () => {
  const r = validateSendEmailPayload({ from: 'a@b.com', toContactId: 'ct-1', body: 'Hi' });
  assert(!r.ok, 'expected rejection');
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
  assert((call.body as any).subject === 'Hi Marcia', `subject=${(call.body as any).subject}`);
  assert((call.body as any).body === 'Score 48', `body=${(call.body as any).body}`);
  assert(call.unresolvedMergeFields.length === 0, 'no unresolved');
});

test('send_email: unresolved merge field reported without crashing', () => {
  const call = buildSendEmailProviderCall(
    { from: 'a@b.com', toContactId: 'ct-1', subject: 'Hi {{contact.bogus}}', body: 'x', scheduleHint: 'immediate' },
    mergeInputs,
  );
  assert(call.unresolvedMergeFields.includes('contact.bogus'), 'unresolved includes contact.bogus');
});

test('send_email: idempotency key stable for same (contact, subject, schedule)', () => {
  const k1 = sendEmailIdempotencyKey({
    subaccountId: 'sub-1', toContactId: 'ct-1', subject: 'Hi', scheduleHint: 'immediate',
  });
  const k2 = sendEmailIdempotencyKey({
    subaccountId: 'sub-1', toContactId: 'ct-1', subject: 'Hi', scheduleHint: 'immediate',
  });
  assert(k1 === k2, 'stable key');
});

// ═════════════════════════════════════════════════════════════════════════
// crm.send_sms
// ═════════════════════════════════════════════════════════════════════════

test('send_sms: valid payload passes', () => {
  const r = validateSendSmsPayload({
    fromNumber: '+61400000000', toContactId: 'ct-1', body: 'Short msg',
  });
  assert(r.ok, 'expected ok');
});

test('send_sms: segment count for single segment', () => {
  assert(countSmsSegments('a'.repeat(160)) === 1, 'exact 160 chars = 1 segment');
});

test('send_sms: segment count for multi-segment', () => {
  const count = countSmsSegments('a'.repeat(165));
  assert(count === 2, `165 chars = 2 segments, got ${count}`);
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
  assert((call.body as any).body === 'Hi Marcia', `body=${(call.body as any).body}`);
  assert(call.segmentCount === 1, `segments=${call.segmentCount}`);
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
  assert(r.ok, 'expected ok');
});

test('create_task: missing title rejected', () => {
  const r = validateCreateTaskPayload({
    assigneeUserId: 'u-1', dueAt: '2026-04-25T10:00:00Z',
  });
  assert(!r.ok, 'expected rejection');
});

test('create_task: invalid dueAt rejected', () => {
  const r = validateCreateTaskPayload({
    assigneeUserId: 'u-1', title: 'x', dueAt: 'not-a-date',
  });
  assert(!r.ok, 'expected rejection');
});

test('create_task: provider call shape includes relatedContactId', () => {
  const call = buildCreateTaskProviderCall({
    assigneeUserId: 'u-1',
    title: 'Follow up',
    dueAt: '2026-04-25T10:00:00Z',
    relatedContactId: 'ct-1',
    priority: 'high',
  });
  assert((call.body as any).contactId === 'ct-1', 'contact');
  assert((call.body as any).priority === 'high', 'priority');
});

test('create_task: idempotency key differs on title change', () => {
  const k1 = createTaskIdempotencyKey({
    subaccountId: 'sub-1', assigneeUserId: 'u-1', title: 'A', dueAt: '2026-04-25T10:00:00Z',
  });
  const k2 = createTaskIdempotencyKey({
    subaccountId: 'sub-1', assigneeUserId: 'u-1', title: 'B', dueAt: '2026-04-25T10:00:00Z',
  });
  assert(k1 !== k2, 'title-distinct keys');
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
  assert(r.ok, 'expected ok');
});

test('operator_alert: empty channels rejected', () => {
  const r = validateOperatorAlertPayload({
    title: 'x',
    message: 'y',
    recipients: { kind: 'preset', value: 'agency_owners' },
    channels: [],
  });
  assert(!r.ok, 'expected rejection');
});

test('operator_alert: channel filter drops unconfigured channels', () => {
  const { fanOut, skipped } = filterChannelsAgainstAvailability(
    ['in_app', 'email', 'slack'],
    { inApp: true, email: true, slack: false },
  );
  assert(fanOut.length === 2, `fanOut=${fanOut.length}`);
  assert(skipped.length === 1, `skipped=${skipped.length}`);
  assert(skipped[0].channel === 'slack', 'skipped slack');
});

test('operator_alert: idempotency key uses title hash + severity', () => {
  const k1 = operatorAlertIdempotencyKey({
    subaccountId: 'sub-1', orgId: 'org-1', title: 'Churn spike', severity: 'warn',
  });
  const k2 = operatorAlertIdempotencyKey({
    subaccountId: 'sub-1', orgId: 'org-1', title: 'Churn spike', severity: 'urgent',
  });
  assert(k1 !== k2, 'severity-distinct keys');
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
