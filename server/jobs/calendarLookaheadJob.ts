import type PgBoss from 'pg-boss';
import { logger } from '../lib/logger.js';
import { db } from '../db/index.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { integrationConnections } from '../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { dispatch as externalSourceDispatch } from '../services/triggers/externalSourceTriggers.js';
import { computeCalendarLookahead } from '../services/triggers/externalSourceTriggersPure.js';
import { connectionTokenService } from '../services/connectionTokenService.js';
import { CALENDAR_LOOKAHEAD_MINUTES } from '../config/limits.js';
import type { ExternalSourceTriggerEvent } from '../../shared/types/externalSourceTrigger.js';

export const CALENDAR_LOOKAHEAD_JOB = 'calendar-lookahead';

export interface CalendarLookaheadJobData {
  integrationConnectionId: string;
}

export async function calendarLookaheadHandler(job: PgBoss.Job<CalendarLookaheadJobData>): Promise<void> {
  const { integrationConnectionId } = job.data;

  // 1. Advisory lock
  const lockKey = hashStringToBigInt(`calendar_lookahead:${integrationConnectionId}`);
  const lockResult = await db.execute(
    sql`SELECT pg_try_advisory_lock(${lockKey}::bigint) AS pg_try_advisory_lock`
  );
  const acquired = (Array.from(lockResult)[0] as { pg_try_advisory_lock?: boolean } | undefined)?.pg_try_advisory_lock;
  if (!acquired) return;

  try {
    // 2. Load connection
    const [conn] = await withAdminConnection(
      { source: 'calendarLookaheadJob', reason: 'load integration_connection for cross-tenant calendar poll' },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        return tx.select().from(integrationConnections)
          .where(and(
            eq(integrationConnections.id, integrationConnectionId),
            eq(integrationConnections.providerType, 'google_calendar'),
            eq(integrationConnections.connectionStatus, 'active'),
          ))
          .limit(1);
      },
    );
    if (!conn || !conn.ownerUserId) return;

    // 3. Resolve OAuth token via connectionTokenService (system worker context set by queueService)
    let token: string;
    try {
      token = await connectionTokenService.getAccessToken(conn);
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 401 || status === 403) {
        await withAdminConnection(
          { source: 'calendarLookaheadJob', reason: 'mark connection revoked after token error' },
          async (tx) => {
            await tx.execute(sql`SET LOCAL ROLE admin_role`);
            await tx.update(integrationConnections)
              .set({ connectionStatus: 'revoked' })
              .where(eq(integrationConnections.id, integrationConnectionId));
          },
        );
      }
      return;
    }

    // 4. Query Calendar API: events between now and now+15min
    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + CALENDAR_LOOKAHEAD_MINUTES * 60_000).toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;

    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.status === 401 || resp.status === 403) {
      await withAdminConnection(
        { source: 'calendarLookaheadJob', reason: 'mark connection revoked after 401/403' },
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE admin_role`);
          await tx.update(integrationConnections)
            .set({ connectionStatus: 'revoked' })
            .where(eq(integrationConnections.id, integrationConnectionId));
        },
      );
      return;
    }
    if (resp.status === 429) {
      logger.warn('[calendar-lookahead] rate_limited', { integrationConnectionId });
      return;
    }
    if (!resp.ok) return;

    const data = await resp.json() as {
      items?: Array<{
        id: string;
        start?: { dateTime?: string; date?: string };
        summary?: string;
      }>;
    };

    // 5. For each event in window, dispatch
    for (const evt of data.items ?? []) {
      const startAt = evt.start?.dateTime ?? evt.start?.date;
      if (!startAt) continue;
      const within = computeCalendarLookahead({
        eventStartAt: startAt,
        now,
        lookaheadMinutes: CALENDAR_LOOKAHEAD_MINUTES,
      });
      if (!within.within) continue;

      const event: ExternalSourceTriggerEvent = {
        eventType: 'calendar_event_imminent',
        ownerUserId: conn.ownerUserId,
        calendarEventId: evt.id,
        summary: evt.summary,
        startAt,
        minutesUntilStart: Math.round(within.minutesUntilStart),
        dedupKey: `primary@${evt.id}@${startAt}@${CALENDAR_LOOKAHEAD_MINUTES}`,
      };
      await externalSourceDispatch(
        event,
        { organisationId: conn.organisationId, subaccountId: conn.subaccountId ?? undefined },
      );
    }

  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockKey}::bigint)`);
  }
}

function hashStringToBigInt(s: string): bigint {
  let h = 0n;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31n + BigInt(s.charCodeAt(i))) % 9223372036854775783n; // largest 63-bit prime
  }
  return h;
}
