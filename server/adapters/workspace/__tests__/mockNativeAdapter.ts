/**
 * In-memory mock of nativeWorkspaceAdapter for contract tests.
 * Mirrors adapter behaviour using Maps — no DB calls.
 */

import crypto from 'node:crypto';
import type {
  WorkspaceAdapter,
  ProvisionParams,
  ProvisionResult,
  SendEmailParams,
  InboundMessage,
  CreateEventParams,
  CreateEventResult,
  CalendarEvent,
} from '../workspaceAdapterContract.js';

interface MockIdentity {
  id: string;
  emailAddress: string;
  suspended: boolean;
  provisioningRequestId: string;
}

interface MockEvent {
  id: string;
  fromIdentityId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  attendeeEmails: string[];
  responseStatus: 'accepted' | 'declined' | 'tentative' | 'needs_action';
}

const identities = new Map<string, MockIdentity>();
const byRequestId = new Map<string, string>();
const sentEmails: Array<{ identityId: string; params: SendEmailParams }> = [];
const events = new Map<string, MockEvent>();

// failNextCall state — makes the next call to a specific method throw, then resets
let failNextCallMethod: string | null = null;
let failNextCallError: Error | null = null;

export function failNextCall(method: string | null, error?: Error | null) {
  failNextCallMethod = method;
  failNextCallError = error ?? null;
}

function consumeFailure(methodName: string): void {
  if (failNextCallMethod === methodName) {
    const err = failNextCallError ?? new Error(`mock_failure: ${methodName}`);
    failNextCallMethod = null;
    failNextCallError = null;
    throw err;
  }
}

export function resetMockNative() {
  identities.clear();
  byRequestId.clear();
  sentEmails.length = 0;
  events.clear();
  failNextCallMethod = null;
  failNextCallError = null;
}

export const mockNativeAdapter: WorkspaceAdapter = {
  backend: 'synthetos_native',

  async provisionIdentity(params: ProvisionParams): Promise<ProvisionResult> {
    consumeFailure('provisionIdentity');
    if (byRequestId.has(params.provisioningRequestId)) {
      const existing = identities.get(byRequestId.get(params.provisioningRequestId)!)!;
      return { identityId: existing.id, emailAddress: existing.emailAddress, externalUserId: null };
    }
    const id = crypto.randomUUID();
    const emailAddress = `${params.emailLocalPart}@native.workspace.local`;
    identities.set(id, { id, emailAddress, suspended: false, provisioningRequestId: params.provisioningRequestId });
    byRequestId.set(params.provisioningRequestId, id);
    return { identityId: id, emailAddress, externalUserId: null };
  },

  async suspendIdentity(identityId: string): Promise<void> {
    consumeFailure('suspendIdentity');
    const identity = identities.get(identityId);
    if (identity) identity.suspended = true;
  },

  async resumeIdentity(identityId: string): Promise<void> {
    consumeFailure('resumeIdentity');
    const identity = identities.get(identityId);
    if (identity) identity.suspended = false;
  },

  async revokeIdentity(identityId: string): Promise<void> {
    consumeFailure('revokeIdentity');
    await mockNativeAdapter.suspendIdentity(identityId);
  },

  async archiveIdentity(_identityId: string): Promise<void> {
    consumeFailure('archiveIdentity');
    // no-op
  },

  async sendEmail(
    params: SendEmailParams,
  ): Promise<{ externalMessageId: string | null; metadata?: Record<string, unknown> }> {
    consumeFailure('sendEmail');
    const id = `native-msg-${crypto.randomUUID()}`;
    sentEmails.push({ identityId: params.fromIdentityId, params });
    return { externalMessageId: id };
  },

  async fetchInboundSince(_identityId: string, _since: Date): Promise<InboundMessage[]> {
    consumeFailure('fetchInboundSince');
    return [];
  },

  async createEvent(params: CreateEventParams): Promise<CreateEventResult> {
    consumeFailure('createEvent');
    const id = crypto.randomUUID();
    events.set(id, {
      id,
      fromIdentityId: params.fromIdentityId,
      title: params.title,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      attendeeEmails: params.attendeeEmails,
      responseStatus: 'accepted',
    });
    return { eventId: id, externalEventId: null };
  },

  async respondToEvent(eventId: string, response: 'accepted' | 'declined' | 'tentative'): Promise<void> {
    consumeFailure('respondToEvent');
    const evt = events.get(eventId);
    if (evt) evt.responseStatus = response;
  },

  async fetchUpcoming(identityId: string, until: Date): Promise<CalendarEvent[]> {
    consumeFailure('fetchUpcoming');
    const now = new Date();
    return Array.from(events.values())
      .filter((e) => e.fromIdentityId === identityId && e.endsAt >= now && e.startsAt <= until)
      .map((e) => ({
        externalEventId: null,
        organiserEmail: 'organiser@native.workspace.local',
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        attendeeEmails: e.attendeeEmails,
        responseStatus: e.responseStatus,
      }));
  },
};

export { sentEmails, identities };
