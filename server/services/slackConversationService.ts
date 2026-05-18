import { eq, and } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { slackConversations, users } from '../db/schema/index.js';
import type { SlackConversation } from '../db/schema/slackConversations.js';

// ---------------------------------------------------------------------------
// Slack Conversation Service — Feature 4: Slack Conversational Surface
// ---------------------------------------------------------------------------

/**
 * Look up an existing Slack conversation by thread coordinates.
 */
export async function resolveConversation(params: {
  workspaceId: string;
  channelId: string;
  threadTs: string;
  orgId: string;
}): Promise<SlackConversation | null> {
  const scopedDb = getOrgScopedDb('slackConversationService.resolveConversation');
  const rows = await scopedDb
    .select()
    .from(slackConversations)
    .where(
      and(
        eq(slackConversations.workspaceId, params.workspaceId),
        eq(slackConversations.channelId, params.channelId),
        eq(slackConversations.threadTs, params.threadTs),
        eq(slackConversations.organisationId, params.orgId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Create a new Slack conversation record, linking a thread to an agent run.
 */
export async function createConversation(params: {
  workspaceId: string;
  channelId: string;
  threadTs: string;
  orgId: string;
  subaccountId: string;
  agentId: string;
  agentRunId: string;
}): Promise<SlackConversation> {
  const scopedDb = getOrgScopedDb('slackConversationService.createConversation');
  const [row] = await scopedDb
    .insert(slackConversations)
    .values({
      organisationId: params.orgId,
      subaccountId: params.subaccountId,
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      channelId: params.channelId,
      threadTs: params.threadTs,
      agentRunId: params.agentRunId,
    })
    .returning();

  return row!;
}

/**
 * Resolve a Slack user_id to an org user for HITL authorization.
 * Returns null if the Slack user is not linked to any org user.
 */
export async function resolveSlackUser(
  slackUserId: string,
  orgId: string,
): Promise<{ userId: string; orgId: string } | null> {
  const scopedDb = getOrgScopedDb('slackConversationService.resolveSlackUser');
  const rows = await scopedDb
    .select({ id: users.id, organisationId: users.organisationId })
    .from(users)
    .where(
      and(
        eq(users.slackUserId, slackUserId),
        eq(users.organisationId, orgId),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  return { userId: rows[0]!.id, orgId: rows[0]!.organisationId };
}

// ── Block Kit approval template ───────────────────────────────────────────────

interface ApprovalBlockContext {
  actionLabel: string;
  riskTier?: number | null;
  requiresApproval?: boolean;
  policyReason?: string | null;
  reasoning?: string | null;
}

/**
 * Build Block Kit blocks for an approval message. Includes risk tier and
 * policy reason per §5.3.4 design. No em-dashes in any copy.
 */
export function buildApprovalBlocks(ctx: ApprovalBlockContext): unknown[] {
  const tierPart = ctx.riskTier != null ? `, Tier ${ctx.riskTier}` : '';
  const policyPart = ctx.requiresApproval !== false ? ', requires approval per policy' : '';
  const actionLine = `Action: ${ctx.actionLabel}${tierPart}${policyPart}`;

  const blocks: unknown[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${actionLine}*`,
      },
    },
  ];

  if (ctx.policyReason) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Context: ${ctx.policyReason}`,
        },
      ],
    });
  }

  if (ctx.reasoning) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Agent reasoning*\n${ctx.reasoning}`,
      },
    });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Approve' },
        style: 'primary',
        action_id: 'review_approve',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Reject' },
        style: 'danger',
        action_id: 'review_reject',
      },
    ],
  });

  return blocks;
}

/**
 * Post a review item as an interactive Block Kit message to Slack.
 * Only posts if the org has a Slack connector with a configured reviewChannel.
 */
export async function postReviewItemToSlack(
  reviewItemId: string,
  orgId: string,
): Promise<void> {
  // This is a placeholder that will be wired to the actual Slack API
  // via the existing sendToSlackService once the review channel config is read.
  // For now, log the intent — the actual posting requires the Slack API token
  // and channel from the org's connector config.
  console.info(`[SlackConversation] Would post review item ${reviewItemId} to Slack for org ${orgId}`);
}
