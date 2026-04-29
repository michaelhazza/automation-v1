export type WorkspaceIdentityStatus =
  | 'provisioned' | 'active' | 'suspended' | 'revoked' | 'archived';

export interface WorkspaceActor {
  id: string;
  organisationId: string;
  subaccountId: string;
  actorKind: 'agent' | 'human';
  displayName: string;
  parentActorId: string | null;
  agentRole: string | null;
  agentTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceIdentity {
  id: string;
  organisationId: string;
  subaccountId: string;
  actorId: string;
  connectorConfigId: string;
  backend: 'synthetos_native' | 'google_workspace';
  emailAddress: string;
  emailSendingEnabled: boolean;
  externalUserId: string | null;
  displayName: string;
  photoUrl: string | null;
  status: WorkspaceIdentityStatus;
  statusChangedAt: string;
  statusChangedBy: string | null;
  provisioningRequestId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface WorkspaceMessage {
  id: string;
  organisationId: string;
  subaccountId: string;
  identityId: string;
  actorId: string;
  threadId: string;
  externalMessageId: string | null;
  direction: 'inbound' | 'outbound';
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[] | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  sentAt: string;
  receivedAt: string | null;
  auditEventId: string | null;
  rateLimitDecision: string;
  attachmentsCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface WorkspaceCalendarEvent {
  id: string;
  organisationId: string;
  subaccountId: string;
  identityId: string;
  actorId: string;
  externalEventId: string | null;
  organiserEmail: string;
  title: string;
  startsAt: string;
  endsAt: string;
  attendeeEmails: string[];
  responseStatus: 'needs_action' | 'accepted' | 'declined' | 'tentative';
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Derives the actor's visible state from its identity rows.
 * An actor is 'active' if any identity is active, 'suspended' if any is
 * suspended (and none active), 'inactive' otherwise.
 */
export function deriveActorState(
  identities: { status: WorkspaceIdentityStatus }[],
): 'active' | 'suspended' | 'inactive' {
  if (identities.some((i) => i.status === 'active')) return 'active';
  if (identities.some((i) => i.status === 'suspended')) return 'suspended';
  return 'inactive';
}
