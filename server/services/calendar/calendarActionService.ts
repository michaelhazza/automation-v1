import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { eaDrafts } from '../../db/schema/eaDrafts.js';
import { actions } from '../../db/schema/actions.js';
import { integrationConnections } from '../../db/schema/integrationConnections.js';
import { credentialBrokerService } from '../credentialBrokerService.js';
import { computeFreeSlots, normaliseAttendees } from './calendarActionServicePure.js';
import { dispatchWithDraftClaim } from '../actions/dispatchHelper.js';
import type {
  CalendarListEventsInput,
  CalendarGetEventInput,
  CalendarFindFreeSlotInput,
  CalendarCreateEventInput,
  CalendarUpdateEventInput,
  CalendarRespondToInviteInput,
} from '../../../shared/types/calendarAction.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CalendarCtx {
  organisationId: string;
  subaccountId: string;
  ownerUserId: string;
  /**
   * Internal flag — set by `eaDraftDispatchService.dispatchAfterApproval`
   * when it has already claimed the draft (ea_drafts.send_state idle → sending)
   * before invoking the handler. The handler MUST then skip its own
   * `claimSend` call. Default (undefined / false) preserves the legacy
   * direct-call contract where the handler claims itself.
   *
   * chatgpt-pr-review R2 F2: claiming in the dispatch hook ensures any
   * routing failure before this point (e.g. dynamic import error, body
   * shape mismatch, missing provider module) is paired with
   * `markSendFailed` — drafts never get stuck in `approved`/`idle`.
   */
  _dispatchPreClaimed?: boolean;
}

interface CalendarEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email: string; responseStatus?: string; displayName?: string }>;
  description?: string;
  location?: string;
  htmlLink?: string;
  etag?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

async function resolveGoogleCalendarToken(
  ownerUserId: string,
  organisationId: string,
  subaccountId: string,
): Promise<string> {
  // Find the user-owned google_calendar connection
  const [conn] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organisationId, organisationId),
        eq(integrationConnections.ownerUserId, ownerUserId),
        // providerType stored as string; cast is TS-only
        eq(integrationConnections.providerType, 'google_calendar' as never),
        eq(integrationConnections.connectionStatus, 'active'),
      ),
    )
    .limit(1);

  if (!conn) {
    throw Object.assign(
      new Error(`No active google_calendar connection found for owner ${ownerUserId}`),
      { statusCode: 404, errorCode: 'INTEGRATION_NOT_CONNECTED' },
    );
  }

  const issued = await credentialBrokerService.issueCredential({
    organisationId,
    subaccountId,
    connectionId: conn.id,
    purpose: 'calendar_action',
  });

  const env: Record<string, string> = {};
  await credentialBrokerService.injectIntoEnvironment({
    issuedCredential: issued as Parameters<typeof credentialBrokerService.injectIntoEnvironment>[0]['issuedCredential'],
    environment: env,
    ownerUserId,
  });

  const token = env['CREDENTIAL_TOKEN'];
  if (!token) {
    throw Object.assign(
      new Error('Failed to resolve Google Calendar access token'),
      { statusCode: 502, errorCode: 'CREDENTIAL_INJECT_FAILED' },
    );
  }
  return token;
}

// ---------------------------------------------------------------------------
// Google Calendar API fetch helper
// ---------------------------------------------------------------------------

async function gcalFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<unknown> {
  const base = 'https://www.googleapis.com';
  const url = path.startsWith('http') ? path : `${base}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`Google Calendar API error ${res.status}: ${body}`),
      { statusCode: res.status >= 500 ? 502 : res.status, errorCode: 'GCAL_API_ERROR', gcalStatus: res.status },
    );
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Write-action pre-flight: load draft + actions row; check approved + idle
// ---------------------------------------------------------------------------

async function writePreFlight(
  draftId: string,
  organisationId: string,
  callerOwnerUserId: string,
): Promise<void> {
  const rows = await db
    .select({
      sendState: eaDrafts.sendState,
      actionStatus: actions.status,
      draftOwnerUserId: eaDrafts.ownerUserId,
    })
    .from(eaDrafts)
    .innerJoin(actions, eq(eaDrafts.proposalActionId, actions.id))
    .where(
      and(
        eq(eaDrafts.id, draftId),
        eq(eaDrafts.organisationId, organisationId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw Object.assign(
      new Error(`EA draft ${draftId} not found`),
      { statusCode: 404, errorCode: 'DRAFT_NOT_FOUND' },
    );
  }

  // Owner-mismatch guard (spec §8.4 + post-merge audit 2026-05-13). A draft
  // belongs to exactly one owner user; an agent run executing on a different
  // owner's behalf must NOT be allowed to commit somebody else's draft, even
  // within the same organisation.
  if (row.draftOwnerUserId !== callerOwnerUserId) {
    throw Object.assign(
      new Error(`Draft ${draftId} does not belong to caller ${callerOwnerUserId}`),
      { statusCode: 403, errorCode: 'DRAFT_OWNER_MISMATCH' },
    );
  }

  if (row.actionStatus !== 'approved') {
    throw Object.assign(
      new Error(`Action for draft ${draftId} is not approved (status: ${row.actionStatus})`),
      { statusCode: 422, errorCode: 'DRAFT_NOT_APPROVED' },
    );
  }

  if (row.sendState !== 'idle') {
    throw Object.assign(
      new Error(`Draft ${draftId} send is in flight (sendState: ${row.sendState})`),
      { statusCode: 409, errorCode: 'DRAFT_SEND_IN_FLIGHT' },
    );
  }
}

// ---------------------------------------------------------------------------
// Read actions
// ---------------------------------------------------------------------------

export const calendarActionService = {
  async listEvents(
    input: CalendarListEventsInput,
    ctx: CalendarCtx,
  ): Promise<{ events: CalendarEvent[] }> {
    const token = await resolveGoogleCalendarToken(
      ctx.ownerUserId,
      ctx.organisationId,
      ctx.subaccountId,
    );

    const calendarId = encodeURIComponent(input.calendarId ?? 'primary');
    const params = new URLSearchParams({
      maxResults: String(input.maxResults ?? 10),
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    if (input.timeMin) params.set('timeMin', input.timeMin);
    if (input.timeMax) params.set('timeMax', input.timeMax);
    if (input.query) params.set('q', input.query);

    const data = await gcalFetch(
      `/calendar/v3/calendars/${calendarId}/events?${params.toString()}`,
      token,
    ) as { items?: CalendarEvent[] };

    return { events: data.items ?? [] };
  },

  async getEvent(
    input: CalendarGetEventInput,
    ctx: CalendarCtx,
  ): Promise<CalendarEvent> {
    const token = await resolveGoogleCalendarToken(
      ctx.ownerUserId,
      ctx.organisationId,
      ctx.subaccountId,
    );

    const calendarId = encodeURIComponent(input.calendarId ?? 'primary');
    const eventId = encodeURIComponent(input.eventId);

    const data = await gcalFetch(
      `/calendar/v3/calendars/${calendarId}/events/${eventId}`,
      token,
    ) as CalendarEvent;

    return data;
  },

  async findFreeSlot(
    input: CalendarFindFreeSlotInput,
    ctx: CalendarCtx,
  ): Promise<{ slots: Array<{ start: string; end: string }> }> {
    const token = await resolveGoogleCalendarToken(
      ctx.ownerUserId,
      ctx.organisationId,
      ctx.subaccountId,
    );

    const calendarId = input.calendarId ?? 'primary';
    const freeBusyBody = {
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      items: [{ id: calendarId }],
    };

    const data = await gcalFetch(
      '/calendar/v3/freeBusy',
      token,
      { method: 'POST', body: JSON.stringify(freeBusyBody) },
    ) as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> };

    const busyPeriods = data.calendars?.[calendarId]?.busy ?? [];

    const slots = computeFreeSlots({
      events: busyPeriods,
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      durationMinutes: input.durationMinutes,
    });

    return { slots };
  },

  // ---------------------------------------------------------------------------
  // Write actions
  // ---------------------------------------------------------------------------

  async createEvent(
    input: CalendarCreateEventInput & { eaDraftId: string },
    ctx: CalendarCtx,
  ): Promise<CalendarEvent> {
    await writePreFlight(input.eaDraftId, ctx.organisationId, ctx.ownerUserId);

    return dispatchWithDraftClaim({
      draftId: input.eaDraftId,
      ctx,
      performDispatch: async () => {
        const token = await resolveGoogleCalendarToken(ctx.ownerUserId, ctx.organisationId, ctx.subaccountId);
        const calendarId = encodeURIComponent(input.calendarId ?? 'primary');
        const attendees = input.attendeeEmails
          ? normaliseAttendees(input.attendeeEmails.map((email) => ({ email })))
          : undefined;

        const eventBody: Record<string, unknown> = {
          summary: input.summary,
          start: { dateTime: input.startAt },
          end: { dateTime: input.endAt },
          extendedProperties: { private: { ea_draft_id: input.eaDraftId } },
        };
        if (input.description !== undefined) eventBody['description'] = input.description;
        if (input.location !== undefined) eventBody['location'] = input.location;
        if (attendees) eventBody['attendees'] = attendees;
        if (input.conferenceType === 'meet') {
          eventBody['conferenceData'] = {
            createRequest: { requestId: input.eaDraftId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
          };
        }

        const url = input.conferenceType === 'meet'
          ? `/calendar/v3/calendars/${calendarId}/events?conferenceDataVersion=1`
          : `/calendar/v3/calendars/${calendarId}/events`;

        return gcalFetch(url, token, { method: 'POST', body: JSON.stringify(eventBody) }) as Promise<CalendarEvent>;
      },
      resolveSentId: (result) => result.id ?? '',
    });
  },

  async updateEvent(
    input: CalendarUpdateEventInput & { eaDraftId: string; etag?: string },
    ctx: CalendarCtx,
  ): Promise<CalendarEvent> {
    await writePreFlight(input.eaDraftId, ctx.organisationId, ctx.ownerUserId);

    return dispatchWithDraftClaim({
      draftId: input.eaDraftId,
      ctx,
      performDispatch: async () => {
        const token = await resolveGoogleCalendarToken(ctx.ownerUserId, ctx.organisationId, ctx.subaccountId);
        const calendarId = encodeURIComponent(input.calendarId ?? 'primary');
        const eventId = encodeURIComponent(input.eventId);

        const patchBody: Record<string, unknown> = {};
        if (input.summary !== undefined) patchBody['summary'] = input.summary;
        if (input.description !== undefined) patchBody['description'] = input.description;
        if (input.startAt !== undefined) patchBody['start'] = { dateTime: input.startAt };
        if (input.endAt !== undefined) patchBody['end'] = { dateTime: input.endAt };
        if (input.attendeeEmails !== undefined) {
          patchBody['attendees'] = normaliseAttendees(input.attendeeEmails.map((email) => ({ email })));
        }

        const headers: Record<string, string> = {};
        if (input.etag) headers['If-Match'] = input.etag;

        return gcalFetch(
          `/calendar/v3/calendars/${calendarId}/events/${eventId}`,
          token,
          { method: 'PATCH', body: JSON.stringify(patchBody), headers },
        ) as Promise<CalendarEvent>;
      },
      resolveSentId: (result) => result.id ?? '',
    });
  },

  async respondToInvite(
    input: CalendarRespondToInviteInput & { eaDraftId: string; ownerEmail: string },
    ctx: CalendarCtx,
  ): Promise<CalendarEvent> {
    await writePreFlight(input.eaDraftId, ctx.organisationId, ctx.ownerUserId);

    return dispatchWithDraftClaim({
      draftId: input.eaDraftId,
      ctx,
      performDispatch: async () => {
        const token = await resolveGoogleCalendarToken(ctx.ownerUserId, ctx.organisationId, ctx.subaccountId);
        const calendarId = encodeURIComponent(input.calendarId ?? 'primary');
        const eventId = encodeURIComponent(input.eventId);
        const patchBody = { attendees: [{ email: input.ownerEmail, responseStatus: input.response }] };

        return gcalFetch(
          `/calendar/v3/calendars/${calendarId}/events/${eventId}`,
          token,
          { method: 'PATCH', body: JSON.stringify(patchBody) },
        ) as Promise<CalendarEvent>;
      },
      resolveSentId: (result) => result.id ?? input.eventId,
    });
  },
};
