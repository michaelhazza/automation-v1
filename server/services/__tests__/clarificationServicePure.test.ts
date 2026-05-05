/**
 * clarificationServicePure.test.ts — recipient resolution + timeout tests
 *
 * Spec: docs/memory-and-briefings-spec.md §5.4 (S8)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/clarificationServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  resolveClarificationRecipient,
  normaliseRoutingConfig,
  isClientDomainQuestion,
  isClarificationTimedOut,
} from '../clarificationServicePure.js';

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
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
  expect(config.defaultRecipientRole, 'default').toBe('subaccount_manager');
  expect(config.blockingEscalationRole, 'escalation').toBe('agency_owner');
  expect(config.clientDomainTopics.length > 0, 'topics seeded').toBe(true);
});

test('empty object → defaults filled', () => {
  const config = normaliseRoutingConfig({});
  expect(config.defaultRecipientRole, 'default').toBe('subaccount_manager');
  expect(config.blockingEscalationRole, 'escalation').toBe('agency_owner');
});

test('partial override preserves other defaults', () => {
  const config = normaliseRoutingConfig({
    defaultRecipientRole: 'agency_owner',
  });
  expect(config.defaultRecipientRole, 'overridden').toBe('agency_owner');
  expect(config.blockingEscalationRole, 'default preserved').toBe('agency_owner');
});

test('clientDomainTopics override', () => {
  const config = normaliseRoutingConfig({
    clientDomainTopics: ['refund', 'warranty'],
  });
  expect(config.clientDomainTopics, 'topics overridden').toEqual(['refund', 'warranty']);
});

// ---------------------------------------------------------------------------
// isClientDomainQuestion
// ---------------------------------------------------------------------------

console.log('isClientDomainQuestion:');

test('matches "brand" keyword case-insensitively', () => {
  expect(isClientDomainQuestion('What is the BRAND voice?', ['brand']), 'matches').toBe(true);
});

test('no match → false', () => {
  expect(isClientDomainQuestion('What is the deadline?', ['brand', 'voice']), 'no match').toBe(false);
});

test('empty topics → false', () => {
  expect(isClientDomainQuestion('anything', []), 'empty topics').toBe(false);
});

test('empty question → false', () => {
  expect(isClientDomainQuestion('', ['brand']), 'empty question').toBe(false);
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
  expect(result.role, 'default').toBe('subaccount_manager');
  expect(result.isClientDomain, 'not client domain').toBe(false);
});

test('default routing non-blocking → subaccount_manager', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the deadline?',
    urgency: 'non_blocking',
    portalMode: 'hidden',
    routingConfig: null,
    online: onlineAll,
  });
  expect(result.role, 'non-blocking still default').toBe('subaccount_manager');
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
  expect(result.role, 'escalated').toBe('agency_owner');
  expect(result.reason.includes('blocking_escalation'), 'escalation reason').toBe(true);
});

test('subaccount_manager offline + non-blocking → still subaccount_manager (no escalation)', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the deadline?',
    urgency: 'non_blocking',
    portalMode: 'hidden',
    routingConfig: null,
    online: onlineNone,
  });
  expect(result.role, 'no escalation on non-blocking').toBe('subaccount_manager');
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
  expect(result.role, 'routes to client').toBe('client_contact');
  expect(result.isClientDomain, 'flagged client domain').toBe(true);
});

test('transparency + client-domain → subaccount_manager (client_contact blocked)', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the brand voice?',
    urgency: 'blocking',
    portalMode: 'transparency',
    routingConfig: null,
    online: onlineAll,
  });
  expect(result.role, 'stays with agency').toBe('subaccount_manager');
  expect(result.isClientDomain, 'still flagged as client domain').toBe(true);
});

test('hidden + client-domain → subaccount_manager (client_contact blocked)', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the audience?',
    urgency: 'blocking',
    portalMode: 'hidden',
    routingConfig: null,
    online: onlineAll,
  });
  expect(result.role, 'stays with agency').toBe('subaccount_manager');
});

test('collaborative + non-client-domain → subaccount_manager', () => {
  const result = resolveClarificationRecipient({
    question: 'What is the API budget for this task?',
    urgency: 'blocking',
    portalMode: 'collaborative',
    routingConfig: null,
    online: onlineAll,
  });
  expect(result.role, 'internal question stays internal').toBe('subaccount_manager');
  expect(result.isClientDomain, 'not client domain').toBe(false);
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
  expect(result.role, 'custom default').toBe('agency_owner');
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
  expect(result.role, 'invariant: no client leak on transparency').toBe('subaccount_manager');
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
  expect(result.role, 'client-domain routes directly').toBe('client_contact');
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
  expect(decision.timedOut, 'not timed out').toBe(false);
  expect(decision.elapsedMinutes, 'elapsed 4 min').toBe(4);
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
  expect(decision.timedOut, 'at boundary → timed out').toBe(true);
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
  expect(decision.timedOut, 'non-blocking 29 min not timed out').toBe(false);
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
  expect(decision.timedOut, 'past non-blocking ceiling').toBe(true);
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
  expect(decision.timedOut, 'future not timed out').toBe(false);
  expect(decision.elapsedMinutes < 0, 'negative elapsed').toBe(true);
});

console.log('');
console.log('');
