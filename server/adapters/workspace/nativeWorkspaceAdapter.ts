import { eq, and, gte } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { workspaceIdentities } from '../../db/schema/workspaceIdentities.js';
import { workspaceCalendarEvents } from '../../db/schema/workspaceCalendarEvents.js';
import { sendThroughProvider } from '../../lib/transactionalEmailProvider.js';
import { buildICalEvent, buildICalReply } from '../../lib/iCalBuilder.js';
import { env } from '../../lib/env.js';
import type {
  WorkspaceAdapter,
  ProvisionParams,
  ProvisionResult,
  SendEmailParams,
  InboundMessage,
  CreateEventParams,
  CreateEventResult,
  CalendarEvent,
} from './workspaceAdapterContract.js';

function getNativeDomain(): string {
  return env.NATIVE_EMAIL_DOMAIN || 'workspace.local';
}

export const nativeWorkspaceAdapter: WorkspaceAdapter = {
  backend: 'synthetos_native',

  async provisionIdentity(params: ProvisionParams): Promise<ProvisionResult> {
    const scopedDb = getOrgScopedDb('nativeAdapter.provisionIdentity');
    const emailAddress = `${params.emailLocalPart}@${getNativeDomain()}`;
    const existing = await scopedDb
      .select()
      .from(workspaceIdentities)
      .where(eq(workspaceIdentities.provisioningRequestId, params.provisioningRequestId));
    if (existing[0]) {
      return {
        identityId: existing[0].id,
        emailAddress: existing[0].emailAddress,
        externalUserId: null,
      };
    }
    const [row] = await scopedDb
      .insert(workspaceIdentities)
      .values({
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
        actorId: params.actorId,
        connectorConfigId: params.connectorConfigId,
        backend: 'synthetos_native',
        emailAddress,
        emailSendingEnabled: params.emailSendingEnabled,
        externalUserId: null,
        displayName: params.displayName,
        photoUrl: params.photoUrl ?? null,
        status: 'provisioned',
        provisioningRequestId: params.provisioningRequestId,
        metadata: { signature: params.signature },
      })
      .returning();
    return { identityId: row.id, emailAddress: row.emailAddress, externalUserId: null };
  },

  async suspendIdentity(_identityId: string): Promise<void> {
    /* native: no provider step */
  },

  async resumeIdentity(_identityId: string): Promise<void> {
    /* native: no provider step */
  },

  async revokeIdentity(_identityId: string): Promise<void> {
    /* native: no provider step */
  },

  async archiveIdentity(_identityId: string): Promise<void> {
    /* native: no provider step */
  },

  async sendEmail(
    params: SendEmailParams,
  ): Promise<{ externalMessageId: string | null; metadata?: Record<string, unknown> }> {
    const [identity] = await getOrgScopedDb('nativeAdapter.sendEmail')
      .select()
      .from(workspaceIdentities)
      .where(eq(workspaceIdentities.id, params.fromIdentityId));
    if (!identity) throw new Error(`Identity ${params.fromIdentityId} not found`);
    const result = await sendThroughProvider({
      from: identity.emailAddress,
      fromName: identity.displayName,
      to: params.toAddresses,
      cc: params.ccAddresses,
      subject: params.subject,
      bodyText: params.bodyText,
      bodyHtml: params.bodyHtml,
      messageId: params.idempotencyKey,
    });
    return { externalMessageId: result.messageId, metadata: { postmark_message_id: result.messageId } };
  },

  async fetchInboundSince(_identityId: string, _since: Date): Promise<InboundMessage[]> {
    return []; // native uses webhooks for inbound
  },

  async createEvent(params: CreateEventParams): Promise<CreateEventResult> {
    const scopedDb = getOrgScopedDb('nativeAdapter.createEvent');
    const [identity] = await scopedDb
      .select()
      .from(workspaceIdentities)
      .where(eq(workspaceIdentities.id, params.fromIdentityId));
    if (!identity) throw new Error(`Identity ${params.fromIdentityId} not found`);
    const ical = buildICalEvent({
      title: params.title,
      organiser: identity.emailAddress,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      attendeeEmails: params.attendeeEmails,
    });
    await sendThroughProvider({
      from: identity.emailAddress,
      fromName: identity.displayName,
      to: params.attendeeEmails,
      subject: params.title,
      bodyText: 'You have been invited to a calendar event.',
      attachments: [{ name: 'invite.ics', content: ical, contentType: 'text/calendar; method=REQUEST' }],
    });
    const [evt] = await scopedDb
      .insert(workspaceCalendarEvents)
      .values({
        organisationId: identity.organisationId,
        subaccountId: identity.subaccountId,
        identityId: identity.id,
        actorId: identity.actorId,
        externalEventId: null,
        organiserEmail: identity.emailAddress,
        title: params.title,
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        attendeeEmails: params.attendeeEmails,
        responseStatus: 'accepted',
        metadata: {},
      })
      .returning();
    return { eventId: evt.id, externalEventId: null };
  },

  async respondToEvent(eventId: string, response: 'accepted' | 'declined' | 'tentative'): Promise<void> {
    const scopedDb = getOrgScopedDb('nativeAdapter.respondToEvent');
    const [evt] = await scopedDb
      .select()
      .from(workspaceCalendarEvents)
      .where(eq(workspaceCalendarEvents.id, eventId));
    if (!evt) throw new Error(`Calendar event ${eventId} not found`);
    const [identity] = await scopedDb
      .select()
      .from(workspaceIdentities)
      .where(eq(workspaceIdentities.id, evt.identityId));
    if (!identity) throw new Error(`Identity ${evt.identityId} not found`);
    await scopedDb
      .update(workspaceCalendarEvents)
      .set({ responseStatus: response, updatedAt: new Date() })
      .where(eq(workspaceCalendarEvents.id, eventId));
    // For native: send an iCal REPLY to the organiser (skip when organiser == attendee)
    if (identity.emailAddress !== evt.organiserEmail) {
      const ical = buildICalReply({
        uid: (evt.metadata as Record<string, string>)?.ical_uid ?? eventId,
        attendee: identity.emailAddress,
        status: response.toUpperCase() as 'ACCEPTED' | 'DECLINED' | 'TENTATIVE',
      });
      await sendThroughProvider({
        from: identity.emailAddress,
        fromName: identity.displayName,
        to: [evt.organiserEmail],
        subject: `Re: ${evt.title}`,
        bodyText: `Response: ${response}`,
        attachments: [{ name: 'reply.ics', content: ical, contentType: 'text/calendar; method=REPLY' }],
      });
    }
  },

  async fetchUpcoming(identityId: string, until: Date): Promise<CalendarEvent[]> {
    const now = new Date();
    const rows = await getOrgScopedDb('nativeAdapter.fetchUpcoming')
      .select()
      .from(workspaceCalendarEvents)
      .where(
        and(
          eq(workspaceCalendarEvents.identityId, identityId),
          gte(workspaceCalendarEvents.endsAt, now),
        ),
      );
    return rows
      .filter((r) => r.startsAt <= until)
      .map((r) => ({
        externalEventId: r.externalEventId,
        organiserEmail: r.organiserEmail,
        title: r.title,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        attendeeEmails: r.attendeeEmails,
        responseStatus: r.responseStatus as 'needs_action' | 'accepted' | 'declined' | 'tentative',
      }));
  },
};
