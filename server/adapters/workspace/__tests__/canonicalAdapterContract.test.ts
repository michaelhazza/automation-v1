/**
 * Adapter contract test suite — both adapters must pass identical scenarios.
 *
 * Uses in-memory mocks (no DB, no googleapis) so this runs cleanly with:
 *   npx vitest run server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts
 */

import { expect, describe, test } from 'vitest';
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

describe('WorkspaceAdapter canonical contract', () => {
  for (const [name, adapter, reset] of adapters) {
    test(`${name} — all contract scenarios`, async () => {
      reset();

      // ── Scenario 1: provisionIdentity is idempotent on provisioningRequestId ──

      const a = await adapter.provisionIdentity(BASE_PROVISION);
      expect(a.identityId, `${name}: provision returns identityId`).toBeTruthy();
      expect(a.emailAddress.includes('alex'), `${name}: email contains local part`).toBe(true);

      const b = await adapter.provisionIdentity(BASE_PROVISION); // same requestId
      expect(a.identityId, `${name}: idempotent provision — same identityId`).toBe(b.identityId);
      expect(a.emailAddress, `${name}: idempotent provision — same emailAddress`).toBe(b.emailAddress);

      // ── Scenario 2: second agent can be provisioned independently ────────────

      const c = await adapter.provisionIdentity({
        ...BASE_PROVISION,
        emailLocalPart: 'bob',
        provisioningRequestId: 'req-contract-test-2',
      });
      expect(c.identityId, `${name}: different agent gets different identityId`).not.toBe(a.identityId);

      // ── Scenario 3: sendEmail returns an externalMessageId ───────────────────

      const sent = await adapter.sendEmail({
        fromIdentityId: a.identityId,
        toAddresses: ['recipient@example.com'],
        subject: 'Contract test',
        bodyText: 'Hello from the contract test.',
        bodyHtml: null,
        policyContext: { skill: 'test', runId: 'run-1' },
      });
      expect(sent.externalMessageId, `${name}: sendEmail returns externalMessageId`).toBeTruthy();

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
      expect(evt.eventId, `${name}: createEvent returns eventId`).toBeTruthy();

      await adapter.respondToEvent(evt.eventId, 'accepted');
      await adapter.respondToEvent(evt.eventId, 'tentative'); // idempotent re-call

      // ── Scenario 5: fetchUpcoming returns the created event ──────────────────

      const upcoming = await adapter.fetchUpcoming(a.identityId, new Date(now.getTime() + 7_200_000));
      expect(upcoming.length >= 1, `${name}: fetchUpcoming returns at least the created event`).toBe(true);
      const found = upcoming.find((e) => e.title === 'Contract test meeting');
      expect(found, `${name}: fetchUpcoming includes the event we created`).toBeTruthy();

      // ── Scenario 6: fetchInboundSince returns an array (possibly empty) ──────

      const inbound = await adapter.fetchInboundSince(a.identityId, new Date(0));
      expect(Array.isArray(inbound), `${name}: fetchInboundSince returns array`).toBe(true);

      // ── Scenario 7: suspend + resume idempotent ───────────────────────────────

      await adapter.suspendIdentity(a.identityId);
      await adapter.suspendIdentity(a.identityId); // idempotent second call — should not throw
      await adapter.resumeIdentity(a.identityId);
      await adapter.resumeIdentity(a.identityId); // idempotent resume

      // ── Scenario 8: revokeIdentity and archiveIdentity do not throw ──────────

      await adapter.revokeIdentity(c.identityId);
      await adapter.archiveIdentity(c.identityId);
    });
  }
});

// ── Migration scenario: native → google (cross-adapter idempotency) ──────────
//
// NOTE: Full service-level orchestration tests (processIdentityMigration with
// audit events) require a live DB and run in CI under the test:gates suite.
// This block tests adapter-level behaviour only.

describe('WorkspaceAdapter migration: native → google', () => {
  test('cross-adapter migration is idempotent on migrationRequestId:actorId', async () => {
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
      expect(r.identityId, `native provision ${actorId}`).toBeTruthy();
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
      expect(r.identityId, `google provision ${actorId}`).toBeTruthy();
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
      expect(
        retry.identityId,
        `migration idempotency: retry for ${actorId} returns same google identityId`,
      ).toBe(googleIds[actorId]);
    }

    // Archive native identities (simulating post-migration cleanup)
    for (const actorId of actorIds) {
      await mockNativeAdapter.archiveIdentity(nativeIds[actorId]);
    }
  });
});

// ── Failure injection scenarios ───────────────────────────────────────────────

describe('WorkspaceAdapter failure injection', () => {
  test('F1: provisionIdentity fails → retry succeeds (idempotency preserved)', async () => {
    resetMockNative();
    resetMockGoogle();

    const provisioningRequestId = 'fail-test-provision-1';
    googleFail('provisionIdentity', new Error('quota_exceeded'));
    await expect(
      mockGoogleAdapter.provisionIdentity({ ...BASE_PROVISION, provisioningRequestId }),
    ).rejects.toThrow(/quota_exceeded/);

    // Retry: same provisioningRequestId, no longer failing → succeeds
    const r = await mockGoogleAdapter.provisionIdentity({ ...BASE_PROVISION, provisioningRequestId });
    expect(r.identityId, 'F1: retry after provision failure succeeds').toBeTruthy();

    // Second retry: idempotent (same identityId)
    const r2 = await mockGoogleAdapter.provisionIdentity({ ...BASE_PROVISION, provisioningRequestId });
    expect(r.identityId, 'F1: idempotent after success').toBe(r2.identityId);
  });

  test('F2: sendEmail fails once → retry succeeds', async () => {
    resetMockNative();
    resetMockGoogle();

    const r = await mockGoogleAdapter.provisionIdentity({ ...BASE_PROVISION, provisioningRequestId: 'fail-test-send-actor' });

    googleFail('sendEmail', new Error('rate_limited'));
    await expect(
      mockGoogleAdapter.sendEmail({ fromIdentityId: r.identityId, toAddresses: ['x@example.com'], subject: 'F2', bodyText: 'body', bodyHtml: null, policyContext: { skill: 'test', runId: 'run-f2' } }),
    ).rejects.toThrow(/rate_limited/);

    // Retry succeeds
    const sent = await mockGoogleAdapter.sendEmail({ fromIdentityId: r.identityId, toAddresses: ['x@example.com'], subject: 'F2', bodyText: 'body', bodyHtml: null, policyContext: { skill: 'test', runId: 'run-f2' } });
    expect(sent.externalMessageId, 'F2: retry send succeeds').toBeTruthy();
  });

  test('F3: archiveIdentity fails once → retry succeeds', async () => {
    resetMockNative();
    resetMockGoogle();

    const r = await mockNativeAdapter.provisionIdentity({ ...BASE_PROVISION, provisioningRequestId: 'fail-test-archive-1' });

    nativeFail('archiveIdentity', new Error('archive_conflict'));
    await expect(mockNativeAdapter.archiveIdentity(r.identityId)).rejects.toThrow(/archive_conflict/);

    // Retry: no longer failing
    await mockNativeAdapter.archiveIdentity(r.identityId); // should not throw
  });
});
