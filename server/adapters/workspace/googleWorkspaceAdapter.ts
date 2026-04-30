/**
 * Google Workspace adapter — implements WorkspaceAdapter against:
 *   Admin SDK   (directory_v1) for user provisioning / lifecycle
 *   Gmail API   (gmail_v1)     for outbound send + inbound fetch
 *   Calendar API (calendar_v3) for event create / respond / fetch
 *
 * All user-level API calls (Gmail, Calendar) impersonate the agent's email
 * address via domain-wide delegation. Admin SDK calls impersonate the
 * GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER admin account.
 *
 * Env vars required:
 *   GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON   — path or inline JSON
 *   GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER   — admin email for impersonation
 */

import { google } from 'googleapis';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { eq, and, gte } from 'drizzle-orm';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import { workspaceIdentities } from '../../db/schema/workspaceIdentities.js';
import { workspaceCalendarEvents } from '../../db/schema/workspaceCalendarEvents.js';
import { env } from '../../lib/env.js';
import { throwFailure } from '../../../shared/iee/failure.js';
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

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

const ADMIN_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user',
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
];

const USER_GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
];

const USER_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
];

function loadCredentials(): Record<string, string> {
  const raw = env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON;
  if (!raw) throwFailure('workspace_provider_acl_denied', 'GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON is not set');
  if (raw.trim().startsWith('{')) {
    return JSON.parse(raw);
  }
  return JSON.parse(fs.readFileSync(raw, 'utf8'));
}

function makeJwt(scopes: string[], subject: string): InstanceType<typeof google.auth.JWT> {
  const creds = loadCredentials();
  return new google.auth.JWT({
    email: creds.client_email as string,
    key: creds.private_key as string,
    scopes,
    subject,
  });
}

function adminAuth() {
  const admin = env.GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER;
  if (!admin) throwFailure('workspace_provider_acl_denied', 'GOOGLE_WORKSPACE_ADMIN_DELEGATED_USER is not set');
  return makeJwt(ADMIN_SCOPES, admin);
}

function gmailAuth(agentEmail: string) {
  return makeJwt(USER_GMAIL_SCOPES, agentEmail);
}

function calendarAuth(agentEmail: string) {
  return makeJwt(USER_CALENDAR_SCOPES, agentEmail);
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function getIdentity(identityId: string) {
  const [row] = await getOrgScopedDb('googleAdapter.getIdentity')
    .select()
    .from(workspaceIdentities)
    .where(eq(workspaceIdentities.id, identityId));
  if (!row) throwFailure('workspace_provider_acl_denied', `Identity ${identityId} not found`);
  return row;
}

// ---------------------------------------------------------------------------
// RFC 2822 email encoding for Gmail API
// ---------------------------------------------------------------------------

function buildRfc2822(params: {
  from: string;
  fromName: string;
  to: string[];
  cc?: string[] | null;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
}): string {
  const lines: string[] = [
    `From: "${params.fromName}" <${params.from}>`,
    `To: ${params.to.join(', ')}`,
  ];
  if (params.cc?.length) lines.push(`Cc: ${params.cc.join(', ')}`);
  lines.push(`Subject: ${params.subject}`);
  if (params.messageId) lines.push(`Message-ID: <${params.messageId}>`);
  if (params.inReplyTo) lines.push(`In-Reply-To: <${params.inReplyTo}>`);
  if (params.references) lines.push(`References: ${params.references}`);
  lines.push('MIME-Version: 1.0');

  if (params.bodyHtml && params.bodyText) {
    const boundary = `=_boundary_${crypto.randomBytes(8).toString('hex')}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset=utf-8');
    lines.push('');
    lines.push(params.bodyText);
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset=utf-8');
    lines.push('');
    lines.push(params.bodyHtml);
    lines.push(`--${boundary}--`);
  } else {
    lines.push(`Content-Type: ${params.bodyHtml ? 'text/html' : 'text/plain'}; charset=utf-8`);
    lines.push('');
    lines.push(params.bodyText ?? params.bodyHtml ?? '');
  }

  return lines.join('\r\n');
}

function toBase64Url(str: string): string {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export const googleWorkspaceAdapter: WorkspaceAdapter = {
  backend: 'google_workspace',

  // ── Identity provisioning ─────────────────────────────────────────────────

  async provisionIdentity(params: ProvisionParams): Promise<ProvisionResult> {
    // Idempotency: check existing row first
    const scopedDb = getOrgScopedDb('googleAdapter.provisionIdentity');
    const [existing] = await scopedDb
      .select()
      .from(workspaceIdentities)
      .where(eq(workspaceIdentities.provisioningRequestId, params.provisioningRequestId));
    if (existing) {
      return { identityId: existing.id, emailAddress: existing.emailAddress, externalUserId: existing.externalUserId };
    }

    // Derive the agent's email from the connectorConfig domain
    const domain = await getDomainFromConnector(params.connectorConfigId);
    const primaryEmail = `${params.emailLocalPart}@${domain}`;
    const password = crypto.randomBytes(24).toString('base64');

    const auth = adminAuth();
    const admin = google.admin({ version: 'directory_v1', auth });

    let googleUserId: string | null = null;
    try {
      const { data } = await admin.users.insert({
        requestBody: {
          primaryEmail,
          name: {
            givenName: params.displayName.split(' ')[0] ?? params.displayName,
            familyName: params.displayName.split(' ').slice(1).join(' ') || params.displayName,
          },
          password,
          changePasswordAtNextLogin: false,
        },
      });
      googleUserId = data.id ?? null;
    } catch (err: unknown) {
      const e = err as { code?: number; errors?: Array<{ reason?: string }> };
      if (e.code === 409 || e.errors?.[0]?.reason === 'duplicate') {
        throwFailure('workspace_idempotency_collision', `Google user ${primaryEmail} already exists`);
      }
      if (e.code === 403) {
        throwFailure('workspace_provider_acl_denied', 'Service account lacks Admin SDK delegation');
      }
      throw err;
    }

    const [row] = await scopedDb
      .insert(workspaceIdentities)
      .values({
        organisationId: params.organisationId,
        subaccountId: params.subaccountId,
        actorId: params.actorId,
        connectorConfigId: params.connectorConfigId,
        backend: 'google_workspace',
        emailAddress: primaryEmail,
        emailSendingEnabled: params.emailSendingEnabled,
        externalUserId: googleUserId,
        displayName: params.displayName,
        photoUrl: params.photoUrl ?? null,
        status: 'provisioned',
        provisioningRequestId: params.provisioningRequestId,
        metadata: { signature: params.signature, googleUserId },
      })
      .onConflictDoNothing()
      .returning();

    if (!row) {
      // Race: concurrent insert won — re-fetch
      const [raced] = await scopedDb
        .select()
        .from(workspaceIdentities)
        .where(eq(workspaceIdentities.provisioningRequestId, params.provisioningRequestId));
      if (!raced) throwFailure('workspace_identity_provisioning_failed', 'DB insert failed and no existing row found');
      return { identityId: raced.id, emailAddress: raced.emailAddress, externalUserId: raced.externalUserId };
    }

    return { identityId: row.id, emailAddress: row.emailAddress, externalUserId: row.externalUserId };
  },

  async suspendIdentity(identityId: string): Promise<void> {
    const identity = await getIdentity(identityId);
    if (!identity.externalUserId) return; // no-op if not yet synced
    const auth = adminAuth();
    const admin = google.admin({ version: 'directory_v1', auth });
    await admin.users.update({
      userKey: identity.externalUserId,
      requestBody: { suspended: true },
    });
  },

  async resumeIdentity(identityId: string): Promise<void> {
    const identity = await getIdentity(identityId);
    if (!identity.externalUserId) return;
    const auth = adminAuth();
    const admin = google.admin({ version: 'directory_v1', auth });
    await admin.users.update({
      userKey: identity.externalUserId,
      requestBody: { suspended: false },
    });
  },

  async revokeIdentity(identityId: string): Promise<void> {
    // Revoke = suspend (not delete). Historical data preserved per spec §9.4.
    await googleWorkspaceAdapter.suspendIdentity(identityId);
  },

  async archiveIdentity(_identityId: string): Promise<void> {
    // No external action — local archive only.
  },

  // ── Email — outbound ──────────────────────────────────────────────────────

  async sendEmail(
    params: SendEmailParams,
  ): Promise<{ externalMessageId: string | null; metadata?: Record<string, unknown> }> {
    const identity = await getIdentity(params.fromIdentityId);
    const auth = gmailAuth(identity.emailAddress);
    const gmail = google.gmail({ version: 'v1', auth });

    const raw = buildRfc2822({
      from: identity.emailAddress,
      fromName: identity.displayName,
      to: params.toAddresses,
      cc: params.ccAddresses,
      subject: params.subject,
      bodyText: params.bodyText,
      bodyHtml: params.bodyHtml,
      inReplyTo: params.inReplyToExternalId,
      references: params.inReplyToExternalId ?? undefined,
    });

    try {
      const { data } = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: toBase64Url(raw) },
      });
      return {
        externalMessageId: data.id ?? null,
        metadata: { gmail_message_id: data.id, gmail_thread_id: data.threadId },
      };
    } catch (err: unknown) {
      const e = err as { code?: number };
      if (e.code === 403) {
        throwFailure('workspace_provider_acl_denied', 'Gmail delegation denied for ' + identity.emailAddress);
      }
      throw err;
    }
  },

  // ── Email — inbound ───────────────────────────────────────────────────────

  async fetchInboundSince(identityId: string, since: Date): Promise<InboundMessage[]> {
    const identity = await getIdentity(identityId);
    const auth = gmailAuth(identity.emailAddress);
    const gmail = google.gmail({ version: 'v1', auth });

    const sinceEpoch = Math.floor(since.getTime() / 1000);
    const { data: list } = await gmail.users.messages.list({
      userId: 'me',
      q: `in:inbox after:${sinceEpoch}`,
      maxResults: 100,
    });

    const messages: InboundMessage[] = [];
    for (const ref of list.messages ?? []) {
      if (!ref.id) continue;
      const { data: msg } = await gmail.users.messages.get({
        userId: 'me',
        id: ref.id,
        format: 'full',
      });

      const headers = msg.payload?.headers ?? [];
      const h = (name: string) => headers.find((hh) => hh.name?.toLowerCase() === name.toLowerCase())?.value ?? null;

      const fromRaw = h('From') ?? '';
      const toRaw = h('To') ?? '';
      const subject = h('Subject');
      const dateRaw = h('Date');
      const inReplyTo = h('In-Reply-To');
      const refs = h('References');
      const messageId = h('Message-ID');

      const bodyText = extractBody(msg.payload, 'text/plain');
      const bodyHtml = extractBody(msg.payload, 'text/html');
      const sentAt = dateRaw ? new Date(dateRaw) : new Date();

      messages.push({
        externalMessageId: messageId?.replace(/[<>]/g, '') ?? msg.id ?? null,
        fromAddress: fromRaw,
        toAddresses: toRaw.split(',').map((s) => s.trim()),
        ccAddresses: h('Cc')?.split(',').map((s) => s.trim()) ?? null,
        subject,
        bodyText,
        bodyHtml,
        sentAt: isNaN(sentAt.getTime()) ? new Date() : sentAt,
        receivedAt: new Date(),
        inReplyToExternalId: inReplyTo?.replace(/[<>]/g, '') ?? null,
        referencesExternalIds: refs ? refs.split(/\s+/).map((s) => s.replace(/[<>]/g, '').trim()).filter(Boolean) : [],
        attachmentsCount: (msg.payload?.parts ?? []).filter((p) => p.filename).length,
        rawProviderId: msg.id ?? '',
      });
    }

    return messages;
  },

  // ── Calendar ──────────────────────────────────────────────────────────────

  async createEvent(params: CreateEventParams): Promise<CreateEventResult> {
    const identity = await getIdentity(params.fromIdentityId);
    const auth = calendarAuth(identity.emailAddress);
    const cal = google.calendar({ version: 'v3', auth });

    const { data: gEvent } = await cal.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: params.title,
        start: { dateTime: params.startsAt.toISOString() },
        end: { dateTime: params.endsAt.toISOString() },
        attendees: params.attendeeEmails.map((email) => ({ email })),
      },
    });

    const [evt] = await getOrgScopedDb('googleAdapter.createEvent')
      .insert(workspaceCalendarEvents)
      .values({
        organisationId: identity.organisationId,
        subaccountId: identity.subaccountId,
        identityId: identity.id,
        actorId: identity.actorId,
        externalEventId: gEvent.id ?? null,
        organiserEmail: identity.emailAddress,
        title: params.title,
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        attendeeEmails: params.attendeeEmails,
        responseStatus: 'accepted',
        metadata: { gcal_event_id: gEvent.id, gcal_html_link: gEvent.htmlLink },
      })
      .returning();

    return { eventId: evt.id, externalEventId: gEvent.id ?? null };
  },

  async respondToEvent(eventId: string, response: 'accepted' | 'declined' | 'tentative'): Promise<void> {
    const scopedDb = getOrgScopedDb('googleAdapter.respondToEvent');
    const [evt] = await scopedDb
      .select()
      .from(workspaceCalendarEvents)
      .where(eq(workspaceCalendarEvents.id, eventId));
    if (!evt) throwFailure('workspace_provider_acl_denied', `Calendar event ${eventId} not found`);

    const identity = await getIdentity(evt.identityId);
    const auth = calendarAuth(identity.emailAddress);
    const cal = google.calendar({ version: 'v3', auth });

    const externalEventId = evt.externalEventId ?? (evt.metadata as Record<string, string>)?.gcal_event_id;
    if (externalEventId) {
      const gcalStatus = response === 'tentative' ? 'tentative' : response;
      await cal.events.patch({
        calendarId: 'primary',
        eventId: externalEventId,
        requestBody: {
          attendees: [{ email: identity.emailAddress, responseStatus: gcalStatus }],
        },
      });
    }

    await scopedDb
      .update(workspaceCalendarEvents)
      .set({ responseStatus: response, updatedAt: new Date() })
      .where(eq(workspaceCalendarEvents.id, eventId));
  },

  async fetchUpcoming(identityId: string, until: Date): Promise<CalendarEvent[]> {
    const identity = await getIdentity(identityId);

    // First try Google Calendar API
    try {
      const auth = calendarAuth(identity.emailAddress);
      const cal = google.calendar({ version: 'v3', auth });
      const { data } = await cal.events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        timeMax: until.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      });

      return (data.items ?? []).map((item) => {
        const selfAttendee = (item.attendees ?? []).find((a) => a.self);
        const responseStatus = selfAttendee?.responseStatus ?? 'needsAction';
        const gcalToLocal: Record<string, CalendarEvent['responseStatus']> = {
          accepted: 'accepted',
          declined: 'declined',
          tentative: 'tentative',
          needsAction: 'needs_action',
        };
        return {
          externalEventId: item.id ?? null,
          organiserEmail: item.organizer?.email ?? identity.emailAddress,
          title: item.summary ?? '(no title)',
          startsAt: new Date(item.start?.dateTime ?? item.start?.date ?? Date.now()),
          endsAt: new Date(item.end?.dateTime ?? item.end?.date ?? Date.now()),
          attendeeEmails: (item.attendees ?? []).map((a) => a.email ?? '').filter(Boolean),
          responseStatus: gcalToLocal[responseStatus] ?? 'needs_action',
        };
      });
    } catch {
      // Fall back to local DB rows (e.g. no delegation configured yet in dev)
    }

    const now = new Date();
    const rows = await getOrgScopedDb('googleAdapter.fetchUpcoming')
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
        responseStatus: r.responseStatus as CalendarEvent['responseStatus'],
      }));
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getDomainFromConnector(connectorConfigId: string): Promise<string> {
  const { connectorConfigs } = await import('../../db/schema/connectorConfigs.js');
  const [row] = await getOrgScopedDb('googleAdapter.getDomainFromConnector')
    .select({ configJson: connectorConfigs.configJson })
    .from(connectorConfigs)
    .where(eq(connectorConfigs.id, connectorConfigId));
  return (row?.configJson as { domain?: string } | null)?.domain ?? 'example.com';
}

function extractBody(payload: { mimeType?: string | null; body?: { data?: string | null } | null; parts?: typeof payload[] } | null | undefined, mimeType: string): string | null {
  if (!payload) return null;
  if (payload.mimeType === mimeType && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  for (const part of payload.parts ?? []) {
    const found = extractBody(part, mimeType);
    if (found) return found;
  }
  return null;
}
