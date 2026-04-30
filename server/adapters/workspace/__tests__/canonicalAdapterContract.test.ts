/**
 * Adapter contract test suite — both adapters must pass identical scenarios.
 *
 * Uses in-memory mocks (no DB, no googleapis) so this runs cleanly with:
 *   npx tsx server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts
 *
 * Integration tests against the real adapters with a live DB + credentials run
 * in CI under the test:gates suite.
 */

import { strict as assert } from 'node:assert';
import type { WorkspaceAdapter } from '../workspaceAdapterContract.js';
import { mockNativeAdapter, resetMockNative, failNextCall as nativeFail } from './mockNativeAdapter.js';
import { mockGoogleAdapter, resetMockGoogle, failNextCall as googleFail } from './mockGoogleApi.js';

const BASE_PROVISION: Parameters<WorkspaceAdapter['provisionIdentity']>[0] = {
  organisationId: '00000000-0000-0000-0000-000000000001',
  subaccountId: '00000000-0000-0000-0000-000000000002',
  actorId: '00000000-0000-0000-0000-000000000003',
  connectorConfigId: '00000000-0000-0000-0000-000000000004',
  displayName: 'Alex Agent',
  emailLocalPart: 'alex',
  emailSendingEnabled: true,
  provisioningRequestId: 'req-contract-test-1',
  signature: '',
  photoUrl: undefined,
};

const adapters: Array<[string, WorkspaceAdapter, () => void]> = [
  ['native_mock', mockNativeAdapter, resetMockNative],
  ['google_mock', mockGoogleAdapter, resetMockGoogle],
];

for (const [name, adapter, reset] of adapters) {
  reset();
  console.log(`\n── ${name} ──`);

  // ── Scenario 1: provisionIdentity is idempotent on provisioningRequestId ──

  const a = await adapter.provisionIdentity(BASE_PROVISION);
  assert.ok(a.identityId, `${name}: provision returns identityId`);
  assert.ok(a.emailAddress.includes('alex'), `${name}: email contains local part`);

  const b = await adapter.provisionIdentity(BASE_PROVISION); // same requestId
  assert.equal(a.identityId, b.identityId, `${name}: idempotent provision — same identityId`);
  assert.equal(a.emailAddress, b.emailAddress, `${name}: idempotent provision — same emailAddress`);

  // ── Scenario 2: second agent can be provisioned independently ────────────

  const c = await adapter.provisionIdentity({
    ...BASE_PROVISION,
    emailLocalPart: 'bob',
    provisioningRequestId: 'req-contract-test-2',
  });
  assert.notEqual(c.identityId, a.identityId, `${name}: different agent gets different identityId`);

  // ── Scenario 3: sendEmail returns an externalMessageId ───────────────────

  const sent = await adapter.sendEmail({
    fromIdentityId: a.identityId,
    toAddresses: ['recipient@example.com'],
    subject: 'Contract test',
    bodyText: 'Hello from the contract test.',
    bodyHtml: null,
    policyContext: { skill: 'test', runId: 'run-1' },
  });
  assert.ok(sent.externalMessageId, `${name}: sendEmail returns externalMessageId`);

  // ── Scenario 4: createEvent + respondToEvent round trip ──────────────────

  const now = new Date();
  const future = new Date(now.getTime() + 3_600_000);
  const evt = await adapter.createEvent({
    fromIdentityId: a.identityId,
    title: 'Contract test meeting',
    startsAt: now,
    endsAt: future,
    attendeeEmails: ['attendee@example.com'],
  });
  assert.ok(evt.eventId, `${name}: createEvent returns eventId`);

  await adapter.respondToEvent(evt.eventId, 'accepted');
  await adapter.respondToEvent(evt.eventId, 'tentative'); // idempotent re-call

  // ── Scenario 5: fetchUpcoming returns the created event ──────────────────

  const upcoming = await adapter.fetchUpcoming(a.identityId, new Date(now.getTime() + 7_200_000));
  assert.ok(upcoming.length >= 1, `${name}: fetchUpcoming returns at least the created event`);
  const found = upcoming.find((e) => e.title === 'Contract test meeting');
  assert.ok(found, `${name}: fetchUpcoming includes the event we created`);

  // ── Scenario 6: fetchInboundSince returns an array (possibly empty) ──────

  const inbound = await adapter.fetchInboundSince(a.identityId, new Date(0));
  assert.ok(Array.isArray(inbound), `${name}: fetchInboundSince returns array`);

  // ── Scenario 7: suspend + resume idempotent ───────────────────────────────

  await adapter.suspendIdentity(a.identityId);
  await adapter.suspendIdentity(a.identityId); // idempotent second call — should not throw
  await adapter.resumeIdentity(a.identityId);
  await adapter.resumeIdentity(a.identityId); // idempotent resume

  // ── Scenario 8: revokeIdentity and archiveIdentity do not throw ──────────

  await adapter.revokeIdentity(c.identityId);
  await adapter.archiveIdentity(c.identityId);

  console.log(`✓ ${name}: all scenarios passed`);
}

// ── Migration scenario: native → google (cross-adapter idempotency) ──────────
//
// NOTE: Full service-level orchestration tests (processIdentityMigration with
// audit events) require a live DB and run in CI under the test:gates suite.
// This block tests adapter-level behaviour only.

console.log('\n── migration: native → google ──');

resetMockNative();
resetMockGoogle();

const MIGRATION_REQUEST_ID = 'mig-req-contract-test-1';
const actorIds = ['actor-alpha', 'actor-beta', 'actor-gamma'];

// Provision all actors on native (simulating "pre-migration" state)
const nativeIds: Record<string, string> = {};
for (const actorId of actorIds) {
  const r = await mockNativeAdapter.provisionIdentity({
    ...BASE_PROVISION,
    actorId,
    emailLocalPart: actorId.replace('actor-', ''),
    provisioningRequestId: `seed:${actorId}`,
  });
  nativeIds[actorId] = r.identityId;
  assert.ok(r.identityId, `native provision ${actorId}`);
}

// Migrate each actor to google: same migrationRequestId:actorId key → idempotent
const googleIds: Record<string, string> = {};
for (const actorId of [...actorIds].sort()) {
  const provisioningRequestId = `${MIGRATION_REQUEST_ID}:${actorId}`;
  const r = await mockGoogleAdapter.provisionIdentity({
    ...BASE_PROVISION,
    actorId,
    emailLocalPart: actorId.replace('actor-', ''),
    provisioningRequestId,
  });
  googleIds[actorId] = r.identityId;
  assert.ok(r.identityId, `google provision ${actorId}`);
}

// Idempotency: same migrationRequestId → same google identityId
for (const actorId of actorIds) {
  const provisioningRequestId = `${MIGRATION_REQUEST_ID}:${actorId}`;
  const retry = await mockGoogleAdapter.provisionIdentity({
    ...BASE_PROVISION,
    actorId,
    emailLocalPart: actorId.replace('actor-', ''),
    provisioningRequestId,
  });
  assert.equal(
    retry.identityId,
    googleIds[actorId],
    `migration idempotency: retry for ${actorId} returns same google identityId`,
  );
}

// Archive native identities (simulating post-migration cleanup)
for (const actorId of actorIds) {
  await mockNativeAdapter.archiveIdentity(nativeIds[actorId]);
}

console.log('✓ migration: native → google — all assertions passed');

// ── Failure injection scenarios ───────────────────────────────────────────────

console.log('\n── failure injection ──');

resetMockNative();
resetMockGoogle();

// Scenario F1: provisionIdentity fails → retry succeeds (idempotency preserved)
{
  const provisioningRequestId = 'fail-test-provision-1';
  googleFail('provisionIdentity', new Error('quota_exceeded'));
  let threw = false;
  try {
    await mockGoogleAdapter.provisionIdentity({ ...BASE_PROVISION, provisioningRequestId });
  } catch (err: unknown) {
    threw = true;
    assert.match(String(err), /quota_exceeded/, 'F1: provision failure message');
  }
  assert.ok(threw, 'F1: provision failure throws');

  // Retry: same provisioningRequestId, no longer failing → succeeds
  const r = await mockGoogleAdapter.provisionIdentity({ ...BASE_PROVISION, provisioningRequestId });
  assert.ok(r.identityId, 'F1: retry after provision failure succeeds');

  // Second retry: idempotent (same identityId)
  const r2 = await mockGoogleAdapter.provisionIdentity({ ...BASE_PROVISION, provisioningRequestId });
  assert.equal(r.identityId, r2.identityId, 'F1: idempotent after success');

  console.log('  ✓ F1: provision fail → retry → idempotent');
}

// Scenario F2: sendEmail fails once → retry succeeds
{
  const r = await mockGoogleAdapter.provisionIdentity({ ...BASE_PROVISION, provisioningRequestId: 'fail-test-send-actor' });

  googleFail('sendEmail', new Error('rate_limited'));
  let threw = false;
  try {
    await mockGoogleAdapter.sendEmail({ fromIdentityId: r.identityId, toAddresses: ['x@example.com'], subject: 'F2', bodyText: 'body', bodyHtml: null, policyContext: { skill: 'test', runId: 'run-f2' } });
  } catch (err: unknown) {
    threw = true;
    assert.match(String(err), /rate_limited/, 'F2: send failure message');
  }
  assert.ok(threw, 'F2: send failure throws');

  // Retry succeeds
  const sent = await mockGoogleAdapter.sendEmail({ fromIdentityId: r.identityId, toAddresses: ['x@example.com'], subject: 'F2', bodyText: 'body', bodyHtml: null, policyContext: { skill: 'test', runId: 'run-f2' } });
  assert.ok(sent.externalMessageId, 'F2: retry send succeeds');

  console.log('  ✓ F2: send fail → retry succeeds');
}

// Scenario F3: archiveIdentity fails once → retry succeeds
{
  const r = await mockNativeAdapter.provisionIdentity({ ...BASE_PROVISION, provisioningRequestId: 'fail-test-archive-1' });

  nativeFail('archiveIdentity', new Error('archive_conflict'));
  let threw = false;
  try {
    await mockNativeAdapter.archiveIdentity(r.identityId);
  } catch (err: unknown) {
    threw = true;
    assert.match(String(err), /archive_conflict/, 'F3: archive failure message');
  }
  assert.ok(threw, 'F3: archive failure throws');

  // Retry: no longer failing
  await mockNativeAdapter.archiveIdentity(r.identityId); // should not throw
  console.log('  ✓ F3: archive fail → retry succeeds');
}

console.log('\n✓ failure injection: all scenarios passed');

console.log('\ncanonicialAdapterContract.test: OK');
