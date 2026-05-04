/**
 * In-memory mock of googleWorkspaceAdapter for contract tests.
 * Mirrors adapter behaviour using Maps — no googleapis or DB calls.
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
  externalUserId: string;
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

const identities = new Map<string, MockIdentity>();         // id → identity
const byRequestId = new Map<string, string>();               // provisioningRequestId → id
const sentEmails: Array<{ identityId: string; params: SendEmailParams }> = [];
const events = new Map<string, MockEvent>();
const inboundQueue: InboundMessage[] = [];

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

// Reset state between test suites
export function resetMockGoogle() {
  identities.clear();
  byRequestId.clear();
  sentEmails.length = 0;
  events.clear();
  inboundQueue.length = 0;
  failNextCallMethod = null;
  failNextCallError = null;
}

export function queueInbound(msg: InboundMessage) {
  inboundQueue.push(msg);
}

export const mockGoogleAdapter: WorkspaceAdapter = {
  backend: 'google_workspace',

  async provisionIdentity(params: ProvisionParams): Promise<ProvisionResult> {
    consumeFailure('provisionIdentity');
    if (byRequestId.has(params.provisioningRequestId)) {
      const existing = identities.get(byRequestId.get(params.provisioningRequestId)!)!;
      return { identityId: existing.id, emailAddress: existing.emailAddress, externalUserId: existing.externalUserId };
    }
    const id = crypto.randomUUID();
    const emailAddress = `${params.emailLocalPart}@mock-google.workspace`;
    const externalUserId = `google-uid-${id}`;
    identities.set(id, { id, emailAddress, externalUserId, suspended: false, provisioningRequestId: params.provisioningRequestId });
    byRequestId.set(params.provisioningRequestId, id);
    return { identityId: id, emailAddress, externalUserId };
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
    await mockGoogleAdapter.suspendIdentity(identityId);
  },

  async archiveIdentity(_identityId: string): Promise<void> {
    consumeFailure('archiveIdentity');
    // no-op in mock
  },

  async sendEmail(
    params: SendEmailParams,
  ): Promise<{ externalMessageId: string | null; metadata?: Record<string, unknown> }> {
    consumeFailure('sendEmail');
    const id = `gmail-msg-${crypto.randomUUID()}`;
    sentEmails.push({ identityId: params.fromIdentityId, params });
    return { externalMessageId: id, metadata: { gmail_message_id: id, gmail_thread_id: `thread-${id}` } };
  },

  async fetchInboundSince(_identityId: string, _since: Date): Promise<InboundMessage[]> {
    consumeFailure('fetchInboundSince');
    return [...inboundQueue];
  },

  async createEvent(params: CreateEventParams): Promise<CreateEventResult> {
    consumeFailure('createEvent');
    const id = crypto.randomUUID();
    const externalEventId = `gcal-evt-${id}`;
    events.set(id, {
      id,
      fromIdentityId: params.fromIdentityId,
      title: params.title,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      attendeeEmails: params.attendeeEmails,
      responseStatus: 'accepted',
    });
    return { eventId: id, externalEventId };
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
        externalEventId: `gcal-evt-${e.id}`,
        organiserEmail: `organiser@mock-google.workspace`,
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        attendeeEmails: e.attendeeEmails,
        responseStatus: e.responseStatus,
      }));
  },
};

export { sentEmails, identities };
