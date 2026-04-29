export interface ProvisionParams {
  actorId: string;
  subaccountId: string;
  organisationId: string;
  connectorConfigId: string;
  emailLocalPart: string;
  displayName: string;
  photoUrl?: string;
  signature: string;
  emailSendingEnabled: boolean;
  provisioningRequestId: string;
}

export interface ProvisionResult {
  identityId: string;
  emailAddress: string;
  externalUserId: string | null;
}

export interface SendEmailParams {
  fromIdentityId: string;
  toAddresses: string[];
  ccAddresses?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  threadId?: string;
  inReplyToExternalId?: string;
  policyContext: { skill?: string; runId?: string };
  // Set by workspaceEmailPipeline AFTER it inserts the audit row at step (5).
  // Adapters pass this through to the provider's idempotency channel.
  idempotencyKey?: string;
}

export interface SendEmailResult {
  messageId: string;
  externalMessageId: string | null;
}

export interface InboundMessage {
  externalMessageId: string | null;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[] | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  sentAt: Date;
  receivedAt: Date;
  inReplyToExternalId: string | null;
  referencesExternalIds: string[];
  attachmentsCount: number;
  rawProviderId: string;
}

export interface CreateEventParams {
  fromIdentityId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  attendeeEmails: string[];
}

export interface CreateEventResult {
  eventId: string;
  externalEventId: string | null;
}

export interface CalendarEvent {
  externalEventId: string | null;
  organiserEmail: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  attendeeEmails: string[];
  responseStatus: 'needs_action' | 'accepted' | 'declined' | 'tentative';
}

export interface WorkspaceAdapter {
  readonly backend: 'synthetos_native' | 'google_workspace';
  provisionIdentity(params: ProvisionParams): Promise<ProvisionResult>;
  suspendIdentity(identityId: string): Promise<void>;
  resumeIdentity(identityId: string): Promise<void>;
  revokeIdentity(identityId: string): Promise<void>;
  archiveIdentity(identityId: string): Promise<void>;
  sendEmail(params: SendEmailParams): Promise<{ externalMessageId: string | null; metadata?: Record<string, unknown> }>;
  fetchInboundSince(identityId: string, since: Date): Promise<InboundMessage[]>;
  createEvent(params: CreateEventParams): Promise<CreateEventResult>;
  respondToEvent(eventId: string, response: 'accepted' | 'declined' | 'tentative'): Promise<void>;
  fetchUpcoming(identityId: string, until: Date): Promise<CalendarEvent[]>;
}
