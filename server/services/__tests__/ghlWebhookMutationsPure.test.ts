/**
 * ghlWebhookMutationsPure.test.ts — Tests for the pure GHL webhook-to-mutation
 * mapper and the volume-heuristic classifier. Exercises the 10 event →
 * canonical_subaccount_mutations mappings from spec §2.0b without touching
 * Postgres.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/ghlWebhookMutationsPure.test.ts
 */

import {
  normaliseGhlMutation,
  classifyUserKindByVolume,
  isOutboundStaffMessage,
  type GhlEventEnvelope,
} from '../ghlWebhookMutationsPure.js';

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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── 10 event-mapping cases (spec §2.0b lines 235–244 + Phase 1 follow-up) ──

test('ContactCreate → contact_created mutation with createdBy attribution', () => {
  const result = normaliseGhlMutation({
    type: 'ContactCreate',
    locationId: 'loc-1',
    traceId: 'trace-abc',
    dateAdded: '2026-04-10T12:00:00Z',
    contact: { id: 'contact-1', createdBy: 'user-42' },
  });
  assert(result !== null, 'should map');
  assertEq(result.mutationType, 'contact_created', 'mutationType');
  assertEq(result.sourceEntity, 'contact', 'sourceEntity');
  assertEq(result.externalUserId, 'user-42', 'externalUserId');
  assertEq(result.externalId, 'trace-abc', 'externalId prefers traceId');
});

test('ContactUpdate → contact_updated mutation with updatedBy attribution', () => {
  const result = normaliseGhlMutation({
    type: 'ContactUpdate',
    locationId: 'loc-1',
    traceId: 'trace-2',
    dateUpdated: '2026-04-10T12:30:00Z',
    contact: { id: 'contact-1', updatedBy: 'user-9' },
  });
  assert(result !== null, 'should map');
  assertEq(result.mutationType, 'contact_updated', 'mutationType');
  assertEq(result.externalUserId, 'user-9', 'externalUserId');
});

test('OpportunityStageUpdate → opportunity_stage_changed', () => {
  const result = normaliseGhlMutation({
    type: 'OpportunityStageUpdate',
    locationId: 'loc-1',
    traceId: 'trace-3',
    opportunity: { id: 'opp-1', updatedBy: 'user-7' },
  });
  assert(result !== null, 'should map');
  assertEq(result.mutationType, 'opportunity_stage_changed', 'mutationType');
  assertEq(result.sourceEntity, 'opportunity', 'sourceEntity');
  assertEq(result.externalUserId, 'user-7', 'externalUserId');
});

test('OpportunityStatusUpdate → opportunity_status_changed', () => {
  const result = normaliseGhlMutation({
    type: 'OpportunityStatusUpdate',
    locationId: 'loc-1',
    traceId: 'trace-4',
    opportunity: { id: 'opp-2', updatedBy: 'user-5' },
  });
  assert(result !== null, 'should map');
  assertEq(result.mutationType, 'opportunity_status_changed', 'mutationType');
  assertEq(result.externalUserId, 'user-5', 'externalUserId');
});

test('ConversationCreated with outbound staff message → message_sent_outbound', () => {
  const result = normaliseGhlMutation({
    type: 'ConversationCreated',
    locationId: 'loc-1',
    traceId: 'trace-5',
    id: 'conv-99',
    message: { id: 'msg-1', direction: 'outbound', userId: 'user-3' },
  });
  assert(result !== null, 'should map');
  assertEq(result.mutationType, 'message_sent_outbound', 'mutationType');
  assertEq(result.sourceEntity, 'conversation', 'sourceEntity');
  assertEq(result.externalUserId, 'user-3', 'externalUserId');
});

test('ConversationCreated inbound → no mutation', () => {
  const result = normaliseGhlMutation({
    type: 'ConversationCreated',
    locationId: 'loc-1',
    message: { direction: 'inbound', userId: 'user-3' },
  });
  assertEq(result, null, 'inbound should not produce a staff mutation');
});

test('ConversationCreated outbound via third-party provider → no mutation (§2.0b guard)', () => {
  const result = normaliseGhlMutation({
    type: 'ConversationCreated',
    locationId: 'loc-1',
    message: { direction: 'outbound', userId: 'user-3', conversationProviderId: 'closebot:xyz' },
  });
  assertEq(result, null, 'provider-dispatched message is not a staff mutation');
});

test('ConversationCreated outbound without userId → no mutation', () => {
  const result = normaliseGhlMutation({
    type: 'ConversationCreated',
    locationId: 'loc-1',
    message: { direction: 'outbound' },
  });
  assertEq(result, null, 'missing userId should skip');
});

test('INSTALL event → app_installed mutation', () => {
  const result = normaliseGhlMutation({
    type: 'INSTALL',
    locationId: 'loc-2',
    traceId: 'trace-i',
    installedBy: 'agency-owner',
  });
  assert(result !== null, 'should map');
  assertEq(result.mutationType, 'app_installed', 'mutationType');
  assertEq(result.sourceEntity, 'location', 'sourceEntity');
  assertEq(result.externalUserId, 'agency-owner', 'externalUserId');
});

test('UNINSTALL event → app_uninstalled mutation', () => {
  const result = normaliseGhlMutation({
    type: 'UNINSTALL',
    locationId: 'loc-2',
    traceId: 'trace-u',
    uninstalledBy: 'agency-owner',
  });
  assert(result !== null, 'should map');
  assertEq(result.mutationType, 'app_uninstalled', 'mutationType');
});

test('LocationCreate event → location_created mutation', () => {
  const result = normaliseGhlMutation({
    type: 'LocationCreate',
    locationId: 'loc-3',
    traceId: 'trace-lc',
    createdBy: 'admin',
  });
  assert(result !== null, 'should map');
  assertEq(result.mutationType, 'location_created', 'mutationType');
  assertEq(result.externalUserId, 'admin', 'externalUserId');
});

test('LocationUpdate event → location_updated mutation', () => {
  const result = normaliseGhlMutation({
    type: 'LocationUpdate',
    locationId: 'loc-3',
    traceId: 'trace-lu',
    updatedBy: 'admin',
  });
  assert(result !== null, 'should map');
  assertEq(result.mutationType, 'location_updated', 'mutationType');
});

test('Unrecognised event type → null', () => {
  const result = normaliseGhlMutation({ type: 'UnknownEvent', locationId: 'loc-1' });
  assertEq(result, null, 'unknown events are not mutations');
});

test('Event missing type → null', () => {
  const result = normaliseGhlMutation({} as GhlEventEnvelope);
  assertEq(result, null, 'missing type short-circuits');
});

test('Fallback externalId when traceId absent uses type + id + timestamp', () => {
  const result = normaliseGhlMutation({
    type: 'ContactCreate',
    locationId: 'loc-1',
    contact: { id: 'contact-xyz', createdBy: 'u1' },
    dateAdded: '2026-04-10T00:00:00Z',
  });
  assert(result !== null, 'should map');
  assert(result.externalId.startsWith('ContactCreate:'), `fallback prefix: ${result.externalId}`);
});

// ── Outbound staff-message guard (isolated) ──────────────────────────────

test('isOutboundStaffMessage returns true for direction=outbound + userId + no providerId', () => {
  assert(
    isOutboundStaffMessage({
      type: 'ConversationCreated',
      locationId: 'loc-1',
      message: { direction: 'outbound', userId: 'u1' },
    }),
    'canonical staff send',
  );
});

test('isOutboundStaffMessage accepts top-level fields as fallback', () => {
  assert(
    isOutboundStaffMessage({
      type: 'ConversationCreated',
      locationId: 'loc-1',
      direction: 'outbound',
      userId: 'u1',
    }),
    'fields at top level',
  );
});

test('isOutboundStaffMessage rejects when providerId set', () => {
  assert(
    !isOutboundStaffMessage({
      type: 'ConversationCreated',
      locationId: 'loc-1',
      message: { direction: 'outbound', userId: 'u1', conversationProviderId: 'closebot:xyz' },
    }),
    'third-party dispatch excluded',
  );
});

// ── Outlier-volume classifier (§2.0b) ────────────────────────────────────

test('classifyUserKindByVolume flags high-volume user as automation', () => {
  const result = classifyUserKindByVolume({
    userId: 'bot-1',
    userCounts: new Map([['bot-1', 800], ['alice', 100], ['bob', 100]]),
    totalCount: 1000,
    threshold: 0.6,
  });
  assertEq(result, 'automation', 'bot-1 has 80% share');
});

test('classifyUserKindByVolume flags moderate user as staff', () => {
  const result = classifyUserKindByVolume({
    userId: 'alice',
    userCounts: new Map([['bot-1', 800], ['alice', 100], ['bob', 100]]),
    totalCount: 1000,
    threshold: 0.6,
  });
  assertEq(result, 'staff', 'alice at 10% is staff');
});

test('classifyUserKindByVolume returns unknown for null userId', () => {
  const result = classifyUserKindByVolume({
    userId: null,
    userCounts: new Map(),
    totalCount: 0,
    threshold: 0.6,
  });
  assertEq(result, 'unknown', 'null id → unknown');
});

test('classifyUserKindByVolume returns unknown when user has zero observations', () => {
  const result = classifyUserKindByVolume({
    userId: 'new-user',
    userCounts: new Map([['alice', 100]]),
    totalCount: 100,
    threshold: 0.6,
  });
  assertEq(result, 'unknown', 'no baseline → unknown');
});

test('classifyUserKindByVolume honours namedAutomationIds override', () => {
  const result = classifyUserKindByVolume({
    userId: 'known-bot',
    userCounts: new Map([['known-bot', 5]]), // low volume
    totalCount: 500,
    threshold: 0.6,
    namedAutomationIds: new Set(['known-bot']),
  });
  assertEq(result, 'automation', 'named list overrides volume');
});

test('classifyUserKindByVolume boundary: threshold is strict (> not >=)', () => {
  const result = classifyUserKindByVolume({
    userId: 'user-boundary',
    userCounts: new Map([['user-boundary', 60], ['other', 40]]),
    totalCount: 100,
    threshold: 0.6,
  });
  assertEq(result, 'staff', 'exactly at threshold is staff, not automation');
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log('');
console.log(`ghlWebhookMutationsPure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
