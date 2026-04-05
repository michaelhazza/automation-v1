import axios from 'axios';
import crypto from 'crypto';
import { connectionTokenService } from '../services/connectionTokenService.js';
import { getProviderRateLimiter } from '../lib/rateLimiter.js';
import type {
  IntegrationAdapter,
  NormalisedEvent,
  MessageSendOptions,
  MessageSendResult,
  MessageChannelData,
} from './integrationAdapter.js';
import { classifyAdapterError } from './integrationAdapter.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

const SLACK_API_BASE = 'https://slack.com/api';
const TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decryptAccessToken(connection: IntegrationConnection): string {
  if (!connection.accessToken) throw new Error('Slack connection has no access token');
  return connectionTokenService.decryptToken(connection.accessToken);
}

function getHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

// ---------------------------------------------------------------------------
// Slack webhook event type mapping
// ---------------------------------------------------------------------------

type SlackEventMapping = { normalisedType: string; entityType: NormalisedEvent['entityType'] };

function mapSlackEventType(eventType: string): SlackEventMapping | null {
  switch (eventType) {
    case 'message':
    case 'app_mention':
      return { normalisedType: eventType, entityType: 'message' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Slack Adapter
// ---------------------------------------------------------------------------

export const slackAdapter: IntegrationAdapter = {
  supportedActions: ['send_message', 'list_channels'],

  // ── Outbound messaging actions ──────────────────────────────────────────
  messaging: {
    async sendMessage(
      connection: IntegrationConnection,
      channelId: string,
      text: string,
      options?: MessageSendOptions,
    ): Promise<MessageSendResult> {
      try {
        const accessToken = decryptAccessToken(connection);
        await getProviderRateLimiter('slack').acquire(connection.id);

        const body: Record<string, unknown> = { channel: channelId, text };
        if (options?.blocks) body.blocks = options.blocks;
        if (options?.threadTs) body.thread_ts = options.threadTs;
        if (options?.unfurlLinks !== undefined) body.unfurl_links = options.unfurlLinks;

        const response = await axios.post(`${SLACK_API_BASE}/chat.postMessage`, body, {
          headers: getHeaders(accessToken),
          timeout: TIMEOUT_MS,
        });

        const data = response.data as { ok?: boolean; ts?: string; error?: string };
        if (!data.ok) {
          return { messageId: '', success: false, error: { code: 'provider_error', retryable: false, message: `Slack API error: ${data.error}` } };
        }

        return { messageId: data.ts ?? '', success: true };
      } catch (err) {
        return { messageId: '', success: false, error: classifyAdapterError(err, 'slack', 'sendMessage') };
      }
    },

    async listChannels(connection: IntegrationConnection): Promise<MessageChannelData[]> {
      const accessToken = decryptAccessToken(connection);
      await getProviderRateLimiter('slack').acquire(connection.id);

      const response = await axios.get(`${SLACK_API_BASE}/conversations.list`, {
        headers: getHeaders(accessToken),
        params: { types: 'public_channel,private_channel', limit: 200, exclude_archived: true },
        timeout: TIMEOUT_MS,
      });

      const data = response.data as {
        ok?: boolean;
        channels?: Array<Record<string, unknown>>;
        error?: string;
      };

      if (!data.ok) throw new Error(`Slack API error: ${data.error}`);

      return (data.channels ?? []).map((ch) => ({
        externalId: ch.id as string,
        name: (ch.name as string) ?? '',
        type: ch.is_im ? 'dm' as const : ch.is_mpim ? 'group' as const : 'channel' as const,
        metadata: ch,
      }));
    },
  },

  // ── Webhook handling ────────────────────────────────────────────────────
  webhook: {
    verifySignature(payload: Buffer, signature: string, secret: string): boolean {
      // Slack signs "v0:timestamp:body" and the signature header is "v0=<hex>".
      // The caller constructs the basestring and passes it as payload.
      const computed = 'v0=' + crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
      const sig = Buffer.from(signature);
      const comp = Buffer.from(computed);
      if (sig.length !== comp.length) return false;
      return crypto.timingSafeEqual(sig, comp);
    },

    normaliseEvent(rawEvent: unknown): NormalisedEvent | null {
      const wrapper = rawEvent as Record<string, unknown>;

      // Slack Events API wraps the actual event inside an "event" field
      const event = (wrapper.event as Record<string, unknown>) ?? wrapper;
      const eventType = event.type as string | undefined;
      if (!eventType) return null;

      const mapping = mapSlackEventType(eventType);
      if (!mapping) return null;

      const teamId = (wrapper.team_id as string) ?? '';
      const channelId = (event.channel as string) ?? '';

      // Slack event_id is globally unique per event delivery
      const externalEventId = (wrapper.event_id as string) ?? `${eventType}:${event.ts ?? Date.now()}`;

      return {
        eventType: mapping.normalisedType,
        accountExternalId: teamId,
        entityType: mapping.entityType,
        entityExternalId: channelId,
        externalEventId,
        data: wrapper,
        timestamp: new Date(),
        sourceTimestamp: event.ts ? new Date(Number(event.ts as string) * 1000) : undefined,
      };
    },
  },
};
