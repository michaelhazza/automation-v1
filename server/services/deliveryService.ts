/**
 * deliveryService — multi-channel artefact delivery
 *
 * ENFORCEMENT BOUNDARY: All playbook "Deliver" steps MUST route through
 * `deliveryService.deliver(...)`. Direct writes to the inbox (tasks with
 * status='inbox') from outside this service are prohibited — this service
 * is the sole enforcement point for the always-on inbox guarantee.
 *
 * Delivery contract (§10.5):
 *   1. Always writes to inbox (task with status='inbox') — unconditional.
 *   2. Dispatches additional channels when enabled in deliveryConfig.
 *   3. Logs delivery attempts and outcomes per channel.
 *   4. Retries failed channel dispatches per the retry ladder:
 *        email  — 3 retries (maxAttempts=4, baseDelay=1 s)
 *        slack  — 2 retries (maxAttempts=3, baseDelay=1 s)
 *        portal — 0 retries (attribute-based, no external call)
 *
 * Spec: docs/memory-and-briefings-spec.md §10.5 (S22)
 */

import { randomUUID } from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { integrationConnections } from '../db/schema/index.js';
import { taskService } from './taskService.js';
import { connectionTokenService } from './connectionTokenService.js';
import { withBackoff } from '../lib/withBackoff.js';
import { logger } from '../lib/logger.js';
import {
  DELIVERY_RETRY_CONFIG,
  shouldDispatchChannel,
  type DeliveryArtefact,
  type DeliveryChannelConfig,
  type ChannelDispatchResult,
} from './deliveryServicePure.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { DeliveryArtefact, DeliveryChannelConfig, ChannelDispatchResult };

export interface DeliveryResult {
  /** ID of the task written to inbox (always present). */
  taskId: string;
  /** Per-channel dispatch outcomes. Always contains entries for all 3 channels. */
  channels: ChannelDispatchResult[];
}

// ---------------------------------------------------------------------------
// Internal — Slack helpers
// ---------------------------------------------------------------------------

const SLACK_POSTMESSAGE = 'https://slack.com/api/chat.postMessage';

interface SlackConfigStored {
  defaultChannel?: string;
  workspaceName?: string;
}

class SlackHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const n = parseFloat(header);
  return isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Resolve the Slack connection for a subaccount with org-level fallback.
 * Mirrors the resolution order in sendToSlackService (subaccount → org).
 */
async function resolveSlackConnection(
  organisationId: string,
  subaccountId: string,
) {
  // 1. Subaccount-scoped connection
  const [subConn] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organisationId, organisationId),
        eq(integrationConnections.subaccountId, subaccountId),
        eq(integrationConnections.providerType, 'slack'),
        eq(integrationConnections.connectionStatus, 'active'),
      ),
    )
    .limit(1);
  if (subConn) return subConn;

  // 2. Org-level fallback
  const [orgConn] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organisationId, organisationId),
        isNull(integrationConnections.subaccountId),
        eq(integrationConnections.providerType, 'slack'),
        eq(integrationConnections.connectionStatus, 'active'),
      ),
    )
    .limit(1);
  return orgConn ?? null;
}

async function slackPostMessage(token: string, channel: string, text: string): Promise<void> {
  const res = await fetch(SLACK_POSTMESSAGE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text }),
  });

  if (!res.ok) {
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
    throw new SlackHttpError(`slack.postMessage:${res.status}`, res.status, retryAfter);
  }

  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) {
    if (json.error === 'invalid_auth' || json.error === 'token_revoked') {
      throw new SlackHttpError(`slack.postMessage:invalid_auth`, 401);
    }
    if (json.error === 'channel_not_found') {
      throw new SlackHttpError(`slack.postMessage:channel_not_found`, 404);
    }
    throw new SlackHttpError(`slack.postMessage:${json.error ?? 'unknown'}`, 500);
  }
}

// ---------------------------------------------------------------------------
// Per-channel dispatch helpers
// ---------------------------------------------------------------------------

async function dispatchSlack(
  artefact: DeliveryArtefact,
  subaccountId: string,
  orgId: string,
  correlationId: string,
  taskId: string,
): Promise<ChannelDispatchResult> {
  const conn = await resolveSlackConnection(orgId, subaccountId);
  if (!conn) {
    return { channel: 'slack', status: 'not_configured', attempts: 0 };
  }

  const config = (conn.configJson as SlackConfigStored | null) ?? {};
  const channel = config.defaultChannel;
  if (!channel) {
    return {
      channel: 'slack',
      status: 'not_configured',
      attempts: 0,
      error: 'No defaultChannel configured on Slack connection',
    };
  }

  const rawToken = conn.accessToken ?? conn.secretsRef;
  if (!rawToken) {
    return { channel: 'slack', status: 'not_configured', attempts: 0, error: 'Bot token missing' };
  }
  const botToken = connectionTokenService.decryptToken(rawToken);

  const text = `*${artefact.title}*\n\n${artefact.content}`;
  const { maxAttempts, baseDelayMs } = DELIVERY_RETRY_CONFIG.slack;

  let attempts = 0;
  try {
    await withBackoff(
      async () => {
        attempts++;
        await slackPostMessage(botToken, channel, text);
      },
      {
        label: 'delivery.slack.postMessage',
        runId: taskId,
        correlationId,
        maxAttempts,
        baseDelayMs,
        maxDelayMs: 8000,
        isRetryable: (err: unknown) => {
          if (err instanceof SlackHttpError) {
            return err.status === 429 || err.status >= 500;
          }
          return true; // network-level errors are transient
        },
        retryAfterMs: (err: unknown) =>
          err instanceof SlackHttpError && err.retryAfterSeconds
            ? err.retryAfterSeconds * 1000
            : undefined,
      },
    );
    return { channel: 'slack', status: 'delivered', attempts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { channel: 'slack', status: 'failed', attempts, error: message };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Deliver an artefact to all enabled channels.
 *
 * Always-inbox invariant: a task with status='inbox' is written unconditionally
 * before any other channel dispatch. Failure of additional channel dispatches
 * never rolls back the inbox write — the artefact is always preserved.
 *
 * @param artefact  - Content to deliver (title + markdown body)
 * @param config    - Channel selection from DeliveryChannelConfig
 * @param subaccountId - Target subaccount
 * @param orgId     - Organisation (required for task creation + channel lookups)
 */
export const deliveryService = {
  async deliver(
    artefact: DeliveryArtefact,
    config: DeliveryChannelConfig,
    subaccountId: string,
    orgId: string,
  ): Promise<DeliveryResult> {
    const correlationId = randomUUID();

    // ── Step 1: Always write to inbox (system guarantee, §10.5) ─────────────
    // This write happens unconditionally regardless of config.email.
    // The inbox is the enforcement boundary — failure here is fatal and throws.
    const task = await taskService.createTask(orgId, subaccountId, {
      title: artefact.title,
      description: artefact.content,
      status: 'inbox',
      createdByAgentId: artefact.createdByAgentId,
    });

    const channels: ChannelDispatchResult[] = [];

    // ── Step 2: Email / Inbox channel ────────────────────────────────────────
    // shouldDispatchChannel('email', ...) is always true (always-on invariant).
    // The inbox write above IS the email/inbox delivery. The email flag in config
    // additionally governs whether an outbound email notification is sent to
    // workspace members (that notification path is handled by the existing
    // inbox notification system, not dispatched here).
    channels.push({ channel: 'email', status: 'delivered', attempts: 1 });

    // ── Step 3: Portal channel ───────────────────────────────────────────────
    // Portal visibility is attribute-based (governed by subaccount.portalMode).
    // No active dispatch is needed — the inbox task is automatically visible
    // to portal users when portalMode >= transparency. Log as delivered or skipped.
    if (shouldDispatchChannel('portal', config)) {
      channels.push({ channel: 'portal', status: 'delivered', attempts: 0 });
    } else {
      channels.push({ channel: 'portal', status: 'skipped', attempts: 0 });
    }

    // ── Step 4: Slack channel ────────────────────────────────────────────────
    if (shouldDispatchChannel('slack', config)) {
      const slackResult = await dispatchSlack(artefact, subaccountId, orgId, correlationId, task.id);
      channels.push(slackResult);
    } else {
      channels.push({ channel: 'slack', status: 'skipped', attempts: 0 });
    }

    // ── Step 5: Log outcome ──────────────────────────────────────────────────
    logger.info('delivery.deliver.complete', {
      taskId: task.id,
      subaccountId,
      orgId,
      correlationId,
      channels: channels.map((c) => ({
        channel: c.channel,
        status: c.status,
        attempts: c.attempts,
      })),
    });

    return { taskId: task.id, channels };
  },
};
