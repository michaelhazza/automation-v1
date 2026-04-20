import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema/users.js';
import { organisations } from '../db/schema/organisations.js';
import { deliverInApp } from './notifyOperatorChannels/inAppChannel.js';
import { deliverEmail } from './notifyOperatorChannels/emailChannel.js';
import { deliverSlack } from './notifyOperatorChannels/slackChannel.js';
import {
  deriveChannelAvailability,
  planFanout,
  type ChannelKey,
} from './notifyOperatorChannels/availabilityPure.js';

// ---------------------------------------------------------------------------
// Operator-alert fan-out orchestrator (spec §7.3). Called from skillExecutor
// when a notify_operator action executes post-approval. Dispatches the alert
// across in-app, email, and slack channels per requested+available plan and
// returns a per-channel result array that the caller writes to
// actions.metadata_json.fanoutResults for audit.
// ---------------------------------------------------------------------------

export type FanoutChannelResult = {
  channel: ChannelKey;
  status: 'delivered' | 'skipped_not_configured' | 'failed';
  recipientCount: number;
  errorMessage?: string;
};

export type OperatorAlertPayload = {
  title: string;
  message: string;
  channels: ChannelKey[];
  recipients: { kind: 'preset'; value: 'on_call' } | { kind: 'explicit'; userIds: string[] };
  reviewQueueLink?: string;
};

async function resolveRecipients(params: {
  organisationId: string;
  recipients: OperatorAlertPayload['recipients'];
}): Promise<{ userIds: string[]; emails: string[] }> {
  if (params.recipients.kind === 'explicit') {
    if (params.recipients.userIds.length === 0) return { userIds: [], emails: [] };
    const rows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, params.recipients.userIds));
    return {
      userIds: rows.map((r) => r.id),
      emails: rows.map((r) => r.email).filter((e): e is string => !!e),
    };
  }

  // preset: 'on_call' — resolve to all users in the org. Per spec §7.6 res 3, a
  // dedicated on-call role is pending audit; until then the preset falls back to
  // "all org members" so operators actually receive the alert.
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.organisationId, params.organisationId));
  return {
    userIds: rows.map((r) => r.id),
    emails: rows.map((r) => r.email).filter((e): e is string => !!e),
  };
}

async function loadAvailability(orgId: string): Promise<{
  emailFromAddress: string | null;
  slackWebhookUrl: string | null;
}> {
  const [org] = await db.select().from(organisations).where(eq(organisations.id, orgId));
  const settings = (org?.settings ?? {}) as Record<string, unknown>;

  // Email is available when emailService is wired server-wide; the "from address"
  // lookup sits on org settings or defaults to the globally-configured sender.
  const emailFromAddress = typeof settings.fromEmailAddress === 'string' && (settings.fromEmailAddress as string).length > 0
    ? (settings.fromEmailAddress as string)
    : (process.env.DEFAULT_FROM_EMAIL ?? null);

  // Slack webhook lives in org settings for Session 2. A future session may
  // migrate this to a dedicated orgSlackIntegrations table if pilot requires.
  const slackWebhookUrl = typeof settings.slackWebhookUrl === 'string' && (settings.slackWebhookUrl as string).length > 0
    ? (settings.slackWebhookUrl as string)
    : null;

  return { emailFromAddress, slackWebhookUrl };
}

export async function fanoutOperatorAlert(params: {
  organisationId: string;
  subaccountId: string | null;
  actionId: string;
  payload: OperatorAlertPayload;
}): Promise<FanoutChannelResult[]> {
  const availabilitySnapshot = await loadAvailability(params.organisationId);
  const availability = deriveChannelAvailability(availabilitySnapshot);
  const plan = planFanout({ requested: params.payload.channels, availability });
  const { userIds, emails } = await resolveRecipients({
    organisationId: params.organisationId,
    recipients: params.payload.recipients,
  });

  const results: FanoutChannelResult[] = [];

  for (const skipped of plan.skipped) {
    results.push({ channel: skipped, status: 'skipped_not_configured', recipientCount: 0 });
  }

  for (const channel of plan.dispatch) {
    if (channel === 'in_app') {
      results.push(
        await deliverInApp({
          organisationId: params.organisationId,
          subaccountId: params.subaccountId,
          actionId: params.actionId,
          recipientUserIds: userIds,
          title: params.payload.title,
          message: params.payload.message,
        }),
      );
    } else if (channel === 'email') {
      results.push(
        await deliverEmail({
          organisationId: params.organisationId,
          actionId: params.actionId,
          recipientEmails: emails,
          title: params.payload.title,
          message: params.payload.message,
          reviewQueueLink: params.payload.reviewQueueLink,
        }),
      );
    } else if (channel === 'slack' && availabilitySnapshot.slackWebhookUrl) {
      results.push(
        await deliverSlack({
          webhookUrl: availabilitySnapshot.slackWebhookUrl,
          actionId: params.actionId,
          title: params.payload.title,
          message: params.payload.message,
          reviewQueueLink: params.payload.reviewQueueLink,
        }),
      );
    }
  }

  return results;
}
