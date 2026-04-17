/**
 * clarificationServicePure.test.ts — recipient resolution + timeout tests
 *
 * Spec: docs/memory-and-briefings-spec.md §5.4 (S8)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/clarificationServicePure.test.ts
 */

import {
  resolveClarificationRecipient,
  normaliseRoutingConfig,
  isClientDomainQuestion,
  isClarificationTimedOut,
} from '../clarificationServicePure.js';

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

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function assertTrue(cond: boolean, label: string) {
  if (!cond) throw new Error(`${label} — expected true`);
}

function assertFalse(cond: boolean, label: string) {
  if (cond) throw new Error(`${label} — expected false`);
}

console.log('');
console.log('clarificationServicePure — routing & timeout (§5.4 S8)');
console.log('');

// ---------------------------------------------------------------------------
// normaliseRoutingConfig
// ---------------------------------------------------------------------------

console.log('normaliseRoutingConfig:');

test('null → fallback chain defaults', () => {
  const config = normaliseRoutingConfig(null);
  assertEqual(config.defaultRecipientRole, 'subaccount_manager', 'default');
  assertEqual(config.blockingEscalationRole, 'agency_owner', 'escalation');
  assertTrue(config.clientDomainTopics.length > 0, 'topics seeded');
});

test('empty object → defaults filled', () => {
  const config = normaliseRoutingConfig({});
  assertEqual(config.defaultRecipientRole, 'subaccount_manager', 'default');
  assertEqual(config.blockingEscalationRole, 'agency_owner', 'escalation');
});

test('partial override preserves other defaults', () => {
  const config = normaliseRoutingConfig({
    defaultRecipientRole: 'agency_owner',
  });
  assertEqual(config.defaultRecipientRole, 'agency_owner', 'overridden');
  assertEqual(config.blockingEscalationRole, 'agency_owner', 'default preserved');
});

test('clientDomainTopics override', () => {
  const config = normaliseRoutingConfig({
    clientDomainTopics: ['refund', 'warranty'],
  });
  assertEqual(config.clientDomainTopics, ['refund', 'warranty'], 'topics overridden');
});

// ---------------------------------------------------------------------------
// isClientDomainQuestion
// ---------------------------------------------------------------------------

console.log('isClientDomainQuestion:');

test('matches "brand" keyword case-insensitively', () => {
  assertTrue(isClientDomainQuestion('What is the BRAND voice?', ['brand']), 'matches');
});

test('no match → false', () => {
  assertFalse(isClientDomainQuestion('What is the deadline?', ['brand', 'voice']), 'no match');
});

test('empty topics → false', () => {
  assertFalse(isClientDomainQuestion('anything', []), 'empty topics');
});

test('empty question → false', () => {
  assertFalse(isClientDomainQuestion('', ['brand']), 'empty question');
});

// ---------------------------------------------------------------------------
// resolveClarificationRecipient — core routing
// ---------------------------------------------------------------------------

console.log('resolveClarificationRecipient — default routing:');

const onlineAll = { subaccountManager: true, agencyOwner: true, clientContact: true };
const onlineNone = { subaccountManager: false, agencyOwner: false, clientContact: false };

test('default routing → subaccount_manager', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the deadline?',
    urgency: 'blocking',
    portalMode: 'hidden',
    routingConfig: null,
    online: onlineAll,
  });
  assertEqual(result.role, 'subaccount_manager', 'default');
  assertEqual(result.isClientDomain, false, 'not client domain');
});

test('default routing non-blocking → subaccount_manager', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the deadline?',
    urgency: 'non_blocking',
    portalMode: 'hidden',
    routingConfig: null,
    online: onlineAll,
  });
  assertEqual(result.role, 'subaccount_manager', 'non-blocking still default');
});

console.log('resolveClarificationRecipient — blocking escalation:');

test('subaccount_manager offline + blocking → agency_owner', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the deadline?',
    urgency: 'blocking',
    portalMode: 'hidden',
    routingConfig: null,
    online: { subaccountManager: false, agencyOwner: true, clientContact: true },
  });
  assertEqual(result.role, 'agency_owner', 'escalated');
  assertTrue(result.reason.includes('blocking_escalation'), 'escalation reason');
});

test('subaccount_manager offline + non-blocking → still subaccount_manager (no escalation)', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the deadline?',
    urgency: 'non_blocking',
    portalMode: 'hidden',
    routingConfig: null,
    online: onlineNone,
  });
  assertEqual(result.role, 'subaccount_manager', 'no escalation on non-blocking');
});

console.log('resolveClarificationRecipient — client domain routing:');

test('collaborative + client-domain → client_contact', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the preferred brand voice?',
    urgency: 'blocking',
    portalMode: 'collaborative',
    routingConfig: null,
    online: onlineAll,
  });
  assertEqual(result.role, 'client_contact', 'routes to client');
  assertTrue(result.isClientDomain, 'flagged client domain');
});

test('transparency + client-domain → subaccount_manager (client_contact blocked)', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the brand voice?',
    urgency: 'blocking',
    portalMode: 'transparency',
    routingConfig: null,
    online: onlineAll,
  });
  assertEqual(result.role, 'subaccount_manager', 'stays with agency');
  assertTrue(result.isClientDomain, 'still flagged as client domain');
});

test('hidden + client-domain → subaccount_manager (client_contact blocked)', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the audience?',
    urgency: 'blocking',
    portalMode: 'hidden',
    routingConfig: null,
    online: onlineAll,
  });
  assertEqual(result.role, 'subaccount_manager', 'stays with agency');
});

test('collaborative + non-client-domain → subaccount_manager', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the API budget for this task?',
    urgency: 'blocking',
    portalMode: 'collaborative',
    routingConfig: null,
    online: onlineAll,
  });
  assertEqual(result.role, 'subaccount_manager', 'internal question stays internal');
  assertFalse(result.isClientDomain, 'not client domain');
});

console.log('resolveClarificationRecipient — config overrides:');

test('custom defaultRecipientRole = agency_owner', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the deadline?',
    urgency: 'blocking',
    portalMode: 'hidden',
    routingConfig: { defaultRecipientRole: 'agency_owner' },
    online: onlineAll,
  });
  assertEqual(result.role, 'agency_owner', 'custom default');
});

test('escalation to client_contact outside collaborative → falls back to default role', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the deadline?',
    urgency: 'blocking',
    portalMode: 'transparency',
    routingConfig: {
      defaultRecipientRole: 'subaccount_manager',
      blockingEscalationRole: 'client_contact',
    },
    online: { subaccountManager: false, agencyOwner: true, clientContact: true },
  });
  // Invariant: never route to client_contact unless collaborative
  assertEqual(result.role, 'subaccount_manager', 'invariant: no client leak on transparency');
});

test('escalation to client_contact IS allowed under collaborative + client-domain', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the preferred brand voice?',
    urgency: 'blocking',
    portalMode: 'collaborative',
    routingConfig: null,
    online: { subaccountManager: false, agencyOwner: true, clientContact: true },
  });
  // Rule 1 (client-domain + collaborative) fires before the escalation ladder
  assertEqual(result.role, 'client_contact', 'client-domain routes directly');
});

// ---------------------------------------------------------------------------
// isClarificationTimedOut
// ---------------------------------------------------------------------------

console.log('isClarificationTimedOut:');

const now = new Date('2026-04-16T10:00:00Z');

test('blocking: 4 min elapsed, 5 min ceiling → not timed out', () => {
  const issuedAt = new Date(now.getTime() - 4 * 60_000);
  const decision = isClarificationTimedOut({
    issuedAt,
    urgency: 'blocking',
    now,
    blockingTimeoutMinutes: 5,
    nonBlockingTimeoutMinutes: 30,
  });
  assertFalse(decision.timedOut, 'not timed out');
  assertEqual(decision.elapsedMinutes, 4, 'elapsed 4 min');
});

test('blocking: 5 min elapsed exactly → timed out (>=)', () => {
  const issuedAt = new Date(now.getTime() - 5 * 60_000);
  const decision = isClarificationTimedOut({
    issuedAt,
    urgency: 'blocking',
    now,
    blockingTimeoutMinutes: 5,
    nonBlockingTimeoutMinutes: 30,
  });
  assertTrue(decision.timedOut, 'at boundary → timed out');
});

test('non_blocking: 29 min elapsed, 30 min ceiling → not timed out', () => {
  const issuedAt = new Date(now.getTime() - 29 * 60_000);
  const decision = isClarificationTimedOut({
    issuedAt,
    urgency: 'non_blocking',
    now,
    blockingTimeoutMinutes: 5,
    nonBlockingTimeoutMinutes: 30,
  });
  assertFalse(decision.timedOut, 'non-blocking 29 min not timed out');
});

test('non_blocking: 31 min elapsed → timed out', () => {
  const issuedAt = new Date(now.getTime() - 31 * 60_000);
  const decision = isClarificationTimedOut({
    issuedAt,
    urgency: 'non_blocking',
    now,
    blockingTimeoutMinutes: 5,
    nonBlockingTimeoutMinutes: 30,
  });
  assertTrue(decision.timedOut, 'past non-blocking ceiling');
});

test('future issuedAt → negative elapsed, not timed out', () => {
  const issuedAt = new Date(now.getTime() + 60_000);
  const decision = isClarificationTimedOut({
    issuedAt,
    urgency: 'blocking',
    now,
    blockingTimeoutMinutes: 5,
    nonBlockingTimeoutMinutes: 30,
  });
  assertFalse(decision.timedOut, 'future not timed out');
  assertTrue(decision.elapsedMinutes < 0, 'negative elapsed');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
