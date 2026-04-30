import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentMessages, agentConversations } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import type { ConversationCostResponse, ConversationCostModelBreakdown } from '../../shared/types/conversationCost.js';

// ---------------------------------------------------------------------------
// conversationCostService — read per-thread cost/token totals from
// agent_messages.cost_cents / tokens_in / tokens_out / model_id.
//
// Returns zero-defaults (not a rejected promise) when the conversation exists
// but has no cost data yet — callers can render "$0.00 · 0 tokens" safely.
// ---------------------------------------------------------------------------

export interface ConversationCostParams {
  conversationId: string;
  /** Checked against agentConversations.userId for ownership guard */
  userId: string;
  /** Checked against agentConversations.organisationId for tenant isolation */
  organisationId: string;
  agentId: string;
}

export async function getConversationCost(
  params: ConversationCostParams,
): Promise<ConversationCostResponse> {
  const { conversationId, userId, organisationId, agentId } = params;

  // Ownership check — ensures the conversation belongs to the requesting user
  // within the correct org and agent. Throws 404/403-shaped errors for the
  // route handler to forward.
  const [conv] = await db
    .select()
    .from(agentConversations)
    .where(
      and(
        eq(agentConversations.id, conversationId),
        eq(agentConversations.agentId, agentId),
        eq(agentConversations.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (!conv) {
    throw { statusCode: 404, message: 'Conversation not found', errorCode: 'CONVERSATION_NOT_FOUND' };
  }

  // 403 if the conversation belongs to a different user — intra-org user guard.
  if (conv.userId !== userId) {
    throw { statusCode: 403, message: 'Forbidden', errorCode: 'FORBIDDEN' };
  }

  // Aggregate cost/token data grouped by model_id — only assistant messages
  // carry cost data. NULLs are excluded by SUM/COUNT naturally.
  // Defence-in-depth: explicit `organisationId` filter via inner-join to
  // `agent_conversations` per §1 ("filter by organisationId in application
  // code, even with RLS"). agent_messages has no organisation_id column.
  const rows = await db
    .select({
      modelId:      agentMessages.modelId,
      costCents:    sql<number>`COALESCE(SUM(${agentMessages.costCents}), 0)`,
      tokensIn:     sql<number>`COALESCE(SUM(${agentMessages.tokensIn}), 0)`,
      tokensOut:    sql<number>`COALESCE(SUM(${agentMessages.tokensOut}), 0)`,
      messageCount: sql<number>`COUNT(*)`,
    })
    .from(agentMessages)
    .innerJoin(agentConversations, eq(agentMessages.conversationId, agentConversations.id))
    .where(
      and(
        eq(agentMessages.conversationId, conversationId),
        eq(agentMessages.role, 'assistant'),
        eq(agentConversations.organisationId, organisationId),
      ),
    )
    .groupBy(agentMessages.modelId);

  // Build model breakdown — sort by costCents DESC, exclude null modelId rows
  // from the named breakdown (they go into totals only).
  const modelBreakdown: ConversationCostModelBreakdown[] = rows
    .filter((r) => r.modelId !== null)
    .map((r) => ({
      modelId:      r.modelId as string,
      costCents:    Number(r.costCents),
      tokensIn:     Number(r.tokensIn),
      tokensOut:    Number(r.tokensOut),
      messageCount: Number(r.messageCount),
    }))
    .sort((a, b) => b.costCents - a.costCents);

  // Totals across all rows (including null modelId messages)
  const totalCostCents  = rows.reduce((s, r) => s + Number(r.costCents), 0);
  const totalTokensIn   = rows.reduce((s, r) => s + Number(r.tokensIn), 0);
  const totalTokensOut  = rows.reduce((s, r) => s + Number(r.tokensOut), 0);
  const messageCount    = rows.reduce((s, r) => s + Number(r.messageCount), 0);

  const response: ConversationCostResponse = {
    conversationId,
    totalCostCents,
    totalTokensIn,
    totalTokensOut,
    totalTokens: totalTokensIn + totalTokensOut,
    messageCount,
    modelBreakdown,
    computedAt: new Date().toISOString(),
  };

  logger.info('conversation_cost_computed', {
    conversationId,
    totalCostCents,
    totalTokens: response.totalTokens,
    action: 'conversation_cost_computed',
  });

  return response;
}
