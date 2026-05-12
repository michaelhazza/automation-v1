import type PgBoss from 'pg-boss';
import { logger } from '../lib/logger.js';
import { db } from '../db/index.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { integrationConnections } from '../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { dispatch as externalSourceDispatch } from '../services/triggers/externalSourceTriggers.js';
import { connectionTokenService } from '../services/connectionTokenService.js';
import type { ExternalSourceTriggerEvent } from '../../shared/types/externalSourceTrigger.js';

export const GMAIL_INBOX_POLL_JOB = 'gmail-inbox-poll';

export interface GmailPollJobData {
  integrationConnectionId: string;
}

/**
 * Poll a Gmail account for new messages since the last history ID.
 * Uses pg advisory-lock to prevent concurrent pollers on the same connection.
 * On 401/403, marks the connection as 'revoked' (no error thrown).
 * On 429, returns silently (backoff handled by pg-boss retry config).
 */
export async function gmailInboxPollHandler(job: PgBoss.Job<GmailPollJobData>): Promise<void> {
  const { integrationConnectionId } = job.data;

  // 1. Advisory lock — pg_try_advisory_lock returns false if another worker holds it
  const lockKey = hashStringToBigInt(`gmail_poll:${integrationConnectionId}`);
  const lockResult = await db.execute(
    sql`SELECT pg_try_advisory_lock(${lockKey}::bigint) AS pg_try_advisory_lock`
  );
  const acquired = (Array.from(lockResult)[0] as { pg_try_advisory_lock?: boolean } | undefined)?.pg_try_advisory_lock;
  if (!acquired) {
    logger.info('[gmail-poll] lock_contended', { integrationConnectionId });
    return;
  }

  try {
    // 2. Load connection + lastHistoryId from configJson
    const [conn] = await withAdminConnection(
      { source: 'gmailInboxPollJob', reason: 'load integration_connection for cross-tenant poll' },
      async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        return tx.select().from(integrationConnections)
          .where(and(
            eq(integrationConnections.id, integrationConnectionId),
            eq(integrationConnections.providerType, 'gmail'),
            eq(integrationConnections.connectionStatus, 'active'),
          ))
          .limit(1);
      },
    );
    if (!conn || !conn.ownerUserId) {
      logger.warn('[gmail-poll] connection_not_found_or_no_owner', { integrationConnectionId });
      return;
    }

    const config = (conn.configJson ?? {}) as { lastHistoryId?: string };
    const lastHistoryId = config.lastHistoryId;

    // 3. Resolve OAuth token via connectionTokenService (system worker context set by queueService)
    let token: string;
    try {
      token = await connectionTokenService.getAccessToken(conn);
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 401 || status === 403) {
        await markConnectionRevoked(integrationConnectionId);
      }
      logger.error('[gmail-poll] token_error', { err: String(err) });
      return;
    }

    // 4. Call Gmail history.list or profile (first-run bootstrap)
    let url: string;
    if (lastHistoryId) {
      url = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${encodeURIComponent(lastHistoryId)}&historyTypes=messageAdded`;
    } else {
      url = `https://gmail.googleapis.com/gmail/v1/users/me/profile`;
    }

    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.status === 401 || resp.status === 403) {
      await markConnectionRevoked(integrationConnectionId);
      return;
    }
    if (resp.status === 429) {
      logger.warn('[gmail-poll] rate_limited', { integrationConnectionId });
      return;
    }
    if (!resp.ok) {
      logger.error('[gmail-poll] api_error', { status: resp.status, body: await resp.text() });
      return;
    }

    const data = await resp.json();

    if (!lastHistoryId) {
      // Bootstrap: store current historyId, no dispatch
      const profileHistoryId = (data as { historyId?: string }).historyId;
      if (profileHistoryId) {
        await withAdminConnection(
          { source: 'gmailInboxPollJob', reason: 'update lastHistoryId bootstrap' },
          async (tx) => {
            await tx.execute(sql`SET LOCAL ROLE admin_role`);
            await tx.update(integrationConnections)
              .set({ configJson: { ...config, lastHistoryId: profileHistoryId } })
              .where(eq(integrationConnections.id, integrationConnectionId));
          },
        );
      }
      return;
    }

    // 5. Iterate history entries; dispatch one event per new message
    const history = (data as {
      history?: Array<{
        messagesAdded?: Array<{ message: { id: string; threadId?: string } }>;
      }>;
      historyId?: string;
    }).history ?? [];

    for (const entry of history) {
      const added = entry.messagesAdded ?? [];
      for (const m of added) {
        const event: ExternalSourceTriggerEvent = {
          eventType: 'gmail_message_received',
          ownerUserId: conn.ownerUserId,
          messageId: m.message.id,
          threadId: m.message.threadId ?? '',
          fromAddress: '',
          receivedAt: new Date().toISOString(),
          dedupKey: m.message.id,
        };
        await externalSourceDispatch(
          event,
          { organisationId: conn.organisationId, subaccountId: conn.subaccountId ?? undefined },
        );
      }
    }

    // 6. Persist new historyId
    const newHistoryId = (data as { historyId?: string }).historyId;
    if (newHistoryId) {
      await withAdminConnection(
        { source: 'gmailInboxPollJob', reason: 'update lastHistoryId bootstrap' },
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE admin_role`);
          await tx.update(integrationConnections)
            .set({ configJson: { ...config, lastHistoryId: newHistoryId } })
            .where(eq(integrationConnections.id, integrationConnectionId));
        },
      );
    }

  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockKey}::bigint)`);
  }
}

async function markConnectionRevoked(integrationConnectionId: string): Promise<void> {
  await withAdminConnection(
    { source: 'gmailInboxPollJob', reason: 'mark connection revoked' },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      await tx.update(integrationConnections)
        .set({ connectionStatus: 'revoked' })
        .where(eq(integrationConnections.id, integrationConnectionId));
    },
  );
}

function hashStringToBigInt(s: string): bigint {
  // Deterministic 63-bit hash for pg_try_advisory_lock
  let h = 0n;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31n + BigInt(s.charCodeAt(i))) % 9223372036854775783n; // largest 63-bit prime
  }
  return h;
}
