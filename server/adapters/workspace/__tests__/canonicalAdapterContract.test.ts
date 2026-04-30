/**
 * Adapter contract test suite — both adapters must pass identical scenarios.
 *
 * Uses in-memory mocks (no DB, no googleapis) so this runs cleanly with:
 *   npx vitest run server/adapters/workspace/__tests__/canonicalAdapterContract.test.ts
 */

import { expect, describe, test } from 'vitest';
import type { WorkspaceAdapter } from '../workspaceAdapterContract.js';
import { mockNativeAdapter, resetMockNative } from './mockNativeAdapter.js';
import { mockGoogleAdapter, resetMockGoogle } from './mockGoogleApi.js';

const BASE_PROVISION: Parameters<WorkspaceAdapter['provisionIdentity']>[0] = {
  organisationId: '00000000-0000-0000-0000-000000000001',
  subaccountId: '00000000-0000-0000-0000-000000000002',
  actorId: '00000000-0000-0000-0000-000000000003',
  connectorConfigId: '00000000-0000-0000-0000-000000000004',
  displayName: 'Alex Agent',
  emailLocalPart: 'alex',
  emailSendingEnabled: true,
  provisioningRequestId: 'req-contract-test-1',
  signature: null,
  photoUrl: null,
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
